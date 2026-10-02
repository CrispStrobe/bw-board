# Actual guest execution only after root-reviewed frozen build receipt.
import json,hashlib,pathlib,subprocess,resource,time,os,sys
W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-alloc-20261002');B=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002')
expected='5da2a4c513a8c35153fd39fb55f73b386560ea80';compiledExpected='7df84bc2c367aff1cadec7cecdde69cf0e904ace';label='trace-fast';assert len(sys.argv)==1
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-alloc-trace-fast-20261002/actual');R.mkdir(exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
receipt=json.loads((B/'build-static-preflight.json').read_bytes());assert receipt['sourceRevision']==compiledExpected
freezePath=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-alloc-source-20261002/source-freeze.json')
freezeSha='6dd59e02aff506b7016d690ebc3426c6977c007809e5a9225b5b89014960b9b9';assert sha(freezePath.read_bytes())==freezeSha
freeze=json.loads(freezePath.read_bytes());assert freeze['source']['revision']==expected
config=B/'guest-source.bochsrc'
configBindingSha='1770dff4e885b017572feed058088b441e186cde02a3971a225cd8f60d24bda0';assert sha((B/'guest-config-binding.json').read_bytes())==configBindingSha
configBinding=json.loads((B/'guest-config-binding.json').read_bytes())
assert sha(config.read_bytes())==configBinding['newConfigSha256']
inputs={'addon':receipt['addonPath'],'sha256':receipt['addonSha256'],'configuration':str(config),'baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(R/'guest'),'nativeTrace':True,'hostJournal':False,'preparedManifest':str(B/'prepare.json'),'preparedManifestSha256':sha((B/'prepare.json').read_bytes()),'buildReceipt':str(B/'build-static-preflight.json'),'buildReceiptSha256':sha((B/'build-static-preflight.json').read_bytes())}
(R/'input.json').write_text(json.dumps(inputs,indent=2)+'\n')
def authenticate():
 assert sha(freezePath.read_bytes())==freezeSha
 assert sha((B/'guest-config-binding.json').read_bytes())==configBindingSha
 assert sha(config.read_bytes())==configBinding['newConfigSha256']
 assert sha((B/'build-static-preflight.json').read_bytes())==inputs['buildReceiptSha256']
 assert sha((B/'prepare.json').read_bytes())==inputs['preparedManifestSha256']
 assert sha(pathlib.Path(inputs['baseline']).read_bytes())=='c079fc196461e7d062df7e6a8a9b13b28ab9014b36a1040698fc5bab91ecdc5f'
 manifest=json.loads((B/'prepare.json').read_bytes())
 for name,h in {**manifest['patchedHashes'],**receipt['preparedHashes']}.items():assert sha((pathlib.Path(receipt['preparedTree'])/name).read_bytes())==h
 assert sha((pathlib.Path(receipt['preparedTree'])/'bochs/config.h').read_bytes())==receipt['configSha256']
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W).decode().strip()==expected
 assert subprocess.check_output(['git','status','--porcelain'],cwd=W).decode().strip()==''
 for name,h in freeze['source']['hashes'].items():assert sha((W/name).read_bytes())==h==sha(subprocess.check_output(['git','show',expected+':'+name],cwd=W))
 for name,h in receipt['sourceHashes'].items():assert freeze['source']['hashes'][name]==h
 for path,h in configBinding['freeBiosHashes'].items():assert sha(pathlib.Path(path).read_bytes())==h
 assert sha(pathlib.Path(inputs['addon']).read_bytes())==inputs['sha256']
 return {'sourceRevision':expected,'compiledSourceRevision':compiledExpected,'sourceFreezeSha256':sha(freezePath.read_bytes()),'inputSha256':sha((R/'input.json').read_bytes()),'configSourceSha256':sha(config.read_bytes()),'buildReceiptSha256':inputs['buildReceiptSha256'],'preparedManifestSha256':inputs['preparedManifestSha256'],'addonSha256':inputs['sha256'],'sourceFiles':len(freeze['source']['hashes']),'compiledSourceFiles':len(receipt['sourceHashes']),'helperSha256':sha(pathlib.Path(__file__).read_bytes())}
approvalPath=pathlib.Path(__file__).parent/'approved-bindings.json';approvalBytes=approvalPath.read_bytes();approval=json.loads(approvalBytes);assert approval['helperHashes']=={n:sha((pathlib.Path(__file__).parent/n).read_bytes())for n in ['run.py','parity.py','plan.json']}
for p,h in approval['artifactHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h
before=authenticate();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
def limits():
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(120,120));os.nice(10)
cmd=['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512',str(W/'scripts/run-i80386-native-owned-clock-alloc.mjs'),str(R/'input.json')]
start=time.monotonic();timedout=False
with (R/'stdout').open('xb') as out,(R/'stderr').open('xb') as err:
 try:r=subprocess.run(cmd,cwd=W,stdout=out,stderr=err,timeout=120,preexec_fn=limits,env={**os.environ,'NODE_OPTIONS':'','NODE_PATH':'','LD_PRELOAD':'','LD_AUDIT':'','BW_HOT_NAPI_PROFILE':''});code=r.returncode
 except subprocess.TimeoutExpired:code=None;timedout=True
record={'command':cmd,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-start,'streams':{n:{'bytes':(R/n).stat().st_size,'sha256':sha((R/n).read_bytes())} for n in ['stdout','stderr']},'scope':'distinct main-thread native fixed-ROM execution; no performance gate or broader guest qualification','limits':{'heapMiB':512,'wallSeconds':120,'cpuSeconds':120,'fileMiB':256,'coreBytes':0,'nice':10},'sanitizedEnv':['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}
(R/'exit.json').write_text(json.dumps(record,indent=2)+'\n');assert approvalPath.read_bytes()==approvalBytes
assert approval['helperHashes']=={n:sha((pathlib.Path(__file__).parent/n).read_bytes())for n in ['run.py','parity.py','plan.json']}
for p,h in approval['artifactHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h
after=authenticate();(R/'auth-after.json').write_text(json.dumps(after,indent=2)+'\n');assert before==after
print(json.dumps(record),flush=True)
assert code==0 and not timedout and all(v['bytes']<256*1024*1024 for v in record['streams'].values())
report=json.loads((R/'guest/capture.json').read_bytes());assert report['source']['revision']==expected
if label=='trace-fast':assert report['journal']['rows']==0 and report['journal']['bytes']==0 and (R/'guest/callbacks.jsonl').stat().st_size==0
print(json.dumps({'status':'ACTUAL_GUEST_COMPLETED_NOT_YET_QUALIFIED','nativeTicks':report['final']['nativeTicks'],'quanta':report['final']['successfulQuanta'],'resumes':report['resumes'],'clockTransfers':report['final']['clockTransfers'],'journal':report['journal']}),flush=True)
