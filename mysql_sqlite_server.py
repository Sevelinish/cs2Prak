"""
MySQL wire-protocol server backed by SQLite.

WeaponPaints (which only supports MySQL) connects here on 127.0.0.1:3306.
Queries are translated from MySQL to SQLite dialect and executed against skins.db.
No MySQL or XAMPP installation required.
"""

import asyncio
import logging
import os
import re
import sqlite3
import sys
import threading

from mysql_mimic import MysqlServer
from mysql_mimic import connection as _mm_connection
from mysql_mimic import packets as _mm_packets
from mysql_mimic.results import ResultColumn
from mysql_mimic.session import Session
from mysql_mimic.types import ColumnType

log = logging.getLogger('cs2prak.mysql')

# --------------------------------------------------------------------------
# TINYINT(1), not TINYINT(256)
#
# mysql_mimic builds every column definition with the default column_length of
# 256 and never lets a caller override it. MySqlConnector — which WeaponPaints
# uses — only surfaces a TINYINT as `bool` when the announced length is 1
# (TreatTinyAsBoolean, on by default); at any other length it hands back an
# sbyte. That is what produced:
#
#     An error occurred in GetWeaponPaintsFromDatabase:
#     Cannot implicitly convert type 'sbyte' to 'bool'
#
# from `bool weaponStatTrak = row.weapon_stattrak ?? false;` in
# WeaponSynchronization.cs. Declaring our TINY columns as length 1 is the whole
# fix. connection.py imports the builder both by name and through the module,
# so both bindings have to be replaced.
# --------------------------------------------------------------------------
def _install_tinyint1_patch() -> bool:
    original = _mm_packets.make_column_definition_41

    def patched(*args, **kwargs):
        if kwargs.get('column_type') is ColumnType.TINY:
            kwargs.setdefault('column_length', 1)
        return original(*args, **kwargs)

    try:
        _mm_packets.make_column_definition_41 = patched
        _mm_connection.make_column_definition_41 = patched
        _mm_connection.packets.make_column_definition_41 = patched
        return True
    except Exception as e:            # a future mysql_mimic could move this
        log.error('could not apply the TINYINT(1) patch: %s — '
                  'StatTrak reads will fail in WeaponPaints', e)
        return False

TINYINT1_PATCHED = _install_tinyint1_patch()

def _db_path() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.join(os.path.dirname(sys.executable), 'skins.db')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'skins.db')

DB_PATH: str = _db_path()

_SKIP = re.compile(
    r'^\s*(SET\b|USE\b|CREATE\s+DATABASE|DROP\s+DATABASE|SHOW\b|SELECT\s+@@)',
    re.IGNORECASE,
)

# Every statement is committed on its own, so the plugin's transaction wrapper
# has nothing to do. Answering OK is honest — the work is already durable —
# whereas passing these to SQLite raised "near START: syntax error" and
# "cannot rollback - no transaction is active" on every plugin start-up.
_TXN = re.compile(
    r'^\s*(START\s+TRANSACTION|BEGIN(\s+WORK)?|COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT)\b',
    re.IGNORECASE,
)

# Column types are declared, not guessed from the first row: a NULL in row one
# (weapon_nametag is nullable) used to type the whole column as a string.
#
# weapon_wear is FLOAT and must stay FLOAT — the plugin reads it into a C#
# `float`, and double -> float is not an implicit conversion, so announcing
# DOUBLE would break it the same way TINYINT(256) broke StatTrak.
_TEXT_COLS = frozenset({
    'steamid', 'weapon_nametag', 'knife', 'agent_ct', 'agent_t',
    'weapon_sticker_0', 'weapon_sticker_1', 'weapon_sticker_2',
    'weapon_sticker_3', 'weapon_sticker_4', 'weapon_keychain',
})
_BOOL_COLS = frozenset({'weapon_stattrak'})
_FLOAT_COLS = frozenset({'weapon_wear'})

def _col_type(name: str, rows, idx: int) -> ColumnType:
    """Wire type for a result column, by name where we know it and by the first
    non-NULL value otherwise (COUNT(*) and friends)."""
    if name in _BOOL_COLS:
        return ColumnType.TINY
    if name in _FLOAT_COLS:
        return ColumnType.FLOAT
    if name in _TEXT_COLS:
        return ColumnType.VAR_STRING
    for row in rows:
        val = row[idx]
        if val is None:
            continue
        if isinstance(val, float):
            return ColumnType.FLOAT
        if isinstance(val, int):
            return ColumnType.LONG
        break
    return ColumnType.VAR_STRING

def _to_sqlite(sql: str) -> str | None:
    """
    Translate a MySQL SQL statement to SQLite.
    Returns None to silently return OK (no rows) without executing.
    """
    s = sql.strip()
    if not s:
        return None
    if _SKIP.match(s) or _TXN.match(s):
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
                cols = [ResultColumn(name, _col_type(name, rows, i))
                        for i, name in enumerate(col_names)]
                return rows, cols
            return None
        except Exception as e:
            # Failing quietly is how a broken skins table used to look like an
            # empty one. The client still gets an OK so a half-supported
            # statement can't take the server down, but the cause is on record.
            log.warning('query failed: %s | %s', e, ' '.join(stmt.split())[:200])
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
