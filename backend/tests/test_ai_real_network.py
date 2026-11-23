"""POST /chat against a REAL misbehaving server on a real socket.

The other chat tests replace the HTTP transport with a fake that raises
`httpx.ReadTimeout` and friends. That proves the backend translates those errors, but
not that the real client is set up to produce them. Here a small server on 127.0.0.1
really never answers, really hangs up, or really speaks nonsense, and the real httpx
client has to cope.

No model and no outside network: every server here lives in this test process.
"""

import contextlib
import socket
import threading
import time
from collections.abc import Callable, Iterator

import httpx
import pytest
import uvicorn

from app import ai, db
from app.main import app

BODY = {"messages": [{"role": "user", "text": "hit one from the corner"}]}
SHORT_WAIT = 0.3  # the backend's read timeout in these tests (the real one is 70 s)
Behaviour = Callable[[socket.socket, threading.Event], None]


def read_request(conn: socket.socket) -> dict[str, str] | None:
    """Read one whole request (headers and body) and return its headers, lowercased.

    The body is read to the end so that closing the connection afterwards is a clean
    close, not a reset caused by unread data. None means the client sent nothing.
    """
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            return None
        data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    headers = {}
    for line in head.decode("latin-1").split("\r\n")[1:]:
        name, _, value = line.partition(":")
        headers[name.strip().lower()] = value.strip()
    wanted = int(headers.get("content-length", "0"))
    while len(body) < wanted:
        chunk = conn.recv(4096)
        if not chunk:
            break
        body += chunk
    return headers


def silent(conn: socket.socket, release: threading.Event) -> None:
    """Connect fine, take the request, then send nothing at all."""
    release.wait(timeout=10)


def hang_up(conn: socket.socket, release: threading.Event) -> None:
    """Take the request and close the connection without a reply."""


def garbage(conn: socket.socket, release: threading.Event) -> None:
    conn.sendall(b"this is not http\r\n\r\n")


def wrong_token(conn: socket.socket, release: threading.Event) -> None:
    body = b'{"detail":"Missing or wrong service token."}'
    head = (
        b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n"
        b"Content-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n"
    )
    conn.sendall(head + body)


class FakeAIService:
    """A tiny TCP server that runs one `behaviour` for each connection."""

    def __init__(self, behaviour: Behaviour) -> None:
        self.behaviour = behaviour
        self.requests = 0
        self.last_headers: dict[str, str] = {}
        self.release = threading.Event()  # lets a silent server go when the test ends
        self._socket = socket.socket()
        self._socket.bind(("127.0.0.1", 0))
        self._socket.listen()
        self._socket.settimeout(0.2)
        self._stop = False
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._socket.getsockname()[1]}"

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop = True
        self.release.set()
        self._thread.join(timeout=5)
        self._socket.close()

    def _accept_loop(self) -> None:
        while not self._stop:
            try:
                conn, _ = self._socket.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket) -> None:
        with conn:
            headers = read_request(conn)
            if headers is not None:
                self.last_headers = headers
                self.requests += 1
                self.behaviour(conn, self.release)


@contextlib.contextmanager
def fake_ai_service(behaviour: Behaviour) -> Iterator[FakeAIService]:
    service = FakeAIService(behaviour)
    service.start()
    try:
        yield service
    finally:
        service.stop()


@pytest.fixture(autouse=True)
def _short_patience(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ai, "READ_TIMEOUT_SECONDS", SHORT_WAIT)


def test_a_server_that_never_answers_is_a_quick_504(client, monkeypatch):
    with fake_ai_service(silent) as service:
        monkeypatch.setenv("AI_SERVICE_URL", service.url)
        started = time.monotonic()
        response = client.post("/chat", json=BODY)
        waited = time.monotonic() - started
    assert service.requests == 1  # it really connected: this is not a refused port
    assert response.status_code == 504
    assert "took too long" in response.json()["detail"]
    assert waited < 3, f"gave up after {waited:.1f} s, the setting was {SHORT_WAIT} s"


def test_a_server_that_hangs_up_is_a_502(client, monkeypatch, caplog):
    with fake_ai_service(hang_up) as service:
        monkeypatch.setenv("AI_SERVICE_URL", service.url)
        response = client.post("/chat", json=BODY)
    assert service.requests == 1
    assert response.status_code == 502
    assert "usable answer" in response.json()["detail"]
    assert "AI service call failed" in caplog.text  # a transport error, not a status


def test_a_server_that_does_not_speak_http_is_a_502(client, monkeypatch, caplog):
    with fake_ai_service(garbage) as service:
        monkeypatch.setenv("AI_SERVICE_URL", service.url)
        response = client.post("/chat", json=BODY)
    assert service.requests == 1
    assert response.status_code == 502
    assert "AI service call failed" in caplog.text


def test_nothing_listening_is_a_503(client, monkeypatch):
    with socket.socket() as spare:  # a port that was free a moment ago, now closed
        spare.bind(("127.0.0.1", 0))
        port = spare.getsockname()[1]
    monkeypatch.setenv("AI_SERVICE_URL", f"http://127.0.0.1:{port}")
    response = client.post("/chat", json=BODY)
    assert response.status_code == 503
    assert "not available" in response.json()["detail"]


def test_a_wrong_service_token_is_a_502_that_says_nothing_about_it(
    client, monkeypatch, caplog
):
    with fake_ai_service(wrong_token) as service:
        monkeypatch.setenv("AI_SERVICE_URL", service.url)
        monkeypatch.setenv("AI_SERVICE_TOKEN", "the-real-secret")
        response = client.post("/chat", json=BODY)
    assert service.last_headers.get("x-service-token") == "the-real-secret"  # was sent
    assert "AI service answered 401" in caplog.text  # the status path, not a crash
    assert response.status_code == 502
    assert "token" not in response.text.lower()
    assert "the-real-secret" not in response.text


@pytest.fixture
def live_backend(client, monkeypatch) -> Iterator[str]:
    """The backend on a real port with ONE event loop, as in production.

    The TestClient gives every request its own loop, so it cannot show one slow call
    holding up another. The `client` fixture supplies the in-memory database for the
    request handlers. `lifespan="off"` matters: the app's startup code opens the
    default database file (backend/data/app.db, a developer's real data) and would
    create tables and demo shots in it. No test here may touch that file.
    """

    def refuse_the_real_database() -> None:
        raise AssertionError("the app's startup ran: it would open backend/data/app.db")

    monkeypatch.setattr(db, "create_db_and_tables", refuse_the_real_database)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="off"))
    thread = threading.Thread(
        target=server.run, kwargs={"sockets": [sock]}, daemon=True
    )
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started, "the test backend did not start"
    yield f"http://127.0.0.1:{sock.getsockname()[1]}"
    server.should_exit = True
    thread.join(timeout=10)
    sock.close()


def test_while_the_ai_service_hangs_plain_shot_logging_still_answers(
    live_backend, monkeypatch
):
    monkeypatch.setattr(ai, "READ_TIMEOUT_SECONDS", 2.0)  # long enough to overlap
    shot = {"player": "Yuly", "x": 25, "y": 6, "made": True}
    with fake_ai_service(silent) as service:
        monkeypatch.setenv("AI_SERVICE_URL", service.url)
        chat: dict[str, httpx.Response | httpx.HTTPError] = {}

        def ask_deni() -> None:
            try:
                chat["reply"] = httpx.post(
                    f"{live_backend}/chat", json=BODY, timeout=10
                )
            except httpx.HTTPError as error:  # shown by the assert below, not swallowed
                chat["reply"] = error

        worker = threading.Thread(target=ask_deni)
        worker.start()
        deadline = time.monotonic() + 5
        while service.requests == 0 and time.monotonic() < deadline:
            time.sleep(0.02)
        assert service.requests == 1, "the chat request never reached the AI service"

        # If a slow AI call held the backend's one event loop, these two would wait for
        # it and the chat call would be over by the time they return.
        created = httpx.post(f"{live_backend}/shots", json=shot, timeout=10)
        listed = httpx.get(f"{live_backend}/shots", timeout=10)
        still_waiting = worker.is_alive()
        worker.join(timeout=10)

    assert still_waiting, "the chat call ended before the shots were tried: no overlap"
    assert (created.status_code, listed.status_code) == (201, 200)
    reply = chat["reply"]
    assert isinstance(reply, httpx.Response), f"the chat request failed: {reply!r}"
    assert reply.status_code == 504
