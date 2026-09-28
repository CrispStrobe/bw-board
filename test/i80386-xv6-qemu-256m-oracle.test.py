#!/usr/bin/env python3
"""Synthetic socket tests; no QEMU guest is started."""
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

RUNNER = Path(__file__).resolve().parents[1] / 'scripts/probe-xv6-usertests-qemu-256m-full-suite.py'
spec = importlib.util.spec_from_file_location('xv6_qemu_256m', RUNNER)
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)


class SocketOracleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        oracle.OUTPUT = root / 'out'
        oracle.OUTPUT.mkdir()
        (root / 'boot.img').write_bytes(b'boot')
        (root / 'fs.img').write_bytes(b'filesystem')
        oracle.PINS = {'bootImage': (root / 'boot.img', oracle.sha(root / 'boot.img')),
                       'filesystemImage': (root / 'fs.img', oracle.sha(root / 'fs.img'))}
        for name, dest in (('bootImage', 'xv6-writable.img'),
                           ('filesystemImage', 'fs-writable.img')):
            (oracle.OUTPUT / dest).write_bytes(oracle.PINS[name][0].read_bytes())
        self.pins = {'test': 'synthetic'}
        self.real_preflight, self.real_command = oracle.preflight, oracle.command
        oracle.preflight = lambda: self.pins
        self.addCleanup(lambda: setattr(oracle, 'preflight', self.real_preflight))
        self.addCleanup(lambda: setattr(oracle, 'command', self.real_command))

    def _run_fake(self, output_bytes, succeeds):
        fake = Path(self.tmp.name) / 'fake-qemu.py'
        fake.write_text('''import socket, sys, time
s = socket.socket(socket.AF_UNIX)
for _ in range(100):
    try:
        s.connect(sys.argv[1])
        break
    except ConnectionRefusedError:
        time.sleep(0.01)
s.sendall(b'xv6...\\ninit: starting sh\\n$ ')
assert s.recv(100) == b'usertests\\r'
s.sendall(bytes.fromhex(sys.argv[2]))
time.sleep(0.1)
s.close()
''')
        argv = [sys.executable, str(fake), str(oracle.OUTPUT / 'serial.sock'), output_bytes.hex()]
        oracle.command = lambda: argv
        (oracle.OUTPUT / 'manifest-private.json').write_text(json.dumps(
            {'pins': self.pins, 'qemuArgv': argv}))
        with contextlib.redirect_stdout(io.StringIO()):
            if succeeds:
                oracle.run()
            else:
                with self.assertRaisesRegex(RuntimeError, 'did not reach'):
                    oracle.run()
        return json.loads((oracle.OUTPUT / 'receipt-private.json').read_text())

    def test_ordered_full_suite_marker(self):
        receipt = self._run_fake(b'createdelete ok\nlinkunlink ok\nconcreate ok\n'
                                 b'ALL TESTS PASSED\n$ ', True)
        self.assertTrue(receipt['fullUsertestsPassed'])
        self.assertTrue(receipt['markersInSourceOrder'])
        self.assertEqual(receipt['stop'], 'target-marker')
        self.assertTrue((oracle.OUTPUT / 'serial-private.bin').read_bytes().endswith(
            b'ALL TESTS PASSED\n$ '))

    def test_stock_sbrk_failure_is_not_a_pass(self):
        receipt = self._run_fake(b'createdelete ok\nlinkunlink ok\nconcreate ok\n'
                                 b'sbrk test failed to grow big address space; enough phys mem?',
                                 False)
        self.assertFalse(receipt['fullUsertestsPassed'])
        self.assertEqual(receipt['stop'], 'guest-failure')

    def test_final_marker_without_ordered_prefix_is_not_a_pass(self):
        receipt = self._run_fake(b'concreate ok\nALL TESTS PASSED\n$ ', False)
        self.assertFalse(receipt['fullUsertestsPassed'])
        self.assertFalse(receipt['markersInSourceOrder'])


if __name__ == '__main__':
    unittest.main()
