"""Private channel/source harness; all kernel, resource and socket edges mocked."""
import hashlib,importlib.util,json,os,resource,socket,unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('contained_entry',HERE/'entry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CONTROLLER=b'''class Controller:
 def __init__(self,*args):pass
 def run(self):return {'schema':'bw.provisioning-controller-result.v1','phase':'complete','closed':True,'complete':True,'firstFailure':None,'cleanupRefused':0,'actualAcquisitionQualified':False}
 def poison(self):pass
'''
class Channel:
 def __init__(self,trace):self.trace=trace;self.sent=None;self.handles=None;self.closed=0;self.reply=b'ACK\n';self.hook=None;self.close_error=None;self.count=None;self.socket_type=socket.SOCK_SEQPACKET
 def getsockopt(self,*args):return self.socket_type
 def settimeout(self,value):self.trace.append(('timeout',value))
 def sendmsg(self,buffers,ancillary):
  self.trace.append(('send',));self.sent=buffers[0];self.handles=ancillary
  if self.hook:self.hook('send')
  return len(self.sent)if self.count is None else self.count
 def recv(self,cap):
  self.trace.append(('recv',cap))
  if self.hook:self.hook('recv')
  return self.reply[:cap]
 def close(self):
  self.closed+=1;self.trace.append(('channel-close',))
  if self.close_error:raise self.close_error
class T(unittest.TestCase):
 def setUp(self):
  self.stack=ExitStack();self.addCleanup(self.stack.close);self.trace=[];self.owner=m.Entry();self.channel=Channel(self.trace);self.installed={};self.controller_reads=0;self.set_hook=None
  self.limits=(HERE.parent/'i80386-provisioning-pid1/limits.py').read_bytes();self.components=m._COMPONENTS
  for name,value in (('getpid',1),('geteuid',0),('getgid',0),('getegid',0)):self.stack.enter_context(patch.object(os,name,return_value=value))
  self.stack.enter_context(patch.object(os,'environ',{'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_RUN_ATTEMPT':'1'}))
  def set_limit(kind,value):
   self.trace.append(('set',kind));self.installed[kind]=value
   if self.set_hook:self.set_hook()
  def get_limit(kind):self.trace.append(('get',kind));return self.installed[kind]
  self.setter=self.stack.enter_context(patch.object(resource,'setrlimit',side_effect=set_limit));self.getter=self.stack.enter_context(patch.object(resource,'getrlimit',side_effect=get_limit))
  def opened(*args):self.trace.append(('namespace-open',));return 41
  def pidfd(*args):self.trace.append(('pidfd-open',));return 42
  def closed(fd):self.trace.append(('fd-close',fd))
  self.ns_open=self.stack.enter_context(patch.object(os,'open',side_effect=opened));self.pid_open=self.stack.enter_context(patch.object(os,'pidfd_open',side_effect=pidfd));self.fd_close=self.stack.enter_context(patch.object(os,'close',side_effect=closed))
 def harness(self):
  self.stack.enter_context(patch.object(m,'_APPROVAL_RAW',b'{}'));self.stack.enter_context(patch.object(m,'_DESCRIPTOR_RAW',b'{}'));self.stack.enter_context(patch.object(m,'_TABLE_RAW',b'{}'));self.stack.enter_context(patch.object(m,'_channel',return_value=self.channel))
  test=self
  def read(owner,checkout,relative,extent):
   if relative==self.components[0][1]:self.trace.append(('read-limits',));return test.limits
   self.trace.append(('read-controller',));self.controller_reads+=1;return CONTROLLER
  self.stack.enter_context(patch.object(m.Entry,'_read',new=read))
  original=m.Entry._module
  def module(owner,checkout,spec):
   if spec[0]=='limits':return original(owner,checkout,spec)
   test.assertEqual(spec,test.components[1]);test.trace.append(('read-controller',));test.controller_reads+=1
   value=m.types.ModuleType('manufactured_controller');code=owner._call(m.__dict__.get('compile',compile),CONTROLLER,'<manufactured-controller>','exec');owner._call(exec,code,value.__dict__);return value
  self.stack.enter_context(patch.object(m.Entry,'_module',new=module))
 def test_actual_and_default_channel_zero_operations(self):
  with self.assertRaises(m.Refusal):m.actual()
  with self.assertRaises(m.Refusal):self.owner._run()
  self.ns_open.assert_not_called();self.pid_open.assert_not_called();self.setter.assert_not_called();self.getter.assert_not_called();self.assertEqual(self.controller_reads,0);self.assertIsNone(m.ACTUAL_SEAL)
 def test_order_limits_handles_send_ack_controller(self):
  self.harness();v=self.owner._run();self.assertTrue(v['complete']);self.assertEqual(self.setter.call_count,5);self.assertEqual(self.getter.call_count,10);self.assertEqual(self.channel.closed,1);self.assertEqual(self.fd_close.call_args_list,[unittest.mock.call(42),unittest.mock.call(41)])
  labels=[r[0]for r in self.trace];self.assertLess(max(i for i,x in enumerate(labels)if x=='get'),labels.index('namespace-open'));self.assertLess(labels.index('send'),labels.index('recv'));self.assertLess(labels.index('recv'),labels.index('read-controller'));packet=json.loads(self.channel.sent);self.assertEqual(packet['schema'],'bw.provisioning-contained-resource.v1');self.assertFalse(packet['controllerBootstrapStarted']);self.assertLessEqual(len(self.channel.sent),8192);self.assertEqual(list(self.channel.handles[0][2]),[41,42]);self.assertEqual(self.channel.handles[0][:2],(socket.SOL_SOCKET,socket.SCM_RIGHTS))
  for flag in ('observerOwnershipQualified','outerTimeoutQualified','officialHostQualified','resourceSufficiencyQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified'):self.assertIs(v[flag],False)
 def test_stream_socket_refuses_before_limit_source(self):
  self.harness();self.channel.socket_type=socket.SOCK_STREAM
  with self.assertRaises(m.Refusal):self.owner._run()
  self.setter.assert_not_called();self.assertEqual(self.trace,[('channel-close',)])
 def test_wrong_overlong_and_absent_ack_no_controller(self):
  self.harness()
  for reply in (b'bad\n',b'',b'ACK\nextra'):
   self.owner=m.Entry();self.channel.reply=reply
   with self.assertRaises(m.Refusal):self.owner._run()
   self.assertEqual(self.controller_reads,0);self.assertFalse(self.owner.status()['ackReceived']);self.assertFalse(self.owner.status()['complete'])
 def test_ack_timeout_preserves_original_and_closes_handles(self):
  self.harness();original=TimeoutError('manufactured ack timeout')
  def recv(cap):raise original
  self.channel.recv=recv
  with self.assertRaises(TimeoutError)as caught:self.owner._run()
  self.assertIs(caught.exception,original);self.assertEqual(self.controller_reads,0);self.assertEqual(self.fd_close.call_count,2);self.assertEqual(self.channel.closed,1)
 def test_partial_send_refuses_before_recv_controller(self):
  self.harness();self.channel.count=1
  with self.assertRaises(m.Refusal):self.owner._run()
  self.assertNotIn('recv',[r[0]for r in self.trace]);self.assertEqual(self.controller_reads,0)
 def test_second_handle_open_error_primary_survives_close(self):
  self.harness();original=OSError('manufactured pidfd');self.pid_open.side_effect=original;self.fd_close.side_effect=OSError('manufactured close')
  with self.assertRaises(OSError)as caught:self.owner._run()
  self.assertIs(caught.exception,original);self.fd_close.assert_called_once_with(41);self.assertEqual(self.channel.closed,1);self.assertEqual(self.owner.status()['cleanupRefused'],1)
 def test_namespace_open_error_stops_pidfd(self):
  self.harness();original=OSError('manufactured namespace');self.ns_open.side_effect=original
  with self.assertRaises(OSError)as caught:self.owner._run()
  self.assertIs(caught.exception,original);self.pid_open.assert_not_called();self.fd_close.assert_not_called();self.assertEqual(self.channel.closed,1)
 def test_swallowed_set_reentry_no_handles_or_send(self):
  self.harness()
  def hook():
   try:self.owner.status()
   except m.Refusal:pass
  self.set_hook=hook
  with self.assertRaises(m.Refusal):self.owner._run()
  self.ns_open.assert_not_called();self.getter.assert_not_called();self.assertIsNone(self.channel.sent);self.assertEqual(self.owner.status()['firstFailure'],'entry-reentry')
 def test_swallowed_send_and_recv_reentry_no_controller(self):
  self.harness()
  for phase in ('send','recv'):
   self.owner=m.Entry()
   def hook(name):
    if name==phase:
     try:self.owner.status()
     except m.Refusal:pass
   self.channel.hook=hook
   with self.assertRaises(m.Refusal):self.owner._run()
   self.assertEqual(self.controller_reads,0);self.assertFalse(self.owner.status()['complete'])
 def test_returned_handle_reentry_registered_before_fence(self):
  self.harness()
  def opened(*args):
   try:self.owner.status()
   except m.Refusal:pass
   return 41
  self.ns_open.side_effect=opened
  with self.assertRaises(m.Refusal):self.owner._run()
  self.fd_close.assert_called_once_with(41);self.pid_open.assert_not_called()
 def test_compile_reentry_no_controller_execution(self):
  self.harness();original=compile;calls=[]
  def compiled(*args,**kwargs):
   calls.append(1)
   if len(calls)==2:
    try:self.owner.status()
    except m.Refusal:pass
   return original(*args,**kwargs)
  with patch.object(m,'compile',new=compiled,create=True):
   with self.assertRaises(m.Refusal):self.owner._run()
  self.assertEqual(len(calls),2);self.assertFalse(self.owner.controller_loaded);self.assertIsNone(self.owner._controller);self.assertFalse(self.owner.status()['complete'])
 def test_invalid_limit_readback_never_handles_or_controller(self):
  self.harness();self.getter.side_effect=lambda kind:(False,False)
  with self.assertRaises(Exception):self.owner._run()
  self.ns_open.assert_not_called();self.assertIsNone(self.channel.sent);self.assertEqual(self.controller_reads,0)
 def test_captured_metadata_pins_and_channel_methods_before_hook(self):
  self.harness();original_set=self.channel.settimeout
  def timeout(value):
   m._APPROVAL_RAW=None;m._DESCRIPTOR_RAW=None;m._TABLE_RAW=None;m._COMPONENTS=();self.channel.sendmsg=lambda*a:(_ for _ in()).throw(AssertionError('substitute send'));self.channel.recv=lambda*a:(_ for _ in()).throw(AssertionError('substitute recv'));return original_set(value)
  self.channel.settimeout=timeout
  saved=m._COMPONENTS
  try:
   v=self.owner._run();self.assertTrue(v['complete']);self.assertTrue(v['ackReceived'])
  finally:m._COMPONENTS=saved
 def test_closed_once_no_later_operations(self):
  self.harness();self.owner._run();trace=list(self.trace)
  with self.assertRaises(m.Refusal):self.owner._run()
  self.assertEqual(trace,self.trace)
 def test_cleanup_only_reentry_refuses_after_remaining_close(self):
  self.harness();original=self.fd_close.side_effect
  def close(fd):
   original(fd)
   if fd==42:
    try:self.owner.status()
    except m.Refusal:pass
  self.fd_close.side_effect=close
  with self.assertRaises(m.Refusal):self.owner._run()
  self.assertEqual(self.fd_close.call_count,2);self.assertEqual(self.channel.closed,1);self.assertFalse(self.owner.status()['complete']);self.assertFalse(self.owner.busy);self.assertTrue(self.owner.closed)
 def test_duplicate_handle_refuses_before_send_closes_unique_once(self):
  self.harness();self.pid_open.return_value=41;self.pid_open.side_effect=None
  with self.assertRaises(m.Refusal)as caught:self.owner._run()
  self.assertEqual(str(caught.exception),'duplicate-handle');self.fd_close.assert_called_once_with(41);self.assertIsNone(self.channel.sent);self.assertEqual(self.controller_reads,0)
 def test_exact_fixed_component_rows_before_channel(self):
  self.harness();bad=list(m._COMPONENTS);row=bad[0];bad[0]=(row[0],row[1],row[2]+1,row[3])
  with patch.object(m,'_COMPONENTS',tuple(bad)),patch.object(m,'_channel')as channel:
   with self.assertRaises(m.Refusal):self.owner._run()
   channel.assert_not_called()
  self.ns_open.assert_not_called();self.setter.assert_not_called()
 def test_packet_frozen_before_handle_hook_mutates_public_resource(self):
  self.harness();entered=[]
  class Foreign(dict):
   def items(self):entered.append(1);raise AssertionError('foreign traversal')
  def opened(*args):self.owner.resource=Foreign(rows=object());return 41
  self.ns_open.side_effect=opened;v=self.owner._run();self.assertTrue(v['complete']);self.assertEqual(entered,[]);self.assertEqual(json.loads(self.channel.sent)['limits']['setAttempted'],5);self.assertEqual(v['resourceFacts']['policy'][0]['soft'],180)
 def test_negative_controller_and_bool_cleanup_no_entry_success(self):
  self.harness()
  for mutation in ({'complete':False,'phase':'refused','firstFailure':'manufactured-refusal'},{'cleanupRefused':False}):
   self.owner=m.Entry();original=m.Entry._module
   def module(owner,checkout,spec):
    result=original(owner,checkout,spec)
    if spec[0]=='controller':
     base=result.Controller.run
     def run(controller):value=base(controller);value.update(mutation);return value
     result.Controller.run=run
    return result
   with patch.object(m.Entry,'_module',new=module):
    with self.assertRaises(m.Refusal):self.owner._run()
   self.assertFalse(self.owner.status()['complete']);self.assertEqual(self.owner.phase,'refused');self.assertTrue(self.owner.closed);self.assertIsNotNone(self.owner.status()['controllerResult'])
 def test_partial_limit_install_original_and_bounded_status_retained(self):
  self.harness();original=OSError('manufactured partial limit');real=self.setter.side_effect
  def set_limit(kind,value):
   if kind==9:raise original
   return real(kind,value)
  self.setter.side_effect=set_limit
  with self.assertRaises(OSError)as caught:self.owner._run()
  self.assertIs(caught.exception,original);self.ns_open.assert_not_called();self.assertIsNone(self.channel.sent);self.assertEqual(self.controller_reads,0);v=self.owner.status();self.assertEqual(v['resourceFacts']['setAttempted'],2);self.assertEqual(v['resourceFacts']['getAttempted'],1);self.assertFalse(v['resourceFacts']['prepared']);self.assertFalse(v['complete'])
if __name__=='__main__':unittest.main()
