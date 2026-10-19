"""Unprivileged fixed c26 restoration only; never qualifier guest main or sampler."""
import sys
sys.dont_write_bytecode=True
import os,json,hashlib,subprocess,importlib.util,pwd
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WS=Path('/home/runner/work/bw-board/bw-board');OUT=Path('/home/runner/work/_temp/cold-ledger-scalars-native-symbol')
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
ENV_KEYS=('HOME','USER','LOGNAME','PATH','LANG','LC_ALL','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME')
def require(ok,message):
 if not ok:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def source():
 head=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip();require(not subprocess.check_output(['git','-C',str(ROOT),'status','--porcelain']),'clean diagnostic source')
 context=json.loads((HERE/'held-source-context.json').read_bytes());files={}
 paths=list(context['hashes'])+[str(p.relative_to(ROOT)) for p in HERE.iterdir() if p.is_file()]+['test/i80386-cold-ledger-scalars-symbol-profile-source.test.mjs']
 for name in sorted(set(paths)):
  raw=(ROOT/name).read_bytes();h=sha(raw);require(h==sha(subprocess.check_output(['git','-C',str(ROOT),'show',head+':'+name])),'diagnostic current/Git '+name)
  if name in context['hashes']:require(h==context['hashes'][name],'unchanged qualified base '+name)
  files[name]=h
 return {'revision':head,'hashes':files}
def main():
 b=json.loads((HERE/'profile-binding.json').read_bytes());require(b['status']=='ROOT_REVIEWED_NATIVE_SYMBOL_DIAGNOSTIC_READY','PENDING before setup/import/download or recorder')
 require(ROOT==WS/'symbol-worker' and os.geteuid()>0 and not OUT.exists(),'fixed ordinary-owner source/exclusive output')
 require(all(not os.environ.get(h) for h in HOOKS),'blank hooks');node=os.environ['BW_COLD_NODE'];require(sha(Path(node).read_bytes())==b['nodeSha256'],'exact Node bytes')
 own_before=source();require(own_before['revision']==os.environ['GITHUB_SHA'],'actual dispatch source HEAD')
 qroot=WS/'qualifier';qb=(HERE/'qualifier-source-context.json').read_bytes();require(sha(qb)==b['qualifierSourceContextSha256'],'fixed qualifier context');qcxt=json.loads(qb)
 require(subprocess.check_output(['git','-C',str(qroot),'rev-parse','HEAD'],text=True).strip()==qcxt['revision'] and not subprocess.check_output(['git','-C',str(qroot),'status','--porcelain']),'frozen clean qualifier')
 for name,h in qcxt['hashes'].items():require(sha((qroot/name).read_bytes())==h==sha(subprocess.check_output(['git','-C',str(qroot),'show',qcxt['revision']+':'+name])),'qualifier current/Git '+name)
 sys.path.insert(0,str(qroot/'scripts/cold-ledger-scalars-qualification'));import qualify as q
 c=q.contract(q.read_json(q.HERE/'contract.json'));OUT.mkdir();out=OUT/'setup';out.mkdir();report={'status':'FAIL','scope':'Fixed frozen q.setup only; no qualifier guest main, addon load, recorder or sampling'};primary=None;initial=None
 try:
  native_binding,data=q.setup(c,Path(node),out,report);initial=q.restored(c,Path(node),out);q.write(out/'restored-before.json',initial)
  data.update(output=b['output'],workerRevision=own_before['revision'],workerSourceSha256=sha(json.dumps(own_before,separators=(',',':')).encode()))
  q.write(OUT/'input.json',data);ordinary={k:os.environ[k] for k in ENV_KEYS if k in os.environ};account=pwd.getpwuid(os.getuid());require(ordinary.get('HOME')==account.pw_dir,'ordinary owner HOME')
  pins={**initial['records'],**q.original_inputs(out)}
  for p in (out/'restored-before.json',OUT/'input.json',*HERE.iterdir()):
   if p.is_file():pins[str(p)]=q.fingerprint(p)
  record={'schema':'bw.cold-ledger-scalars.native-symbol.setup.v1','status':'STATIC_RESTORE_SOURCE_AUTH_PASS_NO_GUEST_OR_RECORDER','uid':os.getuid(),'gid':os.getgid(),'environment':ordinary,'worker':{'root':str(ROOT),'revision':own_before['revision'],'sourceSha256':data['workerSourceSha256'],'entry':'scripts/cold-native-ledger-scalars-symbol-profile/worker.mjs','files':own_before['hashes']},'compiledFiles':native_binding['compiledFiles'],'nativeBinding':native_binding,'node':node,'pinnedFiles':pins,'qualifierSourceContext':qcxt}
  # Semantic validator later uses the diagnostic role identity and unchanged held lock.
  record['nativeBinding']['workers']['native']={**record['worker'],'binding':'scripts/cold-native-memory-fusion-ledger-scalars-performance/capture-binding.json'}
  q.write(OUT/'setup-record.json',record);report['status']=record['status']
 except BaseException as error:primary=error;report['error']=repr(error);raise
 finally:
  guards=[('diagnosticSourceAfter',source,own_before)]
  if 'sourceBeforeSetup' in report:guards.append(('sourcesAfter',lambda:q.sources(c,Path(node)),report['sourceBeforeSetup']))
  if 'inputsBeforeRestore' in report:guards.append(('originalInputsAfter',lambda:q.original_inputs(out),report['inputsBeforeRestore']))
  if initial is not None:guards.append(('restoredAfter',lambda:q.restored(c,Path(node),out),initial))
  errors={}
  for name,read,expected in guards:
   try:report[name]=read();require(report[name]==expected,name+' unchanged')
   except BaseException as error:errors[name]=repr(error)
  if errors:report['status']='FAIL';report['finalizationErrors']=errors
  q.write(out/'setup-result.json',report)
  if errors and primary is None:raise ValueError('retained setup finalization failures')
if __name__=='__main__':
 require(len(sys.argv)==1,'no caller role/path authority');main()
