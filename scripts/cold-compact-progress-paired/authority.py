"""Fixed owned authority only. PENDING blocks all setup/spawn effects."""
import json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
def require(ok,message):
 if not ok:raise ValueError(message)
def validate_authority(c):
 require(c['status']=='ROOT_REVIEWED_ACTUAL_COMPACT_QUALIFICATION_READY','PENDING compact artifact/proof: no checkout/download/spawn')
 require(hashlib.sha256(json.dumps({k:v for k,v in c.items() if k!='status'},sort_keys=True,separators=(',',':')).encode()).hexdigest()=='7203e018a476b7b49a26b10a98e66a777b7f3abd7936ca33b334adff30ada33e','entire source-owned authority; no caller substitutions')
 require(c['schema']=='bw.cold-compact-progress.paired-source.v1' and c['progressExportProfile']=='bw.cold-native.compact-progress.v1','fixed distinct compact authority')
 require(c['targetN']==c['targetQ']==316562,'fixed held extent')
 a=c['compactQualificationAudit'];require(type(a) is dict and set(a)=={'file','sha256'} and Path(a['file']).name==a['file'],'closed genuine proof role')
 p=HERE/a['file'];require(p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==a['sha256'],'actual genuine proof bytes');proof=json.loads(p.read_bytes())
 require(proof['status']=='INDEPENDENT_COMPACT_PROGRESS_QUALIFICATION_TERMINAL_PARITY_PASS','genuine compact full terminal parity')
 artifact=c['compactQualificationArtifact'];require((proof['runId'],proof['artifactId'],proof['artifactBytes'],proof['artifactSha256'])==(artifact['runId'],artifact['artifactId'],artifact['zipBytes'],artifact['zipSha256']),'same genuine official artifact')
 require(proof['sourceInputs']==308 and proof['sourceRoleCounts']=={'tooling':18,'compiled':163,'driver':54,'worker':73} and proof['allSourceGitAndFinalGuardsEqual'],'actual complete source/final guards')
 require(proof['nativeTicks']==proof['successfulQuanta']==316562 and proof['rawResetFinalLastInspectionWords']==166 and proof['actualCompactReturnFields']==9 and proof['requestedLastFinalRaw166Equal'],'actual compact/requested full terminal proof')
 require(proof['fullTerminalBoardEqual'] and proof['wholeRamHashEqual'] and proof['orderedPioEvents']==16475 and proof['closed']=={'native':True,'provider':True} and proof['allChildrenExitZero'],'complete actual terminal parity and closure')
 return c,p

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def pending_guard():
 c=json.loads((HERE/'hosted-contract.json').read_bytes())
 return validate_authority(c)
def download_descriptor(d):
 require(type(d) is dict and set(d)=={'runId','headSha','artifactId','zipBytes','zipSha256'},'exact genuine qualification artifact descriptor')
 return {'runId':d['runId'],'head':d['headSha'],'artifactId':d['artifactId'],'zipBytes':d['zipBytes'],'zipSha256':d['zipSha256']}
