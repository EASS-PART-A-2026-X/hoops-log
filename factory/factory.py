#!/usr/bin/env python3
"""factory: run a work order through the software factory, and decide what happens to the result.

    python3 factory/factory.py run     factory/workorders/WO-001-case-insensitive-picker.md
    python3 factory/factory.py watch   wo-001-r1            # live dashboard, with the GM's buttons, on http://127.0.0.1:5180/
    python3 factory/factory.py status  [wo-001-r1]
    python3 factory/factory.py stop    wo-001-r1            # kills the agent's process group
    python3 factory/factory.py approve wo-001-r1 [--open-pr]   # the GM's decision (the live page's buttons do the same)
    python3 factory/factory.py reject  wo-001-r1 --reason "..."
    python3 factory/factory.py export  wo-001-r1            # rebuild report.html

Runs are saved in factory/runs/<run-id>/ (see factory/README.md for what is in there).
"""

import argparse
import os
import re
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

from factory_lib import agents, report, workorder  # noqa: E402
from factory_lib.controller import Controller, Options  # noqa: E402
from factory_lib.decide import DecisionError, decide, deliver  # noqa: E402
from factory_lib.events import read_run  # noqa: E402
from factory_lib.serve import make_server, serve  # noqa: E402

RUNS = Path(os.environ.get("FACTORY_RUNS", HERE / "runs"))  # tests point this at a temp folder
DASHBOARD = HERE / "dashboard" / "dashboard.html"


RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def run_folder(run_id: str) -> Path:
    """A run's folder, for an id typed on the command line: a plain name, and it must exist."""
    if not RUN_ID.fullmatch(run_id) or ".." in run_id:
        sys.exit(f"Not a run id: {run_id!r}")
    folder = RUNS / run_id
    if not (folder / "run.json").exists():
        sys.exit(f"No such run: {run_id}. `factory status` lists them.")
    return folder


def _stop_server(server) -> None:
    server.shutdown()
    server.server_close()


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


def _start_server(run_dir: Path, port: int):
    if not port:
        return None
    try:
        server = make_server(run_dir, port, REPO, DASHBOARD)
    except OSError as error:
        print(f"Could not serve the live page on port {port} ({error}). The run goes on without it.")
        return None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Live page, with the GM's buttons: http://127.0.0.1:{port}/")
    return server


def _wait_for_the_gm(server, run_dir: Path, port: int) -> None:
    """Keep the page up until the GM has decided (or Ctrl-C), so it never closes before you can click."""
    print(f"Waiting for the GM: open http://127.0.0.1:{port}/ and press Approve or Reject. Ctrl-C to stop serving.")
    try:
        while read_run(run_dir)["status"] == "waiting":
            time.sleep(1)
        time.sleep(10)  # let the page show the result before the server goes
    except KeyboardInterrupt:
        pass
    finally:
        _stop_server(server)


def cmd_run(args) -> int:
    wo = workorder.parse(Path(args.work_order))
    run_id = args.run_id or next_run_id(wo.id)
    if not RUN_ID.fullmatch(run_id) or ".." in run_id:
        sys.exit(f"Not a usable run id: {run_id!r}")
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
    server = _start_server(opts.run_dir, args.serve_port)
    try:
        status = Controller(wo, opts, builder, reviewer, commentator).run()
    except BaseException:
        if server:
            _stop_server(server)
        raise
    run = read_run(opts.run_dir)
    print(f"{run_id}: {status}. {run.get('reason', '')}")
    print(f"Report: {opts.run_dir / 'report.html'}")
    if server and status == "waiting":
        _wait_for_the_gm(server, opts.run_dir, args.serve_port)
    elif server:
        _stop_server(server)
    return 0 if status == "waiting" else 1


def cmd_watch(args) -> int:
    folder = run_folder(args.run_id)
    if not (folder / "index.html").exists():  # the live page is rebuilt, not stored with the evidence
        report.write_live_page(folder, DASHBOARD)
    serve(folder, args.port, REPO, DASHBOARD)
    return 0


def cmd_export(args) -> int:
    print(report.export(run_folder(args.run_id), DASHBOARD))
    return 0


def cmd_status(args) -> int:
    runs = [run_folder(args.run_id)] if args.run_id else sorted(p for p in RUNS.glob("*") if (p / "run.json").exists())
    for folder in runs:
        run = read_run(folder)
        status = run["status"]
        if status == "running" and not _alive(run.get("pid")):
            status = "died"  # the controller is gone but the run never finished
        print(f"{run['id']:<14} {status:<9} {run['work_order']['title']}  {run.get('reason', '')}")
    return 0


def _alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def cmd_stop(args) -> int:
    folder = run_folder(args.run_id)
    if read_run(folder)["status"] != "running":
        sys.exit(f"{args.run_id} is not running ({read_run(folder)['status']}): nothing to stop.")
    (folder / "STOP").write_text("stop\n")
    print("Stop order written. The controller kills the agent's process group within a second.")
    return 0


def cmd_approve(args) -> int:
    folder = run_folder(args.run_id)
    try:
        if read_run(folder)["status"] == "approved" and args.open_pr:  # approved earlier, never delivered
            print(f"Delivered: {deliver(folder, REPO, DASHBOARD)}")
            return 0
        result = decide(folder, REPO, DASHBOARD, "approve", open_pr=args.open_pr)
    except DecisionError as error:
        sys.exit(str(error))
    print(f"Approved {result['candidate']} on branch {result['branch']}.")
    if result["pr_url"]:
        print(f"Pushed that branch only, and opened: {result['pr_url']}")
    else:
        print("Nothing was pushed.")
        print(f"To deliver it: approve again with --open-pr, or git push -u origin {result['branch']} and open a PR.")
    return 0


def cmd_reject(args) -> int:
    try:
        decide(run_folder(args.run_id), REPO, DASHBOARD, "reject", reason=args.reason)
    except DecisionError as error:
        sys.exit(str(error))
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
    run.add_argument("--serve-port", type=int, default=5180, help="the live page and the GM's buttons; 0 = no page")
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
