"""Fixed hosted Linux containment controls; production operation stays unsealed."""
import array,errno,fcntl,hashlib,json,os,select,selectors,signal,socket,stat,struct,subprocess,time
from pathlib import Path
CASES=('success','startup-stall','detached-sleeper','partial-stderr','setup-refusal')
TOOLS=('/usr/bin/timeout','/usr/bin/unshare','/usr/bin/python3')
CAP=8192;PROC_CAP=32768;HOSTED_SEAL=None
HERE=Path(__file__).resolve().parent
class Refusal(RuntimeError):pass
def actual():raise Refusal('production-unsealed')
def read_regular(path,cap):
 before=os.stat(path,follow_symlinks=False)
 if not stat.S_ISREG(before.st_mode)or before.st_size>cap:raise Refusal('source-shape')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);primary=None;chunks=[]
 try:
  opened=os.fstat(fd)
  if (before.st_dev,before.st_ino,before.st_size)!=(opened.st_dev,opened.st_ino,opened.st_size):raise Refusal('source-identity')
  count=0
  while True:
   part=os.read(fd,min(65536,cap+1-count))
   if not part:break
   count+=len(part)
   if count>cap:raise Refusal('source-cap')
   chunks.append(part)
  after=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
  if (opened.st_dev,opened.st_ino,opened.st_size)!=(after.st_dev,after.st_ino,after.st_size)or(after.st_dev,after.st_ino,after.st_size)!=(named.st_dev,named.st_ino,named.st_size)or count!=opened.st_size:raise Refusal('source-changed')
 except BaseException as error:primary=error
 finally:
  try:os.close(fd)
  except BaseException as error:
   if primary is None:primary=error
 if primary is not None:raise primary
 return b''.join(chunks)
def identities():
 if type(TOOLS)is not tuple or TOOLS!=('/usr/bin/timeout','/usr/bin/unshare','/usr/bin/python3'):raise Refusal('tool-policy')
 # Resolve distro symlinks before retaining exact ordinary tool bytes.
 paths=tuple(str(Path(p).resolve(strict=True))for p in TOOLS)+(str(HERE/'fixture.py'),str(HERE/'boundary.py'),str(HERE/'hosted-controls.py'))
 return paths,tuple((len(b),hashlib.sha256(b).hexdigest())for b in (read_regular(p,16777216)for p in paths))
def append_prefix(target,part):
 if type(part)is not bytes:raise Refusal('output-shape')
 left=CAP-len(target);target.extend(part[:left])
 if len(part)>left:raise Refusal('output-cap')
def pidfd_terminal(fd):
 if type(fd)is not int or fd<0:raise Refusal('pidfd-shape')
 return _poll(fd)
def _poll(fd):
 p=select.poll();p.register(fd,select.POLLIN);events=p.poll(0)
 if any(mask&(select.POLLNVAL|select.POLLERR)for _,mask in events):raise Refusal('pidfd-uncertain')
 return any(mask&select.POLLIN for _,mask in events)
def census(identity):
 count=0;seen=0
 with os.scandir('/proc')as entries:
  for entry in entries:
   if not entry.name.isascii()or not entry.name.isdecimal():continue
   seen+=1
   if seen>PROC_CAP:raise Refusal('proc-cap')
   try:row=os.stat('/proc/'+entry.name+'/ns/pid')
   except OSError as error:
    if error.errno in (errno.ENOENT,errno.ESRCH):
     try:os.stat('/proc/'+entry.name)
     except OSError as gone:
      if gone.errno in (errno.ENOENT,errno.ESRCH):continue
     raise Refusal('proc-uncertain')from None
    raise Refusal('proc-uncertain')from None
   if(row.st_dev,row.st_ino)==identity:count+=1
 return count
def admit_handles(nsfd,pidfd,credentials):
 if fcntl.ioctl(nsfd,0xb703)!=0x20000000:raise Refusal('namespace-type')
 if os.readlink('/proc/self/fd/'+str(pidfd))!='anon_inode:[pidfd]':raise Refusal('pidfd-type')
 ns=os.fstat(nsfd);host=os.stat('/proc/self/ns/pid')
 if(ns.st_dev,ns.st_ino)==(host.st_dev,host.st_ino):raise Refusal('host-namespace')
 # Kernel fdinfo binds the received pidfd to a host PID and local PID1.
 info=read_regular_fdinfo(pidfd);rows={}
 for line in info.splitlines():
  if ':'not in line:raise Refusal('pidfd-identity')
  key,value=line.split(':',1)
  if key in rows:raise Refusal('pidfd-identity')
  rows[key]=value
 if 'Pid'not in rows or 'NSpid'not in rows:raise Refusal('pidfd-identity')
 values=rows['NSpid'].split();hostpid=rows['Pid'].strip()
 if type(credentials)is not tuple or len(credentials)!=3 or any(type(x)is not int for x in credentials)or credentials!=(int(hostpid)if hostpid.isdecimal()else -1,0,0):raise Refusal('sender-identity')
 if not hostpid.isdecimal()or int(hostpid)<=1 or not values or values[0]!=hostpid or values[-1]!='1':raise Refusal('pid1-identity')
 observed=os.stat('/proc/'+hostpid+'/ns/pid')
 if(observed.st_dev,observed.st_ino)!=(ns.st_dev,ns.st_ino):raise Refusal('namespace-identity')
 if pidfd_terminal(pidfd):raise Refusal('early-init-exit')
 return(ns.st_dev,ns.st_ino)
def read_regular_fdinfo(fd):
 with open('/proc/self/fdinfo/'+str(fd),'rb')as f:data=f.read(1025)
 if len(data)>1024:raise Refusal('fdinfo-cap')
 try:return data.decode('ascii')
 except UnicodeError:raise Refusal('fdinfo-shape')from None
def receive_handles(channel):
 fds=[]
 try:
  data,ancillary,flags,_=channel.recvmsg(64,socket.CMSG_SPACE(8)+socket.CMSG_SPACE(12));credentials=[];malformed=False
  if data==b''and not ancillary and not flags:return(),None
  # Collect every delivered descriptor before shape refusal, including later chunks.
  for level,kind,body in ancillary:
   if type(body)is not bytes:malformed=True;continue
   if level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS:
    values=array.array('i');remainder=len(body)%values.itemsize
    values.frombytes(body[:len(body)-remainder]);fds.extend(values);malformed|=bool(remainder)
   elif level==socket.SOL_SOCKET and kind==socket.SCM_CREDENTIALS and len(body)==12:credentials.append(struct.unpack('3i',body))
   else:malformed=True
  if malformed or flags&(socket.MSG_CTRUNC|socket.MSG_TRUNC)or data!=b'outer-fixture-v1\n'or len(fds)!=2 or len(credentials)!=1:raise Refusal('handshake-shape')
  identity=admit_handles(*fds,credentials[0])
  channel.sendall(b'ACK\n');return tuple(fds),identity
 except BaseException as error:
  refused=0
  for fd in fds:
   try:os.close(fd)
   except BaseException:refused+=1
  error._outer_cleanup_refused=refused
  raise

def exit_signal(code):
 if type(code)is not int or not -64<=code<=255:raise Refusal('wait-status')
 return (code,None)if code>=0 else(None,-code)

def error_diagnostic(error):
 if error is None:return b''
 name=type(error).__name__[:48];parts=[]
 args=error.args
 if type(args)is tuple:
  for value in args[:3]:
   if type(value)is str:parts.append(value[:80])
   elif type(value)is int and -2147483648<=value<=2147483647:parts.append(value)
 code=getattr(error,'errno',None)
 if type(code)is not int or not -2147483648<=code<=2147483647:code=None
 encoded=(json.dumps({'exceptionType':name,'errno':code,'args':parts},ensure_ascii=True,separators=(',',':'))+'\n').encode()
 if len(encoded)>2048:return b'diagnostic-cap-refusal\n'
 return encoded

def hosted_case(case):
 if CASES!=('success','startup-stall','detached-sleeper','partial-stderr','setup-refusal'):raise Refusal('case-policy')
 if type(case)is not str or case not in CASES:raise Refusal('case-shape')
 if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':raise Refusal('hosted-only')
 paths=pins=()
 left=right=None;handles=();identity=None;process=None;selector=None;closed=set()
 stdout=bytearray();stderr=bytearray();first=None;cleanup=0;returncode=None;started=None;elapsed=None
 try:
  paths,pins=identities();timeout,unshare,python,fixture,_,_=paths
  command=(timeout,'--signal=KILL','5s',unshare,'--pid','--fork','--mount-proc','--kill-child=KILL','--',python,'-I','-B',fixture,case,'SOCKET_FD')
  started=time.monotonic()
  left,right=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET);left.setsockopt(socket.SOL_SOCKET,socket.SO_PASSCRED,1);left.setblocking(False)
  command=command[:-1]+(str(right.fileno()),)
  if identities()!=(paths,pins):raise Refusal('source-changed')
  process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(right.fileno(),),env={'PATH':'/usr/bin:/bin','LC_ALL':'C','HOME':'/nonexistent'},start_new_session=True)
  closed.add(id(right));right.close();selector=selectors.DefaultSelector();selector.register(left,selectors.EVENT_READ,'handshake')
  for pipe,name in((process.stdout,'stdout'),(process.stderr,'stderr')):os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,name)
  while selector.get_map():
   remaining=started+8-time.monotonic()
   if remaining<=0:raise Refusal('observer-deadline')
   for key,_ in selector.select(min(0.1,remaining)):
    if key.data=='handshake':
     handles,identity=receive_handles(left);selector.unregister(left);continue
    part=os.read(key.fileobj.fileno(),4096)
    if not part:selector.unregister(key.fileobj);continue
    append_prefix(stdout if key.data=='stdout'else stderr,part)
  returncode=process.wait(timeout=max(0.001,started+8-time.monotonic()))
  elapsed=time.monotonic()-started
  exit_signal(returncode)
  if case=='setup-refusal':
   if handles or returncode!=4 or stderr!=b'fixture-setup-refusal\n':raise Refusal('setup-outcome')
  else:
   if not handles or not pidfd_terminal(handles[1]):raise Refusal('init-not-terminal')
   if census(identity)!=0 or census(identity)!=0:raise Refusal('namespace-not-empty')
   if case=='success':
    if returncode!=0 or stdout!=b'fixture-success\n'or stderr:raise Refusal('success-outcome')
   elif returncode not in (-signal.SIGKILL,137)or elapsed<4.5:raise Refusal('timer-outcome')
   elif case=='partial-stderr'and stderr!=b'fixture-partial-original\x00\xff\n':raise Refusal('partial-outcome')
   elif case=='detached-sleeper'and(stderr!=b'fixture-detached\n'or stdout!=b'fixture-parent\n'):raise Refusal('detached-outcome')
   elif case=='startup-stall'and stdout!=b'fixture-startup-stall\n':raise Refusal('startup-outcome')
 except BaseException as error:first=error;cleanup+=getattr(error,'_outer_cleanup_refused',0)
 finally:
  # Never signal discovered PIDs. Only a received, admitted PID1 handle is eligible.
  if first is not None and handles:
   try:
    if not pidfd_terminal(handles[1]):signal.pidfd_send_signal(handles[1],signal.SIGKILL)
   except BaseException:cleanup+=1
  if process is not None and returncode is None:
   try:returncode=process.wait(timeout=7)
   except BaseException:cleanup+=1
  for obj in (selector,left,right,process.stdout if process else None,process.stderr if process else None):
   if obj is not None and id(obj)not in closed:
    closed.add(id(obj))
    try:obj.close()
    except BaseException:cleanup+=1
  for fd in handles:
   try:os.close(fd)
   except BaseException:cleanup+=1
 if cleanup and first is None:first=Refusal('cleanup-uncertain')
 result={'schema':'bw.supervisor-outer-boundary-control.v1','case':case,'controlPassed':first is None,'firstFailure':None if first is None else(str(first)if isinstance(first,Refusal)else'host-operation-refusal'),'returnCode':returncode,'exit':exit_signal(returncode)[0]if returncode is not None and type(returncode)is int and -64<=returncode<=255 else None,'signal':exit_signal(returncode)[1]if returncode is not None and type(returncode)is int and -64<=returncode<=255 else None,'elapsedSecondsObserved':elapsed,'stdout':bytes(stdout),'stderr':bytes(stderr),'diagnostic':error_diagnostic(first),'namespaceEmptyObserved':first is None and bool(handles),'initTerminalObserved':first is None and bool(handles),'ownedTimeoutReaped':returncode is not None,'namespaceCensusPasses':2 if first is None and bool(handles)else 0,'setupRefusalObserved':first is None and case=='setup-refusal','cleanupRefused':cleanup,'toolSourceHashes':pins,'actualQualified':False,'compilerQualified':False,'guestQualified':False}
 return result
