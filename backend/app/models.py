from datetime import date, timedelta
from typing import Annotated

from pydantic import AfterValidator, ConfigDict, computed_field
from sqlmodel import Field, SQLModel

from app.court import ShotType, Zone, shot_type_of, zone_of


def _not_too_far_ahead(value: date) -> date:
    # The server may run in UTC while the player is hours ahead (Israel), so "today"
    # for the player can be tomorrow here. One day of slack covers every time zone.
    if value > date.today() + timedelta(days=1):
        raise ValueError("game_date cannot be in the future")
    return value


# Each limit is defined once and used by both ShotBase and ShotUpdate.
Player = Annotated[str, Field(min_length=1, max_length=50)]
CourtX = Annotated[float, Field(ge=0, le=50)]
CourtY = Annotated[float, Field(ge=0, le=47)]
GameDate = Annotated[date, AfterValidator(_not_too_far_ahead)]
Note = Annotated[str, Field(max_length=200)]


class ShotBase(SQLModel):
    """Fields shared by every shot schema. Text is stored as typed (Hebrew is fine)."""

    player: Player
    x: CourtX
    y: CourtY
    made: bool
    game_date: GameDate = Field(default_factory=date.today)
    note: Note = ""


class Shot(ShotBase, table=True):
    """The database table. Never returned directly: routes answer with ShotPublic."""

    # AUTOINCREMENT: plain SQLite reuses the highest id after a delete, and ids must
    # not be reused.
    __table_args__ = {"sqlite_autoincrement": True}

    id: int | None = Field(default=None, primary_key=True)


class ShotCreate(ShotBase):
    """POST body. Unknown fields (including zone and shot_type) -> 422."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ShotUpdate(SQLModel):
    """PATCH body: every field optional; send only what changes."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    player: Player | None = None
    x: CourtX | None = None
    y: CourtY | None = None
    made: bool | None = None
    game_date: GameDate | None = None
    note: Note | None = None


class ShotPublic(ShotBase):
    """Response body: always has an id; zone and shot_type are computed from x, y."""

    id: int

    @computed_field
    @property
    def zone(self) -> Zone:
        return zone_of(self.x, self.y)

    @computed_field
    @property
    def shot_type(self) -> ShotType:
        return shot_type_of(self.x, self.y)
