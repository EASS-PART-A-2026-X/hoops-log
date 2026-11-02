"""Prove the Docker image keeps its data, using throwaway names and port 18000.

    python3 scripts/docker_check.py

Checks, in order:
  1. build the image
  2. a shot survives `docker rm -f` + a new `docker run` on the same volume
  3. without the volume the shot is gone (so check 2 really tests the volume)
  4. chaos: post shots in a loop, SIGKILL the container at a random moment, restart
     on the same volume: every shot the API acknowledged (201) must still be there

It uses its own container, volume and port, so it never touches `backend` or
`backend-data` from the README. Exit status 0 means every check passed.
"""

import json
import random
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMAGE, NAME, VOLUME, PORT = "hoops-log-ci", "hoops-log-ci", "hoops-log-ci-data", 18000
URL = f"http://127.0.0.1:{PORT}"


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *args], capture_output=True, text=True, check=check
    )


def start(volume: bool) -> None:
    docker("rm", "-f", NAME, check=False)
    mount = ["-v", f"{VOLUME}:/app/data"] if volume else []
    docker("run", "-d", "--name", NAME, "-p", f"127.0.0.1:{PORT}:8000", *mount, IMAGE)
    for _ in range(60):
        try:
            if request("GET", "/health")[0] == 200:
                return
        except OSError:
            time.sleep(0.5)
    raise SystemExit("container did not become healthy")


def request(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        URL + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read() or "null")
    except urllib.error.HTTPError as err:
        return err.code, None


def players() -> list[str]:
    """Every player name, reading all pages (the API returns at most 100 a page)."""
    names: list[str] = []
    while True:
        page = request("GET", f"/shots?limit=100&offset={len(names)}")[1]
        if not page:
            return names
        names += [s["player"] for s in page]  # type: ignore[union-attr]


def shot(player: str) -> dict:
    return {"player": player, "x": 25, "y": 10, "made": True}


def cleanup() -> None:
    docker("rm", "-f", NAME, check=False)
    docker("volume", "rm", "-f", VOLUME, check=False)


MIN_WRITES = 10  # a kill test that killed nothing in flight proves nothing


def chaos() -> tuple[int, list[str], str]:
    """Return (acknowledged count, acknowledged players missing after the kill, problem).

    `problem` is empty when the test ran properly: at least MIN_WRITES writes were
    acknowledged before the kill, and none failed for any reason other than the kill.
    """
    acknowledged: list[str] = []
    failures: list[str] = []
    killed = threading.Event()

    def writer() -> None:
        n = 0
        while not killed.is_set():
            name = f"chaos{n}"
            try:
                status = request("POST", "/shots", shot(name))[0]
            except OSError as err:
                if not killed.is_set():
                    failures.append(f"connection error before the kill: {err}")
                return  # after the kill the container is gone: stop writing
            if status == 201:
                acknowledged.append(name)
            else:
                failures.append(f"POST returned {status}")
                return
            n += 1

    thread = threading.Thread(target=writer)
    thread.start()
    deadline = time.monotonic() + 30
    while (
        len(acknowledged) < MIN_WRITES and not failures and time.monotonic() < deadline
    ):
        time.sleep(0.05)
    time.sleep(random.uniform(0.0, 0.5))  # kill at a random moment, mid-stream
    count_at_kill = len(acknowledged)
    killed.set()  # before the kill: connection errors from now on are expected
    docker("kill", NAME)  # SIGKILL: no graceful shutdown
    thread.join()
    problem = ""
    if failures:
        problem = failures[0]
    elif count_at_kill < MIN_WRITES:
        problem = f"only {count_at_kill} writes acknowledged before the kill"
    start(volume=True)
    present = set(players())
    return len(acknowledged), [p for p in acknowledged if p not in present], problem


def main() -> int:
    results: list[tuple[str, bool, str]] = []
    cleanup()
    try:
        docker("build", "-t", IMAGE, str(ROOT / "backend"))
        results.append(("build image", True, ""))

        start(volume=True)
        request("POST", "/shots", shot("persist"))
        start(volume=True)  # rm -f + run again, same volume
        ok = "persist" in players()
        results.append(("shot survives rm + run on the same volume", ok, ""))

        start(volume=False)
        request("POST", "/shots", shot("ephemeral"))
        start(volume=False)
        ok = "ephemeral" not in players()
        results.append(("without the volume the shot is gone", ok, ""))

        start(volume=True)
        count, lost, problem = chaos()
        detail = f"{count} acknowledged writes, {len(lost)} lost"
        if problem:
            detail += f" (test invalid: {problem})"
        ok = not lost and not problem
        results.append(("SIGKILL mid-write loses no acknowledged shot", ok, detail))
    finally:
        cleanup()

    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}".rstrip())
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
