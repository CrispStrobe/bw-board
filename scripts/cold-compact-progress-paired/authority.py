"""Fixed owned authority only. PENDING blocks all setup/spawn effects."""
import json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
def require(ok,message):
 if not ok:raise ValueError(message)
def validate_authority(c):
 require(c['status']=='ROOT_REVIEWED_ACTUAL_COMPACT_QUALIFICATION_READY','PENDING compact artifact/proof: no checkout/download/spawn')
 require(c['schema']=='bw.cold-compact-progress.paired-source.v1' and c['progressExportProfile']=='bw.cold-native.compact-progress.v1','fixed distinct compact authority')
 require(c['targetN']==c['targetQ']==316562,'fixed held extent')
 a=c['compactQualificationAudit'];require(type(a) is dict and set(a)=={'file','sha256'} and Path(a['file']).name==a['file'],'closed genuine proof role')
 p=HERE/a['file'];require(p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==a['sha256'],'actual genuine proof bytes');proof=json.loads(p.read_bytes())
 require(proof['schema']=='bw.cold-compact-progress.qualification-audit.v1' and proof['status']=='PASS','genuine compact full terminal parity')
 require(proof['compiledRevision']==c['compiledRevision'] and proof['addonSha256']==c['addonSha256'] and proof['progressExportProfile']==c['progressExportProfile'],'same actual build/profile')
 require(proof['worker']=={'revision':c['workers']['native']['revision'],'sourceSha256':c['workers']['native']['sourceSha256']} and proof['officialArtifact']==c['compactQualificationArtifact'],'same genuine worker/artifact')
 return c,p
