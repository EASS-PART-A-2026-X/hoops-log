import logging

from fastapi import FastAPI

from app.routers import chat, health

# The server shows warnings and errors by default; this service also says what each
# request cost.
_log = logging.getLogger("app")
if not _log.handlers:
    _handler = logging.StreamHandler()
    _fmt = "%(levelname)s:     %(name)s: %(message)s"
    _handler.setFormatter(logging.Formatter(_fmt))
    _log.addHandler(_handler)
_log.setLevel(logging.INFO)

app = FastAPI(
    title="Hoops Log AI service",
    version="0.1.0",
    description=(
        "Deni's brain: answers a player's chat messages about their own numbers "
        "and proposes the shots they describe. "
        "It never saves anything: the backend owns all stored data."
    ),
)
app.include_router(health.router)
app.include_router(chat.router)
