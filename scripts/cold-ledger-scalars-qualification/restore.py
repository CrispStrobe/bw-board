"""Explicit restore-only CLI. No network, addon load, ldd, compiler or guest."""
import sys
sys.dont_write_bytecode = True
import json
import os
from pathlib import Path
import resource
import signal
import time
import platform
import subprocess
from admission import disjoint_roles, driver_identity, evidence_equal
from archive import ordinary, digest, require, zip_members, tar_members, exclusive_tree

HERE = Path(__file__).resolve().parent
COMPILED = '85fc1599af0ee71e32208da9d36caac86daa3b8c'
BOCHS = '0e45b736ef9792eb9b752b0a35db49eaf2faea47'
W = Path('/home/runner/work/bw-board/bw-board/publication')
T = Path('/home/runner/work/_temp/cold-memory-fusion-build-prepared')
R = Path('/home/runner/work/_temp/cold-memory-fusion-build-evidence')
HOOKS = ('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')

def git(root, *args):
    return subprocess.run(['git','-C',str(root),*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,env={**os.environ,'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}).stdout

def checkout(root, revision, files):
    require(root.is_absolute() and root.resolve() == root, 'checkout path')
    require(git(root,'rev-parse','HEAD').decode().strip() == revision, 'checkout revision')
    require(not git(root,'status','--porcelain'), 'dirty checkout')
    for n, record in files.items():
        b=ordinary(root/n)
        require(digest(b)==record['sha256'] and len(b)==record['bytes'], 'checkout bytes')
        require(git(root,'show',revision+':'+n)==b, 'checkout Git blob')

def run_logged(command, out, label):
    (out/(label+'-command.json')).write_text(json.dumps(command))
    def bounds():
        os.nice(10)
        resource.setrlimit(resource.RLIMIT_CPU,(30,30))
        resource.setrlimit(resource.RLIMIT_FSIZE,(8*1024*1024,8*1024*1024))
        resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    started=time.monotonic(); timed_out=False
    with (out/(label+'.stdout')).open('xb') as stdout,(out/(label+'.stderr')).open('xb') as stderr:
        proc=subprocess.Popen(command,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=bounds)
        try: proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            timed_out=True
            try: os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait()
    (out/(label+'-exit.json')).write_text(json.dumps({'returncode':proc.returncode,'timedOut':timed_out,'wallSeconds':time.monotonic()-started,'cpuSeconds':30,'heapMiB':128,'coreBytes':0,'fileBytes':8*1024*1024,'niceIncrement':10}))
    require(not timed_out and proc.returncode==0,'readonly subprocess failed; raw evidence retained')
    return (out/(label+'.stdout')).read_bytes()

def main(binding_path):
    b=json.loads(ordinary(Path(binding_path)))
    require(set(b)=={'zip','compiledRoot','upstreamRoot','driverRoot','driverRevision','driverFiles','driverAuth','driverAuthSha256','driverIdentitySha256','node','output'}, 'binding keys')
    require(b['compiledRoot']==str(W), 'original compiled role')
    require(b['upstreamRoot']=='/home/runner/work/_temp/cold-memory-fusion-build-pristine','original upstream role')
    for h in HOOKS: require(not os.environ.get(h), 'executable hook environment')
    disjoint_roles([W,T,R,b['upstreamRoot'],b['driverRoot'],b['output']])
    local_before={str(p):digest(ordinary(p)) for p in HERE.glob('*') if p.is_file()}
    binding_before=ordinary(Path(binding_path))
    node=Path(b['node']); nb=ordinary(node)
    require(digest(nb)=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48', 'Node bytes')
    require(subprocess.run([str(node),'--version'],check=True,capture_output=True,timeout=10).stdout.strip()==b'v22.23.3','Node version')
    meta=json.loads(ordinary(HERE/'official-members.json'))
    frozen=json.loads(ordinary(HERE/'frozen-members.json')); prepared=json.loads(ordinary(HERE/'prepared-members.json'))
    require(len(frozen)==151 and len(prepared)==810,'fixed typed inventory counts')
    members=zip_members(Path(b['zip']),meta['members'],meta['zipSha256'],meta['zipBytes'])
    require(sum(len(v) for v in members.values()) <= 128*1024*1024,'ZIP aggregate limit')
    prefix='cold-memory-fusion-build-evidence/'
    original_source=json.loads(members[prefix+'identity-before.stdout'])
    original_prepared=json.loads(members[prefix+'prepared-after-build.json'])
    require({n:r['sha256'] for n,r in frozen.items()}==original_source['hashes'],'frozen inventory receipt')
    require({n:r['sha256'] for n,r in prepared.items()}=={n:h for n,h in original_prepared.items() if not n.endswith('.node')},'prepared inventory receipt')
    require(tar_members(members[prefix+'frozen-source.tar.gz'],frozen)=={n:ordinary(W/n) for n in frozen},'frozen TAR checkout')
    files=tar_members(members[prefix+'prepared-source.tar.gz'],prepared)
    checkout(W,COMPILED,frozen)
    driver=Path(b['driverRoot']); require(driver!=W,'separate driver checkout')
    require(type(b['driverRevision']) is str and len(b['driverRevision'])==40 and b['driverFiles'],'driver identity required')
    checkout(driver,b['driverRevision'],b['driverFiles'])
    auth=driver/b['driverAuth']
    require(auth.resolve()==auth and digest(ordinary(auth))==b['driverAuthSha256'],'driver auth pin')
    require(b['driverAuth'] in b['driverFiles'],'driver auth closure membership')
    identity_script='import {driverSourceIdentity} from '+json.dumps(auth.as_uri())+'; console.log(JSON.stringify(await driverSourceIdentity()));'
    upstream=Path(b['upstreamRoot']); require(upstream.resolve()==upstream,'upstream role')
    require(git(upstream,'rev-parse','HEAD').decode().strip()==BOCHS and not git(upstream,'status','--porcelain'),'pristine Bochs')
    manifest=json.loads(members[prefix+'prepare.json']); context=json.loads(members[prefix+'build-context.json'])
    require(manifest['boardRevision']==COMPILED and manifest['bochsRevision']==BOCHS and manifest['preparedTree']==str(T),'manifest roles')
    for n,h in context['upstreamHashes'].items():
        require(digest(git(upstream,'show',BOCHS+':'+n))==h,'upstream original blob')
    metadata=Path(git(upstream,'rev-parse','--absolute-git-dir').decode().strip())
    require(metadata.resolve()==metadata and metadata.is_dir(),'ordinary Git metadata')
    metadata_files={}
    metadata_directories=[]
    for p in metadata.rglob('*'):
        require(not p.is_symlink(),'Git metadata symlink')
        if p.is_dir(): metadata_directories.append(str(p.relative_to(metadata)))
        elif p.is_file(): metadata_files[str(p.relative_to(metadata))]=ordinary(p)
        else: require(False,'unsupported Git metadata entry')
    for path in (T,R,Path(b['output'])): require(not os.path.lexists(path),'existing output role')
    out=Path(b['output']); exclusive_tree(out,{})
    identity_raw=run_logged([str(node),'--max-old-space-size=128','--input-type=module','-e',identity_script],out,'driver-identity')
    actual_driver=json.loads(identity_raw); driver_identity(actual_driver,b['driverRevision'],b['driverFiles'])
    require(digest(json.dumps(actual_driver,separators=(',',':'),ensure_ascii=False).encode())==b['driverIdentitySha256'],'driver identity canonical SHA')
    exclusive_tree(T,files)
    exclusive_tree(T/'.git',metadata_files,metadata_directories)
    addon=members[prefix+'bw_direct.node']; destination=T/'bochs/bw_direct.node'
    require(not os.path.lexists(destination),'addon exists')
    with destination.open('xb') as f:f.write(addon)
    evidence={n[len(prefix):]:v for n,v in members.items() if n.startswith(prefix) and not n.endswith(('.tar.gz','.node'))}
    exclusive_tree(R,evidence)
    # Existing authenticator consumes ORIGINAL records, no rewriting or DSO require.
    source=W/'scripts/bochs-cpu3-native-cold-memory-fusion/identity.mjs'
    script="import {sourceIdentity,authenticateBuild} from "+json.dumps(source.as_uri())+"; import fs from 'node:fs'; const s=sourceIdentity(); console.log(JSON.stringify({source:s,proof:authenticateBuild(JSON.parse(fs.readFileSync(process.argv[1],'utf8')),s)}));"
    command=[str(node),'--max-old-space-size=128','--input-type=module','-e',script,str(R/'static-input.json')]
    admission=json.loads(run_logged(command,out,'admission'))
    checkout(W,COMPILED,frozen); checkout(driver,b['driverRevision'],b['driverFiles'])
    require(git(T,'rev-parse','HEAD').decode().strip()==BOCHS,'restored Bochs HEAD')
    for n,r in prepared.items():require(digest(ordinary(T/n))==r['sha256'],'prepared after bytes')
    require(ordinary(destination)==addon and ordinary(node)==nb,'addon/Node after bytes')
    require(git(upstream,'rev-parse','HEAD').decode().strip()==BOCHS and not git(upstream,'status','--porcelain'),'upstream after identity')
    for n,h in context['upstreamHashes'].items():require(digest(git(upstream,'show',BOCHS+':'+n))==h,'upstream after blob')
    evidence_equal({n:ordinary(R/n) for n in evidence},evidence)
    require(local_before=={str(p):digest(ordinary(p)) for p in HERE.glob('*') if p.is_file()} and ordinary(Path(binding_path))==binding_before,'helper/binding after bytes')
    proof={'schema':'bw.cold-memory-fusion-restored-materialization.v1','stateExportProfile':'bw.cold-native.copied-u32-state.v1','memoryFusionProfile':'bw.cold-native.memory-clock-fusion.v1','status':'RESTORED_AND_READONLY_ADMITTED_NO_ADDON_LOAD_OR_GUEST','originalBuild':meta,'compiledRevision':COMPILED,'driverRevision':b['driverRevision'],'compiledCount':151,'preparedCount':810,'driverSourceIdentitySha256':b['driverIdentitySha256'],'driverSourceIdentity':actual_driver,'roles':{k:b[k] for k in ('compiledRoot','upstreamRoot','driverRoot','output')},'runtimeHost':{'platform':platform.platform(),'architecture':platform.machine(),'libc':platform.libc_ver(),'nodeSha256':digest(nb)},'admission':admission,'originalRecordsUnchanged':True}
    with (out/'materialization-proof.json').open('x') as f:json.dump(proof,f,indent=2);f.write('\n')

if __name__=='__main__':
    require(len(sys.argv)==2,'one explicit trusted binding path required')
    main(sys.argv[1])
