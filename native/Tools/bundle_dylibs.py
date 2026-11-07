#!/usr/bin/env python3
"""Bundle recursive FFmpeg dylibs; reject missing or conflicting libraries."""
from pathlib import Path
import shutil, subprocess, sys

app = Path(sys.argv[1]).resolve()
frameworks = app / 'Contents/Frameworks'
frameworks.mkdir(parents=True, exist_ok=True)
sources = {}

def output(*args):
    return subprocess.check_output(args, text=True)

def dependencies(file):
    return [line.strip().split(' (', 1)[0] for line in output('otool', '-L', str(file)).splitlines()[1:]]

def rpaths(file):
    lines = output('otool', '-l', str(file)).splitlines()
    return [lines[i+2].strip().removeprefix('path ').split(' (offset ', 1)[0]
            for i, line in enumerate(lines) if line.strip() == 'cmd LC_RPATH']

def expand(value, original, executable):
    return Path(value.replace('@loader_path', str(original.parent)).replace('@executable_path', str(executable.parent)))

def resolve(name, original, executable):
    if name.startswith('@rpath/'):
        relative = name.removeprefix('@rpath/')
        roots = [expand(p, original, executable) for p in rpaths(original)]
        roots += [expand(p, executable, executable) for p in rpaths(executable)]
        candidates = [root / relative for root in roots] + [original.parent / relative]
    else:
        candidates = [expand(name, original, executable)]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(f'Cannot resolve {name} from {original}')

def add_rpath(file, value):
    # CI has Homebrew installed: retaining its rpaths would let smoke tests silently
    # load host libraries instead of proving the copied app is self-contained.
    for previous in rpaths(file):
        subprocess.run(['install_name_tool', '-delete_rpath', previous, str(file)], check=True)
    subprocess.run(['install_name_tool', '-add_rpath', value, str(file)], check=True)

def process(target, original, executable):
    own_id = output('otool', '-D', str(original)).splitlines()[1:] if original.suffix == '.dylib' else []
    for name in dependencies(original):
        if name in own_id or name.startswith(('/usr/lib/', '/System/Library/')):
            continue
        candidate = resolve(name, original, executable)
        library = frameworks / candidate.name
        if library.name in sources and sources[library.name] != candidate:
            raise RuntimeError(f'Conflicting dylib name: {library.name}')
        if library.name not in sources:
            sources[library.name] = candidate
            shutil.copy2(candidate, library)
            library.chmod(0o755)
            subprocess.run(['install_name_tool', '-id', '@rpath/' + library.name, str(library)], check=True)
            process(library, candidate, executable)
            add_rpath(library, '@loader_path')
        subprocess.run(['install_name_tool', '-change', name, '@rpath/' + library.name, str(target)], check=True)

for tool in ['ffmpeg', 'ffprobe']:
    original = Path(shutil.which(tool)).resolve()
    binary = app / 'Contents/Resources/bin' / tool
    process(binary, original, original)
    add_rpath(binary, '@loader_path/../../Frameworks')
