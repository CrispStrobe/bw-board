# PREPARED ONLY: execution requires root grant and approved immutable bindings.
from pathlib import Path
import json,hashlib,subprocess,importlib.util,os,sys
P=Path(__file__).resolve().parent;W=Path('/tmp/bw-board-386-native-owned-in8-r2-20261002');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True
sha=lambda b:hashlib.sha256(b).hexdigest()
raw=(P/'approved-bindings.json').read_bytes();approved=json.loads(raw);helpers=['run.py','child.mjs','wrong-thread.mjs','plan.json','bounded.py','bounded-derivation.json'];pins={p:sha((P/p).read_bytes())for p in helpers};assert pins==approved['helperHashes'];assert approved['revision']=='6b975da14342bc040082142568a539605f580fd7'
boundedPath=W/'scripts/run-i80386-native-hot-regular-file.py';assert sha(boundedPath.read_bytes())==approved['boundedRunnerSha256'];spec=importlib.util.spec_from_file_location('bounded',P/'bounded.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==approved['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for p,h in approved['sourceHashes'].items():
  assert sha((W/p).read_bytes())==h;assert sha(subprocess.check_output(['git','show',approved['revision']+':'+p],cwd=W))==h
 for p,h in approved['artifactHashes'].items():assert sha(Path(p).read_bytes())==h
 assert {p:sha((P/p).read_bytes())for p in helpers}==pins;assert (P/'approved-bindings.json').read_bytes()==raw
 return {'revision':approved['revision'],'sourceHashes':approved['sourceHashes'],'artifactHashes':approved['artifactHashes'],'helperHashes':pins,'launchBlankEnvironment':{k:os.environ[k]for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}}
blankEnvironment={k:''for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']};os.environ.update(blankEnvironment)
initial=auth();initial['launchBlankEnvironment']=blankEnvironment;(P/'auth-before.json').write_text(json.dumps(initial,indent=2));records=[]
for control in json.loads((P/'plan.json').read_text())['controls']:
 output=P/control;output.mkdir();inp={**approved['buildInput'],'configuration':approved['configuration'],'control':control,'output':str(output),'legacyABI3Addon':approved['legacyABI3Addon']};ip=P/(control+'.input.json');ip.write_text(json.dumps(inp));previous=os.getcwd();os.chdir(W)
 try:result=bounded.run_child(NODE,P/'child.mjs',ip,P/(control+'-child'))
 finally:os.chdir(previous)
 events=[json.loads(x)for x in (output/'events.jsonl').read_text().splitlines()];names=[e['name']for e in events];stderr=Path(str(P/(control+'-child'))+'.stderr').read_bytes();negative=control.startswith(('clock-','memory-','in-reply-'));assert not result['timedOut']and not result['fileLimitReached']
 if negative:
  assert result['signal']==6
  if control.startswith('in-reply-'):
   tag=b'owned-IN8-reply'if control in ['in-reply-byte','in-reply-epoch','in-reply-a20']else b'owned-IN8-callback';assert b'BWSD1\tFAIL\t'+tag+b'\n'in stderr
   assert names.count('actual-IN-read-effect')==1 and names.count('mutation-after-IN-effect')==1;assert not set(names)&{'observer-after-attack','unexpected-resume-return','done'}
   effect=next(e for e in events if e['name']=='actual-IN-read-effect');mutation=next(e for e in events if e['name']=='mutation-after-IN-effect');assert effect['args']==[0x40,1]and effect['value']==mutation['byte'];assert mutation['logicalAfter']==mutation['logicalBefore']+1
   assert events.index(effect)<events.index(mutation) and effect['ordinal']<mutation['ordinal'];assert b'BWSD1\tPORT\tin\t'not in stderr
   canonical=[line.split(b'\t')for line in stderr.splitlines()if line.startswith(b'BWSD1\t')]
   assert effect['n']==17 and effect['q']==17 and effect['value']==50
   assert any(parts[1]==b'ATTEMPT' and parts[2]==b'f000' and parts[3]==b'00000122' and parts[4:6]==[b'17',b'17'] and parts[9]==b'e440' for parts in canonical if len(parts)>9)
   assert any(parts[1]==b'NATIVE_TICK'and int(parts[4])==effect['n'] for parts in canonical if len(parts)==7)
   quanta=[parts for parts in canonical if len(parts)==12 and parts[1]==b'QUANTUM'];assert quanta
   assert max(int(parts[9]) for parts in quanta)==effect['q']
   assert not any(int(parts[10])>=effect['n']for parts in quanta)
  else:
   tag=b'owned-transfer-callback'if control.startswith('clock-')else b'direct-memory-callback';assert b'BWSD1\tFAIL\t'+tag+b'\n'in stderr
   assert names.count('attack-before-effect')==1 and names.count('nested-denied')==1;assert not set(names)&{'observer-after-attack','unexpected-nested-success','unexpected-resume-return','done'}
   before=next(x for x in events if x['name']=='attack-before-effect');denied=next(x for x in events if x['name']=='nested-denied');assert before['logical']==denied['logical']
 else:
  assert result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION'and names[-1]=='done'
  required={'second-create':'second-create-denied','failed-capture':'capture-denied-before-callback','wrong-thread':'wrong-thread-denied','abi3-denied':'abi3-denied-before-create','old-rom-denied':'old-rom-denied-before-INIT'}[control];assert names.count(required)==1
 records.append({'control':control,'negativeFatal':negative,'exit':result,'events':events,'stderrSha256':sha(stderr)});assert auth()==initial
(P/'auth-after.json').write_text(json.dumps(auth(),indent=2));(P/'summary.json').write_text(json.dumps({'status':'IN8_NATIVE_GUARD_CONTROLS_PASS_NOT_FULL_QUALIFICATION','records':records},indent=2));print('PASS',len(records),'fresh main-thread children')
