"""The building blocks under /auth: hashing, tokens and the rate limiter."""

import base64
import hashlib
from datetime import timedelta

import pytest
from sqlmodel import Session, select

from app import security
from app.security import RateLimiter
from app.users import AuthToken, User
from tests.conftest import make_user

# --- passwords ----------------------------------------------------------------


@pytest.mark.real_cost
def test_hashing_cost_is_not_weakened():
    # A test cannot watch the cost drop by mistake, so this pins it.
    assert security.SCRYPT_N >= 2**14
    assert security.SCRYPT_R == 8
    assert security.SCRYPT_P == 1
    assert security.KEY_BYTES == 32
    assert security.SALT_BYTES == 16


@pytest.mark.real_cost
def test_hash_format_and_salt():
    one, two = (
        security.hash_password("same password"),
        security.hash_password("same password"),
    )
    assert one != two
    scheme, n, r, p, salt, key = one.split("$")
    assert (scheme, int(n), int(r), int(p)) == ("scrypt", 2**14, 8, 1)
    assert len(base64.b64decode(salt)) == 16
    assert len(base64.b64decode(key)) == 32


def test_right_and_wrong_password():
    stored = security.hash_password("right password")
    assert security.verify_password("right password", stored) is True
    assert security.verify_password("right passwore", stored) is False
    assert security.verify_password("", stored) is False
    assert security.verify_password("Right password", stored) is False


def test_verify_uses_the_parameters_stored_with_the_hash():
    # A hash made with cheaper settings still checks out: they live in the string.
    salt = b"s" * 16
    key = hashlib.scrypt(b"old password", salt=salt, n=2**4, r=8, p=1, dklen=32)
    stored = (
        "scrypt$16$8$1$"
        + base64.b64encode(salt).decode()
        + "$"
        + base64.b64encode(key).decode()
    )
    assert security.verify_password("old password", stored) is True
    assert security.verify_password("new password", stored) is False


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "plain text",
        "scrypt$16384$8$1$abc",  # too few parts
        "scrypt$16384$8$1$!!!$!!!",  # not base64
        "scrypt$x$8$1$AAAA$AAAA",  # not a number
        "bcrypt$16384$8$1$AAAA$AAAA",  # another scheme
        "scrypt$16384$8$1$AAAA$AAAA$extra",
    ],
)
def test_a_broken_stored_hash_is_just_a_no(stored):
    assert security.verify_password("anything", stored) is False


@pytest.mark.real_cost
def test_the_dummy_hash_is_a_real_hash_nobody_knows():
    assert security.DUMMY_HASH.startswith("scrypt$")
    assert security.verify_password("", security.DUMMY_HASH) is False


def test_unusual_characters_hash_fine():
    for password in ["עברית עברית", "emoji 🏀🏀🏀🏀", "tab\tinside", "x" * 128]:
        assert security.verify_password(password, security.hash_password(password))


# --- tokens -------------------------------------------------------------------


def test_token_hash_is_sha256_hex():
    assert security.token_hash("abc") == hashlib.sha256(b"abc").hexdigest()
    assert len(security.token_hash("abc")) == 64


def test_issued_tokens_are_long_random_and_never_stored(session: Session):
    user = make_user(session)
    one, row_one = security.issue_token(session, user)
    two, _ = security.issue_token(session, user)
    assert one != two
    assert len(one) >= 43  # 32 random bytes
    assert row_one.token_hash == security.token_hash(one)
    assert one not in {r.token_hash for r in session.exec(select(AuthToken)).all()}
    assert row_one.expires_at - row_one.created_at == timedelta(days=7)


def test_the_token_is_32_random_bytes(session: Session):
    raw, _ = security.issue_token(session, make_user(session))
    assert len(raw) == 43  # 32 bytes in URL-safe base64, no padding
    assert set(raw) <= set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )


def test_a_login_that_ends_this_very_moment_is_swept(session: Session):
    user = make_user(session)
    start = security.utcnow()
    security.issue_token(session, user, start)
    # Exactly seven days later the first one has just ended: it goes, the new one stays.
    security.issue_token(session, user, start + security.TOKEN_LIFETIME)
    rows = session.exec(select(AuthToken)).all()
    assert [r.created_at for r in rows] == [start + security.TOKEN_LIFETIME]
    # One second before it ends it is still there.
    other = make_user(session, "other")
    security.issue_token(session, other, start)
    security.issue_token(
        session, other, start + security.TOKEN_LIFETIME - timedelta(seconds=1)
    )
    assert (
        len([r for r in session.exec(select(AuthToken)).all() if r.user_id == other.id])
        == 2
    )


def test_find_login_to_the_second(session: Session):
    user = make_user(session)
    now = security.utcnow()
    raw, row = security.issue_token(session, user, now)
    assert security.find_login(session, raw, now) is not None
    assert (
        security.find_login(session, raw, row.expires_at - timedelta(seconds=1))
        is not None
    )
    assert (
        security.find_login(session, raw, row.expires_at) is None
    )  # the moment it ends
    assert security.find_login(session, raw + "x", now) is None
    assert security.find_login(session, "", now) is None


def test_a_user_keeps_only_the_newest_ten_logins(session: Session):
    user = make_user(session)
    start = security.utcnow()
    raws = [
        security.issue_token(session, user, start + timedelta(minutes=i))[0]
        for i in range(12)
    ]
    now = start + timedelta(minutes=12)
    alive = [security.find_login(session, raw, now) is not None for raw in raws]
    assert alive == [False, False] + [True] * 10
    assert len(session.exec(select(AuthToken)).all()) == 10


def test_expired_logins_are_swept_but_only_for_that_user(session: Session):
    first, second = make_user(session, "first"), make_user(session, "second")
    start = security.utcnow()
    security.issue_token(session, first, start)
    security.issue_token(session, second, start)
    later = start + timedelta(days=8)
    security.issue_token(session, first, later)
    rows = session.exec(select(AuthToken)).all()
    assert sorted((r.user_id, r.created_at == later) for r in rows) == [
        (first.id, True),
        (second.id, False),  # the other user's old row is not touched
    ]


def test_tokens_of_other_users_do_not_count_towards_the_cap(session: Session):
    users = [make_user(session, f"user{i}") for i in range(3)]
    for user in users:
        for _ in range(security.MAX_TOKENS_PER_USER):
            security.issue_token(session, user)
    assert (
        len(session.exec(select(AuthToken)).all()) == 3 * security.MAX_TOKENS_PER_USER
    )
    assert len(session.exec(select(User)).all()) == 3


# --- rate limiter -------------------------------------------------------------


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_limit_is_the_nth_hit_not_the_one_after():
    clock = Clock()
    limiter = RateLimiter(3, 60, clock)
    assert [limiter.hit("a") for _ in range(3)] == [None, None, None]
    assert limiter.hit("a") is not None
    assert limiter.hit("a") is not None  # still blocked, and not extended


def test_keys_are_separate():
    limiter = RateLimiter(1, 60, Clock())
    assert limiter.hit("a") is None
    assert limiter.hit("b") is None
    assert limiter.hit("a") is not None


def test_the_window_slides():
    clock = Clock()
    limiter = RateLimiter(2, 60, clock)
    limiter.hit("a")  # at 1000
    clock.now += 30
    limiter.hit("a")  # at 1030
    clock.now += 29  # 1059: the first hit is 59 s old
    assert limiter.hit("a") is not None
    clock.now += 1  # 1060: the first hit is exactly 60 s old, so it is gone
    assert limiter.hit("a") is None


def test_retry_after_counts_down_to_the_oldest_hit_leaving():
    clock = Clock()
    limiter = RateLimiter(1, 60, clock)
    limiter.hit("a")
    assert limiter.retry_after("a") == 61  # whole seconds, rounded up
    clock.now += 40
    assert limiter.retry_after("a") == 21
    clock.now += 19.5
    assert limiter.retry_after("a") == 1  # never 0 while still blocked
    clock.now += 0.5
    assert limiter.retry_after("a") is None


def test_retry_after_records_nothing():
    limiter = RateLimiter(2, 60, Clock())
    for _ in range(10):
        assert limiter.retry_after("a") is None
    assert limiter.hits == {}
    assert limiter.hit("a") is None
    assert limiter.hit("a") is None
    assert limiter.hit("a") is not None


def test_clear_and_reset():
    limiter = RateLimiter(1, 60, Clock())
    limiter.hit("a")
    limiter.hit("b")
    limiter.clear("a")
    assert limiter.hit("a") is None
    assert limiter.hit("b") is not None
    limiter.reset()
    assert limiter.hit("b") is None
    limiter.clear("never seen")  # not an error


def test_it_cannot_grow_without_end(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(RateLimiter, "MAX_KEYS", 5)
    limiter = RateLimiter(1, 60, clock)
    for i in range(5):
        limiter.hit(f"old{i}")
    clock.now += 61  # all five are expired now
    limiter.hit("new")
    assert list(limiter.hits) == ["new"]
    for i in range(20):  # nothing expires: the oldest keys are dropped instead
        limiter.hit(f"fresh{i}")
    assert len(limiter.hits) <= 5
    assert "fresh19" in limiter.hits


def test_the_limiter_holds_ten_thousand_keys():
    assert RateLimiter.MAX_KEYS == 10_000


def test_the_numbers_in_use():
    assert security.login_attempts.limit == 30
    assert security.login_failures.limit == 8
    assert security.register_attempts.limit == 10
    assert security.login_attempts.window == security.LOGIN_WINDOW == 300
    assert security.register_attempts.window == 3600


def test_env_numbers(monkeypatch):
    monkeypatch.setenv("SOME_LIMIT", "7")
    assert security._env_int("SOME_LIMIT", 1) == 7
    monkeypatch.setenv("SOME_LIMIT", "seven")
    assert security._env_int("SOME_LIMIT", 1) == 1
    monkeypatch.delenv("SOME_LIMIT")
    assert security._env_int("SOME_LIMIT", 1) == 1
