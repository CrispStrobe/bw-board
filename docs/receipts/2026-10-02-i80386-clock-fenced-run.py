import pathlib,json,hashlib,subprocess,importlib.util,os,sys,itertools,runpy
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-clock-batch-witness-20261002');sha=lambda b:hashlib.sha256(b).hexdigest()
def file_sha(p):
 with pathlib.Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
Abytes=(P/'approved-bindings.json').read_bytes();A=json.loads(Abytes);Mpath=pathlib.Path(A['manifestPath']);M=json.loads(Mpath.read_bytes());T=pathlib.Path(A['tree']);binary=pathlib.Path(A['addonPath']);native_baseline=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json')
assert sha(pathlib.Path(__file__).read_bytes())==A['helperSha256'];assert file_sha(Mpath)==A['manifestSha256'];assert file_sha(binary)==A['addonSha256']=='5257a116734fb813b3ef9df31666eea0b41753d344f5c928b312765c0c497cd4'
assert M['boardRevision']=='15631beb63d7c1f17e693de7c86d4ed37b96a768';assert len(M['sourceHashes'])==32 and len(M['patchedHashes'])==12
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==A['driverRevision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
for path,digest in A['newSourceHashes'].items():assert file_sha(W/path)==digest;assert sha(subprocess.check_output(['git','show',A['driverRevision']+':'+path],cwd=W))==digest
for path,digest in M['sourceHashes'].items():assert file_sha(W/path)==digest;assert sha(subprocess.check_output(['git','show',M['boardRevision']+':'+path],cwd=W))==digest
for path,digest in M['patchedHashes'].items():assert file_sha(T/path)==digest
for path,digest in A['preparedFileHashes'].items():assert file_sha(T/path)==digest
assert file_sha(native_baseline)=='3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649'
before={'approvedSha256':sha(Abytes),'driverRevision':A['driverRevision'],'newSourceHashes':A['newSourceHashes'],'compiledSourceRevision':M['boardRevision'],'compiledSourceHashes':M['sourceHashes'],'transformHashes':M['patchedHashes'],'preparedFileHashes':A['preparedFileHashes'],'manifestSha256':A['manifestSha256'],'addonSha256':A['addonSha256'],'helperSha256':A['helperSha256']};(P/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded)
node='/tmp/node-v22.23.3-linux-x64/bin/node';stem=P/'fenced';input_path=P/'fenced.input.json';inp={'addon':str(binary),'sha256':A['addonSha256'],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':True,'hostJournal':True,'profile':False};input_path.write_text(json.dumps(inp));os.environ['BW_HOT_NAPI_PROFILE']='0';os.chdir(W)
ex=bounded.run_child(node,W/'scripts/run-i80386-native-hot-clock-fenced.mjs',input_path,stem);assert ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',ex
capture=json.loads((stem/'capture.json').read_bytes());ref=json.loads(native_baseline.read_bytes())
for field in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed','journal']:assert capture[field]==ref[field],field
assert capture['source']['revision']==A['driverRevision'];assert len(capture['source']['hashes'])==A['driverSourceInputs']
for path,digest in capture['source']['hashes'].items():assert file_sha(W/path)==digest;assert sha(subprocess.check_output(['git','show',A['driverRevision']+':'+path],cwd=W))==digest
assert capture['addon']['sha256']==A['addonSha256'];assert capture['captureModes']=={'nativeRawTrace':True,'hostCompactSink':True};assert file_sha(stem/'callbacks.jsonl')=='bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1'
old=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/on.stderr');assert file_sha(old)=='21ea17d068097696c3bf3c991cfdead2f236a833319a563747cabc66f7488308'
def canonical(path):
 with pathlib.Path(path).open('rb') as f:
  for line in f:
   if line.startswith(b'BWSD1\t'):yield line
   else:assert b'BWSD1' not in line,'malformed marker fragment'
rows=0
for a,b in itertools.zip_longest(canonical(old),canonical(str(stem)+'.stderr')):assert a==b,rows;rows+=1
assert rows==1649067
fences=stem/'fences.jsonl';assert file_sha(fences)==capture['fenceCapture']['sha256'];assert fences.stat().st_size==capture['fenceCapture']['bytes'];assert len(fences.read_bytes().splitlines())==capture['fenceCapture']['rows']
assert (P/'approved-bindings.json').read_bytes()==Abytes;assert file_sha(Mpath)==A['manifestSha256'];assert file_sha(binary)==A['addonSha256'];assert file_sha(pathlib.Path(__file__))==A['helperSha256']
for path,digest in A['newSourceHashes'].items():assert file_sha(W/path)==digest
for path,digest in M['sourceHashes'].items():assert file_sha(W/path)==digest
for path,digest in M['patchedHashes'].items():assert file_sha(T/path)==digest
for path,digest in A['preparedFileHashes'].items():assert file_sha(T/path)==digest
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==A['driverRevision'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip();(P/'auth-after.json').write_bytes((P/'auth-before.json').read_bytes())
inputs={k:{'path':str(p),'sha256':file_sha(p)} for k,p in {'trace':pathlib.Path(str(stem)+'.stderr'),'journal':stem/'callbacks.jsonl','capture':stem/'capture.json','fences':fences}.items()};(P/'offline-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
out={'status':'ACTUAL_H4_FENCED_CAPTURE_FULL_H1_PARITY_PASS_NOT_BATCH_ADMISSION','canonicalRows':rows,'driverRevision':A['driverRevision'],'compiledSourceRevision':M['boardRevision'],'driverSourceInputs':len(capture['source']['hashes']),'compiledSourceInputs':len(M['sourceHashes']),'transformInputs':len(M['patchedHashes']),'fenceCapture':capture['fenceCapture'],'actualInputHashes':inputs,'scope':'Diagnostic only; no native batching implemented and no timing qualification'};(P/'comparison.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
