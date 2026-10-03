"""Pure manufactured controls. No download, restore, addon or guest."""
import copy,json,unittest
from unittest.mock import patch
import qualify as q
class Controls(unittest.TestCase):
 def ready(self):
  c=q.read_json(q.HERE/'contract.json');c['status']='ROOT_REVIEWED_TYPED_QUALIFICATION_READY';return c
 def test_pending_precedes_effects(self):
  with patch.object(q,'download',side_effect=AssertionError('network forbidden')),patch.object(q,'bounded_child',side_effect=AssertionError('child forbidden')):
   c=self.ready();c['status']='PENDING_SOURCE_REVIEW'
   with self.assertRaises(ValueError):q.contract(c)
 def test_closed_maps_and_bounds(self):
  c=self.ready();self.assertIs(q.contract(c),c)
  for mutation in [lambda x:x['worker']['files'].pop(next(iter(x['worker']['files']))),lambda x:x['compiledFiles'].pop(next(iter(x['compiledFiles']))),lambda x:x['bounds'].update(cpuSeconds=61),lambda x:x['buildArtifact'].update(artifactId=1)]:
   bad=copy.deepcopy(c);mutation(bad)
   with self.assertRaises(ValueError):q.contract(bad)
 def test_restore_exact_inverse(self):
  d=q.read_json(q.HERE/'restore-derivation.json');s=(q.HERE/'restore.py').read_text();s=s.replace("'schema':'bw.cold-typed-state-restored-materialization.v1','stateExportProfile':'bw.cold-native.copied-u32-state.v1'","'schema':'bw.cold-native-restored-materialization.v1'")
  for old,new in reversed(d['changes']):self.assertIn(new,s);s=s.replace(new,old)
  self.assertEqual(q.digest(s.encode()),d['baseSha256'])
 def test_return_metadata_and_ownership_denials(self):
  fixtures=q.read_json(q.ROOT/'scripts/cold-native-typed-state-performance/actual-snapshot-fixtures.json')
  # Only genuine ordinary snapshot metadata projections; no typed execution.
  n=fixtures['finalInspect'];q.validate_inspect_snapshot(n)
  bad=copy.deepcopy(n);bad['activityState']=0
  with self.assertRaises(ValueError):q.validate_inspect_snapshot(bad)
  for r in [{'requiredStateExportProfile':'wrong','admittedStateExportProfile':'wrong'},{'requiredStateExportProfile':'bw.cold-native.copied-u32-state.v1','admittedStateExportProfile':'bw.cold-native.copied-u32-state.v1','typedSnapshotOwnership':'wrong'}]:
   with self.assertRaises(ValueError):q.terminal(r,{}, {}, {})
 def test_manual_single_child_contract(self):
  text=(q.ROOT/'.github/workflows/i80386-cold-typed-state-qualification.yml').read_text();self.assertIn('workflow_dispatch:',text);self.assertNotIn('pull_request:',text);self.assertNotIn('push:',text);self.assertIn('default: false',text)
  source=(q.HERE/'qualify.py').read_text();self.assertEqual(source.count("str(N/c['worker']['entry'])"),1);self.assertIn("'mode':'batched'",source);self.assertIn("report['inputsAfter']==report['inputsBeforeRestore']",source)
if __name__=='__main__':unittest.main()
