from dataclasses import dataclass, field
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, status

from app.models import ShotCreate, ShotPublic, ShotUpdate


@dataclass
class ShotStore:
    """A dict standing in for a database. Restart the server: data is gone."""

    rows: dict[int, ShotPublic] = field(default_factory=dict)
    last_id: int = 0


store = ShotStore()


def get_store() -> ShotStore:
    return store  # tests swap in a fresh store via app.dependency_overrides


StoreDep = Annotated[ShotStore, Depends(get_store)]

app = FastAPI(title="Hoops Log API")


def get_or_404(store: ShotStore, shot_id: int) -> ShotPublic:
    if shot_id not in store.rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Shot not found")
    return store.rows[shot_id]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/shots")
def list_shots(
    store: StoreDep,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[ShotPublic]:
    return list(store.rows.values())[offset : offset + limit]


@app.post("/shots", status_code=status.HTTP_201_CREATED)
def create_shot(body: ShotCreate, store: StoreDep) -> ShotPublic:
    store.last_id += 1
    shot = ShotPublic(id=store.last_id, **body.model_dump())
    store.rows[shot.id] = shot
    return shot


@app.get("/shots/{shot_id}")
def get_shot(shot_id: int, store: StoreDep) -> ShotPublic:
    return get_or_404(store, shot_id)


@app.patch("/shots/{shot_id}")
def update_shot(shot_id: int, body: ShotUpdate, store: StoreDep) -> ShotPublic:
    shot = get_or_404(store, shot_id)
    # Only fields the client sent; null means "leave unchanged".
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    store.rows[shot_id] = shot.model_copy(update=changes)  # already validated
    return store.rows[shot_id]


@app.delete("/shots/{shot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shot(shot_id: int, store: StoreDep) -> None:
    get_or_404(store, shot_id)
    del store.rows[shot_id]
