# One predeclared18-child unprofiled gate; no retries or chosen samples.
import json,pathlib,hashlib,subprocess,resource,time,os,re
W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002');H=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');B=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002');R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-cpu-benchmark-20261002');P=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-cpu-plan-20261002.json')
sha=lambda p:hashlib.file_digest(pathlib.Path(p).open('rb'),'sha256').hexdigest()
plan=json.loads(P.read_bytes());receipt=json.loads((B/'build-static-preflight.json').read_bytes());h4manifest=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h4-20261001/prepare.json');h4=json.loads(h4manifest.read_bytes());reference=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json');a=json.loads(reference.read_bytes())
assert json.loads(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-runtime-controls-20261002/summary.json').read_bytes())['status']=='ACTUAL_ABI3_CONTROLS_PASS_NOT_FULL_QUALIFICATION'
assert json.loads(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-fulltrace-on-r2-20261002/root-parity.json').read_bytes())['canonicalNativeRows']==1649067
assert sha(reference)=='3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649'
assert sha(plan['baselineHelperPath'])==plan['baselineHelperSha256'];R.mkdir(exist_ok=False)
config=B/'guest-source.bochsrc';configBinding=json.loads((B/'guest-config-binding.json').read_bytes())
def auth():
 for root,rev,hashes in [(W,plan['candidateSource'],receipt['sourceHashes']),(H,h4['boardRevision'],h4['sourceHashes'])]:
  assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip()==rev
  assert not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip()
  for p,h in hashes.items():assert sha(root/p)==h,p
 for path,h in configBinding['freeBiosHashes'].items():assert sha(path)==h
 assert sha(config)==configBinding['newConfigSha256'];assert sha(plan['baselineHelperPath'])==plan['baselineHelperSha256']
 assert sha(receipt['addonPath'])==receipt['addonSha256'];assert sha('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h4-20261001/bochs/bw_direct.node')==plan['baselineAddonSha256']
 return {'planSha256':sha(P),'helperSha256':sha(__file__),'candidateReceiptSha256':sha(B/'build-static-preflight.json'),'candidateManifestSha256':sha(B/'prepare.json'),'baselineManifestSha256':sha(h4manifest),'baselineHelperSha256':sha(plan['baselineHelperPath']),'configSha256':sha(config),'candidateSource':plan['candidateSource'],'baselineSource':h4['boardRevision']}
def logical(v):
 if isinstance(v,dict):
  result={}
  for k,x in v.items():
   if k=='clockTransfers':continue
   if k=='sliceBytes' and isinstance(x,dict):
    assert set(x)=={str(i) for i in range(160)} and all(type(x[str(i)]) is int and 0<=x[str(i)]<=255 for i in range(160));x=[x[str(i)] for i in range(160)]
   result[k]=logical(x)
  return result
 if isinstance(v,list):return [logical(x) for x in v]
 return v
before=auth();(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
def limits():
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(120,120));os.nice(10)
records=[]
for i,order in enumerate(plan['samples']['pairOrder']):
 for arm in order.split(','):
  stem=R/(str(i)+'-'+arm);inp={'addon':receipt['addonPath'] if arm=='ABI3' else '/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h4-20261001/bochs/bw_direct.node','sha256':receipt['addonSha256'] if arm=='ABI3' else plan['baselineAddonSha256'],'configuration':str(config),'baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'hostJournal':False,'nativeTrace':False,'profile':False}
  if arm=='ABI3':inp.update({'preparedManifest':str(B/'prepare.json'),'preparedManifestSha256':sha(B/'prepare.json'),'buildReceipt':str(B/'build-static-preflight.json'),'buildReceiptSha256':sha(B/'build-static-preflight.json')})
  ip=R/(str(i)+'-'+arm+'.input.json');ip.write_text(json.dumps(inp,indent=2)+'\n');entry=W/'scripts/run-i80386-native-owned-clock.mjs' if arm=='ABI3' else pathlib.Path(plan['baselineHelperPath']);cmd=['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512',str(entry),str(ip)];start=time.monotonic();timedout=False
  with pathlib.Path(str(stem)+'.stdout').open('xb') as out,pathlib.Path(str(stem)+'.stderr').open('xb') as err:
   try:r=subprocess.run(cmd,cwd=W if arm=='ABI3' else H,stdout=out,stderr=err,timeout=120,env={**os.environ,'NODE_OPTIONS':''},preexec_fn=limits);code=r.returncode
   except subprocess.TimeoutExpired:code=None;timedout=True
  exit={'command':cmd,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-start,'streams':{n:{'bytes':pathlib.Path(str(stem)+'.'+n).stat().st_size,'sha256':sha(str(stem)+'.'+n)} for n in ['stdout','stderr']}}
  pathlib.Path(str(stem)+'.exit.json').write_text(json.dumps(exit,indent=2)+'\n');assert code==0 and not timedout and all(v['bytes']<256*1024*1024 for v in exit['streams'].values())
  b=json.loads((stem/'capture.json').read_bytes())
  for field in ['reset','final','checkpoints','settled','ramSha256','resumes']:assert logical(b[field])==logical(a[field]),(i,arm,field)
  assert b['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0
  cpu=b['timing']['executionCPU']['total'] if arm=='ABI3' else b['timing']['executionCpuTotalUs'];assert isinstance(cpu,int) and cpu>0
  record={'pair':i,'arm':arm,'warmup':i<2,'executionCpuTotalUs':cpu,'executionNs':b['timing']['executionNs'],'captureSha256':sha(stem/'capture.json'),'inputSha256':sha(ip),'exit':exit,'fullLogicalParity':True};records.append(record)
  assert auth()==before;print(json.dumps({k:record[k] for k in ['pair','arm','warmup','executionCpuTotalUs']}),flush=True)
measured=[r for r in records if not r['warmup']];h4samples=[r['executionCpuTotalUs'] for r in measured if r['arm']=='H4'];owned=[r['executionCpuTotalUs'] for r in measured if r['arm']=='ABI3'];assert len(h4samples)==len(owned)==7
h4mean=sum(h4samples)/7;mean=sum(owned)/7;reduction=100*(1-mean/h4mean);favorable=[owned[i]<h4samples[i] for i in range(7)];passed=reduction>=10 and all(favorable)
result={'status':'ACTUAL_ABI3_PROCESS_CPU_GATE_PASS' if passed else 'ACTUAL_ABI3_PROCESS_CPU_GATE_FAIL_KEEP_H4','planSha256':sha(P),'records':records,'h4SamplesUs':h4samples,'ownedSamplesUs':owned,'h4MeanUs':h4mean,'ownedMeanUs':mean,'meanReductionPercent':reduction,'allSevenFavorable':all(favorable),'gatePassed':passed,'scope':plan['metric'],'physicalRTxMeasured':False,'broaderGuestQualification':False}
(R/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');(R/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='records'}),flush=True)
