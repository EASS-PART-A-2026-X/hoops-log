#!/usr/bin/env python3
"""A Claude Code PreToolUse hook: refuse edits outside the work order's files.

Claude Code runs this before every Edit, Write or MultiEdit the builder attempts, passing the
tool call as JSON on stdin. Exit 0 lets the edit happen. Exit 2 blocks it, and the message on
stderr goes back to the model. A blocked edit is also written to the run's event log as a
foul, so the dashboard shows it live.

The factory sets, in the environment of the builder process:
    FACTORY_RUN_DIR   the run folder (events.jsonl lives there)
    FACTORY_WORKTREE  the builder's checkout
    FACTORY_FILES     JSON list of allowed path patterns

If this script cannot decide (bad input, missing settings) it BLOCKS: a fence that fails
open is not a fence.
"""

import contextlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from factory_lib import scope
    from factory_lib.events import append_event
except BaseException as error:  # noqa: BLE001  Claude Code lets an edit through on any exit code but 2
    print(f"Blocked by the referee: the scope guard could not start ({error}).", file=sys.stderr)
    sys.exit(2)


def decide(payload: dict, worktree: Path, patterns: list[str]) -> tuple[bool, str]:
    raw = (payload.get("tool_input") or {}).get("file_path") or ""
    if not raw:
        return False, "no file path in the tool call"
    try:
        relative = str(Path(raw).resolve().relative_to(worktree.resolve()))
    except ValueError:
        return False, raw
    return scope.allowed(relative, patterns), relative


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        run_dir = Path(os.environ["FACTORY_RUN_DIR"])
        worktree = Path(os.environ["FACTORY_WORKTREE"])
        patterns = json.loads(os.environ["FACTORY_FILES"])
        ok, shown = decide(payload, worktree, patterns)
    except Exception as error:  # cannot decide: block
        print(f"Blocked by the referee: the scope guard could not decide ({error}).", file=sys.stderr)
        return 2
    if ok:
        return 0
    with contextlib.suppress(Exception):  # the block still happens even if the log cannot be written
        append_event(
            run_dir,
            {
                "actor": "referee",
                "kind": "foul",
                "text": f"Edit blocked: {shown} is not one of the files this work order allows.",
                "box": {"referee": {"turns": 1}, "builder": {"fouls": 1}},
            },
        )
    print(
        f"Blocked by the referee: {shown} is not one of the files this work order allows. "
        f"Allowed: {', '.join(patterns)}.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
