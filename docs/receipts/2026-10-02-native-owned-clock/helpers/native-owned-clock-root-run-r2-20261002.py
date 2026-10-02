# Actual guest execution only after root-reviewed frozen build receipt.
import json,hashlib,pathlib,subprocess,resource,time,os,sys
W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002');B=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002')
expected='7df84bc2c367aff1cadec7cecdde69cf0e904ace';label=sys.argv[1];assert label in ['smoke-off','fulltrace-on']
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-'+label+'-r2-20261002');R.mkdir(exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
receipt=json.loads((B/'build-static-preflight.json').read_bytes());assert receipt['sourceRevision']==expected
config=B/'guest-source.bochsrc'
configBinding=json.loads((B/'guest-config-binding.json').read_bytes())
assert sha(config.read_bytes())==configBinding['newConfigSha256']
inputs={'addon':receipt['addonPath'],'sha256':receipt['addonSha256'],'configuration':str(config),'baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(R/'guest'),'nativeTrace':label=='fulltrace-on','hostJournal':label=='fulltrace-on','profile':False,'preparedManifest':str(B/'prepare.json'),'preparedManifestSha256':sha((B/'prepare.json').read_bytes()),'buildReceipt':str(B/'build-static-preflight.json'),'buildReceiptSha256':sha((B/'build-static-preflight.json').read_bytes())}
(R/'input.json').write_text(json.dumps(inputs,indent=2)+'\n')
def authenticate():
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W).decode().strip()==expected
 assert subprocess.check_output(['git','status','--porcelain'],cwd=W).decode().strip()==''
 for name,h in receipt['sourceHashes'].items():assert sha((W/name).read_bytes())==h
 for path,h in configBinding['freeBiosHashes'].items():assert sha(pathlib.Path(path).read_bytes())==h
 assert sha(pathlib.Path(inputs['addon']).read_bytes())==inputs['sha256']
 return {'sourceRevision':expected,'inputSha256':sha((R/'input.json').read_bytes()),'configSourceSha256':sha(config.read_bytes()),'buildReceiptSha256':inputs['buildReceiptSha256'],'preparedManifestSha256':inputs['preparedManifestSha256'],'addonSha256':inputs['sha256'],'sourceFiles':len(receipt['sourceHashes']),'helperSha256':sha(pathlib.Path(__file__).read_bytes())}
before=authenticate();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
def limits():
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(120,120));os.nice(10)
cmd=['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512',str(W/'scripts/run-i80386-native-owned-clock.mjs'),str(R/'input.json')]
start=time.monotonic();timedout=False
with (R/'stdout').open('xb') as out,(R/'stderr').open('xb') as err:
 try:r=subprocess.run(cmd,cwd=W,stdout=out,stderr=err,timeout=120,preexec_fn=limits,env={**os.environ,'NODE_OPTIONS':''});code=r.returncode
 except subprocess.TimeoutExpired:code=None;timedout=True
record={'command':cmd,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-start,'streams':{n:{'bytes':(R/n).stat().st_size,'sha256':sha((R/n).read_bytes())} for n in ['stdout','stderr']},'scope':'diagnostic actual fixed-ROM candidate; no throughput or broader guest qualification'}
(R/'exit.json').write_text(json.dumps(record,indent=2)+'\n');after=authenticate();(R/'auth-after.json').write_text(json.dumps(after,indent=2)+'\n');assert before==after
print(json.dumps(record),flush=True)
assert code==0 and not timedout and all(v['bytes']<256*1024*1024 for v in record['streams'].values())
report=json.loads((R/'guest/capture.json').read_bytes());assert report['source']['revision']==expected
if label=='smoke-off':assert report['journal']['rows']==0 and report['journal']['bytes']==0 and (R/'guest/callbacks.jsonl').stat().st_size==0
print(json.dumps({'status':'ACTUAL_GUEST_COMPLETED_NOT_YET_QUALIFIED','nativeTicks':report['final']['nativeTicks'],'quanta':report['final']['successfulQuanta'],'resumes':report['resumes'],'clockTransfers':report['final']['clockTransfers'],'journal':report['journal']}),flush=True)
