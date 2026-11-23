"""Builds factory/dashboard/dashboard.html: the template with the app's Barlow fonts embedded.

    python3 factory/dashboard/build.py

The result is one self-contained file that works offline. The controller copies it into each
run (index.html for the live page, report.html with the run embedded), so the fonts need to
be inside it. Needs the frontend's node_modules (npm ci in frontend/).
"""

import base64
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent.parent / "frontend" / "node_modules" / "@fontsource"
FACES = [
    ("Barlow Condensed", 600, "barlow-condensed"),
    ("Barlow Condensed", 700, "barlow-condensed"),
    ("Barlow Condensed", 800, "barlow-condensed"),
    ("Barlow", 400, "barlow"),
    ("Barlow", 500, "barlow"),
    ("Barlow", 600, "barlow"),
]


def font_css() -> str:
    rules = []
    for family, weight, folder in FACES:
        data = (FONTS / folder / "files" / f"{folder}-latin-{weight}-normal.woff2").read_bytes()
        encoded = base64.b64encode(data).decode()
        rules.append(
            f"@font-face{{font-family:'{family}';font-weight:{weight};font-style:normal;font-display:swap;"
            f"src:url(data:font/woff2;base64,{encoded}) format('woff2')}}"
        )
    return "\n".join(rules) + "\n"


if __name__ == "__main__":
    html = (HERE / "dashboard.template.html").read_text(encoding="utf-8").replace("/*FONTS*/", font_css())
    (HERE / "dashboard.html").write_text(html, encoding="utf-8")
    print(f"dashboard.html written ({len(html) // 1024} KB)")
