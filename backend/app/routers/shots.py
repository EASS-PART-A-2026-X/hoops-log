from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, status
from sqlmodel import Session, select

from app.db import SessionDep
from app.models import Shot, ShotCreate, ShotPublic, ShotUpdate

router = APIRouter(prefix="/shots", tags=["shots"])

# Ids start at 1 and count up, so 0 and negatives are never valid. The upper limit is
# far beyond any real table (2.1 billion shots) and far below SQLite's 64-bit range:
# a number bigger than that makes SQLite raise OverflowError (a 500), so anything out
# of range is a validation error (422) like any other bad number.
MAX_ID = 2**31 - 1
ShotId = Annotated[int, Path(ge=1, le=MAX_ID)]

NOT_FOUND = {status.HTTP_404_NOT_FOUND: {"description": "Shot not found"}}


def save(session: Session, shot: Shot) -> Shot:
    session.add(shot)
    session.commit()
    session.refresh(shot)
    return shot


def get_or_404(session: Session, shot_id: ShotId) -> Shot:
    shot = session.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shot not found")
    return shot


@router.get("", response_model=list[ShotPublic], summary="List shots, oldest id first")
def list_shots(
    session: SessionDep,
    offset: Annotated[int, Query(ge=0, le=MAX_ID)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[Shot]:
    query = select(Shot).order_by(Shot.id).offset(offset).limit(limit)
    return list(session.exec(query).all())


@router.post(
    "",
    response_model=ShotPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Record a shot",
)
def create_shot(body: ShotCreate, session: SessionDep) -> Shot:
    return save(session, Shot.model_validate(body))


@router.get(
    "/{shot_id}",
    response_model=ShotPublic,
    responses=NOT_FOUND,
    summary="Read one shot",
)
def get_shot(shot_id: ShotId, session: SessionDep) -> Shot:
    return get_or_404(session, shot_id)


@router.patch(
    "/{shot_id}",
    response_model=ShotPublic,
    responses=NOT_FOUND,
    summary="Change only the fields sent",
)
def update_shot(shot_id: ShotId, body: ShotUpdate, session: SessionDep) -> Shot:
    shot = get_or_404(session, shot_id)
    # Only fields the client sent; null means "leave unchanged".
    # equivalent-mutant: exclude_none already drops every unset field (all default None)
    shot.sqlmodel_update(body.model_dump(exclude_unset=True, exclude_none=True))
    return save(session, shot)


@router.delete(
    "/{shot_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=NOT_FOUND,
    summary="Delete a shot",
)
def delete_shot(shot_id: ShotId, session: SessionDep) -> None:
    session.delete(get_or_404(session, shot_id))
    session.commit()
