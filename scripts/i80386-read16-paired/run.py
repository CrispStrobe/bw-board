"""Disabled, fixed hosted ordinary-AT read16 capture. No local benchmark route."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import signal
import stat
import subprocess
import sys
import time

ACTUAL_ENABLED=False
ROOT=Path(__file__).resolve().parents[2]
NAMESPACE=ROOT/'scripts/i80386-read16-paired'
BASE_HEAD='1312250f5ef06ecd96b0e40e2926e87312d8f414'
BASE_TREE='04839d8ebe47645a452d80e7a532c14dd91e0b3e'
ROWS_SHA='0b0c856983519a32e04f1c61d1317bb72184fb6f558780019d9bc0fa44bc4b2f'
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
NODE=Path('/opt/hostedtoolcache/node/22.23.3/x64/bin/node')
COMMON=('package.json','scripts/i80386-at-profile/fixture.mjs','scripts/i80386-read16-paired/fixture.mjs','scripts/i80386-read16-paired/run.py','scripts/i80386-read16-paired/reader.py','scripts/i80386-read16-paired/controls.py','scripts/i80386-read16-paired/source-rows.json','scripts/i80386-read16-paired/README.md','test/i80386-read16-ordered-pair.test.mjs','.github/workflows/i80386-read16-paired.yml')
ORDERS=('AB','BA','AB','BA','BA','AB','BA')
SCHEDULE=tuple([(i,'warmup',None,a) for i,a in enumerate('ABAB')]+[(4+p*2+i,'measured',p,a) for p,order in enumerate(ORDERS) for i,a in enumerate(order)])
CAP=2097152
class Refusal(ValueError):pass
def need(value,reason):
    if not value:raise Refusal(reason)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def b64(raw):return base64.b64encode(raw).decode()
def unique(items):
    value={}
    for k,v in items:need(k not in value,'duplicate key');value[k]=v
    return value
def parse(raw):return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite')))
def read_file(path,cap):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);parts=[];count=0
    try:
        first=os.fstat(fd);need(stat.S_ISREG(first.st_mode) and first.st_nlink==1 and 0<first.st_size<=cap,'bounded ordinary input')
        while True:
            block=os.read(fd,min(65536,cap+1-count));count+=len(block);need(count<=cap,'input cap')
            if not block:break
            parts.append(block)
        last=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        facts=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_nlink,s.st_mtime_ns)
        need(count==first.st_size and facts(first)==facts(last)==facts(named),'input drift')
        return b''.join(parts)
    finally:os.close(fd)
def store(path,value,cap=CAP):
    raw=canonical(value);need(len(raw)<=cap,'original cap')
    with path.open('xb') as f:f.write(raw)
def git(root,*args):
    # Git is metadata-only, bounded, with no replacement objects or lazy fetch.
    env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null','GIT_CONFIG_NOSYSTEM':'1','GIT_NO_LAZY_FETCH':'1','GIT_OPTIONAL_LOCKS':'0'}
    stdout,stderr,usage=capture(('/usr/bin/git','--no-replace-objects','-C',str(root),*args),env,None,seconds=10,stream_caps=(4194304,8192),own_group=False)
    if not(usage['exitCode']==0 and usage['reaped'] and not usage['primary'] and not usage['secondary']):
        error=Refusal('bounded Git admission')
        error.facts={'arguments':list(args),'stdoutPrefixBase64':b64(stdout[:4096]),'stderrPrefixBase64':b64(stderr[:2048]),'stdoutSha256':sha(stdout),'stderrSha256':sha(stderr),'usage':usage}
        raise error
    return stdout

def admit_request(raw,event_raw):
    need(len(raw)<=65536 and sha(raw)==os.environ.get('BW_READ16_REQUEST_SHA256'),'external request SHA')
    req=parse(raw);need(canonical(req)==raw and set(req)=={'schema','repository','head','tree','baseHead','baseTree','workflowHead','workflowRef','pullRequest','sourceBranch','label','eventName','attempt','sourceRowsSha256','commonFiles','workflowSha256'},'closed canonical request')
    need(req['schema']=='bw.read16-paired-request.v1' and req['repository']=='CrispStrobe/bw-board' and req['baseHead']==BASE_HEAD and req['baseTree']==BASE_TREE and req['sourceRowsSha256']==ROWS_SHA,'fixed request scope')
    need(type(req['pullRequest']) is int and 0<req['pullRequest']<10**9 and req['sourceBranch']=='lane/386-read16-ordered-pair-source-20261024' and req['label']=='x86-read16-paired-v1','one selected PR/label')
    need(req['eventName']=='pull_request' and type(req['attempt']) is int and req['attempt']==1,'one owned event scope')
    need(all(type(req[k]) is str and re.fullmatch('[0-9a-f]{40}',req[k]) and req[k]!='0'*40 for k in ('head','tree','workflowHead')),'exact head/tree')
    need(req['workflowRef']=='CrispStrobe/bw-board/.github/workflows/i80386-read16-paired.yml@refs/pull/'+str(req['pullRequest'])+'/merge','executing workflow ref')
    need(type(req['commonFiles']) is dict and set(req['commonFiles'])==set(COMMON),'closed common paths')
    for row in req['commonFiles'].values():need(type(row) is dict and set(row)=={'bytes','sha256'} and type(row['bytes']) is int and 0<row['bytes']<=131072 and type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}',row['sha256']),'common row')
    need(req['workflowSha256']==req['commonFiles']['.github/workflows/i80386-read16-paired.yml']['sha256'],'workflow hash join')
    wanted={'GITHUB_ACTIONS':'true','GITHUB_ACTOR':'CrispStrobe','GITHUB_REPOSITORY':req['repository'],'BW_EXPECTED_HEAD':req['head'],'GITHUB_WORKFLOW_SHA':req['workflowHead'],'GITHUB_WORKFLOW_REF':req['workflowRef'],'GITHUB_HEAD_REF':req['sourceBranch'],'GITHUB_BASE_REF':'master','GITHUB_EVENT_NAME':'pull_request','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'paired'}
    need(all(os.environ.get(k)==v for k,v in wanted.items()),'exact hosted event environment')
    run=os.environ.get('GITHUB_RUN_ID','');need(run.isdecimal() and 0<int(run)<10**15,'one official run')
    need(len(event_raw)<=262144,'event cap');event=parse(event_raw)
    admit_event(req,event)
    return req

def admit_event(req,event):
    pr=event.get('pull_request',{});body=pr.get('body');marker='BW_READ16_PAIRED_REQUEST_SHA256'
    need(type(body) is str and len(body.encode())<=65536 and body.casefold().count(marker.casefold())==1 and re.findall(r'<!-- BW_READ16_PAIRED_REQUEST_SHA256=([0-9a-f]{64}) -->',body)==[sha(canonical(req))],'single event-frozen request SHA marker')
    head=pr.get('head',{});base=pr.get('base',{})
    need(event.get('action')=='labeled' and type(event.get('number')) is int and event['number']==req['pullRequest'] and type(pr.get('number')) is int and pr['number']==req['pullRequest'],'selected labeled PR')
    need(event.get('repository',{}).get('full_name')==req['repository'] and event['repository'].get('fork') is False and event.get('sender',{}).get('login')=='CrispStrobe','own owner event')
    need(pr.get('state')=='open' and pr.get('merged') is False and base.get('ref')=='master' and base.get('repo',{}).get('full_name')==req['repository'],'open own base PR')
    need(head.get('sha')==req['head'] and head.get('ref')==req['sourceBranch'] and head.get('repo',{}).get('full_name')==req['repository'] and head['repo'].get('fork') is False and head['repo'].get('owner',{}).get('login')=='CrispStrobe','exact nonfork PR head')
    need(event.get('label',{}).get('name')==req['label'] and type(pr.get('labels')) is list and sum(x.get('name')==req['label'] for x in pr['labels'])==1,'exact selected label')

def admit_sources(req,observations=None,emit=None):
    seen={} if observations is None else observations
    seen.update(phase='manifest',lastPath='scripts/i80386-read16-paired/source-rows.json',manifestSha256=None,commonFiles={},publication=None,arms={},workflowSource=None)
    def note(phase,path,row=None):
        seen['phase']=phase;seen['lastPath']=path
        if emit is not None and row is not None:emit({'phase':phase,'path':path,'verified':row})
    rows_raw=read_file(NAMESPACE/'source-rows.json',16384);need(sha(rows_raw)==ROWS_SHA,'source35 pin');rows=parse(rows_raw);seen['manifestSha256']=ROWS_SHA;note('manifest',seen['lastPath'],{'sha256':ROWS_SHA})
    common={}
    for name in COMMON:
        note('common',name)
        raw=read_file(ROOT/name,131072);row={'bytes':len(raw),'sha256':sha(raw)}
        need(row==req['commonFiles'][name] and raw==git(ROOT,'cat-file','blob',req['head']+':'+name),'common live/Git join');common[name]=row;seen['commonFiles'][name]=row;note('common',name,row)
    note('publication-git','HEAD')
    need(git(ROOT,'rev-parse','HEAD').strip().decode()==req['head'] and git(ROOT,'rev-parse','HEAD^{tree}').strip().decode()==req['tree'],'publication checkout')
    seen['publication']={'head':req['head'],'tree':req['tree']};note('publication-git','HEAD',seen['publication'])
    for arm,head,tree in [('A',BASE_HEAD,BASE_TREE),('B',req['head'],req['tree'])]:
        seen['arms'][arm]={'head':None,'tree':None,'files':{}};note('arm-'+arm,'HEAD')
        root=ROOT.parent/('source-a' if arm=='A' else 'source-b')
        need(git(root,'rev-parse','HEAD').strip().decode()==head and git(root,'rev-parse','HEAD^{tree}').strip().decode()==tree,'arm checkout head/tree')
        seen['arms'][arm].update(head=head,tree=tree);note('arm-'+arm,'HEAD',{'head':head,'tree':tree})
        for name,row in rows[arm].items():
            note('arm-'+arm,name)
            raw=read_file(root/name,4194304);need(len(raw)==row['bytes'] and sha(raw)==row['sha256'] and raw==git(root,'cat-file','blob',head+':'+name),'arm live/Git/source35')
            seen['arms'][arm]['files'][name]=row;note('arm-'+arm,name,row)
    note('workflow','.github/workflows/i80386-read16-paired.yml')
    workflow_root=ROOT.parent/'workflow-source';name='.github/workflows/i80386-read16-paired.yml'
    need(git(workflow_root,'rev-parse','HEAD').strip().decode()==req['workflowHead'],'actual workflow checkout')
    body=read_file(workflow_root/name,131072)
    need(body==read_file(ROOT/name,131072) and body==git(workflow_root,'cat-file','blob',req['workflowHead']+':'+name),'executing merge/head workflow Git blob equality')
    workflow={'head':req['workflowHead'],'ref':req['workflowRef'],'fileBytes':len(body),'fileSha256':sha(body)}
    need(workflow['fileSha256']==req['workflowSha256'],'executing workflow file SHA')
    seen['workflowSource']=workflow;note('workflow',name,workflow)
    return {'schema':'bw.read16-paired-source.v1','head':req['head'],'tree':req['tree'],'baseHead':BASE_HEAD,'baseTree':BASE_TREE,'rowsBase64':b64(rows_raw),'commonFiles':common,'arms':rows,'workflowSource':workflow}

def text(path):
    raw=path.read_bytes();need(0<len(raw)<=8192,'resource text cap');return raw.decode().strip()
def integer_fields(path):
    result={}
    for line in text(path).splitlines():
        k,v=line.split();need(k not in result and v.isdecimal(),'resource fields');result[k]=int(v)
    return result

def position(unit,parent,child=None,affinity=None):
    need(re.fullmatch(r'bw-read16-paired-[0-9]+-1\.service',unit),'owned service')
    pid=parent if child is None else child
    membership=text(Path('/proc')/str(pid)/'cgroup');need(membership=='0::/system.slice/'+unit,'owned membership')
    directory=Path('/sys/fs/cgroup/system.slice')/unit
    limits={k:text(directory/k) for k in ('cpu.max','memory.max','memory.swap.max','pids.max')}
    need(limits=={'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','pids.max':'64'},'enforced resources')
    cpus=sorted(os.sched_getaffinity(pid));need(len(cpus)==1 and text(directory/'cpuset.cpus.effective')==str(cpus[0]) and (affinity is None or cpus==affinity),'fixed one CPU')
    raw=text(directory/'cgroup.procs').splitlines();need(raw and all(p.isdecimal() for p in raw),'direct PID census');pids=sorted(int(p) for p in raw)
    need(pids==([parent] if child is None else sorted([parent,child])),'no extra direct process')
    stats=integer_fields(directory/'cgroup.stat');events=integer_fields(directory/'cgroup.events');memory=integer_fields(directory/'memory.events')
    need(stats.get('nr_descendants')==stats.get('nr_dying_descendants')==0 and events.get('populated')==1,'no nested/dying group')
    tasks=int(text(directory/'pids.current'));need(len(pids)<=tasks<=64,'bounded task census')
    need({'max','oom','oom_kill'}<=set(memory) and all(v==0 for v in memory.values()),'no memory events')
    return {'unit':unit,'membership':'/system.slice/'+unit,'observerPid':pid,'affinity':cpus,'limits':limits,'pids':pids,'descendants':stats['nr_descendants'],'dyingDescendants':stats['nr_dying_descendants'],'populated':events['populated'],'tasksCurrent':tasks,'memoryEvents':memory}

def prepare_child(unit,parent,before,path):
    resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(32768,32768));resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))
    store(path,position(unit,parent,os.getpid(),before['affinity']),8192)

def capture(command,environment,preexec,seconds=60,stream_caps=(32768,8192),output_paths=None,own_group=True):
    """Owned PID/group only. Preserve first failure and bounded stream prefixes."""
    process=None;selector=None;parts=[bytearray(),bytearray()];sinks=[];reaped=False;usage=None;code=None;primary=None;secondary=[];timed_out=False;start=None;end=None
    try:
        if output_paths is not None:
            need(len(output_paths)==2,'two owned stream files')
            for path in output_paths:sinks.append(path.open('xb',buffering=0))
        start=time.monotonic()
        process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,close_fds=True,start_new_session=own_group,preexec_fn=preexec)
        selector=selectors.DefaultSelector()
        for i,pipe in enumerate((process.stdout,process.stderr)):
            os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,i)
        while selector.get_map() or not reaped:
            remaining=seconds-(time.monotonic()-start)
            if remaining<=0:timed_out=True;raise Refusal('child deadline')
            for key,_ in selector.select(min(remaining,0.02)):
                cap=stream_caps[key.data];available=cap-len(parts[key.data]);block=os.read(key.fileobj.fileno(),min(65536,available+1))
                prefix=block[:available];parts[key.data].extend(prefix)
                if sinks:need(sinks[key.data].write(prefix)==len(prefix),'raw stream short write')
                need(len(block)<=available,'stream overflow')
                if not block:selector.unregister(key.fileobj)
            if not reaped:
                pid,status,current=os.wait4(process.pid,os.WNOHANG)
                if pid:
                    need(pid==process.pid,'owned wait4 PID');reaped=True;usage=current;code=os.waitstatus_to_exitcode(status);process.returncode=code;end=time.monotonic()
    except BaseException as error:primary={'type':type(error).__name__,'reason':str(error)[:1024]}
    finally:
        if process is not None and not reaped:
            try:
                if own_group:os.killpg(process.pid,signal.SIGKILL)
                else:os.kill(process.pid,signal.SIGKILL)
            except BaseException as error:secondary.append({'phase':'kill','type':type(error).__name__,'reason':str(error)[:256]})
            try:
                deadline=time.monotonic()+5
                while True:
                    pid,status,current=os.wait4(process.pid,os.WNOHANG)
                    if pid:
                        need(pid==process.pid,'cleanup PID');reaped=True;usage=current;code=os.waitstatus_to_exitcode(status);process.returncode=code;end=time.monotonic();break
                    need(time.monotonic()<deadline,'cleanup reap deadline');time.sleep(0.01)
            except BaseException as error:secondary.append({'phase':'reap','type':type(error).__name__,'reason':str(error)[:256]})
        for name,handle in [('selector',selector),('stdout',getattr(process,'stdout',None)),('stderr',getattr(process,'stderr',None))]+[('raw'+str(i),sink) for i,sink in enumerate(sinks)]:
            if handle is not None:
                try:handle.close()
                except BaseException as error:secondary.append({'phase':name,'type':type(error).__name__,'reason':str(error)[:256]})
    cpu=None if usage is None else usage.ru_utime+usage.ru_stime
    metrics={'pid':None if process is None else process.pid,'exitCode':code,'reaped':reaped,'timedOut':timed_out,'userSeconds':None if usage is None else usage.ru_utime,'systemSeconds':None if usage is None else usage.ru_stime,'cpuSeconds':cpu,'wallSeconds':None if end is None or start is None else end-start,'maxRSSKiB':None if usage is None else usage.ru_maxrss,'stdoutBytes':len(parts[0]),'stderrBytes':len(parts[1]),'primary':primary,'secondary':secondary}
    return bytes(parts[0]),bytes(parts[1]),metrics

def source_admission(request_raw,event_raw,mode):
    run=os.environ.get('GITHUB_RUN_ID','');need(run.isdecimal() and 0<int(run)<10**15,'admission run')
    output=Path(os.environ['RUNNER_TEMP'])/('read16-admission-'+run+'-1')
    prefix='source-admission' if mode=='--admit' else 'capture-source-admission'
    seen={};failure=None;secondary=[];source=None;stream=None;written=0
    try:
        stream=(output/(prefix+'-progress.original.jsonl')).open('xb',buffering=0)
        def emit(fact):
            nonlocal written
            body=canonical(fact);written+=len(body);need(written<=32768,'source progress cap');need(stream.write(body)==len(body),'source progress short write')
        req=admit_request(request_raw,event_raw)
        source=admit_sources(req,seen,emit)
    except BaseException as error:
        failure={'type':type(error).__name__,'reason':str(error)[:1024],'phase':seen.get('phase','request'),'lastPath':seen.get('lastPath'),'facts':getattr(error,'facts',None)}
    finally:
        if stream is not None:
            try:stream.close()
            except BaseException as error:
                fact={'type':type(error).__name__,'reason':str(error)[:256],'phase':'progress-close'}
                if failure is None:failure={**fact,'lastPath':seen.get('lastPath'),'facts':None}
                else:secondary.append(fact)
    receipt={'schema':'bw.read16-source-admission.v1','mode':mode,'requestSha256':sha(request_raw),'eventSha256':sha(event_raw),'complete':failure is None,'observations':seen,'source':source,'firstFailure':failure,'secondary':secondary,'actualApproved':False,'guestApproved':False,'performanceApproved':False}
    store(output/(prefix+'.original.json'),receipt,65536)
    need(failure is None,'source admission refused; bounded original retained')
    if mode=='--admit':print(canonical({'schema':'bw.read16-source-admission-report.v1','complete':True,'sourceSha256':sha(canonical(source)),'actualApproved':False,'guestApproved':False}).decode(),end='')
    return req,source

def admission_wrapper(request_path,event_path):
    # This module was authenticated by the inline bootstrap before this helper.
    request_raw=read_file(request_path,65536);event_raw=read_file(event_path,262144)
    run=os.environ.get('GITHUB_RUN_ID','');need(run.isdecimal() and 0<int(run)<10**15,'wrapper run')
    output=Path(os.environ['RUNNER_TEMP'])/('read16-admission-'+run+'-1')
    stdout,stderr,usage=capture((sys.executable,'-I','-B',str(NAMESPACE/'run.py'),'--admit',str(request_path),str(event_path)),dict(os.environ),None,seconds=120,stream_caps=(8192,8192),output_paths=(output/'admit-stdout.original',output/'admit-stderr.original'))
    complete=False;receipt_sha=None;post=None
    if usage['exitCode']==0 and usage['reaped'] and not usage['timedOut'] and usage['primary'] is None and not usage['secondary'] and not stderr:
        try:
            raw=read_file(output/'source-admission.original.json',65536);receipt=parse(raw);receipt_sha=sha(raw)
            need(receipt['schema']=='bw.read16-source-admission.v1' and receipt['complete'] is True and receipt['firstFailure'] is None and receipt['requestSha256']==sha(request_raw) and receipt['eventSha256']==sha(event_raw),'admission receipt join')
            report=parse(stdout);need(report=={'schema':'bw.read16-source-admission-report.v1','complete':True,'sourceSha256':sha(canonical(receipt['source'])),'actualApproved':False,'guestApproved':False},'bounded admission stdout')
            complete=True
        except BaseException as error:post={'type':type(error).__name__,'reason':str(error)[:1024]}
    store(output/'admit-command.original.json',{'schema':'bw.read16-admit-command.v1','requestSha256':sha(request_raw),'eventSha256':sha(event_raw),'stdoutBase64':b64(stdout),'stderrBase64':b64(stderr),'usage':usage,'sourceReceiptSha256':receipt_sha,'postFailure':post,'complete':complete,'actualApproved':False,'guestApproved':False},65536)
    need(complete,'bounded source admission command refused; originals retained')

def finish_record(record,observe):
    """Capture error precedes every later observation/cleanup diagnostic."""
    u=record['usage'];primary=u['primary'];secondary=list(u['secondary'])
    if primary is None and secondary:primary={'type':secondary[0]['type'],'reason':secondary[0]['reason']}
    if primary is None and not(u['exitCode']==0 and u['reaped'] and not u['timedOut'] and record['stderrBase64']==''):
        primary={'type':'Refusal','reason':'child exit/reap/timeout/stderr refused'}
    failure=None if primary is None else {'phase':'capture','type':primary['type'],'reason':primary['reason'],'secondary':secondary}
    try:observe()
    except BaseException as error:
        fact={'phase':'post-observation','type':type(error).__name__,'reason':str(error)[:1024]}
        if failure is None:failure={**fact,'secondary':[]}
        else:failure['secondary'].append(fact)
    return failure

def cleanup():
    need(os.environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board' and os.environ.get('GITHUB_ACTOR')=='CrispStrobe' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','owned outside cleanup')
    run=os.environ.get('GITHUB_RUN_ID','');need(run.isdecimal() and 0<int(run)<10**15,'cleanup run')
    unit='bw-read16-paired-'+run+'-1.service'
    output=Path(os.environ['RUNNER_TEMP'])/('read16-paired-'+run+'-1')
    output.mkdir(mode=0o700,exist_ok=True)
    env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
    before_out,before_err,before=capture(('/usr/bin/systemctl','show',unit,'--property=LoadState','--property=ActiveState','--property=ControlGroup','--property=Result','--property=ExecMainPID','--property=ExecMainCode','--property=ExecMainStatus'),env,None,seconds=10,stream_caps=(4096,2048))
    stop_out,stop_err,stop=capture(('/usr/bin/sudo','-n','/usr/bin/systemctl','stop',unit),env,None,seconds=10,stream_caps=(4096,2048))
    show_out,show_err,show=capture(('/usr/bin/systemctl','show',unit,'--property=LoadState','--property=ActiveState','--property=ControlGroup','--property=ExecMainPID'),env,None,seconds=10,stream_caps=(4096,2048))
    directory=Path('/sys/fs/cgroup/system.slice')/unit
    exists=directory.exists();remaining=[];nested=[];errors=[]
    if exists:
        try:
            remaining=text(directory/'cgroup.procs').splitlines()
            nested=sorted(p.name for p in directory.iterdir() if p.is_dir())[:65]
        except BaseException as error:errors.append({'type':type(error).__name__,'reason':str(error)[:512]})
    for role,usage in [('before-show',before),('stop',stop),('show',show)]:
        if usage['primary'] or usage['secondary'] or not usage['reaped'] or usage['timedOut']:errors.append({'phase':role,'usage':usage})
    value={'schema':'bw.read16-paired-cleanup.v1','runId':run,'attempt':1,'unit':unit,'beforeShowExit':before['exitCode'],'beforeShowStdoutBase64':b64(before_out),'beforeShowStderrBase64':b64(before_err),'stopExit':stop['exitCode'],'stopStdoutBase64':b64(stop_out),'stopStderrBase64':b64(stop_err),'showExit':show['exitCode'],'showStdoutBase64':b64(show_out),'showStderrBase64':b64(show_err),'cgroupAbsent':not exists,'remainingPids':remaining,'nestedGroups':nested,'errors':errors}
    store(output/'cleanup.original.json',value,65536)
    need(not exists and not remaining and not nested and not errors,'outside cleanup incomplete')

def main():
    need(ACTUAL_ENABLED,'actual paired capture disabled')
    if len(sys.argv)==2 and sys.argv[1]=='--cleanup':cleanup();return
    need(len(sys.argv)==4 and sys.argv[1] in ('--admit','--capture','--admission-wrapper'),'fixed hosted command')
    if sys.argv[1]=='--admission-wrapper':admission_wrapper(Path(sys.argv[2]),Path(sys.argv[3]));return
    request_raw=read_file(Path(sys.argv[2]),65536);event_raw=read_file(Path(sys.argv[3]),262144)
    req,source=source_admission(request_raw,event_raw,sys.argv[1])
    if sys.argv[1]=='--admit':return
    run=os.environ['GITHUB_RUN_ID'];unit='bw-read16-paired-'+run+'-1.service';parent=os.getpid()
    output=Path(os.environ['RUNNER_TEMP'])/('read16-paired-'+run+'-1');output.mkdir(mode=0o700)
    packet={'schema':'bw.read16-paired-original.v1','requestBase64':b64(request_raw),'eventBase64':b64(event_raw),'source':source,'runtime':None,'context':{'workflowHead':os.environ['GITHUB_WORKFLOW_SHA'],'workflowRef':os.environ['GITHUB_WORKFLOW_REF'],'actor':'CrispStrobe','repository':req['repository'],'head':req['head'],'pullRequest':req['pullRequest'],'sourceBranch':req['sourceBranch'],'eventName':'pull_request','eventSha256':sha(event_raw),'requestSha256':sha(request_raw),'runId':run,'attempt':1,'job':'paired','parentPid':parent,'unit':unit},'children':[],'failure':None}
    store(output/'request.original.json',parse(request_raw),65536)
    with (output/'event.original.json').open('xb') as f:f.write(event_raw)
    store(output/'source.original.json',source,65536);store(output/'context.original.json',packet['context'],8192)
    try:
        need(sha(read_file(NODE,134217728))==NODE_SHA and NODE.stat().st_size==124827920,'exact Node bytes')
        packet['runtime']={'nodeVersion':'22.23.3','nodeBytes':124827920,'nodeSha256':NODE_SHA,'nodePath':str(NODE),'measurement':'whole child including preexec; wait4 user+system and matched monotonic wall'}
        store(output/'runtime.original.json',packet['runtime'],8192)
        affinity=None
        for sequence,phase,pair,arm in SCHEDULE:
            before=position(unit,parent,affinity=affinity)
            if affinity is None:affinity=before['affinity']
            source_before=sha(canonical(admit_sources(req)));runtime_before=sha(read_file(NODE,134217728));need(runtime_before==NODE_SHA,'Node before')
            preexec=output/('%02d-preexec.original.json'%sequence)
            env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','HOME':str(output),'NODE_OPTIONS':'','NODE_PATH':'','LD_PRELOAD':'','LD_AUDIT':'','NODE_V8_COVERAGE':''}
            stdout,stderr,usage=capture((str(NODE),'--max-old-space-size=512',str(NAMESPACE/'fixture.mjs'),arm),env,lambda:prepare_child(unit,parent,before,preexec),output_paths=(output/('%02d-stdout.original'%sequence),output/('%02d-stderr.original'%sequence)))
            record={'sequence':sequence,'phase':phase,'pair':pair,'arm':arm,'stdoutBase64':b64(stdout),'stderrBase64':b64(stderr),'usage':usage,'resource':None};packet['children'].append(record)
            packet['failure']=finish_record(record,lambda:None)
            # Store partial capture before any fallible post-child observation.
            store(output/('capture-%02d.original.json'%sequence),record)
            def observe():
                r={'before':before,'preexec':None,'after':None,'sourceBeforeSha256':source_before,'sourceAfterSha256':None,'runtimeBeforeSha256':runtime_before,'runtimeAfterSha256':None}
                record['resource']=r
                r['after']=position(unit,parent,affinity=affinity)
                r['preexec']=parse(read_file(preexec,8192))
                r['sourceAfterSha256']=sha(canonical(admit_sources(req)));r['runtimeAfterSha256']=sha(read_file(NODE,134217728))
                need(source_before==r['sourceAfterSha256']==sha(canonical(source)) and r['runtimeAfterSha256']==NODE_SHA,'after source/runtime')
                observed=parse(stdout);semantic=observed['semantic']
                need(observed['arm']==arm and observed['sourceFiles']==source['arms'][arm] and semantic['steps']==semantic['cpuCycles']==1000000 and semantic['charges']==6000000 and semantic['state']=={'ax':65534,'bx':65535,'ip':0,'word':65535},'completed authored AT child')
            packet['failure']=finish_record(record,observe)
            store(output/('completed-%02d.original.json'%sequence),record)
            if packet['failure'] is not None:break
        if packet['failure'] is None:
            import statistics
            pairs={}
            for r in packet['children']:
                if r['phase']=='measured':pairs.setdefault(r['pair'],{})[r['arm']]=r['usage']
            ratios=[pairs[i]['A']['cpuSeconds']/pairs[i]['B']['cpuSeconds'] for i in range(7)];walls=[pairs[i]['B']['wallSeconds']/pairs[i]['A']['wallSeconds'] for i in range(7)]
            if not(statistics.median(ratios)>=1.03 and min(ratios)>1 and statistics.median(walls)<=1.02):packet['failure']={'phase':'gate','reason':'strict paired performance gate failed'}
    except BaseException as error:
        if packet['failure'] is None:packet['failure']={'phase':'capture','type':type(error).__name__,'reason':str(error)[:2048]}
        else:packet['failure'].setdefault('secondary',[]).append({'phase':'post-capture','type':type(error).__name__,'reason':str(error)[:1024]})
    store(output/'paired.original.json',packet)
    need(packet['failure'] is None,'paired attempt failed; original retained')
if __name__=='__main__':main()
