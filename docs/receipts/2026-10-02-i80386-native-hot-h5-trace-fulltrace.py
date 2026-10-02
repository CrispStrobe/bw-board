import runpy
bindPrepared=runpy.run_path('/mnt/volume1/tmp-astra/native-hot-h5-runtime-controls-20261001/build-bindings.py')['bind']
import pathlib,json,subprocess,hashlib,importlib.util,os,sys,itertools
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-args-20261001');sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('bounded',W/'scripts/run-i80386-native-hot-regular-file.py');bounded=importlib.util.module_from_spec(spec);spec.loader.exec_module(bounded);sha=lambda b:hashlib.sha256(b).hexdigest()
def fileSha(path):
 with open(path,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
approvedBytes=(P/'approved-bindings.json').read_bytes();approved=json.loads(approvedBytes);assert sha(pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h5-runtime-controls-20261001/build-bindings.py').read_bytes())==approved['bindingHelperSha256'];assert str(pathlib.Path(sys.argv[1]).resolve())==approved['addonPath'];assert sys.argv[2]==approved['addonSha256'];assert fileSha(pathlib.Path(__file__))==approved['helperSha256'];assert fileSha(approved['manifestPath'])==approved['manifestSha256']
manifest=json.load(open('/mnt/volume1/tmp-astra/native-hot-build-h5-20261001/prepare.json'));compiled={k:sha((W/k).read_bytes()) for k in manifest['sourceHashes']};assert compiled==manifest['sourceHashes'];tree=pathlib.Path('/mnt/volume1/tmp-astra/bw-bochs-cpu3-native-hot-h5-20261001')
for k,h in manifest['patchedHashes'].items():assert fileSha(tree/k)==h
prepared=bindPrepared(approved['manifestPath'],tree,approved['configSha256'])
(P/'fulltrace-auth-before.json').write_text(json.dumps({'compiledSourceHashes':compiled,'preparedFiles':prepared,'bindingHelperSha256':fileSha('/mnt/volume1/tmp-astra/native-hot-h5-runtime-controls-20261001/build-bindings.py'),'transformHashes':manifest['patchedHashes'],'addonSha256':sys.argv[2],'approvedSha256':sha(approvedBytes),'parentSha':fileSha(pathlib.Path(__file__))},indent=2))
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert revision=='ef106b4ae3a2ca55e9cc3253597ec66773e07847';assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
stem=P/'fulltrace';ip=P/'fulltrace.input.json';ip.write_text(json.dumps({'addon':sys.argv[1],'sha256':sys.argv[2],'configuration':'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochsrc','baseline':'/mnt/volume1/tmp-astra/js-hot-formal-final-20261001/capture.json','output':str(stem),'nativeTrace':True,'hostJournal':True,'profile':False}));assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2]
os.environ['BW_HOT_NAPI_PROFILE']='0';os.chdir(W);ex=bounded.run_child('/tmp/node-v22.23.3-linux-x64/bin/node',W/'scripts/run-i80386-native-hot-packed-args.mjs',ip,stem);assert ex['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION',ex
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
prepared=bindPrepared(approved['manifestPath'],tree,approved['configSha256'])
assert sha(pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h5-runtime-controls-20261001/build-bindings.py').read_bytes())==approved['bindingHelperSha256']
assert (P/'approved-bindings.json').read_bytes()==approvedBytes;assert fileSha(approved['manifestPath'])==approved['manifestSha256']
assert fileSha(pathlib.Path(__file__))==json.load(open(P/'fulltrace-auth-before.json'))['parentSha']
assert sha(pathlib.Path(sys.argv[1]).read_bytes())==sys.argv[2];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip();(P/'fulltrace-auth-after.json').write_bytes((P/'fulltrace-auth-before.json').read_bytes());(P/'fulltrace-comparison.json').write_text(json.dumps({'status':'H5_ALL_H1_CANONICAL_NATIVE_ROWS_AND_COMPACT_JOURNAL_PASS','rows':rows,'stderrSha256':fileSha(new),'stderrBytes':new.stat().st_size,'addonSha256':sys.argv[2],'source':revision,'scope':'Only unstructured emulator preamble ignored; every canonical field/ordinal/order exact'},indent=2))
