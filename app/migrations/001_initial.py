"""
001_initial — baseline schema
Creates the user, nvr, and camera tables.
Safe to run against a fresh DB (uses IF NOT EXISTS).
"""


def migrate(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS "user" (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      VARCHAR(50)  NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role          VARCHAR(20)  NOT NULL DEFAULT 'viewer'
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS "nvr" (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          VARCHAR(50)  NOT NULL UNIQUE,
            display_name  VARCHAR(100) NOT NULL,
            ip_address    VARCHAR(50),
            username      VARCHAR(100),
            password      VARCHAR(100),
            max_channels  INTEGER NOT NULL DEFAULT 50,
            active        INTEGER NOT NULL DEFAULT 1
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS "camera" (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          VARCHAR(50)  NOT NULL UNIQUE,
            display_name  VARCHAR(100) NOT NULL,
            rtsp_url      VARCHAR(255) NOT NULL,
            nvr           INTEGER,
            active        INTEGER NOT NULL DEFAULT 1
        )
    """)


def rollback(conn):
    conn.execute('DROP TABLE IF EXISTS "camera"')
    conn.execute('DROP TABLE IF EXISTS "nvr"')
    conn.execute('DROP TABLE IF EXISTS "user"')