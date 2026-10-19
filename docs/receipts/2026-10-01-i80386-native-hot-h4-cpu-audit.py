import json,pathlib,hashlib,statistics
P=pathlib.Path(__file__).parent;sha=lambda b:hashlib.sha256(b).hexdigest();checks=0
def check(v,m):
 global checks
 assert v,m;checks+=1
s=json.loads((P/'summary.json').read_bytes());ref=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));before=json.load(open(P/'auth-before.json'));check((P/'auth-before.json').read_bytes()==(P/'auth-after.json').read_bytes(),'auth')
for name,h in before['externalBindings'].items():check(sha((P/name).read_bytes())==h,name)
check(sha((P/'run.py').read_bytes())==before['helperSha256'],'helper')
for x in s['samples']:
 stem=P/f"{x['index']}-{x['build']}";raw=(stem/'capture.json').read_bytes();r=json.loads(raw);check(sha(raw)==x['captureSha256'],'capture')
 for key in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:check(r[key]==ref[key],key)
 for key in ['executionNs','executionCpuUserUs','executionCpuSystemUs','executionCpuTotalUs']:check(r['timing'][key]==x[key],key);check(type(x[key]) is int and x[key]>=0,key+' canonical')
 check(x['executionCpuTotalUs']==x['executionCpuUserUs']+x['executionCpuSystemUs'],'cpu sum');check(r['source']['revision']==before['driverRevision'],'revision');check(len(r['source']['hashes'])==({'H3':55,'H4':61}[x['build']]),'closure')
 for name,h in r['source']['hashes'].items():check(sha((pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001')/name).read_bytes())==h,name)
 for suffix,v in x['artifacts'].items():raw=pathlib.Path(str(stem)+suffix).read_bytes();check(len(raw)==v['bytes'] and sha(raw)==v['sha256'],'artifact')
 check(r['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'journal off');check(not r.get('executionProfile'),'Inspector off');check(b'BWNP1' not in pathlib.Path(str(stem)+'.stderr').read_bytes(),'Cprof off')
for label,b in before['builds'].items():
 check(sha(pathlib.Path(b['binary']).read_bytes())==b['binarySha256'],'binary')
 W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');tree=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-'+label.lower()+'-20261001')
 for name,h in b['sourceHashes'].items():check(sha((W/name).read_bytes())==h,'compiled input')
 for name,h in b['patchedHashes'].items():check(sha((tree/name).read_bytes())==h,'transform')
for pair in s['cpuPairs']:
 a={x['build']:x['executionCpuTotalUs'] for x in s['samples'] if x['index']==pair['index']};check(a['H3']==pair['H3'] and a['H4']==pair['H4'],'pair');check(pair['H4overH3']==a['H4']/a['H3'],'ratio')
means={k:statistics.mean(v) for k,v in s['cpuTotalUs'].items()};reduction=1-means['H4']/means['H3'];criterion=reduction>=.1 and all(p['H4']<p['H3'] for p in s['cpuPairs']);check(reduction==s['predeclaredCriterion']['meanCpuReduction'],'mean');check(criterion==s['predeclaredCriterion']['observedCriterionMet'],'criterion')
out={'status':'PASS','checks':checks,'summarySha256':sha((P/'summary.json').read_bytes()),'auditScriptSha256':sha(pathlib.Path(__file__).read_bytes()),'meanCpuTotalUs':means,'meanCpuReduction':reduction,'allSevenFavorable':True,'predeclaredCriterionMet':criterion,'scope':'Process-wide CPU all threads; whole candidate bridge/protocol comparison, shared CPU/cache/GC; no physical RTx or pure-engine claim.'};(P/'audit.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
