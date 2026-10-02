# Read-only full comparison after explicit root native launch; no execution by preparation.
import json,pathlib,hashlib,itertools,sys
P=pathlib.Path(__file__).parent;label=sys.argv[1];assert label in ['smoke-off','fulltrace-on'];R=P/label;B=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-main-'+label+'-20261002');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();count=0
expected={'smoke-off':'14e8ad86ffb1ee448ae8bcbccf8c11ccffcd5ca89a47d4884547bef4f010902a','fulltrace-on':'6a396529c6c2d95a69b1897fc60251abaecfe06676e18170920c6b6fa297f65f'};assert sha(B/'guest/capture.json')==expected[label];a=json.loads((B/'guest/capture.json').read_bytes());b=json.loads((R/'guest/capture.json').read_bytes());freeze=json.loads(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-alloc-source-20261002/source-freeze.json').read_bytes());assert b['source']==freeze['source'];assert a['source']['revision']=='bab751825473d55d8bf6da8c6ad5786921ffcfe1';assert b['provenance']['compiledSource']==a['provenance']['compiledSource']
for field in ['reset','final','checkpoints','settled','ramSha256','resumes','terminal','closed','journal']:assert b[field]==a[field],field;count+=1
assert b['resumes']==439 and len(b['checkpoints'])==6;assert b['final']['clockTransfers']=={'transfers':'9204','commits':'8738','words':'201366'}
rows=0
if label=='fulltrace-on':
 def lines(p):
  with p.open('rb')as f:
   for line in f:
    if line.startswith(b'BWSD1\t'):yield line
    elif b'BWSD1'in line:raise AssertionError('malformed trace fragment')
 for x,y in itertools.zip_longest(lines(B/'stderr'),lines(R/'stderr')):assert x==y;rows+=1
 assert rows==1649067;assert sha(R/'guest/callbacks.jsonl')=='bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1'
else:assert (R/'guest/callbacks.jsonl').stat().st_size==0
result={'status':'ALLOC_FULL_PARITY_PASS'if label=='fulltrace-on'else'ALLOC_CAPTURE_OFF_PARITY_PASS_NOT_SPEED_GATE','canonicalRows':rows,'completeSnapshotFields':count,'captureSha256':sha(R/'guest/capture.json'),'journalSha256':sha(R/'guest/callbacks.jsonl'),'sourceRevision':b['source']['revision'],'compiledRevision':b['provenance']['compiledSource']['revision'],'scope':'alloriginal fullfields plusphysicalclockcounters exact qualifiedMAINbab, no maskedprojection/no broaderguestqualification'};(R/'parity.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
