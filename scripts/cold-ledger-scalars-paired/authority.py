"""Source-owned semantic authority; PENDING refuses before any effect."""
import json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
QUALIFIER='c26ad6701c9fa13f983dd84c2764c2f073371f57'
NATIVE='06581f3831aa765933b1d160a41ab37b1b652913'
PLAIN='0f1ec8cc73b7dd4f39250be2fe8be5cb39352f83'
def require(ok,msg):
 if not ok:raise ValueError(msg)
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def validate_authority(c):
 require(c['status']=='ROOT_REVIEWED_ACTUAL_LEDGER_SCALARS_QUALIFICATION_READY','PENDING fusion qualification: no checkout/download/spawn')
 require(c['schema']=='bw.cold-ledger-scalars.paired-source.v1' and c['qualifierRevision']==QUALIFIER,'held single-arm setup source')
 require(c['compiledRevision']=='85fc1599af0ee71e32208da9d36caac86daa3b8c' and c['workers']['native']['revision']==NATIVE and c['workers']['plainJs']['revision']==PLAIN,'fixed distinct compiled/worker identities')
 require(c['targetN']==c['targetQ']==316562,'actual held target')
 a=c['fusionQualificationAudit'];require(type(a) is dict and set(a)=={'file','sha256'} and Path(a['file']).name==a['file'],'source-owned fusion audit, no caller authority')
 p=HERE/a['file'];require(p.is_file() and not p.is_symlink() and digest(p)==a['sha256'],'exact actual fusion independent audit')
 typed=json.loads(p.read_bytes());require(typed['schema']=='bw.cold-ledger-scalars.qualification-audit.v1' and typed['status']=='PASS','actual fusion terminal semantic PASS')
 require(typed['targetN']==c['targetN'] and typed['targetQ']==c['targetQ'] and typed['worker']=={'revision':NATIVE,'sourceSha256':c['workers']['native']['sourceSha256']},'same fusion worker/extent')
 require(typed['compiledRevision']==c['compiledRevision'] and typed['addonSha256']==c['addonSha256'] and typed['nodeSha256']==c['nodeSha256'] and typed['captureSha256']==c['captureSha256'],'same fusion source/addon/Node/capture')
 require(typed['stateExportProfile']=='bw.cold-native.copied-u32-state.v1' and typed['memoryFusionProfile']=='bw.cold-native.memory-clock-fusion.v1' and typed['scalarProviderProfile']==c['scalarProviderProfile']=='bw.cold-native.memory-clock-fusion.ledger-scalars.v1' and typed['officialArtifact']==c['fusionQualificationArtifact'],'actual profile/artifact authority')
 artifact=c['fusionQualificationArtifact'];require(artifact['headSha']==QUALIFIER,'actual qualification source pin');download_descriptor(artifact);require(type(artifact['zipBytes']) is int and 0<artifact['zipBytes']<=32<<20,'semantic artifact fits setup cap')
 receipt=c['fusionQualificationReceipt'];require(type(receipt) is dict and set(receipt)=={'member','bytes','sha256'} and receipt['member']=='cold-ledger-scalars-qualification/guest/receipt/receipt.json' and type(receipt['bytes']) is int and 0<receipt['bytes']<=8<<20 and type(receipt['sha256']) is str and len(receipt['sha256'])==64 and all(x in '0123456789abcdef' for x in receipt['sha256']),'fixed retained actual qualification receipt');old=c['plainQualificationAudit'];pp=HERE/old['file'];require(pp.is_file() and not pp.is_symlink() and digest(pp)==old['sha256'],'held original qualification authority')
 plain=json.loads(pp.read_bytes());require(plain['schema']=='bw.cold-performance.arm-qualification.v1' and plain['status']=='PASS' and 'plain-JS' in plain['qualifiedArms'],'genuine plain semantic PASS')
 require(plain['workers']['plainJs']=={'revision':PLAIN,'sourceSha256':c['workers']['plainJs']['sourceSha256']} and plain['captureSha256']==c['captureSha256'] and plain['nodeSha256']==c['nodeSha256'] and plain['officialArtifact']==old['officialArtifact'],'held plain worker/capture/Node/provenance')
 return c,p
def download_descriptor(record):
 require(type(record) is dict and set(record)=={'runId','headSha','artifactId','zipBytes','zipSha256'},'closed actual fusion artifact record')
 require(type(record['runId']) is int and record['runId']>0 and type(record['artifactId']) is int and record['artifactId']>0,'official positive IDs')
 require(type(record['zipBytes']) is int and 0<record['zipBytes']<=32<<20,'setup file cap')
 require(type(record['headSha']) is str and len(record['headSha'])==40 and all(x in '0123456789abcdef' for x in record['headSha']),'actual source SHA')
 require(type(record['zipSha256']) is str and len(record['zipSha256'])==64 and all(x in '0123456789abcdef' for x in record['zipSha256']),'actual ZIP SHA')
 return {'runId':record['runId'],'head':record['headSha'],'artifactId':record['artifactId'],'zipBytes':record['zipBytes'],'zipSha256':record['zipSha256']}
def pending_guard():return validate_authority(json.loads((HERE/'hosted-contract.json').read_bytes()))
