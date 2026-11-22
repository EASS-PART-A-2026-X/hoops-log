import logging
from datetime import date
from typing import Annotated, Literal, Self

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    computed_field,
    model_validator,
)

from app.ai import (
    MAX_REPLY_BYTES,
    STATUS_TIMEOUT_SECONDS,
    ai_headers,
    ai_url,
    get_ai_client,
    limit_chat,
    status_cache,
)
from app.court import ShotType, Zone, shot_type_of, zone_of
from app.db import SessionDep
from app.models import CourtX, CourtY, GameDate, Note, Player, printable_text
from app.routers.history import HistoryLine, remember

router = APIRouter(prefix="/chat", tags=["chat"])
log = logging.getLogger(__name__)

# These limits match the AI service's own (ai-service/app/schemas.py).
MAX_TEXT = 2000  # characters in one message
MAX_TURNS = 12  # messages sent along with a new one
MAX_REPLY = 1500  # characters in Deni's reply
MAX_PROPOSALS = 20  # shots in one reply
MAX_ZONES = 12  # zones in the stats summary
MAX_MODEL_NAME = 100

UNAVAILABLE = (
    "Deni's AI helper is not available right now. You can still add shots by hand."
)
TIMED_OUT = "Deni's AI helper took too long to answer. Try again."
BUSY = "Deni's AI helper is busy. Try again in a minute."
UNUSABLE = (
    "Deni's AI helper could not give a usable answer. "
    "Try again, or add the shots by hand."
)

ClientDep = Annotated[httpx.AsyncClient, Depends(get_ai_client)]

Text = Annotated[str, AfterValidator(printable_text)]
Percent = Annotated[float, Field(ge=0, le=100)]
Count = Annotated[int, Field(ge=0, le=1_000_000)]


class ChatTurn(BaseModel):
    """One message of the conversation."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    role: Literal["user", "deni"]
    text: Annotated[
        str, Field(min_length=1, max_length=MAX_TEXT), AfterValidator(printable_text)
    ]


class ZoneStat(BaseModel):
    """The player's numbers in one zone, with the league's ESTIMATE for it."""

    model_config = ConfigDict(extra="forbid")

    zone: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_]+$")]
    attempts: Count
    made: Count
    pct: Percent | None = None
    nba_pct: Percent

    @model_validator(mode="after")
    def _made_is_at_most_attempts(self) -> Self:
        if self.made > self.attempts:
            raise ValueError("made cannot be more than attempts")
        return self


class StatsSummary(BaseModel):
    """Numbers the app computed from the player's log; the AI may state these and
    nothing else."""

    model_config = ConfigDict(extra="forbid")

    player: Annotated[str, Field(max_length=50), AfterValidator(printable_text)] = ""
    attempts: Count
    made: Count
    fg_pct: Percent | None = None
    three_attempts: Count
    three_made: Count
    three_pct: Percent | None = None
    zones: Annotated[list[ZoneStat], Field(max_length=MAX_ZONES)] = []
    nba_fg: Percent
    nba_three: Percent

    @model_validator(mode="after")
    def _counts_add_up(self) -> Self:
        if self.made > self.attempts or self.three_made > self.three_attempts:
            raise ValueError("made cannot be more than attempts")
        if self.three_attempts > self.attempts:
            raise ValueError("three_attempts cannot be more than attempts")
        return self


class ChatRequest(BaseModel):
    """POST body: the conversation so far (the last message is the player's), the
    numbers the app computed, and the player's date for "today"."""

    model_config = ConfigDict(extra="forbid")

    messages: Annotated[list[ChatTurn], Field(min_length=1, max_length=MAX_TURNS)]
    stats: StatsSummary | None = None
    # The player's today, so "yesterday" is theirs even when the server is elsewhere.
    today: date | None = None
    # Whose conversation this is. When given, the player's message and Deni's reply are
    # saved (see /chat/history). It is never sent on to the AI service.
    player: Annotated[Player | None, Field()] = None

    @model_validator(mode="after")
    def _the_last_message_is_the_players(self) -> Self:
        if self.messages[-1].role != "user":
            raise ValueError("the last message must be the player's")
        return self


class ProposedShot(BaseModel):
    """A shot the AI found in the chat. NOT saved: the player must confirm it."""

    x: CourtX
    y: CourtY
    made: bool
    game_date: GameDate
    note: Note = ""
    quote: Note = ""  # the player's words it came from

    @computed_field
    @property
    def zone(self) -> Zone:
        return zone_of(self.x, self.y)

    @computed_field
    @property
    def shot_type(self) -> ShotType:
        return shot_type_of(self.x, self.y)


class ChatReply(BaseModel):
    reply: Annotated[
        str, Field(min_length=1, max_length=MAX_REPLY), AfterValidator(printable_text)
    ]
    proposals: Annotated[list[ProposedShot], Field(max_length=MAX_PROPOSALS)]
    model: Annotated[str, Field(max_length=MAX_MODEL_NAME)]


class ChatStatus(BaseModel):
    """Is Deni's AI helper there right now? The app shows the manual add form if not."""

    available: bool


@router.get(
    "/status",
    response_model=ChatStatus,
    summary="Is the AI helper reachable and set up with a model?",
)
async def chat_status(client: ClientDep) -> ChatStatus:
    """True only when the AI service answers its health check and has a model set.

    The answer is remembered for a few seconds, so many page loads do not each knock on
    the AI service. This never fails: any trouble just means `available: false`.
    """
    cached = status_cache.get()
    if cached is not None:
        return ChatStatus(available=cached)
    available = await _ai_has_a_model(client)
    status_cache.set(available)
    return ChatStatus(available=available)


async def _ai_has_a_model(client: httpx.AsyncClient) -> bool:
    try:
        reply = await client.get(f"{ai_url()}/health", timeout=STATUS_TIMEOUT_SECONDS)
    except httpx.HTTPError:
        return False
    if reply.status_code != 200:
        return False
    try:
        data = reply.json()
    except ValueError:
        return False
    return isinstance(data, dict) and bool(data.get("model"))


@router.post(
    "",
    response_model=ChatReply,
    responses={
        429: {"description": "Too many requests, or the AI model is busy"},
        502: {"description": "The AI helper gave no usable answer"},
        503: {"description": "The AI helper is not available"},
        504: {"description": "The AI helper took too long"},
    },
    summary="Deni's reply to the player's last message",
)
async def chat(body: ChatRequest, client: ClientDep, session: SessionDep) -> ChatReply:
    """Ask the AI service for Deni's reply. It only PROPOSES shots: no shot is saved.

    With a `player`, the player's message and Deni's reply are kept in the saved
    conversation (`/chat/history`), and only when the reply worked.

    To keep a proposed shot, the browser sends it to `POST /shots` like any other shot.
    """
    # Here, after the body was checked, so a request that ends in a 422 is not counted.
    limit_chat()
    content = bytearray()
    try:
        async with client.stream(
            "POST",
            f"{ai_url()}/chat",
            json=body.model_dump(mode="json", exclude_none=True, exclude={"player"}),
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
        answer = ChatReply.model_validate_json(content)
    except ValidationError as error:
        log.error("AI service sent an answer that breaks the rules: %s", error)
        raise HTTPException(502, UNUSABLE) from error
    if body.player is not None:
        # Only a conversation that worked is kept: both lines, or neither.
        remember(
            session,
            body.player,
            [
                HistoryLine(role="user", text=body.messages[-1].text),
                HistoryLine(role="deni", text=answer.reply),
            ],
        )
    return answer
