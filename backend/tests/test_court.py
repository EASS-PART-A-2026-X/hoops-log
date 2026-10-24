from math import sqrt

import pytest

from app.court import (
    ARC_RADIUS,
    CORNER_DISTANCE,
    CORNER_LENGTH,
    HOOP_X,
    HOOP_Y,
    ShotType,
    Zone,
    is_three,
    shot_type_of,
    zone_of,
)

# One spot well inside each zone. The recap feature will map a zone name to a spot
# like these, so every spot must classify back to its own zone.
SPOTS = {
    Zone.LEFT_CORNER_3: (1.5, 4),
    Zone.RIGHT_CORNER_3: (48.5, 4),
    Zone.LEFT_WING_3: (7, 22),
    Zone.RIGHT_WING_3: (43, 22),
    Zone.TOP_3: (25, 30),
    Zone.LEFT_ELBOW: (15, 19),
    Zone.RIGHT_ELBOW: (35, 19),
    Zone.MID_RANGE: (25, 22),
    Zone.PAINT: (25, 12),
    Zone.RESTRICTED_AREA: (25, 6),
}

# Every point of the half court, every half foot.
GRID = [(xi / 2, yi / 2) for xi in range(101) for yi in range(95)]


def mirror(zone: Zone) -> Zone:
    return Zone(
        zone.value.replace("left", "@").replace("right", "left").replace("@", "right")
    )


def test_every_zone_has_a_spot():
    assert set(SPOTS) == set(Zone)


@pytest.mark.parametrize("zone", list(SPOTS), ids=lambda z: z.value)
def test_spot_classifies_into_its_zone(zone):
    assert zone_of(*SPOTS[zone]) == zone


@pytest.mark.parametrize(
    ("x", "y", "expected"),
    [
        (HOOP_X - CORNER_DISTANCE, 4, ShotType.TWO),  # on the left corner line
        (HOOP_X - CORNER_DISTANCE - 0.1, 4, ShotType.THREE),  # just beyond it
        (HOOP_X + CORNER_DISTANCE, 4, ShotType.TWO),  # on the right corner line
        (HOOP_X + CORNER_DISTANCE + 0.1, 4, ShotType.THREE),
        (HOOP_X, HOOP_Y + ARC_RADIUS, ShotType.TWO),  # on the arc, straight out
        (HOOP_X, HOOP_Y + ARC_RADIUS + 0.1, ShotType.THREE),
        (HOOP_X, HOOP_Y + ARC_RADIUS - 0.1, ShotType.TWO),
    ],
)
def test_three_point_line_edges(x, y, expected):
    assert shot_type_of(x, y) == expected


def test_corner_line_meets_the_arc_without_a_gap():
    # Walk up the left side. Just outside the line is always a 3, just inside a 2,
    # including across the height where the straight corner line turns into the arc.
    for y in [
        0,
        4,
        10,
        CORNER_LENGTH - 0.1,
        CORNER_LENGTH,
        CORNER_LENGTH + 0.1,
        15,
        20,
        28,
    ]:
        edge = HOOP_X - (
            CORNER_DISTANCE
            if y <= CORNER_LENGTH
            else sqrt(ARC_RADIUS**2 - (y - HOOP_Y) ** 2)
        )
        assert is_three(edge - 0.01, y), y
        assert not is_three(edge + 0.01, y), y


def test_corner_length_is_about_14_feet():
    assert 14.0 <= CORNER_LENGTH <= 14.3


def test_left_and_right_zones_mirror_each_other():
    bad = [
        (x, y)
        for x, y in GRID
        if x != HOOP_X and mirror(zone_of(x, y)) != zone_of(50 - x, y)
    ]
    assert bad == []


def test_three_pointer_exactly_when_the_zone_ends_in_3():
    for x, y in GRID:
        assert (shot_type_of(x, y) == ShotType.THREE) == zone_of(x, y).value.endswith(
            "_3"
        ), (x, y)


def test_restricted_area_and_paint_are_two_pointers():
    for x, y in GRID:
        if zone_of(x, y) in (Zone.RESTRICTED_AREA, Zone.PAINT):
            assert shot_type_of(x, y) == ShotType.TWO, (x, y)
