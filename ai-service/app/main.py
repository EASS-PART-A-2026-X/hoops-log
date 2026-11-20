from fastapi import FastAPI

from app.routers import chat, health

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
