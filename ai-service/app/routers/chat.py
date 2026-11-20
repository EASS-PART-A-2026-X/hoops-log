import asyncio
import hmac
import json
import logging
import os
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic_ai import Agent, UsageLimits
from pydantic_ai.exceptions import (
    ModelAPIError,
    ModelQuotaExceededError,
    ModelRateLimitError,
    ModelRequestTimeout,
    ModelTimeoutError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)

from app.agent import get_agent, to_proposals
from app.schemas import AgentChatResult, ChatRequest, ChatResponse

router = APIRouter(tags=["chat"])
log = logging.getLogger(__name__)

# One request may take a few model calls (a repair or two). More than this is a runaway:
# stop it instead of paying for it.
LIMITS = UsageLimits(request_limit=6, total_tokens_limit=20_000)
# The whole request, repairs included. A model call alone is cut at 30 s (agent.py); the
# backend waits 70 s (backend/app/ai.py) and the browser 90 s, so this inner deadline
# fires first: the answer is a plain 504 and nothing keeps spending the model's quota
# for a caller who has given up.
CHAT_DEADLINE_SECONDS = 60.0

AgentDep = Annotated["Agent[None, AgentChatResult] | None", Depends(get_agent)]


def _prompt(body: ChatRequest) -> str:
    # The conversation sits between two markers and is labelled as data, so what is in
    # it is read as words, not as instructions. Every message is one JSON line, so a
    # message cannot fake another speaker with a newline and "deni:". The marker has a
    # random part that is new for every request: nothing in the conversation can contain
    # the closing marker to "escape" it, because nobody can know it in advance.
    marker = f"chat-{secrets.token_hex(6)}"
    stats = body.stats.model_dump_json() if body.stats else "none: no shots logged yet"
    turns = "\n".join(
        json.dumps(turn.model_dump(), ensure_ascii=False) for turn in body.messages
    )
    return (
        f"today: {body.today.isoformat()}\n\n"
        f"STATS (computed by the app from the player's log; the only numbers you may "
        f"state): {stats}\n\n"
        f"The conversation so far, one JSON message per line, between <{marker}> and "
        f"</{marker}>:\n<{marker}>\n{turns}\n</{marker}>\n\n"
        "Reply to the player's last message."
    )


def require_token(
    x_service_token: Annotated[str | None, Header()] = None,
) -> None:
    """If AI_SERVICE_TOKEN is set, /chat needs the same value in X-Service-Token.

    The backend is this service's only caller. On a public host the token stops anyone
    else from spending the model's quota. Unset = no check (local development).
    """
    expected = os.environ.get("AI_SERVICE_TOKEN", "")
    if not expected:
        return
    if x_service_token is None or not hmac.compare_digest(
        x_service_token.encode(), expected.encode()
    ):
        raise HTTPException(401, "Missing or wrong service token.")


@router.post(
    "/chat", response_model=ChatResponse, dependencies=[Depends(require_token)]
)
async def chat(body: ChatRequest, agent: AgentDep) -> ChatResponse:
    """Deni's reply to the player's last message. Proposed shots are NOT saved here."""
    if agent is None:
        raise HTTPException(503, "No AI model is configured (set AI_MODEL).")
    try:
        async with asyncio.timeout(CHAT_DEADLINE_SECONDS):
            run = await agent.run(_prompt(body), usage_limits=LIMITS)
    except UserError as error:  # the model is set up wrong: no key, unknown provider...
        log.error("AI model setup problem: %s", error)
        raise HTTPException(503, "The AI model is not set up correctly.") from error
    except (ModelRateLimitError, ModelQuotaExceededError) as error:
        log.warning("AI model busy or over quota: %s", error)
        raise HTTPException(
            429, "The AI model is busy. Try again in a minute."
        ) from error
    except (ModelRequestTimeout, ModelTimeoutError, TimeoutError) as error:
        log.warning("AI model timed out: %s", error)
        raise HTTPException(504, "The AI model took too long to answer.") from error
    except (ModelAPIError, UnexpectedModelBehavior, UsageLimitExceeded) as error:
        # Includes the model repeatedly returning output that does not fit the contract.
        log.error("AI model failed: %s", error)
        raise HTTPException(
            502, "The AI model could not give a usable answer."
        ) from error
    except Exception as error:  # a bug, or a failure nobody planned for
        log.exception("Unexpected error while asking the AI model")
        raise HTTPException(500, "The AI service had an unexpected problem.") from error
    return ChatResponse(
        reply=run.output.reply,
        proposals=to_proposals(run.output),
        model=run.response.model_name or "unknown",
    )
