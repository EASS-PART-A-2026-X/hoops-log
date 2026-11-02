import json

# Testing strategy: split each input into partitions and test at least one value
# from each, especially both sides of every limit. A test counts only if it fails
# when the rule it protects is broken (break the rule on purpose to check).
#
# Shot fields
#   player:    missing | "" | whitespace only | 1 char | 50 chars | 51 chars | Hebrew
#   x:         -0.1 | 0 | 50 | 50.1 | missing | not a number
#   y:         -0.1 | 0 | 47 | 47.1
#   made:      true | false | missing | not a bool ("maybe")
#   game_date: omitted (defaults to today) | in the past | tomorrow (one day of
#              slack for time zones) | two days ahead | far future | not a date
#   note:      omitted (defaults to "") | 200 chars | 201 chars | Hebrew
#   fields:    only known ones | an unknown one ("chef") | computed ones sent by the
#              client ("zone", "shot_type")
#
# Routes
#   shot id:   exists | missing (GET, PATCH, DELETE) | not an int (422)
#   list:      empty | several | offset/limit pages | limit 0, 100 and 101 | offset -1
#   PATCH:     field absent | field null (leave unchanged) | new value | every invalid
#              value that POST rejects, one field at a time | limits inclusive on both
#              sides | invalid value on a missing id (422 comes before 404) | moving
#              x, y changes the zone
#   DELETE:    first call 204 with empty body | second call 404
#   ids:       never reused after a delete
#   isolation: every test starts with an empty store
#
# Computed values (court geometry)
#   one spot inside each of the 10 zones classifies back to that zone
#   3PT line: on the corner line is 2PT | just beyond it is 3PT
#             on the arc is 2PT | just beyond it is 3PT
#             where the corner line meets the arc (about 14 ft) there is no gap
#   2PT and wing boundaries: a point on and a point just across each threshold
#             (restricted circle, lane edge, free-throw line, elbow edges, top/wing)
#   left and right zones mirror each other
#   shot_type is 3PT exactly when the zone ends in "_3"
#   the response carries the computed zone and shot_type, and they follow x, y
from datetime import date, timedelta

import pytest
from fastapi import status

SHOT = {"player": "Yuly", "x": 15, "y": 19, "made": True}  # a left-elbow 2PT


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_create_returns_201_with_defaults_and_computed_fields(client):
    before = date.today()
    r = client.post("/shots", json=SHOT)
    after = date.today()  # a run that crosses midnight must not flake
    assert r.status_code == status.HTTP_201_CREATED
    body = r.json()
    assert body["id"] >= 1
    assert (body["player"], body["x"], body["y"], body["made"]) == (
        "Yuly",
        15,
        19,
        True,
    )
    assert body["game_date"] in (before.isoformat(), after.isoformat())  # default
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


# One field at a time: POST sends it on top of a valid shot, PATCH sends it alone.
INVALID_VALUES = {
    "player empty": {"player": ""},
    "player whitespace only": {"player": "   "},
    "player 51 chars": {"player": "x" * 51},
    "player 51 Hebrew chars": {"player": "א" * 51},
    "x below 0": {"x": -0.1},
    "x above 50": {"x": 50.1},
    "x not a number": {"x": "abc"},
    "y below 0": {"y": -0.1},
    "y above 47": {"y": 47.1},
    "made not a bool": {"made": "maybe"},
    "game_date far in the future": {"game_date": "2999-01-01"},
    "game_date not a date": {"game_date": "not-a-date"},
    "note 201 chars": {"note": "n" * 201},
}
# A missing field is invalid for POST only; PATCH may leave any field out.
MISSING_FIELDS = {
    "player missing": {"x": 1, "y": 1, "made": True},
    "x missing": {"player": "a", "y": 1, "made": True},
    "y missing": {"player": "a", "x": 1, "made": True},
    "made missing": {"player": "a", "x": 1, "y": 1},
}
INVALID_BODIES = {
    **{name: {**SHOT, **change} for name, change in INVALID_VALUES.items()},
    **MISSING_FIELDS,
}


@pytest.mark.parametrize("body", INVALID_BODIES.values(), ids=INVALID_BODIES.keys())
def test_invalid_bodies_are_422(client, body):
    r = client.post("/shots", json=body)
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert client.get("/shots").json() == []  # nothing was saved


VALID_EDGES = {
    "player 1 char": {"player": "x"},
    "player 50 chars": {"player": "x" * 50},
    "player 50 Hebrew chars": {"player": "א" * 50},
    "x is 0": {"x": 0},
    "x is 50": {"x": 50},
    "y is 0": {"y": 0},
    "y is 47": {"y": 47},
    "note 200 chars": {"note": "n" * 200},
    "note cleared": {"note": ""},
    "game_date in the past": {"game_date": "2000-01-01"},
}


@pytest.mark.parametrize("change", VALID_EDGES.values(), ids=VALID_EDGES.keys())
def test_limits_are_inclusive(client, change):
    r = client.post("/shots", json={**SHOT, **change})
    assert r.status_code == status.HTTP_201_CREATED
    for key, value in change.items():
        assert r.json()[key] == value


def test_game_date_allows_one_day_of_slack_for_time_zones(client):
    # The server may be a day behind the player (UTC versus Israel).
    today = date.today()
    tomorrow = {**SHOT, "game_date": (today + timedelta(days=1)).isoformat()}
    too_far = {**SHOT, "game_date": (today + timedelta(days=2)).isoformat()}
    assert client.post("/shots", json=tomorrow).status_code == status.HTTP_201_CREATED
    assert client.post("/shots", json=too_far).status_code == 422


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


def test_list_offset_0_is_accepted(client):
    client.post("/shots", json=SHOT)
    r = client.get("/shots", params={"offset": 0})
    assert r.status_code == status.HTTP_200_OK
    assert len(r.json()) == 1


def test_list_default_page_is_50_shots(client):
    for _ in range(51):
        client.post("/shots", json=SHOT)
    assert len(client.get("/shots").json()) == 50


def test_list_limit_100_is_accepted(client):
    client.post("/shots", json=SHOT)
    r = client.get("/shots", params={"limit": 100})
    assert r.status_code == status.HTTP_200_OK
    assert len(r.json()) == 1


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


@pytest.mark.parametrize("change", INVALID_VALUES.values(), ids=INVALID_VALUES.keys())
def test_patch_invalid_values_are_422_and_change_nothing(client, change):
    created = client.post("/shots", json=SHOT).json()
    r = client.patch(f"/shots/{created['id']}", json=change)
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert client.get(f"/shots/{created['id']}").json() == created


@pytest.mark.parametrize("field", ["chef", "zone", "shot_type", "id"])
def test_patch_rejects_unknown_and_computed_fields(client, field):
    sid = client.post("/shots", json=SHOT).json()["id"]
    r = client.patch(f"/shots/{sid}", json={field: "top_3"})
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert r.json()["detail"][0]["type"] == "extra_forbidden"


@pytest.mark.parametrize("change", VALID_EDGES.values(), ids=VALID_EDGES.keys())
def test_patch_limits_are_inclusive(client, change):
    sid = client.post("/shots", json=SHOT).json()["id"]
    r = client.patch(f"/shots/{sid}", json=change)
    assert r.status_code == status.HTTP_200_OK
    for key, value in change.items():
        assert r.json()[key] == value


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


def test_ids_are_not_reused_after_a_delete(client):
    first = client.post("/shots", json=SHOT).json()["id"]
    client.delete(f"/shots/{first}")
    second = client.post("/shots", json=SHOT).json()["id"]
    assert second != first
    assert client.get(f"/shots/{first}").status_code == 404  # no stale record either


@pytest.mark.parametrize(
    ("shot_id", "expected"),
    [
        (2**63 - 1, status.HTTP_404_NOT_FOUND),  # largest id SQLite can hold
        (2**63, status.HTTP_422_UNPROCESSABLE_CONTENT),
        (-(2**63), status.HTTP_404_NOT_FOUND),
        (-(2**63) - 1, status.HTTP_422_UNPROCESSABLE_CONTENT),
    ],
)
def test_ids_at_the_edge_of_what_sqlite_holds(client, shot_id, expected):
    # Before the bound existed these were a 500 (OverflowError inside SQLite).
    assert client.get(f"/shots/{shot_id}").status_code == expected


def test_offset_at_the_edge_of_what_sqlite_holds(client):
    ok = client.get("/shots", params={"offset": 2**63 - 1})
    assert (ok.status_code, ok.json()) == (status.HTTP_200_OK, [])
    too_big = client.get("/shots", params={"offset": 2**63})
    assert too_big.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.parametrize(
    "text", [chr(0xD800), chr(0xDFFF), chr(0xFFFE), chr(0xFFFF), "a\x00b"]
)
def test_text_that_cannot_be_stored_or_drawn_is_422(client, text):
    # Each of these used to be a 500 or a chart that was no longer valid XML.
    for field in ("player", "note"):
        # json.dumps escapes a lone surrogate as \\ud800, which is how a client would
        # send it; httpx's json= would refuse to encode it at all.
        body = json.dumps({**SHOT, field: text})
        r = client.post(
            "/shots", content=body, headers={"content-type": "application/json"}
        )
        assert r.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT, (field, text)


def test_tab_and_newline_are_allowed_in_a_note(client):
    r = client.post("/shots", json={**SHOT, "note": "line one\nline\ttwo"})
    assert r.status_code == status.HTTP_201_CREATED
