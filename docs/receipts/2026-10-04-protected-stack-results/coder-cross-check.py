"""Read-only retained actual evidence; no emulator imports/execution."""
import json,hashlib,subprocess,zipfile
from pathlib import Path
N=Path(__file__).resolve().parent;E=N/'selected/_temp/protected-stack-execution';R=Path('/tmp/bw-native-protected-stack-source-20261004')
def read(p):return json.loads(p.read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
v=read(E/'guest/capture.json');m=read(N/'zip-retention.json');checks=0
def check(x):
 global checks
 assert x;checks+=1
check(v['status']=='PASS');check(read(E/'final-status.json')['status']=='PASS');check(sha((N/'official-artifact.zip').read_bytes())==m['zipSha256']);check(m['files']==97)
with zipfile.ZipFile(N/'official-artifact.zip') as z:
 for name,r in m['filesByPath'].items():
  raw=z.read(name);check(len(raw)==r['bytes'] and sha(raw)==r['sha256'])
for before,after in [('driverBefore','driverAfter'),('compiledBefore','compiledAfter'),('build','buildAfter'),('configuration','configurationAfter'),('nodeBefore','nodeAfter'),('inputSha256Before','inputSha256After')]:check(v[before]==v[after])
for role,count in [('compiledBefore',174),('driverBefore',67)]:
 x=v[role];check(len(x['hashes'])==count)
 for name,h in x['hashes'].items():check(sha(subprocess.check_output(['git','show',x['revision']+':'+name],cwd=R))==h)
f=read(E/'fixed-before.json');check(f==read(E/'fixed-after.json'));check(read(E/'restored-before.json')==read(E/'restored-after.json'));check(len(f['tooling']['files'])==9)
for name,h in f['tooling']['files'].items():check(sha(subprocess.check_output(['git','show',f['tooling']['head']+':'+name],cwd=R))==h)
check(len(v['boundaries'])==32);check(len(v['cuts'])==13);check(v['progress']=={'n':30,'q':30,'dn':1,'dq':1,'resumes':30,'zeroQ':0});check(v['cleanup']=={'native':'closed','provider':'closed','javascript':'closed'})
fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss']
for i,b in enumerate(v['boundaries']):
 n=b['native'];j=b['javascript'];c=j['cpu'];words=sum([n[k]for k in ['state','extra','segments','system','debug']],[]);check(len(words)==166);check(all(type(x)is int and 0<=x<=0xffffffff for x in words));check(int(n['nativeTicks'])==int(n['successfulQuanta'])==j['q']==min(i,30))
 for k,x in zip(fields,n['state']):check(c[k]==x)
 check(n['state'][16:]==[c['gdtr']['base'],c['gdtr']['limit'],c['idtr']['base'],c['idtr']['limit']]);check(n['extra'][2:5]==[c['es'],c['fs'],c['gs']]);check(b['board']['board']==j['board'])
 for key in ['gdt','code','stack']:check(len(b['nativeHostPages'][key])==4096 and b['nativeHostPages'][key]==j['pages'][key])
 if c['cs']==24:check(n['segments'][15:30]==[1,24,3,0,0,1,1,0,1,11,0,65535,0,0,0])
 if c['ds']==16:check(n['segments'][45:60]==[3,16,2,0,0,1,1,0,1,3,0,65535,0,0,0])
 if c['ss']==16:check(n['segments'][30:45]==[2,16,2,0,0,7 if len(j['stores'])>11 else 1,1,0,1,3,0,65535,0,0,0])
 check([c['interruptShadow'],c['nmiShadow'],c['debugShadow']]==([1,1,0]if c['cs']==24 and c['eip']==0x7007 else [0,0,0]));check(all(int(x)==0 for x in n['fallback'].values()));check(all(int(n['execution'][k])==0 for k in ['faults','irqDeliveries','portCommits','haltIdleCuts','repIterations','repPartial']))
check([(x['name'],x['q'])for x in v['cuts']]==[('reset',0),('after-LGDT',16),('PE-enabled',18),('entered-protected-RAM',19),('after-DS-load',21),('after-SS-load',22),('stack-ready',23),('after-PUSH',25),('after-POP',26),('entered-CALL',27),('callee-MOV',28),('returned-CALL',29),('before-HLT',30)])
check(v['nativeFinal']['ramSha256']==v['javascriptFinal']['ramSha256']=='45d6115ea87c30d9e4fa0c2a4a484451e1bd2ac34b3667e76db231b4abee2cdd');check(v['nativeFinal']['state']['board']==v['javascriptFinal']['board'])
for k in ['gdt','code','stack']:check(v['nativeFinal']['pages'][k]==v['javascriptFinal']['pages'][k])
exit=read(E/'worker.exit.json');check(exit['exitCode']==0 and not exit['timeout']);check((E/'worker.stderr').stat().st_size>=0)
result={'status':'PASS_READONLY_CODER_ACTUAL_CROSSCHECK','checks':checks,'runId':37196612572,'artifactId':m['artifactId'],'captureSha256':sha((E/'guest/capture.json').read_bytes()),'boundaries':32,'cuts':13,'n':30,'q':30,'compiledGit':174,'driverGit':67,'toolingGit':9,'scope':'Raw represented registers/fullboards/threepages/strict CSDS/SS1-to7/source and allmembers crosscheck; independent complete audit separately covers all counterpart fields/native-only source contracts; no rerun'}
(N/'coder-cross-check.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
