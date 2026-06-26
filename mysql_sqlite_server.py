"""
MySQL wire-protocol server backed by SQLite.

WeaponPaints (which only supports MySQL) connects here on 127.0.0.1:3306.
Queries are translated from MySQL to SQLite dialect and executed against skins.db.
No MySQL or XAMPP installation required.
"""

import asyncio
import os
import re
import sqlite3
import sys
import threading

from mysql_mimic import MysqlServer
from mysql_mimic.results import ResultColumn
from mysql_mimic.session import Session
from mysql_mimic.types import ColumnType

def _db_path() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.dirname(sys.executable), 'skins.db')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'skins.db')

DB_PATH: str = _db_path()

_SKIP = re.compile(
    r'^\s*(SET\b|USE\b|CREATE\s+DATABASE|DROP\s+DATABASE|SHOW\b|SELECT\s+@@)',
    re.IGNORECASE,
)

_BOOL_COLS = frozenset({'weapon_stattrak'})

def _py_to_col_type(name: str, val) -> ColumnType:
    """Map a Python value to the MySQL wire type WeaponPaints expects."""
    if name in _BOOL_COLS:
        return ColumnType.TINY
    if isinstance(val, float):
        return ColumnType.FLOAT
    if isinstance(val, int):
        return ColumnType.LONG
    return ColumnType.VAR_STRING

def _to_sqlite(sql: str) -> str | None:
    """
    Translate a MySQL SQL statement to SQLite.
    Returns None to silently return OK (no rows) without executing.
    """
    s = sql.strip()
    if not s:
        return None
    if _SKIP.match(s):
        return None

    if re.search(r'\bON\s+DUPLICATE\s+KEY\s+UPDATE\b', s, re.IGNORECASE):
        s = re.sub(r'\bINSERT\b', 'INSERT OR REPLACE', s,
                   count=1, flags=re.IGNORECASE)
        s = re.sub(r'\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\b.*', '', s,
                   flags=re.IGNORECASE | re.DOTALL)

    if re.match(r'^\s*CREATE\s+TABLE', s, re.IGNORECASE):
        s = re.sub(r"\bCOMMENT\s+'[^']*'", '', s, flags=re.IGNORECASE)
        s = re.sub(r'\bENGINE\s*=\s*\S+', '', s, flags=re.IGNORECASE)
        s = re.sub(r'\bDEFAULT\s+CHARSET\s*=\s*\S+', '', s, flags=re.IGNORECASE)
        s = re.sub(r'\bCHARSET\s*=\s*\S+', '', s, flags=re.IGNORECASE)
        s = re.sub(r'\bCOLLATE\s*=?\s*\S+', '', s, flags=re.IGNORECASE)
        s = re.sub(r',\s*\)\s*$', '\n)', s.rstrip(';')).rstrip()

    return s

class _SqliteSession(Session):
    def __init__(self):
        super().__init__()
        self._conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute('PRAGMA journal_mode=WAL')
        self._conn.execute('PRAGMA busy_timeout=5000')
        self._conn.commit()

    async def query(self, expression, sql, attrs):
        stmt = _to_sqlite(sql)
        if not stmt:
            return None
        try:
            cur = self._conn.execute(stmt)
            self._conn.commit()
            if cur.description:
                col_names = [d[0] for d in cur.description]
                rows = [tuple(row) for row in cur.fetchall()]
                if rows:
                    cols = [
                        ResultColumn(name, _py_to_col_type(name, val))
                        for name, val in zip(col_names, rows[0])
                    ]
                else:
                    cols = col_names
                return rows, cols
            return None
        except Exception:
            return None

    async def schema(self):
        return {}

def start():
    """Start the MySQL-over-SQLite server in a daemon thread. Blocks until ready."""
    async def _serve():
        srv = MysqlServer(
            host='127.0.0.1',
            port=3306,
            session_factory=_SqliteSession,
        )
        await srv.start_server()
        await srv.serve_forever()

    threading.Thread(target=lambda: asyncio.run(_serve()), daemon=True).start()
    import time
    time.sleep(1.5)
