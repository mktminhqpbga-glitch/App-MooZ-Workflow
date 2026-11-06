#!/usr/bin/env bash
set -euo pipefail
native_root="$(cd "$(dirname "$0")/.." && pwd)"
if command -v swift >/dev/null 2>&1; then
  cd "$native_root"
  swift test -j 4 "$@"
else
  printf '%s\n' 'Swift is required. On macOS install Xcode; on Linux use the documented Swift container.' >&2
  exit 1
fi
