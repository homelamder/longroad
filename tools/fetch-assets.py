# Downloads the CC0 asset set (PolyHaven) the realistic renderer uses.
# Idempotent: skips files already on disk. Everything lands in public/ so the
# static build ships it. All assets CC0 — no attribution required, safe to
# redistribute from a public repo.
import json
import os
import sys
import urllib.request

# PolyHaven's CDN 403s the default Python UA; identify like a browser.
OPENER = urllib.request.build_opener()
OPENER.addheaders = [('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) longroad-asset-fetch')]
urllib.request.install_opener(OPENER)

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
# Raw photoscans are decimation inputs, NOT runtime assets — they must never land
# in public/ or the (gigabyte-scale) originals ship inside every build.
RAW = os.path.join(os.path.dirname(__file__), '..', 'tmp-assets', 'models-raw')
API = 'https://api.polyhaven.com/files/'

TEXTURES = {
    # slug -> maps to fetch (1k jpg)
    'aerial_grass_rock': ['Diffuse', 'nor_gl'],
    'cliff_side': ['Diffuse', 'nor_gl'],
    'snow_02': ['Diffuse', 'nor_gl'],
    'forest_leaves_02': ['Diffuse', 'nor_gl'],
    'dense_sand': ['Diffuse', 'nor_gl'],
    'asphalt_02': ['Diffuse', 'nor_gl', 'Rough'],
}

HDRIS = {
    'hilly_terrain_01_puresky': '1k',
}

MODELS = [
    'pine_tree_01', 'fir_tree_01', 'island_tree_01', 'quiver_tree_01',
    'dead_tree_trunk', 'boulder_01', 'namaqualand_boulder_02',
    'pine_sapling_medium', 'tree_stump_01',
]


def fetch(url, dest):
    if os.path.exists(dest):
        print('  have', os.path.basename(dest))
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print('  get ', os.path.basename(dest), '<-', url)
    urllib.request.urlretrieve(url, dest)


def main():
    for slug, maps in TEXTURES.items():
        print('[tex]', slug)
        info = json.load(urllib.request.urlopen(API + slug))
        for m in maps:
            entry = info[m]['1k']['jpg']
            fetch(entry['url'], os.path.join(ROOT, 'tex', f'{slug}_{m.lower()}_1k.jpg'))

    for slug, res in HDRIS.items():
        print('[hdri]', slug)
        info = json.load(urllib.request.urlopen(API + slug))
        entry = info['hdri'][res]['hdr']
        fetch(entry['url'], os.path.join(ROOT, 'tex', f'{slug}_{res}.hdr'))

    for slug in MODELS:
        print('[model]', slug)
        info = json.load(urllib.request.urlopen(API + slug))
        entry = info['gltf']['1k']
        base = os.path.join(RAW, slug)
        fetch(entry['gltf']['url'], os.path.join(base, f'{slug}.gltf'))
        for rel, sub in entry['gltf'].get('include', {}).items():
            fetch(sub['url'], os.path.join(base, rel))


if __name__ == '__main__':
    main()
    total = 0
    for dirpath, _, files in os.walk(ROOT):
        for f in files:
            total += os.path.getsize(os.path.join(dirpath, f))
    print(f'\npublic/ now {total / 1e6:.1f} MB')
