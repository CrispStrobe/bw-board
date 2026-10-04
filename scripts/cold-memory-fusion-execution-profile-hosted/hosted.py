"""One externally bounded diagnostic child, no probes/pairs/rebuild/retries."""
import sys
sys.dont_write_bytecode=True
import os,signal,platform
from pathlib import Path
from policy import contract,require
from admission import HERE,ROOT,WORKSPACE,N,read,fingerprint,sources,own_source
from lifecycle import bounded_child,write,host_context,HOOKS,interrupted
SCOPE='DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION'
def finish(out,report,primary,source_before,c,node,binding_pin,input_pin):
 final=None
 try:
  report['sourceAfter']=sources(c,node);require(report['sourceAfter']==source_before,'all source/tool roles unchanged')
  if (out/'inputs-before-restore.json').is_file():
   expected=read(out/'inputs-before-restore.json');report['originalInputsAfter']={p:fingerprint(Path(p)) for p in expected};require(report['originalInputsAfter']==expected,'original immutable setup input final guard')
  report['restoredInventoryAfter']={str(p):fingerprint(p) for root in (Path('/home/runner/work/_temp/cold-memory-fusion-build-prepared'),Path('/home/runner/work/_temp/cold-memory-fusion-build-evidence')) if root.exists() for p in root.rglob('*') if p.is_file()}
  if binding_pin is not None:report['bindingAfter']=fingerprint(out/'derived-binding.json');require(report['bindingAfter']==binding_pin,'derived binding final guard')
  if input_pin is not None:report['inputAfter']=fingerprint(out/'input.json');require(report['inputAfter']==input_pin,'input final guard')
 except BaseException as e:final=e;report['finalizationError']=repr(e);report['status']='FAIL'
 try:write(out/'host-after.json',host_context())
 except BaseException as e:
  report['hostAfterUnavailable']=repr(e);report['status']='FAIL'
  if final is None:final=e
 write(out/'result.json',report)
 if primary is None and final is not None:raise final
 return report
def main(mode):
 require(mode in ('disabled','enabled'),'explicit mode')
 if mode=='disabled':print('Disabled; no setup/download/Inspector/addon/guest');return
 c=contract(read(HERE/'contract.json'))
 require(os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and ROOT==WORKSPACE/'runtime','manual authenticated runtime role')
 for k in HOOKS:require(not os.environ.get(k),'blank hooks')
 node=Path(os.environ['BW_COLD_NODE']);require(fingerprint(node)['sha256']==c['nodeSha256'],'exact Node22.23.3');require(platform.machine()=='x86_64' and platform.libc_ver()[1]=='2.39','held loader ABI')
 out=Path(os.environ['BW_FUSION_PROFILE_OUTPUT']);require(out.is_absolute() and out.resolve()==out and out.parent.is_dir() and not os.path.lexists(out),'exclusive output')
 for role in (ROOT,WORKSPACE/'publication',WORKSPACE/'driver',WORKSPACE/'fusion-worker',WORKSPACE/'qualification-source',N):require(role!=out and role not in out.parents and out not in role.parents,'disjoint source/output')
 source_before=sources(c,node);require(source_before['tooling']['revision']==os.environ['GITHUB_SHA'],'dispatch current/Git head');out.mkdir();report={'schema':'bw.cold-memory-fusion.execution-profile-hosted.result.v1','status':'FAIL','scope':SCOPE,'sourceBefore':source_before};primary=None;binding_pin=None;input_pin=None;setup_complete=False
 try:
  write(out/'host-before.json',host_context());write(out/'source-before.json',source_before)
  setup=bounded_child([sys.executable,'-B',str(HERE/'setup-entry.py'),'setup',str(node),str(out)],ROOT,out/'setup-child',c['setupBounds'],artifact_setup=True);report['setupChild']=setup
  require(setup['exitCode']==0 and not setup['timedOut'] and not setup['interrupted'],'first setup failure; no retry');setup_complete=True
  s=read(out/'setup-record.json');require(s['status']=='SETUP_STATIC_ADMISSION_COMPLETE_NO_GUEST','authenticated setup result');binding_pin=fingerprint(out/'derived-binding.json');input_pin=fingerprint(out/'input.json');require(binding_pin==s['bindingPin'] and input_pin==s['inputPin'],'setup-derived exact pins');report['bindingBefore']=binding_pin;report['inputBefore']=input_pin
  child=bounded_child([str(node),'--max-old-space-size=128',str(N/c['diagnosticWorker']['entry']),str(out/'input.json')],N,out/'guest',c['bounds']);report['child']=child
  # Validation executes even after a guest failure, retaining attainable restored/source proof.
  validation=bounded_child([sys.executable,'-B',str(HERE/'setup-entry.py'),'validate',str(node),str(out)],ROOT,out/'validation-child',c['setupBounds']);report['validationChild']=validation
  if (out/'validation-record.json').is_file():report['validation']=read(out/'validation-record.json')
  require(child['exitCode']==0 and not child['timedOut'] and not child['interrupted'],'first diagnostic child failure; no retry')
  require(validation['exitCode']==0 and not validation['timedOut'] and report['validation']['status']=='DIAGNOSTIC_PARITY_AND_RAW_PROFILE_CAPTURE_COMPLETE','terminal/source/profile validation failure')
  report['status']='DIAGNOSTIC_PARITY_AND_PROFILE_CAPTURE_REQUIRES_INDEPENDENT_AUDIT'
 except BaseException as e:primary=e;report['error']=repr(e);raise
 finally:
  if not setup_complete and (out/'setup-record.json').is_file():
   try:report['partialSetup']=read(out/'setup-record.json')
   except BaseException as e:report['partialSetupUnavailable']=repr(e);report['status']='FAIL'
  finish(out,report,primary,source_before,c,node,binding_pin,input_pin)
if __name__=='__main__':
 for s in (signal.SIGINT,signal.SIGTERM):signal.signal(s,interrupted)
 require(len(sys.argv)==2,'one explicit mode');main(sys.argv[1])
