from datetime import datetime, timedelta, timezone

import jwt

from app import auth_routes, main
from app.config import get_settings
from app.db import connect
from app.security import create_access_token, decode_access_token, hash_password, verify_password
from tests.conftest import PASSWORD, SECRET, make_settings


def login(c, email="alice@example.com", password=PASSWORD):
    return c.post("/auth/login", json={"email": email, "password": password})


# ---------- security helpers ----------
def test_password_hash_verifies_and_is_salted():
    h = hash_password("a long enough password")
    assert h != hash_password("a long enough password")
    assert verify_password(h, "a long enough password")
    assert not verify_password(h, "another password")


def test_verify_against_no_user_is_always_false():
    assert not verify_password(None, "anything")


def test_access_token_round_trip_and_rejections():
    token = create_access_token(7, SECRET, 15)
    assert decode_access_token(token, SECRET) == 7
    assert decode_access_token(token, "a different secret, long enough to be valid") is None
    assert decode_access_token("garbage", SECRET) is None
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    assert decode_access_token(create_access_token(7, SECRET, 15, now=past), SECRET) is None


def test_token_of_the_wrong_kind_or_algorithm_is_rejected():
    now = datetime.now(timezone.utc)
    claims = {"sub": "1", "typ": "refresh", "iat": now, "exp": now + timedelta(minutes=5)}
    assert decode_access_token(jwt.encode(claims, SECRET, algorithm="HS256"), SECRET) is None
    # "alg: none" must never be accepted
    unsigned = jwt.encode({**claims, "typ": "access"}, None, algorithm="none")
    assert decode_access_token(unsigned, SECRET) is None


# ---------- register / login ----------
def test_register_returns_tokens_that_work(anon, client):
    r = anon.post("/auth/register", json={"email": "Bob@Example.com ", "password": PASSWORD})
    assert r.status_code == 201
    body = r.json()
    assert body["token_type"] == "bearer" and body["expires_in"] == 15 * 60
    me = anon.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == "bob@example.com"


def test_register_is_closed_by_default(anon):
    main.app.dependency_overrides[get_settings] = lambda: make_settings(allow_registration=False)
    r = anon.post("/auth/register", json={"email": "bob@example.com", "password": PASSWORD})
    assert r.status_code == 403


def test_register_validates_email_and_password(anon):
    bad = [
        {"email": "not-an-email", "password": PASSWORD},
        {"email": "bob@example.com", "password": "short"},
        {"email": "bob@example.com", "password": "x" * 129},
    ]
    for body in bad:
        assert anon.post("/auth/register", json=body).status_code == 422, body


def test_duplicate_email_is_409_case_insensitively(anon):
    r = anon.post("/auth/register", json={"email": "ALICE@example.com", "password": PASSWORD})
    assert r.status_code == 409


def test_login_succeeds_and_wrong_credentials_give_one_message(anon):
    assert login(anon).status_code == 200
    wrong_pw = login(anon, password="wrong password!!")
    unknown = login(anon, email="nobody@example.com")
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json() == unknown.json()  # does not reveal which emails exist


def test_passwords_are_not_stored_in_the_clear(client):
    db = connect(client.db_path)
    stored = db.execute("SELECT password_hash FROM users").fetchall()
    assert stored and all(PASSWORD not in row[0] and row[0].startswith("$argon2") for row in stored)


def test_refresh_tokens_are_stored_hashed(client):
    db = connect(client.db_path)
    stored = {row[0] for row in db.execute("SELECT token_hash FROM refresh_tokens").fetchall()}
    assert client.tokens["refresh_token"] not in stored


# ---------- throttle ----------
def test_repeated_failures_lock_the_account_with_retry_after(anon):
    for _ in range(5):
        assert login(anon, password="wrong password!!").status_code == 401
    locked = login(anon, password="wrong password!!")
    assert locked.status_code == 429 and int(locked.headers["Retry-After"]) > 0
    # even the right password is refused while locked
    assert login(anon).status_code == 429


def test_reset_clears_one_key_only():
    from app.ratelimit import LoginThrottle

    t = LoginThrottle(max_failures=1, window_seconds=60)
    t.record_failure("email:a", now=0)
    t.record_failure("ip:x", now=0)
    t.reset("email:a")
    assert t.retry_after("email:a", now=1) == 0
    # a successful login must not wipe the per-address counter, or an attacker could reset it
    # by signing in to an account of their own
    assert t.retry_after("ip:x", now=1) > 0


def test_throttle_window_expires():
    from app.ratelimit import LoginThrottle

    t = LoginThrottle(max_failures=2, window_seconds=60)
    t.record_failure("k", now=0)
    t.record_failure("k", now=1)
    assert t.retry_after("k", now=2) > 0
    assert t.retry_after("k", now=100) == 0


# ---------- protected routes ----------
def test_expired_access_token_is_401(client, anon):
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    old = create_access_token(1, SECRET, 15, now=past)
    r = anon.get("/trades", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 401 and r.headers["WWW-Authenticate"] == "Bearer"


def test_token_signed_with_another_secret_is_401(anon):
    forged = create_access_token(1, "not the server secret " * 3, 15)
    assert anon.get("/trades", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_token_for_a_deleted_account_cannot_read_me(client):
    db = connect(client.db_path)
    db.execute("DELETE FROM users WHERE id = 1")
    db.commit()
    assert client.get("/auth/me").status_code == 401


def test_without_a_secret_the_server_fails_closed_everywhere(client):
    from app.config import Settings

    main.app.dependency_overrides[get_settings] = lambda: Settings(jwt_secret="", _env_file=None)
    assert client.get("/trades").status_code == 503
    assert login(client).status_code == 503


# ---------- refresh / logout ----------
def test_refresh_rotates_the_token(client, anon):
    old = client.tokens["refresh_token"]
    r = anon.post("/auth/refresh", json={"refresh_token": old})
    assert r.status_code == 200
    new = r.json()
    assert new["refresh_token"] != old
    ok = anon.get("/auth/me", headers={"Authorization": f"Bearer {new['access_token']}"})
    assert ok.status_code == 200
    # the old one is single use
    assert anon.post("/auth/refresh", json={"refresh_token": old}).status_code == 401


def test_replaying_a_used_refresh_token_ends_the_whole_session_family(client, anon):
    first = client.tokens["refresh_token"]
    second = anon.post("/auth/refresh", json={"refresh_token": first}).json()["refresh_token"]
    # an attacker (or confused client) presents the already-used first token
    assert anon.post("/auth/refresh", json={"refresh_token": first}).status_code == 401
    # which also killed the legitimate newer token
    assert anon.post("/auth/refresh", json={"refresh_token": second}).status_code == 401


def test_refresh_rejects_unknown_and_expired_tokens(client, anon):
    assert anon.post("/auth/refresh", json={"refresh_token": "nope"}).status_code == 401
    db = connect(client.db_path)
    db.execute("UPDATE refresh_tokens SET expires_at = '2000-01-01T00:00:00.000000Z'")
    db.commit()
    assert anon.post("/auth/refresh", json={"refresh_token": client.tokens["refresh_token"]}).status_code == 401


def test_logout_revokes_the_session_and_is_idempotent(client, anon):
    token = client.tokens["refresh_token"]
    assert anon.post("/auth/logout", json={"refresh_token": token}).status_code == 204
    assert anon.post("/auth/logout", json={"refresh_token": token}).status_code == 204
    assert anon.post("/auth/logout", json={"refresh_token": "never existed"}).status_code == 204
    assert anon.post("/auth/refresh", json={"refresh_token": token}).status_code == 401


def test_one_users_logout_does_not_touch_another_session(client):
    other = client.new_user("bob@example.com")
    client.post("/auth/logout", json={"refresh_token": client.tokens["refresh_token"]})
    assert client.post("/auth/refresh", json={"refresh_token": other.tokens["refresh_token"]}).status_code == 200


def teardown_function():
    auth_routes.reset_throttle()
