import pathlib,json,subprocess,hashlib,importlib.util,os,sys,statistics
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');node='/tmp/node-v22.23.3-linux-x64/bin/node';sha=lambda b:hashlib.sha256(b).hexdigest();sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert revision=='15631beb63d7c1f17e693de7c86d4ed37b96a768';assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
derivation=json.load(open(P/'derivation.json'));assert derivation['revision']==revision
for item in derivation['children'].values():assert sha(pathlib.Path(item['generatedPath']).read_bytes())==item['generatedSha256'];assert sha((W/item['originalPath']).read_bytes())==item['originalSha256']
builds={};samples=[];reference=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));helperBefore=sha(pathlib.Path(__file__).read_bytes());externalBefore={name:sha((P/name).read_bytes()) for name in ['derive.py','prepare-parent.py','derivation.json','H3-cpu-child.mjs','H4-cpu-child.mjs','H3-diff.txt','H4-diff.txt']}
for label,binaryHash,entry in [('H3','47cbd33c1856d585208221d28aa614345723a42ea302eff83128671e6fe030de','run-i80386-native-hot-direct.mjs'),('H4','5257a116734fb813b3ef9df31666eea0b41753d344f5c928b312765c0c497cd4','run-i80386-native-hot-packed-scalar.mjs')]:
 manifestPath=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-'+label.lower()+'-20261001/prepare.json');m=json.load(open(manifestPath));tree=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-'+label.lower()+'-20261001');binary=tree/'bochs/bw_direct.node';assert sha(binary.read_bytes())==binaryHash
 for k,h in m['sourceHashes'].items():assert sha((W/k).read_bytes())==h
 for k,h in m['patchedHashes'].items():assert sha((tree/k).read_bytes())==h
 builds[label]={'manifestSha256':sha(manifestPath.read_bytes()),'binary':str(binary),'binarySha256':binaryHash,'entry':derivation['children'][label]['generatedPath'],'compiledSourceInputs':len(m['sourceHashes']),'sourceHashes':m['sourceHashes'],'patchedHashes':m['patchedHashes'],'historicalCompiledRevision':'a645480594a9bc20a4046619745bb85e57abacd0' if label=='H3' else revision}
(P/'auth-before.json').write_text(json.dumps({'driverRevision':revision,'helperSha256':helperBefore,'derivationSha256':sha((P/'derivation.json').read_bytes()),'children':derivation['children'],'externalBindings':externalBefore,'builds':builds},indent=2))
def environment():return {'node':subprocess.check_output([node,'--version'],text=True),'kernel':subprocess.check_output(['uname','-a'],text=True),'hardware':subprocess.check_output(['lscpu'],text=True),'load':pathlib.Path('/proc/loadavg').read_text(),'memory':pathlib.Path('/proc/meminfo').read_text()}
(P/'environment-before.json').write_text(json.dumps(environment(),indent=2))
for index in range(9):
 for label in (['H3','H4'] if index%2==0 else ['H4','H3']):
  stem=P/f'{index}-{label}';b=builds[label];inp={'addon':b['binary'],'sha256':b['binarySha256'],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':False,'hostJournal':False,'profile':False};ip=P/f'{index}-{label}.input.json';ip.write_text(json.dumps(inp));os.environ['BW_HOT_NAPI_PROFILE']='0';oldcwd=os.getcwd();os.chdir(W)
  try:ex=bounded.run_child(node,b['entry'],ip,stem)
  finally:os.chdir(oldcwd)
  assert ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',ex;r=json.load(open(stem/'capture.json'))
  for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:assert r[k]==reference[k],(index,label,k)
  assert r['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0;raw=pathlib.Path(str(stem)+'.stderr').read_bytes();assert b'BWNP1' not in raw
  artifacts={suffix:{'bytes':pathlib.Path(str(stem)+suffix).stat().st_size,'sha256':sha(pathlib.Path(str(stem)+suffix).read_bytes())} for suffix in ['.stdout','.stderr']};(P/f'{index}-{label}.artifacts.json').write_text(json.dumps(artifacts,indent=2));samples.append({'index':index,'build':label,'warmup':index<2,'cProfilerEnabled':False,'executionNs':r['timing']['executionNs'],'executionCpuUserUs':r['timing']['executionCpuUserUs'],'executionCpuSystemUs':r['timing']['executionCpuSystemUs'],'executionCpuTotalUs':r['timing']['executionCpuTotalUs'],'startupNs':r['timing']['startupNs'],'captureSha256':sha((stem/'capture.json').read_bytes()),'source':r['source'],'artifacts':artifacts})
assert sha(pathlib.Path(__file__).read_bytes())==helperBefore
assert {name:sha((P/name).read_bytes()) for name in externalBefore}==externalBefore
for item in derivation['children'].values():assert sha(pathlib.Path(item['generatedPath']).read_bytes())==item['generatedSha256'];assert sha((W/item['originalPath']).read_bytes())==item['originalSha256']
for label,b in builds.items():
 assert sha(pathlib.Path(b['binary']).read_bytes())==b['binarySha256']
 for k,h in b['sourceHashes'].items():assert sha((W/k).read_bytes())==h
 tree=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-'+label.lower()+'-20261001')
 for k,h in b['patchedHashes'].items():assert sha((tree/k).read_bytes())==h
assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip();(P/'auth-after.json').write_text(json.dumps({'driverRevision':revision,'helperSha256':helperBefore,'derivationSha256':sha((P/'derivation.json').read_bytes()),'children':derivation['children'],'externalBindings':externalBefore,'builds':builds},indent=2));(P/'environment-after.json').write_text(json.dumps(environment(),indent=2))
distributions={label:{'allNs':[x['executionNs'] for x in samples if not x['warmup'] and x['build']==label]} for label in builds}
for v in distributions.values():v.update({'minNs':min(v['allNs']),'medianNs':statistics.median(v['allNs']),'maxNs':max(v['allNs'])})
pairs=[]
for i in range(2,9):
 x={r['build']:r['executionNs'] for r in samples if r['index']==i};pairs.append({'index':i,'H3':x['H3'],'H4':x['H4'],'H4overH3':x['H4']/x['H3']})
cpuDistributions={label:[x['executionCpuTotalUs'] for x in samples if not x['warmup'] and x['build']==label] for label in builds}
cpuPairs=[{'index':i,'H3':next(x['executionCpuTotalUs'] for x in samples if x['index']==i and x['build']=='H3'),'H4':next(x['executionCpuTotalUs'] for x in samples if x['index']==i and x['build']=='H4')} for i in range(2,9)]
for pair in cpuPairs:pair['H4overH3']=pair['H4']/pair['H3']
meanCpuReduction=1-statistics.mean(cpuDistributions['H4'])/statistics.mean(cpuDistributions['H3']);criterion=meanCpuReduction>=0.10 and all(x['H4']<x['H3'] for x in cpuPairs)
(P/'summary.json').write_text(json.dumps({'status':'SEVEN_H3_H4_CPU_AND_WALL_PAIRS_AFTER_TWO_WARMUPS_SEMANTIC_PASS','predeclaredCriterion':{'minimumMeanCpuReduction':0.10,'allSevenPairsFavorableRequired':True,'meanCpuReduction':meanCpuReduction,'observedCriterionMet':criterion,'scope':'process-wide all-thread CPU; shared cache/GC, no physical RTx'},'cpuTotalUs':cpuDistributions,'cpuPairs':cpuPairs,'samples':samples,'distributions':distributions,'pairs':pairs,'scope':'H3 disabled-profiler/key-cache bridge vs H4 unprofiled a131 packed scalar protocol+JS wrapper; corresponding original/new drivers with labelled sourceclosures. Freshprocess/JITcold/sharedhost wholeadapter execution, no purecore or physicalRTx claim.'},indent=2));print('PASS18freshchildren')
