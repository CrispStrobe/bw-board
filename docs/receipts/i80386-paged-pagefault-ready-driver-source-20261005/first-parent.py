import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-pagefault-ready-driver-source-20261005')
HEAD=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
EXPECTED_HEAD='c7859eab6184f3dd3fc1de6a86144f3039a7f23a'
assert HEAD==EXPECTED_HEAD and len(sys.argv)==1
OUT=pathlib.Path('/tmp/native-paged-pagefault-ready-driver-source-controls-20261005')
PATHS=pathlib.Path('/tmp/native-paged-pagefault-ready-driver-source-freeze-20261005/source-freeze.json')
PATHS_SHA='7290d64c4a4a844b8dd1e8190c322fb43e602348e92bc252ecbc38bdf26bd8b6'
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
CHILD=pathlib.Path('/usr/bin/python3')
SOURCE_PROOF=pathlib.Path('/tmp/native-paged-pagefault-native-policy-design-20261005/source-provenance.json')
STATIC_PINS={'/tmp/native-paged-pagefault-static-build-37262460989.zip': 'c74915df6046cb6c6a92b4830dfe9b6cf8b2110f57717d8a9142bee99c6bbac8', '/tmp/native-paged-pagefault-static-build-audit-20261005/official-metadata.json': 'c3981e9e733d0666b3d68fd299172b7198692e23c679286b596cac9f7c635e14', '/tmp/native-paged-pagefault-static-build-audit-20261005/root-audit.json': '1edc6c22c9225241be5555c298d8eb5d117251f92a5cb03f52d73d7e1abf1b7e', '/tmp/native-paged-pagefault-static-build-audit-20261005/independent-audit.json': '855dc0b9a95a3f803b798d166705c9894da4a65dcfa40f28bd3612f931ff8ab2'}
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['/usr/bin/git',*args],cwd=ROOT,timeout=10)
def inventory():
 assert sha(PATHS)==PATHS_SHA;frozen=json.loads(PATHS.read_text());assert frozen['head']==HEAD and frozen['sourceCount']==106;files={}
 for name,pin in frozen['files'].items():
  p=ROOT/name;assert p.is_file() and not p.is_symlink();raw=p.read_bytes();assert raw==git('show',HEAD+':'+name),name
  files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};assert files[name]==pin,name
 assert len(files)==106
 assert git('diff','--name-only',frozen['base'],HEAD).decode().splitlines()==frozen['ownedPaths'],'entire source publication delta'
 tools={str(p.resolve()):sha(p) for p in (NODE,CHILD,pathlib.Path(sys.executable),pathlib.Path('/usr/bin/git'),pathlib.Path(__file__),PATHS,SOURCE_PROOF)}
 return {'head':git('rev-parse','HEAD').decode().strip(),'status':git('status','--porcelain').decode().strip(),'files':files,'tools':tools,'staticAuthority':{name:sha(name) for name in STATIC_PINS}}
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
 before=inventory();assert before['staticAuthority']==STATIC_PINS;write('before.json',before);assert before['head']==EXPECTED_HEAD and before['status']==''
 assert sha(NODE)=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
 env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TMPDIR':'/tmp','PYTHONDONTWRITEBYTECODE':'1'}
 for key in ('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT'):env[key]=''
 argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern=^(?:fresh PF build authority and manufactured pending old addon refusals before factories|new runtime and provider preserve exact held derivatives and unknown source refuses|frozen source identity includes real fault policy and held multiline checkpoint import|genuine first PF manifest exceeds held cap and is admitted by bounded four MiB source seam)$','test/i80386-paged-pagefault-native-runtime-driver.test.mjs'];cwd=ROOT
 write('invocation.json',{'argv':argv,'cwd':str(cwd),'head':HEAD,'environment':env,'sourceCount':106,'limits':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10},'scope':'Four affected fresh READY source cases: closed build authority, actual checked runtime/provider/lifecycle derivatives, clean owned identity and dirty refusal, genuine original manifest cap. Historical five other cases are not selected. No factories/compiler/addon/CPU/native build.','preparedSourceProvenance':{'path':str(SOURCE_PROOF),'sha256':sha(SOURCE_PROOF)},'sourceFreeze':{'path':str(PATHS),'sha256':PATHS_SHA}})
 with (OUT/'stdout').open('xb') as stdout,(OUT/'stderr').open('xb') as stderr:
  p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=limits);r['pid']=p.pid
  if not reap(p,time.monotonic()+30,r):r['timeout']=True;raise TimeoutError('30 second wall cap')
 r['rawExitWallSeconds']=time.monotonic()-start
 assert r['exitCode']==0 and r['rawWaitStatus']==0 and r['reaped'] and not r['timeout']
 raw=(OUT/'stdout').read_text();assert (OUT/'stderr').read_bytes()==b''
 names=['fresh PF build authority and manufactured pending old addon refusals before factories', 'new runtime and provider preserve exact held derivatives and unknown source refuses', 'frozen source identity includes real fault policy and held multiline checkpoint import', 'genuine first PF manifest exceeds held cap and is admitted by bounded four MiB source seam']
 assert re.findall(r'^# Subtest: (.+)$',raw,re.M)==names,'four affected source cases'
 for key,tap,want in [('tests','tests',4),('passes','pass',4),('failures','fail',0),('skips','skipped',0)]:
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
