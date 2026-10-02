import pathlib,json,hashlib,tarfile,subprocess,re
P=pathlib.Path(__file__).parent;E=P/'files/owned-in8-evidence';W=pathlib.Path('/tmp/bw-board-386-native-owned-in8-r3-20261002');n=0
H=lambda b:hashlib.sha256(b).hexdigest()
def ck(x):
 global n
 assert x;n+=1
ck(H((P/'artifact.zip').read_bytes())=='0335f4c5088280cfcdf00186f5e0ca59ff431442edc3a978dd26b7dc2341a0e0');B=json.loads((E/'build-static-preflight.json').read_bytes());M=json.loads((E/'prepare.json').read_bytes());I=json.loads((E/'artifact-inventory.json').read_bytes());ck(B['sourceRevision']==M['boardRevision']=='fe1eff2039520536350922a2164c8bbe29404c68');ck(len(B['sourceHashes'])==103);ck(B['sourceHashes']==M['sourceHashes']);ck(H((E/'prepare.json').read_bytes())==B['preparedManifestSha256'])
for f,h in I['files'].items():ck(H((E/f).read_bytes())==h)
for f,h in B['sourceHashes'].items():ck(H((W/f).read_bytes())==h);ck(H(subprocess.check_output(['git','show',B['sourceRevision']+':'+f],cwd=W))==h)
def contents(path):
 with tarfile.open(path,'r:gz')as t:
  out={}
  for x in t:
   ck(x.isfile()or x.isdir());ck(not pathlib.PurePosixPath(x.name).is_absolute()and '..'not in pathlib.PurePosixPath(x.name).parts)
   if x.isfile():ck(x.name not in out);out[x.name]=t.extractfile(x).read()
  return out
F=contents(E/'frozen-source103.tar.gz');ck(set(F)==set(B['sourceHashes']))
for f,h in B['sourceHashes'].items():ck(H(F[f])==h)
T=contents(E/'prepared-source.tar.gz')
for f,h in {**M['patchedHashes'],**M['actualPreparedHashes']}.items():ck(H(T[f])==h)
ck(B['preparedHashes']==M['actualPreparedHashes']);cfg=(E/'config.h').read_bytes();ck(H(cfg)==B['configSha256']);ck(T['bochs/config.h']==cfg)
for k,v in B['requiredFeatures'].items():ck(re.search(r'^#define\s+'+k+r'\s+'+str(v)+r'\b',cfg.decode(),re.M))
ck(H((E/'bw_direct.node').read_bytes())==B['addonSha256']);ck((E/'bw_direct.node').stat().st_size==B['addonBytes']);ck(B['addonSha256']=='8d9c83fcc3c42c2c94d17782ae42c152c52fcb2e833c31decc4bfee2af5aa841')
for name in B['requiredExports']:ck(re.search(r'\b'+name+r'$',(E/'addon-nm-defined.txt').read_text(),re.M))
ck('not found'not in(E/'addon-ldd.txt').read_text());ck(M['ownedClock']['abiVersion']==4);ck('25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939'in T['bochs/cpu/bw_slice_runtime.inc'].decode())
for label in ['identity-before','prepare','configure','make','identity']:
 r=json.loads((E/(label+'.exit.json')).read_bytes());ck(r['exitCode']==0 and not r['timedOut'])
 for stream,v in r['streams'].items():b=(E/(label+'.'+stream)).read_bytes();ck(H(b)==v['sha256']);ck(len(b)==v['bytes'])
ck(json.loads((E/'identity-before.stdout').read_bytes())==json.loads((E/'identity.stdout').read_bytes()));ctx=(P/'files/owned-in8-context/context.txt').read_text();ck('8804758633b3cabd23ff9c084238f80433da99f7'in ctx);ck('v22.23.3'in ctx);ck('libnode-dev\t18.19.1'in ctx);ck((E/'upstream-COPYING').stat().st_size>0 and(E/'upstream-LICENSE').stat().st_size>0)
out={'status':'PASS_OFFICIAL_CI_ABI4_BUILD_ARTIFACT_STATIC_NO_ADDON_LOAD','checks':n,'runId':37006765968,'artifactId':11226630502,'workflowHead':'8804758633b3cabd23ff9c084238f80433da99f7','compiledSource':B['sourceRevision'],'sourceInputs':103,'addonSha256':B['addonSha256'],'configSha256':B['configSha256'],'scope':'OfficialZIP exact, inventory/archives/currentgit103/generatedfiles/ABI4/features/exports/exitstreams/licenses exact. CIconfig differs localconfig; sameDSO hash does not relabel compile provenance. No extraction/ldd execution/addon load/guest.'};(P/'independent-build-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
