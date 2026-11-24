"""Create an account without opening public registration.

    python -m scripts.create_user you@example.com

Prompts for the password (not echoed). The first account created on a database that already holds
data from the single-user version gets id 1 and therefore owns that data.
"""

import getpass
import sys
from datetime import datetime, timezone

from app.auth_routes import MAX_PASSWORD, MIN_PASSWORD
from app.config import get_settings
from app.db import connect, init_schema
from app.security import hash_password


def main(argv: list[str]) -> int:
    if len(argv) != 2 or "@" not in argv[1]:
        print("usage: python -m scripts.create_user you@example.com", file=sys.stderr)
        return 2
    email = argv[1].strip().lower()

    password = getpass.getpass("Password: ")
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        print(f"Password must be {MIN_PASSWORD}-{MAX_PASSWORD} characters.", file=sys.stderr)
        return 1

    s = get_settings()
    conn = connect(s.turso_database_url, s.turso_auth_token)
    init_schema(conn)
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        print("An account with that email already exists.", file=sys.stderr)
        return 1
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
        (email, hash_password(password), datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")),
    )
    conn.commit()
    print(f"Created account {email} (id {cur.lastrowid}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
