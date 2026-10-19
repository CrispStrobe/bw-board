import zipfile,tarfile,json,hashlib,pathlib,subprocess,struct
P=pathlib.Path('/tmp/native-paged-int-iret-first-build-20261004.zip');R=pathlib.Path('/tmp/bw-native-paged-int-iret-build-source-20261004');sha=lambda b:hashlib.sha256(b).hexdigest();assert P.stat().st_size==8097621 and sha(P.read_bytes())=='4ac91409753cc618711107cf4fbff1ebb8c73c40295978eb4b6e798af3119a6c'
with zipfile.ZipFile(P) as z:
 assert len(z.infolist())==70 and len(set(z.namelist()))==70
 members={}
 for i in z.infolist():
  assert not i.is_dir() and not i.filename.startswith('/') and '..' not in pathlib.PurePosixPath(i.filename).parts
  with z.open(i) as f:
   h=hashlib.sha256();n=0
   while b:=f.read(1<<20):h.update(b);n+=len(b)
  assert n==i.file_size;members[i.filename]={'bytes':n,'sha256':h.hexdigest()}
 E='paged-int-iret-build-evidence/';get=lambda p:json.loads(z.read(E+p))
 final=get('final-status.json');assert final['completed'] and not final['errors'] and all(final[k] for k in ['sourceBeforeAfterEqual','preparedInputsBeforeAfterEqual','frozenInputsBeforeAfterEqual'])
 before=get('source-before.json');assert before==get('source-after.json');identity=get('identity-before.stdout');assert identity==get('identity-after.stdout');assert identity['revision']=='4a4ec3c92a67c4db6d3bd361f9456d2be144a13c' and len(identity['hashes'])==208
 m=get('prepare.json');receipt=get('build-static-preflight.json');ctx=get('build-context.json');inp=get('static-input.json');adm=get('static-admission.stdout')
 assert receipt['schema']=='bw.native-paged-int-iret-build-receipt.v1' and receipt['status']=='BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST'
 assert ctx['schema']=='bw.native-paged-int-iret-build-context.v1' and ctx['addonLoaded'] is False and ctx['nodeVersion']=='v22.23.3'
 assert m['boardRevision']==receipt['sourceRevision']==ctx['sourceRevision']==identity['revision'];assert m['sourceHashes']==receipt['sourceHashes']==ctx['sourceHashes']==identity['hashes']
 for p,h in identity['hashes'].items():assert before[p]==h==sha(subprocess.check_output(['git','show',identity['revision']+':'+p],cwd=R))
 generated=m['actualPreparedHashes'];assert generated==receipt['preparedHashes']==ctx['preparedHashes']==adm['preparedHashes'];assert generated['bochs/cpu/bw_slice_runtime.inc']=='44d6166807419eebc02f6e69f767e22fed21ead738b2a10e71d87791c364b796';assert generated['bochs/owned-paged-int-iret-provider.mjs']=='afc02de595449021f64cfa74cb0004ae71028e57596195769563439b5d0f005f';assert generated['bochs/owned-paged-int-iret-ROM.bin']=='b8b3525d4299ba14dc467144fc743a39f1c04d1a7d92ea3b34da6f4ee601cd30';assert generated['bochs/cpu/bw_slice_abi.h']=='3cb214dfa1a1cf74c5aea4ef3642d73d8ca1cc9e9c8362d2513dc3483f284990'
 assert m['profile']==m['pagedIntIretProfile']==receipt['pagedIntIretProfile'];assert m['profile']['kind']=='fixed-paged-cpl0-int30-iret-native-source-v1';assert 'nonidentityPagingProfile' not in m
 held=m['originalPagingProvenance'];assert held['generatedRuntimeSha256']=='ff7230c902deafa60d1192f2b5f0e3b4ea51d8f1010375cafc42e25fed3fc8f4'==held['ownedClock']['runtimeSha256'];assert held['boardRevision']==m['boardRevision'];assert all(m['sourceHashes'][p]==h for p,h in held['sourceHashes'].items())
 for k in ['originalStackProvenance','originalProtectedProvenance','originalRamProvenance','originalColdProvenance','originalH4Provenance']:assert m[k]==held[k]
 for key,file in [('preparedManifestSha256','prepare.json'),('configSha256','config.h'),('contextSha256','build-context.json')]:assert receipt[key]==sha(z.read(E+file))
 assert inp['sha256']==receipt['addonSha256']==sha(z.read(E+'bw_direct.node'));assert inp['buildReceiptSha256']==sha(z.read(E+'build-static-preflight.json'));assert receipt['addonBytes']==2074512
 addon=z.read(E+'bw_direct.node');assert addon[:5]==b'\x7fELF\x02' and struct.unpack_from('<H',addon,18)[0]==62
 pre=get('prepared-before-build.json');post=get('prepared-after-build.json');assert all(post[p]==h for p,h in pre.items());assert all(post[p]==h for p,h in generated.items())
 tar_counts={}
 for archive,expected in [('frozen-source.tar.gz',identity['hashes']),('prepared-source.tar.gz',{p:h for p,h in post.items() if p!='bochs/bw_direct.node'})]:
  got={}
  with z.open(E+archive) as stream:
   with tarfile.open(fileobj=stream,mode='r|gz') as t:
    for i in t:
     assert i.isfile() and i.name not in got and '..' not in pathlib.PurePosixPath(i.name).parts and not i.name.startswith('/')
     got[i.name]=sha(t.extractfile(i).read())
  assert got==expected,(archive,len(got),len(expected));tar_counts[archive]=len(got)
 inv=get('artifact-inventory.json')['files']
 for f,v in inv.items():assert members[E+f]==v
 phases=[]
 for n in z.namelist():
  if n.startswith(E) and n.endswith('.exit.json'):
   e=json.loads(z.read(n));assert e['exitCode']==0 and not e['timedOut'],n;stem=n[len(E):-10]
   for stream,v in e['streams'].items():assert members[E+stem+'.'+stream]==v
   phases.append(stem)
 nm=z.read(E+'nm.stdout').decode();assert all(any(line.split()[-1]==s for line in nm.splitlines()) for s in receipt['requiredExports']);config=z.read(E+'config.h').decode()
 for k,v in receipt['requiredFeatures'].items():assert any(line.strip()=='#define '+k+' '+str(v) for line in config.splitlines()),k
 for f,p in [('build-helper.py','scripts/ci-build-i80386-native-paged-int-iret.py'),('workflow.yml','.github/workflows/i80386-native-paged-int-iret-build.yml')]:assert sha(z.read('paged-int-iret-build-context/'+f))==identity['hashes'][p]
 result={'schema':'bw.paged-int-iret.independent-static-build-audit.v1','status':'PASS','sourceRevision':identity['revision'],'runId':37218196080,'officialArtifact':{'id':11309320742,'zipBytes':P.stat().st_size,'zipSha256':sha(P.read_bytes()),'members':70},'sourcePaths':208,'fullSourcePrePostPaths':len(before),'preparedBefore':len(pre),'preparedAfter':len(post),'tarAuthenticated':tar_counts,'successfulPhases':phases,'addonSha256':receipt['addonSha256'],'addonBytes':receipt['addonBytes'],'generated':generated,'abiVersion':4,'heldPagingProvenanceChecked':True,'scope':'Static source/build/archive/config/ELF/export/admission proof only. No addon load, emulated instruction, differential INT/IRET or timing qualification.'}
pathlib.Path('/tmp/native-paged-int-iret-first-build-independent-audit-20261004.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='generated'}))
