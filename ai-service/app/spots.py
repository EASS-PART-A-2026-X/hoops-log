"""Named places on the half court, as plain code.

The model is good at reading "I hit one from the right corner" and bad at geometry,
so it never invents coordinates for a named place: it calls the `court_spot` tool and
gets exact feet from this table. Feet, as in the backend: x 0-50 across (left is
smaller x), y 0-47 from the baseline, hoop at (25, 5.25).
"""

from typing import Literal, NamedTuple

Spot = Literal[
    "at_the_rim",
    "left_block",
    "right_block",
    "left_elbow",
    "right_elbow",
    "free_throw_line",
    "left_corner_three",
    "right_corner_three",
    "left_wing_three",
    "right_wing_three",
    "top_of_key_three",
]


class SpotPoint(NamedTuple):
    x: float
    y: float


SPOTS: dict[str, SpotPoint] = {
    "at_the_rim": SpotPoint(25.0, 7.0),
    "left_block": SpotPoint(17.0, 5.0),
    "right_block": SpotPoint(33.0, 5.0),
    "left_elbow": SpotPoint(17.0, 19.0),
    "right_elbow": SpotPoint(33.0, 19.0),
    "free_throw_line": SpotPoint(25.0, 19.0),
    "left_corner_three": SpotPoint(3.0, 3.0),
    "right_corner_three": SpotPoint(47.0, 3.0),
    "left_wing_three": SpotPoint(7.0, 22.0),
    "right_wing_three": SpotPoint(43.0, 22.0),
    "top_of_key_three": SpotPoint(25.0, 31.0),
}


def court_spot(spot: Spot) -> dict[str, float]:
    """Exact court coordinates in feet, as {"x": ..., "y": ...}, of a named place."""
    x, y = SPOTS[spot]
    return {"x": x, "y": y}
