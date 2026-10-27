#!/usr/bin/env python3
"""Pack an extracted APK inventory into independently decodable MP3 slices.

Input: directory containing inventory.json and its lossless extracted WAVs.
Requires ffmpeg. Each bank is fetched once; only requested clips are decoded.
No existing POKERTEN audio is overwritten.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import wave

source = Path(sys.argv[1])
dest = Path(__file__).resolve().parents[1] / 'assets/sounds/zynga-23-29-705'
dest.mkdir(parents=True, exist_ok=True)
inventory = json.loads((source / 'inventory.json').read_text())
spec = json.loads((dest / 'events.json').read_text())
core = set(sum(spec['events'].values(), []) + list(spec['aliases'].values()))
# Keep gameplay in the first small banks. Music and optional catalog clips are lazy.
inventory.sort(key=lambda r: (0 if r['name'] in core else 1 if r['name'] == spec['music'] else 2, r['name']))

def convert(row):
    wav = source / row['file']
    mp3 = wav.with_suffix('.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-map_metadata', '-1',
                    '-c:a', 'libmp3lame', '-q:a', '4', str(mp3)], check=True)
    # Validate every encoded clip through a real decoder before shipping it.
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp3), '-f', 'null', '-'], check=True)
    with wave.open(str(wav)) as f:
        duration = f.getnframes() / f.getframerate()
    return row, mp3.read_bytes(), duration

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    converted = list(pool.map(convert, inventory))

clips = []
banks = []
bank = bytearray()
def flush():
    if not bank:
        return
    name = 'bank-%02d.bin' % len(banks)
    (dest / name).write_bytes(bank)
    banks.append({'file': name, 'bytes': len(bank), 'sha256': hashlib.sha256(bank).hexdigest()})
    bank.clear()

for row, data, duration in converted:
    if bank and len(bank) + len(data) > 384000:
        flush()
    clips.append({'name': row['name'], 'bank': len(banks), 'offset': len(bank), 'bytes': len(data),
                  'duration': round(duration, 6), 'sha256': hashlib.sha256(data).hexdigest()})
    bank.extend(data)
flush()
assert len(clips) == len(inventory) == 379
assert len({c['name'] for c in clips}) == len(clips)
catalog = {'id': 'zynga-23-29-705', 'source': 'User-provided zynga-poker-23-29-705.apk',
           'count': len(clips), 'banks': banks, 'clips': clips}
(dest / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
print(json.dumps({'clips': len(clips), 'banks': len(banks), 'bytes': sum(b['bytes'] for b in banks)}))
