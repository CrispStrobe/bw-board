"""Manufactured filesystem controls; no compiler or guest imports."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('composition_controls', Path(__file__).with_name('owner.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.owner = m.OwnedWorkspaceEvidence(self.temp.name)
        self.real_close = os.close

    def tearDown(self):
        self.owner.close()
        self.temp.cleanup()

    def test_positive_retained_no_directory_reopen(self):
        self.owner.prepare()
        real_open = os.open
        seen = []
        def opened(*args, **kw):
            seen.append((args[0], args[1]))
            return real_open(*args, **kw)
        with patch.object(os, 'open', opened):
            self.owner.before(b'{"before":true}')
            s = self.owner.terminal('after-link', b'{"after":true}')
        self.assertEqual([v[0] for v in seen], ['tool-before.json', 'tool-terminal.json'])
        self.assertTrue(all(not flags & os.O_DIRECTORY for _, flags in seen))
        self.assertEqual(s['phase'], 'complete')
        self.assertEqual(s['directories']['liveDirectories'], 0)
        self.assertEqual(s['directories']['registeredDirectories'], s['directories']['closeAttempted'])
        self.assertFalse(s['sourceOwnedQualified'])
        self.assertEqual((Path(self.temp.name) / self.owner._creator._name / 'evidence' / 'tool-terminal.json').read_bytes(), b'{"after":true}')

    def test_failure_terminal_alternative(self):
        self.owner.prepare(); self.owner.before(b'a')
        s = self.owner.terminal('failure-final', b'failure')
        self.assertEqual(s['phase'], 'complete')
        self.assertFalse(s['compilationQualified'])

    def test_shared_ledger_close_once(self):
        self.owner.prepare()
        dirs = set(self.owner._ledger.live())
        self.assertLess(len(dirs), sum(len(c) for c in self.owner._writer._routes._chains))
        called = []
        def close(fd):
            called.append(fd); self.real_close(fd)
        with patch.object(os, 'close', close):
            self.owner.close(); self.owner.close()
        self.assertEqual(set(called), dirs)
        self.assertEqual(len(called), len(dirs))

    def test_prepare_copy_interruption_original(self):
        error = KeyboardInterrupt('private test')
        with patch.object(self.owner, '_prepare_chains', side_effect=error):
            with self.assertRaises(KeyboardInterrupt) as caught:
                self.owner.prepare()
        self.assertIs(caught.exception, error)
        self.assertEqual(self.owner.status()['directories']['liveDirectories'], 0)

    def test_writer_constructor_interruption(self):
        error = MemoryError('private test')
        with patch.object(m.writer_module, 'EvidenceOwner', side_effect=error):
            with self.assertRaises(MemoryError) as caught:
                self.owner.prepare()
        self.assertIs(caught.exception, error)
        self.assertEqual(self.owner.status()['directories']['liveDirectories'], 0)

    def test_field_transfer_interruption_no_double_close(self):
        original = m.route_module.RootRoutes
        error = KeyboardInterrupt('transfer')
        class Interrupted(original):
            def __setattr__(self, key, value):
                if key == '_partial' and value:
                    raise error
                super().__setattr__(key, value)
        called = []
        def close(fd):
            called.append(fd); self.real_close(fd)
        with patch.object(m.route_module, 'RootRoutes', Interrupted), patch.object(os, 'close', close):
            with self.assertRaises(KeyboardInterrupt) as caught:
                self.owner.prepare()
        self.assertIs(caught.exception, error)
        self.assertEqual(len(called), len(set(called)))
        self.assertEqual(self.owner.status()['directories']['liveDirectories'], 0)

    def test_original_creator_failure_and_close_refusal(self):
        error = OSError('private path must not be reported')
        refused = []
        def close(fd):
            if not refused:
                refused.append(fd); raise OSError('close')
            self.real_close(fd)
        with patch.object(os, 'mkdir', side_effect=error), patch.object(os, 'close', close):
            with self.assertRaises(OSError) as caught:
                self.owner.prepare()
        self.assertIs(caught.exception, error)
        s = self.owner.status()
        self.assertEqual(s['firstFailure'], 'filesystem-refusal')
        self.assertEqual(s['directories']['closeRefused'], 1)
        self.assertFalse(s['creation']['cleanupQualified'])
        self.real_close(refused[0])  # Test-only close of known unclosed FD.

    def test_original_writer_failure_and_close_refusal(self):
        self.owner.prepare()
        error = OSError('write')
        refused = []
        def close(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                refused.append(fd); raise OSError('output close')
            self.real_close(fd)
        with patch.object(os, 'write', side_effect=error), patch.object(os, 'close', close):
            with self.assertRaises(OSError) as caught:
                self.owner.before(b'abc')
        self.assertIs(caught.exception, error)
        s = self.owner.status()
        self.assertEqual(s['firstFailure'], 'filesystem-refusal')
        self.assertEqual(s['writer']['closeRefused'], 1)
        self.assertFalse(s['writer']['outputCleanupQualified'])
        self.real_close(refused[0])

    def test_registration_interruption_fallback(self):
        error = MemoryError('registration')
        returned = []
        original = os.open
        def opened(*args, **kw):
            fd = original(*args, **kw); returned.append(fd); return fd
        with patch.object(os, 'open', opened), patch.object(self.owner._ledger, 'register', side_effect=error):
            with self.assertRaises(MemoryError) as caught:
                self.owner.prepare()
        self.assertIs(caught.exception, error)
        self.assertEqual(len(returned), 1)
        with self.assertRaises(OSError): os.fstat(returned[0])
        self.assertEqual(self.owner.status()['directories']['closeAttempted'], 1)

    def test_creator_append_fault_closed_by_ledger(self):
        error = MemoryError('append')
        class FailedList(list):
            def append(self, value): raise error
        self.owner._creator._fds = FailedList()
        with self.assertRaises(MemoryError) as caught: self.owner.prepare()
        self.assertIs(caught.exception, error)
        self.assertEqual(self.owner.status()['directories']['closeAttempted'], 1)
        self.assertEqual(self.owner.status()['directories']['liveDirectories'], 0)

    def test_creator_open_reentry_returned_fd_cleanup(self):
        original = os.open; returned = []
        def opened(*args, **kw):
            fd = original(*args, **kw); returned.append(fd)
            try: self.owner.status()
            except m.Refusal: pass
            return fd
        with patch.object(os, 'open', opened):
            with self.assertRaises(ValueError): self.owner.prepare()
        self.assertEqual(len(returned), 1)
        with self.assertRaises(OSError): os.fstat(returned[0])
        self.assertEqual(self.owner.status()['firstFailure'], 'composition-reentry')

    def test_writer_reentry_stops_further_writes(self):
        self.owner.prepare(); original = os.write; calls = []
        def write(*args):
            calls.append(1)
            try: self.owner.status()
            except m.Refusal: pass
            return original(*args)
        with patch.object(os, 'write', write):
            with self.assertRaises(ValueError): self.owner.before(b'ab')
        self.assertEqual(calls, [1])
        self.assertEqual(self.owner.status()['firstFailure'], 'composition-reentry')
        self.assertEqual(self.owner.status()['directories']['liveDirectories'], 0)

    def test_pread_reentry_stops_readback(self):
        self.owner.prepare(); real = os.pread; calls = []
        def pread(*args):
            calls.append(1)
            try: self.owner.status()
            except m.Refusal: pass
            return real(*args)
        with patch.object(os, 'pread', pread):
            with self.assertRaises(ValueError): self.owner.before(b'abc')
        self.assertEqual(calls, [1])
        self.assertEqual(self.owner.status()['firstFailure'], 'composition-reentry')
        self.assertEqual(self.owner.status()['directories']['liveDirectories'], 0)

    def test_exclusive_existing_file_preserved(self):
        self.owner.prepare()
        output = Path(self.temp.name) / self.owner._creator._name / 'evidence' / 'tool-before.json'
        output.write_bytes(b'existing')
        with self.assertRaises(FileExistsError): self.owner.before(b'replacement')
        self.assertEqual(output.read_bytes(), b'existing')
        self.assertEqual(self.owner.status()['writer']['attemptedFiles'], ['tool-before.json'])
        self.assertEqual(self.owner.status()['writer']['writtenFiles'], [])

    def test_terminal_release_reentry_no_complete(self):
        self.owner.prepare(); self.owner.before(b'a'); once = []
        def close(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode) and not once:
                once.append(1)
                try: self.owner.status()
                except m.Refusal: pass
            self.real_close(fd)
        with patch.object(os, 'close', close):
            with self.assertRaises(ValueError): self.owner.terminal('after-link', b'b')
        s = self.owner.status()
        self.assertNotEqual(s['phase'], 'complete')
        self.assertEqual(s['firstFailure'], 'composition-reentry')
        self.assertIn('tool-terminal.json', s['writer']['writtenFiles'])

    def test_phase_order_poison_no_later_opens(self):
        with self.assertRaises(ValueError): self.owner.before(b'a')
        with patch.object(os, 'open', side_effect=AssertionError('must not open')):
            with self.assertRaises(ValueError): self.owner.prepare()

    def test_parent_bounds_no_filesystem(self):
        with patch.object(os, 'open', side_effect=AssertionError('must not open')):
            for parent in ('/'+'a'*4046, '/'+'/'.join(['x']*31), '/'+'é'*2023, '/x/../y'):
                with self.assertRaises(ValueError): m.OwnedWorkspaceEvidence(parent)

    def _parent_shape(self, extent):
        prefix = self.temp.name
        count = 30 - len(prefix.split('/')[1:])
        remaining = extent - len(prefix) - count
        lengths = [1] * count
        remaining -= count
        for i in range(count):
            add = min(254, remaining); lengths[i] += add; remaining -= add
        self.assertEqual(remaining, 0)
        return prefix + ''.join('/' + 'x' * length for length in lengths)

    def test_exact_parent_bounds_real_retained_routes(self):
        self.owner.close()
        parent = self._parent_shape(4046)
        self.assertEqual(len(parent.encode('utf-8')), 4046)
        self.assertEqual(len(parent.split('/')[1:]), 30)
        fd = os.open(self.temp.name, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for component in parent[len(self.temp.name)+1:].split('/'):
                os.mkdir(component, dir_fd=fd)
                following = os.open(component, os.O_RDONLY | os.O_DIRECTORY, dir_fd=fd)
                os.close(fd); fd = following
        finally: os.close(fd)
        self.owner = m.OwnedWorkspaceEvidence(parent)
        s = self.owner.prepare()
        self.assertEqual(s['directories']['registeredDirectories'], 34)
        self.owner.before(b'a')
        self.assertEqual(self.owner.terminal('after-link', b'b')['phase'], 'complete')

    def test_valid_shape_just_over_parent_bounds(self):
        with patch.object(os, 'open', side_effect=AssertionError('no open')):
            with self.assertRaises(ValueError): m.OwnedWorkspaceEvidence(self._parent_shape(4047))
            with self.assertRaises(ValueError): m.OwnedWorkspaceEvidence('/' + '/'.join(['x'] * 31))

    def test_session_replacement_after_prepare_refused(self):
        self.owner.prepare()
        session = Path(self.temp.name) / self.owner._creator._name
        session.rename(Path(self.temp.name) / 'retained-old')
        session.mkdir(); (session / 'tool').mkdir(); (session / 'evidence').mkdir()
        with patch.object(os, 'open', side_effect=AssertionError('no output or route open')):
            with self.assertRaises(ValueError): self.owner.before(b'a')
        self.assertEqual(self.owner.status()['writer']['attemptedFiles'], [])
        self.assertEqual(self.owner.status()['directories']['liveDirectories'], 0)

    def test_mkdir_reentry_stops_normal_source_calls(self):
        real = os.mkdir; calls = []
        def mkdir(*args, **kw):
            calls.append(1); real(*args, **kw)
            try: self.owner.status()
            except m.Refusal: pass
        with patch.object(os, 'mkdir', mkdir):
            with self.assertRaises(ValueError): self.owner.prepare()
        self.assertEqual(calls, [1])
        self.assertEqual(self.owner.status()['creation']['attemptedRoles'], ['session'])
        self.assertEqual(self.owner.status()['creation']['verifiedRoles'], {})
        self.assertEqual(self.owner.status()['firstFailure'], 'composition-reentry')

    def test_route_stat_reentry_stops_normal_source_calls(self):
        self.owner.prepare(); real = os.stat; calls = []
        def named(*args, **kw):
            calls.append(1)
            value = real(*args, **kw)
            try: self.owner.status()
            except m.Refusal: pass
            return value
        with patch.object(os, 'stat', named), patch.object(os, 'open', side_effect=AssertionError('no later open')):
            with self.assertRaises(ValueError): self.owner.before(b'a')
        self.assertEqual(calls, [1])
        self.assertEqual(self.owner.status()['firstFailure'], 'composition-reentry')

    def test_close_uncertainty_shared_status(self):
        self.owner.prepare(); saved = self.owner._ledger.live()[0]
        def close(fd):
            if fd == saved: raise OSError('close')
            self.real_close(fd)
        with patch.object(os, 'close', close): self.owner.close(); self.owner.close()
        s = self.owner.status()
        self.assertEqual(s['directories']['closeRefused'], 1)
        self.assertEqual(s['directories']['uncertainDirectories'], 1)
        self.assertFalse(s['creation']['cleanupQualified'])
        self.assertFalse(s['writer']['routes']['cleanupQualified'])
        self.assertEqual(s['creation']['closeAttempted'], s['directories']['closeAttempted'])
        self.real_close(saved)

if __name__ == '__main__': unittest.main()
