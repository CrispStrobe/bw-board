# ROOT GRANT REQUIRED; two attribution cells only, no retry or speed gate.
from pathlib import Path
import json,hashlib,subprocess,importlib.util,os,sys
sys.dont_write_bytecode=True
P=Path(__file__).resolve().parent;W=Path('/tmp/bw-board-386-native-owned-clock-20261002');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sha=lambda b:hashlib.sha256(b).hexdigest()
approvedBytes=(P/'approved-bindings.json').read_bytes();approved=json.loads(approvedBytes)
files=['generate.py','timing.mjs','provider.mjs','worker.mjs','factory.mjs','driver.mjs','derivation.json','attribution-identity.json','plan.json','run.py'];helpers={n:sha((P/n).read_bytes()) for n in files};assert helpers==approved['helperHashes']
revision='7df84bc2c367aff1cadec7cecdde69cf0e904ace';derivation=json.loads((P/'derivation.json').read_text());assert derivation['revision']==revision
for name,item in derivation['derivatives'].items():
 s=(P/name).read_text();assert sha(s.encode())==item['derivedSha256']
 for edit in reversed(item['edits']):assert s.count(edit['new'])==1;s=s.replace(edit['new'],edit['old'])
 assert sha(s.encode())==item['sourceSha256']==derivation['sourceHashes'][item['sourcePath']]
runner='scripts/run-i80386-native-hot-regular-file.py';assert sha((W/runner).read_bytes())==sha(subprocess.check_output(['git','show',revision+':'+runner],cwd=W))==approved['boundedRunnerSha256']
spec=importlib.util.spec_from_file_location('bounded',W/runner);bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==revision;assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for path,h in derivation['sourceHashes'].items():assert sha((W/path).read_bytes())==h,path
 for path,h in approved['artifactHashes'].items():assert sha(Path(path).read_bytes())==h,path
 assert {n:sha((P/n).read_bytes()) for n in files}==helpers
 assert sha((W/runner).read_bytes())==approved['boundedRunnerSha256']
 return {'revision':revision,'sourceHashes':derivation['sourceHashes'],'helperHashes':helpers,'artifactHashes':approved['artifactHashes']}
initial=auth();(P/'auth-before.json').write_text(json.dumps(initial,indent=2));reference=json.loads(Path(approved['referenceCapture']).read_text());assert approved['referenceCapture'] in approved['artifactHashes'];records=[]
for cell in ['timing-only','timing-worker-profile']:
 input={**approved['buildInput'],'hostJournal':False,'nativeTrace':False,'profile':False,'output':str(P/(cell+'-data'))};ip=P/(cell+'.input.json');assert not ip.exists();ip.write_text(json.dumps(input));previous=os.getcwd();os.chdir(W);prior=os.environ.get('BW_OWNED_ATTRIBUTION_PROFILE');os.environ['BW_OWNED_ATTRIBUTION_PROFILE']='1' if cell=='timing-worker-profile' else '0'
 try:result=bounded.run_child(NODE,P/'driver.mjs',ip,P/cell)
 finally:
  os.chdir(previous)
  if prior is None:os.environ.pop('BW_OWNED_ATTRIBUTION_PROFILE',None)
  else:os.environ['BW_OWNED_ATTRIBUTION_PROFILE']=prior
 assert result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION' and not result['timedOut'] and not result['fileLimitReached'],result
 capture=Path(input['output'])/'capture.json';actual=json.loads(capture.read_text())
 for key in ['reset','final','resumes','terminal','checkpoints','settled','ramSha256','journal','closed']:assert actual[key]==reference[key],(cell,key)
 assert actual['resumes']==439 and len(actual['checkpoints'])==6
 assert actual['attribution']['identity']==json.loads((P/'attribution-identity.json').read_text());parent=actual['attribution']['parent'];worker=actual['attribution']['worker']['worker'];assert parent['factory.resume.roundtrip']['calls']==439 and worker['worker.native-resume.inclusive']['calls']==439
 assert worker['provider.clock.inclusive']['calls']==int(actual['final']['clockTransfers']['transfers'])-int(actual['reset']['clockTransfers']['transfers'])
 assert parent['factory.checkpoint.roundtrip']['calls']==worker['worker.checkpoint.board']['calls']==6
 assert actual['attribution']['worker']['profile']==(cell=='timing-worker-profile')
 residual=parent['factory.resume.roundtrip']['ns']-worker['worker.resume.processing-to-ready']['ns'];assert residual>=0
 profile=Path(input['output'])/'callbacks.jsonl.worker.cpuprofile';profileInfo=None
 if cell=='timing-worker-profile':
  data=json.loads(profile.read_text());assert data['nodes'] and len(data.get('samples',[]))==len(data.get('timeDeltas',[]));profileInfo={'path':str(profile),'sha256':sha(profile.read_bytes()),'bytes':profile.stat().st_size,'samples':len(data['samples'])}
 else:assert not profile.exists()
 records.append({'cell':cell,'exit':result,'captureSha256':sha(capture.read_bytes()),'attribution':actual['attribution'],'execution':actual['timing'],'ipcResidualNs':residual,'ipcResidualScope':'queue/transport/enqueue/parent delivery, not pure transport','profile':profileInfo});assert auth()==initial and (P/'approved-bindings.json').read_bytes()==approvedBytes
(P/'auth-after.json').write_text(json.dumps(auth(),indent=2));(P/'summary.json').write_text(json.dumps({'status':'ATTRIBUTION_TWO_CELLS_PASS_NOT_A_GATE','records':records,'warning':'Inclusive wall buckets overlap and timers/profile alter cost; ABI3 prior performance gate remains FAIL.'},indent=2));print('PASS two attribution cells; no performance gate')
