"""Pure controller fixtures; no Inspector, setup, CPU child or real subprocess."""
import copy,json,tempfile,unittest,hashlib,importlib.util
from pathlib import Path
from unittest.mock import patch
import hosted as h
import lifecycle as l
import policy as p
class Controls(unittest.TestCase):
 def test_pending_precedes_effects(self):
  c=copy.deepcopy(h.read(h.HERE/'contract.json'));c['status']='PENDING_SOURCE_REVIEW_NO_EXECUTION'
  with patch.object(h,'read',return_value=c),patch.object(h,'sources',side_effect=AssertionError('source effects')),patch.object(h,'bounded_child',side_effect=AssertionError('child effects')):
   with self.assertRaisesRegex(ValueError,'pending refuses'):h.main('enabled')
 def test_ready_binding_and_manufactured_worker_mutation_refusals(self):
  c=copy.deepcopy(h.read(h.HERE/'contract.json'));c['status']='ROOT_REVIEWED_EXECUTION_PROFILE_HOSTED_READY'
  self.assertEqual(p.contract(c),c,'valid exact frozen READY role accepted')
  changed=copy.deepcopy(c);changed['diagnosticWorker']['authorityStatus']='PENDING_SOURCE_REVIEW_NO_EXECUTION'
  with self.assertRaisesRegex(ValueError,'full source-owned authority'):p.contract(changed)
  changed=copy.deepcopy(c);changed['diagnosticWorker']['revision']='0'*40
  with self.assertRaisesRegex(ValueError,'full source-owned authority'):p.contract(changed)
  changed=copy.deepcopy(c);changed['diagnosticWorker']['sourceSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'full source-owned authority'):p.contract(changed)
 def test_finalization_preserves_primary_and_raw_failure(self):
  with tempfile.TemporaryDirectory() as name:
   out=Path(name);primary=RuntimeError('original guest');report={'status':'FAIL','error':repr(primary)}
   (out/'derived-binding.json').write_text('{}');binding_before=h.fingerprint(out/'derived-binding.json');(out/'derived-binding.json').write_text('{"altered":true}')
   with patch.object(h,'sources',side_effect=RuntimeError('source after')),patch.object(h,'host_context',side_effect=RuntimeError('host after')):
    got=h.finish(out,report,primary,{}, {},Path('/unused-node'),binding_before,None)
   self.assertIn('bindingAfter',got);self.assertEqual([e['phase'] for e in got['finalizationErrors']],['sourceAfter','bindingAfter']);self.assertNotEqual(got['bindingAfter'],binding_before)
   self.assertEqual(got['error'],repr(primary));self.assertIn('source after',got['finalizationError']);self.assertIn('host after',got['hostAfterUnavailable']);self.assertEqual(json.loads((out/'result.json').read_text())['status'],'FAIL')
 def test_binding_final_only_mutation_is_not_suppressed(self):
  with tempfile.TemporaryDirectory() as name:
   out=Path(name);(out/'derived-binding.json').write_text('{}');before=h.fingerprint(out/'derived-binding.json');(out/'derived-binding.json').write_text('{"altered":true}')
   with patch.object(h,'sources',return_value={}),patch.object(h,'host_context',return_value={}):
    with self.assertRaisesRegex(ValueError,'bindingAfter final guard'):h.finish(out,{'status':'PASS'},None,{}, {},Path('/unused-node'),before,None)
   self.assertEqual(json.loads((out/'result.json').read_text())['status'],'FAIL')
 def test_real_terminal_projection_with_complete_role_metadata(self):
  origin=h.read(h.HERE/'fixture-origin.json');held=h.HERE/'held-terminal-policy.py'
  self.assertEqual(hashlib.sha256(held.read_bytes()).hexdigest(),'8e4755def2cd3171a6b111fd5aedeb832ed301a855755e4d4ea29f92aa16dfaa')
  self.assertEqual(origin['heldPolicySha256'],'8e4755def2cd3171a6b111fd5aedeb832ed301a855755e4d4ea29f92aa16dfaa')
  spec=importlib.util.spec_from_file_location('held_terminal_fixture_policy',held);q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
  f=h.read(h.HERE/'terminal-fixture.json');r=p.terminal_projection(f['receiptProjection']);legacy=copy.deepcopy(f['originalDerivedBinding'])
  with self.assertRaisesRegex(KeyError,'binding'):q.validate_worker_receipt(r,'native-batched',f['input'],legacy,f['captureProjection'])
  c=p.contract(h.read(h.HERE/'contract.json'));fixed=copy.deepcopy(legacy);fixed['workers']['native']=p.diagnostic_worker_role(c)
  q.validate_worker_receipt(r,'native-batched',f['input'],fixed,f['captureProjection']);q.validate_bridge_evidence(r)
  self.assertEqual(len(q.words(r['finalNative'])),166)
  for change in ('state','activity'):
   mutated=copy.deepcopy(r)
   if change=='state':mutated['finalNative']['state'][0]^=1
   else:mutated['lastReturnedNative']['activityState']=1
   with self.assertRaises(ValueError):q.validate_worker_receipt(mutated,'native-batched',f['input'],fixed,f['captureProjection'])
  bad=copy.deepcopy(c);bad['diagnosticWorker']['binding']='scripts/other/binding.json'
  with self.assertRaisesRegex(ValueError,'fixed diagnostic lock'):p.diagnostic_worker_role(bad)
  bad=copy.deepcopy(f['receiptProjection']);bad['terminalParityStatus']='FAIL'
  with self.assertRaisesRegex(ValueError,'terminal proof'):p.terminal_projection(bad)
 def test_fixed_child_scope_and_token_refusal_before_launch(self):
  c=h.read(h.HERE/'contract.json');self.assertEqual(c['bounds']['fileBytes'],16<<20);self.assertEqual(c['setupBounds']['fileBytes'],32<<20);self.assertEqual(c['bounds']['cpuSeconds'],60);self.assertEqual(c['bounds']['wallSeconds'],120)
  with tempfile.TemporaryDirectory() as name,patch.object(l.subprocess,'Popen',side_effect=AssertionError('no real process')):
   with self.assertRaisesRegex(ValueError,'token only'):l.bounded_child(['/node','--max-old-space-size=128','/worker','setup'],Path(name),Path(name)/'child',c['bounds'],artifact_setup=True)
if __name__=='__main__':unittest.main()
