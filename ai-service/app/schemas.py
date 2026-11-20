"""The contract of the AI service: what the backend sends and what it gets back.

The service is Deni's brain. It gets a conversation and a summary of the player's
numbers, and answers with Deni's reply and, when the player described shots,
PROPOSED shots. It never saves anything and it never knows who the shooter is: the
backend adds the player and decides what is stored. The limits on coordinates and
text match the backend's own shot rules (feet, 0-50 across, 0-47 from the baseline),
so a proposal that passes here is not rejected there for its shape.
"""

import unicodedata
from datetime import date, timedelta
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.spots import Spot


def _not_too_far_ahead(value: date) -> date:
    # Same rule as the backend: one day of slack covers every time zone.
    if value > date.today() + timedelta(days=1):
        raise ValueError("game_date cannot be in the future")
    return value


def _printable_text(value: str) -> str:
    """Same rule as the backend: reject text that cannot be stored or drawn."""
    for char in value:
        category = unicodedata.category(char)
        if category == "Cs" or char in "￾￿":
            raise ValueError("text contains a character that cannot be stored")
        if category == "Cc" and char not in "\t\n\r":
            raise ValueError("text contains a control character")
    return value


CourtX = Annotated[float, Field(ge=0, le=50)]
CourtY = Annotated[float, Field(ge=0, le=47)]
GameDate = Annotated[date, AfterValidator(_not_too_far_ahead)]
Line = Annotated[str, Field(max_length=200), AfterValidator(_printable_text)]
Percent = Annotated[float, Field(ge=0, le=100)]
Count = Annotated[int, Field(ge=0, le=1_000_000)]

MAX_TEXT = 2000  # characters in one message of the conversation
MAX_TURNS = 12  # messages of the conversation the model is shown
MAX_REPLY = 1500  # characters in Deni's reply
MAX_SHOTS = 20  # proposals in one reply
MAX_ZONES = 12  # zones in the stats summary

Role = Literal["user", "deni"]


class ChatTurn(BaseModel):
    """One message of the conversation."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    role: Role
    text: Annotated[
        str, Field(min_length=1, max_length=MAX_TEXT), AfterValidator(_printable_text)
    ]


class ZoneStat(BaseModel):
    """The player's numbers in one zone, with the league's ESTIMATE for it."""

    model_config = ConfigDict(extra="forbid")

    zone: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_]+$")]
    attempts: Count
    made: Count
    pct: Percent | None = None
    nba_pct: Percent  # an ESTIMATE, not measured data

    @model_validator(mode="after")
    def _made_is_at_most_attempts(self) -> Self:
        if self.made > self.attempts:
            raise ValueError("made cannot be more than attempts")
        return self


class StatsSummary(BaseModel):
    """Numbers the APP computed from the player's log. The model may state these and
    nothing else: it never calculates."""

    model_config = ConfigDict(extra="forbid")

    player: Annotated[str, Field(max_length=50), AfterValidator(_printable_text)] = ""
    attempts: Count
    made: Count
    fg_pct: Percent | None = None
    three_attempts: Count
    three_made: Count
    three_pct: Percent | None = None
    zones: Annotated[list[ZoneStat], Field(max_length=MAX_ZONES)] = []
    nba_fg: Percent  # estimates, like the zone ones
    nba_three: Percent

    @model_validator(mode="after")
    def _counts_add_up(self) -> Self:
        if self.made > self.attempts or self.three_made > self.three_attempts:
            raise ValueError("made cannot be more than attempts")
        if self.three_attempts > self.attempts:
            raise ValueError("three_attempts cannot be more than attempts")
        return self


class ChatRequest(BaseModel):
    """POST /chat body."""

    model_config = ConfigDict(extra="forbid")

    messages: Annotated[list[ChatTurn], Field(min_length=1, max_length=MAX_TURNS)]
    stats: StatsSummary | None = None
    # The caller's "today", so "yesterday" means the player's yesterday and not the
    # server's. Defaults to the server's date.
    today: date = Field(default_factory=date.today)

    @model_validator(mode="after")
    def _the_last_message_is_the_players(self) -> Self:
        if self.messages[-1].role != "user":
            raise ValueError("the last message must be the player's")
        return self


class AgentShot(BaseModel):
    """One shot as the MODEL writes it: a named `spot`, or explicit feet, never both.

    The model never writes coordinates for a named place. It picks the place from a
    fixed list and the service turns it into exact feet (app/spots.py). It writes x and
    y only when the player's own words give feet.
    """

    spot: Spot | None = None
    x: CourtX | None = None
    y: CourtY | None = None
    made: bool
    game_date: GameDate
    note: Line = ""
    quote: Line = ""

    @model_validator(mode="after")
    def _place_is_a_spot_or_feet(self) -> Self:
        if (self.x is None) != (self.y is None):
            raise ValueError("give x and y together")
        has_feet = self.x is not None
        if (self.spot is not None) == has_feet:
            raise ValueError(
                "give the place as a `spot` name or as feet (x and y), not both "
                "and not neither"
            )
        return self


class AgentChatResult(BaseModel):
    """What the agent must produce (the output type the model is held to)."""

    reply: Annotated[
        str, Field(min_length=1, max_length=MAX_REPLY), AfterValidator(_printable_text)
    ]
    proposals: Annotated[list[AgentShot], Field(max_length=MAX_SHOTS)] = []


class ProposedShot(BaseModel):
    """One shot found in the conversation. Not saved: the player must confirm it."""

    x: CourtX
    y: CourtY
    made: bool
    game_date: GameDate
    note: Line = ""
    # The words of the player this shot came from, so they can check it.
    quote: Line = ""


class ChatResponse(BaseModel):
    """POST /chat answer: Deni's reply, any proposed shots (every one with exact x and
    y), and which model answered."""

    reply: str
    proposals: Annotated[list[ProposedShot], Field(max_length=MAX_SHOTS)] = []
    model: str
