import pathlib,json,hashlib,subprocess
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-args-20261001');sha=lambda b:hashlib.sha256(b).hexdigest();checks=0

def check(value,label):
 global checks
 assert value,label;checks+=1
refpath=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json');refbytes=refpath.read_bytes();check(sha(refbytes)=='3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649','authenticated H4 semantic reference');ref=json.loads(refbytes)
summary=json.loads((P/'summary.json').read_bytes());check(summary['status']=='H5_ACTUAL_BASELINE_AND_HOSTILE_CONTROLS_PASS','summary status');check(len(summary['records'])==17,'17 controls')
before=json.loads((P/'auth-before.json').read_bytes());after=json.loads((P/'auth-after.json').read_bytes());check(before==after,'before after auth identity')
approved=json.loads((P/'approved-bindings.json').read_bytes());check(before['approvedSha256']==sha((P/'approved-bindings.json').read_bytes()),'actual approved binding');check(before['revision']=='ef106b4ae3a2ca55e9cc3253597ec66773e07847','held revision');check(len(before['compiledSourceHashes'])==37,'source count');check(len(before['transformHashes'])==12,'transform count')
for path,digest in before['compiledSourceHashes'].items():
 check(sha((W/path).read_bytes())==digest,'current '+path);check(sha(subprocess.check_output(['git','show',before['revision']+':'+path],cwd=W))==digest,'historical '+path)
for path,digest in before['preparedFiles'].items():check(sha((pathlib.Path(approved['tree'])/path).read_bytes())==digest,'prepared '+path)
for path,digest in before['transformHashes'].items():check(sha((pathlib.Path(approved['tree'])/path).read_bytes())==digest,'transform '+path)
check(sha(pathlib.Path(approved['addonPath']).read_bytes())==approved['addonSha256']==before['addonSha'],'actual addon')
for name,digest in before['helperHashes'].items():check(sha((P/name).read_bytes())==digest,'helper '+name)
keys=['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']
for record in summary['records']:
 name=record['control'];stem=P/name;ex=json.loads((P/(name+'.exit.json')).read_bytes());check(ex==record['exit'],name+' raw exit');check(not ex['timedOut'] and not ex['fileLimitReached'],name+' no caps');inp=json.loads((P/(name+'.input.json')).read_bytes());check(inp['profile']==False and inp['nativeTrace']==False and inp['hostJournal']==False,name+' capture modes');check(inp['addon']==approved['addonPath'] and inp['sha256']==approved['addonSha256'],name+' input addon')
 for suffix,artifact in record['artifacts'].items():
  raw=pathlib.Path(str(stem)+suffix).read_bytes();check(len(raw)==artifact['bytes'] and sha(raw)==artifact['sha256'],name+suffix+' exact bytes');check(len(raw)<268435456,name+suffix+' below output bound')
 events=[json.loads(line) for line in (stem/'control.jsonl').read_text().splitlines()];check(events==record['events'],name+' actual events');stderr=pathlib.Path(str(stem)+'.stderr').read_bytes();check(b'BWNP1' not in stderr,name+' no Cprof')
 if record['positive']:
  check(ex['returncode']==0 and ex['signal'] is None,name+' accepted exit');r=json.loads((stem/'capture.json').read_bytes())
  for key in keys:check(r[key]==ref[key],name+' full '+key)
  check(r['source']['revision']==before['revision'],name+' actual child revision')
  for path,digest in r['source']['hashes'].items():check(sha((W/path).read_bytes())==digest,name+' actual closure '+path)
  check(r['addon']['sha256']==approved['addonSha256'],name+' actual captured addon');check(r['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,name+' no host journal');check(b'BWSD1' not in stderr,name+' no raw native trace')
 else:
  check(ex['signal']==6 and stderr.count(b'BWSD1\tFAIL\tdirect-scalar-callback\n')==1,name+' exact fatal signature');check(not (stem/'capture.json').exists(),name+' no accepted completion')
  expected=['invalid-operation-value'] if name=='invalid-operation-value' else ['malformed-tuple-return'] if name.startswith('tuple-') else ['epoch-getter'];check([e['name'] for e in events]==expected,name+' no forbidden later getter')
 if name=='packed-argc':check(sorted((e['op'],e['argc']) for e in events)==[(1,1),(2,2),(3,4),(4,1)],'actual packed argc')
check(not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip(),'source remains clean')
out={'status':'ROOT_H5_ACTUAL_CONTROLS_PASS','checks':checks,'cases':17,'sourceRevision':before['revision'],'summarySha256':sha((P/'summary.json').read_bytes()),'approvedSha256':before['approvedSha256'],'referenceH4CaptureSha256':sha(refbytes),'scope':'Full exposed CPU/board/RAM accepted controls; exact contained fatal/error chronology on nine denials; test-only raw-loader internal argc observation'}
(P/'root-control-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
