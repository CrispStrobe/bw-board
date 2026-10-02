import pathlib,json,hashlib,subprocess,importlib.util,os,sys
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');node='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
sha=lambda b:hashlib.sha256(b).hexdigest();revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert revision=='15631beb63d7c1f17e693de7c86d4ed37b96a768';assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
manifest=json.load(open('/mnt/volume1/tmp-astra/native-hot-build-h4-20261001/prepare.json'));compiled={k:sha((W/k).read_bytes()) for k in manifest['sourceHashes']};assert compiled==manifest['sourceHashes']
tree=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h4-20261001')
for k,h in manifest['patchedHashes'].items():assert sha((tree/k).read_bytes())==h
reference=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));records=[]
helper_before=sha(pathlib.Path(__file__).read_bytes());child_before=sha((P/'child.mjs').read_bytes())
(P/'auth-before.json').write_text(json.dumps({'revision':revision,'parentSha':sha(pathlib.Path(__file__).read_bytes()),'childSha':sha((P/'child.mjs').read_bytes()),'addonSha':sha(pathlib.Path(sys.argv[1]).read_bytes()),'compiled32':compiled,'patched12':manifest['patchedHashes']},indent=2));assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2]
for control in ['baseline','method-swap','getter-order','reentry','intrinsics','primitive-map','primitive-pio','invalid-operation-value','throw-epoch','invalid-epoch','tuple-float','tuple-length','tuple-offset','tuple-backing','tuple-shared','tuple-detached']:
 stem=P/control;inp={'addon':sys.argv[1],'sha256':sys.argv[2],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':False,'hostJournal':False,'profile':False,'control':control};ip=P/(control+'.input.json');ip.write_text(json.dumps(inp));os.environ['BW_HOT_NAPI_PROFILE']='0';oldcwd=os.getcwd();os.chdir(W)
 try:ex=bounded.run_child(node,P/'child.mjs',ip,stem)
 finally:os.chdir(oldcwd)
 raw=pathlib.Path(str(stem)+'.stderr').read_bytes();events=[json.loads(x) for x in (stem/'control.jsonl').read_text().splitlines()];names=[x['name'] for x in events];positive=control in ['baseline','method-swap','getter-order','reentry','intrinsics','primitive-map','primitive-pio']
 if positive:
  assert ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',ex;actual=json.load(open(stem/'capture.json'))
  for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:assert actual[k]==reference[k],(control,k)
  expected={'baseline':[],'method-swap':['quantum-original','mapping-replacement','tick-replacement'],'getter-order':['mapping-original','epoch-getter','later-a20-getter'],'reentry':['reentry-before','three-rejections'],'intrinsics':['intrinsics-mutated','captured-mapping-lookup','epoch','a20'],'primitive-map':['mappingEpoch','boardA20'],'primitive-pio':['value','mappingEpoch','boardA20']}[control];assert names==expected,(control,names)
 else:
  assert ex['signal']==6 and not ex['timedOut'] and not ex['fileLimitReached'],ex;assert b'BWSD1\tFAIL\tdirect-scalar-callback\n' in raw;expected=['invalid-operation-value'] if control=='invalid-operation-value' else ['malformed-tuple-return'] if control.startswith('tuple-') else ['epoch-getter'];assert names==expected,names;assert not (stem/'capture.json').exists()
 artifacts={suffix:{'bytes':pathlib.Path(str(stem)+suffix).stat().st_size,'sha256':sha(pathlib.Path(str(stem)+suffix).read_bytes())} for suffix in ['.stdout','.stderr']};records.append({'control':control,'positive':positive,'exit':ex,'events':events,'artifacts':artifacts})
assert compiled=={k:sha((W/k).read_bytes()) for k in compiled}
for k,h in manifest['patchedHashes'].items():assert sha((tree/k).read_bytes())==h
assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2]
assert sha(pathlib.Path(__file__).read_bytes())==helper_before and sha((P/'child.mjs').read_bytes())==child_before
(P/'auth-after.json').write_text(json.dumps({'revision':revision,'parentSha':helper_before,'childSha':child_before,'addonSha':sys.argv[2],'compiled32':compiled,'patched12':manifest['patchedHashes']},indent=2))
assert revision==subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
(P/'summary.json').write_text(json.dumps({'status':'H4_ACTUAL_BASELINE_AND_HOSTILE_CONTROLS_PASS','records':records,'scope':'host metadata effects may precede rejected native acceptance; controls do not qualify arbitrary guest modes'},indent=2));print('PASS16 freshchildren')
