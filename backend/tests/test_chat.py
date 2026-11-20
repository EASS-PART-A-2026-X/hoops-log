"""POST /chat: the backend asks the AI service for Deni's reply. GET /chat/status.

The AI service is replaced by `fake_ai`, so nothing here touches the network or a model.
"""

import json
from copy import deepcopy
from datetime import date, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import DEFAULT_RATE_LIMIT as RATE_LIMIT
from app.ai import MAX_REPLY_BYTES, STATUS_TTL_SECONDS, notes_limiter, status_cache

SHOT = {
    "x": 47.5,
    "y": 3.0,
    "made": True,
    "game_date": "2026-11-19",
    "note": "caught and shot",
    "quote": "hit one from the right corner",
}
GOOD = {
    "reply": "Got it: one made three from the right corner. Tap Save to log it.",
    "proposals": [SHOT],
    "model": "groq:test",
}
TURN = {"role": "user", "text": "hit one from the right corner, 2 free throws"}
BODY = {"messages": [TURN], "today": "2026-11-20"}
ZONE = {
    "zone": "right_corner_3",
    "attempts": 6,
    "made": 3,
    "pct": 50.0,
    "nba_pct": 38.0,
}
STATS = {
    "player": "Yuly",
    "attempts": 40,
    "made": 18,
    "fg_pct": 45.0,
    "three_attempts": 12,
    "three_made": 4,
    "three_pct": 33.3,
    "zones": [ZONE],
    "nba_fg": 46.0,
    "nba_three": 36.0,
}
SECRET_BODY = "boom: sk-secret-key and internal stack trace"


def answer(payload=GOOD, status=200):
    return lambda request: httpx.Response(status, json=payload)


def post(client: TestClient, body=BODY):
    return client.post("/chat", json=body)


# --- the happy path ---


def test_proposals_come_back_with_the_backends_own_zone_and_shot_type(client, fake_ai):
    fake_ai(answer())
    response = post(client)
    assert response.status_code == 200
    data = response.json()
    assert data["reply"] == GOOD["reply"]
    shot = data["proposals"][0]
    assert (shot["x"], shot["y"], shot["made"]) == (47.5, 3.0, True)
    assert shot["game_date"] == "2026-11-19"
    assert shot["note"] == "caught and shot"
    assert shot["quote"] == "hit one from the right corner"
    # Computed here, by the same rules as every stored shot, not taken from the AI.
    assert shot["zone"] == "right_corner_3"
    assert shot["shot_type"] == "3PT"
    assert data["model"] == "groq:test"


def test_a_reply_with_no_proposals_is_fine(client, fake_ai):
    fake_ai(answer({"reply": "You shoot 45%.", "proposals": [], "model": "m"}))
    data = post(client).json()
    assert data["reply"] == "You shoot 45%."
    assert data["proposals"] == []


def test_the_ai_service_gets_the_conversation_the_stats_and_the_players_today(
    client, fake_ai
):
    seen = fake_ai(answer())
    turns = [
        {"role": "user", "text": "  how am I doing?  "},
        {"role": "deni", "text": "Fine so far."},
        {"role": "user", "text": "and from three?"},
    ]
    post(client, {"messages": turns, "stats": STATS, "today": "2026-11-20"})
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "POST"
    assert str(request.url) == "http://localhost:8001/chat"
    assert json.loads(request.content) == {
        "messages": [{**turns[0], "text": "how am I doing?"}, turns[1], turns[2]],
        "stats": STATS,
        "today": "2026-11-20",
    }
    assert "x-service-token" not in request.headers


def test_without_stats_or_a_date_neither_is_sent(client, fake_ai):
    seen = fake_ai(answer())
    post(client, {"messages": [TURN]})
    assert json.loads(seen[0].content) == {"messages": [TURN]}


def test_the_address_and_token_come_from_the_environment(client, fake_ai, monkeypatch):
    monkeypatch.setenv("AI_SERVICE_URL", "https://ai.example.test/")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "s3cret")
    seen = fake_ai(answer())
    post(client)
    assert str(seen[0].url) == "https://ai.example.test/chat"
    assert seen[0].headers["x-service-token"] == "s3cret"


def test_nothing_is_saved(client, fake_ai):
    fake_ai(answer())
    before = client.get("/shots").json()
    assert post(client).status_code == 200
    assert client.get("/shots").json() == before


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
        broken_answer(proposals=[SHOT] * 21),
        broken_answer(reply=""),
        broken_answer(reply="x" * 1501),
        broken_answer(reply="bell\x07"),
        broken_answer(reply=5),
        broken_answer(model="m" * 101),
        {k: v for k, v in GOOD.items() if k != "model"},
        {k: v for k, v in GOOD.items() if k != "reply"},
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
        broken_answer(proposals=[SHOT] * 20),
        broken_answer(reply="r" * 1500),
        broken_answer(reply="r"),
        broken_answer(model="m" * 100),
    ],
)
def test_answers_exactly_at_the_limits_are_accepted(client, fake_ai, payload):
    fake_ai(answer(payload))
    assert post(client).status_code == 200


# --- what the browser may send ---


def msgs(n, last="user"):
    turns = [
        {"role": "user" if i % 2 == 0 else "deni", "text": f"m{i}"} for i in range(n)
    ]
    turns[-1]["role"] = last
    return turns


def zone(**over):
    return {**ZONE, **over}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"messages": []},
        {"messages": msgs(13)},
        {"messages": msgs(2, last="deni")},  # the last one must be the player's
        {"messages": [{"role": "system", "text": "hi"}]},
        {"messages": [{"role": "user", "text": ""}]},
        {"messages": [{"role": "user", "text": "   "}]},
        {"messages": [{"role": "user", "text": "x" * 2001}]},
        {"messages": [{"role": "user", "text": "bell\x07"}]},
        {"messages": [{"role": "user", "text": 5}]},
        {"messages": [{"role": "user", "text": "hi", "extra": 1}]},
        {"messages": [TURN], "player": "Yuly"},
        {"messages": [TURN], "today": "not a date"},
        {"messages": "hello"},
        {"text": "the old notes format"},
        {"messages": [TURN], "stats": {**STATS, "made": 41}},
        {"messages": [TURN], "stats": {**STATS, "three_made": 13}},
        {"messages": [TURN], "stats": {**STATS, "three_attempts": 41}},
        {"messages": [TURN], "stats": {**STATS, "fg_pct": 100.5}},
        {"messages": [TURN], "stats": {**STATS, "nba_fg": -1}},
        {"messages": [TURN], "stats": {**STATS, "attempts": -1}},
        {"messages": [TURN], "stats": {**STATS, "zones": [ZONE] * 13}},
        {"messages": [TURN], "stats": {**STATS, "zones": [zone(made=7)]}},
        {"messages": [TURN], "stats": {**STATS, "zones": [zone(zone="Right Corner")]}},
        {"messages": [TURN], "stats": {**STATS, "zones": [zone(zone="")]}},
        {"messages": [TURN], "stats": {**STATS, "zones": [zone(nba_pct=101)]}},
        {"messages": [TURN], "stats": {**STATS, "player": "x" * 51}},
        {"messages": [TURN], "stats": {**STATS, "extra": 1}},
        {
            "messages": [TURN],
            "stats": {k: v for k, v in STATS.items() if k != "nba_three"},
        },
    ],
)
def test_bad_requests_are_422_and_never_reach_the_ai_service(client, fake_ai, body):
    seen = fake_ai(answer())
    assert post(client, body).status_code == 422
    assert seen == []


def test_twelve_messages_are_accepted(client, fake_ai):
    seen = fake_ai(answer())
    assert post(client, {"messages": msgs(12)}).status_code == 200
    assert len(json.loads(seen[0].content)["messages"]) == 12


def test_a_single_character_is_enough_text(client, fake_ai):
    seen = fake_ai(answer())
    assert (
        post(client, {"messages": [{"role": "user", "text": "x"}]}).status_code == 200
    )
    assert json.loads(seen[0].content)["messages"][0]["text"] == "x"


def test_a_message_of_exactly_2000_characters_is_accepted(client, fake_ai):
    seen = fake_ai(answer())
    body = {"messages": [{"role": "user", "text": "x" * 2000}]}
    assert post(client, body).status_code == 200
    assert len(json.loads(seen[0].content)["messages"][0]["text"]) == 2000


def test_stats_at_the_limits_are_accepted(client, fake_ai):
    fake_ai(answer())
    stats = {
        **STATS,
        "player": "p" * 50,
        "made": 40,
        "fg_pct": 100.0,
        "three_attempts": 40,
        "three_made": 40,
        "zones": [zone(zone=f"z{i}") for i in range(12)],
    }
    assert post(client, {"messages": [TURN], "stats": stats}).status_code == 200


def test_stats_numbers_exactly_at_their_edges_are_accepted(client, fake_ai):
    fake_ai(answer())
    zeros = {
        **STATS,
        "attempts": 0,
        "made": 0,
        "fg_pct": 0.0,
        "three_attempts": 0,
        "three_made": 0,
        "three_pct": 0.0,
        "nba_fg": 0.0,
        "nba_three": 0.0,
        "zones": [zone(attempts=0, made=0, pct=0.0, nba_pct=0.0)],
    }
    biggest = {
        **STATS,
        "attempts": 1_000_000,
        "made": 1_000_000,
        "three_attempts": 1_000_000,
        "three_made": 1_000_000,
        "zones": [
            zone(attempts=1_000_000, made=1_000_000),
            zone(zone="z"),
            zone(zone="z" * 40),
        ],
    }
    for stats in (zeros, biggest):
        assert post(client, {"messages": [TURN], "stats": stats}).status_code == 200


@pytest.mark.parametrize(
    "stats",
    [
        {**STATS, "attempts": 1_000_001},
        {**STATS, "zones": [zone(attempts=1_000_001)]},
        {**STATS, "zones": [zone(zone="z" * 41)]},
        {**STATS, "nba_three": 100.1},
    ],
)
def test_stats_just_past_their_edges_are_refused(client, fake_ai, stats):
    seen = fake_ai(answer())
    assert post(client, {"messages": [TURN], "stats": stats}).status_code == 422
    assert seen == []


def test_stats_of_an_empty_log_are_accepted(client, fake_ai):
    fake_ai(answer())
    empty = {
        **STATS,
        "attempts": 0,
        "made": 0,
        "fg_pct": None,
        "three_attempts": 0,
        "three_made": 0,
        "three_pct": None,
        "zones": [],
    }
    assert post(client, {"messages": [TURN], "stats": empty}).status_code == 200


def test_only_the_first_200_characters_of_an_error_body_are_logged(
    client, fake_ai, caplog
):
    fake_ai(lambda request: httpx.Response(500, text="a" * 300))
    with caplog.at_level("ERROR", logger="app.routers.chat"):
        assert post(client).status_code == 502
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "a" * 200 in logged
    assert "a" * 201 not in logged


def test_the_body_must_be_json(client, fake_ai):
    fake_ai(answer())
    response = client.post(
        "/chat", content="hit one", headers={"Content-Type": "text/plain"}
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
    assert "Too many requests" in post(client).json()["detail"]


def test_requests_that_fail_validation_do_not_use_up_the_minute(client, fake_ai):
    seen = fake_ai(answer())
    codes = [post(client, {"messages": []}).status_code for _ in range(RATE_LIMIT + 5)]
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


def test_the_limit_only_covers_the_chat_endpoint(client, fake_ai):
    fake_ai(answer())
    for _ in range(RATE_LIMIT + 1):
        post(client)
    assert client.get("/shots").status_code == 200
    assert client.get("/health").status_code == 200
    assert client.get("/chat/status").status_code == 200


# --- a reply that is too big ---


def test_a_reply_over_the_size_cap_is_refused(client, fake_ai):
    huge = {**GOOD, "padding": "p" * MAX_REPLY_BYTES}
    fake_ai(answer(huge))
    response = post(client)
    assert response.status_code == 502
    assert "usable answer" in response.json()["detail"]


def test_a_reply_just_under_the_size_cap_is_still_read(client, fake_ai):
    body = json.dumps({**GOOD, "padding": ""})
    padding = "p" * (MAX_REPLY_BYTES - len(body))
    exact = json.dumps({**GOOD, "padding": padding})
    assert len(exact) == MAX_REPLY_BYTES
    fake_ai(lambda request: httpx.Response(200, content=exact))
    assert post(client).status_code == 200


def test_one_byte_over_the_cap_is_refused_when_it_arrives_in_pieces(client, fake_ai):
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
    fake_ai(lambda request: httpx.Response(500, content=("ש" * 300).encode()))
    with caplog.at_level("ERROR", logger="app.routers.chat"):
        assert post(client).status_code == 502
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "ש" * 200 in logged
    assert "ש" * 201 not in logged


# --- GET /chat/status: is the AI helper there? ---


def health(payload, status=200):
    return lambda request: httpx.Response(status, json=payload)


def test_the_helper_is_available_when_it_answers_and_has_a_model(client, fake_ai):
    seen = fake_ai(health({"status": "ok", "model": "groq:openai/gpt-oss-120b"}))
    assert client.get("/chat/status").json() == {"available": True}
    assert str(seen[0].url) == "http://localhost:8001/health"
    assert seen[0].method == "GET"


@pytest.mark.parametrize(
    "handler",
    [
        health({"status": "ok", "model": None}),  # up, but no model set
        health({"status": "ok"}),
        health({"status": "ok", "model": ""}),
        health(["not", "an", "object"]),
        health("text"),
        health({"status": "ok", "model": "m"}, status=500),
        health({"status": "ok", "model": "m"}, status=503),
        lambda request: httpx.Response(200, text="<html>proxy error</html>"),
    ],
)
def test_the_helper_is_not_available_without_a_model_or_a_good_answer(
    client, fake_ai, handler
):
    fake_ai(handler)
    response = client.get("/chat/status")
    assert response.status_code == 200
    assert response.json() == {"available": False}


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("refused"),
        httpx.ConnectTimeout("t"),
        httpx.ReadTimeout("t"),
        httpx.RemoteProtocolError("p"),
    ],
)
def test_a_dead_ai_service_is_unavailable_not_an_error(client, fake_ai, error):
    def broken(request):
        raise error

    fake_ai(broken)
    response = client.get("/chat/status")
    assert response.status_code == 200
    assert response.json() == {"available": False}


def test_status_does_not_wait_longer_than_a_few_seconds(client, fake_ai):
    seen = fake_ai(health({"status": "ok", "model": "m"}))
    client.get("/chat/status")
    assert seen[0].extensions["timeout"]["read"] == 3.0


def test_status_is_remembered_for_a_few_seconds(client, fake_ai, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(status_cache, "clock", lambda: now[0])
    seen = fake_ai(health({"status": "ok", "model": "m"}))
    assert client.get("/chat/status").json() == {"available": True}
    now[0] += STATUS_TTL_SECONDS - 0.1
    assert client.get("/chat/status").json() == {"available": True}
    assert len(seen) == 1  # the second answer came from memory
    now[0] += 0.1  # now it is exactly as old as the memory allows
    assert client.get("/chat/status").json() == {"available": True}
    assert len(seen) == 2


def test_a_remembered_no_is_remembered_too_and_then_recovers(
    client, fake_ai, monkeypatch
):
    now = [1000.0]
    monkeypatch.setattr(status_cache, "clock", lambda: now[0])
    up = [False]

    def handler(request):
        return httpx.Response(
            200, json={"status": "ok", "model": "m" if up[0] else None}
        )

    seen = fake_ai(handler)
    assert client.get("/chat/status").json() == {"available": False}
    up[0] = True
    assert client.get("/chat/status").json() == {"available": False}  # from memory
    assert len(seen) == 1
    now[0] += STATUS_TTL_SECONDS
    assert client.get("/chat/status").json() == {"available": True}


def test_status_leaks_nothing_and_does_not_use_the_request_limit(client, fake_ai):
    def by_path(request):
        if request.url.path == "/health":
            return httpx.Response(
                200, json={"status": "ok", "model": "groq:secret-model-name"}
            )
        return httpx.Response(200, json=GOOD)

    fake_ai(by_path)
    for _ in range(RATE_LIMIT + 5):
        response = client.get("/chat/status")
        assert response.status_code == 200
        assert "secret-model-name" not in response.text
    assert post(client).status_code == 200  # the chat's own minute is untouched


# --- it is documented ---


def test_the_endpoints_are_in_the_openapi_document(client):
    spec = client.get("/openapi.json").json()
    operation = spec["paths"]["/chat"]["post"]
    assert set(operation["responses"]) >= {"200", "422", "429", "502", "503", "504"}
    assert "get" in spec["paths"]["/chat/status"]
    assert "/notes/extract" not in spec["paths"]
