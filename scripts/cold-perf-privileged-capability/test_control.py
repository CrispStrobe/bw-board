"""Pure parser/refusal controls only; no perf, compiler or workload execution."""
import sys
sys.dont_write_bytecode=True
import unittest,tempfile,json
from unittest import mock
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import control
class Pure(unittest.TestCase):
 def test_supported_requires_actual_two_thread_nested_stack(self):
  raw='workload 12/12 1.0: cpu-clock:\n 123 leaf (/tmp/workload)\n 456 middle (/tmp/workload)\n 789 chain (/tmp/workload)\n\nworkload 12/13 1.1: cpu-clock:\n 123 leaf (/tmp/workload)\n 456 middle (/tmp/workload)\n 789 chain (/tmp/workload)\n'
  done={'exitCode':0,'timedOut':False};out='WORKLOAD_TID 12\nWORKLOAD_TID 13\n'
  self.assertEqual(control.classify(raw,out,done),'SUPPORTED_FIXED_WORKLOAD_ONLY')
  self.assertEqual(control.classify(raw.replace('12/13','12/14'),out,done),'INSUFFICIENT_THREAD_COVERAGE')
  self.assertEqual(control.classify(raw.replace('middle','unresolved'),out,done),'INSUFFICIENT_UNWIND')
  self.assertEqual(control.classify(raw.replace('123 leaf','123 chain').replace('789 chain','789 leaf'),out,done),'INSUFFICIENT_UNWIND')
  one_unwound=raw[:raw.index('workload 12/13')]+raw[raw.index('workload 12/13'):].replace('middle','unresolved')
  self.assertEqual(control.classify(one_unwound,out,done),'INSUFFICIENT_UNWIND')
  self.assertEqual(control.classify(raw.replace('123 leaf','123 unresolvedleaf'),out,done),'INSUFFICIENT_UNWIND')
  self.assertEqual(control.classify(raw.replace('123 leaf (/tmp/workload)','123 leaf (/tmp/unknown)'),out,done),'INSUFFICIENT_UNWIND')
  self.assertEqual(control.classify(raw.replace('123 leaf (/tmp/workload)','123 [unknown] (/tmp/workload)'),out,done),'INSUFFICIENT_UNWIND')
  self.assertEqual(control.classify(raw+'\nLOST 1 events\n',out,done),'INSUFFICIENT_LOST_EVENTS')
  self.assertEqual(control.classify(raw,out,{'exitCode':1,'timedOut':False}),'REFUSED_OR_RECORD_FAILED')
 def test_wait_interruption_reaps_and_retains_raw_error(self):
  child=mock.Mock(pid=123456,returncode=None);child.wait.side_effect=[KeyboardInterrupt('manufactured'),None];child.poll.return_value=None
  def killed(pid,sig):
   if sig==control.signal.SIGKILL:child.returncode=-9
  with tempfile.TemporaryDirectory() as directory, mock.patch.object(control.subprocess,'Popen',return_value=child),mock.patch.object(control.os,'killpg',side_effect=killed) as kill:
   with self.assertRaises(KeyboardInterrupt):control.command(Path(directory),'interrupted',['/never-tool'])
   self.assertEqual(child.wait.call_count,2);self.assertEqual(kill.call_args_list,[mock.call(123456,control.signal.SIGSTOP),mock.call(123456,control.signal.SIGKILL)])
   receipt=json.loads(Path(directory,'interrupted-exit.json').read_text());self.assertEqual(receipt['exitCode'],-9);self.assertIn('manufactured',receipt['launchOrWaitError'])
 def test_privileged_mode_refuses_unprivileged_before_output(self):
  with mock.patch.object(control.os,'geteuid',return_value=1000),mock.patch.object(control.pathlib.Path,'mkdir',side_effect=AssertionError('must not write')):
   with self.assertRaisesRegex(ValueError,'UID0'):control.main('/never-output')
  with mock.patch.object(control.os,'getpgid',side_effect=ProcessLookupError):self.assertEqual(control.observe_effective_perf(123456),[])
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/'perf';target.write_bytes(b'fixed-image')
   with self.assertRaisesRegex(ValueError,'executing ELF'):control.authenticate_effective({'path':str(target),'sha256':'0'*64})
   control.authenticate_effective({'path':str(target),'sha256':control.sha(target)})
 def test_post_classification_error_cannot_retain_supported(self):
  def fake_command(out,name,args,**kwargs):
   if name.startswith('effective-perf-version'):raise RuntimeError('manufactured post-classify failure')
   if name=='record':
    (out/'record.stdout').write_text('manufactured')
    (out/'effective-perf-observed.json').write_text(json.dumps([{'path':'/never-tool','sha256':'a'*64}]))
   if name=='script':(out/'script.stdout').write_text('manufactured')
   return {'exitCode':0,'timedOut':False}
  with tempfile.TemporaryDirectory() as directory,mock.patch.object(control.os,'geteuid',return_value=0),mock.patch.object(control,'source',return_value={'revision':'manufactured'}),mock.patch.object(control.shutil,'which',return_value='/never-tool'),mock.patch.object(control,'sha',return_value='a'*64),mock.patch.object(control,'command',side_effect=fake_command),mock.patch.object(control,'classify',return_value='SUPPORTED_FIXED_WORKLOAD_ONLY'):
   out=Path(directory)/'output'
   with self.assertRaisesRegex(RuntimeError,'post-classify'):control.main(str(out))
   receipt=json.loads((out/'result.json').read_text());self.assertEqual(receipt['status'],'FAIL');self.assertIn('post-classify',receipt['error'])
 def test_closed_options_and_no_guest_workflow(self):
  self.assertEqual(control.PERF_OPTIONS,('-e','cpu-clock','-F','99','--call-graph','dwarf'))
  workflow=(control.ROOT/'.github/workflows/i80386-cold-perf-privileged-capability.yml').read_text()
  self.assertIn('workflow_dispatch:',workflow);self.assertIn('default: false',workflow);self.assertIn('sudo -n -- /usr/bin/python3',workflow);self.assertIn('--privileged-nonguest',workflow)
  for forbidden in ('apt-get','sysctl -w','enable_guest','workflow_run:'):self.assertNotIn(forbidden,workflow)
if __name__=='__main__':unittest.main()
