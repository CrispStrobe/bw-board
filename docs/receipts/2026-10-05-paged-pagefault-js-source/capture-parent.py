import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-pagefault-source-20261005')
HEAD='75be9c4aaa9fe08ff2adbffa47ff8cc1335b19d2'
assert len(sys.argv)==1,'fixed capture-only command'
MODE='oracle'
OUT=pathlib.Path('/tmp/native-paged-pagefault-source-oracle-20261005')
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
PATHS=pathlib.Path('/tmp/paged-pagefault-source-paths-20261005.json')
PATHS_SHA='d0607b8f8b5c46779c25b2496e8152aec1c1a7a5e1f85141ada24482455dcdc9'
CONTROL_OUT=pathlib.Path('/tmp/native-paged-pagefault-source-controls-20261005')
PRIOR_PINS={'parent.py': {'bytes': 7814, 'sha256': 'c51a54787599c980be0036c61ad09483eb693f5fa0b4ae95cb9324a06e30c5bc'}, 'invocation.json': {'bytes': 1336, 'sha256': '21616b21be9273d576f84c594bd80f021d323bd5ea54575447af324c4548dc1f'}, 'before.json': {'bytes': 8315, 'sha256': '382fa05bf66f667478facc51f624dd3761311f7c5ee2eb2045edcf3d2b0c73d7'}, 'after.json': {'bytes': 8315, 'sha256': '382fa05bf66f667478facc51f624dd3761311f7c5ee2eb2045edcf3d2b0c73d7'}, 'stdout': {'bytes': 3503, 'sha256': 'a0ce7c4cab4866230c6a1aed2a0598cd4d122f4345c3969f81189979aaec563a'}, 'stderr': {'bytes': 0, 'sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}, 'exit.json': {'bytes': 629, 'sha256': '34741e2ea4de1cda2774f51e36044e2216cd1d5d1903a0a6062c92601b7308d4'}, 'independent-audit.json': {'bytes': 1298, 'sha256': '407d861a24ba6ce44df3d216c3c315e250045a36e9e7df707225bc9a3582350d'}}
PRIOR_PARENT=pathlib.Path('/tmp/run-native-paged-pagefault-source-parent-20261005.py')
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(args):return subprocess.check_output(['/usr/bin/git',*args],cwd=ROOT,timeout=10).decode().strip()
def inventory():
 assert sha(PATHS)==PATHS_SHA;paths=json.loads(PATHS.read_text());assert len(paths)==51 and paths==sorted(set(paths));files={}
 for name in paths:
  p=ROOT/name;assert not p.is_symlink() and p.is_file() and p.resolve().is_relative_to(ROOT.resolve());b=p.read_bytes();g=subprocess.check_output(['/usr/bin/git','show',HEAD+':'+name],cwd=ROOT,timeout=10);assert b==g,name;files[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
 tools={str(NODE):sha(NODE),os.path.realpath(sys.executable):sha(sys.executable),'/usr/bin/git':sha('/usr/bin/git'),str(pathlib.Path(__file__).resolve()):sha(__file__),str(PATHS):sha(PATHS),str(PRIOR_PARENT):sha(PRIOR_PARENT)}
 return {'head':git(['rev-parse','HEAD']),'status':git(['status','--porcelain']),'files':files,'tools':tools}
def write(name,v):
 with (OUT/name).open('w')as f:json.dump(v,f,indent=2);f.write('\n')
def reject_signal(signum,frame):raise RuntimeError('parent signal '+str(signum))
def limits():
 os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(10,10));resource.setrlimit(resource.RLIMIT_FSIZE,(16<<20,16<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def reap(p,deadline,result):
 while time.monotonic()<deadline:
  pid,status,r=os.wait4(p.pid,os.WNOHANG)
  if pid:
   p.returncode=os.waitstatus_to_exitcode(status);result['rawWaitStatus']=status;result['exitCode']=p.returncode;result['reaped']=True;result['rusage']={'userSeconds':r.ru_utime,'systemSeconds':r.ru_stime,'maxRssKiB':r.ru_maxrss,'scope':'wait4 leader plus descendants already reaped by it; not cgroup attribution'};return True
  time.sleep(.025)
 return False
assert not OUT.exists();OUT.mkdir();(OUT/'parent.py').write_bytes(pathlib.Path(__file__).read_bytes())
result={'status':'FAIL','mode':MODE,'pid':None,'exitCode':None,'rawWaitStatus':None,'reaped':False,'timeout':False,'primaryError':None,'finalizationErrors':[],'pinsEqual':False};p=None;before=None;start=time.monotonic()
for sig in [signal.SIGINT,signal.SIGTERM]:signal.signal(sig,reject_signal)
try:
 before=inventory();write('before.json',before);assert before['head']==HEAD and not before['status'];assert before['tools'][str(NODE)]==NODE_SHA
 env={'PATH':str(NODE.parent)+':/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TMPDIR':'/tmp'}
 blank=['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT']
 for k in blank:env[k]=''
 compiler=['GCC_EXEC_PREFIX','COMPILER_PATH','LIBRARY_PATH','CPATH','C_INCLUDE_PATH','CPLUS_INCLUDE_PATH','OBJC_INCLUDE_PATH'];assert not any(k in env for k in compiler);assert 'NODE_TEST_CONTEXT' not in env
 for name,pin in PRIOR_PINS.items():
  raw=(CONTROL_OUT/name).read_bytes();assert len(raw)==pin['bytes'] and hashlib.sha256(raw).hexdigest()==pin['sha256'],name
 assert sha(PRIOR_PARENT)==PRIOR_PINS['parent.py']['sha256']=='c51a54787599c980be0036c61ad09483eb693f5fa0b4ae95cb9324a06e30c5bc'
 saved=json.loads((CONTROL_OUT/'exit.json').read_text());assert saved['status']=='FAIL' and saved['primaryError']=='AssertionError()' and saved['finalizationErrors']==[] and saved['pinsEqual'];assert [saved[k]for k in ['tests','passes','failures','skips']]==[7,7,0,0];assert saved['exitCode']==0 and saved['rawWaitStatus']==0 and saved['reaped'] and not saved['timeout']
 cb=json.loads((CONTROL_OUT/'before.json').read_text());ca=json.loads((CONTROL_OUT/'after.json').read_text());assert cb==ca and cb['head']==HEAD and cb['status']=='' and cb['files']==before['files'];assert cb['tools']=={k:before['tools'][k]for k in cb['tools']},'every historical tool pin equal, new capture parent additional and independently pinned'
 first=json.loads((CONTROL_OUT/'invocation.json').read_text());expectedFirst=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern=^(?!bounded actual private JS).*$','test/i80386-paged-pagefault-source.test.mjs'];assert first['argv']==expectedFirst and first['cwd']==str(ROOT) and first['head']==HEAD and first['mode']=='controls' and first['sourceCount']==51 and first['environment']==env and first['limits']=={'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10}
 firstTape=(CONTROL_OUT/'stdout').read_text();assert (CONTROL_OUT/'stderr').read_bytes()==b''
 expectedNames=['fixed source ROM and RAM instructions prove vector14 gate, handler CR3 reload and error discard encodings','physical fetch accepts only encoded instructions and rejects poison aliases and HLT','ordered real frame, ordinary PTE repair and once-only retry store owners refuse changed address phase and byte','exact JS A/D sources distinguish repair table writes and retried data dirtiness while code stays clean','manufactured terminal and zero-completion ledger refuse duplicate fault charge missing repair wrong cache or any page byte','private no-arg factory reset stage returns detached pages and refuses early settle','bounded actual private JS page fault repair CR3 reload IRET and once-only retry retains genuine effects']
 assert re.findall(r'^# Subtest: (.+)$',firstTape,re.M)==expectedNames
 for tap,expected in [('tests',7),('pass',7),('fail',0),('skipped',0)]:assert re.findall(r'^# '+tap+r' (\d+)$',firstTape,re.M)==[str(expected)]
 assert not (CONTROL_OUT/'js-control.json').exists(),'historical first invocation did not request capture'
 audit=json.loads((CONTROL_OUT/'independent-audit.json').read_text());assert audit['status']=='INDEPENDENT_SEVEN_ACTUAL_TEST_PASS_WRAPPER_COUNT_FAILURE_CONFIRMED' and audit['head']==HEAD and audit['sourceCount']==51 and audit['rawTests']==7 and audit['rawPass']==7 and audit['sourceToolsPrepostEqual'] and audit['fullCapturePresent'] is False
 actualName='bounded actual private JS page fault repair CR3 reload IRET and once-only retry retains genuine effects'
 selection='^'+re.escape(actualName)+'$'
 argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern='+selection,'test/i80386-paged-pagefault-source.test.mjs']
 if MODE=='oracle':env['BW_PAGED_PF_CONTROL_OUTPUT']=str(OUT/'js-control.json')
 write('invocation.json',{'argv':argv,'cwd':str(ROOT),'head':HEAD,'mode':MODE,'sourceCount':51,'scope':'one separately approved genuine private JS capture-only purpose after historical all7 childPASS/wrapperFAIL; no unchanged six-case rerun/native', 'historicalPrerequisite':{'packet':str(CONTROL_OUT),'pins':PRIOR_PINS,'wrapperStatus':'FAIL expected6 but childactual7PASS','actualPriorJavascriptAttempts':57,'actualPriorCompletedQ':56,'fullCaptureAbsent':True},'environment':env,'absentCompilerVariables':compiler,'limits':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10},'wait4Scope':'leader plus reaped descendants; whole-child setup/test CPU, no execution-phase speed claim'})
 with (OUT/'stdout').open('xb')as out,(OUT/'stderr').open('xb')as err:
  p=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=out,stderr=err,start_new_session=True,preexec_fn=limits);result['pid']=p.pid
  if not reap(p,time.monotonic()+30,result):result['timeout']=True;raise TimeoutError('30 second wall cap')
 result['rawExitWallSeconds']=time.monotonic()-start
 assert result['exitCode']==0 and result['rawWaitStatus']==0 and result['reaped'] and not result['timeout'],'raw child outcome'
 raw=(OUT/'stdout').read_text();assert (OUT/'stderr').read_bytes()==b'','empty child stderr required; raw stream retained'
 for key,tap in [('tests','tests'),('passes','pass'),('failures','fail'),('skips','skipped')]:
  matches=re.findall(r'^# '+tap+r' (\d+)$',raw,re.M);assert len(matches)==1,(key,matches);result[key]=int(matches[0])
 assert [result[k]for k in ['tests','passes','failures','skips']]==[1,1,0,0]
 assert re.findall(r'^# Subtest: (.+)$',raw,re.M)==[actualName],'exact positive oracle case only'
 if MODE=='oracle':
  capture=json.loads((OUT/'js-control.json').read_text());assert capture['schema']=='bw.paged-pagefault.js-source-control.v1';assert capture['frames'] and capture['settled']['faultSerial']==1;assert capture['settled']['attemptOrdinal']==capture['settled']['q']+1
  result['capture']={'bytes':(OUT/'js-control.json').stat().st_size,'sha256':sha(OUT/'js-control.json'),'attemptOrdinal':capture['settled']['attemptOrdinal'],'q':capture['settled']['q'],'frames':len(capture['frames']),'cuts':len(capture['cuts']),'ramSha256':capture['settled']['ramSha256']}
 result['status']='PASS'
except BaseException as e:result['primaryError']=repr(e);result['status']='FAIL'
finally:
 for sig in [signal.SIGINT,signal.SIGTERM]:signal.signal(sig,signal.SIG_IGN)
 if p is not None:
  try:os.killpg(p.pid,signal.SIGKILL);result['cleanupGroupKill']='sent'
  except ProcessLookupError:result['cleanupGroupKill']='already absent'
  except BaseException as e:result['finalizationErrors'].append({'cleanupGroupKill':repr(e)})
  if not result['reaped']:
   try:
    if not reap(p,time.monotonic()+5,result):result['finalizationErrors'].append({'reap':'leader not reaped within five seconds'})
   except BaseException as e:result['finalizationErrors'].append({'reap':repr(e)})
 try:
  after=inventory();write('after.json',after);result['pinsEqual']=before==after;assert result['pinsEqual'],'source/tool/HEAD/status changed'
 except BaseException as e:result['finalizationErrors'].append({'afterAuthentication':repr(e)})
 if result['primaryError'] is not None or result['finalizationErrors'] or not result['pinsEqual']:result['status']='FAIL'
 result['finalAuthInclusiveWallSeconds']=time.monotonic()-start;write('exit.json',result)
print(json.dumps(result));sys.exit(0 if result['status']=='PASS' else 1)
