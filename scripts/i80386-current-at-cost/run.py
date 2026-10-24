"""Four serial current JS 386 cost children; profiled timing is attribution only."""
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
SOURCE=ROOT
PUBLICATION=ROOT.parent/'publication'
PUBLICATION_HEAD='7803a6341d319b30da2bcd4065e5c8005940687f'
PINS={'run.py':'8b941d7af7ae7dfd6c0300b317bd7d2530ecf44b4e9bd6fc2e0d61b89c7f1467','policy.py':'a3ec7bd0a74f38d070babfc39eedfe7afd8d1aaf2e579002749a06cd19f2d659'}
OWN=('package.json','.github/workflows/i80386-current-at-cost.yml','scripts/i80386-at-profile/fixture.mjs','scripts/i80386-current-at-cost/fixture.mjs','scripts/i80386-current-at-cost/run.py','scripts/i80386-current-at-cost/reader.py','scripts/i80386-current-at-cost/source-rows.json','scripts/i80386-current-at-cost/README.md','test/i80386-current-at-cost.test.mjs','docs/I80386-CURRENT-AT-COST.md')
PROFILE_CAP=8388608
STREAM_CAPS=(262144,8192)
INTERVAL=1000
NODE_BYTES=124827920
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
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

SOURCE_ROWS_BYTES=read_file(ROOT/'scripts/i80386-current-at-cost/source-rows.json',65536)
need(hashlib.sha256(SOURCE_ROWS_BYTES).hexdigest()==
     'ba3039a9866105933db4c2877e948758770c59ffc6a37d0e0a82b752b3c7180d',
     'frozen current import-closure manifest')
SOURCE_ROWS=parse(SOURCE_ROWS_BYTES,65536)

def source_admission(held,head):
    need(held.git_bytes(ROOT,'rev-parse','HEAD').strip().decode()==head,'diagnostic head')
    need(held.git_bytes(SOURCE,'rev-parse','HEAD').strip().decode()==head,'source head')
    tree=held.git_bytes(ROOT,'rev-parse','HEAD^{tree}').strip().decode()
    need(re.fullmatch('[0-9a-f]{40}',tree),'exact current source tree')
    own={}
    for name in OWN:
        body=read_file(ROOT/name,65536)
        need(body==held.git_bytes(ROOT,'cat-file','blob',head+':'+name),'diagnostic live/Git join')
        own[name]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
    for name,row in SOURCE_ROWS.items():
        body=read_file(SOURCE/name,4194304)
        need(len(body)==row['bytes'] and hashlib.sha256(body).hexdigest()==row['sha256'],'source row pin')
        need(body==held.git_bytes(SOURCE,'cat-file','blob',head+':'+name),'source live/Git join')
    return {'schema':'bw.current-at-cost-source.v1','diagnosticRootURI':ROOT.as_uri(),
        'diagnosticHead':head,'sourceTree':tree,'diagnosticRoles':own,
        'sourceRootURI':SOURCE.as_uri(),'sourceHead':head,
        'sourceRoles':SOURCE_ROWS,'helpers':PINS}

def position(held,unit,pid,affinity=None):
    need(re.fullmatch(r'bw-current-cost-[0-9]+-1\.service',unit),'owned profile unit')
    member=held.proc_membership(pid);need(member=='/system.slice/'+unit,'owned profile membership')
    directory=Path('/sys/fs/cgroup')/member.lstrip('/')
    values={name:held.bounded_text(directory/name) for name in ('cpu.max','memory.max','memory.swap.max')}
    need(values=={'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0'},'enforced profile resources')
    current=sorted(os.sched_getaffinity(pid));need(len(current)==1 and held.bounded_text(directory/'cpuset.cpus.effective')==str(current[0]),'one effective CPU')
    if affinity is not None:need(current==affinity,'same effective CPU')
    events=held.memory_events(directory);need(all(value==0 for value in events.values()),'memory events must be zero')
    def fields(name):
        raw=held.bounded_text(directory/name);result={}
        for line in raw.splitlines():
            pair=line.split()
            need(len(pair)==2 and pair[0] not in result and pair[1].isdigit(),'cgroup field')
            result[pair[0]]=int(pair[1])
        return result
    stat_fields=fields('cgroup.stat');event_fields=fields('cgroup.events')
    need(all(key in stat_fields and stat_fields[key]==0 for key in ('nr_descendants','nr_dying_descendants')) and
         event_fields.get('populated')==1,'owned unit no nested or dying groups')
    procs_text=held.bounded_text(directory/'cgroup.procs')
    procs=[int(line) for line in procs_text.splitlines() if line.isdigit()]
    need(procs and len(procs)==len(set(procs)) and pid in procs and
         all(line.isdigit() for line in procs_text.splitlines()),'bounded direct cgroup census')
    return {'unit':unit,'membership':member,'limits':values,'affinity':current,
        'memoryEvents':events,'observerPid':pid,'directProcs':sorted(procs),
        'cgroupStat':stat_fields,'cgroupEvents':event_fields}

def prepare_child(held,unit,before,directory):
    resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(PROFILE_CAP,PROFILE_CAP));resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
    observed=position(held,unit,os.getpid(),before['affinity']);need(observed['membership']==before['membership'],'child cgroup')
    need(resource.getrlimit(resource.RLIMIT_FSIZE)==(PROFILE_CAP,PROFILE_CAP),'preexec profile write limit')
    observed['profileFileLimitBytes']=PROFILE_CAP
    store(directory/'resource-preexec.original.json',observed)

def append_bounded(buffer,piece,cap):
    remaining=cap-len(buffer);buffer.extend(piece[:remaining]);need(len(piece)<=remaining,'stream overflow')

def capture(held,node,arm,mode,directory,unit,before):
    directory.mkdir(mode=0o700);process=None;selector=None;reaped=False;usage=None;code=None;primary=None;buffers=[bytearray(),bytearray()];observed=[0,0];started=None;ended=None;timeout=False;secondary=[]
    argv=(node,'--max-old-space-size=512',*(( '--cpu-prof','--cpu-prof-interval=1000','--cpu-prof-dir='+str(directory),'--cpu-prof-name=v8.cpuprofile') if mode=='profile' else ()),str(ROOT/'scripts/i80386-current-at-cost/fixture.mjs'),arm,mode)
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
                os.killpg(process.pid,signal.SIGKILL)
            except BaseException as error:
                secondary.append('owned-killpg:'+type(error).__name__)
                if primary is None:primary=error
            try:
                deadline=time.monotonic()+5
                while not reaped:
                    pid,status,candidate_usage=os.wait4(process.pid,os.WNOHANG)
                    if pid:
                        need(pid==process.pid,'owned cleanup wait4')
                        reaped=True;usage=candidate_usage;code=os.waitstatus_to_exitcode(status)
                        process.returncode=code;ended=time.monotonic()
                    elif time.monotonic()>=deadline:raise Refusal('owned cleanup reap deadline')
                    else:time.sleep(.01)
            except BaseException as error:
                secondary.append('owned-reap:'+type(error).__name__)
                if primary is None:primary=error
        for handle in (selector,getattr(process,'stdout',None),getattr(process,'stderr',None)):
            if handle is not None and not getattr(handle,'closed',False):
                try:handle.close()
                except BaseException as error:
                    secondary.append('close:'+type(error).__name__)
                    if primary is None:primary=error
        metrics={'argv':list(argv),'exitCode':code,'reaped':reaped,'timedOut':timeout,'userSeconds':None if usage is None else usage.ru_utime,'systemSeconds':None if usage is None else usage.ru_stime,'cpuSeconds':None if usage is None else usage.ru_utime+usage.ru_stime,'wholeChildWallSeconds':None if ended is None or started is None else ended-started,'maxRSSKiB':None if usage is None else usage.ru_maxrss,'observedStreamBytes':observed,'bufferPrefixBytes':[len(v) for v in buffers],'kind':arm,'mode':mode,'requestedProfileIntervalMicroseconds':INTERVAL if mode=='profile' else None,'timingIsDiagnosticOnly':True,'cleanupErrors':secondary}
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


def main():
    need(len(sys.argv)==1,'fixed diagnostic no arguments')
    need(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','own hosted attempt')
    head=os.environ.get('BW_EXPECTED_HEAD','');run_id=os.environ.get('GITHUB_RUN_ID','');need(re.fullmatch('[0-9a-f]{40}',head) and run_id.isdecimal(),'source context')
    unit='bw-current-cost-'+run_id+'-1.service';need(os.environ.get('BW_PROFILE_UNIT')==unit,'owned service')
    output=Path(os.environ['RUNNER_TEMP'])/('current-at-cost-'+run_id+'-1');output.mkdir(mode=0o700);completed=[];primary=None
    try:
        held,_=held_modules();source=source_admission(held,head);store(output/'source.original.json',source)
        # Independent reader bytes are part of admitted OWN before compile.
        reader=types.ModuleType('_current_cost_original_reader');reader.__file__=str(ROOT/'scripts/i80386-current-at-cost/reader.py')
        body=read_file(Path(reader.__file__),65536);need(hashlib.sha256(body).hexdigest()==source['diagnosticRoles']['scripts/i80386-current-at-cost/reader.py']['sha256'],'reader admitted bytes')
        exec(compile(body,reader.__file__,'exec'),reader.__dict__)
        node=shutil.which('node');need(node is not None,'Node available');node=str(Path(node).resolve())
        node_body=read_file(Path(node),134217728)
        node_sha=hashlib.sha256(node_body).hexdigest();need(len(node_body)==NODE_BYTES and node_sha==NODE_SHA,'selected Node executable bytes before execution')
        version=subprocess.run((node,'--version'),capture_output=True,timeout=5,check=True);need(version.stdout==b'v22.23.3\n' and version.stderr==b'','fixed Node')
        store(output/'runtime.original.json',{'nodeVersion':'22.23.3','nodePath':node,'nodeBytes':NODE_BYTES,'nodeSha256':node_sha,'python':sys.version})
        affinity=None
        for kind,mode in (('core','timing'),('core','profile'),('at','timing'),('at','profile')):
            before=position(held,unit,os.getpid(),affinity);affinity=before['affinity']
            group=Path('/sys/fs/cgroup')/before['membership'].lstrip('/')
            need(before['directProcs']==[os.getpid()],'no prior children')
            source_before=source_admission(held,head);runtime_before=hashlib.sha256(read_file(Path(node),134217728)).hexdigest()
            need(source_before==source and runtime_before==node_sha,'before source/runtime')
            directory=output/(kind+'-'+mode);capture(held,node,kind,mode,directory,unit,before)
            after=position(held,unit,os.getpid(),affinity);need(after['directProcs']==[os.getpid()],'children gone')
            source_after=source_admission(held,head);runtime_after=hashlib.sha256(read_file(Path(node),134217728)).hexdigest()
            need(source_after==source and runtime_after==node_sha,'after source/runtime')
            store(directory/'resource.original.json',{'before':before,'after':after,'sourceBefore':source_before,'sourceAfter':source_after,'runtimeBeforeSha256':runtime_before,'runtimeAfterSha256':runtime_after})
            names={'stdout':('stdout.original',262144),'stderr':('stderr.original',8192),'usage':('usage.original.json',16384),'resource':('resource.original.json',65536),'preexec':('resource-preexec.original.json',8192),**({'profile':('v8.cpuprofile',8388608)} if mode=='profile' else {})}
            roles={key:read_file(directory/name,cap) for key,(name,cap) in names.items()}
            roles['source']=read_file(output/'source.original.json',65536);roles['runtime']=read_file(output/'runtime.original.json',8192)
            summary=reader.audit(roles);store(directory/'profile-summary.json',summary);completed.append({'kind':kind,'mode':mode,'semanticSha256':hashlib.sha256(roles['stdout']).hexdigest(),'profileSha256':summary.get('profileSha256')})
        store(output/'result.json',{'schema':'bw.current-at-cost-result.v1','complete':True,'children':completed,'costSharesMeasured':False,'performanceGainQualified':False,'physicalRTxQualified':False,'OSQualified':False})
    except BaseException as error:
        primary=error
        try:store(output/'first-failure.json',{'type':type(error).__name__,'reason':str(error)[:2048],'complete':False,'children':completed,'cleanupErrors':getattr(error,'cleanup_errors',[])})
        except BaseException:pass
    if primary is not None:raise primary



def controls():
    import unittest
    class Cases(unittest.TestCase):
        def test_guard_retains_prefix(self):
            buf=bytearray(b'ab')
            with self.assertRaises(Refusal):append_bounded(buf,b'cde',4)
            self.assertEqual(buf,b'abcd')
        def test_bounded_source_manifest_refuses_oversize_before_read(self):
            import tempfile
            with tempfile.TemporaryDirectory(prefix='bw-profile-manifest-control-') as temporary:
                path=Path(temporary)/'source-rows.json'
                path.write_bytes(b'x'*65537)
                with self.assertRaises(Refusal):read_file(path,65536)
        def mocked_capture(self,read_error=None,kill_error=None):
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
                with patch.object(subprocess,'Popen',return_value=process),patch.object(selectors,'DefaultSelector',return_value=Selector()),patch.object(os,'set_blocking'),patch.object(os,'read',side_effect=read_error if read_error is not None else None,return_value=b'x'*8193),patch.object(os,'wait4',side_effect=[(0,0,None),(77,9,usage)]) as wait,patch.object(os,'killpg',side_effect=kill_error) as kill,patch.object(time,'monotonic',return_value=1):
                    with self.assertRaises(Exception) as caught:capture(None,'/fixed/node','A','profile',directory,'unit',{})
                kill.assert_called_once_with(77,signal.SIGKILL);self.assertEqual(wait.call_count,2)
                self.assertTrue(stdout.closed and stderr.closed)
                if read_error is not None:self.assertIs(caught.exception,read_error)
                else:
                    self.assertEqual(len((directory/'stderr.original').read_bytes()),8192)
                    facts=parse((directory/'usage.original.json').read_bytes(),8192)
                    self.assertEqual(facts['observedStreamBytes'][1],8193)
                if kill_error is not None:
                    facts=parse((directory/'usage.original.json').read_bytes(),8192)
                    self.assertTrue(facts['reaped'])
                    self.assertIn('owned-killpg:ProcessLookupError',facts['cleanupErrors'])
            return caught.exception
        def test_overflow_stops_and_preserves_exact_prefix(self):self.mocked_capture()
        def test_original_read_error_survives_selector_cleanup(self):self.mocked_capture(OSError('authored original read'))
        def test_killpg_esrch_still_reaps_exact_child_and_preserves_first(self):
            self.mocked_capture(OSError('authored original read'),ProcessLookupError())
        def test_owned_cgroup_nested_and_dying_refusals(self):
            from unittest.mock import patch
            class Held:
                stat='nr_descendants 0\nnr_dying_descendants 0'
                events='populated 1'
                def proc_membership(self,pid):return '/system.slice/bw-current-cost-1-1.service'
                def memory_events(self,path):return {'max':0,'oom':0,'oom_kill':0}
                def bounded_text(self,path):
                    return {'cpu.max':'100000 100000','memory.max':'1073741824',
                        'memory.swap.max':'0','cpuset.cpus.effective':'0',
                        'cgroup.procs':'10','cgroup.stat':self.stat,
                        'cgroup.events':self.events}[path.name]
            held=Held()
            with patch.object(os,'sched_getaffinity',return_value={0}):
                self.assertEqual(position(held,'bw-current-cost-1-1.service',10)['directProcs'],[10])
                for value in ('nr_descendants 1\nnr_dying_descendants 0',
                              'nr_descendants 0\nnr_dying_descendants 1',
                              'nr_descendants 0'):
                    held.stat=value
                    with self.assertRaises(Refusal):position(held,'bw-current-cost-1-1.service',10)
                held.stat='nr_descendants 0\nnr_dying_descendants 0';held.events='populated 0'
                with self.assertRaises(Refusal):position(held,'bw-current-cost-1-1.service',10)
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Cases))
    need(result.wasSuccessful(),'capture controls')
if __name__=='__main__':
    if sys.argv[1:]==['--controls']:controls()
    else:main()
