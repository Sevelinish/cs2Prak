"""make_release.py — package an INCREMENTAL update release for cs2prak.

Usage:
    python make_release.py <version> [build_dir] [out_dir]

  <version>    e.g. 1.0.1  (the GitHub release tag must be v<version>)
  build_dir    PyInstaller one-dir output. Default: dist/cs2prak
  out_dir      where assets are written. Default: release_assets

Produces in out_dir:
  - manifest.json
  - one flattened asset per "updatable" file (cs2prak.exe, frontend code, demo.py)

Then: create a GitHub Release tagged v<version> on Sevelinish/cs2Prak and upload
EVERY file in out_dir as a release asset. The in-app updater downloads manifest.json,
hashes the user's local files and fetches only the assets whose hash changed.

Also remember to bump APP_VERSION in app.py to match <version> before building.
"""
import hashlib
import json
import os
import shutil
import sys

def is_updatable(rel: str) -> bool:
    """The set of files that participate in incremental updates: the exe, the demo
    parser, and the frontend code (js/css/html). Images/binaries change ~never and
    are intentionally excluded (a change there means a full reinstall)."""
    rel = rel.replace('\\', '/')
    if rel == 'cs2prak.exe':
        return True
    if rel == '_internal/demo.py':
        return True
    if rel.startswith('_internal/templates/') and rel.endswith('.html'):
        return True
    if rel.startswith('_internal/static/') and rel.endswith(('.js', '.css')):
        return True
    return False

def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    version = sys.argv[1].lstrip('v')
    build = sys.argv[2] if len(sys.argv) > 2 else os.path.join('dist', 'cs2prak')
    out = sys.argv[3] if len(sys.argv) > 3 else 'release_assets'

    if not os.path.isfile(os.path.join(build, 'cs2prak.exe')):
        print(f'! cs2prak.exe not found in {build} — build first or pass build_dir')
        sys.exit(1)

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    files, total = {}, 0
    for root, _dirs, names in os.walk(build):
        for name in names:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, build).replace('\\', '/')
            if not is_updatable(rel):
                continue
            asset = rel.replace('/', '__')
            shutil.copy2(full, os.path.join(out, asset))
            files[rel] = {'sha256': sha256(full), 'asset': asset}
            total += os.path.getsize(full)

    manifest = {'version': version, 'files': files}
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    print(f'Release v{version}: {len(files)} updatable assets '
          f'({total / 1048576:.1f} MB) + manifest.json -> {out}/')
    for rel in sorted(files):
        print(f'  {rel}')
    print('\nNext: create a GitHub Release tagged '
          f'v{version} and upload every file in {out}/ as an asset.')

if __name__ == '__main__':
    main()
