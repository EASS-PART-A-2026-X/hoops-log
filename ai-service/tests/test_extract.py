from datetime import date

from pydantic_ai import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.exceptions import (
    ModelAPIError,
    ModelQuotaExceededError,
    ModelRateLimitError,
    ModelRequestTimeout,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel

GOOD = {
    "proposals": [
        {
            "x": 47.0,
            "y": 3.0,
            "made": True,
            "game_date": "2026-11-18",
            "note": "caught and shot",
            "quote": "hit one from the right corner",
        }
    ],
    "questions": [],
    "skipped": ["two free throws"],
}
BODY = {"text": "hit one from the right corner, 2 free throws", "today": "2026-11-19"}


def test_health_says_ok_and_no_model_when_none_is_set(client):
    assert client.get("/health").json() == {"status": "ok", "model": None}


def test_health_shows_the_model_name_but_no_key(client, monkeypatch):
    monkeypatch.setenv("AI_MODEL", "groq:openai/gpt-oss-120b")
    monkeypatch.setenv("GROQ_API_KEY", "super-secret")
    body = client.get("/health").text
    assert "groq:openai/gpt-oss-120b" in body
    assert "super-secret" not in body


def test_extract_without_a_configured_model_is_503(client):
    response = client.post("/extract", json=BODY)
    assert response.status_code == 503
    assert "AI_MODEL" in response.json()["detail"]


def test_extract_returns_the_proposals_and_the_model_name(client, use_model):
    with use_model(TestModel(custom_output_args=GOOD)):
        response = client.post("/extract", json=BODY)
    assert response.status_code == 200
    data = response.json()
    assert data["proposals"][0]["x"] == 47.0
    assert data["proposals"][0]["made"] is True
    assert data["skipped"] == ["two free throws"]
    assert data["model"] == "test"


def test_the_prompt_carries_today_and_the_notes_as_data(client, use_model):
    seen: list[str] = []

    def spy(messages, info: AgentInfo) -> ModelResponse:
        seen.append(str(messages[0].parts[-1].content))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, GOOD)])

    with use_model(FunctionModel(spy)):
        client.post("/extract", json=BODY)
    assert "today: 2026-11-19" in seen[0]
    assert "<notes>\nhit one from the right corner, 2 free throws\n</notes>" in seen[0]


def test_today_defaults_to_the_servers_date(client, use_model):
    seen: list[str] = []

    def spy(messages, info: AgentInfo) -> ModelResponse:
        seen.append(str(messages[0].parts[-1].content))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, GOOD)])

    with use_model(FunctionModel(spy)):
        client.post("/extract", json={"text": "hit one"})
    assert f"today: {date.today().isoformat()}" in seen[0]


def test_the_agent_can_use_the_court_spot_tool(client, use_model):
    tool_answers: list[object] = []

    def model(messages, info: AgentInfo) -> ModelResponse:
        returns = [
            part
            for message in messages
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        ]
        if not returns:
            return ModelResponse(
                parts=[ToolCallPart("court_spot", {"spot": "right_corner_three"})]
            )
        tool_answers.append(returns[-1].content)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, GOOD)])

    with use_model(FunctionModel(model)):
        response = client.post("/extract", json=BODY)
    assert response.status_code == 200
    # The agent really offered the tool: the model got the exact feet back from it.
    assert tool_answers == [{"x": 47.0, "y": 3.0}]


def test_output_that_breaks_the_contract_is_repaired(client, use_model):
    bad = {"proposals": [{**GOOD["proposals"][0], "x": 99.0}]}  # x is over 50 feet
    attempts: list[int] = []

    def model(messages, info: AgentInfo) -> ModelResponse:
        attempts.append(len(messages))
        args = bad if len(attempts) == 1 else GOOD
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    with use_model(FunctionModel(model)):
        response = client.post("/extract", json=BODY)
    assert response.status_code == 200
    assert len(attempts) == 2
    assert response.json()["proposals"][0]["x"] == 47.0


def test_output_that_never_fits_the_contract_is_502(client, use_model):
    bad = {"proposals": [{**GOOD["proposals"][0], "x": 99.0}]}

    def model(messages, info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, bad)])

    with use_model(FunctionModel(model)):
        response = client.post("/extract", json=BODY)
    assert response.status_code == 502
    assert response.json()["detail"] == "The AI model could not give a usable answer."


def _failing(error):
    def model(messages, info: AgentInfo) -> ModelResponse:
        raise error

    return FunctionModel(model)


def test_rate_limit_and_quota_are_429(client, use_model):
    for error in (
        ModelRateLimitError("m", "slow down"),
        ModelQuotaExceededError("m", "out of quota"),
    ):
        with use_model(_failing(error)):
            assert client.post("/extract", json=BODY).status_code == 429


def test_a_timeout_is_504(client, use_model):
    with use_model(_failing(ModelRequestTimeout("m", 30.0))):
        assert client.post("/extract", json=BODY).status_code == 504


def test_other_provider_errors_are_502_and_leak_nothing(client, use_model):
    with use_model(_failing(ModelAPIError("m", "boom: key sk-secret rejected"))):
        response = client.post("/extract", json=BODY)
    assert response.status_code == 502
    assert "sk-secret" not in response.text


def test_a_missing_provider_key_is_503(client, monkeypatch):
    # A real provider name with no key: reported as "not set up".
    monkeypatch.setenv("AI_MODEL", "groq:openai/gpt-oss-120b")
    from app.agent import _cached_agent

    _cached_agent.cache_clear()
    response = client.post("/extract", json=BODY)
    assert response.status_code == 503


def test_bad_input_is_422(client):
    assert client.post("/extract", json={"text": ""}).status_code == 422
    assert client.post("/extract", json={"text": "x" * 2001}).status_code == 422
    assert (
        client.post("/extract", json={"text": "ok", "today": "not a date"}).status_code
        == 422
    )
    assert client.post("/extract", json={"text": "ok", "extra": 1}).status_code == 422
    assert client.post("/extract", json={}).status_code == 422


def test_a_model_that_never_stops_calling_tools_is_cut_off(client, use_model):
    calls = 0

    def runaway(messages, info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        return ModelResponse(parts=[ToolCallPart("court_spot", {"spot": "left_elbow"})])

    with use_model(FunctionModel(runaway)):
        response = client.post("/extract", json=BODY)
    assert response.status_code == 502
    assert calls <= 6  # the request limit in app/routers/extract.py
