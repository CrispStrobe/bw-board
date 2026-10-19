# PREPARED ONLY; one explicitly granted cell, no native execution during preparation.
import pathlib,json,hashlib,subprocess,importlib.util,sys,os
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-owned-pic-imr-native-profile-20261002');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True
sha=lambda b:hashlib.sha256(b).hexdigest();label=sys.argv[1];assert label in ['smoke-off','fulltrace-on'];R=P/label;assert not R.exists()
raw=(P/'approved-bindings.json').read_bytes();approved=json.loads(raw);helpers=['run.py','parity.py','plan.json','bounded.py','bounded-derivation.json'];pins={p:sha((P/p).read_bytes())for p in helpers};assert pins==approved['helperHashes']
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==approved['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for p,h in approved['sourceHashes'].items():assert sha((W/p).read_bytes())==h and sha(subprocess.check_output(['git','show',approved['revision']+':'+p],cwd=W))==h
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=CW,text=True).strip()==approved['compiledRevision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=CW).strip()
 for p,h in approved['compiledSourceHashes'].items():assert approved['sourceHashes'][p]==h==sha((CW/p).read_bytes())==sha(subprocess.check_output(['git','show',approved['compiledRevision']+':'+p],cwd=CW))
 for p,h in approved['artifactHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h
 for field in ['restorationProof','staticAdmission','staticInput']:assert approved[field]in approved['artifactHashes']
 proof=json.loads(pathlib.Path(approved['restorationProof']).read_bytes());assert proof['status']=='DERIVED_RELOCATED_CI_BUILD' and proof['original']['sourceRevision']==approved['compiledRevision'] and proof['original']['sourceHashes']==approved['compiledSourceHashes'] and proof['original']['runtimeRevision']==approved['revision'] and proof['original']['runtimeSourceHashes']==approved['sourceHashes']
 admission=json.loads(pathlib.Path(approved['staticAdmission']).read_bytes());assert admission['status']=='STATIC_PIC_SOURCE_ONLY_NO_ADDON_LOAD' and admission['source']=={'revision':approved['revision'],'hashes':approved['sourceHashes']} and admission['provenance']==approved['expectedProvenance']
 assert json.loads(pathlib.Path(approved['staticInput']).read_bytes())['input']==approved['buildInput']
 assert {p:sha((P/p).read_bytes())for p in helpers}==pins;assert (P/'approved-bindings.json').read_bytes()==raw
 return {'revision':approved['revision'],'sourceHashes':approved['sourceHashes'],'compiledRevision':approved['compiledRevision'],'compiledSourceHashes':approved['compiledSourceHashes'],'artifactHashes':approved['artifactHashes'],'helperHashes':pins,'blankEnvironment':{k:os.environ[k]for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}}
assert approved['revision']=='3792a908d81e04903974aa7d2bdc545e0713a290' and len(approved['sourceHashes'])==122
assert approved['compiledRevision']=='a6f605280f778b2bc409ef97ac3b40e15874530c' and len(approved['compiledSourceHashes'])==111
CW=pathlib.Path(approved['compiledWorktree'])
assert approved['buildInput'] and approved['expectedProvenance'] and approved['restorationProof']
before=auth();R.mkdir();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n');input={**approved['buildInput'],'configuration':approved['configuration'],'baseline':approved['baseline'],'baselineSha256':'fdca8f8fa92952cd9cd5f4447e66b194a5f691025bcf925f7ddd443290143346','output':str(R/'guest'),'nativeTrace':label=='fulltrace-on','hostJournal':label=='fulltrace-on'};assert len(input)==12;(R/'input.json').write_text(json.dumps(input,indent=2)+'\n')
spec=importlib.util.spec_from_file_location('bounded',P/'bounded.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded);previous=os.getcwd();os.chdir(W)
try:result=bounded.run_child(NODE,W/'scripts/run-i80386-native-owned-pic-imr.mjs',R/'input.json',R/'child')
finally:os.chdir(previous)
(R/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');assert auth()==before;assert result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION';print(json.dumps(result))
