"""Rebuild the bundled extension with reviewed local bridge changes."""
from pathlib import Path
import io, json, zipfile
root = Path(__file__).resolve().parent.parent
path = root / 'downloads/MooZ-Connect.zip'
source = root / 'vendor/mooz/extension/ai-bridge.js'
output = io.BytesIO()
with zipfile.ZipFile(path) as old, zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as new:
    for entry in old.infolist():
        data = old.read(entry.filename)
        if entry.filename == 'ai-bridge.js': data = source.read_bytes()
        if entry.filename == 'manifest.json':
            manifest = json.loads(data); manifest['version'] = '1.9.3'
            data = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
        new.writestr(entry, data)
path.write_bytes(output.getvalue())
