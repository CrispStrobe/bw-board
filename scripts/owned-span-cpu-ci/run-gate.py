#!/usr/bin/env python3
"""One fresh 18-child gate after authentic qualification; original native cells never repeated."""
from pathlib import Path
import os,sys,json,hashlib,shutil,subprocess,importlib.util
sys.dont_write_bytecode=True
P=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def execute():
 context=Path(os.environ['BW_SPAN_CPU_CONTEXT']).resolve();root=Path(os.environ['BW_SPAN_CPU_PUBLICATION']).resolve();tool=Path(os.environ['BW_SPAN_CPU_TOOLING']).resolve();# Hardware context is outside the execution CPUwindow; absent quota files
 # remain explicit rather than implying unlimitedCPU.
 hardware={'node':subprocess.check_output(['node','--version'],timeout=10).decode().strip(),'kernel':subprocess.check_output(['uname','-a'],timeout=10).decode().strip(),'lscpu':subprocess.check_output(['lscpu'],timeout=10).decode(),'files':{}}
 for name in ['/proc/loadavg','/proc/pressure/cpu','/proc/pressure/memory','/proc/pressure/io','/sys/fs/cgroup/cpu.max','/sys/fs/cgroup/cpu/cpu.cfs_quota_us','/sys/fs/cgroup/cpu/cpu.cfs_period_us']:
  try:hardware['files'][name]=Path(name).read_text()
  except OSError as e:hardware['files'][name]={'unavailable':type(e).__name__}
 assert hardware['node']=='v22.23.3';(context/'hardware-context.json').write_text(json.dumps(hardware,indent=2)+'\n')
 prerequisite=json.loads((context/'qualification-admitted.json').read_bytes());q=prerequisite['binding'];assert prerequisite['status']=='GENUINE_ROOT_AND_PEER_THREE_CELL_QUALIFICATION_ADMITTED'
 base=Path('/mnt/volume1/tmp-astra/native-owned-span-parity-prepared-20261002');b=json.loads((base/'approved-bindings.json').read_bytes());target=context/'gate';target.mkdir();qual=context/'qualification';artifact=dict(b['artifactHashes'])
 # Preserve originalofficialbuild and genuinequalificationZIP provenance before
 # every nativechild. Historical bulkstreams retained externally, not reuploaded.
 for name in ['qualification.zip','qualification-artifact-metadata.json','qualification-admitted.json','derivation.json','source-preparation.json','materializer.stdout','materializer.stderr','hardware-context.json']:
  artifact[str(context/name)]=sha(context/name)
 for name,record in q['files'].items():artifact[str(qual/name)]=record['sha256']
 for mode in q['modes']:
  proof=qual/(q['modes'][mode]['journal']+'.stream-proof.json');artifact[str(proof)]=sha(proof)
 for name,h in q['externalReviews'].items():artifact[str(P/'qualification-reviews'/name)]=h
 for p in (context/'materialization').rglob('*'):
  if p.is_file()and not p.is_symlink():artifact[str(p)]=sha(p)
 from prepare import authenticate
 ownSource=authenticate(root)
 artifact.update({str(root/name):h for name,h in ownSource['files'].items()})
 artifact[b['node']]=b['nodeSha256'];helper={}
 for n in ['gate.py','plan.json']:
  shutil.copyfile(P/n,target/n);helper[n]=sha(target/n)
 shutil.copyfile(tool/'scripts/owned-span-parity-ci/bounded.py',target/'bounded.py');helper['bounded.py']=sha(target/'bounded.py')
 # CPUgate references the actual downloadedthree-cell namespace, never newlyrunsit.
 parity=qual/q['parityRoot'];reference=Path(b['baselineNativeCapture'])
 for mode in ['smoke-off','fulltrace-on','trace-fast']:
  assert (parity/mode/'parity.json').is_file()
 approval={'baselineSource':{'revision':b['compiledRevision'],'hashes':b['compiledSourceHashes']},'candidateSource':{'revision':b['revision'],'hashes':b['sourceHashes']},'baselineWorktree':b['compiledWorktree'],'candidateWorktree':b['runtimeWorktree'],'parityDirectory':str(parity),'referenceCapture':str(reference),'entries':{'BASE':str(Path(b['compiledWorktree'])/'scripts/run-i80386-native-owned-in8.mjs'),'SPAN':b['driver']},'buildInput':b['buildInput'],'configuration':b['configuration'],'baseline':b['baseline'],'currentCompiledProof':b['expectedProvenance']['compiled']['proof'],'currentCandidateProvenance':b['expectedProvenance'],'artifactHashes':artifact,'helperHashes':helper,'qualificationReviews':{n:{'path':str(P/'qualification-reviews'/n),'sha256':h,'expected':json.loads((P/'qualification-reviews'/n).read_bytes())}for n,h in q['externalReviews'].items()},'rootReview':q['rootAudit'],'peerReview':q['peerAudit'],'coreReview':q['coreAudit'],'node':b['node'],'nodeSha256':b['nodeSha256']}
 approval['artifactHashes'][approval['entries']['BASE']]=sha(approval['entries']['BASE'])
 (target/'approved-bindings.json').write_text(json.dumps(approval,indent=2)+'\n')
 # Reuse auditedouter process-group cleanup and boundedsequentialgatewrapper,
 # excluding inherited native3cell main(). Import launches no code.
 outerPath=tool/'scripts/owned-span-parity-ci/run-cells.py';originalInventory=json.loads((tool/'scripts/owned-span-parity-ci/packet-files.json').read_bytes())['files'];assert sha(outerPath)==originalInventory['scripts/owned-span-parity-ci/run-cells.py']
 sys.path.insert(0,str(tool/'scripts/owned-span-parity-ci'))
 spec=importlib.util.spec_from_file_location('outer',outerPath);outer=importlib.util.module_from_spec(spec);spec.loader.exec_module(outer)
 result=outer.bounded_command([sys.executable,str(target/'gate.py')],context/'gate-parent',2400)
 assert result['status']=='OUTER_COMMAND_EXIT_PASS','Incomplete/failedgate preserved; no retry'
 summary=json.loads((target/'results/summary.json').read_bytes());assert summary['status']in ['ACTUAL_SPAN_PROCESS_CPU_GATE_PASS','ACTUAL_SPAN_PROCESS_CPU_GATE_FAIL_KEEP_FE1']
 print(json.dumps({'status':summary['status'],'summarySha256':sha(target/'results/summary.json'),'scope':'Onefixed18-child CPUgate; negativegate is validcompletedresult, not orchestration failure.'}))
def main():
 from prepare import authenticate
 root=Path(os.environ['BW_SPAN_CPU_PUBLICATION']).resolve();context=Path(os.environ['BW_SPAN_CPU_CONTEXT']).resolve();before=authenticate(root);record={'status':'CPU_GATE_ORCHESTRATION_STARTED','publicationBefore':before}
 try:
  execute();record['status']='CPU_GATE_COMPLETED_RETAIN_ACTUAL_SUMMARY'
 except BaseException as e:record['status']='CPU_GATE_INCOMPLETE_PRESERVED_NO_RETRY';record['error']=type(e).__name__+': '+str(e);raise
 finally:
  try:record['publicationAfter']=authenticate(root);assert record['publicationAfter']==before
  finally:(context/'gate-source-before-after.json').write_text(json.dumps(record,indent=2)+'\n')
if __name__=='__main__':main()
