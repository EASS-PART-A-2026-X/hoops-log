"""The whole pipeline, with scripted agents in a temporary git repo. No model, no network, no push."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from factory_lib import agents, gitwork, report, workorder
from factory_lib.agents import AgentReport, ScriptedBuilder, ScriptedReviewer
from factory_lib.controller import Controller, Options
from factory_lib.events import read_events, read_run

from .conftest import DASHBOARD, HERE, git

APPROVE = {"verdict": "approve", "summary": "Looks right.", "findings": []}
GAP = {
    "verdict": "gap",
    "summary": "A place still says broken.",
    "findings": [{"severity": "major", "text": "backend/other.py still says broken"}],
}


def fix(cwd: Path, ctx) -> str:
    (cwd / "frontend/src/shooter.ts").write_text("export const state = 'fixed'\n")
    return "Fixed the shooter."


def worse(cwd: Path, ctx) -> str:
    (cwd / "frontend/src/shooter.ts").write_text("export const state = 'still broken'\n")
    return "Tried something."


def tweak(cwd: Path, ctx) -> str:
    target = cwd / "frontend/src/shooter.test.ts"
    target.write_text(target.read_text() + "// another change\n")
    return "Tweaked a test."


def nothing(cwd: Path, ctx) -> str:
    return "I looked and changed nothing."


class FixedCommentator:
    label = "fixed"

    def say(self, key, recent):
        return f"commentary on {key}"


def play(
    repo,
    tmp_path,
    write_order,
    steps,
    verdicts=(APPROVE,),
    repairs=2,
    minutes=30,
    commentator=None,
    run_id="r1",
    prebuilt=None,
):
    wo = workorder.parse(write_order(repairs, minutes))
    builder = prebuilt or ScriptedBuilder(steps)
    reviewer = ScriptedReviewer(verdicts)
    opts = Options(
        repo=repo,
        run_dir=tmp_path / "runs" / run_id,
        run_id=run_id,
        workdir=tmp_path / "work",
        dashboard=DASHBOARD,
        mode="scripted",
    )
    controller = Controller(wo, opts, builder, reviewer, commentator)
    status = controller.run()
    return status, opts.run_dir, controller, builder, reviewer


def texts(run_dir, actor=None, kind=None):
    return [
        e["text"]
        for e in read_events(run_dir)
        if (actor is None or e["actor"] == actor) and (kind is None or e["kind"] == kind)
    ]


# ---------------------------------------------------------------- the good run


def test_a_good_candidate_waits_for_the_gm_and_nothing_is_published(repo, tmp_path, write_order):
    before = git(repo, "rev-parse", "ex3")
    status, run_dir, _, _, _ = play(repo, tmp_path, write_order, [fix])
    assert status == "waiting"

    ev = read_events(run_dir)
    assert ev[0]["actor"] == "announcer" and ev[0]["pass"] == {"from": "order", "to": "builder"}
    assert [e["text"] for e in ev if e["kind"] == "shot"] == ["the shooter is fixed passed."]
    assert any(e.get("newAttempt") and e["cand"] for e in ev)
    assert any(e.get("gate", {}).get("status") == "green" for e in ev)
    assert any(e.get("review", {}).get("status") == "approved" for e in ev)
    assert ev[-1]["actor"] == "announcer" and ev[-1]["text"] == "Ready for the GM. The call is yours."
    assert [e["t"] for e in ev] == sorted(e["t"] for e in ev)

    run = read_run(run_dir)
    assert run["status"] == "waiting" and len(run["candidates"]) == 1 and run["final_candidate"] == run["candidates"][0]
    assert run["checks"] == ["the shooter is fixed"] and run["base"] == before
    # the candidate lives on its own branch; the base and the user's checkout are untouched
    assert git(repo, "rev-parse", run["branch"]) == run["final_candidate"]
    assert git(repo, "rev-parse", "ex3") == before
    assert git(repo, "status", "--porcelain") == "" and git(repo, "branch", "--show-current") == "ex3"
    assert git(repo, "remote") == ""  # there is no remote to push to, and nothing tried
    assert "gate-" not in git(repo, "worktree", "list") and (repo / run["worktree"]).exists()

    for name in (
        "work-order.md",
        "scope-check-1.txt",
        "commit-1.txt",
        "diff-1.patch",
        "gate-1.txt",
        "review-1.md",
        "builder-1-summary.txt",
    ):
        assert (run_dir / "receipts" / name).exists(), name
    assert "fixed" in (run_dir / "candidate.patch").read_text()
    assert "window.RUN_DATA = null" in (run_dir / "index.html").read_text()
    assert "window.RUN_DATA = {" in (run_dir / "report.html").read_text()


def test_the_gate_runs_on_a_clean_checkout_of_the_exact_candidate(repo, tmp_path, write_order):
    def fix_and_leave_a_mess(cwd: Path, ctx) -> str:
        fix(cwd, ctx)
        return "done"

    status, run_dir, controller, _, _ = play(repo, tmp_path, write_order, [fix_and_leave_a_mess])
    assert status == "waiting"
    receipt = (run_dir / "receipts" / "gate-1.txt").read_text()
    assert receipt.startswith("candidate " + read_run(run_dir)["candidates"][0])


# ---------------------------------------------------------------- repairs and limits


def test_a_red_gate_sends_the_builder_back_with_the_real_failure(repo, tmp_path, write_order):
    status, run_dir, _, builder, _ = play(repo, tmp_path, write_order, [worse, fix])
    assert status == "waiting" and len(read_run(run_dir)["candidates"]) == 2
    assert any("repair attempt 1 of 2" in t for t in texts(run_dir, "announcer"))
    second = builder.prompts[1]
    assert "WHAT WENT WRONG LAST TIME" in second and "FAIL  the shooter is fixed" in second
    shots = [e["shot"]["made"] for e in read_events(run_dir) if e["kind"] == "shot"]
    assert shots == [False, True]
    assert [e.get("newAttempt") for e in read_events(run_dir) if "cand" in e] == [True, True]


def test_when_the_repairs_are_used_up_the_run_stops_and_never_reaches_the_gm(repo, tmp_path, write_order):
    status, run_dir, _, builder, reviewer = play(repo, tmp_path, write_order, [worse, tweak, tweak])
    run = read_run(run_dir)
    assert status == "failed" and run["status"] == "failed" and len(run["candidates"]) == 3
    assert "gate stayed red" in run["reason"] and len(builder.prompts) == 3 and reviewer.prompts == []
    assert not any("Ready for the GM" in t for t in texts(run_dir))
    assert "repairs are used up" in texts(run_dir, "announcer")[-1]


def test_zero_repairs_means_one_try(repo, tmp_path, write_order):
    status, run_dir, _, builder, _ = play(repo, tmp_path, write_order, [worse, fix], repairs=0)
    assert status == "failed" and len(builder.prompts) == 1


def test_a_reviewer_gap_sends_the_builder_back_with_the_finding(repo, tmp_path, write_order):
    status, run_dir, _, builder, _ = play(repo, tmp_path, write_order, [fix, tweak], verdicts=[GAP, APPROVE])
    assert status == "waiting" and len(read_run(run_dir)["candidates"]) == 2
    assert "backend/other.py still says broken" in builder.prompts[1]
    assert any("found a gap" in t and "repair attempt 1 of 2" in t for t in texts(run_dir, "announcer"))
    assert [e["review"]["status"] for e in read_events(run_dir) if "review" in e] == ["gap", "approved"]


def test_a_reviewer_who_never_approves_ends_the_run_after_the_repairs(repo, tmp_path, write_order):
    status, run_dir, _, _, reviewer = play(repo, tmp_path, write_order, [fix, tweak, tweak], verdicts=[GAP])
    assert (
        status == "failed"
        and "reviewer still found a gap" in read_run(run_dir)["reason"]
        and len(reviewer.prompts) == 3
    )


def test_a_reviewer_without_a_verdict_is_asked_once_more_then_the_run_stops(repo, tmp_path, write_order):
    status, run_dir, _, _, reviewer = play(repo, tmp_path, write_order, [fix], verdicts=["no json here", "still none"])
    assert status == "failed" and "no verdict" in read_run(run_dir)["reason"] and len(reviewer.prompts) == 2


def test_the_builder_changing_nothing_costs_a_repair(repo, tmp_path, write_order):
    status, run_dir, _, builder, _ = play(repo, tmp_path, write_order, [nothing, fix])
    assert status == "waiting" and len(read_run(run_dir)["candidates"]) == 1
    assert "The builder changed nothing. Builder, repair attempt 1 of 2." in texts(run_dir, "announcer")
    assert "You changed nothing" in builder.prompts[1]
    status, run_dir, *_ = play(repo, tmp_path, write_order, [nothing], repairs=0, run_id="r2")
    assert status == "failed" and "changed nothing" in read_run(run_dir)["reason"]


# ---------------------------------------------------------------- the fence


def test_changes_outside_the_files_are_reverted_and_called_fouls(repo, tmp_path, write_order):
    def greedy(cwd: Path, ctx) -> str:
        fix(cwd, ctx)
        (cwd / "backend/other.py").write_text("x = 99\n")
        (cwd / "check.py").unlink()
        (cwd / "backend/new.py").write_text("y = 1\n")
        return "did a lot"

    status, run_dir, _, _, _ = play(repo, tmp_path, write_order, [greedy])
    assert status == "waiting"  # check.py is restored, so the gate still has its check
    fouls = [e for e in read_events(run_dir) if e["kind"] == "foul"]
    assert sorted(e["text"].split(":")[0] for e in fouls) == ["Change reverted"] * 3
    assert {p for e in fouls for p in ("backend/other.py", "check.py", "backend/new.py") if p in e["text"]} == {
        "backend/other.py",
        "check.py",
        "backend/new.py",
    }
    assert all(e["actor"] == "referee" and e["box"]["builder"]["fouls"] == 1 for e in fouls)
    candidate = read_run(run_dir)["final_candidate"]
    assert gitwork.changed_files(repo, read_run(run_dir)["base"], candidate) == ["frontend/src/shooter.ts"]
    scope_receipt = (run_dir / "receipts" / "scope-check-1.txt").read_text()
    assert "REVERTED (outside the work order): backend/other.py" in scope_receipt


# ---------------------------------------------------------------- stopping


def test_a_stop_order_ends_the_run_before_the_builder_starts(repo, tmp_path, write_order):
    run_dir = tmp_path / "runs" / "r1"
    run_dir.mkdir(parents=True)
    (run_dir / "STOP").write_text("stop")
    status, run_dir, _, builder, _ = play(repo, tmp_path, write_order, [fix])
    assert status == "stopped" and builder.prompts == []
    assert texts(run_dir, "announcer")[-1] == "Stop order received. The run is stopped."


def test_a_budget_of_zero_minutes_is_an_immediate_out_of_time(repo, tmp_path, write_order):
    status, run_dir, _, builder, _ = play(repo, tmp_path, write_order, [fix], minutes=0)
    assert status == "stopped" and builder.prompts == [] and "shot clock ran out" in texts(run_dir, "announcer")[-1]


class SlowBuilder:
    label = "slow"

    def run(self, prompt, cwd, ctx):
        return AgentReport(text="partial", timed_out=True)


def test_a_builder_that_runs_out_of_time_is_stopped_and_the_run_ends(repo, tmp_path, write_order):
    status, run_dir, *_ = play(repo, tmp_path, write_order, [], prebuilt=SlowBuilder())
    assert status == "stopped" and "ran out of time" in read_run(run_dir)["reason"]
    assert any("Time is up" in t for t in texts(run_dir, "referee"))


class BrokenBuilder:
    label = "broken"

    def run(self, prompt, cwd, ctx):
        return AgentReport(failed="claude ended without a result")


def test_a_builder_that_cannot_run_ends_the_run_with_the_reason(repo, tmp_path, write_order):
    status, run_dir, *_ = play(repo, tmp_path, write_order, [], prebuilt=BrokenBuilder())
    assert status == "failed" and "could not run" in read_run(run_dir)["reason"]


def test_a_bug_in_the_factory_is_recorded_and_raised_not_hidden(repo, tmp_path, write_order):
    def boom(cwd, ctx):
        raise RuntimeError("kaboom")

    with pytest.raises(RuntimeError, match="kaboom"):
        play(repo, tmp_path, write_order, [boom])
    run_dir = tmp_path / "runs" / "r1"
    assert read_run(run_dir)["status"] == "error" and "kaboom" in read_run(run_dir)["reason"]
    assert any("The factory itself failed" in t for t in texts(run_dir, "referee"))


# ---------------------------------------------------------------- the commentator and the report


def test_the_commentator_only_narrates_and_is_marked_as_commentary(repo, tmp_path, write_order):
    status, run_dir, *_ = play(repo, tmp_path, write_order, [fix], commentator=FixedCommentator())
    lines = [e for e in read_events(run_dir) if e["actor"] == "commentator"]
    assert [e["text"] for e in lines] == [
        f"commentary on {k}" for k in ("order", "candidate", "gate_green", "approved")
    ]
    assert all(e["kind"] == "commentary" for e in lines)
    assert read_run(run_dir)["models"]["commentator"] == "fixed"


def test_the_report_embeds_the_whole_run_and_survives_script_tags_in_the_text(tmp_path):
    run_dir = tmp_path / "run"
    (run_dir / "receipts").mkdir(parents=True)
    from factory_lib import events

    events.write_run(run_dir, {"started_at": 1.0, "id": "r"})
    events.append_event(run_dir, {"actor": "builder", "kind": "say", "text": "</script><b>x"}, 1.0)
    (run_dir / "receipts" / "gate-1.txt").write_text("PASS everything")
    path = report.export(run_dir, DASHBOARD)
    html = path.read_text()
    assert "</script><b>x" not in html and "<\\/script><b>x" in html and "PASS everything" in html


def test_a_dashboard_without_the_data_marker_is_refused(tmp_path):
    bad = tmp_path / "d.html"
    bad.write_text("<html></html>")
    with pytest.raises(ValueError, match="RUN_DATA"):
        report.write_live_page(tmp_path, bad)


# ---------------------------------------------------------------- the GM's decision


def cli(runs: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "FACTORY_RUNS": str(runs)}
    return subprocess.run([sys.executable, str(HERE / "factory.py"), *args], env=env, capture_output=True, text=True)


def test_only_the_gm_command_decides_and_only_a_waiting_run_can_be_decided(repo, tmp_path, write_order):
    play(repo, tmp_path, write_order, [fix])
    play(repo, tmp_path, write_order, [worse], repairs=0, run_id="r2")  # a failed run
    runs = tmp_path / "runs"
    assert read_run(runs / "r1")["status"] == "waiting"  # finishing a run is not approving it

    refused = cli(runs, "approve", "r2")
    assert refused.returncode != 0 and "only a run waiting for the GM" in refused.stderr
    assert read_run(runs / "r2")["status"] == "failed"

    approved = cli(runs, "approve", "r1")
    assert approved.returncode == 0 and "Nothing was pushed" in approved.stdout
    run = read_run(runs / "r1")
    assert run["status"] == "approved"
    last = read_events(runs / "r1")[-1]
    assert (last["actor"], last["kind"]) == ("gm", "decision") and "approved candidate" in last["text"]
    assert "approved candidate" in (runs / "r1" / "report.html").read_text()
    assert git(repo, "remote") == ""
    assert cli(runs, "approve", "r1").returncode != 0  # the decision is made once


def test_a_rejection_keeps_the_reason(repo, tmp_path, write_order):
    play(repo, tmp_path, write_order, [fix])
    runs = tmp_path / "runs"
    done = cli(runs, "reject", "r1", "--reason", "too broad")
    assert done.returncode == 0 and read_run(runs / "r1")["status"] == "rejected"
    assert "too broad" in read_events(runs / "r1")[-1]["text"]


def test_the_stop_command_writes_the_stop_file(repo, tmp_path, write_order):
    runs = tmp_path / "runs"
    (runs / "r9").mkdir(parents=True)
    assert cli(runs, "stop", "r9").returncode == 0 and (runs / "r9" / "STOP").exists()


def test_status_lists_runs(repo, tmp_path, write_order):
    play(repo, tmp_path, write_order, [fix])
    out = cli(tmp_path / "runs", "status").stdout
    assert "r1" in out and "waiting" in out and "Make the shooter fixed" in out


def test_agents_module_exposes_what_the_cli_uses():
    assert all(
        hasattr(agents, n)
        for n in (
            "ClaudeBuilder",
            "ClaudeReviewer",
            "ClaudeCommentator",
            "TemplateCommentator",
            "ScriptedBuilder",
            "ScriptedReviewer",
        )
    )


def test_a_run_that_cannot_even_start_is_recorded_as_an_error_not_left_running(repo, tmp_path, write_order):
    git(repo, "branch", "factory-run")  # an ordinary branch with that name makes factory-run/r1 impossible
    with pytest.raises(RuntimeError, match="worktree add"):
        play(repo, tmp_path, write_order, [fix])
    run = read_run(tmp_path / "runs" / "r1")
    assert run["status"] == "error" and "worktree add" in run["reason"]


def test_run_branches_do_not_collide_with_a_branch_called_factory(repo, tmp_path, write_order):
    git(repo, "branch", "factory")
    status, run_dir, *_ = play(repo, tmp_path, write_order, [fix])
    assert status == "waiting" and read_run(run_dir)["branch"] == "factory-run/r1"


def test_the_saved_evidence_has_no_machine_specific_paths_and_names_the_factory_version(repo, tmp_path, write_order):
    status, run_dir, *_ = play(repo, tmp_path, write_order, [fix])
    run = read_run(run_dir)
    assert run["factory_version"]
    for value in (run["worktree"], *run["where"].values()):
        assert not value.startswith("/") or str(repo) not in value, value
    assert run["where"]["event_log"].endswith("events.jsonl")


def test_the_factory_version_ignores_run_folders_but_not_edited_factory_code(repo, tmp_path, write_order):
    (repo / "factory" / "runs").mkdir(parents=True)
    (repo / "factory" / "runs" / "old.txt").write_text("evidence")
    (repo / "factory" / "factory_lib").mkdir()
    (repo / "factory" / "factory_lib" / "x.py").write_text("x = 1\n")
    git(repo, "add", "factory/factory_lib")
    git(repo, "commit", "-q", "-m", "factory code")
    _, run_dir, *_ = play(repo, tmp_path, write_order, [fix], run_id="clean")
    assert "+uncommitted" not in read_run(run_dir)["factory_version"]
    (repo / "factory" / "factory_lib" / "x.py").write_text("x = 2\n")  # edited, not committed
    _, run_dir, *_ = play(repo, tmp_path, write_order, [fix], run_id="dirty")
    assert read_run(run_dir)["factory_version"].endswith("+uncommitted")


def test_status_says_when_a_running_run_has_lost_its_controller(repo, tmp_path, write_order):
    _, run_dir, *_ = play(repo, tmp_path, write_order, [fix])
    from factory_lib.events import update_run

    update_run(run_dir, status="running", pid=2**22 + 1)  # no such process
    assert "died" in cli(tmp_path / "runs", "status").stdout


def test_watch_rebuilds_the_live_page_when_it_is_missing(repo, tmp_path, write_order, monkeypatch):
    _, run_dir, *_ = play(repo, tmp_path, write_order, [fix])
    (run_dir / "index.html").unlink()
    import importlib.util

    spec = importlib.util.spec_from_file_location("factory_cli", HERE / "factory.py")
    cli_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli_module)
    monkeypatch.setattr(cli_module, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(cli_module, "serve", lambda folder, port: None)
    args = type("A", (), {"run_id": "r1", "port": 1})()
    cli_module.cmd_watch(args)
    assert "window.RUN_DATA = null" in (run_dir / "index.html").read_text()


def test_a_long_message_is_cut_at_a_word_and_marked():
    from factory_lib.controller import clip

    assert clip("short") == "short"
    long = ("word " * 200).strip()
    out = clip(long, 50)
    assert len(out) <= 50 and out.endswith("…") and not out[:-1].endswith("wor")
    assert clip("a" * 100, 50).endswith("…")  # no spaces to cut at: still cut, still marked
