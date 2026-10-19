# Prepared only: root-approved one native and one historical JS diagnostic.
import pathlib,json,hashlib,subprocess,os,sys,importlib.util
P=pathlib.Path(__file__).parent;mode=sys.argv[1];assert mode in ['native','js'];A=json.loads((P/'approved-bindings.json').read_bytes());raw=(P/'approved-bindings.json').read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest();W=pathlib.Path(A[mode]['worktree']);B=A[mode];R=P/(mode+'-actual');assert not R.exists()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
def auth():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==B['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
 for path,h in B['sourceHashes'].items():assert sha((W/path).read_bytes())==h and sha(subprocess.check_output(['git','show',B['revision']+':'+path],cwd=W))==h
 for path,h in A['artifactHashes'].items():assert sha(pathlib.Path(path).read_bytes())==h
 for path,h in A['helperHashes'].items():assert sha((P/path).read_bytes())==h
 assert (P/'approved-bindings.json').read_bytes()==raw
 return {'mode':mode,'bindingSha256':sha(raw),'sourceHashes':B['sourceHashes'],'artifactHashes':A['artifactHashes'],'helperHashes':A['helperHashes'],'blankEnvironment':{k:os.environ[k]for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}}
before=auth();R.mkdir();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n');spec=importlib.util.spec_from_file_location('bounded',P/'bounded.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
if mode=='native':
 inp={**A['buildInput'],'configuration':A['configuration'],'baseline':A['baseline'],'baselineSha256':'bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e','output':str(R/'guest'),'nativeTrace':False,'hostJournal':False};assert len(inp)==12;(R/'input.json').write_text(json.dumps(inp,indent=2)+'\n');arg=R/'input.json';entry=P/'runner.mjs'
else:arg=R/'guest';entry=P/'js-runner.mjs'
previous=os.getcwd();os.chdir(W)
try:result=bounded.run_child('/tmp/node-v22.23.3-linux-x64/bin/node',entry,arg,R/'child')
finally:os.chdir(previous)
assert not result['timedOut'] and not result['fileLimitReached'] and result['signal'] is None and result['error'] is None
if mode=='native':
 assert result['returncode']==1;stderr=(R/'child.stderr').read_bytes();assert b'AssertionError'in stderr and b'ecb57a4b83090fcf232c4bd2f7019cdfde992bdc8ecf708e04bdc1de9272733a'in stderr and b'8bbabd33892728f64bae9b9a558ba106112aef5024196e10aa037e45d0ca7344'in stderr
else:
 assert result['returncode']==0 and result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION'
 assert sha((R/'guest/capture.json').read_bytes())=='bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e'
after=auth();assert before==after;(R/'auth-after.json').write_text(json.dumps(after,indent=2)+'\n');(R/'diagnostic-exit.json').write_text(json.dumps(result,indent=2)+'\n');ram=(R/'guest/diagnostic-ram.bin').read_bytes();expected={'native':'ecb57a4b83090fcf232c4bd2f7019cdfde992bdc8ecf708e04bdc1de9272733a','js':'8bbabd33892728f64bae9b9a558ba106112aef5024196e10aa037e45d0ca7344'}[mode];assert sha(ram)==expected
print(json.dumps({'status':'DIAGNOSTIC_RAM_ANCHOR_MATCH_NOT_QUALIFICATION','mode':mode,'ramSha256':sha(ram),'exit':result}))
