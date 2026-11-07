#!/usr/bin/env python3
"""Run a CI check and expose bounded diagnostics through standard Actions annotations."""
from collections import deque
from pathlib import Path
import os
import re
import subprocess
import sys


def escaped(value):
    return value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: native-check.py command [args...]')
    recent = deque(maxlen=35)
    reported = set()
    workspace = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
    process = subprocess.Popen(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, errors='replace', bufsize=1)
    for line in process.stdout:
        print(line, end='', flush=True)
        recent.append(line.rstrip())
        match = re.match(r'^(.+\.swift):(\d+):(\d+): error: (.*)$', line.rstrip())
        if not match:
            # XCTest thrown errors use <EXPR>:0, and media/tool failures may not name a Swift file.
            if 'error:' in line.lower() and line.strip() not in reported and len(reported) < 12:
                reported.add(line.strip())
                print('::error::' + escaped(line.strip()[:6000]), flush=True)
            continue
        if match.group(0) in reported or len(reported) >= 12:
            continue
        reported.add(match.group(0))
        file, row, column, message = match.groups()
        try:
            file = str(Path(file).resolve().relative_to(workspace))
        except ValueError:
            pass
        file = escaped(file).replace(',', '%2C').replace(':', '%3A')
        print(f'::error file={file},line={row},col={column}::{escaped(message)}', flush=True)
    status = process.wait()
    if status:
        summary = '\n'.join(recent)[-6000:]
        print('::error title=Native CI check failed::' + escaped(summary), flush=True)
    return status


if __name__ == '__main__':
    sys.exit(main())
