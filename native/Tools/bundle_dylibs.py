#!/usr/bin/env python3
"""Bundle Homebrew FFmpeg's non-system dylibs; a copied executable alone is not standalone."""
from pathlib import Path
import hashlib, shutil, subprocess, sys
app=Path(sys.argv[1]).resolve()
frameworks=app/'Contents/Frameworks'
seen=set()
def dependencies(file):
    return [line.strip().split(' (',1)[0] for line in subprocess.check_output(['otool','-L',str(file)],text=True).splitlines()[1:]]
def process(file, original):
    key=str(original.resolve())
    if key in seen:return
    seen.add(key)
    for name in dependencies(original):
        if name.startswith(('/usr/lib/','/System/Library/')):continue
        if name.startswith('@rpath/'):
            candidate=original.parent/name.removeprefix('@rpath/')
        elif name.startswith('@loader_path/'):
            candidate=original.parent/name.removeprefix('@loader_path/')
        else:candidate=Path(name)
        if not candidate.exists():raise RuntimeError(f'Cannot resolve native dependency {name} from {original}')
        target=frameworks/candidate.name
        if target.exists():
            if hashlib.sha256(target.read_bytes()).digest()!=hashlib.sha256(candidate.read_bytes()).digest() and str(candidate.resolve()) not in seen:
                raise RuntimeError(f'Conflicting dylib name: {candidate.name}')
        else:
            shutil.copy2(candidate,target)
            target.chmod(0o755)
            subprocess.run(['install_name_tool','-id','@rpath/'+target.name,str(target)],check=True)
            process(target,candidate)
            subprocess.run(['install_name_tool','-add_rpath','@loader_path',str(target)],check=True)
        subprocess.run(['install_name_tool','-change',name,'@rpath/'+target.name,str(file)],check=True)
for tool in ['ffmpeg','ffprobe']:
    binary=app/'Contents/Resources/bin'/tool
    original=Path(shutil.which(tool) or '')
    process(binary,original)
    subprocess.run(['install_name_tool','-add_rpath','@loader_path/../../Frameworks',str(binary)],check=True)
