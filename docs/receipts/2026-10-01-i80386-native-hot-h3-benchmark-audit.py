import pathlib,json,hashlib,statistics,subprocess
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-property-keys-20261001');sha=lambda b:hashlib.sha256(b).hexdigest();s=json.loads((P/'summary.json').read_text());ref=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));n=0
def check(x,m):
 global n
 assert x,m;n+=1
check(len(s['samples'])==18,'18children')
for x in s['samples']:
 stem=P/f"{x['index']}-{x['profile']}";raw=(stem/'capture.json').read_bytes();r=json.loads(raw);check(sha(raw)==x['captureSha256'],'captureSHA');check(r['source']['revision']=='a645480594a9bc20a4046619745bb85e57abacd0','driver')
 for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:check(r[k]==ref[k],'reference '+k)
 for k,h in r['source']['hashes'].items():check(sha((W/k).read_bytes())==h,'current '+k)
 check(r['captureModes']=={'nativeRawTrace':False,'hostCompactSink':False},'no modes');check(r['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'no journal')
 ex=json.loads(pathlib.Path(str(stem)+'.exit.json').read_text());check(ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION' and not ex['fileLimitReached'] and not ex['timedOut'],'exit')
 for suffix,v in json.loads(pathlib.Path(str(stem)+'.artifacts.json').read_text()).items():
  b=pathlib.Path(str(stem)+suffix).read_bytes();check(len(b)==v['bytes'] and sha(b)==v['sha256'],'rawartifact')
 check(b'BWNP1' not in pathlib.Path(str(stem)+'.stderr').read_bytes(),'no profiler')
check(sha((P/'run.py').read_bytes())==json.loads((P/'helper-auth.json').read_text())['sha256'],'helper after')
check(json.loads((P/'build-bindings-before.json').read_text())==json.loads((P/'build-bindings-after.json').read_text()),'bindings beforeafter')
for label,b in json.loads((P/'build-bindings-after.json').read_text()).items():
 check(sha(pathlib.Path(b['binaryPath']).read_bytes())==b['binarySha256'],'binary after')
 for k,h in b['sourceHashes'].items():check(sha((W/k).read_bytes())==h,'compiled after')
rows=[]
for i in range(2,9):
 a=[x for x in s['samples'] if x['index']==i];h2=next(x for x in a if x['build']=='H2');h3=next(x for x in a if x['build']=='H3');rows.append({'pair':i-2,'order':['H2','H3'] if i%2==0 else ['H3','H2'],'h2ExecutionNs':h2['executionNs'],'h3ExecutionNs':h3['executionNs'],'h3OverH2':h3['executionNs']/h2['executionNs']})
d={}
for build in ['H2','H3']:
 v=[x['executionNs'] for x in s['samples'] if x['build']==build and not x['warmup']];d[build]={'samples':len(v),'minNs':min(v),'medianNs':statistics.median(v),'maxNs':max(v),'allNs':v}
out={'status':'SEVEN_H2_H3_ACTUAL_NO_PROFILE_PAIRS_PASS','checks':n,'summarySha256':sha((P/'summary.json').read_bytes()),'pairs':rows,'distributions':d,'scope':'Freshprocess wholeadapter execution includes keysetup/close, callbacks, scheduler and return conversion; sharedhost and coldJIT; no purecore or physicalRTx claim'};(P/'audit.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
