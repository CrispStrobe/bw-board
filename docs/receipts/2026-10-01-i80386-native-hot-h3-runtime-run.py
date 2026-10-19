import pathlib,json,hashlib,subprocess,importlib.util,os,sys
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-property-keys-20261001');node='/tmp/node-v22.23.3-linux-x64/bin/node';sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
sha=lambda b:hashlib.sha256(b).hexdigest();revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert revision=='a645480594a9bc20a4046619745bb85e57abacd0';assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
manifest=json.load(open('/mnt/volume1/tmp-astra/native-hot-build-h3-20261001/prepare.json'));compiled={k:sha((W/k).read_bytes()) for k in manifest['sourceHashes']};assert compiled==manifest['sourceHashes']
reference=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/off/capture.json'));records=[]
(P/'auth-before.json').write_text(json.dumps({'revision':revision,'parentSha':sha(pathlib.Path(__file__).read_bytes()),'childSha':sha((P/'child.mjs').read_bytes()),'addonSha':sha(pathlib.Path(sys.argv[1]).read_bytes()),'compiled34':compiled},indent=2));assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2]
for control in ['baseline','method-swap','getter-order','reentry','throw-getter','invalid-nan','invalid-fraction','invalid-negative','invalid-overflow']:
 stem=P/control;inp={'addon':sys.argv[1],'sha256':sys.argv[2],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':False,'hostJournal':False,'profile':False,'control':control};ip=P/(control+'.input.json');ip.write_text(json.dumps(inp));os.environ['BW_HOT_NAPI_PROFILE']='0';oldcwd=os.getcwd();os.chdir(W)
 try:ex=bounded.run_child(node,P/'child.mjs',ip,stem)
 finally:os.chdir(oldcwd)
 raw=pathlib.Path(str(stem)+'.stderr').read_bytes();events=[json.loads(x) for x in (stem/'control.jsonl').read_text().splitlines()];names=[x['name'] for x in events];positive=control in ['baseline','method-swap','getter-order','reentry']
 if positive:
  assert ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',ex;actual=json.load(open(stem/'capture.json'))
  for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed']:assert actual[k]==reference[k],(control,k)
  expected={'baseline':[],'method-swap':['quantum-original','mapping-replacement','tick-replacement'],'getter-order':['mapping-original','epoch-getter','later-a20-getter'],'reentry':['reentry-before','reentry-rejected']}[control];assert names==expected,(control,names)
 else:
  assert ex['signal']==6 and not ex['timedOut'] and not ex['fileLimitReached'],ex;assert b'BWSD1\tFAIL\tdirect-scalar-callback\n' in raw;assert names==['epoch-getter'],names;assert not (stem/'capture.json').exists()
 artifacts={suffix:{'bytes':pathlib.Path(str(stem)+suffix).stat().st_size,'sha256':sha(pathlib.Path(str(stem)+suffix).read_bytes())} for suffix in ['.stdout','.stderr']};records.append({'control':control,'positive':positive,'exit':ex,'events':events,'artifacts':artifacts})
assert compiled=={k:sha((W/k).read_bytes()) for k in compiled}
assert revision==subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
(P/'summary.json').write_text(json.dumps({'status':'H3_ACTUAL_BASELINE_AND_HOSTILE_CONTROLS_PASS','records':records,'scope':'host metadata effects may precede rejected native acceptance; controls do not qualify arbitrary guest modes'},indent=2));print('PASS9 freshchildren')
