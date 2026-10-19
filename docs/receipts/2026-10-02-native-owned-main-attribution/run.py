# PREPARED ONLY. One timing-only child after root source review/grant; never a speed gate.
from pathlib import Path
import json,hashlib,subprocess,importlib.util,os,sys
P=Path(__file__).resolve().parent;W=Path('/tmp/bw-board-386-native-owned-main-20261002');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True;sha=lambda b:hashlib.sha256(b).hexdigest()
raw=(P/'approved-bindings.json').read_bytes();approved=json.loads(raw);pins=json.loads((P/'prepared-helper-pins.json').read_bytes())['helperHashes'];assert pins==approved['helperHashes'];assert approved['revision']=='bab751825473d55d8bf6da8c6ad5786921ffcfe1'
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==approved['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for p,h in approved['sourceHashes'].items():assert sha((W/p).read_bytes())==h
 for p,h in approved['artifactHashes'].items():assert sha(Path(p).read_bytes())==h
 assert {p:sha((P/p).read_bytes())for p in pins}==pins;assert (P/'approved-bindings.json').read_bytes()==raw
 return {'revision':approved['revision'],'sourceHashes':approved['sourceHashes'],'artifactHashes':approved['artifactHashes'],'helperHashes':pins,'blankEnvironment':{k:os.environ[k]for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}}
os.environ.update({k:''for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']});before=auth();(P/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n');spec=importlib.util.spec_from_file_location('bounded',P/'bounded.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
input={**approved['productionInput'],'output':str(P/'timing-only'),'nativeTrace':False,'hostJournal':False};ip=P/'timing-only.input.json';ip.write_text(json.dumps(input,indent=2)+'\n');previous=os.getcwd();os.chdir(W)
try:result=bounded.run_child(NODE,P/'driver.mjs',ip,P/'timing-only-child')
finally:os.chdir(previous)
assert result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION';capture=json.loads((P/'timing-only/capture.json').read_bytes());reference=json.loads(Path(approved['referenceCapture']).read_bytes())
for field in ['source','reset','final','checkpoints','settled','ramSha256','resumes','terminal']:assert capture[field]==reference[field],field
assert capture['resumes']==439 and len(capture['checkpoints'])==6 and capture['journal']['rows']==0 and (P/'timing-only/callbacks.jsonl').stat().st_size==0
b=capture['attribution']['buckets'];assert b['native.resume.inclusive']['calls']==439 and b['board.checkpoint']['calls']==6;assert b['clock.inclusive']['calls']==int(capture['final']['clockTransfers']['transfers'])-int(capture['reset']['clockTransfers']['transfers']);assert b['dispatch.nativeTick']['calls']==100684 and b['dispatch.quantum']['calls']==100682
assert auth()==before;(P/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');(P/'summary.json').write_text(json.dumps({'status':'ACTUAL_MAIN_TIMING_DIAGNOSTIC_PARITY_PASS_NOT_SPEED_GATE','exit':result,'captureSha256':sha((P/'timing-only/capture.json').read_bytes()),'attribution':capture['attribution'],'sourceRevision':capture['source']['revision'],'limitations':'execution-only overlapping wall buckets with perword timer allocations and shared scheduling; native snapshot inside native.resume inclusive; no additiveCPUshare or speedgate'},indent=2)+'\n');print('PASS one main timing diagnostic, fullsnapshot/RAM parity')
