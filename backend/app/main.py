from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlmodel import Session

from app import db
from app.routers import health, shots
from app.seed import seed_if_empty


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.create_db_and_tables()
    with Session(db.engine) as session:
        seed_if_empty(session)
    yield
    db.engine.dispose()


app = FastAPI(
    title="Hoops Log API",
    version="0.3.0",
    description="Record basketball shots on a half court and read them back.",
    lifespan=lifespan,
)
app.include_router(health.router)
app.include_router(shots.router)
