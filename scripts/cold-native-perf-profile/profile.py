"""One whole-process native batched profile; no pairs or rebuild."""
import sys
sys.dont_write_bytecode=True
import os,json,hashlib,subprocess,signal,time,resource,re,pwd
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WS=Path('/home/runner/work/bw-board/bw-board')
PAIRED=WS/'paired'
SETUP=Path('/home/runner/work/_temp/cold-paired-performance/setup')
OUT=Path('/home/runner/work/_temp/cold-native-perf-profile')
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
def require(ok,message):
 if not ok:raise ValueError(message)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,value):
 raw=json.dumps(value,indent=2)+'\n';require(len(raw.encode())<=16<<20,'bounded receipt')
 with Path(p).open('x') as f:f.write(raw)
def load(p):return json.loads(Path(p).read_bytes())
def guard():
 c=load(HERE/'contract.json');require(c['status']=='SOURCE_REVIEW_PENDING_NO_PROFILE_GRANT','closed source status')
 for name,h in c['capabilityPins'].items():require(Path(name).name==name and sha(HERE/name)==h,'actual capability pin')
 r=load(HERE/'capability-result.json');require(r['status']=='SUPPORTED_FIXED_WORKLOAD_ONLY' and r['effectivePerfExecutable']['status']=='OBSERVED_ELF','actual privileged fixture capability')
 require(all(x['sha256']==c['perfElfSha256'] for x in r['effectivePerfExecutable']['records']) and r['effectivePerfExecutable']['records'],'fixed executing perf image')
 require(load(HERE/'capability-audit.json')['status'].startswith('PASS'),'independent actual capability')
 return c
def source_map():return {str(p.relative_to(ROOT)):sha(p) for p in HERE.iterdir() if p.is_file()} | {'.github/workflows/i80386-cold-native-perf-profile.yml':sha(ROOT/'.github/workflows/i80386-cold-native-perf-profile.yml')}
def authenticate_sources(c):
 for name,h in c['pairedFiles'].items():require(sha(PAIRED/name)==h,'held paired source '+name)
def paired_module(c):
 authenticate_sources(c);sys.path.insert(0,str(PAIRED/'scripts/cold-performance-paired'))
 import parent
 return parent
def git_identity(p,root,revision,files):
 root=Path(root);require(root in (WS/'native-worker',WS/'publication'),'two exact Git trust roles')
 def git(*args):return subprocess.check_output(['git','-c','safe.directory='+str(root),'-C',str(root),*args],timeout=15)
 require(git('rev-parse','HEAD').decode().strip()==revision and not git('status','--porcelain'),'clean exact source role')
 for n,h in files.items():require(p.fingerprint(root/n)['sha256']==h and hashlib.sha256(git('show',revision+':'+n)).hexdigest()==h,'full current/Git '+n)
 return {'revision':revision,'hashes':files}
def snapshot(c,p,b):
 require(b['workers']['native']['revision']==c['nativeRevision'] and b['compiledRevision']==c['compiledRevision'],'fixed qualified worker/compiled source')
 require(b['node']['sha256']==c['nodeSha256'],'fixed Node')
 return {'setupSourceProof':p.fingerprint(SETUP.parent/'profile-source.json'),'own':source_map(),'paired':{n:sha(PAIRED/n) for n in c['pairedFiles']},'worker':git_identity(p,b['workers']['native']['root'],c['nativeRevision'],b['workers']['native']['files']),'compiled':git_identity(p,b['compiledRoot'],c['compiledRevision'],b['compiledFiles']),'pins':{n:p.fingerprint(n) for n in b['pinnedFiles']},'node':p.fingerprint(b['node']['path'])}
def sample_summary(raw):
 bins={};dsos={};unresolved=0;lost=[]
 for block in re.split(r'\n\s*\n',raw):
  h=re.search(r'^\S+\s+(\d+)/(\d+)\s+',block,re.M)
  if h:bins[h.group(1)+'/'+h.group(2)]=bins.get(h.group(1)+'/'+h.group(2),0)+1
  for dso in re.findall(r'^\s+(?:[0-9a-fA-F]+\s+)?[^\n]+\s+\(([^)]+)\)\s*$',block,re.M):dsos[dso]=dsos.get(dso,0)+1
  if '[unknown]' in block:unresolved+=1
  if re.search(r'\bLOST\b|lost \d+ events',block,re.I):lost.append(block)
 return {'pidTidSamples':bins,'dsoFrameCounts':dsos,'unresolvedSampleBlocks':unresolved,'lostEventBlocks':lost,'scope':'Whole process tree; counts are sampled blocks, not removable cost or execution-only CPU shares'}
def child_environment(ordinary):
 require(set(ordinary)<=set(('HOME','USER','LOGNAME','PATH','LANG','LC_ALL','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME')),'credential-free environment whitelist')
 env=dict(ordinary)
 for h in HOOKS:env[h]=''
 env.update(PYTHONDONTWRITEBYTECODE='1',LC_ALL='C',GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_COUNT='2',GIT_CONFIG_KEY_0='safe.directory',GIT_CONFIG_VALUE_0=str(WS/'native-worker'),GIT_CONFIG_KEY_1='safe.directory',GIT_CONFIG_VALUE_1=str(WS/'publication'))
 return env
def command(p,out,name,args,cpu,wall,file_bytes,env):
 p.write(out/(name+'-invocation.json'),{'command':args,'cpuSeconds':cpu,'wallSeconds':wall,'fileBytes':file_bytes,'coreBytes':0,'niceIncrement':10,'emptyHooks':list(HOOKS)})
 def limits():
  os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(cpu,cpu));resource.setrlimit(resource.RLIMIT_FSIZE,(file_bytes,file_bytes));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 child=None;error=None;timeout=False;start=time.monotonic();observed={};processes={}
 with (out/(name+'.stdout')).open('xb') as so,(out/(name+'.stderr')).open('xb') as se:
  try:
   child=subprocess.Popen(args,cwd=out,env=env,stdout=so,stderr=se,start_new_session=True,preexec_fn=limits)
   while child.poll() is None:
    if name=='record':
     for proc in Path('/proc').glob('[0-9]*'):
      try:
       if os.getpgid(int(proc.name))!=child.pid:continue
       target=(proc/'exe').resolve();key=(proc.name,str(target))
       if key not in processes:
        processes[key]={'pid':int(proc.name),'path':str(target),'cmdline':(proc/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace'),'threadIds':[int(t.name) for t in (proc/'task').iterdir()],'maps':(proc/'maps').read_text(),'status':(proc/'status').read_text()}
       if target.name!='perf' or key in observed:continue
       raw=(proc/'exe').read_bytes();require(raw[:4]==b'\x7fELF','executing ELF')
       observed[key]={'pid':int(proc.name),'path':str(target),'sha256':hashlib.sha256(raw).hexdigest(),'maps':(proc/'maps').read_text(),'status':(proc/'status').read_text()}
      except OSError:pass
    if time.monotonic()-start>=wall:timeout=True;break
    time.sleep(.01)
  except BaseException as e:error=e
  finally:
   if child is not None:
    if error is not None or timeout or child.poll() is None:p.kill_tree(child.pid)
    try:child.wait()
    except BaseException as e:
     if error is None:error=e
 result={'exitCode':None if child is None else child.returncode,'timedOut':timeout,'wallSeconds':time.monotonic()-start,'error':None if error is None else repr(error)};p.write(out/(name+'-exit.json'),result)
 if name=='record':
  p.write(out/'executing-perf.json',list(observed.values()));p.write(out/'observed-processes.json',list(processes.values()))
 if error is not None:raise error
 return result

def main(out,node,revision):
 c=guard();require(os.geteuid()==0,'privileged controller only');require(Path(out)==OUT and OUT.resolve()==OUT and not os.path.lexists(OUT),'fixed exclusive output');OUT.mkdir();p=paired_module(c);b=p.read_json(SETUP/'derived-paired-binding.json');p.validate_ready_binding(b);capture=p.read_json(b['capture']['path']);p.validate_prerequisites(b,capture)
 before=None;input_file=None;input_sha=None;binding_sha=sha(SETUP/'derived-paired-binding.json');report={'status':'FAIL','scope':'Whole unchanged worker/process tree including startup/final proof; no speed qualification'};primary=None;perf=None
 try:
  proof=load(SETUP.parent/'profile-source.json');require(proof['hashes']==source_map() and proof['pairedRevision']==c['pairedRevision'] and proof['revision']==revision and re.fullmatch('[0-9a-f]{40}',revision),'source map from authenticated unprivileged preflight')
  before=snapshot(c,p,b);p.write(OUT/'before.json',before);p.write(OUT/'host-context.json',{'uid':os.getuid(),'euid':os.geteuid(),'context':p.host_context(),'perfParanoid':Path('/proc/sys/kernel/perf_event_paranoid').read_text()});require(Path(node)==Path(b['node']['path']) and sha(node)==c['nodeSha256'],'actual Node')
  require(all(before['pins'][n]==v for n,v in b['pinnedFiles'].items()),'setup original immutable pins')
  owner=(WS/'native-worker').stat();compiled_owner=(WS/'publication').stat();require(owner.st_uid>0 and (owner.st_uid,owner.st_gid)==(compiled_owner.st_uid,compiled_owner.st_gid),'same authenticated nonroot worker/compiled owner');require(proof['uid']==owner.st_uid and proof['gid']==owner.st_gid,'setup authenticated worker owner');account=pwd.getpwuid(owner.st_uid);require(proof['environment']['HOME']==account.pw_dir and proof['environment'].get('USER',account.pw_name)==account.pw_name,'ordinary owner home/user environment');require(set(proof['environment'])<=set(('HOME','USER','LOGNAME','PATH','LANG','LC_ALL','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME')),'credential-free environment whitelist');worker_parent=OUT/'worker-output';worker_parent.mkdir();os.chown(worker_parent,owner.st_uid,owner.st_gid)
  data=p.child_input('native-batched',b,worker_parent/'receipt');input_file=OUT/'input.json';p.write(input_file,data);input_sha=sha(input_file);binding_sha=sha(SETUP/'derived-paired-binding.json')
  perf=load(HERE/'capability-result.json')['effectivePerfExecutable']['records'][0]['path'];require(sha(perf)==c['perfElfSha256'],'same authenticated effective perf ELF')
  env=child_environment(proof['environment'])
  version=command(p,OUT,'perf-version',[perf,'--version'],5,10,8<<20,env);require(version['exitCode']==0 and not version['timedOut'],'same effective version command');require((OUT/'perf-version.stdout').read_bytes()==(HERE/'capability-version.stdout').read_bytes(),'same observed version')
  worker=[node,'--max-old-space-size=128',str(Path(b['workers']['native']['root'])/b['workers']['native']['entry']),str(input_file)]
  wrapper=[sys.executable,'-I','-B',str(HERE/'worker-entry.py'),str(owner.st_uid),str(owner.st_gid),*worker]
  record=command(p,OUT,'record',[perf,'record','-e','cpu-clock','-F','99','--call-graph','dwarf','-o',str(OUT/'perf.data'),'--',*wrapper],60,120,64<<20,env);require(record['exitCode']==0 and not record['timedOut'],'first profiled child failure, no retry')
  observed=load(OUT/'executing-perf.json');require(observed and all(x['sha256']==c['perfElfSha256'] and sha(x['path'])==c['perfElfSha256'] for x in observed),'actual executing image must match capability')
  receipt=p.read_json(OUT/'worker-output/receipt/receipt.json');require(receipt['inputSha256Before']==receipt['inputSha256After']==input_sha,'actual worker input immutable');p.validate_worker_receipt(receipt,'native-batched',data,b,capture);report['terminalParity']='PASS_FULL_NATIVE166_NQ_BOARD_RAM_HASH_PIO';p.write(OUT/'terminal-validation.json',{'status':'PASS','scope':'Held paired receipt validator; RAM hash/source-attested parity, not retained whole RAM','workerLaunch':load(worker_parent/'launch.json')})
  result=command(p,OUT,'script',[perf,'script','-i',str(OUT/'perf.data'),'--show-lost-events','-F','comm,pid,tid,time,event,ip,sym,dso'],30,60,64<<20,env);require(result['exitCode']==0 and not result['timedOut'],'raw script failure');report['samples']=sample_summary((OUT/'script.stdout').read_text());processes=load(OUT/'observed-processes.json');worker_pids={str(x['pid']) for x in processes if x['path']==str(Path(node).resolve()) and str(Path(b['workers']['native']['root'])/b['workers']['native']['entry']) in x['cmdline']};report['observedWorkerPids']=sorted(worker_pids);require(worker_pids and any(k.split('/')[0] in worker_pids for k in report['samples']['pidTidSamples']),'nonempty observed actual Node worker samples');require(not report['samples']['lostEventBlocks'],'lost events: raw evidence retained but sampling incomplete');report['unwindScope']='Unresolved frames explicitly retained; ordinary fixture proof does not qualify Bochs/JIT unwinding';report['rawPerfSha256']=sha(OUT/'perf.data');require(sha(input_file)==input_sha and sha(SETUP/'derived-paired-binding.json')==binding_sha,'input/derived binding unchanged');report['status']='PROFILE_CAPTURE_COMPLETE_NO_SPEED_CLAIM'
 except BaseException as e:primary=e;report['error']=repr(e);raise
 finally:
  final=None
  try:
   after=snapshot(c,p,b);p.write(OUT/'after.json',after);require(after==before,'all source/artifact/Node maps unchanged');report['beforeAfterEqual']=True
   require(sha(SETUP/'derived-paired-binding.json')==binding_sha,'derived binding unchanged on every outcome')
   if input_file is not None:require(sha(input_file)==input_sha,'worker input unchanged on every outcome')
   if perf is not None:require(sha(perf)==c['perfElfSha256'],'effective perf unchanged')
  except BaseException as e:final=e;report['status']='FAIL';report['finalizationError']=repr(e)
  p.write(OUT/'result.json',report)
  for f in OUT.rglob('*'):
   if f.is_file() and not f.is_symlink():f.chmod(f.stat().st_mode|0o444)
  if final is not None and primary is None:raise final
if __name__=='__main__':
 for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,lambda s,f:(_ for _ in ()).throw(InterruptedError(str(s))))
 require(len(sys.argv)==4,'closed output Node and dispatched source HEAD');main(*sys.argv[1:])
