"""The GM's decision: approve or reject a run that is waiting, and (only if asked) deliver it.

This is the ONE place a decision is made. The command line (`factory approve`) and the live page's
buttons both call it, so they cannot disagree. Nothing here runs unless a person asked: the
controller never calls it.

    approve          records the decision. Nothing is pushed.
    approve + PR     then pushes ONLY the candidate branch and opens a pull request into the base.
    reject           records the decision and the reason.

A run is decided once, even when two requests arrive together (a double click, two tabs, the page
and the command): the check and the write happen under a lock, a thread lock for this process and
a file lock for another process.
"""

import contextlib
import fcntl
import subprocess
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path

from . import report
from .events import append_event, read_run, update_run

PUSH_SECONDS = 120
_THREADS = threading.Lock()


class DecisionError(Exception):
    """The decision cannot be made. The subclasses say why, so callers never match on the wording."""


class BadRequest(DecisionError):
    """The request itself is wrong (an unknown decision)."""


class WrongState(DecisionError):
    """The run is not in the state this needs (already decided, not finished...)."""


class DeliveryFailed(DecisionError):
    """The decision stands, but the push or the pull request did not happen."""


@contextlib.contextmanager
def _locked(run_dir: Path) -> Iterator[None]:
    with _THREADS, open(run_dir / ".decision.lock", "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _slug(repo: Path) -> str:
    remote = subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=repo, capture_output=True, text=True, check=True, timeout=30
    ).stdout.strip()
    if "github.com" not in remote:
        raise DeliveryFailed(f"the origin remote is not on github.com ({remote}): open the pull request by hand.")
    return remote.removesuffix(".git").split("github.com")[-1].lstrip(":/")


def open_pr_for(run: dict, repo: Path) -> str:
    """Push the candidate branch (and only that) and open a PR into the base. Returns the PR's address."""
    subprocess.run(
        ["git", "push", "-u", "origin", run["branch"]],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
        timeout=PUSH_SECONDS,
    )
    body = (
        f"Delivered by the factory from work order {run['work_order']['id']}.\n\n"
        f"Candidate {run['final_candidate'][:7]} on base {run['base'][:7]}; the GM approved it.\n\n"
        f"The run's evidence (events.jsonl, receipts/, report.html) is in factory/runs/{run['id']}/ of the "
        "checkout that ran it. It is not on this branch, which holds only the candidate's change."
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
        timeout=PUSH_SECONDS,
    )
    return done.stdout.strip()


def deliver(run_dir: Path, repo: Path, dashboard: Path, opener: Callable[[dict, Path], str] | None = None) -> str:
    """Push and open the PR for an APPROVED run. Safe to repeat: a run with a PR is not delivered twice."""
    opener = opener or open_pr_for  # looked up now, not when the module loaded
    with _locked(run_dir):
        run = read_run(run_dir)
        if run["status"] != "approved":
            raise WrongState(f"{run['id']} is {run['status']}: only an approved run can be delivered.")
        if run.get("pr_url"):
            return run["pr_url"]
        try:
            url = opener(run, repo)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, DeliveryFailed) as error:
            detail = (getattr(error, "stderr", "") or "") or str(error)
            if isinstance(detail, bytes):
                detail = detail.decode(errors="replace")
            detail = str(detail).strip()[:300]
            append_event(
                run_dir,
                {
                    "actor": "gm",
                    "kind": "say",
                    "text": f"Delivery failed, nothing was opened: {detail[:200]}. Approve again with --open-pr to retry.",
                },
            )
            report.export(run_dir, dashboard)
            raise DeliveryFailed(f"delivery failed: {detail}") from error
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
        raise BadRequest(f"unknown decision: {decision!r}")
    with _locked(run_dir):  # check and write together: two requests cannot both find the run waiting
        run = read_run(run_dir)
        if run["status"] != "waiting":
            raise WrongState(f"{run['id']} is {run['status']}: only a run waiting for the GM can be decided.")
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
