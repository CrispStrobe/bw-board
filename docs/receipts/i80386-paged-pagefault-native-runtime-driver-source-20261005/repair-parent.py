import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-pagefault-native-runtime-driver-20261005')
HEAD=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
EXPECTED_HEAD='50bb03655bea26cd8b8b89bfb31ab2079643b54b'
assert HEAD==EXPECTED_HEAD and len(sys.argv)==1
OUT=pathlib.Path('/tmp/native-paged-pagefault-native-runtime-driver-source-controls-r2-20261005')
PATHS=pathlib.Path('/tmp/native-paged-pagefault-native-runtime-driver-source-freeze-r3-20261005/source-freeze.json')
PATHS_SHA='948855b42480511f11e48f0974c2e57484f70c97082aade69bc8696db4b9e20f'
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
CHILD=pathlib.Path('/usr/bin/python3')
SOURCE_PROOF=pathlib.Path('/tmp/native-paged-pagefault-native-policy-design-20261005/source-provenance.json')
PRIOR=pathlib.Path('/tmp/native-paged-pagefault-native-runtime-driver-source-controls-20261005')
PRIOR_PINS={'parent.py': '7c547fe844a13a5e0ea1edcafcd32545bf722e79bbb6db7a949e58ba9e34e85c', 'before.json': 'fd01201983a45859903ce8f5399aab516dc05d4080919d1c2e79e46f1f7498e9', 'after.json': 'fd01201983a45859903ce8f5399aab516dc05d4080919d1c2e79e46f1f7498e9', 'invocation.json': '9bbd67c9c206e0a51c159ac284a7f73048ba3219af440db61194e96191fba8b0', 'exit.json': 'dda5b67aaa894a76aee10bbf597da23bd8ba2c396d0d4a804aba5a169e5b98d6', 'stdout': '286132568c8c8fb0629287a436b58a553c966e3d82163d5f294832c6f7a70ca8', 'stderr': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'independent-audit.json': 'c60ec7fc5b732146b00584eb8ce87b902be15c947ce6251ac578f1ec4b2390db'}
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['/usr/bin/git',*args],cwd=ROOT,timeout=10)
def inventory():
 assert sha(PATHS)==PATHS_SHA;frozen=json.loads(PATHS.read_text());assert frozen['head']==HEAD and frozen['sourceCount']==105;files={}
 for name,pin in frozen['files'].items():
  p=ROOT/name;assert p.is_file() and not p.is_symlink();raw=p.read_bytes();assert raw==git('show',HEAD+':'+name),name
  files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};assert files[name]==pin,name
 assert len(files)==105
 assert git('diff','--name-only','765eaa85f805afdf62bc5efb092a02de47a73601',HEAD).decode().splitlines()==frozen['ownedPaths'],'entire owned11-path delta'
 tools={str(p.resolve()):sha(p) for p in (NODE,CHILD,pathlib.Path(sys.executable),pathlib.Path('/usr/bin/git'),pathlib.Path(__file__),PATHS,SOURCE_PROOF)}
 return {'head':git('rev-parse','HEAD').decode().strip(),'status':git('status','--porcelain').decode().strip(),'files':files,'tools':tools,'priorFailure':{name:sha(PRIOR/name) for name in PRIOR_PINS}}
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
 before=inventory();write('before.json',before);assert before['head']==EXPECTED_HEAD and before['status']==''
 assert sha(NODE)=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
 env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TMPDIR':'/tmp','PYTHONDONTWRITEBYTECODE':'1'}
 for key in ('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT'):env[key]=''
 assert before['priorFailure']==PRIOR_PINS
 cb=json.loads((PRIOR/'before.json').read_text());ca=json.loads((PRIOR/'after.json').read_text());ce=json.loads((PRIOR/'exit.json').read_text());ci=json.loads((PRIOR/'invocation.json').read_text())
 assert cb==ca and cb['head']=='65069876c60de32826427624bc41efb2a530fec1' and cb['status']=='' and len(cb['files'])==105
 changed='test/i80386-paged-pagefault-native-runtime-driver.test.mjs'
 assert git('diff','--name-only',cb['head'],HEAD).decode().splitlines()==[changed]
 assert {k:v for k,v in cb['files'].items() if k!=changed}=={k:v for k,v in before['files'].items() if k!=changed},'104 unchanged source files'
 for key in set(cb['tools'])&set(before['tools']):assert cb['tools'][key]==before['tools'][key],key
 assert ce['status']=='FAIL' and ce['exitCode']==1 and ce['rawWaitStatus']==256 and ce['reaped'] and not ce['timeout'] and ce['pinsEqual'] and not ce['finalizationErrors']
 assert ci['argv']==[str(NODE),'--max-old-space-size=128','--test',changed] and ci['environment']==env and ci['sourceCount']==105
 priorRaw=(PRIOR/'stdout').read_text();assert (PRIOR/'stderr').read_bytes()==b''
 for key,want in [('tests',8),('pass',7),('fail',1),('skipped',0)]:assert re.findall(r'^# '+key+r' (\d+)$',priorRaw,re.M)==[str(want)]
 assert 'Missing expected exception.' in priorRaw and re.findall(r'^not ok \d+ - (.+)$',priorRaw,re.M)==['comparable wholeboards ten pages and native cache rows remain strict with unmatched prefetch raw']
 argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern=^'+'comparable wholeboards ten pages and native cache rows remain strict with unmatched prefetch raw'+'$','test/i80386-paged-pagefault-native-runtime-driver.test.mjs'];cwd=ROOT
 write('invocation.json',{'argv':argv,'cwd':str(cwd),'head':HEAD,'environment':env,'sourceCount':105,'limits':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10},'scope':'ONE affected manufactured independent-page negative-fixture case; seven other actual cases remain historical at65069876. No factories, CPU instructions, addon, compiler or native build','preparedSourceProvenance':{'path':str(SOURCE_PROOF),'sha256':sha(SOURCE_PROOF)},'sourceFreeze':{'path':str(PATHS),'sha256':PATHS_SHA}})
 with (OUT/'stdout').open('xb') as stdout,(OUT/'stderr').open('xb') as stderr:
  p=subprocess.Popen(argv,cwd=cwd,env=env,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=limits);r['pid']=p.pid
  if not reap(p,time.monotonic()+30,r):r['timeout']=True;raise TimeoutError('30 second wall cap')
 r['rawExitWallSeconds']=time.monotonic()-start
 assert r['exitCode']==0 and r['rawWaitStatus']==0 and r['reaped'] and not r['timeout']
 raw=(OUT/'stdout').read_text();assert (OUT/'stderr').read_bytes()==b''
 names=['comparable wholeboards ten pages and native cache rows remain strict with unmatched prefetch raw']
 assert re.findall(r'^# Subtest: (.+)$',raw,re.M)==names,'one affected exact case'
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
