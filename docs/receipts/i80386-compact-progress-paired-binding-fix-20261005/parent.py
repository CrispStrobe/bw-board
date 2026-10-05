"""Bounded source controls only; no capability/guest command in this wrapper."""
import sys
sys.dont_write_bytecode=True
import os,json,hashlib,subprocess,resource,signal,time
from pathlib import Path
P=Path(__file__).parent;W=Path('/tmp/bw-native-compact-progress-paired-binding-fix-20261005');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';HEAD='35d1f7bef9339e75410bbea22cd1f5a43f084cc3'
CONTEXT=Path('/tmp/native-cold-compact-progress-paired-binding-fix-controls-20261005/context.json');ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'};HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE');ENV.update({h:'' for h in HOOKS});ENV.update({'TMPDIR':str(P)})
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(W),'-C',str(W),*args],env=ENV,timeout=10)
def pins():
 c=json.loads(CONTEXT.read_bytes());assert c['revision']==HEAD and git('rev-parse','HEAD').decode().strip()==HEAD and not git('status','--porcelain').strip();files={}
 for p,h in c['ownFiles'].items():
  actual=sha(W/p);assert actual==h==hashlib.sha256(git('show',HEAD+':'+p)).hexdigest(),p;files[p]=actual
 evidence={p:sha(p) for p in c['evidenceFiles']};assert evidence==c['evidenceFiles'];tools={p:sha(p) for p in c['toolFiles']};assert tools==c['toolFiles'];tools[str(Path(__file__).resolve())]=sha(__file__);assert tools[str(Path(NODE).resolve())]=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
 roles={}
 for key,role in c['roles'].items():
  materialized={}
  for path,h in role['files'].items():
   actual=sha(Path(role['root'])/path);assert actual==h==hashlib.sha256(git('show',role['revision']+':'+path)).hexdigest(),(key,path);materialized[path]=actual
  roles[key]={'revision':role['revision'],'materializedSources':materialized,'scope':role['scope']}
 return {'revision':HEAD,'sourceContextSha256':sha(CONTEXT),'sources':files,'evidence':evidence,'roles':roles,'tools':tools}
def write(name,value):(P/name).write_text(json.dumps(value,indent=2)+'\n')
def limits():
 os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(10,10));resource.setrlimit(resource.RLIMIT_FSIZE,(16<<20,16<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def interrupt(sig,frame):raise InterruptedError('control wrapper signal '+str(sig))
for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,interrupt)
before=pins();write('before.json',before);argv=[NODE,'--max-old-space-size=128','--test','--test-name-pattern=^real retained setup binding assembly','test/i80386-cold-compact-progress-paired-source.test.mjs'];write('invocation.json',{'command':argv,'cwd':str(W),'revision':HEAD,'bounds':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10,'pythonMemoryLimit':'not imposed; one Python pure method inherit process CPU/file limits; Node heap cap applies only to Node'},'blankHooks':list(HOOKS),'absentCompilerOverrides':['CPATH','CPLUS_INCLUDE_PATH','C_INCLUDE_PATH','GCC_EXEC_PREFIX','COMPILER_PATH','LIBRARY_PATH'],'scope':'One selected Node wrapper forwarding the production binding assembly regression on the exact retained first-failure descriptor and authenticated qualifier contract; no historical six-method rerun. No setup/restore/addon/provider/guest/compiler/perf'})
child=None;code=None;error=None;timeout=False;rawStatus=None;rusage=None;childExitWall=None;start=time.monotonic()
def reap_until(deadline):
 global code,rawStatus,rusage,childExitWall
 while rawStatus is None:
  pid,status,usage=os.wait4(child.pid,os.WNOHANG)
  if pid:
   rawStatus=status;code=os.waitstatus_to_exitcode(status);child.returncode=code;rusage={'userSeconds':usage.ru_utime,'systemSeconds':usage.ru_stime,'maxRSSKiB':usage.ru_maxrss};childExitWall=time.monotonic()-start;return True
  if time.monotonic()>=deadline:return False
  time.sleep(.01)
 return True
try:
 with (P/'stdout').open('xb') as out,(P/'stderr').open('xb') as err:
  child=subprocess.Popen(argv,cwd=W,env=ENV,stdout=out,stderr=err,start_new_session=True,preexec_fn=limits)
  if not reap_until(start+30):timeout=True;raise TimeoutError('absolute control wall30')
except BaseException as e:error=repr(e)
finally:
 for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,signal.SIG_IGN)
 cleanupError=None
 try:
  if child is not None:
   try:os.killpg(child.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   if not reap_until(time.monotonic()+5):raise TimeoutError('cleanup reap5')
  if child is not None:code=child.returncode
 except BaseException as e:cleanupError=repr(e)
 after=None;final=None
 try:after=pins();write('after.json',after)
 except BaseException as e:final=repr(e)
 result={'exitCode':code,'timeout':timeout,'wallSeconds':time.monotonic()-start,'wallScope':'parent including final authentication','childExitWallSeconds':childExitWall,'rawWait4Status':rawStatus,'leaderRusage':rusage,'rusageScope':'wait4 leader and its waited descendants; not guest or execution-window CPU','error':error,'cleanupError':cleanupError,'finalizationError':final,'pinsEqual':before==after};write('exit.json',result);print(json.dumps(result))
raise SystemExit(0 if code==0 and not timeout and error is None and cleanupError is None and final is None and before==after else 1)
