# Root-controlled fresh build, invoked only after frozen-source peer approval.
import sys,json,hashlib,pathlib,subprocess,resource,time,os,re
W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002')
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002')
T=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-owned-clock-20261002')
expected=sys.argv[1]
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(args):return subprocess.check_output(['git',*args],cwd=W).decode().strip()
assert git(['rev-parse','HEAD'])==expected and git(['status','--porcelain'])==''
R.mkdir(exist_ok=False);assert not T.exists()
def limits():
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(600,600));os.nice(10)
def run(label,command,cwd,timeout,env=None):
 start=time.monotonic();timedout=False
 with (R/(label+'.stdout')).open('xb') as out,(R/(label+'.stderr')).open('xb') as err:
  try:r=subprocess.run(command,cwd=cwd,stdout=out,stderr=err,timeout=timeout,env=env,preexec_fn=limits);code=r.returncode
  except subprocess.TimeoutExpired:code=None;timedout=True
 receipt={'command':command,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-start,'streams':{n:{'bytes':(R/(label+'.'+n)).stat().st_size,'sha256':sha((R/(label+'.'+n)).read_bytes())} for n in ['stdout','stderr']}}
 (R/(label+'.exit.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
 assert code==0 and not timedout and all(s['bytes']<256*1024*1024 for s in receipt['streams'].values())
env={**os.environ,'BOCHS_386_ROOT':'/tmp/bw-bochs-2.7-oracle-src','NODE_OPTIONS':''}
run('prepare',['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512','scripts/prepare-bochs-cpu3-native-owned-clock.mjs','--prepare',str(T)],W,120,env)
raw=(R/'prepare.stdout').read_bytes();M=json.loads(raw);(R/'prepare.json').write_bytes(raw)
for p,h in M['sourceHashes'].items():
 assert sha((W/p).read_bytes())==h
 assert sha(subprocess.check_output(['git','show',expected+':'+p],cwd=W))==h
for p,h in M['patchedHashes'].items():assert sha((T/p).read_bytes())==h
for p,h in M['actualPreparedHashes'].items():assert sha((T/p).read_bytes())==h
run('configure',M['configure'],T/'bochs',180,env)
run('make',M['build'],T/'bochs',600,env)
features={'BX_CPU_LEVEL':3,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_USE_IDLE_HACK':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_FPU':1,'BX_PLUGINS':0}
cfg=(T/'bochs/config.h').read_text()
for k,v in features.items():assert int(re.search(r'^#define\s+'+k+r'\s+(\d+)',cfg,re.M).group(1))==v
exports=['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']
addon=T/'bochs/bw_direct.node';nm=subprocess.check_output(['nm','-D','--defined-only',str(addon)],text=True)
(R/'addon-nm-defined.txt').write_text(nm)
for x in exports:assert re.search(r'\b'+x+r'$',nm,re.M)
ldd=subprocess.check_output(['ldd',str(addon)],text=True);assert 'not found' not in ldd;(R/'addon-ldd.txt').write_text(ldd)
identity=json.loads(subprocess.check_output(['/tmp/node-v22.23.3-linux-x64/bin/node','--input-type=module','-e',"import {sourceIdentity} from './scripts/bochs-cpu3-native-owned-clock/identity.mjs';console.log(JSON.stringify(sourceIdentity()))"],cwd=W))
receipt={'schema':'bw.owned-clock-build-receipt.v1','status':'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST','sourceRevision':expected,'sourceHashes':identity['hashes'],'preparedManifestPath':str(R/'prepare.json'),'preparedTree':str(T),'preparedManifestSha256':sha(raw),'preparedHashes':M['actualPreparedHashes'],'addonPath':str(addon),'addonSha256':sha(addon.read_bytes()),'addonBytes':addon.stat().st_size,'configSha256':sha((T/'bochs/config.h').read_bytes()),'requiredFeatures':features,'requiredExports':exports,'helperSha256':sha(pathlib.Path(__file__).read_bytes())}
assert git(['rev-parse','HEAD'])==expected and git(['status','--porcelain'])==''
(R/'build-static-preflight.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
