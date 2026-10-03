"""Closed PR build-only preparation. Never import/load the addon or execute a guest."""
import sys,json,hashlib,pathlib,subprocess,resource,time,os,re,signal,shutil,tarfile
sys.dont_write_bytecode=True
REVISION='0e45b736ef9792eb9b752b0a35db49eaf2faea47'
HOOKS=['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE']
FEATURES={'BX_CPU_LEVEL':3,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_USE_IDLE_HACK':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_FPU':1,'BX_PLUGINS':0}
EXPORTS=['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']
sha=lambda b:hashlib.sha256(b).hexdigest()
def regular(path,max_bytes=256<<20):
 p=pathlib.Path(path);assert p.is_absolute() and p.resolve()==p and not p.is_symlink(),'ordinary canonical role'
 st=p.lstat();assert p.is_file() and st.st_size<=max_bytes,'bounded file role';return p.read_bytes()
def absent(path):
 try:pathlib.Path(path).lstat()
 except FileNotFoundError:return True
 return False
def validate_paths(argv):
 assert len(argv)==4,'publication evidence prepared pristine roles'
 paths=[pathlib.Path(x) for x in argv];assert all(p.is_absolute() and p.resolve()==p for p in paths),'canonical absolute roles'
 W,R,T,U=paths;assert W.is_dir() and U.is_dir() and not W.is_symlink() and not U.is_symlink()
 assert len(set(paths))==4 and all(not (x in y.parents or y in x.parents) for i,x in enumerate(paths) for y in paths[i+1:]),'disjoint roles'
 assert absent(R) and absent(T),'fresh evidence/prepared roles including dangling symlinks';assert R.parent.is_dir() and T.parent.is_dir()
 return W,R,T,U
def git(root,*args):return subprocess.check_output(['git',*args],cwd=root,text=True,timeout=30).strip()
def main(argv):
 assert all(not os.environ.get(k) for k in HOOKS),'no executable hooks before any subprocess'
 W,R,T,U=validate_paths(argv);NODE=shutil.which('node');assert NODE;NODE=str(pathlib.Path(NODE).resolve())
 ENV={**os.environ,**{k:'' for k in HOOKS},'BOCHS_386_ROOT':str(U)}
 expected=ENV['BW_EXPECTED_HEAD'];assert re.fullmatch('[0-9a-f]{40}',expected)
 assert git(W,'rev-parse','HEAD')==expected and git(W,'status','--porcelain')==''
 assert git(U,'rev-parse','HEAD')==REVISION and git(U,'status','--porcelain')==''
 assert subprocess.check_output([NODE,'--version'],text=True,env=ENV,timeout=5).strip()=='v22.23.3'
 helper=pathlib.Path(__file__).resolve();assert helper==W/'scripts/ci-build-i80386-native-cold-bios.py'
 workflow=W/'.github/workflows/i80386-native-cold-bios-build.yml'
 node_before=sha(regular(NODE));helper_before=sha(regular(helper));workflow_before=sha(regular(workflow));header=pathlib.Path('/usr/include/node/node_api.h');header_before=sha(regular(header))
 source_before={p:sha(regular(W/p)) for p in git(W,'ls-files').splitlines() if (W/p).is_file() and not (W/p).is_symlink()}
 R.mkdir();(R/'source-before.json').write_text(json.dumps(source_before,indent=2)+'\n')
 def run(label,command,cwd,wall,cpu):
  def limits():
   resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20));resource.setrlimit(resource.RLIMIT_CPU,(cpu,cpu));os.nice(10)
  start=time.monotonic();timed=False;code=None
  with (R/(label+'.stdout')).open('xb') as out,(R/(label+'.stderr')).open('xb') as err:
   child=subprocess.Popen(command,cwd=cwd,stdout=out,stderr=err,env=ENV,preexec_fn=limits,start_new_session=True)
   (R/(label+'.invocation.json')).write_text(json.dumps({'command':command,'cwd':str(cwd),'pid':child.pid,'cpuSeconds':cpu,'wallSeconds':wall,'coreBytes':0,'fileBytes':256<<20,'niceIncrement':10,'blankHooks':{k:ENV[k] for k in HOOKS}},indent=2)+'\n')
   try:code=child.wait(timeout=wall)
   except subprocess.TimeoutExpired:timed=True;os.killpg(child.pid,signal.SIGKILL);code=child.wait()
   except BaseException:os.killpg(child.pid,signal.SIGKILL);code=child.wait();raise
   finally:
    (R/(label+'.exit.json')).write_text(json.dumps({'command':command,'exitCode':code,'timedOut':timed,'elapsedSeconds':time.monotonic()-start,'streams':{k:{'bytes':(R/(label+'.'+k)).stat().st_size,'sha256':sha((R/(label+'.'+k)).read_bytes())} for k in ['stdout','stderr']}},indent=2)+'\n')
  assert code==0 and not timed,label+' failed; stop without retry'
 def node(label,code,wall=30,cpu=15):run(label,[NODE,'--max-old-space-size=128','--input-type=module','-e',code],W,wall,cpu)
 status={'scope':'COLD_BIOS_BUILD_ONLY_NO_ADDON_LOAD_OR_GUEST','completed':False};prepared_before=None;identity=None;M=None
 def prepared_map():
  return {str(p.relative_to(T)):sha(regular(p)) for p in sorted(T.rglob('*')) if p.is_file() and '.git' not in p.parts and p.suffix not in ['.o','.a']}
 try:
  node('identity-before',"import {sourceIdentity} from './scripts/bochs-cpu3-native-cold-bios/identity.mjs';console.log(JSON.stringify(sourceIdentity()))")
  identity=json.loads((R/'identity-before.stdout').read_bytes());assert identity['revision']==expected
  run('prepare',[NODE,'--max-old-space-size=128','scripts/prepare-bochs-cpu3-native-cold-bios.mjs','--prepare',str(T)],W,120,120)
  raw=regular(R/'prepare.stdout');M=json.loads(raw);(R/'prepare.json').write_bytes(raw);assert M['sourceHashes']==identity['hashes'] and M['ownedClock']['abiVersion']==4 and M['preparedTree']==str(T)
  for p,h in M['sourceHashes'].items():assert sha(regular(W/p))==h and sha(subprocess.check_output(['git','show',expected+':'+p],cwd=W,env=ENV,timeout=30))==h
  for p,h in {**M['patchedHashes'],**M['actualPreparedHashes']}.items():assert sha(regular(T/p))==h
  prepared_before=prepared_map();(R/'prepared-before-build.json').write_text(json.dumps(prepared_before,indent=2)+'\n')
  assert M['configure']==['./configure','--enable-cpu-level=3','--with-nogui','--disable-plugins','--disable-debugger','--disable-repeat-speedups','--disable-handlers-chaining','--enable-instrumentation=instrument/stubs','CFLAGS=-O2 -fPIC','CXXFLAGS=-O2 -fPIC']
  assert M['build']==['nice','make','-j1','-f','Makefile','-f','bw_direct_addon.mk','bw_direct.node']
  run('configure',M['configure'],T/'bochs',180,180);run('make',M['build'][1:],T/'bochs',600,600)
  config=regular(T/'bochs/config.h').decode()
  for k,v in FEATURES.items():
   matches=re.findall(r'^#define\s+'+k+r'\s+(\d+)\s*$',config,re.M);assert len(matches)==1 and int(matches[0])==v
  addon=T/'bochs/bw_direct.node';regular(addon,8<<20)
  run('nm',['nm','-D','--defined-only',str(addon)],W,30,15);nm=regular(R/'nm.stdout').decode()
  for x in EXPORTS:assert re.search(r'\b'+x+r'$',nm,re.M)
  run('readelf',['readelf','-d',str(addon)],W,30,15)
  # Reauthenticate every prepared source file that existed before configure/make.
  for p,h in prepared_before.items():assert sha(regular(T/p))==h,'prepared input changed during build '+p
  node('identity-after',"import {sourceIdentity} from './scripts/bochs-cpu3-native-cold-bios/identity.mjs';console.log(JSON.stringify(sourceIdentity()))")
  assert json.loads(regular(R/'identity-after.stdout'))==identity
  run('compiler',['g++','--version'],W,30,15);run('platform',['uname','-a'],W,30,15);run('architecture',['uname','-m'],W,30,15)
  context={'schema':'bw.native-cold-bios-build-context.v1','sourceRevision':expected,'sourceHashes':identity['hashes'],'bochsRevision':REVISION,'preparedManifestSha256':sha(raw),'preparedHashes':M['actualPreparedHashes'],'configSha256':sha(regular(T/'bochs/config.h')),'configure':M['configure'],'build':M['build'],'nodeVersion':'v22.23.3','compilerVersion':regular(R/'compiler.stdout').decode().strip(),'platform':regular(R/'platform.stdout').decode().strip(),'architecture':regular(R/'architecture.stdout').decode().strip(),'addonLoaded':False,'nodeSha256':node_before,'nodeApiHeaderSha256':header_before,'helperSha256':helper_before,'workflowSha256':workflow_before,'requiredFeatures':FEATURES,'requiredExports':EXPORTS,'upstreamHashes':M['upstreamHashes']}
  (R/'build-context.json').write_text(json.dumps(context,indent=2)+'\n')
  receipt={'schema':'bw.native-cold-bios-build-receipt.v1','status':'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST','coldProfile':M['coldProfile'],'sourceRevision':expected,'sourceHashes':identity['hashes'],'preparedManifestPath':str(R/'prepare.json'),'preparedTree':str(T),'preparedManifestSha256':sha(raw),'preparedHashes':M['actualPreparedHashes'],'addonPath':str(addon),'addonSha256':sha(regular(addon)),'addonBytes':addon.stat().st_size,'configSha256':context['configSha256'],'requiredFeatures':FEATURES,'requiredExports':EXPORTS,'contextPath':str(R/'build-context.json'),'contextSha256':sha(regular(R/'build-context.json'))}
  (R/'build-static-preflight.json').write_text(json.dumps(receipt,indent=2)+'\n')
  inp={'addon':str(addon),'sha256':receipt['addonSha256'],'preparedManifest':str(R/'prepare.json'),'preparedManifestSha256':sha(raw),'buildReceipt':str(R/'build-static-preflight.json'),'buildReceiptSha256':sha(regular(R/'build-static-preflight.json'))}
  (R/'static-input.json').write_text(json.dumps(inp,indent=2)+'\n')
  node('static-admission',"import {readFileSync} from 'node:fs';import {sourceIdentity,authenticateBuild} from './scripts/bochs-cpu3-native-cold-bios/identity.mjs';console.log(JSON.stringify(authenticateBuild(JSON.parse(readFileSync("+json.dumps(str(R/'static-input.json'))+")),sourceIdentity())))",120,120)
  shutil.copyfile(addon,R/'bw_direct.node');shutil.copyfile(T/'bochs/config.h',R/'config.h')
  with tarfile.open(R/'prepared-source.tar.gz','w:gz') as a:
   for p in sorted(T.rglob('*')):
    if p.is_file() and '.git' not in p.parts and p.suffix not in ['.o','.a','.node']:regular(p);a.add(p,arcname=str(p.relative_to(T)),recursive=False)
  with tarfile.open(R/'frozen-source.tar.gz','w:gz') as a:
   for p in sorted(identity['hashes']):a.add(W/p,arcname=p,recursive=False)
  for n in ['COPYING','COPYING.LIB','LICENSE']:
   for root in [U,U/'bochs']:
    if(root/n).is_file():shutil.copyfile(root/n,R/('upstream-'+n))
  status.update({'completed':True,'result':'COLD_BIOS_BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST'})
 finally:
  errors={};after={}
  for p in source_before:
   try:after[p]=sha(regular(W/p))
   except Exception as e:errors[p]=repr(e)
  guards={}
  for key,fn in {'head':lambda:git(W,'rev-parse','HEAD'),'status':lambda:git(W,'status','--porcelain'),'upstreamHead':lambda:git(U,'rev-parse','HEAD'),'upstreamStatus':lambda:git(U,'status','--porcelain'),'node':lambda:sha(regular(NODE)),'helper':lambda:sha(regular(helper)),'workflow':lambda:sha(regular(workflow)),'header':lambda:sha(regular(header))}.items():
   try:guards[key]=fn()
   except Exception as e:errors[key]=repr(e)
  prepared_after={}
  if prepared_before is not None:
   try:prepared_after=prepared_map()
   except Exception as e:errors['preparedAfter']=repr(e)
   (R/'prepared-after-build.json').write_text(json.dumps(prepared_after,indent=2)+'\n')
  (R/'source-after.json').write_text(json.dumps(after,indent=2)+'\n');status.update({'sourceBeforeAfterEqual':source_before==after,'guards':guards,'errors':errors,'nodeSha256Before':node_before,'helperSha256Before':helper_before,'workflowSha256Before':workflow_before,'headerSha256Before':header_before})
  guards_valid=not errors and source_before==after and guards=={'head':expected,'status':'','upstreamHead':REVISION,'upstreamStatus':'','node':node_before,'helper':helper_before,'workflow':workflow_before,'header':header_before}
  prepared_valid=prepared_before is None or all(prepared_after.get(p)==h for p,h in prepared_before.items())
  status['preparedInputsBeforeAfterEqual']=prepared_valid;status['frozenInputsBeforeAfterEqual']=guards_valid
  if not guards_valid or not prepared_valid:status.update({'completed':False,'result':'BUILD_OR_INPUT_AUTHENTICATION_FAILURE'})
  (R/'final-status.json').write_text(json.dumps(status,indent=2)+'\n');files={str(p.relative_to(R)):{'sha256':sha(regular(p)),'bytes':p.stat().st_size} for p in sorted(R.rglob('*')) if p.is_file()};(R/'artifact-inventory.json').write_text(json.dumps({'files':files},indent=2)+'\n')
  assert not errors and source_before==after and guards=={'head':expected,'status':'','upstreamHead':REVISION,'upstreamStatus':'','node':node_before,'helper':helper_before,'workflow':workflow_before,'header':header_before},'frozen inputs changed; evidence retained'
  if prepared_before is not None:
   assert all(prepared_after.get(p)==h for p,h in prepared_before.items()),'prepared source input changed; evidence retained'
if __name__=='__main__':main(sys.argv[1:])
