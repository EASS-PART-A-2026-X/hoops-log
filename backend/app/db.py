import os
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/app.db")

if DATABASE_URL.startswith("sqlite:///") and ":memory:" not in DATABASE_URL:
    Path(DATABASE_URL.removeprefix("sqlite:///")).parent.mkdir(
        parents=True, exist_ok=True
    )

# FastAPI runs sync routes in a thread pool, and SQLite refuses cross-thread use by default.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session  # tests swap in an in-memory session via app.dependency_overrides


SessionDep = Annotated[Session, Depends(get_session)]
