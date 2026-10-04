"""Single copied-u32 batched semantic child, no rebuild or paired timing."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,platform,signal,subprocess,urllib.request,urllib.parse,zipfile
from pathlib import Path
from archive import ordinary,digest,require
from restore import checkout,COMPILED,T,R,BOCHS
from lifecycle import bounded_child,write,host_context,HOOKS,interrupted
from policy import validate_worker_receipt,words,validate_inspect_snapshot,validate_resume_snapshot,validate_bridge_evidence,METADATA_COUNTER_FIELDS
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WORKSPACE=Path('/home/runner/work/bw-board/bw-board')
W=WORKSPACE/'publication';D=WORKSPACE/'driver';N=WORKSPACE/'scalar-worker'
U=Path('/home/runner/work/_temp/cold-memory-fusion-build-pristine')
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
def fingerprint(p):
 b=ordinary(Path(p));return {'bytes':len(b),'sha256':digest(b)}
def read_json(p):return json.loads(ordinary(Path(p)))
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],timeout=15)
def identity(root,revision,files):
 checkout(root,revision,files);return {'revision':revision,'hashes':{p:r['sha256'] for p,r in sorted(files.items())}}
def contract(c):
 require(c['status']=='ROOT_REVIEWED_LEDGER_SCALARS_QUALIFICATION_READY','pending refuses before setup/download/spawn')
 require(digest(json.dumps({k:v for k,v in c.items() if k!='status'},sort_keys=True,separators=(',',':')).encode())=='f9663a356637b7c54bd7983ec7bf450d709dfff040abcb2aa9798e80fd6b148c','complete source-owned contract/map authority')
 require(c['schema']=='bw.cold-ledger-scalars.qualification-source.v1' and c['guestEnabledByDefault'] is False,'single explicit semantic qualification')
 require(c['compiledRevision']==COMPILED and c['compiledFiles']==read_json(HERE/'frozen-members.json'),'exact genuine compiled151 map')
 require(c['worker']['revision']=='06581f3831aa765933b1d160a41ab37b1b652913' and len(c['worker']['files'])==73,'source-reviewed scalar worker73 pending READY role')
 require(c['worker']['sourceSha256']=='3e0bb128aa00ea763125d2cc6f0af2ab7ac752de05a3485acc9432f89a799e9d','fixed actual worker identity')
 require(c['worker']['sourceSha256']==digest(json.dumps({'revision':c['worker']['revision'],'hashes':{p:r['sha256'] for p,r in sorted(c['worker']['files'].items())}},separators=(',',':')).encode()),'full worker canonical identity')
 require(c['worker']['binding']=='scripts/cold-native-memory-fusion-ledger-scalars-performance/capture-binding.json' and c['worker']['root']==str(N),'complete fixed worker descriptor')
 require(c['driver']['revision']=='11c0bdcade020117fc682e97db284c6ff8797842' and len(c['driver']['files'])==54,'held driver metadata role')
 require(c['targetN']==c['targetQ']==316562 and c['nodeSha256']==NODE_SHA,'held target/Node')
 require(c['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10},'unchanged child bounds')
 require(c['buildArtifact']=={'artifactId':11295731777,'runId':37182277120,'head':COMPILED,'zipBytes':7537808,'zipSha256':'07bcd66ce81469ce06beaa8cb7567b7812a94110568e89e5f3225a55ac250875'},'actual fusion static artifact')
 return c
def tooling():
 rev=git(ROOT,'rev-parse','HEAD').decode().strip();require(not git(ROOT,'status','--porcelain'),'clean tooling')
 paths=[p for p in HERE.rglob('*') if p.is_file()]+[ROOT/'.github/workflows/i80386-cold-ledger-scalars-qualification.yml',ROOT/'test/i80386-cold-ledger-scalars-qualification-source.test.mjs']
 files={str(p.relative_to(ROOT)):fingerprint(p) for p in paths};return identity(ROOT,rev,files)
def sources(c,node):
 return {'tooling':tooling(),'node':fingerprint(node),'compiled':identity(W,COMPILED,c['compiledFiles']),'driver':identity(D,c['driver']['revision'],c['driver']['files']),'worker':identity(N,c['worker']['revision'],c['worker']['files'])}
def original_inputs(out):
 return {str(p):fingerprint(p) for p in out.rglob('*') if p.is_file() and (p.name in ('capture.json','independent-audit.json','restore-binding.json') or 'build-artifact' in p.parts or 'capture-artifact' in p.parts)}
def restored(c,node,out):
 files=[p for p in (T/'.git').rglob('*') if p.is_file()]+[p for p in out.joinpath('materialization').rglob('*') if p.is_file()]+[p for p in R.rglob('*') if p.is_file()]+[T/p for p in read_json(HERE/'prepared-members.json')]+[T/'bochs/bw_direct.node',out/'guest-source.bochsrc']
 require(git(T,'rev-parse','HEAD').decode().strip()==BOCHS,'restored prepared Git HEAD')
 context=read_json(R/'build-context.json');upstream={'head':git(U,'rev-parse','HEAD').decode().strip(),'clean':not git(U,'status','--porcelain'),'hashes':{p:fingerprint(U/p) for p in context['upstreamHashes']}}
 require(upstream['head']==BOCHS and upstream['clean'],'pristine upstream final')
 for p,h in context['upstreamHashes'].items():require(upstream['hashes'][p]['sha256']==h,'upstream original keybytes')
 return {'source':sources(c,node),'upstream':upstream,'records':{str(p):fingerprint(p) for p in files}}
def artifact_origin(url):
    p=urllib.parse.urlsplit(url);require(p.scheme=='https' and p.hostname and p.username is None and p.password is None,'HTTPS credential-safe origin');port=443 if p.port is None else p.port;require(1<=port<=65535,'HTTPS port domain');return (p.scheme,p.hostname.lower(),port)
class ArtifactRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        before,after=artifact_origin(req.full_url),artifact_origin(newurl);result=super().redirect_request(req,fp,code,msg,headers,newurl)
        if result is not None and before!=after:result.remove_header('Authorization')
        return result
def download(descriptor,out):
    out.mkdir();token=os.environ.get('GH_TOKEN');require(token,'read-only official API credential')
    url='https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/'+str(descriptor['artifactId']);headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};opener=urllib.request.build_opener(ArtifactRedirect())
    with opener.open(urllib.request.Request(url,headers=headers),timeout=30) as r:raw=r.read(1<<20)
    require(len(raw)<1<<20,'metadata bound');(out/'official-metadata.json').write_bytes(raw);m=json.loads(raw)
    require(m['id']==descriptor['artifactId'] and m['size_in_bytes']==descriptor['zipBytes'] and m['workflow_run']['id']==descriptor['runId'] and m['workflow_run']['head_sha']==descriptor['head'],'exact official artifact/run/head')
    require(not m['expired'] and m['digest']=='sha256:'+descriptor['zipSha256'],'official digest/expiry')
    p=out/'official-artifact.zip';count=0
    with opener.open(urllib.request.Request(url+'/zip',headers=headers),timeout=60) as r,p.open('xb') as f:
        while chunk:=r.read(65536):count+=len(chunk);require(count<=descriptor['zipBytes'],'ZIP cap');f.write(chunk)
    require(fingerprint(p)=={'bytes':descriptor['zipBytes'],'sha256':descriptor['zipSha256']},'lossless official download');return p
def capture_from_zip(path,c,out):
    a=c['captureArtifact']
    with zipfile.ZipFile(path) as z:
        matches=[i for i in z.infolist() if i.filename==a['member']];require(len(matches)==1,'unique genuine capture member');i=matches[0];require(not i.is_dir() and not i.flag_bits&1 and i.file_size==a['captureBytes'],'ordinary bounded capture member')
        data=z.read(i)
    p=out/'capture.json';p.write_bytes(data);require(fingerprint(p)=={'bytes':a['captureBytes'],'sha256':a['captureSha256']},'exact raw successful capture');return p

def setup(c,node,out,report):
 # All current/Git role maps are checked before pristine fetch or download.
 report['sourceBeforeSetup']=sources(c,node);write(out/'source-before-setup.json',report['sourceBeforeSetup'])
 require(not any(os.path.lexists(p) for p in (U,T,R)),'exclusive original roles')
 setupbounds={**c['bounds'],'fileBytes':32<<20}
 commands=[['git','init',str(U)],['git','-C',str(U),'remote','add','origin','https://github.com/bochs-emu/Bochs.git'],['git','-C',str(U),'fetch','--depth=1','--no-tags','origin',BOCHS],['git','-C',str(U),'checkout','--detach','FETCH_HEAD']]
 for i,cmd in enumerate(commands):
  e=bounded_child(cmd,ROOT,out/('upstream-'+str(i)),setupbounds);require(e['exitCode']==0 and not e['timedOut'],'upstream setup failure')
 z=download(c['buildArtifact'],out/'build-artifact');cz=download(c['captureArtifact'],out/'capture-artifact');capture=capture_from_zip(cz,c,out)
 audit=out/'independent-audit.json';audit.write_bytes(ordinary(HERE/c['independentAudit']['file']));require(fingerprint(audit)=={'bytes':c['independentAudit']['bytes'],'sha256':c['independentAudit']['sha256']},'actual capture audit')
 d=c['driver'];b={'zip':str(z),'compiledRoot':str(W),'upstreamRoot':str(U),'driverRoot':str(D),'driverRevision':d['revision'],'driverFiles':d['files'],'driverAuth':d['auth'],'driverAuthSha256':d['authSha256'],'driverIdentitySha256':d['sourceSha256'],'node':str(node),'output':str(out/'materialization')};write(out/'restore-binding.json',b)
 report['inputsBeforeRestore']=original_inputs(out);write(out/'inputs-before-restore.json',report['inputsBeforeRestore'])
 e=bounded_child([sys.executable,'-B',str(HERE/'restore.py'),str(out/'restore-binding.json')],ROOT,out/'restore-child',setupbounds);require(e['exitCode']==0 and not e['timedOut'],'restore/static admission failure')
 cfg=out/'guest-source.bochsrc';module=W/'scripts/bochs-cpu3-native-cold-memory-fusion/identity.mjs'
 js='import {canonicalConfiguration,authenticateConfiguration} from '+json.dumps(module.as_uri())+';import fs from "node:fs";fs.writeFileSync(process.argv[1],canonicalConfiguration(process.argv[2]),{flag:"wx"});console.log(JSON.stringify(authenticateConfiguration(process.argv[1])));'
 e=bounded_child([str(node),'--max-old-space-size=128','--input-type=module','-e',js,str(cfg),str(out/'bochs.log')],W,out/'configuration-child',setupbounds);require(e['exitCode']==0 and not e['timedOut'],'configuration admission failure')
 native=read_json(R/'static-input.json');require(set(native)=={'addon','sha256','preparedManifest','preparedManifestSha256','buildReceipt','buildReceiptSha256'} and native['sha256']==c['addonSha256'],'genuine fusion artifact input')
 native.update(compiledRoot=str(W),compiledRevision=COMPILED,configuration=str(cfg))
 binding={'workers':{'native':{**c['worker'],'files':{p:r['sha256'] for p,r in c['worker']['files'].items()}}},'compiledFiles':{p:r['sha256'] for p,r in c['compiledFiles'].items()},'targetN':c['targetN'],'targetQ':c['targetQ'],'node':{'sha256':NODE_SHA},'capture':{'sha256':c['captureArtifact']['captureSha256']},'independentAudit':{'sha256':c['independentAudit']['sha256']},'nativeInput':native,'configuredClockHz':6000000}
 data={**native,'capture':str(capture),'independentAudit':str(audit),'output':str(out/'guest/receipt'),'workerRevision':c['worker']['revision'],'workerSourceSha256':c['worker']['sourceSha256'],'nodeSha256':NODE_SHA,'mode':'batched'}
 return binding,data

def semantic_projection(r,b):
 require(r['schema']=='bw.cold-native-memory-fusion-ledger-scalars-performance.worker.v1' and r['status']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS','scalar semantic receipt success')
 require(r['requiredScalarProviderProfile']=='bw.cold-native.memory-clock-fusion.ledger-scalars.v1','fixed scalar JS profile')
 expected={'profile':'bw.cold-native.memory-clock-fusion.ledger-scalars.v1','bindingSha256':b['workers']['native']['files']['scripts/cold-native-memory-fusion-ledger-scalars-performance/scalar-overlay.json']}
 require(r['scalarOverlay']==expected,'actual owned scalar overlay')
 projected=dict(r);projected['schema']='bw.cold-native-memory-fusion-performance.worker.v1';return projected
def terminal(r,data,b,capture):
 require(r['requiredStateExportProfile']==r['admittedStateExportProfile']=='bw.cold-native.copied-u32-state.v1','actual typed profile')
 require(r['requiredMemoryFusionProfile']==r['admittedMemoryFusionProfile']=='bw.cold-native.memory-clock-fusion.v1','actual MEMORY fusion profile')
 require(r['typedSnapshotOwnership']=='RESET_STABLE_AND_FINAL_LAST_RETURN_DISTINCT','actual snapshot independence')
 validate_inspect_snapshot(r['reset']['native']);require(words(r['reset']['native'])==words(capture['cuts'][0]['native']),'raw reset166')
 metrics=validate_worker_receipt(semantic_projection(r,b),'native-batched',data,b,capture);validate_bridge_evidence(r);return metrics
def final_guards(report,guards):
 first=None
 for name,read,validate in guards:
  try:report[name]=read();validate(report[name])
  except BaseException as e:
   report.setdefault('finalizationErrors',{})[name]=repr(e);report['status']='FAIL'
   if first is None:first=e
 return first
def main(mode):
 require(mode in ('disabled','enabled'),'explicit mode')
 if mode=='disabled':print('Disabled; no setup/download/addon/guest');return
 c=contract(read_json(HERE/'contract.json'));require(os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and ROOT==WORKSPACE/'runtime','manual fixed role')
 for k in HOOKS:require(not os.environ.get(k),'blank hook')
 node=Path(os.environ['BW_COLD_NODE']);require(fingerprint(node)['sha256']==NODE_SHA,'Node hash');require(platform.machine()=='x86_64' and platform.libc_ver()[1]=='2.39','held loader ABI')
 out=Path(os.environ['BW_FUSION_QUALIFICATION_OUTPUT']);require(out.is_absolute() and out.resolve()==out and out.parent.is_dir() and not os.path.lexists(out),'exclusive canonical output')
 for role in (ROOT,W,D,N,U,T,R):require(role!=out and role not in out.parents and out not in role.parents,'disjoint roles')
 out.mkdir();report={'schema':'bw.cold-ledger-scalars.qualification-result.v1','status':'FAIL','coverage':'Raw reset/final/last-resume166; full terminal board/RAMhash/PIO; no intermediate CPU cuts, speed or adoption'};before=None;inputpin=None;primary=None;finalerror=None
 try:
  report['toolingBefore']=tooling();require(report['toolingBefore']['revision']==os.environ['GITHUB_SHA'],'dispatch tooling head');write(out/'host-before.json',host_context());b,data=setup(c,node,out,report);before=restored(c,node,out);write(out/'before-guest.json',before);inp=out/'input.json';write(inp,data);inputpin=fingerprint(inp)
  child=bounded_child([str(node),'--max-old-space-size=128',str(N/c['worker']['entry']),str(inp)],N,out/'guest',c['bounds']);report['child']=child
  require(child['exitCode']==0 and not child['timedOut'] and not child['interrupted'],'first child failure; no retry')
  r=read_json(out/'guest/receipt/receipt.json');require(r['inputSha256Before']==r['inputSha256After']==inputpin['sha256'],'actual input proof');report['informationalExecutionSelfReport']=terminal(r,data,b,read_json(out/'capture.json'));report['status']='LEDGER_SCALARS_BATCHED_TERMINAL_PARITY_PASS_REQUIRES_INDEPENDENT_AUDIT'
 except BaseException as e:primary=e;report['error']=repr(e);raise
 finally:
  guards=[('toolingAfter',lambda:tooling(),lambda value:require(value==report.get('toolingBefore'),'tooling final guard'))]
  if 'sourceBeforeSetup' in report:guards.append(('sourceAfter',lambda:sources(c,node),lambda value:require(value==report['sourceBeforeSetup'],'source final guard')))
  if 'inputsBeforeRestore' in report:guards.append(('inputsAfter',lambda:original_inputs(out),lambda value:require(value==report['inputsBeforeRestore'],'original inputs final guard')))
  if before is not None:
   guards.extend([('afterGuest',lambda:restored(c,node,out),lambda value:require(value==before,'restored final guard')),('inputAfter',lambda:fingerprint(out/'input.json'),lambda value:require(value==inputpin,'input final guard'))])
  else:guards.append(('partialRestoredFiles',lambda:{str(p):fingerprint(p) for root in (T,R) if root.exists() for p in root.rglob('*') if p.is_file() and '.git' not in p.parts},lambda value:None))
  finalerror=final_guards(report,guards)
  try:write(out/'host-after.json',host_context())
  except BaseException as e:
   report['hostAfterUnavailable']=repr(e);report['status']='FAIL'
   if finalerror is None:finalerror=e
  write(out/'result.json',report)
  if finalerror is not None and primary is None:raise finalerror
if __name__=='__main__':
 for s in (signal.SIGINT,signal.SIGTERM):signal.signal(s,interrupted)
 require(len(sys.argv)==2,'one explicit mode');main(sys.argv[1])
