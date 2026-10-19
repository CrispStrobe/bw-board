# Prepared only; actual one-run gate requires root-approved bindings.
from pathlib import Path
import json,hashlib,subprocess,os,sys,importlib.util
sys.dont_write_bytecode=True
P=Path(__file__).resolve().parent;R=P/'results';sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
raw=(P/'approved-bindings.json').read_bytes();a=json.loads(raw);plan=json.loads((P/'plan.json').read_bytes())
for k,v in plan['containment']['blankEnvironment'].items():os.environ[k]=v
sources={'BASE':a['baselineSource'],'SPAN':a['candidateSource']};roots={'BASE':Path(a['baselineWorktree']),'SPAN':Path(a['candidateWorktree'])}
assert sources['BASE']['revision']==plan['baselineSource'] and len(sources['BASE']['hashes'])==103
assert sources['SPAN']['revision']==plan['candidateSource'] and len(sources['SPAN']['hashes'])==116
assert all(sources['SPAN']['hashes'][p]==h for p,h in sources['BASE']['hashes'].items())
def auth():
 assert (P/'approved-bindings.json').read_bytes()==raw
 for n,r in roots.items():
  assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip()==sources[n]['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=r).strip()
  for p,h in sources[n]['hashes'].items():assert sha(r/p)==h==hashlib.sha256(subprocess.check_output(['git','show',sources[n]['revision']+':'+p],cwd=r)).hexdigest()
 assert a['nodeSha256']=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
 assert a['node'] in a['artifactHashes'] and a['artifactHashes'][a['node']]==a['nodeSha256']
 assert sha(a['node'])==a['nodeSha256']
 for p,h in a['artifactHashes'].items():assert sha(p)==h
 for p,h in a['helperHashes'].items():assert sha(P/p)==h
 return {'sources':sources,'artifacts':a['artifactHashes'],'helpers':a['helperHashes'],'bindingSha256':sha(P/'approved-bindings.json')}
before=auth()
for mode in ['smoke-off','fulltrace-on','trace-fast']:
 proof=Path(a['parityDirectory'])/mode/'parity.json'
 assert str(proof) in a['artifactHashes']
 pv=json.loads(proof.read_bytes())
 expectedStatus={'smoke-off':'SPAN_CAPTURE_OFF_EXACT_PARITY_PASS_NOT_SPEED_GATE','fulltrace-on':'SPAN_CAPTURE_ON_EXACT_PARITY_PASS','trace-fast':'SPAN_FULL_CANONICAL_TRACE_NULLSINK_PARITY_PASS'}
 assert pv['status']==expectedStatus[mode]
 reviews={}
 for name,record in a['qualificationReviews'].items():
  assert record['path']in a['artifactHashes'] and sha(record['path'])==record['sha256']
  reviews[name]=json.loads(Path(record['path']).read_bytes());assert reviews[name]==record['expected']
 core=reviews[a['coreReview']];peer=reviews[a['peerReview']];root=reviews[a['rootReview']]
 assert peer['status']=='PASS_INDEPENDENT_ACTUAL_HOSTED_SPAN_THREE_CELL_COMPLETE_PROVENANCE_AND_PARITY'
 assert root['status']=='ROOT_ACTUAL_HOSTED_SPAN_OFFICIAL_ZIP_STREAM_AND_RECORDED_CLOSURE_PASS'
 assert peer['coreParityReceiptSha256']==a['qualificationReviews'][a['coreReview']]['sha256']
 actual=next(x for x in core['cells']if x['mode']==mode)
 assert actual['stateParity']and actual['captureSha256']==pv['captureSha256']and actual['journalSha256']==pv['journalSha256']and actual['canonicalRows']==pv['canonicalRows']
 modeInput=json.loads((Path(a['parityDirectory'])/mode/'input.json').read_bytes())
 assert str(Path(a['parityDirectory'])/mode/'input.json') in a['artifactHashes']
 assert modeInput['nativeTrace']==(mode!='smoke-off') and modeInput['hostJournal']==(mode=='fulltrace-on')
 modeCapturePath=Path(a['parityDirectory'])/mode/'guest/capture.json'; modeJournalPath=Path(a['parityDirectory'])/mode/'guest/callbacks.jsonl.stream-proof.json'
 assert str(modeCapturePath) in a['artifactHashes'] and sha(modeCapturePath)==pv['captureSha256']
 assert str(modeJournalPath) in a['artifactHashes']
 journalProof=json.loads(modeJournalPath.read_bytes());assert journalProof['sha256']==pv['journalSha256'] and journalProof['rows']==(209871 if mode=='fulltrace-on' else 0)
 modeCapture=json.loads(modeCapturePath.read_bytes())
 assert modeCapture['source']==sources['SPAN'] and modeCapture['provenance']==a['currentCandidateProvenance']
 assert modeCapture['provenance']['compiled']['proof']==a['currentCompiledProof']
 assert modeCapture['resetWitness']==[0,0,0,0,240,255,255,127]
 assert modeCapture['ramCanonicalSha256']=='588f9bfd1292b8405d0e42552147fb2d8d082a8253b52771291ca0a603eaf18f'
 assert modeCapture['journal']['rows']==(209871 if mode=='fulltrace-on' else 0)
 assert mode=='fulltrace-on' or journalProof['bytes']==0
 assert pv['sourceRevision']==plan['candidateSource']
 if mode!='smoke-off':assert pv['canonicalRows']==1649271
assert a['referenceCapture'] in a['artifactHashes']
reference=json.loads(Path(a['referenceCapture']).read_bytes());assert reference['source']==sources['BASE']
R.mkdir(exist_ok=False);(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
spec=importlib.util.spec_from_file_location('bounded',P/'bounded.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
records=[]
for pair,order in enumerate(plan['samples']['pairOrder']):
 for arm in order.split(','):
  stem=R/(str(pair)+'-'+arm);inp={**a['buildInput'],'configuration':a['configuration'],'baseline':a['baseline'],'baselineSha256':'bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e','output':str(stem/'guest'),'nativeTrace':False,'hostJournal':False};assert len(inp)==12
  ip=R/(str(pair)+'-'+arm+'.input.json');ip.write_text(json.dumps(inp,indent=2)+'\n');stem.mkdir();previous=os.getcwd();os.chdir(roots[arm])
  try:exit=b.run_child(a['node'],Path(a['entries'][arm]),ip,stem/'child')
  finally:os.chdir(previous)
  assert exit['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION'
  capturePath=stem/'guest'/'capture.json';c=json.loads(capturePath.read_bytes());assert c['source']==sources[arm]
  if arm=='BASE':assert c['provenance']==a['currentCompiledProof']
  else:
   assert c['provenance']['compiled']['revision']==sources['BASE']['revision'] and c['provenance']['compiled']['hashes']==sources['BASE']['hashes']
   assert c['provenance']['runtime']==sources['SPAN']
   assert c['provenance']==a['currentCandidateProvenance']
  for k in ['reset','final','checkpoints','settled','ramSha256','resetWitness','ramCanonicalSha256','in8Witness','resumes','terminal','closed']:assert c[k]==reference[k],(pair,arm,k)
  assert c['resumes']==445 and len(c['checkpoints'])==6 and c['journal']['rows']==0 and (stem/'guest'/'callbacks.jsonl').stat().st_size==0
  cpu=c['timing']['executionCPU'];assert cpu['unit']=='microseconds' and all(type(cpu[k]) is int and cpu[k]>=0 for k in ['user','system','total']);assert cpu['total']==cpu['user']+cpu['system'] and cpu['total']>0
  records.append({'pair':pair,'arm':arm,'warmup':pair<2,'executionCpuTotalUs':cpu['total'],'executionNs':c['timing']['executionNs'],'captureSha256':sha(capturePath),'inputSha256':sha(ip),'fullSemanticParity':True,'exit':exit});assert auth()==before;print(json.dumps(records[-1]),flush=True)
series={arm:[r['executionCpuTotalUs'] for r in records if r['arm']==arm and not r['warmup']] for arm in sources};assert all(len(v)==7 for v in series.values());means={k:sum(v)/7 for k,v in series.items()};reduction=100*(1-means['SPAN']/means['BASE']);favorable=[x<y for x,y in zip(series['SPAN'],series['BASE'])];passed=reduction>=10 and all(favorable)
summary={'status':'ACTUAL_SPAN_PROCESS_CPU_GATE_PASS' if passed else 'ACTUAL_SPAN_PROCESS_CPU_GATE_FAIL_KEEP_FE1','records':records,'samplesUs':series,'meansUs':means,'meanReductionPercent':reduction,'favorablePairs':favorable,'gatePassed':passed,'planSha256':sha(P/'plan.json'),'metric':plan['metric'],'noCumulativeSpeedupClaim':True}
(R/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');(R/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');print(json.dumps(summary),flush=True)
