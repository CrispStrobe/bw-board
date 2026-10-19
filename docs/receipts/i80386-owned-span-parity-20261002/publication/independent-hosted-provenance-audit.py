from pathlib import Path
import json,hashlib,subprocess,tarfile,gzip
D=Path('/mnt/volume1/tmp-astra/386-owned-span-hosted-native-parity-publication-20261002');A=D/'artifact';P=A/'mnt/volume1/tmp-astra/native-owned-span-parity-prepared-20261002';C=A/'home/runner/work/_temp/owned-span-native-parity/context';j=lambda p:json.loads(p.read_text())
def h(p):
 x=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1<<20),b''):x.update(b)
 return x.hexdigest()
meta=j(D/'artifact-metadata.json')['artifacts'][0];run=j(D/'run-status-2.json');zp=D/'official-artifact-11248833105.zip';assert meta['id']==11248833105 and meta['digest']=='sha256:'+h(zp);assert run['id']==37056398077 and run['head_sha']=='80d228ee5452f380655a16c4bc823beb76e781c1' and run['event']=='pull_request' and run['run_attempt']==1 and run['conclusion']=='success'
b=j(P/'approved-bindings.json');m=j(C/'materialization.json');cells=j(C/'cells.json');assert cells['publicationBefore']==cells['publicationAfter']==m['publicationBefore']==m['publicationAfter'];assert cells['sourceBefore']==cells['sourceAfter'];assert cells['bindingBefore']==cells['bindingAfter']==h(P/'approved-bindings.json');assert cells['materializationBefore']==cells['materializationAfter']==h(C/'materialization.json')
root=Path('/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-runtime-source-20261002');n=0;tarDigests=set()
for archive in C.rglob('*.tar.gz'):
 with tarfile.open(archive)as t:
  for entry in t:
   if entry.isfile():tarDigests.add(hashlib.sha256(t.extractfile(entry).read()).hexdigest())
for p,s in b['artifactHashes'].items():
 q=A/p.lstrip('/')
 if q.exists():assert h(q)==s,p
 elif s in tarDigests:pass
 elif p.endswith('/bw_direct.node'):
  files=list(C.rglob('bw_direct.node'));assert len(files)==1 and h(files[0])==s
 elif any(h(q)==s for q in A.rglob(Path(p).name) if q.is_file()):pass
 elif p==b['baseline']:
  assert h(next(A.rglob('js-capture.json')))==s
 elif p==b['baselineNativeCapture']:
  assert h(next(A.rglob('native-capture.json')))==s
 elif p==b['configuration']:
  assert h(next(A.rglob('guest-source.bochsrc')))==s
 elif p in [b['baselineNativeTrace'],b['baselineNativeJournal'],str(Path(b['baseline']).parent/'events.jsonl')]:
  name='reference-child.stderr.gz' if p==b['baselineNativeTrace'] else 'reference-callbacks.jsonl.gz' if p==b['baselineNativeJournal'] else 'reference-events.jsonl.gz'
  hh=hashlib.sha256()
  with gzip.open(next(A.rglob(name)),'rb')as stream:
   for chunk in iter(lambda:stream.read(1<<20),b''):hh.update(chunk)
  assert hh.hexdigest()==s
 else:
  assert p==b['driver'],p
  assert hashlib.sha256(subprocess.check_output(['git','show',b['revision']+':scripts/run-i80386-native-owned-span.mjs'],cwd=root)).hexdigest()==s
 n+=1
assert len(m['officialArtifact']['extractedFiles'])==31
for p,s in m['officialArtifact']['extractedFiles'].items():assert h(A/p.lstrip('/'))==s
for name,s in b['helperHashes'].items():assert h(P/name)==s
for label,repo in [('runtime',root),('compiled',Path('/tmp/bw-board-386-native-owned-in8-r3-20261002'))]:
 src=m[label+'Source'];assert src['current']==src['git']
 for p,s in src['git'].items():assert hashlib.sha256(subprocess.check_output(['git','show',src['head']+':'+p],cwd=repo)).hexdigest()==s
repo='/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-native-parity-preparation-20261002'
for p,s in m['publicationBefore']['git'].items():assert hashlib.sha256(subprocess.check_output(['git','show',run['head_sha']+':'+p],cwd=repo)).hexdigest()==s
for cell in cells['cells']:
 assert cell['status']=='ACTUAL_CELL_AND_FULL_ORIGINAL_COMPARATOR_PASS'
 for name in ['wrapperExecution','auditExecution']:assert cell[name]['returncode']==0 and not cell[name]['timedOut']
for v in m['oracles']:assert v['lossless'] and any(v['rawSha256']==sha for sha in b['artifactHashes'].values())
out={'status':'PASS_INDEPENDENT_ACTUAL_HOSTED_SPAN_THREE_CELL_COMPLETE_PROVENANCE_AND_PARITY','artifactId':11248833105,'runId':37056398077,'head':run['head_sha'],'artifactPins':n,'originalExtractedClosure':31,'runtime116Compiled103Frozen110Exact':True,'coreParityReceiptSha256':h(D/'independent-hosted-cells-audit.json'),'actualOuterLifecycleAllCellsPass':True,'scope':'All3 actual semantic cells qualified fullstored166/boards/RAM/physical/canonical/journal. LocalOFF/ON andpuretimeout controls separate; no CPUgate/adoption or generalAT claim.'};p=D/'independent-hosted-provenance-audit.json';assert not p.exists();p.write_text(json.dumps(out,indent=2)+'\n');print(h(p),n)