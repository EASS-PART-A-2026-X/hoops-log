"""NBA half-court geometry: which zone a point is in, and whether it is a 3-pointer.

Coordinates are feet. x runs 0-50 across the court, y runs 0-47 from the baseline
out to half court, and the hoop is at (25, 5.25).

"left" means smaller x (x < 25) and "right" means larger x (x > 25), as seen with the
baseline at the bottom of the court drawing and half court at the top.
"""

from enum import StrEnum
from math import hypot, sqrt

HOOP_X = 25.0
HOOP_Y = 5.25
ARC_RADIUS = 23.75  # 3PT distance from the hoop, above the corners
CORNER_DISTANCE = 22.0  # 3PT distance from the hoop, in the corners
# The straight corner line runs up from the baseline until it meets the arc
# (about 14 ft).
CORNER_LENGTH = HOOP_Y + sqrt(ARC_RADIUS**2 - CORNER_DISTANCE**2)
RESTRICTED_RADIUS = 4.0
LANE_HALF_WIDTH = 8.0  # the lane is 16 ft wide
FREE_THROW_LINE_Y = 19.0
TOP_HALF_WIDTH = 8.0  # a 3PT within this of the hoop's centre line is "top"
ELBOW_MAX_OFFSET = 14.0  # elbow area runs this far from the centre line
ELBOW_MIN_Y = 13.0
ELBOW_MAX_Y = 25.0


class ShotType(StrEnum):
    TWO = "2PT"
    THREE = "3PT"


class Zone(StrEnum):
    LEFT_CORNER_3 = "left_corner_3"
    LEFT_WING_3 = "left_wing_3"
    TOP_3 = "top_3"
    RIGHT_WING_3 = "right_wing_3"
    RIGHT_CORNER_3 = "right_corner_3"
    LEFT_ELBOW = "left_elbow"
    RIGHT_ELBOW = "right_elbow"
    MID_RANGE = "mid_range"
    PAINT = "paint"
    RESTRICTED_AREA = "restricted_area"


def is_three(x: float, y: float) -> bool:
    """Strictly beyond the line: standing on the line is a 2-pointer."""
    if y <= CORNER_LENGTH:  # equivalent-mutant: at y == CORNER_LENGTH both rules agree
        return abs(x - HOOP_X) > CORNER_DISTANCE
    return hypot(x - HOOP_X, y - HOOP_Y) > ARC_RADIUS


def shot_type_of(x: float, y: float) -> ShotType:
    return ShotType.THREE if is_three(x, y) else ShotType.TWO


def zone_of(x: float, y: float) -> Zone:
    dx = x - HOOP_X
    left = dx < 0  # equivalent-mutant: dx == 0 is never a corner, wing or elbow
    if is_three(x, y):
        if y <= CORNER_LENGTH:
            return Zone.LEFT_CORNER_3 if left else Zone.RIGHT_CORNER_3
        if abs(dx) <= TOP_HALF_WIDTH:
            return Zone.TOP_3
        return Zone.LEFT_WING_3 if left else Zone.RIGHT_WING_3
    if hypot(dx, y - HOOP_Y) <= RESTRICTED_RADIUS:
        return Zone.RESTRICTED_AREA
    if abs(dx) < LANE_HALF_WIDTH and y <= FREE_THROW_LINE_Y:
        return Zone.PAINT
    if (
        LANE_HALF_WIDTH <= abs(dx) <= ELBOW_MAX_OFFSET
        and ELBOW_MIN_Y <= y <= ELBOW_MAX_Y
    ):
        return Zone.LEFT_ELBOW if left else Zone.RIGHT_ELBOW
    return Zone.MID_RANGE
