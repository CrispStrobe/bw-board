import os,sys,json,hashlib,pathlib,subprocess,re,time,resource,signal
ROOT=pathlib.Path('/tmp/bw-native-paged-int-iret-source-20261004')
OUT=pathlib.Path('/tmp/native-paged-int-iret-source-auth-20261004')
NODE=pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
HEAD='40b8a5713fefc04ddb72175ee26f40afb7b60f35'
def digest(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def git(args):return subprocess.check_output(['git',*args],cwd=ROOT,timeout=10).decode().strip()
def inventory():
 seen={}
 def visit(p):
  if p in seen:return
  b=(ROOT/p).read_bytes();g=subprocess.check_output(['git','show','HEAD:'+p],cwd=ROOT,timeout=10);assert b==g,p;seen[p]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
  if p.endswith(('.mjs','.js')):
   for pattern in [r'^\s*(?:import|export)\s+(?:(?:[\w$]+\s*,\s*)?\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s+from\s*[\'"](\.[^\'"]+)[\'"]',r'^\s*import\s*[\'"](\.[^\'"]+)[\'"]']:
    for m in re.finditer(pattern,b.decode(),re.M):visit(os.path.normpath(str(pathlib.Path(p).parent/m[1])))
 for p in ['scripts/bochs-cpu3-native-paged-int-iret/reference.mjs', 'scripts/bochs-cpu3-native-paged-int-iret/profile.mjs', 'scripts/bochs-cpu3-native-paged-int-iret/SOURCE.md', 'test/i80386-paged-int-iret-source.test.mjs', 'package.json', 'roms/free-at-bios/LICENSE', 'src/experimental/i80386.js']:visit(p)
 return {'head':git(['rev-parse','HEAD']),'status':git(['status','--porcelain']),'files':dict(sorted(seen.items())),'nodeSha256':digest(NODE),'python':os.path.realpath(sys.executable),'pythonSha256':digest(sys.executable),'wrapperSha256':digest(__file__),'gitSha256':digest('/usr/bin/git'),'pathListSha256':digest('/tmp/paged-int-iret-source-paths-20261004.json')}
def write(name,v):(OUT/name).write_text(json.dumps(v,indent=2)+'\n')
assert not OUT.exists();OUT.mkdir();(OUT/'parent.py').write_bytes(pathlib.Path(__file__).read_bytes());before=inventory();assert before['head']==HEAD and not before['status'] and len(before['files'])==51 and before['nodeSha256']=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48';write('before.json',before)
env=os.environ.copy()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT']:env[k]=''
env.pop('NODE_TEST_CONTEXT',None)
env.pop('BW_PAGED_INT_IRET_CONTROL_OUTPUT',None)
argv=[str(NODE),'--max-old-space-size=128','--input-type=module','-e',"import {intIretSourceIdentity} from './scripts/bochs-cpu3-native-paged-int-iret/reference.mjs';console.log(JSON.stringify(intIretSourceIdentity()));"]
write('invocation.json',{'argv':argv,'cwd':str(ROOT),'metadataOnly':True,'scope':'READONLY_PAGING_SOURCE_IDENTITY_NO_FACTORY_ORACLE_CPU','blankVariables':{k:env.get(k) for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE']},'limits':{'cpuSeconds':10,'wallSeconds':30,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10}})
def bounds():
 os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(10,10));resource.setrlimit(resource.RLIMIT_FSIZE,(16<<20,16<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
start=time.monotonic();p=None;timeout=False;error=None
try:
 with (OUT/'stdout').open('wb')as out,(OUT/'stderr').open('wb')as err:
  p=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=out,stderr=err,start_new_session=True,preexec_fn=bounds)
  try:p.wait(timeout=30)
  except subprocess.TimeoutExpired:timeout=True;os.killpg(p.pid,signal.SIGKILL);p.wait()
except BaseException as e:error=repr(e)
finally:
 result={'exitCode':None if p is None else p.returncode,'timeout':timeout,'wallSeconds':time.monotonic()-start,'error':error};write('exit.json',result)
 try:after=inventory();write('after.json',after);result['pinsEqual']=before==after
 except BaseException as e:result['afterError']=repr(e);result['pinsEqual']=False
 write('exit.json',result)
raw=(OUT/'stdout').read_bytes();identity=json.loads(raw) if result['exitCode']==0 else None
result['status']='FAIL'
if identity and identity['revision']==HEAD and identity['hashes']=={p:v['sha256']for p,v in before['files'].items()} and result['exitCode']==0 and not timeout and result['pinsEqual'] and not (OUT/'stderr').read_bytes():
 result['status']='READONLY_SOURCE_IDENTITY_PASS';result['actualSourceCount']=len(identity['hashes']);result['identityJsonSha256']=hashlib.sha256(raw.strip()).hexdigest()
write('result.json',result);print(json.dumps(result));assert result['status']=='READONLY_SOURCE_IDENTITY_PASS'
