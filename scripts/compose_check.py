"""Prove the Docker Compose stack works, on throwaway ports and its own project name.

    python3 scripts/compose_check.py

Checks, in order:
  1. `docker compose up --build --wait`: all three services become healthy
  2. the frontend serves the app (and the single-page fallback)
  3. the backend can reach the AI service
  4. a shot survives `docker compose down` + `up` (the named volume)
  5. with the AI service stopped, plain shot CRUD still works and /chat says 503
  6. the AI service comes back and the backend notices
  7. the AI service running with a broken model setting: /chat is a plain 503, shots
     still work, and fixing the setting brings Deni back
  8. the built frontend points at this backend, and the backend allows the app's
     origin (CORS)

It also checks the backend does not `depends_on` the AI service: that would stop
shots from starting whenever the AI service is down.

It never touches the README's `backend` container or a running `fastapi dev`/`vite`.
Exit status 0 means every check passed.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = "hoops-log-compose-ci"
PORTS = {"BACKEND_PORT": "18100", "FRONTEND_PORT": "18173"}
BACKEND = f"http://127.0.0.1:{PORTS['BACKEND_PORT']}"
FRONTEND = f"http://127.0.0.1:{PORTS['FRONTEND_PORT']}"
APP_ORIGIN = "http://localhost:5173"  # the only origin the backend's CORS list allows
ENV = {**os.environ, **PORTS, "AI_MODEL": "test", "COMPOSE_PROJECT_NAME": PROJECT}
# Lets a Windows docker.exe called from WSL see the variables too (ignored elsewhere).
ENV["WSLENV"] = ":".join([*PORTS, "AI_MODEL", "COMPOSE_PROJECT_NAME"])


def compose(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "compose", *args],
        cwd=ROOT,
        env=ENV,
        capture_output=True,
        text=True,
        check=check,
    )


def request(
    method: str, url: str, body: dict | None = None, origin: str | None = None
) -> tuple[int, str, dict[str, str]]:
    """Return (status, body, headers); status 0 means the server was not reachable."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode(), dict(resp.headers)
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode(), dict(err.headers)
    except OSError as err:  # refused, reset, timed out: report it, never crash
        return 0, str(err), {}


def chat_available() -> bool:
    status, text, _ = request("GET", f"{BACKEND}/chat/status")
    try:
        return status == 200 and json.loads(text).get("available") is True
    except ValueError, AttributeError:
        return False


def wait_for(condition, seconds: int = 40) -> bool:
    for _ in range(seconds):
        if condition():
            return True
        time.sleep(1)
    return False


def players() -> list[str]:
    """Every player name, reading all pages (the API returns at most 100 a page)."""
    names: list[str] = []
    while True:
        status, text, _ = request(
            "GET", f"{BACKEND}/shots?limit=100&offset={len(names)}"
        )
        page = json.loads(text) if status == 200 else []
        if not page:
            return names
        names += [s["player"] for s in page]


def shot(player: str) -> dict:
    return {"player": player, "x": 25, "y": 10, "made": True}


def diagnose(failed: subprocess.CompletedProcess[str]) -> str:
    """Why `compose up` failed: its error, each service's state, the last log lines."""
    ps = compose("ps", "-a", check=False).stdout
    logs = compose("logs", "--tail", "30", "--no-color", check=False).stdout
    return f"\n{failed.stderr[-600:]}\n--- ps\n{ps}\n--- logs\n{logs}"


def frontend_points_at_backend() -> tuple[bool, str]:
    """The built site must contain the backend's address the browser will call."""
    status, html, _ = request("GET", FRONTEND + "/")
    scripts = re.findall(r'(?:src|href)="(/assets/[^"]+\.js)"', html)
    wanted = f"localhost:{PORTS['BACKEND_PORT']}"
    for path in scripts:
        if wanted in request("GET", FRONTEND + path)[1]:
            return True, ""
    return (
        False,
        f"{wanted} not found in {len(scripts)} script(s), index status {status}",
    )


def main() -> int:
    results: list[tuple[str, bool, str]] = []
    config = json.loads(compose("config", "--format", "json").stdout)
    needs = config["services"]["backend"].get("depends_on", {})
    results.append(
        ("backend does not depend on the AI service", "ai-service" not in needs, "")
    )
    published = "ports" in config["services"]["ai-service"]
    results.append(("AI service is not published on the host", not published, ""))
    compose("down", "-v", check=False)
    try:
        up = compose("up", "--build", "-d", "--wait", check=False)
        detail = diagnose(up) if up.returncode else ""
        results.append(("up --wait: all three healthy", up.returncode == 0, detail))
        if up.returncode:
            return report(results)

        page = request("GET", FRONTEND + "/")
        deep = request("GET", FRONTEND + "/some/page")
        ok = page[0] == 200 and "<html" in page[1].lower() and deep[0] == 200
        results.append(("frontend serves the app and the SPA fallback", ok, ""))

        ok, detail = frontend_points_at_backend()
        results.append(("built frontend points at this backend", ok, detail))

        allowed = request("GET", f"{BACKEND}/shots", origin=APP_ORIGIN)[2]
        got_origin = allowed.get("access-control-allow-origin", "")
        results.append(
            (
                "backend allows the app's origin (CORS)",
                got_origin == APP_ORIGIN,
                got_origin,
            )
        )

        results.append(("backend reaches the AI service", wait_for(chat_available), ""))

        created = request("POST", f"{BACKEND}/shots", shot("persist"))[0]
        down = compose("down", check=False)
        up = compose("up", "-d", "--wait", check=False)
        if created != 201 or down.returncode or up.returncode:
            detail = f"POST {created}, down {down.returncode}, up {up.returncode}"
            results.append(("shot survives down + up", False, detail))
        else:
            results.append(("shot survives down + up", "persist" in players(), ""))

        compose("stop", "ai-service")
        got = request("GET", f"{BACKEND}/shots")[0]
        made = request("POST", f"{BACKEND}/shots", shot("ai-down"))[0]
        message = {
            "messages": [{"role": "user", "text": "hi"}],
            "today": date.today().isoformat(),
        }
        chat = request("POST", f"{BACKEND}/chat", message)[0]
        ok = (got, made, chat) == (200, 201, 503)
        detail = f"GET {got}, POST {made}, chat {chat}"
        results.append(("AI service stopped: CRUD works, /chat is 503", ok, detail))

        compose("start", "ai-service")
        results.append(
            ("AI service back: backend notices", wait_for(chat_available), "")
        )

        # A running service with a broken model setting is a different failure from a
        # stopped one: it answers /health, then cannot do the job.
        ENV["AI_MODEL"] = "nosuchprovider:model"
        recreated = compose("up", "-d", "--wait", "ai-service", check=False)
        chat = request("POST", f"{BACKEND}/chat", message)
        got = request("GET", f"{BACKEND}/shots")[0]
        ok = recreated.returncode == 0 and (chat[0], got) == (503, 200)
        detail = f"chat {chat[0]}, GET /shots {got}"
        results.append(("broken model setting: /chat is 503, shots work", ok, detail))
        leaked = "nosuchprovider" in chat[1]
        results.append(
            ("the broken setting is not leaked to the player", not leaked, "")
        )

        ENV["AI_MODEL"] = "test"
        fixed = compose("up", "-d", "--wait", "ai-service", check=False)
        again = wait_for(lambda: request("POST", f"{BACKEND}/chat", message)[0] == 200)
        results.append(
            (
                "model setting fixed: Deni answers again",
                fixed.returncode == 0 and again,
                "",
            )
        )
    finally:
        compose("down", "-v", check=False)
    return report(results)


def report(results: list[tuple[str, bool, str]]) -> int:
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}".rstrip())
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
