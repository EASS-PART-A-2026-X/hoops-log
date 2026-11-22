from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlmodel import col, delete, select

from app.db import SessionDep
from app.models import ChatLine, Player

router = APIRouter(prefix="/chat/history", tags=["chat"])

# The newest lines kept for one player. Older ones are dropped when new ones come in,
# so the table cannot grow without end.
KEEP_LINES = 100

PlayerQuery = Annotated[str, Query(min_length=1, max_length=50)]


def key_of(player: str) -> str:
    """ "Yuly" and "yuly" are one player, like everywhere else (see chart.py)."""
    return player.strip().casefold()


class HistoryLine(BaseModel):
    role: Literal["user", "deni"]
    text: str


class History(BaseModel):
    lines: list[HistoryLine]


@router.get(
    "",
    response_model=History,
    summary="The saved conversation with Deni for one player, oldest first",
)
def get_history(player: PlayerQuery, session: SessionDep) -> History:
    key = key_of(player)
    rows = session.exec(
        select(ChatLine)
        .where(ChatLine.player_key == key)
        .order_by(col(ChatLine.id).desc())
        .limit(KEEP_LINES)
    ).all()
    return History(
        lines=[HistoryLine(role=row.role, text=row.text) for row in reversed(rows)]  # type: ignore[arg-type]
    )


@router.delete(
    "",
    status_code=204,
    summary="Start over: forget the saved conversation of one player",
)
def start_over(player: PlayerQuery, session: SessionDep) -> None:
    session.exec(delete(ChatLine).where(ChatLine.player_key == key_of(player)))  # type: ignore[arg-type]
    session.commit()


def remember(session: SessionDep, player: Player, lines: list[HistoryLine]) -> None:
    """Save new lines for a player and keep only the newest KEEP_LINES."""
    key = key_of(player)
    for line in lines:
        session.add(ChatLine(player_key=key, role=line.role, text=line.text))
    session.commit()
    keep = session.exec(
        select(ChatLine.id)
        .where(ChatLine.player_key == key)
        .order_by(col(ChatLine.id).desc())
        .limit(KEEP_LINES)
    ).all()
    if len(keep) == KEEP_LINES:
        session.exec(
            delete(ChatLine).where(
                ChatLine.player_key == key,
                col(ChatLine.id) < min(keep),  # type: ignore[type-var]
            )  # type: ignore[arg-type]
        )
        session.commit()
