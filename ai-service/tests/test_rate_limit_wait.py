"""When the provider says "try again in 3 s", the service waits once and asks again.

The provider's free tier limits tokens per minute, and a short burst of messages used
to end in an error that the provider itself said would be gone in a few seconds. These
tests use scripted fake models and a fake sleep: nothing really waits and no model is
called.
"""

import asyncio

import pytest
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.exceptions import ModelQuotaExceededError, ModelRateLimitError
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.routers import chat as chat_router

GOOD = {"reply": "Got it: one shot. Tap Save to log it.", "proposals": []}
BODY = {
    "messages": [{"role": "user", "text": "how am I doing?"}],
    "today": "2026-11-20",
}


def limited(wait_text: str) -> ModelRateLimitError:
    """The error as the provider integration builds it: the wait is in the message."""
    return ModelRateLimitError(
        "openai/gpt-oss-120b",
        "status_code: 429, body: {'error': {'message': 'Rate limit reached on tokens "
        f"per minute (TPM): Limit 8000, Used 6239, Requested 2162. {wait_text} Need "
        "more tokens?'}}",
    )


def scripted(*outcomes):
    """A fake model that does `outcomes` in order (an exception is raised, a dict is the
    answer) and repeats the last one. Returns the model and the list of its calls."""
    calls: list[int] = []

    def model(messages, info: AgentInfo) -> ModelResponse:
        calls.append(len(calls) + 1)
        outcome = outcomes[min(len(calls), len(outcomes)) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, outcome)])

    return FunctionModel(model), calls


@pytest.fixture
def waits(monkeypatch):
    """Record the waits instead of sleeping."""
    seen: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        seen.append(seconds)

    monkeypatch.setattr(chat_router, "_sleep", fake_sleep)
    return seen


def ask(client):
    return client.post("/chat", json=BODY)


# --- reading how long to wait ---


@pytest.mark.parametrize(
    ("text", "seconds"),
    [
        ("Please try again in 3.0075s.", 3.0075),
        ("Please try again in 10.935s.", 10.935),
        ("Please try again in 3.599999999s.", 3.599999999),
        ("Please try again in 250ms.", 0.25),
        ("Please try again in 14m22.5s.", 14 * 60 + 22.5),
        ("Please try again in 1h2m.", 3720.0),
        ("TRY AGAIN IN 2s", 2.0),
    ],
)
def test_the_wait_is_read_from_the_providers_message(text, seconds):
    assert chat_router.rate_limit_wait(limited(text)) == pytest.approx(seconds)


@pytest.mark.parametrize("text", ["Slow down.", "Please try again later.", ""])
def test_no_wait_is_given_when_the_provider_does_not_say(text):
    assert chat_router.rate_limit_wait(limited(text)) is None


def test_the_retry_after_the_library_already_read_wins_over_the_text():
    error = ModelRateLimitError("m", "try again in 99s", retry_after=4.0)
    assert chat_router.rate_limit_wait(error) == 4.0


# --- what the service does about it ---


def test_a_short_wait_is_waited_out_once_and_the_player_gets_an_answer(
    client, use_model, waits
):
    model, calls = scripted(limited("Please try again in 3.0075s."), GOOD)
    with use_model(model):
        response = ask(client)
    assert response.status_code == 200
    assert response.json()["reply"].startswith("Got it")
    assert len(calls) == 2
    assert waits == [pytest.approx(3.0075 + chat_router.WAIT_MARGIN_SECONDS)]
    assert waits[0] > 3.0075  # a little past the end of the window, never short of it


def test_a_second_rate_limit_is_a_429_after_exactly_one_wait(client, use_model, waits):
    model, calls = scripted(limited("Please try again in 2s."))  # limited every time
    with use_model(model):
        response = ask(client)
    assert response.status_code == 429
    assert len(calls) == 2
    assert len(waits) == 1


@pytest.mark.parametrize(
    "wait_text", ["Please try again in 14m22.5s.", "Please try again in 16s."]
)
def test_a_wait_longer_than_the_limit_is_not_waited_out(
    client, use_model, waits, wait_text
):
    model, calls = scripted(limited(wait_text))
    with use_model(model):
        response = ask(client)
    assert response.status_code == 429
    assert len(calls) == 1
    assert waits == []


def test_exactly_the_longest_wait_is_still_waited_out(client, use_model, waits):
    seconds = chat_router.MAX_RATE_LIMIT_WAIT_SECONDS
    model, calls = scripted(limited(f"try again in {seconds}s."), GOOD)
    with use_model(model):
        assert ask(client).status_code == 200
    assert len(calls) == 2


def test_a_rate_limit_that_says_nothing_about_time_is_not_retried(
    client, use_model, waits
):
    model, calls = scripted(limited("Slow down."))
    with use_model(model):
        assert ask(client).status_code == 429
    assert len(calls) == 1
    assert waits == []


def test_a_used_up_quota_is_not_retried(client, use_model, waits):
    model, calls = scripted(ModelQuotaExceededError("m", "try again in 1s"))
    with use_model(model):
        assert ask(client).status_code == 429
    assert len(calls) == 1
    assert waits == []


def test_other_errors_are_not_retried(client, use_model, waits):
    model, calls = scripted(RuntimeError("boom"))
    with use_model(model):
        assert ask(client).status_code == 500
    assert len(calls) == 1
    assert waits == []


def test_a_wait_that_would_run_past_the_deadline_ends_as_a_504(
    client, use_model, monkeypatch
):
    async def really_sleep(seconds: float) -> None:
        await asyncio.sleep(5)

    monkeypatch.setattr(chat_router, "_sleep", really_sleep)
    monkeypatch.setattr(chat_router, "CHAT_DEADLINE_SECONDS", 0.2)
    model, calls = scripted(limited("Please try again in 3s."), GOOD)
    with use_model(model):
        response = ask(client)
    assert response.status_code == 504
    assert len(calls) == 1  # it never got to ask again


def test_the_longest_wait_and_a_second_model_call_fit_inside_the_deadline():
    model_call_cut_off = 30.0  # settings["timeout"] in app/agent.py
    first_call_allowance = 5.0
    total = (
        first_call_allowance
        + chat_router.MAX_RATE_LIMIT_WAIT_SECONDS
        + chat_router.WAIT_MARGIN_SECONDS
        + model_call_cut_off
    )
    assert total < chat_router.CHAT_DEADLINE_SECONDS
