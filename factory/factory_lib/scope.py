"""Which files an agent may change. This is enforced twice, because advice is not a fence.

1. hooks/scope_guard.py runs before every Edit or Write the builder tries and refuses the
   ones outside the work order's `Files`.
2. `enforce` runs after the builder is done and reverts anything else that changed (a deleted
   file, a new file, a staged file, a rename), whatever the tool that did it.

Git-ignored paths are not looked at by the second layer: git never commits them, so they cannot
become part of a candidate. (The first layer still refuses the builder's edits to them.)
"""

import posixpath
import re
import subprocess
from pathlib import Path


def _regex(pattern: str) -> re.Pattern[str]:
    out = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(out)


def allowed(path: str, patterns: tuple[str, ...] | list[str]) -> bool:
    """Is `path` (relative to the repo, with / separators) one of the allowed paths?"""
    clean = posixpath.normpath(path.replace("\\", "/"))
    if clean.startswith("/") or clean == ".." or clean.startswith("../"):
        return False
    return any(_regex(p).fullmatch(clean) for p in patterns)


def _git(worktree: Path, *args: str, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=worktree, capture_output=True, text=True, check=check)
    return done.stdout


def _nul_list(text: str) -> list[str]:
    return [p for p in text.split("\0") if p]


def changed_paths(worktree: Path) -> tuple[list[str], list[str]]:
    """(tracked files that differ from HEAD, new files git does not know yet)."""
    # -z: git otherwise quotes and octal-escapes names with accents or spaces, and they would never match
    tracked = _nul_list(_git(worktree, "diff", "--name-only", "-z", "HEAD"))
    new = _nul_list(_git(worktree, "ls-files", "--others", "--exclude-standard", "-z"))
    return tracked, new


def enforce(worktree: Path, patterns: tuple[str, ...] | list[str]) -> list[str]:
    """Undo every change outside `patterns`. Returns the paths that were reverted."""
    tracked, new = changed_paths(worktree)
    reverted = []
    for path in tracked:
        if allowed(path, patterns):
            continue
        in_head = (
            subprocess.run(["git", "cat-file", "-e", f"HEAD:{path}"], cwd=worktree, capture_output=True).returncode == 0
        )
        if in_head:
            _git(worktree, "checkout", "HEAD", "--", path)
        else:  # staged as new: unstage it and remove it
            _git(worktree, "rm", "-f", "-q", "--cached", "--", path, check=False)
            (worktree / path).unlink(missing_ok=True)
        reverted.append(path)
    for path in new:
        if not allowed(path, patterns):
            (worktree / path).unlink(missing_ok=True)
            reverted.append(path)
    return sorted(reverted)
