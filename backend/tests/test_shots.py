# Testing strategy: split each input into partitions and test at least one value
# from each, especially both sides of every limit. A test counts only if it fails
# when the rule it protects is broken (break the rule on purpose to check).
#
# Shot fields
#   player:    missing | "" | whitespace only | 1 char | 50 chars | 51 chars | Hebrew
#   x:         -0.1 | 0 | 50 | 50.1 | missing | not a number
#   y:         -0.1 | 0 | 47 | 47.1
#   made:      true | false | missing | not a bool ("maybe")
#   game_date: omitted (defaults to today) | today | in the past | tomorrow | not a date
#   note:      omitted (defaults to "") | 200 chars | 201 chars | Hebrew
#   fields:    only known ones | an unknown one ("chef") | computed ones sent by the
#              client ("zone", "shot_type")
#
# Routes
#   shot id:   exists | missing (GET, PATCH, DELETE) | not an int (422)
#   list:      empty | several | offset/limit pages | limit 0 and 101 | offset -1
#   PATCH:     field absent | field null (leave unchanged) | new value | invalid value
#              on a missing id (422 comes before 404) | moving x, y changes the zone
#   DELETE:    first call 204 with empty body | second call 404
#   isolation: every test starts with an empty store
#
# Computed values (court geometry)
#   one spot inside each of the 10 zones classifies back to that zone
#   3PT line: on the corner line is 2PT | just beyond it is 3PT
#             on the arc is 2PT | just beyond it is 3PT
#             where the corner line meets the arc (about 14 ft) there is no gap
#   left and right zones mirror each other
#   shot_type is 3PT exactly when the zone ends in "_3"
#   the response carries the computed zone and shot_type, and they follow x, y

from datetime import date, timedelta

import pytest
from fastapi import status

SHOT = {"player": "Yuly", "x": 15, "y": 19, "made": True}  # a left-elbow 2PT
TODAY = date.today()


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_create_returns_201_with_defaults_and_computed_fields(client):
    r = client.post("/shots", json=SHOT)
    assert r.status_code == status.HTTP_201_CREATED
    body = r.json()
    assert body["id"] >= 1
    assert (body["player"], body["x"], body["y"], body["made"]) == (
        "Yuly",
        15,
        19,
        True,
    )
    assert body["game_date"] == TODAY.isoformat()  # default
    assert body["note"] == ""  # default
    assert (body["zone"], body["shot_type"]) == ("left_elbow", "2PT")  # computed


def test_get_returns_what_was_created(client):
    created = client.post("/shots", json=SHOT).json()
    assert client.get(f"/shots/{created['id']}").json() == created


def test_hebrew_text_is_stored_as_typed(client):
    shot = {**SHOT, "player": "יולי", "note": "זריקה מהמרפק"}
    created = client.post("/shots", json=shot).json()
    assert (created["player"], created["note"]) == ("יולי", "זריקה מהמרפק")
    assert client.get(f"/shots/{created['id']}").json() == created


def test_text_is_trimmed(client):
    created = client.post("/shots", json={**SHOT, "player": "  Yuly  "}).json()
    assert created["player"] == "Yuly"


@pytest.mark.parametrize("field", ["chef", "zone", "shot_type"])
def test_unknown_and_computed_fields_are_rejected(client, field):
    r = client.post("/shots", json={**SHOT, field: "top_3"})
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert r.json()["detail"][0]["type"] == "extra_forbidden"


INVALID_BODIES = {
    "player missing": {"x": 1, "y": 1, "made": True},
    "player empty": {**SHOT, "player": ""},
    "player whitespace only": {**SHOT, "player": "   "},
    "player 51 chars": {**SHOT, "player": "x" * 51},
    "player 51 Hebrew chars": {**SHOT, "player": "א" * 51},
    "x below 0": {**SHOT, "x": -0.1},
    "x above 50": {**SHOT, "x": 50.1},
    "x not a number": {**SHOT, "x": "abc"},
    "x missing": {"player": "a", "y": 1, "made": True},
    "y below 0": {**SHOT, "y": -0.1},
    "y above 47": {**SHOT, "y": 47.1},
    "y missing": {"player": "a", "x": 1, "made": True},
    "made missing": {"player": "a", "x": 1, "y": 1},
    "made not a bool": {**SHOT, "made": "maybe"},
    "game_date tomorrow": {
        **SHOT,
        "game_date": (TODAY + timedelta(days=1)).isoformat(),
    },
    "game_date not a date": {**SHOT, "game_date": "not-a-date"},
    "note 201 chars": {**SHOT, "note": "n" * 201},
}


@pytest.mark.parametrize("body", INVALID_BODIES.values(), ids=INVALID_BODIES.keys())
def test_invalid_bodies_are_422(client, body):
    r = client.post("/shots", json=body)
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert client.get("/shots").json() == []  # nothing was saved


VALID_EDGES = {
    "player 1 char": {**SHOT, "player": "x"},
    "player 50 chars": {**SHOT, "player": "x" * 50},
    "player 50 Hebrew chars": {**SHOT, "player": "א" * 50},
    "x is 0": {**SHOT, "x": 0},
    "x is 50": {**SHOT, "x": 50},
    "y is 0": {**SHOT, "y": 0},
    "y is 47": {**SHOT, "y": 47},
    "note 200 chars": {**SHOT, "note": "n" * 200},
    "game_date today": {**SHOT, "game_date": TODAY.isoformat()},
    "game_date in the past": {
        **SHOT,
        "game_date": (TODAY - timedelta(days=30)).isoformat(),
    },
}


@pytest.mark.parametrize("body", VALID_EDGES.values(), ids=VALID_EDGES.keys())
def test_limits_are_inclusive(client, body):
    assert client.post("/shots", json=body).status_code == status.HTTP_201_CREATED


def test_missing_shot_is_404(client):
    for method in ("GET", "PATCH", "DELETE"):
        body = {} if method == "PATCH" else None  # PATCH must pass validation first
        r = client.request(method, "/shots/999", json=body)
        assert r.status_code == status.HTTP_404_NOT_FOUND, method
        assert r.json() == {"detail": "Shot not found"}


def test_unknown_path_is_404_not_found(client):
    r = client.get("/shot/1")
    assert r.status_code == status.HTTP_404_NOT_FOUND
    assert r.json() == {"detail": "Not Found"}  # no route matched: not our handler


def test_non_integer_id_is_422(client):
    r = client.get("/shots/abc")
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert r.json()["detail"][0]["loc"] == ["path", "shot_id"]


def test_list_is_paginated(client):
    assert client.get("/shots").json() == []
    for n in range(3):
        client.post("/shots", json={**SHOT, "player": f"P{n}"})
    assert [s["player"] for s in client.get("/shots").json()] == ["P0", "P1", "P2"]
    page = client.get("/shots", params={"offset": 1, "limit": 1}).json()
    assert [s["player"] for s in page] == ["P1"]
    assert client.get("/shots", params={"offset": 3}).json() == []


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 101}, {"offset": -1}], ids=str
)
def test_bad_pagination_is_422(client, params):
    r = client.get("/shots", params=params)
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_patch_changes_only_sent_fields(client):
    sid = client.post("/shots", json={**SHOT, "note": "keep"}).json()["id"]
    r = client.patch(f"/shots/{sid}", json={"made": False})
    assert r.status_code == status.HTTP_200_OK
    body = r.json()
    assert body["made"] is False
    assert (body["player"], body["x"], body["y"], body["note"]) == (
        "Yuly",
        15,
        19,
        "keep",
    )


def test_patch_null_means_leave_unchanged(client):
    sid = client.post("/shots", json=SHOT).json()["id"]
    r = client.patch(f"/shots/{sid}", json={"player": None, "x": None})
    assert r.status_code == status.HTTP_200_OK
    assert (r.json()["player"], r.json()["x"]) == ("Yuly", 15)


def test_patch_moving_the_shot_updates_zone_and_type(client):
    sid = client.post("/shots", json=SHOT).json()["id"]
    r = client.patch(f"/shots/{sid}", json={"x": 1.5, "y": 4})
    assert (r.json()["zone"], r.json()["shot_type"]) == ("left_corner_3", "3PT")
    assert client.get(f"/shots/{sid}").json()["zone"] == "left_corner_3"


def test_patch_invalid_value_is_422_and_changes_nothing(client):
    sid = client.post("/shots", json=SHOT).json()["id"]
    assert client.patch(f"/shots/{sid}", json={"x": 51}).status_code == 422
    assert client.patch(f"/shots/{sid}", json={"zone": "top_3"}).status_code == 422
    assert client.get(f"/shots/{sid}").json()["x"] == 15


def test_patch_validation_runs_before_the_404(client):
    # Invalid body on a missing id: validation (stage 3) answers before get_or_404.
    r = client.patch("/shots/999", json={"x": 51})
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert [e["loc"] for e in r.json()["detail"]] == [["body", "x"]]


def test_delete_then_404(client):
    sid = client.post("/shots", json=SHOT).json()["id"]
    r = client.delete(f"/shots/{sid}")
    assert r.status_code == status.HTTP_204_NO_CONTENT
    assert r.content == b""
    assert client.get(f"/shots/{sid}").status_code == 404
    assert client.delete(f"/shots/{sid}").status_code == 404


def test_each_test_starts_empty(client):
    assert client.get("/shots").json() == []
