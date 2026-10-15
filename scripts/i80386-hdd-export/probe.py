"""Bounded two-session ordinary CLI owner. Run only through reviewed workflow."""
import argparse,errno,fcntl,hashlib,json,math,os,re,resource,selectors,signal,stat,struct,subprocess,sys,termios,time
from pathlib import Path
OPEN=b'\x1b[?1049h\x1b[?25l\x1b[?1003h\x1b[?1006h\x1b[?1004h'
CLOSE=b'\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?25h\x1b[?1049l'
FRAME=b'\x1b[H\x1b[2J';END=b'\x1b[0m'
RAW_CAP=16*1024*1024;STDERR_CAP=65536;TAIL_CAP=16384;FRAME_CAP=4096
STABLE_STEPS=1500000
SIZE=10653696
class Refusal(ValueError):pass

def need(value,code):
 if not value:raise Refusal(code)

class Frames:
 def __init__(self):self.pending=b'';self.started=False;self.closed=False;self.count=0;self.last=-1;self.raw_count=0;self.limit=None;self.consumed=0;self.frames=[]
 def feed(self,chunk):
  self.raw_count+=len(chunk);need(self.raw_count<=RAW_CAP,'raw-cap');self.pending+=chunk;result=[]
  while self.pending:
   if not self.started:
    if len(self.pending)<len(OPEN):need(OPEN.startswith(self.pending),'terminal-open');break
    need(self.pending.startswith(OPEN),'terminal-open');self.pending=self.pending[len(OPEN):];self.consumed+=len(OPEN);self.started=True;continue
   if self.closed:raise Refusal('bytes-after-terminal-close')
   if CLOSE.startswith(self.pending):
    if len(self.pending)<len(CLOSE):break
    self.pending=self.pending[len(CLOSE):];self.consumed+=len(CLOSE);self.closed=True;continue
   if self.pending.startswith(CLOSE):self.pending=self.pending[len(CLOSE):];self.consumed+=len(CLOSE);self.closed=True;continue
   if len(self.pending)<len(FRAME):need(FRAME.startswith(self.pending),'frame-marker');break
   need(self.pending.startswith(FRAME),'frame-marker')
   end=self.pending.find(END,len(FRAME))
   if end<0:need(len(self.pending)<=TAIL_CAP,'frame-tail-cap');break
   body=self.pending[len(FRAME):end];start=self.consumed;self.consumed+=end+len(END);self.pending=self.pending[end+len(END):]
   need(len(body)<=TAIL_CAP,'frame-cap');need(b'\x1b' not in body,'frame-escape')
   try:text=body.decode('utf-8')
   except UnicodeDecodeError:raise Refusal('frame-utf8')
   text=text.replace('\r\n','\n');need('\r' not in text,'frame-cr');lines=text.split('\n')
   need(len(lines)==26 and all(len(x)==80 for x in lines[1:]),'frame-body-shape');need(all(32<=ord(c)<=126 or 160<=ord(c)<=255 for row in lines[1:] for c in row),'frame-body-character')
   match=re.fullmatch(r'386 AT  step ([0-9]{1,9})/([0-9]{1,9})  text RAM  Ctrl-\] quit  Ctrl-L redraw',lines[0])
   need(match is not None,'frame-header-text-mode');step,limit=map(int,match.groups());need(0<=self.last<=step<=limit if self.last>=0 else 0<=step<=limit,'frame-step');self.last=step
   need(limit==120000000 and (self.limit is None or self.limit==limit),'frame-budget-changed');self.limit=limit
   self.count+=1;need(self.count<=FRAME_CAP,'frame-count-cap');frame={'ordinal':self.count,'step':step,'limit':limit,'lines':lines[1:],'start':start,'end':self.consumed,'bodySha256':hashlib.sha256(body.split(b'\n',1)[1]).hexdigest()};result.append(frame);self.frames.append(frame)
  return result
 def finish(self):need(not self.pending and self.started and self.closed and self.count>0,'truncated-or-unclosed-terminal')

class Inputs:
 """Finite prospective DOS command states; manufactured frames only here."""
 def __init__(self,writer=True):self.state='boot';self.writer=writer;self.offers=[];self.last_offer=0;self.entered=False;self.candidate=None;self.offer_start_boundary=0;self.raw_seen=0;self.elapsed_ns=0
 def offer(self,data,frame,next_state):
  command=data.rstrip(b'\r').decode('ascii').lower()
  if command.startswith(('echo ','type ')):
   need(not any(x.rstrip(' ').lower()=='a:\\>'+command for x in frame['lines']),'preexisting-expected-command-echo')
  need(len(self.offers)<5,'input-count-cap');self.offers.append({'offerOrdinal':len(self.offers)+1,'frameOrdinal':frame['ordinal'],'frameStep':frame['step'],'rawBytesSeen':self.raw_seen,'elapsedNs':self.elapsed_ns,'bytesHex':data.hex(),'writtenBytes':0});self.last_offer=frame['ordinal'];self.state=next_state;self.candidate=None;return data
 def observe(self,frame):
  lines=[x.rstrip(' ') for x in frame['lines']];joined='\n'.join(lines)
  prompt=lambda s:s=='A:\\>'
  if self.state=='boot':
   if 'Do you want to proceed' in joined:return self.offer(b'n\r',frame,'decline')
   if not self.entered and re.search(r'press \[ENTER\]|Select from Menu',joined,re.I):self.entered=True;return self.offer(b'\r',frame,'boot')
  elif self.state=='decline' and frame['ordinal']>self.last_offer:
   if any(re.search(r'installation of FreeDOS .* has been aborted',x,re.I) is not None for x in lines) and any(prompt(x) for x in lines):
    return self.offer(b'echo bw-hdd-persist-ok>c:\\bwkeep.txt\r' if self.writer else b'type c:\\bwkeep.txt\r',frame,'write-prompt' if self.writer else 'type-output')
  elif self.state=='write-prompt' and frame['ordinal']>self.last_offer:
   echoes=[i for i,x in enumerate(lines)if x.lower()=='a:\\>echo bw-hdd-persist-ok>c:\\bwkeep.txt']
   valid=bool(echoes and any(prompt(x)for x in lines[echoes[-1]+1:]))
   if not valid:self.candidate=None
   elif self.candidate is not None and self.candidate['lines']==lines and frame['step']-self.candidate['step']>=STABLE_STEPS:return self.offer(b'type c:\\bwkeep.txt\r',frame,'type-output')
   elif self.candidate is None or self.candidate['lines']!=lines:self.candidate={'step':frame['step'],'lines':lines}
  elif self.state in ('type-output','stable') and frame['ordinal']>self.last_offer:
   echoes=[i for i,x in enumerate(lines)if x.lower()=='a:\\>type c:\\bwkeep.txt']
   markers=[i for i,x in enumerate(lines)if x=='bw-hdd-persist-ok']
   valid=bool(echoes and any(i>echoes[-1] and any(prompt(x)for x in lines[i+1:])for i in markers))
   if valid:
    if self.candidate is not None and self.candidate['lines']==lines and frame['step']-self.candidate['step']>=STABLE_STEPS:return self.offer(b'\x1d',frame,'quit-offered')
    if self.candidate is None or self.candidate['lines']!=lines:self.candidate={'step':frame['step'],'lines':lines}
    self.state='stable'
   else:self.candidate=None;self.state='type-output'
  return b''
 def finish(self):need(self.state=='quit-offered','missing-later-prompt-or-stability')

def group_alive(pid):
 try:os.killpg(pid,0);return True
 except ProcessLookupError:return False

def latest_offer(parser,inputs,frames):
 if not frames:return b'',None
 latest=frames[-1]
 if latest['ordinal']<=inputs.offer_start_boundary:return b'',latest
 offered=inputs.observe(latest)
 if offered:
  partial=bool(parser.pending) and (FRAME.startswith(parser.pending) or parser.pending.startswith(FRAME))
  inputs.offer_start_boundary=parser.count+(1 if partial else 0)
 return offered,latest

def batch_offer(parser,inputs,data):
 return latest_offer(parser,inputs,parser.feed(data))

def drain_pty(fd,parser,raw,deadline):
 """Validate/retain all currently available bytes before any input decision."""
 frames=[];eof_kind=None
 while True:
  need(time.monotonic()<deadline,'wall-limit')
  try:data=os.read(fd,4096)
  except BlockingIOError:break
  except OSError as error:
   if error.errno!=errno.EIO:raise
   eof_kind='eio';break
  if not data:eof_kind='eof';break
  room=RAW_CAP-len(raw);raw.extend(data[:room]);need(len(data)<=room,'pty-cap')
  frames.extend(parser.feed(data))
 return frames,eof_kind

def observe_exit_without_reap(pid):
    # WNOWAIT retains this leader's identity until all group signals are finished.
    event=os.waitid(os.P_PID,pid,os.WEXITED|os.WNOHANG|os.WNOWAIT)
    return event is not None

def run_session(argv,session,child,outer_deadline):
 """Own one real CLI process; no producer result is final acceptance."""
 need(all(hasattr(os,key)for key in ('waitid','WNOWAIT','WEXITED','WNOHANG','P_PID')),'waitid-wnowait-unavailable')
 try:os.waitid(os.P_PID,os.getpid(),os.WEXITED|os.WNOHANG|os.WNOWAIT)
 except ChildProcessError:pass
 except OSError:raise Refusal('waitid-wnowait-unavailable')
 wall=600;writer=child==1;environment=child_environment(session,child);before_resource=resource_observation()
 master=slave=None;process=None;selector=None;primary=None;secondary=[];raw=bytearray();err=bytearray();events=[];eof=False;stderr_eof=False;reaped=False;exited=False;usage=None;process_identity=None;parser=Frames();inputs=Inputs(writer);started=time.monotonic();start_ns=time.monotonic_ns();exit_code=None
 def record(kind,**fields):
  phase='reaped'if reaped else'exited-unreaped'if exited else'running'if process else'pre-spawn'
  row={key:None for key in ['pid','pgid','signal','inputOrdinal','status','errorCode','attemptedBytes','writtenBytes','bytesHex']}
  row.update(ordinal=len(events)+1,kind=kind,elapsedNs=time.monotonic_ns()-start_ns,phase=phase,pid=process.pid if process else None,pgid=process.pid if process else None)
  row.update(fields);events.append(row)
 def retain(error):
  nonlocal primary
  if primary is None:primary=error
  else:secondary.append(type(error).__name__)
 def signal_owned(sig):
  need(not reaped,'signal-after-reap-forbidden')
  os.killpg(process.pid,sig);record('group-signal',signal=sig)
 try:
  master,slave=os.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0))
  process=subprocess.Popen(argv,cwd=session,env=environment,stdin=slave,stdout=slave,stderr=subprocess.PIPE,start_new_session=True,close_fds=True,preexec_fn=child_limits)
  record('spawn');need(os.getpgid(process.pid)==process.pid,'owned-group')
  process_identity=owned_identity(process.pid,start_ns,session)
  os.close(slave);slave=None;os.set_blocking(master,False);os.set_blocking(process.stderr.fileno(),False)
  selector=selectors.DefaultSelector();selector.register(master,selectors.EVENT_READ,'pty');selector.register(process.stderr,selectors.EVENT_READ,'stderr')
  while not(eof and stderr_eof and exited):
   need(time.monotonic()-started<wall and time.monotonic()<outer_deadline,'wall-limit');watch_report_cap(session,child)
   if not exited and observe_exit_without_reap(process.pid):exited=True;record('exit-observed-wnowait')
   for key,_ in selector.select(.02):
    if key.data=='pty':
     frames,end=drain_pty(master,parser,raw,min(started+wall,outer_deadline))
     # EIO is EOF only once the leader is observed exited but still waitable.
     if end in ('eof','eio') and not exited and observe_exit_without_reap(process.pid):
      exited=True;record('exit-observed-wnowait')
     if end in ('eof','eio') and exited:
      selector.unregister(key.fileobj);eof=True;record('pty-eof')
     if end is None:
      inputs.raw_seen=len(raw);inputs.elapsed_ns=time.monotonic_ns()-start_ns
      offered,latest=latest_offer(parser,inputs,frames)
      if offered:
       written=os.write(master,offered);inputs.offers[-1]['writtenBytes']=written
       record('input-write',inputOrdinal=len(inputs.offers),attemptedBytes=len(offered),writtenBytes=written,bytesHex=offered.hex())
       need(written==len(offered),'input-short-write')
       record('input',inputOrdinal=len(inputs.offers),bytesHex=offered.hex())
     continue
    try:data=os.read(key.fd,4096)
    except BlockingIOError:continue
    if not data:
     if not exited and observe_exit_without_reap(process.pid):exited=True;record('exit-observed-wnowait')
     if exited:selector.unregister(key.fileobj);stderr_eof=True;record('stderr-eof')
     continue
    room=STDERR_CAP-len(err);err.extend(data[:room]);need(len(data)<=room,'stderr-cap')
  need(not err,'child-stderr');parser.finish();inputs.finish()
 except BaseException as error:retain(error)
 finally:
  if process is not None:
   # The leader remains waitable through the last possible group signal.
   try:
    if not exited:
     signal_owned(signal.SIGTERM)
     until=time.monotonic()+.25
     while time.monotonic()<until:
      if observe_exit_without_reap(process.pid):exited=True;record('exit-observed-wnowait');break
      time.sleep(.01)
    # Kill remaining members before releasing the leader identity, even if it
    # already exited. ESRCH simply means this still-owned group is empty.
    try:signal_owned(signal.SIGKILL)
    except ProcessLookupError:pass
   except BaseException as error:retain(error)
   try:
    until=time.monotonic()+5
    while True:
     pid,status,ru=os.wait4(process.pid,os.WNOHANG)
     if pid==process.pid:
      exit_code=os.waitstatus_to_exitcode(status);process.returncode=exit_code;reaped=True
      usage={'userSeconds':ru.ru_utime,'systemSeconds':ru.ru_stime,'maxRssKiB':ru.ru_maxrss}
      record('wait4-reap',status=status);break
     need(time.monotonic()<until,'cleanup-reap-timeout');time.sleep(.01)
    if exit_code!=0 and primary is None:retain(Refusal('child-exit'))
   except BaseException as error:retain(error)
  for cleanup in [lambda:selector.close()if selector else None,lambda:process.stderr.close()if process and process.stderr else None,lambda:os.close(master)if master is not None else None,lambda:os.close(slave)if slave is not None else None]:
   try:cleanup()
   except BaseException as error:retain(error)
 group_empty=None
 if process is not None:
  try:
   group_empty=not group_alive(process.pid);record('group-empty-query')
   if not group_empty:retain(Refusal('postreap-group-reuse-or-cleanup-uncertain'))
  except BaseException as error:retain(error)
 after_resource=None
 try:after_resource=resource_observation();need_no_oom(before_resource,after_resource)
 except BaseException as error:retain(error)
 if any(e['kind']=='group-signal'and e['phase']!='exited-unreaped'for e in events) and primary is None:retain(Refusal('forced-stop-not-user-quit'))
 if primary is not None:record('failure',errorCode=str(primary))
 return {'raw':bytes(raw),'stderr':bytes(err),'framesInternal':parser.frames,'offers':{'schema':'bw.hdd-session-input.v1','writer':writer,'offers':inputs.offers},
  'lifecycle':{'schema':'bw.hdd-cli-lifecycle.v1','child':child,'argv':argv,'environment':environment,'cwdRole':'session-root','pid':process.pid if process else 0,'pgid':process.pid if process else 0,'operationalWallLimitSeconds':600,'cleanupLimitSeconds':5,'exitCode':exit_code,'primaryFailure':str(primary)if primary else None,'secondaryFailures':secondary,'timeout':str(primary)=='wall-limit','reaped':reaped,'ptyEof':eof,'stderrEof':stderr_eof,'groupEmpty':group_empty,'cleanupUncertain':not reaped or group_empty is not True or bool(secondary),'events':events,'wait4Usage':usage,'resourceBefore':before_resource,'resourceAfter':after_resource,'ownedProcessIdentity':process_identity}}

PINS={'bios':(65536,'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),'vga':(38400,'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'),'floppy':(1228800,'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'),'initial':(SIZE,'2fa9c252f22cec4f8c5bdc82d1587293ffcaed791e0982384628d19a7316a851')}
COMMANDS={'enter':b'\r','decline':b'n\r','write':b'echo bw-hdd-persist-ok>c:\\bwkeep.txt\r','read':b'type c:\\bwkeep.txt\r','quit':b'\x1d'}
KEYS=dict(zip('qwertyuiop',range(16,26)));KEYS.update(zip('asdfghjkl',range(30,39)));KEYS.update(zip('zxcvbnm',range(44,51)));KEYS.update({'-':12,'.':52,'\\':43,' ':57,';':39,'\r':28})

def sha(data):return hashlib.sha256(data).hexdigest()

def regular_bytes(path,cap,exact=None):
 fd=None;primary=None
 try:
  fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_CLOEXEC|os.O_NOFOLLOW);s=os.fstat(fd)
  need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=cap and(exact is None or s.st_size==exact),'regular-byte-role')
  chunks=[];remaining=cap+1
  while remaining:
   b=os.read(fd,min(65536,remaining))
   if not b:break
   chunks.append(b);remaining-=len(b)
  data=b''.join(chunks);need(len(data)==s.st_size and len(data)<=cap and os.fstat(fd).st_size==s.st_size,'role-extent-drift');return data
 except BaseException as error:primary=error;raise
 finally:
  if fd is not None:
   try:os.close(fd)
   except BaseException as close_error:
    if primary is None:raise
    primary.add_note('secondary-close: '+type(close_error).__name__)

def strict_json(data):
 need(len(data)<=4*1024*1024,'json-cap');text=data.decode('utf8');depth=0;quoted=escape=False
 for c in text:
  if quoted:
   if escape:escape=False
   elif c=='\\':escape=True
   elif c=='"':quoted=False
  elif c=='"':quoted=True
  elif c in '[{':depth+=1;need(depth<=32,'json-depth')
  elif c in ']}':depth-=1;need(depth>=0,'json-depth')
 def pairs(rows):
  out={}
  for k,v in rows:need(k not in out,'json-duplicate');out[k]=v
  return out
 def bad(_):raise Refusal('json-nonfinite')
 value=json.loads(text,object_pairs_hook=pairs,parse_constant=bad);pending=[value];count=0
 while pending:
  v=pending.pop();count+=1;need(count<=200000,'json-nodes')
  if type(v)is dict:pending.extend(v.keys());pending.extend(v.values())
  elif type(v)is list:pending.extend(v)
  elif type(v)is str:need(len(v.encode('utf8'))<=1048576,'json-string')
  elif type(v)in(int,float):need(abs(v)<=2**53-1 and math.isfinite(v),'json-number')
 return value

def write_new(path,data):
 path=Path(path);path.parent.mkdir(mode=0o700,exist_ok=True)
 with path.open('xb')as f:f.write(data)

def json_new(path,value):write_new(path,(json.dumps(value,sort_keys=True,indent=2)+'\n').encode())

def binary_identity(path,role):
 resolved=Path(path).resolve(strict=True);s=resolved.stat();need(stat.S_ISREG(s.st_mode)and 0<s.st_size<=256*1024*1024,'runtime-binary')
 h=hashlib.sha256()
 with resolved.open('rb')as f:
  while True:
   b=f.read(65536)
   if not b:break
   h.update(b)
 version=subprocess.check_output([str(resolved),'--version'],timeout=10,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'},stderr=subprocess.STDOUT).decode().strip()
 return {'role':role,'path':str(path),'realpath':str(resolved),'byteLength':s.st_size,'sha256':h.hexdigest(),'version':version}

def runtime_inventory(session,provenance):
 rows=[binary_identity('runtime/bin/node','node'),binary_identity('/usr/bin/python3','python'),binary_identity('/usr/bin/git','git')];need(rows[0]['version']=='v22.23.3','node-version')
 return {'schema':'bw.hdd-cli-runtime.v2','profile':'hosted-observed-runtime-identity.v1','provenance':provenance,'rows':rows,'sourceBuildAuthenticityQualified':False,'completeElfStdlibClosureQualified':False}

def child_environment(session,child):
 hdd='inputs/initial.img'if child==1 else'outputs/first.img'
 return {'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','TERM':'xterm','AT_BIOS_ROM':'inputs/bios.bin','AT_BIOS_SHA256':PINS['bios'][1],'VGA_BIOS_ROM':'inputs/vga.bin','VGA_BIOS_SHA256':PINS['vga'][1],'AT_HDD_SHA256':sha(regular_bytes(hdd,SIZE,SIZE)),'AT_FLOPPY_SHA256':PINS['floppy'][1],'AT_CONSOLE_REPORT':f'outputs/child{child}-report.json','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}

def resource_observation():
 row=Path('/proc/self/cgroup').read_text().strip().splitlines();need(len(row)==1 and row[0].startswith('0::/system.slice/bw-hdd-export-'),'owned-cgroup')
 rel=row[0][3:];base=Path('/sys/fs/cgroup'+rel);cpu=(base/'cpu.max').read_text().strip();memory=(base/'memory.max').read_text().strip();swap=(base/'memory.swap.max').read_text().strip();affinity=sorted(os.sched_getaffinity(0))
 need(cpu=='100000 100000'and memory=='1073741824'and swap=='0'and len(affinity)==1,'resource-readback')
 events={k:int(v)for k,v in(line.split()for line in(base/'memory.events').read_text().splitlines())}
 names=['low','high','max','oom','oom_kill','oom_group_kill'];need(all(k in events for k in names),'memory-event-shape')
 return {'cgroupRole':rel,'cpuMax':cpu,'memoryMaxBytes':int(memory),'swapMaxBytes':int(swap),'affinityCpus':affinity,'memoryEvents':{k:events[k]for k in names}}

def need_no_oom(before,after):
 need(all(before[k]==after[k]for k in['cgroupRole','cpuMax','memoryMaxBytes','swapMaxBytes','affinityCpus']),'resource-drift')
 need(all(after['memoryEvents'][k]>=before['memoryEvents'][k]for k in before['memoryEvents']),'resource-counter-regression')
 need(all(after['memoryEvents'][k]==before['memoryEvents'][k]for k in['oom','oom_kill','oom_group_kill']),'oom-observed')

def child_limits():
 resource_observation();resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_NOFILE,(64,64));resource.setrlimit(resource.RLIMIT_CPU,(600,600));resource.setrlimit(resource.RLIMIT_FSIZE,(SIZE,SIZE))

def owned_identity(pid,start_ns,session):
 path=f'/proc/{pid}/exe';resolved=os.readlink(path);h=hashlib.sha256();extent=0
 with open(path,'rb')as f:
  while True:
   data=f.read(65536)
   if not data:break
   extent+=len(data);need(extent<=256*1024*1024,'owned-exe-cap');h.update(data)
 cmd=Path(f'/proc/{pid}/cmdline').read_bytes();need(len(cmd)<=16384 and cmd.endswith(b'\0'),'owned-command')
 argv=[b.decode('utf8')for b in cmd[:-1].split(b'\0')];expected=Path('runtime/bin/node').resolve();need(Path(resolved)==expected,'owned-node-exe')
 return {'pid':pid,'exeRealpath':resolved,'exeByteLength':extent,'exeSha256':h.hexdigest(),'argv':argv,'observedElapsedNs':time.monotonic_ns()-start_ns}

def watch_report_cap(session,child):
 p=Path(f'outputs/child{child}-report.json')
 try:s=p.lstat()
 except FileNotFoundError:return
 need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=4*1024*1024,'report-live-cap')

def media_inventory(stage):
 rows=[]
 for role,file in [('bios','inputs/bios.bin'),('vga','inputs/vga.bin'),('floppy','inputs/floppy.img'),('initial','inputs/initial.img')]+([('first','outputs/first.img')]if stage in('between','after')else[])+([('second','outputs/second.img')]if stage=='after'else[]):
  size=PINS[role][0]if role in PINS else SIZE;data=regular_bytes(file,size,size)
  if role in PINS:need(sha(data)==PINS[role][1],'pinned-input-drift-'+role)
  rows.append({'role':role,'byteLength':len(data),'sha256':sha(data),'regular':True})
 return {'schema':'bw.hdd-cli-media.v1','stage':stage,'rows':rows}

def source_after(before):
 rows=[]
 for row in before['rows']:
  b=regular_bytes(Path('source')/row['path'],2*1024*1024);need(len(b)==row['byteLength']and sha(b)==row['sha256'],'source-drift');rows.append(row)
 env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
 def git(*args):return subprocess.check_output(['/usr/bin/git','-C','source',*args],env=env,timeout=10).decode().strip()
 need(git('rev-parse','HEAD')==before['head']and git('rev-parse','HEAD^{tree}')==before['tree']and not git('status','--porcelain'),'source-git-drift');return {**before,'rows':rows}

def scans(data):
 out=[]
 for c in data.decode('ascii'):
  if c=='\x1d':continue
  shifted=c in '>:';code=KEYS[{'>':'.',':':';'}.get(c,c)]
  if shifted:out.append(42)
  out.extend([code,code|128])
  if shifted:out.append(170)
 return out

def validate_session(result,report,source,source_map,child):
 life=result['lifecycle'];need(life['primaryFailure']is None and not life['secondaryFailures']and life['exitCode']==0 and life['reaped']and life['ptyEof']and life['stderrEof']and life['groupEmpty']is True and not life['timeout']and not life['cleanupUncertain'],'session-lifetime')
 need(not result['stderr'],'session-stderr');need(report['executionRevision']==source['head']and report['stop']=='user-quit'and report['refusal']is None and type(report['steps'])is int and report['steps']<120000000,'session-report-stop')
 expected={key:next(row['sha256']for row in source['rows']if row['path']==path)for key,path in source_map['consoleMap'].items()};need(report['sourceSha256']==expected,'report-source-map')
 flags=['expandedGroupedAdmission','registerStackAdmission','nativeBlocks','code16Loads','code16Wasm'];need(all(report['inputs'][k]is False for k in flags)and report['inputs']['dosboxConfig']is None and report['inputs']['events']==sha(b'[]')and report['inputs']['mouseEnabled']is True,'ordinary-report')
 need(report['nativeStats']is None and report['code16WasmStats']is None and report['code16LoadExecutions']==0,'ordinary-backend')
 offers=result['offers']['offers'];names=(['enter']if len(offers)==(5 if child==1 else 4)else[])+['decline']+(['write']if child==1 else[])+['read','quit'];need(len(offers)==len(names),'offer-language')
 expected_codes=[];segments=[]
 for name,offer in zip(names,offers):
  need(offer['bytesHex']==COMMANDS[name].hex()and offer['writtenBytes']==len(COMMANDS[name]),'offer-bytes');code=scans(COMMANDS[name]);segments.append((name,len(expected_codes),len(code)));expected_codes+=code
 delivered=report['delivered'];need(type(delivered)is list and len(delivered)==len(expected_codes),'delivered-count');last=-1024
 for e,c in zip(delivered,expected_codes):
  need(set(e)=={'step','type','code','accepted'}and e['type']=='live-key'and e['accepted']is True and type(e['code'])is int and e['code']==c,'delivered-code');need(type(e['step'])is int and e['step']%1024==0 and last+1024<=e['step']<=report['steps'],'delivered-step');last=e['step']
 frames=result['framesInternal'];need(all(f['step']<=report['steps']for f in frames),'frame-final-step')
 for index,(name,offset,count)in enumerate(segments):
  offer=offers[index];need(frames[offer['frameOrdinal']-1]['end']<=offer['rawBytesSeen']<=len(result['raw'])-len(CLOSE),'offer-raw-boundary')
  if not count:continue
  need(delivered[offset]['step']>=offer['frameStep'],'delivery-before-offer');next_offer=offers[index+1];response=frames[next_offer['frameOrdinal']-1]
  need(response['start']>=offer['rawBytesSeen']and response['step']>delivered[offset+count-1]['step'],'response-before-delivery')
 out=report['hddOutput'];hdd='inputs/initial.img'if child==1 else'outputs/first.img';output='outputs/first.img'if child==1 else'outputs/second.img'
 need(out['complete']is True and out['guestCompletionQualified']is False and out['input']['sha256']==sha(regular_bytes(hdd,SIZE,SIZE))and out['output']['sha256']==sha(regular_bytes(output,SIZE,SIZE))and report['diskSha256']==out['output']['sha256'],'stored-output-join')
 need(out['output']['boundary']['cpuCycles']==report['cpu']['cycles']and out['output']['boundary']['machineCycles']==report['machineCycles'],'stored-boundary')
 need(life['ownedProcessIdentity']['argv']==life['argv'],'owned-argv')

ROLE_CAPS=[('admission.json',65536),('source-before.json',262144),('source-after.json',262144),('runtime-before.json',262144),('runtime-after.json',262144),('media-before.json',16384),('media-between.json',16384),('media-after.json',16384),('result.json',65536),('initial.img',SIZE),('first.img',SIZE),('second.img',SIZE)]+[(f'child{c}/{name}',cap)for c in(1,2)for name,cap in[('report.json',4194304),('pty.bin',RAW_CAP),('stderr.bin',STDERR_CAP),('offers.json',16384),('lifecycle.json',262144),('frames.json',8388608)]]
RESOURCE_POLICY={'cpuMax':'100000 100000','memoryMaxBytes':1073741824,'swapMaxBytes':0,'affinityCount':1,'childWallSeconds':600,'outerWallSeconds':1250,'oomDeltas':0}
RUNTIME_POLICY={'profile':'hosted-observed-runtime-identity.v1','nodeVersion':'v22.23.3','roles':['node','python','git'],'sourceBuildAuthenticityQualified':False,'completeElfStdlibClosureQualified':False}
PROTOCOL_POLICY={'steps':120000000,'stableStepCalls':1500000,'commands':{k:v.hex()for k,v in COMMANDS.items()},'rawCap':RAW_CAP,'frameCap':FRAME_CAP,'stderrCap':STDERR_CAP,'reportCap':4194304,'secondExportsReadback':True}
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')

def finalize_index():
 rows=[];total=0
 allowed={name for name,_ in ROLE_CAPS}|{'index.json'}
 actual={p.relative_to('originals').as_posix()for p in Path('originals').rglob('*')if p.is_file()or p.is_symlink()};need(actual<=allowed,'unexpected-original-role')
 for name,cap in ROLE_CAPS:
  path=Path('originals')/name
  if path.exists()or path.is_symlink():
   data=regular_bytes(path,cap);total+=len(data);rows.append({'name':name,'state':'present','byteLength':len(data),'sha256':sha(data)})
  else:rows.append({'name':name,'state':'absent','byteLength':None,'sha256':None})
 need(total<=96*1024*1024,'decoded-packet-cap');json_new('originals/index.json',{'schema':'bw.hdd-cli-index.v1','roles':rows})

def provenance(head):
 env=os.environ
 need(env.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board'and env.get('GITHUB_RUN_ATTEMPT')=='1'and env.get('ImageOS')=='ubuntu24','hosted-provenance')
 # Job ID is admitted by the coordinator against official job metadata; it is
 # not inferred from a runner-local sequence number.
 job=env.get('BW_OFFICIAL_JOB_ID','');need(job.isdecimal()and int(job)>0,'official-job-id-required')
 path='.github/workflows/i80386-hdd-export.yml'
 blob=subprocess.check_output(['/usr/bin/git','-C','source','rev-parse',f'HEAD:{path}'],timeout=10,env={'PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}).decode().strip()
 return {'repository':'CrispStrobe/bw-board','head':head,'workflowPath':path,'workflowBlob':blob,'runId':int(env['GITHUB_RUN_ID']),'runAttempt':1,'jobId':int(job),'runnerName':env['RUNNER_NAME'],'runnerImageOS':env['ImageOS'],'runnerImageVersion':env['ImageVersion'],'checkoutAction':'11d5960a326750d5838078e36cf38b85af677262','setupNodeAction':'49933ea5288caeca8642d1e84afbd3f7d6820020','uploadAction':'ea165f8d65b6e75b540449e92b4886f43607fa02'}

def save_child(result,child):
 base=Path(f'originals/child{child}');base.mkdir(mode=0o700)
 write_new(base/'pty.bin',result['raw']);write_new(base/'stderr.bin',result['stderr']);json_new(base/'offers.json',result['offers']);json_new(base/'lifecycle.json',result['lifecycle'])
 rows=[{'frameOrdinal':f['ordinal'],'frameStep':f['step'],'stepLimit':f['limit'],'frameStartRawOffset':f['start'],'endRawOffset':f['end'],'textBodySha256':f['bodySha256']}for f in result['framesInternal']]
 json_new(base/'frames.json',{'schema':'bw.hdd-cli-frames.v1','child':child,'stepDomain':'console-machine-step-calls','frames':rows})
 path=Path(f'outputs/child{child}-report.json')
 if path.exists():write_new(base/'report.json',regular_bytes(path,4194304))
 output=Path('outputs/first.img'if child==1 else'outputs/second.img')
 if output.exists():write_new('originals/first.img'if child==1 else'originals/second.img',regular_bytes(output,SIZE,SIZE))

def run_packet(session,expected_head,media_review):
 need(re.fullmatch('[0-9a-f]{40}',expected_head)is not None and re.fullmatch('[0-9a-f]{64}',media_review)is not None,'external-admission-format')
 os.chdir(session);source=strict_json(regular_bytes('originals/source-before.json',262144));mapping=strict_json(regular_bytes('source-map.json',262144));need(source['head']==expected_head,'expected-source-head');need(media_review=='93a1119016e7e9d2a963ce4491199698e852739f9d20b3b7b0f5fdfe10c41795','public-media-policy')
 before=None;first=None;secondary=[];passed=[False,False];deadline=time.monotonic()+1250
 def retain(error):
  nonlocal first
  if first is None:first=error
  elif error is not first:secondary.append(str(error))
 try:
  need(source_after(source)==source,'source-preflight');before=runtime_inventory(session,provenance(expected_head));json_new('originals/runtime-before.json',before)
  resource_observation();json_new('originals/media-before.json',media_inventory('before'))
  hashes={r['path']:r['sha256']for r in source['rows']};console={key:hashes[path]for key,path in mapping['consoleMap'].items()};common={p:h for p,h in hashes.items()if p not in mapping['consoleMap'].values()}
  need(len(console)==79 and set(common)==set(mapping['commonPaths']),'closed-source-map')
  admission={'schema':'bw.hdd-cli-admission.v1','sourceHead':source['head'],'sourceTree':source['tree'],'consoleMapSha256':sha(canonical(console)),'commonMapSha256':sha(canonical(common)),'runtimeIdentityPolicySha256':sha(canonical(RUNTIME_POLICY)),'mediaReviewSha256':media_review,'resourcePolicySha256':sha(canonical(RESOURCE_POLICY)),'protocolSha256':sha(canonical(PROTOCOL_POLICY)),'inputGeometry':{'cylinders':306,'heads':4,'sectors':17},'childGuestSteps':120000000,'stableStepCalls':1500000,'childWallSeconds':600,'outerWallSeconds':1250,'secondExportsReadback':True,'authority':'external-reviewed-inputs-required','runtimeProfile':'hosted-observed-runtime-identity.v1'}
  json_new('originals/admission.json',admission)
  prior_resource=None
  for child in(1,2):
   need(time.monotonic()<deadline,'outer-wall-limit');need(runtime_inventory(session,before['provenance'])==before,'runtime-before-child-drift')
   argv=['runtime/bin/node','source/scripts/run-i80386-at-console.mjs','--hdd-image','inputs/initial.img'if child==1 else'outputs/first.img','--geometry','306,4,17','--floppy-image','inputs/floppy.img','--steps','120000000','--live','--hdd-output','outputs/first.img'if child==1 else'outputs/second.img']
   if prior_resource is not None:need_no_oom(prior_resource,resource_observation())
   captured=run_session(argv,session,child,deadline)
   # Capture failure predates any artifact copy/admission failure. Retain it
   # before fallible saves, and never launch a successor after uncertainty.
   failure=captured['lifecycle']['primaryFailure']
   if failure is not None:retain(Refusal(failure))
   secondary.extend(captured['lifecycle']['secondaryFailures'])
   try:save_child(captured,child)
   except BaseException as error:retain(error)
   if first is not None:raise first
   node=before['rows'][0];identity=captured['lifecycle']['ownedProcessIdentity'];need(identity is not None and identity['exeSha256']==node['sha256']and identity['exeByteLength']==node['byteLength']and identity['exeRealpath']==node['realpath'],'owned-runtime-join')
   report=strict_json(regular_bytes(f'originals/child{child}/report.json',4194304));validate_session(captured,report,source,mapping,child);passed[child-1]=True;prior_resource=captured['lifecycle']['resourceAfter']
   if child==1:json_new('originals/media-between.json',media_inventory('between'))
  need(regular_bytes('outputs/first.img',SIZE,SIZE)==regular_bytes('outputs/second.img',SIZE,SIZE),'reader-export-changed')
  json_new('originals/media-after.json',media_inventory('after'))
 except BaseException as error:retain(error)
 finally:
  for path,action in [('source-after.json',lambda:source_after(source)),('runtime-after.json',lambda:runtime_inventory(session,before['provenance'])if before else None)]:
   try:
    value=action()
    if value is not None:
     json_new('originals/'+path,value)
     if path=='runtime-after.json':need(value==before,'runtime-after-drift')
   except BaseException as error:retain(error)
  result={'schema':'bw.hdd-cli-result.v1','byteProofPass':False,'session1Pass':passed[0],'session2Pass':passed[1],'finitePersistencePass':False,'firstFailure':str(first)if first else None,'secondaryFailures':secondary[:64],'fullOsQualified':False,'crashDurabilityQualified':False,'installedGuiQualified':False}
  try:json_new('originals/result.json',result);finalize_index()
  except BaseException as error:retain(error)
 if first is not None:raise first
 print('Two captured sessions complete; independent original-byte and official admission gates remain required.')

def stage_floppy(destination):
 # Fixed official archive/member only. No caller-selected URL or extraction root.
 import urllib.request,zipfile
 target=Path(destination);archive=target.with_suffix('.archive.zip');cap=23624258
 need(not target.exists()and not archive.exists(),'download-output-exists')
 h=hashlib.sha256();count=0
 with urllib.request.urlopen('https://download.freedos.org/1.4/FD14-FloppyEdition.zip',timeout=30)as response,archive.open('xb')as out:
  while True:
   data=response.read(min(65536,cap+1-count))
   if not data:break
   count+=len(data);need(count<=cap,'archive-cap');h.update(data);out.write(data)
 need(count==cap and h.hexdigest()=='45b1fa7c52dd996c3bfa5e352ffcd410781b952a6ad629f15a4c9ec4bbaefc5a','archive-pin')
 with zipfile.ZipFile(archive)as z:
  infos=z.infolist();need(len(infos)<=256 and len({i.filename for i in infos})==len(infos),'archive-directory')
  info=z.getinfo('120m/x86BOOT.img');need(info.file_size==1228800 and info.compress_size<=cap and not info.flag_bits&1,'floppy-member')
  with z.open(info)as f:data=f.read(1228801)
  need(len(data)==1228800 and sha(data)==PINS['floppy'][1],'floppy-pin');write_new(target,data)

def main():
 parser=argparse.ArgumentParser(description=__doc__);mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--run');mode.add_argument('--stage-floppy');parser.add_argument('--expected-head');parser.add_argument('--media-review-sha256');args=parser.parse_args()
 if args.stage_floppy:stage_floppy(args.stage_floppy)
 else:need(args.expected_head is not None and args.media_review_sha256 is not None,'external-admission-required');run_packet(Path(args.run).resolve(),args.expected_head,args.media_review_sha256)
if __name__=='__main__':
 try:main()
 except BaseException as error:print(type(error).__name__+': '+str(error),file=sys.stderr);sys.exit(1)
