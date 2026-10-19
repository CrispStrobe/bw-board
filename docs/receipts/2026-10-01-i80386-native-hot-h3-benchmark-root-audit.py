import pathlib,json,hashlib,statistics
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-property-keys-20261001');n=0
def check(v,label):
 global n
 n+=1
 if not v:raise AssertionError(label)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
s=read(P/'summary.json');check(len(s['samples'])==18,'18 fresh processes');ref=read(pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'))
check(read(P/'build-bindings-before.json')==read(P/'build-bindings-after.json'),'both build bindings unchanged');bindings=read(P/'build-bindings-before.json')
for build,b in bindings.items():
 check(sha(pathlib.Path(b['binaryPath']))==b['binarySha256'],'actual '+build+' binary')
 for name,h in b['sourceHashes'].items():check(sha(W/name)==h,'compiled '+build+name)
for x in s['samples']:
 stem=P/f"{x['index']}-{x['profile']}"; c=read(stem/'capture.json');e=read(pathlib.Path(str(stem)+'.exit.json'));inp=read(pathlib.Path(str(stem)+'.input.json'))
 check(x['build'].lower()==('h3' if x['profile'] else 'h2'),'legacy selector interpretation');check(x['warmup']==(x['index']<2),'two discarded warmup pairs')
 check(sha(stem/'capture.json')==x['captureSha256'],'capture hash')
 for field in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:check(c[field]==ref[field],'full H1 invariants '+field)
 check(c['source']==x['source'] and c['source']['revision']=='a645480594a9bc20a4046619745bb85e57abacd0','same actual driver')
 for name,h in c['source']['hashes'].items():check(sha(W/name)==h,'driver closure '+name)
 check(len(c['source']['hashes'])==55,'source55')
 check(c['addon']['sha256']==bindings[x['build'].lower()]['binarySha256'],'actual selected addon')
 check(inp['nativeTrace'] is False and inp['hostJournal'] is False and inp['profile'] is False,'all profiling and tracing OFF')
 check(c['captureModes']=={'nativeRawTrace':False,'hostCompactSink':False},'actual tracing disabled')
 check(e['returncode']==0 and not e['timedOut'] and not e['fileLimitReached'] and e['error'] is None,'actual child completion')
 raw=pathlib.Path(str(stem)+'.stderr');check(sha(raw)==x['stderrSha256'] and raw.stat().st_size==x['stderrBytes'],'actual stderr');check(b'BWNP1' not in raw.read_bytes(),'native C profiler disabled')
 check(c['timing']['executionNs']==x['executionNs']==read(stem/'timing.json')['executionNs'],'actual execution timing')
 check(c['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'no journal')
check(read(P/'helper-auth.json')['sha256']==sha(P/'run.py'),'measured helper binding')
measured=[x for x in s['samples'] if not x['warmup']];distributions={}
for build in ['h2','h3']:
 values=[x['executionNs'] for x in measured if x['build'].lower()==build];check(len(values)==7,'seven '+build);distributions[build]={'minNs':min(values),'medianNs':statistics.median(values),'maxNs':max(values)}
pairs=[]
for index in range(2,9):
 pair={x['build'].lower():x['executionNs'] for x in measured if x['index']==index};check(len(pair)==2,'pair');pairs.append({'index':index,**pair,'h3OverH2':pair['h3']/pair['h2']})
output={'status':'ROOT_H2_H3_BENCHMARK_ARTIFACT_AND_FULL_INVARIANT_AUDIT_PASS','checks':n,'summarySha256':sha(P/'summary.json'),'helperSha256':sha(P/'run.py'),'driverRevision':'a645480594a9bc20a4046619745bb85e57abacd0','actualChildren':18,'discardedWarmupPairs':2,'measuredPairs':7,'distributions':distributions,'pairs':pairs,'medianTimeReductionPercent':100*(1-distributions['h3']['medianNs']/distributions['h2']['medianNs']),'lowerH3Pairs':sum(x['h3']<x['h2'] for x in pairs),'medianPairedH3OverH2':statistics.median(x['h3OverH2'] for x in pairs),'legacyAnnotation':'The original sample.profile flag selects H3 rather than enabling profiling; every child input.profile and BW_HOT_NAPI_PROFILE were disabled. Original summary.scope has copied H2 three-profiler-pairs wording; this receipt describes seven measured OFF H2/H3 pairs. Original evidence remains unchanged.','scope':'Whole adapter execution includes per-resume key allocation/close and returned snapshots, not cold setup/settlement/serialization. Shared VPS and fresh-process JIT variation remain; no physical RTx, 10x gain or general workload claim.'}
(P/'root-audit.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps({k:v for k,v in output.items() if k not in ['pairs','legacyAnnotation','scope']}))
