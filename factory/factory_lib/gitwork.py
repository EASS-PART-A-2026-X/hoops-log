"""Git plumbing for a run: an isolated worktree per run and per gate, and one commit per candidate.

A worktree is a second checkout of the same repository in another folder. The builder works
in one of them on its own branch, so nothing it does can touch the folder you work in. A
worktree is NOT a sandbox: it separates edited files, not processes or credentials. That is
why the builder has no shell and no push rights (see agents.py and README).
"""

import os
import shutil
import subprocess
from pathlib import Path

IDENTITY = ("-c", "user.name=Factory builder", "-c", "user.email=factory@localhost")


def git(*args: str, cwd: Path, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=False)
    if check and done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip() or done.stdout.strip()}")
    return done.stdout.strip()


def rev_parse(ref: str, cwd: Path) -> str:
    return git("rev-parse", ref, cwd=cwd)


def add_worktree(repo: Path, path: Path, base: str, branch: str | None = None) -> None:
    """A checkout of `base` in `path`: on a new branch, or detached when `branch` is None."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if branch:
        git("worktree", "add", "-b", branch, str(path), base, cwd=repo)
    else:
        git("worktree", "add", "--detach", str(path), base, cwd=repo)


def remove_worktree(repo: Path, path: Path) -> None:
    if path.exists():
        git("worktree", "remove", "--force", str(path), cwd=repo, check=False)
        shutil.rmtree(path, ignore_errors=True)
    git("worktree", "prune", cwd=repo, check=False)


def link_dependencies(worktree: Path, source_repo: Path) -> None:
    """The frontend's node_modules is big: a symlink shares the installed copy, read only in use."""
    source = source_repo / "frontend" / "node_modules"
    target = worktree / "frontend" / "node_modules"
    if source.exists() and (worktree / "frontend").exists() and not target.exists():
        target.symlink_to(source)


def commit_all(worktree: Path, message: str) -> str | None:
    """Commit everything changed in the worktree. Returns the new SHA, or None if nothing changed."""
    git("add", "-A", cwd=worktree)
    if not git("status", "--porcelain", cwd=worktree):
        return None
    git(*IDENTITY, "commit", "-q", "-m", message, cwd=worktree)
    return rev_parse("HEAD", worktree)


def diff(repo: Path, base: str, head: str) -> str:
    return git("diff", "--no-color", f"{base}..{head}", cwd=repo)


def changed_files(repo: Path, base: str, head: str) -> list[str]:
    return [p for p in git("diff", "--name-only", f"{base}..{head}", cwd=repo).splitlines() if p]


def tool_path() -> str:
    """PATH for checks and agents: the user's own Node install is not always on PATH."""
    extra = Path.home() / ".local" / "node" / "bin"
    path = os.environ.get("PATH", "")
    return f"{extra}{os.pathsep}{path}" if extra.exists() else path
