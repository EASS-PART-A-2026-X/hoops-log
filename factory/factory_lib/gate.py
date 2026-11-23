"""The gate: the checks that decide whether a candidate is any good. Run by the controller, never by an agent.

Every check runs in a clean checkout of the exact candidate commit, not in the builder's
folder, so a stale file or an unsaved edit cannot make a check pass. One check is special:
`fails-first` takes the tests the candidate added or changed, puts them on the ORIGINAL code,
and requires at least one to FAIL there. A test that also passes without the change does not
test the change.
"""

import fnmatch
import os
import posixpath
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import gitwork
from .runner import run_bounded
from .workorder import Check

TEST_FILE = ("*.test.ts", "*.test.tsx", "test_*.py")
FAILS_FIRST = "fails-first:"


@dataclass
class CheckResult:
    label: str
    ok: bool
    output: str
    seconds: float
    note: str = ""


SECRET_NAME = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^SSH_AUTH_SOCK$|^GIT_ASKPASS$|^ANTHROPIC|^GROQ", re.I)


def _env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """The checks run code the builder wrote (its tests), so credentials in the environment are left out.

    This is not a sandbox: such a test can still read files in your home folder.
    """
    env = {name: value for name, value in os.environ.items() if not SECRET_NAME.search(name)}
    env["PATH"] = gitwork.tool_path()
    env["CI"] = "1"
    env.update(extra or {})
    return env


def _is_test(path: str) -> bool:
    return any(fnmatch.fnmatch(Path(path).name, pattern) for pattern in TEST_FILE)


def fails_first(
    repo: Path,
    base: str,
    candidate: str,
    check: Check,
    workdir: Path,
    timeout: float,
    stop_file: Path | None = None,
) -> CheckResult:
    """The candidate's tests, run on the original code: at least one must fail there."""
    folder = posixpath.normpath(check.cwd)
    folder = "" if folder == "." else folder  # "." is the repo root; ".github" is a real folder
    changed = [
        p
        for p in gitwork.changed_files(repo, base, candidate, still_there=True)
        if _is_test(p) and (not folder or p.startswith(folder + "/"))
    ]
    if not changed:
        return CheckResult(check.label, False, "", 0.0, "The candidate added or changed no test file here.")
    scratch = workdir / "base-check"
    gitwork.remove_worktree(repo, scratch)
    gitwork.add_worktree(repo, scratch, base)
    try:
        gitwork.link_dependencies(scratch, repo)
        for path in changed:
            target = scratch / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(gitwork.file_at(repo, candidate, path))
        relative = " ".join(p[len(folder) + 1 :] if folder else p for p in changed)
        command = check.command[len(FAILS_FIRST) :].strip().replace("{files}", relative)
        outcome = run_bounded(command, scratch / folder, _env(), timeout, stop_file, shell=True)
    finally:
        gitwork.remove_worktree(repo, scratch)
    if outcome.stopped or outcome.timed_out:
        return CheckResult(check.label, False, outcome.output, outcome.seconds, "Stopped before the tests finished.")
    code = outcome.returncode
    if code is None or code < 0 or code in (126, 127):  # killed by a signal, or the command could not run
        return CheckResult(
            check.label,
            False,
            outcome.output,
            outcome.seconds,
            f"The tests could not run on the original code (exit {code}).",
        )
    failed_there = code != 0
    note = (
        "Tests failed on the original code, as they should: " + ", ".join(changed)
        if failed_there
        else "These tests also pass without the change, so they do not test it: " + ", ".join(changed)
    )
    return CheckResult(check.label, failed_there, outcome.output, outcome.seconds, note)


def run_checks(
    repo: Path,
    base: str,
    candidate: str,
    checks: tuple[Check, ...],
    root: Path,
    workdir: Path,
    timeout: float,
    on_result: Callable[[CheckResult], None],
    stop_file: Path | None = None,
    deadline: Callable[[], float] | None = None,
) -> list[CheckResult]:
    """Run each check on `root` (a clean checkout of `candidate`), reporting each as it finishes."""
    results: list[CheckResult] = []
    for check in checks:
        if stop_file is not None and stop_file.exists():
            break
        budget = min(timeout, deadline()) if deadline else timeout
        if budget <= 0:
            break
        if check.command.startswith(FAILS_FIRST):
            result = fails_first(repo, base, candidate, check, workdir, budget, stop_file)
        else:
            outcome = run_bounded(check.command, root / check.cwd, _env(), budget, stop_file, shell=True)
            result = CheckResult(
                check.label,
                outcome.ok,
                outcome.output,
                outcome.seconds,
                "Timed out." if outcome.timed_out else "",
            )
        results.append(result)
        on_result(result)
    return results


def summarize(results: list[CheckResult], keep_lines: int = 60) -> str:
    """The text saved as the gate receipt: every check, and the output of the ones that failed."""
    lines = []
    for result in results:
        lines.append(f"{'PASS' if result.ok else 'FAIL'}  {result.label}  ({result.seconds:.1f} s)")
        if result.note:
            lines.append(f"      {result.note}")
    for result in results:
        if not result.ok:
            tail = result.output.splitlines()[-keep_lines:]
            lines += ["", f"--- output of: {result.label} (last {keep_lines} lines)", *tail]
    passed = sum(1 for r in results if r.ok)
    lines += ["", f"{passed} of {len(results)} checks passed"]
    return "\n".join(lines) + "\n"
