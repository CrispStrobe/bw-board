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
 def test_closed_options_and_no_guest_workflow(self):
  self.assertEqual(control.PERF_OPTIONS,('-e','cpu-clock','-F','99','--call-graph','dwarf'))
  workflow=(control.ROOT/'.github/workflows/i80386-cold-perf-capability.yml').read_text()
  self.assertIn('workflow_dispatch:',workflow);self.assertIn('default: false',workflow)
  for forbidden in ('sudo ','apt-get','sysctl -w','enable_guest','workflow_run:'):self.assertNotIn(forbidden,workflow)
if __name__=='__main__':unittest.main()
