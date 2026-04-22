"""
One-off password reset / admin recovery.

Usage (inside the opus container):

    docker compose exec opus python -m app.reset_password <username> <new_password>

Notes:
  - Updates User.password_hash in place using the same PBKDF2-SHA256 600k hashing
    as the normal set_password() path; no plaintext ever leaves this process.
  - If <username> doesn't exist and there are zero users in the DB, this will
    CREATE them as an admin (convenient for first-run recovery).
  - Otherwise it refuses to create new users — use the Configuration UI for that.
  - Does NOT touch SECRET_KEY or sessions; users already logged in elsewhere
    keep their sessions until they expire.
"""

from __future__ import annotations

import os
import sys

from app.database import db, init_database
from app.migrate import run_migrations
from app.models import User


def _usage() -> int:
    sys.stderr.write(
        "usage: python -m app.reset_password <username> <new_password>\n"
    )
    return 2


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        return _usage()
    username = argv[1].strip()
    password = argv[2]
    if not username or len(password) < 8:
        sys.stderr.write("username required; password must be at least 8 chars\n")
        return 2

    database_path = os.environ.get("DATABASE_PATH", "/app/instance/opus.db")
    database_url = os.environ.get("DATABASE_URL") or None

    if not database_url:
        os.makedirs(os.path.dirname(database_path), exist_ok=True)
    init_database(database_path=database_path, database_url=database_url)
    db.connect(reuse_if_open=True)

    # Ensure schema is at latest so password_hash column exists on fresh DBs.
    if not database_url:
        run_migrations(database_path)

    try:
        user = User.get(User.username == username)
        user.set_password(password)
        user.save()
        print(f"Password updated for user '{username}' (role={user.role}).")
    except User.DoesNotExist:
        if User.select().count() == 0:
            user = User(username=username, role="admin")
            user.set_password(password)
            user.save(force_insert=True)
            print(f"Admin user '{username}' created (empty DB).")
        else:
            sys.stderr.write(
                f"User '{username}' does not exist. "
                "Create new users via the Configuration UI.\n"
            )
            return 1
    finally:
        if not db.is_closed():
            db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
