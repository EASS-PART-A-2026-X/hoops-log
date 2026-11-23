"""Shared helpers: a tiny git repo and work order for the tests. No test uses a real model."""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

HERE = Path(__file__).resolve().parent.parent
DASHBOARD = HERE / "dashboard" / "dashboard.html"

CHECK_PY = "import sys\ntext = open('frontend/src/shooter.ts').read()\nsys.exit(0 if 'fixed' in text else 1)\n"

WORK_ORDER = """# WO-001 Make the shooter fixed

Outcome:      The shooter file says fixed.
Files:        frontend/src/shooter.ts
              frontend/src/shooter.test.ts
Non-goals:    No other file.
Verify with:  - the shooter is fixed | . | python3 check.py
Review focus: Whether anything else still says broken.
Acceptance:   check.py passes.
Stop:         Two failed repair attempts.
Budget:       {repairs} repair attempts, {minutes} minutes
Delivery:     A local commit on its own branch only.
"""


def git(cwd: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    return done.stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "frontend" / "src").mkdir(parents=True)
    (root / "backend").mkdir()
    (root / "frontend/src/shooter.ts").write_text("export const state = 'broken'\n")
    (root / "frontend/src/shooter.test.ts").write_text("// tests\n")
    (root / "backend/other.py").write_text("x = 1\n")
    (root / "check.py").write_text(CHECK_PY)
    git(root, "init", "-q", "-b", "ex3")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "base")
    return root


@pytest.fixture
def write_order(tmp_path: Path):
    def make(repairs: int = 2, minutes: int = 30) -> Path:
        path = tmp_path / "WO-001.md"
        path.write_text(WORK_ORDER.format(repairs=repairs, minutes=minutes))
        return path

    return make
