"""Fixed owner protocol controls with a manufactured context; no Git or worktree."""
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('owner',Path(__file__).with_name('owner.py'))
owner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)

class Context:
    def __init__(self):
        self.prepared=False;self.busy=False;self.closed=False
        self._prepared_owner=('c'*40,'CrispStrobe/bw-board',True,True,'/tmp/bw-held-fixture/source')
        self._selectors={};self.close_count=0
    def _prepare(self):self.prepared=True
    def _pins(self):return (('context-table.json','a'*64),('original-proofs.json','b'*64))
    def close(self):self.close_count+=1;self.closed=True
    def observations(self):return {'releaseComplete':self.closed,'finalReadbackComplete':self.prepared,'cleanupUncertain':False}

class Controls(unittest.TestCase):
    def run_case(self,command,context):
        output=io.StringIO()
        stdin=type('Input',(),{'buffer':io.BytesIO(command)})()
        with patch.object(owner.materializer,'Materializer',return_value=context),patch.object(owner.sys,'stdin',stdin),patch.object(owner.sys,'stdout',output):
            code=owner.session()
        import json
        return code,[json.loads(line) for line in output.getvalue().splitlines()]
    def test_close_once_after_ready(self):
        c=Context();code,rows=self.run_case(b'CLOSE\n',c)
        self.assertEqual(code,0);self.assertEqual(c.close_count,1)
        self.assertEqual([v['schema'] for v in rows],['bw.historical-owner-ready.v1','bw.historical-owner-closed.v1'])
        self.assertTrue(rows[-1]['releaseObserved'])
    def test_eof_not_success(self):
        c=Context();code,rows=self.run_case(b'',c)
        self.assertEqual(code,1);self.assertEqual(c.close_count,1);self.assertIsNotNone(rows[-1]['firstFailure'])
    def test_wrong_or_overlong_command_refuses(self):
        for raw in (b'CLOSE',b'CLOSE\nX',b'OTHER\n'):
            c=Context();code,rows=self.run_case(raw,c)
            if raw==b'CLOSE\nX':
                # The one line protocol must also reject trailing input.
                self.assertEqual(code,1)
            else:self.assertEqual(code,1)
    def test_prepare_failure_still_closes(self):
        c=Context()
        def fail():raise OSError('first prepare')
        c._prepare=fail
        code,rows=self.run_case(b'CLOSE\n',c)
        self.assertEqual(code,1);self.assertEqual(c.close_count,1);self.assertEqual(len(rows),1)
        self.assertFalse(rows[0]['readyIssued'])
    def test_release_failure_not_success(self):
        c=Context()
        def fail():c.close_count+=1;raise OSError('close failure')
        c.close=fail
        code,rows=self.run_case(b'CLOSE\n',c)
        self.assertEqual(code,1);self.assertFalse(rows[-1]['releaseObserved'])
    def test_prepare_primary_survives_secondary_close(self):
        c=Context()
        def prepare():raise ValueError('primary')
        def close():raise OSError('secondary')
        c._prepare=prepare;c.close=close
        code,rows=self.run_case(b'',c)
        self.assertEqual(code,1);self.assertEqual(rows[-1]['firstFailure']['type'],'ValueError')

if __name__=='__main__':unittest.main()
