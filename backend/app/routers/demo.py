from fastapi import APIRouter

from app.demo import demo_shots
from app.deps import CurrentUser
from app.models import ShotPublic

router = APIRouter(prefix="/demo", tags=["demo"])


@router.get(
    "/shots",
    response_model=list[ShotPublic],
    summary="A made-up set of shots to see what a full court looks like",
)
def list_demo_shots(_: CurrentUser) -> list[ShotPublic]:
    """Not stored and not anyone's: the same demo for every account, read only."""
    return demo_shots()
