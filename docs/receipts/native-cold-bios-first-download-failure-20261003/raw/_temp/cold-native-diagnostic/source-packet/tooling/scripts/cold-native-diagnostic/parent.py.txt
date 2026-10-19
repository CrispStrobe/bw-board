"""One closed hosted trace-OFF diagnostic, disabled unless explicitly armed.
No retries or second guest. Restore and native child evidence remain distinct.
"""
import sys
sys.dont_write_bytecode=True
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import signal
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cold-native-restore'))
from archive import ordinary,digest,require
from admission import driver_identity,disjoint_roles
HERE=Path(__file__).resolve().parent
W=Path('/home/runner/work/bw-board/bw-board/publication')
D=Path('/home/runner/work/bw-board/bw-board/driver')
U=Path('/home/runner/work/_temp/cold-bios-build-pristine')
T=Path('/home/runner/work/_temp/cold-bios-build-prepared')
R=Path('/home/runner/work/_temp/cold-bios-build-evidence')
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')

def validate_contract(c):
    require(c['schema']=='bw.cold-native.hosted-diagnostic-contract.v1','contract schema')
    require(c['artifactId']==11265997873 and c['runId']==37102085724,'original official artifact')
    require(c['compiledRevision']=='a6fae61a549d595c88a324f50589d92497040c07' and c['bochsRevision']=='0e45b736ef9792eb9b752b0a35db49eaf2faea47','fixed source roles')
    require(c['zipBytes']==7396223 and c['zipSha256']=='315587c2a738cb201f6ad09f2f82c19f82a46a25f73051062234fdeeffc2eda9','official digest')
    require(c['nativeTrace'] is False and c['guestEnabledByDefault'] is False,'single trace-OFF only')
    require(type(c['driverRevision']) is str and len(c['driverRevision'])==40,'frozen driver required')
    for n in ('driverSourceIdentitySha256','driverAuthSha256'):
        require(type(c[n]) is str and len(c[n])==64 and all(x in '0123456789abcdef' for x in c[n]),'driver pin required')
    require(type(c['driverFiles']) is dict and c['driverAuth'] in c['driverFiles'] and c['runner'] in c['driverFiles'],'complete driver map required')
    require(c['driverFiles'][c['driverAuth']]['sha256']==c['driverAuthSha256'],'driver auth map pin')

def descendants(pid):
    pairs={}
    for p in Path('/proc').iterdir():
        if p.name.isdecimal():
            try:
                raw=(p/'stat').read_text(); tail=raw[raw.rfind(')')+2:].split();pairs[int(p.name)]=int(tail[1])
            except (OSError,ValueError,IndexError):pass
    result={pid}
    while True:
        more={p for p,q in pairs.items() if q in result};new=result|more
        if new==result:return sorted(result,reverse=True)
        result=new

def kill_tree(pid):
    stopped=set();parents={pid}
    try:os.killpg(pid,signal.SIGSTOP)
    except ProcessLookupError:pass
    for _ in range(5):
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit():continue
            try:
                raw=(entry/'stat').read_text();fields=raw[raw.rfind(')')+2:].split();ppid=int(fields[1]);number=int(entry.name)
                if number==pid or ppid in parents:
                    parents.add(number)
                    if number not in stopped:os.kill(number,signal.SIGSTOP);stopped.add(number)
            except (FileNotFoundError,ProcessLookupError,PermissionError):pass
    for number in stopped:
        try:os.kill(number,signal.SIGKILL)
        except ProcessLookupError:pass
    try:os.killpg(pid,signal.SIGKILL)
    except ProcessLookupError:pass
    return sorted(stopped)

ACTIVE=set()
def interrupted(signum,frame):
    for pid in list(ACTIVE):kill_tree(pid)
    raise SystemExit(128+signum)
for signum in (signal.SIGTERM,signal.SIGINT):signal.signal(signum,interrupted)

def bounded(command,cwd,out,label,cpu=60,wall=120,file_bytes=16<<20):
    env=os.environ.copy()
    for k in HOOKS:env[k]=''
    env.pop('GH_TOKEN',None)
    invocation={'command':command,'cwd':str(cwd),'cpuSeconds':cpu,'wallSeconds':wall,'heapMiB':128 if '--max-old-space-size=128' in command else None,'fileBytes':file_bytes,'coreBytes':0,'niceIncrement':10,'blankHooks':{k:'' for k in HOOKS}}
    (out/(label+'.invocation.json')).write_text(json.dumps(invocation,indent=2)+'\n')
    def limits():
        os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(cpu,cpu));resource.setrlimit(resource.RLIMIT_FSIZE,(file_bytes,file_bytes));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    timeout=False;start=time.monotonic();terminated=[];interrupt=None
    with (out/(label+'.stdout')).open('xb') as so,(out/(label+'.stderr')).open('xb') as se:
        proc=subprocess.Popen(command,cwd=cwd,env=env,preexec_fn=limits,start_new_session=True,stdout=so,stderr=se)
        ACTIVE.add(proc.pid)
        try:proc.wait(timeout=wall)
        except subprocess.TimeoutExpired:timeout=True;terminated=kill_tree(proc.pid);proc.wait()
        except BaseException as error:interrupt=error;terminated=kill_tree(proc.pid);proc.wait()
        finally:ACTIVE.discard(proc.pid)
    result={'returncode':proc.returncode,'timedOut':timeout,'wallSeconds':time.monotonic()-start,'terminatedPids':terminated,'interrupted':str(interrupt) if interrupt else None}
    (out/(label+'.exit.json')).write_text(json.dumps(result,indent=2)+'\n')
    if interrupt:raise interrupt
    return result

def git(root,*args):return subprocess.run(['git','-C',str(root),*args],check=True,capture_output=True,timeout=15).stdout

def source_map(root,files):
    return {n:digest(ordinary(root/n)) for n in files}

def snapshot(c,node):
    f=json.loads(ordinary(ROOT/'scripts/cold-native-restore/frozen-members.json'))
    result={'toolingHead':git(ROOT,'rev-parse','HEAD').decode().strip(),'toolingStatus':git(ROOT,'status','--porcelain').decode(),'compiledHead':git(W,'rev-parse','HEAD').decode().strip(),'compiledStatus':git(W,'status','--porcelain').decode(),'compiledFiles':source_map(W,f),'driverHead':git(D,'rev-parse','HEAD').decode().strip(),'driverStatus':git(D,'status','--porcelain').decode(),'driverFiles':source_map(D,c['driverFiles']),'nodeSha256':digest(ordinary(node))}
    tools={}
    for directory in ('scripts/cold-native-diagnostic','scripts/cold-native-restore'):
        for p in (ROOT/directory).rglob('*'):
            if p.is_file():tools[str(p.relative_to(ROOT))]=digest(ordinary(p))
    wf=ROOT/'.github/workflows/i80386-cold-native-diagnostic.yml';tools[str(wf.relative_to(ROOT))]=digest(ordinary(wf));result['toolingFiles']=tools
    return result

def immutable_inputs(out):
    paths=[out/'official-artifact.zip',out/'official-artifact-metadata.json',out/'restore-binding.json']
    paths += [p for p in (out/'source-packet').rglob('*') if p.is_file()]
    return {str(p):digest(ordinary(p)) for p in paths}

def partial_inventory(out):
    result={}
    for root in (T,R,out/'materialization'):
        if root.exists():
            for p in root.rglob('*'):
                if p.is_file() and '.git' not in p.relative_to(root).parts:
                    try:result[str(p)]={'bytes':p.stat().st_size,'sha256':digest(ordinary(p))}
                    except BaseException as error:result[str(p)]={'unavailable':str(error)}
    return result

def artifact_snapshot(out):
    paths=[p for p in (out/'source-packet').rglob('*') if p.is_file()]
    paths += [out/'official-artifact.zip',out/'official-artifact-metadata.json',out/'restore-binding.json',out/'input.json',out/'guest-source.bochsrc']
    paths += [p for p in (out/'materialization').rglob('*') if p.is_file()]
    paths += [p for p in R.rglob('*') if p.is_file()]
    for n in json.loads(ordinary(ROOT/'scripts/cold-native-restore/prepared-members.json')):paths.append(T/n)
    paths.append(T/'bochs/bw_direct.node')
    return {str(p):digest(ordinary(p)) for p in paths}

def download(c,out):
    token=os.environ.get('GH_TOKEN');require(token,'read-only API credential required')
    url='https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/'+str(c['artifactId'])
    headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as response:
        raw=response.read(1<<20);require(len(raw)<1<<20,'metadata bound')
    (out/'official-artifact-metadata.json').write_bytes(raw);meta=json.loads(raw)
    require(meta['id']==c['artifactId'] and meta['size_in_bytes']==c['zipBytes'] and meta['workflow_run']['id']==c['runId'] and meta['workflow_run']['head_sha']==c['compiledRevision'],'official run/head/size')
    require(meta['digest']=='sha256:'+c['zipSha256'] and not meta['expired'],'official digest/expiry')
    target=out/'official-artifact.zip'
    with urllib.request.urlopen(urllib.request.Request(url+'/zip',headers=headers),timeout=60) as response,target.open('xb') as f:
        count=0
        while True:
            chunk=response.read(65536)
            if not chunk:break
            count+=len(chunk);require(count<=c['zipBytes'],'ZIP download cap');f.write(chunk)
    require(count==c['zipBytes'] and digest(ordinary(target))==c['zipSha256'],'download exact digest');return target

def main(armed):
    require(armed in ('disabled','enabled'),'explicit mode')
    if armed=='disabled':print('Guest disabled; no download, restore or native child');return
    c=json.loads(ordinary(HERE/'contract.json'));validate_contract(c)
    require(ROOT.resolve()==ROOT,'canonical tooling root')
    for k in HOOKS:require(not os.environ.get(k),'parent hook environment')
    out=Path(os.environ['BW_COLD_DIAGNOSTIC_OUTPUT']);require(out.is_absolute() and out.parent.resolve()==out.parent and out.parent.is_dir() and not os.path.lexists(out),'exclusive output');disjoint_roles([ROOT,W,D,U,T,R,out]);out.mkdir()
    node=Path(os.environ['BW_COLD_NODE']);before=None;inputs_before=None;artifact_before=None;primary_error=None;final={'status':'FAIL','scope':'ONE_TRACE_OFF_COLD_BOCHS_RESET_MODEL_DIAGNOSTIC_NO_SPEED_OR_FULL_BOOT'}
    try:
        require(digest(ordinary(node))==c['nodeSha256'],'Node hash')
        require(subprocess.run([str(node),'--version'],check=True,capture_output=True,timeout=10).stdout.strip()==c['nodeVersion'].encode(),'Node version')
        before=snapshot(c,node);(out/'before.json').write_text(json.dumps(before,indent=2)+'\n')
        require(not before['toolingStatus'] and not before['compiledStatus'] and not before['driverStatus'],'clean checkouts')
        require(before['compiledHead']==c['compiledRevision'] and before['driverHead']==c['driverRevision'],'source revisions')
        require(before['nodeSha256']==c['nodeSha256'],'Node snapshot')
        require(platform.machine()=='x86_64' and platform.libc_ver()[1]=='2.39','original Ubuntu24 glibc ABI host')
        event=json.loads(ordinary(Path(os.environ['GITHUB_EVENT_PATH'])));require(os.environ['GITHUB_EVENT_NAME']=='workflow_dispatch' and before['toolingHead']==os.environ['GITHUB_SHA'],'trusted manual tooling head')
        for n,h in before['toolingFiles'].items():require(digest(git(ROOT,'show',before['toolingHead']+':'+n))==h,'tooling Git blob')
        packet=out/'source-packet';packet.mkdir()
        for role,root,map_ in [('compiled124',W,before['compiledFiles']),('driver52',D,before['driverFiles']),('tooling',ROOT,before['toolingFiles'])]:
            for n,h in map_.items():
                data=ordinary(root/n);require(digest(data)==h,'source packet bytes');target=packet/role/n;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        zip_path=download(c,out)
        binding={'zip':str(zip_path),'compiledRoot':str(W),'upstreamRoot':str(U),'driverRoot':str(D),'driverRevision':c['driverRevision'],'driverFiles':c['driverFiles'],'driverAuth':c['driverAuth'],'driverAuthSha256':c['driverAuthSha256'],'driverIdentitySha256':c['driverSourceIdentitySha256'],'node':str(node),'output':str(out/'materialization')}
        (out/'restore-binding.json').write_text(json.dumps(binding,indent=2)+'\n')
        inputs_before=immutable_inputs(out);(out/'immutable-inputs-before-restore.json').write_text(json.dumps(inputs_before,indent=2)+'\n')
        restore=bounded(['python3','-B',str(ROOT/'scripts/cold-native-restore/restore.py'),str(out/'restore-binding.json')],ROOT,out,'restore',cpu=60,wall=120)
        require(restore['returncode']==0 and not restore['timedOut'],'restore failed; no guest launched')
        original=json.loads(ordinary(R/'static-input.json'))
        config=out/'guest-source.bochsrc'
        identity=W/'scripts/bochs-cpu3-native-cold-bios/identity.mjs'
        config_script="import {canonicalConfiguration,authenticateConfiguration} from "+json.dumps(identity.as_uri())+"; import fs from 'node:fs'; fs.writeFileSync(process.argv[1],canonicalConfiguration(process.argv[2]),{flag:'wx'}); console.log(JSON.stringify(authenticateConfiguration(process.argv[1])));"
        config_result=bounded([str(node),'--max-old-space-size=128','--input-type=module','-e',config_script,str(config),str(out/'bochs.log')],W,out,'configuration',cpu=30,wall=30)
        require(config_result['returncode']==0 and not config_result['timedOut'],'configuration source admission failed')
        inp={**original,'compiledRoot':str(W),'compiledRevision':c['compiledRevision'],'driverRevision':c['driverRevision'],'driverSourceSha256':c['driverSourceIdentitySha256'],'configuration':str(config),'output':str(out/'guest'),'nativeTrace':False}
        (out/'input.json').write_text(json.dumps(inp,indent=2)+'\n')
        artifact_before=artifact_snapshot(out);(out/'artifacts-before-native.json').write_text(json.dumps(artifact_before,indent=2)+'\n')
        final['child']=bounded([str(node),'--max-old-space-size=128',str(D/c['runner']),str(out/'input.json')],D,out,'native',cpu=60,wall=120)
        require(final['child']['returncode']==0 and not final['child']['timedOut'],'first native divergence/failure retained; no retry')
        final['status']='ONE_TRACE_OFF_DIAGNOSTIC_CHILD_EXIT_PASS_REQUIRES_INDEPENDENT_AUDIT'
    except BaseException as error:
        primary_error=error;final['error']=str(error);raise
    finally:
        try:
            after=snapshot(c,node);(out/'after.json').write_text(json.dumps(after,indent=2)+'\n');final['sourceBeforeAfterEqual']=before==after
            if before!=after:final['status']='FAIL_SOURCE_BEFORE_AFTER_MISMATCH'
        except BaseException as error:final['afterError']=str(error)
        try:
            if inputs_before is not None:
                inputs_after=immutable_inputs(out);(out/'immutable-inputs-after.json').write_text(json.dumps(inputs_after,indent=2)+'\n');final['immutableInputsBeforeAfterEqual']=inputs_before==inputs_after
                if inputs_before!=inputs_after:final['status']='FAIL_IMMUTABLE_RESTORE_INPUTS_MISMATCH'
            if artifact_before is not None:
                artifact_after=artifact_snapshot(out);(out/'artifacts-after-native.json').write_text(json.dumps(artifact_after,indent=2)+'\n');final['artifactsBeforeAfterEqual']=artifact_after==artifact_before
                if artifact_after!=artifact_before:final['status']='FAIL_ARTIFACT_BEFORE_AFTER_MISMATCH'
        except BaseException as error:final['artifactAfterError']=str(error);final['status']='FAIL_ARTIFACT_AFTER_UNAVAILABLE'
        try:(out/'partial-restored-inventory.json').write_text(json.dumps(partial_inventory(out),indent=2)+'\n')
        except BaseException as error:final['partialInventoryError']=str(error)
        final['host']={'platform':platform.platform(),'architecture':platform.machine(),'libc':platform.libc_ver(),'cpuModels':sorted(set(line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name'))),'logicalCpus':sum(line.startswith('processor') for line in Path('/proc/cpuinfo').read_text().splitlines()),'osRelease':Path('/etc/os-release').read_text(),'contextTiming':'current parent end, not throughput evidence'}
        (out/'final-status.json').write_text(json.dumps(final,indent=2)+'\n')
        if primary_error is None:
            require(final.get('sourceBeforeAfterEqual') is True,'source after failure/mismatch retained')
            if inputs_before is not None:require(final.get('immutableInputsBeforeAfterEqual') is True,'immutable input mismatch retained')
            if artifact_before is not None:require(final.get('artifactsBeforeAfterEqual') is True,'artifact after failure/mismatch retained')

if __name__=='__main__':
    require(len(sys.argv)==2,'explicit disabled/enabled argument required');main(sys.argv[1])
