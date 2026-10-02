from pathlib import Path
import json,hashlib,tarfile,subprocess
P=Path(__file__).resolve().parent;E=Path('/mnt/volume1/tmp-astra/native-owned-pic-imr-ci-build-download-20261002/files/owned-pic-imr-evidence');H=Path('/mnt/volume1/tmp-astra/native-owned-pic-imr-ci-restore-prepared-20261002');j=lambda p:json.loads(p.read_bytes());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();checks=0
def ck(v):
 global checks
 assert v;checks+=1
A=j(H/'approved-bindings.json');proof=j(P/'relocation-proof.json');m=j(E/'prepare.json');b=j(E/'build-static-preflight.json');dm=j(P/'derived-prepare.json');db=j(P/'derived-build-receipt.json');s=j(P/'source-admission.stdout');inp=j(P/'static-input.json')
ck(sha(H/'approved-bindings.json')=='de4b60cdd207bb9d014b8267bfc3cbb2c0b9bc01df101b848eb77ea892bda0b4')
ck(proof['status']=='DERIVED_RELOCATED_CI_BUILD' and proof['noLocalCompilation'] and proof['noAddonLoad']);ck(proof['original']['ci']==A['ci']);ck(proof['original']['manifestSha256']==sha(E/'prepare.json') and proof['original']['receiptSha256']==sha(E/'build-static-preflight.json'));ck(proof['original']['sourceHashes']==m['sourceHashes']==A['sourceHashes']);ck(proof['original']['runtimeSourceHashes']==A['runtimeSourceHashes']);ck(proof['original']['inventorySha256']==sha(E/'artifact-inventory.json'))
ck({k for k in m.keys()|dm.keys()if m.get(k)!=dm.get(k)}=={'preparedTree'});ck(dm['preparedTree']==str(P/'prepared'))
allowed={'addonPath','preparedTree','relocation','provenanceKind','preparedManifestSha256','preparedManifestPath'};ck({k for k in b.keys()|db.keys()if b.get(k)!=db.get(k)}==allowed);ck(db['preparedManifestSha256']==sha(P/'derived-prepare.json'));ck(db['preparedManifestPath']==str(P/'derived-prepare.json') and db['preparedTree']==dm['preparedTree']);ck(db['addonPath']==str(P/'prepared/bochs/bw_direct.node'));ck(db['provenanceKind']=='DERIVED_RELOCATED_CI_BUILD');ck(db['relocation']==proof)
for archive,dest in [('prepared-source.tar.gz',P/'prepared'),('frozen-source111.tar.gz',P/'frozen-source')]:
 with tarfile.open(E/archive)as t:
  for member in t:
   ck(member.isfile());ck((dest/member.name).read_bytes()==t.extractfile(member).read())
ck(sha(Path(db['addonPath']))==sha(E/'bw_direct.node')==db['addonSha256']);ck(sha(P/'prepared/bochs/config.h')==db['configSha256']);ck(s['status']=='STATIC_PIC_SOURCE_ONLY_NO_ADDON_LOAD');ck(s['source']=={'revision':A['runtimeRevision'],'hashes':A['runtimeSourceHashes']});ck(s['provenance']['compiled']['revision']==A['sourceRevision'] and s['provenance']['compiled']['hashes']==A['sourceHashes']);ck(s['provenance']['runtime']==s['source'])
for key in ['compiled','runtime']:
 revision=inp[key+'Revision'];mapping=inp[key+'SourceHashes'];root=Path(inp['compiledWorktree' if key=='compiled' else 'sourceWorktree']);ck(subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==revision);ck(not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip())
 for name,h in mapping.items():ck(sha(root/name)==h==hashlib.sha256(subprocess.check_output(['git','show',revision+':'+name],cwd=root)).hexdigest())
for label in ['nm','ldd','source-admission']:
 x=j(P/(label+'.exit.json'));ck(x['returncode']==0 and not x['timeout'])
 for stream,h in x['streams'].items():ck(sha(P/(label+'.'+stream))==h)
ck('not found'not in(P/'ldd.stdout').read_text());ck(all(name in(P/'nm.stdout').read_text()for name in db['requiredExports']))
I=j(E/'artifact-inventory.json');ck(all(sha(E/n)==h for n,h in I['files'].items()))
out={'status':'PASS_ACTUAL_PIC_STATIC_RESTORATION_PATH_ONLY_NO_ADDON_LOAD','checks':checks,'compiledInputs':111,'runtimeInputs':122,'addonSha256':db['addonSha256'],'configSha256':db['configSha256'],'bindingSha256':sha(H/'approved-bindings.json'),'scope':'Original official inventory unchanged; restored archives byteexact; only declared local path/manifest SHA and explicit origin additions changed. Static exports/dependencies/source admission and current/Git clean identities authenticated. No addon or guest executed; populated qualification bindings still require review.'};target=P/'independent-restoration-audit.json';assert not target.exists();target.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
