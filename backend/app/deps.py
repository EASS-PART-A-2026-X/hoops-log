"""Who is calling: turns the `Authorization: Bearer <token>` header into a user."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db import SessionDep
from app.security import find_login
from app.users import AuthToken, User

# auto_error is off so a missing header is a 401 like every other failure (the
# default would be 403). The scheme still shows up in /docs as the Authorize button.
bearer = HTTPBearer(auto_error=False, description="The token from /auth/login")

UNAUTHORIZED = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Not logged in, or the login has expired",
    headers={"WWW-Authenticate": "Bearer"},
)


def current_login(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> AuthToken:
    if credentials is None:
        raise UNAUTHORIZED
    login = find_login(session, credentials.credentials)
    if login is None:
        raise UNAUTHORIZED
    return login


def current_user(
    session: SessionDep, login: Annotated[AuthToken, Depends(current_login)]
) -> User:
    user = session.get(User, login.user_id)
    if user is None:  # the account is gone but the token is not: treat it as logged out
        raise UNAUTHORIZED
    return user


CurrentLogin = Annotated[AuthToken, Depends(current_login)]
CurrentUser = Annotated[User, Depends(current_user)]
