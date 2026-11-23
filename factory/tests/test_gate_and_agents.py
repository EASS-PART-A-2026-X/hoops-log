import json
import sys
from pathlib import Path

import pytest

from factory_lib import agents, gate, gitwork
from factory_lib.workorder import Check

from .conftest import git

# ---------------------------------------------------------------- the gate


def test_checks_run_in_order_report_each_result_and_judge_by_exit_status(tmp_path):
    seen = []
    checks = (
        Check("passes", ".", "echo fine"),
        Check("fails", ".", "echo broke; exit 1"),
        Check("runs after a failure", ".", "true"),
    )
    results = gate.run_checks(tmp_path, "b", "c", checks, tmp_path, tmp_path, 30, seen.append)
    assert [(r.label, r.ok) for r in results] == [("passes", True), ("fails", False), ("runs after a failure", True)]
    assert [r.label for r in seen] == [r.label for r in results]
    text = gate.summarize(results)
    assert "PASS  passes" in text and "FAIL  fails" in text and "2 of 3 checks passed" in text
    assert "output of: fails" in text and "broke" in text


def test_a_check_that_hangs_is_killed_and_counts_as_failed(tmp_path):
    results = gate.run_checks(
        tmp_path, "b", "c", (Check("hangs", ".", "sleep 60"),), tmp_path, tmp_path, 1.0, lambda r: None
    )
    assert not results[0].ok and results[0].note == "Timed out."


def test_no_checks_run_when_the_time_is_already_gone(tmp_path):
    results = gate.run_checks(
        tmp_path, "b", "c", (Check("x", ".", "true"),), tmp_path, tmp_path, 30, lambda r: None, deadline=lambda: 0
    )
    assert results == []


def candidate_with_test(repo: Path, test_body: str, change_code: bool = True) -> tuple[str, str]:
    base = gitwork.rev_parse("HEAD", repo)
    (repo / "pkg.py").write_text("def f():\n    return 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "pkg")
    base = gitwork.rev_parse("HEAD", repo)
    if change_code:
        (repo / "pkg.py").write_text("def f():\n    return 2\n")
    if test_body:
        (repo / "test_pkg.py").write_text(test_body)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "candidate")
    return base, gitwork.rev_parse("HEAD", repo)


def fails_first_check() -> Check:
    return Check("new tests fail without the change", ".", f"fails-first: {sys.executable} -m pytest -q {{files}}")


def test_fails_first_passes_when_the_new_test_fails_on_the_original_code(repo, tmp_path):
    base, cand = candidate_with_test(repo, "from pkg import f\n\ndef test_f():\n    assert f() == 2\n")
    result = gate.fails_first(repo, base, cand, fails_first_check(), tmp_path, 120)
    assert result.ok and "failed on the original code" in result.note and "test_pkg.py" in result.note
    assert not (tmp_path / "base-check").exists()  # the scratch checkout is cleaned up


def test_fails_first_fails_when_the_new_test_also_passes_without_the_change(repo, tmp_path):
    base, cand = candidate_with_test(repo, "from pkg import f\n\ndef test_f():\n    assert f() in (1, 2)\n")
    result = gate.fails_first(repo, base, cand, fails_first_check(), tmp_path, 120)
    assert not result.ok and "do not test it" in result.note


def test_fails_first_fails_when_no_test_was_added(repo, tmp_path):
    base, cand = candidate_with_test(repo, "")
    result = gate.fails_first(repo, base, cand, fails_first_check(), tmp_path, 120)
    assert not result.ok and "no test file" in result.note.lower()


# ---------------------------------------------------------------- the agents


@pytest.mark.parametrize(
    ("text", "verdict"),
    [
        ('{"verdict": "approve", "summary": "ok", "findings": []}', "approve"),
        (
            'Here it is:\n```json\n{"verdict": "gap", "summary": "x", "findings": [{"severity": "major", "text": "y"}]}\n```',
            "gap",
        ),
        ('I think {not json} but {"verdict": "approve"} done', "approve"),
    ],
)
def test_the_verdict_is_found_in_the_reply(text, verdict):
    assert agents.parse_verdict(text)["verdict"] == verdict


@pytest.mark.parametrize("text", ["", "approve", '{"verdict": "maybe"}', '{"summary": "no verdict"}', "{broken"])
def test_a_reply_without_a_valid_verdict_gives_none(text):
    assert agents.parse_verdict(text) is None


def test_the_builder_has_no_shell_and_a_scope_hook():
    argv = agents.ClaudeBuilder("sonnet").argv("PROMPT")
    tools = argv[argv.index("--tools") + 1]
    assert tools == "Read,Glob,Grep,Edit,Write" and "Bash" not in tools
    settings = json.loads(argv[argv.index("--settings") + 1])
    command = settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
    assert command.endswith("scope_guard.py") and "Edit" in settings["hooks"]["PreToolUse"][0]["matcher"]
    assert (
        "--no-session-persistence" in argv
        and "--max-budget-usd" in argv
        and argv[argv.index("--permission-mode") + 1] == "acceptEdits"
    )


def test_the_reviewer_can_only_read(monkeypatch, tmp_path):
    captured = {}

    def fake_run(argv, cwd, env, timeout, stop_file=None, **kw):
        captured["argv"] = argv
        from factory_lib.runner import Outcome

        return Outcome(0, json.dumps({"result": "x", "num_turns": 1, "usage": {}}), 0.1)

    monkeypatch.setattr(agents, "run_bounded", fake_run)
    ctx = agents.AgentContext(None, tmp_path, (), 30, tmp_path / "STOP")
    agents.ClaudeReviewer("haiku").run("p", tmp_path, ctx)
    argv = captured["argv"]
    tools = argv[argv.index("--tools") + 1]
    assert tools == "Read,Glob,Grep" and "Edit" not in tools and "Write" not in tools and "Bash" not in tools
    assert "--settings" not in argv  # no hook: there is nothing to block


class Log:
    def __init__(self):
        self.events = []

    def emit(self, actor, kind, text, **extra):
        self.events.append({"actor": actor, "kind": kind, "text": text, **extra})


def stream(*items):
    return [json.dumps(i) for i in items]


def tool_use(id_, name, **inp):
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": id_, "name": name, "input": inp}]}}


def tool_result(id_, error=False):
    return {
        "type": "user",
        "message": {"content": [{"type": "tool_result", "tool_use_id": id_, "is_error": error, "content": "x"}]},
    }


def test_the_stream_becomes_events_and_a_blocked_edit_is_not_counted_as_an_edit(tmp_path):
    log = Log()
    t = agents.StreamTranslator(agents.AgentContext(log, tmp_path, (), 30, tmp_path / "S"), tmp_path)
    for line in stream(
        tool_use("1", "Read", file_path=str(tmp_path / "a.ts")),
        tool_use("2", "Grep", pattern="player"),
        tool_use("3", "Edit", file_path=str(tmp_path / "frontend/src/shooter.ts")),
        tool_result("3"),
        tool_use("4", "Edit", file_path=str(tmp_path / "backend/db.py")),
        tool_result("4", error=True),
        {
            "type": "result",
            "result": "done",
            "num_turns": 5,
            "total_cost_usd": 0.5,
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5,
                "cache_creation_input_tokens": 100,
                "cache_read_input_tokens": 99999,
            },
        },
    ):
        t.feed(line)
    texts = [e["text"] for e in log.events]
    assert texts == ["Read 2 files or searches: a.ts, player.", "Edited frontend/src/shooter.ts."]
    assert log.events[1]["files"] == ["frontend/src/shooter.ts"]
    assert agents._usage(t.result) == (5, 115, 0.5)  # cache reads are not counted as tokens used
    assert t.tool_log[0] == "Read a.ts"


def test_garbage_in_the_stream_is_ignored(tmp_path):
    t = agents.StreamTranslator(agents.AgentContext(Log(), tmp_path, (), 30, tmp_path / "S"), tmp_path)
    for line in ["", "not json", "{broken", '{"type": "system"}']:
        t.feed(line)
    assert t.result is None


def test_the_fixed_line_commentator_says_something_for_every_moment():
    c = agents.TemplateCommentator()
    for key in ("order", "foul", "candidate", "gate_green", "gate_red", "gap", "approved", "failed"):
        assert c.say(key, [])
    assert c.say("unknown", []) is None
