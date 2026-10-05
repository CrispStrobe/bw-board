"""Manufactured controller controls only. No perf, compile, addon or guest."""
import sys
sys.dont_write_bytecode=True
import unittest,json,tempfile
from pathlib import Path
from unittest.mock import patch,Mock
import recorder as r
class Controls(unittest.TestCase):
 def setUp(self):
  forbidden=patch.object(r.subprocess,'Popen',side_effect=AssertionError('real child forbidden'));forbidden.start();self.addCleanup(forbidden.stop)
 def test_pending_precedes_every_effect(self):
  with patch.object(r,'load',return_value={'status':'PENDING_ROOT_SOURCE_REVIEW'}),patch.object(r.subprocess,'Popen',side_effect=AssertionError('real child forbidden')),patch.object(r,'fingerprint',side_effect=AssertionError('tool access forbidden')):
   with self.assertRaisesRegex(ValueError,'PENDING'):r.source_guard()
 def test_order_nonce_pid_and_markers(self):
  s=r.WindowState(42,1001,1001)
  def msg(kind,seq,nonce):return {'schema':r.SCHEMA,'type':kind,'seq':seq,'pid':42,'session':nonce}
  hello=msg('hello',0,None);self.assertEqual(s.accept(hello),'hello');s.response('ready',{})
  for bad in [hello,{**msg('enable',1,s.nonce),'pid':43},msg('enable',1,'0'*64),{**msg('enable',1,s.nonce),'seq':True}]:
   with self.assertRaises(ValueError):s.accept(bad)
  s.accept(msg('enable',1,s.nonce));s.response('enabled')
  bad={**msg('disable',2,s.nonce),'beginNs':'10','endNs':'9'}
  with self.assertRaisesRegex(ValueError,'ordered'):s.accept(bad)
  s.accept({**bad,'endNs':'11'});s.response('disabled')
  with self.assertRaises(ValueError):s.accept(msg('enable',3,s.nonce))
 def test_ack_failure_is_permanent_and_cleans_owned_child(self):
  child=Mock();child.poll.return_value=None;c=r.RecorderControl(10,11,child)
  with patch.object(r.select,'select',side_effect=[([],[],[]),([11],[],[])]),patch.object(r.os,'write') as write,patch.object(r.os,'read',return_value=b'ack\nack\n'),patch.object(r,'checked_control_stderr',return_value={'bytes':0}),patch.object(r,'terminate') as stop:
   with self.assertRaisesRegex(ValueError,'single'):c.command('enable',1)
   stop.assert_called_once_with(child);write.assert_called_once_with(10,b'enable cpu-clock\n')
  self.assertTrue(c.failed)
  with self.assertRaisesRegex(ValueError,'closed'):c.command('disable',2)
 def test_tracking_named_commands_and_unknown_selector_ack_refusal(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(r,'OUT',Path(directory)):
   stderr=Path(directory)/'record.stderr';stderr.write_bytes(b'');child=Mock();child.poll.return_value=None;c=r.RecorderControl(10,11,child)
   def success(fd,payload):
    if payload!=b'enable\n':
     with stderr.open('ab') as f:f.write(b'Event cpu-clock '+(b'enabled' if payload==b'enable cpu-clock\n' else b'disabled')+b'\n')
   with patch.object(r.select,'select',side_effect=[([],[],[]),([11],[],[]),([],[],[])]*4),patch.object(r.os,'write',side_effect=success) as write,patch.object(r.os,'read',return_value=b'ack\n\0'),patch.object(r,'terminate') as stop:
    for name,seq in [('enable',-2),('disable',0),('enable',1),('disable',2)]:c.command(name,seq)
    self.assertEqual([x.args[1] for x in write.call_args_list],[b'enable\n',b'disable cpu-clock\n',b'enable cpu-clock\n',b'disable cpu-clock\n']);stop.assert_not_called()
   self.assertEqual([x['command'] for x in c.records],['enable','disable cpu-clock','enable cpu-clock','disable cpu-clock'])
   for raw in [b"failed: can't find 'cpu-clock' event\n",b'failed: wrong command\n',b'Event unrelated disabled\n',b'Event cpu-clock disabled extra\n']:
    stderr.write_bytes(b'');bad=r.RecorderControl(10,11,child)
    with patch.object(r.select,'select',side_effect=[([],[],[]),([11],[],[]),([],[],[])]),patch.object(r.os,'write',side_effect=lambda *args:stderr.write_bytes(raw)),patch.object(r.os,'read',return_value=b'ack\n\0'),patch.object(r,'terminate') as stop:
     with self.assertRaisesRegex(ValueError,'selector refused|exact named selector'):bad.command('disable',0)
     stop.assert_called_once_with(child)
    self.assertTrue(bad.failed);self.assertEqual(len(bad.records),1);self.assertEqual(bad.records[0]['status'],'FAIL');self.assertEqual(bad.records[0]['rawAck'],'ack\n\0');self.assertIn(raw.decode(),bad.records[0]['stderrAtFailure']['rawExcerpt'])
    with self.assertRaisesRegex(ValueError,'closed'):bad.command('enable',1)
   stderr.write_bytes(b'');startup=r.RecorderControl(10,11,child);report={'controlRecords':startup.records}
   def startup_reply(fd,payload):
    if payload==b'disable cpu-clock\n':stderr.write_bytes(b"failed: can't find 'cpu-clock' event\n")
   with patch.object(r.select,'select',side_effect=[([],[],[]),([11],[],[]),([],[],[])]*2),patch.object(r.os,'write',side_effect=startup_reply),patch.object(r.os,'read',return_value=b'ack\n\0'),patch.object(r,'terminate',side_effect=OSError('secondary cleanup failure')):
    startup.command('enable',-2)
    with self.assertRaisesRegex(ValueError,'selector refused'):startup.command('disable',0)
   self.assertEqual([x['status'] for x in report['controlRecords']],['PASS','FAIL']);self.assertEqual(report['controlRecords'][1]['rawAck'],'ack\n\0');self.assertIn('secondary cleanup',report['controlRecords'][1]['cleanupError'])
   text=(Path(r.__file__)).read_text();self.assertIn("'-e','cpu-clock','-e','dummy:u'",text);self.assertIn("control.command('enable',-2);control.command('disable',0)",text);self.assertNotIn("command('enable dummy",text)
 def test_fragmented_exact_ack_and_absolute_timeout(self):
  child=Mock();child.poll.return_value=None
  c=r.RecorderControl(10,11,child,0)
  with patch.object(r.time,'monotonic',return_value=1),patch.object(r.select,'select',side_effect=[([],[],[]),([11],[],[]),([11],[],[]),([11],[],[]),([],[],[])]),patch.object(r.os,'write'),patch.object(r.os,'read',side_effect=[b'ac',b'k\n',b'\0']),patch.object(r,'checked_control_stderr',return_value={'bytes':0}):c.command('enable',-2)
  self.assertEqual(c.records[0]['rawAck'],'ack\n\0');self.assertEqual(c.records[0]['ackFragments'],['6163','6b0a','00'])
  for fragments in ([b'ack\n',b''],[b'ack\nX'],[b'ack\n\0ack\n\0']):
   c=r.RecorderControl(10,11,child,0)
   with patch.object(r.time,'monotonic',return_value=1),patch.object(r.select,'select',side_effect=[([],[],[])]+[([11],[],[])]*len(fragments)),patch.object(r.os,'write'),patch.object(r.os,'read',side_effect=fragments),patch.object(r,'checked_control_stderr',return_value={'bytes':0}),patch.object(r,'terminate'):
    with self.assertRaises(ValueError):c.command('enable',-2)
   self.assertTrue(c.failed);self.assertIsNotNone(c.records[0]['rawAck'])
  c=r.RecorderControl(10,11,child,0)
  with patch.object(r.time,'monotonic',side_effect=[1,1,1,1,7]),patch.object(r.select,'select',side_effect=[([],[],[]),([11],[],[])]),patch.object(r.os,'write'),patch.object(r.os,'read',return_value=b'a'),patch.object(r,'checked_control_stderr',return_value={'bytes':0}),patch.object(r,'terminate'):
   with self.assertRaisesRegex(ValueError,'timeout'):c.command('enable',-2)
  self.assertEqual(c.records[0]['rawAck'],'a');self.assertTrue(c.failed)
 def test_stale_and_trailing_ack_refuse(self):
  child=Mock();child.poll.return_value=None
  for selections,reads in [([([11],[],[])],[]),([([],[],[]),([11],[],[]),([11],[],[])],[b'ack\n\0'])]:
   c=r.RecorderControl(10,11,child)
   with patch.object(r.select,'select',side_effect=selections),patch.object(r.os,'write'),patch.object(r.os,'read',side_effect=reads),patch.object(r,'checked_control_stderr',return_value={'bytes':0}),patch.object(r,'terminate'):
    with self.assertRaisesRegex(ValueError,'stale|trailing'):c.command('enable',-2)
   self.assertTrue(c.failed)
 def test_isolated_held_modules_restore_collision_and_exception(self):
  from types import ModuleType
  names=('archive','admission','restore','policy','lifecycle','qualify');held=Path('/fixed/qualifier')
  prior={name:ModuleType('hosted_'+name) for name in names};original_path=list(sys.path)
  def imported(name):
   for n in names:
    m=ModuleType(n);m.__file__=str(held/(n+'.py'));sys.modules[n]=m
   sys.modules['qualify'].terminal=Mock(return_value={'actual':'held terminal result'})
   return sys.modules['qualify']
  with patch.dict(sys.modules,prior),patch.object(Path,'is_dir',return_value=True):
   with patch.object(r.importlib,'import_module',side_effect=imported):self.assertEqual(r.isolated_terminal(held,{}, {}, {}, {}),{'actual':'held terminal result'})
   self.assertTrue(all(sys.modules[n] is prior[n] for n in names));self.assertEqual(sys.path,original_path)
   def failed(name):imported(name);raise ImportError('manufactured held failure')
   with patch.object(r.importlib,'import_module',side_effect=failed):
    with self.assertRaisesRegex(ImportError,'manufactured'):r.isolated_terminal(held,{}, {}, {}, {})
   self.assertTrue(all(sys.modules[n] is prior[n] for n in names));self.assertEqual(sys.path,original_path)
   def terminal_failure(name):
    q=imported(name);q.terminal.side_effect=ValueError('held semantic refusal');return q
   with patch.object(r.importlib,'import_module',side_effect=terminal_failure):
    with self.assertRaisesRegex(ValueError,'semantic refusal'):r.isolated_terminal(held,{}, {}, {}, {})
   self.assertTrue(all(sys.modules[n] is prior[n] for n in names));self.assertEqual(sys.path,original_path)
  saved={n:sys.modules.pop(n) for n in names if n in sys.modules}
  try:
   with patch.object(Path,'is_dir',return_value=True),patch.object(r.importlib,'import_module',side_effect=imported):r.isolated_terminal(held,{}, {}, {}, {})
   self.assertTrue(all(n not in sys.modules for n in names))
  finally:sys.modules.update(saved)
 def test_independent_final_guards_and_terminal_projection(self):
  report={'status':'RAW_RECORDING','error':'original guest/controller error'}
  def broken():raise OSError('source unavailable')
  r.final_guards(report,[('source',broken,{}),('binding',lambda:'mutated','original'),('input',lambda:'same','same')])
  self.assertEqual(set(report['finalizationErrors']),{'source','binding'});self.assertEqual(report['after']['binding'],'mutated');self.assertEqual(report['after']['input'],'same');self.assertEqual(report['error'],'original guest/controller error');self.assertEqual(report['status'],'FAIL')
  raw={'schema':'bw.cold-native-ledger-scalars-symbol-profile.worker.v1','status':'FAIL','guestStatus':'NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS','observerScope':'DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION','sampler':{'status':'FAIL'}}
  projected=r.terminal_projection(raw);self.assertEqual(raw['status'],'FAIL');self.assertEqual(projected['status'],raw['guestStatus']);self.assertEqual(projected['sampler'],raw['sampler'])
  with self.assertRaises(ValueError):r.terminal_projection({**raw,'guestStatus':'FAIL'})
 def test_owner_environment_and_launch_failure_receipt(self):
  env=r.child_environment({'HOME':'/home/runner','PATH':'/usr/bin:/bin','USER':'runner'})
  self.assertEqual(env['HOME'],'/home/runner');self.assertEqual(env['GIT_CONFIG_COUNT'],'2');self.assertEqual(env['GIT_CONFIG_GLOBAL'],'/dev/null');self.assertEqual(env['GIT_CONFIG_NOSYSTEM'],'1')
  self.assertEqual([env['GIT_CONFIG_VALUE_0'],env['GIT_CONFIG_VALUE_1']],[str(r.WORKER),str(r.COMPILED)])
  self.assertTrue(all(env[h]=='' for h in r.HOOKS));self.assertEqual(r.recorder_environment()['HOME'],str(r.OUT/'perf-home'));self.assertEqual(r.recorder_environment()['PERF_CONFIG'],'/dev/null')
  with self.assertRaises(ValueError):r.child_environment({'HOME':'/home/runner','PATH':'/bin','GH_TOKEN':'secret'})
  with tempfile.TemporaryDirectory() as directory,patch.object(r,'OUT',Path(directory)),patch.object(r.subprocess,'Popen',side_effect=OSError('manufactured launch refusal')):
   with self.assertRaisesRegex(OSError,'manufactured'):r.launch('fixture',['never-executed'],{},5,8<<20)
   record=json.loads((Path(directory)/'fixture-launch-error.json').read_text());self.assertFalse(record['childCreated']);self.assertIsNone(record['exitCode'])
 def test_cleanup_reaps_after_group_kill(self):
  with patch.object(r.time,'monotonic',return_value=110):self.assertEqual(r.remaining_budget(100),110);self.assertEqual(r.remaining_budget(0,30),10)
  with patch.object(r.time,'monotonic',return_value=120):
   with self.assertRaisesRegex(ValueError,'wall120'):r.remaining_budget(0,30)
  child=Mock(pid=77);empty=Mock();empty.iterdir.return_value=[]
  with patch.object(r,'Path',return_value=empty),patch.object(r.os,'killpg') as killpg:
   r.terminate(child)
  self.assertEqual(killpg.call_args_list[-1].args,(77,r.signal.SIGKILL));child.wait.assert_called_once_with(timeout=5)
  # Exercise the production root cleanup handler, including an attainable
  # manufactured proof written while the worker gets EOF and bounded grace.
  with tempfile.TemporaryDirectory() as directory,patch.object(r,'OUT',Path(directory)):
   events=[];worker=Mock();worker.poll.side_effect=[None,0];worker.returncode=0;perf=Mock();perf.poll.return_value=None;perf.returncode=-9;connection=Mock();connection.close.side_effect=lambda:events.append('control EOF')
   raw={'schema':'bw.cold-native-ledger-scalars-symbol-profile.worker.v1','status':'FAIL','guestStatus':'NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS','observerScope':'DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION'}
   def proof(timeout):
    self.assertLessEqual(timeout,10);events.append('attainable terminal proof');(Path(directory)/'manufactured-proof.json').write_text(json.dumps(raw))
   worker.wait.side_effect=proof;report={'status':'FAIL','error':'original recorder failure'}
   with patch.object(r,'ACTIVE',{'record':perf,'worker':worker}),patch.object(r,'terminate',side_effect=lambda p:events.append('stop recorder' if p is perf else 'kill worker')):
    r.finish_children(report,connection,worker,r.time.monotonic()-1)
   self.assertEqual(events,['stop recorder','control EOF','attainable terminal proof']);self.assertEqual(report['error'],'original recorder failure');self.assertEqual(r.terminal_projection(json.loads((Path(directory)/'manufactured-proof.json').read_text()))['status'],raw['guestStatus'])
   timed=Mock();timed.poll.return_value=None;timed.wait.side_effect=r.subprocess.TimeoutExpired('manufactured',10);timed.returncode=-9
   with patch.object(r,'ACTIVE',{'worker':timed}),patch.object(r,'terminate') as stop:
    # New exclusive path for this second manufactured cleanup outcome.
    with patch.object(r,'write') as write:r.finish_children({},None,timed,r.time.monotonic()-1)
    stop.assert_called_once_with(timed);write.assert_called_once()
if __name__=='__main__':unittest.main()
