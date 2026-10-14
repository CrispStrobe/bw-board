"""Two fixed hosted V8 diagnostics; profiled timing never enters paired gates."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import selectors
import shutil
import signal
import subprocess
import sys
import time
import types

ROOT=Path(__file__).resolve().parents[2]
PUBLICATION=ROOT.parent/'publication'
PUBLICATION_HEAD='7803a6341d319b30da2bcd4065e5c8005940687f'
PINS={'run.py':'8b941d7af7ae7dfd6c0300b317bd7d2530ecf44b4e9bd6fc2e0d61b89c7f1467','policy.py':'a3ec7bd0a74f38d070babfc39eedfe7afd8d1aaf2e579002749a06cd19f2d659'}
OWN=('.github/workflows/i80386-code16-profile.yml','scripts/i80386-code16-profile/profile.py','scripts/i80386-code16-profile/README.md')
PROFILE_CAP=8388608
STREAM_CAPS=(262144,8192)
INTERVAL=1000
class Refusal(ValueError):pass

def need(value,reason):
    if not value:raise Refusal(reason)

def canonical(value):return (json.dumps(value,sort_keys=True,allow_nan=False)+'\n').encode()
def unique(items):
    result={}
    for key,value in items:
        need(key not in result,'duplicate profile key');result[key]=value
    return result

def parse(raw,cap):
    need(type(raw) is bytes and len(raw)<=cap,'original byte cap')
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda v:(_ for _ in ()).throw(Refusal('nonfinite JSON')))

def read_file(path,cap):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);primary=None;parts=[];count=0
    try:
        import stat
        before=os.fstat(fd);need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<=before.st_size<=cap,'ordinary original')
        while True:
            piece=os.read(fd,min(65536,cap+1-count));count+=len(piece);need(count<=cap,'original cap')
            if not piece:break
            parts.append(piece)
        after=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mode,s.st_nlink,s.st_mtime_ns)
        need(count==before.st_size and identity(before)==identity(after)==identity(named),'original drift')
    except BaseException as error:primary=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary
    return b''.join(parts)

def store(path,value):
    with path.open('xb') as stream:stream.write(canonical(value))

def held_modules():
    directory=PUBLICATION/'scripts/i80386-code16-paired';bodies={}
    # Both executable dependencies authenticate before either is compiled.
    for name,sha in PINS.items():
        body=read_file(directory/name,65536);need(hashlib.sha256(body).hexdigest()==sha,'immutable helper pin');bodies[name]=body
    policy=types.ModuleType('policy');policy.__file__=str(directory/'policy.py')
    exec(compile(bodies['policy.py'],policy.__file__,'exec'),policy.__dict__)
    sys.modules['policy']=policy
    runner=types.ModuleType('_held_code16_run');runner.__file__=str(directory/'run.py')
    exec(compile(bodies['run.py'],runner.__file__,'exec'),runner.__dict__)
    return runner,policy

def source_admission(held,head):
    need(held.git_bytes(ROOT,'rev-parse','HEAD').strip().decode()==head,'diagnostic head')
    own={}
    for name in OWN:
        body=read_file(ROOT/name,65536);original=held.git_bytes(ROOT,'cat-file','blob',head+':'+name)
        need(body==original,'diagnostic live/Git join');own[name]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
    return {'diagnosticHead':head,'diagnosticRoles':own,'publication':held.admit_sources(PUBLICATION_HEAD)}

def position(held,unit,pid,affinity=None):
    need(re.fullmatch(r'bw-code16-profile-[0-9]+-1\.service',unit),'owned profile unit')
    member=held.proc_membership(pid);need(member=='/system.slice/'+unit,'owned profile membership')
    directory=Path('/sys/fs/cgroup')/member.lstrip('/')
    values={name:held.bounded_text(directory/name) for name in ('cpu.max','memory.max','memory.swap.max')}
    need(values=={'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0'},'enforced profile resources')
    current=sorted(os.sched_getaffinity(pid));need(len(current)==1 and held.bounded_text(directory/'cpuset.cpus.effective')==str(current[0]),'one effective CPU')
    if affinity is not None:need(current==affinity,'same effective CPU')
    events=held.memory_events(directory);need(all(value==0 for value in events.values()),'memory events must be zero')
    return {'unit':unit,'membership':member,'limits':values,'affinity':current,'memoryEvents':events}

def prepare_child(held,unit,before,directory):
    resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(PROFILE_CAP,PROFILE_CAP));resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
    observed=position(held,unit,os.getpid(),before['affinity']);need(observed['membership']==before['membership'],'child cgroup')
    store(directory/'resource-preexec.original.json',observed)

def append_bounded(buffer,piece,cap):
    remaining=cap-len(buffer);buffer.extend(piece[:remaining]);need(len(piece)<=remaining,'stream overflow')

def capture(held,node,arm,directory,unit,before):
    directory.mkdir(mode=0o700);process=None;selector=None;reaped=False;usage=None;code=None;primary=None;buffers=[bytearray(),bytearray()];observed=[0,0];started=None;ended=None;timeout=False;secondary=[]
    argv=(node,'--max-old-space-size=512','--cpu-prof','--cpu-prof-interval=1000','--cpu-prof-dir='+str(directory),'--cpu-prof-name=v8.cpuprofile',str(PUBLICATION/'scripts/i80386-code16-paired/fixture.mjs'),arm)
    env={'PATH':os.environ['PATH'],'LANG':'C','LC_ALL':'C','NODE_OPTIONS':'','NODE_PATH':'','NODE_V8_COVERAGE':'','LD_PRELOAD':'','LD_AUDIT':''}
    try:
        started=time.monotonic()
        process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,close_fds=True,start_new_session=True,preexec_fn=lambda:prepare_child(held,unit,before,directory))
        selector=selectors.DefaultSelector()
        for index,pipe in enumerate((process.stdout,process.stderr)):
            os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,index)
        while selector.get_map() or not reaped:
            if not reaped:
                pid,status,candidate_usage=os.wait4(process.pid,os.WNOHANG)
                if pid:
                    need(pid==process.pid,'owned wait4');reaped=True;usage=candidate_usage;code=os.waitstatus_to_exitcode(status);process.returncode=code;ended=time.monotonic()
            remaining=60-(time.monotonic()-started)
            if remaining<=0:
                timeout=True;raise Refusal('profile child deadline')
            for key,_ in selector.select(min(remaining,0.05)):
                available=STREAM_CAPS[key.data]-len(buffers[key.data])
                block=os.read(key.fileobj.fileno(),min(65536,available+1));observed[key.data]+=len(block)
                append_bounded(buffers[key.data],block,STREAM_CAPS[key.data])
                if not block:selector.unregister(key.fileobj)
    except BaseException as error:primary=error
    finally:
        if process is not None and not reaped:
            try:
                os.killpg(process.pid,signal.SIGKILL);pid,status,usage=os.wait4(process.pid,0);need(pid==process.pid,'owned cleanup wait4');reaped=True;code=os.waitstatus_to_exitcode(status);process.returncode=code;ended=time.monotonic()
            except BaseException as error:
                secondary.append('owned-reap:'+type(error).__name__)
                if primary is None:primary=error
        for handle in (selector,getattr(process,'stdout',None),getattr(process,'stderr',None)):
            if handle is not None and not getattr(handle,'closed',False):
                try:handle.close()
                except BaseException as error:
                    secondary.append('close:'+type(error).__name__)
                    if primary is None:primary=error
        metrics={'argv':list(argv),'exitCode':code,'reaped':reaped,'timedOut':timeout,'userSeconds':None if usage is None else usage.ru_utime,'systemSeconds':None if usage is None else usage.ru_stime,'cpuSeconds':None if usage is None else usage.ru_utime+usage.ru_stime,'wholeChildWallSeconds':None if ended is None or started is None else ended-started,'maxRSSKiB':None if usage is None else usage.ru_maxrss,'observedStreamBytes':observed,'bufferPrefixBytes':[len(v) for v in buffers],'requestedProfileIntervalMicroseconds':INTERVAL,'timingIsDiagnosticOnly':True,'cleanupErrors':secondary}
        for name,body in (('stdout.original',bytes(buffers[0])),('stderr.original',bytes(buffers[1])),('usage.original.json',canonical(metrics))):
            try:
                with (directory/name).open('xb') as stream:stream.write(body)
            except BaseException as error:
                secondary.append('store:'+name+':'+type(error).__name__)
                if primary is None:primary=error
    if primary is not None:
        try:primary.cleanup_errors=secondary
        except BaseException:pass
        raise primary
    need(reaped and code==0 and not timeout and len(buffers[1])==0,'profile child refusal')
    return parse(bytes(buffers[0]),STREAM_CAPS[0]),metrics

def profile_summary(raw,arm):
    data=parse(raw,PROFILE_CAP)
    need(type(data) is dict and set(data)=={'nodes','startTime','endTime','samples','timeDeltas'},'complete profile fields')
    for key in ('startTime','endTime'):need(type(data[key]) in (int,float) and math.isfinite(data[key]),'profile finite times')
    duration=data['endTime']-data['startTime'];need(0<duration<=60000000,'recorded profile interval')
    nodes=data['nodes'];samples=data['samples'];deltas=data['timeDeltas']
    need(type(nodes) is list and 0<len(nodes)<=20000 and type(samples) is list and 0<len(samples)<=120000 and type(deltas) is list and len(deltas)==len(samples),'profile census')
    ids={}
    for node in nodes:
        need(type(node) is dict and {'id','callFrame'}<=set(node)<= {'id','callFrame','hitCount','children','positionTicks','deoptReason'},'node fields')
        identifier=node['id'];need(type(identifier) is int and identifier>0 and identifier not in ids,'node ID')
        frame=node['callFrame'];need(type(frame) is dict and set(frame)=={'functionName','scriptId','url','lineNumber','columnNumber'},'call frame')
        for key in ('functionName','scriptId','url'):need(type(frame[key]) is str and len(frame[key])<=4096,'frame strings')
        for key in ('lineNumber','columnNumber'):need(type(frame[key]) is int and frame[key]>=-1,'frame location')
        need(type(node.get('hitCount',0)) is int and node.get('hitCount',0)>=0,'hit count')
        children=node.get('children',[]);need(type(children) is list and len(children)<=20000 and all(type(v) is int and v>0 for v in children),'child references')
        if 'deoptReason' in node:need(type(node['deoptReason']) is str and len(node['deoptReason'])<=4096,'deopt reason')
        ticks=node.get('positionTicks',[]);need(type(ticks) is list and len(ticks)<=20000,'tick bounds')
        for tick in ticks:need(type(tick) is dict and set(tick)=={'line','ticks'} and all(type(v) is int and v>=0 for v in tick.values()),'position ticks')
        ids[identifier]=node
    for node in nodes:need(all(identifier in ids for identifier in node.get('children',[])),'missing child ID')
    weights={identifier:{'sampleCount':0,'rawDeltaMicroseconds':0} for identifier in ids}
    for identifier,delta in zip(samples,deltas):
        need(type(identifier) is int and identifier in ids,'sample reference')
        need(type(delta) is int and abs(delta)<=60000000,'bounded raw delta')
        weights[identifier]['sampleCount']+=1;weights[identifier]['rawDeltaMicroseconds']+=delta
    frames=[]
    engine=(PUBLICATION.parent/('source-a' if arm=='A' else 'source-b')/'src/experimental/i80386.js').as_uri()
    fixture=(PUBLICATION/'scripts/i80386-code16-paired/fixture.mjs').as_uri()
    for identifier,node in ids.items():
        frame=node['callFrame'];url=frame['url'];name=frame['functionName']
        role='engine' if url==engine else 'fixture' if url==fixture else 'Node builtin' if url.startswith('node:') else 'V8 GC' if name=='(garbage collector)' and url=='' else 'unresolved'
        frames.append({'nodeId':identifier,'sourceRole':role,'functionName':name,'url':url,'lineNumber':frame['lineNumber'],'columnNumber':frame['columnNumber'],'deoptReason':node.get('deoptReason'),**weights[identifier]})
    return {'schema':'bw.code16-v8-profile-summary.v1','arm':arm,'profileSha256':hashlib.sha256(raw).hexdigest(),'profileBytes':len(raw),'recordedDurationMicroseconds':duration,'requestedSamplingIntervalMicroseconds':INTERVAL,'totalSamples':len(samples),'rawDeltaSumMicroseconds':sum(deltas),'unusualNonpositiveDeltaCount':sum(v<=0 for v in deltas),'frames':frames,'sampleWeightsAreExactCPUCosts':False,'allocationCountsMeasured':False,'completeOSStartupCovered':False,'pairedPerformanceGate':False,'adoptionQualified':False}

def main():
    need(len(sys.argv)==1,'fixed diagnostic no arguments')
    need(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','own first hosted attempt')
    run_id=os.environ.get('GITHUB_RUN_ID','');head=os.environ.get('BW_EXPECTED_HEAD','');need(run_id.isdecimal() and re.fullmatch('[0-9a-f]{40}',head),'official source context')
    unit='bw-code16-profile-'+run_id+'-1.service';need(os.environ.get('BW_PROFILE_UNIT')==unit,'owned diagnostic unit')
    output=Path(os.environ['RUNNER_TEMP'])/('code16-profile-'+run_id+'-1');output.mkdir(mode=0o700);completed=[];primary=None
    try:
        held,policy=held_modules();source=source_admission(held,head);store(output/'source.original.json',source)
        node=shutil.which('node');need(node is not None,'Node present');node=str(Path(node).resolve())
        version=subprocess.run((node,'--version'),capture_output=True,timeout=5,check=True);need(version.stdout==b'v20.20.2\n' and version.stderr==b'','fixed Node version')
        node_sha=hashlib.sha256(read_file(Path(node),134217728)).hexdigest();store(output/'runtime.original.json',{'nodeVersion':'v20.20.2','nodeSha256':node_sha,'python':sys.version,'requestedProfileIntervalMicroseconds':INTERVAL})
        affinity=None
        for arm in ('A','B'):
            before=position(held,unit,os.getpid(),affinity)
            if affinity is None:affinity=before['affinity']
            group=Path('/sys/fs/cgroup')/before['membership'].lstrip('/')
            need(held.bounded_text(group/'cgroup.procs').splitlines()==[str(os.getpid())],'no prior child')
            need(source_admission(held,head)==source and hashlib.sha256(read_file(Path(node),134217728)).hexdigest()==node_sha,'source/runtime before')
            directory=output/arm;report,metrics=capture(held,node,arm,directory,unit,before);policy.child(report,arm)
            after=position(held,unit,os.getpid(),affinity);need(before['memoryEvents']==after['memoryEvents'],'memory event refusal')
            need(held.bounded_text(group/'cgroup.procs').splitlines()==[str(os.getpid())],'children not gone')
            need(source_admission(held,head)==source and hashlib.sha256(read_file(Path(node),134217728)).hexdigest()==node_sha,'source/runtime after')
            raw=read_file(directory/'v8.cpuprofile',PROFILE_CAP);summary=profile_summary(raw,arm)
            store(directory/'resource.original.json',{'before':before,'after':after});store(directory/'profile-summary.json',summary)
            completed.append({'arm':arm,'profileSha256':summary['profileSha256'],'semanticPassed':True})
        store(output/'result.json',{'schema':'bw.code16-v8-diagnostic-result.v1','profiles':completed,'complete':True,'timingIsDiagnosticOnly':True,'pairedGateSatisfied':False,'adoptionQualified':False})
    except BaseException as error:
        primary=error
        try:store(output/'first-failure.json',{'type':type(error).__name__,'reason':str(error)[:2048],'completedProfiles':completed,'cleanupErrors':getattr(error,'cleanup_errors',[]),'complete':False})
        except BaseException:pass
    if primary is not None:raise primary

def controls():
    import copy
    import unittest
    class Cases(unittest.TestCase):
        def fixture(self):return {'nodes':[{'id':1,'callFrame':{'functionName':'(root)','scriptId':'0','url':'','lineNumber':-1,'columnNumber':-1},'children':[2]},{'id':2,'callFrame':{'functionName':'authored unknown','scriptId':'1','url':'unknown:authored','lineNumber':0,'columnNumber':0},'hitCount':2}],'startTime':10,'endTime':30,'samples':[2,2],'timeDeltas':[5,-1]}
        def test_all_raw_weights_retained(self):
            value=profile_summary(canonical(self.fixture()),'A');self.assertEqual(value['totalSamples'],2);self.assertEqual(value['rawDeltaSumMicroseconds'],4);self.assertEqual(value['unusualNonpositiveDeltaCount'],1);self.assertEqual(value['frames'][1]['sourceRole'],'unresolved');self.assertFalse(value['completeOSStartupCovered'])
        def test_duplicate_json(self):
            with self.assertRaises(Refusal):parse(b'{"x":1,"x":2}',100)
        def test_missing_sample_reference(self):
            value=self.fixture();value['samples'][0]=3
            with self.assertRaises(Refusal):profile_summary(canonical(value),'A')
        def test_cardinality(self):
            value=self.fixture();value['timeDeltas'].pop()
            with self.assertRaises(Refusal):profile_summary(canonical(value),'A')
        def test_duplicate_node_id(self):
            value=self.fixture();value['nodes'][1]['id']=1
            with self.assertRaises(Refusal):profile_summary(canonical(value),'A')
        def test_stream_guard_retains_allowed_prefix(self):
            buffer=bytearray(b'ab')
            with self.assertRaises(Refusal):append_bounded(buffer,b'cde',4)
            self.assertEqual(buffer,b'abcd')
        def test_nonfinite_and_boolean(self):
            with self.assertRaises(Refusal):parse(b'{"time":NaN}',100)
            value=self.fixture();value['samples'][0]=True
            with self.assertRaises(Refusal):profile_summary(canonical(value),'A')
        def test_preexisting_memory_event_refuses(self):
            from types import SimpleNamespace
            from unittest.mock import patch
            def text(path):return {'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','cpuset.cpus.effective':'0'}[path.name]
            held=SimpleNamespace(proc_membership=lambda pid:'/system.slice/bw-code16-profile-1-1.service',bounded_text=text,memory_events=lambda path:{'max':1,'oom':0,'oom_kill':0})
            with patch.object(os,'sched_getaffinity',return_value={0}):
                with self.assertRaises(Refusal):position(held,'bw-code16-profile-1-1.service',1)
        def mocked_capture(self,read_error=None):
            import tempfile
            from types import SimpleNamespace
            from unittest.mock import patch
            class Pipe:
                closed=False
                def __init__(self,fd):self.fd=fd
                def fileno(self):return self.fd
                def close(self):self.closed=True
            class Selector:
                def register(self,*args):pass
                def get_map(self):return {1:1}
                def select(self,*args):return [(SimpleNamespace(data=1,fileobj=stderr),1)]
                def close(self):
                    if read_error is not None:raise OSError('secondary selector close')
            stdout=Pipe(10);stderr=Pipe(11);process=SimpleNamespace(pid=77,stdout=stdout,stderr=stderr,returncode=None)
            usage=SimpleNamespace(ru_utime=0.1,ru_stime=0.1,ru_maxrss=1)
            with tempfile.TemporaryDirectory(prefix='bw-profile-pure-control-') as temporary:
                directory=Path(temporary)/'A'
                with patch.object(subprocess,'Popen',return_value=process),patch.object(selectors,'DefaultSelector',return_value=Selector()),patch.object(os,'set_blocking'),patch.object(os,'read',side_effect=read_error if read_error is not None else None,return_value=b'x'*8193),patch.object(os,'wait4',side_effect=[(0,0,None),(77,9,usage)]) as wait,patch.object(os,'killpg') as kill,patch.object(time,'monotonic',return_value=1):
                    with self.assertRaises(Exception) as caught:capture(None,'/fixed/node','A',directory,'unit',{})
                kill.assert_called_once_with(77,signal.SIGKILL);self.assertEqual(wait.call_count,2)
                self.assertTrue(stdout.closed and stderr.closed)
                if read_error is not None:self.assertIs(caught.exception,read_error)
                else:
                    self.assertEqual(len((directory/'stderr.original').read_bytes()),8192)
                    facts=parse((directory/'usage.original.json').read_bytes(),8192)
                    self.assertEqual(facts['observedStreamBytes'][1],8193)
            return caught.exception
        def test_overflow_stops_and_preserves_exact_prefix(self):self.mocked_capture()
        def test_original_read_error_survives_selector_cleanup(self):self.mocked_capture(OSError('authored original read'))
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Cases))
    need(result.wasSuccessful(),'pure controls failed')
if __name__=='__main__':
    if sys.argv[1:]==['--controls']:controls()
    else:main()
