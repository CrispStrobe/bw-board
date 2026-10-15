"""Tiny authored packet and mocked wait4 controls; no benchmark/resource setup."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import policy as p
import run as r

def authored_records():
    records=[]
    for sequence,phase,pair,arm in p.SCHEDULE:
        timing={'userSeconds':2.0 if arm=='A' else 1.8,'systemSeconds':0.1,'cpuSeconds':2.1 if arm=='A' else 1.9,'wallSeconds':3.0,'maxRSSKiB':1,'exitCode':0,'timedOut':False,'reaped':True,'stdoutBytes':1,'stderrBytes':0}
        timing['cpuSeconds']=timing['userSeconds']+timing['systemSeconds']
        resources={'unit':'bw-width-mask-paired-1-1.service','parentCgroup':'/system.slice/bw-width-mask-paired-1-1.service','childCgroup':'/system.slice/bw-width-mask-paired-1-1.service','cpuMax':'100000 100000','memoryMax':'1073741824','memorySwapMax':'0','parentAffinity':[1],'childAffinity':[1],'childPID':100+sequence,'memoryEventsBefore':{'max':0,'oom':0,'oom_kill':0},'memoryEventsAfter':{'max':0,'oom':0,'oom_kill':0}}
        records.append({'sequence':sequence,'phase':phase,'pair':pair,'arm':arm,'child':{'schema':'bw.width-mask-public-child.v1','arm':arm,'revision':p.SOURCES[arm]['revision'],'sourceFiles':copy.deepcopy(p.SOURCES[arm]['files']),'semantic':copy.deepcopy(p.EXPECTED)},'timing':timing,'resources':resources})
    return records

class Controls(unittest.TestCase):
    def test_authored_numbers_pass_scoped_gate(self):
        value=p.evaluate(authored_records());self.assertTrue(value['performancePassed']);self.assertEqual(len(value['cpuRatios']),7);self.assertFalse(value['adoptionQualified']);self.assertFalse(value['originalBenchmarkGateSatisfied'])
    def test_missing_and_duplicate(self):
        for records in (authored_records()[:-1],authored_records()):
            if len(records)==18:records[-1]=records[-2]
            with self.assertRaises(p.Refusal):p.evaluate(records)
    def test_wrong_pair_order(self):
        rows=authored_records();rows[4],rows[5]=rows[5],rows[4]
        with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_semantic_mismatch(self):
        rows=authored_records();rows[6]['child']['semantic']['readCount']+=1
        with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_source_identity(self):
        rows=authored_records();rows[3]['child']['revision']=p.SOURCES['A']['revision']
        with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_extra_source(self):
        rows=authored_records();rows[0]['child']['sourceFiles']['foreign']={'bytes':1,'sha256':'0'*64}
        with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_nan_and_zero(self):
        for value in (float('nan'),0,True):
            rows=authored_records();rows[0]['timing']['cpuSeconds']=value
            with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_losing_pair_fails_without_dropping(self):
        rows=authored_records();rows[5]['timing'].update(userSeconds=3.0,systemSeconds=0.1,cpuSeconds=3.1)
        self.assertFalse(p.evaluate(rows)['performancePassed'])
    def test_wall_regression(self):
        rows=authored_records()
        for row in rows:
            if row['arm']=='B':row['timing']['wallSeconds']=4.0
        self.assertFalse(p.evaluate(rows)['performancePassed'])
    def test_timeout_and_stderr(self):
        for key,value in (('timedOut',True),('stderrBytes',1),('exitCode',1)):
            rows=authored_records();rows[0]['timing'][key]=value
            with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_memory_event_refusal(self):
        rows=authored_records();rows[0]['resources']['memoryEventsAfter']['oom_kill']=1
        with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_resource_and_affinity(self):
        for key,value in (('cpuMax','max 100000'),('memorySwapMax','1'),('childAffinity',[2])):
            rows=authored_records();rows[0]['resources'][key]=value
            with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_different_measured_cpu(self):
        rows=authored_records();rows[6]['resources']['parentAffinity']=[2];rows[6]['resources']['childAffinity']=[2]
        with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_boolean_semantic(self):
        rows=authored_records();rows[0]['child']['semantic']['faults']=False
        with self.assertRaises(p.Refusal):p.evaluate(rows)
    def test_duplicate_json_refusal(self):
        with self.assertRaises(p.Refusal):json.loads('{"x":1,"x":2}',object_pairs_hook=r.pairs)
    def test_wait4_single_harvest_and_same_window(self):
        with tempfile.TemporaryDirectory(prefix='bw-code16-pure-control-') as temporary:
            output=Path(temporary)/'child';record=authored_records()[0]
            process=SimpleNamespace(pid=77,returncode=None)
            usage=SimpleNamespace(ru_utime=1.0,ru_stime=0.2,ru_maxrss=10)
            def popen(*args,**kwargs):
                kwargs['stdout'].write(json.dumps(record['child']).encode())
                r.write_json(output/'before-node-resource.json',{'mocked':True})
                return process
            with patch.object(r.subprocess,'Popen',side_effect=popen),patch.object(r.os,'wait4',return_value=(77,0,usage)) as wait,patch.object(r.time,'monotonic',side_effect=[10.0,12.0]),patch.object(r.os,'killpg') as kill:
                metrics,report,observed,pid=r.measure_child(('fixed-node','fixture'),{},output,'unit',{})
            self.assertEqual(wait.call_count,1);kill.assert_not_called();self.assertEqual(metrics['cpuSeconds'],1.2);self.assertEqual(metrics['wallSeconds'],2.0);self.assertEqual(pid,77)
    def test_timeout_owned_pid_only_then_harvest(self):
        with tempfile.TemporaryDirectory(prefix='bw-code16-pure-control-') as temporary:
            output=Path(temporary)/'child';process=SimpleNamespace(pid=77,returncode=None);usage=SimpleNamespace(ru_utime=1.0,ru_stime=0.2,ru_maxrss=10)
            with patch.object(r.subprocess,'Popen',return_value=process),patch.object(r.os,'wait4',side_effect=[(0,0,None),(77,9,usage)]) as wait,patch.object(r.time,'monotonic',side_effect=[0.0,61.0,61.1]),patch.object(r.os,'killpg') as kill:
                with self.assertRaises(p.Refusal):r.measure_child(('fixed-node','fixture'),{},output,'unit',{})
            kill.assert_called_once_with(77,r.signal.SIGKILL);self.assertEqual(wait.call_count,2)
            self.assertTrue(json.loads((output/'timing.original.json').read_bytes())['timedOut'])
    def test_spawn_first_failure_preserved(self):
        first=OSError('authored spawn failure')
        with tempfile.TemporaryDirectory(prefix='bw-code16-pure-control-') as temporary:
            output=Path(temporary)/'child'
            with patch.object(r.subprocess,'Popen',side_effect=first),patch.object(r.time,'monotonic',return_value=1),patch.object(r.os,'killpg') as kill:
                with self.assertRaises(OSError) as caught:r.measure_child(('fixed-node','fixture'),{},output,'unit',{})
            self.assertIs(caught.exception,first);kill.assert_not_called();self.assertFalse(json.loads((output/'timing.original.json').read_bytes())['reaped'])
    def test_output_stat_secondary_cannot_mask_spawn_primary(self):
        first=OSError('authored spawn first');secondary=OSError('authored stat second')
        original_stat=r.os.stat
        def observed(path,*args,**kwargs):
            if Path(path).name=='stdout.original':raise secondary
            return original_stat(path,*args,**kwargs)
        with tempfile.TemporaryDirectory(prefix='bw-code16-pure-control-') as temporary:
            output=Path(temporary)/'child'
            with patch.object(r.subprocess,'Popen',side_effect=first),patch.object(r.time,'monotonic',return_value=1),patch.object(r.os,'stat',side_effect=observed):
                with self.assertRaises(OSError) as caught:r.measure_child(('fixed-node','fixture'),{},output,'unit',{})
            self.assertIs(caught.exception,first)
            self.assertIsNone(json.loads((output/'timing.original.json').read_bytes())['stdoutBytes'])
            self.assertTrue((output/'output-observation-errors.json').exists())
    def test_git_stream_cap_retains_prefix_and_owned_cleanup(self):
        class Pipe:
            closed=False
            def __init__(self,fd):self.fd=fd
            def fileno(self):return self.fd
            def close(self):self.closed=True
        class Selector:
            def register(self,*args):pass
            def get_map(self):return {1:1}
            def select(self,*args):return [(SimpleNamespace(data=1,fileobj=stderr),1)]
            def close(self):pass
        stdout=Pipe(10);stderr=Pipe(11);process=SimpleNamespace(pid=77,stdout=stdout,stderr=stderr,returncode=None,wait=lambda **kw:0)
        with patch.object(r.subprocess,'Popen',return_value=process),patch.object(r.selectors,'DefaultSelector',return_value=Selector()),patch.object(r.os,'set_blocking'),patch.object(r.os,'read',return_value=b'x'*8193) as read,patch.object(r.os,'killpg') as kill,patch.object(r.time,'monotonic',return_value=1):
            with self.assertRaises(p.Refusal) as caught:r.git_bytes(Path('/unused'),'rev-parse','HEAD')
        self.assertEqual(len(caught.exception.git_stderr_prefix),8192);self.assertEqual(read.call_args.args,(11,8193));kill.assert_called_once_with(77,r.signal.SIGKILL)
        self.assertTrue(stdout.closed and stderr.closed)
    def test_workflow_cleanup_active_or_nonempty_refuses(self):
        import textwrap
        source=(Path(__file__).resolve().parents[2]/'.github/workflows/i80386-width-mask-paired.yml').read_text()
        code=textwrap.dedent(source.split(" <<'PYCODE'\n",1)[1].split('          PYCODE',1)[0])
        class Cgroup:
            def __init__(self,body):self.body=body
            def lstat(self):return SimpleNamespace(st_mode=0o40755)
            def __truediv__(self,name):return self
            def read_bytes(self):return self.body
        class Parent:
            def __init__(self,body):self.body=body
            def __truediv__(self,name):return Cgroup(self.body)
        for active,body in ((True,b''),(False,b'123\n')):
            with tempfile.TemporaryDirectory(prefix='bw-code16-cleanup-mock-') as temporary:
                context=Path(temporary)
                fields={'LoadState':'loaded','ActiveState':'active' if active else 'inactive','SubState':'running' if active else 'dead','Result':'success','ExecMainCode':'1','ExecMainStatus':'0','ExecMainPID':'123' if active else '0'}
                (context/'unit-after-cleanup.original').write_text(''.join(k+'='+v+'\n' for k,v in fields.items()))
                def fakepath(value):return Parent(body) if str(value)=='/sys/fs/cgroup/system.slice' else Path(value)
                with patch('pathlib.Path',side_effect=fakepath),patch.object(sys,'argv',['mock','bw-width-mask-paired-1-1.service',temporary]):
                    with self.assertRaises(ValueError):exec(compile(code,'workflow-cleanup','exec'),{})
                self.assertFalse(json.loads((context/'owned-service-cleanup.json').read_bytes())['complete'])

import reader as independent

def authored_originals():
    encode=lambda v:(json.dumps(v,sort_keys=True,allow_nan=False)+'\n').encode()
    source={'schema':'bw.width-mask-source.v1','head':'a'*40,'publicationRootURI':'file:///publication','common':{name:{'bytes':1,'sha256':'b'*64} for name in independent.COMMON},'arms':copy.deepcopy(p.SOURCES)}
    runtime={'nodeVersion':'v20.20.2','nodeSha256':'c'*64,'nodePath':'/fixed/node'}
    state={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','Result':'success','ExecMainCode':'0','ExecMainStatus':'0','ExecMainPID':'0'}
    cleanup={'serviceState':state,'cgroupDisposition':'absent','schema':'bw.width-mask-owned-service-cleanup.v1','unit':'bw-width-mask-paired-1-1.service','complete':True,'terminalOrAbsentObserved':True,'emptyOrAbsentCgroupObserved':True}
    rows=authored_records();children=[]
    for row in rows:
        stdout=encode(row['child']);row['timing']['stdoutBytes']=len(stdout)
        res=row['resources'];pre={'unit':res['unit'],'cgroup':res['childCgroup'],'affinity':res['childAffinity'],'cpuMax':res['cpuMax'],'memoryMax':res['memoryMax'],'memorySwapMax':res['memorySwapMax'],'memoryEvents':{'max':0,'oom':0,'oom_kill':0}}
        positions={'before':source,'after':source,'runtimeBeforeSha256':'c'*64,'runtimeAfterSha256':'c'*64}
        invocation={'argv':['/fixed/node','--max-old-space-size=512','/publication/scripts/i80386-width-mask-paired/fixture.mjs',row['arm']],'sourceRoot':'file:///publication'}
        children.append({'stdout':stdout,'stderr':b'','timing':encode(row['timing']),'preexec':encode(pre),'record':encode(row),'positions':encode(positions),'invocation':encode(invocation)})
    originals={'source':encode(source),'runtime':encode(runtime),'cleanup':encode(cleanup),'unitState':''.join(k+'='+v+'\n' for k,v in state.items()).encode(),'cgroupProcs':None,'records':encode(rows),'children':children}
    return originals,{'head':source['head'],'common':source['common']}

class IndependentOriginalCases(unittest.TestCase):
    def test_authored_positive_originals(self):
        originals,expected=authored_originals();r=independent.audit(originals,expected);self.assertTrue(r['performancePassed']);self.assertFalse(r['officialMetadataAuthenticated'])
    def test_raw_stdout_mismatch(self):
        originals,expected=authored_originals();v=json.loads(originals['children'][0]['stdout']);v['semantic']['eflags']=3;originals['children'][0]['stdout']=json.dumps(v).encode()
        with self.assertRaises(independent.Refusal):independent.audit(originals,expected)
    def test_source_after_mismatch(self):
        originals,expected=authored_originals();v=json.loads(originals['children'][0]['positions']);v['after']['head']='d'*40;originals['children'][0]['positions']=json.dumps(v).encode()
        with self.assertRaises(independent.Refusal):independent.audit(originals,expected)
    def test_runtime_command_substitution(self):
        originals,expected=authored_originals();v=json.loads(originals['children'][0]['invocation']);v['argv'][1]='--jitless';originals['children'][0]['invocation']=json.dumps(v).encode()
        with self.assertRaises(independent.Refusal):independent.audit(originals,expected)
    def test_external_publication_mismatch(self):
        originals,expected=authored_originals();expected=copy.deepcopy(expected);expected['head']='d'*40
        with self.assertRaises(independent.Refusal):independent.audit(originals,expected)
    def test_cleanup_uncertain(self):
        originals,expected=authored_originals();v=json.loads(originals['cleanup']);v['complete']=False;originals['cleanup']=json.dumps(v).encode()
        with self.assertRaises(independent.Refusal):independent.audit(originals,expected)
    def test_duplicate_original_json(self):
        with self.assertRaises(independent.Refusal):independent.parse(b'{"count":1,"count":1}',100)
    def test_missing_original_set(self):
        originals,expected=authored_originals();originals['children'].pop()
        with self.assertRaises(independent.Refusal):independent.audit(originals,expected)
if __name__=='__main__':unittest.main()
