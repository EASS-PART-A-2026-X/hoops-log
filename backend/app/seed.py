from sqlmodel import Session, select

from app.models import Shot

# Plain dicts, so each call builds new Shot objects and no session ever shares one.
SEED_ROWS = [
    {
        "player": "Yuly",
        "x": 25.0,
        "y": 6.0,
        "made": True,
        "game_date": "2026-10-12",
        "note": "Layup off the fast break",
    },
    {
        "player": "Yuly",
        "x": 2.0,
        "y": 3.0,
        "made": False,
        "game_date": "2026-10-12",
        "note": "Left corner three",
    },
    {"player": "Noam", "x": 25.0, "y": 30.0, "made": True, "game_date": "2026-10-19"},
]


def seed(session: Session) -> None:
    """Insert the demo shots, but only into an empty table, so running it twice is safe."""
    if session.exec(select(Shot).limit(1)).first() is not None:
        return
    session.add_all(Shot.model_validate(row) for row in SEED_ROWS)
    session.commit()
