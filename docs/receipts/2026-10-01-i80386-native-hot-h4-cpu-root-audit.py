import pathlib,json,hashlib,statistics
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');checks=0
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(v,l):
 global checks
 checks+=1
 if not v:raise AssertionError(l)
s=read(P/'summary.json');a=read(P/'auth-before.json');check(a==read(P/'auth-after.json'),'both compiled/helper/binary bindingmaps unchanged');check(a['helperSha256']==sha(P/'run.py'),'actual helper');check(len(s['samples'])==18,'18 actual children');ref=read(pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'))
for x in s['samples']:
 stem=P/f"{x['index']}-{x['build']}"; c=read(stem/'capture.json');e=read(pathlib.Path(str(stem)+'.exit.json'));inp=read(pathlib.Path(str(stem)+'.input.json'))
 check(sha(stem/'capture.json')==x['captureSha256'],'capture binding');check(x['warmup']==(x['index']<2),'discard warmup rule')
 check(not x['cProfilerEnabled'] and inp['profile'] is False and inp['nativeTrace'] is False and inp['hostJournal'] is False,'all tracing disabled')
 check(c['source']==x['source'] and c['source']['revision']=='15631beb63d7c1f17e693de7c86d4ed37b96a768','driver source identity')
 check(len(c['source']['hashes'])==(55 if x['build']=='H3' else 61),'explicit driver closures')
 for name,h in c['source']['hashes'].items():check(sha(W/name)==h,'current driver '+name)
 for field in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:check(c[field]==ref[field],'whole H1 state '+field)
 check(c['addon']['sha256']==a['builds'][x['build']]['binarySha256'],'actual selected binary');check(e['returncode']==0 and not e['timedOut'] and not e['fileLimitReached'],'normal contained completion')
 for suffix,rec in x['artifacts'].items():
  f=pathlib.Path(str(stem)+suffix);check(f.stat().st_size==rec['bytes'] and sha(f)==rec['sha256'],'artifact')
 check(b'BWNP1' not in pathlib.Path(str(stem)+'.stderr').read_bytes(),'no C timing');check(c['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'no journal');check(c['timing']['executionNs']==x['executionNs'],'execution timer')
for build,b in a['builds'].items():
 check(sha(pathlib.Path(b['binary']))==b['binarySha256'],'actual current binary '+build)
 for name,h in b['sourceHashes'].items():check(sha(W/name)==h,'compiled source '+build+name)
for x in s['samples']:
 c=read(P/f"{x['index']}-{x['build']}"/'capture.json'); timing=read(P/f"{x['index']}-{x['build']}"/'timing.json')
 for field in ['executionCpuUserUs','executionCpuSystemUs','executionCpuTotalUs']:
  check(type(x[field]) is int and x[field]>=0,'CPU metric domain');check(x[field]==c['timing'][field]==timing[field],'actual CPU metric mirror')
 check(x['executionCpuTotalUs']==x['executionCpuUserUs']+x['executionCpuSystemUs'],'user plus system')
for name,h in a['externalBindings'].items():check(sha(P/name)==h,'external helper after '+name)
for label,v in a['children'].items():check(sha(pathlib.Path(v['generatedPath']))==v['generatedSha256'],'derived child '+label);check(sha(W/v['originalPath'])==v['originalSha256'],'original child '+label)
measured=[x for x in s['samples'] if not x['warmup']];dist={}

for build in ['H3','H4']:
 values=[x['executionNs'] for x in measured if x['build']==build];check(len(values)==7,'seven pairs');d={'allNs':values,'minNs':min(values),'medianNs':statistics.median(values),'maxNs':max(values)};check(d==s['distributions'][build],'computed distribution');dist[build]=d
pairs=[]
for index in range(2,9):
 row={x['build']:x['executionNs'] for x in measured if x['index']==index};pairs.append({'index':index,**row,'H4overH3':row['H4']/row['H3']})
check(pairs==s['pairs'],'all paired ratios')
cpu={build:[x['executionCpuTotalUs'] for x in measured if x['build']==build] for build in ['H3','H4']};check(cpu==s['cpuTotalUs'],'computed CPU series')
reduction=1-statistics.mean(cpu['H4'])/statistics.mean(cpu['H3']);all_favorable=all(b<a for a,b in zip(cpu['H3'],cpu['H4']));criterion=s['predeclaredCriterion'];check(criterion['minimumMeanCpuReduction']==0.1 and criterion['allSevenPairsFavorableRequired'] is True,'unchanged predeclared criterion');check(reduction==criterion['meanCpuReduction'],'CPU reduction calculation');check(criterion['observedCriterionMet']==(reduction>=0.1 and all_favorable) is True,'actual gate pass')
out={'status':'ROOT_H3_H4_CPU_AND_WALL_BENCHMARK_FULL_INVARIANTS_AND_PREDECLARED_CPU_GATE_PASS','checks':checks,'summarySha256':sha(P/'summary.json'),'distributions':dist,'pairs':pairs,'cpuMeanUs':{k:statistics.mean(v) for k,v in cpu.items()},'meanCpuReductionPercent':100*reduction,'allSevenCpuPairsFavorable':all_favorable,'scope':'Process-wide execution CPU includes all active child threads and tiny measurement overhead. Whole H3/H4 candidate comparison meets predeclared CPU criterion, not isolated protocol/core, general applications, 10x or physical RTx. Historical noisy wall result remains inconclusive.'};(P/'root-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'status':out['status'],'checks':checks}))
