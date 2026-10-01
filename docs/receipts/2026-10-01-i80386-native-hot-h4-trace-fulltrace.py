import pathlib,json,subprocess,hashlib,importlib.util,os,sys,itertools
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded);sha=lambda b:hashlib.sha256(b).hexdigest()
def fileSha(path):
 with open(path,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
manifest=json.load(open('/mnt/volume1/tmp-astra/native-hot-build-h4-20261001/prepare.json'));compiled={k:sha((W/k).read_bytes()) for k in manifest['sourceHashes']};assert compiled==manifest['sourceHashes'];tree=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h4-20261001')
for k,h in manifest['patchedHashes'].items():assert fileSha(tree/k)==h
(P/'fulltrace-auth-before.json').write_text(json.dumps({'compiled32':compiled,'parentSha':fileSha(pathlib.Path(__file__))},indent=2))
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert revision=='15631beb63d7c1f17e693de7c86d4ed37b96a768';assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
stem=P/'fulltrace';ip=P/'fulltrace.input.json';ip.write_text(json.dumps({'addon':sys.argv[1],'sha256':sys.argv[2],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':True,'hostJournal':True,'profile':False}));assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2]
os.environ['BW_HOT_NAPI_PROFILE']='0';os.chdir(W);ex=bounded.run_child('/tmp/node-v22.23.3-linux-x64/bin/node',W/'scripts/run-i80386-native-hot-packed-scalar.mjs',ip,stem);assert ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',ex
old=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/on.stderr');new=pathlib.Path(str(stem)+'.stderr');rows=0
assert fileSha(old)=='21ea17d068097696c3bf3c991cfdead2f236a833319a563747cabc66f7488308'
def canonical(file):
 for line in file:
  if line.startswith(b'BWSD1\t'):yield line
  else:assert b'BWSD1' not in line,'malformed native marker fragment'
with open(old,'rb') as a,open(new,'rb') as b:
 x=canonical(a);y=canonical(b)
 for left,right in itertools.zip_longest(x,y):assert left==right,rows;rows+=1
assert rows==1649067;assert sha((stem/'callbacks.jsonl').read_bytes())=='bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1'
ref=json.load(open('/mnt/volume1/tmp-astra/native-hot-h1-regularfile-pair-20261001/on/capture.json'));r=json.load(open(stem/'capture.json'))
for k in ['reset','final','checkpoints','settled','ramSha256','checksums','witnesses','rawResetWitness','callbackCounts','resumes','closed','journal']:assert r[k]==ref[k],k
assert compiled=={k:sha((W/k).read_bytes()) for k in compiled}
for k,h in manifest['patchedHashes'].items():assert fileSha(tree/k)==h
assert fileSha(pathlib.Path(__file__))==json.load(open(P/'fulltrace-auth-before.json'))['parentSha']
assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip();(P/'fulltrace-comparison.json').write_text(json.dumps({'status':'H4_ALL_H1_CANONICAL_NATIVE_ROWS_AND_COMPACT_JOURNAL_PASS','rows':rows,'stderrSha256':fileSha(new),'stderrBytes':new.stat().st_size,'addonSha256':sys.argv[2],'source':revision,'scope':'Only unstructured emulator preamble ignored; every canonical field/ordinal/order exact'},indent=2))
