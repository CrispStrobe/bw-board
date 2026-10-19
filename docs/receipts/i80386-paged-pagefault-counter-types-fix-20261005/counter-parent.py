import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-pagefault-counter-types-fix-20261005')
HEAD=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
EXPECTED_HEAD='e0aebea784e4daf1bb4cfcb69edeea2d2aec9ada'
assert HEAD==EXPECTED_HEAD and len(sys.argv)==1
OUT=pathlib.Path('/tmp/native-paged-pagefault-counter-types-source-controls-20261005')
PATHS=pathlib.Path('/tmp/native-paged-pagefault-counter-types-source-freeze-20261005/source-freeze.json')
PATHS_SHA='867187780e8b8067c634f07f19b32efb6e17c26e41f999bdfd0a9950b35eda96'
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
CHILD=pathlib.Path('/usr/bin/python3')
SOURCE_PROOF=pathlib.Path('/tmp/native-paged-pagefault-native-policy-design-20261005/source-provenance.json')
STATIC_PINS={'/tmp/native-paged-pagefault-static-build-37262460989.zip': 'c74915df6046cb6c6a92b4830dfe9b6cf8b2110f57717d8a9142bee99c6bbac8', '/tmp/native-paged-pagefault-static-build-audit-20261005/official-metadata.json': 'c3981e9e733d0666b3d68fd299172b7198692e23c679286b596cac9f7c635e14', '/tmp/native-paged-pagefault-static-build-audit-20261005/root-audit.json': '1edc6c22c9225241be5555c298d8eb5d117251f92a5cb03f52d73d7e1abf1b7e', '/tmp/native-paged-pagefault-static-build-audit-20261005/independent-audit.json': '855dc0b9a95a3f803b798d166705c9894da4a65dcfa40f28bd3612f931ff8ab2'}
FIRST_PINS={'/tmp/native-paged-pagefault-first-execution-37266253433.zip': '3da1d6b9b3ce457ef2355e265fad9a5bea65dda583552b5fdb5f376f0f1d255e', '/tmp/native-paged-pagefault-first-execution-audit-20261005/reset-capture.json': 'd9f3c4e9cf2544cbf9d7be9b53b5d4553cd1d346e141a98622db28ffbd72778a', '/tmp/native-paged-pagefault-first-execution-audit-20261005/root-first-failure-audit.json': '1ca9a9bd93856f34c2e3c704cda7c01eb142cf92fd676be6b284044ebd40ccb3', '/tmp/native-paged-pagefault-first-execution-audit-20261005/independent-audit.json': '6ceffd8a8072920ca94a3634c38afb60f4f6a051f26dae4c2efaaf007459a7d4', '/tmp/native-paged-pagefault-first-execution-audit-20261005/guest-outcome.json': '26ed840b214d4307a387b614bf734df669f7f0e3238eedccd1dfbb408f3b5f9b'}
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['/usr/bin/git',*args],cwd=ROOT,timeout=10)
def inventory():
 assert sha(PATHS)==PATHS_SHA;frozen=json.loads(PATHS.read_text());assert frozen['head']==HEAD and frozen['sourceCount']==107;files={}
 for name,pin in frozen['files'].items():
  p=ROOT/name;assert p.is_file() and not p.is_symlink();raw=p.read_bytes();assert raw==git('show',HEAD+':'+name),name
  files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};assert files[name]==pin,name
 assert len(files)==107
 assert git('diff','--name-only',frozen['base'],HEAD).decode().splitlines()==frozen['ownedPaths'],'entire source publication delta'
 tools={str(p.resolve()):sha(p) for p in (NODE,CHILD,pathlib.Path(sys.executable),pathlib.Path('/usr/bin/git'),pathlib.Path(__file__),PATHS,SOURCE_PROOF,ROOT/'.git/objects/info/alternates')}
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
 argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern=^(?:frozen source identity includes real fault policy and held multiline checkpoint import|genuine saved reset restores live BigInt metadata without weakening canonical bounds or raw words)$','test/i80386-paged-pagefault-native-runtime-driver.test.mjs'];cwd=ROOT
 write('invocation.json',{'argv':argv,'cwd':str(cwd),'head':HEAD,'environment':env,'sourceCount':107,'limits':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10},'scope':'Two focused cases: affected clean driver107 identity and genuine saved reset reconstruction to live BigInt uint64 metadata with complete reset CPU/board/ten-page comparison, strict invalid domains and manufactured returned metadata. Original actual reset failure preserved. Other driver cases historical, not a full-suite rerun. No provider/oracle factory, compiler, addon, CPU or build.','preparedSourceProvenance':{'path':str(SOURCE_PROOF),'sha256':sha(SOURCE_PROOF)},'sourceFreeze':{'path':str(PATHS),'sha256':PATHS_SHA}})
 with (OUT/'stdout').open('xb') as stdout,(OUT/'stderr').open('xb') as stderr:
  p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=limits);r['pid']=p.pid
  if not reap(p,time.monotonic()+30,r):r['timeout']=True;raise TimeoutError('30 second wall cap')
 r['rawExitWallSeconds']=time.monotonic()-start
 assert r['exitCode']==0 and r['rawWaitStatus']==0 and r['reaped'] and not r['timeout']
 raw=(OUT/'stdout').read_text();assert (OUT/'stderr').read_bytes()==b''
 names=['frozen source identity includes real fault policy and held multiline checkpoint import', 'genuine saved reset restores live BigInt metadata without weakening canonical bounds or raw words']
 assert re.findall(r'^# Subtest: (.+)$',raw,re.M)==names,'two counter typing/fixture-closure cases'
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
