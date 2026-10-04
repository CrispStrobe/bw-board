"""Pure controller fixtures; no Inspector, setup, CPU child or real subprocess."""
import copy,json,tempfile,unittest
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
 def test_fixed_child_scope_and_token_refusal_before_launch(self):
  c=h.read(h.HERE/'contract.json');self.assertEqual(c['bounds']['fileBytes'],16<<20);self.assertEqual(c['setupBounds']['fileBytes'],32<<20);self.assertEqual(c['bounds']['cpuSeconds'],60);self.assertEqual(c['bounds']['wallSeconds'],120)
  with tempfile.TemporaryDirectory() as name,patch.object(l.subprocess,'Popen',side_effect=AssertionError('no real process')):
   with self.assertRaisesRegex(ValueError,'token only'):l.bounded_child(['/node','--max-old-space-size=128','/worker','setup'],Path(name),Path(name)/'child',c['bounds'],artifact_setup=True)
if __name__=='__main__':unittest.main()
