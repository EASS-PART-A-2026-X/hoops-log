"""Who may do what: every route against every kind of caller, and shots kept apart.

Testing strategy
  routes:   each shot route, /chart.svg, /auth/me, /auth/logout
  callers:  no header | a made-up token | an expired token | another user | the owner
  shots:    list | read | change | delete | chart, as the owner and as someone else
  new routes: a test that fails when a route is added without the lock on it
"""

from datetime import timedelta

import pytest
from fastapi import status
from sqlmodel import Session, select

from app import security
from app.main import app
from app.models import Shot
from app.users import AuthToken
from tests.conftest import login_header, make_user

SHOT = {"player": "Yuly", "x": 15, "y": 19, "made": True}

# (method, path, json body). Ids need not exist: a locked route answers 401 first.
PROTECTED = [
    ("GET", "/shots", None),
    ("POST", "/shots", SHOT),
    ("GET", "/shots/1", None),
    ("PATCH", "/shots/1", {"made": False}),
    ("DELETE", "/shots/1", None),
    ("GET", "/chart.svg", None),
    ("GET", "/auth/me", None),
    ("POST", "/auth/logout", None),
]
PUBLIC = {
    ("GET", "/health"),
    ("POST", "/auth/register"),
    ("POST", "/auth/login"),
}


@pytest.fixture
def other(anon, session: Session):
    """A second logged-in client (a different account, the same server)."""
    from fastapi.testclient import TestClient

    user = make_user(session, "other")
    return TestClient(app, headers=login_header(session, user))


@pytest.mark.parametrize(("method", "path", "body"), PROTECTED)
def test_no_token_means_401(anon, method, path, body):
    r = anon.request(method, path, json=body)
    assert r.status_code == status.HTTP_401_UNAUTHORIZED
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(("method", "path", "body"), PROTECTED)
def test_a_made_up_token_means_401(anon, method, path, body):
    r = anon.request(
        method, path, json=body, headers={"Authorization": "Bearer abc123"}
    )
    assert r.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.parametrize(("method", "path", "body"), PROTECTED)
def test_an_expired_token_means_401(client, session, method, path, body):
    for row in session.exec(select(AuthToken)).all():
        row.expires_at = security.utcnow() - timedelta(minutes=1)
        session.add(row)
    session.commit()
    assert (
        client.request(method, path, json=body).status_code
        == status.HTTP_401_UNAUTHORIZED
    )


def test_only_the_public_routes_are_open():
    """Fails the day someone adds a route and forgets the lock."""
    open_routes = set()
    for path, operations in app.openapi()["paths"].items():
        for method, operation in operations.items():
            if "security" not in operation:
                open_routes.add((method.upper(), path))
    assert open_routes == PUBLIC


def test_the_docs_describe_the_lock(anon):
    schema = anon.get("/openapi.json").json()
    assert schema["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"
    assert anon.get("/docs").status_code == 200
    assert anon.get("/health").status_code == 200


# --- shots are kept apart -----------------------------------------------------
def make_shot(client, **changes):
    r = client.post("/shots", json={**SHOT, **changes})
    assert r.status_code == 201, r.text
    return r.json()


def test_each_account_sees_only_its_own_shots(client, other):
    mine = make_shot(client, player="Mine")
    theirs = make_shot(other, player="Theirs")
    assert [s["id"] for s in client.get("/shots").json()] == [mine["id"]]
    assert [s["id"] for s in other.get("/shots").json()] == [theirs["id"]]
    assert client.get("/shots", params={"offset": 1}).json() == []


def test_someone_elses_shot_is_a_404_for_read_change_and_delete(client, other):
    theirs = make_shot(other)
    missing = client.get("/shots/99999")
    for method, body in (("GET", None), ("PATCH", {"made": False}), ("DELETE", None)):
        r = client.request(method, f"/shots/{theirs['id']}", json=body)
        assert r.status_code == 404, method
        assert (
            r.json() == missing.json()
        )  # the same words as a shot that does not exist


def test_a_refused_change_or_delete_leaves_the_shot_alone(client, other):
    theirs = make_shot(other, note="keep me")
    client.patch(f"/shots/{theirs['id']}", json={"note": "hacked", "made": False})
    client.delete(f"/shots/{theirs['id']}")
    assert other.get(f"/shots/{theirs['id']}").json() == theirs


def test_the_owner_can_still_do_everything(client):
    shot = make_shot(client)
    assert client.get(f"/shots/{shot['id']}").json() == shot
    assert (
        client.patch(f"/shots/{shot['id']}", json={"made": False}).json()["made"]
        is False
    )
    assert client.delete(f"/shots/{shot['id']}").status_code == 204
    assert client.get(f"/shots/{shot['id']}").status_code == 404


def test_the_chart_shows_only_your_shots(client, other):
    make_shot(client, player="Mine")
    make_shot(other, player="Theirs")
    mine = client.get("/chart.svg")
    assert "Mine" in mine.text
    assert "Theirs" not in mine.text
    assert "Mine" not in other.get("/chart.svg").text
    assert "Theirs" not in client.get("/chart.svg", params={"player": "Theirs"}).text


def test_the_client_cannot_choose_the_owner(client, other, session):
    r = client.post("/shots", json={**SHOT, "owner_id": 2})
    assert r.status_code == 422
    shot = make_shot(client)
    assert client.patch(f"/shots/{shot['id']}", json={"owner_id": 2}).status_code == 422
    assert "owner_id" not in shot
    assert session.get(Shot, shot["id"]).owner_id == 1


def test_a_new_shot_belongs_to_the_caller(client, other, session):
    mine, theirs = make_shot(client), make_shot(other)
    assert (
        session.get(Shot, mine["id"]).owner_id
        != session.get(Shot, theirs["id"]).owner_id
    )


def test_ids_are_still_never_reused_between_accounts(client, other):
    first = make_shot(client)
    client.delete(f"/shots/{first['id']}")
    assert make_shot(other)["id"] > first["id"]


def test_logging_out_locks_the_shots_again(client):
    make_shot(client)
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/shots").status_code == 401
