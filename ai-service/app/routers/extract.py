import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
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
    # The notes sit between tags and are labelled as data, so text inside them is read
    # as the user's words and not as instructions.
    return f"today: {body.today.isoformat()}\n\n<notes>\n{body.text}\n</notes>"


@router.post("/extract", response_model=ExtractResponse)
async def extract(body: ExtractRequest, agent: AgentDep) -> ExtractResponse:
    """Turn pasted notes into PROPOSED shots. Nothing is saved here."""
    if agent is None:
        raise HTTPException(503, "No AI model is configured (set AI_MODEL).")
    try:
        run = await agent.run(_prompt(body), usage_limits=LIMITS)
    except UserError as error:  # e.g. the provider's API key is missing
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
    return ExtractResponse(
        **run.output.model_dump(), model=run.response.model_name or "unknown"
    )
