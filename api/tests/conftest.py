import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import Settings, get_settings
from app.db import connect, get_conn, init_schema

KEY = "test-key"


@pytest.fixture
def client(tmp_path):
    db = str(tmp_path / "test.db")
    init = connect(db)
    init_schema(init)

    def _conn():
        c = connect(db)
        yield c

    main.app.dependency_overrides[get_conn] = _conn
    main.app.dependency_overrides[get_settings] = lambda: Settings(api_key=KEY, _env_file=None)
    with TestClient(main.app, headers={"X-API-Key": KEY}) as c:
        c.db_path = db  # lets a test write to the database directly, bypassing API validation
        yield c
    main.app.dependency_overrides.clear()


@pytest.fixture
def db_conn(tmp_path):
    """A plain connection to a fresh database with the schema applied."""
    conn = connect(str(tmp_path / "unit.db"))
    init_schema(conn)
    return conn
