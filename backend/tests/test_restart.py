from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import create_engine

from app import db
from app.main import app


def start_server(monkeypatch: pytest.MonkeyPatch, path: Path) -> TestClient:
    """A brand-new engine on the same file, like a freshly started process."""
    engine = create_engine(
        f"sqlite:///{path}", connect_args={"check_same_thread": False}
    )
    monkeypatch.setattr(db, "engine", engine)
    return TestClient(app)


def test_shot_survives_a_restart(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "app.db"

    with start_server(monkeypatch, path) as client:  # "with" runs the lifespan
        created = client.post(
            "/shots", json={"player": "Restart Test", "x": 25, "y": 10, "made": True}
        ).json()
    db.engine.dispose()  # the first server is gone

    with start_server(monkeypatch, path) as client:
        found = client.get(f"/shots/{created['id']}")
    db.engine.dispose()

    assert found.status_code == 200
    assert found.json()["player"] == "Restart Test"
