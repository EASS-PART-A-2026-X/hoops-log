import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.seed import SEED


def test_data_survives_restart(tmp_path, monkeypatch: pytest.MonkeyPatch):
    url = f"sqlite:///{tmp_path / 'data' / 'app.db'}"
    monkeypatch.setattr(db, "engine", db.make_engine(url))  # "process" 1
    with TestClient(app) as client:  # `with` runs lifespan startup + shutdown
        assert len(client.get("/shots").json()) == len(SEED)  # seeded
        client.post(
            "/shots", json={"player": "Restart Test", "x": 25, "y": 10, "made": True}
        )
    monkeypatch.setattr(db, "engine", db.make_engine(url))  # "process" 2
    with TestClient(app) as client:
        players = [s["player"] for s in client.get("/shots").json()]
    assert players == [row["player"] for row in SEED] + [
        "Restart Test"
    ]  # no double seed
