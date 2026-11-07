"""Packaging must catch host dependencies even when only the main app uses them."""
import contextlib
import io
import os
from pathlib import Path
import plistlib
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch


VERIFY = Path(__file__).resolve().parents[1] / 'Tools/verify_bundle.py'


class BundleVerificationTests(unittest.TestCase):
    def verify(self, main_dependency='/usr/lib/libsqlite3.dylib',
               main_rpath='@executable_path', minimum='13.0'):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'MooZ.app'
            contents = app / 'Contents'
            (contents / 'Resources/bin').mkdir(parents=True)
            (contents / 'Frameworks').mkdir()
            (contents / 'MacOS').mkdir()
            for relative in ['MacOS/MooZ', 'Resources/bin/ffmpeg', 'Resources/bin/ffprobe']:
                (contents / relative).touch()
            with (contents / 'Info.plist').open('wb') as stream:
                plistlib.dump({'LSMinimumSystemVersion': '13.0'}, stream)

            def output(args, **kwargs):
                tool, option, filename = args
                is_main = Path(filename).name == 'MooZ'
                if tool == 'lipo':
                    return 'x86_64\n'
                if option == '-L':
                    dependency = main_dependency if is_main else '/usr/lib/libSystem.B.dylib'
                    return f'{filename}:\n\t{dependency} (compatibility version 1.0.0, current version 1.0.0)\n'
                rpath = main_rpath if is_main else '@loader_path/../../Frameworks'
                # Real otool formatting: independent LC_BUILD_VERSION/LC_RPATH blocks.
                return (f'Load command 0\n      cmd LC_BUILD_VERSION\n  cmdsize 32\n'
                        f' platform 1\n    minos {minimum}\n      sdk 15.0\n'
                        f'Load command 1\n      cmd LC_RPATH\n  cmdsize 48\n'
                        f'     path {rpath} (offset 12)\n')

            with patch.object(sys, 'argv', [str(VERIFY), str(app)]), \
                    patch.dict(os.environ, {'MOOZ_MAX_MINIMUM_MACOS': '13.0', 'GITHUB_ACTIONS': 'false'}), \
                    patch('subprocess.check_output', side_effect=output), \
                    contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(VERIFY), run_name='__main__')
            return plistlib.loads((contents / 'Info.plist').read_bytes())

    def test_system_sqlite_bundle_targets_ventura(self):
        self.assertEqual(self.verify()['LSMinimumSystemVersion'], '13.0')

    def test_rejects_main_executable_homebrew_dependency(self):
        with self.assertRaisesRegex(RuntimeError, 'Unbundled native load path'):
            self.verify(main_dependency='/usr/local/opt/sqlite/lib/libsqlite3.0.dylib')

    def test_rejects_main_executable_host_search_path(self):
        with self.assertRaisesRegex(RuntimeError, 'Unexpected host rpath'):
            self.verify(main_rpath='/usr/local/opt/sqlite/lib')

    def test_accepts_system_swift_runtime(self):
        self.verify(main_dependency='@rpath/libswift_Concurrency.dylib', main_rpath='/usr/lib/swift')

    def test_rejects_newer_os_requirement(self):
        with self.assertRaisesRegex(RuntimeError, 'requires macOS 15.0'):
            self.verify(minimum='15.0')


if __name__ == '__main__':
    unittest.main()
