import sys,json,hashlib,subprocess,resource,time
from pathlib import Path
root=Path('/tmp/bw-board-386-owned-clock-replay-20261002')
expected=sys.argv[1]
out=Path('/mnt/volume1/tmp-astra/owned-clock-historical-replay-20261002');out.mkdir(exist_ok=False)
inputs=Path('/mnt/volume1/tmp-astra/native-hot-clock-fenced-capture-20261002/offline-inputs.json')
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(args):return subprocess.check_output(['git',*args],cwd=root).decode().strip()
assert git(['rev-parse','HEAD'])==expected
assert git(['status','--porcelain'])==''
inputsha=sha(inputs.read_bytes()); assert inputsha=='7bbf9d61df3597bc0432bb61968286a9b045a17a1adfc7b0450ddc708f1813c2'
bindings=json.loads(inputs.read_bytes())
def authenticate():
 assert sha(inputs.read_bytes())==inputsha
 assert git(['rev-parse','HEAD'])==expected and git(['status','--porcelain'])==''
 files={}
 for name,v in bindings.items():
  b=Path(v['path']).read_bytes(); assert sha(b)==v['sha256']; files[name]={'bytes':len(b),'sha256':sha(b),'path':v['path']}
 return {'revision':expected,'inputsSha256':inputsha,'inputs':files,'helperSha256':sha(Path(__file__).read_bytes())}
before=authenticate();(out/'auth-before.json').write_text(json.dumps(before,indent=2)+'\n')
command=['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512',str(root/'scripts/replay-i80386-native-owned-clock-journal.mjs'),str(inputs),inputsha]
def limits():
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(120,120))
start=time.monotonic();timedout=False
with (out/'replay.stdout').open('xb') as stdout,(out/'replay.stderr').open('xb') as stderr:
 try:r=subprocess.run(command,cwd=root,stdout=stdout,stderr=stderr,timeout=120,preexec_fn=limits);code=r.returncode
 except subprocess.TimeoutExpired:code=None;timedout=True
elapsed=time.monotonic()-start;after=authenticate();(out/'auth-after.json').write_text(json.dumps(after,indent=2)+'\n'); assert after==before
streams={n:{'bytes':(out/n).stat().st_size,'sha256':sha((out/n).read_bytes())} for n in ['replay.stdout','replay.stderr']}
record={'command':command,'exitCode':code,'timedOut':timedout,'elapsedSeconds':elapsed,'streams':streams,'sourceRevision':expected,'scope':'actual historical host/board replay only; no native addon/CPU execution; no performance measurement'}
(out/'exit.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
assert code==0 and not timedout and all(v['bytes']<256*1024*1024 for v in streams.values())
report=json.loads((out/'replay.stdout').read_bytes());assert report['status']=='SOURCE_ONLY_OWNED_REAL_BOARD_HISTORICAL_REPLAY_PASS';assert report['resumes']==439 and report['logicalRows']==209839 and len(report['checkpoints'])==6
assert report['source']['revision']==expected
print('ROOT_BOUND_OWNED_HISTORICAL_REPLAY_PASS')
