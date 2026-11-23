#!/usr/bin/env python3
"""factory: run a work order through the software factory, and decide what happens to the result.

    python3 factory/factory.py run     factory/workorders/WO-001-case-insensitive-picker.md
    python3 factory/factory.py watch   wo-001-r1            # live dashboard on http://127.0.0.1:5180/
    python3 factory/factory.py status  [wo-001-r1]
    python3 factory/factory.py stop    wo-001-r1            # kills the agent's process group
    python3 factory/factory.py approve wo-001-r1 [--open-pr]   # the GM's decision; nothing else publishes
    python3 factory/factory.py reject  wo-001-r1 --reason "..."
    python3 factory/factory.py export  wo-001-r1            # rebuild report.html

Runs are saved in factory/runs/<run-id>/ (see factory/README.md for what is in there).
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

from factory_lib import agents, report, workorder  # noqa: E402
from factory_lib.controller import Controller, Options  # noqa: E402
from factory_lib.events import append_event, read_run, update_run  # noqa: E402
from factory_lib.serve import serve  # noqa: E402

RUNS = Path(os.environ.get("FACTORY_RUNS", HERE / "runs"))  # tests point this at a temp folder
DASHBOARD = HERE / "dashboard" / "dashboard.html"


def next_run_id(wo_id: str) -> str:
    n = 1
    while (RUNS / f"{wo_id.lower()}-r{n}").exists():
        n += 1
    return f"{wo_id.lower()}-r{n}"


def _dry_run_agents():
    """Scripted stand-ins: they edit one harmless comment and approve. For smoke tests, never as evidence."""

    def build(cwd: Path, ctx) -> str:
        target = cwd / "frontend" / "src" / "shooter.ts"
        target.write_text(target.read_text() + "\n// dry run: scripted builder\n")
        ctx.log.emit("builder", "evidence", "Wrote frontend/src/shooter.ts.", files=["frontend/src/shooter.ts"])
        return "Scripted dry run: added one comment line."

    verdict = {"verdict": "approve", "summary": "Scripted dry run.", "findings": []}
    return agents.ScriptedBuilder([build]), agents.ScriptedReviewer([verdict])


def cmd_run(args) -> int:
    wo = workorder.parse(Path(args.work_order))
    run_id = args.run_id or next_run_id(wo.id)
    if args.agents == "scripted":
        builder, reviewer = _dry_run_agents()
    else:
        builder = agents.ClaudeBuilder(args.builder_model, args.max_turns, args.builder_budget_usd)
        reviewer = agents.ClaudeReviewer(args.reviewer_model)
    commentator = {
        "off": None,
        "templates": agents.TemplateCommentator(),
        "haiku": agents.ClaudeCommentator("haiku"),
    }[args.commentator]
    opts = Options(
        repo=REPO,
        run_dir=RUNS / run_id,
        run_id=run_id,
        base=args.base,
        mode="scripted" if args.agents == "scripted" else "live",
        dashboard=DASHBOARD,
    )
    print(f"Run {run_id}: watch it with  python3 factory/factory.py watch {run_id}")
    status = Controller(wo, opts, builder, reviewer, commentator).run()
    run = read_run(opts.run_dir)
    print(f"{run_id}: {status}. {run.get('reason', '')}")
    print(f"Report: {opts.run_dir / 'report.html'}")
    return 0 if status == "waiting" else 1


def cmd_watch(args) -> int:
    serve(RUNS / args.run_id, args.port)
    return 0


def cmd_export(args) -> int:
    print(report.export(RUNS / args.run_id, DASHBOARD))
    return 0


def cmd_status(args) -> int:
    runs = [RUNS / args.run_id] if args.run_id else sorted(p for p in RUNS.glob("*") if (p / "run.json").exists())
    for folder in runs:
        run = read_run(folder)
        print(f"{run['id']:<14} {run['status']:<9} {run['work_order']['title']}  {run.get('reason', '')}")
    return 0


def cmd_stop(args) -> int:
    (RUNS / args.run_id / "STOP").write_text("stop\n")
    print("Stop order written. The controller kills the agent's process group within a second.")
    return 0


def _decide(args, decision: str, text: str) -> dict:
    folder = RUNS / args.run_id
    run = read_run(folder)
    if run["status"] != "waiting":
        sys.exit(f"{args.run_id} is {run['status']}: only a run waiting for the GM can be decided.")
    append_event(folder, {"actor": "gm", "kind": "decision", "text": text.format(sha=run["final_candidate"][:7])})
    run = update_run(folder, status=decision, decided_at=time.time())
    report.export(folder, DASHBOARD)
    return run


def cmd_approve(args) -> int:
    run = _decide(args, "approved", "The GM approved candidate {sha}.")
    print(f"Approved {run['final_candidate'][:7]} on branch {run['branch']}. Nothing was pushed.")
    if args.open_pr:
        _open_pr(run)
    else:
        print(
            f"To deliver it: git push -u origin {run['branch']}, then open a PR into {run['base_ref']} (or re-run with --open-pr)."
        )
    return 0


def _open_pr(run: dict) -> None:
    subprocess.run(["git", "push", "-u", "origin", run["branch"]], cwd=REPO, check=True)
    remote = subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout.strip()
    slug = remote.removesuffix(".git").split("github.com")[-1].lstrip(":/")
    body = (
        f"Delivered by the factory from work order {run['work_order']['id']}.\n\n"
        f"Candidate {run['final_candidate'][:7]} on base {run['base'][:7]}; the GM approved it.\n"
        f"Evidence: factory/runs/{run['id']}/ (events.jsonl, receipts/, report.html)."
    )
    subprocess.run(
        [
            "gh",
            "api",
            f"repos/{slug}/pulls",
            "-f",
            f"title={run['work_order']['id']}: {run['work_order']['title']}",
            "-f",
            f"head={run['branch']}",
            "-f",
            f"base={run['base_ref']}",
            "-f",
            f"body={body}",
            "--jq",
            ".html_url",
        ],
        cwd=REPO,
        check=True,
    )


def cmd_reject(args) -> int:
    _decide(args, "rejected", "The GM rejected candidate {sha}: " + (args.reason or "no reason given") + ".")
    print("Rejected. The branch and the evidence stay for the record.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="The software factory.")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run a work order")
    run.add_argument("work_order")
    run.add_argument("--run-id")
    run.add_argument("--base", default="ex3", help="the branch the candidate starts from")
    run.add_argument("--agents", choices=["claude", "scripted"], default="claude")
    run.add_argument("--builder-model", default="sonnet")
    run.add_argument("--reviewer-model", default="haiku")
    run.add_argument("--commentator", choices=["off", "templates", "haiku"], default="templates")
    run.add_argument("--max-turns", type=int, default=40)
    run.add_argument("--builder-budget-usd", type=float, default=4.0)
    run.set_defaults(func=cmd_run)
    watch = sub.add_parser("watch", help="serve the live dashboard")
    watch.add_argument("run_id")
    watch.add_argument("--port", type=int, default=5180)
    watch.set_defaults(func=cmd_watch)
    for name, func, help_ in (
        ("export", cmd_export, "rebuild report.html"),
        ("stop", cmd_stop, "stop a run"),
        ("approve", cmd_approve, "the GM approves"),
        ("reject", cmd_reject, "the GM rejects"),
    ):
        p = sub.add_parser(name, help=help_)
        p.add_argument("run_id")
        if name == "approve":
            p.add_argument("--open-pr", action="store_true", help="push the branch and open a PR into the base")
        if name == "reject":
            p.add_argument("--reason", default="")
        p.set_defaults(func=func)
    status = sub.add_parser("status", help="list runs")
    status.add_argument("run_id", nargs="?")
    status.set_defaults(func=cmd_status)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
