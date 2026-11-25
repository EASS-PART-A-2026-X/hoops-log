"""A database made before accounts existed gets the new column and keeps its shots."""

from pathlib import Path

import pytest
from sqlalchemy import inspect, text

from app import db

OLD_SCHEMA = """
CREATE TABLE shot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player VARCHAR NOT NULL, x FLOAT NOT NULL, y FLOAT NOT NULL,
    made BOOLEAN NOT NULL, game_date DATE NOT NULL, note VARCHAR NOT NULL
)
"""


@pytest.fixture
def old_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    engine = db.make_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as connection:
        connection.execute(text(OLD_SCHEMA))
        connection.execute(
            text(
                "INSERT INTO shot (player, x, y, made, game_date, note) "
                "VALUES ('Yuly', 25, 6, 1, '2026-10-12', 'kept'), "
                "('Noam', 25, 30, 0, '2026-10-19', '')"
            )
        )
    monkeypatch.setattr(db, "engine", engine)
    yield engine
    engine.dispose()


def columns(engine) -> set[str]:
    return {col["name"] for col in inspect(engine).get_columns("shot")}


def test_the_column_is_added_and_the_shots_are_kept(old_database):
    assert "owner_id" not in columns(old_database)
    db.create_db_and_tables()
    assert "owner_id" in columns(old_database)
    with old_database.connect() as connection:
        rows = connection.execute(
            text("SELECT player, note, owner_id FROM shot ORDER BY id")
        ).all()
    assert [tuple(r) for r in rows] == [("Yuly", "kept", None), ("Noam", "", None)]


def test_the_new_tables_and_the_index_exist(old_database):
    db.create_db_and_tables()
    inspector = inspect(old_database)
    assert {"account", "auth_token", "shot"} <= set(inspector.get_table_names())
    assert "ix_shot_owner_id" in {i["name"] for i in inspector.get_indexes("shot")}


def test_running_it_twice_is_harmless(old_database):
    db.create_db_and_tables()
    db.create_db_and_tables()
    assert "owner_id" in columns(old_database)


def test_a_new_database_needs_no_migration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    engine = db.make_engine(f"sqlite:///{tmp_path / 'new.db'}")
    monkeypatch.setattr(db, "engine", engine)
    db.create_db_and_tables()
    assert "owner_id" in columns(engine)
    engine.dispose()


def test_the_first_account_adopts_the_migrated_shots(old_database):
    from fastapi.testclient import TestClient

    from app.main import app

    account = {
        "email": "a@example.com",
        "username": "first",
        "password": "a long enough password",
        "password_confirm": "a long enough password",
    }
    with TestClient(app) as client:  # start-up runs the migration
        token = client.post("/auth/register", json=account).json()["token"]
        shots = client.get(
            "/shots", headers={"Authorization": f"Bearer {token}"}
        ).json()
    assert [s["player"] for s in shots] == ["Yuly", "Noam"]
