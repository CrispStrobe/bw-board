import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-int-iret-native-source-20261004')
OUT=pathlib.Path('/tmp/native-paged-int-iret-native-source-controls-r2-20261004')
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
HEAD='55d94f2894a7860c20b61b9d55e95c6797c8641c'
def digest(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(args):return subprocess.check_output(['git',*args],cwd=ROOT,timeout=10).decode().strip()
def inventory():
 seen={}
 for p in json.loads(pathlib.Path('/tmp/paged-int-iret-native-source-paths-20261004.json').read_text()):
  b=(ROOT/p).read_bytes();g=subprocess.check_output(['git','show','HEAD:'+p],cwd=ROOT,timeout=10);assert b==g,p;seen[p]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
 return {'head':git(['rev-parse','HEAD']),'status':git(['status','--porcelain']),'files':dict(sorted(seen.items())),'nodeSha256':digest(NODE),'python':os.path.realpath(sys.executable),'pythonSha256':digest(sys.executable),'wrapperSha256':digest(__file__),'sourcePathListSha256':digest('/tmp/paged-int-iret-native-source-paths-20261004.json'),'gitSha256':digest('/usr/bin/git'),'compilerTools':{p:{'realPath':str(pathlib.Path(p).resolve()),'sha256':digest(p)} for p in ['/usr/bin/g++','/usr/bin/as','/usr/bin/ld','/usr/libexec/gcc/x86_64-linux-gnu/13/cc1plus']}}
def write(name,v):(OUT/name).write_text(json.dumps(v,indent=2)+'\n')
assert not OUT.exists();OUT.mkdir();(OUT/'parent.py').write_bytes(pathlib.Path(__file__).read_bytes());before=inventory();assert before['head']==HEAD and not before['status'] and len(before['files'])==194 and before['nodeSha256']=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48';write('before.json',before)
hooks=['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT']
env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TMPDIR':'/tmp',**{k:'' for k in hooks}}
compilerInjections=['CPATH','CPLUS_INCLUDE_PATH','C_INCLUDE_PATH','LIBRARY_PATH','COMPILER_PATH','GCC_EXEC_PREFIX']
assert all(k not in env for k in compilerInjections)
argv=[str(NODE),'--max-old-space-size=128','--test','--test-name-pattern','tiny nonguest C fixture','test/i80386-paged-int-iret-native-source.test.mjs']
write('invocation.json',{'argv':argv,'cwd':str(ROOT),'scope':'ONE_AFFECTED_ACTUAL_GENERATED_C_COMPILE_EXECUTION_CASE_PRIOR_FOUR_PASS_RETAINED_NO_CPU_NO_BOCHS_BUILD_ADDON','environment':env,'absentCompilerInjectionVariables':{k:k not in env for k in compilerInjections},'blankVariables':{k:env.get(k) for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE']},'limits':{'cpuSeconds':10,'wallSeconds':30,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10}})
def bounds():
 os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(10,10));resource.setrlimit(resource.RLIMIT_FSIZE,(16<<20,16<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
start=time.monotonic();p=None;timeout=False;error=None;finalizationErrors=[]
def interrupted(signum,frame):raise RuntimeError('parent signal '+str(signum))
for signum in (signal.SIGINT,signal.SIGTERM):signal.signal(signum,interrupted)
try:
 with (OUT/'stdout').open('wb')as out,(OUT/'stderr').open('wb')as err:
  p=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=out,stderr=err,start_new_session=True,preexec_fn=bounds)
  try:p.wait(timeout=30)
  except subprocess.TimeoutExpired:timeout=True
except BaseException as e:error=repr(e)
finally:
 # Every outcome passes through group cleanup before source/tool authentication.
 # The leader may have exited while a compiler descendant is still alive.
 for signum in (signal.SIGINT,signal.SIGTERM):signal.signal(signum,signal.SIG_IGN)
 if p is not None:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  except BaseException as e:finalizationErrors.append({'probe':'killProcessGroup','error':repr(e)})
  try:p.wait(timeout=5)
  except BaseException as e:finalizationErrors.append({'probe':'reapLeader','error':repr(e)})
 result={'pid':None if p is None else p.pid,'exitCode':None if p is None else p.returncode,'timeout':timeout,'wallSeconds':time.monotonic()-start,'error':error,'finalizationErrors':finalizationErrors};write('exit.json',result)
 try:after=inventory();write('after.json',after);result['pinsEqual']=before==after
 except BaseException as e:result['afterError']=repr(e);result['pinsEqual']=False;finalizationErrors.append({'probe':'afterAuthentication','error':repr(e)})
 write('exit.json',result)
text=(OUT/'stdout').read_text() if (OUT/'stdout').exists() else '';result['tests']=int(re.search(r'^# tests (\d+)$',text,re.M)[1]) if re.search(r'^# tests (\d+)$',text,re.M) else None
result['passes']=int(re.search(r'^# pass (\d+)$',text,re.M)[1]) if re.search(r'^# pass (\d+)$',text,re.M) else None
result['failures']=int(re.search(r'^# fail (\d+)$',text,re.M)[1]) if re.search(r'^# fail (\d+)$',text,re.M) else None
result['skips']=int(re.search(r'^# skipped (\d+)$',text,re.M)[1]) if re.search(r'^# skipped (\d+)$',text,re.M) else None
write('exit.json',result);print(json.dumps(result));assert result['exitCode']==0 and not timeout and not error and not finalizationErrors and result['pinsEqual'] and result['tests']==1 and result['passes']==1 and result['failures']==0 and result['skips']==0
