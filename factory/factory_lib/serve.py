"""`factory watch`: serve one run's folder on localhost so the dashboard can follow events.jsonl."""

import contextlib
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class _Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")  # the log grows: never show a stale copy
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # keep the terminal for the run
        pass


def serve(run_dir: Path, port: int) -> None:
    handler = functools.partial(_Handler, directory=str(run_dir))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)  # this machine only
    print(f"Watching {run_dir.name}: http://127.0.0.1:{port}/  (Ctrl+C to stop)")
    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()
