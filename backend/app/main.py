from fastapi import FastAPI

app = FastAPI(title="My Product API")

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
