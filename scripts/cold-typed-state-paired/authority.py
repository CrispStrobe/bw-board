"""Source-owned semantic authority; PENDING refuses before any effect."""
import json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
QUALIFIER='fd15172085d59daed331d40a2dfec5d6666b3d99'
NATIVE='162a9b2a72d780cd7ea4491c91cf7260b15b0a8b'
PLAIN='0f1ec8cc73b7dd4f39250be2fe8be5cb39352f83'
def require(ok,msg):
 if not ok:raise ValueError(msg)
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def validate_authority(c):
 require(c['status']=='ROOT_REVIEWED_ACTUAL_TYPED_QUALIFICATION_READY','PENDING typed qualification: no checkout/download/spawn')
 require(c['schema']=='bw.cold-typed-state.paired-source.v1' and c['qualifierRevision']==QUALIFIER,'held single-arm setup source')
 require(c['compiledRevision']=='f4a2f2ceae48dde3e4585d84e6c759e13ebadc53' and c['workers']['native']['revision']==NATIVE and c['workers']['plainJs']['revision']==PLAIN,'fixed distinct compiled/worker identities')
 require(c['targetN']==c['targetQ']==316562,'actual held target')
 a=c['typedQualificationAudit'];require(type(a) is dict and set(a)=={'file','sha256'} and Path(a['file']).name==a['file'],'source-owned typed audit, no caller authority')
 p=HERE/a['file'];require(p.is_file() and not p.is_symlink() and digest(p)==a['sha256'],'exact actual typed independent audit')
 typed=json.loads(p.read_bytes());require(typed['schema']=='bw.cold-typed-state.qualification-audit.v1' and typed['status']=='PASS','actual typed terminal semantic PASS')
 require(typed['targetN']==c['targetN'] and typed['targetQ']==c['targetQ'] and typed['worker']=={'revision':NATIVE,'sourceSha256':c['workers']['native']['sourceSha256']},'same typed worker/extent')
 require(typed['compiledRevision']==c['compiledRevision'] and typed['addonSha256']==c['addonSha256'] and typed['nodeSha256']==c['nodeSha256'] and typed['captureSha256']==c['captureSha256'],'same typed source/addon/Node/capture')
 require(typed['stateExportProfile']=='bw.cold-native.copied-u32-state.v1' and typed['officialArtifact']==c['typedQualificationArtifact'],'actual profile/artifact authority')
 artifact=c['typedQualificationArtifact'];require(type(artifact['zipBytes']) is int and 0<artifact['zipBytes']<=32<<20,'semantic artifact fits setup cap')
 old=c['plainQualificationAudit'];pp=HERE/old['file'];require(pp.is_file() and not pp.is_symlink() and digest(pp)==old['sha256'],'held original qualification authority')
 plain=json.loads(pp.read_bytes());require(plain['schema']=='bw.cold-performance.arm-qualification.v1' and plain['status']=='PASS' and 'plain-JS' in plain['qualifiedArms'],'genuine plain semantic PASS')
 require(plain['workers']['plainJs']=={'revision':PLAIN,'sourceSha256':c['workers']['plainJs']['sourceSha256']} and plain['captureSha256']==c['captureSha256'] and plain['nodeSha256']==c['nodeSha256'] and plain['officialArtifact']==old['officialArtifact'],'held plain worker/capture/Node/provenance')
 return c,p
def pending_guard():return validate_authority(json.loads((HERE/'hosted-contract.json').read_bytes()))
