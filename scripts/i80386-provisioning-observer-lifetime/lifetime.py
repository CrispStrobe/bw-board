"""Unconnected cooperative lifetime observations; no operational authority."""
import hashlib
import math
import os
from pathlib import Path
import select
import signal
import stat
import time
import types

_SEAL=None
_OBSERVER=('scripts/i80386-provisioning-observer/observer.py',14445,'3ad37c746bae7035d7897ce5678919b59c98b4bdb510fc48996613d6677bb9e8')
_ROOT=str(Path(__file__).parent.parent.parent)
_POLICY=(8.0,480.0,488.0,65536)
class Refusal(RuntimeError):pass
def actual():raise Refusal('actual-unsealed')
def _launch():raise Refusal('launch-unconnected')
_UNCONNECTED=_launch
def need(value,code):
 if not value:raise Refusal(code)

class Lifetime:
 def __init__(self):
  self.entered=False;self.busy=False;self.closed=False;self.phase='new';self.first=None;self.original=None;self.cleanup=0;self.complete=False;self.observer=None;self.boundary=None;self.terminal_fn=None;self.census_fn=None;self.process=None;self.channel=None;self.channel_transferred=False;self.channel_close=None;self.pipe_fds=[];self.consumed=set();self.output=[bytearray(),bytearray()];self.observed=[0,0];self.eof=[False,False];self.overflow=False;self.terminal=None;self.reaped=False;self.exit=None;self.censuses=[];self.signal_attempted=False;self.signal_returned=False;self.admitted=False;self.ack_attempted=False;self.ack_sent=False;self.ack_may_have_escaped=False;self.handles_observed=False;self.usable_handles=False;self.identity=None;self.pidfd=None;self.start=None;self.last=None;self.execution_start=None;self.cleanup_observations_missing=False;self.launch_unobserved=False;self.launch_attempted=False;self.ops=None
 def fail(self,code,error):
  if self.first is None:self.first=code;self.original=error
 def check(self):
  if self.first is not None:raise self.original
 def poison(self):
  error=Refusal('lifetime-reentry');self.fail('lifetime-reentry',error)
  if self.observer is not None and self.observer.busy:
   try:self.observer._poison()
   except BaseException:pass
  raise self.original
 def call(self,fn,*args,**kwargs):self.check();value=fn(*args,**kwargs);self.check();return value
 def clock(self):
  value=self.ops['clock']();self.check();need(type(value)in(int,float)and self.ops['finite'](value)and value>=0,'clock-shape');need(self.last is None or value>=self.last,'clock-backward');self.last=value;return value
 def remaining(self,execution=False):
  now=self.clock();ends=[self.start+self.policy[2]]
  if execution:ends.append(self.execution_start+self.policy[1])
  else:ends.append(self.start+self.policy[0])
  remaining=min(ends)-now;need(remaining>0,'cooperative-deadline');return remaining
 def _load(self,root,spec):
  path=Path(root)/spec[0];fd=None;body=bytearray();primary=None
  try:
   fd=self.ops['open'](path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);need(type(fd)is int and fd>=0,'source-fd');self.check();initial=self.call(self.ops['fstat'],fd);need(stat.S_ISREG(initial.st_mode)and initial.st_nlink==1 and initial.st_size==spec[1],'source-shape')
   while True:
    part=self.call(self.ops['read'],fd,min(65536,spec[1]+1-len(body)));need(type(part)is bytes,'source-bytes')
    if not part:break
    body.extend(part);need(len(body)<=spec[1],'source-cap')
   end=self.call(self.ops['fstat'],fd);named=self.call(self.ops['stat'],path,follow_symlinks=False);need((initial.st_dev,initial.st_ino,initial.st_size,initial.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns)and end.st_nlink==named.st_nlink==1 and stat.S_ISREG(named.st_mode),'source-changed')
  except BaseException as error:self.fail('source-refused',error);primary=self.original
  finally:
   if type(fd)is int and fd>=0:
    try:self.ops['close'](fd)
    except BaseException as error:self.cleanup+=1;self.fail('source-close-refused',error)
  if primary is not None:raise primary
  self.check();need(len(body)==spec[1],'source-extent');digest=self.call(self.ops['hash'],bytes(body));need(self.call(digest.hexdigest)==spec[2],'source-hash');module=types.ModuleType('owned_lifetime_observer');module.__file__=str(path);code=self.call(self.ops['compile'],bytes(body),'<owned-observer>','exec');self.call(self.ops['exec'],code,module.__dict__);return module
 def capture_admission(self):
  self.usable_handles=False
  observer=self.observer
  if observer is None:return
  received=tuple(observer._fds);self.consumed.update(fd for fd in received if type(fd)is int and fd>=0)
  self.channel_transferred=observer._channel_owner is self.channel
  self.handles_observed=observer.handles_admitted is True
  self.ack_attempted=observer.ack_attempted is True;self.ack_sent=observer.ack_sent is True;self.ack_may_have_escaped=observer.ack_may_have_escaped is True
  self.usable_handles=observer.handles_admitted is True and observer.closed is False and len(received)==2 and all(type(fd)is int and fd>=0 and fd not in observer._consumed for fd in received)and received[0]!=received[1]
  if self.usable_handles:self.admitted=True;self.pidfd=received[1]
  elif self.handles_observed:self.cleanup_observations_missing=True
 def cleanup_owned(self):
  try:self.capture_admission()
  except BaseException as error:self.cleanup+=1;self.fail('cleanup-ownership-refused',error)
  if self.usable_handles:
   try:
    self.terminal=self.terminal_fn(self.pidfd)
    need(type(self.terminal)is bool,'terminal-shape');need(not self.complete or self.terminal is True,'cleanup-terminal-drift')
    if not self.terminal and not self.signal_attempted:
     self.signal_attempted=True;self.ops['signal'](self.pidfd,signal.SIGKILL);self.signal_returned=True
   except BaseException as error:self.cleanup+=1;self.fail('cleanup-terminal-refused',error)
  elif self.launch_attempted:self.launch_unobserved=True
  if self.process is not None and not self.reaped:self.cleanup_observations_missing=True
  for fd in reversed(self.pipe_fds):
   if type(fd)is not int or fd<0 or fd in self.consumed:continue
   self.consumed.add(fd)
   try:self.ops['close'](fd)
   except BaseException as error:self.cleanup+=1;self.fail('pipe-close-refused',error)
  if self.observer is not None:
   try:self.observer.close()
   except BaseException as error:self.cleanup+=1;self.fail('admission-close-refused',error)
   finally:self.usable_handles=False
  if self.channel is not None and not self.channel_transferred:
   self.channel_transferred=True
   try:self.channel_close()
   except BaseException as error:self.cleanup+=1;self.fail('channel-close-refused',error)
 def _run(self):
  if self.busy:self.poison()
  need(not self.entered and not self.closed,'lifetime-once');need(_launch is not _UNCONNECTED,'launch-unconnected');self.entered=True;self.busy=True;primary=None
  try:
   root=_ROOT;spec=_OBSERVER;policy=_POLICY;launch=_launch;loader=self._load
   self.ops={'clock':time.monotonic,'finite':math.isfinite,'open':os.open,'read':os.read,'close':os.close,'fstat':os.fstat,'stat':os.stat,'hash':hashlib.sha256,'compile':compile,'exec':exec,'select':select.select,'signal':signal.pidfd_send_signal,'set_blocking':os.set_blocking,'get_blocking':os.get_blocking}
   need(type(policy)is tuple and len(policy)==4 and all(type(v)is float for v in policy[:3])and type(policy[3])is int and policy==(8.0,480.0,488.0,65536),'policy-shape');self.policy=policy
   need(type(spec)is tuple and len(spec)==3 and type(spec[0])is str and type(spec[1])is int and type(spec[2])is str and spec==('scripts/i80386-provisioning-observer/observer.py',14445,'3ad37c746bae7035d7897ce5678919b59c98b4bdb510fc48996613d6677bb9e8'),'source-binding')
   self.start=self.clock();self.phase='source';module=self.call(loader,root,spec);observer_type=module.Observer;self.remaining();self.phase='launch'
   self.launch_attempted=True;bundle=launch()
   # Capture every recognizable returned owned resource before post-hook refusal.
   if type(bundle)is tuple:
    if len(bundle)>0:self.process=bundle[0]
    if len(bundle)>1:self.channel=bundle[1]
    self.pipe_fds.extend(v for v in bundle[2:]if type(v)is int and v>=0)
   if self.channel is not None:self.channel_close=self.channel.close
   self.check();need(type(bundle)is tuple and len(bundle)==4 and self.process is not None and self.channel is not None and all(type(v)is int and v>=0 for v in bundle[2:])and bundle[2]!=bundle[3],'launch-shape');poll=self.process.poll;wait=self.process.wait;self.remaining()
   for fd in self.pipe_fds:
    self.call(self.ops['set_blocking'],fd,False);need(self.call(self.ops['get_blocking'],fd)is False,'pipe-blocking')
   self.observer=observer_type();self.check();observer=self.observer;module._channel=lambda:self.channel
   original_loader=observer._load_boundary
   def capture_boundary(*args):
    boundary=original_loader(*args);self.boundary=boundary;self.terminal_fn=boundary.pidfd_terminal;self.census_fn=boundary.census;return boundary
   observer._load_boundary=capture_boundary
   self.phase='admission';self.execution_start=self.clock()
   try:observer._receive()
   finally:self.capture_admission()
   self.check();self.remaining();need(observer.admitted and observer.ack_sent and observer.first is None and self.admitted,'admission-refused');nsfd,self.pidfd=tuple(observer._fds);need(not(set(self.pipe_fds)&set(observer._fds)),'ownership-alias');ns=self.call(self.ops['fstat'],nsfd);self.identity=(ns.st_dev,ns.st_ino);need(all(type(v)is int and v>=0 for v in self.identity),'namespace-identity-shape');terminal=self.terminal_fn;census=self.census_fn;self.phase='execution'
   while not all(self.eof):
    remaining=self.remaining(True);fds=[fd for i,fd in enumerate(self.pipe_fds)if not self.eof[i]];ready,_,_=self.call(self.ops['select'],fds,[],[],min(remaining,0.1));need(type(ready)is list and all(type(fd)is int and fd in fds for fd in ready)and len(set(ready))==len(ready),'ready-shape')
    for fd in ready:
     index=self.pipe_fds.index(fd);part=self.ops['read'](fd,min(65536,self.policy[3]-len(self.output[index])+1));need(type(part)is bytes,'output-shape');self.observed[index]+=len(part);left=self.policy[3]-len(self.output[index]);self.output[index].extend(part[:left]);self.overflow|=len(part)>left;self.check();need(not self.overflow,'output-cap')
     if not part:self.eof[index]=True
   self.phase='terminal';code=self.call(wait,timeout=self.remaining(True));need(type(code)is int,'wait-shape');self.exit=code;self.reaped=True;self.remaining(True);self.terminal=self.call(terminal,self.pidfd);need(self.terminal is True,'init-not-terminal');need(self.call(poll)==code,'wait-mismatch');need(code==0,'launcher-exit')
   self.phase='census'
   for _ in range(2):
    self.remaining(True);count=self.call(census,self.identity);need(type(count)is int and count>=0,'census-shape');self.censuses.append(count);self.remaining(True);need(count==0,'namespace-not-empty')
   self.complete=True
  except BaseException as error:self.fail('lifetime-refused',error);primary=self.original;self.complete=False
  finally:
   try:self.cleanup_owned()
   except BaseException as error:self.cleanup+=1;self.fail('cleanup-refused',error)
   finally:self.busy=False;self.closed=True
   if self.first is not None:self.complete=False;self.phase='refused'
   else:self.phase='observed'
  if primary is not None:raise primary
  self.check();return self.status()
 def close(self):
  if self.busy:self.poison()
  if self.closed:return self.status()
  self.busy=True
  try:
   if self.ops is not None:self.cleanup_owned()
  finally:self.busy=False;self.closed=True
  self.check();return self.status()
 def status(self):
  if self.busy:self.poison()
  return {'schema':'bw.provisioning-observer-lifetime.v1','phase':self.phase,'closed':self.closed,'complete':self.complete and self.first is None,'firstFailure':self.first,'cleanupRefused':self.cleanup,'stdoutPrefixBytes':len(self.output[0]),'stderrPrefixBytes':len(self.output[1]),'stdoutObservedBytes':self.observed[0],'stderrObservedBytes':self.observed[1],'stdoutPrefixSha256':hashlib.sha256(bytes(self.output[0])).hexdigest(),'stderrPrefixSha256':hashlib.sha256(bytes(self.output[1])).hexdigest(),'stdout':bytes(self.output[0]),'stderr':bytes(self.output[1]),'stdoutEOF':self.eof[0],'stderrEOF':self.eof[1],'outputCapRefused':self.overflow,'admissionObserved':self.admitted,'historicalHandlesAdmitted':self.handles_observed,'ackAttempted':self.ack_attempted,'ackSent':self.ack_sent,'ackMayHaveEscaped':self.ack_may_have_escaped,'pid1Terminal':self.terminal,'launcherReaped':self.reaped,'launcherExit':self.exit,'censusCounts':list(self.censuses),'signalAttempted':self.signal_attempted,'signalReturned':self.signal_returned,'cleanupObservationsMissing':self.cleanup_observations_missing,'launchUnobserved':self.launch_unobserved,'namespaceOwnershipQualified':False,'continuousLeaseQualified':False,'outerHardDeadlineQualified':False,'officialHostQualified':False,'resourceSufficiencyQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
