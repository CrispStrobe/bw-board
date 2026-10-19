#!/usr/bin/env python3
"""Fixed hosted gate. Download occurs in workflow; no arbitrary code/artifact inputs."""
from pathlib import Path
import json,hashlib,sys,os,subprocess,zipfile,shutil,signal,time,resource
sys.dont_write_bytecode=True
BASE='fe1eff2039520536350922a2164c8bbe29404c68';DISPATCH='2c688e69cae516b9749d70a126a3b474707d5cb7';ZIP='0335f4c5088280cfcdf00186f5e0ca59ff431442edc3a978dd26b7dc2341a0e0'
W=Path(__file__).resolve().parent.parent;A=W/'scripts/owned-dispatch-ci';workspace=Path(os.environ['GITHUB_WORKSPACE']);R=Path(os.environ['RUNNER_TEMP'])/'owned-dispatch-gate';R.mkdir(exist_ok=False);C=Path('/tmp/bw-board-386-native-owned-in8-r3-20261002');B=Path('/tmp/bw-board-386-owned-dispatch-runtime-20261002');node=shutil.which('node');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
version=subprocess.run([node,'--version'],check=True,capture_output=True,text=True,timeout=10);assert version.stdout.strip()=='v22.23.3';(R/'node-version.json').write_text(json.dumps({'command':[node,'--version'],'stdout':version.stdout,'stderr':version.stderr,'returncode':version.returncode})+'\n')
publicationRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert publicationRevision==os.environ['GITHUB_SHA'];assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
toolingPaths=['scripts/ci-benchmark-i80386-owned-dispatch.py','.github/workflows/i80386-owned-clock-bulk-benchmark.yml','test/i80386-owned-dispatch-ci.test.mjs']
toolingHashes={p:sha(W/p)for p in toolingPaths}
for p,h in toolingHashes.items():assert hashlib.sha256(subprocess.check_output(['git','show',publicationRevision+':'+p],cwd=W)).hexdigest()==h
(R/'publication-source.json').write_text(json.dumps({'revision':publicationRevision,'tooling':toolingHashes},indent=2)+'\n')
assetInventory=json.loads((A/'source-inventory.json').read_bytes())
for n,v in assetInventory.items():assert sha(A/n)==v['sha256']==hashlib.sha256(subprocess.check_output(['git','show',publicationRevision+':scripts/owned-dispatch-ci/'+n],cwd=W)).hexdigest()
assert sha(A/'source-inventory.json')==hashlib.sha256(subprocess.check_output(['git','show',publicationRevision+':scripts/owned-dispatch-ci/source-inventory.json'],cwd=W)).hexdigest()
assert not C.exists() and not B.exists()
subprocess.run(['git','-C',str(workspace/'baseline-checkout'),'worktree','add','--detach',str(C),BASE],check=True,timeout=120)
sys.path.insert(0,str(A));from reconstruct import reconstruct
reconstruction=reconstruct(workspace/'baseline-checkout',A,B,R/'isolated-git-index');(R/'reconstruction.json').write_text(json.dumps(reconstruction,indent=2)+'\n')
for root,rev in [(C,BASE),(B,DISPATCH)]:assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==rev and not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip()
activeChildren=set()
def terminateTree(pid):
 stopped=set();parents={pid}
 for _ in range(5):
  for entry in Path('/proc').iterdir():
   if not entry.name.isdigit():continue
   try:
    stat=(entry/'stat').read_text();fields=stat[stat.rfind(')')+2:].split();ppid=int(fields[1]);number=int(entry.name)
    if number==pid or ppid in parents:
     parents.add(number)
     if number not in stopped:os.kill(number,signal.SIGSTOP);stopped.add(number)
   except (FileNotFoundError,ProcessLookupError,PermissionError):pass
 for number in stopped:
  try:os.kill(number,signal.SIGKILL)
  except ProcessLookupError:pass
 return sorted(stopped)
def interrupted(signum,frame):
 for pid in list(activeChildren):terminateTree(pid)
 raise SystemExit(128+signum)
for signum in [signal.SIGTERM,signal.SIGINT]:signal.signal(signum,interrupted)
assert Path('/proc/self/stat').is_file()
def execute(label,cmd,cwd=W,seconds=120):
 with (R/(label+'.stdout')).open('xb') as out,(R/(label+'.stderr')).open('xb') as err:
  def static_bounds():
   os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  child=subprocess.Popen(cmd,cwd=cwd,stdout=out,stderr=err,start_new_session=True,preexec_fn=static_bounds if label=='dispatch-static' else None);activeChildren.add(child.pid);timed=False;terminated=[]
  try:code=child.wait(timeout=seconds)
  except subprocess.TimeoutExpired:terminated=terminateTree(child.pid);code=child.wait();timed=True
 activeChildren.discard(child.pid)
 (R/(label+'.exit.json')).write_text(json.dumps({'command':cmd,'returncode':code,'timeout':timed,'terminatedDescendantPids':terminated})+'\n');assert code==0 and not timed
metadata=json.loads((Path(os.environ['RUNNER_TEMP'])/'owned-dispatch-context/artifact-metadata.json').read_bytes());assert metadata['id']==11226630502 and metadata['workflow_run']['id']==37006765968 and metadata['workflow_run']['head_sha']=='8804758633b3cabd23ff9c084238f80433da99f7';assert metadata['digest']=='sha256:'+ZIP
archive=Path(os.environ['RUNNER_TEMP'])/'original-build.zip';assert archive.is_file() and not archive.is_symlink() and archive.stat().st_size<256<<20 and sha(archive)==ZIP
D=R/'download';D.mkdir();total=0;seen=set()
with zipfile.ZipFile(archive) as z:
 for info in z.infolist():
  p=Path(info.filename);assert not p.is_absolute() and '..' not in p.parts and info.filename not in seen;seen.add(info.filename);mode=(info.external_attr>>16)&0o170000;assert len(seen)<100000 and mode in [0,0o100000,0o040000] and info.file_size<=256<<20;total+=info.file_size;assert total<1024<<20
  target=D/p
  if info.is_dir():target.mkdir(parents=True,exist_ok=True);continue
  target.parent.mkdir(parents=True,exist_ok=True)
  with z.open(info) as source,target.open('xb') as output:shutil.copyfileobj(source,output)
matches=list(D.rglob('artifact-inventory.json'));assert len(matches)==1;download=matches[0].parent
rest=R/'restore-tools';rest.mkdir()
for f in ['restore.py','authenticate.mjs']:shutil.copyfile(A/f,rest/f)
a=json.loads((A/'restore-bindings.json').read_bytes());a.update(sourceWorktree=str(C),downloadedEvidence=str(download),newOutput=str(R/'restored'),node=node);a['helperHashes']={f:sha(rest/f) for f in ['restore.py','authenticate.mjs']};(R/'restore-input.json').write_text(json.dumps(a,indent=2)+'\n');execute('restore',[sys.executable,str(rest/'restore.py'),str(R/'restore-input.json')],seconds=600)
gate=R/'gate';gate.mkdir();derivation={}
from portable import runner as portable_runner,configuration as portable_configuration,admission as portable_admission
config,derivation['configuration']=portable_configuration((A/'guest.bochsrc').read_text(),C,R/'bochs.log');(gate/'guest.bochsrc').write_text(config)
text,derivation['profile-admission.mjs']=portable_admission((C/'scripts/bochs-cpu3-native-owned-in8/admission.mjs').read_text(),C,sha(gate/'guest.bochsrc'));(gate/'profile-admission.mjs').write_text(text)
for arm,root,path in [('BASE',C,'scripts/run-i80386-native-owned-in8.mjs'),('DISPATCH',B,'scripts/run-i80386-native-owned-dispatch.mjs')]:
 text,derivation[arm]=portable_runner((root/path).read_text(),root,gate/'profile-admission.mjs');(gate/(arm.lower()+'-runner.mjs')).write_text(text)
old=(A/'gate.py').read_text();new=old.replace("'/tmp/node-v22.23.3-linux-x64/bin/node'",repr(node));assert new.replace(repr(node),"'/tmp/node-v22.23.3-linux-x64/bin/node'")==old;(gate/'run.py').write_text(new);derivation['run.py']={'originalSha256':sha(A/'gate.py'),'derivedSha256':sha(gate/'run.py'),'onlyNodePathSubstitution':True}
for f in ['bounded.py','plan.json','reference.json','js-reference.json']:shutil.copyfile(A/f,gate/f)
for mode in ['smoke-off','fulltrace-on','trace-fast']:shutil.copytree(A/mode,gate/mode)
static=R/'dispatch-static.mjs';static.write_text("import {readFileSync}from 'node:fs';import {sourceIdentity,authenticateBuild}from "+json.dumps(str(B/'scripts/bochs-cpu3-native-owned-dispatch-runtime/identity.mjs'))+";const input=JSON.parse(readFileSync("+json.dumps(str(R/'restored/static-input.json'))+")).input;const source=sourceIdentity();console.log(JSON.stringify({source,provenance:authenticateBuild(input,source)}));")
execute('dispatch-static',[node,'--max-old-space-size=512',str(static)])
current=json.loads((R/'restored/source-admission.stdout').read_text());assert current['status']=='STATIC_SOURCE_ONLY_NO_ADDON_LOAD';candidate=json.loads((R/'dispatch-static.stdout').read_text());assert candidate['source']['revision']==DISPATCH and len(candidate['source']['hashes'])==112
b=json.loads((A/'gate-bindings.json').read_bytes());assert b['candidateSource']==candidate['source'];b.update(baselineWorktree=str(C),candidateWorktree=str(B),entries={'BASE':str(gate/'base-runner.mjs'),'DISPATCH':str(gate/'dispatch-runner.mjs')},parityDirectory=str(gate),referenceCapture=str(gate/'reference.json'),baseline=str(gate/'js-reference.json'),configuration=str(gate/'guest.bochsrc'),buildInput=json.loads((R/'restored/static-input.json').read_bytes())['input'],currentCompiledProof=current['provenance'],currentCandidateProvenance=candidate['provenance'])
(R/'portable-derivation.json').write_text(json.dumps(derivation,indent=2)+'\n');art={}
for root in [A,rest,D,R/'restored',gate]:
 for f in root.rglob('*'):
  if f.is_file() and f.name!='approved-bindings.json':art[str(f)]=sha(f)
for f in [archive,Path(os.environ['RUNNER_TEMP'])/'owned-dispatch-context/artifact-metadata.json',Path(os.environ['RUNNER_TEMP'])/'owned-dispatch-context/context.txt',R/'restore-input.json',R/'restore.stdout',R/'restore.stderr',R/'restore.exit.json',R/'publication-source.json',R/'portable-derivation.json',R/'reconstruction.json',static,R/'dispatch-static.stdout',R/'dispatch-static.stderr',R/'dispatch-static.exit.json',Path(__file__).resolve(),W/'.github/workflows/i80386-owned-clock-bulk-benchmark.yml',W/'test/i80386-owned-dispatch-ci.test.mjs']:art[str(f)]=sha(f)
b['artifactHashes']=art;b['helperHashes']={f:sha(gate/f)for f in ['run.py','plan.json','bounded.py']};(gate/'approved-bindings.json').write_text(json.dumps(b,indent=2)+'\n')
execute('benchmark',[sys.executable,str(gate/'run.py')],seconds=2400)
summary=json.loads((gate/'results/summary.json').read_bytes());assert len(summary['records'])==18;print(json.dumps(summary))

assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==publicationRevision and not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
for p,h in toolingHashes.items():assert sha(W/p)==h==hashlib.sha256(subprocess.check_output(['git','show',publicationRevision+':'+p],cwd=W)).hexdigest()

for n,v in assetInventory.items():assert sha(A/n)==v['sha256']==hashlib.sha256(subprocess.check_output(['git','show',publicationRevision+':scripts/owned-dispatch-ci/'+n],cwd=W)).hexdigest()
