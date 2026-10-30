from sqlmodel import Session, select

from app.models import Shot, ShotCreate
from app.seed import SEED, seed_if_empty


def test_seed_is_idempotent(session: Session):
    for row in SEED:  # same rules as a POST body, including no unknown keys
        ShotCreate.model_validate(row)
    assert seed_if_empty(session) == len(SEED)
    assert seed_if_empty(session) == 0


def test_seed_does_not_touch_existing_data(session: Session):
    session.add(Shot(player="Existing", x=10, y=10, made=True))
    session.commit()
    assert seed_if_empty(session) == 0
    assert [s.player for s in session.exec(select(Shot)).all()] == ["Existing"]
