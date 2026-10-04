"""Pure manufactured controls. No download, restore, addon or guest."""
import copy,json,unittest
from unittest.mock import patch
import qualify as q
class Controls(unittest.TestCase):
 def ready(self):
  c=q.read_json(q.HERE/'contract.json');c['status']='ROOT_REVIEWED_LEDGER_SCALARS_QUALIFICATION_READY';return c
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
  d=q.read_json(q.HERE/'restore-derivation.json');s=(q.HERE/'restore.py').read_text()
  for e in reversed(d['edits']):self.assertEqual(s[e['start']:e['end']],e['next']);s=s[:e['start']]+e['old']+s[e['end']:]
  self.assertEqual(q.digest(s.encode()),d['baseSha256'])
 def test_return_metadata_and_ownership_denials(self):
  fixtures=q.read_json(q.ROOT/'scripts/cold-native-memory-fusion-performance/actual-snapshot-fixtures.json')
  # Only genuine ordinary snapshot metadata projections; no typed execution.
  n=copy.deepcopy(fixtures['finalInspect']);n.update(bridgeClockEntryAttempts={k:str(int(k=='INIT')) for k in q.METADATA_COUNTER_FIELDS['bridgeClockEntryAttempts']},bridgeMemoryEntryAttempts={k:'0' for k in q.METADATA_COUNTER_FIELDS['bridgeMemoryEntryAttempts']});q.validate_inspect_snapshot(n)
  # Fusion metadata is manufactured; ordinary raw words above remain genuine.
  for field in ['bridgeClockEntryAttempts','bridgeMemoryEntryAttempts']:
   bad=copy.deepcopy(n);bad[field].pop(next(iter(bad[field])))
   with self.assertRaises(ValueError):q.validate_inspect_snapshot(bad)
  reset=copy.deepcopy(n);final=copy.deepcopy(n);final['bridgeMemoryEntryAttempts']['fusedOuter']='12'
  counts={'provider':{'memoryOuterEntries':12,'replyValidations':12,'readEffects':5,'writeEffects':7},'reset':{'clock':reset['bridgeClockEntryAttempts'],'memory':reset['bridgeMemoryEntryAttempts']},'final':{'clock':final['bridgeClockEntryAttempts'],'memory':final['bridgeMemoryEntryAttempts']},'scope':'Manufactured proof fixture only'}
  record={'reset':{'native':reset},'finalNative':final,'bridgeAttemptCounts':counts};q.validate_bridge_evidence(record)
  for mutation in [lambda r:r['bridgeAttemptCounts']['provider'].update(replyValidations=11),lambda r:r['bridgeAttemptCounts']['provider'].update(writeEffects=6),lambda r:r['bridgeAttemptCounts']['final'].update(memory={'fusedOuter':'13'}),lambda r:r['reset']['native']['bridgeClockEntryAttempts'].update(INIT='0')]:
   bad=copy.deepcopy(record);mutation(bad)
   with self.assertRaises(ValueError):q.validate_bridge_evidence(bad)
  bad=copy.deepcopy(n);bad['activityState']=0
  with self.assertRaises(ValueError):q.validate_inspect_snapshot(bad)
  for r in [{'requiredStateExportProfile':'wrong','admittedStateExportProfile':'wrong'},{'requiredStateExportProfile':'bw.cold-native.copied-u32-state.v1','admittedStateExportProfile':'bw.cold-native.copied-u32-state.v1','requiredMemoryFusionProfile':'bw.cold-native.memory-clock-fusion.v1','admittedMemoryFusionProfile':'bw.cold-native.memory-clock-fusion.v1','typedSnapshotOwnership':'wrong'},{'requiredStateExportProfile':'bw.cold-native.copied-u32-state.v1','admittedStateExportProfile':'bw.cold-native.copied-u32-state.v1','requiredMemoryFusionProfile':'wrong','admittedMemoryFusionProfile':'wrong'}]:
   with self.assertRaises(ValueError):q.terminal(r,{}, {}, {})
 def test_manual_single_child_contract(self):
  text=(q.ROOT/'.github/workflows/i80386-cold-ledger-scalars-qualification.yml').read_text();self.assertIn('workflow_dispatch:',text);self.assertNotIn('pull_request:',text);self.assertNotIn('push:',text);self.assertIn('default: false',text)
  source=(q.HERE/'qualify.py').read_text();self.assertEqual(source.count("str(N/c['worker']['entry'])"),1);self.assertIn("'mode':'batched'",source);self.assertIn("report['inputsAfter']==report['inputsBeforeRestore']",source)
if __name__=='__main__':unittest.main()
