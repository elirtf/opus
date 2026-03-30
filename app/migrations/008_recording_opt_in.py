"""
Recording is opt-in: disable all cameras so nothing records until enabled in the UI
(after recording setup is completed).
"""


def migrate(conn):
    try:
        conn.execute("UPDATE camera SET recording_enabled = 0, recording_policy = 'off'")
    except Exception:
        try:
            conn.execute("UPDATE camera SET recording_enabled = 0")
        except Exception:
            pass
