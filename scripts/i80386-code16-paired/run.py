"""Fixed hosted public code16 ordinary A/B runner; no native or private input."""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parent))
from policy import SOURCES,SCHEDULE,child,evaluate,require

NAMESPACE=Path(__file__).resolve().parent
PUBLICATION=NAMESPACE.parents[1]
WORKSPACE=PUBLICATION.parent
ARMS={'A':WORKSPACE/'source-a','B':WORKSPACE/'source-b'}
COMMON=('package.json','scripts/i80386-code16-paired/fixture.mjs','scripts/i80386-code16-paired/run.py','scripts/i80386-code16-paired/policy.py','scripts/i80386-code16-paired/controls.py','scripts/i80386-code16-paired/README.md','test/i80386-code16-paired-fixture.test.mjs','.github/workflows/i80386-code16-paired.yml')
MAX_STDOUT=262144
CHILD_SECONDS=60

def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def pairs(items):
    result={}
    for key,value in items:
        require(key not in result,'duplicate JSON key');result[key]=value
    return result

def read_bytes(path,cap):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);primary=None;body=None
    try:
        first=os.fstat(fd);require(stat.S_ISREG(first.st_mode) and first.st_nlink==1 and first.st_size<=cap,'ordinary bounded file')
        chunks=[];count=0
        while True:
            block=os.read(fd,min(65536,cap+1-count));count+=len(block);require(count<=cap,'file cap')
            if not block:break
            chunks.append(block)
        last=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        facts=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_mode,s.st_nlink)
        require(count==first.st_size and facts(first)==facts(last)==facts(named),'file changed');body=b''.join(chunks)
    except BaseException as error:primary=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary
    return body

def write_json(path,value):
    with path.open('xb') as stream:stream.write(canonical(value))

def git_bytes(root,*arguments):
    env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null','GIT_CONFIG_NOSYSTEM':'1','GIT_NO_LAZY_FETCH':'1','GIT_OPTIONAL_LOCKS':'0'}
    process=None;selector=None;primary=None;buffers=[bytearray(),bytearray()];reaped=False
    started=time.monotonic()
    try:
        process=subprocess.Popen(('/usr/bin/git','--no-replace-objects','-C',str(root),*arguments),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,close_fds=True,start_new_session=True)
        selector=selectors.DefaultSelector()
        for index,pipe in enumerate((process.stdout,process.stderr)):
            os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,index)
        while selector.get_map():
            remaining=10-(time.monotonic()-started);require(remaining>0,'Git deadline')
            for key,_ in selector.select(min(remaining,0.1)):
                cap=4194304 if key.data==0 else 8192;available=cap-len(buffers[key.data])
                block=os.read(key.fileobj.fileno(),min(65536,available+1));buffers[key.data].extend(block[:available])
                require(len(block)<=available,'Git output cap')
                if not block:selector.unregister(key.fileobj)
        remaining=10-(time.monotonic()-started);require(remaining>0,'Git wait deadline')
        code=process.wait(timeout=remaining);reaped=True;require(type(code) is int and code==0,'Git admission refused')
    except BaseException as error:primary=error
    finally:
        if process is not None and not reaped:
            try:
                os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=1);reaped=True
            except BaseException as error:
                if primary is None:primary=error
        for handle in (selector,getattr(process,'stdout',None),getattr(process,'stderr',None)):
            if handle is not None and not getattr(handle,'closed',False):
                try:handle.close()
                except BaseException as error:
                    if primary is None:primary=error
    if primary is not None:
        try:primary.git_stdout_prefix=bytes(buffers[0]);primary.git_stderr_prefix=bytes(buffers[1])
        except BaseException:pass
        raise primary
    return bytes(buffers[0])

def admit_sources(head):
    require(git_bytes(PUBLICATION,'rev-parse','HEAD').strip().decode()==head,'publication head')
    common={}
    for name in COMMON:
        live=read_bytes(PUBLICATION/name,4194304);original=git_bytes(PUBLICATION,'cat-file','blob',head+':'+name)
        require(live==original,'common source differs from Git');common[name]={'bytes':len(live),'sha256':hashlib.sha256(live).hexdigest()}
    arms={}
    for arm,root in ARMS.items():
        fixed=SOURCES[arm]
        require(git_bytes(root,'rev-parse','HEAD').strip().decode()==fixed['revision'],'arm head')
        observed={}
        for relative,row in fixed['files'].items():
            live=read_bytes(root/relative,4194304);original=git_bytes(root,'cat-file','blob',fixed['revision']+':'+relative)
            require(live==original and len(live)==row['bytes'] and hashlib.sha256(live).hexdigest()==row['sha256'],'selected source join')
            observed[relative]={'bytes':len(live),'sha256':row['sha256']}
        arms[arm]={'revision':fixed['revision'],'files':observed}
    differences=[name for name in SOURCES['A']['files'] if SOURCES['A']['files'][name]!=SOURCES['B']['files'][name]]
    require(differences==['src/experimental/i80386.js'],'only CPU source difference')
    return {'head':head,'common':common,'arms':arms}

def proc_membership(pid):
    raw=Path(f'/proc/{pid}/cgroup').read_text();require(len(raw)<=4096,'cgroup membership cap')
    rows=raw.splitlines();require(len(rows)==1 and rows[0].startswith('0::/'),'unified cgroup v2')
    return rows[0][3:]

def bounded_text(path):
    raw=path.read_text();require(len(raw)<=8192,'resource text cap');return raw.strip()

def memory_events(directory):
    rows=bounded_text(directory/'memory.events').splitlines();result={}
    for line in rows:
        key,value=line.split();require(key not in result and value.isdecimal(),'memory event row');result[key]=int(value)
    require({'max','oom','oom_kill'}<=set(result),'memory event census');return result

def resource_position(unit,pid,expected_cpu=None):
    require(re.fullmatch(r'bw-code16-paired-[0-9]+-1\.service',unit),'fixed owned service')
    membership=proc_membership(pid)
    require(membership=='/system.slice/'+unit,'owned service membership')
    directory=Path('/sys/fs/cgroup')/membership.lstrip('/')
    cpu_max=bounded_text(directory/'cpu.max');memory_max=bounded_text(directory/'memory.max');swap_max=bounded_text(directory/'memory.swap.max')
    require((cpu_max,memory_max,swap_max)==('100000 100000','1073741824','0'),'literal enforced cgroup policy')
    affinity=sorted(os.sched_getaffinity(pid));require(len(affinity)==1,'one effective CPU')
    if expected_cpu is not None:require(affinity==expected_cpu,'same effective CPU')
    effective=bounded_text(directory/'cpuset.cpus.effective');require(effective==str(affinity[0]),'one effective cpuset')
    return {'unit':unit,'cgroup':membership,'cpuMax':cpu_max,'memoryMax':memory_max,'memorySwapMax':swap_max,'affinity':affinity,'cpusetEffective':effective,'memoryEvents':memory_events(directory)}

def child_setup(unit,parent,output):
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_STDOUT,MAX_STDOUT))
    resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
    observed=resource_position(unit,os.getpid(),parent['affinity'])
    require(observed['cgroup']==parent['cgroup'],'same child resource group before exec')
    write_json(output/'before-node-resource.json',observed)

def measure_child(command,environment,output,unit,parent):
    output.mkdir(mode=0o700);owned=[];process=None;reaped=False;primary=None;usage=None;timed_out=False;code=None;started=None;ended=None
    try:
        stdout=output.joinpath('stdout.original').open('xb');owned.append(stdout)
        stderr=output.joinpath('stderr.original').open('xb');owned.append(stderr)
        started=time.monotonic()
        process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,env=environment,close_fds=True,start_new_session=True,preexec_fn=lambda:child_setup(unit,parent,output))
        while True:
            pid,status,usage=os.wait4(process.pid,os.WNOHANG)
            if pid:
                require(pid==process.pid,'owned wait4 PID');reaped=True;code=os.waitstatus_to_exitcode(status);process.returncode=code;ended=time.monotonic();break
            if time.monotonic()-started>=CHILD_SECONDS:
                timed_out=True;os.killpg(process.pid,signal.SIGKILL)
                pid,status,usage=os.wait4(process.pid,0);require(pid==process.pid,'owned timeout reap');reaped=True;code=os.waitstatus_to_exitcode(status);process.returncode=code;ended=time.monotonic();break
            time.sleep(0.01)
    except BaseException as error:primary=error
    finally:
        if process is not None and not reaped:
            try:
                os.killpg(process.pid,signal.SIGKILL);pid,status,usage=os.wait4(process.pid,0)
                require(pid==process.pid,'cleanup reap PID');reaped=True;code=os.waitstatus_to_exitcode(status);process.returncode=code;ended=time.monotonic()
            except BaseException as error:
                if primary is None:primary=error
        for stream in reversed(owned):
            try:stream.close()
            except BaseException as error:
                if primary is None:primary=error
    counts={};observation_errors=[]
    for key,name in (('stdoutBytes','stdout.original'),('stderrBytes','stderr.original')):
        try:
            observed=os.stat(output/name,follow_symlinks=False)
            require(stat.S_ISREG(observed.st_mode) and observed.st_nlink==1 and observed.st_size>=0,'output observation shape')
            counts[key]=observed.st_size
        except BaseException as error:
            counts[key]=None;observation_errors.append(type(error).__name__)
            if primary is None:primary=error
    metrics={'userSeconds':None if usage is None else usage.ru_utime,'systemSeconds':None if usage is None else usage.ru_stime,'cpuSeconds':None if usage is None else usage.ru_utime+usage.ru_stime,'wallSeconds':None if ended is None or started is None else ended-started,'maxRSSKiB':None if usage is None else usage.ru_maxrss,'exitCode':code,'timedOut':timed_out,'reaped':reaped,**counts}
    if observation_errors:
        try:write_json(output/'output-observation-errors.json',observation_errors)
        except BaseException:pass
    try:write_json(output/'timing.original.json',metrics)
    except BaseException as error:
        if primary is None:primary=error
    if primary is not None:raise primary
    require(reaped and code==0 and not timed_out,'child failure')
    require(metrics['stdoutBytes']<=MAX_STDOUT and metrics['stderrBytes']==0,'child output refusal')
    raw=read_bytes(output/'stdout.original',MAX_STDOUT);report=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda v:(_ for _ in ()).throw(ValueError('nonfinite')))
    observed=json.loads(read_bytes(output/'before-node-resource.json',8192),object_pairs_hook=pairs)
    return metrics,report,observed,process.pid

def main():
    require(len(sys.argv)==1,'fixed runner has no arguments')
    require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','own hosted first attempt')
    head=os.environ.get('BW_EXPECTED_HEAD','');require(re.fullmatch('[0-9a-f]{40}',head),'exact head')
    run_id=os.environ.get('GITHUB_RUN_ID','');require(run_id.isdecimal(),'run ID')
    unit='bw-code16-paired-'+run_id+'-1.service'
    require(os.environ.get('BW_CODE16_UNIT')==unit,'owned unit name')
    output=Path(os.environ['RUNNER_TEMP'])/('code16-public-paired-'+run_id+'-1');output.mkdir(mode=0o700)
    records=[];primary=None
    try:
        source=admit_sources(head);write_json(output/'source-admission.json',source)
        node=shutil.which('node');require(node is not None,'Node available');node=str(Path(node).resolve())
        version=subprocess.run((node,'--version'),capture_output=True,timeout=5,check=True)
        require(version.stdout==b'v20.20.2\n' and version.stderr==b'','fixed Node version')
        node_sha=hashlib.sha256(read_bytes(Path(node),134217728)).hexdigest()
        write_json(output/'runtime.json',{'nodeVersion':'v20.20.2','nodeSha256':node_sha,'python':sys.version,'platform':sys.platform,'measurement':'whole Node wait4 user+system and monotonic same-window wall'})
        expected_affinity=None
        for sequence,phase,pair_index,arm in SCHEDULE:
            parent=resource_position(unit,os.getpid(),expected_affinity)
            if expected_affinity is None:expected_affinity=parent['affinity']
            directory=Path('/sys/fs/cgroup')/parent['cgroup'].lstrip('/')
            require(bounded_text(directory/'cgroup.procs').splitlines()==[str(os.getpid())],'no previous child in owned unit')
            before=admit_sources(head);require(before==source,'source drift before child')
            require(hashlib.sha256(read_bytes(Path(node),134217728)).hexdigest()==node_sha,'Node runtime drift before child')
            child_output=output/f'{sequence:02d}-{phase}-{arm}'
            env={'PATH':os.environ['PATH'],'LANG':'C','LC_ALL':'C','NODE_OPTIONS':'','NODE_PATH':'','LD_PRELOAD':'','LD_AUDIT':'','NODE_V8_COVERAGE':''}
            metrics,report,observed,pid=measure_child((node,'--max-old-space-size=512',str(NAMESPACE/'fixture.mjs'),arm),env,child_output,unit,parent)
            child(report,arm)
            after=resource_position(unit,os.getpid(),expected_affinity)
            require(bounded_text(directory/'cgroup.procs').splitlines()==[str(os.getpid())],'owned children not gone')
            require(admit_sources(head)==source,'source drift after child')
            require(hashlib.sha256(read_bytes(Path(node),134217728)).hexdigest()==node_sha,'Node runtime drift after child')
            facts={'unit':unit,'parentCgroup':parent['cgroup'],'childCgroup':observed['cgroup'],'cpuMax':observed['cpuMax'],'memoryMax':observed['memoryMax'],'memorySwapMax':observed['memorySwapMax'],'parentAffinity':parent['affinity'],'childAffinity':observed['affinity'],'childPID':pid,'memoryEventsBefore':parent['memoryEvents'],'memoryEventsAfter':after['memoryEvents']}
            row={'sequence':sequence,'phase':phase,'pair':pair_index,'arm':arm,'child':report,'timing':metrics,'resources':facts}
            write_json(child_output/'admitted-record.json',row);records.append(row)
        result=evaluate(records);write_json(output/'records.json',records);write_json(output/'result.json',result)
        require(result['performancePassed'],'public workload speed gate failed')
    except BaseException as error:
        primary=error
        try:write_json(output/'first-failure.json',{'type':type(error).__name__,'reason':str(error)[:2048],'completedChildren':len(records),'benchmarkGatePassed':False})
        except BaseException:pass  # Original failure survives diagnostic storage refusal.
    if primary is not None:raise primary
if __name__=='__main__':main()
