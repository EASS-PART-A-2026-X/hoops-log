"""The contract of the AI service: what the backend sends and what it gets back.

The service only PROPOSES shots. It never saves anything and it never knows who the
shooter is: the backend adds the player and decides what is stored. The limits on
coordinates and note length match the backend's own shot rules (feet, 0-50 across,
0-47 from the baseline), so a proposal that passes here is not rejected there for
its shape.
"""

import unicodedata
from datetime import date, timedelta
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field


def _not_too_far_ahead(value: date) -> date:
    # Same rule as the backend: one day of slack covers every time zone.
    if value > date.today() + timedelta(days=1):
        raise ValueError("game_date cannot be in the future")
    return value


def _printable_text(value: str) -> str:
    """Same rule as the backend: reject text that cannot be stored or drawn."""
    for char in value:
        category = unicodedata.category(char)
        if category == "Cs" or char in "\ufffe\uffff":
            raise ValueError("text contains a character that cannot be stored")
        if category == "Cc" and char not in "\t\n\r":
            raise ValueError("text contains a control character")
    return value


CourtX = Annotated[float, Field(ge=0, le=50)]
CourtY = Annotated[float, Field(ge=0, le=47)]
GameDate = Annotated[date, AfterValidator(_not_too_far_ahead)]
Line = Annotated[str, Field(max_length=200), AfterValidator(_printable_text)]

MAX_TEXT = 2000  # characters of pasted notes
MAX_SHOTS = 20  # proposals per request
MAX_QUESTIONS = 5


class ExtractRequest(BaseModel):
    """POST /extract body."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: Annotated[
        str, Field(min_length=1, max_length=MAX_TEXT), AfterValidator(_printable_text)
    ]
    # The caller's "today", so "yesterday" means the player's yesterday and not the
    # server's. Defaults to the server's date.
    today: date = Field(default_factory=date.today)


class ProposedShot(BaseModel):
    """One shot found in the notes. Not saved: the user must confirm it first."""

    x: CourtX
    y: CourtY
    made: bool
    game_date: GameDate
    note: Line = ""
    # The words of the notes this shot came from, so the user can check it.
    quote: Line = ""


class ExtractionResult(BaseModel):
    """What the agent must produce (the output type the model is held to)."""

    proposals: Annotated[list[ProposedShot], Field(max_length=MAX_SHOTS)] = []
    # Ask instead of guessing: one short question per unclear thing.
    questions: Annotated[list[Line], Field(max_length=MAX_QUESTIONS)] = []
    # Things in the notes that are not logged (free throws, assists...), one line each.
    skipped: Annotated[list[Line], Field(max_length=10)] = []


class ExtractResponse(ExtractionResult):
    """POST /extract answer: the result plus which model produced it."""

    model: str
