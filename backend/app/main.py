import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from math import isfinite
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import db
from app.routers import auth, chart, demo, health, shots


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.create_db_and_tables()
    yield
    db.engine.dispose()


app = FastAPI(
    title="Hoops Log API",
    version="0.3.0",
    description="Record basketball shots on a half court and read them back.",
    lifespan=lifespan,
)
# The React dev server runs in the user's browser, so the browser checks CORS: the
# API must name the exact origin (scheme + host + port). "localhost" and "127.0.0.1"
# are different origins, so both are listed.
# FRONTEND_ORIGINS (comma separated) names the real addresses once the app is deployed.
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
    # A browser only lets the page read headers named here: the frontend shows how
    # long to wait after "too many attempts".
    expose_headers=["Retry-After"],
)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(shots.router)
app.include_router(demo.router)
app.include_router(chart.router)


def _json_safe(value: Any) -> Any:
    """Make a 422 body that can always be sent as JSON.

    FastAPI echoes the rejected input back in the error. If that input was NaN,
    Infinity or a lone surrogate, JSON encoding the error raised and the client got
    a 500 instead of the 422 it deserved.
    """
    if isinstance(value, dict):
        return {_json_safe(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, float) and not isfinite(value):
        return repr(value)
    if isinstance(value, str):
        return value.encode("utf-8", "backslashreplace").decode("utf-8")
    return value


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = _json_safe(jsonable_encoder(exc.errors()))
    return JSONResponse(status_code=422, content={"detail": detail})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    # The browser must not guess a type (an SVG chart is not a web page), and a login
    # or token answer must never be kept in a cache.
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/auth"):
        response.headers["Cache-Control"] = "no-store"
    return response
