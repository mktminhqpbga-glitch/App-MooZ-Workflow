#!/usr/bin/env python3
"""Reject unbundled Homebrew load paths and derive the actual minimum macOS version."""
from pathlib import Path
import plistlib, re, subprocess, sys

app = Path(sys.argv[1]).resolve()
frameworks = app / 'Contents/Frameworks'
files = [app / 'Contents/Resources/bin' / tool for tool in ['ffmpeg', 'ffprobe']]
files += list(frameworks.glob('*.dylib'))
minimum = (13, 0)
for file in files:
    loads = subprocess.check_output(['otool', '-L', str(file)], text=True).splitlines()[1:]
    for row in loads:
        path = row.strip().split(' (', 1)[0]
        if path.startswith(('/usr/lib/', '/System/Library/')):
            continue
        if not path.startswith('@rpath/') or not (frameworks / path.removeprefix('@rpath/')).is_file():
            raise RuntimeError(f'Unbundled native load path {path} in {file}')
    commands = subprocess.check_output(['otool', '-l', str(file)], text=True)
    for block in commands.split('Load command '):
        if 'cmd LC_BUILD_VERSION' in block:
            match = re.search(r'\bminos\s+([0-9.]+)', block)
        elif 'cmd LC_VERSION_MIN_MACOSX' in block:
            match = re.search(r'\bversion\s+([0-9.]+)', block)
        else:
            continue
        if match:
            minimum = max(minimum, tuple(map(int, match.group(1).split('.'))))
plist = app / 'Contents/Info.plist'
with plist.open('rb') as stream:
    info = plistlib.load(stream)
info['LSMinimumSystemVersion'] = '.'.join(map(str, minimum))
with plist.open('wb') as stream:
    plistlib.dump(info, stream)
print(f'Bundle architecture is host-specific; minimum macOS including media tools: {info["LSMinimumSystemVersion"]}')
