from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, status
from sqlmodel import Session, select

from app import db
from app.db import SessionDep
from app.models import Shot, ShotCreate, ShotPublic, ShotUpdate
from app.seed import seed


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.create_db_and_tables()
    with Session(db.engine) as session:
        seed(session)
    yield


app = FastAPI(title="Hoops Log API", lifespan=lifespan)


def get_or_404(session: SessionDep, shot_id: int) -> Shot:
    shot = session.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shot not found")
    return shot


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/shots")
def list_shots(
    session: SessionDep,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[ShotPublic]:
    shots = session.exec(
        select(Shot).order_by(Shot.id).offset(offset).limit(limit)
    ).all()
    return [ShotPublic.model_validate(shot) for shot in shots]


@app.post("/shots", status_code=status.HTTP_201_CREATED)
def create_shot(body: ShotCreate, session: SessionDep) -> ShotPublic:
    shot = Shot.model_validate(body)
    session.add(shot)
    session.commit()
    session.refresh(shot)
    return ShotPublic.model_validate(shot)


@app.get("/shots/{shot_id}")
def get_shot(shot_id: int, session: SessionDep) -> ShotPublic:
    return ShotPublic.model_validate(get_or_404(session, shot_id))


@app.patch("/shots/{shot_id}")
def update_shot(shot_id: int, body: ShotUpdate, session: SessionDep) -> ShotPublic:
    shot = get_or_404(session, shot_id)
    # Only fields the client sent; null means "leave unchanged".
    shot.sqlmodel_update(body.model_dump(exclude_unset=True, exclude_none=True))
    session.add(shot)
    session.commit()
    session.refresh(shot)
    return ShotPublic.model_validate(shot)


@app.delete("/shots/{shot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shot(shot_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, shot_id))
    session.commit()
