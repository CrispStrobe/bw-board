"""Fixed refusal launch preparation; external supervisor qualification absent."""
import hashlib
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import types

_ACTUAL_SEAL=None
_CREATE=None
_LAUNCH=None
_ROOT=str(Path(__file__).parent.parent.parent)
_LIFETIME=('scripts/i80386-provisioning-observer-lifetime/lifetime.py',12941,'a1fd301279a3d01728f68a90fc6315f99421365699ac4080c3a17594623ec840')
_BOOTSTRAP=('scripts/i80386-provisioning-enclosing-supervisor/bootstrap.py',170,'12c774eb80f09d74740ba86a16edc6d30174e5066689f792f5c0c469c5e858c0')
_PREFIX=('/usr/bin/timeout','--signal=KILL','480s','/usr/bin/unshare','--pid','--fork','--mount-proc','--kill-child=KILL','--','/usr/bin/python3','-I','-B')
_ENV=(('PATH','/usr/bin:/bin'),('LANG','C'),('LC_ALL','C'),('PYTHONDONTWRITEBYTECODE','1'))
class Refusal(RuntimeError):pass
def actual():raise Refusal('actual-unsealed')
def need(ok,code):
 if not ok:raise Refusal(code)
def _owned_create(owner):
 need(owner.busy and owner.phase=='creating','creation-phase')
 pair=owner.ops['socketpair'](*owner.ops['socketpair_args'])
 if type(pair)in(tuple,list):owner.sockets.extend(pair)
 owner.check();need(type(pair)is tuple and len(pair)==2,'socketpair-shape')
 for sock in pair:
  row={'object':sock,'close':sock.close,'fd':None};owner.socket_rows.append(row);fd=sock.fileno();row['fd']=fd;owner.check();need(type(fd)is int and fd>=0,'socket-fd');kind=owner.call(sock.getsockopt,*owner.ops['sockettype_args']);need(type(kind)is int and kind==owner.ops['seqpacket'],'socket-type')
 for _ in range(2):
  pair=owner.ops['pipe2'](owner.ops['pipeflags'])
  if type(pair)in(tuple,list):owner.pipes.extend(v for v in pair if type(v)is int and v>=0)
  owner.check();need(type(pair)is tuple and len(pair)==2 and all(type(fd)is int and fd>=0 for fd in pair),'pipe-shape')
 return tuple(owner.socket_rows),tuple(owner.pipes)

class Preparation:
 def __init__(self):
  self.entered=False;self.busy=False;self.closed=False;self.phase='new';self.first=None;self.original=None;self.cleanup=0;self.sockets=[];self.socket_rows=[];self.pipes=[];self.consumed=set();self.socket_consumed=set();self.process=None;self.launch_attempted=False;self.launch_returned=False;self.transferred=False;self.prepared=False;self.lifetime=None;self.module=None;self.command=None;self.pass_fds=None;self.env=None;self.ops=None;self.bootstrap_verified=False;self.eligibility={'linuxObserved':False,'rootCredentialsObserved':False};self.credentials=[]
 def fail(self,code,error):
  if self.first is None:self.first=code;self.original=error
 def check(self):
  if self.first is not None:raise self.original
 def poison(self):
  error=Refusal('preparation-reentry');self.fail('preparation-reentry',error);raise self.original
 def call(self,fn,*args,**kwargs):self.check();value=fn(*args,**kwargs);self.check();return value
 def read_source(self,root,spec):
  fd=None;body=bytearray();primary=None
  try:
   target=self.ops['path'](root)/spec[0];fd=self.ops['open'](target,self.ops['open_flags']);need(type(fd)is int and fd>=0,'source-fd');self.check();initial=self.call(self.ops['fstat'],fd);need(self.ops['regular'](initial.st_mode)and initial.st_nlink==1 and initial.st_size==spec[1],'source-shape')
   while True:
    part=self.call(self.ops['read'],fd,min(65536,spec[1]+1-len(body)));need(type(part)is bytes,'source-bytes')
    if not part:break
    body.extend(part);need(len(body)<=spec[1],'source-cap')
   end=self.call(self.ops['fstat'],fd);named=self.call(self.ops['stat'],target,follow_symlinks=False);need((initial.st_dev,initial.st_ino,initial.st_size,initial.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns)and end.st_nlink==named.st_nlink==1 and self.ops['regular'](named.st_mode),'source-changed')
  except BaseException as error:self.fail('source-refused',error);primary=self.original
  finally:
   if type(fd)is int and fd>=0:
    try:self.ops['close'](fd)
    except BaseException as error:self.cleanup+=1;self.fail('source-close-refused',error)
  if primary is not None:raise primary
  self.check();need(len(body)==spec[1],'source-extent');digest=self.call(self.ops['hash'],bytes(body));need(self.call(digest.hexdigest)==spec[2],'source-hash');return bytes(body)
 def _close_fd(self,fd):
  if fd in self.consumed:return
  self.consumed.add(fd)
  try:self.ops['close'](fd)
  except BaseException as error:self.cleanup+=1;self.fail('pipe-close-refused',error)
 def _close_socket(self,sock):
  identity=id(sock)
  if identity in self.socket_consumed:return
  self.socket_consumed.add(identity);rows=[r for r in self.socket_rows if r['object']is sock];row=rows[0]if rows else None;fd=None if row is None else row['fd']
  if type(fd)is int and fd>=0:
   if fd in self.consumed:return
   self.consumed.add(fd)
  try:(sock.close if row is None else row['close'])()
  except BaseException as error:self.cleanup+=1;self.fail('socket-close-refused',error)
 def cleanup_owned(self):
  if self.transferred:
   try:self.lifetime.close()
   except BaseException as error:self.cleanup+=1;self.fail('lifetime-close-refused',error)
  else:
   for fd in reversed(self.pipes):self._close_fd(fd)
   for sock in reversed(self.sockets):self._close_socket(sock)
 def _handoff(self):
  need(self.prepared and not self.closed and not self.transferred and self.lifetime.entered and self.lifetime.busy and self.lifetime.phase=='launch','handoff-phase');self.check();bundle=(self.process,self.sockets[0],self.pipes[0],self.pipes[2]);self.transferred=True
  # Lifetime's exact returned-resource capture owns this tuple before its check.
  return bundle
 def _prepare(self):
  if self.busy:self.poison()
  need(not self.entered and not self.closed,'preparation-once');creator=_CREATE;launcher=_LAUNCH;need(creator is not None and launcher is not None and callable(creator)and callable(launcher),'route-unconnected');self.entered=True;self.busy=True;primary=None
  try:
   linux=sys.platform;root=_ROOT;lifetime_spec=_LIFETIME;bootstrap_spec=_BOOTSTRAP;prefix=_PREFIX;environment=_ENV;stdin=subprocess.DEVNULL;read_source=self.read_source
   self.ops={'getuid':os.getuid,'geteuid':os.geteuid,'getgid':os.getgid,'getegid':os.getegid,'socketpair':socket.socketpair,'socketpair_args':(int(socket.AF_UNIX),int(socket.SOCK_SEQPACKET|socket.SOCK_CLOEXEC)),'sockettype_args':(int(socket.SOL_SOCKET),int(socket.SO_TYPE)),'seqpacket':int(socket.SOCK_SEQPACKET),'pipeflags':int(os.O_CLOEXEC|os.O_NONBLOCK),'pipe2':os.pipe2,'get_inheritable':os.get_inheritable,'get_blocking':os.get_blocking,'path':Path,'open_flags':int(os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),'regular':stat.S_ISREG,'open':os.open,'fstat':os.fstat,'stat':os.stat,'read':os.read,'close':os.close,'hash':hashlib.sha256,'compile':compile,'exec':exec}
   need(type(stdin)is int and stdin==-3,'stdin-policy');need(type(prefix)is tuple and all(type(v)is str for v in prefix)and prefix==('/usr/bin/timeout','--signal=KILL','480s','/usr/bin/unshare','--pid','--fork','--mount-proc','--kill-child=KILL','--','/usr/bin/python3','-I','-B'),'command-shape')
   need(type(environment)is tuple and all(type(v)is tuple and len(v)==2 and all(type(x)is str for x in v)for v in environment)and environment==(('PATH','/usr/bin:/bin'),('LANG','C'),('LC_ALL','C'),('PYTHONDONTWRITEBYTECODE','1')),'environment-shape')
   need(type(lifetime_spec)is tuple and len(lifetime_spec)==3 and all(type(v)is t for v,t in zip(lifetime_spec,(str,int,str)))and lifetime_spec==('scripts/i80386-provisioning-observer-lifetime/lifetime.py',12941,'a1fd301279a3d01728f68a90fc6315f99421365699ac4080c3a17594623ec840'),'lifetime-binding')
   need(type(bootstrap_spec)is tuple and len(bootstrap_spec)==3 and all(type(v)is t for v,t in zip(bootstrap_spec,(str,int,str)))and bootstrap_spec==('scripts/i80386-provisioning-enclosing-supervisor/bootstrap.py',170,'12c774eb80f09d74740ba86a16edc6d30174e5066689f792f5c0c469c5e858c0'),'bootstrap-binding')
   bootstrap_path=str(Path(root)/bootstrap_spec[0]);lifetime_path=str(Path(root)/lifetime_spec[0]);getters=tuple((name,self.ops[name])for name in('getuid','geteuid','getgid','getegid'));self.phase='eligibility';need(type(linux)is str and linux=='linux','linux-eligibility');self.eligibility['linuxObserved']=True
   for name,getter in getters:
    observed=self.call(getter);need(type(observed)is int,'credential-shape');self.credentials.append({'name':name,'value':observed});need(observed==0,'root-eligibility')
   self.eligibility['rootCredentialsObserved']=True;self.phase='source';body=self.call(read_source,root,lifetime_spec);self.call(read_source,root,bootstrap_spec);self.bootstrap_verified=True;module=types.ModuleType('owned_refusal_lifetime');module.__file__=lifetime_path;code=self.call(self.ops['compile'],body,'<owned-lifetime>','exec');self.call(self.ops['exec'],code,module.__dict__);self.module=module;self.lifetime=module.Lifetime();self.check()
   self.phase='creating';creator(self);self.check();need(len(self.sockets)==2 and len(self.socket_rows)==2 and len(self.pipes)==4,'wiring-shape');fds=tuple(row['fd']for row in self.socket_rows)+tuple(self.pipes);need(all(type(fd)is int and fd>=0 for fd in fds)and len(set(fds))==6,'wiring-alias')
   for fd in fds:need(self.call(self.ops['get_inheritable'],fd)is False,'cloexec-refused')
   for fd in self.pipes:need(self.call(self.ops['get_blocking'],fd)is False,'pipe-blocking')
   child_fd=fds[1];self.command=prefix+(bootstrap_path,'--unarmed-channel-fd',str(child_fd));self.pass_fds=(child_fd,);self.env=dict(environment);argv=self.command;pass_fds=self.pass_fds;env=dict(self.env);stdout=self.pipes[1];stderr=self.pipes[3];self.phase='launch';self.launch_attempted=True;self.process=launcher(argv,stdin=stdin,stdout=stdout,stderr=stderr,pass_fds=pass_fds,env=env,close_fds=True);self.launch_returned=self.process is not None;self.check();need(self.process is not None,'launch-return')
   self._close_socket(self.sockets[1]);self._close_fd(self.pipes[1]);self._close_fd(self.pipes[3]);self.check();module._launch=self._handoff;self.prepared=True;self.phase='refusal-prepared'
  except BaseException as error:self.fail('preparation-refused',error);primary=self.original;self.prepared=False
  finally:
   if self.first is not None:
    try:self.cleanup_owned()
    except BaseException as error:self.cleanup+=1;self.fail('cleanup-refused',error)
    self.closed=True;self.phase='refused'
   self.busy=False
  if primary is not None:raise primary
  self.check();return self.status()
 def close(self):
  if self.busy:self.poison()
  if self.closed:return self.status()
  self.busy=True
  try:self.cleanup_owned()
  except BaseException as error:self.cleanup+=1;self.fail('cleanup-refused',error)
  finally:self.closed=True;self.busy=False;self.phase='refused'if self.first is not None else'closed'
  self.check();return self.status()
 def status(self):
  if self.busy:self.poison()
  return {'schema':'bw.provisioning-refusal-launch-preparation.v1','phase':self.phase,'closed':self.closed,'refusalPreparationComplete':self.prepared and self.first is None,'firstFailure':self.first,'cleanupRefused':self.cleanup,'bootstrapVerified':self.bootstrap_verified,'eligibility':dict(self.eligibility),'credentialObservations':[dict(row)for row in self.credentials],'bootstrapProvisioningConnected':False,'launchAttempted':self.launch_attempted,'launchReturned':self.launch_returned,'launchCleanupUnobserved':self.launch_attempted,'resourcesTransferred':self.transferred,'ownedDescriptorsPending':0 if self.transferred else sum(fd not in self.consumed for fd in set(self.pipes+[r['fd']for r in self.socket_rows if type(r['fd'])is int])),'transferredDescriptorCount':3 if self.transferred else 0,'descriptorCloseAttempts':len(self.consumed),'descriptorClosureProven':False,'containedCommand':self.command,'passDescriptors':self.pass_fds,'outerDeadlineProposedSeconds':488,'outerObserverBootstrapConnected':False,'outerHardDeadlineQualified':False,'installedToolIdentityQualified':False,'sourceGraphAdmissionQualified':False,'namespaceOwnershipQualified':False,'officialHostQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
