"""The dashboard files of a run: the live page, and the finished report with everything inside.

`index.html` is the dashboard that follows events.jsonl while the run happens (served by
`factory watch`). `report.html` is the same page with the whole run embedded, so it opens
from a plain file, offline, and stays readable after the run folder is archived.
"""

import json
from pathlib import Path

from .events import read_events, read_run

MARK = "/*RUN_DATA*/"
MAX_RECEIPT = 30_000


def _page(dashboard: Path, data: dict | None) -> str:
    html = dashboard.read_text(encoding="utf-8")
    if MARK not in html:
        raise ValueError("the dashboard has no /*RUN_DATA*/ marker")
    payload = "null" if data is None else json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return html.replace(MARK, f"window.RUN_DATA = {payload};")


def write_live_page(run_dir: Path, dashboard: Path) -> Path:
    path = run_dir / "index.html"
    path.write_text(_page(dashboard, None), encoding="utf-8")
    return path


def export(run_dir: Path, dashboard: Path) -> Path:
    receipts = {}
    folder = run_dir / "receipts"
    if folder.exists():
        for file in sorted(folder.iterdir()):
            if file.is_file():
                receipts[file.name] = file.read_text(encoding="utf-8", errors="replace")[:MAX_RECEIPT]
    data = {"run": read_run(run_dir), "events": read_events(run_dir), "receipts": receipts}
    path = run_dir / "report.html"
    path.write_text(_page(dashboard, data), encoding="utf-8")
    return path
