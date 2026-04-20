# DATABASE NOTE:
# Currently using SQLite via named Docker volume — acceptable for development.
# To migrate to PostgreSQL: swap DATABASE_URL to postgresql://... and
# run flask db upgrade (or equivalent). All auth logic is ORM-abstracted
# and requires no changes beyond the connection string.

from peewee import DatabaseProxy
from playhouse.sqliteq import SqliteQueueDatabase

# Database proxy that will be bound to either:
# - a SqliteQueueDatabase (default, small installs)
# - or a Postgres database (via DATABASE_URL) for larger installs.
db = DatabaseProxy()


def init_database(database_path: str | None = None, database_url: str | None = None):
    """
    Initialize the global Peewee database.

    - If DATABASE_URL is provided, we delegate to playhouse.db_url.connect()
      so Postgres (or other backends) can be used.
    - Otherwise, we fall back to SqliteQueueDatabase for simple/small installs.
    """
    if database_url:
        from playhouse.db_url import connect

        database = connect(database_url)
    else:
        if not database_path:
            raise ValueError("database_path is required when DATABASE_URL is not set")

        database = SqliteQueueDatabase(
            database_path,
            pragmas={
                "journal_mode": "wal",       # allows concurrent reads during writes
                "cache_size": -1024 * 32,    # 32MB page cache
                "foreign_keys": 1,           # enforce FK constraints
                "synchronous": "normal",     # safe + faster than 'full'
                "busy_timeout": 5000,        # wait up to 5s on lock instead of failing
            },
            autostart=False,
            queue_max_size=64,
            results_timeout=5.0,
        )
        # Start the background write queue for SQLite.
        database.start()

    # Bind the concrete database instance to the proxy used by models.
    db.initialize(database)
    return database