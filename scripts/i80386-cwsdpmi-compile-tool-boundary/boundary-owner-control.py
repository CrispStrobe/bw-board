"""Manufactured callbacks only; never imports compiler or tool helpers."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('owner', Path(__file__).with_name('boundary-owner.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Controls(unittest.TestCase):
    def owner(self, fail_capture=None, fail_write=None):
        self.events=[]
        def capture(phase):
            self.events.append(('capture',phase))
            if phase==fail_capture: raise OSError('private path never serialized')
            return {'complete':True}
        def write(path,receipt):
            self.events.append(('write',path))
            if path==fail_write: raise OSError('private write path')
        return m.PhaseOwner(capture,write,'before','terminal')

    def test_success_order_no_third(self):
        o=self.owner();o.before();self.events.append(('command','link'));o.after();o.failure()
        self.assertEqual([x[1] for x in self.events if x[0]=='capture'],['before-probes','after-link'])
        self.assertFalse(o.status()['compilationQualified'])

    def test_before_fail_stops_commands(self):
        for capture,write in [('before-probes',None),(None,'before')]:
            o=self.owner(capture,write);commands=[]
            with self.assertRaises(OSError):o.before();commands.append('probe')
            self.assertEqual(commands,[]);o.failure();o.failure()
            self.assertEqual(o.status()['firstFailure'],'boundary-operation-refused')
            self.assertEqual(sum(x==('capture','failure-final') for x in self.events),1)

    def test_original_exception_preserved(self):
        for capture,write in [('failure-final',None),(None,'terminal')]:
            o=self.owner(capture,write);o.before();original=RuntimeError('original')
            try:
                try:raise original
                except BaseException:m.preserve_error(o.failure);raise
            except RuntimeError as error:self.assertIs(error,original)
            self.assertEqual(o.status()['secondary'],'diagnostic-refusal')
            self.assertNotIn('private',str(o.status()))

    def test_secondary_status_and_write_failures_preserve_original(self):
        for failure in [OSError("private status path"), ValueError("private parse path"),
                        KeyError("phase"), KeyboardInterrupt(), SystemExit(7)]:
            original=RuntimeError("original")
            def secondary():raise failure
            try:
                try:raise original
                except BaseException:
                    self.assertEqual(m.preserve_error(secondary),"secondary-refusal")
                    raise
            except RuntimeError as error:self.assertIs(error,original)

    def test_failed_after_no_retry(self):
        o=self.owner(fail_write='terminal');o.before()
        with self.assertRaises(OSError):o.after()
        o.failure();o.failure()
        self.assertEqual([x[1] for x in self.events if x[0]=='capture'],['before-probes','after-link'])
        self.assertEqual(self.events.count(('write','terminal')),1)

    def test_swallowed_reentry_stops_writer(self):
        events=[];o=None
        def capture(phase):
            try:o.status()
            except m.Refusal:pass
            events.append(phase);return {'complete':True}
        o=m.PhaseOwner(capture,lambda *a:events.append('write'),'a','b')
        with self.assertRaises(m.Refusal):o.before()
        o.failure();self.assertEqual(events,['before-probes']);self.assertTrue(o.status()['poisoned'])

    def test_incomplete_refuses_positive(self):
        o=m.PhaseOwner(lambda p:{'complete':False},lambda *a:None,'a','b')
        with self.assertRaises(m.Refusal):o.before()
        o.failure();self.assertEqual(o.status()['phase'],'terminal-consumed')

    def test_illegal_order_poison_no_further_callbacks(self):
        o=self.owner();o.before();prior=list(self.events)
        with self.assertRaises(m.Refusal):o.before()
        with self.assertRaises(m.Refusal):o.after()
        o.failure();self.assertEqual(self.events,prior)
        self.assertEqual(o.status()['firstFailure'],'owner-order')
        self.assertTrue(o.status()['poisoned'])

    def test_production_unconditionally_disabled_static(self):
        import ast
        source=Path(__file__).with_name('compile.py').read_text();tree=ast.parse(source)
        first_raise=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Raise))
        first_call=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Assign) and any(isinstance(x,ast.Call) for x in ast.walk(n)))
        self.assertLess(first_raise,first_call)
        self.assertIn('compile-tool-boundary-production-disabled',source)

if __name__=='__main__':unittest.main()
