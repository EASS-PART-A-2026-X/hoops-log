from math import hypot

import pytest

from app.spots import SPOTS, court_spot

HOOP = (25.0, 5.25)


def test_every_spot_is_on_the_half_court():
    for name, (x, y) in SPOTS.items():
        assert 0 <= x <= 50, name
        assert 0 <= y <= 47, name


@pytest.mark.parametrize("name", [n for n in SPOTS if n.endswith("_three")])
def test_three_point_spots_are_outside_the_arc(name):
    x, y = SPOTS[name]
    # Corner threes are 22 ft from the hoop's centre line, everywhere else 23.75 ft.
    if "corner" in name:
        assert abs(x - HOOP[0]) >= 22.0, name
    else:
        assert hypot(x - HOOP[0], y - HOOP[1]) >= 23.75, name


@pytest.mark.parametrize("name", [n for n in SPOTS if not n.endswith("_three")])
def test_two_point_spots_are_inside_the_arc(name):
    x, y = SPOTS[name]
    assert hypot(x - HOOP[0], y - HOOP[1]) < 22.0, name


def test_left_is_smaller_x_and_right_is_larger_x():
    for side in ("corner_three", "wing_three"):
        assert SPOTS[f"left_{side}"].x < 25 < SPOTS[f"right_{side}"].x
    assert SPOTS["left_elbow"].x < 25 < SPOTS["right_elbow"].x


def test_court_spot_returns_labelled_feet():
    assert court_spot("right_corner_three") == {"x": 47.0, "y": 3.0}
