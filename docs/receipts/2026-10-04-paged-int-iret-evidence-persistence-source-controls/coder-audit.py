"""Read-only audit of manufactured transport controls and source identity; no emulator."""
from pathlib import Path
import hashlib,json,subprocess
R=Path('/tmp/bw-native-paged-int-iret-evidence-persistence-20261004');F=Path('/tmp/native-paged-int-iret-evidence-persistence-source-freeze-20261004')
C=Path('/tmp/native-paged-int-iret-evidence-persistence-source-controls-20261004');A=Path('/tmp/native-paged-int-iret-evidence-persistence-source-auth-20261004')
sha=lambda b:hashlib.sha256(b).hexdigest();meta=json.loads((F/'source-freeze.json').read_text());assert meta['head']=='b12e8d50bd90dcb503dd186890ed11483cc2eca3'
for P,mode in [(C,'SOURCE_CONTROLS_PASS'),(A,'READONLY_SOURCE_AUTH_PASS')]:
 b=json.loads((P/'before.json').read_text());a=json.loads((P/'after.json').read_text());r=json.loads((P/'result.json').read_text());ex=json.loads((P/'exit.json').read_text());assert b==a and b['head']==meta['head']and not b['status']
 assert b['source']==b['git']=={p:v['sha256']for p,v in meta['files'].items()};assert len(b['source'])==81
 assert r['status']==mode and r['beforeAfterEqual']and r['primaryError']is None and r['finalizationErrors']==[]
 assert ex['exitCode']==0 and ex['rawWaitStatus']==0 and ex['leaderReaped'] and not ex['timeout'] and not ex['primaryError']and ex['finalizationErrors']==[]
 assert (P/'stderr').read_bytes()==b'' and sha((P/'parent.py').read_bytes())==b['wrapper']
 for key,path in [('node',b['nodePath']),('python',b['pythonPath']),('gitBinary',b['gitPath'])]:assert sha(Path(path).read_bytes())==b[key]
 for p,record in meta['files'].items():
  assert sha((R/p).read_bytes())==record['sha256'];assert sha(subprocess.check_output(['/usr/bin/git','show',meta['head']+':'+p],cwd=R))==record['sha256']
 lines=(C/'stdout').read_text().splitlines()
 for line in ['# tests 6','# pass 6','# fail 0','# skipped 0']:assert line in lines
 v=json.loads((A/'stdout').read_text());assert v['revision']==meta['head']and v['hashes']==b['source'];pin=json.loads((A/'source-identity-pin.json').read_text());assert sha(json.dumps(v,separators=(',',':')).encode())==pin['canonicalSha256']
 report={'status':'CODER_AUDIT_PASS','head':meta['head'],'sourceCount':81,'currentGitAndBeforeAfterEqual':True,'controls':'six selected PASS zero skips: held lifecycle inverse plus five manufactured transport fixtures','identity':pin,'rawExit':ex,'scope':'No provider/oracle construction, addon/CPU/guest/build; transport controls only. The original first guest run remains FAIL with unknown instruction/parity/closure extent.'}
 (P/'coder-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print('CODER_CONTROLS_AND_IDENTITY_AUDIT_PASS')
