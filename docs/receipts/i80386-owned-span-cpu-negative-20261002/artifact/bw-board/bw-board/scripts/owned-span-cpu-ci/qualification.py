"""Fixed reviewed actual qualification artifact download/admission, never native execution."""
from pathlib import Path,PurePosixPath
import json,hashlib,subprocess,zipfile,stat
P=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def validate_binding(q):
 assert q['status']=='ROOT_AND_PEER_THREE_SPAN_NATIVE_CELLS_PASS'
 assert q['runId']==37056398077 and q['artifactId']==11248833105 and q['head']=='80d228ee5452f380655a16c4bc823beb76e781c1'
 assert q['zipSha256']=='7cae79af646feba252df601a811098a92614cc334a8a29b0d90d5d51d552f41e' and q['zipBytes']==44331598
 assert set(q['modes'])=={'smoke-off','fulltrace-on','trace-fast'}
 expected={'smoke-off':'SPAN_CAPTURE_OFF_EXACT_PARITY_PASS_NOT_SPEED_GATE','fulltrace-on':'SPAN_CAPTURE_ON_EXACT_PARITY_PASS','trace-fast':'SPAN_FULL_CANONICAL_TRACE_NULLSINK_PARITY_PASS'}
 reviews={}
 for name,h in q['externalReviews'].items():
  path=P/'qualification-reviews'/name;assert sha(path)==h;reviews[name]=json.loads(path.read_bytes())
 root=reviews[q['rootAudit']];core=reviews[q['coreAudit']];peer=reviews[q['peerAudit']]
 assert core['status']=='PASS_INDEPENDENT_ACTUAL_HOSTED_SPAN_THREE_CELL_CORE_PARITY_PENDING_PROVENANCE_ADDENDUM'
 assert root['status']=='ROOT_ACTUAL_HOSTED_SPAN_OFFICIAL_ZIP_STREAM_AND_RECORDED_CLOSURE_PASS'
 assert peer['status']=='PASS_INDEPENDENT_ACTUAL_HOSTED_SPAN_THREE_CELL_COMPLETE_PROVENANCE_AND_PARITY'
 assert peer['coreParityReceiptSha256']==q['externalReviews'][q['coreAudit']]
 for r in [root,peer]:assert r['runId']==q['runId'] and r['artifactId']==q['artifactId'] and r['head']==q['head']
 for mode,record in q['modes'].items():
  assert record['expectedParity']['status']==expected[mode]
  for kind in ['input','parity','capture']:assert record[kind]in q['files']
  assert record['journal']in q['streamAnchors']
  assert q['files'][record['capture']]['sha256']==record['expectedParity']['captureSha256']
  assert q['streamAnchors'][record['journal']]['sha256']==record['expectedParity']['journalSha256']
  c=next(x for x in core['cells']if x['mode']==mode);assert c['stateParity']and c['captureSha256']==record['expectedParity']['captureSha256']and c['journalSha256']==record['expectedParity']['journalSha256']and c['canonicalRows']==record['expectedParity']['canonicalRows']
 return reviews
def admit(context):
 q=json.loads((P/'qualification-template.json').read_bytes());validate_binding(q)
 assert type(q['artifactId'])is int and type(q['runId'])is int and q['head']=='80d228ee5452f380655a16c4bc823beb76e781c1'
 assert len(q['zipSha256'])==64 and len(q['files'])>0
 metadata=context/'qualification-artifact-metadata.json';archive=context/'qualification.zip'
 with metadata.open('xb')as out:subprocess.run(['gh','api',f"/repos/CrispStrobe/bw-board/actions/artifacts/{q['artifactId']}"],stdout=out,check=True,timeout=60)
 m=json.loads(metadata.read_bytes());assert m['id']==q['artifactId'] and not m['expired'] and m['workflow_run']['id']==q['runId'] and m['workflow_run']['head_sha']==q['head'] and m['digest']=='sha256:'+q['zipSha256']
 with archive.open('xb')as out:subprocess.run(['gh','api',f"/repos/CrispStrobe/bw-board/actions/artifacts/{q['artifactId']}/zip"],stdout=out,check=True,timeout=120)
 assert archive.stat().st_size==q['zipBytes'] and m['size_in_bytes']==q['zipBytes']
 assert sha(archive)==q['zipSha256'];destination=context/'qualification';destination.mkdir()
 with zipfile.ZipFile(archive)as z:
  names=set();total=0
  for item in z.infolist():
   path=PurePosixPath(item.filename);assert not path.is_absolute() and '..'not in path.parts and '\\'not in item.filename and item.filename not in names;names.add(item.filename);kind=(item.external_attr>>16)&0o170000;assert kind in [0,stat.S_IFREG,stat.S_IFDIR];assert item.file_size<=256<<20;total+=item.file_size;assert total<=1<<30
   if item.is_dir():continue
   assert item.filename in q['streamAnchors'];anchor=q['streamAnchors'][item.filename];assert item.file_size==anchor['bytes']
   digest=hashlib.sha256();size=0;lines=0
   target=destination/path if item.filename in q['files'] else None
   if target:assert item.file_size<=16<<20;target.parent.mkdir(parents=True,exist_ok=True)
   output=target.open('xb')if target else None
   try:
    with z.open(item)as source:
     for block in iter(lambda:source.read(1<<20),b''):
      digest.update(block);size+=len(block)
      if item.filename.endswith('/guest/callbacks.jsonl'):lines+=block.count(b'\n')
      if output:output.write(block)
   finally:
    if output:output.close()
   assert size==anchor['bytes']and digest.hexdigest()==anchor['sha256']
   if item.filename.endswith('/guest/callbacks.jsonl'):
    proof=destination/(item.filename+'.stream-proof.json');proof.parent.mkdir(parents=True,exist_ok=True);proof.write_text(json.dumps({'sha256':digest.hexdigest(),'bytes':size,'rows':lines,'originZIP':q['zipSha256'],'originMember':item.filename,'scope':'Verified streaming original member; raw stream retained externally, not reuploaded.'},indent=2)+'\n')
  assert set(q['streamAnchors'])<=names
 for name,record in q['files'].items():assert sha(destination/name)==record['sha256'] and (destination/name).stat().st_size==record['bytes']
 reviews={}
 for name,h in q['externalReviews'].items():
  path=P/'qualification-reviews'/name;assert sha(path)==h;reviews[name]=json.loads(path.read_bytes())
 root=reviews[q['rootAudit']];core=reviews[q['coreAudit']];peer=reviews[q['peerAudit']]
 assert root['status']=='ROOT_ACTUAL_HOSTED_SPAN_OFFICIAL_ZIP_STREAM_AND_RECORDED_CLOSURE_PASS'
 assert peer['status']=='PASS_INDEPENDENT_ACTUAL_HOSTED_SPAN_THREE_CELL_COMPLETE_PROVENANCE_AND_PARITY'
 assert core['status']=='PASS_INDEPENDENT_ACTUAL_HOSTED_SPAN_THREE_CELL_CORE_PARITY_PENDING_PROVENANCE_ADDENDUM'
 assert peer['coreParityReceiptSha256']==q['externalReviews'][q['coreAudit']]
 for x in [root,peer]:assert x['runId']==q['runId'] and x['artifactId']==q['artifactId'] and x['head']==q['head']
 for mode in ['smoke-off','fulltrace-on','trace-fast']:
  binding=q['modes'][mode];proof=json.loads((destination/binding['parity']).read_bytes());assert proof==binding['expectedParity'];assert proof['sourceRevision']=='bbf2a73e3d9090e73fe7037f4b8dbd4f6248aaa1'
  actual=next(x for x in core['cells']if x['mode']==mode);assert actual['stateParity'] and actual['captureSha256']==proof['captureSha256'] and actual['journalSha256']==proof['journalSha256'] and actual['canonicalRows']==proof['canonicalRows']
 (context/'qualification-admitted.json').write_text(json.dumps({'status':'GENUINE_ROOT_AND_PEER_THREE_CELL_QUALIFICATION_ADMITTED','binding':q,'metadataSha256':sha(metadata),'zipSha256':sha(archive),'files':q['files']},indent=2)+'\n')
 return q,destination
