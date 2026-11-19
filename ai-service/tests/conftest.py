import pytest
from fastapi.testclient import TestClient
from pydantic_ai import models

from app.agent import get_agent
from app.main import app

# Safety net: any test that reaches for a real model fails here instead of calling out.
models.ALLOW_MODEL_REQUESTS = False


@pytest.fixture(autouse=True)
def _no_ambient_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """A developer's own AI_MODEL / keys must never leak into a test."""
    for name in ("AI_MODEL", "GROQ_API_KEY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def use_model():
    """Serve /extract with a fake model: use_model(TestModel(...) or FunctionModel)."""
    from app.agent import build_agent

    def _use(model):
        agent = build_agent("test")
        app.dependency_overrides[get_agent] = lambda: agent
        return agent.override(model=model)

    yield _use
    app.dependency_overrides.clear()
