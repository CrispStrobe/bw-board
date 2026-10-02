from pathlib import Path
import json,hashlib,zipfile,tarfile,subprocess
D=Path(__file__).resolve().parent;F=D/'files';G=F/'owned-dispatch-gate';P=G/'gate';R=P/'results';checks=0
h=lambda b:hashlib.sha256(b).hexdigest()
def check(x,label):
 global checks
 checks+=1
 assert x,label
j=lambda p:json.loads(p.read_bytes())
a=j(P/'approved-bindings.json');s=j(R/'summary.json');plan=j(P/'plan.json');ref=j(P/'reference.json')
check(h((D/'official-artifact.zip').read_bytes())=='73b99f1a5328707e3a613570f588548d66057fb6f4ff6f309d87660a3eb3c5d8','official ZIP')
run=j(D/'run.json');check(run['head_sha']=='7a24f7d4f1057e5e9523d0f2f23d426bb3b40476' and run['conclusion']=='success' and run['run_attempt']==1,'run metadata')
with zipfile.ZipFile(D/'official-artifact.zip') as z:
 check(len(z.infolist())==1131,'ZIP entries')
 for i in z.infolist():
  check(not i.filename.startswith('/') and '..' not in Path(i.filename).parts,'safe ZIP path')
  if not i.is_dir():check((F/i.filename).read_bytes()==z.read(i),'extracted ZIP exact '+i.filename)
# Authenticate every artifact against actual uploaded bytes; hidden original prepared files are sourced from retained TAR.
byhash={}
for p in F.rglob('*'):
 if p.is_file():byhash.setdefault(h(p.read_bytes()),[]).append(str(p))
tarhash={}
for p in F.rglob('*.tar.gz'):
 with tarfile.open(p) as t:
  for m in t:
   if m.isfile():tarhash.setdefault(h(t.extractfile(m).read()),[]).append((str(p),m.name))
missing=[];tarbound=[]
for p,sha in a['artifactHashes'].items():
 if sha in byhash:check(True,'artifact '+p)
 else:
  check(sha in tarhash,'artifact retained TAR '+p);tarbound.append({'originalPath':p,'sha256':sha,'retainedMembers':tarhash[sha]})
check(j(R/'auth-before.json')==j(R/'auth-after.json'),'pre/post authentication')
check(j(R/'auth-before.json')['artifacts']==a['artifactHashes'],'artifact map exact')
for arm,key in [('BASE','baselineSource'),('DISPATCH','candidateSource')]:
 src=a[key];root=Path(a[arm.lower()+'Worktree'] if arm=='BASE' else a['candidateWorktree']) if False else Path('/tmp/bw-board-386-native-owned-in8-r3-20261002' if arm=='BASE' else '/tmp/bw-board-386-owned-dispatch-runtime-20261002')
 check(len(src['hashes'])==(103 if arm=='BASE' else 112),'source count')
 for p,sha in src['hashes'].items():check(h(subprocess.check_output(['git','show',src['revision']+':'+p],cwd=root))==sha,'frozen Git source '+p)
for p,sha in a['helperHashes'].items():check(h((P/p).read_bytes())==sha,'gate helper '+p)
records=s['records'];check(len(records)==18,'18 children');series={'BASE':[],'DISPATCH':[]}
for index,rec in enumerate(records):
 pair=index//2;arm=plan['samples']['pairOrder'][pair].split(',')[index%2];check(rec['pair']==pair and rec['arm']==arm and rec['warmup']==(pair<2),'fixed alternating order')
 stem=R/(str(pair)+'-'+arm);capPath=stem/'guest/capture.json';c=j(capPath);inp=R/(str(pair)+'-'+arm+'.input.json');v=j(inp);e=j(stem/'child.exit.json')
 check(h(capPath.read_bytes())==rec['captureSha256'] and h(inp.read_bytes())==rec['inputSha256'],'record input/capture SHA')
 check(e==rec['exit'] and e['returncode']==0 and e['signal'] is None and not e['timedOut'] and not e['fileLimitReached'] and e['error'] is None,'bounded actual exit')
 check(h((stem/'child.stderr').read_bytes())==e['stderrSha256'] and (stem/'child.stderr').stat().st_size==e['stderrBytes'],'stderr exact')
 check(e['RLIMIT_CPU']==120 and e['heapMiB']==512 and e['RLIMIT_FSIZE']==268435456 and e['niceIncrement']==10 and all(x=='' for x in e['blankEnvironment'].values()),'bounds/environment')
 check(v['nativeTrace'] is False and v['hostJournal'] is False and len(v)==12,'CAPOFF input')
 check(c['source']==a['baselineSource' if arm=='BASE' else 'candidateSource'],'capture actual source')
 check(c['provenance']==a['currentCompiledProof' if arm=='BASE' else 'currentCandidateProvenance'],'capture complete provenance')
 for k in ['reset','final','checkpoints','settled','ramSha256','resetWitness','ramCanonicalSha256','in8Witness','resumes','terminal','closed']:check(c[k]==ref[k],'whole semantic '+k)
 check(c['resumes']==445 and len(c['checkpoints'])==6 and c['journal']['rows']==0 and (stem/'guest/callbacks.jsonl').stat().st_size==0,'445/six/empty journal')
 cpu=c['timing']['executionCPU'];check(cpu['unit']=='microseconds' and all(type(cpu[k]) is int and cpu[k]>=0 for k in ['user','system','total']) and cpu['total']==cpu['user']+cpu['system']>0,'raw CPU sum')
 check(rec['executionCpuTotalUs']==cpu['total'] and rec['executionNs']==c['timing']['executionNs'],'record raw timing')
 if pair>=2:series[arm].append(cpu['total'])
means={k:sum(v)/7 for k,v in series.items()};reduction=100*(1-means['DISPATCH']/means['BASE']);fav=[x<y for x,y in zip(series['DISPATCH'],series['BASE'])]
check(series==s['samplesUs'] and means==s['meansUs'] and reduction==s['meanReductionPercent'] and fav==s['favorablePairs'],'independent arithmetic')
check(not s['gatePassed'] and not(reduction>=10 and all(fav)) and s['status']=='ACTUAL_DISPATCH_PROCESS_CPU_GATE_FAIL_KEEP_FE1','honest gate FAIL')
context=(F/'owned-dispatch-context/context.txt').read_text();check('Model name' in context,'actual CPU context')
result={'status':'PASS_INDEPENDENT_ACTUAL_18_DISPATCH_GATE_AUDIT_GATE_FAIL_KEEP_FE1','checks':checks,'samplesUs':series,'meansUs':means,'meanReductionPercent':reduction,'favorablePairs':fav,'favorableCount':sum(fav),'gatePassed':False,'tarAuthenticatedMissingUploadFiles':tarbound,'artifactCount':len(a['artifactHashes']),'hardwareContextSha256':h(context.encode()),'scope':'All18 recorded full semantic fields including stored166-word snapshots/boards/raw+canonical RAM/physical counters, exact provenance, source Git records and process CPU. Source creates full snapshots each445 resumes; report retains reset/final/six cuts. No execution/retry/adoption or cumulative speed claim.'}
out=D/'independent-actual-audit.json';assert not out.exists();out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='tarAuthenticatedMissingUploadFiles'}));print('receiptSHA',h(out.read_bytes()))
