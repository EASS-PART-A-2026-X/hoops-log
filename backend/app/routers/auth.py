from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db import SessionDep
from app.deps import CurrentLogin, CurrentUser
from app.security import (
    DUMMY_HASH,
    hash_password,
    issue_token,
    login_attempts,
    login_failures,
    register_attempts,
    utcnow,
    verify_password,
)
from app.users import (
    LoginBody,
    RegisterBody,
    TokenResponse,
    User,
    UserPublic,
    username_key,
)

router = APIRouter(prefix="/auth", tags=["auth"])

BAD_LOGIN = "Wrong username, email or password"


def too_many(wait: int) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Too many attempts. Try again in {wait} seconds.",
        headers={"Retry-After": str(wait)},
    )


def client_ip(request: Request) -> str:
    # Behind a proxy the server is started with --proxy-headers, which puts the real
    # address here. Reading X-Forwarded-For by hand would let anyone fake it.
    return request.client.host if request.client else "unknown"


def token_response(session: Session, user: User) -> TokenResponse:
    raw, row = issue_token(session, user)
    return TokenResponse(
        token=raw,
        expires_at=row.expires_at,
        user=UserPublic.model_validate(user, from_attributes=True),
    )


def taken(field: str) -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={"field": field, "message": f"That {field} is already used"},
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and log in",
)
def register(
    body: RegisterBody, session: SessionDep, request: Request
) -> TokenResponse:
    wait = register_attempts.hit(client_ip(request))
    if wait is not None:
        raise too_many(wait)
    email = str(body.email)
    key = username_key(body.username)
    if session.exec(select(User).where(User.email == email)).first() is not None:
        raise taken("email")
    if session.exec(select(User).where(User.username_key == key)).first() is not None:
        raise taken("username")
    user = User(
        email=email,
        username=body.username,
        username_key=key,
        password_hash=hash_password(body.password),
        created_at=utcnow(),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError:  # two requests with the same name at the same moment
        session.rollback()
        raise taken("username") from None
    session.refresh(user)
    return token_response(session, user)


@router.post("/login", response_model=TokenResponse, summary="Log in")
def login(body: LoginBody, session: SessionDep, request: Request) -> TokenResponse:
    ip = client_ip(request)
    wait = login_attempts.hit(ip)
    name = body.login.strip().casefold()
    failures_key = f"{ip}|{name}"
    wait = wait or login_failures.retry_after(failures_key)
    if wait is not None:
        raise too_many(wait)
    query = select(User).where(
        User.email == name if "@" in name else User.username_key == username_key(name)
    )
    user = session.exec(query).first()
    # An unknown account still pays for one hash, so the answer takes as long.
    stored = user.password_hash if user else DUMMY_HASH
    if not verify_password(body.password, stored) or user is None:
        login_failures.hit(failures_key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=BAD_LOGIN)
    login_failures.clear(failures_key)
    return token_response(session, user)


@router.get("/me", response_model=UserPublic, summary="Who am I")
def me(user: CurrentUser) -> User:
    return user


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="End this login (the token stops working at once)",
)
def logout(login: CurrentLogin, session: SessionDep) -> None:
    session.delete(login)
    session.commit()
