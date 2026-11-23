"""`factory watch` and the live page: serve ONE run's folder on this computer, and take the GM's decision.

The page follows `events.jsonl` while the run happens. When the run is waiting for the GM, the
page's Approve and Reject buttons POST to `/decide`, which calls decide.py: the same code as
`factory approve`. Because a web page can reach `localhost`, the server refuses anything that is
not the page it served: a secret token is put into the page it serves (never into the file on
disk) and must come back in a header, and the Host and Origin must be this server's own address.
"""

import contextlib
import functools
import hmac
import json
import secrets
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .decide import DecisionError, decide

TOKEN_SLOT = "window.FACTORY_TOKEN = null;"
MAX_BODY = 4096


class _Handler(SimpleHTTPRequestHandler):
    server_version = "factory"

    def __init__(self, *args, run_dir: Path, repo: Path, dashboard: Path, token: str, **kwargs):
        self.run_dir, self.repo, self.dashboard, self.token = run_dir, repo, dashboard, token
        super().__init__(*args, directory=str(run_dir), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")  # the log grows: never show a stale copy
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # keep the terminal for the run
        pass

    # ------------------------------------------------------------ the page: the token goes in here

    def do_GET(self) -> None:
        if self.path.split("?")[0] in ("/", "/index.html"):
            page = self.run_dir / "index.html"
            if page.exists():
                text = page.read_text(encoding="utf-8")
                if TOKEN_SLOT in text:
                    text = text.replace(TOKEN_SLOT, f'window.FACTORY_TOKEN = "{self.token}";', 1)
                self._send(200, text.encode("utf-8"), "text/html; charset=utf-8")
                return
        super().do_GET()

    # ------------------------------------------------------------ the decision

    def _send(self, code: int, body: bytes, kind: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, json.dumps(payload).encode("utf-8"))

    def _from_this_server(self) -> bool:
        port = self.server.server_address[1]
        own = {f"127.0.0.1:{port}", f"localhost:{port}"}
        origin = self.headers.get("Origin")
        return self.headers.get("Host") in own and (origin is None or origin in {f"http://{h}" for h in own})

    def do_POST(self) -> None:
        if self.path != "/decide":
            self._json(404, {"ok": False, "error": "not found"})
            return
        if not self._from_this_server():
            self._json(403, {"ok": False, "error": "this request did not come from the page this server gave you"})
            return
        sent = self.headers.get("X-Factory-Token", "")
        if not hmac.compare_digest(sent.encode(), self.token.encode()):
            self._json(403, {"ok": False, "error": "missing or wrong token: reload the page"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self._json(413, {"ok": False, "error": "request too large"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            decision = body["decision"]
            if decision not in ("approve", "reject"):
                raise KeyError(decision)
        except (ValueError, KeyError, TypeError):
            self._json(400, {"ok": False, "error": "send {decision: approve|reject, open_pr?, reason?}"})
            return
        try:
            result = decide(
                self.run_dir,
                self.repo,
                self.dashboard,
                decision,
                reason=str(body.get("reason") or "")[:300],
                open_pr=bool(body.get("open_pr")),
            )
        except DecisionError as error:
            code = 409 if "only a run waiting" in str(error) else 502
            self._json(code, {"ok": False, "error": str(error)})
            return
        self._json(200, {"ok": True, **result})


def make_server(run_dir: Path, port: int, repo: Path, dashboard: Path, token: str | None = None) -> ThreadingHTTPServer:
    """A server for one run, on this computer only. `port=0` picks a free one."""
    handler = functools.partial(
        _Handler, run_dir=run_dir, repo=repo, dashboard=dashboard, token=token or secrets.token_urlsafe(24)
    )
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def serve(run_dir: Path, port: int, repo: Path, dashboard: Path) -> None:
    server = make_server(run_dir, port, repo, dashboard)
    print(f"Watching {run_dir.name}: http://127.0.0.1:{port}/  (Ctrl+C to stop)")
    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()
