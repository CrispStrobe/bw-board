from pathlib import Path
import subprocess,resource,os,signal,time,json,hashlib,tempfile,shutil
W=Path('/tmp/bw-board-386-owned-pic-imr-publication-20261002');P=Path(__file__).resolve().parent;TEST='test/i80386-native-owned-pic-imr-profile.test.mjs';NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();before=sha(W/TEST)
def limits():os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def run(label,root):
 cmd=[NODE,'--max-old-space-size=512','--test',str(root/TEST)];start=time.monotonic();timed=False
 with (P/(label+'.stdout')).open('xb')as out,(P/(label+'.stderr')).open('xb')as err:
  child=subprocess.Popen(cmd,cwd=root,stdout=out,stderr=err,start_new_session=True,preexec_fn=limits,env={**os.environ,**{k:''for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}})
  try:code=child.wait(timeout=120)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait();timed=True
 receipt={'command':cmd,'returncode':code,'timeout':timed,'wallSeconds':time.monotonic()-start,'testSha256':before,'scope':'Source only; no addon/build/guest','streams':{k:{'sha256':sha(P/(label+'.'+k)),'bytes':(P/(label+'.'+k)).stat().st_size}for k in ['stdout','stderr']}}
 (P/(label+'.receipt.json')).write_text(json.dumps(receipt,indent=2)+'\n');assert code==0 and not timed;stdout=(P/(label+'.stdout')).read_text();assert '# pass 17' in stdout and '# fail 0' in stdout and '# skipped 0' in stdout;print(json.dumps(receipt),flush=True)
run('caller',W)
with tempfile.TemporaryDirectory(prefix='bw-pic-dirty-caller-')as temporary:
 root=Path(temporary)/'checkout';added=False
 try:
  subprocess.run(['git','worktree','add','--detach',str(root),'HEAD'],cwd=W,check=True,capture_output=True);added=True;shutil.copyfile(W/TEST,root/TEST)
  with (root/'package-lock.json').open('ab')as lock:lock.write(b'\n')
  (root/'blinkenrocket-firmware').mkdir();(root/'blinkenrocket-firmware/source-control-marker').write_text('owned test fixture')
  (P/'dirty-caller-status.txt').write_bytes(subprocess.check_output(['git','status','--porcelain'],cwd=root));run('dirty-caller',root)
 finally:
  if added:subprocess.run(['git','worktree','remove','--force',str(root)],cwd=W,check=True,capture_output=True)
assert sha(W/TEST)==before
