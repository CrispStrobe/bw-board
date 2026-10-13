"""Pure source-owned wiring controls. All socket/FD/process operations mocked."""
import hashlib
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('refusal_supervisor',Path(__file__).with_name('supervisor.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
READ_SOURCE=m.Preparation.read_source
FAKE_LIFETIME=b'''class Lifetime:
 def __init__(self):self.entered=False;self.busy=False;self.phase='new';self.closes=0
 def close(self):self.closes+=1
'''
class Socket:
 def __init__(self,fd):self.fd=fd;self.close=Mock();self.fileno=Mock(side_effect=lambda:self.fd);self.getsockopt=Mock(return_value=int(m.socket.SOCK_SEQPACKET))
class T(unittest.TestCase):
 def setUp(self):
  self.q=m.Preparation();self.parent=Socket(20);self.child=Socket(21);self.process=object();self.launch=Mock(return_value=self.process);self.socketpair=Mock(return_value=(self.parent,self.child));self.pipe2=Mock(side_effect=[(10,11),(12,13)]);self.close=Mock();self.inheritable=Mock(return_value=False);self.blocking=Mock(return_value=False);self.getters={name:Mock(return_value=0)for name in('getuid','geteuid','getgid','getegid')};self.read_source=Mock(side_effect=lambda root,spec:FAKE_LIFETIME if spec==m._LIFETIME else b'bootstrap');self.patches=[]
  for obj,name,value in [(m,'_CREATE',m._owned_create),(m,'_LAUNCH',self.launch),(m.Preparation,'read_source',self.read_source),(m.socket,'socketpair',self.socketpair),(m.os,'pipe2',self.pipe2),(m.os,'close',self.close),(m.os,'get_inheritable',self.inheritable),(m.os,'get_blocking',self.blocking),(m.sys,'platform','linux')]+[(m.os,name,getter)for name,getter in self.getters.items()]:
   p=patch.object(obj,name,value);p.start();self.patches.append(p)
  self.addCleanup(lambda:[p.stop()for p in reversed(self.patches)])
 def fail(self):
  with self.assertRaises(BaseException):self.q._prepare()
  self.assertFalse(self.q.status()['refusalPreparationComplete']);self.assertTrue(self.q.closed);self.assertFalse(self.q.busy)
 def test_unsealed_and_unconnected_zero_operations(self):
  with patch.object(m,'_CREATE',None),patch.object(m.os,'open',side_effect=AssertionError('OS')):
   with self.assertRaises(m.Refusal):m.actual()
   with patch.object(m,'_ACTUAL_SEAL','not-permission'):
    with self.assertRaises(m.Refusal):m.actual()
   with self.assertRaises(m.Refusal):self.q._prepare()
  self.socketpair.assert_not_called();self.read_source.assert_not_called();self.launch.assert_not_called();[getter.assert_not_called()for getter in self.getters.values()]
 def test_fixed_argv_environment_descriptor_map_and_child_close(self):
  s=self.q._prepare();self.assertTrue(s['refusalPreparationComplete']);argv=self.launch.call_args.args[0];kw=self.launch.call_args.kwargs
  self.assertEqual(argv[:-3],m._PREFIX);self.assertTrue(argv[-3].endswith('/scripts/i80386-provisioning-enclosing-supervisor/bootstrap.py'));self.assertEqual(argv[-2:],('--unarmed-channel-fd','21'));self.assertEqual(kw,{'stdin':m.subprocess.DEVNULL,'stdout':11,'stderr':13,'pass_fds':(21,),'env':dict(m._ENV),'close_fds':True});self.assertEqual(self.close.call_args_list,[unittest.mock.call(11),unittest.mock.call(13)]);self.child.close.assert_called_once();self.parent.close.assert_not_called();self.assertTrue(s['launchCleanupUnobserved']);self.assertFalse(s['outerHardDeadlineQualified']);self.assertFalse(s['bootstrapProvisioningConnected'])
 def test_cloexec_exact_false_and_readonly_observations(self):
  self.q._prepare();self.assertEqual([c.args[0]for c in self.inheritable.call_args_list],[20,21,10,11,12,13]);self.assertEqual([c.args[0]for c in self.blocking.call_args_list],[10,11,12,13]);self.assertEqual(self.pipe2.call_args_list,[unittest.mock.call(m.os.O_CLOEXEC|m.os.O_NONBLOCK)]*2)
 def test_inheritable_or_boolean_laundering_refuses_before_launch(self):
  for value in (True,0,None):
   self.q=m.Preparation();self.pipe2.side_effect=[(10,11),(12,13)];self.inheritable.return_value=value;self.fail()
  self.launch.assert_not_called()
 def test_blocking_pipe_refuses(self):
  self.blocking.return_value=True;self.fail();self.launch.assert_not_called()
 def test_socketpair_reentry_captures_all_returned_objects(self):
  def pair(*a):
   try:self.q.status()
   except m.Refusal:pass
   return self.parent,self.child
  self.socketpair.side_effect=pair;self.fail();self.parent.close.assert_called_once();self.child.close.assert_called_once();self.pipe2.assert_not_called()
 def test_pipe_return_reentry_captures_both_ends(self):
  def pipes(*a):
   try:self.q.status()
   except m.Refusal:pass
   return 10,11
  self.pipe2.side_effect=pipes;self.fail();self.assertEqual(set(c.args[0]for c in self.close.call_args_list),{10,11});self.parent.close.assert_called_once();self.child.close.assert_called_once()
 def test_malformed_socket_tuple_all_objects_closed(self):
  extra=Socket(22);self.socketpair.return_value=(self.parent,self.child,extra);self.fail();self.parent.close.assert_called_once();self.child.close.assert_called_once();extra.close.assert_called_once()
 def test_malformed_pipe_tuple_all_integer_ends_closed(self):
  self.pipe2.side_effect=[(10,11,12)];self.fail();self.assertEqual(set(c.args[0]for c in self.close.call_args_list),{10,11,12})
 def test_duplicate_pipe_and_socket_fd_close_unique(self):
  self.pipe2.side_effect=[(20,11),(12,13)];self.fail();self.assertEqual(sum(c.args[0]==20 for c in self.close.call_args_list)+self.parent.close.call_count,1);self.launch.assert_not_called()
 def test_same_socket_object_consumed_once(self):
  self.socketpair.return_value=(self.parent,self.parent);self.fail();self.parent.close.assert_called_once();self.launch.assert_not_called()
 def test_same_socket_numeric_fd_consumed_once(self):
  self.child.fd=20;self.fail();self.assertEqual(self.parent.close.call_count+self.child.close.call_count,1)
 def test_creator_partial_error_preserves_first_object(self):
  original=OSError('pipe');self.pipe2.side_effect=[(10,11),original];self.close.side_effect=OSError('close')
  with self.assertRaises(OSError)as caught:self.q._prepare()
  self.assertIs(caught.exception,original);self.assertEqual(self.close.call_count,2);self.assertEqual(self.q.cleanup,2);self.parent.close.assert_called_once();self.child.close.assert_called_once()
 def test_launch_error_preserved_no_cancellation_authority(self):
  original=OSError('launch');self.launch.side_effect=original
  with self.assertRaises(OSError)as caught:self.q._prepare()
  self.assertIs(caught.exception,original);self.assertTrue(self.q.status()['launchCleanupUnobserved']);self.assertFalse(self.q.launch_returned);self.assertEqual(self.close.call_count,4)
 def test_returned_process_captured_before_reentry_refusal(self):
  def launch(*a,**kw):
   try:self.q.status()
   except m.Refusal:pass
   return self.process
  self.launch.side_effect=launch;self.fail();self.assertIs(self.q.process,self.process);self.assertTrue(self.q.launch_returned);self.assertTrue(self.q.status()['launchCleanupUnobserved'])
 def test_child_close_reentry_cannot_mark_prepared(self):
  def close():
   try:self.q.status()
   except m.Refusal:pass
  self.child.close.side_effect=close;self.fail();self.assertEqual(self.close.call_count,4);self.child.close.assert_called_once()
 def test_handoff_only_exact_owned_lifetime_phase_once(self):
  self.q._prepare()
  with self.assertRaises(m.Refusal):self.q._handoff()
  self.q.lifetime.entered=True;self.q.lifetime.busy=True;self.q.lifetime.phase='launch';bundle=self.q.module._launch();self.assertEqual(bundle,(self.process,self.parent,10,12));self.assertTrue(self.q.transferred);self.assertEqual(self.q.status()['ownedDescriptorsPending'],0);self.assertEqual(self.q.status()['transferredDescriptorCount'],3);self.assertFalse(self.q.status()['descriptorClosureProven'])
  with self.assertRaises(m.Refusal):self.q._handoff()
  self.q.close();self.assertEqual(self.q.lifetime.closes,1);self.parent.close.assert_not_called();self.assertEqual(self.close.call_count,2)
 def test_close_before_handoff_consumes_parent_once(self):
  self.q._prepare();self.q.close();self.q.close();self.assertEqual(self.close.call_count,4);self.parent.close.assert_called_once();self.child.close.assert_called_once()
  with self.assertRaises(m.Refusal):self.q._prepare()
 def test_command_environment_capture_before_creator_mutation(self):
  original=m._PREFIX;environment=m._ENV;launch=m._LAUNCH;stdin=m.subprocess.DEVNULL
  def creator(owner):
   m._PREFIX=('/bad',);m._ENV=(('LD_PRELOAD','bad'),);m.subprocess.DEVNULL=99;m._LAUNCH=Mock(side_effect=AssertionError('substitute'));return m._owned_create(owner)
  with patch.object(m,'_CREATE',creator):
   try:self.q._prepare();self.assertEqual(self.launch.call_args.args[0][:len(original)],original);self.assertEqual(self.launch.call_args.kwargs['env'],dict(environment));self.assertEqual(self.launch.call_args.kwargs['stdin'],stdin)
   finally:m._PREFIX=original;m._ENV=environment;m._LAUNCH=launch;m.subprocess.DEVNULL=stdin
 def test_preentry_command_override_no_source_or_creation(self):
  with patch.object(m,'_PREFIX',('/bin/sh','-c','bad')):self.fail()
  self.read_source.assert_not_called();self.socketpair.assert_not_called();self.launch.assert_not_called()
 def test_launcher_environment_mutation_does_not_change_snapshot(self):
  def launch(*a,**kw):kw['env']['LD_PRELOAD']='bad';return self.process
  self.launch.side_effect=launch;self.q._prepare();self.assertEqual(self.q.env,dict(m._ENV))
 def test_exact_held_lifetime_source_loader_mock_files(self):
  path=Path(__file__).parent.parent/'i80386-provisioning-observer-lifetime'/'lifetime.py';body=path.read_bytes();meta=types.SimpleNamespace(st_mode=0o100600,st_size=len(body),st_nlink=1,st_dev=1,st_ino=2,st_mtime_ns=3)
  self.q.ops={'path':Path,'open_flags':m.os.O_RDONLY|m.os.O_NOFOLLOW|m.os.O_NONBLOCK,'regular':m.stat.S_ISREG,'open':Mock(return_value=42),'fstat':Mock(return_value=meta),'read':Mock(side_effect=[body,b'']),'stat':Mock(return_value=meta),'close':Mock(),'hash':hashlib.sha256};self.assertEqual(READ_SOURCE(self.q,str(path.parent.parent.parent),m._LIFETIME),body);self.q.ops['close'].assert_called_once_with(42)
 def test_source_read_primary_survives_close_refusal(self):
  original=OSError('read');meta=types.SimpleNamespace(st_mode=0o100600,st_size=12941,st_nlink=1);self.q.ops={'path':Path,'open_flags':m.os.O_RDONLY|m.os.O_NOFOLLOW|m.os.O_NONBLOCK,'regular':m.stat.S_ISREG,'open':Mock(return_value=42),'fstat':Mock(return_value=meta),'read':Mock(side_effect=original),'close':Mock(side_effect=OSError('close'))}
  with self.assertRaises(OSError)as caught:READ_SOURCE(self.q,'unused',m._LIFETIME)
  self.assertIs(caught.exception,original);self.q.ops['close'].assert_called_once_with(42)
 def test_nonroot_and_boolean_credentials_refuse_before_source_or_creation(self):
  for name in self.getters:
   for value in (1,True,False):
    self.q=m.Preparation()
    for getter in self.getters.values():getter.return_value=0
    self.getters[name].return_value=value;self.fail()
  self.read_source.assert_not_called();self.socketpair.assert_not_called();self.launch.assert_not_called()
 def test_nonlinux_refuses_before_credential_getters(self):
  with patch.object(m.sys,'platform','other'):self.fail()
  [getter.assert_not_called()for getter in self.getters.values()];self.read_source.assert_not_called()
 def test_credential_reentry_and_capture_stop_before_creation(self):
  def getter():
   try:self.q.status()
   except m.Refusal:pass
   return 0
  self.getters['getuid'].side_effect=getter;self.fail();self.getters['geteuid'].assert_not_called();self.read_source.assert_not_called();self.socketpair.assert_not_called()
 def test_no_intervening_sudo_and_credential_functions_captured(self):
  original=m.os.geteuid
  def getter():m.os.geteuid=Mock(side_effect=AssertionError('substituted'));return 0
  self.getters['getuid'].side_effect=getter
  try:self.q._prepare()
  finally:m.os.geteuid=original
  argv=self.launch.call_args.args[0];self.assertEqual(argv[0],'/usr/bin/timeout');self.assertFalse(any('sudo'in word for word in argv));self.getters['geteuid'].assert_called_once_with();self.assertTrue(self.q.status()['eligibility']['rootCredentialsObserved'])
 def test_bootstrap_fixed_refusal_no_entry_import(self):
  path=Path(__file__).with_name('bootstrap.py');body=path.read_bytes();self.assertEqual((len(body),hashlib.sha256(body).hexdigest()),m._BOOTSTRAP[1:]);namespace={'__name__':'fixture_bootstrap'};exec(compile(body,'<fixed-refusal-bootstrap>','exec'),namespace)
  with patch('builtins.print')as printer:
   with self.assertRaises(SystemExit)as caught:namespace['main']()
  self.assertEqual(caught.exception.code,1);printer.assert_called_once_with('bootstrap-unarmed')
if __name__=='__main__':unittest.main()
