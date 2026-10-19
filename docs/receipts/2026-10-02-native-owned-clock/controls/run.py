# PREPARED ONLY. Root must grant actual addon/control execution first.
import pathlib,json,hashlib,subprocess,importlib.util,os,sys,re
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True
sha=lambda b:hashlib.sha256(b).hexdigest()
# Root-authenticated approval must bind exact helper hashes and actual build inputs.
approvedBytes=(P/'approved-bindings.json').read_bytes();approved=json.loads(approvedBytes)
helpers=['run.py','child.mjs','worker.mjs','second-worker.mjs','plan.json'];before={n:sha((P/n).read_bytes()) for n in helpers};assert before==approved['helperHashes'];assert approved['revision']=='7df84bc2c367aff1cadec7cecdde69cf0e904ace'
plan=json.loads((P/'plan.json').read_text());assert len(sys.argv)==1
assert approved['configuration'] in approved['artifactHashes']
for key in ['addon','preparedManifest','buildReceipt']:assert approved['buildInput'][key] in approved['artifactHashes']
boundedPath='scripts/run-i80386-native-hot-regular-file.py';assert sha((W/boundedPath).read_bytes())==sha(subprocess.check_output(['git','show',approved['revision']+':'+boundedPath],cwd=W))==approved['boundedRunnerSha256']
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==approved['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for path,h in approved['artifactHashes'].items():assert sha(pathlib.Path(path).read_bytes())==h,path
 assert sha((W/boundedPath).read_bytes())==approved['boundedRunnerSha256']
 for path,h in approved['sourceHashes'].items():assert sha((W/path).read_bytes())==h,path
 return {'helpers':{n:sha((P/n).read_bytes()) for n in helpers},'artifacts':approved['artifactHashes'],'sourceHashes':approved['sourceHashes'],'revision':approved['revision']}
initial=auth();assert initial['helpers']==before;(P/'auth-before.json').write_text(json.dumps(initial,indent=2));records=[]
for control in plan['controls']:
 stem=P/control;stem.mkdir();config=stem/'guest.bochsrc';text=pathlib.Path(approved['configuration']).read_text();matches=list(re.finditer(r'^([ \t]*log:[ \t]*)([^\r\n]*)(\r?)$',text,re.M));assert len(matches)==1;m=matches[0];text=text[:m.start()]+m[1]+json.dumps(str(stem/'guest.bochs.log'))+m[3]+text[m.end():];config.write_text(text)
 inp={**approved['buildInput'],'control':control,'configuration':str(config),'configurationSha256':sha(config.read_bytes()),'eventsPath':str(stem/'control.jsonl')};ip=P/(control+'.input.json');ip.write_text(json.dumps(inp));previous=os.getcwd();os.chdir(W)
 try:result=bounded.run_child(NODE,P/'child.mjs',ip,P/(control+'-child'))
 finally:os.chdir(previous)
 events=[json.loads(x) for x in (stem/'control.jsonl').read_text().splitlines()];parent=[json.loads(x) for x in pathlib.Path(str(stem/'control.jsonl')+'.parent').read_text().splitlines()];names=[e['name'] for e in events];negative=control.startswith(('field-','tuple-')) or control=='phase-entry-as-postpio'
 stderr=pathlib.Path(str(P/(control+'-child'))+'.stderr').read_bytes()
 assert not result['timedOut'] and not result['fileLimitReached'],result
 if negative:
  assert result['signal']==6,result;assert 'done' not in names and 'returned' not in names and 'observer-after-mutation' not in names,names
  if control.startswith(('tuple-','field-')):assert names.count('malformed-reply')==1 and names.count('commit-applied')==1
  expected=b'owned-clock-reply' if control in ['field-debt','field-deadline'] else b'owned-state-reply' if control.startswith('field-') else b'owned-transfer-callback'
  assert b'BWSD1\tFAIL\t'+expected+b'\n' in stderr,(control,stderr[-1000:])
 else:
  assert result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',result;assert parent[-1]['name']=='authenticated-done',parent
  if control=='reentry':assert [e['op'] for e in events if e['name']=='reentry-denied']==['resume','setIRQ','inspect','close']
  if control=='thread-owner':assert [e['name'] for e in parent].count('wrong-thread-denied')==4
  if control=='second-worker':assert [e['name'] for e in parent].count('second-worker-denied')==1
  if control.startswith('invalid-'):assert names.count('query')==1 and names.count('invalid-before-query-denied')==1 and names.count('commit-enter')==0
 records.append({'control':control,'negative':negative,'exit':result,'events':events,'parentEvents':parent,'stderrSha256':sha(stderr)})
 assert auth()==initial and (P/'approved-bindings.json').read_bytes()==approvedBytes
assert {n:sha((P/n).read_bytes()) for n in helpers}==before
(P/'auth-after.json').write_text(json.dumps(auth(),indent=2));(P/'summary.json').write_text(json.dumps({'status':'ACTUAL_ABI3_CONTROLS_PASS_NOT_FULL_QUALIFICATION','records':records},indent=2));print('PASS',len(records),'fresh children')
