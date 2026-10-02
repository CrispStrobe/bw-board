# PREPARED ONLY; one explicitly granted cell, no native execution during preparation.
import pathlib,json,hashlib,subprocess,importlib.util,sys,os
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-owned-in8-r3-20261002');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True
sha=lambda b:hashlib.sha256(b).hexdigest();label=sys.argv[1];assert label in ['smoke-off','fulltrace-on'];R=P/label;assert not R.exists()
raw=(P/'approved-bindings.json').read_bytes();approved=json.loads(raw);helpers=['run.py','parity.py','plan.json','bounded.py','bounded-derivation.json'];pins={p:sha((P/p).read_bytes())for p in helpers};assert pins==approved['helperHashes']
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==approved['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for p,h in approved['sourceHashes'].items():assert sha((W/p).read_bytes())==h and sha(subprocess.check_output(['git','show',approved['revision']+':'+p],cwd=W))==h
 for p,h in approved['artifactHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h
 assert {p:sha((P/p).read_bytes())for p in helpers}==pins;assert (P/'approved-bindings.json').read_bytes()==raw
 return {'revision':approved['revision'],'sourceHashes':approved['sourceHashes'],'artifactHashes':approved['artifactHashes'],'helperHashes':pins,'blankEnvironment':{k:os.environ[k]for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}}
before=auth();R.mkdir();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n');input={**approved['buildInput'],'configuration':approved['configuration'],'baseline':approved['baseline'],'baselineSha256':'bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e','output':str(R/'guest'),'nativeTrace':label=='fulltrace-on','hostJournal':label=='fulltrace-on'};assert len(input)==12;(R/'input.json').write_text(json.dumps(input,indent=2)+'\n')
spec=importlib.util.spec_from_file_location('bounded',P/'bounded.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded);previous=os.getcwd();os.chdir(W)
try:result=bounded.run_child(NODE,W/'scripts/run-i80386-native-owned-in8.mjs',R/'input.json',R/'child')
finally:os.chdir(previous)
(R/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');assert auth()==before;assert result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION';print(json.dumps(result))
