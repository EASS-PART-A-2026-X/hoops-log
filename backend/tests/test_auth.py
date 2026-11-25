"""Accounts: register, log in, log out, and what each of them refuses.

Testing strategy: split every input into partitions and test both sides of each limit.
  email:     fine | upper case (stored lower) | no @ | no domain | two @ | 255 chars
  username:  2 chars | 3 | 30 | 31 | space inside | accent | spaces around (trimmed)
  password:  9 chars | 10 | 128 | 129 | too common | same as username | same as email
             | control character | spaces at the end (kept, not trimmed)
  confirm:   same | different | missing
  duplicates: same email | same email in capitals | same username in capitals
  login:     username | email | capitals | spaces around | wrong password | unknown
  tokens:    new on every login | works until it expires | logout kills only itself
  limits:    register per address | login per address | failures per address+account
"""

from datetime import timedelta

import pytest
from fastapi import status
from sqlmodel import select

from app import security
from app.routers import auth as auth_routes
from app.users import AuthToken, User

PASSWORD = "a long enough password"
ACCOUNT = {
    "email": "Yuly@Example.com",
    "username": "Yuly",
    "password": PASSWORD,
    "password_confirm": PASSWORD,
}


def register(client, **changes):
    return client.post("/auth/register", json={**ACCOUNT, **changes})


def login(client, name="yuly", password=PASSWORD):
    return client.post("/auth/login", json={"login": name, "password": password})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- registering --------------------------------------------------------------
def test_register_returns_a_working_login(anon):
    r = register(anon)
    assert r.status_code == status.HTTP_201_CREATED
    body = r.json()
    assert body["token_type"] == "bearer"
    assert len(body["token"]) >= 40
    assert body["user"] == {"id": 1, "email": "yuly@example.com", "username": "Yuly"}
    assert set(body) == {"token", "token_type", "expires_at", "user"}
    me = anon.get("/auth/me", headers=bearer(body["token"]))
    assert me.json() == body["user"]


def test_nothing_secret_comes_back_and_nothing_is_cached(anon):
    r = register(anon)
    assert PASSWORD not in r.text
    assert "password" not in r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert anon.get("/health").headers["x-content-type-options"] == "nosniff"
    assert "cache-control" not in anon.get("/health").headers


def test_email_is_stored_lower_case_and_username_keeps_its_letters(anon, session):
    register(anon)
    user = session.exec(select(User)).one()
    assert (user.email, user.username, user.username_key) == (
        "yuly@example.com",
        "Yuly",
        "yuly",
    )


@pytest.mark.real_cost
def test_the_password_is_stored_only_as_a_salted_hash(anon, session):
    register(anon)
    register(
        anon, email="b@example.com", username="second"
    )  # same password, other account
    first, second = session.exec(select(User).order_by(User.id)).all()
    assert first.password_hash.startswith("scrypt$16384$8$1$")
    assert PASSWORD not in first.password_hash
    assert first.password_hash != second.password_hash  # a new salt every time


def test_token_is_stored_only_as_a_hash(anon, session):
    token = register(anon).json()["token"]
    row = session.exec(select(AuthToken)).one()
    assert row.token_hash == security.token_hash(token)
    assert token not in row.token_hash


def test_token_expires_in_seven_days(anon):
    body = register(anon).json()
    from datetime import datetime

    expires = datetime.fromisoformat(body["expires_at"])
    left = expires - security.utcnow()
    assert timedelta(days=6, hours=23) < left <= timedelta(days=7)


@pytest.mark.parametrize(
    "email", ["a@b.co", "UPPER@EXAMPLE.COM", "o'brien@example.org"]
)
def test_good_emails(anon, email):
    r = register(anon, email=email)
    assert r.status_code == 201
    assert r.json()["user"]["email"] == email.lower()


@pytest.mark.parametrize(
    "email",
    [
        "",
        "yuly",
        "yuly@",
        "@example.com",
        "a@@example.com",
        "a b@example.com",
        "x" * 250 + "@example.com",
    ],
)
def test_bad_emails(anon, email):
    assert register(anon, email=email).status_code == 422


@pytest.mark.parametrize(
    "username", ["abc", "a_b.c-d", "x" * 30, "Ünï".replace("Ü", "U").replace("ï", "i")]
)
def test_good_usernames(anon, username):
    assert register(anon, username=username).status_code == 201


@pytest.mark.parametrize(
    "username", ["ab", "x" * 31, "a b", "yuly!", "יולי", "é" * 3, "", "  ", "a/b"]
)
def test_bad_usernames(anon, username):
    r = register(anon, username=username)
    assert r.status_code == 422


def test_username_is_trimmed(anon):
    assert register(anon, username="  yuly  ").json()["user"]["username"] == "yuly"


@pytest.mark.parametrize("length", [10, 50, 128])
def test_password_lengths_that_are_fine(anon, length):
    password = "k" * length
    assert (
        register(anon, password=password, password_confirm=password).status_code == 201
    )


@pytest.mark.parametrize("length", [0, 1, 9, 129, 5000])
def test_password_lengths_that_are_not(anon, length):
    password = "k" * length
    assert (
        register(anon, password=password, password_confirm=password).status_code == 422
    )


@pytest.mark.parametrize(
    "password", ["password123", "PASSWORD123", "basketball", "1234567890"]
)
def test_common_passwords_are_refused(anon, password):
    r = register(anon, password=password, password_confirm=password)
    assert r.status_code == 422
    assert "too common" in r.text


def test_password_cannot_be_the_username(anon):
    same = "yulyyulyyuly"
    r = register(anon, username=same, password=same, password_confirm=same)
    assert r.status_code == 422
    assert "username or your email" in r.text


def test_password_cannot_be_the_name_in_the_email(anon):
    same = "myname1234"
    r = register(
        anon, email="MyName1234@example.com", password=same, password_confirm=same
    )
    assert r.status_code == 422
    assert "username or your email" in r.text


def test_the_two_passwords_must_match(anon):
    r = register(anon, password_confirm=PASSWORD + "x")
    assert r.status_code == 422
    assert "do not match" in r.text
    assert register(anon, password_confirm="").status_code == 422
    assert (
        anon.post(
            "/auth/register", json={**ACCOUNT, "password_confirm": None}
        ).status_code
        == 422
    )


def test_password_is_not_trimmed(anon):
    padded = PASSWORD + "  "
    assert register(anon, password=padded, password_confirm=padded).status_code == 201
    assert login(anon, password=padded).status_code == 200
    assert login(anon, password=PASSWORD).status_code == 401


def test_password_with_a_control_character_is_refused(anon):
    bad = "a long enough\x00password"
    assert register(anon, password=bad, password_confirm=bad).status_code == 422


@pytest.mark.parametrize(
    "missing", ["email", "username", "password", "password_confirm"]
)
def test_every_field_is_required(anon, missing):
    body = {k: v for k, v in ACCOUNT.items() if k != missing}
    assert anon.post("/auth/register", json=body).status_code == 422


def test_unknown_fields_are_refused(anon):
    assert register(anon, admin=True).status_code == 422
    assert register(anon, id=7).status_code == 422


def test_email_already_used(anon):
    register(anon)
    r = register(anon, email="YULY@example.com", username="other")
    assert r.status_code == status.HTTP_409_CONFLICT
    assert r.json()["detail"] == {
        "field": "email",
        "message": "That email is already used",
    }


def test_username_already_used_whatever_the_capitals(anon):
    register(anon)
    r = register(anon, email="other@example.com", username="YULY")
    assert r.status_code == status.HTTP_409_CONFLICT
    assert r.json()["detail"]["field"] == "username"


def test_a_refused_registration_creates_nothing(anon, session):
    register(anon, password_confirm="different")
    register(anon, username="ab")
    assert session.exec(select(User)).all() == []
    assert session.exec(select(AuthToken)).all() == []


def test_first_account_takes_the_old_shots_and_the_second_does_not(anon, session):
    from app.models import Shot

    session.add_all([Shot(player="Old", x=1, y=1, made=True) for _ in range(3)])
    session.commit()
    first = register(anon).json()
    second = register(anon, email="b@example.com", username="second").json()
    assert len(anon.get("/shots", headers=bearer(first["token"])).json()) == 3
    assert anon.get("/shots", headers=bearer(second["token"])).json() == []
    assert {s.owner_id for s in session.exec(select(Shot)).all()} == {
        first["user"]["id"]
    }


def test_old_shots_stay_hidden_until_someone_signs_up(client, session):
    from app.models import Shot

    session.add(Shot(player="Old", x=1, y=1, made=True))
    session.commit()
    assert (
        client.get("/shots").json() == []
    )  # `client` is logged in, but is not the first account


def test_register_is_rate_limited_per_address(anon, monkeypatch):
    monkeypatch.setattr(security.register_attempts, "limit", 2)
    assert register(anon).status_code == 201
    assert register(anon, email="b@example.com", username="second").status_code == 201
    r = register(anon, email="c@example.com", username="third")
    assert r.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert 1 <= int(r.headers["retry-after"]) <= 3600
    assert "Try again in" in r.json()["detail"]


# --- logging in ---------------------------------------------------------------
@pytest.mark.parametrize(
    "name", ["yuly", "YULY", "Yuly", "  yuly  ", "yuly@example.com", "YULY@EXAMPLE.COM"]
)
def test_login_by_username_or_email(anon, name):
    register(anon)
    r = login(anon, name)
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "Yuly"


def test_every_login_gets_a_new_token(anon):
    register(anon)
    one, two = login(anon).json()["token"], login(anon).json()["token"]
    assert one != two
    for token in (one, two):
        assert anon.get("/auth/me", headers=bearer(token)).status_code == 200


def test_wrong_password_and_unknown_user_look_the_same(anon):
    register(anon)
    wrong = login(anon, password="not the password")
    unknown = login(anon, name="nobody", password=PASSWORD)
    unknown_email = login(anon, name="nobody@example.com")
    for r in (wrong, unknown, unknown_email):
        assert r.status_code == 401
        assert r.json() == {"detail": "Wrong username, email or password"}
        assert "token" not in r.text


def test_an_unknown_user_still_pays_for_a_hash(anon, monkeypatch):
    seen = []
    real = security.verify_password

    def spy(password, stored):
        seen.append(stored)
        return real(password, stored)

    monkeypatch.setattr(auth_routes, "verify_password", spy)
    login(anon, name="nobody")
    assert seen == [security.DUMMY_HASH]


def test_login_takes_a_single_character_in_each_field(anon):
    # Too short to be real, but a wrong login (401), not a malformed request (422).
    assert (
        anon.post("/auth/login", json={"login": "a", "password": "b"}).status_code
        == 401
    )


def test_the_longest_email_is_accepted_and_one_more_is_not(anon):
    local, domain = "a" * 64, "b" * 63 + "." + "c" * 63 + "." + "d" * 57 + ".com"
    longest = f"{local}@{domain}"
    assert len(longest) == 254
    assert register(anon, email=longest).status_code == 201
    too_long = f"{local}@{domain.replace('d' * 57, 'd' * 58)}"
    assert len(too_long) == 255
    assert register(anon, email=too_long, username="second").status_code == 422


def test_login_needs_both_fields_and_refuses_extras(anon):
    assert anon.post("/auth/login", json={"login": "yuly"}).status_code == 422
    assert anon.post("/auth/login", json={"password": PASSWORD}).status_code == 422
    assert (
        anon.post("/auth/login", json={"login": "", "password": "x"}).status_code == 422
    )
    assert (
        anon.post("/auth/login", json={"login": "x", "password": ""}).status_code == 422
    )
    assert (
        anon.post(
            "/auth/login", json={"login": "x", "password": "y", "z": 1}
        ).status_code
        == 422
    )
    assert (
        anon.post("/auth/login", json={"login": "x" * 255, "password": "y"}).status_code
        == 422
    )
    assert (
        anon.post("/auth/login", json={"login": "x", "password": "y" * 129}).status_code
        == 422
    )


def test_login_failures_are_limited_per_address_and_account(anon, monkeypatch):
    monkeypatch.setattr(security.login_failures, "limit", 3)
    register(anon)
    register(anon, email="b@example.com", username="second")
    for _ in range(3):
        assert login(anon, password="wrong wrong wrong").status_code == 401
    blocked = login(anon, password="wrong wrong wrong")
    assert blocked.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert int(blocked.headers["retry-after"]) >= 1
    assert login(anon).status_code == 429  # even the right password waits
    assert login(anon, name="second").status_code == 200  # another account is fine


def test_a_good_login_clears_the_failures(anon, monkeypatch):
    monkeypatch.setattr(security.login_failures, "limit", 3)
    register(anon)
    for _ in range(2):
        login(anon, password="wrong wrong wrong")
    assert login(anon).status_code == 200
    for _ in range(2):
        assert login(anon, password="wrong wrong wrong").status_code == 401


def test_every_login_attempt_from_one_address_is_limited(anon, monkeypatch):
    monkeypatch.setattr(security.login_attempts, "limit", 2)
    register(anon)
    assert login(anon).status_code == 200
    assert login(anon).status_code == 200
    assert login(anon).status_code == 429


# --- the token ----------------------------------------------------------------
def test_me_and_logout_need_a_login(anon):
    assert anon.get("/auth/me").status_code == 401
    assert anon.post("/auth/logout").status_code == 401


def test_logout_ends_that_login_only(anon):
    register(anon)
    one, two = login(anon).json()["token"], login(anon).json()["token"]
    assert anon.post("/auth/logout", headers=bearer(one)).status_code == 204
    assert anon.get("/auth/me", headers=bearer(one)).status_code == 401
    assert anon.get("/shots", headers=bearer(one)).status_code == 401
    assert anon.get("/auth/me", headers=bearer(two)).status_code == 200


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "Bearer",
        "Bearer ",
        "Bearer nonsense",
        "Basic dXNlcjpwYXNz",
        "bearer-only",
        "Token abc",
    ],
)
def test_missing_or_bad_credentials_are_401(anon, header):
    headers = {} if header is None else {"Authorization": header}
    r = anon.get("/shots", headers=headers)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"
    assert r.json() == {"detail": "Not logged in, or the login has expired"}


def test_the_scheme_name_is_case_insensitive(anon):
    token = register(anon).json()["token"]
    assert (
        anon.get("/shots", headers={"Authorization": f"bearer {token}"}).status_code
        == 200
    )


def test_expired_token_stops_working_to_the_second(anon, session):
    token = register(anon).json()["token"]
    row = session.exec(select(AuthToken)).one()
    row.expires_at = security.utcnow() + timedelta(seconds=30)
    session.add(row)
    session.commit()
    assert anon.get("/auth/me", headers=bearer(token)).status_code == 200
    row.expires_at = security.utcnow() - timedelta(seconds=1)
    session.add(row)
    session.commit()
    assert anon.get("/auth/me", headers=bearer(token)).status_code == 401


def test_a_token_whose_account_is_gone_is_refused(anon, session):
    token = register(anon).json()["token"]
    session.delete(session.exec(select(User)).one())
    session.commit()
    assert anon.get("/auth/me", headers=bearer(token)).status_code == 401
