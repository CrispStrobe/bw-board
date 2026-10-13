"""Unconnected fixed contained entry: limits, own handles, ACK, then controller."""
import array,hashlib,json,os,socket,stat,types
from pathlib import Path
ACTUAL_SEAL=None
_CHECKOUT=str(Path(__file__).parent.parent.parent)
_APPROVAL_RAW=None
_DESCRIPTOR_RAW=None
_TABLE_RAW=None
_COMPONENTS=(('limits','scripts/i80386-provisioning-pid1/limits.py',5805,'829872fee3f1565ec8a67c57e74a7caba8c202b027ea6260f184425e888455d4'),('controller','scripts/i80386-full-tree-provisioning-launcher/controller.py',19661,'9cb7cb6411694b65a9fe18a318967e04b3e24f5d9f86d4f59e48797fd19a43dd'))
_PACKET_CAP=8192
_ACK=b'ACK\n'
_POLICY=(('cpuSeconds',0,180,180),('addressSpaceBytes',9,2147483648,2147483648),('fileBytes',1,67108864,67108864),('fdCount',7,256,256),('coreBytes',4,0,0))
class Refusal(ValueError):pass
def actual():raise Refusal('actual-unsealed')
def _channel():raise Refusal('channel-unconnected')
def need(ok,code):
 if not ok:raise Refusal(code)
def keys(value,names):need(type(value)is dict and len(value)==len(names)and all(type(k)is str for k in value)and set(value)==set(names),'closed-shape')
def resource_facts(value):
 flags=('namespaceOwnershipQualified','officialHostQualified','aggregateResourceQuotaQualified','diskQuotaQualified','actualResourceSufficiencyQualified','outerTimeoutQualified','bootstrapConnected','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified')
 fields=('schema','phase','closed','prepared','firstFailure','stoppedPhase','eligibility','policy','rows','setAttempted','getAttempted','processLimitsPrepared',*flags)
 keys(value,fields);need(value['schema']=='bw.provisioning-pid1-limits.v1'and value['phase']=='prepared'and value['closed']is True and value['prepared']is True and value['processLimitsPrepared']is True and value['firstFailure']is None and value['stoppedPhase']is None and type(value['setAttempted'])is int and value['setAttempted']==5 and type(value['getAttempted'])is int and value['getAttempted']==10,'limits-incomplete');need(all(value[k]is False for k in flags),'limits-flags');keys(value['eligibility'],('linuxObserved','pid1Observed','rootCredentialsObserved','githubContextObserved'));need(all(v is True for v in value['eligibility'].values()),'limits-eligibility');need(type(value['policy'])is list and len(value['policy'])==5 and type(value['rows'])is list and len(value['rows'])==5,'limits-row-count')
 expected_policy=(('cpuSeconds',0,180,180),('addressSpaceBytes',9,2147483648,2147483648),('fileBytes',1,67108864,67108864),('fdCount',7,256,256),('coreBytes',4,0,0))
 for expected,policy,row in zip(expected_policy,value['policy'],value['rows']):
  name,kind,soft,hard=expected;keys(policy,('name','resource','soft','hard'));keys(row,('name','resource','soft','hard','setReturned','observations'))
  for item in(policy,row):need(type(item['name'])is str and item['name']==name and all(type(item[k])is int for k in('resource','soft','hard'))and(item['resource'],item['soft'],item['hard'])==(kind,soft,hard),'limits-policy')
  need(row['setReturned']is True and type(row['observations'])is list and len(row['observations'])==2,'limits-observations')
  for position,observation in zip(('immediate','final'),row['observations']):
   keys(observation,('position','shapeValid','soft','hard','matchesPolicy'));need(observation['position']==position and observation['shapeValid']is True and observation['matchesPolicy']is True and type(observation['soft'])is int and type(observation['hard'])is int and(observation['soft'],observation['hard'])==(soft,hard),'limits-readback')
 # Closed primitive admission precedes JSON traversal; no foreign nested values.
 return json.loads(json.dumps(value,sort_keys=True,separators=(',',':')))
def copied(value,depth=0,budget=None):
 if budget is None:budget=[8192]
 budget[0]-=1;need(budget[0]>=0 and depth<=12,'result-cap')
 if value is None or type(value)is bool:return value
 if type(value)is int:need(-1<=value<=2**64-1,'result-int');return value
 if type(value)is str:need(len(value)<=512,'result-string');return value
 if type(value)is list:need(len(value)<=100,'result-list');return[copied(v,depth+1,budget)for v in value]
 need(type(value)is dict and len(value)<=100 and all(type(k)is str and len(k)<=240 for k in value),'result-shape');return{k:copied(v,depth+1,budget)for k,v in value.items()}
class Entry:
 def __init__(self):
  self.entered=False;self.busy=False;self.closed=False;self.first=None;self.stopped=None;self._original=None;self.phase='new';self.cleanup=0;self.resource=None;self._resource_raw=None;self._controller_raw=None;self.sent=False;self.acked=False;self.controller_loaded=False;self.controller_result=None;self.complete=False;self._limit_owner=None;self._controller=None;self._reentry=False
 def _fail(self,code,error):
  if self.first is None:self.first=code;self.stopped=self.phase;self._original=error
 def _poison(self):
  self._reentry=True;error=Refusal('entry-reentry');self._fail('entry-reentry',error)
  if self._limit_owner is not None:self._limit_owner._fail('entry-reentry',error)
  if self._controller is not None:self._controller.poison()
  raise self._original
 def _check(self):
  if self.first is not None:raise self._original
 def _call(self,fn,*args,**kwargs):self._check();result=fn(*args,**kwargs);self._check();return result
 def _read(self,checkout,relative,extent):
  # Fixed lexical source route. O_NOFOLLOW rejects a substituted final component;
  # full route/Git admission is the held controller's later separate responsibility.
  target=Path(checkout)/relative;fd=None;primary=None;body=None
  try:
   fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);need(type(fd)is int and fd>=0,'component-handle');self._check();st=self._call(os.fstat,fd);need(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_size==extent,'component-shape');parts=[];count=0
   while True:
    part=self._call(os.read,fd,min(65536,extent+1-count));need(type(part)is bytes,'component-bytes')
    if not part:break
    count+=len(part);need(count<=extent,'component-cap');parts.append(part)
   end=self._call(os.fstat,fd);named=self._call(os.stat,target,follow_symlinks=False);need(count==extent and(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns)and stat.S_ISREG(named.st_mode)and end.st_nlink==1 and named.st_nlink==1,'component-changed');body=b''.join(parts)
  except BaseException as error:self._fail('component-read-refused',error);primary=self._original
  finally:
   if type(fd)is int and fd>=0:
    try:os.close(fd)
    except BaseException as error:
     self.cleanup+=1;self._fail('component-close-refused',error)
     if primary is None:primary=self._original
  if primary is not None:raise primary
  self._check();return body
 def _module(self,checkout,spec):
  name,relative,extent,digest=spec;body=self._call(self._read,checkout,relative,extent);h=self._call(hashlib.sha256,body);need(self._call(h.hexdigest)==digest,'component-hash');module=types.ModuleType('contained_'+name);module.__file__=str(Path(checkout)/relative);code=self._call(compile,body,'<fixed-contained-component>','exec');self._call(exec,code,module.__dict__);return module
 def _run(self):
  if self.busy:self._poison()
  need(not self.entered and not self.closed,'entry-once');self.entered=True;self.busy=True;channel=None;channel_close=None;fds=[];closed=set();primary=None;reason='entry-refused'
  try:
   # Immutable source/metadata bindings are captured before the first hook.
   checkout=_CHECKOUT;components=_COMPONENTS;approval=_APPROVAL_RAW;descriptor=_DESCRIPTOR_RAW;table=_TABLE_RAW;packet_cap=_PACKET_CAP;ack=_ACK;validator=resource_facts;copy_result=copied
   need(type(checkout)is str and checkout.startswith('/')and len(checkout)<=4046 and type(components)is tuple and len(components)==2 and packet_cap==8192 and type(packet_cap)is int and ack==b'ACK\n'and type(ack)is bytes,'fixed-bindings')
   expected=(('limits','scripts/i80386-provisioning-pid1/limits.py',5805,'829872fee3f1565ec8a67c57e74a7caba8c202b027ea6260f184425e888455d4'),('controller','scripts/i80386-full-tree-provisioning-launcher/controller.py',19661,'9cb7cb6411694b65a9fe18a318967e04b3e24f5d9f86d4f59e48797fd19a43dd'))
   for row,wanted in zip(components,expected):need(type(row)is tuple and len(row)==4 and all(type(v)is str for v in(row[0],row[1],row[3]))and type(row[2])is int and row==wanted,'component-binding')
   self.phase='channel';channel=_channel();need(channel is not None,'channel-unconnected');channel_close=channel.close;send=channel.sendmsg;receive=channel.recv;set_timeout=channel.settimeout;socket_type=channel.getsockopt;self._check();need(self._call(socket_type,socket.SOL_SOCKET,socket.SO_TYPE)==socket.SOCK_SEQPACKET,'channel-type');self._call(set_timeout,5.0)
   need(type(approval)is bytes and len(approval)<=32768 and type(descriptor)is bytes and len(descriptor)<=8192 and type(table)is bytes and len(table)<=65536,'metadata-unconnected')
   self.phase='limits';limits=self._call(self._module,checkout,components[0]);self._limit_owner=self._call(limits.Limits);facts=self._call(self._limit_owner._prepare);prepared=self._call(validator,facts);self.resource=prepared
   self._resource_raw=self._call(lambda:(json.dumps(prepared,sort_keys=True,separators=(',',':'))+'\n').encode())
   packet={'schema':'bw.provisioning-contained-resource.v1','components':{'limits':{'bytes':components[0][2],'sha256':components[0][3]},'controller':{'bytes':components[1][2],'sha256':components[1][3]}},'limits':prepared,'controllerBootstrapStarted':False,'observerOwnershipQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False};body=self._call(lambda:(json.dumps(packet,sort_keys=True,separators=(',',':'))+'\n').encode());need(len(body)<=packet_cap,'packet-cap')
   # Packet bytes are frozen before namespace/pidfd hooks; never serialize mutable
   # public resource state after acquiring handles.
   self.phase='handles';ns=os.open('/proc/self/ns/pid',os.O_RDONLY);need(type(ns)is int and ns>=0,'namespace-handle');fds.append(ns);self._check();pidfd=os.pidfd_open(1);need(type(pidfd)is int and pidfd>=0,'pid1-handle');fds.append(pidfd);self._check();need(pidfd!=ns,'duplicate-handle')
   self.phase='send';result=self._call(send,[body],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',fds))]);need(type(result)is int and result==len(body),'send-incomplete');self.sent=True;self.phase='ack';reply=self._call(receive,len(ack)+1);need(type(reply)is bytes and reply==ack,'ack-refused');self.acked=True
   self.phase='controller';module=self._call(self._module,checkout,components[1]);self.controller_loaded=True;self._controller=self._call(module.Controller,checkout,approval,descriptor,table);value=self._call(self._controller.run);self.controller_result=self._call(copy_result,value);self._controller_raw=self._call(lambda:json.dumps(self.controller_result,sort_keys=True,separators=(',',':')).encode());need(len(self._controller_raw)<=262144,'controller-result-cap');value=self.controller_result;need(type(value)is dict and value.get('schema')=='bw.provisioning-controller-result.v1'and value.get('complete')is True and value.get('closed')is True and value.get('phase')=='complete'and value.get('firstFailure')is None and type(value.get('cleanupRefused'))is int and value['cleanupRefused']==0,'controller-incomplete');self.complete=True
  except BaseException as error:self._fail(reason,error);primary=self._original;self.complete=False
  finally:
   if self._limit_owner is not None and self._resource_raw is None and not self._reentry:
    try:
     partial=self._limit_owner.status();need(not self._reentry,'entry-reentry');partial=copied(partial);encoded=(json.dumps(partial,sort_keys=True,separators=(',',':'))+'\n').encode();need(not self._reentry and len(encoded)<=8192,'limit-status-cap');self._resource_raw=encoded
    except BaseException as error:
     self._fail('limit-status-refused',error)
     if primary is None:primary=self._original
   for fd in reversed(fds):
    if fd in closed:continue
    closed.add(fd)
    try:os.close(fd)
    except BaseException as error:
     self.cleanup+=1;self._fail('handle-close-refused',error)
     if primary is None:primary=self._original
   if channel is not None:
    try:
     if channel_close is not None:channel_close()
     else:channel.close()
    except BaseException as error:
     self.cleanup+=1;self._fail('channel-close-refused',error)
     if primary is None:primary=self._original
   if self.first is not None:self.complete=False;primary=self._original
   self.phase='complete'if self.complete else'refused';self.busy=False;self.closed=True
  if primary is not None:raise primary
  self._check();return self.status()
 def status(self):
  if self.busy:self._poison()
  return{'schema':'bw.provisioning-contained-entry.v1','phase':self.phase,'closed':self.closed,'complete':self.complete and self.first is None,'firstFailure':self.first,'stoppedPhase':self.stopped,'cleanupRefused':self.cleanup,'resourceFacts':None if self._resource_raw is None else json.loads(self._resource_raw),'handshakeSent':self.sent,'ackReceived':self.acked,'controllerLoaded':self.controller_loaded,'controllerResult':None if self._controller_raw is None else json.loads(self._controller_raw),'observerOwnershipQualified':False,'outerTimeoutQualified':False,'officialHostQualified':False,'resourceSufficiencyQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
