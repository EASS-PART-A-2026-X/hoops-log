"""Accounts: the tables and the request and response bodies of /auth."""

import re
import unicodedata
from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)
from sqlmodel import Field as SQLField
from sqlmodel import SQLModel

from app.models import _printable_text

USERNAME_PATTERN = re.compile(r"[A-Za-z0-9_.-]{3,30}")
MIN_PASSWORD = 10
MAX_PASSWORD = 128

# The passwords that fill every "most used" list. Length 10 already removes most of
# them; this catches the ones that are long enough anyway.
COMMON_PASSWORDS = frozenset(
    {
        "0123456789",
        "1234567890",
        "12345678910",
        "1q2w3e4r5t",
        "abcdefghij",
        "admin12345",
        "basketball",
        "iloveyou123",
        "letmein123",
        "password",
        "password1",
        "password12",
        "password123",
        "password1234",
        "passw0rd123",
        "qwertyuiop",
        "qwerty12345",
        "welcome123",
    }
)


class User(SQLModel, table=True):
    """One account. The password is stored only as a salted scrypt hash."""

    __tablename__ = "account"

    id: int | None = SQLField(default=None, primary_key=True)
    email: str = SQLField(unique=True, index=True)  # always lower case
    username: str  # as typed, so "Yuly" stays "Yuly"
    username_key: str = SQLField(unique=True, index=True)  # lower case, for uniqueness
    password_hash: str
    created_at: datetime


class AuthToken(SQLModel, table=True):
    """One login. Only the SHA-256 of the token is stored, never the token."""

    __tablename__ = "auth_token"

    id: int | None = SQLField(default=None, primary_key=True)
    token_hash: str = SQLField(unique=True, index=True)
    user_id: int = SQLField(foreign_key="account.id", index=True)
    created_at: datetime
    expires_at: datetime


def _username(value: str) -> str:
    if not USERNAME_PATTERN.fullmatch(value):
        raise ValueError(
            "username must be 3 to 30 characters: letters, digits, _ . or -"
        )
    return value


def _password(value: str) -> str:
    # Passwords are never trimmed: a space at the end is part of the password.
    _printable_text(value)
    if value.casefold() in COMMON_PASSWORDS:
        raise ValueError("that password is too common, pick another one")
    return value


# EmailStr already refuses more than 254 characters (the limit in the email standard).
Email = Annotated[EmailStr, StringConstraints(to_lower=True)]
Username = Annotated[
    str, StringConstraints(strip_whitespace=True), AfterValidator(_username)
]
Password = Annotated[
    str,
    Field(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD),
    AfterValidator(_password),
]


class RegisterBody(SQLModel):
    """POST /auth/register. The password has to be typed twice."""

    model_config = ConfigDict(extra="forbid")

    email: Email
    username: Username
    password: Password
    password_confirm: Annotated[str, Field(max_length=MAX_PASSWORD)]

    @model_validator(mode="after")
    def _check_passwords(self) -> RegisterBody:
        if self.password != self.password_confirm:
            raise ValueError("the two passwords do not match")
        forbidden = {self.username.casefold(), str(self.email).split("@")[0].casefold()}
        if self.password.casefold() in forbidden:
            raise ValueError("the password cannot be your username or your email")
        return self


class LoginBody(SQLModel):
    """POST /auth/login. `login` is the username or the email."""

    model_config = ConfigDict(extra="forbid")

    login: Annotated[str, Field(min_length=1, max_length=254)]
    password: Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD)]


class UserPublic(SQLModel):
    id: int
    email: str
    username: str


class TokenResponse(SQLModel):
    token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserPublic


def username_key(username: str) -> str:
    return unicodedata.normalize("NFKC", username).casefold()
