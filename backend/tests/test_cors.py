"""The browser frontend (Vite, port 5173) may call the API; other origins may not."""

import pytest
from fastapi.testclient import TestClient


def preflight(
    client: TestClient,
    origin: str,
    method: str = "POST",
    headers: str = "content-type",
):
    return client.options(
        "/shots",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": headers,
        },
    )


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_frontend_origin_is_allowed(client: TestClient, origin: str) -> None:
    response = preflight(client, origin)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("method", ["GET", "POST", "PATCH", "DELETE"])
def test_crud_methods_are_allowed(client: TestClient, method: str) -> None:
    response = preflight(client, "http://localhost:5173", method)
    assert response.status_code == 200


@pytest.mark.parametrize("method", ["PUT", "PATCHX", "TRACE"])
def test_other_methods_are_refused(client: TestClient, method: str) -> None:
    response = preflight(client, "http://localhost:5173", method)
    assert response.status_code == 400


def test_login_token_header_is_allowed(client: TestClient) -> None:
    response = preflight(
        client, "http://localhost:5173", headers="authorization, content-type"
    )
    assert response.status_code == 200


@pytest.mark.parametrize("header", ["x-custom", "cookie", "x-forwarded-for"])
def test_other_headers_are_refused(client: TestClient, header: str) -> None:
    response = preflight(client, "http://localhost:5173", headers=header)
    assert response.status_code == 400


@pytest.mark.parametrize(
    "origin", ["http://evil.example", "http://localhost:3000", "http://localhost:5174"]
)
def test_other_origins_are_refused(client: TestClient, origin: str) -> None:
    response = preflight(client, origin)
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_simple_request_from_frontend_gets_the_header(client: TestClient) -> None:
    response = client.get("/shots", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_the_browser_may_read_how_long_to_wait(anon: TestClient, monkeypatch) -> None:
    from app import security

    monkeypatch.setattr(security.login_attempts, "limit", 1)
    origin = {"Origin": "http://localhost:5173"}
    body = {"login": "nobody", "password": "whatever"}
    anon.post("/auth/login", json=body, headers=origin)
    blocked = anon.post("/auth/login", json=body, headers=origin)
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1
    assert blocked.headers["access-control-expose-headers"] == "Retry-After"


def test_every_answer_from_auth_is_marked_not_to_be_cached(anon: TestClient) -> None:
    for response in (
        anon.post(
            "/auth/login", json={"login": "nobody", "password": "whatever"}
        ),  # 401
        anon.post("/auth/login", json={}),  # 422
        anon.get("/auth/me"),  # 401
    ):
        assert response.headers["cache-control"] == "no-store", response.status_code
