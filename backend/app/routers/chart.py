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
    query = select(Shot).order_by(Shot.id)
    if player is not None:
        query = query.where(Shot.player == player)
    svg = render_chart(session.exec(query).all())
    return Response(content=svg, media_type="image/svg+xml")
