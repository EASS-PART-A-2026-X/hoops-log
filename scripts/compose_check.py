"""Prove the Docker Compose stack works, on throwaway ports and its own project name.

    python3 scripts/compose_check.py

Checks, in order:
  1. `docker compose up --build --wait`: all three services become healthy
  2. the frontend serves the app (and the single-page fallback)
  3. the backend can reach the AI service
  4. a shot survives `docker compose down` + `up` (the named volume)
  5. with the AI service stopped, plain shot CRUD still works and /chat says 503
  6. the AI service comes back and the backend notices

It also checks the backend does not `depends_on` the AI service: that would stop
shots from starting whenever the AI service is down.

It never touches the README's `backend` container or a running `fastapi dev`/`vite`.
Exit status 0 means every check passed.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = "hoops-log-compose-ci"
PORTS = {"BACKEND_PORT": "18100", "AI_PORT": "18101", "FRONTEND_PORT": "18173"}
BACKEND = f"http://127.0.0.1:{PORTS['BACKEND_PORT']}"
FRONTEND = f"http://127.0.0.1:{PORTS['FRONTEND_PORT']}"
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


def request(method: str, url: str, body: dict | None = None) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()


def chat_available() -> bool:
    return json.loads(request("GET", f"{BACKEND}/chat/status")[1])["available"]


def wait_for(condition, seconds: int = 40) -> bool:
    for _ in range(seconds):
        if condition():
            return True
        time.sleep(1)
    return False


def players() -> list[str]:
    page = json.loads(request("GET", f"{BACKEND}/shots?limit=100")[1])
    return [s["player"] for s in page]


def shot(player: str) -> dict:
    return {"player": player, "x": 25, "y": 10, "made": True}


def main() -> int:
    results: list[tuple[str, bool, str]] = []
    config = json.loads(compose("config", "--format", "json").stdout)
    needs = config["services"]["backend"].get("depends_on", {})
    results.append(
        ("backend does not depend on the AI service", "ai-service" not in needs, "")
    )
    compose("down", "-v", check=False)
    try:
        up = compose("up", "--build", "-d", "--wait", check=False)
        detail = up.stderr[-300:] if up.returncode else ""
        results.append(("up --wait: all three healthy", up.returncode == 0, detail))
        if up.returncode:
            return report(results)

        page = request("GET", FRONTEND + "/")
        deep = request("GET", FRONTEND + "/some/page")
        ok = page[0] == 200 and "<html" in page[1].lower() and deep[0] == 200
        results.append(("frontend serves the app and the SPA fallback", ok, ""))

        results.append(("backend reaches the AI service", wait_for(chat_available), ""))

        request("POST", f"{BACKEND}/shots", shot("persist"))
        compose("down")
        compose("up", "-d", "--wait")
        results.append(("shot survives down + up", "persist" in players(), ""))

        compose("stop", "ai-service")
        got = request("GET", f"{BACKEND}/shots")[0]
        made = request("POST", f"{BACKEND}/shots", shot("ai-down"))[0]
        message = {"messages": [{"role": "user", "text": "hi"}], "today": "2026-11-23"}
        chat = request("POST", f"{BACKEND}/chat", message)[0]
        ok = (got, made, chat) == (200, 201, 503)
        detail = f"GET {got}, POST {made}, chat {chat}"
        results.append(("AI service stopped: CRUD works, /chat is 503", ok, detail))

        compose("start", "ai-service")
        results.append(
            ("AI service back: backend notices", wait_for(chat_available), "")
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
