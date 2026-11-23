"""Rules a fresh-eyes review found missing. Each test fails if its fix is taken out. No model, no network."""

import json
import shlex
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from factory_lib import agents, events, gate, gitwork, scope, workorder
from factory_lib.controller import Controller, Options
from factory_lib.decide import DecisionError, decide
from factory_lib.workorder import Check

from .conftest import DASHBOARD, HERE, git
from .test_controller import cli, fix
from .test_decide_and_serve import waiting_run
from .test_gate_and_agents import candidate_with_test, fails_first_check

HOOK = HERE / "hooks" / "scope_guard.py"

# ---------------------------------------------------------------- the hook cannot fail open


def test_the_hook_command_survives_a_path_with_a_space(monkeypatch):
    monkeypatch.setattr(agents, "HOOK", Path("/home/a person/factory/hooks/scope_guard.py"))
    monkeypatch.setattr(sys, "executable", "/opt/my python/bin/python3")
    argv = agents.ClaudeBuilder("sonnet").argv("PROMPT")
    command = json.loads(argv[argv.index("--settings") + 1])["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
    assert shlex.split(command) == ["/opt/my python/bin/python3", "/home/a person/factory/hooks/scope_guard.py"]


def test_the_hook_blocks_when_its_own_imports_fail(tmp_path):
    (tmp_path / "hooks").mkdir()
    (tmp_path / "factory_lib").mkdir()
    (tmp_path / "hooks" / "scope_guard.py").write_text(HOOK.read_text())
    (tmp_path / "factory_lib" / "__init__.py").write_text("raise ImportError('boom')\n")
    done = subprocess.run(
        [sys.executable, str(tmp_path / "hooks" / "scope_guard.py")], input="{}", capture_output=True, text=True
    )
    assert done.returncode == 2 and "could not start" in done.stderr  # not 1: Claude Code lets exit 1 through


# ---------------------------------------------------------------- the scope check, edge cases


def test_a_name_with_an_accent_or_a_space_is_judged_by_its_real_name(repo):
    (repo / "frontend/src/café.ts").write_text("// allowed\n")
    (repo / "backend/my file é.py").write_text("// not allowed\n")
    assert scope.enforce(repo, ["frontend/src/*.ts"]) == ["backend/my file é.py"]
    assert (repo / "frontend/src/café.ts").exists() and not (repo / "backend/my file é.py").exists()


def test_a_file_staged_as_new_is_removed_not_a_crash(repo):
    (repo / "backend/staged.py").write_text("z = 1\n")
    git(repo, "add", "backend/staged.py")
    assert scope.enforce(repo, ["frontend/src/shooter.ts"]) == ["backend/staged.py"]
    assert not (repo / "backend/staged.py").exists() and git(repo, "status", "--porcelain") == ""


def test_renaming_an_allowed_file_to_a_forbidden_name_is_undone(repo):
    git(repo, "mv", "frontend/src/shooter.ts", "backend/shooter.py")
    reverted = scope.enforce(repo, ["frontend/src/shooter.ts"])
    assert "backend/shooter.py" in reverted
    assert not (repo / "backend/shooter.py").exists()  # the forbidden name is gone
    # (deleting the allowed file itself is within what the order allows, so that deletion stands)
    assert scope.enforce(repo, ["frontend/src/shooter.ts"]) == []


# ---------------------------------------------------------------- the gate, edge cases


def test_a_dot_folder_is_not_mangled(repo, tmp_path):
    (repo / ".github").mkdir()
    (repo / ".github" / "test_flow.py").write_text("def test_x():\n    assert False\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "c")
    base = gitwork.rev_parse("HEAD~1", repo)
    check = Check("t", ".github", f"fails-first: {sys.executable} -m pytest -q {{files}}")
    result = gate.fails_first(repo, base, gitwork.rev_parse("HEAD", repo), check, tmp_path, 120)
    assert result.ok and ".github/test_flow.py" in result.note


def test_a_check_folder_that_leaves_the_repo_is_refused(tmp_path):
    for bad in ("../x", "/etc", "a/../../x"):
        path = tmp_path / "WO-001.md"
        path.write_text(
            "# WO-001 T\n\nOutcome: o\nFiles: a\nNon-goals: n\nVerify with: - c | " + bad + " | true\n"
            "Review focus: r\nAcceptance: a\nStop: s\nBudget: 1 repair attempts, 1 minutes\nDelivery: d\n"
        )
        with pytest.raises(workorder.WorkOrderError, match="inside the repo"):
            workorder.parse(path)


def test_a_candidate_that_deletes_a_test_file_does_not_crash_fails_first(repo, tmp_path):
    base, cand = candidate_with_test(repo, "from pkg import f\n\ndef test_f():\n    assert f() == 2\n")
    (repo / "frontend/src/shooter.test.ts").unlink()
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "delete a test")
    result = gate.fails_first(repo, base, gitwork.rev_parse("HEAD", repo), fails_first_check(), tmp_path, 120)
    assert result.ok and "shooter.test.ts" not in result.note


def test_the_tests_are_copied_byte_for_byte(repo, tmp_path):
    # a file with NO trailing newline: this test passes only if it is copied exactly. An added newline would make it
    # fail, and a fails-first that failed for that reason would wrongly count as "fails without the change"
    body = "def test_exact():\n    assert open(__file__, 'rb').read().endswith(b'# end')\n# end"
    base, cand = candidate_with_test(repo, body, change_code=False)
    result = gate.fails_first(repo, base, cand, fails_first_check(), tmp_path, 120)
    assert not result.ok and "also pass without the change" in result.note
    assert gitwork.file_at(repo, cand, "test_pkg.py") == body.encode()


def test_a_stopped_fails_first_is_not_a_pass(repo, tmp_path):
    base, cand = candidate_with_test(repo, "def test_x():\n    assert True\n")
    stop = tmp_path / "STOP"
    stop.write_text("stop")
    check = Check("t", ".", "fails-first: sleep 30")
    result = gate.fails_first(repo, base, cand, check, tmp_path, 60, stop_file=stop)
    assert not result.ok and "Stopped" in result.note


def test_a_command_that_cannot_run_is_not_a_test_that_failed(repo, tmp_path):
    base, cand = candidate_with_test(repo, "def test_x():\n    assert True\n")
    check = Check("t", ".", "fails-first: definitely-not-a-command-xyz {files}")
    result = gate.fails_first(repo, base, cand, check, tmp_path, 60)
    assert not result.ok and "could not run" in result.note


def test_the_checks_do_not_get_your_credentials(monkeypatch):
    for name in ("GH_TOKEN", "MY_API_KEY", "SSH_AUTH_SOCK", "ANTHROPIC_BASE_URL", "AWS_SECRET_ACCESS_KEY"):
        monkeypatch.setenv(name, "x")
    env = gate._env()
    assert not any(
        n in env for n in ("GH_TOKEN", "MY_API_KEY", "SSH_AUTH_SOCK", "ANTHROPIC_BASE_URL", "AWS_SECRET_ACCESS_KEY")
    )
    assert "PATH" in env and env["CI"] == "1"


# ---------------------------------------------------------------- the log, written by two processes


def test_two_processes_never_interleave_long_lines(tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    events.write_run(run_dir, {"started_at": 0.0})
    code = (
        "import sys; sys.path.insert(0, sys.argv[1]); from pathlib import Path; from factory_lib import events\n"
        "for i in range(40): events.append_event(Path(sys.argv[2]), {'actor': 'x', 'kind': 'say', 'text': sys.argv[3] * 20000})\n"
    )
    procs = [
        subprocess.Popen([sys.executable, "-c", code, str(HERE), str(run_dir), letter]) for letter in ("a", "b", "c")
    ]
    assert all(p.wait(timeout=120) == 0 for p in procs)
    lines = events.read_events(run_dir)
    assert len(lines) == 120 and all(len(set(e["text"])) == 1 and len(e["text"]) == 20000 for e in lines)


# ---------------------------------------------------------------- Ctrl-C leaves a record


def test_ctrl_c_during_a_run_is_recorded_as_stopped(repo, tmp_path, write_order):
    def interrupted(cwd, ctx):
        raise KeyboardInterrupt

    wo = workorder.parse(write_order(2, 30))
    run_dir = tmp_path / "runs" / "r1"
    opts = Options(
        repo=repo, run_dir=run_dir, run_id="r1", workdir=tmp_path / "work", dashboard=DASHBOARD, mode="scripted"
    )
    controller = Controller(wo, opts, agents.ScriptedBuilder([interrupted]), agents.ScriptedReviewer([]), None)
    with pytest.raises(KeyboardInterrupt):
        controller.run()
    run = events.read_run(run_dir)
    assert run["status"] == "stopped" and "interrupted" in run["reason"] and "finished_at" in run


# ---------------------------------------------------------------- the command line


def test_the_commands_refuse_an_id_that_is_not_a_run(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    (tmp_path / "outside").mkdir()
    for bad in ("../outside", "nope", ""):
        done = cli(runs, "stop", bad)
        assert done.returncode != 0 and not (tmp_path / "outside" / "STOP").exists()


def test_an_id_that_walks_back_into_another_run_is_refused_too(repo, tmp_path, write_order):
    from .test_controller import play

    play(repo, tmp_path, write_order, [fix])
    done = cli(tmp_path / "runs", "status", "../runs/r1")  # resolves to a real run folder, by a path
    assert done.returncode != 0 and "Not a run id" in done.stderr


def test_stopping_a_run_that_is_not_running_is_refused(repo, tmp_path, write_order):
    from .test_controller import play

    play(repo, tmp_path, write_order, [fix])
    done = cli(tmp_path / "runs", "stop", "r1")
    assert done.returncode != 0 and "not running" in done.stderr and not (tmp_path / "runs" / "r1" / "STOP").exists()


def test_two_commands_at_once_decide_a_run_once(repo, tmp_path, write_order):
    from .test_controller import play

    play(repo, tmp_path, write_order, [fix])
    codes = []
    threads = [
        threading.Thread(target=lambda c=c: codes.append(cli(tmp_path / "runs", c, "r1").returncode))
        for c in ("approve", "reject", "approve", "reject")
    ]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(codes) == [0, 1, 1, 1]
    decisions = [e for e in events.read_events(tmp_path / "runs" / "r1") if e["kind"] == "decision"]
    assert len(decisions) == 1


# ---------------------------------------------------------------- the decision, concurrently and when delivery breaks


def test_two_threads_deciding_at_once_make_one_decision(tmp_path):
    run_dir = waiting_run(tmp_path)
    outcomes, barrier = [], threading.Barrier(8)

    def go(kind):
        barrier.wait()
        try:
            outcomes.append(decide(run_dir, tmp_path, DASHBOARD, kind)["status"])
        except DecisionError:
            outcomes.append("refused")

    threads = [threading.Thread(target=go, args=(k,)) for k in ("approve", "reject") * 4]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(outcomes).count("refused") == 7 and len([o for o in outcomes if o != "refused"]) == 1
    assert len([e for e in events.read_events(run_dir) if e["kind"] == "decision"]) == 1


def test_a_failed_push_shows_readable_text_not_bytes(tmp_path):
    run_dir = waiting_run(tmp_path)

    def broken(run, repo):
        raise subprocess.CalledProcessError(128, "git push", stderr="fatal: could not read from remote")

    with pytest.raises(DecisionError, match="fatal: could not read"):
        decide(run_dir, tmp_path, DASHBOARD, "approve", open_pr=True, opener=broken)
    assert "b'" not in events.read_events(run_dir)[-1]["text"]


def test_a_hung_push_is_an_error_not_a_hang(tmp_path):
    run_dir = waiting_run(tmp_path)

    def hung(run, repo):
        raise subprocess.TimeoutExpired("git push", 120)

    with pytest.raises(DecisionError, match="delivery failed"):
        decide(run_dir, tmp_path, DASHBOARD, "approve", open_pr=True, opener=hung)
    assert events.read_run(run_dir)["status"] == "approved"


def test_the_real_delivery_uses_text_mode_and_a_timeout(tmp_path, monkeypatch):
    from factory_lib import decide as decide_module

    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv[:2], kwargs))
        return subprocess.CompletedProcess(
            argv, 0, stdout="git@github.com:o/r.git\n" if "get-url" in argv else "https://x/pull/1\n"
        )

    monkeypatch.setattr(decide_module.subprocess, "run", fake_run)
    run = {
        "branch": "factory-run/r1",
        "work_order": {"id": "WO-1", "title": "t"},
        "final_candidate": "b" * 40,
        "base": "a" * 40,
        "base_ref": "ex3",
        "id": "r1",
    }
    assert decide_module.open_pr_for(run, tmp_path) == "https://x/pull/1"
    assert all(k.get("text") is True and k.get("timeout") for _, k in calls)


def test_a_remote_that_is_not_github_is_said_plainly(tmp_path, monkeypatch):
    from factory_lib import decide as decide_module

    monkeypatch.setattr(
        decide_module.subprocess,
        "run",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 0, stdout="ssh://git.example/x.git\n"),
    )
    with pytest.raises(decide_module.DeliveryFailed, match="not on github.com"):
        decide_module._slug(tmp_path)


# ---------------------------------------------------------------- the dashboard file is the template with the fonts in


def test_the_built_dashboard_matches_its_template():
    template = (HERE / "dashboard" / "dashboard.template.html").read_text(encoding="utf-8")
    built = DASHBOARD.read_text(encoding="utf-8")
    head, tail = template.split("/*FONTS*/")
    assert built.startswith(head) and built.endswith(tail), "run: python3 factory/dashboard/build.py"
