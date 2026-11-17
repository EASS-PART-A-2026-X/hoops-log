#!/usr/bin/env python3
"""Add realistic demo shots through the API, or remove them again.

    python3 scripts/seed_demo.py                 # add 150 shots to http://localhost:8000
    python3 scripts/seed_demo.py --count 400
    python3 scripts/seed_demo.py --remove        # delete the demo shots
    python3 scripts/seed_demo.py --url http://localhost:8002

Only the standard library is used. The shots go through POST /shots, so the backend
checks and classifies them like any other. The demo players are exactly "Demo Yuly" and
"Demo Noam"; --remove and the refusal to add twice look for those two names only, so a
real player with a similar name is never touched.
"""

import argparse
import datetime
import json
import math
import random
import urllib.error
import urllib.request

HOOP_X, HOOP_Y = 25.0, 5.25
PLAYERS = [("Demo Yuly", 0.7), ("Demo Noam", 0.3)]
DEMO_NAMES = {name for name, _ in PLAYERS}


def polar(radius: float, angle: float) -> tuple[float, float]:
    return HOOP_X + radius * math.cos(angle), HOOP_Y + radius * math.sin(angle)


# (weight, chance of making it, a function that picks a spot). A believable spread:
# lots of layups, a hot left corner, a cold top of the key.
REGIONS = [
    (22, 0.66, lambda: polar(random.uniform(0.5, 3.6), random.uniform(0, math.pi))),
    (16, 0.55, lambda: (random.uniform(17.5, 32.5), random.uniform(6.5, 18.5))),
    (9, 0.52, lambda: (random.uniform(0.6, 2.8), random.uniform(0.5, 13.5))),
    (7, 0.33, lambda: (random.uniform(47.2, 49.4), random.uniform(0.5, 13.5))),
    (
        8,
        0.27,
        lambda: polar(
            random.uniform(24.2, 26),
            random.uniform(math.pi / 2 - 0.35, math.pi / 2 + 0.35),
        ),
    ),
    (
        7,
        0.44,
        lambda: polar(
            random.uniform(24.2, 26), random.uniform(math.pi * 0.62, math.pi * 0.85)
        ),
    ),
    (
        7,
        0.30,
        lambda: polar(
            random.uniform(24.2, 26), random.uniform(math.pi * 0.15, math.pi * 0.38)
        ),
    ),
    (
        8,
        0.41,
        lambda: (
            25 + random.choice([-1, 1]) * random.uniform(8.5, 13.5),
            random.uniform(13.5, 24),
        ),
    ),
    (
        16,
        0.36,
        lambda: polar(random.uniform(8, 17), random.uniform(0.3, math.pi - 0.3)),
    ),
]
NOTES = ["", "", "", "off the dribble", "catch and shoot", "fast break", "contested"]


def call(url: str, method: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    request = urllib.request.Request(url, data, headers, method=method)
    with urllib.request.urlopen(request, timeout=10) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def list_all(base: str) -> list[dict]:
    shots, offset = [], 0
    while True:
        page = call(f"{base}/shots?offset={offset}&limit=100", "GET")
        shots += page
        if len(page) < 100:
            return shots
        offset += 100


def add(base: str, count: int) -> None:
    existing = [s for s in list_all(base) if s["player"] in DEMO_NAMES]
    if existing:
        raise SystemExit(
            f"{len(existing)} demo shots are already in {base}. "
            "Run with --remove first, so the demo is not added twice."
        )
    random.seed(7)  # the same demo every time
    today = datetime.date.today()
    weights = [weight for weight, _, _ in REGIONS]
    added = 0
    try:
        for _ in range(count):
            _, chance, spot = random.choices(REGIONS, weights)[0]
            x, y = spot()
            names, shares = zip(*PLAYERS, strict=True)
            player = random.choices(names, shares)[0]
            call(
                f"{base}/shots",
                "POST",
                {
                    "player": player,
                    "x": min(50.0, max(0.0, round(x, 1))),
                    "y": min(47.0, max(0.0, round(y, 1))),
                    "made": random.random() < chance,
                    "game_date": (
                        today - datetime.timedelta(days=random.randint(0, 21))
                    ).isoformat(),
                    "note": random.choice(NOTES),
                },
            )
            added += 1
    except urllib.error.HTTPError as error:
        # The server answered, so it is up: it refused a request. Say how far we got.
        raise SystemExit(
            f"The backend at {base} answered HTTP {error.code} ({error.reason}) "
            f"after {added} of {count} shots were added. Run --remove to undo."
        ) from None
    print(f"Added {added} demo shots to {base}")


def remove(base: str) -> None:
    demo = [s for s in list_all(base) if s["player"] in DEMO_NAMES]
    for shot in demo:
        call(f"{base}/shots/{shot['id']}", "DELETE")
    print(f"Removed {len(demo)} demo shots from {base}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--url", default="http://localhost:8000", help="backend address"
    )
    parser.add_argument("--count", type=int, default=150, help="how many shots to add")
    parser.add_argument(
        "--remove", action="store_true", help="delete the demo shots instead"
    )
    args = parser.parse_args()
    base = args.url.rstrip("/")
    try:
        remove(base) if args.remove else add(base, args.count)
    except urllib.error.HTTPError as error:
        raise SystemExit(
            f"The backend at {base} answered HTTP {error.code} ({error.reason})."
        ) from None
    except urllib.error.URLError as error:
        raise SystemExit(
            f"Cannot reach the backend at {base}: {error.reason}. Is it running?"
        ) from None


if __name__ == "__main__":
    main()
