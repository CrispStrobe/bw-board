"""Closed root-owned disabled/enable/disable recorder; PENDING refuses all effects."""
import sys
sys.dont_write_bytecode=True
import os,json,hashlib,subprocess,resource,signal,socket,struct,select,time,secrets,pwd
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WS=Path('/home/runner/work/bw-board/bw-board')
WORKER=WS/'symbol-worker';COMPILED=WS/'publication'
OUT=Path('/home/runner/work/_temp/cold-ledger-scalars-native-symbol')
SETUP=OUT/'setup-record.json'
SCHEMA='bw.cold-ledger-scalars.native-symbol.control.v1'
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
ENV_KEYS={'HOME','USER','LOGNAME','PATH','LANG','LC_ALL','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME'}
ACTIVE={}
def require(ok,message):
 if not ok:raise ValueError(message)
def fingerprint(path):
 p=Path(path);require(p.is_absolute() and str(p)==str(p.resolve()) and p.is_file() and not p.is_symlink(),'ordinary exact path')
 h=hashlib.sha256();size=0
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(65536),b''):size+=len(chunk);require(size<=256<<20,'bounded file');h.update(chunk)
 return {'bytes':size,'sha256':h.hexdigest()}
def load(path):
 p=Path(path);require(p.stat().st_size<=8<<20,'bounded metadata');return json.loads(p.read_bytes())
def write(path,value):
 raw=json.dumps(value,indent=2)+'\n';require(len(raw.encode())<=16<<20,'bounded receipt')
 with Path(path).open('x') as f:f.write(raw)
def source_guard():
 b=load(HERE/'profile-binding.json');require(b['status']=='ROOT_REVIEWED_NATIVE_SYMBOL_DIAGNOSTIC_READY','PENDING before tools, worker, recorder or guest')
 require(b['defaultEnabled'] is False and b['baseWorkerRevision']=='06581f3831aa765933b1d160a41ab37b1b652913','fixed separate observer profile')
 for name,key in [('qualification-audit.json','qualificationAuditSha256'),('paired-audit.json','pairedAuditSha256'),('held-source-context.json','heldContextSha256')]:require(fingerprint(HERE/name)['sha256']==b[key],'owned audit/base pin')
 for name,h in b['capabilityPins'].items():require(Path(name).name==name and fingerprint(HERE/name)['sha256']==h,'owned actual capability pin')
 q=load(HERE/'qualification-audit.json');require(q['status']=='PASS' and q['worker']['revision']==b['baseWorkerRevision'] and q['worker']['sourceSha256']==b['baseSourceSha256'],'actual unchanged scalar qualification')
 cap=load(HERE/'capability-result.json');require(cap['status']=='SUPPORTED_FIXED_WORKLOAD_ONLY' and cap['effectivePerfExecutable']['status']=='OBSERVED_ELF','actual ordinary-fixture capability only')
 require(load(HERE/'capability-audit.json')['status']=='PASS','independent ordinary capability')
 require(cap['effectivePerfExecutable']['records'] and all(r['sha256']==b['perfElfSha256'] for r in cap['effectivePerfExecutable']['records']),'held effective image')
 return b,cap
def child_environment(ordinary):
 require(set(ordinary)<=ENV_KEYS and ordinary.get('HOME') and ordinary.get('PATH'),'authenticated ordinary-owner environment')
 env=dict(ordinary);env.update({h:'' for h in HOOKS});env.update(PYTHONDONTWRITEBYTECODE='1',LC_ALL='C',DEBUGINFOD_URLS='',GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_COUNT='2',GIT_CONFIG_KEY_0='safe.directory',GIT_CONFIG_VALUE_0=str(WORKER),GIT_CONFIG_KEY_1='safe.directory',GIT_CONFIG_VALUE_1=str(COMPILED));return env
def git_identity(root,revision,files):
 root=Path(root);require(root in (WORKER,COMPILED),'only two explicit Git trust roots')
 def git(*args):return subprocess.check_output(['git','-c','safe.directory='+str(root),'-C',str(root),*args],timeout=10,env={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'})
 require(git('rev-parse','HEAD').decode().strip()==revision and not git('status','--porcelain').strip(),'clean fixed Git role')
 for p,h in files.items():
  require(not Path(p).is_absolute() and '..' not in Path(p).parts,'relative source role');require(fingerprint(root/p)['sha256']==h==hashlib.sha256(git('show',revision+':'+p)).hexdigest(),'current/Git '+p)
 return {'revision':revision,'hashes':files}
def terminate(child):
 if child is None:return
 # Stop the owned group before discovering descendants, including descendants
 # that created another session. This is cleanup, never a sampling scope claim.
 parents={child.pid};stopped=set()
 try:os.killpg(child.pid,signal.SIGSTOP)
 except ProcessLookupError:pass
 for _ in range(6):
  changed=False
  for entry in Path('/proc').iterdir():
   if not entry.name.isdecimal():continue
   try:
    fields=(entry/'stat').read_text().rsplit(')',1)[1].split();number=int(entry.name);ppid=int(fields[1])
    if number==child.pid or ppid in parents:
     if number not in parents:parents.add(number);changed=True
     if number not in stopped:os.kill(number,signal.SIGSTOP);stopped.add(number)
   except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError,IndexError):pass
  if not changed:break
 for number in stopped:
  try:os.kill(number,signal.SIGKILL)
  except ProcessLookupError:pass
 try:os.killpg(child.pid,signal.SIGKILL)
 except ProcessLookupError:pass
 child.wait(timeout=5)
def limits(cpu,file_bytes):
 def apply():
  os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(cpu,cpu));resource.setrlimit(resource.RLIMIT_FSIZE,(file_bytes,file_bytes));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 return apply
def launch(name,args,env,cpu,file_bytes):
 write(OUT/(name+'-invocation.json'),{'command':args,'cpuSeconds':cpu,'fileBytes':file_bytes,'coreBytes':0,'niceIncrement':10,'scope':'Separate observer diagnostic; worker Node heap flag unchanged'})
 so=(OUT/(name+'.stdout')).open('xb');se=(OUT/(name+'.stderr')).open('xb')
 try:child=subprocess.Popen(args,cwd=OUT,env=env,stdout=so,stderr=se,start_new_session=True,preexec_fn=limits(cpu,file_bytes));ACTIVE[name]=child;return child
 except BaseException as error:
  write(OUT/(name+'-launch-error.json'),{'error':repr(error),'exitCode':None,'childCreated':False});raise
 finally:so.close();se.close()
def observed_process(pid):
 p=Path('/proc')/str(pid);raw=(p/'exe').read_bytes();require(raw[:4]==b'\x7fELF','actual executing inode ELF')
 return {'pid':pid,'executable':str((p/'exe').resolve()),'imageSha256':hashlib.sha256(raw).hexdigest(),'cmdline':(p/'cmdline').read_bytes().split(b'\0')[:-1],'status':(p/'status').read_text(),'threadIds':sorted(int(t.name) for t in (p/'task').iterdir()),'maps':(p/'maps').read_text()}
def threads(pid):return sorted(int(p.name) for p in (Path('/proc')/str(pid)/'task').iterdir())
def remaining_budget(started,cap=None):
 left=120-(time.monotonic()-started);require(left>0,'absolute child wall120 exhausted')
 return left if cap is None else min(left,cap)
def recorder_environment():
 return {'PATH':'/usr/bin:/bin','HOME':str(OUT/'perf-home'),'XDG_CONFIG_HOME':str(OUT/'perf-home'),'XDG_CACHE_HOME':str(OUT/'perf-home'),'PERF_CONFIG':'/dev/null','LC_ALL':'C','DEBUGINFOD_URLS':'','PYTHONDONTWRITEBYTECODE':'1',**{h:'' for h in HOOKS}}
def final_guards(report,guards):
 for name,read,expected in guards:
  try:report.setdefault('after',{})[name]=read();require(report['after'][name]==expected,name+' unchanged')
  except BaseException as error:report.setdefault('finalizationErrors',{})[name]=repr(error);report['status']='FAIL'
def finish_children(report,connection,worker,worker_started):
 # Recorder failure must not race otherwise attainable outside-loop proof.
 for name,child in list(ACTIVE.items()):
  if child is worker:continue
  try:
   if child.poll() is None:terminate(child)
   write(OUT/(name+'-final-exit.json'),{'exitCode':child.returncode})
  except BaseException as error:report.setdefault('cleanupErrors',{})[name]=repr(error)
 if connection is not None:
  try:connection.close()
  except BaseException as error:report.setdefault('cleanupErrors',{})['controlSocket']=repr(error)
 if worker is not None:
  grace=max(0,min(10,120-(time.monotonic()-worker_started)))
  report['workerProofGraceSeconds']=grace
  try:
   if worker.poll() is None and grace>0:
    try:worker.wait(timeout=grace)
    except subprocess.TimeoutExpired:pass
   if worker.poll() is None:terminate(worker)
   write(OUT/'worker-final-exit.json',{'exitCode':worker.returncode})
  except BaseException as error:
   report.setdefault('cleanupErrors',{})['worker']=repr(error)
   try:terminate(worker)
   except BaseException as secondary:report.setdefault('cleanupErrors',{})['workerReap']=repr(secondary)
def terminal_projection(receipt):
 require(receipt['schema']=='bw.cold-native-ledger-scalars-symbol-profile.worker.v1' and receipt.get('guestStatus')=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS','attainable completed guest proof, independent of observer status')
 require(receipt['observerScope']=='DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION','fixed observer scope')
 projected=dict(receipt);projected['schema']='bw.cold-native-memory-fusion-ledger-scalars-performance.worker.v1';projected['status']=receipt['guestStatus'];return projected
def terminal_audit(setup):
 # Metadata-only import of the exact held terminal validator; never q.main/setup.
 qroot=WS/'qualifier';context=setup['qualifierSourceContext']
 require(fingerprint(HERE/'qualifier-source-context.json')['sha256']==load(HERE/'profile-binding.json')['qualifierSourceContextSha256'],'fixed terminal-validator source context')
 for name,h in context['hashes'].items():require(fingerprint(qroot/name)['sha256']==h,'terminal validator current bytes '+name)
 sys.path.insert(0,str(qroot/'scripts/cold-ledger-scalars-qualification'));import qualify as q
 receipt_dir=Path(load(OUT/'input.json')['output']);success=receipt_dir/'receipt.json';failure=receipt_dir/'failure.json';require(success.exists()!=failure.exists(),'one original worker outcome')
 receipt=load(success if success.exists() else failure);data=load(OUT/'input.json');capture=load(Path(data['capture']))
 return {'status':'HELD_FULL_TERMINAL_PARITY_PASS','rawReceipt':fingerprint(success if success.exists() else failure),'metrics':q.terminal(terminal_projection(receipt),data,setup['nativeBinding'],capture),'scope':'Raw receipt unchanged; only diagnostic schema/status projected for held semantic validation'}
def read_message(connection,timeout=5):
 deadline=time.monotonic()+timeout;raw=b''
 while b'\n' not in raw:
  remaining=deadline-time.monotonic();require(remaining>0,'absolute worker message deadline');ready,_,_=select.select([connection],[],[],remaining);require(ready,'bounded worker message timeout');part=connection.recv(4096);require(part,'worker control EOF');raw+=part;require(len(raw)<=4096,'bounded worker control message')
 line,rest=raw.split(b'\n',1);require(not rest,'duplicate control frame');return json.loads(line)
def send_message(connection,value):connection.sendall((json.dumps(value,separators=(',',':'))+'\n').encode())
def checked_control_stderr(expected=None,offset=0):
 path=OUT/'record.stderr';require(path.is_file() and path.stat().st_size<=8<<20,'bounded retained recorder stderr')
 raw=path.read_bytes();require(not any(x in raw for x in (b"failed: can't find",b'failed: wrong command')),'perf selector refused despite ACK')
 if expected is not None:require(expected in raw[offset:].splitlines(),'missing exact named selector success before ACK')
 return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
class RecorderControl:
 """Serialized source-owned perf commands; a timeout ends this session permanently."""
 def __init__(self,write_fd,read_fd,perf,worker_started=None):self.write_fd=write_fd;self.read_fd=read_fd;self.perf=perf;self.failed=False;self.records=[];self.worker_started=time.monotonic() if worker_started is None else worker_started
 def command(self,name,sequence):
  commands={('enable',-2):'enable',('disable',0):'disable cpu-clock',('enable',1):'enable cpu-clock',('disable',2):'disable cpu-clock'}
  require(not self.failed and (name,sequence) in commands,'closed live perf command');require(self.perf.poll() is None,'recorder alive');command=commands[name,sequence]
  before=time.monotonic_ns();record={'command':command,'sessionSequence':sequence,'controllerBeforeNs':str(before),'status':'ATTEMPT','rawAck':None};self.records.append(record)
  try:
   stderr_before=checked_control_stderr()['bytes']
   require(not select.select([self.read_fd],[],[],0)[0],'stale or duplicate perf ACK');os.write(self.write_fd,(command+'\n').encode());ready,_,_=select.select([self.read_fd],[],[],remaining_budget(self.worker_started,5));require(ready,'bounded perf ACK timeout');raw=os.read(self.read_fd,64);record['rawAck']=raw.decode(errors='replace');require(raw==b'ack\n','exact single perf ACK')
   stderr=checked_control_stderr(None if sequence==-2 else ('Event cpu-clock '+('enabled' if name=='enable' else 'disabled')).encode(),stderr_before)
   record.update(status='PASS',stderrAtAck=stderr,controllerAfterNs=str(time.monotonic_ns()),scope='perf ACK has no sequence field; this authenticated single-writer channel is serialized, any failure permanently ends session')
  except BaseException as error:
   self.failed=True;record.update(status='FAIL',error=repr(error),controllerAfterNs=str(time.monotonic_ns()))
   try:
    path=OUT/'record.stderr';require(path.is_file() and path.stat().st_size<=8<<20,'bounded retained failure stderr');raw=path.read_bytes();record['stderrAtFailure']={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'rawExcerpt':raw[:4096].decode(errors='replace'),'fullRawPath':str(path)}
   except BaseException as secondary:record['stderrEvidenceError']=repr(secondary)
   try:terminate(self.perf)
   except BaseException as secondary:record['cleanupError']=repr(secondary)
   raise

class WindowState:
 def __init__(self,pid,uid,gid):self.pid=pid;self.uid=uid;self.gid=gid;self.nonce=secrets.token_hex(32);self.phase='NEW';self.sequence=0;self.records=[]
 def accept(self,message):
  require(self.phase in ('NEW','READY','ENABLED'),'closed completed control session')
  extra={'beginNs','endNs'} if self.phase=='ENABLED' else set();require(set(message)=={'schema','type','seq','pid','session'}|extra,'exact control fields')
  require(message['schema']==SCHEMA and message['pid']==self.pid and type(message['seq'])is int and message['seq']==self.sequence,'actual PID/ordered sequence')
  require(message['session']==(None if self.phase=='NEW' else self.nonce),'fresh owned session')
  expected={'NEW':'hello','READY':'enable','ENABLED':'disable'}[self.phase];require(message['type']==expected,'no duplicate, late or out-of-order request')
  if extra:
   for name in extra:require(type(message[name])is str and message[name].isascii() and message[name].isdecimal() and len(message[name])<=20,'bounded raw marker')
   require(int(message['endNs'])>=int(message['beginNs']),'ordered worker markers')
  self.records.append(message);self.sequence+=1;return expected
 def response(self,kind,proof=None):
  self.phase={'ready':'READY','enabled':'ENABLED','disabled':'STOPPED'}[kind]
  r={'schema':SCHEMA,'type':kind,'seq':self.sequence-1,'pid':self.pid,'session':self.nonce,'controllerMonotonicNs':str(time.monotonic_ns())}
  if proof is not None:r['proof']=proof
  return r
def main():
 b,cap=source_guard() # Before tools, output creation or child launch.
 require(os.geteuid()==0 and ROOT==WORKER,'root controller in authenticated worker role');setup=load(SETUP);owner=WORKER.stat();require(owner.st_uid>0 and (owner.st_uid,owner.st_gid)==(COMPILED.stat().st_uid,COMPILED.stat().st_gid)==(setup['uid'],setup['gid']),'common ordinary source owner')
 setup_result=load(OUT/'setup'/'setup-result.json');require(setup_result['status']=='STATIC_RESTORE_SOURCE_AUTH_PASS_NO_GUEST_OR_RECORDER' and not setup_result.get('finalizationErrors'),'completed independent setup guards')
 require(OUT.is_dir() and not OUT.is_symlink() and OUT.stat().st_uid==owner.st_uid,'new owned diagnostic output only');os.chown(OUT,0,0);os.chmod(OUT,0o711)
 account=pwd.getpwuid(owner.st_uid);require(setup['environment']['HOME']==account.pw_dir,'ordinary owner HOME');env=child_environment(setup['environment'])
 require(setup['worker']['root']==str(WORKER) and setup['worker']['entry']=='scripts/cold-native-ledger-scalars-symbol-profile/worker.mjs','fixed diagnostic role')
 before=None;primary=None;report={'status':'FAIL','scope':'DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION; conservative acknowledged window only'};listener=None;connection=None;fds=[];worker=None;perf=None;tool_pins={};worker_started=None
 def snapshot():
  return {'worker':git_identity(WORKER,setup['worker']['revision'],setup['worker']['files']),'compiled':git_identity(COMPILED,b['compiledRevision'],setup['compiledFiles']),'immutable':{p:fingerprint(p) for p in setup['pinnedFiles']},'setup':fingerprint(SETUP),'input':fingerprint(OUT/'input.json')}
 try:
  before=snapshot();require(before['immutable']==setup['pinnedFiles'],'all source/restoration/original evidence pins');write(OUT/'before.json',before)
  held_context=load(HERE/'held-source-context.json');own_paths={str(p.relative_to(ROOT)) for p in HERE.iterdir() if p.is_file()}|{'test/i80386-cold-ledger-scalars-symbol-profile-source.test.mjs'}
  require(set(setup['worker']['files'])==set(held_context['hashes'])|own_paths,'complete closed diagnostic source closure')
  require(all(setup['worker']['files'][p]==h for p,h in held_context['hashes'].items()),'unchanged original73 inputs')
  compiled_context=load(WORKER/'scripts/cold-native-memory-fusion-ledger-scalars-performance/compiled-source-context.json');require(setup['compiledFiles']==compiled_context['hashes'],'complete fixed compiled151 context')
  require(setup['worker']['sourceSha256']==hashlib.sha256(json.dumps({'revision':setup['worker']['revision'],'hashes':dict(sorted(setup['worker']['files'].items()))},separators=(',',':')).encode()).hexdigest(),'complete canonical diagnostic source identity')
  node=setup['node'];require(fingerprint(node)['sha256']==b['nodeSha256'],'fixed Node');data=load(OUT/'input.json');require(data['workerRevision']==setup['worker']['revision'] and data['workerSourceSha256']==setup['worker']['sourceSha256'] and data['output']==b['output'] and data['mode']=='batched' and data['sha256']==b['addonSha256'],'fixed immutable diagnostic input')
  perf_path=cap['effectivePerfExecutable']['records'][0]['path'];require(fingerprint(perf_path)['sha256']==b['perfElfSha256'],'same effective actual capability image')
  tool_pins={node:fingerprint(node),perf_path:fingerprint(perf_path),str(Path(sys.executable).resolve()):fingerprint(Path(sys.executable).resolve())};report['toolsBefore']=tool_pins
  (OUT/'perf-home').mkdir();perf_env=recorder_environment()
  for name,args in [('version',[perf_path,'--version']),('help',[perf_path,'record','-h'])]:
   child=launch(name,args,perf_env,5,8<<20)
   try:child.wait(timeout=10)
   except BaseException:terminate(child);raise
   write(OUT/(name+'-exit.json'),{'exitCode':child.returncode})
   if name=='version':require(child.returncode==0,'effective version command success')
  require((OUT/'version.stdout').read_bytes()==(HERE/'capability-version.stdout').read_bytes(),'same effective version output');help_raw=(OUT/'help.stdout').read_bytes()+(OUT/'help.stderr').read_bytes();require(all(x in help_raw for x in (b'--control',b'--delay',b'--clockid',b'--call-graph',b'--no-buildid',b'--no-buildid-cache')),'all actual option support before worker')
  parent=OUT/'worker-output';require(not parent.exists(),'exclusive worker parent');parent.mkdir();os.chown(parent,owner.st_uid,owner.st_gid)
  listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);listener.bind(str(OUT/'control.sock'));os.chown(OUT/'control.sock',owner.st_uid,owner.st_gid);os.chmod(OUT/'control.sock',0o600);listener.listen(1);listener.settimeout(15)
  wrapper=[sys.executable,'-I','-B',str(HERE/'worker-entry.py'),str(owner.st_uid),str(owner.st_gid),node,'--max-old-space-size=128',str(WORKER/setup['worker']['entry']),str(OUT/'input.json')];worker_started=time.monotonic();worker=launch('worker',wrapper,env,60,16<<20)
  listener.settimeout(remaining_budget(worker_started,15));connection,_=listener.accept();peer=struct.unpack('3i',connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));require(peer==(worker.pid,owner.st_uid,owner.st_gid),'actual connected owner/PID')
  node_observed=observed_process(worker.pid);require(node_observed['imageSha256']==b['nodeSha256'] and node_observed['cmdline']==[x.encode() for x in wrapper[6:]],'observed unchanged Node CLI');node_observed['cmdline']=[x.decode() for x in node_observed['cmdline']];report['workerObserved']=node_observed
  ctl_read,ctl_write=os.pipe();ack_read,ack_write=os.pipe();fds=[ctl_read,ctl_write,ack_read,ack_write]
  args=[perf_path,'record','--no-buildid','--no-buildid-cache','-e','cpu-clock','-e','dummy:u','-F','99','--call-graph','dwarf,8192','--delay=-1','--control=fd:'+str(ctl_read)+','+str(ack_write),'--clockid','mono','-p',str(worker.pid),'-o',str(OUT/'perf.data')]
  write(OUT/'record-invocation.json',{'command':args,'cpuSeconds':60,'wallSeconds':120,'fileBytes':64<<20,'coreBytes':0,'niceIncrement':10,'scope':'Existing process attach, initially disabled; no system-wide sampling'})
  perf_started=time.monotonic()
  with (OUT/'record.stdout').open('xb') as so,(OUT/'record.stderr').open('xb') as se:perf=subprocess.Popen(args,cwd=OUT,env=perf_env,stdout=so,stderr=se,start_new_session=True,preexec_fn=limits(60,64<<20),pass_fds=(ctl_read,ack_write));ACTIVE['record']=perf
  deadline=time.monotonic()+remaining_budget(worker_started,5);image=None
  while time.monotonic()<deadline and perf.poll() is None:
   try:image=observed_process(perf.pid);break
   except FileNotFoundError:time.sleep(.01)
  require(image is not None and image['imageSha256']==b['perfElfSha256'],'observed executing perf inode before release');image['cmdline']=[x.decode(errors='replace') for x in image['cmdline']];report['perfObserved']=image
  control=RecorderControl(ctl_write,ack_read,perf,worker_started);report['controlRecords']=control.records;control.command('enable',-2);control.command('disable',0);report['trackingScope']='Global enable while worker blocked before provider/addon; then cpu-clock-only disable before READY. Dummy sideband remains enabled. Pre-ready waiting samples may exist; only conservative active ACK window is attributable.';state=WindowState(worker.pid,owner.st_uid,owner.st_gid);report['controlRecords']=control.records;report['workerControlRecords']=state.records;message=read_message(connection,remaining_budget(worker_started,5));state.accept(message);initial_threads=threads(worker.pid);report['attachedExistingTids']=initial_threads;send_message(connection,state.response('ready',{'disabledAck':True,'effectivePerfSha256':image['imageSha256'],'uid':owner.st_uid,'gid':owner.st_gid,'threadIds':initial_threads}))
  state.accept(read_message(connection,remaining_budget(worker_started,5)));report['workerMapsBeforeActiveEnable']=(Path('/proc')/str(worker.pid)/'maps').read_text();control.command('enable',1);send_message(connection,state.response('enabled'));tid_observations=[];report['observedExistingAndLaterTids']=tid_observations
  while not select.select([connection],[],[],remaining_budget(worker_started,.01))[0]:
   require(worker.poll() is None and perf.poll() is None,'bounded active window');remaining_budget(perf_started);tid_observations.append({'controllerNs':str(time.monotonic_ns()),'tids':threads(worker.pid)})
  state.accept(read_message(connection,remaining_budget(worker_started,5)));control.command('disable',2);send_message(connection,state.response('disabled'));connection.close();connection=None
  report.update(controlRecords=control.records,workerControlRecords=state.records,observedExistingAndLaterTids=tid_observations,clockProof='UNPROVEN_SAME_CLOCK; no execution-only timestamp clipping or percentages')
  # Stop recording outside the worker loop; proof/close proceeds with events disabled.
  os.write(ctl_write,b'stop\n');worker.wait(timeout=remaining_budget(worker_started));perf.wait(timeout=remaining_budget(perf_started,30));write(OUT/'record-exit.json',{'exitCode':perf.returncode});write(OUT/'worker-exit.json',{'exitCode':worker.returncode})
  report['threadCoverage']='Observed existing/later worker TIDs only; actual perf COMM/FORK and sample PID/TID coverage must be audited from raw recording, not inferred from attach'
  require(perf.returncode==0 and worker.returncode==0,'first recorder/worker failure; no retry');report['status']='RAW_DISABLED_ENABLE_DISABLE_RECORDING_REQUIRES_TERMINAL_AND_SAMPLE_AUDIT'
 except BaseException as error:primary=error;report['error']=repr(error);raise
 finally:
  finish_children(report,connection,worker,worker_started)
  for value in (listener,):
   if value is not None:
    try:value.close()
    except BaseException as error:report.setdefault('cleanupErrors',{})['socket']=repr(error)
  for fd in fds:
   try:os.close(fd)
   except OSError:pass
  # Terminal evidence is independently attempted even after a recorder failure.
  if worker is not None:
   try:report['terminalAudit']=terminal_audit(setup)
   except BaseException as error:report['terminalAuditError']=repr(error);report['status']='FAIL'
  # A source read failure must not suppress attainable independent input evidence.
  report['after']={}
  guards={'worker':lambda:git_identity(WORKER,setup['worker']['revision'],setup['worker']['files']),'compiled':lambda:git_identity(COMPILED,b['compiledRevision'],setup['compiledFiles']),'setup':lambda:fingerprint(SETUP),'input':lambda:fingerprint(OUT/'input.json')}
  for name,read in guards.items():
   try:report['after'][name]=read();require(before is not None and report['after'][name]==before[name],name+' unchanged')
   except BaseException as error:report.setdefault('finalizationErrors',{})[name]=repr(error)
  report['after']['immutable']={}
  for path,expected in setup['pinnedFiles'].items():
   try:report['after']['immutable'][path]=fingerprint(path);require(report['after']['immutable'][path]==expected,'immutable input unchanged')
   except BaseException as error:report.setdefault('finalizationErrors',{})['immutable:'+path]=repr(error)
  final_guards(report,[("tool:"+path,lambda p=path:fingerprint(p),expected) for path,expected in tool_pins.items()])
  if report.get('cleanupErrors') or report.get('finalizationErrors'):report['status']='FAIL'
  write(OUT/'result.json',report)
  if primary is None and report['status']=='FAIL':raise ValueError('retained cleanup/finalization failure')
def interrupted(signum,frame):raise InterruptedError('controller signal '+str(signum))
if __name__=='__main__':
 require(len(sys.argv)==1,'no caller source/output/tool authority')
 for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,interrupted)
 main()
