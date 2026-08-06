"""make_release.py — package an INCREMENTAL update release for cs2prak.

Usage:
    python make_release.py <version> [build_dir] [out_dir] [--no-legacy]

  <version>    e.g. 1.0.1  (the GitHub release tag must be v<version>)
  build_dir    PyInstaller one-dir output. Default: dist/cs2prak
  out_dir      where assets are written. Default: release_assets
  --no-legacy  skip the flat per-file assets and ship the bundle only

Produces in out_dir:
  - manifest.json
  - update.zip — every updatable file (cs2prak.exe, frontend code, icons, demo.py)
  - unless --no-legacy: one flattened asset per file as well

Then: create a GitHub Release tagged v<version> on Sevelinish/cs2Prak and upload
EVERY file in out_dir as a release asset. The in-app updater downloads manifest.json,
hashes the user's local files, and pulls only what differs.

About --no-legacy: clients up to 1.1.2 fetch one asset per file and abort with
"asset-missing" if any is absent, so they cannot read a bundle-only release.
Keep the legacy assets while those clients are still in the wild; once everyone
is on 1.1.3+, pass --no-legacy and the release page drops to two files.

Also remember to bump APP_VERSION in app.py to match <version> before building.
"""
import hashlib
import json
import os
import shutil
import sys
import zipfile

BUNDLE = 'update.zip'

def is_updatable(rel: str) -> bool:
    """The set of files that participate in incremental updates: the exe, the demo
    parser, the frontend code (js/css/html) and its icons.

    This is a one-dir build, so everything under _internal/ sits on disk as loose
    files — shipping a new cs2prak.exe does NOT carry new images with it. Icons
    have to be listed here or a fresh UI ends up pointing at files the user does
    not have.

    Radar maps are the one exception: they are 16 MB of the 16.2 MB of imagery and
    have never changed, so they stay out to keep every release small. If a radar
    ever does change, that release needs a full reinstall."""
    rel = rel.replace('\\', '/')
    if rel == 'cs2prak.exe':
        return True
    if rel == '_internal/demo.py':
        return True
    if rel.startswith('_internal/templates/') and rel.endswith('.html'):
        return True
    if not rel.startswith('_internal/static/'):
        return False
    if rel.startswith('_internal/static/radars/'):
        return False
    return rel.endswith(('.js', '.css', '.svg', '.png', '.jpg', '.ico'))

def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    argv = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    if not argv:
        print(__doc__)
        sys.exit(1)
    version = argv[0].lstrip('v')
    build = argv[1] if len(argv) > 1 else os.path.join('dist', 'cs2prak')
    out = argv[2] if len(argv) > 2 else 'release_assets'
    legacy = '--no-legacy' not in flags

    if not os.path.isfile(os.path.join(build, 'cs2prak.exe')):
        print(f'! cs2prak.exe not found in {build} — build first or pass build_dir')
        sys.exit(1)

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    files, total = {}, 0
    bundle_path = os.path.join(out, BUNDLE)
    bundle = zipfile.ZipFile(bundle_path, 'w', zipfile.ZIP_DEFLATED)
    for root, _dirs, names in os.walk(build):
        for name in names:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, build).replace('\\', '/')
            if not is_updatable(rel):
                continue
            bundle.write(full, rel)
            entry = {'sha256': sha256(full)}
            if legacy:
                # Clients up to 1.1.2 fetch one asset per file and hard-fail when
                # one is missing, so they keep getting the flat assets until
                # everybody is on a bundle-aware build.
                asset = rel.replace('/', '__')
                shutil.copy2(full, os.path.join(out, asset))
                entry['asset'] = asset
            files[rel] = entry
            total += os.path.getsize(full)

    bundle.close()
    manifest = {
        'version': version,
        'files': files,
        'bundle': {'asset': BUNDLE, 'sha256': sha256(bundle_path),
                   'size': os.path.getsize(bundle_path)},
    }
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    print(f'Release v{version}: {len(files)} files packed into {BUNDLE} '
          f'({os.path.getsize(bundle_path) / 1048576:.1f} MB, {total / 1048576:.1f} MB raw)'
          + (f' + {len(files)} legacy per-file assets' if legacy else ' — bundle only'))
    for rel in sorted(files):
        print(f'  {rel}')
    print('\nNext: create a GitHub Release tagged '
          f'v{version} and upload every file in {out}/ as an asset.')

if __name__ == '__main__':
    main()
