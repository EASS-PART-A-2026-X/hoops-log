import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import AfterValidator, BaseModel, Field
from sqlmodel import Session, col, delete, select

from app.db import SessionDep
from app.models import ChatLine, printable_text

log = logging.getLogger(__name__)

router = APIRouter(prefix="/chat/history", tags=["chat"])

# The newest lines kept for one player. Older ones are dropped when new ones come in,
# so the table cannot grow without end.
KEEP_LINES = 100


def _a_name(value: str) -> str:
    """A real name: not only spaces, nothing that cannot be stored. Returned trimmed."""
    value = value.strip()
    if value == "":
        raise ValueError("the player's name cannot be empty")
    return printable_text(value)


# The same rule for the query of /chat/history and the `player` of POST /chat.
HistoryPlayer = Annotated[
    str, Field(min_length=1, max_length=50), AfterValidator(_a_name)
]
PlayerQuery = Annotated[HistoryPlayer, Query()]

# Start over must beat a chat that was already on its way: each Start over leaves a new
# marker for the player, and a chat saves only if the marker is still the one it saw
# when it began. (In memory: right for one server process, which is how this app runs.)
_started_over: dict[str, object] = {}


def generation_of(player: str) -> object | None:
    return _started_over.get(key_of(player))


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
    key = key_of(player)
    _started_over[key] = object()
    session.exec(delete(ChatLine).where(ChatLine.player_key == key))  # type: ignore[arg-type]
    session.commit()


def remember(session: Session, player: str, lines: list[HistoryLine]) -> None:
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
