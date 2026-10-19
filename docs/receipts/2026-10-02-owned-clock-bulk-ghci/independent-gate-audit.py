from pathlib import Path
import json,hashlib,subprocess,math,tarfile
P=Path(__file__).resolve().parent;F=P/'files';G=F/'owned-bulk-gate/gate';R=G/'results';load=lambda p:json.loads(p.read_bytes());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();a=load(G/'approved-bindings.json');s=load(R/'summary.json');plan=load(G/'plan.json');ref=load(G/'reference.json');checks=0
def ck(v):
 global checks
 assert v;checks+=1
def eq(x,y):
 ck(type(x)==type(y))
 if isinstance(x,dict):
  ck(x.keys()==y.keys())
  for k in x:eq(x[k],y[k])
 elif isinstance(x,list):
  ck(len(x)==len(y))
  for v,w in zip(x,y):eq(v,w)
 else:ck(x==y)
ck(sha(P/'artifact.zip')=='18ecd75342d8d2c6d417f6412cd349043682a8ffe4d2a3628aae4270c7c9a6f9')
ck(load(R/'auth-before.json')==load(R/'auth-after.json'));ck(load(R/'auth-before.json')['artifacts']==a['artifactHashes']);ck(len(a['artifactHashes'])==997)
hashes={sha(p) for p in F.rglob('*')if p.is_file()}
for archive in F.rglob('*.tar.gz'):
 with tarfile.open(archive) as tar:
  for member in tar:
   if member.isfile():hashes.add(hashlib.sha256(tar.extractfile(member).read()).hexdigest())
repo=Path('/tmp/bw-board-386-bulk-context-fix-20261002');workflow='edca15eea1414baf04f36d66a13444654163eb44'
for p,h in a['artifactHashes'].items():
 if h not in hashes:
  marker='/publication/';ck(marker in p);rel=p.split(marker,1)[1];ck(hashlib.sha256(subprocess.check_output(['git','show',workflow+':'+rel],cwd=repo)).hexdigest()==h)
 else:ck(True)
for name,h in a['helperHashes'].items():ck(sha(G/name)==h)
for arm,root in [('BASE',Path('/tmp/bw-board-386-native-owned-in8-r3-20261002')),('BULK',Path('/tmp/bw-board-386-owned-clock-bulk-source-20261002'))]:
 src=a['baselineSource' if arm=='BASE' else 'candidateSource'];ck(len(src['hashes'])==(103 if arm=='BASE' else 106))
 for p,h in src['hashes'].items():ck(sha(root/p)==h);ck(hashlib.sha256(subprocess.check_output(['git','show',src['revision']+':'+p],cwd=root)).hexdigest()==h)
ck(len(s['records'])==18);expected=[(i,arm)for i,order in enumerate(plan['samples']['pairOrder'])for arm in order.split(',')];ck([(r['pair'],r['arm'])for r in s['records']]==expected)
for record in s['records']:
 pair,arm=record['pair'],record['arm'];D=R/(str(pair)+'-'+arm);C=D/'guest/capture.json';c=load(C);i=load(R/(str(pair)+'-'+arm+'.input.json'));e=load(D/'child.exit.json');ck(sha(C)==record['captureSha256']);ck(sha(R/(str(pair)+'-'+arm+'.input.json'))==record['inputSha256']);eq(e,record['exit']);ck(e['returncode']==0 and e['signal'] is None and not e['timedOut'] and not e['fileLimitReached'] and e['error'] is None);ck(e['RLIMIT_CPU']==120 and e['RLIMIT_FSIZE']==268435456 and e['heapMiB']==512 and e['niceIncrement']==10);ck(all(v==''for v in e['blankEnvironment'].values()));ck(sha(D/'child.stderr')==e['stderrSha256'] and (D/'child.stderr').stat().st_size==e['stderrBytes']);ck(i['hostJournal'] is False and i['nativeTrace'] is False and len(i)==12);ck(c['source']==a['baselineSource' if arm=='BASE' else 'candidateSource'])
 if arm=='BASE':eq(c['provenance'],a['currentCompiledProof'])
 else:
  ck(c['provenance']['compiled']['revision']==a['baselineSource']['revision']);eq(c['provenance']['compiled']['hashes'],a['baselineSource']['hashes']);eq(c['provenance']['runtime'],a['candidateSource']);eq(c['provenance']['compiled']['proof'],a['currentCompiledProof'])
 for k in ['reset','final','checkpoints','settled','ramSha256','resetWitness','ramCanonicalSha256','in8Witness','resumes','terminal','closed']:eq(c[k],ref[k])
 ck(c['resumes']==445 and len(c['checkpoints'])==6 and c['journal']['rows']==0 and (D/'guest/callbacks.jsonl').stat().st_size==0);ck([len(c['final'][k])for k in ['state','extra','segments','system','debug']]==[20,20,90,30,6]);ck(c['ramSha256']=='ecb57a4b83090fcf232c4bd2f7019cdfde992bdc8ecf708e04bdc1de9272733a');ck(c['ramCanonicalSha256']=='588f9bfd1292b8405d0e42552147fb2d8d082a8253b52771291ca0a603eaf18f');cpu=c['timing']['executionCPU'];ck(cpu['unit']=='microseconds');ck(all(type(cpu[k])is int and cpu[k]>=0 for k in ['user','system','total']));ck(cpu['total']==cpu['user']+cpu['system']==record['executionCpuTotalUs'] and cpu['total']>0);ck(record['warmup']==(pair<2));ck(c['timing']['executionNs']==record['executionNs']);ck(c['addon']['sha256']=='8d9c83fcc3c42c2c94d17782ae42c152c52fcb2e833c31decc4bfee2af5aa841')
series={arm:[r['executionCpuTotalUs']for r in s['records']if r['arm']==arm and r['pair']>=2]for arm in ['BASE','BULK']};ck(series==s['samplesUs']);means={k:sum(v)/7 for k,v in series.items()};eq(means,s['meansUs']);reduction=100*(1-means['BULK']/means['BASE']);ck(reduction==s['meanReductionPercent']);favorable=[b<a for a,b in zip(series['BASE'],series['BULK'])];ck(favorable==s['favorablePairs']);ck(s['gatePassed']is False and not(reduction>=10 and all(favorable)));ck(s['status']=='ACTUAL_BULK_PROCESS_CPU_GATE_FAIL_KEEP_FE1');ck(sha(G/'plan.json')==s['planSha256']=='45e270b2e00399d06888579cd6701ace9592542a3972d20636e36dcb4e11e921')
context=F/'owned-bulk-context/context.txt';text=context.read_text();ck('AMD EPYC 7763 64-Core Processor' in text and 'CONTEXT_MISSING_OR_UNREADABLE /sys/fs/cgroup/cpu.max' in text);ck(workflow in text)
out={'status':'PASS_INDEPENDENT_ACTUAL_HOSTED_GATE_AUDIT_GATE_FAILED_KEEP_FE1','checks':checks,'run':37019813658,'workflowHead':workflow,'records':18,'discardedWarmupChildren':4,'measuredPairs':7,'artifactPins':997,'meansUs':means,'meanReductionPercent':reduction,'favorablePairs':favorable,'gatePassed':False,'summarySha256':sha(R/'summary.json'),'hardwareContextSha256':sha(context),'hardware':'AMD EPYC 7763;4 logical CPUs; explicit optional cgroup v2 missing marker retained','scope':'All18 entire stored166 states/descriptors/counters/boards/reset/final/sixcuts/settled/raw+canonicalRAM/445resumes exact same-fixture reference; compiledfe1/103 distinct runtime7b/106; all-thread process.cpuUsage arithmetic and four warmup exclusion. Workflowsuccess is not performance gate success; no adoption, cumulative speedup, retry, or broader guest qualification.'};target=P/'independent-gate-audit.json';assert not target.exists();target.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
