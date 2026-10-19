import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-pagefault-native-runtime-driver-20261005')
HEAD=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
EXPECTED_HEAD='e939567e10556ae55028208c372267a64abc0e67'
assert HEAD==EXPECTED_HEAD and len(sys.argv)==1
OUT=pathlib.Path('/tmp/native-paged-pagefault-native-runtime-driver-ci-sparse-add-controls-20261005')
PATHS=pathlib.Path('/tmp/native-paged-pagefault-native-runtime-driver-ci-sparse-add-source-freeze-20261005/source-freeze.json')
PATHS_SHA='eb3e134ef0270062a0749f8cf5da37d4cc0a0afe1775de5c7476f68a9b522dc9'
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
CHILD=pathlib.Path('/usr/bin/python3')
SOURCE_PROOF=pathlib.Path('/tmp/native-paged-pagefault-native-policy-design-20261005/source-provenance.json')
CI_FAILURE=pathlib.Path('/tmp/pf-ci-sparse-add-failure-20261005')
CI_PINS={'origin.json': 'd1a95750e2d2ddcbc4379654632df416e2f970ffcd4e4fe9b937755bf9544f08', 'identity-failure.txt': '9c7136333e02ab4316bb17acc5bc4b1aa160d10abb0f831784f4c068ad22fb31'}
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['/usr/bin/git',*args],cwd=ROOT,timeout=10)
def inventory():
 assert sha(PATHS)==PATHS_SHA;frozen=json.loads(PATHS.read_text());assert frozen['head']==HEAD and frozen['sourceCount']==105;files={}
 for name,pin in frozen['files'].items():
  p=ROOT/name;assert p.is_file() and not p.is_symlink();raw=p.read_bytes();assert raw==git('show',HEAD+':'+name),name
  files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};assert files[name]==pin,name
 assert len(files)==105
 assert git('diff','--name-only','01ea0d40438b3d2a081a5739d47f7d95ceb5d8c9',HEAD).decode().splitlines()==frozen['ownedPaths'],'entire source publication delta'
 tools={str(p.resolve()):sha(p) for p in (NODE,CHILD,pathlib.Path(sys.executable),pathlib.Path('/usr/bin/git'),pathlib.Path(__file__),PATHS,SOURCE_PROOF)}
 return {'head':git('rev-parse','HEAD').decode().strip(),'status':git('status','--porcelain').decode().strip(),'files':files,'tools':tools,'failedCI':{name:sha(CI_FAILURE/name) for name in CI_PINS}}
def write(name,value):
 with (OUT/name).open('x') as f:json.dump(value,f,indent=2);f.write('\n')
def limits():
 os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(10,10));resource.setrlimit(resource.RLIMIT_FSIZE,(16<<20,16<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def stop_signal(signum,frame):raise RuntimeError('parent signal '+str(signum))
def reap(p,deadline,r):
 while time.monotonic()<deadline:
  pid,status,u=os.wait4(p.pid,os.WNOHANG)
  if pid:
   p.returncode=os.waitstatus_to_exitcode(status);r.update(reaped=True,rawWaitStatus=status,exitCode=p.returncode,rusage={'userSeconds':u.ru_utime,'systemSeconds':u.ru_stime,'maxRssKiB':u.ru_maxrss,'scope':'wait4 leader plus descendants reaped by it; not cgroup attribution'});return True
  time.sleep(.025)
 return False
assert not OUT.exists();OUT.mkdir();(OUT/'parent.py').write_bytes(pathlib.Path(__file__).read_bytes())
r={'status':'FAIL','pid':None,'exitCode':None,'rawWaitStatus':None,'reaped':False,'timeout':False,'primaryError':None,'finalizationErrors':[],'pinsEqual':False};p=None;before=None;start=time.monotonic()
for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,stop_signal)
try:
 before=inventory();assert before['failedCI']==CI_PINS;write('before.json',before);assert before['head']==EXPECTED_HEAD and before['status']==''
 assert sha(NODE)=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
 env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TMPDIR':'/tmp','PYTHONDONTWRITEBYTECODE':'1'}
 for key in ('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT'):env[key]=''
 argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern=^frozen source identity includes real fault policy and held multiline checkpoint import$','test/i80386-paged-pagefault-native-runtime-driver.test.mjs'];cwd=ROOT
 write('invocation.json',{'argv':argv,'cwd':str(cwd),'head':HEAD,'environment':env,'sourceCount':105,'limits':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10},'scope':'ONE affected CI portable sparse-add identity case: exact clean owned sparse checkout identity plus manufactured tracked/untracked dirty fixture refusal and unchanged caller Git status. No factories/compiler/addon/CPU/native build.','preparedSourceProvenance':{'path':str(SOURCE_PROOF),'sha256':sha(SOURCE_PROOF)},'sourceFreeze':{'path':str(PATHS),'sha256':PATHS_SHA}})
 with (OUT/'stdout').open('xb') as stdout,(OUT/'stderr').open('xb') as stderr:
  p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=limits);r['pid']=p.pid
  if not reap(p,time.monotonic()+30,r):r['timeout']=True;raise TimeoutError('30 second wall cap')
 r['rawExitWallSeconds']=time.monotonic()-start
 assert r['exitCode']==0 and r['rawWaitStatus']==0 and r['reaped'] and not r['timeout']
 raw=(OUT/'stdout').read_text();assert (OUT/'stderr').read_bytes()==b''
 names=['frozen source identity includes real fault policy and held multiline checkpoint import']
 assert re.findall(r'^# Subtest: (.+)$',raw,re.M)==names,'one affected identity case'
 for key,tap,want in [('tests','tests',1),('passes','pass',1),('failures','fail',0),('skips','skipped',0)]:
  found=re.findall(r'^# '+tap+r' (\d+)$',raw,re.M);assert found==[str(want)],(key,found);r[key]=want
 r['status']='PASS'
except BaseException as e:r['primaryError']=repr(e)
finally:
 for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,signal.SIG_IGN)
 if p is not None:
  try:os.killpg(p.pid,signal.SIGKILL);r['groupCleanup']='sent'
  except ProcessLookupError:r['groupCleanup']='already absent'
  except BaseException as e:r['finalizationErrors'].append({'groupCleanup':repr(e)})
  if not r['reaped']:
   try:
    if not reap(p,time.monotonic()+5,r):r['finalizationErrors'].append({'reap':'not reaped within five seconds'})
   except BaseException as e:r['finalizationErrors'].append({'reap':repr(e)})
 try:
  after=inventory();write('after.json',after);r['pinsEqual']=before==after;assert r['pinsEqual']
 except BaseException as e:r['finalizationErrors'].append({'afterAuthentication':repr(e)})
 if r['primaryError'] is not None or r['finalizationErrors'] or not r['pinsEqual']:r['status']='FAIL'
 r['finalAuthInclusiveWallSeconds']=time.monotonic()-start;write('exit.json',r)
print(json.dumps(r));sys.exit(0 if r['status']=='PASS' else 1)
