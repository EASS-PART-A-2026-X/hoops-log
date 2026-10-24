from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import ShotStore, app, get_store


@pytest.fixture
def client() -> Iterator[TestClient]:
    store = ShotStore()  # a fresh, empty store for every test
    app.dependency_overrides[get_store] = lambda: store
    yield TestClient(app)
    app.dependency_overrides.clear()
