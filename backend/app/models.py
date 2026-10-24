from datetime import date
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, computed_field

from app.court import ShotType, Zone, shot_type_of, zone_of


def _not_in_future(value: date) -> date:
    if value > date.today():
        raise ValueError("game_date cannot be in the future")
    return value


GameDate = Annotated[date, AfterValidator(_not_in_future)]


class ShotBase(BaseModel):
    """Fields shared by every shot schema. Text is stored as typed (Hebrew is fine)."""

    player: str = Field(min_length=1, max_length=50)
    x: float = Field(ge=0, le=50)
    y: float = Field(ge=0, le=47)
    made: bool
    game_date: GameDate = Field(default_factory=date.today)
    note: str = Field(default="", max_length=200)


class ShotCreate(ShotBase):
    """POST body. Unknown fields (including zone and shot_type) -> 422."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ShotUpdate(BaseModel):
    """PATCH body: every field optional; send only what changes."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    player: str | None = Field(default=None, min_length=1, max_length=50)
    x: float | None = Field(default=None, ge=0, le=50)
    y: float | None = Field(default=None, ge=0, le=47)
    made: bool | None = None
    game_date: GameDate | None = None
    note: str | None = Field(default=None, max_length=200)


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
