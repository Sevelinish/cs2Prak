# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

block_cipher = None

# Collect mysql_mimic fully — it ships mypyc-compiled .pyd extensions that
# PyInstaller won't find through normal import analysis.
mimic_datas, mimic_binaries, mimic_hiddenimports = collect_all('mysql_mimic')
sqlglot_datas, sqlglot_binaries, sqlglot_hiddenimports = collect_all('sqlglot')
# demoparser2 ships a Rust .pyd extension PyInstaller won't find on its own;
# it imports `polars` at runtime from Rust (invisible to static analysis).
demo_datas, demo_binaries, demo_hiddenimports = collect_all('demoparser2')
polars_datas, polars_binaries, polars_hiddenimports = collect_all('polars')
# pyogg ships the bundled opus.dll used to decode CS2 voice chat
pyogg_datas, pyogg_binaries, pyogg_hiddenimports = collect_all('pyogg')
# zstandard decompresses FACEIT CS2 demos (.dem.zst)
zstd_datas, zstd_binaries, zstd_hiddenimports = collect_all('zstandard')

# mypyc runtime that the mysql_mimic .pyd files link against
import os, sys
_sp = os.path.join(sys.prefix, 'Lib', 'site-packages')
_mypyc = '3e019d0ad8f724d4859b__mypyc.cp311-win_amd64.pyd'
extra_binaries = [( os.path.join(_sp, _mypyc), '.' )]

a = Analysis(
    ['cs2prak.py'],
    pathex=['.'],
    binaries=mimic_binaries + sqlglot_binaries + demo_binaries + polars_binaries + pyogg_binaries + zstd_binaries + extra_binaries,
    datas=[
        ('templates', 'templates'),
        ('static',    'static'),
        ('demo.py',   '.'),
    ] + mimic_datas + sqlglot_datas + demo_datas + polars_datas + pyogg_datas + zstd_datas,
    hiddenimports=[
        'pymysql',
        'pymysql.cursors',
        'pystray._win32',
        'PIL._tkinter_finder',
        'flask',
        'jinja2',
        'werkzeug',
        'werkzeug.serving',
        'werkzeug.debug',
        'waitress',
        'waitress.server',
        'waitress.task',
        'demo',
        'demoparser2',
        'polars',
        'pandas',
        'numpy',
        'pyogg',
        'zstandard',
    ] + mimic_hiddenimports + sqlglot_hiddenimports + demo_hiddenimports + polars_hiddenimports + pyogg_hiddenimports + zstd_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# One-dir build: no per-launch unpacking of a 200 MB archive, so startup is fast.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='cs2prak',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    uac_admin=False,
    icon='icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='cs2prak',
)
