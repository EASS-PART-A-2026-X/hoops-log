"""A run's two state files: events.jsonl (the append-only log) and run.json (the summary).

`events.jsonl` has one JSON object per line and is only ever appended to. It is the single
record of who said or did what, and the live dashboard follows it. An event is:

    t        seconds since the run started
    actor    announcer | builder | reviewer | gate | referee | commentator | gm
    kind     say | evidence | foul | commentary | shot | decision
    text     one plain sentence
    ...      optional: stage, huddle, pass, cand, newAttempt, shot, gate, review,
             receipt, files, box   (the dashboard reads these; see dashboard/)

The hook that blocks out-of-scope edits runs in another process and appends to the same
file, so every write is one whole line, flushed, under a lock.
"""

import json
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path

_LOCK = threading.Lock()


def read_run(run_dir: Path) -> dict:
    return json.loads((run_dir / "run.json").read_text(encoding="utf-8"))


def write_run(run_dir: Path, data: dict) -> None:
    """Replace run.json in one step, so a reader never sees half a file."""
    tmp = run_dir / "run.json.tmp"
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, run_dir / "run.json")


def update_run(run_dir: Path, **changes) -> dict:
    data = read_run(run_dir)
    data.update(changes)
    write_run(run_dir, data)
    return data


def append_event(
    run_dir: Path,
    event: dict,
    started_at: float | None = None,
    now: Callable[[], float] = time.time,
) -> dict:
    """Append one event and return it (with its `t`)."""
    if started_at is None:
        started_at = read_run(run_dir)["started_at"]
    stored = {"t": round(now() - started_at, 1), **event}
    line = json.dumps(stored, ensure_ascii=False)
    with _LOCK, open(run_dir / "events.jsonl", "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return stored


def read_events(run_dir: Path) -> list[dict]:
    path = run_dir / "events.jsonl"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


class EventLog:
    """What the controller writes through: one place that knows the run and the clock."""

    def __init__(self, run_dir: Path, started_at: float, now: Callable[[], float] = time.time):
        self.run_dir = run_dir
        self.started_at = started_at
        self.now = now

    def emit(self, actor: str, kind: str, text: str, **extra) -> dict:
        event = {"actor": actor, "kind": kind, "text": text, **extra}
        return append_event(self.run_dir, event, self.started_at, self.now)

    def elapsed(self) -> float:
        return self.now() - self.started_at
