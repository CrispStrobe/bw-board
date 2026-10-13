"""Independent resource packet receiver; production/host channel unconnected."""
import array,hashlib,json,os,resource,socket,stat,struct,types
from pathlib import Path
ACTUAL_SEAL=None
_BOUNDARY=('scripts/i80386-supervisor-outer-boundary/boundary.py',11573,'7ed023b41570cece9eae95430ec2ce10bae0aa074245502eb99208728e39e37e')
_ROOT=str(Path(__file__).parent.parent.parent)
_POLICY=(('cpuSeconds',0,180,180),('addressSpaceBytes',9,2147483648,2147483648),('fileBytes',1,67108864,67108864),('fdCount',7,256,256),('coreBytes',4,0,0))
_COMPONENTS=(('limits',5805,'829872fee3f1565ec8a67c57e74a7caba8c202b027ea6260f184425e888455d4'),('controller',19661,'9cb7cb6411694b65a9fe18a318967e04b3e24f5d9f86d4f59e48797fd19a43dd'))
_CAP=8192
_ACK=b'ACK\n'
class Refusal(ValueError):pass
def actual():raise Refusal('actual-unsealed')
def _channel():raise Refusal('channel-unconnected')
def need(ok,code):
 if not ok:raise Refusal(code)
def keys(v,names):need(type(v)is dict and len(v)==len(names)and all(type(k)is str for k in v)and set(v)==set(names),'closed-shape')
def bounded(v,depth=0,budget=None):
 if budget is None:budget=[512]
 budget[0]-=1;need(budget[0]>=0 and depth<=10,'json-budget')
 if v is None or type(v)is bool:return
 if type(v)is int:need(-1<=v<=2**64-1,'json-integer');return
 if type(v)is str:need(len(v)<=128,'json-string');return
 if type(v)is list:need(len(v)<=32,'json-list');[bounded(x,depth+1,budget)for x in v];return
 need(type(v)is dict and len(v)<=64 and all(type(k)is str and len(k)<=96 for k in v),'json-object')
 for value in v.values():bounded(value,depth+1,budget)
def _decode(body,policy,components,cap):
 need(type(body)is bytes and len(body)<=cap,'packet-cap')
 def pairs(rows):
  result={}
  for key,value in rows:need(key not in result,'json-duplicate');result[key]=value
  return result
 def bad(_):raise Refusal('json-number')
 try:value=json.loads(body.decode('utf8'),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
 except Refusal:raise
 except(ValueError,UnicodeError,RecursionError):raise Refusal('json-parse')from None
 bounded(value);keys(value,('schema','components','limits','controllerBootstrapStarted','observerOwnershipQualified','actualAcquisitionQualified','compilerQualified','guestQualified'));need(value['schema']=='bw.provisioning-contained-resource.v1'and all(value[k]is False for k in('controllerBootstrapStarted','observerOwnershipQualified','actualAcquisitionQualified','compilerQualified','guestQualified')),'packet-version-flags');keys(value['components'],('limits','controller'))
 for name,extent,digest in components:
  row=value['components'][name];keys(row,('bytes','sha256'));need(type(row['bytes'])is int and row['bytes']==extent and type(row['sha256'])is str and row['sha256']==digest,'component-pin')
 v=value['limits'];flags=('namespaceOwnershipQualified','officialHostQualified','aggregateResourceQuotaQualified','diskQuotaQualified','actualResourceSufficiencyQualified','outerTimeoutQualified','bootstrapConnected','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified');keys(v,('schema','phase','closed','prepared','firstFailure','stoppedPhase','eligibility','policy','rows','setAttempted','getAttempted','processLimitsPrepared',*flags));need(v['schema']=='bw.provisioning-pid1-limits.v1'and v['phase']=='prepared'and v['closed']is True and v['prepared']is True and v['processLimitsPrepared']is True and v['firstFailure']is None and v['stoppedPhase']is None and type(v['setAttempted'])is int and v['setAttempted']==5 and type(v['getAttempted'])is int and v['getAttempted']==10 and all(v[k]is False for k in flags),'limit-summary');keys(v['eligibility'],('linuxObserved','pid1Observed','rootCredentialsObserved','githubContextObserved'));need(all(x is True for x in v['eligibility'].values()),'limit-eligibility');need(type(v['policy'])is list and len(v['policy'])==5 and type(v['rows'])is list and len(v['rows'])==5,'limit-counts')
 for expected,p,row in zip(policy,v['policy'],v['rows']):
  name,kind,soft,hard=expected;keys(p,('name','resource','soft','hard'));keys(row,('name','resource','soft','hard','setReturned','observations'))
  for fact in(p,row):need(type(fact['name'])is str and fact['name']==name and all(type(fact[k])is int for k in('resource','soft','hard'))and(fact['resource'],fact['soft'],fact['hard'])==(kind,soft,hard),'limit-policy')
  need(row['setReturned']is True and type(row['observations'])is list and len(row['observations'])==2,'limit-observations')
  for position,observation in zip(('immediate','final'),row['observations']):
   keys(observation,('position','shapeValid','soft','hard','matchesPolicy'));need(observation['position']==position and observation['shapeValid']is True and observation['matchesPolicy']is True and type(observation['soft'])is int and type(observation['hard'])is int and(observation['soft'],observation['hard'])==(soft,hard),'limit-readback')
 return value
class Observer:
 def __init__(self):
  self.entered=False;self.busy=False;self.closed=False;self.phase='new';self.first=None;self._original=None;self.cleanup=0;self._fds=[];self._consumed=set();self._channel_owner=None;self._channel_close=None;self._close_fd=None;self._channel_consumed=False;self._loader_ops=None;self.packet_raw=None;self.limit_rows=[];self.handles_admitted=False;self.admitted=False;self.ack_attempted=False;self.ack_sent=False;self.ack_may_have_escaped=False
 def _fail(self,code,error):
  if self.first is None:self.first=code;self._original=error
 def _poison(self):
  error=Refusal('observer-reentry');self._fail('observer-reentry',error);raise self._original
 def _check(self):
  if self.first is not None:raise self._original
 def _call(self,fn,*args,**kwargs):self._check();value=fn(*args,**kwargs);self._check();return value
 def _load_boundary(self,root,spec):
  relative,extent,digest=spec;target=Path(root)/relative;open_fd,fstat_fd,read_fd,stat_path,hash_body,compile_body,exec_body=self._loader_ops;fd=None;primary=None;body=None
  try:
   fd=open_fd(target,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);need(type(fd)is int and fd>=0,'boundary-handle');self._check();st=self._call(fstat_fd,fd);need(stat.S_ISREG(st.st_mode)and st.st_size==extent and st.st_nlink==1,'boundary-shape');parts=[];count=0
   while True:
    part=self._call(read_fd,fd,min(65536,extent+1-count));need(type(part)is bytes,'boundary-bytes')
    if not part:break
    count+=len(part);need(count<=extent,'boundary-cap');parts.append(part)
   end=self._call(fstat_fd,fd);named=self._call(stat_path,target,follow_symlinks=False);need(count==extent and(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns)and stat.S_ISREG(named.st_mode)and end.st_nlink==1 and named.st_nlink==1,'boundary-changed');body=b''.join(parts)
  except BaseException as error:self._fail('boundary-read-refused',error);primary=self._original
  finally:
   if type(fd)is int and fd>=0:
    try:self._close_fd(fd)
    except BaseException as error:
     self.cleanup+=1;self._fail('boundary-close-refused',error)
     if primary is None:primary=self._original
  if primary is not None:raise primary
  h=self._call(hash_body,body);need(self._call(h.hexdigest)==digest,'boundary-hash');module=types.ModuleType('held_observer_boundary');module.__file__=str(target);code=self._call(compile_body,body,'<held-observer-boundary>','exec');self._call(exec_body,code,module.__dict__);return module
 def _close_owned(self):
  for fd in reversed(self._fds):
   if fd in self._consumed:continue
   self._consumed.add(fd)
   try:self._close_fd(fd)
   except BaseException as error:self.cleanup+=1;self._fail('fd-close-refused',error)
  if self._channel_owner is not None and not self._channel_consumed:
   self._channel_consumed=True
   try:self._channel_close()
   except BaseException as error:self.cleanup+=1;self._fail('channel-close-refused',error)
 def _receive(self):
  if self.busy:self._poison()
  need(not self.entered and not self.closed,'observer-once');self.entered=True;self.busy=True;primary=None;reason='observer-refused'
  try:
   root=_ROOT;boundary_spec=_BOUNDARY;policy=_POLICY;components=_COMPONENTS;cap=_CAP;ack=_ACK;decoder=_decode;prlimit=resource.prlimit;self._close_fd=os.close;self._loader_ops=(os.open,os.fstat,os.read,os.stat,hashlib.sha256,compile,exec)
   expected_policy=(('cpuSeconds',0,180,180),('addressSpaceBytes',9,2147483648,2147483648),('fileBytes',1,67108864,67108864),('fdCount',7,256,256),('coreBytes',4,0,0));expected_components=(('limits',5805,'829872fee3f1565ec8a67c57e74a7caba8c202b027ea6260f184425e888455d4'),('controller',19661,'9cb7cb6411694b65a9fe18a318967e04b3e24f5d9f86d4f59e48797fd19a43dd'))
   need(type(root)is str and root.startswith('/')and len(root)<=4046 and type(policy)is tuple and len(policy)==5 and type(components)is tuple and len(components)==2 and type(cap)is int and cap==8192 and type(ack)is bytes and ack==b'ACK\n','fixed-policy')
   for row,wanted in zip(policy,expected_policy):need(type(row)is tuple and len(row)==4 and type(row[0])is str and all(type(v)is int for v in row[1:])and row==wanted,'fixed-policy')
   for row,wanted in zip(components,expected_components):need(type(row)is tuple and len(row)==3 and type(row[0])is str and type(row[1])is int and type(row[2])is str and row==wanted,'fixed-components')
   need(type(boundary_spec)is tuple and boundary_spec==('scripts/i80386-supervisor-outer-boundary/boundary.py',11573,'7ed023b41570cece9eae95430ec2ce10bae0aa074245502eb99208728e39e37e'),'fixed-boundary')
   self.phase='channel';channel=_channel();need(channel is not None,'channel-unconnected');self._channel_owner=channel;self._channel_close=channel.close;receive=channel.recvmsg;send=channel.send;socket_type=channel.getsockopt;set_option=channel.setsockopt;set_timeout=channel.settimeout;self._check();kind=self._call(socket_type,socket.SOL_SOCKET,socket.SO_TYPE);need(type(kind)is int and kind==socket.SOCK_SEQPACKET,'channel-type');self._call(set_option,socket.SOL_SOCKET,socket.SO_PASSCRED,1);self._call(set_timeout,5.0)
   self.phase='boundary';module=self._call(self._load_boundary,root,boundary_spec);admit=module.admit_handles;terminal=module.pidfd_terminal;self._check()
   self.phase='receive';self._check();body,ancillary,flags,_=receive(cap+1,socket.CMSG_SPACE(8)+socket.CMSG_SPACE(12));credentials=[];malformed=False
   # Returned descriptors become owned BEFORE any poison/payload/shape refusal.
   for item in ancillary:
    if type(item)is not tuple or len(item)!=3:malformed=True;continue
    level,kind,data=item
    if type(level)is not int or type(kind)is not int:
     malformed=True
     if type(level)not in(int,bool)or type(kind)not in(int,bool):continue
    if type(data)is not bytes:malformed=True;continue
    if level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS:
     values=array.array('i');remainder=len(data)%values.itemsize;values.frombytes(data[:len(data)-remainder]);self._fds.extend(values);malformed|=bool(remainder)
    elif level==socket.SOL_SOCKET and kind==socket.SCM_CREDENTIALS:credentials.append(data)
    else:malformed=True
   self._check();need(type(flags)is int and not malformed and not flags&(socket.MSG_CTRUNC|socket.MSG_TRUNC)and len(self._fds)==2 and len(set(self._fds))==2 and all(type(fd)is int and fd>=0 for fd in self._fds)and len(credentials)==1 and len(credentials[0])==12,'ancillary-shape');creds=self._call(struct.unpack,'3i',credentials[0]);need(type(creds)is tuple and len(creds)==3 and all(type(v)is int for v in creds)and 1<creds[0]<=2147483647 and creds[1:]==(0,0),'credential-shape');self.phase='packet';self._call(decoder,body,policy,components,cap);self.packet_raw=body
   nsfd,pidfd=self._fds;self.phase='handles';identity=self._call(admit,nsfd,pidfd,creds);self.handles_admitted=True;host_pid=creds[0];need(self._call(terminal,pidfd)is False,'sender-terminal');self.phase='limits'
   for name,kind,soft,hard in policy:
    need(self._call(terminal,pidfd)is False,'sender-terminal');observed=self._call(prlimit,host_pid,kind);need(self._call(terminal,pidfd)is False,'sender-terminal');row={'name':name,'resource':kind,'observedSoft':None,'observedHard':None,'matchesPolicy':False};self.limit_rows.append(row);need(type(observed)is tuple and len(observed)==2 and all(type(v)is int for v in observed),'kernel-limit-shape');row.update(observedSoft=observed[0],observedHard=observed[1],matchesPolicy=observed==(soft,hard));need(row['matchesPolicy'],'kernel-limit-drift')
   self.phase='recheck';need(self._call(admit,nsfd,pidfd,creds)==identity,'namespace-drift');need(self._call(terminal,pidfd)is False,'sender-terminal');self.phase='ack';self._check();self.ack_attempted=True;self.ack_may_have_escaped=True;result=send(ack);self._check();need(type(result)is int and result==len(ack),'ack-incomplete');self.ack_sent=True;self.admitted=True;self.phase='admitted'
  except BaseException as error:self._fail(reason,error);primary=self._original;self.admitted=False
  finally:
   if primary is not None or self.first is not None:self._close_owned();self.closed=True;self.phase='refused';primary=self._original
   self.busy=False
  if primary is not None:raise primary
  self._check();return self.status()
 def close(self):
  if self.busy:self._poison()
  if self.closed:return self.status()
  self.busy=True
  try:self._close_owned()
  finally:self.busy=False;self.closed=True
  if self.first is not None:self.phase='refused';raise self._original
  self.phase='closed';return self.status()
 def status(self):
  if self.busy:self._poison()
  return{'schema':'bw.provisioning-observer-admission.v1','phase':self.phase,'closed':self.closed,'admissionObserved':self.admitted and self.first is None,'firstFailure':self.first,'cleanupRefused':self.cleanup,'packet':None if self.packet_raw is None else json.loads(self.packet_raw),'kernelLimitRows':[dict(row)for row in self.limit_rows],'handlesAdmitted':self.handles_admitted,'ownedDescriptors':sum(fd not in self._consumed for fd in set(self._fds)),'ackAttempted':self.ack_attempted,'ackSent':self.ack_sent,'ackMayHaveEscaped':self.ack_may_have_escaped,'namespaceOwnershipQualified':False,'continuousPIDLeaseQualified':False,'outerTimeoutQualified':False,'officialHostQualified':False,'resourceSufficiencyQualified':False,'aggregateQuotaQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
