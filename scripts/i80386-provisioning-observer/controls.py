"""Manufactured packet + held-helper fake. All sockets, FDs and prlimit mocked."""
import array,copy,hashlib,importlib.util,io,json,os,resource,socket,stat,struct,unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('resource_observer',Path(__file__).with_name('observer.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
LOAD_REAL=m.Observer._load_boundary
BOUNDARY_BODY=(Path(__file__).parent.parent/'i80386-supervisor-outer-boundary/boundary.py').read_bytes()
def packet():
 policy=[{'name':n,'resource':r,'soft':s,'hard':h}for n,r,s,h in m._POLICY];rows=[dict(p,setReturned=True,observations=[{'position':position,'shapeValid':True,'soft':p['soft'],'hard':p['hard'],'matchesPolicy':True}for position in('immediate','final')])for p in policy]
 flags=('namespaceOwnershipQualified','officialHostQualified','aggregateResourceQuotaQualified','diskQuotaQualified','actualResourceSufficiencyQualified','outerTimeoutQualified','bootstrapConnected','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified')
 limits={'schema':'bw.provisioning-pid1-limits.v1','phase':'prepared','closed':True,'prepared':True,'firstFailure':None,'stoppedPhase':None,'eligibility':{k:True for k in('linuxObserved','pid1Observed','rootCredentialsObserved','githubContextObserved')},'policy':policy,'rows':rows,'setAttempted':5,'getAttempted':10,'processLimitsPrepared':True,**{k:False for k in flags}}
 return{'schema':'bw.provisioning-contained-resource.v1','components':{n:{'bytes':b,'sha256':h}for n,b,h in m._COMPONENTS},'limits':limits,'controllerBootstrapStarted':False,'observerOwnershipQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False}
def raw(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
class Channel:
 def __init__(self,test):self.test=test;self.closes=0;self.sent=[];self.body=raw(packet());self.ancillary=[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',(41,42)).tobytes()),(socket.SOL_SOCKET,socket.SCM_CREDENTIALS,struct.pack('3i',1337,0,0))];self.flags=0;self.hook=None;self.send_result=4;self.send_error=None;self.close_error=None
 def getsockopt(self,*args):return int(socket.SOCK_SEQPACKET)
 def setsockopt(self,*args):pass
 def settimeout(self,value):self.test.trace.append(('timeout',value))
 def recvmsg(self,*args):
  self.test.trace.append(('receive',args))
  if self.hook:self.hook('receive')
  return self.body,self.ancillary,self.flags,None
 def send(self,value):
  self.sent.append(value);self.test.trace.append(('ack',value))
  if self.hook:self.hook('ack')
  if self.send_error:raise self.send_error
  return self.send_result
 def close(self):
  self.closes+=1
  if self.close_error:raise self.close_error
class T(unittest.TestCase):
 def setUp(self):
  self.stack=ExitStack();self.addCleanup(self.stack.close);self.owner=m.Observer();self.trace=[];self.channel=Channel(self);self.join_calls=[];self.poll_calls=[];self.poll_values=[];self.limit_values={r:(s,h)for _,r,s,h in m._POLICY};self.join_values=[(7,8),(7,8)];self.join_error=None;self.limit_hook=None
  def admit(ns,pid,creds):
   self.join_calls.append((ns,pid,creds));self.trace.append(('join',))
   if self.join_error:raise self.join_error
   return self.join_values[min(len(self.join_calls)-1,len(self.join_values)-1)]
  def terminal(fd):self.poll_calls.append(fd);return self.poll_values.pop(0)if self.poll_values else False
  self.boundary=SimpleNamespace(admit_handles=admit,pidfd_terminal=terminal)
  self.close=self.stack.enter_context(patch.object(os,'close'))
  def limits(pid,kind):
   self.trace.append(('prlimit',pid,kind))
   if self.limit_hook:self.limit_hook(pid,kind)
   return self.limit_values[kind]
  self.prlimit=self.stack.enter_context(patch.object(resource,'prlimit',side_effect=limits))
  self.loader=self.stack.enter_context(patch.object(m.Observer,'_load_boundary',return_value=self.boundary))
 def harness(self):self.stack.enter_context(patch.object(m,'_channel',return_value=self.channel))
 def test_default_actual_and_channel_zero_operations(self):
  with self.assertRaises(m.Refusal):m.actual()
  with self.assertRaises(m.Refusal):self.owner._receive()
  self.prlimit.assert_not_called();self.loader.assert_not_called();self.close.assert_not_called();self.assertIsNone(m.ACTUAL_SEAL)
 def test_independent_decode_then_kernel_readonly_before_ack(self):
  self.harness();v=self.owner._receive();self.assertTrue(v['admissionObserved']);self.assertFalse(v['closed']);self.assertEqual(v['ownedDescriptors'],2);self.assertEqual(self.prlimit.call_args_list,[unittest.mock.call(1337,r)for _,r,_,_ in m._POLICY]);self.assertEqual(self.join_calls,[(41,42,(1337,0,0))]*2);self.assertEqual(self.channel.sent,[b'ACK\n']);self.close.assert_not_called();self.assertEqual(len(self.poll_calls),12)
  labels=[r[0]for r in self.trace];self.assertLess(max(i for i,x in enumerate(labels)if x=='prlimit'),labels.index('ack'))
  for flag in('namespaceOwnershipQualified','continuousPIDLeaseQualified','outerTimeoutQualified','officialHostQualified','resourceSufficiencyQualified','aggregateQuotaQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified'):self.assertIs(v[flag],False)
  self.owner.close();self.assertEqual(self.close.call_args_list,[unittest.mock.call(42),unittest.mock.call(41)]);self.assertEqual(self.channel.closes,1);self.owner.close();self.assertEqual(self.close.call_count,2)
 def refusal(self):
  with self.assertRaises(Exception):self.owner._receive()
  self.assertFalse(self.owner.status()['admissionObserved']);self.assertTrue(self.owner.closed)
 def test_payload_version_extra_missing_and_components(self):
  self.harness()
  for mutate in ('version','extra','missing','component','bootstrap'):
   self.owner=m.Observer();v=packet()
   if mutate=='version':v['schema']='wrong'
   elif mutate=='extra':v['extra']=1
   elif mutate=='missing':del v['limits']
   elif mutate=='component':v['components']['limits']['sha256']='0'*64
   else:v['controllerBootstrapStarted']=True
   self.channel.body=raw(v);self.refusal();self.assertEqual(self.channel.sent,[])
  self.prlimit.assert_not_called()
 def test_duplicate_json_float_nonfinite_depth_cap(self):
  self.harness()
  for body in (b'{"schema":1,"schema":2}',b'{"x":1.5}',b'{"x":NaN}',b'['*20+b'0'+b']'*20,b' '*8193):
   self.owner=m.Observer();self.channel.body=body;self.refusal()
  self.prlimit.assert_not_called();self.assertEqual(self.channel.sent,[])
 def test_bool_zero_counts_policy_rows_and_flags(self):
  self.harness()
  for mutation in ('counter','core','observed','flag','count'):
   self.owner=m.Observer();v=packet()
   if mutation=='counter':v['limits']['getAttempted']=True
   elif mutation=='core':v['limits']['policy'][-1]['soft']=False
   elif mutation=='observed':v['limits']['rows'][-1]['observations'][-1]['hard']=False
   elif mutation=='flag':v['limits']['namespaceOwnershipQualified']=1
   else:v['limits']['rows'].pop()
   self.channel.body=raw(v);self.refusal()
  self.prlimit.assert_not_called()
 def test_unknown_ancillary_later_rights_all_close(self):
  self.harness();self.channel.ancillary=[(0,0,b'unknown'),*self.channel.ancillary];self.refusal();self.assertEqual(self.close.call_args_list,[unittest.mock.call(42),unittest.mock.call(41)]);self.assertEqual(self.channel.closes,1);self.assertEqual(self.join_calls,[])
 def test_truncation_remainder_duplicates_and_multiple_credentials(self):
  self.harness();original=list(self.channel.ancillary)
  for case in('truncated','remainder','duplicate','credentials'):
   self.owner=m.Observer();self.channel.ancillary=list(original);self.channel.flags=0;self.close.reset_mock()
   if case=='truncated':self.channel.flags=socket.MSG_CTRUNC
   elif case=='remainder':self.channel.ancillary[0]=(socket.SOL_SOCKET,socket.SCM_RIGHTS,original[0][2]+b'x')
   elif case=='duplicate':self.channel.ancillary[0]=(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',(41,41)).tobytes())
   else:self.channel.ancillary.append(original[1])
   self.refusal();self.assertEqual(self.close.call_count,1 if case=='duplicate'else 2)
  self.prlimit.assert_not_called()
 def test_foreign_or_nonroot_credentials_refuse_before_join(self):
  self.harness()
  for creds in((1,0,0),(1337,1,0),(1337,0,1)):
   self.owner=m.Observer();self.channel.ancillary[1]=(socket.SOL_SOCKET,socket.SCM_CREDENTIALS,struct.pack('3i',*creds));self.refusal()
  self.assertEqual(self.join_calls,[])
 def test_held_admit_original_error_no_kernel_reads_ack(self):
  self.harness();original=OSError('held admission');self.join_error=original
  with self.assertRaises(OSError)as caught:self.owner._receive()
  self.assertIs(caught.exception,original);self.prlimit.assert_not_called();self.assertEqual(self.channel.sent,[])
 def test_terminal_before_and_mid_reads_no_ack(self):
  self.harness()
  for replies,expected_calls in(([True],0),([False,False,True],1)):
   self.owner=m.Observer();self.poll_values=list(replies);self.prlimit.reset_mock();self.refusal();self.assertEqual(self.prlimit.call_count,expected_calls);self.assertEqual(self.channel.sent,[])
 def test_kernel_drift_bool_and_infinite_refuse(self):
  self.harness()
  for value in((179,180),(True,180),(-1,-1),[180,180]):
   self.owner=m.Observer();self.limit_values[0]=value;self.refusal();self.assertEqual(self.channel.sent,[])
 def test_namespace_identity_recheck_drift_no_ack(self):
  self.harness();self.join_values=[(7,8),(7,9)];self.refusal();self.assertEqual(self.prlimit.call_count,5);self.assertEqual(self.channel.sent,[])
 def test_prlimit_original_error_survives_close_uncertainty(self):
  self.harness();original=OSError('readonly kernel');self.prlimit.side_effect=original;self.close.side_effect=RuntimeError('close uncertainty')
  with self.assertRaises(OSError)as caught:self.owner._receive()
  self.assertIs(caught.exception,original);self.assertEqual(self.owner.status()['cleanupRefused'],2);self.assertEqual(self.channel.sent,[])
 def test_ack_short_error_and_reentry_may_escape(self):
  self.harness()
  for case in('short','error','reentry'):
   self.owner=m.Observer();self.channel.send_result=4;self.channel.send_error=None;self.channel.hook=None
   if case=='short':self.channel.send_result=1
   elif case=='error':self.channel.send_error=OSError('uncertain ACK')
   else:
    def hook(phase):
     if phase=='ack':
      try:self.owner.status()
      except m.Refusal:pass
    self.channel.hook=hook
   self.refusal();v=self.owner.status();self.assertTrue(v['ackAttempted']);self.assertTrue(v['ackMayHaveEscaped']);self.assertFalse(v['ackSent']);self.assertFalse(v['admissionObserved'])
 def test_receive_reentry_still_collects_returned_fds(self):
  self.harness()
  def hook(phase):
   try:self.owner.status()
   except m.Refusal:pass
  self.channel.hook=hook;self.refusal();self.assertEqual(self.close.call_count,2);self.prlimit.assert_not_called();self.assertEqual(self.join_calls,[])
 def test_prlimit_swallowed_reentry_no_next_read_ack(self):
  self.harness()
  def hook(pid,kind):
   try:self.owner._receive()
   except m.Refusal:pass
  self.limit_hook=hook;self.refusal();self.assertEqual(self.prlimit.call_count,1);self.assertEqual(self.channel.sent,[])
 def test_capture_policy_source_and_prlimit_before_hooks(self):
  self.harness();original=self.channel.settimeout;saved=(m._POLICY,m._COMPONENTS,m._BOUNDARY)
  def timeout(value):m._POLICY=();m._COMPONENTS=();m._BOUNDARY=();resource.prlimit=lambda*a:(_ for _ in()).throw(AssertionError('substitute'));return original(value)
  self.channel.settimeout=timeout;old_get=resource.prlimit
  try:v=self.owner._receive();self.assertTrue(v['admissionObserved']);self.assertEqual(self.prlimit.call_count,5)
  finally:m._POLICY,m._COMPONENTS,m._BOUNDARY=saved;resource.prlimit=old_get;self.owner.close()
 def test_preentry_policy_override_zero_channel(self):
  bad=list(m._POLICY);bad[-1]=('coreBytes',4,False,False)
  with patch.object(m,'_POLICY',tuple(bad)),patch.object(m,'_channel')as channel:
   with self.assertRaises(m.Refusal):self.owner._receive()
   channel.assert_not_called()
  self.prlimit.assert_not_called()
 def test_close_reentry_and_uncertainty_consumed_no_retry(self):
  self.harness();self.owner._receive()
  def close(fd):
   if fd==42:
    try:self.owner.status()
    except m.Refusal:pass
   raise OSError('uncertain close')
  self.close.side_effect=close
  with self.assertRaises(m.Refusal):self.owner.close()
  self.assertEqual(self.close.call_count,2);self.assertEqual(self.channel.closes,1);self.owner.close();self.assertEqual(self.close.call_count,2);self.assertEqual(self.owner.status()['ownedDescriptors'],0)
 def test_status_snapshot_and_no_caller_fd_factory_api(self):
  self.harness();v=self.owner._receive();v['packet']['limits']['policy'][0]['soft']=1;v['kernelLimitRows'][0]['observedSoft']=1;again=self.owner.status();self.assertEqual(again['packet']['limits']['policy'][0]['soft'],180);self.assertEqual(again['kernelLimitRows'][0]['observedSoft'],180);self.owner.close()
  with self.assertRaises(TypeError):m.Observer(fd=1)
 def loader_harness(self,body=None,shape=None,hash_fn=None,compile_fn=None):
  body=BOUNDARY_BODY if body is None else body;meta=SimpleNamespace(st_mode=stat.S_IFREG|0o644,st_size=11573,st_nlink=1,st_dev=1,st_ino=2,st_mtime_ns=3);state=[0]
  opened=unittest.mock.Mock(return_value=201);fstat=unittest.mock.Mock(return_value=meta if shape is None else shape);named=unittest.mock.Mock(return_value=meta)
  def read(fd,cap):
   part=body[state[0]:state[0]+cap];state[0]+=len(part);return part
  self.owner._close_fd=self.close;self.owner._loader_ops=(opened,fstat,read,named,hash_fn or hashlib.sha256,compile_fn or compile,exec)
  return opened,fstat,named
 def test_exact_held_loader_mock_fd_hash_compile_exec(self):
  self.loader_harness()
  with patch.object(Path,'resolve',new=lambda path,strict=False:path):module=LOAD_REAL(self.owner,m._ROOT,m._BOUNDARY)
  self.assertTrue(callable(module.admit_handles));self.assertTrue(callable(module.pidfd_terminal));self.close.assert_called_once_with(201)
 def test_held_loader_shape_hash_and_read_close_primary(self):
  wrong=SimpleNamespace(st_mode=stat.S_IFDIR,st_size=11573,st_nlink=1,st_dev=1,st_ino=2,st_mtime_ns=3);self.loader_harness(shape=wrong)
  with self.assertRaises(m.Refusal):LOAD_REAL(self.owner,m._ROOT,m._BOUNDARY)
  self.close.assert_called_once_with(201);self.owner=m.Observer();self.close.reset_mock();self.loader_harness(body=b'X'*11573)
  with self.assertRaises(m.Refusal):LOAD_REAL(self.owner,m._ROOT,m._BOUNDARY)
  self.close.assert_called_once_with(201);self.owner=m.Observer();self.close.reset_mock();self.loader_harness();original=OSError('source read');operations=list(self.owner._loader_ops)
  def read(*args):raise original
  operations[2]=read;self.owner._loader_ops=tuple(operations);self.close.side_effect=RuntimeError('close')
  with self.assertRaises(OSError)as caught:LOAD_REAL(self.owner,m._ROOT,m._BOUNDARY)
  self.assertIs(caught.exception,original);self.close.assert_called_once_with(201);self.assertEqual(self.owner.cleanup,1)
 def test_held_loader_returned_fd_reentry_closed_once(self):
  self.loader_harness();self.owner.busy=True;operations=list(self.owner._loader_ops)
  def opened(*args):
   try:self.owner.status()
   except m.Refusal:pass
   return 201
  operations[0]=opened;self.owner._loader_ops=tuple(operations)
  with self.assertRaises(m.Refusal):LOAD_REAL(self.owner,m._ROOT,m._BOUNDARY)
  self.close.assert_called_once_with(201)
 def test_held_loader_compile_reentry_no_exec(self):
  self.owner.busy=True;called=[]
  def compiled(*args):
   called.append(1)
   try:self.owner.status()
   except m.Refusal:pass
   return compile(*args)
  self.loader_harness(compile_fn=compiled)
  with self.assertRaises(m.Refusal):LOAD_REAL(self.owner,m._ROOT,m._BOUNDARY)
  self.assertEqual(called,[1]);self.close.assert_called_once_with(201)
 def test_exact_held_admit_and_terminal_helpers_mock_kernel(self):
  self.loader_harness()
  with patch.object(Path,'resolve',new=lambda path,strict=False:path):held=LOAD_REAL(self.owner,m._ROOT,m._BOUNDARY)
  self.harness();self.loader.return_value=held;self.owner=m.Observer()
  class Poll:
   def register(self,*args):pass
   def poll(self,*args):return[]
  namespace=SimpleNamespace(st_dev=7,st_ino=8)
  def status(path,*args,**kwargs):return SimpleNamespace(st_dev=7,st_ino=9 if path=='/proc/self/ns/pid'else 8)
  with patch.object(held.fcntl,'ioctl',return_value=0x20000000),patch.object(held.os,'readlink',return_value='anon_inode:[pidfd]'),patch.object(held.os,'fstat',return_value=namespace),patch.object(held.os,'stat',side_effect=status),patch('builtins.open',side_effect=lambda*args,**kwargs:io.BytesIO(b'Pid:\t1337\nNSpid:\t1337 1\n')),patch.object(held.select,'poll',return_value=Poll()):v=self.owner._receive()
  self.assertTrue(v['admissionObserved']);self.assertEqual(self.prlimit.call_count,5);self.assertEqual(self.channel.sent,[b'ACK\n']);self.owner.close()
 def test_malformed_ancillary_tuple_does_not_lose_later_fds(self):
  self.harness();self.channel.ancillary=[None,(1,2),*self.channel.ancillary];self.refusal();self.assertEqual(self.close.call_count,2);self.assertEqual(self.join_calls,[])
 def test_source_loader_functions_captured_before_channel_hook(self):
  self.harness();original=self.channel.settimeout;saved=[];source_meta=SimpleNamespace(st_mode=stat.S_IFREG|0o644,st_size=11573,st_nlink=1,st_dev=1,st_ino=2,st_mtime_ns=3);offset=[0];opens=[]
  def opened(*args):opens.append(args);return 201
  def read(fd,cap):part=BOUNDARY_BODY[offset[0]:offset[0]+cap];offset[0]+=len(part);return part
  def timeout(value):
   for name in('open','fstat','read','stat'):
    saved.append((name,getattr(os,name)));setattr(os,name,lambda*a,**kw:(_ for _ in()).throw(AssertionError('substituted source operation')))
   return original(value)
  def loaded(root,spec):LOAD_REAL(self.owner,root,spec);return self.boundary
  self.loader.side_effect=loaded;self.channel.settimeout=timeout
  with patch.object(os,'open',side_effect=opened),patch.object(os,'fstat',return_value=source_meta),patch.object(os,'read',side_effect=read),patch.object(os,'stat',return_value=source_meta),patch.object(Path,'resolve',new=lambda path,strict=False:path):
   try:
    value=self.owner._receive();self.assertTrue(value['admissionObserved']);self.assertEqual(len(opens),1);self.assertEqual(offset[0],11573);self.assertEqual(self.prlimit.call_count,5);self.owner.close()
   finally:
    for name,fn in saved:setattr(os,name,fn)
 def test_boolean_ancillary_metadata_refuses_but_closes_rights(self):
  self.harness();rights=self.channel.ancillary[0];self.channel.ancillary[0]=(True,rights[1],rights[2]);self.refusal();self.assertEqual(self.close.call_count,2);self.prlimit.assert_not_called();self.assertEqual(self.channel.sent,[])
if __name__=='__main__':unittest.main()
