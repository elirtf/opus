from playhouse.sqliteq import SqliteQueueDatabase

# SqliteQueueDatabase serializes all writes through a background thread.
# This is critical for an NVR where multiple cameras/processes write simultaneously.
# autostart=False so we start it manually inside create_app() after config is loaded.
db = SqliteQueueDatabase(
    None,                   # path set later via db.init()
    pragmas={
        "journal_mode": "wal",      # WAL mode allows concurrent reads during writes
        "cache_size": -1024 * 32,   # 32MB page cache
        "foreign_keys": 1,          # enforce FK constraints
        "synchronous": "normal",    # safe + faster than "full"
    },
    autostart=False,
    queue_max_size=64,      # max pending writes before blocking
    results_timeout=5.0,    # seconds to wait for a write result
)