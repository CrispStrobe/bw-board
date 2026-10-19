"""One gated fixed materialization; no toolchain executable is launched."""
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import types

ADAPTER_SHA='89a4f4999313e2522040507bcc4fea60d415c22d5b4da7696dba23a0619d1288'
OUT='fixed-archive-materialization'
MAX_PACKET=196608
LABEL='x86-fixed-archive-gnu-longname'
ROLES=('scripts/i80386-cwsdpmi-compile-root-routes/root-routes.py', 'scripts/i80386-cwsdpmi-compile-root-routes/root-routes-control.py', 'scripts/i80386-cwsdpmi-compile-root-routes/README.md', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner.py', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner-control.py', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/README.md', 'scripts/i80386-cwsdpmi-workspace-creator/workspace.py', 'scripts/i80386-cwsdpmi-workspace-creator/workspace-control.py', 'scripts/i80386-cwsdpmi-workspace-creator/README.md', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/README.md', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/owner-control.py', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/owner.py', 'scripts/i80386-cwsdpmi-retained-tool-observer/README.md', 'scripts/i80386-cwsdpmi-retained-tool-observer/observer-control.py', 'scripts/i80386-cwsdpmi-retained-tool-observer/observer.py', 'scripts/i80386-cwsdpmi-retained-tool-materializer/materialize.py', 'scripts/i80386-cwsdpmi-retained-tool-materializer/materialize-control.py', 'scripts/i80386-cwsdpmi-retained-tool-materializer/README.md', 'scripts/i80386-cwsdpmi-fixed-alias-materializer/materialize.py', 'scripts/i80386-cwsdpmi-fixed-alias-materializer/materialize-control.py', 'scripts/i80386-cwsdpmi-fixed-alias-materializer/README.md', 'scripts/i80386-cwsdpmi-fixed-archive-materialization/run.py', 'scripts/i80386-cwsdpmi-fixed-archive-materialization/run-control.py', 'scripts/i80386-cwsdpmi-fixed-archive-materialization/README.md', 'scripts/i80386-cwsdpmi-compile-tool-boundary/compile.py', 'scripts/i80386-fixed-archive-acquisition/acquire.py', 'scripts/i80386-fixed-archive-acquisition/acquire-control.py', 'scripts/i80386-fixed-archive-acquisition/README.md', 'scripts/i80386-fixed-archive-materialization-hosted/admit.py', 'scripts/i80386-fixed-archive-materialization-hosted/execute.py', 'scripts/i80386-fixed-archive-materialization-hosted/README.md', '.github/workflows/i80386-fixed-archive-materialization.yml', 'scripts/i80386-cwsdpmi-archive-refusal-diagnostic/materialize.py', 'scripts/i80386-cwsdpmi-archive-refusal-diagnostic/materialize-control.py', 'scripts/i80386-cwsdpmi-archive-refusal-diagnostic/README.md', 'scripts/i80386-cwsdpmi-gnu-longname-materializer/materialize.py', 'scripts/i80386-cwsdpmi-gnu-longname-materializer/materialize-control.py', 'scripts/i80386-cwsdpmi-gnu-longname-materializer/README.md')
class Refusal(ValueError):pass

def need(ok):
    if not ok:raise Refusal('hosted-execution-refused')

def pairs(rows):
    result={}
    for key,value in rows:
        need(key not in result);result[key]=value
    return result

def read(path,cap):
    prior=os.lstat(path);need(stat.S_ISREG(prior.st_mode) and prior.st_nlink==1 and 0<=prior.st_size<=cap)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK)
    try:
        identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
        opened=os.fstat(fd);need(identity(prior)==identity(opened));raw=bytearray()
        while len(raw)<=cap:
            block=os.read(fd,min(65536,cap+1-len(raw)))
            if not block:break
            raw.extend(block)
        need(len(raw)==opened.st_size and len(raw)<=cap and identity(opened)==identity(os.fstat(fd))==identity(os.lstat(path)))
        return bytes(raw)
    finally:os.close(fd)

def load():
    path=Path(__file__).parent.parent/'i80386-fixed-archive-acquisition/acquire.py';raw=read(path,65536)
    need(hashlib.sha256(raw).hexdigest()==ADAPTER_SHA)
    module=types.ModuleType('private_hosted_fixed_acquisition');module.__file__=str(path)
    exec(compile(raw,'<fixed-acquisition>','exec'),module.__dict__);return module

def context():
    source=json.loads(read(OUT+'/source-before.json',32768),object_pairs_hook=pairs)
    event=json.loads(read(OUT+'/event.json',4096),object_pairs_hook=pairs)
    need(type(source)is dict and type(event)is dict and source.get('event')==event)
    need(set(source)=={'schema','head','base','fixedRoles','roles','event','mode','qualification'})
    need(set(event)=={'schema','action','pr','head','headRepository','baseRepository','repository','run','attempt','label'})
    need(os.environ.get('GITHUB_EVENT_NAME')=='pull_request' and os.environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board' and os.environ.get('PR_HEAD_REPOSITORY')=='CrispStrobe/bw-board')
    need(source.get('schema')=='bw.fixed-archive-hosted-source.v3' and source.get('mode')=='actual-before')
    need(source.get('fixedRoles')==34 and type(source.get('fixedRoles'))is int and type(source.get('roles'))is dict and len(source['roles'])==38)
    need(set(source['roles'])==set(ROLES))
    need(all(type(key)is str and type(value)is str and len(value)==64 and all(c in '0123456789abcdef' for c in value) for key,value in source['roles'].items()))
    need(source['roles']['scripts/i80386-fixed-archive-acquisition/acquire.py']==ADAPTER_SHA)
    need(type(event.get('pr'))is int and 0<event['pr']<2**53)
    need(event.get('schema')=='bw.fixed-archive-event.v1' and event.get('action')=='labeled' and event.get('label')==LABEL)
    need(event.get('head')==os.environ.get('EXPECTED_HEAD')==source.get('head'))
    need(event.get('attempt')==1 and type(event.get('attempt'))is int and os.environ.get('GITHUB_RUN_ATTEMPT')=='1')
    need(type(event.get('run'))is int and str(event['run'])==os.environ.get('GITHUB_RUN_ID'))
    need(event.get('repository')==event.get('headRepository')==event.get('baseRepository')=='CrispStrobe/bw-board')
    return event,source['roles']

def write(row):
    raw=(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii');need(len(raw)<=MAX_PACKET)
    fd=os.open(OUT+'/acquisition.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
    try:
        count=0
        while count<len(raw):
            n=os.write(fd,raw[count:]);need(0<n<=len(raw)-count);count+=n
    finally:os.close(fd)

def completed(report,adapter):
    need(type(report)is dict and type(report.get('acquisition'))is dict and report['acquisition'].get('phase')=='complete' and report['acquisition'].get('firstFailure') is None and report['acquisition'].get('secondary') is None and report['acquisition'].get('cleanupQualified') is True and report['acquisition'].get('reentered') is False)
    inputs=report['acquisition'].get('inputs');need(type(inputs)is list and len(inputs)==4)
    for facts,pin in zip(inputs,adapter.INPUTS):
        need(type(facts)is dict and facts.get('role')==pin[0] and type(facts.get('bytesRead'))is int and facts['bytesRead']==pin[2] and facts.get('sha256')==pin[3] and facts.get('authenticated') is True)
    need(type(report.get('materialization'))is dict and report['materialization'].get('wrapper',{}).get('phase')=='complete')

def run():
    event=None;roles=None;adapter=None;owner=None;temporary=None;report=None
    first=None;secondary=None;close_attempted=False;temp_attempted=False;temp_refused=False;complete=False
    try:
        event,roles=context();adapter=load();temporary=tempfile.TemporaryDirectory(prefix='fixed-archive-materialization-')
        owner=adapter.FixedArchiveAcquisition(temporary.name)
        owner.acquire();report=owner.report()
        completed(report,adapter)
        complete=True
    except BaseException:
        first='hosted-execution-refused'
        if owner is not None:
            try:
                status=owner.status();code=status.get('firstFailure') if type(status)is dict else None
                if type(code)is str and len(code)<=32 and code in adapter.CODES:first=code
            except BaseException:secondary='status-refused'
    finally:
        if owner is not None:
            close_attempted=True
            try:owner.close()
            except BaseException:secondary=secondary or 'cleanup-refusal';complete=False
            report=None
            try:
                candidate=owner.report()
                if candidate is None:
                    report=None
                    need(not complete)
                else:
                    need(type(candidate)is dict)
                    report=candidate
                    if complete:completed(report,adapter)
            except BaseException:
                secondary=secondary or 'report-refusal';complete=False
        if temporary is not None:
            temp_attempted=True
            try:temporary.cleanup()
            except BaseException:temp_refused=True;secondary=secondary or 'cleanup-refusal';complete=False
    if secondary is not None and first is None:first=secondary
    packet={'schema':'bw.fixed-archive-hosted-acquisition.v3','event':event,'sourceRoles':roles,'adapterSha256':ADAPTER_SHA,'complete':complete,'firstFailure':first,'secondary':secondary,'adapterCloseAttempted':close_attempted,'temporaryCleanupAttempted':temp_attempted,'temporaryCleanupRefused':temp_refused,'acquisition':report,'boundary':'FINITE_REPORTED_NINE_ROLE_OBSERVATIONS_ONLY','actualInputLeaseQualified':False,'sourceOwnedQualified':False,'namespaceModeQualified':False,'fullToolchainReady':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
    try:write(packet)
    except BaseException:
        print('hosted-evidence-refused');return 1
    print('MATERIALIZATION_REPORTED_OBSERVATIONS_ONLY' if complete else 'MATERIALIZATION_REFUSED_UNQUALIFIED')
    return 0 if complete else 1

if __name__=='__main__':
    try:code=run()
    except BaseException:
        print('hosted-execution-refused');code=1
    raise SystemExit(code)
