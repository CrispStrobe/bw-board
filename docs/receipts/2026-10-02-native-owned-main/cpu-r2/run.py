# One predeclared18-child unprofiled gate; no retries or chosen samples.
import json,pathlib,hashlib,subprocess,resource,time,os,re
W=pathlib.Path('/tmp/bw-board-386-native-owned-main-20261002');H=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');B=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002');R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-main-cpu-gate-r2-20261002/results');P=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-main-cpu-gate-r2-20261002/plan.json')
sha=lambda p:hashlib.file_digest(pathlib.Path(p).open('rb'),'sha256').hexdigest()
approvedBytes=(P.parent/'approved-bindings.json').read_bytes();approved=json.loads(approvedBytes);assert approved['revision']=='bab751825473d55d8bf6da8c6ad5786921ffcfe1'
plan=json.loads(P.read_bytes());receipt=json.loads((B/'build-static-preflight.json').read_bytes());h4manifest=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h4-20261001/prepare.json');h4=json.loads(h4manifest.read_bytes());reference=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json');a=json.loads(reference.read_bytes())
assert json.loads(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-main-lifecycle-controls-20261002/summary.json').read_bytes())['status']=='MAIN_LIFECYCLE_CONTROLS_PASS_NOT_FULL_QUALIFICATION'
assert json.loads(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-main-fulltrace-on-20261002/root-parity.json').read_bytes())['canonicalNativeRows']==1649067
assert sha(reference)=='3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649'
assert sha(plan['baselineHelperPath'])==plan['baselineHelperSha256'];R.mkdir(exist_ok=False)
candidateSource=json.loads(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-main-source-20261002/source-freeze.json').read_bytes())['source'];assert candidateSource['revision']==plan['candidateSource'];assert len(candidateSource['hashes'])==95
assert approved['candidateSource']==candidateSource and approved['baselineSource']==a['source'];assert len(a['source']['hashes'])==61
for p,h in receipt['sourceHashes'].items():assert candidateSource['hashes'][p]==h
assert len(h4['sourceHashes'])==32
config=B/'guest-source.bochsrc';configBinding=json.loads((B/'guest-config-binding.json').read_bytes())
def auth():
 for root,rev,hashes in [(W,plan['candidateSource'],candidateSource['hashes']),(H,a['source']['revision'],a['source']['hashes']),(H,h4['boardRevision'],h4['sourceHashes'])]:
  assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip()==rev
  assert not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip()
  for p,h in hashes.items():assert sha(root/p)==h==hashlib.sha256(subprocess.check_output(['git','show',rev+':'+p],cwd=root)).hexdigest(),p
 for path,h in configBinding['freeBiosHashes'].items():assert sha(path)==h
 assert sha(config)==configBinding['newConfigSha256'];assert sha(plan['baselineHelperPath'])==plan['baselineHelperSha256']
 assert sha(receipt['addonPath'])==receipt['addonSha256'];assert sha('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h4-20261001/bochs/bw_direct.node')==plan['baselineAddonSha256']
 assert (P.parent/'approved-bindings.json').read_bytes()==approvedBytes
 assert sha(B/'prepare.json')=='7092cf5efdb3d68b65e2b4b8a91f726ae07516e8df0de4712eeb8c92c7369c28';assert sha(B/'build-static-preflight.json')=='acebb536e93e6e74218057f18ae1e5a47d8f436e7aee212c0d82b8658d4e3da8'
 assert {p:sha(pathlib.Path(__file__).parent/p)for p in ['run.py','plan.json']}==approved['helperHashes']
 for p,h in approved['artifactHashes'].items():assert sha(p)==h
 return {'planSha256':sha(P),'helperSha256':sha(__file__),'candidateReceiptSha256':sha(B/'build-static-preflight.json'),'candidateManifestSha256':sha(B/'prepare.json'),'baselineManifestSha256':sha(h4manifest),'baselineHelperSha256':sha(plan['baselineHelperPath']),'configSha256':sha(config),'candidateSource':plan['candidateSource'],'compiledCandidateSource':receipt['sourceRevision'],'candidateSourceHashes':candidateSource['hashes'],'approvedBindingsSha256':sha(P.parent/'approved-bindings.json'),'baselineSource':h4['boardRevision']}
def logical(v):
 if isinstance(v,dict):
  result={}
  for k,x in v.items():
   if k=='clockTransfers'and 'nativeTicks'in v and 'successfulQuanta'in v:continue
   if k=='sliceBytes':
    if isinstance(x,dict):
     assert set(x)=={str(i) for i in range(160)};x=[x[str(i)]for i in range(160)]
    assert isinstance(x,list)and len(x)==160 and all(type(byte)is int and 0<=byte<=255 for byte in x)
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
  stem=R/(str(i)+'-'+arm);inp={'addon':receipt['addonPath'] if arm=='MAIN' else '/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h4-20261001/bochs/bw_direct.node','sha256':receipt['addonSha256'] if arm=='MAIN' else plan['baselineAddonSha256'],'configuration':str(config),'baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'hostJournal':False,'nativeTrace':False,'profile':False}
  if arm=='MAIN':inp.pop('profile')
  if arm=='MAIN':inp.update({'preparedManifest':str(B/'prepare.json'),'preparedManifestSha256':sha(B/'prepare.json'),'buildReceipt':str(B/'build-static-preflight.json'),'buildReceiptSha256':sha(B/'build-static-preflight.json')})
  ip=R/(str(i)+'-'+arm+'.input.json');ip.write_text(json.dumps(inp,indent=2)+'\n');entry=W/'scripts/run-i80386-native-owned-main.mjs' if arm=='MAIN' else pathlib.Path(plan['baselineHelperPath']);cmd=['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512',str(entry),str(ip)];start=time.monotonic();timedout=False
  with pathlib.Path(str(stem)+'.stdout').open('xb') as out,pathlib.Path(str(stem)+'.stderr').open('xb') as err:
   try:r=subprocess.run(cmd,cwd=W if arm=='MAIN' else H,stdout=out,stderr=err,timeout=120,env={**os.environ,**{k:'' for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']}},preexec_fn=limits);code=r.returncode
   except subprocess.TimeoutExpired:code=None;timedout=True
  exit={'command':cmd,'exitCode':code,'timedOut':timedout,'elapsedSeconds':time.monotonic()-start,'limits':{'heapMiB':512,'wallSeconds':120,'cpuSeconds':120,'niceIncrement':10,'fileMiB':256,'coreBytes':0},'blankEnvironment':{k:''for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']},'streams':{n:{'bytes':pathlib.Path(str(stem)+'.'+n).stat().st_size,'sha256':sha(str(stem)+'.'+n)} for n in ['stdout','stderr']}}
  pathlib.Path(str(stem)+'.exit.json').write_text(json.dumps(exit,indent=2)+'\n');assert code==0 and not timedout and all(v['bytes']<256*1024*1024 for v in exit['streams'].values())
  b=json.loads((stem/'capture.json').read_bytes());assert b['source']==(approved['candidateSource']if arm=='MAIN'else approved['baselineSource']),(i,arm,'runtime source closure')
  for field in ['reset','final','checkpoints','settled','ramSha256','resumes']:assert logical(b[field])==logical(a[field]),(i,arm,field)
  assert b['resumes']==439 and len(b['checkpoints'])==6;assert b['terminal']is True
  assert b['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0
  timing=b['timing']
  if arm=='MAIN':
   usage=timing['executionCPU'];assert usage['unit']=='microseconds';assert all(type(usage[k])is int and usage[k]>=0 for k in ['user','system','total']);assert usage['total']==usage['user']+usage['system'];cpu=usage['total']
  else:
   assert all(type(timing[k])is int and timing[k]>=0 for k in ['executionCpuUserUs','executionCpuSystemUs','executionCpuTotalUs']);assert timing['executionCpuTotalUs']==timing['executionCpuUserUs']+timing['executionCpuSystemUs'];cpu=timing['executionCpuTotalUs']
  assert type(cpu)is int and cpu>0
  record={'pair':i,'arm':arm,'warmup':i<2,'executionCpuTotalUs':cpu,'executionNs':b['timing']['executionNs'],'captureSha256':sha(stem/'capture.json'),'inputSha256':sha(ip),'exit':exit,'fullLogicalParity':True};records.append(record)
  assert auth()==before;print(json.dumps({k:record[k] for k in ['pair','arm','warmup','executionCpuTotalUs']}),flush=True)
measured=[r for r in records if not r['warmup']];h4samples=[r['executionCpuTotalUs'] for r in measured if r['arm']=='H4'];owned=[r['executionCpuTotalUs'] for r in measured if r['arm']=='MAIN'];assert len(h4samples)==len(owned)==7
h4mean=sum(h4samples)/7;mean=sum(owned)/7;reduction=100*(1-mean/h4mean);favorable=[owned[i]<h4samples[i] for i in range(7)];passed=reduction>=10 and all(favorable)
result={'status':'ACTUAL_ABI3_MAIN_PROCESS_CPU_GATE_PASS' if passed else 'ACTUAL_ABI3_MAIN_PROCESS_CPU_GATE_FAIL_KEEP_H4','planSha256':sha(P),'records':records,'h4SamplesUs':h4samples,'ownedSamplesUs':owned,'h4MeanUs':h4mean,'ownedMeanUs':mean,'meanReductionPercent':reduction,'allSevenFavorable':all(favorable),'gatePassed':passed,'scope':plan['metric'],'physicalRTxMeasured':False,'broaderGuestQualification':False}
(R/'auth-after.json').write_text(json.dumps(auth(),indent=2)+'\n');(R/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='records'}),flush=True)
