import sys
sys.dont_write_bytecode=True
import pathlib,json,zipfile,hashlib,statistics,math,importlib.util,subprocess
O=pathlib.Path(__file__).parent;Z=O/'official-artifact.zip';H=lambda b:hashlib.sha256(b).hexdigest()
def hashfile(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
a=json.loads((O/'artifacts.json').read_bytes())['artifacts'][0];run=json.loads((O/'run.json').read_bytes());head='b3e29ad322ccb723d971a0841ad89777f7e07a73'
RUN_ID=37187325276;ARTIFACT_ID=11297715775 # Root dispatch must supply genuine fixed IDs before execution.
assert type(RUN_ID) is int and type(ARTIFACT_ID) is int,'actual paired dispatch pending'
assert run['id']==RUN_ID and run['event']=='workflow_dispatch' and run['head_sha']==head and run['run_attempt']==1 and run['conclusion']=='success'
assert a['id']==ARTIFACT_ID and a['workflow_run']['id']==run['id'] and a['workflow_run']['head_sha']==head and a['size_in_bytes']==Z.stat().st_size and a['digest']=='sha256:'+hashfile(Z)
w=pathlib.Path('/tmp/bw-cold-memory-fusion-paired-source-20261004');source=w/'scripts/cold-memory-fusion-paired/policy.py';assert source.read_bytes()==subprocess.check_output(['git','-C',str(w),'show',head+':scripts/cold-memory-fusion-paired/policy.py']);spec=importlib.util.spec_from_file_location('audited_typed_policy',source);p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
with zipfile.ZipFile(Z) as z:
 infos=z.infolist();names=[i.filename for i in infos];assert len(names)==len(set(names));members={}
 for i in infos:
  path=pathlib.PurePosixPath(i.filename);assert not path.is_absolute() and '..' not in path.parts and not i.flag_bits&1 and (i.external_attr>>16)&0o170000!=0o120000
  hh=hashlib.sha256();size=0
  with z.open(i) as f:
   for b in iter(lambda:f.read(1<<20),b''):hh.update(b);size+=len(b)
  assert size==i.file_size;members[i.filename]={'bytes':size,'sha256':hh.hexdigest()}
 (O/'members.json').write_text(json.dumps(members,indent=2)+'\n')
 prefix='cold-memory-fusion-paired/';read=lambda n:json.loads(z.read(prefix+n));d=read('pairs/result.json');binding=read('setup/derived-paired-binding.json');capture=read('setup/capture.json');initial=read('pairs/initial-authentication.json');assert d['finalAuthentication']==initial and d['bindingPinBefore']==d['bindingPinAfter'] and d['requestPinBefore']==d['requestPinAfter'];assert d['bindingPinBefore']['sha256']==H(z.read(prefix+'setup/derived-paired-binding.json'))
 assert binding['compiledRevision']==p.COMPILED and len(binding['compiledFiles'])==151 and binding['workers']['native']['revision']=='735740cb52550bb71edde5aba326da6f3a01f473' and len(binding['workers']['native']['files'])==63 and len(binding['workers']['plainJs']['files'])==49
 sourceChecks=0
 for identity in [initial['parent'],initial['compiled'],*initial['workers'].values()]:
  for path,pin in identity['hashes'].items():
   expected=pin['sha256'] if type(pin)is dict else pin;blob=subprocess.check_output(['git','-C',str(w),'show',identity['revision']+':'+path]);assert H(blob)==expected;sourceChecks+=1
 assert sourceChecks==280,'full17 parent+151 compiled+63 native+49 plain Git closure'
 assert binding['workers']['native']['sourceSha256']=='f2a2a7c6f19366e2b11b9b9667ecff08dd22253f2914a24a2faa98f7c07d1649'
 assert binding['nativeInput']['sha256']=='7de755f02b385149e17abfb086972bc73cbcb3fac5294f758eda5a4ab97d2351'
 setupReport=read('setup/setup-result.json');setupBefore=read('setup/before.json');setupAfter=read('setup/after.json');restored=read('setup/restored-before.json')
 assert setupBefore==setupAfter,'setup helper/plain/Node before-after'
 assert setupReport['sourceBeforeSetup']==restored['source'],'restored sources equal pre-setup roles'
 assert setupReport['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED' and 'error' not in setupReport and 'finalizationError' not in setupReport
 extraRoleChecks=0
 for role,revision,count in [('driver','11c0bdcade020117fc682e97db284c6ff8797842',54),('tooling','a200b3d6fe8d42a020e8c65f0f33dacb777e6317',17)]:
  identity=setupReport['sourceBeforeSetup'][role];assert identity['revision']==revision and len(identity['hashes'])==count
  for path,pin in identity['hashes'].items():
   expected=pin['sha256'] if type(pin)is dict else pin;assert H(subprocess.check_output(['git','-C',str(w),'show',revision+':'+path]))==expected;extraRoleChecks+=1
 assert extraRoleChecks==71 and sourceChecks+extraRoleChecks==351,'complete six authenticated role inventories'
 assert setupBefore['tooling']==setupReport['sourceBeforeSetup']['tooling'] and setupBefore['plain']==initial['workers']['plainJs']
 materialization=read('setup/materialization/materialization-proof.json')
 assert materialization['driverSourceIdentity']==setupReport['sourceBeforeSetup']['driver'] and materialization['originalRecordsUnchanged'] is True
 assert materialization['memoryFusionProfile']=='bw.cold-native.memory-clock-fusion.v1' and materialization['stateExportProfile']=='bw.cold-native.copied-u32-state.v1'
 for label,record in restored['records'].items():assert initial['pinnedFiles'][label]==record,'prepared/evidence/Git/config/materialization immutable pin'
 for label,record in setupReport['inputsBeforeRestore'].items():assert initial['pinnedFiles'][label]==record,'original build/capture ZIP/metadata/restore binding pin'
 assert restored['upstream']['head']=='0e45b736ef9792eb9b752b0a35db49eaf2faea47' and restored['upstream']['clean'] is True
 qualificationContract=json.loads((w/'scripts/cold-memory-fusion-paired/hosted-contract.json').read_bytes())
 assert qualificationContract['fusionQualificationAudit']['sha256']=='978c54cff9bfceb2c704010869ad355318381b51c03837f650b1afb8f308c927'
 assert H(z.read(prefix+'setup/fusion-qualification-artifact/official-artifact.zip'))==qualificationContract['fusionQualificationArtifact']['zipSha256']
 assert binding['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10};assert read('setup/setup-result.json')['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED'
 assert len(d['pairs'])==9;metrics={arm:{key:[] for key in ('executionCpu','executionWall','wholeChildCpu','wholeChildWall')} for arm in ('plain-JS','fusion-batched')};children=[]
 for i,pair in enumerate(d['pairs']):
  expected=p.pair_schedule('plain-JS-v-fusion-batched')[i];assert {k:pair[k] for k in expected}==expected and set(pair['arms'])==set(expected['order'])
  for arm in expected['order']:
   ns=f'pairs/pair-{i:02d}-{arm}';r=read(ns+'/receipt/receipt.json');e=read(ns+'/exit.json');data=read(f'pairs/pair-{i:02d}-{arm}-input.json');raw_input=z.read(prefix+f'pairs/pair-{i:02d}-{arm}-input.json');assert r['inputSha256Before']==r['inputSha256After']==H(raw_input)
   assert e['exitCode']==0 and not e['timedOut'] and not e['interrupted'];assert read(ns+'/after-authentication.json')==read(f'pairs/pair-{i:02d}-{arm}-before.json')==initial
   computed=p.validate_worker_receipt(r,arm,data,binding,capture);reported=pair['arms'][arm];assert computed==reported['execution'] and e==reported['wholeChild'];assert reported['rawReceiptSha256']==H(z.read(prefix+ns+'/receipt/receipt.json'))
   assert math.isclose(e['cpuSeconds'],e['rusage']['ru_utime']+e['rusage']['ru_stime'],rel_tol=1e-14)
   if arm=='fusion-batched':assert p.words(r['reset']['native'])==p.words(capture['cuts'][0]['native']);assert r['typedSnapshotOwnership']=='RESET_STABLE_AND_FINAL_LAST_RETURN_DISTINCT' and r['returns']['resumes']==16524 and r['returns']['zeroQ']==0 and len(r['ports'])==16475
   else:assert r['result']['beforeSettle']['cpu']==capture['cuts'][-1]['javascript']['cpu']
   children.append({'pair':i,'phase':pair['phase'],'arm':arm,'executionCpu':computed['cpuSeconds'],'executionWall':computed['wallSeconds'],'wholeChildCpu':e['cpuSeconds'],'wholeChildWall':e['wallSeconds'],'pid':e['pid']})
   if i>=2:
    for key,value in [('executionCpu',computed['cpuSeconds']),('executionWall',computed['wallSeconds']),('wholeChildCpu',e['cpuSeconds']),('wholeChildWall',e['wallSeconds'])]:metrics[arm][key].append(value)
 assert len({c['pid'] for c in children})==18
 summary=p.summarize_pairs('plain-JS-v-fusion-batched',d['pairs']);assert summary==d['summary'];assert d['status']==('PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_PASS' if summary['quantitativeGatePass'] else 'PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_FAIL_KEEP_BASELINE')
 stats={arm:{key:{'mean':statistics.mean(values),'median':statistics.median(values),'series':values} for key,values in m.items()} for arm,m in metrics.items()};host=read('pairs/host-before.json');models=sorted({line.split(':',1)[1].strip() for line in host['cpuInfo'].splitlines() if line.startswith('model name')})
 out={'status':'PASS_CODER_ACTUAL_MEMORY_FUSION_PAIRED_AUDIT','runId':run['id'],'head':head,'artifactId':a['id'],'zipBytes':Z.stat().st_size,'zipSha256':hashfile(Z),'members':len(infos),'currentGitProofInputs':sourceChecks+extraRoleChecks,'roleProofScope':'280 parent/build/workers plus 54 metadata-driver and 17 qualifier paths. Setup success source-attests final driver/upstream guards; retained helper before/after and all restored/input pins independently equal. No unretained full after-driver map fabricated.','children':18,'warmupPairs':2,'measuredPairs':7,'quantitativeGatePassed':summary['quantitativeGatePass'],'favorablePairs':sum(c<b for c,b in zip(metrics['fusion-batched']['executionCpu'],metrics['plain-JS']['executionCpu'])),'candidateOverBaselineMeanExecutionCpu':stats['fusion-batched']['executionCpu']['mean']/stats['plain-JS']['executionCpu']['mean'],'candidateOverBaselineMeanExecutionWall':stats['fusion-batched']['executionWall']['mean']/stats['plain-JS']['executionWall']['mean'],'metrics':stats,'hardware':{'cpuModels':models,'logicalCpus':host['logicalCpus'],'allowedCpuSet':host['allowedCpuSet'],'platform':host['platform'],'processCgroup':host['processCgroup']},'scope':'Samehost primary plain-JS versus fusion-batched only. Native nine reset/final/last-return166/NQ; JS nine represented CPU/Q; all18 board/RAMhash/PIO/source-input-final proof. Live typed ownership is executed-source-attested. No old-native-versus-fusion measurement, physical386 calibration, fullboot or adoption.'}
 (O/'coder-actual-audit.json').write_text(json.dumps(out,indent=2)+'\n');(O/'actual-18-child-series.json').write_text(json.dumps(children,indent=2)+'\n')
 print(json.dumps({k:v for k,v in out.items() if k not in ('metrics','hardware')}));print('hardware',models,host['logicalCpus'],host['allowedCpuSet']);print('means/medians',json.dumps({a:{k:{j:v[j] for j in ('mean','median')} for k,v in m.items()} for a,m in stats.items()}))
