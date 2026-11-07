#!/usr/bin/env bash
set -euo pipefail
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'A macOS/Xcode runner is required to build and package this native app.' >&2
  exit 1
fi
native_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$native_root"
python3 "$native_root/Tools/verify_media_tools.py"
swift test -j 4
swift build -c release -j 4
native_bin="$(swift build -c release --show-bin-path)"
native_app="$native_root/artifacts/MooZ.app"
# Only this generated app is replaced. User data is in Application Support/MooZNative.
if [ -d "$native_app" ]; then rm -rf "$native_app"; fi
mkdir -p "$native_app/Contents/MacOS" "$native_app/Contents/Resources/bin" "$native_app/Contents/Frameworks"
cp "$native_bin/MooZ" "$native_app/Contents/MacOS/MooZ"
cp "$native_root/../LICENSE" "$native_app/Contents/Resources/LICENSE"
cp "$native_root/../desktop/icon.icns" "$native_app/Contents/Resources/MooZ.icns"
cat > "$native_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>MooZ</string>
<key>CFBundleIdentifier</key><string>vn.mooz.native</string>
<key>CFBundleName</key><string>MooZ</string>
<key>CFBundleDisplayName</key><string>MooZ</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.6.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>MooZ</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
for native_tool in ffmpeg ffprobe; do
  native_tool_path="$(command -v "$native_tool")"
  cp "$native_tool_path" "$native_app/Contents/Resources/bin/$native_tool"
done
python3 "$native_root/Tools/bundle_dylibs.py" "$native_app"
python3 "$native_root/Tools/verify_bundle.py" "$native_app"
cp "$native_app/Contents/Resources/bundle-info.json" "$native_root/artifacts/native-bundle-info.json"
python3 "$native_root/Tools/build_companion.py"
mkdir -p "$native_app/Contents/Resources/Companion"
ditto -x -k "$native_root/artifacts/MooZ-Connect-Native.zip" "$native_app/Contents/Resources/Companion"
ffmpeg -L > "$native_app/Contents/Resources/FFmpeg-LICENSE.txt" 2>&1
ffmpeg -buildconf > "$native_app/Contents/Resources/FFmpeg-build.txt" 2>&1
find "$native_app/Contents/Frameworks" -type f -name '*.dylib' -exec codesign --force --sign - {} \;
codesign --force --sign - "$native_app/Contents/Resources/bin/ffmpeg"
codesign --force --sign - "$native_app/Contents/Resources/bin/ffprobe"
codesign --force --deep --sign - "$native_app"
codesign --verify --deep --strict "$native_app"
native_archive="$native_root/artifacts/MooZ-Native-macOS-$(uname -m).zip"
ditto -c -k --sequesterRsrc --keepParent "$native_app" "$native_archive"
cd "$native_root/artifacts"
shasum -a 256 "$(basename "$native_archive")" MooZ-Connect-Native.zip > SHA256SUMS.txt
printf '%s\n' "$native_app" 'Ad-hoc signed local/CI build. Developer ID signing and notarization are required for a public distribution.'
