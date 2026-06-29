# cs2prak

A local **CS2 practice-server launcher & companion** for Windows. Spin up a Counter‑Strike 2 dedicated server, apply weapon skins, manage plugins, generate binds, and replay your demos in a built‑in 2D viewer - all from one hand‑built desktop UI.

The app is a Flask backend packaged into a single Windows tray application with PyInstaller; the interface opens in your browser at `http://127.0.0.1:5000` and only ever listens on loopback.

---

## Features

- **Server launcher** - pick a map from the FACEIT pool and launch a local CS2 dedicated server; copy the connect string or jump straight into the game.
- **Skins editor** - configure WeaponPaints skins, knives, gloves, wear, seed, name tags, StatTrak and stickers per weapon (backed by a built‑in MySQL‑over‑SQLite shim, so no MySQL/XAMPP install required).
- **Plugin manager** - install/update CounterStrikeSharp, Metamod, MatchZy, WeaponPaints and more from their official GitHub releases; enable/disable installed plugins.
- **Binds generator** - bind plugin chat‑commands to keys and export `sBinds.cfg`.
- **Demo viewer (Analytics)** - drop in `.dem` / `.dem.gz` / `.dem.zst` (or a `.zip`); they parse locally into a 2D radar replay with kill feed, voice, grenade visuals (smoke/molotov/HE/flash) and a freehand pencil.
- **Statistics** - a scoreboard view plus an **Advanced** per‑player "duel lab" (reaction, crosshair placement, first‑bullet, counter‑strafe). *(beta)*
- **Polish** - EN/RU interface, three colour themes, and a first‑run guided tour.

> Everything runs and stays on your machine. Demos are parsed locally; nothing is uploaded.

---

## Requirements

- **Windows** 10 / 11 (x64)
- **Python 3.11** (to run from source or build)
- A free **FACEIT API key** is optional (only needed for FACEIT demo download and avatars)

---

## Run from source

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open <http://127.0.0.1:5000>. (`app.py` is the dev entry point - Flask's dev server. The packaged app uses `cs2prak.py`, which adds the system tray, the MySQL shim and a waitress server.)

The `maps/` folder (map thumbnails) and `static/` must sit next to the entry script - they already do in this repo.

## Build the Windows app

```bash
pip install pyinstaller
python -m PyInstaller cs2prak.spec --noconfirm --clean
```

The result is a one‑dir build in `dist/cs2prak/` (`cs2prak.exe` + `_internal/`). Copy the `maps/` folder next to `cs2prak.exe` if it isn't already there. First launch can download the CS2 server, the .NET runtime and the plugins on demand.

---

## How it works (layout)

| File | Role |
|------|------|
| `cs2prak.py` | Packaged entry point - tray icon, MySQL shim, waitress, browser launch |
| `app.py` | Flask backend - all routes, server control, skins DB, plugin/demo APIs |
| `demo.py` | Demo parsing (demoparser2) → 2D replay + per‑player stats |
| `mysql_sqlite_server.py` | MySQL wire‑protocol server backed by SQLite, for WeaponPaints |
| `static/`, `templates/` | Frontend (vanilla JS + CSS + Jinja) |
| `maps/` | Map thumbnails |
| `cs2prak.spec` | PyInstaller build recipe |

---

## Credits

This tool is a launcher - the heavy lifting is done by these community projects (installed from their official releases):

- **CounterStrikeSharp** - [@roflmuffin](https://github.com/roflmuffin/CounterStrikeSharp)
- **Metamod:Source** - [AlliedModders](https://github.com/alliedmodders/metamod-source)
- **MatchZy** - [@shobhit-pathak](https://github.com/shobhit-pathak/MatchZy)
- **WeaponPaints** - [@Nereziel](https://github.com/Nereziel/cs2-WeaponPaints)
- **PlayerSettings / MenuManagerCS2 / AnyBaseLibCS2** - [@NickFox007](https://github.com/NickFox007)

Built with [Flask](https://flask.palletsprojects.com/), [waitress](https://github.com/Pylons/waitress), [demoparser2](https://github.com/LaihoE/demoparser), [polars](https://github.com/pola-rs/polars), [pystray](https://github.com/moses-palmer/pystray) (LGPL‑3.0), [Pillow](https://github.com/python-pillow/Pillow), [mysql-mimic](https://github.com/kelsin/mysql-mimic) and [PyOgg](https://github.com/TeamPyOgg/PyOgg).

## Assets / trademarks

Counter‑Strike 2 and all related map names, radar images and map thumbnails are the property of **Valve Corporation**. This project is an unofficial, non‑commercial fan tool and is not affiliated with or endorsed by Valve or FACEIT. The CS2 game files and plugins are downloaded from their original sources at runtime, not redistributed here.

## License

Released under the [MIT License](LICENSE).

---

_Developed by [Sevelinish](https://github.com/Sevelinish) with engineering assistance from Claude Opus 4.8 (Anthropic)._
