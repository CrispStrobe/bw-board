import pathlib,json,subprocess,resource,time,hashlib,collections,os,sys,importlib.util
p=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h3-cost-pairs-20261001');w=pathlib.Path('/tmp/bw-board-386-native-hot-property-keys-20261001');node='/tmp/node-v22.23.3-linux-x64/bin/node';reference=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));samples=[]
(p/'environment.json').write_text(json.dumps({'kernel':subprocess.check_output(['uname','-a'],text=True),'hardware':subprocess.check_output(['lscpu'],text=True),'node':subprocess.check_output([node,'--version'],text=True),'load':pathlib.Path('/proc/loadavg').read_text(),'memory':pathlib.Path('/proc/meminfo').read_text()},indent=2))
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('regular_child',w/'scripts/run-i80386-native-hot-regular-file.py');wrapper=importlib.util.module_from_spec(spec);spec.loader.exec_module(wrapper)
source_revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip();assert source_revision=='a645480594a9bc20a4046619745bb85e57abacd0'
assert not subprocess.check_output(['git','status','--porcelain'],cwd=w,text=True).strip()
manifest=json.load(open('/mnt/volume1/tmp-astra/native-hot-build-h3-20261001/prepare.json'));compiled_before={k:hashlib.sha256((w/k).read_bytes()).hexdigest() for k in manifest['sourceHashes']};assert compiled_before==manifest['sourceHashes']
(p/'helper-auth.json').write_text(json.dumps({'sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'revision':source_revision,'compiled34':compiled_before},indent=2))
tree=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h3-20261001')
for k,h in manifest['patchedHashes'].items():assert hashlib.sha256((tree/k).read_bytes()).hexdigest()==h
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()==sys.argv[2]
for index in range(3):
 for profile in ([False,True] if index%2==0 else [True,False]):
  stem=p/f'{index}-{profile}';inp={'addon':sys.argv[1],'sha256':sys.argv[2],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':False,'hostJournal':False,'profile':False};(p/f'{index}-{profile}.input.json').write_text(json.dumps(inp))
  args=[node,'--max-old-space-size=512']
  args+=[str(w/'scripts/run-i80386-native-hot-direct.mjs'),str(p/f'{index}-{profile}.input.json')]
  oldcwd=os.getcwd();os.chdir(w);os.environ['BW_HOT_NAPI_PROFILE']='1' if profile else '0'
  try:exit=wrapper.run_child(node,args[-2],args[-1],stem,heap_mib=512,timeout_seconds=120,max_file_mib=256)
  finally:os.chdir(oldcwd)
  artifacts={suffix:{'bytes':pathlib.Path(str(stem)+suffix).stat().st_size,'sha256':hashlib.sha256(pathlib.Path(str(stem)+suffix).read_bytes()).hexdigest()} for suffix in ['.stdout','.stderr']};(p/f'{index}-{profile}.artifacts.json').write_text(json.dumps(artifacts,indent=2))
  assert exit['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',exit
  actual=json.load(open(stem/'capture.json'))
  for f in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:assert actual[f]==reference[f],(index,profile,f)
  assert actual['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0
  record={'index':index,'build':'H3','cProfilerEnabled':profile,'profile':profile,'executionNs':actual['timing']['executionNs'],'startupNs':actual['timing']['startupNs'],'wallNs':exit['wallNs'],'captureSha256':hashlib.sha256((stem/'capture.json').read_bytes()).hexdigest(),'source':actual['source']}
  raw=pathlib.Path(str(stem)+'.stderr').read_bytes();record['stderrSha256']=hashlib.sha256(raw).hexdigest();record['stderrBytes']=len(raw)
  if profile:
   parsed=subprocess.check_output([node,'--input-type=module','-e',"import {readFileSync} from 'node:fs';import {parseHotNapiProfile} from './scripts/bochs-cpu3-native-hot-napi-profile/parse.mjs';const p=parseHotNapiProfile(readFileSync(process.argv[1],'utf8').split('\\n'),{expectedCounts:{native_resume_inclusive:439,resume_return_conversion:439,scalar_native_tick:100684,scalar_quantum:100682,scalar_pio:26,scalar_ack:1,memory_whole:8438,page_whole:8}});console.log(JSON.stringify(p,(_,v)=>typeof v==='bigint'?v.toString():v));",str(stem)+'.stderr'],cwd=w,text=True)
   record['costSplit']=json.loads(parsed);assert record['costSplit']['control']['clockReads']=='1428373'
  else:assert b'BWNP1' not in raw,'disabled profiler emitted diagnostics'
  samples.append(record)
for k,h in manifest['patchedHashes'].items():assert hashlib.sha256((tree/k).read_bytes()).hexdigest()==h
assert source_revision==subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip()
assert compiled_before=={k:hashlib.sha256((w/k).read_bytes()).hexdigest() for k in compiled_before}
assert not subprocess.check_output(['git','status','--porcelain'],cwd=w,text=True).strip()
(p/'source-after.json').write_text(json.dumps({'revision':source_revision,'compiled34':compiled_before},indent=2))
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()==sys.argv[2]
summary={'status':'THREE_H3_COST_ON_OFF_PAIRS_FULL_INVARIANTS_PASS','scope':'Three alternating H3 C-profiler OFF/ON pairs; scalar phases disjoint inside inclusive callbacks; profiler overhead/sharedhost not isolated; nativecore unattributed','samples':samples};(p/'summary.json').write_text(json.dumps(summary,indent=2));print('PASS 6 actual children')
