import sys
sys.dont_write_bytecode=True
import pathlib,json,zipfile,hashlib,statistics,math,subprocess,struct
O=pathlib.Path(__file__).parent;Z=None;H=lambda b:hashlib.sha256(b).hexdigest()
def hashfile(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
# Standalone independent JSON checks. No imports of repository code.
from types import SimpleNamespace
COMPILED='e4807d0647ab1e151755811ff8ef53d493ebf6ff'
BASE='plain-JS';CAND='compact-progress-batched';COMPARISON='plain-JS-v-compact-progress-batched'
GROUPS={'clockTransfers':{'transfers','commits','words'},'callbacks':{'physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'},'fallback':{'bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'},'execution':{'attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'},'bridgeClockEntryAttempts':{'unknown','INIT','ENTRY','MEMORY','PAGE','PRE_PIO','POST_PIO','ACK','FAULT','IRQ','HLT','RETURN'},'bridgeMemoryEntryAttempts':{'ordinaryRead','ordinaryWrite','fusedOuter'}}
ARRAYS={'state':20,'extra':20,'segments':90,'system':30,'debug':6}
def uint(v,maximum=2**53-1):
 assert type(v) is int and 0<=v<=maximum;return v
def decimal(v):
 if type(v) is str:
  assert v and v.isascii() and v.isdecimal() and (v=='0' or not v.startswith('0')) and len(v)<=16;v=int(v)
 return uint(v)
def raw166(n):
 out=[]
 for key,count in ARRAYS.items():
  assert type(n[key]) is list and len(n[key])==count
  out.extend(uint(v,2**32-1) for v in n[key])
 assert len(out)==166;return out
def inspection(n):
 assert set(n)==set(ARRAYS)|{'nativeTicks','successfulQuanta','mappingEpoch','boardA20'}|set(GROUPS)
 raw166(n);decimal(n['nativeTicks']);decimal(n['successfulQuanta']);assert n['mappingEpoch']==0 and type(n['mappingEpoch']) is int and n['boardA20']==1 and type(n['boardA20']) is int
 for name,keys in GROUPS.items():
  assert type(n[name]) is dict and set(n[name])==keys
  for value in n[name].values():
   if name.startswith('bridge'):assert type(value) is str
   decimal(value)
 assert all(decimal(v)==0 for v in n['fallback'].values())
 assert all(decimal(n['execution'][k])==0 for k in ('faults','irqDeliveries','haltIdleCuts'))
def ports(tape,native):
 assert type(tape) is list and len(tape)==16475;out=[]
 for index,e in enumerate(tape,1):
  q=decimal(e['successfulQuanta'])+1 if native else uint(e['q']);assert 1<=q<=316562
  assert type(e['ordinal']) is int and e['ordinal']==index and e['dir'] in ('in','out') and e.get('width',8)==8
  port=uint(e['port'],65535);value=uint(e['value'],255);assert type(e['cycles']) is int and e['cycles']==4+6*(q-1)
  if native:decimal(e['nativeTicks'])
  out.append((index,e['dir'],port,8,value,q,e['cycles']))
 return out
def schedule(name):
 assert name==COMPARISON
 return [{'pair':i,'phase':'warmup' if i<2 else 'measured','measuredPair':None if i<2 else i-2,'order':[BASE,CAND] if i%2==0 else [CAND,BASE]} for i in range(9)]
def slice_abi(last,cut):
 # Authenticated held combined slice ABI, not a CPU snapshot array.
 decoded=struct.unpack('<6I10QH2x13I',bytes(last['sliceBytes']))
 reason,requestedN,effectiveN,chargedN,requestedQ,chargedQ=decoded[:6]
 assert reason==last['reason']==1 and chargedN==last['chargedNativeTicks'] and chargedQ==last['chargedQuanta']
 assert requestedN==600 and 0<chargedN<=effectiveN<=requestedN and requestedQ==chargedQ==7
 assert decoded[6]==decimal(cut['nativeTicks']) and decoded[7]==decimal(cut['successfulQuanta'])
 for actual,key in zip(decoded[8:16],('attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts')):assert actual==decimal(cut['execution'][key])
 assert decoded[16]==cut['state'][13] and decoded[17]==cut['state'][8]
 assert decoded[18:22]==(0,0,0,0) # No pending fault, vector/error/CR2.
 assert decoded[22]==0 and decoded[23]==0 # Terminal budget return: no committed port/event.
 assert decoded[24] in (0,1) and decoded[25:27]==(0,0) # Pending host IRQ is separate from delivery.
 assert decoded[27]==((cut['state'][9]>>9)&1) and decoded[28]==last['activityState'] and decoded[29]==cut['extra'][18]
 return decoded
def validate_receipt(r,arm,data,b,capture):
 assert arm in (BASE,CAND) and r['input']==data and b['targetN']==b['targetQ']==316562 and capture['progress']['n']==capture['progress']['q']==316562
 native=arm==CAND;role=b['workers']['native' if native else 'plainJs'];identity={'revision':role['revision'],'hashes':role['files']}
 assert r['workerBefore' if native else 'sourceBefore']==r['workerAfter' if native else 'sourceAfter']==identity
 assert r['nodeSha256Before']==r['nodeSha256After']==b['node']['sha256']
 assert r['prerequisite']['bindingSha256']==role['files'][role['binding']] and r['prerequisite']['captureSha256']==b['capture']['sha256'] and r['prerequisite']['independentAuditSha256']==b['independentAudit']['sha256']
 if native:
  assert r['schema']=='bw.cold-native-compact-progress-performance.worker.v1' and r['status']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS' and data['mode']=='batched'
  for field,profile in [('State','bw.cold-native.copied-u32-state.v1'),('MemoryFusion','bw.cold-native.memory-clock-fusion.v1'),('Progress','bw.cold-native.compact-progress.v1')]:assert r['required'+field+'ExportProfile' if field!='MemoryFusion' else 'requiredMemoryFusionProfile']==r['admitted'+field+'ExportProfile' if field!='MemoryFusion' else 'admittedMemoryFusionProfile']==profile
  assert r['requiredScalarProviderProfile']=='bw.cold-native.memory-clock-fusion.ledger-scalars.v1' and r['scalarOverlay']=={'profile':r['requiredScalarProviderProfile'],'bindingSha256':role['files']['scripts/cold-native-compact-progress-performance/scalar-overlay.json']}
  assert r['typedSnapshotOwnership']=='RESET_STABLE_AND_REQUESTED_LAST_FINAL_INSPECT_DISTINCT'
  reset=r['reset']['native'];cut=r['lastResumeInspect'];final=r['finalNative']
  for n in (reset,cut,final):inspection(n)
  assert raw166(reset)==raw166(capture['cuts'][0]['native']) and raw166(cut)==raw166(final)==raw166(capture['cuts'][-1]['native'])
  last=r['lastReturnedProgress'];assert set(last)=={'sliceBytes','nativeTicks','successfulQuanta','reason','activityState','chargedNativeTicks','chargedQuanta','mappingEpoch','boardA20'}
  assert type(last['sliceBytes']) is list and len(last['sliceBytes'])==160
  for v in last['sliceBytes']:uint(v,255)
  slice_abi(last,cut)
  assert type(last['reason']) is int and last['reason'] in (1,3,7) and type(last['activityState']) is int and last['activityState']==0
  assert uint(last['chargedNativeTicks'],600)==r['progress']['dn'] and uint(last['chargedQuanta'],300)==r['progress']['dq']
  for key in ('nativeTicks','successfulQuanta','mappingEpoch','boardA20'):assert last[key]==cut[key]==final[key]
  assert decimal(final['nativeTicks'])==decimal(final['successfulQuanta'])==r['progress']['n']==r['progress']['q']==316562
  assert final['state'][13]==0xf000 and final['state'][8]==0xe16 and final['state'][10]==0x7ffffff0 and not final['state'][9]&0x200
  for key in ('bridgeClockEntryAttempts','bridgeMemoryEntryAttempts'):assert cut[key]==final[key]
  evidence=r['bridgeAttemptCounts'];assert set(evidence)=={'provider','reset','final','scope'}
  for long,short in [('bridgeClockEntryAttempts','clock'),('bridgeMemoryEntryAttempts','memory')]:
   assert evidence['reset'][short]==reset[long] and evidence['final'][short]==final[long]
   assert all(decimal(final[long][k])>=decimal(reset[long][k]) for k in reset[long])
  assert reset['bridgeClockEntryAttempts']=={k:str(int(k=='INIT')) for k in GROUPS['bridgeClockEntryAttempts']} and all(v=='0' for v in reset['bridgeMemoryEntryAttempts'].values())
  provider=evidence['provider'];assert set(provider)=={'memoryOuterEntries','replyValidations','readEffects','writeEffects'}
  for v in provider.values():uint(v)
  assert provider['memoryOuterEntries']==provider['replyValidations']==decimal(final['bridgeMemoryEntryAttempts']['fusedOuter'])==provider['readEffects']+provider['writeEffects']
  board=r['finalBoard'];assert board['state']['board']==capture['javascriptFinal']['board'] and board['ramSha256']==capture['javascriptFinal']['ramSha256']
  assert board['state']['nativeTicks']==board['state']['successfulQuanta']==316562 and board['state']['cold']['phase']=='complete' and r['closed']=={'native':True,'provider':True}
  assert r['compiledBefore']==r['compiledAfter']=={'revision':COMPILED,'hashes':b['compiledFiles']} and r['buildBefore']==r['buildAfter'] and r['buildBefore']['addonSha256']==b['nativeInput']['sha256']
  tape=r['ports'];timing=r['executionTiming']
 else:
  assert r['schema']=='bw.cold-plain-js.worker.v1' and r['status']=='PLAIN_JS_ARM_EXECUTION_AND_FINAL_PARITY_PASS'
  assert r['result']['final']==capture['javascriptFinal'] and r['result']['final']['cpu']['cycles']==316562 and r['result']['beforeSettle']['cpu']==capture['cuts'][-1]['javascript']['cpu']
  tape=r['result']['ports'];timing=r['result']['timing']
 assert ports(tape,native)==ports(capture['javascriptPorts'],False)
 cpu=timing['cpuMicroseconds'];assert set(cpu)=={'user','system'};micros=sum(uint(v,10**15) for v in cpu.values());assert micros>0
 ns=timing['wallNanoseconds'];assert type(ns) is str and ns.isascii() and ns.isdecimal() and not ns.startswith('0') and len(ns)<=20
 wall=int(ns)/1e9;assert 0<wall<=120;virtual=6*316562/6000000
 return {'cpuSeconds':micros/1e6,'cpuMicrosecondsSum':micros,'wallSeconds':wall,'configuredVirtualSeconds':virtual,'configuredVirtualRTx':virtual/wall}
def summary(name,pairs):
 assert name==COMPARISON and len(pairs)==9
 rows=[r for r in pairs if r['phase']=='measured'];assert len(rows)==7
 ratios=[];totals={BASE:0,CAND:0}
 for row in rows:
  a=row['arms'][BASE];c=row['arms'][CAND]
  for arm in (BASE,CAND):
   e=row['arms'][arm]['execution'];uint(e['cpuMicrosecondsSum'],10**15);assert e['cpuSeconds']==e['cpuMicrosecondsSum']/1e6;totals[arm]+=e['cpuMicrosecondsSum']
  ratios.append({'pair':row['measuredPair'],'executionCpuCandidateOverBaseline':c['execution']['cpuSeconds']/a['execution']['cpuSeconds'],'executionWallCandidateOverBaseline':c['execution']['wallSeconds']/a['execution']['wallSeconds'],'wholeChildCpuCandidateOverBaseline':c['wholeChild']['cpuSeconds']/a['wholeChild']['cpuSeconds'],'wholeChildWallCandidateOverBaseline':c['wholeChild']['wallSeconds']/a['wholeChild']['wallSeconds']})
 favorable=all(row['arms'][CAND]['execution']['cpuMicrosecondsSum']<row['arms'][BASE]['execution']['cpuMicrosecondsSum'] for row in rows)
 return {'comparison':name,'primaryMetric':'executionProcessCpuSeconds','criteria':{'primaryMetric':'executionProcessCpuSeconds','meanReductionAtLeast':0.1,'allSevenCandidateFaster':True},'baselineMeanExecutionCpuSeconds':totals[BASE]/7e6,'candidateMeanExecutionCpuSeconds':totals[CAND]/7e6,'meanCpuReduction':1-totals[CAND]/totals[BASE],'allSevenFavorable':favorable,'quantitativeGatePass':10*totals[CAND]<=9*totals[BASE] and favorable,'rawRatios':ratios,'scope':'Cold slice only; configured virtual RTx is not physical 386 calibration; no default adoption, full AT/Windows/Doom10x claim'}
p=SimpleNamespace(COMPILED=COMPILED,words=raw166,pair_schedule=schedule,validate_worker_receipt=validate_receipt,summarize_pairs=summary)

members={};children=[];sourceChecks=0;extraRoleChecks=0;retainedOutcomes={};childExtent=[]
try:
 Z=pathlib.Path(json.loads((O/'actual-artifact-input.json').read_bytes())['zipPath'])
 a=json.loads((O/'artifacts.json').read_bytes())['artifacts'][0];run=json.loads((O/'run.json').read_bytes());head='56669aa8f214e0011f89824befafe12e4e034383'
 RUN_ID=37267527701;ARTIFACT_ID=11327261646 # Root must freeze genuine dispatch IDs before reviewed invocation.
 assert type(RUN_ID) is int and type(ARTIFACT_ID) is int,'actual paired dispatch pending'
 assert run['id']==RUN_ID and run['event']=='workflow_dispatch' and run['head_sha']==head and run['run_attempt']==1 and run['status']=='completed'
 assert a['id']==ARTIFACT_ID and a['workflow_run']['id']==run['id'] and a['workflow_run']['head_sha']==head and a['size_in_bytes']==Z.stat().st_size and a['digest']=='sha256:'+hashfile(Z)
 w=pathlib.Path('/tmp/bw-native-compact-progress-paired-binding-fix-20261005');source=w/'scripts/cold-compact-progress-paired/policy.py';assert source.read_bytes()==subprocess.check_output(['git','-C',str(w),'show',head+':scripts/cold-compact-progress-paired/policy.py'])
 with zipfile.ZipFile(Z) as z:
  infos=z.infolist();names=[i.filename for i in infos];assert 0<len(names)<=512 and len(names)==len(set(names));assert sum(i.file_size for i in infos)<=256<<20;members={}
  for i in infos:
   assert 0<=i.file_size<=64<<20
   path=pathlib.PurePosixPath(i.filename);assert not path.is_absolute() and '..' not in path.parts and not i.flag_bits&1 and (i.external_attr>>16)&0o170000!=0o120000
   hh=hashlib.sha256();size=0
   with z.open(i) as f:
    for b in iter(lambda:f.read(1<<20),b''):hh.update(b);size+=len(b)
   assert size==i.file_size;members[i.filename]={'bytes':size,'sha256':hh.hexdigest()}
  (O/'members.json').write_text(json.dumps(members,indent=2)+'\n')
  prefix='cold-compact-progress-paired/';read=lambda n:json.loads(z.read(prefix+n))
  # Retain the actual first outcome and attainable raw child extent even on failure.
  for name in names:
   if name.startswith(prefix) and (name.endswith('/result.json') or name.endswith('/hosted-result.json') or name.endswith('/setup-result.json') or name.endswith('/exit.json') or name.endswith('/failure.json')):
    retainedOutcomes[name]=json.loads(z.read(name))
   if name.startswith(prefix+'pairs/pair-') and name.endswith('/receipt/receipt.json'):childExtent.append(name)
  assert run['conclusion']=='success','original workflow outcome is not success; retained outcomes remain authoritative'
  hosted=read('hosted-result.json');assert hosted=={'status':'HOSTED_PAIRS_RETURNED','primaryError':None}
  assert read('parent-source.json')==read('parent-source-after.json') and read('parent-source.json')['revision']==head and len(read('parent-source.json')['hashes'])==20
  d=read('pairs/result.json');assert not any(k in d for k in ('error','finalizationError','finalAuthenticationUnavailable','requestPinAfterUnavailable','hostAfterUnavailable'));binding=read('setup/derived-paired-binding.json');capture=read('setup/capture.json');initial=read('pairs/initial-authentication.json');assert d['finalAuthentication']==initial and d['bindingPinBefore']==d['bindingPinAfter'] and d['requestPinBefore']==d['requestPinAfter'];assert d['bindingPinBefore']['sha256']==H(z.read(prefix+'setup/derived-paired-binding.json'))
  assert H(z.read(prefix+'setup/capture.json'))==binding['capture']['sha256']=='b4dd71749cb8c51db0ae4981bdd87e9485b8f658208b6d7d2a53f1f19fa41cbf'
  assert binding['node']['sha256']=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
  assert H(z.read(prefix+'setup/build-artifact/official-artifact.zip'))=='bbe77a630e6789beac60424cf85f254d0156acc310bcf2b3e277932120760ba0'
  assert binding['compiledRevision']==p.COMPILED and len(binding['compiledFiles'])==163 and binding['workers']['native']['revision']=='5a967d701cffb730cc0bebf4bb6c1fee846a8aee' and len(binding['workers']['native']['files'])==73 and len(binding['workers']['plainJs']['files'])==49
  sourceChecks=0
  for identity in [initial['parent'],initial['compiled'],*initial['workers'].values()]:
   for path,pin in identity['hashes'].items():
    expected=pin['sha256'] if type(pin)is dict else pin;blob=subprocess.check_output(['git','-C',str(w),'show',identity['revision']+':'+path]);assert H(blob)==expected;sourceChecks+=1
  assert initial['parent']['revision']==head and len(initial['parent']['hashes'])==20
  assert sourceChecks==305,'runtime20 parent+163 compiled+73 native+49 plain Git closure'
  assert binding['workers']['native']['sourceSha256']=='d2402a127ca8a4d764eccb2a3561fa943d416f975a18c87f0a76132e0070b741'
  assert binding['nativeInput']['sha256']=='0323040b94db365ff66b51c7b0827c6fc07bd3ba4153eac80ee4023920a1ac3d'
  setupReport=read('setup/setup-result.json');setupBefore=read('setup/before.json');setupAfter=setupReport['sourceAfter'];restored=read('setup/restored-before.json')
  assert setupBefore==setupAfter,'setup helper/plain/Node before-after'
  assert setupReport['roleSourcesAfter']==setupReport['sourceBeforeSetup'] and setupReport['originalInputsAfter']==setupReport['inputsBeforeRestore'] and setupReport['restoredAfter']==restored,'independent full setup after guards'
  assert 'finalizationErrors' not in setupReport
  assert setupReport['sourceBeforeSetup']==restored['source'],'restored sources equal pre-setup roles'
  assert setupReport['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED' and 'error' not in setupReport and 'finalizationError' not in setupReport
  extraRoleChecks=0
  for role,revision,count in [('driver','11c0bdcade020117fc682e97db284c6ff8797842',54),('tooling','95c3ae6cb0504c3e86007a28bf25ad31dbbd5d4c',18)]:
   identity=setupReport['sourceBeforeSetup'][role];assert identity['revision']==revision and len(identity['hashes'])==count
   for path,pin in identity['hashes'].items():
    expected=pin['sha256'] if type(pin)is dict else pin;assert H(subprocess.check_output(['git','-C',str(w),'show',revision+':'+path]))==expected;extraRoleChecks+=1
  assert extraRoleChecks==72 and sourceChecks+extraRoleChecks==377,'complete six authenticated role inventories'
  assert setupBefore['tooling']==setupReport['sourceBeforeSetup']['tooling'] and setupBefore['plain']==initial['workers']['plainJs']
  materialization=read('setup/materialization/materialization-proof.json')
  assert materialization['driverSourceIdentity']==setupReport['sourceBeforeSetup']['driver'] and materialization['originalRecordsUnchanged'] is True
  assert materialization['memoryFusionProfile']=='bw.cold-native.memory-clock-fusion.v1' and materialization['stateExportProfile']=='bw.cold-native.copied-u32-state.v1'
  for label,record in restored['records'].items():assert initial['pinnedFiles'][label]==record,'prepared/evidence/Git/config/materialization immutable pin'
  for label,record in setupReport['inputsBeforeRestore'].items():assert initial['pinnedFiles'][label]==record,'original build/capture ZIP/metadata/restore binding pin'
  assert restored['upstream']['head']=='0e45b736ef9792eb9b752b0a35db49eaf2faea47' and restored['upstream']['clean'] is True
  qualificationContract=json.loads((w/'scripts/cold-compact-progress-paired/hosted-contract.json').read_bytes())
  assert qualificationContract['compactQualificationAudit']['sha256']=='5a7f577adac60276199be9c6323ef657df663ea8559fb6ce2e3acb7810416e2f'
  assert H(z.read(prefix+'setup/compact-qualification-artifact/official-artifact.zip'))==qualificationContract['compactQualificationArtifact']['zipSha256']
  assert binding['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10};assert read('setup/setup-result.json')['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED'
  assert len(d['pairs'])==9;metrics={arm:{key:[] for key in ('executionCpu','executionWall','wholeChildCpu','wholeChildWall')} for arm in ('plain-JS','compact-progress-batched')};children=[]
  for i,pair in enumerate(d['pairs']):
   expected=p.pair_schedule('plain-JS-v-compact-progress-batched')[i];assert {k:pair[k] for k in expected}==expected and set(pair['arms'])==set(expected['order'])
   for arm in expected['order']:
    ns=f'pairs/pair-{i:02d}-{arm}';r=read(ns+'/receipt/receipt.json');e=read(ns+'/exit.json');data=read(f'pairs/pair-{i:02d}-{arm}-input.json');raw_input=z.read(prefix+f'pairs/pair-{i:02d}-{arm}-input.json');assert r['inputSha256Before']==r['inputSha256After']==H(raw_input)
    assert e['exitCode']==0 and not e['timedOut'] and not e['interrupted'];assert read(ns+'/after-authentication.json')==read(f'pairs/pair-{i:02d}-{arm}-before.json')==initial
    computed=p.validate_worker_receipt(r,arm,data,binding,capture);reported=pair['arms'][arm];assert computed==reported['execution'] and e==reported['wholeChild'];assert reported['rawReceiptSha256']==H(z.read(prefix+ns+'/receipt/receipt.json'))
    assert math.isclose(e['cpuSeconds'],e['rusage']['ru_utime']+e['rusage']['ru_stime'],rel_tol=1e-14)
    if arm=='compact-progress-batched':assert p.words(r['reset']['native'])==p.words(capture['cuts'][0]['native']);assert r['typedSnapshotOwnership']=='RESET_STABLE_AND_REQUESTED_LAST_FINAL_INSPECT_DISTINCT' and len(r['lastReturnedProgress'])==9 and p.words(r['lastResumeInspect'])==p.words(r['finalNative']) and r['returns']['resumes']==16524 and r['returns']['zeroQ']==0 and len(r['ports'])==16475
    else:assert r['result']['beforeSettle']['cpu']==capture['cuts'][-1]['javascript']['cpu']
    children.append({'pair':i,'phase':pair['phase'],'arm':arm,'executionCpu':computed['cpuSeconds'],'executionWall':computed['wallSeconds'],'wholeChildCpu':e['cpuSeconds'],'wholeChildWall':e['wallSeconds'],'pid':e['pid']})
    if i>=2:
     for key,value in [('executionCpu',computed['cpuSeconds']),('executionWall',computed['wallSeconds']),('wholeChildCpu',e['cpuSeconds']),('wholeChildWall',e['wallSeconds'])]:metrics[arm][key].append(value)
  assert len({c['pid'] for c in children})==18
  summary=p.summarize_pairs('plain-JS-v-compact-progress-batched',d['pairs']);assert summary==d['summary'];assert d['status']==('PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_PASS' if summary['quantitativeGatePass'] else 'PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_FAIL_KEEP_BASELINE')
  stats={arm:{key:{'mean':statistics.mean(values),'median':statistics.median(values),'series':values} for key,values in m.items()} for arm,m in metrics.items()};host=read('pairs/host-before.json');hostAfter=read('pairs/host-after.json');assert hostAfter['logicalCpus']==host['logicalCpus'] and hostAfter['platform']==host['platform'];assert sorted({line.split(':',1)[1].strip() for line in hostAfter['cpuInfo'].splitlines() if line.startswith('model name')})==sorted({line.split(':',1)[1].strip() for line in host['cpuInfo'].splitlines() if line.startswith('model name')});models=sorted({line.split(':',1)[1].strip() for line in host['cpuInfo'].splitlines() if line.startswith('model name')})
  out={'status':'PASS_CODER_ACTUAL_COMPACT_PROGRESS_PAIRED_AUDIT','runId':run['id'],'head':head,'artifactId':a['id'],'zipBytes':Z.stat().st_size,'zipSha256':hashfile(Z),'members':len(infos),'currentGitProofInputs':sourceChecks+extraRoleChecks,'roleProofScope':'305 parent/build/workers plus 54 metadata-driver and 18 qualifier paths. Independent retained setup after-maps and all restored/input pins equal.','children':18,'warmupPairs':2,'measuredPairs':7,'quantitativeGatePassed':summary['quantitativeGatePass'],'favorablePairs':sum(c<b for c,b in zip(metrics['compact-progress-batched']['executionCpu'],metrics['plain-JS']['executionCpu'])),'candidateOverBaselineMeanExecutionCpu':stats['compact-progress-batched']['executionCpu']['mean']/stats['plain-JS']['executionCpu']['mean'],'candidateOverBaselineMeanExecutionWall':stats['compact-progress-batched']['executionWall']['mean']/stats['plain-JS']['executionWall']['mean'],'metrics':stats,'configuredFunctionalVirtualSeconds':6*316562/6000000,'configuredVirtualOverMeanExecutionWall':{arm:(6*316562/6000000)/stats[arm]['executionWall']['mean'] for arm in (BASE,CAND)},'virtualRatioScope':'Six configured functional cycles per Q at 6MHz; not physical 386 calibration or measured hardware RTx','hardware':{'cpuModels':models,'logicalCpus':host['logicalCpus'],'allowedCpuSet':host['allowedCpuSet'],'platform':host['platform'],'processCgroup':host['processCgroup']},'scope':'Samehost primary plain-JS versus compact-progress-batched only. Native nine reset/requested-last/final166 plus actual compact9/NQ; JS nine represented CPU/Q; all18 board/RAMhash/PIO/source-input-final proof. Live typed ownership is executed-source-attested. No held-scalar-versus-compact measurement, physical386 calibration, fullboot or adoption.'}
  (O/'coder-actual-audit.json').write_text(json.dumps(out,indent=2)+'\n');(O/'actual-18-child-series.json').write_text(json.dumps(children,indent=2)+'\n')
  print(json.dumps({k:v for k,v in out.items() if k not in ('metrics','hardware')}));print('hardware',models,host['logicalCpus'],host['allowedCpuSet']);print('means/medians',json.dumps({a:{k:{j:v[j] for j in ('mean','median')} for k,v in m.items()} for a,m in stats.items()}))
except BaseException as error:
 report={'status':'FAIL_CODER_COMPACT_PAIRED_AUDIT','originalError':repr(error),'membersRetained':members,'retainedOriginalOutcomes':retainedOutcomes,'rawChildReceiptExtent':childExtent,'childrenVerified':children,'gitChecksCompleted':sourceChecks+extraRoleChecks,'scope':'Partial read-only audit extent; original first outcome unchanged; no semantic or quantitative PASS'}
 try:
  with (O/'coder-audit-failure.json').open('x') as f:json.dump(report,f,indent=2)
 except BaseException as final:print('Audit failure finalization error: '+repr(final),file=sys.stderr)
 raise
