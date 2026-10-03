"""Closed source/artifact admission only; no worker or native imports."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,subprocess
from pathlib import Path
from policy import require,hexpin,identity_sha
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
ORDER=['plain-JS','native-oneQ','native-batched']
COMPILED='7632e6a0995ceaab88bc8cede91506a5330d2e1c'
WORKSPACE=Path('/home/runner/work/bw-board/bw-board')
ROLES={'compiled':WORKSPACE/'publication','driver':WORKSPACE/'driver','native':WORKSPACE/'native-worker','plainJs':WORKSPACE/'plain-worker'}
U=Path('/home/runner/work/_temp/cold-bios-build-pristine')
T=Path('/home/runner/work/_temp/cold-bios-build-prepared')
R=Path('/home/runner/work/_temp/cold-bios-build-evidence')
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
def fingerprint(path,max_bytes=256<<20):
    path=Path(path);require(path.is_absolute() and path.resolve()==path,'canonical ordinary path')
    for part in [path,*path.parents]:require(not part.is_symlink(),'no source/artifact symlink')
    st=path.stat();require(path.is_file() and st.st_size<=max_bytes,'bounded ordinary file')
    h=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(65536):h.update(chunk)
    require(path.stat().st_size==st.st_size,'stable file size')
    return {'bytes':st.st_size,'sha256':h.hexdigest()}
def read_json(path,max_bytes=8<<20):
    fingerprint(path,max_bytes);return json.loads(Path(path).read_bytes())
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],timeout=15)
def source_identity(root,revision,files):
    require(git(root,'rev-parse','HEAD').decode().strip()==revision and not git(root,'status','--porcelain'),'exact clean source revision')
    current={}
    for p,expected in files.items():
        require(not Path(p).is_absolute() and '..' not in Path(p).parts,'relative source path')
        actual=fingerprint(root/p);require(actual==expected,'current source '+p)
        raw=git(root,'show',revision+':'+p);require(len(raw)==actual['bytes'] and hashlib.sha256(raw).hexdigest()==actual['sha256'],'Git source '+p);current[p]=actual['sha256']
    return {'revision':revision,'hashes':dict(sorted(current.items()))}
def validate_contract(c):
    require(c['status']=='ROOT_REVIEWED_THREE_ARM_SOURCE_READY','pending qualification source refuses before setup/spawn')
    require(c['schema']=='bw.cold-three-arm.source-contract.v1' and c['order']==ORDER and c['guestEnabledByDefault'] is False,'three semantic children only')
    require(c['compiledRevision']==COMPILED and len(c['compiledFiles'])==125,'fixed compiled125')
    require(c['driver']['revision']=='11c0bdcade020117fc682e97db284c6ff8797842' and len(c['driver']['files'])==54,'fixed qualified diagnostic source')
    require(c['targetN']==316562 and c['targetQ']==316562,'target from genuine eighth capture, independent N/Q fields')
    require(c['nodeVersion']=='v22.23.3' and c['nodeSha256']==NODE_SHA,'exact Node')
    require(c['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10},'fixed fresh-child bounds')
    require(c['buildArtifact']=={'artifactId':11269563080,'runId':37111139585,'head':COMPILED,'zipBytes':7452841,'zipSha256':'98063e7c7a429408d02096b0d9ac42be57114ec16d940d2d19d05b8692af3156'},'genuine original build ZIP')
    a=c['captureArtifact'];require(a['artifactId']==11272405254 and a['runId']==37116448106 and a['head']=='41e9c7a748e8cbdb5e1c019a91a2f05772dad49f','genuine eighth artifact role')
    require(a['zipBytes']==10438346 and a['zipSha256']=='702c9eafeb7dbfd95d6d49b0df9b1d293491d8276d8a8857a543a80ce8abb1f2','genuine eighth ZIP')
    require(a['member']=='_temp/cold-native-diagnostic/guest/capture.json' and a['captureBytes']==3852756 and a['captureSha256']=='b4dd71749cb8c51db0ae4981bdd87e9485b8f658208b6d7d2a53f1f19fa41cbf','immutable successful capture')
    require(c['independentAudit']=={'file':'independent-eighth-attempt-audit.json','sha256':'a1b93101bd0584837d495ca3083c176c76610be31909df44035d9be0050941b2','bytes':1020},'genuine independent actual audit')
    for kind,count,revision in [('plainJs',49,'0f1ec8cc73b7dd4f39250be2fe8be5cb39352f83'),('native',55,'8ed0366af9bf92823561d5130d0ad6274020c6da')]:
        w=c['workers'][kind];require(w['revision']==revision and len(w['files'])==count and hexpin(w['sourceSha256'],64),'fixed source-qualified worker')
        hashes={p:r['sha256'] for p,r in w['files'].items()};require(identity_sha(revision,hashes)==w['sourceSha256'],'complete canonical worker closure')
    return c
def validate_source_packets(c):
    # Both source-control packets are required BEFORE setup, download or worker.
    for kind,controls in [('plainJs',5),('native',8)]:
        w=c['workers'][kind];folder=HERE/'source-qualifications'/kind;s=w['sourceQualification'];require(s['controls']==controls,'exact source controls')
        require(set(s['records'])=={'before.json','after.json','invocation.json','exit.json','stdout','stderr','independent-source-audit.json'},'complete raw source-control packet')
        for p,expected in s['records'].items():require(fingerprint(folder/p)==expected,'source-control record '+p)
        before=read_json(folder/'before.json');after=read_json(folder/'after.json');require(before==after,'source-control before-after equal')
        e=read_json(folder/'exit.json');require(e.get('exitCode',e.get('returncode'))==0 and not e['timedOut'],'source controls passed')
        audit=read_json(folder/'independent-source-audit.json');require(audit['head']==w['revision'] and audit['sourceFiles']==len(w['files']) and audit['controls']==controls and audit['status'].startswith('PASS_SOURCE_ONLY_'),'independently reviewed exact source packet')
        stdout=(folder/'stdout').read_text();require('# pass '+str(controls) in stdout and '# fail 0' in stdout and '# skipped 0' in stdout,'actual pure controls counts')
        if kind=='plainJs':require(before['source']==before['git']=={p:r['sha256'] for p,r in w['files'].items()} and before['head']==w['revision'],'plain worker raw source pins')
        else:
            for p,r in w['files'].items():require(before[str(Path('/tmp/bw-cold-native-worker-eighth-20261003')/p)]==r['sha256'],'native worker raw source pins')
    return True
def validate_worker_locks(c):
    for kind,w in c['workers'].items():
        b=read_json(ROLES[kind]/w['binding']);require(b['status']=='INDEPENDENTLY_AUDITED_CAPTURE_READY' and b['independentAuditApproved'] is True,'worker source-owned READY prerequisite')
        require(b['compiledRevision']==COMPILED and b['driverRevision']==c['driver']['revision'] and b['driverSourceSha256']==c['driver']['sourceSha256'],'same original compiled and actual diagnostic')
        require(b['captureSha256']==c['captureArtifact']['captureSha256'] and b['independentAuditSha256']==c['independentAudit']['sha256'] and b['targetQ']==c['targetQ'],'same fixed successful capture/audit/target')
