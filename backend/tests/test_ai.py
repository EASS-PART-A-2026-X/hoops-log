"""The pieces the notes endpoint is built from: settings, the HTTP client, the limit."""

import asyncio

import httpx
import pytest

from app.ai import (
    CONNECT_TIMEOUT_SECONDS,
    DEFAULT_RATE_LIMIT,
    DEFAULT_URL,
    MAX_REPLY_BYTES,
    RATE_WINDOW_SECONDS,
    READ_TIMEOUT_SECONDS,
    RateLimiter,
    ai_headers,
    ai_url,
    get_ai_client,
    rate_limit_from_env,
)


def test_the_ai_service_defaults_to_localhost_8001():
    assert DEFAULT_URL == "http://localhost:8001"
    assert ai_url() == "http://localhost:8001"


def test_the_url_comes_from_the_environment_without_a_trailing_slash(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_URL", "https://ai.example.test///")
    assert ai_url() == "https://ai.example.test"


def test_no_token_means_no_header(monkeypatch):
    assert ai_headers() == {}
    monkeypatch.setenv("AI_SERVICE_TOKEN", "")
    assert ai_headers() == {}


def test_a_token_is_sent_as_x_service_token(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "s3cret")
    assert ai_headers() == {"X-Service-Token": "s3cret"}


def test_the_client_waits_for_the_model_but_not_for_a_dead_connection():
    async def timeouts() -> httpx.Timeout:
        agen = get_ai_client()
        client = await anext(agen)
        timeout = client.timeout
        await agen.aclose()
        return timeout

    timeout = asyncio.run(timeouts())
    assert (timeout.read, timeout.connect) == (70.0, 5.0)
    assert (READ_TIMEOUT_SECONDS, CONNECT_TIMEOUT_SECONDS) == (70.0, 5.0)


def test_the_limit_is_ten_requests_a_minute_unless_set():
    assert (DEFAULT_RATE_LIMIT, RATE_WINDOW_SECONDS) == (10, 60.0)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("25", 25),
        ("1", 1),
        ("1000", 1000),
        ("0", 10),
        ("-3", 10),
        ("", 10),
        ("abc", 10),
        ("2.5", 10),
        ("\u00b2", 10),
        (" 7", 10),
    ],
)
def test_the_limit_can_be_set_and_nonsense_means_the_default(
    monkeypatch, raw, expected
):
    monkeypatch.setenv("AI_RATE_LIMIT", raw)
    assert rate_limit_from_env() == expected


def test_no_setting_means_the_default(monkeypatch):
    monkeypatch.delenv("AI_RATE_LIMIT", raising=False)
    assert rate_limit_from_env() == 10


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_the_limiter_allows_exactly_its_limit_then_refuses():
    limiter = RateLimiter(3, 60.0, Clock())
    assert [limiter.allow() for _ in range(5)] == [True, True, True, False, False]


def test_a_call_frees_its_place_after_exactly_one_window():
    clock = Clock()
    limiter = RateLimiter(2, 60.0, clock)
    assert limiter.allow()  # at 1000
    clock.now = 1030.0
    assert limiter.allow()  # at 1030
    assert not limiter.allow()
    clock.now = 1059.9  # the first call is still inside the window
    assert not limiter.allow()
    clock.now = 1060.0  # exactly one window later: the first call has aged out
    assert limiter.allow()
    assert not limiter.allow()


def test_reset_forgets_every_call():
    limiter = RateLimiter(1, 60.0, Clock())
    assert limiter.allow()
    assert not limiter.allow()
    limiter.reset()
    assert limiter.allow()


@pytest.mark.parametrize("limit", [1, 4])
def test_limiters_do_not_share_state(limit):
    first, second = RateLimiter(limit, 60.0, Clock()), RateLimiter(limit, 60.0, Clock())
    for _ in range(limit):
        assert first.allow()
    assert not first.allow()
    assert second.allow()


def test_a_limiter_asks_for_its_limit_on_every_call():
    clock = Clock()
    limit = [1]
    limiter = RateLimiter(lambda: limit[0], 60.0, clock)
    assert limiter.allow()
    assert not limiter.allow()
    limit[0] = 3  # raised without recreating the limiter
    assert limiter.allow()
    assert limiter.allow()
    assert not limiter.allow()
    limit[0] = 1  # lowered again: the calls already made still count
    assert not limiter.allow()


def test_the_chat_limiter_follows_ai_rate_limit_without_a_restart(monkeypatch):
    from app.ai import chat_limiter

    monkeypatch.setenv("AI_RATE_LIMIT", "2")
    assert [chat_limiter.allow() for _ in range(3)] == [True, True, False]
    monkeypatch.setenv("AI_RATE_LIMIT", "4")
    assert [chat_limiter.allow() for _ in range(3)] == [True, True, False]


def test_the_reply_size_cap_is_generous_for_a_real_answer_but_finite():
    # 20 shots of ~600 characters each is ~12 KB: far below the cap.
    assert 100_000 <= MAX_REPLY_BYTES <= 1_000_000
