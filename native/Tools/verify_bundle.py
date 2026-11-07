#!/usr/bin/env python3
"""Reject unbundled Homebrew load paths and derive the actual minimum macOS version."""
from pathlib import Path
import json, os, plistlib, re, subprocess, sys

app = Path(sys.argv[1]).resolve()
frameworks = app / 'Contents/Frameworks'
files = [app / 'Contents/Resources/bin' / tool for tool in ['ffmpeg', 'ffprobe']]
files += list(frameworks.glob('*.dylib'))
main = app / 'Contents/MacOS/MooZ'
architectures = set(subprocess.check_output(['lipo', '-archs', str(main)], text=True).split())
minimum = (13, 0)
for file in files + [main]:
    file_architectures = set(subprocess.check_output(['lipo', '-archs', str(file)], text=True).split())
    if not architectures.issubset(file_architectures):
        raise RuntimeError(f'Architecture mismatch in {file.name}: app={architectures}, library={file_architectures}')
    loads = subprocess.check_output(['otool', '-L', str(file)], text=True).splitlines()[1:] if file != main else []
    for row in loads:
        path = row.strip().split(' (', 1)[0]
        if path.startswith(('/usr/lib/', '/System/Library/')):
            continue
        if not path.startswith('@rpath/') or not (frameworks / path.removeprefix('@rpath/')).is_file():
            raise RuntimeError(f'Unbundled native load path {path} in {file}')
    commands = subprocess.check_output(['otool', '-l', str(file)], text=True)
    for block in commands.split('Load command '):
        if file != main and 'cmd LC_RPATH' in block:
            rpath = re.search(r'\bpath\s+(.+?)\s+\(offset', block).group(1)
            expected = '@loader_path' if file.parent == frameworks else '@loader_path/../../Frameworks'
            if rpath != expected:
                raise RuntimeError(f'Unexpected host rpath in {file.name}: {rpath}')
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
report = {'minimumMacOS': info['LSMinimumSystemVersion'], 'architectures': sorted(architectures), 'bundledDylibs': len(files) - 2}
(app / 'Contents/Resources/bundle-info.json').write_text(json.dumps(report, indent=2))
print(f'Bundle architecture is host-specific; minimum macOS including media tools: {info["LSMinimumSystemVersion"]}')
if os.environ.get('GITHUB_ACTIONS') == 'true':
    print('::notice title=Native bundle compatibility::' + json.dumps(report, separators=(',', ':')))
