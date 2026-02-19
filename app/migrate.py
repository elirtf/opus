import sqlite3
import os
import logging

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def run_migrations(db_path: str):
    """
    Minimal migration runner using plain sqlite3 — no peewee_migrate.

    Uses a direct sqlite3 connection (not SqliteQueueDatabase) because
    migrations run once at startup before the queue thread is needed,
    and plain sqlite3 has no transaction restrictions.

    Tracks applied migrations in a 'migratehistory' table.
    Runs each pending migration file in order, wrapping each in a transaction
    so a failed migration doesn't leave the DB in a partial state.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        # Create the history table if it doesn't exist
        conn.execute("""
                     CREATE TABLE IF NOT EXISTS migratehistory (
                                                                   id        INTEGER PRIMARY KEY AUTOINCREMENT,
                                                                   name      TEXT NOT NULL UNIQUE,
                                                                   applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
                     )
                     """)
        conn.commit()

        # Find all migration files, sorted by name (001_, 002_, etc.)
        migration_files = sorted(
            f[:-3] for f in os.listdir(MIGRATIONS_DIR)
            if f.endswith(".py") and not f.startswith("_")
        )

        # Find which have already been applied
        applied = {
            row["name"]
            for row in conn.execute("SELECT name FROM migratehistory")
        }

        pending = [m for m in migration_files if m not in applied]

        if not pending:
            logger.debug("Database up to date — no migrations to run.")
            return

        logger.info(f"Applying {len(pending)} migration(s): {pending}")

        for name in pending:
            path = os.path.join(MIGRATIONS_DIR, f"{name}.py")
            spec = {}
            with open(path) as f:
                exec(compile(f.read(), path, "exec"), spec)

            migrate_fn = spec.get("migrate")
            if not migrate_fn:
                logger.warning(f"Migration {name} has no migrate() function — skipping.")
                continue

            try:
                with conn:  # auto-commits or rolls back on exception
                    migrate_fn(conn)
                    conn.execute(
                        "INSERT INTO migratehistory (name) VALUES (?)", (name,)
                    )
                logger.info(f"  ✓ {name}")
            except Exception as e:
                logger.error(f"  ✗ {name} failed: {e}")
                raise  # abort startup — don't run the app with a broken schema

    finally:
        conn.close()