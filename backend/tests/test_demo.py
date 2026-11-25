"""The built-in demo: shots made up for a new account to look at, never stored.

Testing strategy
  who:      no login (401) | any account (the same demo for everyone)
  content:  how many | ids | the player name | every limit a real shot has | every zone
  stable:   the same demo on every call | only the dates move with today
  storage:  never written to the database | never in an account's own shots
  writes:   no route accepts a demo id
"""

import hashlib
from datetime import date, timedelta

import pytest

from app.demo import DEMO_COUNT, DEMO_PLAYER, NOTES, demo_shots
from tests.conftest import login_header, make_user


def test_the_demo_needs_a_login(anon):
    r = anon.get("/demo/shots")
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


def test_150_shots_with_negative_ids_for_a_made_up_player(client):
    shots = client.get("/demo/shots").json()
    assert len(shots) == DEMO_COUNT == 150
    assert [s["id"] for s in shots] == list(range(-1, -151, -1))
    assert {s["player"] for s in shots} == {DEMO_PLAYER} == {"Demo Player"}


def test_every_demo_shot_is_a_valid_shot_with_its_zone(client):
    shots = client.get("/demo/shots").json()
    for shot in shots:
        assert 0 <= shot["x"] <= 50
        assert 0 <= shot["y"] <= 47
        assert isinstance(shot["made"], bool)
        assert shot["note"] in NOTES
        assert shot["zone"]
        assert shot["shot_type"] in ("2PT", "3PT")
    assert {s["zone"] for s in shots} == {
        "left_corner_3",
        "left_wing_3",
        "top_3",
        "right_wing_3",
        "right_corner_3",
        "left_elbow",
        "right_elbow",
        "mid_range",
        "paint",
        "restricted_area",
    }


def test_it_looks_like_a_real_player(client):
    shots = client.get("/demo/shots").json()
    made = sum(s["made"] for s in shots)
    threes = [s for s in shots if s["shot_type"] == "3PT"]
    assert 60 <= made <= 90  # about half go in, not all and not none
    assert 30 <= len(threes) <= 70
    assert any(s["note"] for s in shots)
    assert any(not s["note"] for s in shots)


def test_the_same_demo_on_every_call_and_for_every_account(client, anon, session):
    first = client.get("/demo/shots").json()
    assert client.get("/demo/shots").json() == first
    other = make_user(session, "someoneelse")
    assert anon.get("/demo/shots", headers=login_header(session, other)).json() == first


def test_only_the_dates_move_with_today():
    one = demo_shots(date(2026, 1, 1))
    two = demo_shots(date(2026, 6, 1))
    assert [(s.x, s.y, s.made, s.note) for s in one] == [
        (s.x, s.y, s.made, s.note) for s in two
    ]
    for shots, today in ((one, date(2026, 1, 1)), (two, date(2026, 6, 1))):
        days_ago = {(today - s.game_date).days for s in shots}
        assert min(days_ago) == 0
        assert max(days_ago) == 21
        assert days_ago <= set(range(22))


def test_the_dates_default_to_today():
    assert demo_shots() == demo_shots(date.today())
    assert max(s.game_date for s in demo_shots()) <= date.today()
    assert min(s.game_date for s in demo_shots()) >= date.today() - timedelta(days=21)


def test_the_demo_is_what_it_was_on_purpose():
    # A fingerprint of the made-up shots. If you change the demo on purpose, update it.
    shots = demo_shots(date(2026, 1, 1))
    text = "|".join(
        f"{s.id},{s.x},{s.y},{int(s.made)},{s.game_date},{s.note}" for s in shots
    )
    assert hashlib.sha256(text.encode()).hexdigest() == (
        "c3836c797a23d71f14a7350cb54bf6d2cc9c110df57e2316e77f92830b3b3e34"
    )


def test_the_demo_is_never_stored_or_mixed_with_your_own_shots(client, session):
    from sqlmodel import select

    from app.models import Shot

    client.get("/demo/shots")
    assert client.get("/shots").json() == []
    assert session.exec(select(Shot)).all() == []
    mine = client.post("/shots", json={"x": 25, "y": 10, "made": True}).json()
    assert [s["id"] for s in client.get("/shots").json()] == [mine["id"]]
    assert all(s["id"] < 0 for s in client.get("/demo/shots").json())
    assert not client.get("/chart.svg").text.count("Demo Player")


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
@pytest.mark.parametrize("shot_id", [-1, -150])
def test_no_route_accepts_a_demo_id(client, method, shot_id):
    kwargs = {"json": {"x": 1}} if method == "patch" else {}
    r = getattr(client, method)(f"/shots/{shot_id}", **kwargs)
    assert r.status_code == 422


def test_the_demo_cannot_be_written(client):
    for method in ("post", "put", "patch", "delete"):
        r = getattr(client, method)("/demo/shots")
        assert r.status_code == 405, method
