# Root-controlled fresh build, invoked only after frozen-source peer approval.
import sys,json,hashlib,pathlib,subprocess,resource,time,os,re,signal
W=pathlib.Path('/tmp/bw-board-386-native-owned-in8-r3-20261002')
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-in8-r3-build-20261002')
T=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-owned-in8-r3-20261002')
expected=sys.argv[1]
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(args):return subprocess.check_output(['git',*args],cwd=W).decode().strip()
assert git(['rev-parse','HEAD'])==expected and git(['status','--porcelain'])==''
R.mkdir(exist_ok=False);assert not T.exists()
source_before={p:sha((W/p).read_bytes()) for p in subprocess.check_output(['git','ls-files'],cwd=W,text=True).splitlines() if p.startswith(('scripts/','src/','test/','roms/free-at-bios/'))}
(R/'source-before.json').write_text(json.dumps(source_before,indent=2)+'\n')
def limits():
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(600,600));os.nice(10)
def run(label,command,cwd,timeout,env=None):
 start=time.monotonic();timedout=False
 with (R/(label+'.stdout')).open('xb') as out,(R/(label+'.stderr')).open('xb') as err:
  child=subprocess.Popen(command,cwd=cwd,stdout=out,stderr=err,env=env,preexec_fn=limits,start_new_session=True)
  try:code=child.wait(timeout=timeout)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait();timedout=True
 receipt={'command':command,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-start,'streams':{n:{'bytes':(R/(label+'.'+n)).stat().st_size,'sha256':sha((R/(label+'.'+n)).read_bytes())} for n in ['stdout','stderr']}}
 (R/(label+'.exit.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
 assert code==0 and not timedout and all(s['bytes']<256*1024*1024 for s in receipt['streams'].values())
env={**os.environ,'BOCHS_386_ROOT':'/tmp/bw-bochs-pristine-in8-20261002',**{k:'' for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}}
run('prepare',['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512','scripts/prepare-bochs-cpu3-native-owned-in8.mjs','--prepare',str(T)],W,120,env)
raw=(R/'prepare.stdout').read_bytes();M=json.loads(raw);assert M['ownedClock']['abiVersion']==4;(R/'prepare.json').write_bytes(raw)
for p,h in M['sourceHashes'].items():
 assert sha((W/p).read_bytes())==h
 assert sha(subprocess.check_output(['git','show',expected+':'+p],cwd=W))==h
for p,h in M['patchedHashes'].items():assert sha((T/p).read_bytes())==h
for p,h in M['actualPreparedHashes'].items():assert sha((T/p).read_bytes())==h
run('configure',M['configure'],T/'bochs',180,env)
assert M['build']==['nice','make','-j1','-f','Makefile','-f','bw_direct_addon.mk','bw_direct.node']
run('make',M['build'][1:],T/'bochs',600,env) # preexec already applies nice10 exactly once
features={'BX_CPU_LEVEL':3,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_USE_IDLE_HACK':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_FPU':1,'BX_PLUGINS':0}
cfg=(T/'bochs/config.h').read_text()
for k,v in features.items():assert int(re.search(r'^#define\s+'+k+r'\s+(\d+)',cfg,re.M).group(1))==v
exports=['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']
addon=T/'bochs/bw_direct.node';nm=subprocess.check_output(['nm','-D','--defined-only',str(addon)],text=True)
(R/'addon-nm-defined.txt').write_text(nm)
for x in exports:assert re.search(r'\b'+x+r'$',nm,re.M)
ldd=subprocess.check_output(['ldd',str(addon)],text=True);assert 'not found' not in ldd;(R/'addon-ldd.txt').write_text(ldd)
run('identity',['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512','--input-type=module','-e',"import {sourceIdentity} from './scripts/bochs-cpu3-native-owned-in8/identity.mjs';console.log(JSON.stringify(sourceIdentity()))"],W,120,env)
identity=json.loads((R/'identity.stdout').read_bytes())
receipt={'schema':'bw.owned-clock-build-receipt.v1','status':'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST','sourceRevision':expected,'sourceHashes':identity['hashes'],'preparedManifestPath':str(R/'prepare.json'),'preparedTree':str(T),'preparedManifestSha256':sha(raw),'preparedHashes':M['actualPreparedHashes'],'addonPath':str(addon),'addonSha256':sha(addon.read_bytes()),'addonBytes':addon.stat().st_size,'configSha256':sha((T/'bochs/config.h').read_bytes()),'requiredFeatures':features,'requiredExports':exports,'helperSha256':sha(pathlib.Path(__file__).read_bytes())}
assert git(['rev-parse','HEAD'])==expected and git(['status','--porcelain'])==''
assert all(sha((W/p).read_bytes())==h for p,h in source_before.items())
original_config=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002/guest-source.bochsrc').read_bytes();assert sha(original_config)=='5683c4731d60804502b17ee0653085ef761137199878880b3b5ed64fd0a49d3d'
(R/'guest-source.bochsrc').write_bytes(original_config)
assets={}
for name,h in [('BIOS-bochs-legacy','6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),('vgabios-lgpl.bin','76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1')]:
 assert sha((W/'roms/free-at-bios'/name).read_bytes())==h;assets[name]=h
(R/'guest-config-binding.json').write_text(json.dumps({'configurationSha256':sha(original_config),'scope':'exact original free config bytes and BIOS asset paths retained; no new ROM path rewrite','assets':assets},indent=2)+'\n')
(R/'build-static-preflight.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
