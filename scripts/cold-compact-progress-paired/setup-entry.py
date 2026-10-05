"""Reuse frozen fusion single-arm setup only. Never its guest main()."""
import sys
sys.dont_write_bytecode=True
import json,os,hashlib,subprocess,zipfile,importlib.util
from pathlib import Path
from authority import pending_guard,require,HERE,digest,download_descriptor
WORKSPACE=Path('/home/runner/work/bw-board/bw-board')
def final_guards(report,guards):
 first=None
 for name,read,expected in guards:
  try:report[name]=read();require(report[name]==expected,name+' final proof')
  except BaseException as e:
   report.setdefault('finalizationErrors',{})[name]=repr(e);report['status']='FAIL'
   if first is None:first=e
 return first
def assemble_binding(c,qc,setup,data,node,audit_path,pins):
 # Fixed owned template and pure validator; unique module name avoids the held
 # qualifier's already-loaded local policy module. No caller template/import.
 binding=json.loads((HERE/'binding.json').read_bytes());require(binding['workers']==c['workers'],'fixed paired worker maps')
 require(binding['targetN']==qc['targetN']==c['targetN'] and binding['targetQ']==qc['targetQ']==c['targetQ'],'fixed authenticated qualifier/capture target ledger')
 binding.update(status='ROOT_REVIEWED_READY_FOR_SEPARATELY_GRANTED_PAIRS',capture={'path':data['capture'],'sha256':qc['captureArtifact']['captureSha256']},independentAudit={'path':data['independentAudit'],'sha256':qc['independentAudit']['sha256']},armQualificationAudit={'path':str(audit_path),'sha256':c['compactQualificationAudit']['sha256']},node={'path':str(node),'version':'v22.23.3','sha256':c['nodeSha256']},nativeInput=setup['nativeInput'],pinnedFiles=pins)
 spec=importlib.util.spec_from_file_location('owned_compact_paired_binding_validator',Path(__file__).resolve().parent/'policy.py');validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator)
 require(Path(validator.__file__).resolve()==(Path(__file__).resolve().parent/'policy.py').resolve(),'fixed pure binding validator file')
 validator.validate_ready_binding(binding) # All fields before any success write.
 return binding
def main(out,node):
 c,audit_path=pending_guard() # FIRST before even metadata subprocesses.
 root=Path(c['qualifierRoot']);require(root==WORKSPACE/'qualifier','separate frozen qualifier role')
 require(subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==c['qualifierRevision'],'held qualifier HEAD')
 require(not subprocess.check_output(['git','-C',str(root),'status','--porcelain']),'clean qualifier')
 for p,h in c['qualifierFiles'].items():require(digest(root/p)==h and hashlib.sha256(subprocess.check_output(['git','-C',str(root),'show',c['qualifierRevision']+':'+p])).hexdigest()==h,'qualifier current/Git '+p)
 sys.path.insert(0,str(root/'scripts/cold-compact-progress-qualification'))
 import qualify as q
 qc=q.contract(q.read_json(q.HERE/'contract.json'));require(qc['worker']['revision']==c['workers']['native']['revision'] and qc['compiledRevision']==c['compiledRevision'],'fixed setup authority')
 plain=c['workers']['plainJs'];P=Path(plain['root']);require(P==WORKSPACE/'plain-worker','fixed plain role')
 plainfiles={p:{'sha256':h,'bytes':(P/p).stat().st_size} for p,h in plain['files'].items()}
 plainbefore=q.identity(P,plain['revision'],plainfiles)
 out=Path(out);node=Path(node);require(out==Path('/home/runner/work/_temp/cold-compact-progress-paired/setup') and out.resolve()==out and not os.path.lexists(out),'exclusive setup')
 out.mkdir();report={'status':'FAIL','scope':'Restoration only; no semantic child/pair/rebuild'};before=None;initial=None;qualificationpins=None;primary=None;finalerror=None
 try:
  before={'tooling':q.tooling(),'plain':plainbefore,'node':q.fingerprint(node)};q.write(out/'before.json',before)
  setup,data=q.setup(qc,node,out,report);q.download(download_descriptor(c['compactQualificationArtifact']),out/'compact-qualification-artifact');qualificationpins={str(p):q.fingerprint(p) for p in (out/'compact-qualification-artifact').rglob('*') if p.is_file()};
  pin=c['compactQualificationReceipt']
  with zipfile.ZipFile(out/'compact-qualification-artifact'/'official-artifact.zip') as archive:
   info=archive.getinfo(pin['member']);require(info.file_size==pin['bytes'] and info.file_size<=8<<20,'actual qualification receipt size');require(hashlib.sha256(archive.read(info)).hexdigest()==pin['sha256'],'actual qualification receipt exact bytes')
  initial=q.restored(qc,node,out);q.write(out/'restored-before.json',initial)
  pins=dict(initial['records']);pins.update(q.original_inputs(out))
  for parent in (out/'compact-qualification-artifact',HERE):
   for p in parent.rglob('*'):
    if p.is_file():pins[str(p)]=q.fingerprint(p)
  for p in c['qualifierFiles']:pins[str(root/p)]=q.fingerprint(root/p)
  binding=assemble_binding(c,qc,setup,data,node,audit_path,pins);q.write(out/'derived-paired-binding.json',binding);report['bindingSha256']=digest(out/'derived-paired-binding.json');report['status']='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED'
 except BaseException as e:primary=e;report['error']=repr(e);raise
 finally:
  guards=[]
  if before is not None:guards.append(('sourceAfter',lambda:{'tooling':q.tooling(),'plain':q.identity(P,plain['revision'],plainfiles),'node':q.fingerprint(node)},before))
  if 'sourceBeforeSetup' in report:guards.append(('roleSourcesAfter',lambda:q.sources(qc,node),report['sourceBeforeSetup']))
  if 'inputsBeforeRestore' in report:guards.append(('originalInputsAfter',lambda:q.original_inputs(out),report['inputsBeforeRestore']))
  if qualificationpins is not None:guards.append(('qualificationInputsAfter',lambda:{p:q.fingerprint(p) for p in qualificationpins},qualificationpins))
  if initial is not None:guards.append(('restoredAfter',lambda:q.restored(qc,node,out),initial))
  finalerror=final_guards(report,guards)
  q.write(out/'setup-result.json',report)
  if finalerror is not None and primary is None:raise finalerror
if __name__=='__main__':
 require(len(sys.argv)==3,'closed setup args');main(sys.argv[1],sys.argv[2])
