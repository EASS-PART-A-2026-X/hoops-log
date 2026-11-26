"""Passwords, login tokens and rate limits. Nothing here knows about HTTP."""

import base64
import hashlib
import hmac
import os
import secrets
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, col, select

from app.users import AuthToken, User

# --- passwords -----------------------------------------------------------------------
# scrypt is in Python's standard library, is memory-hard (a GPU gains little) and is
# recommended by OWASP. N = 2**14 costs about 0.1 s and 16 MB per attempt. Every
# stored hash carries its own parameters, so they can be raised later.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
KEY_BYTES = 32


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _derive(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8", "surrogatepass"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=KEY_BYTES,
        # equivalent-mutant: only an upper limit; scrypt at these settings needs 16 MB
        maxmem=64 * 1024 * 1024,
    )


def hash_password(password: str) -> str:
    """`scrypt$N$r$p$salt$key`: a new random salt for every password."""
    salt = os.urandom(SALT_BYTES)
    key = _derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    """True only for the right password. A broken stored value is just False."""
    try:
        scheme, n, r, p, salt, key = stored.split("$")
        if scheme != "scrypt":
            return False
        wanted = base64.b64decode(key)
        actual = _derive(password, base64.b64decode(salt), int(n), int(r), int(p))
    except ValueError:
        return False
    return hmac.compare_digest(actual, wanted)


# Checked when the account does not exist, so "unknown user" and "wrong password"
# take the same time and cannot be told apart by timing.
# equivalent-mutant: any password nobody knows will do, whatever its length
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


# --- login tokens --------------------------------------------------------------------
TOKEN_LIFETIME = timedelta(days=7)
MAX_TOKENS_PER_USER = 10


def utcnow() -> datetime:
    """Now, in UTC, with the time zone attached (SQLModel stores and returns UTC)."""
    return datetime.now(UTC)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8", "surrogatepass")).hexdigest()


def issue_token(
    session: Session, user: User, now: datetime | None = None
) -> tuple[str, AuthToken]:
    """Make a login for `user`: the raw token (shown once) and its stored row."""
    now = now or utcnow()
    raw = secrets.token_urlsafe(32)
    row = AuthToken(
        token_hash=token_hash(raw),
        user_id=user.id,
        created_at=now,
        expires_at=now + TOKEN_LIFETIME,
    )
    session.add(row)
    # Housekeeping: expired logins go, and a user keeps at most the newest few.
    for old in session.exec(
        select(AuthToken).where(
            AuthToken.user_id == user.id, AuthToken.expires_at <= now
        )
    ).all():
        session.delete(old)
    session.flush()  # the expired ones are gone before the rest are counted
    live = session.exec(
        select(AuthToken)
        .where(AuthToken.user_id == user.id)
        .order_by(col(AuthToken.created_at).desc(), col(AuthToken.id).desc())
    ).all()
    for old in live[MAX_TOKENS_PER_USER:]:
        session.delete(old)
    session.commit()
    session.refresh(row)
    return raw, row


def find_login(
    session: Session, raw: str, now: datetime | None = None
) -> AuthToken | None:
    """The login behind a token, or None when it is unknown or has expired."""
    now = now or utcnow()
    row = session.exec(
        select(AuthToken).where(AuthToken.token_hash == token_hash(raw))
    ).first()
    if row is None or row.expires_at <= now:
        return None
    return row


# --- rate limits ---------------------------------------------------------------------
class RateLimiter:
    """At most `limit` hits per key in any `window` seconds (a sliding window).

    Kept in memory: it is per process and a restart clears it. That is enough to make
    guessing passwords slow, and it needs no extra service.
    """

    MAX_KEYS = 10_000

    def __init__(
        self,
        limit: int,
        window: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window = window
        self.clock = clock
        self.hits: dict[str, deque[float]] = {}

    def _recent(self, key: str) -> deque[float]:
        queue = self.hits.get(key)
        if queue is None:
            return deque()
        cutoff = self.clock() - self.window
        while queue and queue[0] <= cutoff:
            queue.popleft()
        return queue

    def retry_after(self, key: str) -> int | None:
        """Seconds to wait if `key` is over the limit, else None. Records nothing."""
        queue = self._recent(key)
        if len(queue) < self.limit:
            return None
        return max(1, int(queue[0] + self.window - self.clock()) + 1)

    def hit(self, key: str) -> int | None:
        """Count one attempt. Returns the seconds to wait when it is over the limit."""
        wait = self.retry_after(key)
        if wait is not None:
            return wait
        if len(self.hits) >= self.MAX_KEYS:
            self._forget_old_keys()
        self.hits.setdefault(key, deque()).append(self.clock())
        return None

    def clear(self, key: str) -> None:
        self.hits.pop(key, None)

    def reset(self) -> None:
        self.hits.clear()

    def _forget_old_keys(self) -> None:
        for key in list(self.hits):
            if not self._recent(key):
                del self.hits[key]
        while len(self.hits) >= self.MAX_KEYS:  # still full: drop the oldest key
            del self.hits[next(iter(self.hits))]


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# Every attempt from one address, then the failed ones for one address and account.
# The numbers are generous on purpose: a whole classroom can share one address.
LOGIN_WINDOW = 300
login_attempts = RateLimiter(_env_int("LOGIN_ATTEMPTS", 30), LOGIN_WINDOW)
login_failures = RateLimiter(_env_int("LOGIN_FAILURES", 8), LOGIN_WINDOW)
register_attempts = RateLimiter(_env_int("REGISTER_ATTEMPTS", 10), 3600)
LIMITERS = (login_attempts, login_failures, register_attempts)
