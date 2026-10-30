from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, status
from sqlmodel import Session, select

from app import db
from app.db import SessionDep
from app.models import Shot, ShotCreate, ShotPublic, ShotUpdate
from app.seed import seed_if_empty


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.create_db_and_tables()
    with Session(db.engine) as session:
        seed_if_empty(session)
    yield
    db.engine.dispose()


app = FastAPI(title="Hoops Log API", lifespan=lifespan)


def save(session: Session, shot: Shot) -> Shot:
    session.add(shot)
    session.commit()
    session.refresh(shot)
    return shot


def get_or_404(session: Session, shot_id: int) -> Shot:
    shot = session.get(Shot, shot_id)
    if shot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shot not found")
    return shot


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/shots", response_model=list[ShotPublic])
def list_shots(
    session: SessionDep,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[Shot]:
    query = select(Shot).order_by(Shot.id).offset(offset).limit(limit)
    return list(session.exec(query).all())


@app.post("/shots", response_model=ShotPublic, status_code=status.HTTP_201_CREATED)
def create_shot(body: ShotCreate, session: SessionDep) -> Shot:
    return save(session, Shot.model_validate(body))


@app.get("/shots/{shot_id}", response_model=ShotPublic)
def get_shot(shot_id: int, session: SessionDep) -> Shot:
    return get_or_404(session, shot_id)


@app.patch("/shots/{shot_id}", response_model=ShotPublic)
def update_shot(shot_id: int, body: ShotUpdate, session: SessionDep) -> Shot:
    shot = get_or_404(session, shot_id)
    # Only fields the client sent; null means "leave unchanged".
    shot.sqlmodel_update(body.model_dump(exclude_unset=True, exclude_none=True))
    return save(session, shot)


@app.delete("/shots/{shot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shot(shot_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, shot_id))
    session.commit()
