import json,pathlib,hashlib,subprocess
P=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h2-cost-pairs-20261001');W=pathlib.Path('/tmp/bw-board-386-native-hot-napi-profile-20261001');B=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h2-20261001');T=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h2-20261001/bochs');n=0
sha=lambda b:hashlib.sha256(b).hexdigest()
def check(x,msg):
 global n
 assert x,msg;n+=1
def load(p):return json.loads(p.read_bytes())
s=load(P/'summary.json');ref=load(pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));a=load(B/'build-static-preflight.json');m=load(B/'prepare.json')
check(sha((B/'prepare.json').read_bytes())==a['manifestSha256'],'manifest hash')
for filename,key in [('bw_direct.node','addonSha256'),('config.h','configSha256'),('cpu/bw_slice_runtime.inc','runtimeSha256'),('bochs-cpu3-native-direct-board/abi.h','headerSha256'),('bochs-cpu3-native-direct-board-adapter/napi.cc','napiSha256')]:check(sha((T/filename).read_bytes())==a[key],filename)
for p,h in m['sourceHashes'].items():
 check(sha((W/p).read_bytes())==h,'live compiled '+p);check(sha(subprocess.check_output(['git','show',a['sourceRevision']+':'+p],cwd=W))==h,'historical '+p)
for p,h in m['patchedHashes'].items():check(sha((T.parent/p).read_bytes())==h,'patched '+p)
keys=['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed'];profiles=[]
for item in s['samples']:
 stem=P/f"{item['index']}-{item['profile']}";raw=(stem/'capture.json').read_bytes();r=json.loads(raw);check(sha(raw)==item['captureSha256'],'capture digest')
 for k in keys:check(r[k]==ref[k],'full reference '+k)
 check(r['captureModes']=={'nativeRawTrace':False,'hostCompactSink':False},'modes');check(r['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'no journal')
 for p,h in r['source']['hashes'].items():check(sha((W/p).read_bytes())==h,'live measured '+p);check(sha(subprocess.check_output(['git','show',r['source']['revision']+':'+p],cwd=W))==h,'historical measured '+p)
 ex=load(pathlib.Path(str(stem)+'.exit.json'));check(ex['returncode']==0 and not ex['timedOut'] and not ex['fileLimitReached'] and ex['error'] is None,'child containment')
 for suffix,v in load(pathlib.Path(str(stem)+'.artifacts.json')).items():
  b=pathlib.Path(str(stem)+suffix).read_bytes();check(len(b)==v['bytes'] and sha(b)==v['sha256'],'raw artifact')
 rows=[x.split('\t') for x in pathlib.Path(str(stem)+'.stderr').read_text().splitlines() if x.startswith('BWNP1\t')]
 if not item['profile']:check(not rows,'disabled no diagnostics');continue
 check(len(rows)==17 and rows[0]==['BWNP1','HEADER','1','nanoseconds','resume-only'],'complete header')
 c=list(map(int,rows[1][2:]));check(c==[439,209839,1,0,1428373,0,0,0],'control exact')
 d={x[2]:tuple(map(int,x[3:])) for x in rows[2:]};check(len(d)==15,'unique buckets')
 for v in d.values():check(v[0]>=0 and 0<=v[2]<=v[1],'bucket domains')
 ops=['scalar_native_tick','scalar_quantum','scalar_pio','scalar_ack'];ph=['scalar_arguments_scopes','scalar_op_call','scalar_return_validation','scalar_mapping_call','scalar_mapping_fields','scalar_scope_close']
 check(sum(d[x][0] for x in ops)==d['scalar_whole'][0],'op count');check(sum(d[x][1] for x in ops)==d['scalar_whole'][1],'op duration');check(sum(d[x][1] for x in ph)==d['scalar_whole'][1],'phase duration')
 check(d['scalar_mapping_call'][0]==201367,'mapping count');check(d['memory_whole'][0]==8438 and d['page_whole'][0]==8,'memory page count')
 residual=d['native_resume_inclusive'][1]-sum(d[x][1] for x in ['scalar_whole','memory_whole','page_whole']);check(residual>=0 and str(residual)==item['costSplit']['residualResumeNs'],'residual containment')
 profiles.append({'index':item['index'],'residualNs':residual,'mappingCallNs':d['scalar_mapping_call'][1],'mappingFieldsNs':d['scalar_mapping_fields'][1]})
check(not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip(),'clean source')
result={'status':'INDEPENDENT_H2_ACTUAL_EVIDENCE_PASS','checks':n,'summarySha256':sha((P/'summary.json').read_bytes()),'compiledSourceInputs':len(m['sourceHashes']),'patchedInputs':len(m['patchedHashes']),'profiles':profiles,'limits':'No guest/build executed; checks read retained actual artifacts. Residual includes unclassified bridge/instrumentation, not pure native core.'}
pathlib.Path(__file__).with_name('audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
