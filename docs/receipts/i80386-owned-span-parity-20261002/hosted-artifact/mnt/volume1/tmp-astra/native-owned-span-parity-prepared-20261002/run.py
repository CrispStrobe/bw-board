#!/usr/bin/env python3
"""Run one specifically granted parity cell; preparation/imports launch nothing."""
import hashlib,importlib.util,json,os,pathlib,subprocess,sys,datetime
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).resolve().parent
BLANK=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
HELPERS=('run.py','parity.py','bounded.py','plan.json','helper-derivation.json')
def sha(path):
 h=hashlib.sha256()
 with pathlib.Path(path).open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def safe(path):
 try:return {'sha256':sha(path),'bytes':pathlib.Path(path).stat().st_size}
 except Exception as e:return {'sha256':None,'error':type(e).__name__+': '+str(e)}
def persist(path,v):path.write_text(json.dumps(v,indent=2)+'\n')
def heads(b):
 result={}
 for tag,path in [('runtime',b['runtimeWorktree']),('compiled',b['compiledWorktree'])]:
  try:
   r=subprocess.run(['git','-C',path,'rev-parse','HEAD'],capture_output=True,text=True,timeout=30);result[tag]={'exitCode':r.returncode,'head':r.stdout.strip(),'stderr':r.stderr}
  except Exception as e:result[tag]={'exitCode':None,'head':None,'error':type(e).__name__+': '+str(e)}
 return result
def git_map(root,revision,expected):
 result={}
 try:
  refs=[revision+':'+name for name in expected]
  raw=subprocess.run(['git','-C',str(root),'cat-file','--batch'],input=('\n'.join(refs)+'\n').encode(),capture_output=True,timeout=30)
  if raw.returncode:raise RuntimeError(raw.stderr.decode(errors='replace'))
  cursor=0
  for name in expected:
   end=raw.stdout.index(b'\n',cursor);header=raw.stdout[cursor:end].split();assert len(header)==3 and header[1]==b'blob';size=int(header[2]);start=end+1;data=raw.stdout[start:start+size];assert len(data)==size and raw.stdout[start+size:start+size+1]==b'\n';cursor=start+size+1;result[name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':size}
  assert cursor==len(raw.stdout)
 except Exception as e:result={'error':type(e).__name__+': '+str(e)}
 return result
def snapshot(b):
 result={'runtime':{},'compiled':{},'artifacts':{},'helpers':{},'gitHeads':heads(b),'node':safe(b['node']),'binding':safe(P/'approved-bindings.json')}
 for tag,root,maps in [('runtime',pathlib.Path(b['runtimeWorktree']),b['sourceHashes']),('compiled',pathlib.Path(b['compiledWorktree']),b['compiledSourceHashes']),('artifacts',pathlib.Path('/'),b['artifactHashes'])]:
  result[tag]={name:safe(root/name) for name in maps}
 result['helpers']={name:safe(P/name) for name in HELPERS}
 result['runtimeGit']=git_map(b['runtimeWorktree'],b['revision'],b['sourceHashes']);result['compiledGit']=git_map(b['compiledWorktree'],b['compiledRevision'],b['compiledSourceHashes']);return result
def authenticate(s,b):
 assert len(b['sourceHashes'])==b['runtimeSourceCount']==116 and b['frozenSpanSourceCount']==110 and len(b['compiledSourceHashes'])==b['compiledSourceCount']==103
 assert all(b['sourceHashes'][p]==h for p,h in b['compiledSourceHashes'].items())
 for tag,expected in [('runtime',b['sourceHashes']),('compiled',b['compiledSourceHashes']),('runtimeGit',b['sourceHashes']),('compiledGit',b['compiledSourceHashes']),('artifacts',b['artifactHashes']),('helpers',b['helperHashes'])]:
  assert set(s[tag])==set(expected)
  for name,h in expected.items():assert s[tag][name]['sha256']==h and 'error' not in s[tag][name],tag+' '+name
 for tag,head in [('runtime',b['revision']),('compiled',b['compiledRevision'])]:assert s['gitHeads'][tag]['exitCode']==0 and s['gitHeads'][tag]['head']==head
 assert s['node']['sha256']==b['nodeSha256']
 for name in ['driver','baselineNativeCapture','baselineNativeTrace','baselineNativeJournal','baseline','configuration']:assert b[name]in b['artifactHashes']
def main():
 assert len(sys.argv)==2;label=sys.argv[1];assert label in ['smoke-off','fulltrace-on','trace-fast'];R=P/label;R.mkdir(exist_ok=False)
 for k in BLANK:os.environ[k]=''
 raw=(P/'approved-bindings.json').read_bytes();b=json.loads(raw);before=snapshot(b);persist(R/'auth-before.json',before)
 record={'status':'PARITY_CELL_PRELAUNCH_PENDING_NO_CHILD','label':label,'sourceRevision':b['revision'],'frozenSpanRevision':b['frozenSpanRevision'],'compiledRevision':b['compiledRevision'],'before':before,'blankEnvironment':{k:os.environ[k] for k in BLANK},'childLaunched':False,'scope':'One semantic parity cell, no CPU gate/adoption or expanded guest admission.'};persist(R/'invocation.json',record);childResult=None
 try:
  authenticate(before,b)
  value={**b['buildInput'],'configuration':b['configuration'],'baseline':b['baseline'],'baselineSha256':'bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e','output':str(R/'guest'),'nativeTrace':label!='smoke-off','hostJournal':label=='fulltrace-on'};assert len(value)==12
  persist(R/'input.json',value);record['inputSha256']=sha(R/'input.json');persist(R/'invocation.json',record)
  spec=importlib.util.spec_from_file_location('span_parity_bounded',P/'bounded.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
  record['childLaunched']=True;childResult=bounded.run_child(b['node'],pathlib.Path(b['driver']),R/'input.json',R/'child',heap_mib=512,timeout_seconds=120,max_file_mib=256);record['childResult']=childResult
 except Exception as e:record['executionError']=type(e).__name__+': '+str(e)
 finally:
  after=snapshot(b);record['after']=after;persist(R/'auth-after.json',after);record['endedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();record['status']='PARITY_CELL_EXECUTION_RECORDED_BEFORE_ASSERTIONS';persist(R/'execution.json',record)
 success=False
 try:
  if record.get('executionError') or childResult is None or childResult['status']!='CHILD_EXIT_PASS_NOT_QUALIFICATION':raise RuntimeError('child/authentication failure; retain raw evidence, no retry')
  authenticate(after,b)
  if before!=after or (P/'approved-bindings.json').read_bytes()!=raw:raise RuntimeError('source/artifact/helper/node/binding/Git changed')
  if sha(R/'input.json')!=record['inputSha256']:raise RuntimeError('cell input changed')
  record['status']='ONE_CELL_CHILD_PASS_INPUTS_UNCHANGED_AWAITING_FULL_PARITY_AUDIT';success=True
 except Exception as e:record['status']='PARITY_CELL_AUTH_CHILD_OR_RESULT_FAILED';record['resultValidationError']=type(e).__name__+': '+str(e)
 persist(R/'execution.json',record);print(json.dumps({'status':record['status'],'label':label,'childResult':childResult}));return 0 if success else 1
if __name__=='__main__':raise SystemExit(main())
