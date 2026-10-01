import pathlib,json,hashlib,subprocess,statistics
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');sha=lambda b:hashlib.sha256(b).hexdigest();n=0;cache={}
def check(x,msg):
 global n
 assert x,msg;n+=1
def historical(rev,path):
 key=(rev,path)
 if key not in cache:cache[key]=sha(subprocess.check_output(['git','show',rev+':'+path],cwd=W))
 return cache[key]
s=json.load(open(P/'summary.json'));auth=json.load(open(P/'auth-before.json'));check(auth==json.load(open(P/'auth-after.json')),'beforeafterbindings');check(auth['helperSha256']==sha((P/'run.py').read_bytes()),'helperafter');check(len(s['samples'])==18,'18actualchildren');ref=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'))
for build,b in auth['builds'].items():
 check(sha(pathlib.Path(b['binary']).read_bytes())==b['binarySha256'],'binaryafter')
 for k,h in b['sourceHashes'].items():check(sha((W/k).read_bytes())==h,'compiledcurrent');check(historical(b['historicalCompiledRevision'],k)==h,'compiledhistorical')
for x in s['samples']:
 stem=P/f"{x['index']}-{x['build']}";raw=(stem/'capture.json').read_bytes();r=json.loads(raw);inp=json.load(open(P/f"{x['index']}-{x['build']}.input.json"));check(sha(raw)==x['captureSha256'],'captureSHA');check(not x['cProfilerEnabled'] and inp['profile'] is False and inp['nativeTrace'] is False and inp['hostJournal'] is False,'modesOFF');check(x['source']==r['source'],'sourceMirror');check(len(r['source']['hashes'])==(55 if x['build']=='H3' else 61),'driverclosureCount')
 for k,h in r['source']['hashes'].items():check(sha((W/k).read_bytes())==h,'currentdriver');check(historical(r['source']['revision'],k)==h,'historicaldriver')
 for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:check(r[k]==ref[k],'H1invariant '+k)
 check(r['addon']['sha256']==auth['builds'][x['build']]['binarySha256'],'actualbuild');check(r['timing']['executionNs']==x['executionNs'],'timingMirror');check(r['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'noJournal')
 ex=json.load(open(pathlib.Path(str(stem)+'.exit.json')));check(ex['returncode']==0 and not ex['timedOut'] and not ex['fileLimitReached'],'exit')
 for suffix,a in x['artifacts'].items():
  b=pathlib.Path(str(stem)+suffix).read_bytes();check(len(b)==a['bytes'] and sha(b)==a['sha256'],'artifact')
 check(b'BWNP1' not in pathlib.Path(str(stem)+'.stderr').read_bytes(),'noCprofile')
check(not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip(),'clean')
out={'status':'H3_H4_ACTUAL_EIGHTEEN_CHILDREN_INDEPENDENT_PASS','checks':n,'summarySha256':sha((P/'summary.json').read_bytes()),'distributions':s['distributions'],'pairs':s['pairs'],'medianH4ReductionPercent':100*(1-s['distributions']['H4']['medianNs']/s['distributions']['H3']['medianNs']),'scope':s['scope']};(P/'audit.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
