import pytest

from factory_lib import scope

from .conftest import git

PATTERNS = ["frontend/src/shooter.ts", "frontend/src/**/*.test.ts", "docs/*.md"]


@pytest.mark.parametrize(
    ("path", "ok"),
    [
        ("frontend/src/shooter.ts", True),
        ("./frontend/src/shooter.ts", True),
        ("frontend/src/deep/er/x.test.ts", True),
        ("frontend/src/x.test.ts", True),
        ("docs/a.md", True),
        ("docs/sub/a.md", False),  # * stays inside one folder
        ("frontend/src/shooter.tsx", False),
        ("backend/app/db.py", False),
        ("../outside.ts", False),
        ("frontend/../backend/x.py", False),
        ("frontend/src/shooter.ts/../../../x", False),
        ("/etc/passwd", False),
        ("", False),
    ],
)
def test_which_paths_are_allowed(path, ok):
    assert scope.allowed(path, PATTERNS) is ok


def test_enforce_reverts_everything_outside_the_files_and_keeps_the_rest(repo):
    (repo / "frontend/src/shooter.ts").write_text("export const state = 'fixed'\n")  # allowed
    (repo / "backend/other.py").write_text("x = 2\n")  # tracked, outside
    (repo / "check.py").unlink()  # a deletion, outside
    (repo / "backend/new.py").write_text("y = 1\n")  # untracked, outside
    (repo / "frontend/src/new.test.ts").write_text("// new\n")  # untracked, allowed
    reverted = scope.enforce(repo, ["frontend/src/shooter.ts", "frontend/src/*.test.ts"])
    assert reverted == ["backend/new.py", "backend/other.py", "check.py"]
    assert (repo / "backend/other.py").read_text() == "x = 1\n"
    assert (repo / "check.py").exists() and not (repo / "backend/new.py").exists()
    assert "fixed" in (repo / "frontend/src/shooter.ts").read_text()
    assert (repo / "frontend/src/new.test.ts").exists()
    tracked, new = scope.changed_paths(repo)
    assert tracked == ["frontend/src/shooter.ts"] and new == ["frontend/src/new.test.ts"]
    assert git(repo, "status", "--porcelain").count("\n") == 1  # only the two allowed changes remain


def test_enforce_on_a_clean_checkout_does_nothing(repo):
    assert scope.enforce(repo, ["frontend/src/shooter.ts"]) == []
