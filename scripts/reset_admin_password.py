#!/usr/bin/env python3
"""
Reset a user's password in the Opus database (same DB as the running app).

Typical use (from the machine that runs Docker):

    docker compose exec opus python scripts/reset_admin_password.py
    docker compose exec opus python scripts/reset_admin_password.py --username admin --password your-new-password
"""
from __future__ import annotations

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset an Opus user password.")
    parser.add_argument("--username", default="admin", help="Username (default: admin)")
    parser.add_argument("--password", default="admin", help="New password (default: admin)")
    args = parser.parse_args()

    from app import create_app
    from app.models import User

    app = create_app()
    with app.app_context():
        try:
            user = User.get(User.username == args.username)
        except User.DoesNotExist:
            print(f'No user named {args.username!r}.', file=sys.stderr)
            sys.exit(1)
        user.set_password(args.password)
        user.save()
        print(f'Password updated for {args.username!r}.')


if __name__ == "__main__":
    main()
