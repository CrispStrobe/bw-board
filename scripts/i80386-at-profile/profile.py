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
SOURCE=ROOT.parent/'source'
SOURCE_HEAD='4d17e27c6bb1b3b329ccb53620d342c3b031e672'
PUBLICATION=ROOT.parent/'publication'
PUBLICATION_HEAD='7803a6341d319b30da2bcd4065e5c8005940687f'
PINS={'run.py':'8b941d7af7ae7dfd6c0300b317bd7d2530ecf44b4e9bd6fc2e0d61b89c7f1467','policy.py':'a3ec7bd0a74f38d070babfc39eedfe7afd8d1aaf2e579002749a06cd19f2d659'}
OWN=('package.json','.github/workflows/i80386-at-profile.yml','scripts/i80386-at-profile/fixture.mjs','scripts/i80386-at-profile/profile.py','scripts/i80386-at-profile/reader.py','scripts/i80386-at-profile/README.md','test/i80386-at-profile-fixture.test.mjs')
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

SOURCE_ROWS = {'package.json': {'bytes': 2969, 'sha256': 'ff91e0e077c6e39cea49f5c1f07219637fee72f206a670649178a6a09d5e3e8c'}, 'src/adc0809.js': {'bytes': 6267, 'sha256': '92926d8bd4315fa837d6cce7bc3770148960d181802eb52ba5d9aa013e5f64af'}, 'src/at-8042-a20.js': {'bytes': 19631, 'sha256': 'c604c8a272034a9a80eeb30abe1c5d6ab09ebe6c816b3f3c778874f6b9a9f6b8'}, 'src/at-ps2-mouse.js': {'bytes': 2891, 'sha256': 'b75f93e3a4473e21568af438d658941e9a9703ab330147b8f444baba278281ea'}, 'src/at-system-control.js': {'bytes': 2682, 'sha256': 'aaeecd1c9ea926f4d35481a46be3f64075367152144756786443041018c443e7'}, 'src/audio-bus.js': {'bytes': 10590, 'sha256': '95a263b2432f8309b76a64a0b6dcf0ddcc1dd61aeabb7a8727505f343e26ba08'}, 'src/cga-card.js': {'bytes': 10416, 'sha256': 'afb6141ce8420556e8e9acfff7642225d46f5509db20459bd6fdaba8d0b50fdc'}, 'src/chip-ledger.js': {'bytes': 6217, 'sha256': 'b12b5d635086636f0f9f405e4a06816943b74c03c1b036fcbd3ffe813055ac3a'}, 'src/dac0832.js': {'bytes': 5848, 'sha256': '81b24b9c8f461cbd2f4a9bcd1aceda3e366062841d1c530440eccdb8cbeae787'}, 'src/ega-card.js': {'bytes': 6552, 'sha256': '5b93057ca256f7a43046b477127862278c80bb9849e062528c1cd603f7e3d2f5'}, 'src/experimental/ata16.js': {'bytes': 13489, 'sha256': 'bcf08d6e5e2316cfefe7e264c587e6d23e94b5a4f4e5099c8aace162164a88b7'}, 'src/experimental/i80286-protected.js': {'bytes': 73806, 'sha256': 'b3e00b7bd10e1e02d9e9a27bf543f620229e5f9f888dddf4c9ef0a2127826e70'}, 'src/experimental/i80386-at-machine.js': {'bytes': 26851, 'sha256': '6c5f12cc92ba7219ed4b53f6237622f6ce58269402ee14770791e04c68f93cb0'}, 'src/experimental/i80386.js': {'bytes': 134357, 'sha256': '2303557f35ad56d8101eb96ffc8749fa4d64338425726027d70bd64a6b10d4ba'}, 'src/experimental/vga-memory.js': {'bytes': 7229, 'sha256': '966109bdc8c55992474175dae31dcff4a6d609a64a0cbf2db7b6976e16ee001a'}, 'src/hercules-card.js': {'bytes': 4798, 'sha256': '6e3af9bce88edbc609b2f8a07dc464b8a1fb60ce5fd800a4d345dac61367752b'}, 'src/i8086-machine.js': {'bytes': 128619, 'sha256': '7cf7fdf4e6de451071809e32e128aa0ac663524eaf8b2e08581780b0ec4f167c'}, 'src/i8086-ram-words.js': {'bytes': 1656, 'sha256': '5bfdcf9743a73d1fc37afe78949f045d2aeb2d3d7b71561a694af96a443da6c5'}, 'src/i8086.js': {'bytes': 107519, 'sha256': '814d2a96184f7b490905f25317197ec0dcea8128e234efcf3fe3f173f799300a'}, 'src/i8237.js': {'bytes': 26099, 'sha256': 'a2a774349848e797861108c59a9563a281ce1c1b561a201b8dc022d5584142ad'}, 'src/i8251.js': {'bytes': 9962, 'sha256': '45a2df29bc0920e7d57188a365e8c05addab0805efc1eb02d8df72a41d4dca2b'}, 'src/i8254.js': {'bytes': 18502, 'sha256': '4346fc1eb6b2d368480292372ac8cec7db8cac6baf94d6a88c7311b1809a8c30'}, 'src/i8255.js': {'bytes': 8295, 'sha256': '3445ac6676005f225db542031be51b6d1561045d2be76be339e5853a50f6ff7f'}, 'src/i8259.js': {'bytes': 19093, 'sha256': 'fcfca4a160bac3cf4b72ca0613c63ca702cd26d6822000ba75a0035ef87da278'}, 'src/machine-checkpoint.js': {'bytes': 8280, 'sha256': '576a8420212a8eedaf89dc0dff27cb26e8a7e73c89162e242d65b8e1cc3f0139'}, 'src/mc146818.js': {'bytes': 12655, 'sha256': 'f6caa1e99c2f0fc323cab7a913df68435c5c13c4a86d3c89a8b55ccdde2ec80c'}, 'src/mc6845.js': {'bytes': 11052, 'sha256': '30c369c37fc4030162dde6d46bea388ce9acbf489141195ab166f3c0cab5c599'}, 'src/mc6850.js': {'bytes': 2854, 'sha256': 'e987c5243a92a7b43533a99ff9bf2da29e0bd608a2417162c7b5dfeb1cb75889'}, 'src/ne2000.js': {'bytes': 17462, 'sha256': '12a97f87807aaf74a94245d81acddfb10f43748c09a1d4633e0ba7959b7a1244'}, 'src/ns16c550.js': {'bytes': 8784, 'sha256': '34633ec3bec4d0826998fadde5e11bf88f20dfd32fc5a09144c6bad64461f41b'}, 'src/pc-speaker.js': {'bytes': 6434, 'sha256': '50260dcd04eaedd84373e5c2b1e42faa2f1bc924833b6bdf0aa7d23a80ea9499'}, 'src/sb-dsp.js': {'bytes': 13475, 'sha256': '901fc1d6536e19a552380d226b8e285ff4ab29f871a319d552701c2100044f71'}, 'src/upd765.js': {'bytes': 53603, 'sha256': 'b5a066fd577ee358f40c13682015d28be490acbeb00a50d8c7199671523fcde4'}, 'src/vga-card.js': {'bytes': 10652, 'sha256': '245d777aeae5513a5cae02e943d1e18a5b333bd03352dd2717eee51b8c3e5d71'}, 'src/ym3812.js': {'bytes': 15069, 'sha256': 'c78833b8efb3048143e7fac898a7af5374ce3f00f1b9e5b55baa6d212a51df04'}}

def source_admission(held,head):
    need(held.git_bytes(ROOT,'rev-parse','HEAD').strip().decode()==head,'diagnostic head')
    need(held.git_bytes(SOURCE,'rev-parse','HEAD').strip().decode()==SOURCE_HEAD,'source head')
    own={}
    for name in OWN:
        body=read_file(ROOT/name,65536)
        need(body==held.git_bytes(ROOT,'cat-file','blob',head+':'+name),'diagnostic live/Git join')
        own[name]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
    for name,row in SOURCE_ROWS.items():
        body=read_file(SOURCE/name,4194304)
        need(len(body)==row['bytes'] and hashlib.sha256(body).hexdigest()==row['sha256'],'source row pin')
        need(body==held.git_bytes(SOURCE,'cat-file','blob',SOURCE_HEAD+':'+name),'source live/Git join')
    return {'schema':'bw.at-profile-source.v1','diagnosticRootURI':ROOT.as_uri(),'diagnosticHead':head,'diagnosticRoles':own,'sourceRootURI':SOURCE.as_uri(),'sourceHead':SOURCE_HEAD,'sourceRoles':SOURCE_ROWS,'helpers':PINS}

def position(held,unit,pid,affinity=None):
    need(re.fullmatch(r'bw-at-profile-[0-9]+-1\.service',unit),'owned profile unit')
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
    argv=(node,'--max-old-space-size=512','--cpu-prof','--cpu-prof-interval=1000','--cpu-prof-dir='+str(directory),'--cpu-prof-name=v8.cpuprofile',str(ROOT/'scripts/i80386-at-profile/fixture.mjs'),arm)
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
        metrics={'argv':list(argv),'exitCode':code,'reaped':reaped,'timedOut':timeout,'userSeconds':None if usage is None else usage.ru_utime,'systemSeconds':None if usage is None else usage.ru_stime,'cpuSeconds':None if usage is None else usage.ru_utime+usage.ru_stime,'wholeChildWallSeconds':None if ended is None or started is None else ended-started,'maxRSSKiB':None if usage is None else usage.ru_maxrss,'observedStreamBytes':observed,'bufferPrefixBytes':[len(v) for v in buffers],'kind':arm,'requestedProfileIntervalMicroseconds':INTERVAL,'timingIsDiagnosticOnly':True,'cleanupErrors':secondary}
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
    unit='bw-at-profile-'+run_id+'-1.service';need(os.environ.get('BW_PROFILE_UNIT')==unit,'owned service')
    output=Path(os.environ['RUNNER_TEMP'])/('at-profile-'+run_id+'-1');output.mkdir(mode=0o700);completed=[];primary=None
    try:
        held,_=held_modules();source=source_admission(held,head);store(output/'source.original.json',source)
        # Independent reader bytes are part of admitted OWN before compile.
        reader=types.ModuleType('_at_original_reader');reader.__file__=str(ROOT/'scripts/i80386-at-profile/reader.py')
        body=read_file(Path(reader.__file__),65536);need(hashlib.sha256(body).hexdigest()==source['diagnosticRoles']['scripts/i80386-at-profile/reader.py']['sha256'],'reader admitted bytes')
        exec(compile(body,reader.__file__,'exec'),reader.__dict__)
        node=shutil.which('node');need(node is not None,'Node available');node=str(Path(node).resolve())
        version=subprocess.run((node,'--version'),capture_output=True,timeout=5,check=True);need(version.stdout==b'v20.20.2\n' and version.stderr==b'','fixed Node')
        node_sha=hashlib.sha256(read_file(Path(node),134217728)).hexdigest();store(output/'runtime.original.json',{'nodeVersion':'20.20.2','nodePath':node,'nodeSha256':node_sha,'python':sys.version})
        affinity=None
        for kind in ('core','at'):
            before=position(held,unit,os.getpid(),affinity);affinity=before['affinity']
            group=Path('/sys/fs/cgroup')/before['membership'].lstrip('/')
            need(held.bounded_text(group/'cgroup.procs').splitlines()==[str(os.getpid())],'no prior children')
            source_before=source_admission(held,head);runtime_before=hashlib.sha256(read_file(Path(node),134217728)).hexdigest()
            need(source_before==source and runtime_before==node_sha,'before source/runtime')
            directory=output/kind;capture(held,node,kind,directory,unit,before)
            after=position(held,unit,os.getpid(),affinity);need(held.bounded_text(group/'cgroup.procs').splitlines()==[str(os.getpid())],'children gone')
            source_after=source_admission(held,head);runtime_after=hashlib.sha256(read_file(Path(node),134217728)).hexdigest()
            need(source_after==source and runtime_after==node_sha,'after source/runtime')
            store(directory/'resource.original.json',{'before':before,'after':after,'sourceBefore':source_before,'sourceAfter':source_after,'runtimeBeforeSha256':runtime_before,'runtimeAfterSha256':runtime_after})
            names={'stdout':('stdout.original',262144),'stderr':('stderr.original',8192),'usage':('usage.original.json',16384),'resource':('resource.original.json',65536),'preexec':('resource-preexec.original.json',8192),'profile':('v8.cpuprofile',8388608)}
            roles={key:read_file(directory/name,cap) for key,(name,cap) in names.items()}
            roles['source']=read_file(output/'source.original.json',65536);roles['runtime']=read_file(output/'runtime.original.json',8192)
            summary=reader.audit(roles);store(directory/'profile-summary.json',summary);completed.append({'kind':kind,'profileSha256':summary['profileSha256']})
        store(output/'result.json',{'schema':'bw.at-profile-result.v1','complete':True,'profiles':completed,'costSharesMeasured':False,'performanceGainQualified':False,'physicalRTxQualified':False,'OSQualified':False})
    except BaseException as error:
        primary=error
        try:store(output/'first-failure.json',{'type':type(error).__name__,'reason':str(error)[:2048],'complete':False,'profiles':completed,'cleanupErrors':getattr(error,'cleanup_errors',[])})
        except BaseException:pass
    if primary is not None:raise primary



def controls():
    import unittest
    class Cases(unittest.TestCase):
        def test_guard_retains_prefix(self):
            buf=bytearray(b'ab')
            with self.assertRaises(Refusal):append_bounded(buf,b'cde',4)
            self.assertEqual(buf,b'abcd')
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
    need(result.wasSuccessful(),'capture controls')
if __name__=='__main__':
    if sys.argv[1:]==['--controls']:controls()
    else:main()
