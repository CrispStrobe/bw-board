# PREPARED ONLY. Requires root-authenticated downloaded CI artifacts; never loads native addon.
import pathlib,json,hashlib,os,subprocess,resource,signal,time,tarfile,shutil,sys,re
P=pathlib.Path(__file__).parent;EXPECTED='a6f605280f778b2bc409ef97ac3b40e15874530c';RUNTIME='3792a908d81e04903974aa7d2bdc545e0713a290';sha=lambda b:hashlib.sha256(b).hexdigest()
def read(path,cap=16<<20):
 path=pathlib.Path(path);assert not path.is_symlink()and path.is_file()and path.stat().st_size<=cap;return path.read_bytes()
def load(path):return json.loads(read(path))
A=load(sys.argv[1]);assert A['sourceRevision']==EXPECTED;W=pathlib.Path(A['sourceWorktree']);D=pathlib.Path(A['downloadedEvidence']);R=pathlib.Path(A['newOutput']);assert W.is_absolute()and D.is_absolute()and R.is_absolute()and not R.exists();assert len(A['sourceHashes'])==111
RW=pathlib.Path(A['runtimeWorktree']);assert RW.is_absolute() and A['runtimeRevision']==RUNTIME and len(A['runtimeSourceHashes'])==122
assert A['ci']['runId'] and A['ci']['artifactId'] and re.fullmatch('[a-f0-9]{40}',A['ci']['headSha']) and re.fullmatch('[a-f0-9]{64}',A['ci']['zipSha256']) and re.fullmatch('[a-f0-9]{64}',A['inventorySha256'])
assert A['ci']['toolingRevision']==A['ci']['headSha']
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=RW,text=True).strip()==RUNTIME and not subprocess.check_output(['git','status','--porcelain'],cwd=RW).strip()
for name,h in A['runtimeSourceHashes'].items():assert sha(read(RW/name))==h==sha(subprocess.check_output(['git','show',RUNTIME+':'+name],cwd=RW))
for name,h in A['sourceHashes'].items():assert A['runtimeSourceHashes'][name]==h
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==EXPECTED;assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
for name,h in A['helperHashes'].items():assert sha(read(P/name))==h
for name,h in A['sourceHashes'].items():assert sha(read(W/name))==h and sha(subprocess.check_output(['git','show',EXPECTED+':'+name],cwd=W))==h
assert sha(read(A['originalArchive'],256<<20))==A['ci']['zipSha256']
assert subprocess.check_output([A['node'],'--version'],text=True,timeout=10).strip()=='v22.23.3'
inventoryRaw=read(D/'artifact-inventory.json');assert sha(inventoryRaw)==A['inventorySha256'];inventory=json.loads(inventoryRaw)
for name,h in inventory['files'].items():
 path=pathlib.PurePosixPath(name);assert not path.is_absolute()and '..'not in path.parts;assert sha(read(D/name,256<<20))==h
manifestRaw=read(D/'prepare.json');receiptRaw=read(D/'build-static-preflight.json');M=json.loads(manifestRaw);B=json.loads(receiptRaw)
assert B['status']=='BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST'and B['sourceRevision']==EXPECTED and M['boardRevision']==EXPECTED
assert B['sourceHashes']==M['sourceHashes']==A['sourceHashes'];assert B['preparedManifestSha256']==sha(manifestRaw);assert sha(read(D/'bw_direct.node',256<<20))==B['addonSha256'];assert sha(read(D/'config.h'))==B['configSha256'];assert M['ownedClock']['abiVersion']==4
assert A['ci']['runId']and A['ci']['headSha']and A['ci']['workflowSha256']and A['ci']['helperSha256']==B['helperSha256']
assert B['tooling']==M['tooling'] and B['profile']==M['profile']
assert M['profile']=={'kind': 'PIC_IMR_FIXED_FREE_ROM', 'sourceRevision': 'a6f605280f778b2bc409ef97ac3b40e15874530c', 'sourceCount': 111, 'romSha256': '8a7380f01bbc40985d377fe9764667749c36b05d45ee602b28c7e68556bd509f', 'expectedPicWitness': [255, 255], 'witnessAddresses': [1426, 1427], 'status': 'SOURCE_PREPARATION_ONLY_NO_BUILD_OR_GUEST'}
assert len(M['originalIn8Provenance']['sourceHashes'])==103
assert M['tooling']['revision']==A['ci']['toolingRevision'] and len(M['tooling']['hashes'])==3
expectedTools={'scripts/prepare-bochs-cpu3-native-owned-pic-imr.mjs','scripts/ci-build-i80386-native-owned-pic-imr.py','.github/workflows/i80386-native-owned-pic-imr-build.yml'}
assert set(M['tooling']['hashes'])==expectedTools
for name,h in M['tooling']['hashes'].items():assert A['runtimeSourceHashes'][name]==h==sha(subprocess.check_output(['git','show',A['ci']['toolingRevision']+':'+name],cwd=RW))
assert M['tooling']['hashes']['scripts/ci-build-i80386-native-owned-pic-imr.py']==B['helperSha256']==A['ci']['helperSha256']
assert M['tooling']['hashes']['.github/workflows/i80386-native-owned-pic-imr-build.yml']==A['ci']['workflowSha256']
originalManifest=json.loads(manifestRaw);originalReceipt=json.loads(receiptRaw)
R.mkdir();T=R/'prepared';F=R/'frozen-source';T.mkdir();F.mkdir()
def extract(archive,dest):
 assert not archive.is_symlink() and archive.is_file() and archive.stat().st_size<=256<<20;seen=set();total=0
 with tarfile.open(archive,'r:gz')as tar:
  for index,member in enumerate(tar):
   path=pathlib.PurePosixPath(member.name);assert index<100000 and not path.is_absolute()and '..'not in path.parts and member.name not in seen;seen.add(member.name);assert member.isfile()or member.isdir();total+=member.size;assert total<=1024<<20 and member.size<=256<<20
   target=dest.joinpath(*path.parts)
   if member.isdir():target.mkdir(parents=True,exist_ok=True);continue
   target.parent.mkdir(parents=True,exist_ok=True)
   with tar.extractfile(member)as source,target.open('xb')as output:shutil.copyfileobj(source,output,1<<20)
extract(D/'prepared-source.tar.gz',T);extract(D/'frozen-source111.tar.gz',F)
assert {str(p.relative_to(F))for p in F.rglob('*')if p.is_file()}==set(A['sourceHashes'])
for name,h in A['sourceHashes'].items():assert sha(read(F/name))==h
addon_target=T/'bochs/bw_direct.node';assert not addon_target.exists() and not addon_target.is_symlink()
with addon_target.open('xb')as output:output.write(read(D/'bw_direct.node',256<<20))
assert sha(read(T/'bochs/config.h'))==B['configSha256']
for group in ['patchedHashes','actualPreparedHashes']:
 for name,h in M[group].items():assert sha(read(T/name))==h
for source,target in [('scripts/bochs-cpu3-native-direct-board/runtime.h','bochs/cpu/bw_slice_runtime.h'),('scripts/bochs-cpu3-native-direct-board/addon.mk','bochs/bw_direct_addon.mk')]:assert sha(read(T/target))==A['sourceHashes'][source]
env=os.environ.copy()
def limits():os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20))
def run(label,command):
 start=time.monotonic();timeout=False
 with(R/(label+'.stdout')).open('xb')as out,(R/(label+'.stderr')).open('xb')as err:
  child=subprocess.Popen(command,cwd=W,env=env,stdout=out,stderr=err,preexec_fn=limits,start_new_session=True)
  try:code=child.wait(timeout=120)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait();timeout=True
 result={'command':command,'returncode':code,'timeout':timeout,'wallSeconds':time.monotonic()-start,'streams':{name:sha(read(R/(label+'.'+name),256<<20))for name in ['stdout','stderr']}};(R/(label+'.exit.json')).write_text(json.dumps(result,indent=2)+'\n');assert code==0 and not timeout
run('nm',['nm','-D','--defined-only',str(T/'bochs/bw_direct.node')]);symbols=read(R/'nm.stdout').decode()
for name in B['requiredExports']:assert re.search(r'\b'+re.escape(name)+r'$',symbols,re.M)
assert B['requiredExports']==['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']
run('ldd',['ldd',str(T/'bochs/bw_direct.node')]);assert b'not found'not in read(R/'ldd.stdout')
# Keep raw CI records immutable. Only explicit local path fields change in derived records.
original={'ci':A['ci'],'manifestSha256':sha(manifestRaw),'receiptSha256':sha(receiptRaw),'inventorySha256':sha(inventoryRaw),'addonSha256':B['addonSha256'],'sourceRevision':EXPECTED,'sourceHashes':A['sourceHashes'],'runtimeRevision':RUNTIME,'runtimeSourceHashes':A['runtimeSourceHashes'],'tooling':M['tooling'],'profile':M['profile']}
relocation={'status':'DERIVED_RELOCATED_CI_BUILD','original':original,'oldPreparedTree':M['preparedTree'],'newPreparedTree':str(T),'oldAddonPath':B['addonPath'],'newAddonPath':str(T/'bochs/bw_direct.node'),'noLocalCompilation':True,'noAddonLoad':True}
M['preparedTree']=str(T);derivedManifest=R/'derived-prepare.json';derivedManifest.write_text(json.dumps(M,indent=2)+'\n');B['preparedTree']=str(T);B['preparedManifestPath']=str(derivedManifest);B['preparedManifestSha256']=sha(read(derivedManifest));B['addonPath']=str(T/'bochs/bw_direct.node');B['provenanceKind']='DERIVED_RELOCATED_CI_BUILD';B['relocation']=relocation;derivedReceipt=R/'derived-build-receipt.json';derivedReceipt.write_text(json.dumps(B,indent=2)+'\n')
assert M['originalIn8Provenance']==originalManifest['originalIn8Provenance']
expectedM={**originalManifest,'preparedTree':str(T)};assert M==expectedM
expectedB={**originalReceipt,'preparedTree':str(T),'preparedManifestPath':str(derivedManifest),'preparedManifestSha256':sha(read(derivedManifest)),'addonPath':str(T/'bochs/bw_direct.node'),'provenanceKind':'DERIVED_RELOCATED_CI_BUILD','relocation':relocation};assert B==expectedB
input={'preparedManifest':str(derivedManifest),'preparedManifestSha256':sha(read(derivedManifest)),'buildReceipt':str(derivedReceipt),'buildReceiptSha256':sha(read(derivedReceipt)),'addon':B['addonPath'],'sha256':B['addonSha256']};(R/'static-input.json').write_text(json.dumps({'sourceWorktree':str(RW),'compiledWorktree':str(W),'compiledRevision':EXPECTED,'compiledSourceHashes':A['sourceHashes'],'runtimeRevision':RUNTIME,'runtimeSourceHashes':A['runtimeSourceHashes'],'input':input},indent=2)+'\n');run('source-admission',[A['node'],'--max-old-space-size=512',str(P/'authenticate.mjs'),str(R/'static-input.json')])
for name,h in inventory['files'].items():assert sha(read(D/name,256<<20))==h
assert sha(read(A['originalArchive'],256<<20))==A['ci']['zipSha256']
assert sha(read(D/'artifact-inventory.json'))==A['inventorySha256'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
for name,h in A['sourceHashes'].items():assert sha(read(W/name))==h
for name,h in A['runtimeSourceHashes'].items():assert sha(read(RW/name))==h
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=RW,text=True).strip()==RUNTIME and not subprocess.check_output(['git','status','--porcelain'],cwd=RW).strip()
for name,h in A['helperHashes'].items():assert sha(read(P/name))==h
(R/'relocation-proof.json').write_text(json.dumps(relocation,indent=2)+'\n');print(json.dumps({'status':'DERIVED_RELOCATED_CI_STATIC_ADMISSION_PASS_NO_ADDON_LOAD_OR_GUEST','original':original,'derivedManifestSha256':input['preparedManifestSha256'],'derivedReceiptSha256':input['buildReceiptSha256']}))
