"""Read-only sole-ZIP failure audit. No extraction, imports of driver/addon or guest."""
import hashlib,json,zipfile
from pathlib import Path
P=Path('/tmp/native-paged-int-iret-first-execution-publication-20261004');Z=Path('/tmp/native-paged-int-iret-first-execution-20261004.zip')
def sha(b):return hashlib.sha256(b).hexdigest()
o=json.loads((P/'official-zip.json').read_text());raw=Z.read_bytes();assert len(raw)==o['zipBytes'] and sha(raw)==o['zipSha256']
with zipfile.ZipFile(Z) as z:
 assert len(z.infolist())==98 and z.testzip() is None
 assert len(z.namelist())==len(set(z.namelist())); members={}
 for i in z.infolist():
  assert not i.filename.startswith('/') and '..' not in i.filename.split('/') and not i.is_dir();b=z.read(i);members[i.filename]={'bytes':len(b),'sha256':sha(b)}
 def get(t):
  names=[n for n in z.namelist() if n.endswith('/'+t)];names=[n for n in names if n.startswith('_temp/paged-int-iret-execution/')] if len(names)>1 else names;assert len(names)==1,(t,names);return z.read(names[0])
 def obj(t):return json.loads(get(t))
 assert not any('/guest/' in n for n in z.namelist()),'no guest receipt retained'
 c=obj('paged-int-iret-hosted/contract.json');before=obj('fixed-before.json');after=obj('fixed-after.json');assert before==after
 assert len(before['tooling']['files'])==11 and len(before['compiled'])==208 and len(before['driver'])==80
 for role in ['compiled','driver']:assert before[role]=={p:v['sha256'] for p,v in c[role+'Files'].items()}
 restored=obj('restored-before.json');assert len(restored)==910 and restored==obj('restored-after.json')
 assert sha(get('official-artifact.zip'))==c['zipSha256'] and len(get('official-artifact.zip'))==c['zipBytes']
 status=obj('final-status.json');ex=obj('worker.exit.json');assert status['status']=='FAIL' and status['workerAttempted'] and status['workerStarted'] and status['workerPid']==3562
 assert ex['exitCode']==1 and not ex['timeout']
 stderr=get('worker.stderr').decode();assert 'Buffer.byteLength(bytes)<=16<<20' in stderr and 'runner.mjs:59:36' in stderr
 assert 'reading configuration' in stderr and 'installing nogui module' in stderr
 for role in ['driver-identity','static-admission-config']:assert obj(role+'.exit.json')['exitCode']==0
 runner=get('paged-int-iret-wrapper/scripts/paged-int-iret-hosted/parent.py') if False else None
 report={'status':'CODER_READ_ONLY_AUDIT_PASS_OF_GENUINE_FAILURE','officialArtifact':o,'members':members,'verified':{'crc':True,'originalStaticZipUnchanged':True,'fixedSourceRoleCounts':[11,208,80],'fixedBeforeAfterEqual':True,'fixedRoleMapsEqualOwnedContract':True,'restoredFileCount':910,'restoredBeforeAfterEqual':True,'identityAndStaticConfigExitZero':True},'worker':{'pid':3562,'exit':ex,'visibleError':'Final evidence serializer assertion: Buffer.byteLength(bytes)<=16<<20','finalStatus':status},'extent':{'addonInitializationObserved':True,'guestInstructions':'UNKNOWN','rawNative166':'NOT_RETAINED','primaryGuestError':'UNKNOWN; final serialization exception replaced any original outcome','architecturalParity':'UNQUALIFIED','nativeProviderOracleClosure':'UNKNOWN; cleanup path precedes write in source but no receipt proves its outcomes'},'scope':'ZIP streaming/read-only records only; no extraction/download/driver/addon/guest or source controls executed.'}
(P/'coder-actual-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print('CODER_FAILURE_AUDIT_PASS; first run remains FAIL; instruction extent unknown')
