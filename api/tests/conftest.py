import os

SECRET = "test-secret-" + "x" * 40

# `app.main` reads the settings when it is imported, which would load the developer's real
# .env (and refuse to start on a weak JWT_SECRET there). Environment variables win over the
# .env file, so pin the test secret first: the suite must not depend on private local config.
os.environ["JWT_SECRET"] = SECRET

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth_routes, main  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402
from app.db import connect, get_conn, init_schema  # noqa: E402
PASSWORD = "correct horse battery"


def make_settings(**overrides) -> Settings:
    values = {"jwt_secret": SECRET, "allow_registration": True, **overrides}
    return Settings(_env_file=None, **values)


def sign_up(c: TestClient, email: str) -> dict:
    r = c.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def client(tmp_path):
    """A client signed in as the first user (id 1, alice@example.com), on a fresh database.

    `client.new_user(email)` returns another signed-in client on the same database, for tests
    that check one user cannot see or change another's data.
    """
    db = str(tmp_path / "test.db")
    init = connect(db)
    init_schema(init)

    def _conn():
        c = connect(db)
        yield c

    main.app.dependency_overrides[get_conn] = _conn
    main.app.dependency_overrides[get_settings] = lambda: make_settings()
    auth_routes.reset_throttle()

    opened: list[TestClient] = []

    def new_user(email: str) -> TestClient:
        c = TestClient(main.app)
        c.__enter__()
        opened.append(c)
        tokens = sign_up(c, email)
        c.headers["Authorization"] = f"Bearer {tokens['access_token']}"
        c.tokens = tokens
        c.db_path = db
        return c

    first = new_user("alice@example.com")
    first.user_id = 1
    first.new_user = new_user
    try:
        yield first
    finally:
        for c in opened:
            c.__exit__(None, None, None)
        main.app.dependency_overrides.clear()
        auth_routes.reset_throttle()


@pytest.fixture
def anon(client):
    """A client with no credentials, on the same database as `client`."""
    c = TestClient(main.app)
    c.__enter__()
    yield c
    c.__exit__(None, None, None)


@pytest.fixture
def db_conn(tmp_path):
    """A plain connection to a fresh database with the schema applied."""
    conn = connect(str(tmp_path / "unit.db"))
    init_schema(conn)
    return conn
