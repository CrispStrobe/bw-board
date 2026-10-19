import sys
sys.dont_write_bytecode=True
import pathlib,json,zipfile,hashlib,statistics,math,importlib.util,subprocess
O=pathlib.Path(__file__).parent;Z=O/'official-artifact.zip';H=lambda b:hashlib.sha256(b).hexdigest()
def hashfile(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
a=json.loads((O/'official-metadata.json').read_bytes());run=json.loads((O/'run.json').read_bytes());head='9f3042810d59fa6911e33c5cc480a6c405c5a618'
assert run['id']==37149610856 and run['event']=='workflow_dispatch' and run['head_sha']==head and run['run_attempt']==1 and run['conclusion']=='success'
assert a['id']==11283860658 and a['workflow_run']['id']==run['id'] and a['workflow_run']['head_sha']==head and a['size_in_bytes']==Z.stat().st_size and a['digest']=='sha256:'+hashfile(Z)
w=pathlib.Path('/tmp/bw-cold-native-typed-state-build-source-20261003');source=w/'scripts/cold-typed-state-paired/policy.py';assert source.read_bytes()==subprocess.check_output(['git','-C',str(w),'show',head+':scripts/cold-typed-state-paired/policy.py']);spec=importlib.util.spec_from_file_location('audited_typed_policy',source);p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
with zipfile.ZipFile(Z) as z:
 infos=z.infolist();names=[i.filename for i in infos];assert len(names)==len(set(names));members={}
 for i in infos:
  path=pathlib.PurePosixPath(i.filename);assert not path.is_absolute() and '..' not in path.parts and not i.flag_bits&1 and (i.external_attr>>16)&0o170000!=0o120000
  hh=hashlib.sha256();size=0
  with z.open(i) as f:
   for b in iter(lambda:f.read(1<<20),b''):hh.update(b);size+=len(b)
  assert size==i.file_size;members[i.filename]={'bytes':size,'sha256':hh.hexdigest()}
 (O/'members.json').write_text(json.dumps(members,indent=2)+'\n')
 prefix='cold-typed-paired/';read=lambda n:json.loads(z.read(prefix+n));d=read('pairs/result.json');binding=read('setup/derived-paired-binding.json');capture=read('setup/capture.json');initial=read('pairs/initial-authentication.json');assert d['finalAuthentication']==initial and d['bindingPinBefore']==d['bindingPinAfter'] and d['requestPinBefore']==d['requestPinAfter'];assert d['bindingPinBefore']['sha256']==H(z.read(prefix+'setup/derived-paired-binding.json'))
 assert binding['compiledRevision']==p.COMPILED and len(binding['compiledFiles'])==134 and binding['workers']['native']['revision']=='162a9b2a72d780cd7ea4491c91cf7260b15b0a8b' and len(binding['workers']['native']['files'])==62 and len(binding['workers']['plainJs']['files'])==49
 assert binding['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10};assert read('setup/setup-result.json')['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED'
 assert len(d['pairs'])==9;metrics={arm:{key:[] for key in ('executionCpu','executionWall','wholeChildCpu','wholeChildWall')} for arm in ('plain-JS','typed-batched')};children=[]
 for i,pair in enumerate(d['pairs']):
  expected=p.pair_schedule('plain-JS-v-typed-batched')[i];assert {k:pair[k] for k in expected}==expected and set(pair['arms'])==set(expected['order'])
  for arm in expected['order']:
   ns=f'pairs/pair-{i:02d}-{arm}';r=read(ns+'/receipt/receipt.json');e=read(ns+'/exit.json');data=read(f'pairs/pair-{i:02d}-{arm}-input.json');raw_input=z.read(prefix+f'pairs/pair-{i:02d}-{arm}-input.json');assert r['inputSha256Before']==r['inputSha256After']==H(raw_input)
   assert e['exitCode']==0 and not e['timedOut'] and not e['interrupted'];assert read(ns+'/after-authentication.json')==read(f'pairs/pair-{i:02d}-{arm}-before.json')==initial
   computed=p.validate_worker_receipt(r,arm,data,binding,capture);reported=pair['arms'][arm];assert computed==reported['execution'] and e==reported['wholeChild'];assert reported['rawReceiptSha256']==H(z.read(prefix+ns+'/receipt/receipt.json'))
   assert math.isclose(e['cpuSeconds'],e['rusage']['ru_utime']+e['rusage']['ru_stime'],rel_tol=1e-14)
   if arm=='typed-batched':assert p.words(r['reset']['native'])==p.words(capture['cuts'][0]['native']);assert r['typedSnapshotOwnership']=='RESET_STABLE_AND_FINAL_LAST_RETURN_DISTINCT' and r['returns']['resumes']==16524 and r['returns']['zeroQ']==0 and len(r['ports'])==16475
   else:assert r['result']['beforeSettle']['cpu']==capture['cuts'][-1]['javascript']['cpu']
   children.append({'pair':i,'phase':pair['phase'],'arm':arm,'executionCpu':computed['cpuSeconds'],'executionWall':computed['wallSeconds'],'wholeChildCpu':e['cpuSeconds'],'wholeChildWall':e['wallSeconds'],'pid':e['pid']})
   if i>=2:
    for key,value in [('executionCpu',computed['cpuSeconds']),('executionWall',computed['wallSeconds']),('wholeChildCpu',e['cpuSeconds']),('wholeChildWall',e['wallSeconds'])]:metrics[arm][key].append(value)
 assert len({c['pid'] for c in children})==18
 summary=p.summarize_pairs('plain-JS-v-typed-batched',d['pairs']);assert summary==d['summary'];assert d['status']==('PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_PASS' if summary['quantitativeGatePass'] else 'PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_FAIL_KEEP_BASELINE')
 stats={arm:{key:{'mean':statistics.mean(values),'median':statistics.median(values),'series':values} for key,values in m.items()} for arm,m in metrics.items()};host=read('pairs/host-before.json');models=sorted({line.split(':',1)[1].strip() for line in host['cpuInfo'].splitlines() if line.startswith('model name')})
 out={'status':'PASS_CODER_ACTUAL_TYPED_PAIRED_AUDIT','runId':run['id'],'head':head,'artifactId':a['id'],'zipBytes':Z.stat().st_size,'zipSha256':hashfile(Z),'members':len(infos),'children':18,'warmupPairs':2,'measuredPairs':7,'quantitativeGatePassed':summary['quantitativeGatePass'],'favorablePairs':sum(c<b for c,b in zip(metrics['typed-batched']['executionCpu'],metrics['plain-JS']['executionCpu'])),'candidateOverBaselineMeanExecutionCpu':stats['typed-batched']['executionCpu']['mean']/stats['plain-JS']['executionCpu']['mean'],'candidateOverBaselineMeanExecutionWall':stats['typed-batched']['executionWall']['mean']/stats['plain-JS']['executionWall']['mean'],'metrics':stats,'hardware':{'cpuModels':models,'logicalCpus':host['logicalCpus'],'allowedCpuSet':host['allowedCpuSet'],'platform':host['platform'],'processCgroup':host['processCgroup']},'scope':'Samehost primary plain-JS versus typed-batched only. Native nine reset/final/last-return166/NQ; JS nine represented CPU/Q; all18 board/RAMhash/PIO/source-input-final proof. Live typed ownership is executed-source-attested. No old-native-versus-typed measurement, physical386 calibration, fullboot or adoption.'}
 (O/'coder-actual-audit.json').write_text(json.dumps(out,indent=2)+'\n');(O/'actual-18-child-series.json').write_text(json.dumps(children,indent=2)+'\n')
 print(json.dumps({k:v for k,v in out.items() if k not in ('metrics','hardware')}));print('hardware',models,host['logicalCpus'],host['allowedCpuSet']);print('means/medians',json.dumps({a:{k:{j:v[j] for j in ('mean','median')} for k,v in m.items()} for a,m in stats.items()}))
