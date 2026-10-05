"""Six manufactured hosted/source controls; no setup, sudo, perf or guest."""
import sys
sys.dont_write_bytecode=True
import json,hashlib,tempfile,importlib.util,signal
from pathlib import Path
from unittest import TestCase,main
from unittest.mock import patch,Mock
import policy,admission,lifecycle,hosted
spec=importlib.util.spec_from_file_location('root_entry',Path(__file__).parent/'root-entry.py');root=importlib.util.module_from_spec(spec);spec.loader.exec_module(root)
class Controls(TestCase):
 def setUp(self):
  p=patch.object(lifecycle.subprocess,'Popen',side_effect=AssertionError('real child forbidden'));p.start();self.addCleanup(p.stop)
 def test_pending_precedes_setup_roles_and_processes(self):
  pending=admission.read(admission.HERE/'contract.json');pending['status']='PENDING_ROOT_HOSTED_SOURCE_REVIEW'
  with patch.object(hosted,'read',return_value=pending),patch.object(hosted,'sources',side_effect=AssertionError('source/tool lookup forbidden')),patch.object(hosted,'bounded_child',side_effect=AssertionError('child forbidden')):
   with self.assertRaisesRegex(ValueError,'PENDING'):hosted.main('enabled')
  with self.assertRaisesRegex(ValueError,'PENDING'):policy.contract(pending)
 def test_complete_maps_bounds_and_owned_ready_with_pending_denials(self):
  c=admission.read(admission.HERE/'contract.json');c['status']='ROOT_REVIEWED_NATIVE_SYMBOL_HOSTED_READY'
  self.assertIs(policy.contract(c),c)
  role=c['roles']['diagnostic'];self.assertEqual(len(role['files']),92)
  self.assertFalse(any('/ack-framing-source/' in name for name in role['files']))
  self.assertEqual(role['sourceSha256'],hashlib.sha256(json.dumps({'revision':role['revision'],'hashes':role['files']},separators=(',',':')).encode()).hexdigest())
  self.assertEqual(sum(len(v['files']) for v in c['roles'].values()),390)
  pending=json.loads(json.dumps(c));pending['status']='PENDING_ROOT_HOSTED_SOURCE_REVIEW'
  with self.assertRaisesRegex(ValueError,'PENDING'):policy.contract(pending)
  for mutate in [lambda x:x['roles']['diagnostic'].update(status='PENDING_ROOT_SOURCE_REVIEW'),lambda x:x['roles']['diagnostic'].update(revision='0'*40),lambda x:x['roles']['diagnostic'].update(sourceSha256='0'*64),lambda x:x['roles']['diagnostic']['files'].update({'scripts/cold-native-ledger-scalars-symbol-profile/ack-framing-source/FINDING.md':'0'*64}),lambda x:x['roles']['compiled']['files'].pop(next(iter(x['roles']['compiled']['files']))),lambda x:x['observerBounds'].update(fileBytes=128<<20),lambda x:x.update(enabledByDefault=True)]:
   bad=json.loads(json.dumps(c));mutate(bad)
   with self.assertRaisesRegex(ValueError,'complete source-owned'):policy.contract(bad)
 def test_setup_only_sha_alias_retains_actual_dispatch(self):
  c=admission.read(admission.HERE/'contract.json');command=[sys.executable,'-B','/home/runner/work/bw-board/bw-board/symbol-worker/scripts/cold-native-ledger-scalars-symbol-profile/setup.py'];env={'GITHUB_SHA':'a'*40,'GH_TOKEN':'manufactured token'}
  with patch.object(policy,'contract',return_value=c):
   scoped=lifecycle.scoped_setup_environment(command,env);self.assertEqual(env['GITHUB_SHA'],'a'*40);self.assertEqual(scoped['BW_ACTUAL_DISPATCH_SHA'],'a'*40);self.assertEqual(scoped['GITHUB_SHA'],c['roles']['diagnostic']['revision']);self.assertEqual(scoped['GH_TOKEN'],env['GH_TOKEN'])
   with self.assertRaisesRegex(ValueError,'fixed authenticated'):lifecycle.scoped_setup_environment([sys.executable,'-B','/tmp/caller.py'],env)
 def test_parent_independent_source_and_input_failures(self):
  with tempfile.TemporaryDirectory() as directory,patch.object(hosted,'PARENT',Path(directory)),patch.object(hosted,'OUT',Path(directory)/'no-setup'),patch.object(hosted,'own_source',side_effect=OSError('source missing')),patch.object(hosted,'fingerprint',return_value={'sha256':'changed'}),patch.object(hosted,'host_context',return_value={'fixture':True}):
   error=ValueError('original child failure');report={'status':'FAIL','error':repr(error)};before={'dispatch':{},'node':{'sha256':'old'}}
   hosted.finish(report,error,{'roles':{}},Path('/fixture/node'),before,{'/fixture/input':{'sha256':'old'}});self.assertEqual(set(report['finalizationErrors']),{'dispatchAfter','nodeAfter','inputAfter:/fixture/input'});self.assertEqual(report['inputAfter:/fixture/input'],{'sha256':'changed'});self.assertEqual(report['error'],repr(error));self.assertTrue((Path(directory)/'result.json').exists())
 def test_root_failure_keeps_original_and_watchdog_cleanup(self):
  c={'roles':{'diagnostic':{'root':str(admission.WS/'symbol-worker'),'files':{}}},'scope':'DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION','rootWatchdogSeconds':180};guest=RuntimeError('manufactured recorder failure');child=Mock();child.poll.return_value=None;recorder=Mock();recorder.ROOT=admission.WS/'symbol-worker';recorder.ACTIVE={'record':child};recorder.main.side_effect=guest
  pin={'sha256':'fixture'};before={'dispatch':{'hashes':{}},'sourceRecordPin':pin}
  with patch.object(root,'contract',return_value=c),patch.object(root,'read',side_effect=[c,{'setupRecordPin':pin,'inputPin':pin}]),patch.object(root.os,'geteuid',return_value=0),patch.object(root,'ROOT',admission.WS/'runtime'),patch.object(root,'authenticated_bytes',return_value=before),patch.object(root,'fingerprint',return_value=pin),patch.object(root.importlib.util,'spec_from_file_location',return_value=Mock()),patch.object(root.importlib.util,'module_from_spec',return_value=recorder),patch.object(root.signal,'signal'),patch.object(root.signal,'alarm') as alarm,patch.object(root,'finish_root') as finish:
   try:root.main()
   except RuntimeError as caught:self.assertIs(caught,guest)
   else:self.fail('original error lost')
   recorder.terminate.assert_called_once_with(child);self.assertEqual(alarm.call_args_list[0].args,(180,));self.assertEqual(alarm.call_args_list[-1].args,(0,));self.assertIs(finish.call_args.args[-1],guest)
   child.poll.return_value=0;child.returncode=0;recorder.terminate.reset_mock();root.read.side_effect=[c,{'setupRecordPin':pin,'inputPin':pin}]
   with self.assertRaises(RuntimeError):root.main()
   recorder.terminate.assert_not_called();self.assertTrue(finish.call_args.args[0]['childCleanup']['record']['alreadyReaped'])
  with tempfile.TemporaryDirectory() as directory,patch.object(root,'PARENT',Path(directory)),patch.object(root,'fingerprint',side_effect=OSError('manufactured missing')):
   report={'status':'FAIL','error':repr(guest),'inputPinsBefore':{'/fixture/input':pin}};root.finish_root(report,{'roles':{'diagnostic':{'root':'/fixture','files':{'source.py':'a'*64}}}},{'dispatch':{'hashes':{}}},guest)
   self.assertEqual(set(report['finalizationErrors']),{'diagnostic/source.py','input:/fixture/input'});self.assertEqual(report['error'],repr(guest))
 def test_held_lifecycle_count_bound_inverse_and_watchdog_source(self):
  here=Path(__file__).parent;d=json.loads((here/'lifecycle-derivation.json').read_bytes());held=(here.parents[1]/d['heldPath']).read_text();self.assertEqual(hashlib.sha256(held.encode()).hexdigest(),d['heldSha256']);candidate=held
  for s in d['seams']:self.assertEqual(s['count'],1);self.assertEqual(candidate.count(s['held']),1);candidate=candidate.replace(s['held'],s['candidate'])
  self.assertEqual(candidate,(here/'lifecycle.py').read_text());self.assertEqual(hashlib.sha256(candidate.encode()).hexdigest(),d['candidateSha256']);text=(here/'root-entry.py').read_text();self.assertIn("signal.alarm(c['rootWatchdogSeconds'])",text);self.assertIn('recorder.main()',text);self.assertNotIn('recorder.source_guard =',text)
if __name__=='__main__':main()
