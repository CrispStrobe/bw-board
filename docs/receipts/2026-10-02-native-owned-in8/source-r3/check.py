import pathlib,json,hashlib,subprocess,resource,os,time,signal
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-owned-in8-r3-20261002');sha=lambda b:hashlib.sha256(b).hexdigest();paths=json.load(open(P/'source-paths.json'));pins=lambda:{f:sha((W/f).read_bytes())for f in paths};before=pins();cmd=['/tmp/node-v22.23.3-linux-x64/bin/node','--max-old-space-size=512','--test','test/i80386-native-owned-in8.test.mjs'];env=os.environ.copy()
for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE']:env[k]=''
(P/'prepared.json').write_text(json.dumps({'command':cmd,'before':before,'helperSha256':sha(pathlib.Path(__file__).read_bytes()),'scope':'source-only dirty candidate tests; no native addon'},indent=2)+'\n')
def limits():
 os.nice(10);resource.setrlimit(resource.RLIMIT_CPU,(120,120));resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(256<<20,256<<20))
t=time.monotonic()
with(P/'stdout').open('xb')as out,(P/'stderr').open('xb')as err:
 child=subprocess.Popen(cmd,cwd=W,env=env,stdout=out,stderr=err,preexec_fn=limits,start_new_session=True)
 try:code=child.wait(timeout=120);timeout=False
 except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);code=child.wait();timeout=True
after=pins();receipt={'exitCode':code,'timeout':timeout,'wallSeconds':time.monotonic()-t,'before':before,'after':after,'unchanged':before==after,'stdoutSha256':sha((P/'stdout').read_bytes()),'stderrSha256':sha((P/'stderr').read_bytes())};(P/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({k:v for k,v in receipt.items()if k not in ['before','after']}))
