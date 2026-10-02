import pathlib,hashlib,json
sha=lambda b:hashlib.sha256(b).hexdigest()
def bind(manifestPath,tree,expectedConfig):
 m=json.load(open(manifestPath));t=pathlib.Path(tree);replacement=m.get('packedArgs',m['packedScalar']);files={replacement['compiledReplacementOnly']:replacement['generatedNapiSha256'],'bochs/cpu/bw_slice_runtime.inc':m['generatedRuntimeSha256'],'bochs/bochs-cpu3-native-direct-board/abi.h':m['sourceHashes']['scripts/bochs-cpu3-native-direct-board/abi.h'],'bochs/config.h':expectedConfig}
 for p,h in files.items():assert sha((t/p).read_bytes())==h,(p,h)
 return files
