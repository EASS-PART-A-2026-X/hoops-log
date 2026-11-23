"""Run one command with a hard time limit and a stop order that is REALLY enforced.

A STOP written in a file or a prompt is only a request. Here the controller owns the process
group: when time runs out, or the STOP file appears, the whole group is killed, so a stuck
agent or a runaway test cannot outlive it. Output is kept (bounded), so the evidence of a
stopped run is not lost.
"""

import contextlib
import os
import signal
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

MAX_OUTPUT = 400_000  # characters kept per command


@dataclass
class Outcome:
    returncode: int | None
    output: str
    seconds: float
    timed_out: bool = False
    stopped: bool = False

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.timed_out and not self.stopped


def _kill_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    for _ in range(20):
        if process.poll() is not None:
            return
        time.sleep(0.1)
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)


def run_bounded(
    argv: list[str] | str,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: float = 600,
    stop_file: Path | None = None,
    on_line: Callable[[str], None] | None = None,
    shell: bool = False,
) -> Outcome:
    started = time.monotonic()
    process = subprocess.Popen(
        argv,
        cwd=cwd,
        env=env,
        shell=shell,
        executable="/bin/bash" if shell else None,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        start_new_session=True,  # its own process group, so the whole tree can be killed
    )
    chunks: list[str] = []
    size = 0

    def read() -> None:
        nonlocal size
        assert process.stdout is not None
        for line in process.stdout:
            if size < MAX_OUTPUT:
                chunks.append(line)
                size += len(line)
            if on_line:
                with contextlib.suppress(Exception):  # a broken listener must not stop the command
                    on_line(line)

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    timed_out = stopped = False
    while process.poll() is None:
        if time.monotonic() - started > timeout:
            timed_out = True
            _kill_group(process)
            break
        if stop_file is not None and stop_file.exists():
            stopped = True
            _kill_group(process)
            break
        time.sleep(0.2)
    process.wait()
    reader.join(timeout=5)
    return Outcome(process.returncode, "".join(chunks), time.monotonic() - started, timed_out, stopped)
