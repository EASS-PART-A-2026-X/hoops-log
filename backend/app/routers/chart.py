from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlmodel import select

from app.chart import render_chart
from app.db import SessionDep
from app.models import Shot

router = APIRouter(tags=["chart"])


@router.get(
    "/chart.svg",
    response_class=Response,
    responses={200: {"content": {"image/svg+xml": {}}}},
    summary="Draw the shot chart as an SVG image",
)
def chart(
    session: SessionDep,
    player: Annotated[str | None, Query(min_length=1, max_length=50)] = None,
) -> Response:
    # Trade-off, on purpose: this loads every shot and filters in Python, not in SQL.
    # SQLite's lower() only handles ASCII, so `WHERE lower(player) = ...` would miss
    # names like "Élodie". The chart reads every shot when unfiltered anyway, so this
    # costs nothing extra at this app's size. Do not "optimise" it back to SQL
    # without keeping the non-ASCII test.
    shots = session.exec(select(Shot).order_by(Shot.id)).all()
    if player is not None:
        # "yuly" and "Yuly" are the same player. casefold is Unicode case folding,
        # so it is a little broader than upper/lower case: "Straße" matches "STRASSE".
        wanted = player.strip().casefold()
        shots = [shot for shot in shots if shot.player.casefold() == wanted]
    svg = render_chart(shots)
    return Response(content=svg, media_type="image/svg+xml")
