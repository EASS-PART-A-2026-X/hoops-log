"""Measure how good the tests are: break the code on purpose, many times, and count
how often a test notices.

For every mutation (flip a `<` to `<=`, `and` to `or`, `+` to `-`, change a number,
...) the script copies backend/ to a temp folder, applies ONE mutation, and runs
pytest there. A mutant that makes a test fail is "killed". A mutant that passes is a
"survivor": the tests do not care about that line.

    uv run python ../scripts/mutation_score.py                 # run from backend/
    uv run python ../scripts/mutation_score.py --min 90        # exit 1 below 90%
    uv run python ../scripts/mutation_score.py app/court.py    # one file

Your real files are never touched; the work happens in copies.
"""

import argparse
import ast
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path.cwd()
DEFAULT_TARGETS = ["app/court.py", "app/models.py", "app/chart.py", "app/routers"]
SWAPS: dict[type, type] = {
    ast.Lt: ast.LtE,
    ast.LtE: ast.Lt,
    ast.Gt: ast.GtE,
    ast.GtE: ast.Gt,
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
    ast.Add: ast.Sub,
    ast.Sub: ast.Add,
    ast.Mult: ast.Div,
    ast.And: ast.Or,
    ast.Or: ast.And,
}


@dataclass
class Mutant:
    file: str
    line: int
    what: str
    index: int  # which candidate node, in ast.walk order


def candidates(tree: ast.AST):
    """Yield (node, description) for every node a mutation can change."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            for op in node.ops:
                if type(op) in SWAPS:
                    yield node, f"{type(op).__name__} -> {SWAPS[type(op)].__name__}"
        elif isinstance(node, ast.BinOp | ast.BoolOp) and type(node.op) in SWAPS:
            yield node, f"{type(node.op).__name__} -> {SWAPS[type(node.op)].__name__}"
        elif isinstance(node, ast.Constant):
            if isinstance(node.value, bool):
                yield node, f"{node.value} -> {not node.value}"
            elif isinstance(node.value, int | float):
                yield node, f"{node.value!r} -> {node.value + 1!r}"
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            yield node, "remove `not`"


def apply(tree: ast.AST, index: int) -> None:
    node, _ = list(candidates(tree))[index]
    if isinstance(node, ast.Compare):
        node.ops = [SWAPS.get(type(op), type(op))() for op in node.ops]
    elif isinstance(node, ast.BinOp | ast.BoolOp):
        node.op = SWAPS[type(node.op)]()
    elif isinstance(node, ast.Constant):
        node.value = (
            (not node.value) if isinstance(node.value, bool) else node.value + 1
        )
    elif isinstance(node, ast.UnaryOp):
        node.op = ast.UAdd()  # `not x` -> `+x`: same truth value as x


def find_mutants(files: list[Path]) -> list[Mutant]:
    """A line marked `# equivalent-mutant: <why>` (on it or the line above) is
    skipped: changing it cannot change behaviour, so no test could ever notice."""
    mutants = []
    for path in files:
        rel = str(path.relative_to(BACKEND))
        text = path.read_text()
        lines = text.splitlines()
        for i, (node, what) in enumerate(candidates(ast.parse(text))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                continue
            if any(
                "equivalent-mutant" in lines[n]
                for n in (node.lineno - 1, node.lineno - 2)
            ):
                continue
            mutants.append(Mutant(rel, node.lineno, what, i))
    return mutants


def run_one(mutant: Mutant, template: Path) -> bool:
    """True if a test failed (mutant killed)."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "backend"
        shutil.copytree(template, work)
        target = work / mutant.file
        tree = ast.parse((BACKEND / mutant.file).read_text())
        apply(tree, mutant.index)
        target.write_text(ast.unparse(ast.fix_missing_locations(tree)))
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-x", "-q", "-p", "no:cacheprovider"],
            cwd=work,
            capture_output=True,
            timeout=120,
            check=False,
        )
        return result.returncode != 0


def expand(targets: list[str]) -> list[Path]:
    files: list[Path] = []
    for target in targets:
        path = BACKEND / target
        files += sorted(path.rglob("*.py")) if path.is_dir() else [path]
    return [f for f in files if f.name != "__init__.py"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("targets", nargs="*", default=DEFAULT_TARGETS)
    parser.add_argument("--min", type=float, default=0, help="fail below this percent")
    parser.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args()

    if not (BACKEND / "pyproject.toml").exists():
        sys.exit("Run this from the backend/ folder.")
    mutants = find_mutants(expand(args.targets))
    with tempfile.TemporaryDirectory() as tmp:
        template = Path(tmp) / "template"
        shutil.copytree(
            BACKEND,
            template,
            ignore=shutil.ignore_patterns(
                ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "data", "*.db"
            ),
        )
        print(f"{len(mutants)} mutants, {args.jobs} at a time...", flush=True)
        with ThreadPoolExecutor(args.jobs) as pool:
            killed = list(pool.map(lambda m: run_one(m, template), mutants))

    survivors = [m for m, k in zip(mutants, killed, strict=True) if not k]
    score = 100 * (len(mutants) - len(survivors)) / max(len(mutants), 1)
    print(
        f"\nmutation score: {score:.1f}% ({len(mutants) - len(survivors)}"
        f" of {len(mutants)} killed)"
    )
    for m in survivors:
        print(f"  SURVIVED {m.file}:{m.line}  {m.what}")
    return 1 if score < args.min else 0


if __name__ == "__main__":
    sys.exit(main())
