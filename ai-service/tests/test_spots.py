"""Every named spot is checked against the BACKEND's own court rules.

The two services are separate programs, so the AI service cannot import the backend. But
the backend's court.py uses only the standard library, so this test loads that one file
by its path. If the backend changes a zone boundary, this fails here instead of letting
the AI service propose a "corner three" that the backend would store as a mid-range 2PT.
"""

import importlib.util
from pathlib import Path

import pytest

from app.spots import SPOTS, court_spot

BACKEND_COURT = Path(__file__).resolve().parents[2] / "backend" / "app" / "court.py"

# (zone, shot type) each name must get from the backend.
EXPECTED = {
    "at_the_rim": ("restricted_area", "2PT"),
    "left_block": ("paint", "2PT"),
    "right_block": ("paint", "2PT"),
    "left_elbow": ("left_elbow", "2PT"),
    "right_elbow": ("right_elbow", "2PT"),
    "free_throw_line": ("paint", "2PT"),
    "left_corner_three": ("left_corner_3", "3PT"),
    "right_corner_three": ("right_corner_3", "3PT"),
    "left_wing_three": ("left_wing_3", "3PT"),
    "right_wing_three": ("right_wing_3", "3PT"),
    "top_of_key_three": ("top_3", "3PT"),
}


@pytest.fixture(scope="module")
def backend_court():
    assert BACKEND_COURT.is_file(), f"the backend's court.py moved: {BACKEND_COURT}"
    spec = importlib.util.spec_from_file_location("backend_court", BACKEND_COURT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_expectations_cover_every_spot():
    assert set(EXPECTED) == set(SPOTS)


@pytest.mark.parametrize("name", sorted(SPOTS))
def test_each_spot_is_classified_as_its_name_says(backend_court, name):
    x, y = SPOTS[name]
    zone, shot_type = EXPECTED[name]
    assert backend_court.zone_of(x, y).value == zone, name
    assert backend_court.shot_type_of(x, y).value == shot_type, name


def test_every_spot_is_on_the_half_court():
    for name, (x, y) in SPOTS.items():
        assert 0 <= x <= 50, name
        assert 0 <= y <= 47, name


def test_left_is_smaller_x_and_right_is_larger_x():
    for side in ("corner_three", "wing_three"):
        assert SPOTS[f"left_{side}"].x < 25 < SPOTS[f"right_{side}"].x
    assert SPOTS["left_elbow"].x < 25 < SPOTS["right_elbow"].x
    assert SPOTS["left_block"].x < 25 < SPOTS["right_block"].x


def test_court_spot_returns_labelled_feet():
    assert court_spot("right_corner_three") == {"x": 47.5, "y": 3.0}
