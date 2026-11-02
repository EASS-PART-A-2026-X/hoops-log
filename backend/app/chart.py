"""Draw the shot chart as an SVG string. Plain code: no frontend, no model.

One foot is SCALE pixels. SVG's y axis points down, so court y is flipped and the
baseline is drawn at the bottom, as in the geometry notes in app/court.py.
"""

import re
from collections.abc import Iterable
from math import sqrt
from xml.sax.saxutils import escape

from app.court import (
    ARC_RADIUS,
    CORNER_DISTANCE,
    CORNER_LENGTH,
    FREE_THROW_LINE_Y,
    HOOP_X,
    HOOP_Y,
    LANE_HALF_WIDTH,
    RESTRICTED_RADIUS,
    zone_of,
)
from app.models import Shot

SCALE = 10
COURT_WIDTH = 50
COURT_DEPTH = 47
MARK_RADIUS = 0.8  # feet
MADE_COLOR = "#1a7f37"
MISSED_COLOR = "#cf222e"
LINE_COLOR = "#444"
PADDING = 12  # px around the court so marks on the very edge are not clipped
# Characters XML 1.0 forbids. New shots cannot contain them (see models.py), but a
# row stored earlier could, and one bad row must not break the chart for everyone.
_ILLEGAL_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


def _px(value: float) -> str:
    return f"{value * SCALE:.1f}"


def _sx(x: float) -> str:
    return _px(x)


def _sy(y: float) -> str:
    return _px(COURT_DEPTH - y)


def _court_lines() -> list[str]:
    left_corner = HOOP_X - CORNER_DISTANCE
    right_corner = HOOP_X + CORNER_DISTANCE
    lane_left, lane_right = HOOP_X - LANE_HALF_WIDTH, HOOP_X + LANE_HALF_WIDTH
    arc_radius = _px(ARC_RADIUS)
    restricted = _px(RESTRICTED_RADIUS)
    return [
        (
            f'<rect x="0" y="0" width="{_px(COURT_WIDTH)}" height="{_px(COURT_DEPTH)}"'
            f' fill="#f6f1e7" stroke="{LINE_COLOR}" stroke-width="3"/>'
        ),
        # lane and free-throw circle
        (
            f'<rect x="{_sx(lane_left)}" y="{_sy(FREE_THROW_LINE_Y)}"'
            f' width="{_px(lane_right - lane_left)}" height="{_px(FREE_THROW_LINE_Y)}"'
            f' fill="none" stroke="{LINE_COLOR}" stroke-width="2"/>'
        ),
        (
            f'<circle cx="{_sx(HOOP_X)}" cy="{_sy(FREE_THROW_LINE_Y)}" r="{_px(6)}"'
            f' fill="none" stroke="{LINE_COLOR}" stroke-width="2"/>'
        ),
        # restricted area: the half circle in front of the hoop
        (
            f'<path d="M {_sx(HOOP_X - RESTRICTED_RADIUS)} {_sy(HOOP_Y)}'
            f" A {restricted} {restricted} 0 0 1 {_sx(HOOP_X + RESTRICTED_RADIUS)}"
            f' {_sy(HOOP_Y)}" fill="none" stroke="{LINE_COLOR}" stroke-width="2"/>'
        ),
        # three-point line: two straight corner lines joined by the arc
        (
            f'<path d="M {_sx(left_corner)} {_sy(0)} L {_sx(left_corner)}'
            f" {_sy(CORNER_LENGTH)} A {arc_radius} {arc_radius} 0 0 1"
            f" {_sx(right_corner)} {_sy(CORNER_LENGTH)} L {_sx(right_corner)}"
            f' {_sy(0)}" fill="none" stroke="{LINE_COLOR}" stroke-width="2"/>'
        ),
        # hoop
        (
            f'<circle cx="{_sx(HOOP_X)}" cy="{_sy(HOOP_Y)}" r="{_px(0.75)}"'
            f' fill="none" stroke="#d9480f" stroke-width="3"/>'
        ),
    ]


def _mark(shot: Shot) -> str:
    zone = zone_of(shot.x, shot.y)
    verdict = "made" if shot.made else "missed"
    player = _ILLEGAL_XML.sub("\ufffd", shot.player)
    title = f"<title>{escape(player)}: {verdict} from {zone}</title>"
    cx, cy = _sx(shot.x), _sy(shot.y)
    if shot.made:
        return (
            f'<circle cx="{cx}" cy="{cy}" r="{_px(MARK_RADIUS)}"'
            f' fill="{MADE_COLOR}" fill-opacity="0.8" stroke="#fff">{title}</circle>'
        )
    # A cross, not just a different colour, so the chart works without colour.
    d = MARK_RADIUS / sqrt(2) * 1.4
    x1, x2 = _sx(shot.x - d), _sx(shot.x + d)
    y1, y2 = _sy(shot.y - d), _sy(shot.y + d)
    return (
        f'<g stroke="{MISSED_COLOR}" stroke-width="3" stroke-linecap="round">'
        f'{title}<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>'
        f'<line x1="{x1}" y1="{y2}" x2="{x2}" y2="{y1}"/></g>'
    )


def render_chart(shots: Iterable[Shot]) -> str:
    marks = [_mark(shot) for shot in shots]
    width = COURT_WIDTH * SCALE + 2 * PADDING
    height = COURT_DEPTH * SCALE + 2 * PADDING
    return (
        '<svg xmlns="http://www.w3.org/2000/svg"'
        f' viewBox="{-PADDING} {-PADDING} {width} {height}" width="{width}"'
        f' height="{height}"'
        ' role="img" aria-label="Shot chart: green circles are made, red crosses'
        ' are missed">' + "".join(_court_lines()) + "".join(marks) + "</svg>"
    )
