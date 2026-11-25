from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import security
from app.db import get_session
from app.main import app
from app.users import User, username_key

# Hashing is slow on purpose, so the test accounts are made once and reused.
PASSWORD = "correct horse battery"
PASSWORD_HASH = security.hash_password(PASSWORD)


def make_user(session: Session, name: str = "tester") -> User:
    """An account straight in the database (the /auth routes have their own tests)."""
    user = User(
        email=f"{name}@example.com",
        username=name,
        username_key=username_key(name),
        password_hash=PASSWORD_HASH,
        created_at=security.utcnow(),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def login_header(session: Session, user: User) -> dict[str, str]:
    raw, _ = security.issue_token(session, user)
    return {"Authorization": f"Bearer {raw}"}


@pytest.fixture(autouse=True)
def cheap_hashing(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Hashing costs 0.1 s on purpose: tests use a cheap setting unless they say
    `@pytest.mark.real_cost` (the ones that check the real numbers)."""
    if request.node.get_closest_marker("real_cost") is None:
        monkeypatch.setattr(security, "SCRYPT_N", 2**4)


@pytest.fixture(autouse=True)
def fresh_limits() -> None:
    """Rate limits are per process: every test starts with all of them empty."""
    for limiter in security.LIMITERS:
        limiter.reset()


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
def anon(engine: Engine) -> Iterator[TestClient]:
    """A client that is not logged in."""

    def session_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def client(anon: TestClient, session: Session) -> TestClient:
    """A client logged in as the account "tester": the shots tests use this one."""
    anon.headers.update(login_header(session, make_user(session)))
    return anon
