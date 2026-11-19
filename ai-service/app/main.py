from fastapi import FastAPI

from app.routers import extract, health

app = FastAPI(
    title="Hoops Log AI service",
    version="0.1.0",
    description=(
        "Reads a player's free-text shot notes and proposes shots to log. "
        "It never saves anything: the backend owns all stored data."
    ),
)
app.include_router(health.router)
app.include_router(extract.router)
