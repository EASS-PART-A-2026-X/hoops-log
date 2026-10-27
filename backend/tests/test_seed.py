from sqlmodel import Session, select

from app.models import Shot
from app.seed import SEED_ROWS, seed


def test_seed_is_idempotent(session: Session):
    seed(session)
    seed(session)
    assert len(session.exec(select(Shot)).all()) == len(SEED_ROWS)


def test_seed_does_not_touch_existing_data(session: Session):
    session.add(Shot(player="Existing", x=10, y=10, made=True))
    session.commit()
    seed(session)
    assert [s.player for s in session.exec(select(Shot)).all()] == ["Existing"]
