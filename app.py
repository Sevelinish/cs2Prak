import os
import re
import sys
import json
import math
import time
import ctypes
import ctypes.wintypes as _wt
import sqlite3
import threading
import subprocess
import tempfile
import zipfile
import tarfile
import shutil
import socket
import urllib.request
import urllib.error
import urllib.parse
import concurrent.futures
import webbrowser
from flask import Flask, render_template, send_from_directory, jsonify, request

if getattr(sys, 'frozen', False):
    _BASE   = os.path.dirname(sys.executable)
    _BUNDLE = sys._MEIPASS
else:
    _BASE   = os.path.dirname(os.path.abspath(__file__))
    _BUNDLE = _BASE

app = Flask(__name__,
            template_folder=os.path.join(_BUNDLE, 'templates'),
            static_folder=os.path.join(_BUNDLE, 'static'))

_LOOPBACK_HOSTS = {'127.0.0.1', 'localhost', '[::1]', '::1'}

@app.before_request
def _guard_loopback_only():
    if (request.host or '').rsplit(':', 1)[0] not in _LOOPBACK_HOSTS:
        return 'Forbidden', 403
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        origin = request.headers.get('Origin')
        if origin and (urllib.parse.urlparse(origin).hostname or '') not in _LOOPBACK_HOSTS:
            return 'Forbidden', 403

def _safe_cache_key(key):
    """Cache keys are sha1 hex; reject anything else so a crafted <key> URL segment
    (Werkzeug allows backslashes) can't escape the cache directory on Windows."""
    return bool(key) and re.fullmatch(r'[0-9a-f]{1,40}', key) is not None

MAPS_DIR = os.path.join(_BASE, 'maps')

DB_PATH = os.path.join(_BASE, 'skins.db')

SERVER_ROOT  = os.path.join(_BASE, 'cs2Server')
_CS2_COMMON  = os.path.join(SERVER_ROOT,
                             r'steamapps\common\Counter-Strike Global Offensive')
CS2_GAME     = os.path.join(_CS2_COMMON, 'game')
CS2_DIR      = os.path.join(CS2_GAME, r'bin\win64')
CS2_EXE      = os.path.join(CS2_DIR, 'cs2.exe')
STEAMCMD_DIR = SERVER_ROOT
STEAMCMD     = os.path.join(SERVER_ROOT, 'steamcmd.exe')
STEAMCMD_URL    = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
DOTNET8_VER_URL = 'https://dotnetcli.azureedge.net/dotnet/Runtime/8.0/latest.version'
GAMEINFO_GI  = os.path.join(CS2_GAME, r'csgo\gameinfo.gi')
CSGO_BASE    = os.path.join(CS2_GAME, 'csgo')
CSGO_ADDONS  = os.path.join(CSGO_BASE, 'addons')
CSS_BASE     = os.path.join(CSGO_ADDONS, 'counterstrikesharp')
CSS_PLUGINS  = os.path.join(CSS_BASE, 'plugins')
CSS_PLUGINS_DISABLED = os.path.join(CSS_BASE, 'plugins_disabled')
PLUGIN_DATA  = os.path.join(CSS_PLUGINS, r'WeaponPaints\data')
PLUGIN_STATE_PATH = os.path.join(_BASE, 'plugin_versions.json')
ADMINS_JSON  = os.path.join(CSS_BASE, r'configs\admins.json')
DOWNLOADS_DIR = os.path.expanduser('~\\Downloads')

PLUGINS_DEF = [
    {
        'id': 'metamod',
        'name': 'Metamod:Source',
        'description': 'Plugin loader for CS2 — required by CounterStrikeSharp',
        'github': 'alliedmodders/metamod-source',
        'github_tag_prefix': '2.',
        'marker': os.path.join(CSGO_ADDONS, r'metamod\bin\win64\metamod.2.cs2.dll'),
        'version_src': 'dll',
        'asset_ext': '.zip',
        'asset_os': 'windows',
        'extract_to': CSGO_BASE,
        'preserve': [],
        'extract_hint': r'cs2Server\steamapps\common\Counter-Strike Global Offensive\game\csgo\\',
    },
    {
        'id': 'counterstrikesharp',
        'name': 'CounterStrikeSharp',
        'description': 'C# plugin framework built on Metamod:Source',
        'github': 'roflmuffin/CounterStrikeSharp',
        'marker': os.path.join(CSGO_ADDONS, r'counterstrikesharp\bin\win64\counterstrikesharp.dll'),
        'version_src': 'css_deps',
        'asset_ext': '.zip',
        'asset_os': 'windows',
        'asset_name_prefer': 'with-runtime',
        'extract_to': CSGO_BASE,
        'preserve': [
            os.path.join('addons', 'counterstrikesharp', 'configs'),
            os.path.join('addons', 'counterstrikesharp', 'plugins'),
        ],
        'extract_hint': r'cs2Server\steamapps\common\Counter-Strike Global Offensive\game\csgo\\',
    },
    {
        'id': 'anybaselibcs2',
        'name': 'AnyBaseLibCS2',
        'description': 'Base library required by PlayerSettings and MenuManager',
        'github': 'NickFox007/AnyBaseLibCS2',
        'marker': os.path.join(CSS_BASE, r'shared\AnyBaseLib\AnyBaseLib.dll'),
        'version_src': 'tracker',
        'asset_ext': '.zip',
        'asset_os': None,
        'extract_to': CSGO_BASE,
        'preserve': [],
        'is_dependency': True,
        'extract_hint': r'cs2Server\steamapps\common\Counter-Strike Global Offensive\game\csgo\\',
    },
    {
        'id': 'playersettings',
        'name': 'PlayerSettings',
        'description': 'Player settings storage required by MenuManager',
        'github': 'NickFox007/PlayerSettingsCS2',
        'marker': os.path.join(CSS_PLUGINS, r'PlayerSettings\PlayerSettings.dll'),
        'version_src': 'tracker',
        'asset_ext': '.zip',
        'asset_os': None,
        'extract_to': CSGO_BASE,
        'preserve': [],
        'is_dependency': True,
        'extract_hint': r'cs2Server\steamapps\common\Counter-Strike Global Offensive\game\csgo\\',
    },
    {
        'id': 'menumanagercs2',
        'name': 'MenuManagerCS2',
        'description': 'In-game menu system required by WeaponPaints',
        'github': 'NickFox007/MenuManagerCS2',
        'marker': os.path.join(CSS_PLUGINS, r'MenuManagerCore\MenuManagerCore.dll'),
        'version_src': 'tracker',
        'asset_ext': '.zip',
        'asset_os': None,
        'extract_to': CSGO_BASE,
        'preserve': [],
        'is_dependency': True,
        'extract_hint': r'cs2Server\steamapps\common\Counter-Strike Global Offensive\game\csgo\\',
    },
    {
        'id': 'matchzy',
        'name': 'MatchZy',
        'description': 'Practice and match management plugin',
        'github': 'shobhit-pathak/MatchZy',
        'marker': os.path.join(CSS_PLUGINS, r'MatchZy\MatchZy.dll'),
        'version_src': 'tracker',
        'asset_ext': '.zip',
        'asset_os': None,
        'extract_to': CSGO_BASE,
        'preserve': [
            os.path.join('addons', 'counterstrikesharp', 'plugins', 'MatchZy', 'lang'),
            os.path.join('addons', 'counterstrikesharp', 'plugins', 'MatchZy', 'matchzy.db'),
            os.path.join('addons', 'counterstrikesharp', 'plugins', 'MatchZy', 'spawns'),
        ],
        'extract_hint': r'cs2Server\steamapps\common\Counter-Strike Global Offensive\game\csgo\\',
    },
    {
        'id': 'weaponpaints',
        'name': 'WeaponPaints',
        'description': 'Weapon skin and glove customization for players',
        'github': 'Nereziel/cs2-WeaponPaints',
        'marker': os.path.join(CSS_PLUGINS, r'WeaponPaints\WeaponPaints.dll'),
        'version_src': 'tracker',
        'asset_ext': '.zip',
        'asset_os': None,
        'extract_to': CSS_PLUGINS,
        'asset_name_exclude': ['website'],
        'preserve': [
            os.path.join('WeaponPaints', 'lang'),
        ],
        'depends_on': ['anybaselibcs2', 'playersettings', 'menumanagercs2'],
        'extract_hint': r'cs2Server\...\csgo\addons\counterstrikesharp\plugins\\',
    },
]

def patch_gameinfo():
    """Re-insert the Metamod search path that `app_update validate` wipes."""
    try:
        with open(GAMEINFO_GI, 'r', encoding='utf-8') as f:
            text = f.read()
        if 'csgo/addons/metamod' in text:
            return
        patched = text.replace(
            '\t\t\tGame\tcsgo\n',
            '\t\t\tGame\tcsgo/addons/metamod\n\t\t\tGame\tcsgo\n',
            1,
        )
        if patched == text:
            return
        with open(GAMEINFO_GI, 'w', encoding='utf-8') as f:
            f.write(patched)
    except Exception:
        pass

def ensure_css_basepath_link(log: list | None = None):
    """Make CounterStrikeSharp find itself on current CS2.

    On the current CS2 build `IVEngineServer::GetGameDir()` returns an empty
    string, so CSS resolves its base path to the bare default
    `/addons/counterstrikesharp`, which Windows treats as drive-relative —
    i.e. `<serverDrive>:\\addons\\counterstrikesharp`. Without that folder CSS
    logs `Invalid base path` and loads 0 plugins (vanilla server).

    Fix: create a junction `<serverDrive>:\\addons` → the real
    `csgo\\addons`, so the drive-root lookup lands on the actual install.
    Junctions need no admin rights. Forward-compatible: if a future CS2/CSS
    restores GetGameDir(), CSS resolves the real path and this link is unused.
    """
    def _say(m):
        if log is not None:
            log.append(m)
    if not os.path.isdir(CSGO_ADDONS):
        return
    drive = os.path.splitdrive(os.path.abspath(CSGO_ADDONS))[0]
    link = os.path.join(drive + os.sep, 'addons')
    try:
        if os.path.isdir(link):
            if os.path.realpath(link).rstrip('\\/').lower() == \
                    os.path.realpath(CSGO_ADDONS).rstrip('\\/').lower():
                return
            _say(f'! {link} exists but points elsewhere — CSS may not load. '
                 f'Remove it or repoint it to {CSGO_ADDONS}.')
            return
        subprocess.run(['cmd', '/c', 'mklink', '/J', link, CSGO_ADDONS],
                       creationflags=subprocess.CREATE_NO_WINDOW,
                       capture_output=True, text=True, timeout=15)
        if os.path.isdir(link):
            _say(rf'[+] CSS base-path link created: {link} -> csgo\addons')
        else:
            _say(f'! Could not create CSS base-path link {link}.')
    except Exception as e:
        _say(f'! CSS base-path link error: {e}')

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=5000')
    return conn

_SKINS_DDL = """
    CREATE TABLE IF NOT EXISTS wp_player_skins (
        steamid               TEXT    NOT NULL,
        weapon_team           INTEGER NOT NULL DEFAULT 0,
        weapon_defindex       INTEGER NOT NULL DEFAULT 0,
        weapon_paint_id       INTEGER NOT NULL DEFAULT 0,
        weapon_wear           REAL    NOT NULL DEFAULT 0.001,
        weapon_seed           INTEGER NOT NULL DEFAULT 0,
        weapon_nametag        TEXT             DEFAULT NULL,
        weapon_stattrak       INTEGER NOT NULL DEFAULT 0,
        weapon_stattrak_count INTEGER NOT NULL DEFAULT 0,
        weapon_sticker_0      TEXT    NOT NULL DEFAULT '0;0;0;0;0;0;0',
        weapon_sticker_1      TEXT    NOT NULL DEFAULT '0;0;0;0;0;0;0',
        weapon_sticker_2      TEXT    NOT NULL DEFAULT '0;0;0;0;0;0;0',
        weapon_sticker_3      TEXT    NOT NULL DEFAULT '0;0;0;0;0;0;0',
        weapon_sticker_4      TEXT    NOT NULL DEFAULT '0;0;0;0;0;0;0',
        weapon_keychain       TEXT    NOT NULL DEFAULT '0;0;0;0;0',
        PRIMARY KEY (steamid, weapon_team, weapon_defindex)
    );
"""

def ensure_schema():
    """Create all WeaponPaints tables; migrate if weapon_team is missing from skins PK."""
    conn = get_db()

    tbl = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='wp_player_skins'"
    ).fetchone()
    if tbl and tbl[0] and 'weapon_team' not in tbl[0]:
        try:
            conn.execute('ALTER TABLE wp_player_skins RENAME TO _wp_player_skins_bak')
            conn.executescript(_SKINS_DDL)
            for team in (2, 3):
                try:
                    conn.execute(f"""
                        INSERT OR IGNORE INTO wp_player_skins
                            (steamid, weapon_team, weapon_defindex, weapon_paint_id, weapon_wear,
                             weapon_seed, weapon_nametag, weapon_stattrak, weapon_stattrak_count)
                        SELECT steamid, {team}, weapon_defindex, weapon_paint_id, weapon_wear,
                               weapon_seed, weapon_nametag, weapon_stattrak, weapon_stattrak_count
                        FROM _wp_player_skins_bak
                    """)
                except Exception:
                    pass
            conn.execute('DROP TABLE IF EXISTS _wp_player_skins_bak')
            conn.commit()
        except Exception:
            conn.execute('DROP TABLE IF EXISTS _wp_player_skins_bak')

    conn.executescript(_SKINS_DDL + """
        CREATE TABLE IF NOT EXISTS wp_player_knife (
            steamid     TEXT    NOT NULL,
            weapon_team INTEGER NOT NULL DEFAULT 0,
            knife       TEXT    NOT NULL DEFAULT '',
            PRIMARY KEY (steamid, weapon_team)
        );
        CREATE TABLE IF NOT EXISTS wp_player_gloves (
            steamid         TEXT    NOT NULL,
            weapon_team     INTEGER NOT NULL DEFAULT 0,
            weapon_defindex INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (steamid, weapon_team)
        );
        CREATE TABLE IF NOT EXISTS wp_player_agents (
            steamid  TEXT NOT NULL PRIMARY KEY,
            agent_ct TEXT DEFAULT NULL,
            agent_t  TEXT DEFAULT NULL
        );
    """)
    conn.commit()
    conn.close()

def _load(name):
    path = os.path.join(PLUGIN_DATA, name)
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

_CATALOGUE_FILES = ('skins_en.json', 'gloves_en.json', 'agents_en.json', 'stickers_en.json')
_catalogue_mtimes: dict[str, float] = {}

def _reload_catalogues():
    global SKINS_BY_WEAPON, GLOVES_CAT, AGENTS_CAT, STICKERS_CAT
    raw = _load('skins_en.json')
    SKINS_BY_WEAPON = {}
    for s in raw:
        SKINS_BY_WEAPON.setdefault(s['weapon_name'], []).append(s)
    GLOVES_CAT   = _load('gloves_en.json')
    AGENTS_CAT   = _load('agents_en.json')
    STICKERS_CAT = _load('stickers_en.json')
    for name in _CATALOGUE_FILES:
        try:
            _catalogue_mtimes[name] = os.path.getmtime(os.path.join(PLUGIN_DATA, name))
        except OSError:
            _catalogue_mtimes[name] = 0

def _refresh_catalogues_if_changed():
    """Reload the catalogue if any data file changed on disk (e.g. WeaponPaints
    was installed/updated after the app started). Keeps new skins in sync without
    requiring a restart."""
    for name in _CATALOGUE_FILES:
        try:
            m = os.path.getmtime(os.path.join(PLUGIN_DATA, name))
        except OSError:
            m = 0
        if _catalogue_mtimes.get(name) != m:
            _reload_catalogues()
            return

SKINS_BY_WEAPON: dict[str, list] = {}
GLOVES_CAT:   list = []
AGENTS_CAT:   list = []
STICKERS_CAT: list = []
_reload_catalogues()

cs2_process = None

_cs2_console_hwnd: int | None = None

_WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, _wt.HWND, _wt.LPARAM)

def _enum_visible_hwnds() -> set:
    result: set = set()
    def _cb(hwnd, _):
        if ctypes.windll.user32.IsWindowVisible(hwnd):
            result.add(hwnd)
        return True
    ctypes.windll.user32.EnumWindows(_WNDENUMPROC(_cb), 0)
    return result

def _find_cs2_console_after_launch(windows_before: set):
    """Daemon thread: waits for a new visible window after CS2 launches.
    With SW_HIDE on cmd.exe, the only new visible window that appears is
    CS2's own console (created by AllocConsole inside cs2.exe -console)."""
    global _cs2_console_hwnd
    deadline = time.time() + 60
    while time.time() < deadline:
        if not cs2_process or cs2_process.poll() is not None:
            return
        new = _enum_visible_hwnds() - windows_before
        if new:
            _cs2_console_hwnd = next(iter(new))
            return
        time.sleep(1)

def _load_plugin_state() -> dict:
    try:
        with open(PLUGIN_STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}

def _save_plugin_state(state: dict):
    try:
        with open(PLUGIN_STATE_PATH, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception:
        pass

def _get_local_version(plugin: dict, state: dict | None = None) -> str | None:
    if not os.path.exists(plugin['marker']):
        return None
    src = plugin['version_src']
    if src == 'css_deps':
        try:
            deps = os.path.join(CSGO_ADDONS,
                r'counterstrikesharp\api\CounterStrikeSharp.API.deps.json')
            with open(deps) as f:
                d = json.load(f)
            for k in d.get('libraries', {}):
                if 'CounterStrikeSharp.API' in k:
                    return k.split('/')[-1]
        except Exception:
            pass
        return 'unknown'
    elif src == 'dll':
        try:
            path = plugin['marker']
            sz = ctypes.windll.version.GetFileVersionInfoSizeW(path, None)
            if not sz:
                return 'unknown'
            buf = ctypes.create_string_buffer(sz)
            ctypes.windll.version.GetFileVersionInfoW(path, None, sz, buf)
            p, n = ctypes.c_void_p(), ctypes.c_uint()
            ctypes.windll.version.VerQueryValueW(
                buf, chr(92), ctypes.byref(p), ctypes.byref(n))
            arr = ctypes.cast(p, ctypes.POINTER(ctypes.c_uint32))
            fv_ms, fv_ls = arr[4], arr[5]
            return (f'{fv_ms >> 16}.{fv_ms & 0xffff}'
                    f'.{fv_ls >> 16}.{fv_ls & 0xffff}')
        except Exception:
            return 'unknown'
    elif src == 'tracker':
        if state is None:
            state = _load_plugin_state()
        return state.get(plugin['id'], 'unknown')
    return 'unknown'

def _ver_tuple(v: str) -> tuple:
    v = v.strip().lstrip('v').split('-')[0]
    result = []
    for part in v.split('.'):
        try:
            result.append(int(part))
        except ValueError:
            break
    return tuple(result) if result else (0,)

def _is_outdated(local: str, latest: str) -> bool:
    if not local or local in ('unknown', '—'):
        return True
    tl = _ver_tuple(local)
    tr = _ver_tuple(latest)
    n = min(len(tl), len(tr))
    if n == 0:
        return False
    return tl[-n:] < tr[-n:]

def _github_latest(repo: str, timeout: int = 8, tag_prefix: str = None) -> dict | None:
    if tag_prefix:
        url = f'https://api.github.com/repos/{repo}/releases?per_page=50'
    else:
        url = f'https://api.github.com/repos/{repo}/releases/latest'
    req = urllib.request.Request(url, headers={'User-Agent': 'cs2prak/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
        if not tag_prefix:
            return data
        for rel in (data if isinstance(data, list) else [data]):
            if rel.get('tag_name', '').lstrip('v').startswith(tag_prefix):
                return rel
        return None
    except Exception:
        return None

_WP_CONFIG = os.path.join(
    CSGO_ADDONS,
    r'counterstrikesharp\configs\plugins\WeaponPaints\WeaponPaints.json',
)
_CSS_CORE_CONFIG = os.path.join(
    CSGO_ADDONS,
    r'counterstrikesharp\configs\core.json',
)

def _patch_weaponpaints_config(log: list | None = None):
    """Ensure WeaponPaints runs without commercial-server restrictions.
    CSS core: FollowCS2ServerGuidelines must be false.
    WeaponPaints: any ValvePolicy key must be false if present.
    Called after WeaponPaints install AND before every server launch.
    """
    def _log(msg):
        if log is not None:
            log.append(msg)

    try:
        with open(_CSS_CORE_CONFIG, 'r', encoding='utf-8') as f:
            core = json.load(f)
        if core.get('FollowCS2ServerGuidelines') is not False:
            core['FollowCS2ServerGuidelines'] = False
            with open(_CSS_CORE_CONFIG, 'w', encoding='utf-8') as f:
                json.dump(core, f, indent=4)
            _log('Set FollowCS2ServerGuidelines=false in CSS core.json.')
    except Exception:
        pass

    try:
        with open(_WP_CONFIG, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        changed = False
        for key in list(cfg.keys()):
            if 'valve' in key.lower() and 'policy' in key.lower():
                if cfg[key] is not False:
                    cfg[key] = False
                    changed = True
        if changed:
            with open(_WP_CONFIG, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, indent=2)
            _log('Set valve policy to false in WeaponPaints.json.')
    except Exception:
        pass

def _pick_asset(plugin: dict, release: dict, os_pref: str):
    """Return the best matching release asset for the given OS preference."""
    assets   = release.get('assets', [])
    excludes = [x.lower() for x in plugin.get('asset_name_exclude', [])]
    prefer   = plugin.get('asset_name_prefer', '').lower()

    def _ok(a):   return not any(ex in a['name'].lower() for ex in excludes)
    def _pref(a): return not prefer or prefer in a['name'].lower()

    exts = (['.tar.gz', '.tgz', '.zip'] if os_pref == 'linux'
            else ['.zip', '.tar.gz', '.tgz'])
    for ext in exts:
        for a in assets:
            if (a['name'].lower().endswith(ext) and os_pref in a['name'].lower()
                    and _pref(a) and _ok(a)):
                return a
    for ext in exts:
        for a in assets:
            if a['name'].lower().endswith(ext) and os_pref in a['name'].lower() and _ok(a):
                return a
    for ext in exts:
        for a in assets:
            if a['name'].lower().endswith(ext) and _ok(a):
                return a
    return None

def _ensure_dotnet8(log: list):
    """Ensure .NET 8 runtime is available for CounterStrikeSharp.
    Checks bundled runtime first, then system install, then downloads+installs silently."""
    if os.path.exists(os.path.join(CSS_BASE, 'dotnet', 'dotnet.exe')):
        log.append('[+] CSS with-runtime: .NET 8 bundled, no system install needed.')
        return

    pf     = os.environ.get('ProgramFiles', r'C:\Program Files')
    sys_dn = os.path.join(pf, 'dotnet', 'dotnet.exe')
    if os.path.exists(sys_dn):
        try:
            r = subprocess.run(
                [sys_dn, '--list-runtimes'],
                capture_output=True, text=True, timeout=8,
                creationflags=subprocess.CREATE_NO_WINDOW)
            if 'Microsoft.NETCore.App 8.' in r.stdout:
                log.append('[+] .NET 8 runtime found on system.')
                return
        except Exception:
            pass

    log.append('.NET 8 runtime not found — downloading (CounterStrikeSharp requires it)...')
    try:
        req = urllib.request.Request(DOTNET8_VER_URL, headers={'User-Agent': 'cs2prak/1.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            ver = r.read().decode().strip()
        dl_url = (f'https://dotnetcli.azureedge.net/dotnet/Runtime/{ver}'
                  f'/dotnet-runtime-{ver}-win-x64.exe')
        log.append(f'Downloading .NET Runtime {ver}...')
        inst = os.path.join(tempfile.gettempdir(), f'dotnet-runtime-{ver}-win-x64.exe')
        req2 = urllib.request.Request(dl_url, headers={'User-Agent': 'cs2prak/1.0'})
        with urllib.request.urlopen(req2, timeout=300) as r2, open(inst, 'wb') as f:
            shutil.copyfileobj(r2, f)
        log.append('Running .NET 8 installer silently...')
        proc = subprocess.Popen(
            [inst, '/install', '/quiet', '/norestart'],
            creationflags=subprocess.CREATE_NO_WINDOW)
        proc.wait()
        try:
            os.remove(inst)
        except Exception:
            pass
        if proc.returncode in (0, 3010):
            log.append('[+] .NET 8 runtime installed successfully.')
        else:
            log.append(f'WARNING: .NET installer returned code {proc.returncode}.')
            log.append('  → If CSS still fails, re-download CSS using the "with-runtime" zip.')
    except Exception as e:
        log.append(f'WARNING: Could not auto-install .NET 8: {e}')
        log.append('  → Re-download CSS using the "with-runtime" zip from GitHub.')

def _download_plugin_zip(plugin_id: str, log: list, os_pref: str = 'windows'):
    """Download a plugin's latest release zip to the user's Downloads folder,
    then pop two side-by-side Explorer windows (the archive on the left, the
    server's csgo folder on the right) so the addons folder can be dragged in.
    The actual install stays manual."""
    plugin = next(p for p in PLUGINS_DEF if p['id'] == plugin_id)
    log.append(f'Fetching latest release for {plugin["name"]}...')
    release = _github_latest(plugin['github'], timeout=10,
                             tag_prefix=plugin.get('github_tag_prefix'))
    if not release:
        raise RuntimeError('GitHub API unreachable.')
    tag = release['tag_name']
    log.append(f'Latest: {tag}')

    asset = _pick_asset(plugin, release, os_pref)
    if not asset:
        raise RuntimeError(f'No suitable asset found in release {tag}.')

    name = asset['name']
    dest_path = os.path.join(DOWNLOADS_DIR, name)
    log.append(f'Downloading {name} ({asset["size"] // 1024} KB)...')
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    req = urllib.request.Request(asset['browser_download_url'],
                                 headers={'User-Agent': 'cs2prak/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r, \
            open(dest_path, 'wb') as f:
        shutil.copyfileobj(r, f)
    log.append(f'Saved → {dest_path}')
    log.append('Use OPEN SERVER FOLDER, then drag the archive\'s addons folder into csgo.')
    log.append(f'Done! {plugin["name"]} {tag} downloaded.')

def _install_server(log: list):
    """Download SteamCMD (if missing) then install CS2 dedicated server (visible window)."""
    os.makedirs(SERVER_ROOT, exist_ok=True)

    if not os.path.exists(STEAMCMD):
        log.append('Downloading SteamCMD...')
        zip_path = os.path.join(SERVER_ROOT, 'steamcmd.zip')
        req = urllib.request.Request(STEAMCMD_URL, headers={'User-Agent': 'cs2prak/1.0'})
        with urllib.request.urlopen(req, timeout=60) as r, \
                open(zip_path, 'wb') as f:
            shutil.copyfileobj(r, f)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(SERVER_ROOT)
        os.remove(zip_path)
        log.append('SteamCMD ready.')
    else:
        log.append('SteamCMD already present.')

    log.append('SteamCMD window is now open — watch it for download progress.')
    log.append('This may take 10–30 minutes depending on your internet speed.')

    proc = subprocess.Popen(
        [STEAMCMD, '+login', 'anonymous', '+app_update', '730', 'validate', '+quit'],
        cwd=STEAMCMD_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f'SteamCMD exited with code {proc.returncode}')
    patch_gameinfo()
    log.append('Done! CS2 server is installed.')

def _configure_weaponpaints_db(log: list):
    """Write WeaponPaints.json DB credentials pointing at our local mysql_sqlite_server."""
    wp_dll = os.path.join(CSS_PLUGINS, r'WeaponPaints\WeaponPaints.dll')
    if not os.path.exists(wp_dll):
        return

    os.makedirs(os.path.dirname(_WP_CONFIG), exist_ok=True)
    _WP_DEFAULTS = {
        'ConfigVersion':           10,
        'SkinsLanguage':           'en',
        'DatabaseHost':            '',
        'DatabasePort':            3306,
        'DatabaseUser':            '',
        'DatabasePassword':        '',
        'DatabaseName':            '',
        'CmdRefreshCooldownSeconds': 3,
        'Website':                 'example.com/skins',
        'MenuType':                'selectable',
    }
    try:
        with open(_WP_CONFIG, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        cfg = dict(_WP_DEFAULTS)

    if not cfg.get('DatabaseHost', '').strip():
        cfg.update({
            'DatabaseHost':     '127.0.0.1',
            'DatabasePort':     3306,
            'DatabaseUser':     'root',
            'DatabasePassword': '',
            'DatabaseName':     'cs2prak',
        })
        with open(_WP_CONFIG, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2)
        log.append('[+] WeaponPaints database configured (127.0.0.1:3306).')
    else:
        log.append(f'[+] WeaponPaints database already set ({cfg["DatabaseHost"]}).')

def _configure_server(log: list):
    """Patch gameinfo, create CSS VDF, apply valve policy fix, write admin."""
    if not os.path.exists(GAMEINFO_GI):
        log.append('ERROR: CS2 server not found. Install the server first (Download tab).')
        return

    patch_gameinfo()
    log.append('[+] gameinfo.gi patched for Metamod.')

    css_dll  = os.path.join(CSS_BASE, r'bin\win64\counterstrikesharp.dll')
    vdf_path = os.path.join(CSGO_ADDONS, 'counterstrikesharp.vdf')
    if os.path.exists(css_dll):
        with open(vdf_path, 'w') as f:
            f.write('"Plugin"\n{\n\t"file"\t\t'
                    '"addons/counterstrikesharp/bin/win64/counterstrikesharp"\n}\n')
        log.append('[+] counterstrikesharp.vdf written.')
        _ensure_dotnet8(log)
        ensure_css_basepath_link(log)
    else:
        log.append('— CounterStrikeSharp not found; place it then re-run Configure.')

    wp_gamedata_wrong = os.path.join(CSS_PLUGINS, 'gamedata', 'weaponpaints.json')
    wp_gamedata_right = os.path.join(CSS_BASE, 'gamedata', 'weaponpaints.json')
    if os.path.exists(wp_gamedata_wrong) and not os.path.exists(wp_gamedata_right):
        os.makedirs(os.path.dirname(wp_gamedata_right), exist_ok=True)
        shutil.move(wp_gamedata_wrong, wp_gamedata_right)
        log.append('[+] WeaponPaints gamedata moved to correct location.')

    _patch_weaponpaints_config(log)
    _configure_weaponpaints_db(log)

    try:
        with open(ADMINS_JSON, 'r', encoding='utf-8') as f:
            admins = json.load(f)
        for v in admins.values():
            if isinstance(v, dict) and v.get('identity'):
                log.append(f'[+] Admin already configured ({v["identity"]}).')
                break
    except FileNotFoundError:
        log.append('— No admin set. Enter a SteamID64 in the Plugins tab and click SAVE.')
    except Exception:
        pass

    _reload_catalogues()
    log.append('Configuration complete.')

_plugin_jobs: dict[str, dict] = {}

_server_install_running   = False
_server_install_log: list = []
_server_install_exit_code: int | None = None

_configure_running   = False
_configure_log: list = []
_configure_exit_code: int | None = None

_update_running   = False
_update_log: list[str] = []
_update_exit_code: int | None = None

last_heartbeat = time.time()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/maps/<filename>')
def maps(filename):
    return send_from_directory(MAPS_DIR, filename)

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    global last_heartbeat
    last_heartbeat = time.time()
    return jsonify({'ok': True})

@app.route('/launch', methods=['POST'])
def launch():
    global cs2_process, _cs2_console_hwnd
    if cs2_process and cs2_process.poll() is None:
        return jsonify({'ok': False, 'message': 'Server already running'}), 400
    if not os.path.exists(CS2_EXE):
        return jsonify({'ok': False, 'message': 'CS2 server not installed. Use the Download tab first.'}), 400
    _patch_weaponpaints_config()
    if os.path.isdir(CSS_BASE):
        ensure_css_basepath_link()
    data = request.get_json(silent=True) or {}
    map_name = data.get('map', 'de_dust2')
    if not re.fullmatch(r'[A-Za-z0-9_]{1,64}', map_name or ''):
        return jsonify({'ok': False, 'message': 'Invalid map name'}), 400

    _args = [
        CS2_EXE, '-dedicated',
        '+map', map_name,
        '+game_type', '0', '+game_mode', '1',
        '+sv_cheats', '1', '+sv_lan', '0',
        '-console', '-port', '27015',
    ]

    _bat = os.path.join(tempfile.gettempdir(), f'cs2prak_{os.getpid()}.bat')
    with open(_bat, 'w') as _f:
        _f.write('@echo off\n' + subprocess.list2cmdline(_args) + '\n')

    _si = subprocess.STARTUPINFO()
    _si.dwFlags    |= subprocess.STARTF_USESHOWWINDOW
    _si.wShowWindow = 0

    _cs2_console_hwnd = None
    windows_before = _enum_visible_hwnds()

    try:
        cs2_process = subprocess.Popen(
            ['cmd.exe', '/c', _bat],
            cwd=CS2_DIR,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
            startupinfo=_si,
        )
    except Exception as e:
        return jsonify({'ok': False, 'message': f'Failed to start CS2: {e}'})

    threading.Thread(
        target=_find_cs2_console_after_launch,
        args=(windows_before,),
        daemon=True,
    ).start()

    return jsonify({'ok': True, 'message': f'Server launched on {map_name}'})

@app.route('/stop', methods=['POST'])
def stop():
    global cs2_process, _cs2_console_hwnd
    _cs2_console_hwnd = None
    if cs2_process and cs2_process.poll() is None:
        try:
            subprocess.Popen(
                ['taskkill', '/f', '/t', '/pid', str(cs2_process.pid)],
                creationflags=subprocess.CREATE_NO_WINDOW,
            ).wait(timeout=5)
        except Exception:
            try:
                cs2_process.terminate()
            except Exception:
                pass
        cs2_process = None
        return jsonify({'ok': True})
    return jsonify({'ok': False, 'message': 'Server not running'}), 400

@app.route('/status')
def status():
    running = cs2_process is not None and cs2_process.poll() is None
    return jsonify({'running': running})

BINDS_CATALOG = [
    {
        'plugin': 'MatchZy',
        'id': 'matchzy',
        'commands': [
            {'label': 'Ready',            'cmd': '.ready',       'desc': 'Mark yourself ready'},
            {'label': 'Unready',          'cmd': '.unready',     'desc': 'Mark yourself not ready'},
            {'label': 'Pause',            'cmd': '.pause',       'desc': 'Pause the match'},
            {'label': 'Unpause',          'cmd': '.unpause',     'desc': 'Unpause the match'},
            {'label': 'Tactical timeout', 'cmd': '.tac',         'desc': 'Call a tactical timeout'},
            {'label': 'Stay',             'cmd': '.stay',        'desc': 'Stay on side after knife round'},
            {'label': 'Switch',           'cmd': '.switch',      'desc': 'Switch sides after knife round'},
            {'label': 'Clear nades',      'cmd': '.clear',       'desc': 'Practice: remove all thrown grenades'},
            {'label': 'Rethrow',          'cmd': '.rethrow',     'desc': 'Practice: rethrow your last grenade'},
            {'label': 'Last nade',        'cmd': '.last',        'desc': 'Practice: teleport to last throw spot'},
            {'label': 'Back',             'cmd': '.back',        'desc': 'Practice: return to last saved position'},
            {'label': 'Spawn',            'cmd': '.spawn',       'desc': 'Practice: teleport to a spawn'},
            {'label': 'Best spawn',       'cmd': '.bestspawn',   'desc': 'Practice: teleport to the closest spawn'},
            {'label': 'Worst spawn',      'cmd': '.worstspawn',  'desc': 'Practice: teleport to the farthest spawn'},
            {'label': 'Add bot',          'cmd': '.bot',         'desc': 'Practice: place a crouching bot here'},
            {'label': 'Remove bots',      'cmd': '.nobots',      'desc': 'Practice: remove all placed bots'},
            {'label': 'Fast forward',     'cmd': '.fastforward', 'desc': 'Practice: skip grenade flight time'},
            {'label': 'No flash',         'cmd': '.noflash',     'desc': 'Practice: toggle flash immunity'},
            {'label': 'Crosshair',        'cmd': '.crosshair',   'desc': 'Practice: drop a crosshair marker'},
            {'label': 'Break props',      'cmd': '.break',       'desc': 'Practice: toggle breakable props'},
        ],
    },
    {
        'plugin': 'WeaponPaints',
        'id': 'weaponpaints',
        'commands': [
            {'label': 'Skins menu',     'cmd': '!ws',           'desc': 'Open the weapon skins menu / refresh skins'},
            {'label': 'Knife menu',     'cmd': '!knife',        'desc': 'Open the knife menu'},
            {'label': 'Gloves menu',    'cmd': '!gloves',       'desc': 'Open the gloves menu'},
            {'label': 'Agents menu',    'cmd': '!agents',       'desc': 'Open the agents menu'},
            {'label': 'Music kit',      'cmd': '!music',        'desc': 'Open the music kit menu'},
            {'label': 'Reset weapons',  'cmd': '!resetweapons', 'desc': 'Reset all applied weapon skins'},
        ],
    },
    {
        'plugin': 'PlayerSettings',
        'id': 'playersettings',
        'commands': [
            {'label': 'Settings menu', 'cmd': '!settings', 'desc': 'Open the player settings menu'},
        ],
    },
]

def _find_client_cfg_dir():
    """Locate the *client* CS2 cfg folder (the user's own install, where binds
    are exec'd from), scanning every Steam library.  Returns a path or None."""
    import re
    pf86 = os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')
    steam = os.path.join(pf86, 'Steam')
    libs = [steam]
    try:
        vdf = os.path.join(steam, 'steamapps', 'libraryfolders.vdf')
        txt = open(vdf, encoding='utf-8', errors='ignore').read()
        for m in re.findall(r'"path"\s*"([^"]+)"', txt):
            libs.append(m.replace('\\\\', '\\'))
    except OSError:
        pass
    for lib in libs:
        cfg = os.path.join(lib, 'steamapps', 'common',
                           'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg')
        if os.path.isdir(cfg):
            return cfg
    return None

@app.route('/api/binds/catalog')
def binds_catalog():
    return jsonify(BINDS_CATALOG)

@app.route('/api/binds/generate', methods=['POST'])
def binds_generate():
    data  = request.get_json(silent=True) or {}
    binds = data.get('binds', [])

    lines = [
        '// sBinds.cfg — generated by cs2prak',
        '// Plugin command binds.  Apply in CS2 console with:  exec sBinds',
        '',
    ]
    seen = 0
    for b in binds:
        key = re.sub(r'\s+', ' ', str(b.get('key', ''))).strip()
        cmd = re.sub(r'\s+', ' ', str(b.get('command', ''))).strip()
        if not key or not cmd:
            continue
        action = f'say {cmd}' if cmd[0] in '!.' else cmd
        action = action.replace('"', '')
        lines.append(f'bind "{key}" "{action}"')
        seen += 1
    lines += ['', 'echo "[cs2prak] sBinds loaded"', '']
    content = '\n'.join(lines)

    cfg_dir = _find_client_cfg_dir()
    written, path = False, None
    if cfg_dir:
        try:
            path = os.path.join(cfg_dir, 'sBinds.cfg')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            written = True
        except OSError as e:
            path = f'(write failed: {e})'

    return jsonify({'ok': True, 'count': seen, 'written': written,
                    'path': path, 'content': content})

app.config['MAX_CONTENT_LENGTH'] = 3 * 1024 ** 3

def _parse_and_respond(path):
    import demo
    _k = ctypes.windll.kernel32
    _h = _k.GetCurrentProcess()
    _k.SetPriorityClass(_h, 0x00000020)
    try:
        key, meta = demo.parse_demo(path, fps=8)
    except Exception as e:
        return jsonify({'ok': False, 'message': str(e)}), 400
    finally:
        _k.SetPriorityClass(_h, 0x00000040)
    return jsonify({'ok': True, 'key': key, 'meta': meta})

def _to_raw_dem(src):
    """Return a path to a raw .dem, transparently decompressing FACEIT's
    zstandard (.dem.zst) or gzip (.dem.gz) downloads. May return src unchanged."""
    with open(src, 'rb') as f:
        head = f.read(4)
    if head[:4] == b'\x28\xb5\x2f\xfd':
        import zstandard
        out = src + '.dem'
        with open(src, 'rb') as fi, open(out, 'wb') as fo:
            zstandard.ZstdDecompressor().copy_stream(fi, fo)
        return out
    if head[:2] == b'\x1f\x8b':
        import gzip
        out = src + '.dem'
        with gzip.open(src, 'rb') as gz, open(out, 'wb') as fo:
            shutil.copyfileobj(gz, fo, 1 << 20)
        return out
    return src

@app.route('/api/demo/upload', methods=['POST'])
def demo_upload():
    name = request.args.get('name', 'demo.dem').lower()
    if not name.endswith(('.dem', '.dem.gz', '.dem.zst', '.gz', '.zst')):
        return jsonify({'ok': False, 'message': 'Please choose a .dem (or .dem.gz / .dem.zst) file'}), 400
    tmp = os.path.join(tempfile.gettempdir(), f'cs2prak_upload_{int(time.time())}.bin')
    stream = request.stream
    with open(tmp, 'wb') as out:
        while True:
            chunk = stream.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    try:
        raw = _to_raw_dem(tmp)
    except Exception as e:
        try: os.remove(tmp)
        except OSError: pass
        return jsonify({'ok': False, 'message': f'Could not read demo: {e}'}), 400
    try:
        resp = _parse_and_respond(raw)
    finally:
        for p in {tmp, raw}:
            try: os.remove(p)
            except OSError: pass
    return resp

_ADV_DIR = os.path.join(tempfile.gettempdir(), 'cs2prak_adv')

def _adv_cleanup():
    try:
        now = time.time()
        for f in os.listdir(_ADV_DIR):
            p = os.path.join(_ADV_DIR, f)
            if now - os.path.getmtime(p) > 7200:
                try: os.remove(p)
                except OSError: pass
    except OSError:
        pass

@app.route('/api/demo/advanced/upload', methods=['POST'])
def demo_advanced_upload():
    name = request.args.get('name', 'demo.dem').lower()
    if not name.endswith(('.dem', '.dem.gz', '.dem.zst', '.gz', '.zst')):
        return jsonify({'ok': False, 'message': 'Choose a .dem (.dem.gz / .dem.zst ok)'}), 400
    os.makedirs(_ADV_DIR, exist_ok=True)
    _adv_cleanup()
    tmp = os.path.join(_ADV_DIR, f'up_{int(time.time() * 1000)}.bin')
    stream = request.stream
    with open(tmp, 'wb') as out:
        while True:
            chunk = stream.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    try:
        raw = _to_raw_dem(tmp)
    except Exception as e:
        try: os.remove(tmp)
        except OSError: pass
        return jsonify({'ok': False, 'message': f'Could not read demo: {e}'}), 400
    aid = str(int(time.time() * 1000))
    staged = os.path.join(_ADV_DIR, aid + '.dem')
    try:
        os.replace(raw, staged)
    except OSError:
        staged = raw
    if os.path.exists(tmp) and tmp != staged:
        try: os.remove(tmp)
        except OSError: pass
    try:
        from demoparser2 import DemoParser
        parser = DemoParser(staged)
        mapname = parser.parse_header().get('map_name', '')
        pi = parser.parse_player_info()
        team_of = {}
        try:
            fe = parser.parse_event('round_freeze_end')
            if fe is not None and len(fe):
                ref = int(fe['tick'].iloc[len(fe) // 2])
                tt = parser.parse_ticks(['team_num', 'team_clan_name'], ticks=[ref])
                for sd, tn, cn in zip(tt['steamid'], tt['team_num'], tt['team_clan_name']):
                    clan = str(cn) if isinstance(cn, str) and cn else ''
                    if clan.lower().startswith('team_'):
                        clan = clan[5:]
                    team_of[str(sd)] = (int(tn) if tn == tn else 0, clan[:24])
        except Exception:
            pass
        seen, players = set(), []
        for sid, nm in zip(pi['steamid'], pi['name']):
            s = str(sid)
            if s and s != '0' and nm and s not in seen:
                seen.add(s)
                tn, clan = team_of.get(s, (0, ''))
                players.append({'steamid': s, 'name': str(nm), 'team': tn, 'clan': clan})
        players = players[:12]
    except Exception as e:
        return jsonify({'ok': False, 'message': f'Parse failed: {e}'}), 400
    return jsonify({'ok': True, 'id': aid, 'map': mapname, 'players': players})

@app.route('/api/demo/advanced/analyze')
def demo_advanced_analyze():
    aid = (request.args.get('id') or '').strip()
    sid = (request.args.get('steamid') or '').strip()
    if not aid.isdigit() or not sid.isdigit():
        return jsonify({'ok': False, 'message': 'Bad request'}), 400
    staged = os.path.join(_ADV_DIR, os.path.basename(aid) + '.dem')
    if not os.path.exists(staged):
        return jsonify({'ok': False, 'message': 'Demo expired — re-upload it'}), 404
    try:
        import demo
        return jsonify(demo.analyze_player(staged, sid))
    except Exception as e:
        return jsonify({'ok': False, 'message': f'Analysis failed: {e}'}), 500

_LIB_FILE  = os.path.join(_BASE, 'demo_library.json')
_STAGE_DIR = os.path.join(tempfile.gettempdir(), 'cs2prak_stage')
_lib_lock  = threading.Lock()
_pq_lock   = threading.Lock()
_pq        = []
_pq_event  = threading.Event()
_pq_seq    = [0]

def _lib_load():
    try:
        with open(_LIB_FILE, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return []

def _lib_add(entry):
    with _lib_lock:
        lst = [e for e in _lib_load() if e.get('key') != entry['key']]
        lst.insert(0, entry)
        try:
            with open(_LIB_FILE, 'w', encoding='utf-8') as f:
                json.dump(lst, f)
        except OSError:
            pass

def _pq_worker():
    import demo
    while True:
        _pq_event.wait()
        with _pq_lock:
            item = next((x for x in _pq if x['status'] == 'queued'), None)
            if item:
                item['status'] = 'parsing'
            else:
                _pq_event.clear()
        if not item:
            continue
        src, raw = item['path'], None
        try:
            raw = _to_raw_dem(src)
            _k = ctypes.windll.kernel32
            _h = _k.GetCurrentProcess()
            _k.SetPriorityClass(_h, 0x00000020)
            try:
                key, meta = demo.parse_demo(raw, fps=8)
            finally:
                _k.SetPriorityClass(_h, 0x00000040)
            _lib_add({'key': key, 'name': item['name'], 'map': meta.get('map', ''),
                      'sa': meta.get('sa', 0), 'sb': meta.get('sb', 0),
                      'winner': meta.get('winner', ''), 'added': int(time.time())})
            with _pq_lock:
                item['status'], item['key'] = 'done', key
        except Exception as e:
            with _pq_lock:
                item['status'], item['error'] = 'error', str(e)[:200]
        finally:
            for p in {src, raw}:
                if p:
                    try: os.remove(p)
                    except OSError: pass

threading.Thread(target=_pq_worker, daemon=True).start()

def _pq_enqueue(name, path):
    with _pq_lock:
        _pq_seq[0] += 1
        _pq.append({'id': _pq_seq[0], 'name': name, 'path': path,
                    'status': 'queued', 'error': '', 'key': ''})
    _pq_event.set()

@app.route('/api/demo/enqueue', methods=['POST'])
def demo_enqueue():
    name = request.args.get('name', 'demo.dem')
    low = name.lower()
    if not low.endswith(('.dem', '.dem.gz', '.dem.zst', '.gz', '.zst', '.zip')):
        return jsonify({'ok': False, 'message': 'Drop .dem / .dem.gz / .dem.zst / .zip'}), 400
    os.makedirs(_STAGE_DIR, exist_ok=True)
    stamp = f'{int(time.time() * 1000)}_{_pq_seq[0]}'
    tmp = os.path.join(_STAGE_DIR, f'{stamp}.bin')
    with open(tmp, 'wb') as out:
        stream = request.stream
        while True:
            chunk = stream.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    queued = []
    if low.endswith('.zip'):
        try:
            with zipfile.ZipFile(tmp) as z:
                for zi in z.namelist():
                    if zi.endswith('/') or not zi.lower().endswith(('.dem', '.dem.gz', '.dem.zst')):
                        continue
                    dst = os.path.join(_STAGE_DIR, f'{stamp}_{len(queued)}.bin')
                    with z.open(zi) as zsrc, open(dst, 'wb') as zo:
                        shutil.copyfileobj(zsrc, zo, 1 << 20)
                    _pq_enqueue(os.path.basename(zi), dst)
                    queued.append(os.path.basename(zi))
        except Exception as e:
            try: os.remove(tmp)
            except OSError: pass
            return jsonify({'ok': False, 'message': f'Bad zip: {e}'}), 400
        try: os.remove(tmp)
        except OSError: pass
        if not queued:
            return jsonify({'ok': False, 'message': 'No demos found in the zip'}), 400
    else:
        _pq_enqueue(name, tmp)
        queued.append(name)
    return jsonify({'ok': True, 'queued': queued})

@app.route('/api/demo/queue')
def demo_queue():
    with _pq_lock:
        items = [{'id': x['id'], 'name': x['name'], 'status': x['status'],
                  'error': x['error'], 'key': x['key']} for x in _pq]
    return jsonify({'queue': items})

@app.route('/api/demo/queue/clear', methods=['POST'])
def demo_queue_clear():
    with _pq_lock:
        _pq[:] = [x for x in _pq if x['status'] in ('queued', 'parsing')]
    return jsonify({'ok': True})

@app.route('/api/demo/library')
def demo_library():
    import demo
    lst = [e for e in _lib_load() if os.path.exists(demo.cached_path(e.get('key', '')))]
    return jsonify({'library': lst})

@app.route('/api/demo/library/<key>', methods=['DELETE'])
def demo_library_delete(key):
    import demo
    if not _safe_cache_key(key):
        return jsonify({'ok': False}), 400
    with _lib_lock:
        lst = [e for e in _lib_load() if e.get('key') != key]
        try:
            with open(_LIB_FILE, 'w', encoding='utf-8') as f:
                json.dump(lst, f)
        except OSError:
            pass
    try: os.remove(demo.cached_path(key))
    except OSError: pass
    shutil.rmtree(demo.voice_dir(key), ignore_errors=True)
    return jsonify({'ok': True})

@app.route('/api/demo/data/<key>')
def demo_data(key):
    import demo
    if not _safe_cache_key(key):
        return jsonify({'ok': False}), 404
    p = demo.cached_path(key)
    if not os.path.exists(p):
        return jsonify({'ok': False, 'message': 'Not parsed'}), 404
    with open(p, encoding='utf-8') as f:
        return app.response_class(f.read(), mimetype='application/json')

@app.route('/api/demo/stats/<key>')
def demo_stats(key):
    """Lightweight per-player stats for the Statistics tab (no heavy frames)."""
    import demo
    if not _safe_cache_key(key):
        return jsonify({'ok': False}), 404
    p = demo.cached_path(key)
    if not os.path.exists(p):
        return jsonify({'ok': False, 'message': 'Not parsed'}), 404
    with open(p, encoding='utf-8') as f:
        d = json.load(f)
    last = d['rounds'][-1] if d.get('rounds') else {}
    return jsonify({
        'ok': True, 'map': d.get('map'),
        'players': d.get('players', []), 'stats': d.get('stats', []),
        'teamA': d.get('teamA', []), 'teamB': d.get('teamB', []),
        'teamAName': d.get('teamAName'), 'teamBName': d.get('teamBName'),
        'rounds': len(d.get('rounds', [])),
        'sa': int(last.get('sa', 0)), 'sb': int(last.get('sb', 0)),
    })

_AVATAR_FILE = os.path.join(_BASE, 'faceit_avatars.json')
_avatar_lock = threading.Lock()

def _avatar_cache():
    try:
        with open(_AVATAR_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

@app.route('/api/faceit/avatar')
def faceit_avatar():
    """steamid64 -> FACEIT avatar URL. {ok:false} (client shows an initials fallback)
    when no FACEIT key is set or the player isn't on FACEIT. Uses the same key the app
    already stores for FACEIT match download (faceit_key.txt)."""
    sid = (request.args.get('steamid') or '').strip()
    if not sid.isdigit():
        return jsonify({'ok': False}), 400
    cache = _avatar_cache()
    if sid in cache:
        return jsonify({'ok': bool(cache[sid]), 'url': cache[sid] or ''})
    key = _faceit_key()
    if not key:
        return jsonify({'ok': False, 'reason': 'no-key'})
    url = ''
    try:
        j = _faceit_get('/players', key, {'game': 'cs2', 'game_player_id': sid})
        url = (j or {}).get('avatar') or ''
    except Exception:
        url = ''
    with _avatar_lock:
        c = _avatar_cache()
        c[sid] = url
        try:
            with open(_AVATAR_FILE, 'w', encoding='utf-8') as f:
                json.dump(c, f)
        except OSError:
            pass
    return jsonify({'ok': bool(url), 'url': url})

@app.route('/api/demo/voice/<key>/<int:n>.wav')
def demo_voice(key, n):
    import demo
    if not _safe_cache_key(key):
        return jsonify({'ok': False}), 404
    p = os.path.join(demo.voice_dir(key), f'{n}.wav')
    if not os.path.exists(p):
        return jsonify({'ok': False, 'message': 'No voice clip'}), 404
    with open(p, 'rb') as f:
        return app.response_class(f.read(), mimetype='audio/wav')

@app.route('/api/demo/nade-export', methods=['POST'])
def demo_nade_export():
    """Write expNade.cfg into the client cfg folder with setpos/setang of a throw,
    so the user can `exec expNade` in-game to teleport to the lineup."""
    data = request.get_json(silent=True) or {}
    sp, sa = data.get('sp'), data.get('sa')
    if not (isinstance(sp, list) and len(sp) == 3 and isinstance(sa, list) and len(sa) == 2):
        return jsonify({'ok': False, 'message': 'No lineup data'}), 400
    try:
        sp = [float(v) for v in sp]
        sa = [float(v) for v in sa]
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'message': 'Bad lineup data'}), 400
    content = ('sv_cheats 1\n'
               f'setpos {sp[0]} {sp[1]} {sp[2]}\n'
               f'setang {sa[0]} {sa[1]} 0\n'
               'echo "[cs2prak] teleported to nade lineup — exec expNade"\n')
    cfg_dir = _find_client_cfg_dir()
    if not cfg_dir:
        return jsonify({'ok': False, 'message': 'CS2 cfg folder not found'}), 404
    try:
        path = os.path.join(cfg_dir, 'expNade.cfg')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({'ok': True, 'path': path})
    except OSError as e:
        return jsonify({'ok': False, 'message': str(e)}), 500

FACEIT_BASE = 'https://open.faceit.com/data/v4'
_FACEIT_KEY_FILE = os.path.join(_BASE, 'faceit_key.txt')

def _faceit_key():
    try:
        return open(_FACEIT_KEY_FILE, encoding='utf-8').read().strip() or None
    except OSError:
        return None

def _faceit_get(path, key, params=None, timeout=20):
    url = FACEIT_BASE + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + key, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))

def _faceit_nick(profile):
    profile = (profile or '').strip()
    m = re.search(r'/players/([^/?#]+)', profile, re.I)
    return urllib.parse.unquote(m.group(1)) if m else profile.split('?')[0].strip('/')

_B2_REGION = {
    'demos-europe-central': 'eu-central-003',
    'demos-eu-central':     'eu-central-003',
    'demos-europe-west':    'eu-central-003',
    'demos-us-east':        'us-east-005',
    'demos-us-west':        'us-west-002',
}

def _faceit_demo_hosts(url):
    """FACEIT hands out a vanity host *.backblaze.faceit-cdn.net that no longer
    resolves; the demo actually lives on Backblaze S3. Return candidate URLs to
    try — the rewritten S3 host (region from the presigned credential, else a
    known region map) first, then the original as a fallback."""
    p = urllib.parse.urlparse(url)
    host = p.hostname or ''
    out = []
    if host.endswith('.backblaze.faceit-cdn.net'):
        first = host.split('.backblaze.faceit-cdn.net')[0]
        bucket = first + '-faceit-cdn'
        cred = urllib.parse.parse_qs(p.query).get('X-Amz-Credential', [''])[0]
        parts = cred.split('/')
        region = parts[2] if len(parts) >= 3 else _B2_REGION.get(first)
        if region:
            out.append(urllib.parse.urlunparse(
                p._replace(netloc=f'{bucket}.s3.{region}.backblazeb2.com')))
    out.append(url)
    return out

def _faceit_download_url(resource_url, key):
    """Exchange a Cloud resource URL for a fresh signed, downloadable URL via the
    FACEIT Downloads API."""
    body = json.dumps({'resource_url': resource_url}).encode('utf-8')
    req = urllib.request.Request(
        'https://open.faceit.com/download/v2/demos/download', data=body, method='POST',
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode('utf-8'))
    return (d.get('payload') or {}).get('download_url')

@app.route('/api/faceit/key', methods=['GET'])
def faceit_key_status():
    return jsonify({'set': bool(_faceit_key())})

@app.route('/api/faceit/key', methods=['POST'])
def faceit_key_set():
    data = request.get_json(silent=True) or {}
    key = str(data.get('key', '')).strip()
    if not key:
        try: os.remove(_FACEIT_KEY_FILE)
        except OSError: pass
        return jsonify({'ok': True})
    try:
        _faceit_get('/players', key, {'nickname': 'donk', 'game': 'cs2'})
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return jsonify({'ok': False, 'message': 'Invalid key — use a Server-side API key'})
        return jsonify({'ok': False, 'message': f'FACEIT returned {e.code}'})
    except Exception:
        return jsonify({'ok': False, 'message': 'Could not reach FACEIT — check your connection'})
    try:
        with open(_FACEIT_KEY_FILE, 'w', encoding='utf-8') as f:
            f.write(key)
    except OSError as e:
        return jsonify({'ok': False, 'message': f'Could not save key: {e}'})
    return jsonify({'ok': True})

@app.route('/api/faceit/matches', methods=['POST'])
def faceit_matches():
    key = _faceit_key()
    if not key:
        return jsonify({'ok': False, 'needKey': True})
    data = request.get_json(silent=True) or {}
    nick = _faceit_nick(str(data.get('profile', '')))
    if not nick:
        return jsonify({'ok': False, 'message': 'Enter your FACEIT nickname or profile link'})
    try:
        pl = _faceit_get('/players', key, {'nickname': nick, 'game': 'cs2'})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return jsonify({'ok': False, 'message': f'Player "{nick}" not found'})
        if e.code in (401, 403):
            return jsonify({'ok': False, 'needKey': True})
        return jsonify({'ok': False, 'message': f'FACEIT returned {e.code}'})
    except Exception:
        return jsonify({'ok': False, 'message': 'Could not reach FACEIT'})
    pid = pl.get('player_id')
    player = {'nickname': pl.get('nickname', nick), 'avatar': pl.get('avatar', '')}
    try:
        hist = _faceit_get(f'/players/{pid}/history', key, {'game': 'cs2', 'limit': 20})
    except Exception:
        return jsonify({'ok': False, 'message': 'Could not load match history'})

    def _stat(it):
        mid = it.get('match_id')
        finished = it.get('finished_at')
        try:
            st = _faceit_get(f'/matches/{mid}/stats', key)
        except Exception:
            return None
        rounds = st.get('rounds') or []
        if not rounds:
            return None
        rs = rounds[0].get('round_stats', {})
        nums = re.findall(r'\d+', rs.get('Score', ''))
        sa, sb = (int(nums[0]), int(nums[1])) if len(nums) >= 2 else (0, 0)
        winner = rs.get('Winner', '')
        k = d = None
        pteam = None
        for tm in rounds[0].get('teams', []):
            for p in tm.get('players', []):
                if p.get('player_id') == pid:
                    ps = p.get('player_stats', {})
                    k, d = int(ps.get('Kills', 0)), int(ps.get('Deaths', 0))
                    pteam = tm.get('team_id')
        if k is None:
            return None
        return {
            'matchId': mid, 'map': rs.get('Map', ''),
            'scoreA': sa, 'scoreB': sb, 'kills': k, 'deaths': d,
            'kd': '%.2f' % (k / max(1, d)), 'win': winner == pteam,
            'date': (int(finished) * 1000) if finished else None, 'hasDemo': True,
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(_stat, hist.get('items', [])))
    return jsonify({'ok': True, 'player': player, 'matches': [m for m in res if m]})

@app.route('/api/faceit/load', methods=['POST'])
def faceit_load():
    key = _faceit_key()
    if not key:
        return jsonify({'ok': False, 'needKey': True})
    data = request.get_json(silent=True) or {}
    mid = str(data.get('matchId', '')).strip()
    if not mid:
        return jsonify({'ok': False, 'message': 'No match selected'})
    try:
        det = _faceit_get(f'/matches/{mid}', key)
    except Exception:
        return jsonify({'ok': False, 'message': 'Could not load match details'})
    raw = det.get('demo_url')
    urls = [raw] if isinstance(raw, str) else (raw if isinstance(raw, list) else [])
    urls = [u for u in urls if isinstance(u, str) and u.startswith('http')]
    if not urls:
        return jsonify({'ok': False, 'message': 'Demo is not available for this match (expired)'})
    try:
        dl = _faceit_download_url(urls[0], key)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return jsonify({'ok': False, 'message':
                'Your FACEIT key has no Downloads API access — recreate the key with the Downloads scope'})
        return jsonify({'ok': False, 'message': f'FACEIT download API error {e.code}'})
    except Exception as e:
        return jsonify({'ok': False, 'message': f'Could not get download link: {e}'})
    if not dl:
        dl = urls[0]
    import gzip
    candidates = _faceit_demo_hosts(dl)
    tmp_c = os.path.join(tempfile.gettempdir(), f'cs2prak_fc_{int(time.time())}.bin')
    tmp   = os.path.join(tempfile.gettempdir(), f'cs2prak_fc_{int(time.time())}.dem')
    errs, ok = [], False
    for cu in candidates:
        host = urllib.parse.urlparse(cu).hostname or '?'
        try:
            req = urllib.request.Request(cu, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp_c, 'wb') as f:
                shutil.copyfileobj(r, f, 1 << 20)
            ok = True
            break
        except Exception as e:
            errs.append(f'{host}: {e}')
    if not ok:
        try: os.remove(tmp_c)
        except OSError: pass
        return jsonify({'ok': False, 'message': 'Demo download failed — ' + ' | '.join(errs)})
    try:
        with open(tmp_c, 'rb') as f:
            head = f.read(4)
        if head[:4] == b'\x28\xb5\x2f\xfd':
            import zstandard
            with open(tmp_c, 'rb') as fi, open(tmp, 'wb') as fo:
                zstandard.ZstdDecompressor().copy_stream(fi, fo)
        elif head[:2] == b'\x1f\x8b':
            with gzip.open(tmp_c, 'rb') as gz, open(tmp, 'wb') as fo:
                shutil.copyfileobj(gz, fo, 1 << 20)
        else:
            os.replace(tmp_c, tmp); tmp_c = None
    except Exception as e:
        return jsonify({'ok': False, 'message': f'Demo decompress failed: {e}'})
    finally:
        if tmp_c:
            try: os.remove(tmp_c)
            except OSError: pass
    try:
        return _parse_and_respond(tmp)
    finally:
        try: os.remove(tmp)
        except OSError: pass

@app.route('/update', methods=['POST'])
def update_server():
    global _update_running, _update_log, _update_exit_code
    if _update_running:
        return jsonify({'ok': False, 'message': 'Update already in progress'})

    _update_log = []
    _update_exit_code = None
    _update_running = True

    def _run():
        global _update_running, _update_exit_code
        try:
            _update_log.append('SteamCMD window is now open — watch it for update progress.')
            proc = subprocess.Popen(
                [STEAMCMD, '+login', 'anonymous',
                 '+app_update', '730', 'validate', '+quit'],
                cwd=STEAMCMD_DIR,
                creationflags=subprocess.CREATE_NEW_CONSOLE,
            )
            proc.wait()
            _update_exit_code = proc.returncode
            if _update_exit_code == 0:
                patch_gameinfo()
                _update_log.append('[cs2prak] gameinfo.gi patched for Metamod.')
                _update_log.append('Server updated successfully.')
            else:
                _update_log.append(f'SteamCMD exited with code {proc.returncode}')
        except Exception as e:
            _update_log.append(f'ERROR: {e}')
            _update_exit_code = -1
        finally:
            _update_running = False

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({'ok': True})

@app.route('/update/status')
def update_status():
    return jsonify({
        'running':  _update_running,
        'log':      _update_log,
        'exitCode': _update_exit_code,
    })

@app.route('/api/catalogue/skins')
def api_catalogue_skins():
    _refresh_catalogues_if_changed()
    return jsonify(SKINS_BY_WEAPON)

@app.route('/api/catalogue/gloves')
def api_catalogue_gloves():
    _refresh_catalogues_if_changed()
    return jsonify(GLOVES_CAT)

@app.route('/api/catalogue/agents')
def api_catalogue_agents():
    _refresh_catalogues_if_changed()
    return jsonify(AGENTS_CAT)

@app.route('/api/catalogue/stickers')
def api_catalogue_stickers():
    _refresh_catalogues_if_changed()
    return jsonify(STICKERS_CAT)

@app.route('/api/player/<steamid>')
def api_player_get(steamid):
    try:
        conn = get_db()
        skins = conn.execute(
            'SELECT weapon_team, weapon_defindex, weapon_paint_id, '
            'weapon_wear, weapon_seed, weapon_nametag, '
            'weapon_stattrak, weapon_stattrak_count, '
            'weapon_sticker_0, weapon_sticker_1, weapon_sticker_2, '
            'weapon_sticker_3, weapon_sticker_4 '
            'FROM wp_player_skins WHERE steamid=?', (steamid,)
        ).fetchall()
        knives = conn.execute(
            'SELECT weapon_team, knife FROM wp_player_knife WHERE steamid=?',
            (steamid,)
        ).fetchall()
        gloves = conn.execute(
            'SELECT weapon_team, weapon_defindex FROM wp_player_gloves WHERE steamid=?',
            (steamid,)
        ).fetchall()
        agents = conn.execute(
            'SELECT agent_ct, agent_t FROM wp_player_agents WHERE steamid=?',
            (steamid,)
        ).fetchone()
        conn.close()
        return jsonify({
            'skins':  [dict(r) for r in skins],
            'knives': [dict(r) for r in knives],
            'gloves': [dict(r) for r in gloves],
            'agents': dict(agents) if agents else {},
        })
    except Exception as e:
        return jsonify({'ok': False, 'message': str(e)}), 500

@app.route('/api/player/<steamid>/save', methods=['POST'])
def api_player_save(steamid):
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()

        _empty_sticker = '0;0;0;0;0;0;0'
        for skin in data.get('skins', []):
            st = skin.get('stickers') or []
            while len(st) < 5:
                st.append(_empty_sticker)
            conn.execute(
                'INSERT OR REPLACE INTO wp_player_skins '
                '(steamid, weapon_team, weapon_defindex, weapon_paint_id, '
                ' weapon_wear, weapon_seed, weapon_nametag, '
                ' weapon_stattrak, weapon_stattrak_count, '
                ' weapon_sticker_0, weapon_sticker_1, weapon_sticker_2, '
                ' weapon_sticker_3, weapon_sticker_4) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (steamid,
                 skin['team'], skin['defindex'], skin['paint_id'],
                 skin['wear'], skin['seed'], skin.get('nametag') or None,
                 int(skin['stattrak']), skin['stattrak_count'],
                 st[0], st[1], st[2], st[3], st[4])
            )

        for knife in data.get('knives', []):
            conn.execute(
                'INSERT OR REPLACE INTO wp_player_knife (steamid, weapon_team, knife) '
                'VALUES (?,?,?)',
                (steamid, knife['team'], knife['knife'])
            )

        for glove in data.get('gloves', []):
            conn.execute(
                'INSERT OR REPLACE INTO wp_player_gloves '
                '(steamid, weapon_team, weapon_defindex) VALUES (?,?,?)',
                (steamid, glove['team'], glove['defindex'])
            )

        if 'agents' in data:
            conn.execute(
                'INSERT OR REPLACE INTO wp_player_agents (steamid, agent_ct, agent_t) '
                'VALUES (?,?,?)',
                (steamid,
                 data['agents'].get('ct') or None,
                 data['agents'].get('t')  or None)
            )

        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'message': str(e)}), 500

@app.route('/api/plugins')
def api_plugins():
    ps = _load_plugin_state()
    result = []
    for p in PLUGINS_DEF:
        installed = os.path.exists(p['marker'])
        result.append({
            'id':            p['id'],
            'name':          p['name'],
            'description':   p['description'],
            'github_url':    f"https://github.com/{p['github']}/releases",
            'installed':     installed,
            'local_version': _get_local_version(p, ps),
            'is_dependency': p.get('is_dependency', False),
        })
    return jsonify(result)

@app.route('/api/plugins/latest')
def api_plugins_latest():
    def _fetch(p):
        rel = _github_latest(p['github'], timeout=8,
                             tag_prefix=p.get('github_tag_prefix'))
        return p['id'], rel['tag_name'] if rel else None

    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as exe:
        futs = {exe.submit(_fetch, p): p for p in PLUGINS_DEF}
        done, _ = concurrent.futures.wait(futs, timeout=12)
        for fut in done:
            try:
                pid, ver = fut.result()
                result[pid] = ver
            except Exception:
                pass
    return jsonify(result)

@app.route('/api/plugins/<plugin_id>/download', methods=['POST'])
def api_plugin_download(plugin_id):
    plugin = next((p for p in PLUGINS_DEF if p['id'] == plugin_id), None)
    if not plugin:
        return jsonify({'ok': False, 'message': 'Unknown plugin'}), 404
    if _plugin_jobs.get(plugin_id, {}).get('running'):
        return jsonify({'ok': False, 'message': 'Download already running'})

    os_pref = request.args.get('os', 'windows').lower()
    if os_pref not in ('windows', 'linux'):
        os_pref = 'windows'

    job = {'running': True, 'log': [], 'exitCode': None}
    _plugin_jobs[plugin_id] = job

    def _run():
        try:
            _download_plugin_zip(plugin_id, job['log'], os_pref)
            job['exitCode'] = 0
        except Exception as e:
            job['log'].append(f'ERROR: {e}')
            job['exitCode'] = -1
        finally:
            job['running'] = False

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({'ok': True})

@app.route('/api/open-csgo', methods=['POST'])
def api_open_csgo():
    """Open the server's csgo folder (where addons lives) in File Explorer."""
    if not os.path.isdir(CSGO_BASE):
        return jsonify({'ok': False, 'message': 'CS2 server not installed yet.'}), 400
    try:
        subprocess.Popen(['explorer', CSGO_BASE])
    except Exception as e:
        return jsonify({'ok': False, 'message': str(e)}), 500
    return jsonify({'ok': True})

@app.route('/api/plugins/<plugin_id>/download/status')
def api_plugin_download_status(plugin_id):
    job = _plugin_jobs.get(plugin_id)
    if not job:
        return jsonify({'running': False, 'log': [], 'exitCode': None})
    return jsonify({
        'running':  job['running'],
        'log':      job['log'],
        'exitCode': job['exitCode'],
    })

@app.route('/api/server/status')
def api_server_status():
    return jsonify({'installed': os.path.exists(CS2_EXE)})

@app.route('/api/server/install', methods=['POST'])
def api_server_install():
    global _server_install_running, _server_install_log, _server_install_exit_code
    if _server_install_running:
        return jsonify({'ok': False, 'message': 'Install already in progress'})
    _server_install_log = []
    _server_install_exit_code = None
    _server_install_running = True

    def _run():
        global _server_install_running, _server_install_exit_code
        try:
            _install_server(_server_install_log)
            _server_install_exit_code = 0
        except Exception as e:
            _server_install_log.append(f'ERROR: {e}')
            _server_install_exit_code = -1
        finally:
            _server_install_running = False

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({'ok': True})

@app.route('/api/server/install/status')
def api_server_install_status():
    return jsonify({
        'running':  _server_install_running,
        'log':      _server_install_log,
        'exitCode': _server_install_exit_code,
    })

@app.route('/api/configure', methods=['POST'])
def api_configure():
    global _configure_running, _configure_log, _configure_exit_code
    if _configure_running:
        return jsonify({'ok': False, 'message': 'Configure already in progress'})
    _configure_log = []
    _configure_exit_code = None
    _configure_running = True

    def _run():
        global _configure_running, _configure_exit_code
        try:
            _configure_server(_configure_log)
            _configure_exit_code = 0
        except Exception as e:
            _configure_log.append(f'ERROR: {e}')
            _configure_exit_code = -1
        finally:
            _configure_running = False

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({'ok': True})

@app.route('/api/configure/status')
def api_configure_status():
    return jsonify({
        'running':  _configure_running,
        'log':      _configure_log,
        'exitCode': _configure_exit_code,
    })

def _get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

@app.route('/api/server/connect-info')
def api_connect_info():
    return jsonify({'ip': _get_local_ip(), 'port': 27015})

@app.route('/api/admin')
def api_admin_get():
    try:
        with open(ADMINS_JSON, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for v in data.values():
            if isinstance(v, dict) and 'identity' in v:
                return jsonify({'steamid': v['identity']})
    except Exception:
        pass
    return jsonify({'steamid': ''})

@app.route('/api/admin', methods=['POST'])
def api_admin_set():
    data = request.get_json(silent=True) or {}
    steamid = str(data.get('steamid', '')).strip()
    if not re.fullmatch(r'7656119\d{10}', steamid):
        return jsonify({'ok': False, 'message': 'Invalid SteamID64'}), 400
    try:
        os.makedirs(os.path.dirname(ADMINS_JSON), exist_ok=True)
        admins = {'Server Admin': {'identity': steamid, 'flags': ['@css/root']}}
        with open(ADMINS_JSON, 'w', encoding='utf-8') as f:
            json.dump(admins, f, indent=4)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'message': str(e)}), 500

def _resolve_steamid64(text: str) -> str | None:
    text = (text or '').strip()
    if not text:
        return None
    if re.fullmatch(r'7656119\d{10}', text):
        return text
    m = re.search(r'/profiles/(7656119\d{10})', text)
    if m:
        return m.group(1)
    vanity = None
    m = re.search(r'steamcommunity\.com/id/([^/?#]+)', text)
    if m:
        vanity = m.group(1)
    elif re.fullmatch(r'[A-Za-z0-9_.\-]{2,64}', text):
        vanity = text
    if vanity:
        try:
            url = f'https://steamcommunity.com/id/{urllib.parse.quote(vanity)}/?xml=1'
            req = urllib.request.Request(url, headers={'User-Agent': 'cs2prak/1.0'})
            with urllib.request.urlopen(req, timeout=8) as r:
                xml = r.read().decode('utf-8', 'replace')
            mm = re.search(r'<steamID64>(\d{17})</steamID64>', xml)
            if mm:
                return mm.group(1)
        except Exception:
            pass
    return None

@app.route('/api/resolve-steamid', methods=['POST'])
def api_resolve_steamid():
    data = request.get_json(silent=True) or {}
    sid = _resolve_steamid64(str(data.get('input', '')))
    if sid:
        return jsonify({'ok': True, 'steamid': sid})
    return jsonify({'ok': False, 'message':
        'Could not find a SteamID64. Paste your full profile link or SteamID64.'}), 400

def _known_plugin_folders() -> dict:
    """Map lowercased folder-name → friendly name for plugins this tool manages."""
    known = {}
    for p in PLUGINS_DEF:
        marker = p['marker']
        try:
            rel = os.path.relpath(marker, CSS_PLUGINS)
        except ValueError:
            continue
        if rel.startswith('..'):
            continue
        folder = rel.split(os.sep)[0]
        known[folder.lower()] = p['name']
    return known

def _scan_plugin_dir(base: str, enabled: bool, known: dict) -> list:
    out = []
    if not os.path.isdir(base):
        return out
    for name in os.listdir(base):
        d = os.path.join(base, name)
        if not os.path.isdir(d):
            continue
        try:
            has_dll = any(f.lower().endswith('.dll') for f in os.listdir(d))
        except OSError:
            has_dll = False
        if not has_dll:
            continue
        out.append({
            'folder':   name,
            'enabled':  enabled,
            'external': name.lower() not in known,
            'name':     known.get(name.lower(), name),
        })
    return out

@app.route('/api/plugins/installed')
def api_plugins_installed():
    known = _known_plugin_folders()
    items  = _scan_plugin_dir(CSS_PLUGINS, True, known)
    items += _scan_plugin_dir(CSS_PLUGINS_DISABLED, False, known)
    items.sort(key=lambda x: (x['external'], x['name'].lower()))
    return jsonify(items)

@app.route('/api/plugins/installed/<folder>/toggle', methods=['POST'])
def api_plugins_toggle(folder):
    if not folder or '/' in folder or '\\' in folder or '..' in folder:
        return jsonify({'ok': False, 'message': 'Invalid plugin folder.'}), 400

    data   = request.get_json(silent=True) or {}
    enable = bool(data.get('enabled'))
    src_base = CSS_PLUGINS_DISABLED if enable else CSS_PLUGINS
    dst_base = CSS_PLUGINS if enable else CSS_PLUGINS_DISABLED
    src = os.path.join(src_base, folder)
    dst = os.path.join(dst_base, folder)

    if not os.path.isdir(src):
        if os.path.isdir(dst):
            return jsonify({'ok': True})
        return jsonify({'ok': False, 'message': 'Plugin folder not found.'}), 404
    try:
        os.makedirs(dst_base, exist_ok=True)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        shutil.move(src, dst)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'message': f'Could not move plugin (is the server running?): {e}'}), 500

def open_browser(port):
    time.sleep(1)
    webbrowser.open(f'http://127.0.0.1:{port}')

if __name__ == '__main__':
    import mysql_sqlite_server
    mysql_sqlite_server.start()
    ensure_schema()
    port = 5000
    threading.Thread(target=open_browser, args=(port,), daemon=True).start()
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)
