#!/usr/bin/env python3
"""Fail packaging before creating an app with missing media capabilities."""
import shutil
import subprocess

for tool in ['ffmpeg', 'ffprobe']:
    if not shutil.which(tool):
        raise SystemExit(f'Missing {tool}. Install ffmpeg-full and add its bin directory to PATH.')


def names(option):
    text = subprocess.check_output(['ffmpeg', '-hide_banner', option], text=True, stderr=subprocess.DEVNULL)
    return {columns[1] for line in text.splitlines() if len(columns := line.split()) >= 2}


if 'subtitles' not in names('-filters') or not {'libx264', 'aac'}.issubset(names('-encoders')):
    raise SystemExit('FFmpeg requires subtitles/libass, libx264 and AAC. On Mac use brew install ffmpeg-full and its bin directory in PATH.')
print('PASS media prerequisites: subtitles/libass, H264 and AAC; ffprobe available.')
