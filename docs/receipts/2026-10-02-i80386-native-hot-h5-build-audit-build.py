import hashlib,json,pathlib,subprocess,re
R=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h5-20261001'); W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-args-20261001'); M=json.loads((R/'prepare.json').read_text()); T=pathlib.Path(M['preparedTree']); checks=0
def sha(b):return hashlib.sha256(b).hexdigest()
def eq(a,b,label):
 global checks
 assert a==b,(label,a,b);checks+=1
for p,h in M['sourceHashes'].items():
 eq(sha((W/p).read_bytes()),h,'current '+p)
 eq(sha(subprocess.check_output(['git','show',M['boardRevision']+':'+p],cwd=W)),h,'historical '+p)
for p,h in M['upstreamHashes'].items():eq(sha(subprocess.check_output(['git','show',M['bochsRevision']+':'+p],cwd=T)),h,'upstream '+p)
for p,h in M['patchedHashes'].items():eq(sha((T/p).read_bytes()),h,'patched '+p)
eq(len(M['sourceHashes']),37,'source census');eq(len(M['patchedHashes']),12,'patch census')
H2=json.loads(pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h4-20261001/prepare.json').read_text())
eq(M['h4SourceHashes'],H2['sourceHashes'],'H4 complete source binding unchanged')
eq(M['patchedHashes'],H2['patchedHashes'],'H2 upstream transforms unchanged')
eq(M['generatedRuntimeSha256'],H2['generatedRuntimeSha256'],'H2 native runtime unchanged')
B=T/'bochs';eq(sha((B/'cpu/bw_slice_runtime.inc').read_bytes()),M['generatedRuntimeSha256'],'generated runtime')
eq(sha((B/'bochs-cpu3-native-direct-board-adapter/napi.cc').read_bytes()),M['packedArgs']['generatedNapiSha256'],'generated napi')
eq(sha((B/'bochs-cpu3-native-direct-board/abi.h').read_bytes()),M['sourceHashes']['scripts/bochs-cpu3-native-direct-board/abi.h'],'header')
features={'BX_CPU_LEVEL':3,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_USE_IDLE_HACK':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_FPU':1,'BX_PLUGINS':0};cfg=(B/'config.h').read_text()
for k,v in features.items():eq(int(re.search(r'^#define\s+'+k+r'\s+(\d+)',cfg,re.M).group(1)),v,'feature '+k)
addon=B/'bw_direct.node';nm=subprocess.check_output(['nm','-D','--defined-only',str(addon)],text=True);(R/'addon-nm-defined.txt').write_text(nm)
exports=['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']
for x in exports: assert re.search(r'\b'+x+r'$',nm,re.M),x;checks+=1
ldd=subprocess.check_output(['ldd',str(addon)],text=True);assert 'not found' not in ldd;checks+=1;(R/'addon-ldd.txt').write_text(ldd)
(R/'addon-readelf.txt').write_text(subprocess.check_output(['readelf','-h',str(addon)],text=True))
result={'status':'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST','sourceRevision':M['boardRevision'],'sourceInputs':37,'patchedInputs':12,'checks':checks,'features':features,'manifestSha256':sha((R/'prepare.json').read_bytes()),'addonSha256':sha(addon.read_bytes()),'addonBytes':addon.stat().st_size,'configSha256':sha((B/'config.h').read_bytes()),'runtimeSha256':M['generatedRuntimeSha256'],'headerSha256':M['sourceHashes']['scripts/bochs-cpu3-native-direct-board/abi.h'],'napiSha256':M['packedArgs']['generatedNapiSha256'],'requiredExports':exports,'h1RuntimeUnchanged':True,'h5NativeExecution':False}
(R/'build-static-preflight.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
