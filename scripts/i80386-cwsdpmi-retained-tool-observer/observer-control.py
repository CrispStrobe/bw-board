"""Manufactured filesystem and private pin fixtures; never actual tools."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('retained_observer_controls', Path(__file__).with_name('observer.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
HELD_SELECTED = dict(m.SELECTED)

class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.observer = m.RetainedToolObserver(self.temp.name)
        self.observer.prepare()
        self.contents = {role: ('synthetic-' + role).encode() for role in HELD_SELECTED}
        self.selected = {role: (relative, hashlib.sha256(self.contents[role]).hexdigest()) for role, (relative, digest) in HELD_SELECTED.items()}
        self.pins = patch.object(m, 'SELECTED', self.selected)
        self.pins.start()
        self.real_close = os.close

    def tearDown(self):
        self.observer.close()
        self.pins.stop()
        self.temp.cleanup()

    def root(self):
        return self.observer._owner._writer._routes._chains[0][-1][2]

    def evidence(self):
        return Path(self.temp.name) / self.observer._owner._creator._name / 'evidence'

    def source_path(self, role='compiler'):
        return Path(self.temp.name) / self.observer._owner._creator._name / 'tool' / self.selected[role][0]

    def populate(self):
        # Tests alone provision private synthetic bytes, relative to borrowed root.
        root = self.root()
        for role, (relative, digest) in self.selected.items():
            owned = []
            parent = root
            try:
                for name in relative.split('/')[:-1]:
                    try: os.mkdir(name, dir_fd=parent)
                    except FileExistsError: pass
                    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY, dir_fd=parent)
                    owned.append(fd); parent = fd
                fd = os.open(relative.split('/')[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=parent)
                owned.append(fd); os.write(fd, self.contents[role])
            finally:
                for fd in reversed(owned): os.close(fd)

    def test_empty_first_capture_two_partial_diagnostics(self):
        with self.assertRaises(FileNotFoundError): self.observer.before()
        s = self.observer.status()
        self.assertEqual(s['observationAttempts'], 1)
        self.assertEqual(s['emittedSequences'], [1, 2])
        self.assertEqual(s['receiptFacts'][0]['completedRoles'], 0)
        self.assertEqual(s['receiptFacts'][1]['kind'], 'failure-terminal-no-observation')
        self.assertFalse(s['sourceOwnedQualified'])
        for name in ('tool-before.json', 'tool-terminal.json'):
            m.admit_receipt(json.loads((self.evidence() / name).read_bytes()))

    def test_full_pair_roundtrip_and_no_root_reopen(self):
        self.populate(); real_open = os.open; seen = []
        def opened(name, flags, *args, **kw):
            seen.append((name, flags, kw.get('dir_fd')))
            return real_open(name, flags, *args, **kw)
        with patch.object(os, 'open', opened):
            self.observer.before(); s = self.observer.terminal('after-link')
        self.assertEqual(s['phase'], 'complete')
        self.assertEqual(s['observationAttempts'], 2)
        self.assertEqual(s['receiptFacts'][1]['pairStatus'], 'consistent')
        self.assertTrue(all(type(name) is str and '/' not in name for name,flags,fd in seen))
        self.assertTrue(all(fd is not None for name,flags,fd in seen))
        before = json.loads((self.evidence() / 'tool-before.json').read_bytes())
        after = json.loads((self.evidence() / 'tool-terminal.json').read_bytes())
        m.admit_receipt(before); m.admit_receipt(after)
        self.assertTrue(m.validate_pair(before, after)['toolBoundaryConsistent'])
        self.assertNotIn('session', s)

    def test_failed_second_capture_preserves_observed_phase(self):
        self.populate(); self.observer.before(); self.source_path('assembler').unlink()
        with self.assertRaises(FileNotFoundError): self.observer.terminal('after-link')
        value = json.loads((self.evidence() / 'tool-terminal.json').read_bytes())
        m.admit_receipt(value)
        self.assertEqual(value['phase'], 'after-link')
        self.assertEqual(value['routePhase'], 'failure-final')
        self.assertFalse(value['complete'])
        self.assertEqual(value['roleOrder'], ['compiler'])
        self.assertEqual(self.observer.status()['emittedSequences'], [1, 2])

    def test_complete_capture_changed_identity_pair_refusal(self):
        self.populate(); self.observer.before()
        path = self.source_path(); old = path.with_name('old-synthetic')
        path.rename(old); path.write_bytes(self.contents['compiler'])
        with self.assertRaises(m.Refusal): self.observer.terminal('after-link')
        value = json.loads((self.evidence() / 'tool-terminal.json').read_bytes())
        m.admit_receipt(value)
        self.assertTrue(value['complete'])
        self.assertEqual(value['pairStatus'], 'refused')
        self.assertEqual(value['phase'], 'after-link')
        self.assertEqual(value['routePhase'], 'failure-final')
        self.assertEqual(self.observer.status()['observationAttempts'], 2)
        self.assertEqual(self.observer.status()['emittedSequences'], [1,2])

    def test_repeat_after_first_refusal_no_writer_or_capture(self):
        with self.assertRaises(FileNotFoundError): self.observer.before()
        with patch.object(self.observer._owner, 'before', side_effect=AssertionError('no retry')) as before, patch.object(self.observer._owner, 'terminal', side_effect=AssertionError('no retry')) as terminal, patch.object(self.observer, '_capture', side_effect=AssertionError('no recapture')) as capture:
            for method in (self.observer.before, lambda:self.observer.terminal('failure-final')):
                with self.assertRaises(m.Refusal): method()
            before.assert_not_called();terminal.assert_not_called();capture.assert_not_called()
        self.assertEqual(self.observer.status()['observationAttempts'], 1)

    def test_wrong_phase_and_third_attempt_no_source(self):
        self.populate()
        with self.assertRaises(m.Refusal): self.observer.terminal('after-link')
        with patch.object(os, 'open', side_effect=AssertionError('no source')):
            with self.assertRaises(m.Refusal): self.observer.before()

    def test_pin_mismatch_prefix_and_consumed_reservation(self):
        self.populate(); self.source_path('assembler').write_bytes(b'bad')
        with self.assertRaises(m.Refusal): self.observer.before()
        value = json.loads((self.evidence() / 'tool-before.json').read_bytes())
        m.admit_receipt(value)
        self.assertEqual(value['roleOrder'], ['compiler'])
        self.assertEqual(value['reservationOrder'], ['compiler','assembler'])
        self.assertEqual(value['firstFailure'], 'pin-mismatch')

    def test_symlink_and_hardlink_refuse(self):
        self.populate(); path = self.source_path(); alias = path.with_name('alias')
        os.link(path, alias)
        with self.assertRaises(m.Refusal): self.observer.before()
        self.assertEqual(self.observer.status()['firstFailure'], 'file-type-or-links')

    def test_relative_directory_symlink_refuse(self):
        self.populate(); folder = self.source_path().parent; old = folder.with_name('old-bin')
        folder.rename(old); folder.symlink_to(old)
        with self.assertRaises(m.Refusal): self.observer.before()
        self.assertEqual(self.observer.status()['firstFailure'], 'directory-type')

    def test_aggregate_reserves_before_content_open(self):
        self.populate(); real = os.open; content = []
        def opened(name, flags, *args, **kw):
            if name == self.selected['compiler'][0].split('/')[-1]: content.append(name)
            return real(name, flags, *args, **kw)
        with patch.object(m, 'MAX_TOTAL', 1), patch.object(os, 'open', opened):
            with self.assertRaises(m.Refusal): self.observer.before()
        self.assertEqual(content, [])
        self.assertEqual(self.observer._reports[0]['reservedBytes'], 0)

    def test_growth_during_read_known_extent_plus_one_only(self):
        self.populate(); real = os.read; read_bytes = []; once = []
        path = self.source_path()
        def read(fd, extent):
            if not once:
                once.append(1)
                with path.open('ab') as stream: stream.write(b'x'*10000)
            block = real(fd, extent); read_bytes.append(len(block)); return block
        with patch.object(os, 'read', read):
            with self.assertRaises(m.Refusal): self.observer.before()
        self.assertEqual(sum(read_bytes), len(self.contents['compiler'])+1)
        self.assertEqual(self.observer._reports[0]['reservedBytes'], len(self.contents['compiler']))
        self.assertEqual(self.observer.status()['firstFailure'], 'file-read-race')

    def test_zero_file_and_file_cap(self):
        self.populate(); self.source_path().write_bytes(b'')
        with self.assertRaises(m.Refusal): self.observer.before()
        self.assertEqual(self.observer.status()['firstFailure'], 'file-size')

    def test_route_replacement_before_capture(self):
        self.populate(); session = Path(self.temp.name)/self.observer._owner._creator._name
        session.rename(Path(self.temp.name)/'old-session'); session.mkdir()
        with self.assertRaises(ValueError): self.observer.before()
        self.assertEqual(self.observer.status()['firstFailure'], 'source-route-refused')
        self.assertEqual(self.observer.status()['emittedSequences'], [])

    def test_source_read_reentry_cleanup_only(self):
        self.populate(); real = os.read; calls = []
        def read(*args):
            calls.append(1); value = real(*args)
            try:self.observer.status()
            except m.Refusal:pass
            return value
        with patch.object(os, 'read', read):
            with self.assertRaises(m.Refusal): self.observer.before()
        self.assertEqual(calls, [1]); self.assertEqual(self.observer.status()['emittedSequences'], [])
        self.assertTrue(self.observer.status()['reentered'])
        self.assertEqual(self.observer.status()['workspace']['directories']['liveDirectories'], 0)

    def test_returned_open_reentry_closes_fd(self):
        self.populate(); real = os.open; returned = []
        def opened(*args, **kw):
            fd = real(*args, **kw); returned.append(fd)
            try:self.observer.status()
            except m.Refusal:pass
            return fd
        with patch.object(os, 'open', opened):
            with self.assertRaises(m.Refusal):self.observer.before()
        self.assertEqual(len(returned), 1)
        with self.assertRaises(OSError):os.fstat(returned[0])
        self.assertEqual(self.observer.status()['emittedSequences'], [])

    def test_original_read_error_and_close_refusal(self):
        self.populate(); error = OSError('original private')
        refused = []
        def close(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode) and not refused:
                refused.append(fd); raise OSError('cleanup')
            self.real_close(fd)
        with patch.object(os, 'read', side_effect=error), patch.object(os, 'close', close):
            with self.assertRaises(OSError) as caught:self.observer.before()
        self.assertIs(caught.exception, error)
        s = self.observer.status()
        self.assertEqual(s['firstFailure'], 'filesystem-refusal')
        self.assertEqual(s['localCloseRefused'], 1)
        self.assertFalse(s['localCleanupQualified'])
        self.real_close(refused[0])

    def test_original_capture_error_preserved_despite_writer_failure(self):
        error = OSError('original')
        with patch.object(os, 'stat', side_effect=error):
            with self.assertRaises(OSError) as caught:self.observer.before()
        self.assertIs(caught.exception, error)
        self.assertEqual(self.observer.status()['emittedSequences'], [])

    def test_failed_diagnostic_writer_original_retained(self):
        error = OSError('tool read')
        self.populate()
        with patch.object(os, 'read', side_effect=error), patch.object(os, 'write', side_effect=KeyboardInterrupt('diagnostic')):
            with self.assertRaises(OSError) as caught:self.observer.before()
        self.assertIs(caught.exception, error)
        self.assertEqual(self.observer.status()['secondary'], 'diagnostic-refusal')
        self.assertEqual(self.observer.status()['observationAttempts'], 1)

    def test_registration_fault_cleanup_no_retry(self):
        self.populate(); error = MemoryError('register'); returned = []; real = os.open
        def opened(*args, **kw):
            fd=real(*args, **kw);returned.append(fd);return fd
        with patch.object(os, 'open', opened), patch.object(m._LocalFDs, 'register', side_effect=error):
            with self.assertRaises(MemoryError) as caught:self.observer.before()
        self.assertIs(caught.exception,error)
        with self.assertRaises(OSError):os.fstat(returned[0])

    def test_successful_terminal_third_call_no_retry(self):
        self.populate(); self.observer.before(); self.observer.terminal('after-link')
        with patch.object(self.observer, '_capture', side_effect=AssertionError('no third capture')) as capture, patch.object(self.observer._owner, 'terminal', side_effect=AssertionError('no rewrite')) as terminal:
            with self.assertRaises(m.Refusal):self.observer.terminal('failure-final')
            capture.assert_not_called();terminal.assert_not_called()
        self.assertEqual(self.observer.status()['observationAttempts'],2)

    def test_stat_reentry_poison_full_owner(self):
        self.populate(); real=os.stat; calls=[]
        def named(*args,**kw):
            value=real(*args,**kw);calls.append(1)
            try:self.observer.status()
            except m.Refusal:pass
            return value
        with patch.object(os,'stat',named),patch.object(os,'open',side_effect=AssertionError('no later open')):
            with self.assertRaises(ValueError):self.observer.before()
        self.assertEqual(calls,[1])
        self.assertEqual(self.observer.status()['emittedSequences'],[])
        self.assertIsNotNone(self.observer.status()['workspace']['firstFailure'])

    def test_historical_refusal_then_diagnostic_write_reentry(self):
        self.populate(); error=OSError('read');real=os.write;calls=[]
        def write(*args):
            value=real(*args);calls.append(1)
            try:self.observer.status()
            except m.Refusal:pass
            return value
        with patch.object(os,'read',side_effect=error),patch.object(os,'write',write):
            with self.assertRaises(OSError) as caught:self.observer.before()
        self.assertIs(caught.exception,error)
        self.assertEqual(calls,[1])
        self.assertEqual(self.observer.status()['firstFailure'],'filesystem-refusal')
        self.assertTrue(self.observer.status()['reentered'])
        self.assertEqual(self.observer.status()['emittedSequences'],[])

    def test_terminal_close_reentry_retains_written_fact(self):
        self.populate();self.observer.before();dirs=set(self.observer._owner._ledger.live());called=[]
        def close(fd):
            if fd in dirs and not called:
                called.append(1)
                try:self.observer.status()
                except m.Refusal:pass
            self.real_close(fd)
        with patch.object(os,'close',close):
            with self.assertRaises(ValueError):self.observer.terminal('after-link')
        self.assertEqual(self.observer.status()['emittedSequences'],[1,2])
        self.assertNotEqual(self.observer.status()['phase'],'complete')
        self.assertTrue(self.observer.status()['reentered'])

    def test_source_close_reentry_no_next_role(self):
        self.populate();calls=[]; realread=os.read
        def read(*args):calls.append(1);return realread(*args)
        once=[]
        def close(fd):
            if not once:
                once.append(1)
                try:self.observer.status()
                except m.Refusal:pass
            self.real_close(fd)
        with patch.object(os,'read',read),patch.object(os,'close',close):
            with self.assertRaises(m.Refusal):self.observer.before()
        self.assertEqual(len(calls),2) # content plus one EOF guard for the first role.
        self.assertEqual(self.observer._reports[0]['roles'],{})
        self.assertEqual(self.observer.status()['emittedSequences'],[])

    def test_borrowed_root_not_registered_or_closed(self):
        root=self.root();local=m._LocalFDs(root)
        with self.assertRaises(m.Refusal):local.register(root)
        local.returned_cleanup(root);local.release()
        self.assertTrue(stat.S_ISDIR(os.fstat(root).st_mode))
        self.assertEqual(local.attempted,0)
        for fd in (True,-1,'fd'):
            with self.assertRaises(m.Refusal):local.register(fd)

    def test_single_file_size_cap_before_content_open(self):
        self.populate();real=os.open;content=[]
        def opened(name,flags,*args,**kw):
            if name==self.selected['compiler'][0].split('/')[-1]:content.append(name)
            return real(name,flags,*args,**kw)
        with patch.object(m,'MAX_FILE',1),patch.object(os,'open',opened):
            with self.assertRaises(m.Refusal):self.observer.before()
        self.assertEqual(content,[])
        self.assertEqual(self.observer._reports[0]['reservedBytes'],0)

    def test_oversized_orders_and_refused_pair_never_consistent(self):
        self.populate();self.observer.before();self.observer.terminal('after-link')
        before,after=self.observer._reports
        for field,value in [('roleOrder',['compiler']*10000),('reservationOrder',['compiler']*10000),('firstFailure','x'*10000),('pairFailure','x'*10000)]:
            forged=copy.deepcopy(before);forged[field]=value
            with self.assertRaises(m.Refusal):m.admit_receipt(forged)
        forged=copy.deepcopy(after)
        forged['pairStatus']='refused';forged['pairFailure']='file-read-race';forged['routePhase']='failure-final'
        m.admit_receipt(forged)
        with self.assertRaises(m.Refusal):m.validate_pair(before,forged)

    def test_closed_schema_types_prefix_pair_and_no_caller_inputs(self):
        self.populate();self.observer.before();self.observer.terminal('after-link')
        before,after=self.observer._reports
        for field,value in [('sequence',True),('complete',1),('reservedBytes',1.0),('session','f'),('protocol',True),('pairStatus','invented')]:
            forged=copy.deepcopy(before);forged[field]=value
            with self.assertRaises(m.Refusal):m.admit_receipt(forged)
        forged=copy.deepcopy(before);forged['roleOrder'].reverse()
        with self.assertRaises(m.Refusal):m.admit_receipt(forged)
        forged=copy.deepcopy(after);forged['session']='f'*64
        with self.assertRaises(m.Refusal):m.validate_pair(before,forged)
        with self.assertRaises(TypeError):self.observer.before([])
        with self.assertRaises(TypeError):m.RetainedToolObserver(self.temp.name, lambda:None)

if __name__ == '__main__': unittest.main()
