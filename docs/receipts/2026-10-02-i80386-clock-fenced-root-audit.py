import pathlib,json,hashlib,subprocess
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-clock-batch-witness-20261002');sha=lambda b:hashlib.sha256(b).hexdigest();checks=0

def check(v,label):
 global checks
 assert v,label;checks+=1
A=json.loads((P/'approved-bindings.json').read_bytes());before=json.loads((P/'auth-before.json').read_bytes());check((P/'auth-before.json').read_bytes()==(P/'auth-after.json').read_bytes(),'auth unchanged');check(sha((P/'approved-bindings.json').read_bytes())==before['approvedSha256'],'approved bytes');check(sha((P/'run.py').read_bytes())==A['helperSha256'],'root actual helper');check(sha(pathlib.Path(A['addonPath']).read_bytes())==A['addonSha256'],'actual H4 addon');check(sha(pathlib.Path(A['manifestPath']).read_bytes())==A['manifestSha256'],'held H4 manifest')
for path,h in A['newSourceHashes'].items():check(sha((W/path).read_bytes())==h,'new source '+path)
for path,h in before['compiledSourceHashes'].items():check(sha((W/path).read_bytes())==h,'compiled source '+path)
for path,h in before['transformHashes'].items():check(sha((pathlib.Path(A['tree'])/path).read_bytes())==h,'transform '+path)
for path,h in before['preparedFileHashes'].items():check(sha((pathlib.Path(A['tree'])/path).read_bytes())==h,'actual compiled '+path)
check(subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==A['driverRevision'],'held driver revision');check(not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip(),'driver clean')
comparison=json.loads((P/'comparison.json').read_bytes());check(json.loads((P/'parent.stdout').read_bytes())==comparison,'actual parent accepted complete comparison');check((P/'parent.stderr').stat().st_size==0,'parent no errors');check(comparison['canonicalRows']==1649067,'root actual complete canonical rows');check(comparison['compiledSourceRevision']=='15631beb63d7c1f17e693de7c86d4ed37b96a768' and comparison['driverRevision']==A['driverRevision'],'separate measured source revisions')
for name,inp in comparison['actualInputHashes'].items():
 with pathlib.Path(inp['path']).open('rb') as f:check(hashlib.file_digest(f,'sha256').hexdigest()==inp['sha256'],'actual '+name)
cap=json.loads((P/'fenced/capture.json').read_bytes());refpath=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json');check(sha(refpath.read_bytes())=='3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649','reference SHA');ref=json.loads(refpath.read_bytes())
for field in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed','journal']:check(cap[field]==ref[field],'full invariant '+field)
check(len(cap['source']['hashes'])==67,'actual 67 driver inputs')
for path,h in cap['source']['hashes'].items():check(sha((W/path).read_bytes())==h,'actual driver input '+path);check(sha(subprocess.check_output(['git','show',A['driverRevision']+':'+path],cwd=W))==h,'historical driver input '+path)
rows=[json.loads(line) for line in (P/'fenced/fences.jsonl').read_text().splitlines()];check(len(rows)==1326,'actual fence census');phasecounts={};active=None;resumes=0;previous=None;inspections=[]
for i,row in enumerate(rows):
 check(row['ordinal']==i+1,'fence ordinal');phase=row['phase'];phasecounts[phase]=phasecounts.get(phase,0)+1
 for key in ['resume','hostOrdinal','n','q','cycles','debt','deadline','epoch','a20','nativeN','nativeQ']:check(type(row[key]) is int and row[key]>=0,'safe unsigned '+key)
 check(row['nativeN']==row['n'] and row['nativeQ']==row['q'],'native/board ledger');check(row['cycles']==4+6*row['q'],'successful clock ledger')
 if previous and phase!='return':check(row['hostOrdinal']==previous['hostOrdinal'] and row['n']==previous['n'] and row['q']==previous['q'],'only return advances callbacks')
 if phase=='entry':
  active=row;resumes+=1;check(row['resume']==resumes,'resume sequence');check(0<row['maxNative']<=600 and 0<row['maxQuanta']<=300,'independent caps');check(row['deadline']>row['debt'],'entry chips settled')
 elif phase=='return':
  check(active is not None and active['resume']==row['resume'],'paired return');check(row['chargedNativeTicks']==row['n']-active['n']<=active['maxNative'],'exact N charge');check(row['chargedQuanta']==row['q']-active['q']<=active['maxQuanta'],'exact Q charge');active=None
 elif phase=='inspect':inspections.append(row['q'])
 previous=row
check(resumes==cap['resumes']==439,'all 439 resumes');check(inspections==[c['q'] for c in cap['checkpoints']],'all six selected inspections');check(phasecounts=={'start':1,'stage-irq':439,'entry':439,'return':439,'inspect':6,'settle':1,'close':1},'complete phase census')
off=json.loads((P/'offline.stdout').read_bytes());ex=json.loads((P/'offline.exit.json').read_bytes());check(ex['exitCode']==0 and (P/'offline.stderr').stat().st_size==0,'actual offline completion');check(ex['stdoutSha256']==sha((P/'offline.stdout').read_bytes()),'actual offline output binding');check(off['canonicalRows']==1649067 and off['clocks']=={'nativeTicks':100684,'successfulQuanta':100682},'actual native clock census');check(off['fences']=={'resumes':439,'status':'OFFLINE_FENCES_PRESENT_NOT_BATCH_ADMISSION'},'actual fenced validator acceptance');check(off['inputs']==comparison['actualInputHashes'],'all offline inputs exactly bound')
out={'status':'ROOT_ACTUAL_FENCED_H4_AND_OFFLINE_VALIDATOR_PASS_NOT_BATCH_ADMISSION','checks':checks,'driverRevision':A['driverRevision'],'driverSourceInputs':67,'compiledSourceRevision':before['compiledSourceRevision'],'compiledSourceInputs':32,'transformInputs':12,'canonicalRowsComparedByActualRootParent':1649067,'fenceRows':len(rows),'phaseCounts':phasecounts,'comparisonSha256':sha((P/'comparison.json').read_bytes()),'offlineOutputSha256':sha((P/'offline.stdout').read_bytes()),'auditScriptSha256':sha(pathlib.Path(__file__).read_bytes()),'scope':'Diagnostic capture and offline chronology only; no native batch implementation or speed qualification'};(P/'root-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
