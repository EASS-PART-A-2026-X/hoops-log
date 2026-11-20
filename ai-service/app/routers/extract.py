import hmac
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

from app.agent import get_agent
from app.schemas import ExtractionResult, ExtractRequest, ExtractResponse

router = APIRouter(tags=["extract"])
log = logging.getLogger(__name__)

# One request may take a few model calls (a tool call, a repair). More than this is a
# runaway: stop it instead of paying for it.
LIMITS = UsageLimits(request_limit=6, total_tokens_limit=20_000)

AgentDep = Annotated["Agent[None, ExtractionResult] | None", Depends(get_agent)]


def _prompt(body: ExtractRequest) -> str:
    # The notes sit between two markers and are labelled as data, so text inside them
    # is read as the user's words, not as instructions. The marker has a random part
    # that is new for every request: notes cannot contain the closing marker to
    # "escape" it, because nobody can know it in advance.
    marker = f"notes-{secrets.token_hex(6)}"
    return (
        f"today: {body.today.isoformat()}\n\n"
        f"The player's notes are between <{marker}> and </{marker}>:\n"
        f"<{marker}>\n{body.text}\n</{marker}>"
    )


def require_token(
    x_service_token: Annotated[str | None, Header()] = None,
) -> None:
    """If AI_SERVICE_TOKEN is set, /extract needs the same value in X-Service-Token.

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
    "/extract", response_model=ExtractResponse, dependencies=[Depends(require_token)]
)
async def extract(body: ExtractRequest, agent: AgentDep) -> ExtractResponse:
    """Turn pasted notes into PROPOSED shots. Nothing is saved here."""
    if agent is None:
        raise HTTPException(503, "No AI model is configured (set AI_MODEL).")
    try:
        run = await agent.run(_prompt(body), usage_limits=LIMITS)
    except UserError as error:  # the model is set up wrong: no key, unknown provider...
        log.error("AI model setup problem: %s", error)
        raise HTTPException(503, "The AI model is not set up correctly.") from error
    except (ModelRateLimitError, ModelQuotaExceededError) as error:
        log.warning("AI model busy or over quota: %s", error)
        raise HTTPException(
            429, "The AI model is busy. Try again in a minute."
        ) from error
    except (ModelRequestTimeout, ModelTimeoutError) as error:
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
    return ExtractResponse(
        **run.output.model_dump(), model=run.response.model_name or "unknown"
    )
