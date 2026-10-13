"""Manufactured-only lifetime controls; no kernel/process/channel probes."""
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import Mock,patch

spec=importlib.util.spec_from_file_location('lifetime',Path(__file__).with_name('lifetime.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Channel:
 def __init__(self):self.close=Mock()
class Process:
 def __init__(self):self.wait=Mock(return_value=0);self.poll=Mock(return_value=0)
class Observer:
 def __init__(self):
  self.busy=False;self.admitted=False;self.ack_sent=False;self.ack_attempted=False;self.ack_may_have_escaped=False;self.first=None;self._fds=[20,21];self._channel_owner=None;self._consumed=set();self.handles_admitted=False;self._load_boundary=lambda *args:BOUNDARY;self.closed=False;self.close_count=0
 def _receive(self):self._channel_owner=CHANNEL;self._load_boundary(None,None);self.handles_admitted=True;self.admitted=True;self.ack_sent=True;self.ack_attempted=True;self.ack_may_have_escaped=True
 def close(self):self.close_count+=1;self.closed=True;self._consumed.update(self._fds)
 def _poison(self):raise m.Refusal('admission-reentry')
BOUNDARY=None
CHANNEL=None
REAL_LOAD=m.Lifetime._load
class T(unittest.TestCase):
 def setUp(self):
  global BOUNDARY,CHANNEL
  self.q=m.Lifetime();self.channel=Channel();CHANNEL=self.channel;self.process=Process();self.terminal=Mock(return_value=True);self.census=Mock(return_value=0);BOUNDARY=types.SimpleNamespace(pidfd_terminal=self.terminal,census=self.census);self.module=types.SimpleNamespace(Observer=Observer);self.clock=Mock(return_value=1.0);self.read=Mock(side_effect=[b'raw\x00\xff\n',b'error\n',b'',b'']);self.select=Mock(side_effect=lambda f,*a:(list(f),[],[]));self.close=Mock();self.signal=Mock();self.launch=Mock(side_effect=lambda:(self.process,self.channel,10,11));self.fstat=Mock(return_value=types.SimpleNamespace(st_dev=2,st_ino=7));self.patches=[]
  for obj,name,value in [(m,'_launch',self.launch),(m.Lifetime,'_load',lambda *a:self.module),(m.time,'monotonic',self.clock),(m.os,'read',self.read),(m.os,'close',self.close),(m.os,'fstat',self.fstat),(m.os,'set_blocking',Mock()),(m.os,'get_blocking',Mock(return_value=False)),(m.select,'select',self.select),(m.signal,'pidfd_send_signal',self.signal)]:
   p=patch.object(obj,name,value);p.start();self.patches.append(p)
  self.addCleanup(lambda:[p.stop()for p in reversed(self.patches)])
 def fail(self):
  with self.assertRaises(BaseException):self.q._run()
  self.assertFalse(self.q.status()['complete']);self.assertTrue(self.q.closed);self.assertFalse(self.q.busy)
 def test_default_actual_and_private_unconnected_no_operations(self):
  with patch.object(m,'_launch',m._UNCONNECTED),patch.object(m.os,'open',side_effect=AssertionError('OS')):
   with self.assertRaises(m.Refusal):m.actual()
   with patch.object(m,'_SEAL','present'):
    with self.assertRaises(m.Refusal):m.actual()
   with self.assertRaises(m.Refusal):self.q._run()
  self.clock.assert_not_called();self.launch.assert_not_called()
 def test_positive_original_binary_eof_terminal_reap_two_censuses(self):
  s=self.q._run();self.assertTrue(s['complete']);self.assertEqual(s['stdout'],b'raw\x00\xff\n');self.assertEqual(s['stderr'],b'error\n');self.assertEqual(s['censusCounts'],[0,0]);self.assertTrue(s['launcherReaped']);self.assertTrue(all(self.q.eof));self.signal.assert_not_called();self.assertEqual(self.q.observer.close_count,1);self.assertEqual(self.close.call_count,2);self.assertEqual(self.channel.close.call_count,0)
 def test_startup_deadline_before_admission(self):
  self.clock.side_effect=[1.0,1.0,9.0];self.fail();self.assertTrue(self.q.launch_unobserved);self.assertIsNone(self.q.observer);self.signal.assert_not_called();self.assertEqual(self.close.call_count,2);self.channel.close.assert_called_once()
 def test_execution_deadline_no_invented_census_or_reap(self):
  self.clock.side_effect=[1.0,1.0,1.0,1.0,1.0,1.0,481.0];self.terminal.return_value=False;self.fail();self.assertEqual(self.q.censuses,[]);self.assertFalse(self.q.reaped);self.assertTrue(self.q.cleanup_observations_missing);self.signal.assert_called_once_with(21,m.signal.SIGKILL)
 def test_absolute_deadline_also_constrains_execution(self):
  self.clock.side_effect=[1.0,8.0,8.0,8.0,8.0,489.0];self.fail();self.select.assert_not_called();self.assertEqual(self.q.censuses,[])
 def test_strict_clock_nan_inf_boolean_negative(self):
  for value in (True,float('nan'),float('inf'),-1):
   q=m.Lifetime();self.clock.return_value=value
   with self.assertRaises(m.Refusal):q._run()
   self.assertFalse(q.status()['complete'])
  self.launch.assert_not_called()
 def test_clock_backwards(self):
  self.clock.side_effect=[2.0,1.0];self.fail();self.launch.assert_not_called()
 def test_prefix_retained_before_overflow_no_later_read(self):
  self.read.side_effect=[b'x'*65537];self.fail();self.assertEqual(self.q.status()['stdout'],b'x'*65536);self.assertTrue(self.q.overflow);self.assertEqual(self.read.call_count,1);self.assertFalse(self.q.eof[0]);self.census.assert_not_called()
 def test_exact_cap_then_extent_plus_one_eof(self):
  self.read.side_effect=[b'x'*65536,b'',b'',b''];s=self.q._run();self.assertTrue(s['complete']);self.assertEqual(self.read.call_args_list[2].args,(10,1))
 def test_partial_stderr_then_read_failure_original_identity(self):
  original=OSError('read-original');self.read.side_effect=[b'',b'partial\xff',original]
  with self.assertRaises(OSError)as caught:self.q._run()
  self.assertIs(caught.exception,original);self.assertEqual(self.q.status()['stderr'],b'partial\xff');self.assertFalse(self.q.eof[1])
 def test_eofs_do_not_imply_terminal_or_census(self):
  self.terminal.return_value=False;self.fail();self.process.wait.assert_called_once();self.census.assert_not_called();self.signal.assert_called_once_with(21,m.signal.SIGKILL)
 def test_nonzero_and_uncertain_censuses_never_complete(self):
  for values in ([0,1],[0,PermissionError('proc')],[True]):
   self.q=m.Lifetime();self.read.side_effect=[b'',b''];self.census.side_effect=values
   self.fail();self.assertLessEqual(len(self.q.censuses),2)
 def test_wait_failure_does_not_credit_reaping(self):
  original=TimeoutError('wait');self.process.wait.side_effect=original
  with self.assertRaises(TimeoutError)as caught:self.q._run()
  self.assertIs(caught.exception,original);self.assertFalse(self.q.reaped)
 def test_launch_returns_resources_after_swallowed_reentry(self):
  def launch():
   try:self.q.status()
   except m.Refusal:pass
   return self.process,self.channel,10,11
  self.launch.side_effect=launch;self.fail();self.assertEqual(set(c.args[0]for c in self.close.call_args_list),{10,11});self.channel.close.assert_called_once();self.assertTrue(self.q.launch_unobserved);self.signal.assert_not_called()
 def test_malformed_bundle_captures_later_descriptors(self):
  self.launch.side_effect=lambda:(self.process,self.channel,10,11,12);self.fail();self.assertEqual(set(c.args[0]for c in self.close.call_args_list),{10,11,12})
 def test_duplicate_pipes_close_once_no_admission(self):
  self.launch.side_effect=lambda:(self.process,self.channel,10,10);self.fail();self.close.assert_called_once_with(10);self.assertIsNone(self.q.observer)
 def test_pipe_alias_to_observer_not_double_closed(self):
  self.launch.side_effect=lambda:(self.process,self.channel,20,11);self.fail();self.close.assert_called_once_with(11);self.assertEqual(self.q.observer.close_count,1)
 def test_read_reentry_retains_original_prefix_no_later_work(self):
  def read(*args):
   try:self.q.status()
   except m.Refusal:pass
   return b'prefix\x00'
  self.read.side_effect=read;self.fail();self.assertEqual(bytes(self.q.output[0]),b'prefix\x00');self.assertEqual(self.read.call_count,1);self.census.assert_not_called()
 def test_census_reentry_cannot_adopt_zero(self):
  def census(*args):
   try:self.q.status()
   except m.Refusal:pass
   return 0
  self.census.side_effect=census;self.fail();self.assertEqual(self.q.censuses,[]);self.assertEqual(self.census.call_count,1)
 def test_primary_read_error_survives_signal_and_close_failures(self):
  original=OSError('read');self.read.side_effect=original;self.terminal.return_value=False;self.signal.side_effect=OSError('signal');self.close.side_effect=OSError('close')
  with self.assertRaises(OSError)as caught:self.q._run()
  self.assertIs(caught.exception,original);self.assertEqual(self.q.cleanup,3);self.assertEqual(self.signal.call_count,1);self.assertEqual(self.q.observer.close_count,1)
 def test_final_close_reentry_invalidates_success(self):
  def close(fd):
   try:self.q.status()
   except m.Refusal:pass
  self.close.side_effect=close;self.fail();self.assertEqual(self.q.phase,'refused');self.assertEqual(self.close.call_count,2)
 def test_once_close_no_retry(self):
  self.q._run();self.q.close();self.q.close();self.assertEqual(self.close.call_count,2);self.assertEqual(self.q.observer.close_count,1)
  with self.assertRaises(m.Refusal):self.q._run()
 def test_captured_launch_clock_read_and_policy_ignore_hook_mutation(self):
  old_policy=m._POLICY;old_read=m.os.read;old_clock=m.time.monotonic
  def launch():
   m._POLICY=(0,0,0,1);m.os.read=Mock(side_effect=AssertionError('foreign-read'));m.time.monotonic=Mock(side_effect=AssertionError('foreign-clock'));return self.process,self.channel,10,11
  self.launch.side_effect=launch
  try:self.assertTrue(self.q._run()['complete'])
  finally:m._POLICY=old_policy;m.os.read=old_read;m.time.monotonic=old_clock
 def test_changed_preentry_policy_refuses_before_clock(self):
  with patch.object(m,'_POLICY',(8,480,488,65536)):self.fail()
  self.clock.assert_not_called();self.launch.assert_not_called()
 def test_admission_returns_after_startup_expiry_still_owned(self):
  self.clock.side_effect=[1.0,1.0,1.0,1.0,9.0];self.terminal.return_value=False;self.fail();self.assertTrue(self.q.admitted);self.signal.assert_called_once_with(21,m.signal.SIGKILL);self.assertEqual(self.q.observer.close_count,1);self.channel.close.assert_not_called()
 def test_admission_refuses_before_channel_ownership_closes_channel(self):
  def receive(obj):raise OSError('before-channel')
  with patch.object(Observer,'_receive',receive):self.fail()
  self.channel.close.assert_called_once();self.assertEqual(self.q.observer.close_count,1);self.signal.assert_not_called()
 def test_failed_admission_crossledger_alias_consumed_once(self):
  def receive(obj):obj._channel_owner=self.channel;obj._fds=[10,21];raise OSError('partial')
  with patch.object(Observer,'_receive',receive):self.fail()
  self.close.assert_called_once_with(11);self.channel.close.assert_not_called();self.assertEqual(self.q.observer.close_count,1)
 def test_nonblocking_readback_and_setter_reentry_no_admission(self):
  with patch.object(m.os,'get_blocking',return_value=True):self.fail()
  self.assertIsNone(self.q.observer);self.read.assert_not_called()
 def test_blocking_setter_reentry_closes_returned_pipes(self):
  def setter(*args):
   try:self.q.status()
   except m.Refusal:pass
  with patch.object(m.os,'set_blocking',side_effect=setter):self.fail()
  self.assertIsNone(self.q.observer);self.assertEqual(self.close.call_count,2)
 def test_failed_launch_without_return_is_explicit_uncertainty(self):
  self.launch.side_effect=OSError('no-return');self.fail();self.assertTrue(self.q.launch_unobserved);self.signal.assert_not_called();self.close.assert_not_called()
 def test_raw_observed_count_includes_overflow_prefix_excludes_extra(self):
  self.read.side_effect=[b'z'*65537];self.fail();s=self.q.status();self.assertEqual(s['stdoutObservedBytes'],65537);self.assertEqual(s['stdoutPrefixBytes'],65536);self.assertEqual(s['stdoutPrefixSha256'],m.hashlib.sha256(b'z'*65536).hexdigest())
 def test_wait_precedes_terminal_exit_observation(self):
  order=[];self.process.wait.side_effect=lambda **kw:order.append('wait')or 0;self.terminal.side_effect=lambda fd:order.append('terminal')or True;self.q._run();self.assertEqual(order[0],'wait');self.assertTrue(self.q.terminal)
 def test_cleanup_unexpected_error_preserves_primary_and_resets(self):
  original=OSError('read');self.read.side_effect=original
  with patch.object(self.q,'cleanup_owned',side_effect=OSError('cleanup')):
   with self.assertRaises(OSError)as caught:self.q._run()
  self.assertIs(caught.exception,original);self.assertFalse(self.q.busy);self.assertTrue(self.q.closed);self.assertFalse(self.q.complete)
 def test_exact_observer_loader_with_mocked_source_reads(self):
  path=Path(__file__).parent.parent/'i80386-provisioning-observer'/'observer.py';body=path.read_bytes();meta=types.SimpleNamespace(st_mode=0o100600,st_size=len(body),st_nlink=1,st_dev=1,st_ino=8,st_mtime_ns=3)
  self.q.ops={'open':Mock(return_value=42),'fstat':Mock(return_value=meta),'stat':Mock(return_value=meta),'read':Mock(side_effect=[body,b'']),'close':Mock(),'hash':m.hashlib.sha256,'compile':compile,'exec':exec}
  loaded=REAL_LOAD(self.q,str(path.parent.parent.parent),m._OBSERVER);self.assertEqual(loaded.Observer.__module__,'owned_lifetime_observer');self.assertIsNone(loaded.ACTUAL_SEAL);self.q.ops['close'].assert_called_once_with(42)
 def test_consumed_historical_handles_never_polled_or_signaled(self):
  def receive(obj):obj._channel_owner=self.channel;obj.handles_admitted=True;obj._consumed.update(obj._fds);obj.closed=True;raise OSError('ack')
  with patch.object(Observer,'_receive',receive):self.fail()
  self.terminal.assert_not_called();self.signal.assert_not_called();self.assertTrue(self.q.handles_observed);self.assertTrue(self.q.cleanup_observations_missing);self.assertFalse(self.q.usable_handles)
 def exact_receiver_case(self,fail_ack=False):
  path=Path(__file__).parent.parent/'i80386-provisioning-observer'/'controls.py';spec=importlib.util.spec_from_file_location('receiver_fixture',path);fixture_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture_module);fixture=fixture_module.T();fixture.setUp()
  try:
   boundary=fixture.boundary;boundary.census=Mock(return_value=0);terminal=Mock(side_effect=lambda fd:bool(fixture.channel.sent));boundary.pidfd_terminal=terminal
   if fail_ack:fixture.channel.send_error=OSError('ack-original')
   self.launch.side_effect=lambda:(self.process,fixture.channel,10,11)
   with patch.object(m.Lifetime,'_load',return_value=fixture_module.m):
    if fail_ack:
     with self.assertRaises(OSError)as caught:self.q._run()
     self.assertIs(caught.exception,fixture.channel.send_error);self.assertFalse(self.q.complete);self.assertFalse(self.q.usable_handles);self.assertTrue(self.q.cleanup_observations_missing);self.signal.assert_not_called();self.assertEqual(terminal.call_count,12)
    else:self.assertTrue(self.q._run()['complete'])
   self.assertEqual([c.args[0]for c in fixture.close.call_args_list],[42,41,11,10]if fail_ack else[11,10,42,41]);self.assertEqual(fixture.channel.closes,1)
  finally:fixture.doCleanups()
 def test_exact_held_receiver_positive_mock_kernel_connection(self):self.exact_receiver_case()
 def test_exact_held_receiver_ack_failure_no_closed_pidfd_reuse(self):self.exact_receiver_case(True)
 def test_cleanup_terminal_drift_revokes_positive(self):
  self.terminal.side_effect=[True,False];self.fail();self.assertIs(self.q.terminal,False);self.assertFalse(self.q.complete);self.signal.assert_not_called()
 def test_status_copies_census_and_raw_prefixes(self):
  s=self.q._run();s['censusCounts'].append(9);self.assertEqual(self.q.status()['censusCounts'],[0,0]);self.assertIs(type(s['stdout']),bytes)
if __name__=='__main__':unittest.main()
