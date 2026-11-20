"""POST /notes/extract: the backend asks the AI service to read pasted notes.

The AI service is replaced by `fake_ai`, so nothing here touches the network or a model.
"""

import json
from copy import deepcopy
from datetime import date, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import DEFAULT_RATE_LIMIT as RATE_LIMIT
from app.ai import notes_limiter

GOOD = {
    "proposals": [
        {
            "x": 47.5,
            "y": 3.0,
            "made": True,
            "game_date": "2026-11-19",
            "note": "caught and shot",
            "quote": "hit one from the right corner",
        }
    ],
    "questions": ["Which day?"],
    "skipped": ["2 free throws"],
    "model": "groq:test",
}
BODY = {"text": "hit one from the right corner, 2 free throws", "today": "2026-11-20"}
SECRET_BODY = "boom: sk-secret-key and internal stack trace"


def answer(payload=GOOD, status=200):
    return lambda request: httpx.Response(status, json=payload)


def post(client: TestClient, body=BODY):
    return client.post("/notes/extract", json=body)


# --- the happy path ---


def test_proposals_come_back_with_the_backends_own_zone_and_shot_type(client, fake_ai):
    fake_ai(answer())
    response = post(client)
    assert response.status_code == 200
    data = response.json()
    shot = data["proposals"][0]
    assert (shot["x"], shot["y"], shot["made"]) == (47.5, 3.0, True)
    assert shot["game_date"] == "2026-11-19"
    assert shot["note"] == "caught and shot"
    assert shot["quote"] == "hit one from the right corner"
    # Computed here, by the same rules as every stored shot, not taken from the AI.
    assert shot["zone"] == "right_corner_3"
    assert shot["shot_type"] == "3PT"
    assert data["questions"] == ["Which day?"]
    assert data["skipped"] == ["2 free throws"]
    assert data["model"] == "groq:test"


def test_the_ai_service_gets_the_text_and_the_players_today(client, fake_ai):
    seen = fake_ai(answer())
    post(client, {"text": "  hit one  ", "today": "2026-11-20"})
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "POST"
    assert str(request.url) == "http://localhost:8001/extract"
    assert json.loads(request.content) == {"text": "hit one", "today": "2026-11-20"}
    assert "x-service-token" not in request.headers


def test_without_a_date_none_is_sent(client, fake_ai):
    seen = fake_ai(answer())
    post(client, {"text": "hit one"})
    assert json.loads(seen[0].content) == {"text": "hit one"}


def test_the_address_and_token_come_from_the_environment(client, fake_ai, monkeypatch):
    monkeypatch.setenv("AI_SERVICE_URL", "https://ai.example.test/")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "s3cret")
    seen = fake_ai(answer())
    post(client)
    assert str(seen[0].url) == "https://ai.example.test/extract"
    assert seen[0].headers["x-service-token"] == "s3cret"


def test_nothing_is_saved(client, fake_ai):
    fake_ai(answer())
    before = client.get("/shots").json()
    assert post(client).status_code == 200
    assert client.get("/shots").json() == before


def test_an_answer_with_nothing_to_propose_is_fine(client, fake_ai):
    empty = {"proposals": [], "questions": ["Where?"], "skipped": [], "model": "m"}
    fake_ai(answer(empty))
    assert post(client).json()["proposals"] == []


# --- the AI service is down or slow: the rest of the app must not notice ---


def test_normal_shots_still_work_when_the_ai_service_is_down(client, fake_ai):
    def down(request):
        raise httpx.ConnectError("refused")

    fake_ai(down)
    assert post(client).status_code == 503
    created = client.post(
        "/shots", json={"player": "Yuly", "x": 25, "y": 6, "made": True}
    )
    assert created.status_code == 201
    assert client.get("/shots").status_code == 200


@pytest.mark.parametrize(
    ("error", "status", "words"),
    [
        (httpx.ConnectError("refused"), 503, "not available"),
        (httpx.ConnectTimeout("no route"), 503, "not available"),
        (httpx.ReadTimeout("slow"), 504, "took too long"),
        (httpx.WriteTimeout("slow"), 504, "took too long"),
        (httpx.RemoteProtocolError("garbage"), 502, "usable answer"),
        (httpx.ReadError("reset"), 502, "usable answer"),
    ],
)
def test_network_trouble_becomes_a_plain_sentence(
    client, fake_ai, error, status, words
):
    def broken(request):
        raise error

    fake_ai(broken)
    response = post(client)
    assert response.status_code == status
    assert words in response.json()["detail"]


@pytest.mark.parametrize(
    ("ai_status", "status", "words"),
    [
        (429, 429, "busy"),
        (503, 503, "not available"),
        (504, 504, "took too long"),
        (401, 502, "usable answer"),
        (422, 502, "usable answer"),
        (500, 502, "usable answer"),
        (502, 502, "usable answer"),
        (404, 502, "usable answer"),
    ],
)
def test_the_ai_services_errors_are_translated_and_never_leaked(
    client, fake_ai, ai_status, status, words
):
    fake_ai(lambda request: httpx.Response(ai_status, text=SECRET_BODY))
    response = post(client)
    assert response.status_code == status
    assert words in response.json()["detail"]
    assert "sk-secret" not in response.text
    assert "stack trace" not in response.text


# --- never trust another program's answer ---


def broken_answer(**changes):
    data = deepcopy(GOOD)
    data.update(changes)
    return data


def with_shot(**changes):
    data = deepcopy(GOOD)
    data["proposals"][0].update(changes)
    return data


tomorrow = (date.today() + timedelta(days=1)).isoformat()
too_far = (date.today() + timedelta(days=2)).isoformat()


@pytest.mark.parametrize(
    "payload",
    [
        with_shot(x=50.5),
        with_shot(x=-0.5),
        with_shot(y=47.5),
        with_shot(y=-1),
        with_shot(made="maybe"),
        with_shot(game_date=too_far),
        with_shot(game_date="not a date"),
        with_shot(note="x" * 201),
        with_shot(note="bell\x07"),
        with_shot(quote="x" * 201),
        with_shot(quote="bell\x07"),
        broken_answer(proposals="none"),
        broken_answer(proposals=[GOOD["proposals"][0]] * 21),
        broken_answer(questions=["q"] * 6),
        broken_answer(questions=["x" * 201]),
        broken_answer(skipped=["s"] * 11),
        broken_answer(skipped=["bell\x07"]),
        broken_answer(model="m" * 101),
        {k: v for k, v in GOOD.items() if k != "model"},
        {k: v for k, v in GOOD.items() if k != "proposals"},
        ["not", "an", "object"],
    ],
)
def test_an_answer_that_breaks_the_backends_rules_is_refused(client, fake_ai, payload):
    fake_ai(answer(payload))
    response = post(client)
    assert response.status_code == 502
    assert "usable answer" in response.json()["detail"]


def test_an_answer_that_is_not_json_is_refused(client, fake_ai):
    fake_ai(lambda request: httpx.Response(200, text="<html>proxy error</html>"))
    assert post(client).status_code == 502


@pytest.mark.parametrize(
    "payload",
    [
        with_shot(x=0, y=0),
        with_shot(x=50, y=47),
        with_shot(game_date=tomorrow),
        with_shot(note="x" * 200, quote="x" * 200),
        broken_answer(proposals=[GOOD["proposals"][0]] * 20),
        broken_answer(questions=["q"] * 5, skipped=["s"] * 10),
        broken_answer(model="m" * 100),
    ],
)
def test_answers_exactly_at_the_limits_are_accepted(client, fake_ai, payload):
    fake_ai(answer(payload))
    assert post(client).status_code == 200


# --- what the browser may send ---


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"text": ""},
        {"text": "   "},
        {"text": "x" * 2001},
        {"text": "ok", "today": "not a date"},
        {"text": "ok", "player": "Yuly"},
        {"text": "bell\x07"},
        {"text": 5},
    ],
)
def test_bad_requests_are_422_and_never_reach_the_ai_service(client, fake_ai, body):
    seen = fake_ai(answer())
    assert post(client, body).status_code == 422
    assert seen == []


def test_a_single_character_is_enough_text(client, fake_ai):
    seen = fake_ai(answer())
    assert post(client, {"text": "x"}).status_code == 200
    assert json.loads(seen[0].content)["text"] == "x"


def test_only_the_first_200_characters_of_an_error_body_are_logged(
    client, fake_ai, caplog
):
    fake_ai(lambda request: httpx.Response(500, text="a" * 300))
    with caplog.at_level("ERROR", logger="app.routers.notes"):
        assert post(client).status_code == 502
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "a" * 200 in logged
    assert "a" * 201 not in logged


def test_text_of_exactly_2000_characters_is_accepted(client, fake_ai):
    seen = fake_ai(answer())
    assert post(client, {"text": "x" * 2000}).status_code == 200
    assert len(json.loads(seen[0].content)["text"]) == 2000


def test_the_body_must_be_json(client, fake_ai):
    fake_ai(answer())
    response = client.post(
        "/notes/extract", content="hit one", headers={"Content-Type": "text/plain"}
    )
    assert response.status_code == 422


# --- the request limit ---


def test_the_eleventh_request_in_a_minute_is_refused_without_calling_the_ai(
    client, fake_ai
):
    seen = fake_ai(answer())
    codes = [post(client).status_code for _ in range(RATE_LIMIT + 1)]
    assert codes == [200] * RATE_LIMIT + [429]
    assert len(seen) == RATE_LIMIT
    last = post(client)
    assert "Too many requests" in last.json()["detail"]


def test_requests_that_fail_validation_do_not_use_up_the_minute(client, fake_ai):
    seen = fake_ai(answer())
    codes = [post(client, {"text": ""}).status_code for _ in range(RATE_LIMIT + 5)]
    assert codes == [422] * (RATE_LIMIT + 5)
    assert post(client).status_code == 200  # the whole minute is still there
    assert len(seen) == 1


def test_ai_rate_limit_is_read_when_a_request_arrives(client, fake_ai, monkeypatch):
    fake_ai(answer())
    monkeypatch.setenv("AI_RATE_LIMIT", "2")
    assert [post(client).status_code for _ in range(3)] == [200, 200, 429]


def test_a_minute_later_requests_are_allowed_again(client, fake_ai, monkeypatch):
    fake_ai(answer())
    now = [1000.0]
    monkeypatch.setattr(notes_limiter, "clock", lambda: now[0])
    assert [post(client).status_code for _ in range(RATE_LIMIT + 1)][-1] == 429
    now[0] += 60.0
    assert post(client).status_code == 200


def test_the_limit_only_covers_the_ai_endpoint(client, fake_ai):
    fake_ai(answer())
    for _ in range(RATE_LIMIT + 1):
        post(client)
    assert client.get("/shots").status_code == 200
    assert client.get("/health").status_code == 200


# --- a reply that is too big ---


def test_a_reply_over_the_size_cap_is_refused(client, fake_ai):
    from app.ai import MAX_REPLY_BYTES

    huge = {**GOOD, "skipped": ["x" * 150] * 10, "padding": "p" * MAX_REPLY_BYTES}
    fake_ai(answer(huge))
    response = post(client)
    assert response.status_code == 502
    assert "usable answer" in response.json()["detail"]


def test_a_reply_just_under_the_size_cap_is_still_read(client, fake_ai):
    from app.ai import MAX_REPLY_BYTES

    body = json.dumps({**GOOD, "padding": ""})
    padding = "p" * (MAX_REPLY_BYTES - len(body))
    exact = json.dumps({**GOOD, "padding": padding})
    assert len(exact) == MAX_REPLY_BYTES
    fake_ai(lambda request: httpx.Response(200, content=exact))
    assert post(client).status_code == 200


def test_one_byte_over_the_cap_is_refused_even_when_it_arrives_in_pieces(
    client, fake_ai
):
    from app.ai import MAX_REPLY_BYTES

    valid = json.dumps(GOOD)
    # Valid JSON padded with spaces to exactly one byte over the cap, sent in two
    # pieces: cutting it at the cap would still leave a valid answer, so only a real
    # size check refuses it.
    body = (valid + " " * (MAX_REPLY_BYTES + 1 - len(valid))).encode()
    assert len(body) == MAX_REPLY_BYTES + 1

    async def pieces():
        yield body[:MAX_REPLY_BYTES]
        yield body[MAX_REPLY_BYTES:]

    fake_ai(lambda request: httpx.Response(200, content=pieces()))
    assert post(client).status_code == 502


def test_the_error_log_shows_only_the_start_of_a_multibyte_body(
    client, fake_ai, caplog
):
    fake_ai(lambda request: httpx.Response(500, content=("\u05e9" * 300).encode()))
    with caplog.at_level("ERROR", logger="app.routers.notes"):
        assert post(client).status_code == 502
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "\u05e9" * 200 in logged
    assert "\u05e9" * 201 not in logged


# --- it is documented ---


def test_the_endpoint_is_in_the_openapi_document(client):
    spec = client.get("/openapi.json").json()
    operation = spec["paths"]["/notes/extract"]["post"]
    assert set(operation["responses"]) >= {"200", "422", "429", "502", "503", "504"}
