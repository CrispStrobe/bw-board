"""Pure source/qualification controls. Does not download, assemble or load native code."""
from pathlib import Path
import ast,copy,json,hashlib,subprocess,sys,unittest
sys.dont_write_bytecode=True
P=Path(__file__).parent
from qualification import validate_binding
class Controls(unittest.TestCase):
 def test_exact_gate_inverse_and_unchanged_window(self):
  s=(P/'gate.py').read_text()
  for row in reversed(json.loads((P/'inverse-seams.json').read_text())):
   self.assertEqual(s[row['newStart']:row['newEnd']],row['new']);s=s[:row['newStart']]+row['old']+s[row['newEnd']:]
  s=s.replace('SPAN','DISPATCH').replace('==116','==112');self.assertEqual(hashlib.sha256(s.encode()).hexdigest(),json.loads((P/'derivation.json').read_text())['sourceSha256'])
  self.assertIn("cpu=c['timing']['executionCPU']",s);self.assertIn("pair<2",s)
 def test_actual_binding_and_meaningful_denials(self):
  q=json.loads((P/'qualification-template.json').read_text());validate_binding(q)
  attacks=[lambda x:x.update(artifactId=11226630502),lambda x:x.update(head='0'*40),lambda x:x.update(zipBytes=1),lambda x:x['modes'].pop('trace-fast'),lambda x:x['modes']['trace-fast']['expectedParity'].update(status='PASS'),lambda x:x['externalReviews'].update({x['peerAudit']:'0'*64}),lambda x:x['files'].pop(x['modes']['smoke-off']['capture']),lambda x:x['modes']['trace-fast']['expectedParity'].update(canonicalRows=1),lambda x:x['files'][x['modes']['smoke-off']['capture']].update(sha256='0'*64),lambda x:x['streamAnchors'][x['modes']['fulltrace-on']['journal']].update(sha256='0'*64)]
  for attack in attacks:
   bad=copy.deepcopy(q);attack(bad)
   with self.assertRaises((AssertionError,KeyError)):validate_binding(bad)
 def test_materializer_inverse_and_all_source_syntax(self):
  old="assert before['head']==event['pull_request']['head']['sha'];";new="assert before['head']=='80d228ee5452f380655a16c4bc823beb76e781c1';"
  # Original materializer is the merged pinned source; exact token guard in
  # prepare.py ensures only this source-owned identity seam is changed.
  original=(P.parents[0]/'owned-span-parity-ci/prepare.py').read_text();self.assertEqual(original.count(old),1);oldMetadata="'head':before['head'],'pullRequest':event['number']";newMetadata="'head':event['pull_request']['head']['sha'],'toolingHead':before['head'],'pullRequest':event['number']"
  self.assertEqual(original.count(oldMetadata),1);derived=original.replace(old,new).replace(oldMetadata,newMetadata);self.assertEqual(derived.replace(newMetadata,oldMetadata).replace(new,old),original)
  for f in P.glob('*.py'):ast.parse(f.read_text(),filename=str(f))
if __name__=='__main__':unittest.main()
