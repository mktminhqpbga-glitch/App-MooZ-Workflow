#!/usr/bin/env python3
"""Fail packaging before creating an app with missing media capabilities."""
import shutil
import subprocess

for tool in ['ffmpeg', 'ffprobe']:
    if not shutil.which(tool):
        raise SystemExit(f'Missing {tool}. Build with Tools/build_media_macos.py on Intel Mac, then add stage/bin to PATH; see native/README.md.')


def names(option):
    text = subprocess.check_output(['ffmpeg', '-hide_banner', option], text=True, stderr=subprocess.DEVNULL)
    return {columns[1] for line in text.splitlines() if len(columns := line.split()) >= 2}


if 'subtitles' not in names('-filters') or not {'libx264', 'aac'}.issubset(names('-encoders')) or 'lavfi' not in names('-devices'):
    raise SystemExit('FFmpeg requires subtitles/libass, libx264, AAC and lavfi. For Intel Ventura use Tools/build_media_macos.py and stage/bin; see native/README.md.')
print('PASS media prerequisites: subtitles/libass, H264/AAC, lavfi fixture input and ffprobe.')
