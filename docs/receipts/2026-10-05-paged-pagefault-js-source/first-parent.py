import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-pagefault-source-20261005')
HEAD='75be9c4aaa9fe08ff2adbffa47ff8cc1335b19d2'
assert len(sys.argv)==2 and sys.argv[1] in ['controls','oracle'],'closed control mode'
MODE=sys.argv[1]
OUT=pathlib.Path('/tmp/native-paged-pagefault-source-'+MODE+'-20261005')
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
PATHS=pathlib.Path('/tmp/paged-pagefault-source-paths-20261005.json')
PATHS_SHA='d0607b8f8b5c46779c25b2496e8152aec1c1a7a5e1f85141ada24482455dcdc9'
CONTROL_OUT=pathlib.Path('/tmp/native-paged-pagefault-source-controls-20261005')
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(args):return subprocess.check_output(['/usr/bin/git',*args],cwd=ROOT,timeout=10).decode().strip()
def inventory():
 assert sha(PATHS)==PATHS_SHA;paths=json.loads(PATHS.read_text());assert len(paths)==51 and paths==sorted(set(paths));files={}
 for name in paths:
  p=ROOT/name;assert not p.is_symlink() and p.is_file() and p.resolve().is_relative_to(ROOT.resolve());b=p.read_bytes();g=subprocess.check_output(['/usr/bin/git','show',HEAD+':'+name],cwd=ROOT,timeout=10);assert b==g,name;files[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
 tools={str(NODE):sha(NODE),os.path.realpath(sys.executable):sha(sys.executable),'/usr/bin/git':sha('/usr/bin/git'),str(pathlib.Path(__file__).resolve()):sha(__file__),str(PATHS):sha(PATHS)}
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
 def prerequisite(directory,tests):
  saved=json.loads((directory/'exit.json').read_text());assert saved['status']=='PASS' and saved['tests']==tests and saved['passes']==tests and saved['skips']==0 and saved['pinsEqual'];assert sha(directory/'parent.py')==sha(__file__)
  cb=json.loads((directory/'before.json').read_text());ca=json.loads((directory/'after.json').read_text());assert cb==ca and cb['head']==HEAD and cb['files']==before['files'];assert cb['tools'][str(NODE)]==NODE_SHA
 if MODE=='oracle':prerequisite(CONTROL_OUT,6)
 actualName='bounded actual private JS page fault repair CR3 reload IRET and once-only retry retains genuine effects'
 selection='^(?!bounded actual private JS).*$' if MODE=='controls' else '^'+re.escape(actualName)+'$'
 argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern='+selection,'test/i80386-paged-pagefault-source.test.mjs']
 if MODE=='oracle':env['BW_PAGED_PF_CONTROL_OUTPUT']=str(OUT/'js-control.json')
 write('invocation.json',{'argv':argv,'cwd':str(ROOT),'head':HEAD,'mode':MODE,'sourceCount':51,'scope':{'controls':'five manufactured/source cases + one actual factory/reset/stage zero instruction; no guest instructions','oracle':'one separately bounded genuine private JS fault repair retry program; no native'}[MODE],'environment':env,'absentCompilerVariables':compiler,'limits':{'cpuSeconds':10,'wallSeconds':30,'nodeHeapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10},'wait4Scope':'leader plus reaped descendants; whole-child setup/test CPU, no execution-phase speed claim'})
 with (OUT/'stdout').open('xb')as out,(OUT/'stderr').open('xb')as err:
  p=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=out,stderr=err,start_new_session=True,preexec_fn=limits);result['pid']=p.pid
  if not reap(p,time.monotonic()+30,result):result['timeout']=True;raise TimeoutError('30 second wall cap')
 result['rawExitWallSeconds']=time.monotonic()-start
 assert result['exitCode']==0 and result['rawWaitStatus']==0 and result['reaped'] and not result['timeout'],'raw child outcome'
 raw=(OUT/'stdout').read_text();assert (OUT/'stderr').read_bytes()==b'','empty child stderr required; raw stream retained'
 for key,tap in [('tests','tests'),('passes','pass'),('failures','fail'),('skips','skipped')]:
  matches=re.findall(r'^# '+tap+r' (\d+)$',raw,re.M);assert len(matches)==1,(key,matches);result[key]=int(matches[0])
 assert [result[k]for k in ['tests','passes','failures','skips']]==([6,6,0,0] if MODE=='controls' else [1,1,0,0])
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
