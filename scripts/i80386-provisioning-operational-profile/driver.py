"""Fixed smoke CLI; actual acquisition remains unarmed and never delegated."""
import hashlib,json,os,stat,subprocess,sys,types,selectors,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PROFILE='scripts/i80386-provisioning-operational-profile/'
EXTERNAL_APPROVAL_SHA256=None
class Refusal(ValueError):pass
def actual():raise Refusal('actual-unsealed')
def _read_bound(path,cap):
    fd=None;primary=None;body=None
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        if type(fd)is not int or fd<0:raise ValueError('bootstrap-file-handle')
        first=os.fstat(fd)
        if not stat.S_ISREG(first.st_mode)or first.st_nlink!=1 or first.st_size>cap:raise ValueError('bootstrap-source-shape')
        chunks=[];count=0
        while True:
            part=os.read(fd,min(65536,cap+1-count));count+=len(part)
            if count>cap:raise ValueError('bootstrap-source-cap')
            if not part:break
            chunks.append(part)
        end=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        if count!=first.st_size or not stat.S_ISREG(named.st_mode)or end.st_nlink!=1 or named.st_nlink!=1 or(first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns)!=(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)or(first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns)!=(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns):raise ValueError('bootstrap-source-changed')
        body=b''.join(chunks)
    except BaseException as error:primary=error
    finally:
        if type(fd)is int and fd>=0:
            try:os.close(fd)
            except BaseException as error:
                if primary is None:primary=error
    if primary is not None:raise primary
    return body

def _preload(raw,seal):
    if type(raw)is not bytes or len(raw)>65536 or type(seal)is not str or len(seal)!=64 or hashlib.sha256(raw).hexdigest()!=seal:raise ValueError('approval-unsealed')
    def pairs(items):
        out={}
        for k,v in items:
            if k in out:raise ValueError('duplicate-approval')
            out[k]=v
        return out
    def bad(_):raise ValueError('approval-number')
    approved=json.loads(raw.decode(),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
    if type(approved)is not dict or set(approved)!={'schema','repository','head','mode','roles','graphSha256'}or approved['schema']!='bw.provisioning-operational-approval.v1'or approved['mode']!='limits-ack-approval-refusal':raise ValueError('approval-shape')
    if type(approved['roles'])is not dict or not 1<=len(approved['roles'])<=100:raise ValueError('approval-roles')
    bodies={}
    for relative,row in approved['roles'].items():
        if type(relative)is not str or relative.startswith('/')or len(relative)>240 or any(p in ('','.','..')for p in relative.split('/')):raise ValueError('approval-path')
        if type(row)is not dict or set(row)!={'bytes','sha256'}or type(row['bytes'])is not int or not 0<row['bytes']<=524288 or type(row['sha256'])is not str or len(row['sha256'])!=64:raise ValueError('approval-row')
        body=_read_bound(ROOT/relative,524288)
        if len(body)!=row['bytes']or hashlib.sha256(body).hexdigest()!=row['sha256']:raise ValueError('approval-source-changed')
        bodies[relative]=body
    graph_relative='scripts/i80386-provisioning-operational-profile/fixed-graph.json'
    if graph_relative not in bodies or hashlib.sha256(bodies[graph_relative]).hexdigest()!=approved['graphSha256']:raise ValueError('approval-graph')
    graph=json.loads(bodies[graph_relative],object_pairs_hook=pairs)
    if set(graph)!={'schema','roles','held'}or graph['schema']!='bw.provisioning-operational-graph.v1'or type(graph['roles'])is not list or any(type(x)is not str for x in graph['roles'])or len(set(graph['roles']))!=len(graph['roles'])or set(graph['roles'])!=set(bodies):raise ValueError('approval-closure')
    for relative,row in graph['held'].items():
        if relative not in approved['roles']or approved['roles'][relative]!=row:raise ValueError('held-changed')
    path='scripts/i80386-provisioning-operational-profile/collect.py'
    if path not in bodies:raise ValueError('collect-unapproved')
    module=types.ModuleType('approved_collect');module.__file__=str(ROOT/path)
    exec(compile(bodies[path],'<approved-collector>','exec'),module.__dict__)
    return module

def _load(raw,seal):return _preload(raw,seal)

def main():
    # External reviewed launcher sets the seal on a fresh module. The default
    # command refuses before source/OS/process work; no self-issued approval.
    seal=EXTERNAL_APPROVAL_SHA256
    if seal is None:raise Refusal('approval-unsealed')
    output=Path(os.environ['RUNNER_TEMP'])/'bw-provisioning-operational'
    raw=_read_bound(output/'approval.json',65536);c=_load(raw,seal);approval,bodies=c.admit(ROOT,raw,seal)
    c.need(os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board'and os.environ.get('GITHUB_RUN_ATTEMPT')=='1'and os.environ.get('BW_HEAD_SHA')==approval['head'] and os.environ.get('GITHUB_EVENT_NAME')=='pull_request' and os.environ.get('BW_HEAD_REPOSITORY')=='CrispStrobe/bw-board','official-context-eligibility')
    c.need(all(v==0 and type(v)is int for v in (os.getuid(),os.geteuid(),os.getgid(),os.getegid())),'root-driver')
    c.need(stat.S_ISDIR(os.lstat(ROOT).st_mode)and stat.S_ISDIR(os.lstat(ROOT/'.git').st_mode)and os.lstat(ROOT).st_uid==0 and os.lstat(ROOT/'.git').st_uid==0,'root-owned-checkout')
    c.need(not (ROOT/'.git/shallow').exists()and not (ROOT/'.git/objects/info/alternates').exists(),'git-history-shape')
    # External collector/driver is outside the observer timer. This does not
    # impose a hard deadline on this bootstrap or on an unreviewed host.
    tools={}
    for tool in ('/usr/bin/python3','/usr/bin/timeout','/usr/bin/unshare','/usr/bin/git'):
        body=c.regular(Path(tool).resolve(strict=True),16777216);tools[tool]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
    env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1','RUNNER_TEMP':os.environ['RUNNER_TEMP'],'BW_APPROVAL_SHA256':seal}
    for k in ('GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_RUN_ATTEMPT','GITHUB_RUN_ID','GITHUB_SHA','BW_HEAD_SHA','GITHUB_EVENT_NAME','BW_HEAD_REPOSITORY'):env[k]=os.environ[k]
    argv=('/usr/bin/timeout','--signal=KILL','488s','/usr/bin/python3','-I','-B',str(ROOT/PROFILE/'observer-main.py'))
    process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,env=env,close_fds=True)
    # Bound original outer diagnostics separately; never use communicate() with
    # an unbounded report pipe. Structured reports use the owned directory.
    prefix=bytearray();overflow=False;outer_error=None;selector=None
    cleanup_refused=0
    try:
        deadline=time.monotonic()+490.0
        os.set_blocking(process.stderr.fileno(),False)
        selector=selectors.DefaultSelector();selector.register(process.stderr,selectors.EVENT_READ)
        eof=False
        while not eof:
            left=deadline-time.monotonic()
            if left<=0:raise Refusal('outer-capture-timeout')
            for _,_ in selector.select(min(left,0.1)):
                body=os.read(process.stderr.fileno(),min(65536,65536-len(prefix)+1))
                if not body:eof=True;break
                remaining=65536-len(prefix);prefix.extend(body[:remaining])
                if len(body)>remaining:overflow=True;raise Refusal('outer-diagnostic-cap')
        remaining=deadline-time.monotonic()
        if remaining<=0:raise Refusal('outer-wait-timeout')
        code=process.wait(timeout=remaining)
    except BaseException as error:
        outer_error=error;code=None
        # Only the returned owned timeout process, never discovered PIDs.
        try:process.kill()
        except BaseException:pass
        try:process.wait(timeout=2.0)
        except BaseException:pass
    finally:
        if selector is not None:
            try:selector.close()
            except BaseException as error:
                cleanup_refused+=1
                if outer_error is None:outer_error=error
        try:process.stderr.close()
        except BaseException as error:
            cleanup_refused+=1
            if outer_error is None:outer_error=error
    fd=None;primary=outer_error;result=None
    try:
        fd=os.open(output,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);store=c.Store(fd)
        store.put('observer-diagnostic.bin',bytes(prefix))
        reader=c.module(ROOT,bodies,PROFILE+'report-reader.py')
        members={}
        for name,cap in reader.CAPS.items():
            if name in ('capture-index.json','official-event.json'):continue
            try:members[name]=c.regular(output/name,cap)
            except FileNotFoundError:pass
        members['observer-diagnostic.bin']=c.regular(output/'observer-diagnostic.bin',65536)
        store.json('official-event.json',{'schema':'bw.provisioning-operational-event.v1','event':'pull_request','action':os.environ['BW_PR_ACTION'],'repository':'CrispStrobe/bw-board','headRepository':'CrispStrobe/bw-board','pr':int(os.environ['BW_PR_NUMBER']),'head':approval['head'],'base':os.environ['BW_BASE_SHA'],'run':int(os.environ['GITHUB_RUN_ID']),'attempt':1,'workflow':'.github/workflows/i80386-provisioning-operational-profile.yml','job':'operational-smoke','mode':'limits-ack-approval-refusal','authenticatedContextQualified':False})
        # Parent is the sole final index owner. Retain child journal independently.
        child=None
        try:child=c.decoded(c.regular(output/'child-capture.json',16384),16384)
        except FileNotFoundError:pass
        roles={name:{'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}for name,body in members.items()}
        event=c.regular(output/'official-event.json',8192);roles['official-event.json']={'bytes':len(event),'sha256':hashlib.sha256(event).hexdigest()}
        store.json('capture-index.json',{'schema':'bw.provisioning-operational-capture.v1','mode':'limits-ack-approval-refusal','roles':roles,'childCapture':child,'parentCapture':store.records,'observerExit':code,'outerDiagnosticBytes':len(prefix),'outerDiagnosticOverflow':overflow,'outerCaptureError':None if outer_error is None else type(outer_error).__name__,'outerCleanupRefused':cleanup_refused,'reviewDigest':seal,'hostTools':tools,'observationAbsentReason':'child-before-group-absent','finiteFixturePass':False,'materializationComplete':False,'actualAcquisitionQualified':False,'compilerQualified':False})
        members['official-event.json']=event;members['capture-index.json']=c.regular(output/'capture-index.json',16384)
        result=reader.audit(members,code if type(code)is int else -255,overflow or outer_error is not None)
        c.package(output,members)
        # Result is a finite smoke result, never acquisition or full-tree success.
        c.need(result['finiteFixturePass'],'smoke-refused')
    except BaseException as error:
        if primary is None:primary=error
    finally:
        if type(fd)is int and fd>=0:
            try:os.close(fd)
            except BaseException as error:
                if primary is None:primary=error
    if primary is not None:raise primary
    sys.stdout.write(c.encoded(result).decode())
    return 0
if __name__=='__main__':sys.exit(main())
