"""How the backend talks to the AI service: settings, an HTTP client, a request limit.

The AI service is a separate program (ai-service/). The backend is its only caller: the
browser never talks to it. Everything here is configuration read from the environment
at call time, so a test (or a host) can change it without restarting anything.
"""

import os
import threading
import time
from collections import deque
from collections.abc import AsyncIterator, Callable

import httpx
from fastapi import HTTPException

DEFAULT_URL = "http://localhost:8001"
# The model can need ~30 s for one step and a request may use a few steps (a tool call,
# a repair), so wait longer than the slowest normal answer. Connecting is quick or
# never.
READ_TIMEOUT_SECONDS = 70.0
CONNECT_TIMEOUT_SECONDS = 5.0
# The users face this backend, so this is where requests are limited (one shared window:
# behind a proxy every visitor looks like one address anyway). The model's free quota is
# small and one request can use several model calls.
RATE_LIMIT = 10  # requests ...
RATE_WINDOW_SECONDS = 60.0  # ... per minute, all callers together


def ai_url() -> str:
    """Where the AI service listens (AI_SERVICE_URL), without a trailing slash."""
    return os.environ.get("AI_SERVICE_URL", DEFAULT_URL).rstrip("/")


def ai_headers() -> dict[str, str]:
    """The shared secret the AI service asks for (AI_SERVICE_TOKEN), if one is set."""
    token = os.environ.get("AI_SERVICE_TOKEN", "")
    return {"X-Service-Token": token} if token else {}


async def get_ai_client() -> AsyncIterator[httpx.AsyncClient]:
    """FastAPI dependency: one HTTP client per request. Tests replace it with a fake."""
    timeout = httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        yield client


class RateLimiter:
    """At most `limit` calls in any `window` seconds; the rest are refused."""

    def __init__(
        self,
        limit: int,
        window: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window = window
        self.clock = clock
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def allow(self) -> bool:
        now = self.clock()
        with self._lock:
            while self._calls and now - self._calls[0] >= self.window:
                self._calls.popleft()
            if len(self._calls) >= self.limit:
                return False
            self._calls.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._calls.clear()


notes_limiter = RateLimiter(RATE_LIMIT, RATE_WINDOW_SECONDS)


def limit_notes() -> None:
    """FastAPI dependency: refuse with 429 when the AI endpoint is called too often."""
    if not notes_limiter.allow():
        raise HTTPException(
            429, "Too many requests to the AI helper. Wait a minute and try again."
        )
