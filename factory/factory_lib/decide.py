"""The GM's decision: approve or reject a run that is waiting, and (only if asked) deliver it.

This is the ONE place a decision is made. The command line (`factory approve`) and the live page's
buttons both call it, so they cannot disagree. Nothing here runs unless a person asked: the
controller never calls it.

    approve          records the decision. Nothing is pushed.
    approve + PR     then pushes ONLY the candidate branch and opens a pull request into the base.
    reject           records the decision and the reason.
"""

import subprocess
import time
from collections.abc import Callable
from pathlib import Path

from . import report
from .events import append_event, read_run, update_run


class DecisionError(Exception):
    """The decision cannot be made (wrong state, or delivery failed)."""


def _slug(repo: Path) -> str:
    remote = subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()
    return remote.removesuffix(".git").split("github.com")[-1].lstrip(":/")


def open_pr_for(run: dict, repo: Path) -> str:
    """Push the candidate branch (and only that) and open a PR into the base. Returns the PR's address."""
    subprocess.run(["git", "push", "-u", "origin", run["branch"]], cwd=repo, check=True, capture_output=True)
    body = (
        f"Delivered by the factory from work order {run['work_order']['id']}.\n\n"
        f"Candidate {run['final_candidate'][:7]} on base {run['base'][:7]}; the GM approved it.\n"
        f"Evidence: factory/runs/{run['id']}/ (events.jsonl, receipts/, report.html)."
    )
    done = subprocess.run(
        [
            "gh",
            "api",
            f"repos/{_slug(repo)}/pulls",
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
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    return done.stdout.strip()


def deliver(run_dir: Path, repo: Path, dashboard: Path, opener: Callable[[dict, Path], str] | None = None) -> str:
    """Push and open the PR for an APPROVED run. Safe to repeat: a run with a PR is not delivered twice."""
    opener = opener or open_pr_for  # looked up now, not when the module loaded
    run = read_run(run_dir)
    if run["status"] != "approved":
        raise DecisionError(f"{run['id']} is {run['status']}: only an approved run can be delivered.")
    if run.get("pr_url"):
        return run["pr_url"]
    try:
        url = opener(run, repo)
    except (subprocess.CalledProcessError, OSError) as error:
        detail = getattr(error, "stderr", "") or str(error)
        append_event(
            run_dir,
            {
                "actor": "gm",
                "kind": "say",
                "text": f"Delivery failed, nothing was opened: {str(detail).strip()[:200]}. Approve again with --open-pr to retry.",
            },
        )
        report.export(run_dir, dashboard)
        raise DecisionError(f"delivery failed: {str(detail).strip()[:300]}") from error
    update_run(run_dir, pr_url=url)
    append_event(run_dir, {"actor": "gm", "kind": "say", "text": f"Pull request opened: {url}"})
    report.export(run_dir, dashboard)
    return url


def decide(
    run_dir: Path,
    repo: Path,
    dashboard: Path,
    decision: str,
    reason: str = "",
    open_pr: bool = False,
    opener: Callable[[dict, Path], str] | None = None,
    now: Callable[[], float] = time.time,
) -> dict:
    """Approve or reject a run that is waiting for the GM. Returns what happened."""
    if decision not in ("approve", "reject"):
        raise DecisionError(f"unknown decision: {decision!r}")
    run = read_run(run_dir)
    if run["status"] != "waiting":
        raise DecisionError(f"{run['id']} is {run['status']}: only a run waiting for the GM can be decided.")
    sha = run["final_candidate"][:7]
    if decision == "approve":
        text, status = f"The GM approved candidate {sha}.", "approved"
    else:
        text, status = f"The GM rejected candidate {sha}: {reason.strip() or 'no reason given'}.", "rejected"
    append_event(run_dir, {"actor": "gm", "kind": "decision", "text": text})
    run = update_run(run_dir, status=status, decided_at=now())
    report.export(run_dir, dashboard)
    result = {"status": status, "candidate": sha, "branch": run["branch"], "pr_url": None, "message": text}
    if decision == "approve" and open_pr:
        result["pr_url"] = deliver(run_dir, repo, dashboard, opener)
        result["message"] = f"{text} Pull request opened."
    return result
