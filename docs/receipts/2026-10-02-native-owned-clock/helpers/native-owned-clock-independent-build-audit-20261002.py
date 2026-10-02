"""Read-only build artifact audit; no compile, addon load, guest or benchmark."""
import hashlib,json,pathlib,re,subprocess
W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002')
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002')
T=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-owned-clock-20261002')
REV='7df84bc2c367aff1cadec7cecdde69cf0e904ace'
checks=0
sha=lambda b:hashlib.sha256(b).hexdigest()
def check(ok,label):
 global checks
 if not ok:raise AssertionError(label)
 checks+=1
J=lambda p:json.loads(p.read_bytes())
git=lambda args:subprocess.check_output(['git',*args],cwd=W).decode().strip()
check(git(['rev-parse','HEAD'])==REV,'exact frozen source');check(git(['status','--porcelain'])=='','clean frozen source')
receipt=J(R/'build-static-preflight.json');manifest=J(R/'prepare.json')
check(receipt['status']=='BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST','static-only status')
check(receipt['schema']=='bw.owned-clock-build-receipt.v1','schema');check(receipt['sourceRevision']==REV==manifest['boardRevision'],'source revision')
check(receipt['preparedTree']==str(T)==manifest['preparedTree'],'tree')
check(receipt['preparedManifestPath']==str(R/'prepare.json'),'manifest path');check(receipt['preparedManifestSha256']==sha((R/'prepare.json').read_bytes()),'manifest bytes')
check((R/'prepare.stdout').read_bytes()==(R/'prepare.json').read_bytes(),'lossless preparer report')
check(receipt['helperSha256']==sha(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-root-build-20261002.py').read_bytes()),'actual build helper')
for stage in ['prepare','configure','make']:
 e=J(R/(stage+'.exit.json'));check(e['exitCode']==0 and not e['timedOut'],stage+' actual completion')
 for stream,v in e['streams'].items():
  b=(R/(stage+'.'+stream)).read_bytes();check(v['bytes']==len(b),stage+' stream length');check(v['sha256']==sha(b),stage+' stream SHA')
check(J(R/'make.exit.json')['command']==manifest['build'],'build command');check('-j1' in manifest['build'],'single build job');check(J(R/'configure.exit.json')['command']==manifest['configure'],'configure command')
identity=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {sourceIdentity} from './scripts/bochs-cpu3-native-owned-clock/identity.mjs';console.log(JSON.stringify(sourceIdentity()))"],cwd=W))
check(identity['revision']==REV,'actual identity revision');check(receipt['sourceHashes']==identity['hashes'],'actual driver closure')
for p,h in manifest['sourceHashes'].items():
 check(sha((W/p).read_bytes())==h,p+' current');check(sha(subprocess.check_output(['git','show',REV+':'+p],cwd=W))==h,p+' git blob')
for p,h in identity['hashes'].items():check(manifest['sourceHashes'].get(p)==h,p+' manifest closure')
check(manifest['ownedClock']['abiVersion']==3,'ABI3')
derivatives=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {deriveOwnedRuntime} from './scripts/bochs-cpu3-native-owned-clock/runtime.mjs';import {deriveOwnedNapi} from './scripts/bochs-cpu3-native-owned-clock/napi.mjs';import {sha256} from './scripts/bochs-cpu3-native-owned-clock/derive.mjs';console.log(JSON.stringify({runtime:sha256(deriveOwnedRuntime().bytes),napi:sha256(deriveOwnedNapi().bytes)}))"],cwd=W))
check(manifest['ownedClock']['runtimeSha256']==derivatives['runtime'],'actual runtime derivation');check(manifest['ownedClock']['napiSha256']==derivatives['napi'],'actual NAPI derivation');check(manifest['ownedClock']['abiSha256']==sha((W/'scripts/bochs-cpu3-native-owned-clock/abi.h').read_bytes()),'actual ABI source')
check(manifest['generatedRuntimeSha256']==derivatives['runtime'],'active runtime identity');check(receipt['preparedHashes']==manifest['actualPreparedHashes'],'actual replacements')
for p,h in {**manifest['patchedHashes'],**manifest['actualPreparedHashes']}.items():check(sha((T/p).read_bytes())==h,p+' prepared bytes')
for src,dst in [('scripts/bochs-cpu3-native-direct-board/runtime.h','bochs/cpu/bw_slice_runtime.h'),('scripts/bochs-cpu3-native-direct-board/addon.mk','bochs/bw_direct_addon.mk')]:check((W/src).read_bytes()==(T/dst).read_bytes(),dst+' unchanged copy')
features={'BX_CPU_LEVEL':3,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_USE_IDLE_HACK':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_FPU':1,'BX_PLUGINS':0}
check(receipt['requiredFeatures']==features,'expected feature set');cfg=(T/'bochs/config.h').read_bytes();check(receipt['configSha256']==sha(cfg),'config bytes')
for name,value in features.items():
 matches=re.findall(r'^#define\s+'+name+r'\s+(\d+)\s*$',cfg.decode(),re.M);check(matches==[str(value)],name+' actual macro')
addon=T/'bochs/bw_direct.node';check(receipt['addonPath']==str(addon),'addon path');check(receipt['addonBytes']==addon.stat().st_size,'addon size');check(receipt['addonSha256']==sha(addon.read_bytes()),'addon SHA');check(addon.read_bytes()[:4]==b'\x7fELF','ELF artifact')
nm=subprocess.check_output(['nm','-D','--defined-only',str(addon)],text=True);check(nm==(R/'addon-nm-defined.txt').read_text(),'actual defined symbols')
exports=['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1'];check(receipt['requiredExports']==exports,'expected exports')
for name in exports:check(bool(re.search(r'\b'+name+r'$',nm,re.M)),name+' defined')
check('not found' not in (R/'addon-ldd.txt').read_text(),'captured dependency resolution')
check(git(['rev-parse','HEAD'])==REV and git(['status','--porcelain'])=='','source remains frozen')
out={'status':'PASS_BUILD_ARTIFACT_AUDIT_NO_ADDON_LOAD_OR_GUEST','checks':checks,'sourceRevision':REV,'driverSourceCount':len(identity['hashes']),'manifestSourceCount':len(manifest['sourceHashes']),'heldH4SourceCount':len(manifest['originalH4SourceHashes']),'inheritedTransforms':len(manifest['patchedHashes']),'addonSha256':receipt['addonSha256'],'preparedManifestSha256':receipt['preparedManifestSha256'],'buildReceiptSha256':sha((R/'build-static-preflight.json').read_bytes()),'auditScriptSha256':sha(pathlib.Path(__file__).read_bytes())}
(R/'independent-build-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
