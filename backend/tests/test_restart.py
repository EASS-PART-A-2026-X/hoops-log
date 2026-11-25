import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.seed import SEED

ACCOUNT = {
    "email": "restart@example.com",
    "username": "restart",
    "password": "a long enough password",
    "password_confirm": "a long enough password",
}


def test_data_survives_restart(tmp_path, monkeypatch: pytest.MonkeyPatch):
    url = f"sqlite:///{tmp_path / 'data' / 'app.db'}"
    monkeypatch.setattr(db, "engine", db.make_engine(url))  # "process" 1
    with TestClient(app) as client:  # `with` runs lifespan startup + shutdown
        # The first account takes over the three demo shots made at start-up.
        token = client.post("/auth/register", json=ACCOUNT).json()["token"]
        login = {"Authorization": f"Bearer {token}"}
        assert len(client.get("/shots", headers=login).json()) == len(SEED)  # seeded
        client.post(
            "/shots",
            json={"player": "Restart Test", "x": 25, "y": 10, "made": True},
            headers=login,
        )
    monkeypatch.setattr(db, "engine", db.make_engine(url))  # "process" 2
    with TestClient(app) as client:
        # The account and the login both survived: the same token still works.
        assert client.get("/auth/me", headers=login).json()["username"] == "restart"
        players = [s["player"] for s in client.get("/shots", headers=login).json()]
        # A new login works too.
        again = client.post(
            "/auth/login",
            json={"login": "restart", "password": ACCOUNT["password"]},
        )
        assert again.status_code == 200
    assert players == [row["player"] for row in SEED] + [
        "Restart Test"
    ]  # no double seed
