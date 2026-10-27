from sqlmodel import Session, select

from app.models import Shot

# Plain dicts, so each call builds new Shot objects and no session ever shares one.
SEED: list[dict] = [
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


def seed_if_empty(session: Session) -> int:
    """Insert the demo shots only when the table is empty. Returns rows added."""
    if session.exec(select(Shot).limit(1)).first() is not None:
        return 0
    # Seeds are input too: model_validate checks the limits; Shot(**row) does not.
    session.add_all([Shot.model_validate(row) for row in SEED])
    session.commit()
    return len(SEED)
