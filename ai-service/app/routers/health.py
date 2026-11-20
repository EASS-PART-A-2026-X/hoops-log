from fastapi import APIRouter

from app.agent import configured_model

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str | None]:
    """Is the service up, and which model is it set to use (None = not configured)?

    The model NAME is shown; keys never are.
    """
    return {"status": "ok", "model": configured_model()}
