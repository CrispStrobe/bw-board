import json,hashlib,subprocess,ast
from pathlib import Path
Q=Path('/tmp/native-paged-int-iret-hosted-source-controls-20261004');R=Path('/tmp/bw-native-paged-int-iret-hosted-source-20261004')
h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();load=lambda p:json.loads(Path(p).read_text())
b=load(Q/'before.json');a=load(Q/'after.json');e=load(Q/'exit.json');v=load(Q/'invocation.json');s=load(Q/'result.json');assert a==b and b['head']=='f259485ac5de4696b35768809cb96f6769eb0eaf'and b['status']==''and b['source']==b['git']and len(b['source'])==11
f=load('/tmp/native-paged-int-iret-hosted-source-freeze-20261004/source-freeze.json');assert f['head']==b['head']
for root,revision,files in [(R,b['head'],f['files'])]+[(Path(x['root']),x['revision'],{p:{'sha256':v}for p,v in x['current'].items()})for x in b['roles'].values()]:
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()==revision and not subprocess.check_output(['git','-C',str(root),'status','--porcelain'])
 for p,w in files.items():
  data=(root/p).read_bytes();assert hashlib.sha256(data).hexdigest()==w['sha256'];assert data==subprocess.check_output(['git','-C',str(root),'show',revision+':'+p])
  if 'bytes'in w:assert len(data)==w['bytes']
assert [len(b['roles'][k]['current'])for k in ['compiledFiles','driverFiles']]==[208,80]
for x in b['roles'].values():assert x['current']==x['git']and not x['status']
for k,p in [('node',b['nodePath']),('python',b['pythonPath']),('nestedPython',b['nestedPythonPath']),('gitBinary',b['gitPath'])]:assert h(p)==b[k]
assert h(Q/'parent.py')==b['wrapper']=='862e3bc9a400cde268faa61854a702f2d4288ff77ffe78cb9dd43d5b7488a293'
for k,p in [('officialBuildZip','/tmp/native-paged-int-iret-first-build-20261004.zip'),('staticRootAudit','/tmp/native-paged-int-iret-first-build-root-audit-20261004.json'),('staticIndependentAudit','/tmp/native-paged-int-iret-first-build-independent-audit-20261004.json'),('driverFinalFreeze','/tmp/native-paged-int-iret-ready-driver-source-publication-20261004/final-source-freeze.json')]:assert h(p)==b['authorities'][k]
assert h(Q/'paths.json')==b['pathList']and h('/tmp/native-paged-int-iret-hosted-source-freeze-20261004/source-freeze.json')==b['sourceFreeze']
assert s['status']=='SOURCE_CONTROLS_PASS'and s['beforeAfterEqual']and s['primaryError']is None and not s['finalizationErrors']
assert e['childStarted']and e['leaderReaped']and e['exitCode']==e['rawWaitStatus']==0 and not e['timeout']and e['primaryError']is None and not e['finalizationErrors']
assert v['bounds']=={'cpuSeconds':10,'wallSeconds':30,'heapMiB':128,'fileMiB':16,'coreBytes':0,'nice':10}
assert v['argv']==[b['nodePath'],'--max-old-space-size=128','--test','test/i80386-paged-int-iret-hosted-source.test.mjs']
stdout=(Q/'stdout').read_text();lines=stdout.splitlines();normalized=[]
for line in lines:
 while line.startswith('# ')or line.startswith('\\# '):line=line[2:]if line.startswith('# ')else line[3:]
 normalized.append(line)
named=[line for line in normalized if line.startswith('test_')and line.endswith(' ... ok')];assert len(named)==6 and any(line.startswith('Ran 6 tests in ')for line in normalized)and 'OK'in normalized
assert all(line in lines for line in ['# tests 1','# pass 1','# fail 0','# skipped 0'])and(Q/'stderr').read_bytes()==b''
for p in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT']:assert v['environment'][p]==''
for p in v['compilerInjectionVariablesAbsent']:assert p not in v['environment']
report={'status':'PASS','revision':b['head'],'toolingCount':11,'compiledCount':208,'driverCount':80,'beforeAfterEqual':True,'currentGitEqual':True,'namedPythonCases':named,'nodeTests':1,'pythonCases':6,'failures':0,'skips':0,'outerStderrBytes':0,'rawWaitStatus':0,'leaderReaped':True,'rawExitWallSeconds':e['wallSeconds'],'rootReportedFinalAuthInclusiveSeconds':6.982858606,'rusage':e['rusage'],'scope':'Manufactured source/mock control evidence only; no real restoration/download/worker/factory/addon/emulated CPU.'}
(Q/'coder-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'sourceCounts':[11,208,80],'coverage':[1,6],'rawExitWallSeconds':e['wallSeconds']}))
