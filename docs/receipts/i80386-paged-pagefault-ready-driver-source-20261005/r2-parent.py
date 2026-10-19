import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-pagefault-ready-driver-source-20261005')
HEAD=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
EXPECTED_HEAD='c7ba003148a636e468431498626933c2e2e93e26'
assert HEAD==EXPECTED_HEAD and len(sys.argv)==1
OUT=pathlib.Path('/tmp/native-paged-pagefault-ready-driver-source-controls-r2-20261005')
PATHS=pathlib.Path('/tmp/native-paged-pagefault-ready-driver-source-freeze-r2-20261005/source-freeze.json')
PATHS_SHA='b07deec8b6ce88102f4c7c7ee43d4f5595d44059121a5f26096e1acb03b72a7f'
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
CHILD=pathlib.Path('/usr/bin/python3')
SOURCE_PROOF=pathlib.Path('/tmp/native-paged-pagefault-native-policy-design-20261005/source-provenance.json')
STATIC_PINS={'/tmp/native-paged-pagefault-static-build-37262460989.zip': 'c74915df6046cb6c6a92b4830dfe9b6cf8b2110f57717d8a9142bee99c6bbac8', '/tmp/native-paged-pagefault-static-build-audit-20261005/official-metadata.json': 'c3981e9e733d0666b3d68fd299172b7198692e23c679286b596cac9f7c635e14', '/tmp/native-paged-pagefault-static-build-audit-20261005/root-audit.json': '1edc6c22c9225241be5555c298d8eb5d117251f92a5cb03f52d73d7e1abf1b7e', '/tmp/native-paged-pagefault-static-build-audit-20261005/independent-audit.json': '855dc0b9a95a3f803b798d166705c9894da4a65dcfa40f28bd3612f931ff8ab2'}
FIRST_PINS={'/tmp/native-paged-pagefault-ready-driver-source-controls-20261005/exit.json': '47071921a74be5de4d517aba56d2e3fdcd4f60b2e52b58d825e88b191fff854a', '/tmp/native-paged-pagefault-ready-driver-source-controls-20261005/stdout': '213369a379188be6711b35409ae4b53575e97fb82a83fee56dbb8987b0bd1c58', '/tmp/native-paged-pagefault-ready-driver-source-controls-20261005/stderr': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '/tmp/native-paged-pagefault-ready-driver-source-controls-20261005/before.json': '83d35f62c607e02f74051e68edddea9a98ed4a8052d1d4f44ff649ba6f1c9c1f', '/tmp/native-paged-pagefault-ready-driver-source-controls-20261005/after.json': '83d35f62c607e02f74051e68edddea9a98ed4a8052d1d4f44ff649ba6f1c9c1f', '/tmp/native-paged-pagefault-ready-driver-source-controls-20261005/invocation.json': 'bb4e15e42534672fe14675f778c86dafbdadeca24074184b212ca411a063b5ec', '/tmp/native-paged-pagefault-ready-driver-source-controls-20261005/parent.py': '7d9114c09c0369d329ad73d2551f0731fb569740037ccc9a2303ea77d2de0502'}
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
 return {'head':git('rev-parse','HEAD').decode().strip(),'status':git('status','--porcelain').decode().strip(),'files':files,'tools':tools,'staticAuthority':{name:sha(name) for name in STATIC_PINS},'firstOutcome':{name:sha(name) for name in FIRST_PINS}}
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
 before=inventory();assert before['staticAuthority']==STATIC_PINS;assert before['firstOutcome']==FIRST_PINS;write('before.json',before);assert before['head']==EXPECTED_HEAD and before['status']==''
 assert sha(NODE)=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
 env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TMPDIR':'/tmp','PYTHONDONTWRITEBYTECODE':'1'}
 for key in ('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT'):env[key]=''
 argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern=^(?:new runtime and provider preserve exact held derivatives and unknown source refuses|genuine first PF manifest exceeds held cap and is admitted by bounded four MiB source seam)$','test/i80386-paged-pagefault-native-runtime-driver.test.mjs'];cwd=ROOT
 write('invocation.json',{'argv':argv,'cwd':str(cwd),'head':HEAD,'environment':env,'sourceCount':106,'limits':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10},'scope':'Two affected repaired cases: exact checked derivatives/full lifecycle inverse and genuine original manifest cap. Initial authority and clean identity passed at c785; original two strict-header failures preserved. Five other cases historical. No full-suite rerun. No factories/compiler/addon/CPU/native build.','preparedSourceProvenance':{'path':str(SOURCE_PROOF),'sha256':sha(SOURCE_PROOF)},'sourceFreeze':{'path':str(PATHS),'sha256':PATHS_SHA}})
 with (OUT/'stdout').open('xb') as stdout,(OUT/'stderr').open('xb') as stderr:
  p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=limits);r['pid']=p.pid
  if not reap(p,time.monotonic()+30,r):r['timeout']=True;raise TimeoutError('30 second wall cap')
 r['rawExitWallSeconds']=time.monotonic()-start
 assert r['exitCode']==0 and r['rawWaitStatus']==0 and r['reaped'] and not r['timeout']
 raw=(OUT/'stdout').read_text();assert (OUT/'stderr').read_bytes()==b''
 names=['new runtime and provider preserve exact held derivatives and unknown source refuses', 'genuine first PF manifest exceeds held cap and is admitted by bounded four MiB source seam']
 assert re.findall(r'^# Subtest: (.+)$',raw,re.M)==names,'two repaired affected source cases'
 for key,tap,want in [('tests','tests',2),('passes','pass',2),('failures','fail',0),('skips','skipped',0)]:
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
