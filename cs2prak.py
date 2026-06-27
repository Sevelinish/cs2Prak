"""
cs2prak.py — entry point for cs2prak.exe

Start order:
  1. Lower own process priority (idle) so Python never steals CPU from the game.
  2. Start the MySQL-over-SQLite server on 127.0.0.1:3306 (WeaponPaints connects here).
  3. Ensure the skins.db schema exists.
  4. Start Flask (waitress) in a background thread.
  5. Open browser.
  6. Start daemon thread that monitors the CS2 console window:
       - If minimized by the user, hides it (removes from taskbar) instead.
       - "Open Console" in the tray restores + focuses it.
  7. System-tray icon — Quit shuts everything down cleanly.
"""

import sys
import os
import time
import ctypes
import threading
import subprocess
import webbrowser

def _fix_std_fds():
    if not getattr(sys, 'frozen', False):
        return
    try:
        nul = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            try:
                os.dup2(nul, fd)
            except OSError:
                pass
    except OSError:
        pass

_fix_std_fds()

import pystray
from PIL import Image, ImageDraw

import mysql_sqlite_server
import app as server

def _lower_priority():
    IDLE = 0x00000040
    try:
        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), IDLE)
    except Exception:
        pass

_lower_priority()

def _make_icon() -> Image.Image:
    """Signal-orange power/standby glyph on transparency — the same mark as the
    .exe icon, simplified for the tray: no tile, heavier stroke and a wide top
    gap so the open ring stays legible at ~16px on any taskbar colour.
    Drawn at 64px (the OS resizes it down) and returned as a PIL image, which
    pystray requires."""
    import math
    signal = (0xff, 0x6a, 0x1f, 255)

    ss   = 8
    size = 64
    S    = size * ss
    img  = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d    = ImageDraw.Draw(img)

    cx = cy = S / 2.0
    r      = S * 0.33
    stroke = S * 0.115
    cap    = stroke / 2.0
    cy    += r * 0.10

    gap = 52
    start = -90 + gap / 2.0
    end   = 270 - gap / 2.0
    d.arc([cx - r, cy - r, cx + r, cy + r], start=start, end=end,
          fill=signal, width=int(round(stroke)))
    for ang in (start, end):
        ex = cx + r * math.cos(math.radians(ang))
        ey = cy + r * math.sin(math.radians(ang))
        d.ellipse([ex - cap, ey - cap, ex + cap, ey + cap], fill=signal)

    stem_top = cy - r * 1.16
    stem_bot = cy - r * 0.02
    d.line([(cx, stem_top), (cx, stem_bot)], fill=signal, width=int(round(stroke)))
    for ey in (stem_top, stem_bot):
        d.ellipse([cx - cap, ey - cap, cx + cap, ey + cap], fill=signal)

    return img.resize((size, size), Image.LANCZOS)

def _get_cs2_console_hwnd():
    """Return the cached HWND of the CS2 console window, or None."""
    return server._cs2_console_hwnd

def _monitor_console_minimize():
    """Daemon thread: when the CS2 console window is minimized, hide it from
    the taskbar instead (true minimize-to-tray behaviour).  The tray's
    'Open Console' item restores it."""
    GWL_STYLE   = -16
    WS_MINIMIZE = 0x20000000
    SW_HIDE     = 0
    user32 = ctypes.windll.user32
    while True:
        hwnd = _get_cs2_console_hwnd()
        if hwnd:
            try:
                style = user32.GetWindowLongW(hwnd, GWL_STYLE)
                if style & WS_MINIMIZE:
                    user32.ShowWindow(hwnd, SW_HIDE)
            except Exception:
                pass
        time.sleep(0.15)

def _on_open(icon, item):
    webbrowser.open('http://127.0.0.1:5000')

def _on_show_console(icon, item):
    """Show and focus the CS2 server console window."""
    hwnd = _get_cs2_console_hwnd()
    if hwnd:
        ctypes.windll.user32.ShowWindow(hwnd, 9)
        ctypes.windll.user32.SetForegroundWindow(hwnd)

def _on_quit(icon, item):
    if server.cs2_process and server.cs2_process.poll() is None:
        try:
            subprocess.Popen(
                ['taskkill', '/f', '/t', '/pid', str(server.cs2_process.pid)],
                creationflags=subprocess.CREATE_NO_WINDOW,
            ).wait(timeout=5)
        except Exception:
            try:
                server.cs2_process.terminate()
            except Exception:
                pass
    if server.is_update_staged():
        server.apply_staged_update()
    icon.stop()
    os._exit(0)

def _run_flask():
    from waitress import serve
    serve(server.app, host='127.0.0.1', port=5000, threads=2)

def main():
    mysql_sqlite_server.start()

    server.ensure_schema()

    threading.Thread(target=_run_flask, daemon=True).start()
    threading.Timer(1.5, lambda: webbrowser.open('http://127.0.0.1:5000')).start()

    server.start_update_check()

    threading.Thread(target=_monitor_console_minimize, daemon=True).start()

    menu = pystray.Menu(
        pystray.MenuItem('Open CS2 Practice', _on_open, default=True),
        pystray.MenuItem('Open Console', _on_show_console),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem('Quit', _on_quit),
    )
    tray = pystray.Icon('cs2prak', _make_icon(), 'CS2 Practice Server', menu)
    tray.run()

if __name__ == '__main__':
    main()
