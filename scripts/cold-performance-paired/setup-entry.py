"""Reviewed qualifier setup reused in a separate process; never its arm loop."""
import sys
sys.dont_write_bytecode=True
import json,hashlib,os,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
WORKSPACE=Path('/home/runner/work/bw-board/bw-board')
def require(ok,msg):
    if not ok:raise ValueError(msg)
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def pending_guard():
    c=json.loads((HERE/'hosted-contract.json').read_bytes())
    require(c['status']=='ROOT_REVIEWED_ACTUAL_THREE_ARM_AUDIT_READY','PENDING actual semantic audit: no setup/download/spawn')
    a=c['qualificationAudit'];require(type(a['file']) is str and Path(a['file']).name==a['file'] and len(a['sha256'])==64,'fixed source-owned actual audit')
    p=HERE/a['file'];require(p.is_file() and not p.is_symlink() and digest(p)==a['sha256'],'exact immutable semantic audit')
    audit=json.loads(p.read_bytes());require(audit['schema']=='bw.cold-performance.arm-qualification.v1' and audit['status']=='PASS','independent actual three-arm audit')
    require(audit['targetN']==c['targetN'] and audit['targetQ']==c['targetQ'] and set(audit['qualifiedArms'])=={'plain-JS','native-oneQ','native-batched'},'actual three-arm extent')
    require(audit['workers']=={k:{'revision':v['revision'],'sourceSha256':v['sourceSha256']} for k,v in c['workers'].items()} and audit['captureSha256']==c['captureSha256'],'same frozen workers/capture')
    require(audit['officialArtifact']==c['qualificationArtifact'],'exact official semantic artifact provenance')
    return c,p

def main(out,node):
    c,audit_path=pending_guard() # FIRST, before metadata subprocesses or network.
    root=Path(c['qualifierRoot']);require(root==WORKSPACE/'runtime','fixed separate qualifier role')
    require(subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==c['qualifierRevision'],'exact held qualifier HEAD')
    require(not subprocess.check_output(['git','-C',str(root),'status','--porcelain']),'clean held qualifier')
    for name,h in c['qualifierFiles'].items():
        p=root/name;require(p.is_file() and not p.is_symlink() and digest(p)==h and hashlib.sha256(subprocess.check_output(['git','-C',str(root),'show',c['qualifierRevision']+':'+name])).hexdigest()==h,'exact held qualifier source '+name)
    sys.path.insert(0,str(root/'scripts/cold-three-arm-qualification'))
    import qualify as q
    contract=q.validate_contract(q.read_json(q.HERE/'contract.json'));q.validate_source_packets(contract)
    require(contract['compiledRevision']==c['compiledRevision'] and contract['driver']['revision']==c['driverRevision'],'held setup exact source roles')
    require({k:{'revision':v['revision'],'sourceSha256':v['sourceSha256'],'count':len(v['files'])} for k,v in contract['workers'].items()}==c['workers'],'complete worker closure authority')
    out=Path(out);node=Path(node);require(out==Path('/home/runner/work/_temp/cold-paired-performance/setup'),'fixed setup role');require(out.is_absolute() and out.resolve()==out and not os.path.lexists(out),'exclusive setup output');out.mkdir()
    report={'status':'FAIL','scope':'Setup only; no semantic arms or paired children'};before=None;inputs=None;primary=None
    try:
        before={'tooling':q.tooling_identity(),'node':q.fingerprint(node)};q.write(out/'source-before.json',before)
        setup=q.setup(contract,out,node,report)
        # Genuine existing semantic result is retained, never re-executed.
        q.download(c['qualificationArtifact'],out/'qualification-artifact')
        snapshot=q.immutable_snapshot(contract,setup,node,out);q.write(out/'setup-authentication.json',snapshot)
        binding=q.read_json(HERE/'binding.json')
        for kind,w in setup['workers'].items():w['root']=str(q.ROLES[kind])
        require(binding['workers']==setup['workers'] and binding['compiledFiles']==setup['compiledFiles'],'fixed paired source worker/compiled maps')
        setup['node']['version']='v22.23.3';binding.update(status='ROOT_REVIEWED_READY_FOR_SEPARATELY_GRANTED_PAIRS',capture=setup['capture'],independentAudit=setup['independentAudit'],armQualificationAudit={'path':str(audit_path),'sha256':c['qualificationAudit']['sha256']},node=setup['node'],nativeInput=setup['nativeInput'],compiledFiles=setup['compiledFiles'],workers=setup['workers'])
        for kind,w in binding['workers'].items():w['root']=str(q.ROLES[kind])
        pins=dict(snapshot['artifactPins']);pins[str(audit_path)]=q.fingerprint(audit_path)
        for p in (out/'qualification-artifact').rglob('*'):
            if p.is_file():pins[str(p)]=q.fingerprint(p)
        for name in c['qualifierFiles']:pins[str(root/name)]=q.fingerprint(root/name)
        pins[str(HERE/'hosted-contract.json')]=q.fingerprint(HERE/'hosted-contract.json');binding['pinnedFiles']=pins
        q.write(out/'derived-paired-binding.json',binding);report['bindingSha256']=digest(out/'derived-paired-binding.json');report['status']='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED'
    except BaseException as error:primary=error;report['error']=repr(error);raise
    finally:
        final_error=None
        try:
            after={'tooling':q.tooling_identity(),'node':q.fingerprint(node)};q.write(out/'source-after.json',after);require(after==before,'held source/Node unchanged')
            if 'sourceBeforeArtifactRestore' in report:require(q.source_context(contract,node)==report['sourceBeforeArtifactRestore'],'all source roles unchanged after setup/failure')
            if 'immutableInputsBeforeRestore' in report:
                after_inputs=q.restore_input_snapshot(out);q.write(out/'immutable-inputs-after.json',after_inputs);require(after_inputs==report['immutableInputsBeforeRestore'],'original download/binding inputs unchanged')
            if report['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED':require(q.immutable_snapshot(contract,setup,node,out)==snapshot,'restored original records unchanged')
        except BaseException as error:final_error=error;report['finalizationError']=repr(error);report['status']='FAIL'
        q.write(out/'partial-restored-inventory.json',{str(root):{str(p.relative_to(root)):q.fingerprint(p) for p in root.rglob('*') if p.is_file() and '.git' not in p.relative_to(root).parts} for root in (q.R,q.T) if root.exists()});q.write(out/'setup-result.json',report)
        if final_error is not None and primary is None:raise final_error
if __name__=='__main__':
    require(len(sys.argv)==3,'fixed setup output and authenticated Node path');main(sys.argv[1],sys.argv[2])
