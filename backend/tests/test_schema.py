"""The database enforces what the routes check, so a bug in a route cannot break it.

Each rule is tested at the database itself (not through a route, which would catch the
problem first and hide a missing constraint).
"""

import pytest
from sqlalchemy import Engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app import security
from app.users import AuthToken, User


def indexed(engine: Engine, table: str) -> set[tuple[str, ...]]:
    return {
        tuple(index["column_names"]) for index in inspect(engine).get_indexes(table)
    }


def unique(engine: Engine, table: str) -> set[tuple[str, ...]]:
    return {
        tuple(index["column_names"])
        for index in inspect(engine).get_indexes(table)
        if index["unique"]
    }


def user(**changes) -> User:
    fields = {
        "email": "a@example.com",
        "username": "A",
        "username_key": "a",
        "password_hash": "x",
        "created_at": security.utcnow(),
    }
    return User(**{**fields, **changes})


def test_two_accounts_cannot_share_an_email_or_a_username(session: Session):
    session.add(user())
    session.commit()
    for clash in ({"username": "B", "username_key": "b"}, {"email": "b@example.com"}):
        session.add(user(**clash))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_a_login_hash_cannot_appear_twice(session: Session):
    account = user()
    session.add(account)
    session.commit()
    now = security.utcnow()
    row = {
        "token_hash": "same",
        "user_id": account.id,
        "created_at": now,
        "expires_at": now,
    }
    session.add(AuthToken(**row))
    session.commit()
    session.add(AuthToken(**row))
    with pytest.raises(IntegrityError):
        session.commit()


def test_the_columns_that_are_looked_up_have_an_index(engine: Engine):
    assert ("email",) in indexed(engine, "account")
    assert ("username_key",) in indexed(engine, "account")
    assert ("token_hash",) in indexed(engine, "auth_token")
    assert ("user_id",) in indexed(engine, "auth_token")
    assert ("owner_id",) in indexed(engine, "shot")


def test_and_the_names_and_tokens_are_unique_there_too(engine: Engine):
    assert ("email",) in unique(engine, "account")
    assert ("username_key",) in unique(engine, "account")
    assert ("token_hash",) in unique(engine, "auth_token")
