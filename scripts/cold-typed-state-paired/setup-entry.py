"""Reuse frozen typed single-arm setup only. Never its guest main()."""
import sys
sys.dont_write_bytecode=True
import json,os,hashlib,subprocess
from pathlib import Path
from authority import pending_guard,require,HERE,digest
WORKSPACE=Path('/home/runner/work/bw-board/bw-board')
def main(out,node):
 c,audit_path=pending_guard() # FIRST before even metadata subprocesses.
 root=Path(c['qualifierRoot']);require(root==WORKSPACE/'qualifier','separate frozen qualifier role')
 require(subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==c['qualifierRevision'],'held qualifier HEAD')
 require(not subprocess.check_output(['git','-C',str(root),'status','--porcelain']),'clean qualifier')
 for p,h in c['qualifierFiles'].items():require(digest(root/p)==h and hashlib.sha256(subprocess.check_output(['git','-C',str(root),'show',c['qualifierRevision']+':'+p])).hexdigest()==h,'qualifier current/Git '+p)
 sys.path.insert(0,str(root/'scripts/cold-typed-state-qualification'))
 import qualify as q
 qc=q.contract(q.read_json(q.HERE/'contract.json'));require(qc['worker']['revision']==c['workers']['native']['revision'] and qc['compiledRevision']==c['compiledRevision'],'fixed setup authority')
 plain=c['workers']['plainJs'];P=Path(plain['root']);require(P==WORKSPACE/'plain-worker','fixed plain role')
 plainfiles={p:{'sha256':h,'bytes':(P/p).stat().st_size} for p,h in plain['files'].items()}
 plainbefore=q.identity(P,plain['revision'],plainfiles)
 out=Path(out);node=Path(node);require(out==Path('/home/runner/work/_temp/cold-typed-paired/setup') and out.resolve()==out and not os.path.lexists(out),'exclusive setup')
 out.mkdir();report={'status':'FAIL','scope':'Restoration only; no semantic child/pair/rebuild'};before=None;initial=None;qualificationpins=None;primary=None;finalerror=None
 try:
  before={'tooling':q.tooling(),'plain':plainbefore,'node':q.fingerprint(node)};q.write(out/'before.json',before)
  setup,data=q.setup(qc,node,out,report);q.download(c['typedQualificationArtifact'],out/'typed-qualification-artifact');qualificationpins={str(p):q.fingerprint(p) for p in (out/'typed-qualification-artifact').rglob('*') if p.is_file()};initial=q.restored(qc,node,out);q.write(out/'restored-before.json',initial)
  binding=q.read_json(HERE/'binding.json');require(binding['workers']==c['workers'],'fixed paired worker maps')
  binding.update(status='ROOT_REVIEWED_READY_FOR_SEPARATELY_GRANTED_PAIRS',capture={'path':data['capture'],'sha256':qc['captureArtifact']['captureSha256']},independentAudit={'path':data['independentAudit'],'sha256':qc['independentAudit']['sha256']},armQualificationAudit={'path':str(audit_path),'sha256':c['typedQualificationAudit']['sha256']},node={'path':str(node),'version':'v22.23.3','sha256':c['nodeSha256']},nativeInput=setup['nativeInput'])
  pins=dict(initial['records']);pins.update(q.original_inputs(out))
  for parent in (out/'typed-qualification-artifact',HERE):
   for p in parent.rglob('*'):
    if p.is_file():pins[str(p)]=q.fingerprint(p)
  for p in c['qualifierFiles']:pins[str(root/p)]=q.fingerprint(root/p)
  binding['pinnedFiles']=pins;q.write(out/'derived-paired-binding.json',binding);report['bindingSha256']=digest(out/'derived-paired-binding.json');report['status']='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED'
 except BaseException as e:primary=e;report['error']=repr(e);raise
 finally:
  try:
   if before is not None:after={'tooling':q.tooling(),'plain':q.identity(P,plain['revision'],plainfiles),'node':q.fingerprint(node)};q.write(out/'after.json',after);require(after==before,'setup source/plain/Node final proof')
   if 'sourceBeforeSetup' in report:require(q.sources(qc,node)==report['sourceBeforeSetup'],'all sources final proof')
   if 'inputsBeforeRestore' in report:require(q.original_inputs(out)==report['inputsBeforeRestore'],'original download/input final proof')
   if qualificationpins is not None:require({p:q.fingerprint(p) for p in qualificationpins}==qualificationpins,'qualification original input final guard')
   if initial is not None:require(q.restored(qc,node,out)==initial,'restored final proof')
  except BaseException as e:finalerror=e;report['status']='FAIL';report['finalizationError']=repr(e)
  q.write(out/'setup-result.json',report)
  if finalerror is not None and primary is None:raise finalerror
if __name__=='__main__':
 require(len(sys.argv)==3,'closed setup args');main(sys.argv[1],sys.argv[2])
