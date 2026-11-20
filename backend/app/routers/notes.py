import logging
from datetime import date
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    computed_field,
)

from app.ai import MAX_REPLY_BYTES, ai_headers, ai_url, get_ai_client, limit_notes
from app.court import ShotType, Zone, shot_type_of, zone_of
from app.models import CourtX, CourtY, GameDate, Note, printable_text

router = APIRouter(prefix="/notes", tags=["notes"])
log = logging.getLogger(__name__)

# These limits match the AI service's own (ai-service/app/schemas.py).
MAX_TEXT = 2000  # characters of pasted notes
MAX_PROPOSALS = 20  # shots in one answer
MAX_QUESTIONS = 5
MAX_SKIPPED = 10
MAX_MODEL_NAME = 100

UNAVAILABLE = (
    "The AI helper is not available right now. You can still add shots with the form."
)
TIMED_OUT = "The AI helper took too long to answer. Try again."
BUSY = "The AI helper is busy. Try again in a minute."
UNUSABLE = (
    "The AI helper could not give a usable answer. "
    "Try again, or add the shots with the form."
)

ClientDep = Annotated[httpx.AsyncClient, Depends(get_ai_client)]


class NotesRequest(BaseModel):
    """POST body: the player's own words, and optionally their date for "today"."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: Annotated[
        str, Field(min_length=1, max_length=MAX_TEXT), AfterValidator(printable_text)
    ]
    # The player's today, so "yesterday" is theirs even when the server is elsewhere.
    today: date | None = None


class ProposedShot(BaseModel):
    """A shot the AI found in the notes. NOT saved: the user must confirm it."""

    x: CourtX
    y: CourtY
    made: bool
    game_date: GameDate
    note: Note = ""
    quote: Note = ""  # the words of the notes it came from

    @computed_field
    @property
    def zone(self) -> Zone:
        return zone_of(self.x, self.y)

    @computed_field
    @property
    def shot_type(self) -> ShotType:
        return shot_type_of(self.x, self.y)


class NotesResult(BaseModel):
    proposals: Annotated[list[ProposedShot], Field(max_length=MAX_PROPOSALS)]
    questions: Annotated[list[Note], Field(max_length=MAX_QUESTIONS)]
    skipped: Annotated[list[Note], Field(max_length=MAX_SKIPPED)]
    model: Annotated[str, Field(max_length=MAX_MODEL_NAME)]


@router.post(
    "/extract",
    response_model=NotesResult,
    responses={
        429: {"description": "Too many requests, or the AI model is busy"},
        502: {"description": "The AI helper gave no usable answer"},
        503: {"description": "The AI helper is not available"},
        504: {"description": "The AI helper took too long"},
    },
    summary="Turn pasted notes into proposed shots (nothing is saved)",
)
async def extract_shots(body: NotesRequest, client: ClientDep) -> NotesResult:
    """Ask the AI service to read the notes. It only PROPOSES shots: nothing is saved.

    To keep a proposed shot, the browser sends it to `POST /shots` like any other shot.
    """
    # Here, after the body was checked, so a request that ends in a 422 is not counted.
    limit_notes()
    content = bytearray()
    try:
        async with client.stream(
            "POST",
            f"{ai_url()}/extract",
            json=body.model_dump(mode="json", exclude_none=True),
            headers=ai_headers(),
        ) as reply:
            status = reply.status_code
            async for chunk in reply.aiter_bytes():
                content += chunk
                if len(content) > MAX_REPLY_BYTES:
                    break  # never read more than this from another program
    except (httpx.ConnectError, httpx.ConnectTimeout) as error:
        log.warning("AI service unreachable: %s", error)
        raise HTTPException(503, UNAVAILABLE) from error
    except httpx.TimeoutException as error:
        log.warning("AI service timed out: %s", error)
        raise HTTPException(504, TIMED_OUT) from error
    except httpx.HTTPError as error:
        log.error("AI service call failed: %s", error)
        raise HTTPException(502, UNUSABLE) from error
    if status == 429:
        raise HTTPException(429, BUSY)
    if status == 503:
        raise HTTPException(503, UNAVAILABLE)
    if status == 504:
        raise HTTPException(504, TIMED_OUT)
    text = content.decode("utf-8", "replace")
    if status != 200:
        # Includes a wrong service token (401) and anything we did not plan for.
        log.error("AI service answered %s: %s", status, text[:200])
        raise HTTPException(502, UNUSABLE)
    if len(content) > MAX_REPLY_BYTES:
        log.error("AI service sent more than %s bytes", MAX_REPLY_BYTES)
        raise HTTPException(502, UNUSABLE)
    try:
        # Never trust another program's answer: it must obey this backend's own rules.
        return NotesResult.model_validate_json(content)
    except ValidationError as error:
        log.error("AI service sent an answer that breaks the rules: %s", error)
        raise HTTPException(502, UNUSABLE) from error
