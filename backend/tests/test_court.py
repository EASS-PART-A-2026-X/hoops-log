from math import hypot

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


# One point exactly on, and one just across, each threshold of the 2PT and wing zones.
# Edges: the restricted circle includes its edge, the lane does not, the elbows include theirs.
BOUNDARIES = {
    "restricted circle: on the edge": ((25, 9.25), Zone.RESTRICTED_AREA),
    "restricted circle: just outside": ((25, 9.35), Zone.PAINT),
    "lane edge: just inside (left)": ((17.1, 10), Zone.PAINT),
    "lane edge: on it, below the elbow (left)": ((17, 10), Zone.MID_RANGE),
    "lane edge: just inside (right)": ((32.9, 10), Zone.PAINT),
    "lane edge: on it, below the elbow (right)": ((33, 10), Zone.MID_RANGE),
    "free-throw line: on it": ((25, 19), Zone.PAINT),
    "free-throw line: just past it": ((25, 19.1), Zone.MID_RANGE),
    "elbow: on the lane edge (left)": ((17, 15), Zone.LEFT_ELBOW),
    "elbow: just inside the lane (left)": ((17.1, 15), Zone.PAINT),
    "elbow: on the lane edge (right)": ((33, 15), Zone.RIGHT_ELBOW),
    "elbow: just inside the lane (right)": ((32.9, 15), Zone.PAINT),
    "elbow bottom: on y=13": ((17, 13), Zone.LEFT_ELBOW),
    "elbow bottom: just below": ((17, 12.9), Zone.MID_RANGE),
    "elbow top: on y=25": ((17, 25), Zone.LEFT_ELBOW),
    "elbow top: just above": ((17, 25.1), Zone.MID_RANGE),
    "elbow outer edge: 14 ft out (left)": ((11, 19), Zone.LEFT_ELBOW),
    "elbow outer edge: just beyond (left)": ((10.9, 19), Zone.MID_RANGE),
    "elbow outer edge: 14 ft out (right)": ((39, 19), Zone.RIGHT_ELBOW),
    "elbow outer edge: just beyond (right)": ((39.1, 19), Zone.MID_RANGE),
    "out wide, below the elbow": ((10, 8), Zone.MID_RANGE),
    "top of the arc: 8 ft from centre (left)": ((17, 30), Zone.TOP_3),
    "top of the arc: just wider (left)": ((16.9, 30), Zone.LEFT_WING_3),
    "top of the arc: 8 ft from centre (right)": ((33, 30), Zone.TOP_3),
    "top of the arc: just wider (right)": ((33.1, 30), Zone.RIGHT_WING_3),
    "corner three: just below where the line meets the arc (left)": (
        (1.5, 14.19),
        Zone.LEFT_CORNER_3,
    ),
    "wing three: just above where the line meets the arc (left)": (
        (1.5, 14.21),
        Zone.LEFT_WING_3,
    ),
    "corner three: just below where the line meets the arc (right)": (
        (48.5, 14.19),
        Zone.RIGHT_CORNER_3,
    ),
    "wing three: just above where the line meets the arc (right)": (
        (48.5, 14.21),
        Zone.RIGHT_WING_3,
    ),
}


@pytest.mark.parametrize(("point", "zone"), BOUNDARIES.values(), ids=BOUNDARIES.keys())
def test_zone_boundaries(point, zone):
    assert zone_of(*point) == zone


def three_by_definition(x: float, y: float) -> bool:
    """The rule as written, independent of how app.court implements it."""
    return (
        abs(x - HOOP_X) > CORNER_DISTANCE or hypot(x - HOOP_X, y - HOOP_Y) > ARC_RADIUS
    )


def test_corner_line_meets_the_arc_without_a_gap():
    # Scan the strip where the straight corner line turns into the arc (about 14 ft up),
    # one hundredth of a foot at a time, on both sides of the line.
    bad = [
        (x, y)
        for xi in range(250, 351)
        for yi in range(1200, 1600, 2)
        if is_three(x := xi / 100, y := yi / 100) != three_by_definition(x, y)
    ]
    assert bad == []


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
