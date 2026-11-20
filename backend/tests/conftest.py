from collections.abc import Callable, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.ai import get_ai_client, notes_limiter, status_cache
from app.db import get_session
from app.main import app


@pytest.fixture
def engine() -> Iterator[Engine]:
    # One in-memory database per test; StaticPool keeps every connection on the
    # same one.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def client(engine: Engine) -> Iterator[TestClient]:
    def session_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clean_ai_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """No developer setting and no earlier test may leak into a notes test."""
    monkeypatch.delenv("AI_SERVICE_URL", raising=False)
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    notes_limiter.reset()
    status_cache.reset()
    yield
    notes_limiter.reset()
    status_cache.reset()


@pytest.fixture
def fake_ai(client: TestClient) -> Callable[..., list[httpx.Request]]:
    """Stand in for the AI service: `fake_ai(handler)` answers its requests.

    Returns the list of requests the backend sent, so a test can inspect them. Nothing
    ever reaches the network. (It depends on `client`, which clears the overrides.)
    """

    def install(
        handler: Callable[[httpx.Request], httpx.Response],
    ) -> list[httpx.Request]:
        seen: list[httpx.Request] = []

        def recording(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        async def fake_client():
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(recording)
            ) as fake:
                yield fake

        app.dependency_overrides[get_ai_client] = fake_client
        return seen

    return install
