#!/usr/bin/env python3
"""Build the app's media tools for Intel Ventura, without Homebrew runtime libraries.

Homebrew supplies build tools only. Every runtime library is built from a pinned
source with the same deployment target; copied modern bottles cannot establish
Ventura compatibility.
"""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile

if sys.platform != 'darwin' or platform.machine() != 'x86_64':
    raise SystemExit('This media build targets macOS Intel x86_64.')
if sys.version_info < (3, 12):
    raise SystemExit('Python 3.12+ is required for safe source archive extraction.')

lock_path = Path(__file__).with_name('media-sources.json')
lock = json.loads(lock_path.read_text())
root = Path(os.environ.get('MOOZ_MEDIA_BUILD_ROOT', str(Path(tempfile.gettempdir()) / 'mooz-media-ventura'))).resolve()
prefix = root / 'stage'
for folder in ['downloads', 'src', 'stamps', 'stage']:
    (root / folder).mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
compiler = subprocess.check_output(['xcrun', 'clang', '--version'], text=True)
flags = '-O2 -mmacosx-version-min=13.0 -Werror=unguarded-availability-new'
env.update({'MACOSX_DEPLOYMENT_TARGET': '13.0', 'SDKROOT': sdk,
            'CC': subprocess.check_output(['xcrun', '--find', 'clang'], text=True).strip(),
            'CXX': subprocess.check_output(['xcrun', '--find', 'clang++'], text=True).strip(),
            'CFLAGS': flags, 'CXXFLAGS': flags,
            'CPPFLAGS': f'-I{prefix}/include', 'LDFLAGS': f'-L{prefix}/lib -mmacosx-version-min=13.0',
            'PKG_CONFIG_LIBDIR': str(prefix / 'lib/pkgconfig'), 'PKG_CONFIG_PATH': str(prefix / 'lib/pkgconfig')})
env['PATH'] = str(prefix / 'bin') + os.pathsep + env['PATH']


def run(args, cwd=None):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def source(name):
    spec = lock['sources'][name]
    dest = root / 'src' / name
    if 'git' in spec:
        if not (dest / '.git').exists():
            dest.mkdir(exist_ok=True)
            run(['git', 'init', dest])
            run(['git', '-C', dest, 'remote', 'add', 'origin', spec['git']])
            run(['git', '-C', dest, 'fetch', '--depth=1', 'origin', spec['revision']])
            run(['git', '-C', dest, 'checkout', '--detach', 'FETCH_HEAD'])
        actual = subprocess.check_output(['git', '-C', str(dest), 'rev-parse', 'HEAD'], text=True).strip()
        if actual != spec['revision']:
            raise RuntimeError(f'Wrong pinned revision for {name}')
        if subprocess.check_output(['git', '-C', str(dest), 'diff', '--name-only', 'HEAD'], text=True).strip():
            raise RuntimeError(f'Pinned source was modified: {name}')
        return dest
    archive = root / 'downloads' / spec['url'].rsplit('/', 1)[1]
    if archive.exists() and hashlib.sha256(archive.read_bytes()).hexdigest() != spec['sha256']:
        archive.unlink()  # Only a builder-owned cache entry; never accept a mismatched source.
    if not archive.exists():
        partial = archive.with_name(archive.name + '.part')
        run(['curl', '--fail', '--location', '--retry', '3', '--proto', '=https', '--proto-redir', '=https',
             spec['url'], '--output', partial])
        if hashlib.sha256(partial.read_bytes()).hexdigest() != spec['sha256']:
            raise RuntimeError(f'Source checksum mismatch for {name}; refusing to build')
        partial.rename(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != spec['sha256']:
        raise RuntimeError(f'Source checksum mismatch for {name}; refusing to build')
    if not dest.exists():
        extracted = root / 'src' / (name + '-extract')
        extracted.mkdir(exist_ok=True)
        with tarfile.open(archive) as bundle:
            bundle.extractall(extracted, filter='data')
        entries = list(extracted.iterdir())
        if len(entries) != 1 or not entries[0].is_dir():
            raise RuntimeError(f'Unexpected source archive layout for {name}')
        entries[0].rename(dest)
        extracted.rmdir()
    return dest


def licenses(name, src):
    candidates = list(src.glob('COPYING*')) + list(src.glob('LICEN*'))
    if name == 'freetype':
        candidates += [src / 'docs/FTL.TXT', src / 'docs/GPLv2.TXT']
    for file in candidates:
        if file.is_file():
            target = prefix / 'share/mooz-media/licenses' / name / file.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)


def build(name, kind, options):
    src = source(name)
    signature = hashlib.sha256(json.dumps([lock['sources'][name], kind, options, flags, sdk, compiler], sort_keys=True).encode()).hexdigest()
    stamp = root / 'stamps' / name
    if stamp.exists() and stamp.read_text() == signature:
        print(f'Reuse verified build step: {name}', flush=True)
        return
    print(f'Building {name} for Intel macOS 13.0', flush=True)
    if kind == 'meson':
        build_dir = root / 'src' / (name + '-build')
        setup_flags = ['--wipe'] if (build_dir / 'meson-private/coredata.dat').exists() else []
        run(['meson', 'setup', *setup_flags,
             build_dir, src, '--prefix=' + str(prefix), '--libdir=lib', '--default-library=static',
             '--buildtype=release', '-Db_lto=false', *options])
        run(['meson', 'compile', '-C', build_dir, '-j', '4'])
        run(['meson', 'install', '-C', build_dir])
    else:
        if kind == 'ffmpeg':
            args = ['./configure', '--prefix=' + str(prefix), *options,
                    '--extra-cflags=' + flags + f' -I{prefix}/include',
                    '--extra-ldflags=' + f'-L{prefix}/lib -mmacosx-version-min=13.0']
        else:
            args = ['./configure', '--prefix=' + str(prefix), *options]
        run(args, src)
        run(['make', '-j4'], src)
        run(['make', 'install'], src)
    licenses(name, src)
    stamp.write_text(signature)


build('freetype', 'configure', ['--enable-static', '--disable-shared', '--without-harfbuzz', '--without-bzip2',
                              '--without-png', '--without-brotli', '--without-zlib'])
build('fribidi', 'meson', ['-Ddocs=false', '-Dbin=false', '-Dtests=false'])
build('harfbuzz', 'meson', ['-Dfreetype=enabled', *['-D' + name + '=disabled' for name in [
    'glib', 'gobject', 'cairo', 'chafa', 'png', 'zlib', 'icu', 'graphite2', 'coretext',
    'fontations', 'harfrust', 'kbts', 'wasm', 'raster', 'vector', 'gpu', 'gpu_demo', 'subset',
    'tests', 'docs', 'utilities', 'introspection']]])
build('libunibreak', 'configure', ['--enable-static', '--disable-shared'])
build('libass', 'configure', ['--enable-static', '--disable-shared', '--disable-fontconfig',
                            '--enable-coretext', '--enable-libunibreak'])
build('x264', 'configure', ['--enable-static', '--disable-cli', '--enable-pic'])
build('ffmpeg', 'ffmpeg', ['--arch=x86_64', '--target-os=darwin', '--disable-autodetect',
                          '--enable-static', '--disable-shared', '--disable-debug', '--disable-doc',
                          '--disable-ffplay', '--disable-network', '--disable-indevs', '--enable-indev=lavfi', '--disable-outdevs',
                          '--enable-gpl', '--enable-version3', '--enable-libx264', '--enable-libass',
                          '--enable-zlib', '--pkg-config-flags=--static'])
shutil.copy2(lock_path, prefix / 'share/mooz-media/sources.json')
run([sys.executable, Path(__file__).with_name('verify_media_tools.py')], cwd=Path(__file__).parent)
if os.environ.get('GITHUB_PATH'):
    with open(os.environ['GITHUB_PATH'], 'a') as stream:
        stream.write(str(prefix / 'bin') + '\n')
print(f'Intel Ventura media tools built: {prefix / "bin"}', flush=True)
