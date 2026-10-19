import json,hashlib,pathlib,subprocess
P=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h2-cost-pairs-20261001'); W=pathlib.Path('/tmp/bw-board-386-native-hot-napi-profile-20261001'); O=pathlib.Path(__file__).parent
checks=0; bindings={}
def check(v,m):
 global checks
 checks+=1
 if not v: raise AssertionError(m)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text())
def bind(p): bindings[str(p)]={'bytes':p.stat().st_size,'sha256':sha(p)}
s=read(P/'summary.json');bind(P/'summary.json');check(len(s['samples'])==6,'six actual children')
refp=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json');ref=read(refp);bind(refp)
manp=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h2-20261001/prepare.json');man=read(manp);bind(manp)
check(len(man['sourceHashes'])==30,'compiled 30')
for name,h in man['sourceHashes'].items():
 check(sha(W/name)==h,'current '+name)
 historical=subprocess.check_output(['git','show','d074466f7b077cbe6c8ad57a80d309761a958ee1:'+name],cwd=W)
 check(hashlib.sha256(historical).hexdigest()==h,'historical '+name)
check(read(P/'source-after.json')['compiled30']==man['sourceHashes'],'source after')
check(read(P/'helper-auth.json')['sha256']==sha(P/'run.py'),'actual helper');bind(P/'run.py')
rows=[]
for sample in s['samples']:
 stem=P/f"{sample['index']}-{sample['profile']}";cp=stem/'capture.json';c=read(cp);e=read(pathlib.Path(str(stem)+'.exit.json'));a=read(pathlib.Path(str(stem)+'.artifacts.json'))
 check(sha(cp)==sample['captureSha256'],'capture hash');bind(cp)
 for f in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']: check(c[f]==ref[f],'full parity '+f)
 check(c['source']==sample['source'] and c['source']['revision']=='d074466f7b077cbe6c8ad57a80d309761a958ee1','actual source')
 for name,h in c['source']['hashes'].items(): check(sha(W/name)==h,'actual closure '+name)
 check(len(c['source']['hashes'])==55,'55 source closure')
 addon=pathlib.Path(c['addon']['path']);check(sha(addon)==c['addon']['sha256']=='791774c572e0b170b66f1eaa26145da2cf9505060939631ac4395ee760f5fb65','actual binary')
 check(e['returncode']==0 and not e['timedOut'] and not e['fileLimitReached'] and e['error'] is None,'child success')
 check(c['captureModes']=={'nativeRawTrace':False,'hostCompactSink':False},'no tracing')
 check(c['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'no journal')
 check(sample['executionNs']==c['timing']['executionNs']==read(stem/'timing.json')['executionNs'],'actual timer')
 for suffix in ['.stdout','.stderr']:
  file=pathlib.Path(str(stem)+suffix);check(a[suffix]=={'bytes':file.stat().st_size,'sha256':sha(file)},'artifact binding');bind(file)
 raw=pathlib.Path(str(stem)+'.stderr').read_text()
 check(sample['stderrSha256']==sha(pathlib.Path(str(stem)+'.stderr')) and sample['stderrBytes']==len(raw.encode()),'stderr sample')
 if not sample['profile']: check('BWNP1' not in raw,'disabled output');continue
 lines=[l.split('\t') for l in raw.splitlines() if l.startswith('BWNP1\t')];check(len(lines)==17,'17 rows')
 check(lines[0]==['BWNP1','HEADER','1','nanoseconds','resume-only'],'header')
 names=['successfulResumes','callbackCalls','maxCallbackDepth','nestedCallbacks','clockReads','liveCallbackDepth','overflow','clockRegression'];ctrl=dict(zip(names,map(int,lines[1][2:])));check(ctrl==dict(zip(names,[439,209839,1,0,1428373,0,0,0])),'full census')
 b={r[2]:dict(zip(['count','totalNs','maxNs'],map(int,r[3:]))) for r in lines[2:]};check(len(b)==15,'15 buckets')
 for v in b.values():check(0<=v['maxNs']<=v['totalNs'],'time domain')
 phases=['scalar_arguments_scopes','scalar_op_call','scalar_return_validation','scalar_mapping_call','scalar_mapping_fields','scalar_scope_close'];ops=['scalar_native_tick','scalar_quantum','scalar_pio','scalar_ack']
 check(sum(b[n]['totalNs'] for n in phases)==b['scalar_whole']['totalNs'],'phase partition')
 for field in ['count','totalNs']:check(sum(b[n][field] for n in ops)==b['scalar_whole'][field],'operation partition '+field)
 check(4*439+7*201393-26+2*(8438+8)==ctrl['clockReads'],'clock formula')
 for n,count in [('native_resume_inclusive',439),('resume_return_conversion',439),('scalar_whole',201393),('scalar_native_tick',100684),('scalar_quantum',100682),('scalar_pio',26),('scalar_ack',1),('scalar_mapping_call',201367),('memory_whole',8438),('page_whole',8)]:check(b[n]['count']==count,'bucket '+n)
 residual=b['native_resume_inclusive']['totalNs']-sum(b[n]['totalNs'] for n in ['scalar_whole','memory_whole','page_whole']);check(residual>=0,'contained callbacks')
 cost=sample['costSplit'];check({k:int(v) for k,v in cost['control'].items()}==ctrl,'parser controls');check({k:{x:int(y) for x,y in v.items()} for k,v in cost['buckets'].items()}==b,'parser buckets');check(int(cost['residualResumeNs'])==residual and cost['qualification'] is False,'diagnostic only')
 rows.append({'pair':sample['index'],'executionNs':sample['executionNs'],'buckets':b,'residualResumeNs':residual})
bind(addon);bind(pathlib.Path(__file__))
out={'status':'ROOT_H2_ACTUAL_ARTIFACT_AND_COST_PARTITION_AUDIT_PASS','checks':checks,'sourceRevision':'d074466f7b077cbe6c8ad57a80d309761a958ee1','bindings':bindings,'profiledRows':rows,'qualification':False,'scope':'Full native H1 invariants preserved; diagnostic overlap and instrumentation/shared-host overhead remain. Residual is not pure Bochs. No speedup or physical RTx established.'}
(O/'receipt.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'status':out['status'],'checks':checks}))
