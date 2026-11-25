import os
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine, inspect, text
from sqlmodel import Session, SQLModel, create_engine

import app.users  # noqa: F401  (registers the account tables before create_all)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")


def make_engine(url: str) -> Engine:
    # FastAPI runs sync routes in a thread pool, and SQLite refuses cross-thread use
    # by default.
    return create_engine(url, connect_args={"check_same_thread": False})


engine = make_engine(DATABASE_URL)


def create_db_and_tables() -> None:
    db_file = engine.url.database  # e.g. "./data/app.db"; None for in-memory
    if db_file:
        Path(db_file).parent.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(engine)
    add_owner_column(engine)


def add_owner_column(engine: Engine) -> None:
    """Databases made before accounts existed have no `shot.owner_id`: add it.

    `create_all` only makes missing tables, it never changes one that exists.
    """
    if "owner_id" in {col["name"] for col in inspect(engine).get_columns("shot")}:
        return
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE shot ADD COLUMN owner_id INTEGER REFERENCES account(id)")
        )
        connection.execute(text("CREATE INDEX ix_shot_owner_id ON shot (owner_id)"))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session  # tests swap in an in-memory session via app.dependency_overrides


SessionDep = Annotated[Session, Depends(get_session)]
