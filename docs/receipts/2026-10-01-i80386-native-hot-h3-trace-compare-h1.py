import pathlib,hashlib,json,itertools
P=pathlib.Path(__file__).parent;H=P.parent/'native-hot-h1-regularfile-pair-20261001'
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
assert digest(H/'on.stderr')=='21ea17d068097696c3bf3c991cfdead2f236a833319a563747cabc66f7488308'
def semantic(p):
 with p.open('rb') as f:
  for row in f:
   if row.startswith(b'BWSD1\t'):yield row
count=0
for a,b in itertools.zip_longest(semantic(H/'on.stderr'),semantic(P/'on.stderr')):
 assert a==b,('semantic row mismatch',count,a,b);count+=1
old=H/'on/callbacks.jsonl';new=P/'on/callbacks.jsonl';assert digest(old)==digest(new)
a=json.loads((H/'on/capture.json').read_text());b=json.loads((P/'on/capture.json').read_text())
for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed','journal']:assert a[k]==b[k],k
assert json.loads((P/'build-before.json').read_text())==json.loads((P/'build-after.json').read_text())
assert len(b['source']['hashes'])==55
report={'status':'H3_H1_ALL_CANONICAL_NATIVE_ROWS_AND_HOST_JOURNAL_EXACT_PASS','canonicalNativeRows':count,'projection':'only non-BWSD1 preamble ignored; every BWSD1 field/ordinal/order retained','h1TraceSha256':digest(H/'on.stderr'),'h3TraceSha256':digest(P/'on.stderr'),'compactJournalSha256':digest(new),'compactJournalBytes':new.stat().st_size,'captureSha256':digest(P/'on/capture.json'),'sourceRevision':b['source']['revision'],'sourceInputs':55,'compiledSourceInputs':34,'compiledTransformInputs':12,'compiledBeforeAfterExact':True,'snapshotBoardRamCounterFieldsExact':['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed','journal']}
(P/'h1-h3-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
