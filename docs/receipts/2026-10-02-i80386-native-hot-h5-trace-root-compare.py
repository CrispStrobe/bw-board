import pathlib,json,hashlib,itertools
P=pathlib.Path(__file__).parent;H=P.parent/'native-hot-h1-regularfile-pair-20261001';checks=0

def check(v,label):
 global checks
 checks+=1
 if not v:raise AssertionError(label)
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def rows(p):
 with p.open('rb') as f:
  for line in f:
   if line.startswith(b'BWSD1\t'):yield line
   else:
    if b'BWSD1' in line:raise AssertionError('malformed native trace marker fragment')
check(sha(H/'on.stderr')=='21ea17d068097696c3bf3c991cfdead2f236a833319a563747cabc66f7488308','bound historical trace');check(sha(P/'fulltrace.stderr')==json.loads((P/'fulltrace-comparison.json').read_bytes())['stderrSha256'],'actual H5 trace metadata')
count=0
for a,b in itertools.zip_longest(rows(H/'on.stderr'),rows(P/'fulltrace.stderr')):check(a==b,'exact trace row '+str(count));count+=1
check(count==1649067,'complete native row census')
check(sha(P/'fulltrace/callbacks.jsonl')==sha(H/'on/callbacks.jsonl')=='bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1','whole ordered journal exact')
a=json.loads((H/'on/capture.json').read_text());b=json.loads((P/'fulltrace/capture.json').read_text())
for field in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed','journal']:check(a[field]==b[field],'full invariant '+field)
e=json.loads((P/'fulltrace.exit.json').read_text());check(e['returncode']==0 and not e['timedOut'] and not e['fileLimitReached'],'actual normal completion');check(b['source']['revision']=='ef106b4ae3a2ca55e9cc3253597ec66773e07847' and b['addon']['sha256']=='c52943191195faae07107049dcea594f8e35451cff6d7aa0cafc485886895fc0','actual source/binary')
out={'status':'ROOT_H5_FULL_CANONICAL_NATIVE_TRACE_AND_HOST_JOURNAL_EXACT_H1_PASS','checks':checks,'canonicalNativeRows':count,'h5TraceSha256':sha(P/'fulltrace.stderr'),'h5CaptureSha256':sha(P/'fulltrace/capture.json'),'orderedJournalSha256':sha(P/'fulltrace/callbacks.jsonl'),'projection':'Every BWSD1 field and ordering exact; only unstructured emulator preamble excluded. No ISA states or trace events masked.','scope':'Bounded free protected-mode workload; no broader guest admission or Windows/Doom qualification.'};(P/'root-trace-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
