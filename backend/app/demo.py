"""The built-in demo: a believable set of shots, made up on the spot and never stored.

It lets a new account (which has no shots) see what the app looks like with a full
court. The shots belong to nobody: they are not in the database, cannot be changed
and are never mixed with an account's own shots.
"""

import math
import random
from collections.abc import Callable
from datetime import date, timedelta

from app.models import ShotPublic

DEMO_PLAYER = "Demo Player"
DEMO_COUNT = 150
HOOP_X, HOOP_Y = 25.0, 5.25

Spot = Callable[[random.Random], tuple[float, float]]


def polar(radius: float, angle: float) -> tuple[float, float]:
    return HOOP_X + radius * math.cos(angle), HOOP_Y + radius * math.sin(angle)


# (weight, chance of making it, a function that picks a spot). A believable spread:
# lots of layups, a hot left corner, a cold top of the key.
REGIONS: list[tuple[int, float, Spot]] = [
    (22, 0.66, lambda r: polar(r.uniform(0.5, 3.6), r.uniform(0, math.pi))),
    (16, 0.55, lambda r: (r.uniform(17.5, 32.5), r.uniform(6.5, 18.5))),
    (9, 0.52, lambda r: (r.uniform(0.6, 2.8), r.uniform(0.5, 13.5))),
    (7, 0.33, lambda r: (r.uniform(47.2, 49.4), r.uniform(0.5, 13.5))),
    (
        8,
        0.27,
        lambda r: polar(
            r.uniform(24.2, 26), r.uniform(math.pi / 2 - 0.35, math.pi / 2 + 0.35)
        ),
    ),
    (
        7,
        0.44,
        lambda r: polar(r.uniform(24.2, 26), r.uniform(math.pi * 0.62, math.pi * 0.85)),
    ),
    (
        7,
        0.30,
        lambda r: polar(r.uniform(24.2, 26), r.uniform(math.pi * 0.15, math.pi * 0.38)),
    ),
    (
        8,
        0.41,
        lambda r: (25 + r.choice([-1, 1]) * r.uniform(8.5, 13.5), r.uniform(13.5, 24)),
    ),
    (16, 0.36, lambda r: polar(r.uniform(8, 17), r.uniform(0.3, math.pi - 0.3))),
]
NOTES = ["", "", "", "off the dribble", "catch and shoot", "fast break", "contested"]


def demo_shots(today: date | None = None) -> list[ShotPublic]:
    """The same demo every time (only the dates move with `today`).

    Ids are negative so they can never be mistaken for a real shot's id: no route
    accepts them.
    """
    today = today or date.today()
    rng = random.Random(7)
    weights = [weight for weight, _, _ in REGIONS]
    shots: list[ShotPublic] = []
    for number in range(1, DEMO_COUNT + 1):
        _, chance, spot = rng.choices(REGIONS, weights)[0]
        x, y = spot(rng)
        shots.append(
            ShotPublic(
                id=-number,
                player=DEMO_PLAYER,
                x=min(50.0, max(0.0, round(x, 1))),
                y=min(47.0, max(0.0, round(y, 1))),
                made=rng.random() < chance,
                game_date=today - timedelta(days=rng.randint(0, 21)),
                note=rng.choice(NOTES),
            )
        )
    return shots
