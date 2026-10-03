"""Closed manual nonguest perf capability; never installs or alters privilege."""
import sys
sys.dont_write_bytecode=True
import os,json,hashlib,pathlib,platform,re,resource,shutil,signal,subprocess,time
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[1]
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
FILES=('scripts/cold-perf-privileged-capability/control.py','scripts/cold-perf-privileged-capability/workload.cc','scripts/cold-perf-privileged-capability/README.md','scripts/cold-perf-privileged-capability/test_control.py','.github/workflows/i80386-cold-perf-privileged-capability.yml')
def require(ok,msg):
 if not ok:raise ValueError(msg)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def source():
 head=subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'rev-parse','HEAD'],cwd=ROOT,text=True).strip();require(not subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'status','--porcelain'],cwd=ROOT),'clean source')
 hashes={p:sha(ROOT/p) for p in FILES}
 for p,h in hashes.items():require(hashlib.sha256(subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'show',head+':'+p],cwd=ROOT)).hexdigest()==h,'current/Git '+p)
 return {'revision':head,'hashes':hashes}
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def text(p):
 try:return pathlib.Path(p).read_text()[:1<<20]
 except OSError as e:return {'unavailable':str(e)}
def observe_effective_perf(pid,known=()):
 observations=[]
 # Only the root-owned record process group and its current descendants.
 try:group=os.getpgid(pid)
 except ProcessLookupError:return []
 for proc in pathlib.Path('/proc').glob('[0-9]*'):
  try:
   candidate=int(proc.name)
   if os.getpgid(candidate)!=group:continue
   exe=(proc/'exe').resolve()
   if (candidate,str(exe)) in known:continue
   raw=(proc/'exe').read_bytes()
   if exe.name!='perf' or raw[:4]!=b'\x7fELF':continue
   observations.append({'pid':candidate,'path':str(exe),'sha256':hashlib.sha256(raw).hexdigest(),'elf':True,'maps':text(proc/'maps'),'status':text(proc/'status')})
  except (OSError,ValueError):continue
 return observations

def authenticate_effective(item):
 require(sha(item['path'])==item['sha256'],'executing ELF bytes must match version target')

def command(out,name,args,cpu=5,wall=10):
 env=os.environ.copy()
 for key in HOOKS:env[key]=''
 env.pop('GH_TOKEN',None);env['LC_ALL']='C';env['PYTHONDONTWRITEBYTECODE']='1'
 require(all(not env[k] for k in HOOKS),'empty hooks')
 def limits():
  os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(cpu,cpu));resource.setrlimit(resource.RLIMIT_FSIZE,(8<<20,8<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 write(out/(name+'-invocation.json'),{'command':args,'cwd':str(out),'cpuSeconds':cpu,'wallSeconds':wall,'fileBytes':8<<20,'coreBytes':0,'niceIncrement':10,'emptyHooks':list(HOOKS),'scope':'NONGUEST_FIXED_WORKLOAD_ONLY'})
 started=time.monotonic();timeout=False;child=None;primary=None;observed={}
 with (out/(name+'.stdout')).open('xb') as so,(out/(name+'.stderr')).open('xb') as se:
  try:
   child=subprocess.Popen(args,cwd=out,env=env,stdout=so,stderr=se,start_new_session=True,preexec_fn=limits)
   try:
    if name=='record':
     deadline=started+wall
     while child.poll() is None:
      for item in observe_effective_perf(child.pid,{(key[0],key[1]) for key in observed}):observed[(item['pid'],item['path'],item['sha256'])]=item
      if time.monotonic()>=deadline:raise subprocess.TimeoutExpired(args,wall)
      time.sleep(.005)
     child.wait()
    else:child.wait(timeout=wall)
   except subprocess.TimeoutExpired:timeout=True
   except BaseException as error:primary=error
  except BaseException as error:primary=error
  finally:
   if child is not None and child.poll() is None:
    try:os.killpg(child.pid,signal.SIGSTOP);os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    try:child.wait()
    except BaseException as error:
     if primary is None:primary=error
 if name=='record':write(out/'effective-perf-observed.json',list(observed.values()))
 result={'exitCode':None if child is None else child.returncode,'timedOut':timeout,'wallSeconds':time.monotonic()-started,'launchOrWaitError':None if primary is None else repr(primary)};write(out/(name+'-exit.json'),result)
 if primary is not None:raise primary
 return result

PERF_OPTIONS=('-e','cpu-clock','-F','99','--call-graph','dwarf')
def classify(samples,workload_stdout,record):
 if record['exitCode']!=0 or record['timedOut']:return 'REFUSED_OR_RECORD_FAILED'
 tids=set(re.findall(r'WORKLOAD_TID (\d+)',workload_stdout));sample_tids=set(re.findall(r'^\S+\s+(\d+)/(\d+)\s+',samples,re.M));observed={tid for pid,tid in sample_tids}
 if re.search(r'\bLOST\b|lost \d+ events',samples,re.I):return 'INSUFFICIENT_LOST_EVENTS'
 if len(tids)!=2 or not tids<=observed:return 'INSUFFICIENT_THREAD_COVERAGE'
 # Resolved nested frames are evidence of this workload, not Bochs unwind proof.
 blocks=re.split(r'\n\s*\n',samples)
 resolved=set()
 for block in blocks:
  header=re.search(r'^\S+\s+(\d+)/(\d+)\s+',block,re.M)
  frames=re.findall(r'^\s+(?:[0-9a-fA-F]+\s+)?(leaf|middle|chain)(?:\+0x[0-9a-fA-F]+)?\s+\((?:[^)]+/)?workload\)\s*$',block,re.M)
  if header and frames==['leaf','middle','chain']:resolved.add(header.group(2))
 if not tids<=resolved:return 'INSUFFICIENT_UNWIND'
 return 'SUPPORTED_FIXED_WORKLOAD_ONLY'
def main(out):
 require(os.geteuid()==0,'explicit privileged nonguest controller requires UID0')
 out=pathlib.Path(out);require(out.is_absolute() and out.resolve()==out and out.parent.is_dir() and not os.path.lexists(out),'exclusive output');out.mkdir();before=source();write(out/'source-before.json',before)
 context={'mode':'EXPLICIT_PRIVILEGED_NONGUEST_FIXED_FIXTURE','uid':os.getuid(),'euid':os.geteuid(),'platform':platform.platform(),'uname':list(platform.uname()),'cpuInfo':text('/proc/cpuinfo'),'logicalCpus':os.cpu_count(),'perfEventParanoid':text('/proc/sys/kernel/perf_event_paranoid'),'selfCgroup':text('/proc/self/cgroup'),'osRelease':text('/etc/os-release')};write(out/'host-context.json',context);report={'status':'FAIL','scope':'NONGUEST_CAPABILITY_ONLY_NO_ADDON_GUEST_BOCHS_BUILD_OR_PRIVILEGE_CHANGE'}
 try:
  perf=shutil.which('perf');compiler=shutil.which('g++');report['tools']={k:None if v is None else {'path':str(pathlib.Path(v).resolve()),'sha256':sha(pathlib.Path(v).resolve()),'scope':'requested launcher executable only; delegation not authenticated'} for k,v in [('perf',perf),('compiler',compiler)]}
  if not perf or not compiler:report['status']='UNSUPPORTED_MISSING_TOOL';return
  for name,tool in [('perf',perf),('compiler',compiler)]:
   result=command(out,name+'-version',[tool,'--version']);require(result['exitCode']==0 and not result['timedOut'],'tool version failure')
  binary=out/'workload';result=command(out,'compile',[compiler,'-O2','-fPIC','-pthread',str(HERE/'workload.cc'),'-o',str(binary)],cpu=10,wall=15)
  require(result['exitCode']==0 and not result['timedOut'],'nonguest workload compile failed');report['workloadSha256']=sha(binary)
  record=command(out,'record',[perf,'record',*PERF_OPTIONS,'-o',str(out/'perf.data'),'--',str(binary)],cpu=5,wall=10)
  if record['exitCode']!=0 or record['timedOut']:report['status']='REFUSED_OR_RECORD_FAILED';return
  script=command(out,'script',[perf,'script','-i',str(out/'perf.data'),'--show-lost-events','-F','comm,pid,tid,time,event,ip,sym,dso'],cpu=5,wall=10)
  if script['exitCode']!=0 or script['timedOut']:report['status']='INSUFFICIENT_SCRIPT_CAPABILITY';return
  report['status']=classify((out/'script.stdout').read_text(),(out/'record.stdout').read_text(),record)
  effective=json.loads((out/'effective-perf-observed.json').read_text());report['effectivePerfExecutable']={'status':'OBSERVED_ELF' if effective else 'NOT_OBSERVED','records':effective,'scope':'record-active group observation; not blanket delegated-process authority'}
  for i,item in enumerate(effective):
   authenticate_effective(item);version=command(out,'effective-perf-version-'+str(i),[item['path'],'--version']);require(version['exitCode']==0 and not version['timedOut'],'effective perf version failure')
  if not effective:report['status']='INSUFFICIENT_EFFECTIVE_PERF_PROVENANCE'
  report['rawPerfSha256']=sha(out/'perf.data');report['coverage']='Two fixed workload TIDs only; full raw record/callchains retained; not native addon or JIT unwind qualification'
 except BaseException as error:
  report['status']='FAIL';report['error']=repr(error);raise
 finally:
  final_error=None
  try:
   after=source();write(out/'source-after.json',after);require(after==before,'source unchanged');report['sourceBeforeAfterEqual']=True
   for item in report.get('effectivePerfExecutable',{}).get('records',[]):authenticate_effective(item)
   for item in report.get('tools',{}).values():
    if item:require(sha(item['path'])==item['sha256'],'tool unchanged')
  except BaseException as error:
   final_error=error;report['finalizationError']=repr(error);report['status']='FAIL';write(out/'source-after-unavailable.json',{'error':repr(error)})
  write(out/'result.json',report)
  for file in out.iterdir():
   if file.is_file() and not file.is_symlink():file.chmod(file.stat().st_mode|0o444)
  if final_error is not None and 'error' not in report:raise final_error
def interrupted(signum,frame):raise InterruptedError('control signal '+str(signum))
if __name__=='__main__':
 for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,interrupted)
 require(len(sys.argv)==3 and sys.argv[1]=='--privileged-nonguest','explicit fixed privileged mode and one output');main(sys.argv[2])
