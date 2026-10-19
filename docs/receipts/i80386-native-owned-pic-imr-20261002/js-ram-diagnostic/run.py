# Prepared only. No execution until clean freeze/peer/root guest grant.
from pathlib import Path
import json,hashlib,subprocess,os,signal,resource,time
P=Path(__file__).resolve().parent;a=json.loads((P/'approved-bindings.json').read_bytes());W=Path(a['sourceWorktree']);R=Path(a['newOutput']);NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert len(a['sourceHashes'])==111 and not R.exists()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==a['sourceRevision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for p,h in a['sourceHashes'].items():assert sha(W/p)==h==hashlib.sha256(subprocess.check_output(['git','show',a['sourceRevision']+':'+p],cwd=W)).hexdigest()
 for p,h in a['helperHashes'].items():assert sha(P/p)==h
 return {'sourceRevision':a['sourceRevision'],'sourceHashes':a['sourceHashes'],'helperHashes':a['helperHashes']}
before=auth();R.mkdir();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
def bounds():os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
cmd=[NODE,'--max-old-space-size=512',str(P/'runner.mjs'),str(R/'guest')];timed=False;start=time.monotonic()
with (R/'child.stdout').open('xb')as out,(R/'child.stderr').open('xb')as err:
 child=subprocess.Popen(cmd,cwd=W,stdout=out,stderr=err,env=os.environ.copy(),start_new_session=True,preexec_fn=bounds)
 try:code=child.wait(timeout=120)
 except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait();timed=True
(R/'exit.json').write_text(json.dumps({'command':cmd,'returncode':code,'timeout':timed,'wallSeconds':time.monotonic()-start,'streams':{k:{'sha256':sha(R/('child.'+k)),'bytes':(R/('child.'+k)).stat().st_size}for k in ['stdout','stderr']}},indent=2)+'\n');(R/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');assert auth()==before and code==0 and not timed
c=json.loads((R/'guest/capture.json').read_bytes());assert c['source']=={'revision':a['sourceRevision'],'hashes':a['sourceHashes']} and c['rom']['sha256']==a['romSha256'];assert c['halted'] and len(c['boundaries'])==6;assert c['final']['picImrWitness']==[255,255];assert [(r['port'],r['reg'],r['value'])for r in c['picReads']]==[(33,1,255),(161,1,255)]
for r in c['picReads']:assert r['before']==r['after'] and r['before']['pollPending'] is False and r['before']['imr']==255
print(json.dumps({'status':'ACTUAL_JS_PIC_IMR_REFERENCE_PASS_NOT_NATIVE_OR_SPEED','captureSha256':sha(R/'guest/capture.json'),'attempts':c['attempts'],'q':c['q'],'sourceCount':111}))

assert sha(R/'guest/capture.json')=='fdca8f8fa92952cd9cd5f4447e66b194a5f691025bcf925f7ddd443290143346'
ramPath=R/'guest/ram.bin';assert ramPath.is_file() and not ramPath.is_symlink() and ramPath.stat().st_size==16*1024*1024;memory=ramPath.read_bytes();assert sha(ramPath)=='887b7eb9959044f45868a71c29c5c013d65ec0ad3e0205c738719757e63b0ffb'
evidence=json.loads((R/'guest/ram-evidence.json').read_bytes());assert list(memory[0x510:0x518])==evidence['resetWitness']==[0,3,0,0,0,0,0,0];assert evidence['ownReset']=={'edx':c['reset']['cpu']['edx'],'cr0':c['reset']['cpu']['cr0']}=={'edx':0x300,'cr0':0}
canonical=hashlib.sha256(memory[:0x510]+bytes(8)+memory[0x518:]).hexdigest();assert canonical==evidence['ramCanonicalSha256'] and evidence['rawRamSha256']==sha(ramPath)
proof={'status':'ACTUAL_DIAGNOSTIC_RAM_CANONICAL_ANCHOR_PASS_NOT_NATIVE_QUALIFICATION','originalCaptureSha256':sha(R/'guest/capture.json'),'rawRamSha256':sha(ramPath),'ramCanonicalSha256':canonical,'ownReset':evidence['ownReset'],'resetWitness':evidence['resetWitness'],'diagnosticRunnerSha256':sha(P/'runner.mjs'),'derivationSha256':sha(P/'derivation.json'),'sourceRevision':a['sourceRevision'],'sourceCount':111,'normalizedAddresses':{'start':0x510,'endExclusive':0x518}}
(R/'canonical-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
