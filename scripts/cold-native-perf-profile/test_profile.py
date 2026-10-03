"""Manufactured pure source controls; no child/network/addon/workload."""
import sys
sys.dont_write_bytecode=True
import unittest,tempfile,json
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).parent))
import profile
class Pure(unittest.TestCase):
 def test_actual_capability_authority_and_changed_digest_refusal(self):
  c=profile.guard();self.assertEqual(c['nativeRevision'],'b01c922c2d634aba9367f6e2a70d109370e4adee')
  with mock.patch.object(profile,'sha',return_value='0'*64),mock.patch.object(profile.subprocess,'Popen',side_effect=AssertionError('no child')):
   with self.assertRaisesRegex(ValueError,'capability pin'):profile.guard()
 def test_whole_process_summary_preserves_unknown_and_helper_scope(self):
  raw='node 10/11 1.0: cpu-clock:\n 12 [unknown] ([unknown])\n\ngit 20/20 1.1: cpu-clock:\n 34 run_command (/usr/bin/git)\n\nLOST 2 events\n'
  s=profile.sample_summary(raw);self.assertEqual(s['pidTidSamples'],{'10/11':1,'20/20':1});self.assertEqual(s['unresolvedSampleBlocks'],1);self.assertEqual(s['dsoFrameCounts']['/usr/bin/git'],1);self.assertTrue(s['lostEventBlocks'])
 def test_only_two_explicit_git_roles(self):
  with mock.patch.object(profile.subprocess,'check_output',side_effect=AssertionError('before Git')):
   with self.assertRaisesRegex(ValueError,'two exact'):profile.git_identity(None,'/arbitrary','x',{})
 def test_closed_workflow_worker_and_profiler_bounds(self):
  text=(profile.ROOT/'.github/workflows/i80386-cold-native-perf-profile.yml').read_text();self.assertIn('default: false',text);self.assertIn('sudo -n --',text);self.assertNotIn('enable_pairs',text);self.assertNotIn('apt-get',text)
  c=profile.guard();self.assertEqual(c['bounds']['workerFileBytes'],16<<20);self.assertEqual(c['bounds']['profilerFileBytes'],64<<20)
  shim=(profile.HERE/'worker-entry.py').read_text();self.assertIn('os.execv(args[2],args[2:])',shim);self.assertIn('--max-old-space-size=128',shim)
 def test_interrupted_command_cleanup_preserves_primary_and_exit(self):
  child=mock.Mock(pid=100,returncode=None);child.poll.side_effect=KeyboardInterrupt('manufactured')
  def kill(pid):child.returncode=-9;child.poll.side_effect=None;child.poll.return_value=-9
  with tempfile.TemporaryDirectory() as d:
   p=mock.Mock();p.write.side_effect=profile.write;p.kill_tree.side_effect=kill
   with mock.patch.object(profile.subprocess,'Popen',return_value=child):
    with self.assertRaisesRegex(KeyboardInterrupt,'manufactured'):profile.command(p,Path(d),'synthetic',['/never'],5,10,8<<20,{})
   p.kill_tree.assert_called_once_with(100);child.wait.assert_called_once();self.assertEqual(json.loads(Path(d,'synthetic-exit.json').read_text())['exitCode'],-9)
 def test_uid_drop_refusal_and_irreversible_exec_order(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('shim',profile.HERE/'worker-entry.py');shim=importlib.util.module_from_spec(spec);spec.loader.exec_module(shim)
  with mock.patch.object(shim.os,'geteuid',return_value=0),mock.patch.object(shim.os,'setgroups',side_effect=AssertionError('before drop')):
   with self.assertRaisesRegex(ValueError,'nonroot'):shim.exec_worker(['0','1','/node','--max-old-space-size=128','/entry','/input'])
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'worker-output').mkdir();events=[]
   with mock.patch.object(shim.resource,'setrlimit'),mock.patch.object(shim.os,'geteuid',side_effect=[0,1000,1000]),mock.patch.object(shim.os,'getuid',return_value=1000),mock.patch.object(shim.os,'getgid',return_value=1000),mock.patch.object(shim.os,'getegid',return_value=1000),mock.patch.object(shim.os,'getgroups',return_value=[]),mock.patch.object(shim.os,'setgroups',side_effect=lambda _:events.append('groups')),mock.patch.object(shim.os,'setgid',side_effect=lambda _:events.append('gid')),mock.patch.object(shim.os,'setuid',side_effect=lambda _:events.append('uid')),mock.patch.object(shim.os,'execv',side_effect=lambda *a:events.append('exec')):
    shim.exec_worker(['1000','1000','/node','--max-old-space-size=128','/entry',str(root/'input.json')])
   self.assertEqual(events,['groups','gid','uid','exec']);self.assertEqual(json.loads((root/'worker-output/launch.json').read_text())['uid'],1000)
 def test_owner_environment_isolates_inherited_git_and_credentials(self):
  ordinary={'HOME':'/home/runner','USER':'runner','PATH':'/usr/bin'}
  with mock.patch.dict(profile.os.environ,{'HOME':'/root','GH_TOKEN':'manufactured-secret','GIT_CONFIG_VALUE_0':'*'}):env=profile.child_environment(ordinary)
  self.assertEqual(env['HOME'],'/home/runner');self.assertNotIn('GH_TOKEN',env);self.assertEqual(env['GIT_CONFIG_GLOBAL'],'/dev/null');self.assertEqual(env['GIT_CONFIG_NOSYSTEM'],'1');self.assertEqual(env['GIT_CONFIG_COUNT'],'2');self.assertEqual(env['GIT_CONFIG_VALUE_0'],str(profile.WS/'native-worker'));self.assertEqual(env['GIT_CONFIG_VALUE_1'],str(profile.WS/'publication'));self.assertTrue(all(env[h]=='' for h in profile.HOOKS));self.assertEqual(ordinary['HOME'],'/home/runner')
  with self.assertRaisesRegex(ValueError,'whitelist'):profile.child_environment(dict(ordinary,GIT_CONFIG_VALUE_0='*'))
if __name__=='__main__':unittest.main()
