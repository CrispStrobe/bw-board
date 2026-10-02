import pathlib,json,hashlib,subprocess,itertools,collections
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-clock-batch-witness-20261002');checks=0
read=lambda p:json.loads(pathlib.Path(p).read_bytes())
def sha(p):
 with pathlib.Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def check(v,label):
 global checks
 assert v,label;checks+=1
A=read(P/'approved-bindings.json');B=read(P/'auth-before.json');C=read(P/'comparison.json');R=read(P/'fenced/capture.json');E=read(P/'fenced.exit.json');M=read(A['manifestPath']);tree=pathlib.Path(A['tree'])
check((P/'auth-before.json').read_bytes()==(P/'auth-after.json').read_bytes(),'beforeafter exact');check(sha(P/'approved-bindings.json')==B['approvedSha256'],'approved binding');check(sha(P/'run.py')==A['helperSha256']==B['helperSha256'],'parent binding');check(sha(A['manifestPath'])==A['manifestSha256']==B['manifestSha256'],'manifest');check(sha(A['addonPath'])==A['addonSha256']==B['addonSha256'],'binary')
check(M['boardRevision']=='15631beb63d7c1f17e693de7c86d4ed37b96a768','compiled held H4');check(A['driverRevision']==R['source']['revision']==C['driverRevision']=='2d1cf651d7d7d0dfda55b9df482cf0ec70d9187c','driver frozen');check(len(R['source']['hashes'])==67 and len(M['sourceHashes'])==32 and len(M['patchedHashes'])==12 and len(A['newSourceHashes'])==7,'separate inventories')
check(subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==A['driverRevision'],'current head');check(not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip(),'clean source')
for n,h in R['source']['hashes'].items():check(sha(W/n)==h,'driver file '+n);check(hashlib.sha256(subprocess.check_output(['git','show',A['driverRevision']+':'+n],cwd=W)).hexdigest()==h,'historical driver '+n)
for n,h in M['sourceHashes'].items():check(sha(W/n)==h,'compiled file '+n);check(hashlib.sha256(subprocess.check_output(['git','show',M['boardRevision']+':'+n],cwd=W)).hexdigest()==h,'historical compiled '+n)
for n,h in M['patchedHashes'].items():check(sha(tree/n)==h,'transformed '+n)
for n,h in A['preparedFileHashes'].items():check(sha(tree/n)==h,'actual compiled '+n)
for n,h in A['newSourceHashes'].items():check(R['source']['hashes'][n]==h,'new source closure '+n)
check(E['returncode']==0 and not E['timedOut'] and not E['fileLimitReached'] and E['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION','contained pass');check(E['stderrSha256']==sha(P/'fenced.stderr') and E['stderrBytes']==(P/'fenced.stderr').stat().st_size,'stderr binding');check(E['RLIMIT_FSIZE']==268435456 and E['heapMiB']==512,'bounded transport')
ref=read('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json')
for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed','journal']:check(R[k]==ref[k],'full reference '+k)
for v in C['actualInputHashes'].values():check(sha(v['path'])==v['sha256'],'actual input bound')
check(R['resumes']==439,'actual439 resumes');check(R['fenceCapture']==C['fenceCapture'],'fence metadata');check(sha(P/'fenced/fences.jsonl')==R['fenceCapture']['sha256'] and (P/'fenced/fences.jsonl').stat().st_size==R['fenceCapture']['bytes'],'fence bytes')
H=[json.loads(x) for x in (P/'fenced/callbacks.jsonl').read_text().splitlines()];F=[json.loads(x) for x in (P/'fenced/fences.jsonl').read_text().splitlines()];check(len(F)==1326==R['fenceCapture']['rows'],'1326 fences');check(len(H)==R['journal']['rows'],'journal census')
for i,h in enumerate(H,1):check(h[0]==i,'host order')
expected=['start'];qtargets={x['resume']:x['q'] for x in R['checkpoints']}
for i in range(1,440):expected+=['stage-irq','entry','return']+(['inspect'] if i in qtargets else [])
expected+=['settle','close'];check([x['phase'] for x in F]==expected,'independent exact phase automaton')
prev=None;entry=None;returns=[];inspections=[]
for i,f in enumerate(F,1):
 check(f['ordinal']==i,'fence ordinal')
 for k in ['resume','hostOrdinal','n','q','cycles','debt','deadline','epoch','a20','nativeN','nativeQ']:check(type(f[k]) is int and 0<=f[k]<=9007199254740991,'safe domain '+k)
 check(f['n']==f['nativeN'] and f['q']==f['nativeQ'],'native board mirror');check(f['cycles']==4+6*f['q'],'independent Q cycles');check(f['n']<=160000 and f['q']<=150000 and f['a20'] in [0,1] and f['epoch']<=4294967295,'profile bounds')
 check(0<=f['hostOrdinal']<=len(H),'host ordinal bounds')
 h=H[f['hostOrdinal']-1] if f['hostOrdinal'] else [None]*4+[0,0,4]
 check([f['n'],f['q'],f['cycles']]==h[4:7],'host ledger mirror')
 if prev:check(f['hostOrdinal']>=prev['hostOrdinal'] and (f['phase']=='return' or f['hostOrdinal']==prev['hostOrdinal']),'callbacks only within resume')
 if f['phase']=='start':check(f['resume']==0 and f['hostOrdinal']==0 and f['debt']==0,'reset fence')
 if f['phase']=='stage-irq':check(f['resume']==len(returns),'stage resume')
 if f['phase']=='entry':
  entry=f;check(f['resume']==len(returns)+1,'entry resume');check(type(f['maxNative']) is int and f['maxNative']==600,'native requested cap');remaining=next((x['q']-f['q'] for x in R['checkpoints'] if x['q']>f['q']),300);check(f['maxQuanta']==min(300,remaining),'exact selected Q requested cap');check(f['deadline']>f['debt'],'settled entry horizon');check((f['deadline']-f['debt']+5)//6>0,'ceil horizon')
 if f['phase']=='return':
  check(f['resume']==entry['resume'],'return resume');dn=f['n']-entry['n'];dq=f['q']-entry['q'];check(0<=dn<=entry['maxNative'] and 0<=dq<=entry['maxQuanta'],'independent delta caps');check(f['chargedNativeTicks']==dn and f['chargedQuanta']==dq,'charged mirrors');check(f['reason'] in [1,2,3,4,6,7],'return reason');returns.append(f)
 if f['phase']=='inspect':check(f['q']==qtargets[f['resume']],'selected checkpoint Q');inspections.append(f['q'])
 if f['phase']=='close':check(f['debt']==0 and returns[-1]['reason']==4 and returns[-1]['chargedNativeTicks']==returns[-1]['chargedQuanta']==0,'terminal flush zero work')
 prev=f
check(inspections==[x['q'] for x in R['checkpoints']],'all inspection horizons');check(returns[-1]['n']==int(R['final']['nativeTicks']) and returns[-1]['q']==int(R['final']['successfulQuanta']),'final totals')
def canonical(p):
 with pathlib.Path(p).open('rb') as fd:
  for l in fd:
   if l.startswith(b'BWSD1\t'):yield l
   else:check(b'BWSD1' not in l,'malformed canonical fragment')
rows=0
for x,y in itertools.zip_longest(canonical(P/'fenced.stderr'),canonical('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/on.stderr')):check(x==y,'every canonical field/order');rows+=1
check(rows==1649067,'canonical census')
out={'status':'INDEPENDENT_ACTUAL_FENCED_H4_FULL_PARITY_AND_FENCE_INVARIANTS_PASS_NOT_BATCH_ADMISSION','checks':checks,'auditScriptSha256':sha(pathlib.Path(__file__)),'driverRevision':A['driverRevision'],'compiledSourceRevision':M['boardRevision'],'driverSourceInputs':67,'compiledSourceInputs':32,'transformInputs':12,'actualResumes':len(returns),'fenceRows':len(F),'canonicalNativeRows':rows,'fenceSha256':R['fenceCapture']['sha256'],'captureSha256':sha(P/'fenced/capture.json'),'scope':'Actual unchanged H4 diagnostic; no native batch implementation, legal span count or timing/performance qualification'};(P/'independent-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
