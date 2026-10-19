#!/usr/bin/env python3
"""Single fixed baseline profiling diagnostic; no throughput gate or arbitrary inputs."""
from pathlib import Path
import json,hashlib,sys,os,subprocess,zipfile,shutil,signal,time,resource
sys.dont_write_bytecode=True
BASE='fe1eff2039520536350922a2164c8bbe29404c68';ZIP='0335f4c5088280cfcdf00186f5e0ca59ff431442edc3a978dd26b7dc2341a0e0'
W=Path(__file__).resolve().parent.parent;A=W/'scripts/owned-clock-bulk-ci';workspace=Path(os.environ['GITHUB_WORKSPACE']);R=Path(os.environ['RUNNER_TEMP'])/'owned-baseline-profile';R.mkdir(exist_ok=False);C=workspace/'baseline';node=shutil.which('node');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:os.environ[k]=''
version=subprocess.run([node,'--version'],check=True,capture_output=True,text=True,timeout=10);assert version.stdout.strip()=='v22.23.3';(R/'node-version.json').write_text(json.dumps({'command':[node,'--version'],'stdout':version.stdout,'stderr':version.stderr,'returncode':version.returncode})+'\n')
for n,v in json.loads((A/'source-inventory.json').read_bytes()).items():assert sha(A/n)==v['sha256']
for root,rev in [(C,BASE)]:assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==rev and not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip()
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
def childLimits(niceIncrease=10):
 resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0));os.nice(niceIncrease)
def execute(label,cmd,cwd=W,seconds=120):
 with (R/(label+'.stdout')).open('xb') as out,(R/(label+'.stderr')).open('xb') as err:
  child=subprocess.Popen(cmd,cwd=cwd,stdout=out,stderr=err,start_new_session=True,preexec_fn=lambda:childLimits(0 if label=='profile-child-parent' else 10));activeChildren.add(child.pid);timed=False;terminated=[]
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
profile=R/'profile';profile.mkdir()
config=(A/'guest.bochsrc').read_text();original=config
import re
for oldRoot in ['/tmp/bw-board-386-native-owned-clock-20261002','/tmp/bw-board-386-native-owned-main-20261002']:config=config.replace(oldRoot,str(C))
config=re.sub(r'/tmp/[^\s,\"]+/roms/free-at-bios/',str(C)+'/roms/free-at-bios/',config)
config=re.sub(r'^log:.*$', 'log: '+str(R/'bochs.log'),config,flags=re.M)
assert config.replace(str(C),'/tmp/bw-board-386-native-owned-clock-20261002').replace(str(R/'bochs.log'),'/mnt/volume1/tmp-astra/native-direct-smoke-r3-20261001/bochs.log')==original
(profile/'guest.bochsrc').write_text(config)
helper=W/'scripts/owned-baseline-profile';pins={str(f):sha(f) for f in [Path(__file__).resolve(),helper/'derive.mjs',helper/'alignment.mjs',helper/'plan.json',W/'.github/workflows/i80386-owned-baseline-profile.yml',W/'test/i80386-owned-baseline-profile.test.mjs']}
publicationRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip();assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
for path,h in pins.items():assert hashlib.sha256(subprocess.check_output(['git','show',publicationRevision+':'+str(Path(path).relative_to(W))],cwd=W)).hexdigest()==h
(R/'diagnostic-manifest.json').write_text(json.dumps({'kind':'SOURCE_OWNED_BASELINE_INSPECTOR_DIAGNOSTIC','publicationRevision':publicationRevision,'files':pins,'alignmentSha256':None},indent=2)+'\n')
execute('alignment',[node,'--max-old-space-size=512',str(helper/'alignment.mjs'),str(R/'alignment.json')],seconds=120)
assert json.loads((R/'alignment.json').read_bytes())['status']=='NONGUEST_INSPECTOR_HRTIME_DOMAIN_PASS'
manifest=json.loads((R/'diagnostic-manifest.json').read_bytes());manifest['alignmentSha256']=sha(R/'alignment.json');(R/'diagnostic-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
execute('derive',[node,'--max-old-space-size=512',str(helper/'derive.mjs'),str(C),str(profile),sha(profile/'guest.bochsrc'),str(R/'diagnostic-manifest.json')])
current=json.loads((R/'restored/source-admission.stdout').read_text());assert current['status']=='STATIC_SOURCE_ONLY_NO_ADDON_LOAD'
source=current['source'];assert source['revision']==BASE and len(source['hashes'])==103
before={}
for p,h in source['hashes'].items():
 assert sha(C/p)==h==hashlib.sha256(subprocess.check_output(['git','show',BASE+':'+p],cwd=C)).hexdigest();before[str(C/p)]=h
for root in [A,D,R/'restored',profile,helper]:
 for f in root.rglob('*'):
  if f.is_file():before[str(f)]=sha(f)
before.update(pins);before[str(archive)]=sha(archive);before[str(Path(os.environ['RUNNER_TEMP'])/'owned-bulk-context/artifact-metadata.json')]=sha(Path(os.environ['RUNNER_TEMP'])/'owned-bulk-context/artifact-metadata.json');before[str(R/'diagnostic-manifest.json')]=sha(R/'diagnostic-manifest.json');(R/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
reference=json.loads((A/'reference.json').read_bytes());assert reference['source']==source
inp={**json.loads((R/'restored/static-input.json').read_bytes())['input'],'configuration':str(profile/'guest.bochsrc'),'baseline':str(A/'js-reference.json'),'baselineSha256':'bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e','output':str(profile/'guest'),'nativeTrace':False,'hostJournal':False};assert len(inp)==12
ip=profile/'input.json';ip.write_text(json.dumps(inp,indent=2)+'\n')
execute('profile-child-parent',[sys.executable,str(A/'bounded.py'),'--node',node,'--entry',str(profile/'profile-runner.mjs'),'--input',str(ip),'--stem',str(profile/'child')],cwd=C,seconds=140)
exit=json.loads((profile/'child.exit.json').read_bytes());assert exit['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION'
capture=json.loads((profile/'guest/capture.json').read_bytes());assert capture['source']==source and capture['provenance']==current['provenance']
for k in ['reset','final','checkpoints','settled','ramSha256','resetWitness','ramCanonicalSha256','in8Witness','resumes','terminal','closed']:assert capture[k]==reference[k],k
assert capture['resumes']==445 and len(capture['checkpoints'])==6 and capture['journal']['rows']==0
for p,h in before.items():assert sha(p)==h
assert not subprocess.check_output(['git','status','--porcelain'],cwd=C).strip()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==publicationRevision and not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
(R/'auth-after.json').write_text(json.dumps(before,indent=2)+'\n')
raw=json.loads((profile/'guest/profile.cpuprofile').read_bytes());phases=capture['profiling']['phases'];assert phases['startCallEndUs']<=phases['executionBeginUs']<=phases['executionEndUs']<=phases['stopCallBeginUs']<=phases['stopCallEndUs'];assert raw['startTime']<=phases['executionBeginUs'] and raw['endTime']>=phases['executionEndUs']
assert type(raw['startTime']) is int and type(raw['endTime']) is int and 0<=raw['startTime']<=raw['endTime']<2**53
assert len(raw['samples'])==len(raw['timeDeltas'])
nodeIds={n['id'] for n in raw['nodes']};assert len(nodeIds)==len(raw['nodes']) and all(type(n) is int and n>0 for n in nodeIds)
assert all(type(n) is int and n in nodeIds for n in raw['samples'])
timeUs=raw['startTime'];selected=[]
for i,delta in enumerate(raw['timeDeltas']):
 assert type(delta) is int and 0<=delta<2**53;timeUs+=delta;assert timeUs<2**53
 if phases['executionBeginUs']<=timeUs<=phases['executionEndUs']:selected.append(i)
assert selected,'No actual execution samples; raw profile retained but diagnostic unqualified'
summary={'status':'ACTUAL_SINGLE_BASELINE_PROFILE_FULL_PARITY_PASS','captureSha256':sha(profile/'guest/capture.json'),'profileSha256':sha(profile/'guest/profile.cpuprofile'),'alignmentSha256':sha(R/'alignment.json'),'derivationSha256':sha(profile/'derivation.json'),'executionSampleIndices':selected,'sampleCount':len(raw['samples']),'executionSampleCount':len(selected),'limitation':'Qualitative isolate stack ranking only; no CPU shares, speed gate, all-thread attribution or C-core/NAPI split. Shared invoke leaf named close is not actual close cost.'}
(R/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary))
