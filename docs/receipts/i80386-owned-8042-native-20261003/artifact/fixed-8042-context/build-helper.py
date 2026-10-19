"""Reviewed PR-only first build, then two bounded fixed-ROM semantic children."""
import sys,json,hashlib,pathlib,subprocess,resource,time,os,re,signal,shutil,tarfile
assert len(sys.argv)==5
W,R,T,U=map(lambda x:pathlib.Path(x).resolve(),sys.argv[1:])
NODE=shutil.which('node');assert NODE
HOOKS=['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE']
ENV={**os.environ,**{k:'' for k in HOOKS},'BOCHS_386_ROOT':str(U)}
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(root,*args):return subprocess.check_output(['git',*args],cwd=root,text=True,timeout=30).strip()
expected=os.environ['BW_EXPECTED_HEAD'];assert re.fullmatch('[0-9a-f]{40}',expected)
assert git(W,'rev-parse','HEAD')==expected and git(W,'status','--porcelain')==''
assert git(U,'rev-parse','HEAD')=='0e45b736ef9792eb9b752b0a35db49eaf2faea47' and git(U,'status','--porcelain')==''
assert subprocess.check_output([NODE,'--version'],text=True,timeout=5).strip()=='v22.23.3'
R.mkdir(exist_ok=False);assert not T.exists()
helper=pathlib.Path(__file__).resolve();node_before=sha(pathlib.Path(NODE).read_bytes());helper_before=sha(helper.read_bytes())
source_before={p:sha((W/p).read_bytes())for p in git(W,'ls-files').splitlines()if p.startswith(('src/','scripts/','test/','roms/free-at-bios/','.github/workflows/i80386-native-owned-8042-build.yml'))}
(R/'source-before.json').write_text(json.dumps(source_before,indent=2)+'\n')
def run(label,command,cwd,wall,cpu,env=ENV):
 def limits():
  resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20));resource.setrlimit(resource.RLIMIT_CPU,(cpu,cpu));os.nice(10)
 start=time.monotonic();timedout=False;code=None
 with (R/(label+'.stdout')).open('xb')as out,(R/(label+'.stderr')).open('xb')as err:
  child=subprocess.Popen(command,cwd=cwd,stdout=out,stderr=err,env=env,preexec_fn=limits,start_new_session=True)
  (R/(label+'.invocation.json')).write_text(json.dumps({'command':command,'cwd':str(cwd),'pid':child.pid,'cpuSeconds':cpu,'wallSeconds':wall,'coreBytes':0,'fileBytes':256<<20,'niceIncrement':10,'blankHooks':{k:env[k]for k in HOOKS}},indent=2)+'\n')
  try:code=child.wait(timeout=wall)
  except subprocess.TimeoutExpired:
   timedout=True;os.killpg(child.pid,signal.SIGKILL);code=child.wait()
  except BaseException:
   os.killpg(child.pid,signal.SIGKILL);code=child.wait();raise
  finally:
   receipt={'command':command,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-start,'streams':{k:{'bytes':(R/(label+'.'+k)).stat().st_size,'sha256':sha((R/(label+'.'+k)).read_bytes())}for k in ['stdout','stderr']}}
   (R/(label+'.exit.json')).write_text(json.dumps(receipt,indent=2)+'\n')
 assert code==0 and not timedout,label+' failed; no later child or retry'
def node(label,code,wall=30,cpu=10):run(label,[NODE,'--max-old-space-size=128','--input-type=module','-e',code],W,wall,cpu)
status={'scope':'First new fixed-ROM build and semantic qualification; no speed/broader AT claim','completed':False};prepared_before=None
def prepared_map():
 return {str(p.relative_to(T)):sha(p.read_bytes())for p in sorted(T.rglob('*'))if p.is_file()and '.git'not in p.parts and p.suffix not in ['.o','.a']}
try:
 node('identity-before',"import {sourceIdentity}from './scripts/bochs-cpu3-native-owned-8042/identity.mjs';console.log(JSON.stringify(sourceIdentity()))")
 identity=json.loads((R/'identity-before.stdout').read_bytes());assert identity['revision']==expected
 run('prepare',[NODE,'--max-old-space-size=512','scripts/prepare-bochs-cpu3-native-owned-8042.mjs','--prepare',str(T)],W,120,120)
 raw=(R/'prepare.stdout').read_bytes();M=json.loads(raw);(R/'prepare.json').write_bytes(raw);assert M['sourceHashes']==identity['hashes'] and M['ownedClock']['abiVersion']==4
 for p,h in M['sourceHashes'].items():assert sha((W/p).read_bytes())==h and sha(subprocess.check_output(['git','show',expected+':'+p],cwd=W,timeout=30))==h
 for p,h in {**M['patchedHashes'],**M['actualPreparedHashes']}.items():assert sha((T/p).read_bytes())==h
 run('configure',M['configure'],T/'bochs',180,180)
 assert M['build']==['nice','make','-j1','-f','Makefile','-f','bw_direct_addon.mk','bw_direct.node']
 run('make',M['build'][1:],T/'bochs',600,600)
 features={'BX_CPU_LEVEL':3,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_USE_IDLE_HACK':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_FPU':1,'BX_PLUGINS':0}
 config=(T/'bochs/config.h').read_text()
 for k,v in features.items():assert int(re.search(r'^#define\s+'+k+r'\s+(\d+)',config,re.M).group(1))==v
 exports=['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']
 addon=T/'bochs/bw_direct.node';nm=subprocess.check_output(['nm','-D','--defined-only',str(addon)],text=True,timeout=30);(R/'addon-nm-defined.txt').write_text(nm)
 for x in exports:assert re.search(r'\b'+x+r'$',nm,re.M)
 ldd=subprocess.check_output(['ldd',str(addon)],text=True,timeout=30);(R/'addon-ldd.txt').write_text(ldd);assert 'not found' not in ldd
 receipt={'schema':'bw.owned-clock-build-receipt.v1','status':'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST','sourceRevision':expected,'sourceHashes':identity['hashes'],'preparedManifestPath':str(R/'prepare.json'),'preparedTree':str(T),'preparedManifestSha256':sha(raw),'preparedHashes':M['actualPreparedHashes'],'addonPath':str(addon),'addonSha256':sha(addon.read_bytes()),'addonBytes':addon.stat().st_size,'configSha256':sha((T/'bochs/config.h').read_bytes()),'requiredFeatures':features,'requiredExports':exports,'helperSha256':helper_before,'native8042Profile':M['native8042Profile']}
 (R/'build-static-preflight.json').write_text(json.dumps(receipt,indent=2)+'\n')
 # Preserve a reusable compiled artifact and exact transformed sources/licenses.
 shutil.copyfile(addon,R/'bw_direct.node');shutil.copyfile(T/'bochs/config.h',R/'config.h')
 with tarfile.open(R/'prepared-source.tar.gz','w:gz')as a:
  for p in sorted(T.rglob('*')):
   if p.is_file()and '.git'not in p.parts and p.suffix not in ['.o','.a','.node']:a.add(p,arcname=str(p.relative_to(T)),recursive=False)
 with tarfile.open(R/'frozen-source.tar.gz','w:gz')as a:
  for p in sorted(identity['hashes']):a.add(W/p,arcname=p,recursive=False)
 for n in ['COPYING','COPYING.LIB','LICENSE']:
  for root in [U,U/'bochs']:
   if(root/n).is_file():shutil.copyfile(root/n,R/('upstream-'+n))
 prepared_before=prepared_map();(R/'prepared-before-guests.json').write_text(json.dumps(prepared_before,indent=2)+'\n')
 node('reference',"import {captureReference}from './scripts/bochs-cpu3-native-owned-8042/reference.mjs';console.log(JSON.stringify(captureReference()))")
 reference=R/'reference.json';reference.write_bytes((R/'reference.stdout').read_bytes())
 node('configuration',"import {canonicalConfiguration}from './scripts/bochs-cpu3-native-owned-8042/identity.mjs';process.stdout.write(canonicalConfiguration("+json.dumps(str(R/'guest.bochs.log'))+"))")
 configuration=R/'guest-source.bochsrc';configuration.write_bytes((R/'configuration.stdout').read_bytes())
 inputs=[]
 for mode,trace in [('off',False),('on',True)]:
  inp={'addon':str(addon),'sha256':receipt['addonSha256'],'configuration':str(configuration),'output':str(R/mode),'preparedManifest':str(R/'prepare.json'),'preparedManifestSha256':sha(raw),'buildReceipt':str(R/'build-static-preflight.json'),'buildReceiptSha256':sha((R/'build-static-preflight.json').read_bytes()),'reference':str(reference),'referenceSha256':sha(reference.read_bytes()),'nativeTrace':trace}
  path=R/(mode+'.input.json');path.write_text(json.dumps(inp,indent=2)+'\n');inputs.append(inp)
  # The Node runner spawns only ordinary Git admission subprocesses, all in
  # this process group. Addon CPU executes in this same main process.
  run(mode,[NODE,'--max-old-space-size=128','scripts/run-i80386-native-owned-8042.mjs',str(path)],W,60,30)
 node('compare',"import {readFileSync}from 'node:fs';import {compareNativeReference,compareNativeModes,compareNativePorts}from './scripts/bochs-cpu3-native-owned-8042/reference.mjs';const root="+json.dumps(str(R))+";const load=p=>JSON.parse(readFileSync(root+'/'+p));const r=load('reference.json'),off=load('off/capture.json'),on=load('on/capture.json');console.log(JSON.stringify({off:compareNativeReference(off,r),on:compareNativeReference(on,r),modes:compareNativeModes(off,on),ports:compareNativePorts(readFileSync(root+'/on.stderr','utf8'),r)}));")
 status['completed']=True;status['result']='FIRST_FIXED_8042_BUILD_AND_TWO_NATIVE_SEMANTIC_CELLS_PASS_PENDING_INDEPENDENT_ARTIFACT_AUDIT'
finally:
 # Persist complete after maps and failures even when build/guest/audit fails.
 after={};errors={}
 for p in source_before:
  try:after[p]=sha((W/p).read_bytes())
  except Exception as e:errors[p]=repr(e)
 guards={}
 for key,fn in {'head':lambda:git(W,'rev-parse','HEAD'),'status':lambda:git(W,'status','--porcelain'),'upstreamHead':lambda:git(U,'rev-parse','HEAD'),'node':lambda:sha(pathlib.Path(NODE).read_bytes()),'helper':lambda:sha(helper.read_bytes())}.items():
  try:guards[key]=fn()
  except Exception as e:errors[key]=repr(e)
 prepared_after={}
 if prepared_before is not None:
  try:prepared_after=prepared_map()
  except Exception as e:errors['preparedAfter']=repr(e)
  (R/'prepared-after-guests.json').write_text(json.dumps(prepared_after,indent=2)+'\n');status['preparedBeforeAfterEqual']=prepared_before==prepared_after
 (R/'source-after.json').write_text(json.dumps(after,indent=2)+'\n');status.update({'beforeAfterEqual':source_before==after,'guards':guards,'errors':errors,'nodeSha256Before':node_before,'helperSha256Before':helper_before})
 (R/'final-status.json').write_text(json.dumps(status,indent=2)+'\n')
 files={str(p.relative_to(R)):{'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}for p in sorted(R.rglob('*'))if p.is_file()};(R/'artifact-inventory.json').write_text(json.dumps({'files':files},indent=2)+'\n')
 assert not errors and source_before==after and (prepared_before is None or prepared_before==prepared_after) and guards=={'head':expected,'status':'','upstreamHead':'0e45b736ef9792eb9b752b0a35db49eaf2faea47','node':node_before,'helper':helper_before},'source/prepared/helper/node provenance changed; receipts retained'
