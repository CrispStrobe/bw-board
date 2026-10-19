import json,pathlib,hashlib,itertools,sys
label=sys.argv[1];assert label in ['smoke-off','fulltrace-on']
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-'+label+'-r2-20261002');H=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001');checks=0
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def eq(a,b,label):
 global checks
 assert a==b,(label,a,b);checks+=1
def logical(s):
 if isinstance(s,dict):
  result={}
  for k,v in s.items():
   if k=='clockTransfers':continue
   if k=='sliceBytes' and isinstance(v,dict):
    assert set(v)=={str(i) for i in range(160)} and all(type(v[str(i)]) is int and 0<=v[str(i)]<=255 for i in range(160))
    v=[v[str(i)] for i in range(160)]
   result[k]=logical(v)
  return result
 if isinstance(s,list):return [logical(v) for v in s]
 return s
eq(sha(H/'fulltrace/capture.json'),'3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649','authenticated H4 capture')
a=json.loads((H/'fulltrace/capture.json').read_bytes());b=json.loads((R/'guest/capture.json').read_bytes());e=json.loads((R/'exit.json').read_bytes())
eq(e['exitCode'],0,'completed child');eq(e['timedOut'],False,'bounded child');eq(b['source']['revision'],'7df84bc2c367aff1cadec7cecdde69cf0e904ace','frozen candidate')
for field in ['reset','final','checkpoints','settled','ramSha256','resumes']:
 eq(logical(b[field]),logical(a[field]),'full logical invariant '+field)
eq(b['closed'],{'native':True,'board':True,'worker':True},'closed all owners')
eq(b['ramSha256'],'7aecf019a32f109760267d6ac1c60ef3d8793661910226cca3bcf5661189c38d','whole RAM')
tracecount=0
if label=='fulltrace-on':
 eq(sha(H/'fulltrace.stderr'),'1df0b89f1b99a25729adbf193bf86f0fb2b8618ab22b13915d2f050e7e668a51','authenticated H4 raw trace')
 def rows(p):
  with p.open('rb') as f:
   for line in f:
    if line.startswith(b'BWSD1\t'):yield line
    elif b'BWSD1' in line:raise AssertionError('malformed trace fragment')
 for aa,bb in itertools.zip_longest(rows(H/'fulltrace.stderr'),rows(R/'stderr')):
  eq(aa,bb,'every canonical row '+str(tracecount));tracecount+=1
 eq(tracecount,1649067,'full row census');eq(b['journal'],a['journal'],'full logical journal metadata');eq(sha(R/'guest/callbacks.jsonl'),a['journal']['sha256'],'full expanded ordered bf12 journal')
else:
 eq(b['journal']['rows'],0,'capture off rows');eq((R/'guest/callbacks.jsonl').stat().st_size,0,'capture off actual bytes')
physical=b['final']['clockTransfers'];eq(int(physical['words']),201366,'all native N and Q tape words')
assert 0<int(physical['commits'])<=int(physical['transfers']);checks+=1
result={'status':'ROOT_ABI3_FULL_CANONICAL_AND_LOGICAL_PARITY_PASS' if label=='fulltrace-on' else 'ROOT_ABI3_CAPTURE_OFF_LOGICAL_SNAPSHOT_PARITY_PASS_NOT_FULL_TRACE','checks':checks,'canonicalNativeRows':tracecount,'captureSha256':sha(R/'guest/capture.json'),'orderedJournalSha256':sha(R/'guest/callbacks.jsonl'),'ramSha256':b['ramSha256'],'clockTransfers':physical,'resumes':b['resumes'],'snapshotProjection':'only new physical clockTransfers field removed and indexed-object sliceBytes bijectively converted to exact160-byte array; every original CPU/cache/segment/debug/system/logical callback counter/slice and six whole-board snapshots exact','scope':'fixed free protected-mode ROM; no native broad-guest or throughput qualification'}
(R/'root-parity.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
