"""Tiny manufactured source rows and mocked private boundaries only."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('fixed_context', HERE/'context.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def raw(value):
    return json.dumps(value,sort_keys=True,separators=(',',':')).encode()

class Controls(unittest.TestCase):
    def setUp(self):
        self.table = json.loads((HERE/'context-table.json').read_bytes())
        self.proof = json.loads((HERE/'original-proofs.json').read_bytes())
        self.body=b'authored tiny source\n'
        self.row={'bytes':len(self.body),'sha256':m.digest(self.body),'gitBlob':hashlib.sha1(b'blob '+str(len(self.body)).encode()+b'\0'+self.body).hexdigest()}
        self.table['rows']={p:dict(self.row) for p in self.table['rows']}
        for original in self.proof['javascript'].values():
            original['sourceRows']={p:dict(self.row) for p in original['sourceRows']}
        self.proof['PIC111']['rows']={p:dict(self.row) for p in self.proof['PIC111']['rows']}
        for original in self.proof['native'].values():original['encodedRow']=dict(self.row)
        self.closed=[]
        self.imported=[]

    def harness(self, owner, materialize=None, read=None, git=None, release=None, importer=None):
        bodies={'context-table.json':raw(self.table),'original-proofs.json':raw(self.proof)}
        def create(table):return (m._COMMIT,'CrispStrobe/bw-board',True,True,'owned-mock')
        def load(cap, group, paths, bodies):self.imported.append((group,paths,bodies));return 'manufactured-module-result'
        def close(cap):self.closed.append(cap)
        pins=tuple((p,m.digest(b)) for p,b in bodies.items())
        return [patch.object(m.Context,'_pins',staticmethod(lambda:pins)),
                patch.object(m.Context,'_admit',staticmethod(lambda:True)),patch.object(m,'regular_metadata',new=lambda p:bodies[p]),
                patch.object(m.Context,'_materialize',staticmethod(materialize or create)),
                patch.object(m.Context,'_read_row',staticmethod(read or (lambda *args:self.body))),
                patch.object(m.Context,'_git_row',staticmethod(git or (lambda *args:dict(self.row)))),
                patch.object(m.Context,'_release',staticmethod(release or close)),patch.object(m.Context,'_import',staticmethod(importer or load))]

    def enter(self, owner, **kwargs):
        from contextlib import ExitStack
        stack=ExitStack()
        for hook in self.harness(owner,**kwargs):stack.enter_context(hook)
        self.addCleanup(stack.close)
        return stack

    def test_default_actual_and_prepare_zero_edges(self):
        with patch.object(m,'regular_metadata',side_effect=AssertionError('metadata')),patch.object(m.os,'open',side_effect=AssertionError('OS')):
            with self.assertRaises(m.Refusal):m.actual()
            with self.assertRaises(m.Refusal):m.Context()._prepare()

    def test_closed_186_plan_support_only_and_no_qualification(self):
        owner=m.Context();self.enter(owner)
        status=owner._prepare();self.assertTrue(status['prepared'])
        self.assertEqual(owner._load('protected-ram-source'),'manufactured-module-result')
        self.assertTrue(all(not p.startswith('test/') for p in self.imported[0][1]))
        self.assertFalse(status['actualMaterializationImplemented']);self.assertFalse(status['currentCpuQualified'])
        owner.close();self.assertEqual(len(self.closed),1)

    def test_missing_extra_bool_extent_and_bad_path(self):
        for change in ('missing','extra','bool','path'):
            with self.subTest(change=change):
                saved=copy.deepcopy(self.table)
                key=next(iter(self.table['rows']))
                if change=='missing':self.table['rows'].pop(key)
                elif change=='extra':self.table['rows']['src/extra.js']=dict(self.row)
                elif change=='bool':self.table['rows'][key]['bytes']=True
                else:self.table['rows']['../bad']=self.table['rows'].pop(key)
                owner=m.Context();self.enter(owner)
                with self.assertRaises(m.Refusal):owner._prepare()
                self.assertEqual(self.closed,[]);self.table=saved

    def test_metadata_duplicate_and_hash_seal(self):
        with self.assertRaises(m.Refusal):m.parse(b'{"x":1,"x":2}')
        with self.assertRaises(m.Refusal):m.parse(b'{"x":NaN}')
        owner=m.Context();self.enter(owner)
        with patch.object(m,'regular_metadata',return_value=b'{}'):
            with self.assertRaises(m.Refusal):owner._prepare()

    def test_git_live_blob_and_source_refusal(self):
        for edge in ('git','live','blob'):
            owner=m.Context()
            row=dict(self.row)
            if edge=='blob':
                row['gitBlob']='0'*40
                self.table['rows']={p:dict(row) for p in self.table['rows']}
                for original in self.proof['javascript'].values():original['sourceRows']={p:dict(row) for p in original['sourceRows']}
                self.proof['PIC111']['rows']={p:dict(row) for p in self.proof['PIC111']['rows']}
                for original in self.proof['native'].values():original['encodedRow']=dict(row)
            self.enter(owner,git=(lambda *a:{**row,'sha256':'0'*64}) if edge=='git' else lambda *a:dict(row),read=(lambda *a:b'wrong') if edge=='live' else lambda *a:self.body)
            with self.assertRaises(m.Refusal):owner._prepare()
            self.assertEqual(len(self.closed),1);self.closed.clear()

    def test_original_commit_rows_and_pic111_no_cpu_waiver(self):
        original=next(iter(self.proof['javascript'].values()))
        original['sourceRows'][next(iter(original['sourceRows']))]['sha256']='0'*64
        owner=m.Context();self.enter(owner)
        with self.assertRaises(m.Refusal):owner._prepare()
        self.assertEqual(len(self.closed),1)

    def test_native_descriptor_and_historical_test_selector_refuse(self):
        for edge in ('native','test'):
            saved=copy.deepcopy(self.table);savedp=copy.deepcopy(self.proof)
            if edge=='native':self.proof['native']['cold']['encodedRow']['sha256']='0'*64
            else:self.table['selectors']['protected-ram-source']=['test/i80386-protected-ram-source.test.mjs']
            owner=m.Context();self.enter(owner)
            with self.assertRaises(m.Refusal):owner._prepare()
            self.assertEqual(self.imported,[]);self.table=saved;self.proof=savedp

    def test_returned_owner_captured_before_swallowed_reentry(self):
        owner=m.Context()
        def create(_):
            try:owner.status()
            except m.Refusal:pass
            return (m._COMMIT,'CrispStrobe/bw-board',True,True,'owned-mock')
        self.enter(owner,materialize=create)
        with self.assertRaises(m.Refusal):owner._prepare()
        self.assertEqual(len(self.closed),1);self.assertFalse(owner.status()['prepared'])

    def test_detached_copy_cannot_substitute_admitted_rows(self):
        owner=m.Context()
        def create(table):
            table['rows'].clear()
            return (m._COMMIT,'CrispStrobe/bw-board',True,True,'owned-mock')
        self.enter(owner,materialize=create)
        self.assertTrue(owner._prepare()['prepared']);self.assertEqual(len(owner._bodies),186)
        owner.close()

    def test_dirty_or_wrong_head_context(self):
        for field,value in [('head','0'*40),('clean',False),('detached',False)]:
            owner=m.Context()
            def create(_,field=field,value=value):
                result=list((m._COMMIT,'CrispStrobe/bw-board',True,True,'owned-mock'));result[{'head':0,'clean':3,'detached':2}[field]]=value;return tuple(result)
            self.enter(owner,materialize=create)
            with self.assertRaises(m.Refusal):owner._prepare()
            self.assertEqual(len(self.closed),1);self.closed.clear()

    def test_primary_error_survives_release_failure_and_no_retry(self):
        owner=m.Context();primary=OSError('first-read-error')
        def read(*_):raise primary
        def close(_):raise OSError('secondary-close-error')
        self.enter(owner,read=read,release=close)
        with self.assertRaises(OSError)as error:owner._prepare()
        self.assertIs(error.exception,primary);self.assertEqual(owner.status()['cleanupRefused'],1)
        with self.assertRaises(m.Refusal):owner._prepare()

    def test_invalid_group_and_once_import(self):
        owner=m.Context();self.enter(owner);owner._prepare()
        with self.assertRaises(m.Refusal):owner._load('../foreign.js')
        owner._load('protected-ram-source')
        with self.assertRaises(m.Refusal):owner._load('protected-ram-source')
        self.assertEqual(len(self.imported),1);owner.close()

    def test_owner_substitution_cannot_redirect_read_import_or_cleanup(self):
        owner=m.Context();seen=[]
        original=(m._COMMIT,'CrispStrobe/bw-board',True,True,'owned-mock')
        def git(cap,*_):
            seen.append(cap)
            owner._owned=('0'*40,'foreign',True,True,'foreign-token')
            return dict(self.row)
        def read(cap,*_):seen.append(cap);return self.body
        def release(cap):seen.append(cap);self.closed.append(cap)
        def importer(cap,*_):seen.append(cap);return 'mock'
        self.enter(owner,git=git,read=read,release=release,importer=importer)
        owner._prepare();owner._load('protected-ram-source');owner.close()
        self.assertTrue(all(cap is seen[0] for cap in seen));self.assertEqual(seen[0],original)
        self.assertEqual(self.closed,[original])

    def test_importer_groups_and_hash_constructor_snapshot_before_hooks(self):
        owner=m.Context();seen=[]
        original=(m._COMMIT,'CrispStrobe/bw-board',True,True,'owned-mock')
        def create(_):
            m.Context._import=staticmethod(lambda *_:(_ for _ in ()).throw(AssertionError('lateimport')))
            m._GROUPS=('foreign',)
            m.hashlib.sha256=lambda *_:(_ for _ in ()).throw(AssertionError('latehash'))
            return original
        self.enter(owner,materialize=create)
        with patch.object(m,'_GROUPS',m._GROUPS),patch.object(m.hashlib,'sha256',m.hashlib.sha256):
            owner._prepare();self.assertEqual(owner._load('protected-ram-source'),'manufactured-module-result');owner.close()
        self.assertEqual(len(self.imported),1)

    def test_hash_constructor_reentry_has_no_update_after_poison(self):
        owner=m.Context();updates=[]
        class Hash:
            def update(self,_):updates.append(1)
            def hexdigest(self):return '0'*64
        def constructor():
            try:owner.status()
            except m.Refusal:pass
            return Hash()
        self.enter(owner)
        with patch.object(m.hashlib,'sha256',new=constructor):
            with self.assertRaises(m.Refusal):owner._prepare()
        self.assertEqual(updates,[]);self.assertEqual(self.closed,[])

    def test_setup_capture_failure_closes_lifecycle(self):
        owner=m.Context();primary=OSError('pins-capture-failure')
        with patch.object(m.Context,'_pins',staticmethod(lambda:(_ for _ in ()).throw(primary))):
            with self.assertRaises(OSError)as error:owner._prepare()
        self.assertIs(error.exception,primary);self.assertTrue(owner.closed);self.assertFalse(owner.busy)

    def test_import_swallowed_reentry_never_success(self):
        owner=m.Context()
        def importer(*_):
            try:owner.status()
            except m.Refusal:pass
            return 'poisoned'
        self.enter(owner,importer=importer);owner._prepare()
        with self.assertRaises(m.Refusal):owner._load('protected-ram-source')
        self.assertFalse(owner.status()['prepared']);owner.close()

if __name__=='__main__':unittest.main()
