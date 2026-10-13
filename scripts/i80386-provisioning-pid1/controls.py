"""Every process/privilege/context/resource operation is mocked; no real limits."""
import importlib.util,unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('pid1_limits',Path(__file__).with_name('limits.py'));m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
class T(unittest.TestCase):
 def setUp(self):
  self.stack=ExitStack();self.addCleanup(self.stack.close);self.owner=m.Limits();self.installed={};self.calls=[];self.context={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_RUN_ATTEMPT':'1'}
  for name,value in (('getpid',1),('geteuid',0),('getgid',0),('getegid',0)):self.stack.enter_context(patch.object(m.os,name,return_value=value))
  self.env=self.stack.enter_context(patch.object(m.os,'environ',self.context));self.stack.enter_context(patch.object(m.sys,'platform','linux'))
  def set_limit(kind,value):self.calls.append(('set',kind,value));self.installed[kind]=value
  def get_limit(kind):self.calls.append(('get',kind));return self.installed[kind]
  self.setter=self.stack.enter_context(patch.object(m.resource,'setrlimit',side_effect=set_limit));self.getter=self.stack.enter_context(patch.object(m.resource,'getrlimit',side_effect=get_limit))
 def test_actual_unsealed_before_all_operations(self):
  with patch.object(m.os,'getpid',side_effect=AssertionError('pid')),patch.object(m.os,'getenv',side_effect=AssertionError('env')),patch.object(m.os,'environ',None):
   with self.assertRaises(m.Refusal):m.actual()
  self.setter.assert_not_called();self.getter.assert_not_called();self.assertIsNone(m.ACTUAL_SEAL)
 def test_fixed_order_immediate_then_final_readback(self):
  v=self.owner._prepare();self.assertTrue(v['prepared']);self.assertEqual(v['setAttempted'],5);self.assertEqual(v['getAttempted'],10)
  expected=[]
  for _,kind,soft,hard in m.POLICY:expected.extend([('set',kind,(soft,hard)),('get',kind)])
  expected.extend(('get',row[1])for row in m.POLICY);self.assertEqual(self.calls,expected)
  for row in v['rows']:self.assertEqual([o['position']for o in row['observations']],['immediate','final']);self.assertTrue(all(o['matchesPolicy']for o in row['observations']))
  for key in ('namespaceOwnershipQualified','officialHostQualified','aggregateResourceQuotaQualified','diskQuotaQualified','actualResourceSufficiencyQualified','outerTimeoutQualified','bootstrapConnected','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified'):self.assertIs(v[key],False)
 def test_pid_and_privilege_guards_before_sets(self):
  for name,value in (('getpid',2),('geteuid',1),('getgid',1),('getegid',1),('getpid',True)):
   self.owner=m.Limits()
   with patch.object(m.os,name,return_value=value):
    with self.assertRaises(m.Refusal):self.owner._prepare()
   self.setter.assert_not_called();self.getter.assert_not_called();self.assertFalse(self.owner.status()['prepared'])
 def test_linux_and_hosted_context_guards(self):
  with patch.object(m.sys,'platform','darwin'):
   with self.assertRaises(m.Refusal):self.owner._prepare()
  for key,value in (('GITHUB_ACTIONS','false'),('GITHUB_REPOSITORY','foreign/repo'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_RUN_ATTEMPT',True)):
   self.owner=m.Limits();original=self.context[key];self.context[key]=value
   try:
    with self.assertRaises(m.Refusal):self.owner._prepare()
   finally:self.context[key]=original
  self.setter.assert_not_called();self.getter.assert_not_called()
 def test_once_only_no_restore_or_retry(self):
  self.owner._prepare();before=list(self.calls)
  with self.assertRaises(m.Refusal):self.owner._prepare()
  self.assertEqual(self.calls,before)
 def test_partial_set_error_preserves_original_object(self):
  original=OSError('manufactured set refusal');real=self.setter.side_effect
  def set_limit(kind,value):
   if kind==9:raise original
   return real(kind,value)
  self.setter.side_effect=set_limit
  with self.assertRaises(OSError)as caught:self.owner._prepare()
  self.assertIs(caught.exception,original);v=self.owner.status();self.assertEqual(v['setAttempted'],2);self.assertEqual(v['getAttempted'],1);self.assertEqual(len(v['rows']),2);self.assertTrue(v['rows'][0]['setReturned']);self.assertFalse(v['rows'][1]['setReturned']);self.assertEqual(v['firstFailure'],'limit-set-refused');self.assertFalse(self.owner.busy);self.assertTrue(self.owner.closed)
 def test_wrong_immediate_readback_no_next_set(self):
  self.getter.side_effect=lambda kind:(179,180)
  with self.assertRaises(m.Refusal):self.owner._prepare()
  v=self.owner.status();self.assertEqual(v['setAttempted'],1);self.assertEqual(v['getAttempted'],1);self.assertEqual(v['rows'][0]['observations'][0]['soft'],179);self.assertFalse(v['prepared'])
 def test_boolean_list_float_infinite_and_foreign_readbacks_refuse(self):
  class Foreign:
   def __iter__(self):raise AssertionError('foreign iterator')
  for value in ((True,180),[180,180],(180.0,180),(-1,-1),Foreign()):
   self.owner=m.Limits();self.getter.side_effect=lambda kind:value
   with self.assertRaises(m.Refusal):self.owner._prepare()
   self.assertFalse(self.owner.status()['prepared']);self.assertEqual(self.owner.get_attempts,1)
 def test_final_recheck_drift_preserves_all_install_facts(self):
  calls=[];real=self.getter.side_effect
  def get_limit(kind):
   calls.append(kind)
   if len(calls)==6:return(179,180)
   return real(kind)
  self.getter.side_effect=get_limit
  with self.assertRaises(m.Refusal):self.owner._prepare()
  v=self.owner.status();self.assertEqual(v['setAttempted'],5);self.assertEqual(v['getAttempted'],6);self.assertEqual(v['firstFailure'],'final-readback-refused');self.assertEqual(v['rows'][0]['observations'][-1]['soft'],179);self.assertFalse(v['prepared'])
 def test_swallowed_set_reentry_stops_before_get_or_later_set(self):
  swallowed=[]
  def set_limit(kind,value):
   try:self.owner.status()
   except m.Refusal as error:swallowed.append(error)
  self.setter.side_effect=set_limit
  with self.assertRaises(m.Refusal)as caught:self.owner._prepare()
  self.assertIs(caught.exception,swallowed[0]);self.getter.assert_not_called();self.assertEqual(self.setter.call_count,1);self.assertEqual(self.owner.status()['firstFailure'],'pid1-reentry')
 def test_swallowed_immediate_get_reentry_stops_adoption(self):
  def get_limit(kind):
   try:self.owner._prepare()
   except m.Refusal:pass
   return(180,180)
  self.getter.side_effect=get_limit
  with self.assertRaises(m.Refusal):self.owner._prepare()
  self.assertEqual(self.owner.set_attempts,1);self.assertEqual(self.owner.get_attempts,1);self.assertEqual(self.owner.status()['rows'][0]['observations'],[]);self.assertFalse(self.owner.status()['prepared'])
 def test_swallowed_final_get_reentry_never_prepared(self):
  calls=[];real=self.getter.side_effect
  def get_limit(kind):
   calls.append(kind)
   if len(calls)==10:
    try:self.owner.status()
    except m.Refusal:pass
   return real(kind)
  self.getter.side_effect=get_limit
  with self.assertRaises(m.Refusal):self.owner._prepare()
  self.assertEqual(self.owner.get_attempts,10);self.assertEqual(self.owner.phase,'refused');self.assertFalse(self.owner.busy);self.assertTrue(self.owner.closed);self.assertFalse(self.owner.status()['prepared'])
 def test_preentry_policy_override_bool_and_custom_container_zero_guards(self):
  class Foreign(tuple):
   def __iter__(self):raise AssertionError('foreign iteration')
  wrong=list(m.POLICY);wrong[0]=('cpuSeconds',0,179,180);boolean=list(m.POLICY);boolean[0]=('cpuSeconds',0,True,180)
  for value in (tuple(wrong),tuple(boolean),Foreign(m.POLICY)):
   self.owner=m.Limits()
   with patch.object(m,'POLICY',value),patch.object(m.os,'getpid',side_effect=AssertionError('guard')):
    with self.assertRaises(m.Refusal):self.owner._prepare()
  self.setter.assert_not_called();self.getter.assert_not_called()
 def test_policy_and_callable_bindings_captured_before_guard_hook(self):
  original=m.POLICY
  def pid():
   m.POLICY=(('cpuSeconds',0,1,1),);m.resource.setrlimit=lambda*a:(_ for _ in()).throw(AssertionError('substitute setter'));m.resource.getrlimit=lambda*a:(_ for _ in()).throw(AssertionError('substitute getter'));return 1
  saved_set=m.resource.setrlimit;saved_get=m.resource.getrlimit
  try:
   with patch.object(m.os,'getpid',side_effect=pid):v=self.owner._prepare()
   self.assertTrue(v['prepared']);self.assertEqual(v['policy'][0]['soft'],180);self.assertEqual(self.setter.call_count,5);self.assertEqual(self.getter.call_count,10)
  finally:m.POLICY=original;m.resource.setrlimit=saved_set;m.resource.getrlimit=saved_get
 def test_get_error_preserves_original_and_consumed_attempt(self):
  original=RuntimeError('manufactured get refusal');self.getter.side_effect=original
  with self.assertRaises(RuntimeError)as caught:self.owner._prepare()
  self.assertIs(caught.exception,original);self.assertEqual(self.owner.get_attempts,1);self.assertEqual(self.owner.set_attempts,1);self.assertTrue(self.owner.status()['rows'][0]['setReturned']);self.assertFalse(self.owner.status()['prepared'])
 def test_status_copy_cannot_change_owned_facts(self):
  v=self.owner._prepare();v['rows'][0]['observations'][0]['soft']=1;v['policy'][0]['soft']=1;v['eligibility']['pid1Observed']=False;again=self.owner.status();self.assertEqual(again['rows'][0]['observations'][0]['soft'],180);self.assertEqual(again['policy'][0]['soft'],180);self.assertTrue(again['eligibility']['pid1Observed'])
 def test_no_caller_policy_delegate_fd_command_interface(self):
  with self.assertRaises(TypeError):m.Limits(policy={})
  with self.assertRaises(TypeError):self.owner._prepare(delegate=lambda:None)
  self.setter.assert_not_called();self.getter.assert_not_called()
 def test_false_core_readback_is_not_integer_zero(self):
  original=self.getter.side_effect;seen=[]
  def get_limit(kind):
   seen.append(kind)
   if len(seen)==10:return(False,False)
   return original(kind)
  self.getter.side_effect=get_limit
  with self.assertRaises(m.Refusal):self.owner._prepare()
  v=self.owner.status();self.assertEqual(v['getAttempted'],10);self.assertFalse(v['rows'][-1]['observations'][-1]['shapeValid']);self.assertIsNone(v['rows'][-1]['observations'][-1]['soft']);self.assertFalse(v['prepared'])
if __name__=='__main__':unittest.main()
