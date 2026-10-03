"""One fixed restore + correctness child. Manual default-disabled; never builds."""
import sys
sys.dont_write_bytecode=True
import os,json,hashlib,subprocess,resource,signal,time,platform,shutil,urllib.request,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'scripts/cold-native-restore'))
sys.path.insert(0,str(ROOT/'scripts/cold-native-diagnostic'))
from archive import ordinary,digest,require,name,zip_members,tar_members,exclusive_tree
from resources import wait4_until,wait4_reap,memory_events,memory_delta
W=Path('/home/runner/work/bw-board/bw-board/publication')
D=Path('/home/runner/work/bw-board/bw-board/ram-driver')
U=Path('/home/runner/work/bw-board/bw-board/ram-pristine')
T=Path('/home/runner/work/_temp/ram-bootstrap-build-prepared')
R=Path('/home/runner/work/_temp/ram-bootstrap-build-evidence')
OUT=Path('/home/runner/work/_temp/ram-bootstrap-execution')
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
COMPILED='81694d0d19a86ded0449ab56b3554020ffc344ca'
DRIVER='368ad8b61bb80f49380ed91b8ea1db442712e083'
NODE_HASH='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
ADDON_HASH='9475b94b4dd067bc6c25ccd7c61c60cef5c9696fba0725ed05913838a3ee9873'
def write(p,value):p.write_text(json.dumps(value,indent=2)+'\n')
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],timeout=15,env={**os.environ,'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'})
def validate_contract(c,ready=True):
 require(set(c)=={'schema','status','enabledByDefault','compiledRevision','driverRevision','bochsRevision','artifactId','runId','zipSha256','zipBytes','zipMembers','compiledFiles','preparedFiles','driverFiles','nodeSha256','addonSha256','helperPins','scope'},'closed contract fields')
 require(c['schema']=='bw.ram-bootstrap.hosted-one-run.v1','contract schema');require(c['enabledByDefault'] is False,'disabled default')
 if ready:require(c['status']=='ROOT_REVIEWED_RAM_SOURCE_READY','reviewed source required before any setup')
 require(c['compiledRevision']==COMPILED and c['driverRevision']==DRIVER and c['bochsRevision']=='0e45b736ef9792eb9b752b0a35db49eaf2faea47','fixed source roles')
 require(c['artifactId']==11278388657 and c['runId']==37136096190 and c['zipBytes']==7580867 and c['zipSha256']=='632a8a39787938c63f4607136b51d2628afaaf555b6e5a06c68258fe45305f29','actual first build')
 require(c['nodeSha256']==NODE_HASH and c['addonSha256']==ADDON_HASH,'fresh addon/Node')
 for key,count in [('zipMembers',66),('compiledFiles',138),('preparedFiles',812),('driverFiles',60)]:
  require(type(c[key]) is dict and len(c[key])==count,'complete '+key)
  for p,v in c[key].items():name(p);require(set(v)=={'bytes','sha256'} and type(v['bytes']) is int and 0<=v['bytes']<=16<<20 and type(v['sha256'])is str and len(v['sha256'])==64 and all(x in '0123456789abcdef'for x in v['sha256']),'member record')
 require(c['driverFiles']['scripts/bochs-cpu3-native-ram-bootstrap/driver-auth.mjs'],'driver authority')
 require(c['zipMembers']['ram-bootstrap-build-evidence/bw_direct.node']['sha256']==ADDON_HASH,'addon member')
 return c
ACTIVE=set()
def interrupted(signum,frame):
 for pid in list(ACTIVE):
  try:os.killpg(pid,signal.SIGKILL)
  except ProcessLookupError:pass
 raise SystemExit(128+signum)
def checkout(root,revision,files):
 require(root.resolve()==root and git(root,'rev-parse','HEAD').decode().strip()==revision and not git(root,'status','--porcelain'),'frozen clean checkout '+str(root))
 for p,v in files.items():
  b=ordinary(root/p);require(len(b)==v['bytes'] and digest(b)==v['sha256'] and b==git(root,'show',revision+':'+p),'source current/Git '+p)
 return {p:v['sha256']for p,v in files.items()}
def https_origin(url):
 p=urllib.parse.urlsplit(url);port=443 if p.port is None else p.port;require(p.scheme=='https'and p.hostname and p.username is None and p.password is None and 1<=port<=65535,'HTTPS origin');return(p.hostname.lower(),port)
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  old,new=https_origin(req.full_url),https_origin(newurl);r=super().redirect_request(req,fp,code,msg,headers,newurl)
  if r and old!=new:r.remove_header('Authorization')
  return r
def download(c):
 token=os.environ.get('GH_TOKEN');require(token,'read-only artifact credential');base='https://api.github.com/repos/CrispStrobe/bw-board/actions/'
 opener=urllib.request.build_opener(Redirect());headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
 def get(url,cap):
  https_origin(url)
  with opener.open(urllib.request.Request(url,headers=headers),timeout=30)as response:
   https_origin(response.url);b=response.read(cap+1);require(len(b)<=cap,'HTTP response cap');return b
 run_raw=get(base+'runs/'+str(c['runId']),1<<20);run=json.loads(run_raw);(OUT/'original-run.json').write_bytes(run_raw)
 require(run['id']==c['runId'] and run['head_sha']==COMPILED and run['event']=='workflow_dispatch' and run['run_attempt']==1 and run['conclusion']=='success'and run['path']=='.github/workflows/i80386-native-ram-bootstrap-build.yml','actual successful first build context')
 raw=get(base+'artifacts/'+str(c['artifactId']),1<<20);meta=json.loads(raw);(OUT/'original-artifact.json').write_bytes(raw)
 require(meta['id']==c['artifactId'] and not meta['expired'] and meta['size_in_bytes']==c['zipBytes'] and meta['digest']=='sha256:'+c['zipSha256'] and meta['workflow_run']['id']==c['runId'] and meta['workflow_run']['head_sha']==COMPILED,'official artifact metadata')
 b=get(base+'artifacts/'+str(c['artifactId'])+'/zip',c['zipBytes']);require(len(b)==c['zipBytes']and digest(b)==c['zipSha256'],'lossless official ZIP');(OUT/'official-artifact.zip').write_bytes(b)
def tooling():
 paths=[p for p in HERE.iterdir()if p.is_file()]+[ROOT/'.github/workflows/i80386-ram-bootstrap-execution.yml',ROOT/'test/i80386-ram-bootstrap-hosted-source.test.mjs',ROOT/'scripts/cold-native-restore/archive.py',ROOT/'scripts/cold-native-diagnostic/resources.py']
 head=git(ROOT,'rev-parse','HEAD').decode().strip();require(not git(ROOT,'status','--porcelain'),'clean wrapper source');require(head==os.environ.get('GITHUB_SHA'),'exact hosted wrapper revision')
 files={}
 for p in paths:b=ordinary(p);require(b==git(ROOT,'show',head+':'+str(p.relative_to(ROOT))),'wrapper current/Git');files[str(p.relative_to(ROOT))]=digest(b)
 return {'head':head,'files':files,'python':str(Path(sys.executable).resolve()),'pythonSha256':digest(ordinary(Path(sys.executable).resolve()))}
def fixed_snapshot(c,node):
 return {'tooling':tooling(),'compiled':checkout(W,COMPILED,c['compiledFiles']),'driver':checkout(D,DRIVER,c['driverFiles']),'nodeSha256':digest(ordinary(node)),'upstreamHead':git(U,'rev-parse','HEAD').decode().strip(),'upstreamStatus':git(U,'status','--porcelain').decode()}
def partial_maps():
 result={}
 for root in (T,R):
  if root.exists():
   for p in root.rglob('*'):
    if p.is_file()and '.git'not in p.relative_to(root).parts:
     try:result[str(p)]={'bytes':p.stat().st_size,'sha256':digest(ordinary(p))}
     except BaseException as e:result[str(p)]={'unavailable':str(e)}
 return result
def restored_snapshot(c):
 paths=[T/p for p in c['preparedFiles']]+[T/'bochs/bw_direct.node']+[p for p in R.iterdir()if p.is_file()]+[p for p in (T/'.git').rglob('*')if p.is_file()]+[OUT/'official-artifact.zip',OUT/'original-artifact.json',OUT/'original-run.json',OUT/'input.json',OUT/'ram-source.bochsrc']
 return {str(p):digest(ordinary(p))for p in paths}
def bounded(argv,cwd,label,cpu=60,wall=120,on_launch=None):
 env=os.environ.copy()
 for k in HOOKS:env[k]=''
 for k in ['GH_TOKEN','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT']:env.pop(k,None)
 write(OUT/(label+'.invocation.json'),{'argv':argv,'cwd':str(cwd),'cpuSeconds':cpu,'wallSeconds':wall,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'nice':10,'blankHooks':{k:''for k in HOOKS}})
 def limits():os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(cpu,cpu));resource.setrlimit(resource.RLIMIT_FSIZE,(16<<20,16<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 start=time.monotonic();timeout=False;usage=None;err=None;before=memory_events();p=None
 try:
  with (OUT/(label+'.stdout')).open('xb')as so,(OUT/(label+'.stderr')).open('xb')as se:
   p=subprocess.Popen(argv,cwd=cwd,env=env,start_new_session=True,preexec_fn=limits,stdout=so,stderr=se);ACTIVE.add(p.pid)
   try:
    if on_launch:on_launch(p.pid)
    usage,timeout=wait4_until(p,start+wall)
    if timeout:os.killpg(p.pid,signal.SIGKILL);usage=wait4_reap(p)
   except BaseException as e:
    err=e
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    if p.returncode is None:usage=wait4_reap(p)
 except BaseException as e:err=err or e
 finally:
  if p:ACTIVE.discard(p.pid)
  after=memory_events();result={'pid':None if p is None else p.pid,'exitCode':None if p is None else p.returncode,'timeout':timeout,'wallSeconds':time.monotonic()-start,'wait4':usage,'error':str(err)if err else None,'memoryEventsBefore':before,'memoryEventsAfter':after,'memoryDelta':memory_delta(before,after)};write(OUT/(label+'.exit.json'),result)
 if err:raise err
 require(result['exitCode']==0 and not timeout,'child failed; raw exit retained '+label);return(OUT/(label+'.stdout')).read_bytes()
def finalize(report,initial,after,artifacts_before,artifacts_after,error=None):
 try:
  if error:raise error
  require(initial is not None and initial==after,'final fixed inputs/HEADs unchanged');require(artifacts_before is not None and artifacts_before==artifacts_after,'final restored inputs unchanged')
 except BaseException as e:report['finalAuthenticationError']=str(e);report['status']='FAIL';return False
 return True
def main(enabled):
 c=validate_contract(json.loads(ordinary(HERE/'contract.json')));require(enabled=='enabled','explicit manual enable only');require(ROOT==Path('/home/runner/work/bw-board/bw-board/ram-wrapper'),'fixed wrapper role')
 require(os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch'and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','first manual attempt only')
 for k in HOOKS:require(not os.environ.get(k),'executable hook')
 require(not os.path.lexists(OUT),'exclusive evidence output');OUT.mkdir();report={'schema':'bw.ram-bootstrap.hosted-correctness.v1','status':'FAIL','scope':c['scope'],'workerStarted':False,'originalProvenance':'Original build records retained unchanged; recreated filesystem is new materialization, not original build execution'}
 initial=None;artifacts_before=None;node=Path(os.environ['BW_RAM_NODE']);primary=None
 try:
  initial=fixed_snapshot(c,node);write(OUT/'fixed-before.json',initial);write(OUT/'host.json',{'platform':platform.platform(),'python':sys.version,'cpuinfo':Path('/proc/cpuinfo').read_text(),'meminfo':Path('/proc/meminfo').read_text(),'loadavg':Path('/proc/loadavg').read_text(),'scope':'Correctness host context; no speed/physical386 claim'});require(initial['nodeSha256']==NODE_HASH and initial['upstreamHead']==c['bochsRevision'] and initial['upstreamStatus']=='','fixed Node/upstream');
  for p,h in c['helperPins'].items():require(initial['tooling']['files'][p]==h,'held helper pin')
  download(c);members=zip_members(OUT/'official-artifact.zip',c['zipMembers'],c['zipSha256'],c['zipBytes']);prefix='ram-bootstrap-build-evidence/'
  frozen=tar_members(members[prefix+'frozen-source.tar.gz'],c['compiledFiles']);require(frozen=={p:ordinary(W/p)for p in c['compiledFiles']},'original frozen source matches checkout')
  prepared=tar_members(members[prefix+'prepared-source.tar.gz'],c['preparedFiles']);require(json.loads(members[prefix+'identity-before.stdout'])['hashes']=={p:v['sha256']for p,v in c['compiledFiles'].items()},'original138 identity')
  require({p:h for p,h in json.loads(members[prefix+'prepared-after-build.json']).items()if not p.endswith('.node')}=={p:v['sha256']for p,v in c['preparedFiles'].items()},'original812 prepared map')
  manifest=json.loads(members[prefix+'prepare.json']);require(manifest['preparedTree']==str(T)and manifest['boardRevision']==COMPILED,'original roles');
  exclusive_tree(T,prepared);metadata=Path(git(U,'rev-parse','--absolute-git-dir').decode().strip());meta={};dirs=[]
  for p in metadata.rglob('*'):
   require(not p.is_symlink(),'genuine ordinary Git metadata');rel=str(p.relative_to(metadata))
   if p.is_dir():dirs.append(rel)
   else:meta[rel]=ordinary(p)
  exclusive_tree(T/'.git',meta,dirs);require(git(T,'rev-parse','HEAD').decode().strip()==c['bochsRevision'],'restored genuine upstream HEAD')
  with (T/'bochs/bw_direct.node').open('xb')as f:f.write(members[prefix+'bw_direct.node'])
  evidence={p[len(prefix):]:b for p,b in members.items()if p.startswith(prefix)and not p.endswith('.tar.gz')};exclusive_tree(R,evidence)
  auth=D/'scripts/bochs-cpu3-native-ram-bootstrap/driver-auth.mjs';script='import {driverSourceIdentity} from '+json.dumps(auth.as_uri())+';console.log(JSON.stringify(driverSourceIdentity()));'
  raw=bounded([str(node),'--max-old-space-size=128','--input-type=module','-e',script],D,'driver-identity',15,30).strip();identity=json.loads(raw);require(identity['revision']==DRIVER and identity['hashes']=={p:v['sha256']for p,v in c['driverFiles'].items()},'actual full60 driver authority')
  input=json.loads(members[prefix+'static-input.json']);require(set(input)=={'addon','sha256','preparedManifest','preparedManifestSha256','buildReceipt','buildReceiptSha256'},'original six input fields');require(input['addon']==str(T/'bochs/bw_direct.node')and input['sha256']==ADDON_HASH and input['preparedManifest']==str(R/'prepare.json')and input['buildReceipt']==str(R/'build-static-preflight.json'),'actual original static roles');require(input['preparedManifestSha256']==digest(ordinary(R/'prepare.json'))and input['buildReceiptSha256']==digest(ordinary(R/'build-static-preflight.json')),'original raw receipt hashes');script='import {canonicalConfiguration,authenticateBuild,sourceIdentity} from '+json.dumps((W/'scripts/bochs-cpu3-native-ram-bootstrap/build-identity.mjs').as_uri())+';import fs from "node:fs";const m=JSON.parse(fs.readFileSync(process.argv[1]));authenticateBuild(JSON.parse(fs.readFileSync(process.argv[2])),sourceIdentity());process.stdout.write(canonicalConfiguration(m,process.argv[3]));'
  raw=bounded([str(node),'--max-old-space-size=128','--input-type=module','-e',script,str(R/'prepare.json'),str(R/'static-input.json'),str(OUT/'bochs.log')],W,'static-admission-config',15,30);(OUT/'ram-source.bochsrc').write_bytes(raw)
  input.update({'compiledRoot':str(W),'compiledRevision':COMPILED,'driverRevision':DRIVER,'driverSourceSha256':digest(json.dumps(identity,separators=(',',':'),ensure_ascii=False).encode()),'configuration':str(OUT/'ram-source.bochsrc'),'output':str(OUT/'guest'),'nativeTrace':False});write(OUT/'input.json',input)
  artifacts_before=restored_snapshot(c);write(OUT/'restored-before.json',artifacts_before);write(OUT/'materialization.json',{'originalRun':c['runId'],'originalArtifact':c['artifactId'],'zipSha256':c['zipSha256'],'compiledCount':138,'preparedCount':812,'driverCount':60,'metadata':'Genuine new pristine checkout Git metadata copied; original records unchanged','addonLoaded':False})
  report['workerAttempted']=True
  def launched(pid):report['workerStarted']=True;report['workerPid']=pid;write(OUT/'worker-launch.json',{'pid':pid,'scope':'Node process launched, not a CPU execution claim'})
  bounded([str(node),'--max-old-space-size=128',str(D/'scripts/bochs-cpu3-native-ram-bootstrap/runner.mjs'),str(OUT/'input.json')],D,'worker',on_launch=launched)
  capture=json.loads(ordinary(OUT/'guest/capture.json'));require(capture['status']=='PASS' and capture['progress']['n']<=512 and capture['progress']['q']<=512,'driver actual PASS/caps');require([p['name']for p in capture['cuts']]==['reset','AX1','patched-from-ROM','AX2','before-HLT'],'five actual milestones');report['status']='PASS';report['progress']=capture['progress']
 except BaseException as e:primary=e;report['error']=str(e)
 finally:
  after=None;artifacts_after=None;failure=None
  try:after=fixed_snapshot(c,node);write(OUT/'fixed-after.json',after)
  except BaseException as e:failure=e;report['fixedAfterUnavailable']=str(e)
  try:artifacts_after=restored_snapshot(c);write(OUT/'restored-after.json',artifacts_after)
  except BaseException as e:failure=failure or e;report['restoredAfterUnavailable']=str(e);write(OUT/'available-partial-restoration.json',partial_maps())
  if not finalize(report,initial,after,artifacts_before,artifacts_after,failure)and not primary:primary=ValueError(report['finalAuthenticationError'])
  write(OUT/'final-status.json',report)
 if primary:raise primary
if __name__=='__main__':
 for signum in (signal.SIGTERM,signal.SIGINT):signal.signal(signum,interrupted)
 require(len(sys.argv)==2,'one explicit enable argument');main(sys.argv[1])
