from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from math import isfinite
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app import db
from app.routers import chart, health, shots
from app.seed import seed_if_empty


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.create_db_and_tables()
    with Session(db.engine) as session:
        seed_if_empty(session)
    yield
    db.engine.dispose()


app = FastAPI(
    title="Hoops Log API",
    version="0.3.0",
    description="Record basketball shots on a half court and read them back.",
    lifespan=lifespan,
)
app.include_router(health.router)
app.include_router(shots.router)
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
