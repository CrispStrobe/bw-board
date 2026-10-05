"""Read-only audit of four manufactured hosted decoder controls; no parent import."""
from pathlib import Path
import json,hashlib,subprocess
P=Path('/tmp/native-paged-int-iret-persistence-hosted-source-controls-20261004');F=Path('/tmp/native-paged-int-iret-persistence-hosted-source-freeze-20261004');R=Path('/tmp/bw-native-paged-int-iret-persistence-hosted-20261004')
sha=lambda b:hashlib.sha256(b).hexdigest();b=json.loads((P/'before.json').read_text());a=json.loads((P/'after.json').read_text());m=json.loads((F/'source-freeze.json').read_text());ex=json.loads((P/'exit.json').read_text());result=json.loads((P/'result.json').read_text());inv=json.loads((P/'invocation.json').read_text());assert b==a and b['head']==m['head']and not b['status'];assert b['source']==b['git']=={p:v['sha256']for p,v in m['files'].items()}and len(b['source'])==12
assert sha((P/'parent.py').read_bytes())==b['wrapper']=='334bceb6a6224f373d817076a055870e73308d8dd04ca0adea2d546b199b27ea'
for p,h in b['source'].items():assert sha((R/p).read_bytes())==h==sha(subprocess.check_output(['/usr/bin/git','show',m['head']+':'+p],cwd=R))
for role,count in [('compiledFiles',208),('driverFiles',81)]:
 v=b['roles'][role];assert len(v['current'])==count and v['current']==v['git']and not v['status']
 for p,h in v['current'].items():assert sha((Path(v['root'])/p).read_bytes())==h==sha(subprocess.check_output(['/usr/bin/git','show',v['revision']+':'+p],cwd=v['root']))
for key,path in [('node','nodePath'),('python','pythonPath'),('nestedPython','nestedPythonPath'),('gitBinary','gitPath')]:assert sha(Path(b[path]).read_bytes())==b[key]
assert result['status']=='SOURCE_CONTROLS_PASS'and result['beforeAfterEqual']and not result['primaryError']and not result['finalizationErrors'];assert ex['exitCode']==0 and ex['rawWaitStatus']==0 and ex['leaderReaped']and not ex['timeout']and not ex['primaryError']and not ex['finalizationErrors']
assert (P/'stdout').read_bytes()==b'';lines=(P/'stderr').read_text().splitlines();names=[arg.split('.',1)[1]for arg in inv['argv'][3:]];assert len(names)==4
for n in names:assert sum(l.startswith(n+' (')and l.endswith(' ... ok')for l in lines)==1
assert sum(l.startswith('test_')and l.endswith(' ... ok')for l in lines)==4 and 'OK'in lines and any(l.startswith('Ran 4 tests in ')for l in lines)
assert not any('skipped'in l for l in lines)
report={'status':'CODER_AUDIT_PASS','testedHead':m['head'],'ownSourceCount':12,'compiledCount':208,'driverCount':81,'sourceCurrentGitAndBeforeAfterEqual':True,'coverage':'four affected direct Python methods; five unchanged historical methods not repeated; no Node invoked','rawExit':ex,'scope':'Manufactured decoder/source fixtures only; no restore/download/worker/factory/addon/CPU. Original first execution remains FAIL; native instruction/parity/closure extent unknown.'}
(P/'coder-audit.json').write_text(json.dumps(report,indent=2)+'\n');print('CODER_FOUR_CASE_AUDIT_PASS')
