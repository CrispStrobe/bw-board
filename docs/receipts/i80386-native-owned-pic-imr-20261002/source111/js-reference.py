# Prepared only. No execution until clean freeze/peer/root guest grant.
from pathlib import Path
import json,hashlib,subprocess,os,signal,resource,time
P=Path(__file__).resolve().parent;a=json.loads((P/'approved-js-bindings.json').read_bytes());W=Path(a['sourceWorktree']);R=Path(a['newOutput']);NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert len(a['sourceHashes'])==111 and not R.exists()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==a['sourceRevision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for p,h in a['sourceHashes'].items():assert sha(W/p)==h==hashlib.sha256(subprocess.check_output(['git','show',a['sourceRevision']+':'+p],cwd=W)).hexdigest()
 for p,h in a['helperHashes'].items():assert sha(P/p)==h
 return {'sourceRevision':a['sourceRevision'],'sourceHashes':a['sourceHashes'],'helperHashes':a['helperHashes']}
before=auth();R.mkdir();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
def bounds():os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
cmd=[NODE,'--max-old-space-size=512',str(W/'scripts/run-i80386-free-owned-pic-imr.mjs'),str(R/'guest')];timed=False;start=time.monotonic()
with (R/'child.stdout').open('xb')as out,(R/'child.stderr').open('xb')as err:
 child=subprocess.Popen(cmd,cwd=W,stdout=out,stderr=err,env=os.environ.copy(),start_new_session=True,preexec_fn=bounds)
 try:code=child.wait(timeout=120)
 except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait();timed=True
(R/'exit.json').write_text(json.dumps({'command':cmd,'returncode':code,'timeout':timed,'wallSeconds':time.monotonic()-start,'streams':{k:{'sha256':sha(R/('child.'+k)),'bytes':(R/('child.'+k)).stat().st_size}for k in ['stdout','stderr']}},indent=2)+'\n');(R/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');assert auth()==before and code==0 and not timed
c=json.loads((R/'guest/capture.json').read_bytes());assert c['source']=={'revision':a['sourceRevision'],'hashes':a['sourceHashes']} and c['rom']['sha256']==a['romSha256'];assert c['halted'] and len(c['boundaries'])==6;assert c['final']['picImrWitness']==[255,255];assert [(r['port'],r['reg'],r['value'])for r in c['picReads']]==[(33,1,255),(161,1,255)]
for r in c['picReads']:assert r['before']==r['after'] and r['before']['pollPending'] is False and r['before']['imr']==255
print(json.dumps({'status':'ACTUAL_JS_PIC_IMR_REFERENCE_PASS_NOT_NATIVE_OR_SPEED','captureSha256':sha(R/'guest/capture.json'),'attempts':c['attempts'],'q':c['q'],'sourceCount':111}))
