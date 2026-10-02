from pathlib import Path
import json,hashlib,zipfile,subprocess
P=Path(__file__).parent; A=P/'artifact'; C=A/'_temp/owned-span-cpu'; G=C/'gate';R=G/'results'
load=lambda p:json.loads(Path(p).read_bytes())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
checks=0
def check(v):
 global checks
 assert v
 checks+=1
run=load(P/'run.json');meta=load(P/'artifacts.json')['artifacts'][0];ex=load(P/'extraction.json')
check(run['databaseId']==37061280177 and run['headSha']=='d48ba37f4b38784757275b28f26da71bb9113c11' and run['event']=='pull_request' and run['conclusion']=='success')
check(meta['id']==11250412021 and meta['digest']=='sha256:'+sha(P/'official-artifact.zip') and not meta['expired'])
with zipfile.ZipFile(P/'official-artifact.zip') as z:
 check(len(z.namelist())==len(set(z.namelist())))
 for n,v in ex['files'].items():
  b=z.read(n);check(len(b)==v['bytes'] and hashlib.sha256(b).hexdigest()==v['sha256'] and b==(A/n).read_bytes())
b=load(G/'approved-bindings.json');s=load(R/'summary.json');plan=load(G/'plan.json')
before=load(R/'auth-before.json');after=load(R/'auth-after.json');check(before==after)
check(before['sources']=={'BASE':b['baselineSource'],'SPAN':b['candidateSource']} and before['artifacts']==b['artifactHashes'] and before['helpers']==b['helperHashes'])
check(before['bindingSha256']==sha(G/'approved-bindings.json'))
src=load(C/'gate-source-before-after.json');check(src['publicationBefore']==src['publicationAfter'])
W=Path('/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-cpu-hosted-preparation-20261002')
for n,h in src['publicationBefore']['files'].items():
 check(hashlib.sha256(subprocess.check_output(['git','show',run['headSha']+':'+n],cwd=W)).hexdigest()==h)
 check(sha(A/'bw-board/bw-board'/n)==h)
reference=load('/mnt/volume1/tmp-astra/native-owned-in8-parity-r3-ci-20261002/fulltrace-on/guest/capture.json')
fields=['reset','final','checkpoints','settled','ramSha256','resetWitness','ramCanonicalSha256','in8Witness','resumes','terminal','closed']
check(len(s['records'])==18)
series={'BASE':[],'SPAN':[]}
for index,rec in enumerate(s['records']):
 pair=index//2;arm=plan['samples']['pairOrder'][pair].split(',')[index%2];stem=R/(str(pair)+'-'+arm)
 c=load(stem/'guest/capture.json');inp=load(R/(str(pair)+'-'+arm+'.input.json'));e=load(stem/'child.exit.json')
 check(rec['pair']==pair and rec['arm']==arm and rec['warmup']==(pair<2))
 check(sha(stem/'guest/capture.json')==rec['captureSha256'] and sha(R/(str(pair)+'-'+arm+'.input.json'))==rec['inputSha256'])
 check(e==rec['exit'] and e['returncode']==0 and not e['timedOut'] and e['signal'] is None and not e['fileLimitReached'] and e['error'] is None)
 check(e['RLIMIT_CPU']==120 and e['RLIMIT_FSIZE']==256<<20 and e['heapMiB']==512 and e['niceIncrement']==10 and set(e['blankEnvironment'].values())=={''})
 check((stem/'child.stderr').stat().st_size==e['stderrBytes'] and sha(stem/'child.stderr')==e['stderrSha256'])
 check(c['source']==b['baselineSource' if arm=='BASE' else 'candidateSource'])
 check(c['provenance']==b['currentCompiledProof' if arm=='BASE' else 'currentCandidateProvenance'])
 for k in fields:check(c[k]==reference[k])
 check(c['resumes']==445 and len(c['checkpoints'])==6 and c['journal']['rows']==0 and (stem/'guest/callbacks.jsonl').stat().st_size==0)
 for snap in [c['reset'],c['final'],*[x['native'] for x in c['checkpoints']]]:
  # Complete snapshot equality above includes architecture, descriptors and all physical counters.
  check(snap is not None)
 check(inp['nativeTrace'] is False and inp['hostJournal'] is False and inp['baselineSha256']=='bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e')
 cpu=c['timing']['executionCPU'];check(cpu['unit']=='microseconds' and all(type(cpu[k]) is int and cpu[k]>=0 for k in ['user','system','total']) and cpu['total']==cpu['user']+cpu['system']>0 and cpu['total']==rec['executionCpuTotalUs'])
 check(c['timing']['executionNs']==rec['executionNs'])
 if pair>=2:series[arm].append(cpu['total'])
means={k:sum(v)/7 for k,v in series.items()};reduction=100*(1-means['SPAN']/means['BASE']);favorable=[x<y for x,y in zip(series['SPAN'],series['BASE'])]
check(series==s['samplesUs'] and means==s['meansUs'] and reduction==s['meanReductionPercent'] and favorable==s['favorablePairs'])
check(not (reduction>=10 and all(favorable)) and s['gatePassed'] is False and s['status']=='ACTUAL_SPAN_PROCESS_CPU_GATE_FAIL_KEEP_FE1')
check(s['planSha256']==sha(G/'plan.json') and s['metric']==plan['metric'])
hardware=load(C/'hardware-context.json');check(hardware['node']=='v22.23.3' and 'AMD EPYC' in hardware['lscpu'])
out=P/'independent-actual-gate-audit.json';assert not out.exists()
out.write_text(json.dumps({'status':'PASS_INDEPENDENT_ACTUAL_18_SEMANTICS_CPU_GATE_FAIL_KEEP_FE1','checks':checks,'runId':run['databaseId'],'head':run['headSha'],'artifactId':meta['id'],'zipSha256':sha(P/'official-artifact.zip'),'meansUs':means,'meanReductionPercent':reduction,'favorablePairs':favorable,'measuredPairs':7,'discardedWarmupChildren':4,'all18FullSemanticParity':True,'scope':'Recorded pre/post source/artifact authentication plus genuine ZIP and exact full saved native/board/RAM parity. No new guest, no speed adoption; only fixed fixture and execution window.'},indent=2)+'\n')
print(out)
