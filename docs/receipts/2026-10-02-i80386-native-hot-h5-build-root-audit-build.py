import pathlib,json,hashlib,subprocess,re
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-args-20261001');M=json.loads((P/'prepare.json').read_bytes());T=pathlib.Path(M['preparedTree']);H=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h4-20261001');HM=json.loads((H/'prepare.json').read_bytes());HS=json.loads((H/'build-static-preflight.json').read_bytes());checks=0
sha=lambda b:hashlib.sha256(b).hexdigest()
def check(condition,label):
 global checks
 assert condition,label;checks+=1
check(subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()=='ef106b4ae3a2ca55e9cc3253597ec66773e07847','held revision')
check(not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip(),'clean source')
check(M['boardRevision']=='ef106b4ae3a2ca55e9cc3253597ec66773e07847','manifest source revision')
check(len(M['sourceHashes'])==37,'source count');check(len(M['patchedHashes'])==12,'transform count')
for path,digest in M['sourceHashes'].items():
 check(sha((W/path).read_bytes())==digest,'current '+path)
 check(sha(subprocess.check_output(['git','show',M['boardRevision']+':'+path],cwd=W))==digest,'historical '+path)
for path,digest in M['patchedHashes'].items():check(sha((T/path).read_bytes())==digest,'transform '+path)
for path,digest in M['upstreamHashes'].items():check(sha(subprocess.check_output(['git','show',M['bochsRevision']+':'+path],cwd=T))==digest,'upstream '+path)
check(M['h4SourceHashes']==HM['sourceHashes'],'original H4 source hashes exact')
check(M['patchedHashes']==HM['patchedHashes'],'original transforms exact')
check(M['generatedRuntimeSha256']==HM['generatedRuntimeSha256'],'runtime lineage')
B=T/'bochs';paths={'configSha256':'config.h','runtimeSha256':'cpu/bw_slice_runtime.inc','headerSha256':'bochs-cpu3-native-direct-board/abi.h'}
for key,path in paths.items():check(sha((B/path).read_bytes())==HS[key],key+' exact H4')
check(sha((B/M['packedArgs']['compiledReplacementOnly'].removeprefix('bochs/')).read_bytes())=='f83992b411bb0756c4a0744fdd8f9ae70be6d1b3a7e23d65db199ef2fbec58b5','H5 generated NAPI exact')
check(M['packedArgs']['generatedNapiSha256']=='f83992b411bb0756c4a0744fdd8f9ae70be6d1b3a7e23d65db199ef2fbec58b5','manifest actual H5 NAPI')
features={'BX_CPU_LEVEL':3,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_USE_IDLE_HACK':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_FPU':1,'BX_PLUGINS':0};cfg=(B/'config.h').read_text()
for name,value in features.items():check(int(re.search(r'^#define\s+'+name+r'\s+(\d+)',cfg,re.M).group(1))==value,'feature '+name)
addon=B/'bw_direct.node';nm=subprocess.check_output(['nm','-D','--defined-only',str(addon)],text=True)
for name in HS['requiredExports']:check(bool(re.search(r'\b'+name+r'$',nm,re.M)),'export '+name)
check('not found' not in subprocess.check_output(['ldd',str(addon)],text=True),'resolved dependencies')
check(sha((pathlib.Path(HM['preparedTree'])/'bochs/bw_direct.node').read_bytes())==HS['addonSha256'],'H4 baseline addon unchanged')
S=json.loads((P/'build-static-preflight.json').read_bytes())
check(S['addonSha256']==sha(addon.read_bytes()),'actual addon matches peer receipt')
check(S['manifestSha256']==sha((P/'prepare.json').read_bytes()),'manifest matches peer receipt')
check(S['napiSha256']==M['packedArgs']['generatedNapiSha256'],'peer H5 NAPI')
out={'status':'ROOT_H5_FRESH_BUILD_BINDING_PASS','checks':checks,'sourceRevision':M['boardRevision'],'sourceInputs':37,'transformInputs':12,'manifestSha256':sha((P/'prepare.json').read_bytes()),'addonSha256':sha(addon.read_bytes()),'addonBytes':addon.stat().st_size,'generatedNapiSha256':M['packedArgs']['generatedNapiSha256'],'runtimeConfigAbiIdenticalH4':True,'auditScriptSha256':sha(pathlib.Path(__file__).read_bytes()),'guestExecuted':False}
(P/'root-build-binding-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
