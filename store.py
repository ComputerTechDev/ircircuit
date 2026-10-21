import json
import os
import sqlite3
import threading

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT_DIR, "data", "ircircuit.db")

_lock = threading.Lock()
_conn = None


def _get_conn():
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                network TEXT NOT NULL,
                channel TEXT NOT NULL,
                ts      REAL NOT NULL,
                type    TEXT NOT NULL,
                nick    TEXT,
                text    TEXT,
                data    TEXT NOT NULL
            )
        """)
        _conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_net_chan_ts ON messages(network, channel, ts)")
        _conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                text, content='messages', content_rowid='id'
            )
        """)
        _conn.execute("""
            CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
            END
        """)
        _conn.commit()
    return _conn


def _row_text(record):
    return record.get("message") or record.get("topic") or ""


def insert_message(network, channel, record, ts=None):
    if ts is None:
        ts = record.get("ts")
    if ts is None:
        return
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO messages (network, channel, ts, type, nick, text, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (network, channel, ts, record.get("type", ""), record.get("nick", ""), _row_text(record), json.dumps(record)),
        )
        conn.commit()


def get_history_before(network, channel, before_ts, limit=100):
    with _lock:
        conn = _get_conn()
        if before_ts is None:
            cur = conn.execute(
                "SELECT data FROM messages WHERE network=? AND channel=? ORDER BY ts DESC, id DESC LIMIT ?",
                (network, channel, limit),
            )
        else:
            cur = conn.execute(
                "SELECT data FROM messages WHERE network=? AND channel=? AND ts < ? ORDER BY ts DESC, id DESC LIMIT ?",
                (network, channel, before_ts, limit),
            )
        rows = [json.loads(r[0]) for r in cur.fetchall()]
    rows.reverse()
    return rows


def has_any(network):
    with _lock:
        conn = _get_conn()
        cur = conn.execute("SELECT 1 FROM messages WHERE network=? LIMIT 1", (network,))
        return cur.fetchone() is not None


def migrate_backlog_json(net_id, backlog_dict):
    if has_any(net_id):
        return 0
    count = 0
    with _lock:
        conn = _get_conn()
        for channel, msgs in backlog_dict.items():
            last_ts = 0.0
            for m in msgs:
                ts = m.get("ts")
                if ts is None:
                    ts = last_ts + 0.001
                last_ts = ts
                conn.execute(
                    "INSERT INTO messages (network, channel, ts, type, nick, text, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (net_id, channel, ts, m.get("type", ""), m.get("nick", ""), _row_text(m), json.dumps(m)),
                )
                count += 1
        conn.commit()
    return count
