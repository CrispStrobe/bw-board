import runpy
bindPrepared=runpy.run_path('/mnt/volume1/tmp-astra/native-hot-h5-runtime-controls-20261001/build-bindings.py')['bind']
import pathlib,json,hashlib,subprocess,importlib.util,os,sys
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-args-20261001');node='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
sha=lambda b:hashlib.sha256(b).hexdigest();approvedBytes=(P/'approved-bindings.json').read_bytes();approved=json.loads(approvedBytes);assert str(pathlib.Path(sys.argv[1]).resolve())==approved['addonPath'];assert sys.argv[2]==approved['addonSha256'];assert sha(pathlib.Path(approved['manifestPath']).read_bytes())==approved['manifestSha256'];externalBefore={name:sha((P/name).read_bytes()) for name in ['run.py','child.mjs','prepare.py','preparation.json','plan.json','build-bindings.py']};assert externalBefore==approved['helperHashes'];revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert revision==json.load(open(P/'approved-bindings.json'))['revision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
manifest=json.load(open(json.load(open(P/'approved-bindings.json'))['manifestPath']));compiled={k:sha((W/k).read_bytes()) for k in manifest['sourceHashes']};assert compiled==manifest['sourceHashes']
tree=pathlib.Path(json.load(open(P/'approved-bindings.json'))['tree'])
for k,h in manifest['patchedHashes'].items():assert sha((tree/k).read_bytes())==h
prepared=bindPrepared(approved['manifestPath'],tree,approved['configSha256'])
reference=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));records=[]
helper_before=sha(pathlib.Path(__file__).read_bytes());child_before=sha((P/'child.mjs').read_bytes())
(P/'auth-before.json').write_text(json.dumps({'revision':revision,'parentSha':sha(pathlib.Path(__file__).read_bytes()),'childSha':sha((P/'child.mjs').read_bytes()),'addonSha':sha(pathlib.Path(sys.argv[1]).read_bytes()),'compiledSourceHashes':compiled,'preparedFiles':prepared,'transformHashes':manifest['patchedHashes'],'compiledSourceInputs':len(compiled),'transformInputs':len(manifest['patchedHashes']),'approvedSha256':sha(approvedBytes),'manifestSha256':approved['manifestSha256'],'helperHashes':externalBefore},indent=2));assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2]
for control in ['packed-argc','baseline','method-swap','getter-order','reentry','intrinsics','primitive-map','primitive-pio','invalid-operation-value','throw-epoch','invalid-epoch','tuple-float','tuple-length','tuple-offset','tuple-backing','tuple-shared','tuple-detached']:
 stem=P/control;inp={'addon':sys.argv[1],'sha256':sys.argv[2],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':False,'hostJournal':False,'profile':False,'control':control};ip=P/(control+'.input.json');ip.write_text(json.dumps(inp));os.environ['BW_HOT_NAPI_PROFILE']='0';oldcwd=os.getcwd();os.chdir(W)
 try:ex=bounded.run_child(node,P/'child.mjs',ip,stem)
 finally:os.chdir(oldcwd)
 raw=pathlib.Path(str(stem)+'.stderr').read_bytes();events=[json.loads(x) for x in (stem/'control.jsonl').read_text().splitlines()];names=[x['name'] for x in events];positive=control in ['packed-argc','baseline','method-swap','getter-order','reentry','intrinsics','primitive-map','primitive-pio']
 if positive:
  assert ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',ex;actual=json.load(open(stem/'capture.json'))
  for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:assert actual[k]==reference[k],(control,k)
  expected={'packed-argc':['packed-argc']*4,'baseline':[],'method-swap':['quantum-original','mapping-replacement','tick-replacement'],'getter-order':['mapping-original','epoch-getter','later-a20-getter'],'reentry':['reentry-before','three-rejections'],'intrinsics':['intrinsics-mutated','captured-mapping-lookup','epoch','a20'],'primitive-map':['mappingEpoch','boardA20'],'primitive-pio':['value','mappingEpoch','boardA20']}[control];assert names==expected,(control,names)
  if control=='packed-argc':assert sorted((x['op'],x['argc']) for x in events)==[(1,1),(2,2),(3,4),(4,1)]
 else:
  assert ex['signal']==6 and not ex['timedOut'] and not ex['fileLimitReached'],ex;assert b'BWSD1\tFAIL\tdirect-scalar-callback\n' in raw;expected=['invalid-operation-value'] if control=='invalid-operation-value' else ['malformed-tuple-return'] if control.startswith('tuple-') else ['epoch-getter'];assert names==expected,names;assert not (stem/'capture.json').exists()
 artifacts={suffix:{'bytes':pathlib.Path(str(stem)+suffix).stat().st_size,'sha256':sha(pathlib.Path(str(stem)+suffix).read_bytes())} for suffix in ['.stdout','.stderr']};records.append({'control':control,'positive':positive,'exit':ex,'events':events,'artifacts':artifacts})
assert (P/'approved-bindings.json').read_bytes()==approvedBytes
assert sha(pathlib.Path(approved['manifestPath']).read_bytes())==approved['manifestSha256']
assert {name:sha((P/name).read_bytes()) for name in externalBefore}==externalBefore
assert compiled=={k:sha((W/k).read_bytes()) for k in compiled}
for k,h in manifest['patchedHashes'].items():assert sha((tree/k).read_bytes())==h
prepared=bindPrepared(approved['manifestPath'],tree,approved['configSha256'])
assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2]
assert sha(pathlib.Path(__file__).read_bytes())==helper_before and sha((P/'child.mjs').read_bytes())==child_before
(P/'auth-after.json').write_text(json.dumps({'revision':revision,'parentSha':helper_before,'childSha':child_before,'addonSha':sys.argv[2],'compiledSourceHashes':compiled,'preparedFiles':prepared,'transformHashes':manifest['patchedHashes'],'compiledSourceInputs':len(compiled),'transformInputs':len(manifest['patchedHashes']),'approvedSha256':sha(approvedBytes),'manifestSha256':approved['manifestSha256'],'helperHashes':externalBefore},indent=2))
assert revision==subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
(P/'summary.json').write_text(json.dumps({'status':'H5_ACTUAL_BASELINE_AND_HOSTILE_CONTROLS_PASS','records':records,'scope':'host metadata effects may precede rejected native acceptance; controls do not qualify arbitrary guest modes'},indent=2));print('PASS17 freshchildren')
