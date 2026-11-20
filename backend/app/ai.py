"""How the backend talks to the AI service: settings, an HTTP client, a request limit.

The AI service is a separate program (ai-service/). The backend is its only caller: the
browser never talks to it. Everything here is read from the environment when it is used
(the address, the token and the request limit), so a test or a host can change it
without restarting anything.
"""

import os
import threading
import time
from collections import deque
from collections.abc import AsyncIterator, Callable

import httpx
from fastapi import HTTPException

DEFAULT_URL = "http://localhost:8001"
# The deadlines are nested so that the inner one always fires first and says so:
#   30 s  one call to the model (ai-service/app/agent.py)
#   60 s  the whole /extract in the AI service, repairs included (it answers 504)
#   70 s  this backend waits for the AI service (so it normally hears the 504 above)
#   90 s  the browser waits for this backend (frontend/src/api.ts)
# Past 60 s the AI service stops, so it does not keep spending the model's quota on an
# answer nobody is waiting for. Connecting is quick or never.
READ_TIMEOUT_SECONDS = 70.0
CONNECT_TIMEOUT_SECONDS = 5.0
# The users face this backend, so this is where requests are limited. One window is
# shared by everybody ON PURPOSE: what is protected is the model's small free quota, and
# a limit per visitor would not cap the total (and behind a proxy every visitor looks
# like one address anyway). The price: one heavy user can use up the minute for
# everybody. Only requests that passed validation are counted (see limit_notes).
# The largest answer accepted from the AI service. A real one is a few KB (at most 20
# shots with short texts); this only stops a broken or hostile reply filling memory.
MAX_REPLY_BYTES = 200_000
# "Is the AI helper there?" is answered from a short memory, so many page loads do not
# each knock on the AI service. Asking is cheap and must never hold a page up.
STATUS_TTL_SECONDS = 15.0
STATUS_TIMEOUT_SECONDS = 3.0
DEFAULT_RATE_LIMIT = 10  # requests ...
RATE_WINDOW_SECONDS = 60.0  # ... per minute, all callers together


def rate_limit_from_env() -> int:
    """Requests per minute (AI_RATE_LIMIT); any other value means the default."""
    raw = os.environ.get("AI_RATE_LIMIT", "")
    if raw.isascii() and raw.isdigit() and int(raw) >= 1:
        return int(raw)
    return DEFAULT_RATE_LIMIT


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
        limit: int | Callable[[], int],
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
            limit = self.limit() if callable(self.limit) else self.limit
            if len(self._calls) >= limit:
                return False
            self._calls.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._calls.clear()


# The limit is asked for on every call, so AI_RATE_LIMIT takes effect without a restart.
notes_limiter = RateLimiter(rate_limit_from_env, RATE_WINDOW_SECONDS)


def limit_notes() -> None:
    """Refuse with 429 when the AI endpoint is called too often.

    Call it at the START OF THE HANDLER, not as a route dependency: dependencies run
    before the body is validated, so requests that end in a 422 would use up the minute.
    """
    if not notes_limiter.allow():
        raise HTTPException(
            429, "Too many requests to the AI helper. Wait a minute and try again."
        )


class TimedValue:
    """Remembers one answer for `ttl` seconds."""

    def __init__(self, ttl: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.ttl = ttl
        self.clock = clock
        self._value: bool | None = None
        self._at = 0.0

    def get(self) -> bool | None:
        """The remembered answer, or None when there is none or it is too old."""
        if self._value is None or self.clock() - self._at >= self.ttl:
            return None
        return self._value

    def set(self, value: bool) -> None:
        self._value = value
        self._at = self.clock()

    def reset(self) -> None:
        self._value = None


status_cache = TimedValue(STATUS_TTL_SECONDS)
