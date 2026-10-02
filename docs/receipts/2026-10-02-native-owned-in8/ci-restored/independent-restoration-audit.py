import pathlib,json,hashlib
R=pathlib.Path(__file__).parent;D=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-in8-r3-ci-attempt2-20261002/files/owned-in8-evidence');n=0;H=lambda b:hashlib.sha256(b).hexdigest()
def ck(x):
 global n
 assert x;n+=1
M=json.loads((D/'prepare.json').read_bytes());B=json.loads((D/'build-static-preflight.json').read_bytes());m=json.loads((R/'derived-prepare.json').read_bytes());b=json.loads((R/'derived-build-receipt.json').read_bytes());p=json.loads((R/'relocation-proof.json').read_bytes());T=R/'prepared';ck(p['status']=='DERIVED_RELOCATED_CI_BUILD');ck(p['noLocalCompilation']and p['noAddonLoad']);ck(m['preparedTree']==str(T));m['preparedTree']=M['preparedTree'];ck(m==M)
allowed={'preparedTree','preparedManifestPath','preparedManifestSha256','addonPath','provenanceKind','relocation'};ck({k:v for k,v in b.items()if k not in allowed}=={k:v for k,v in B.items()if k not in allowed});ck(b['relocation']==p);ck(b['preparedManifestSha256']==H((R/'derived-prepare.json').read_bytes()));ck(b['addonPath']==str(T/'bochs/bw_direct.node'));ck(H((T/'bochs/bw_direct.node').read_bytes())==B['addonSha256']);ck(H((T/'bochs/config.h').read_bytes())==B['configSha256'])
for f,h in {**M['patchedHashes'],**M['actualPreparedHashes']}.items():ck(H((T/f).read_bytes())==h)
for f,h in B['sourceHashes'].items():ck(H((R/'frozen-source'/f).read_bytes())==h)
for f,h in json.loads((D/'artifact-inventory.json').read_bytes())['files'].items():ck(H((D/f).read_bytes())==h)
for label in ['nm','ldd','source-admission']:
 e=json.loads((R/(label+'.exit.json')).read_bytes());ck(e['returncode']==0 and not e['timeout'])
 for s,h in e['streams'].items():ck(H((R/(label+'.'+s)).read_bytes())==h)
ck('not found'not in(R/'ldd.stdout').read_text());ck(not(R/'source-admission.stderr').read_bytes())
out={'status':'PASS_ACTUAL_CI_STATIC_RESTORATION_NO_ADDON_LOAD','checks':n,'compiledSource':B['sourceRevision'],'sourceInputs':103,'addonSha256':B['addonSha256'],'configSha256':B['configSha256'],'scope':'RawCIinventory unchanged; derivedmanifest onlypreparedTree; derivedreceipt onlyallowedpaths/manifesthash/explicitrelocationmetadata. Frozen103/generatedoutputs/config/DSO exact; localnm/ldd/sourceadmission successful. No localbuild/addonload/guest.'};(R/'independent-restoration-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
