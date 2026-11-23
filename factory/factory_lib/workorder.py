"""The work order: the course's nine fields, read from a markdown file.

    Outcome, Files, Non-goals, Verify with, Review focus, Acceptance, Stop, Budget, Delivery

A field starts a line as `Name:` and may continue on the lines below it, indented. `Files`
holds path patterns (`*` inside a folder, `**` across folders), one per line or comma
separated. `Verify with` holds one check per line as `label | folder | command`.
"""

import posixpath
import re
from dataclasses import dataclass, field
from pathlib import Path

FIELDS = (
    "Outcome",
    "Files",
    "Non-goals",
    "Verify with",
    "Review focus",
    "Acceptance",
    "Stop",
    "Budget",
    "Delivery",
)
FIELD_LINE = re.compile(r"^(" + "|".join(re.escape(name) for name in FIELDS) + r"):\s*(.*)$")


class WorkOrderError(ValueError):
    pass


@dataclass(frozen=True)
class Check:
    label: str
    cwd: str  # a folder inside the repo, "." for the root
    command: str


@dataclass(frozen=True)
class WorkOrder:
    id: str
    title: str
    path: str
    fields: dict[str, str]
    files: tuple[str, ...]
    checks: tuple[Check, ...]
    max_repairs: int
    minutes: int
    extra: dict = field(default_factory=dict)

    @property
    def budget_seconds(self) -> int:
        return self.minutes * 60


def _split_files(text: str) -> tuple[str, ...]:
    parts = re.split(r"[,\n]", text)
    return tuple(part.strip() for part in parts if part.strip())


def _parse_checks(text: str) -> tuple[Check, ...]:
    checks = []
    for line in text.splitlines():
        line = line.strip().lstrip("-").strip()
        if not line:
            continue
        pieces = [piece.strip() for piece in line.split("|")]
        if len(pieces) != 3 or not all(pieces):
            raise WorkOrderError(f"a check must be `label | folder | command`, got: {line!r}")
        folder = posixpath.normpath(pieces[1])
        if folder.startswith(("/", "..")):
            raise WorkOrderError(f"a check's folder must be inside the repo, got: {pieces[1]!r}")
        checks.append(Check(pieces[0], folder, pieces[2]))
    return tuple(checks)


def _parse_budget(text: str) -> tuple[int, int]:
    repairs = re.search(r"(\d+)\s+repair", text)
    minutes = re.search(r"(\d+)\s+minute", text)
    if not repairs or not minutes:
        raise WorkOrderError(f"Budget needs `N repair attempts, M minutes`, got: {text!r}")
    return int(repairs.group(1)), int(minutes.group(1))


def parse(path: Path) -> WorkOrder:
    lines = path.read_text(encoding="utf-8").splitlines()
    heading = next((line for line in lines if line.startswith("# ")), "")
    found = re.match(r"#\s+(WO-\d+)\s+(.*)", heading)
    if not found:
        raise WorkOrderError("the first heading must be `# WO-001 Title`")
    fields: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        match = FIELD_LINE.match(line)
        if match:
            current = match.group(1)
            fields[current] = [match.group(2)]
        elif current and (line.startswith((" ", "\t")) or not line.strip()):
            fields[current].append(line.strip())
        elif current and not line.startswith("#"):
            current = None
    missing = [name for name in FIELDS if name not in fields]
    if missing:
        raise WorkOrderError("missing fields: " + ", ".join(missing))
    text = {name: "\n".join(part for part in value if part).strip() for name, value in fields.items()}
    repairs, minutes = _parse_budget(text["Budget"])
    return WorkOrder(
        id=found.group(1),
        title=found.group(2).strip(),
        path=str(path),
        fields=text,
        files=_split_files(text["Files"]),
        checks=_parse_checks(text["Verify with"]),
        max_repairs=repairs,
        minutes=minutes,
    )
