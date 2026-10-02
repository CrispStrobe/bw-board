#!/usr/bin/env python3
"""Fixed hosted gate. Download occurs in workflow; no arbitrary code/artifact inputs."""
from pathlib import Path
import json,hashlib,sys,os,subprocess,zipfile,shutil,signal,time
sys.dont_write_bytecode=True
BASE='fe1eff2039520536350922a2164c8bbe29404c68';BULK='7b83f0ef631ba7c1cf3dc3513f5f569f00fc49f4';ZIP='0335f4c5088280cfcdf00186f5e0ca59ff431442edc3a978dd26b7dc2341a0e0'
W=Path(__file__).resolve().parent.parent;A=W/'scripts/owned-clock-bulk-ci';workspace=Path(os.environ['GITHUB_WORKSPACE']);R=Path(os.environ['RUNNER_TEMP'])/'owned-bulk-gate';R.mkdir(exist_ok=False);C=workspace/'baseline';B=workspace/'candidate';node=shutil.which('node');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
version=subprocess.run([node,'--version'],check=True,capture_output=True,text=True,timeout=10);assert version.stdout.strip()=='v22.23.3';(R/'node-version.json').write_text(json.dumps({'command':[node,'--version'],'stdout':version.stdout,'stderr':version.stderr,'returncode':version.returncode})+'\n')
for n,v in json.loads((A/'source-inventory.json').read_bytes()).items():assert sha(A/n)==v['sha256']
for root,rev in [(C,BASE),(B,BULK)]:assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==rev and not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip()
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
  child=subprocess.Popen(cmd,cwd=cwd,stdout=out,stderr=err,start_new_session=True);activeChildren.add(child.pid);timed=False;terminated=[]
  try:code=child.wait(timeout=seconds)
  except subprocess.TimeoutExpired:terminated=terminateTree(child.pid);code=child.wait();timed=True
 activeChildren.discard(child.pid)
 (R/(label+'.exit.json')).write_text(json.dumps({'command':cmd,'returncode':code,'timeout':timed,'terminatedDescendantPids':terminated})+'\n');assert code==0 and not timed
metadata=json.loads((Path(os.environ['RUNNER_TEMP'])/'owned-bulk-context/artifact-metadata.json').read_bytes());assert metadata['id']==11226630502 and metadata['workflow_run']['id']==37006765968 and metadata['workflow_run']['head_sha']=='8804758633b3cabd23ff9c084238f80433da99f7';assert metadata['digest']=='sha256:'+ZIP
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
for f in ['runner.mjs','admission.mjs']:
 old=(A/f).read_text();new=old.replace('/tmp/bw-board-386-owned-clock-bulk-source-20261002',str(B)).replace('/tmp/bw-board-386-native-owned-in8-r3-20261002',str(C)).replace('/mnt/volume1/tmp-astra/native-owned-clock-bulk-source-20261002/runtime-derivation',str(gate))
 assert new.replace(str(gate),'/mnt/volume1/tmp-astra/native-owned-clock-bulk-source-20261002/runtime-derivation').replace(str(B),'/tmp/bw-board-386-owned-clock-bulk-source-20261002').replace(str(C),'/tmp/bw-board-386-native-owned-in8-r3-20261002')==old
 (gate/f).write_text(new);derivation[f]={'originalSha256':sha(A/f),'derivedSha256':sha(gate/f),'onlyPathSubstitutions':True}
old=(A/'gate.py').read_text();new=old.replace("'/tmp/node-v22.23.3-linux-x64/bin/node'",repr(node));new=new.replace("c['provenance']==reference['provenance']","c['provenance']==a['currentCompiledProof']").replace("c['provenance']['compiled']['proof']==reference['provenance']","c['provenance']['compiled']['proof']==a['currentCompiledProof']");assert new.replace(repr(node),"'/tmp/node-v22.23.3-linux-x64/bin/node'").replace("c['provenance']==a['currentCompiledProof']","c['provenance']==reference['provenance']").replace("c['provenance']['compiled']['proof']==a['currentCompiledProof']","c['provenance']['compiled']['proof']==reference['provenance']")==old;(gate/'run.py').write_text(new);derivation['run.py']={'originalSha256':sha(A/'gate.py'),'derivedSha256':sha(gate/'run.py'),'allowedChanges':'Node path and explicit current compiled build proof (saved reference unchanged)'}
for f in ['bounded.py','plan.json']:shutil.copyfile(A/f,gate/f)
config=(A/'guest.bochsrc').read_text();original=config
for oldRoot in ['/tmp/bw-board-386-native-owned-clock-20261002','/tmp/bw-board-386-native-owned-main-20261002']:
 config=config.replace(oldRoot,str(C))
# BIOS paths historically use the frozen compiled 7df tree; replace only path tokens.
import re
config=re.sub(r'/tmp/[^\s,\"]+/roms/free-at-bios/',str(C)+'/roms/free-at-bios/',config)
config=re.sub(r'^log:.*$', 'log: '+str(R/'bochs.log'),config,flags=re.M)
(gate/'guest.bochsrc').write_text(config);derivation['configuration']={'originalSha256':sha(A/'guest.bochsrc'),'derivedSha256':sha(gate/'guest.bochsrc'),'allowedChanges':'BIOS/VGA/log path fields only; source-authenticated BIOS bytes'}
# Derived admission binds the portable configuration hash; all device/profile guards remain exact.
originalAdmission=(C/'scripts/bochs-cpu3-native-owned-in8/admission.mjs').read_text()
portableAdmission=originalAdmission.replace("'../bochs-cpu3-native-owned-clock/derive.mjs'",repr(str(C/'scripts/bochs-cpu3-native-owned-clock/derive.mjs'))).replace("'../bochs-cpu3-native-combined-paging-ram/host.mjs'",repr(str(C/'scripts/bochs-cpu3-native-combined-paging-ram/host.mjs'))).replace("fileURLToPath(new URL('../../',import.meta.url))",repr(str(C)+'/')).replace('5683c4731d60804502b17ee0653085ef761137199878880b3b5ed64fd0a49d3d',sha(gate/'guest.bochsrc'))
assert portableAdmission.replace(repr(str(C/'scripts/bochs-cpu3-native-owned-clock/derive.mjs')),"'../bochs-cpu3-native-owned-clock/derive.mjs'").replace(repr(str(C/'scripts/bochs-cpu3-native-combined-paging-ram/host.mjs')),"'../bochs-cpu3-native-combined-paging-ram/host.mjs'").replace(repr(str(C)+'/'),"fileURLToPath(new URL('../../',import.meta.url))").replace(sha(gate/'guest.bochsrc'),'5683c4731d60804502b17ee0653085ef761137199878880b3b5ed64fd0a49d3d')==originalAdmission
(gate/'profile-admission.mjs').write_text(portableAdmission)
originalBaseRunner=(C/'scripts/run-i80386-native-owned-in8.mjs').read_text();baseRunner=originalBaseRunner;baseImportReplacements=[]
# Resolve every literal relative import to its same frozen module; only admission points at derivative.
baseRunner=re.sub(r"from ('|\")(\./[^'\"]+)\1",lambda m:(baseImportReplacements.append((m.group(0),'from '+repr(str((C/'scripts'/m.group(2)).resolve())))) or baseImportReplacements[-1][1]),baseRunner)
baseRunner=baseRunner.replace(str(C/'scripts/bochs-cpu3-native-owned-in8/admission.mjs'),str(gate/'profile-admission.mjs'))
inverseBase=baseRunner.replace(str(gate/'profile-admission.mjs'),str(C/'scripts/bochs-cpu3-native-owned-in8/admission.mjs'))
for originalImport,derivedImport in reversed(baseImportReplacements):inverseBase=inverseBase.replace(derivedImport,originalImport)
assert inverseBase==originalBaseRunner
(gate/'base-runner.mjs').write_text(baseRunner)
derivation['base-runner.mjs']={'originalSha256':hashlib.sha256(originalBaseRunner.encode()).hexdigest(),'derivedSha256':sha(gate/'base-runner.mjs'),'inverseExact':True}
bulkRunner=(gate/'runner.mjs').read_text().replace(str(C/'scripts/bochs-cpu3-native-owned-in8/admission.mjs'),str(gate/'profile-admission.mjs'));(gate/'runner.mjs').write_text(bulkRunner)
assert bulkRunner.replace(str(gate/'profile-admission.mjs'),str(C/'scripts/bochs-cpu3-native-owned-in8/admission.mjs')).replace(str(gate),'/mnt/volume1/tmp-astra/native-owned-clock-bulk-source-20261002/runtime-derivation').replace(str(B),'/tmp/bw-board-386-owned-clock-bulk-source-20261002').replace(str(C),'/tmp/bw-board-386-native-owned-in8-r3-20261002')==(A/'runner.mjs').read_text()
derivation['runner.mjs']['derivedSha256']=sha(gate/'runner.mjs');derivation['runner.mjs']['profileAdmissionImportSubstitution']=True
derivation['profile-admission']={'originalSha256':hashlib.sha256(originalAdmission.encode()).hexdigest(),'derivedSha256':sha(gate/'profile-admission.mjs'),'allowedChanges':'frozen import/root paths and exact path-derived configuration SHA only'}
# Compare all configuration directives after canonicalizing only the three declared path fields.
assert config.replace(str(C),'/tmp/bw-board-386-native-owned-clock-20261002').replace(str(R/'bochs.log'),'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochs.log')==original
for mode in ['smoke-off','fulltrace-on','trace-fast']:shutil.copytree(A/mode,gate/mode)
for f in ['reference.json','js-reference.json']:shutil.copyfile(A/f,gate/f)
b=json.loads((A/'gate-bindings.json').read_bytes());b['baselineWorktree']=str(C);b['candidateWorktree']=str(B);b['entries']={'BASE':str(gate/'base-runner.mjs'),'BULK':str(gate/'runner.mjs')};b['parityDirectory']=str(gate);b['referenceCapture']=str(gate/'reference.json');b['baseline']=str(gate/'js-reference.json');b['configuration']=str(gate/'guest.bochsrc');b['buildInput']=json.loads((R/'restored/static-input.json').read_bytes())['input']
# Portable binding authenticates every restored/source/recipe/retained evidence byte.
art={}
for root in [A,rest,R/'restored',gate]:
 for f in root.rglob('*'):
  if f.is_file() and f.name!='approved-bindings.json':art[str(f)]=sha(f)
current=json.loads((R/'restored/source-admission.stdout').read_text());assert current['status']=='STATIC_SOURCE_ONLY_NO_ADDON_LOAD';b['currentCompiledProof']=current['provenance'];(R/'portable-derivation.json').write_text(json.dumps(derivation,indent=2)+'\n');art[str(R/'portable-derivation.json')]=sha(R/'portable-derivation.json');art[str(Path(__file__).resolve())]=sha(Path(__file__).resolve());b['artifactHashes']=art;b['helperHashes']={f:sha(gate/f) for f in ['run.py','plan.json','bounded.py']};(gate/'approved-bindings.json').write_text(json.dumps(b,indent=2)+'\n');(R/'portable-derivation.json').write_text(json.dumps(derivation,indent=2)+'\n')
execute('benchmark',[sys.executable,str(gate/'run.py')],seconds=2400)
summary=json.loads((gate/'results/summary.json').read_bytes());assert len(summary['records'])==18;print(json.dumps(summary))
