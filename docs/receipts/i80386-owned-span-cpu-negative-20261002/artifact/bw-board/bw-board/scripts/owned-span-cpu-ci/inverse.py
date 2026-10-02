from pathlib import Path
import json,hashlib
P=Path(__file__).parent
s=(P/'gate.py').read_text()
for row in reversed(json.loads((P/'inverse-seams.json').read_text())):
 assert s[row['newStart']:row['newEnd']]==row['new']
 s=s[:row['newStart']]+row['old']+s[row['newEnd']:]
s=s.replace('SPAN','DISPATCH').replace('==116','==112')
assert hashlib.sha256(s.encode()).hexdigest()==json.loads((P/'derivation.json').read_text())['sourceSha256']
print('EXACT_SOURCE_INVERSE_PASS_NO_GATE_EXECUTION')
