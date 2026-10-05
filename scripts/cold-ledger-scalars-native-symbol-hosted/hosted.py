"""One owned setup then observer child; no repeats, pairs, rebuild or decoder."""
import sys
sys.dont_write_bytecode=True
import os,signal,json
from pathlib import Path
from policy import contract,require
from admission import HERE,ROOT,WS,OUT,PARENT,read,fingerprint,sources,own_source,git
from lifecycle import bounded_child,write,host_context,HOOKS,interrupted

def finish(report,primary,c,node,before,pins):
 final=None
 def check(name,fn,expected=None):
  nonlocal final
  try:
   report[name]=fn()
   if expected is not None:require(report[name]==expected,name+' unchanged')
  except BaseException as error:
   report.setdefault('finalizationErrors',{})[name]=repr(error);report['status']='FAIL'
   if final is None:final=error
 check('dispatchAfter',own_source,before['dispatch']);check('nodeAfter',lambda:fingerprint(node),before['node'])
 for name,role in c['roles'].items():
  root=Path(role['root']);check('roleHeadAfter:'+name,lambda p=root:git(p,'rev-parse','HEAD').decode().strip(),role['revision']);check('roleCleanAfter:'+name,lambda p=root:git(p,'status','--porcelain').decode(),'')
  for path,h in role['files'].items():check('roleAfter:'+name+'/'+path,lambda p=root/path:fingerprint(p)['sha256'],h)
 for path,value in pins.items():check('inputAfter:'+path,lambda p=path:fingerprint(Path(p)),value)
 # Independently retain each readable original/restored pin even on root failure.
 if (OUT/'setup-record.json').is_file():
  try:
   s=read(OUT/'setup-record.json')
   for path,value in s['pinnedFiles'].items():check('restoredAfter:'+path,lambda p=path:fingerprint(Path(p)),value)
  except BaseException as error:report.setdefault('finalizationErrors',{})['setupRecordRead']=repr(error);report['status']='FAIL';final=final or error
 check('hostAfter',host_context);write(PARENT/'result.json',report)
 if primary is None and final is not None:raise final
 return report
def log_primary_failure(report,error):
 log={'scope':'First observer failure; native/worker extent unknown without retained evidence','primary':repr(error)[:4096],'observerChild':report.get('observerChild')}
 try:
  path=PARENT/'observer-child/stderr'
  if path.is_file():
   with path.open('rb') as stream:log['observerStderrPrefix']=stream.read(4096).decode(errors='replace')
 except BaseException as secondary:log['stderrReadError']=repr(secondary)[:4096]
 print(json.dumps(log),file=sys.stderr,flush=True)

def main(mode):
 require(mode in ('disabled','enabled'),'fixed mode')
 if mode=='disabled':print('Disabled: no setup/download/tool/recorder/addon/guest');return
 c=contract(read(HERE/'contract.json')) # First gate, before output/tools or effects.
 require(ROOT==WS/'runtime' and os.environ['GITHUB_EVENT_NAME']=='workflow_dispatch','manual dispatch runtime')
 require(all(not os.environ.get(h) for h in HOOKS),'blank hooks');node=Path(os.environ['BW_COLD_NODE']);require(fingerprint(node)['sha256']==c['nodeSha256'],'fixed Node bytes')
 before=sources(c,node);require(before['dispatch']['revision']==os.environ['GITHUB_SHA'],'actual dispatch current/Git')
 require(not PARENT.exists() and not OUT.exists(),'exclusive fixed parent/recorder output');PARENT.mkdir();report={'schema':'bw.cold-ledger-scalars.native-symbol.hosted-result.v1','status':'FAIL','scope':c['scope'],'actualDispatchSha':os.environ['GITHUB_SHA'],'diagnosticRoleSha':c['roles']['diagnostic']['revision'],'sourceBefore':before};primary=None;pins={}
 try:
  write(PARENT/'host-before.json',host_context());write(PARENT/'source-before.json',before)
  command=[sys.executable,'-B',str(WS/'symbol-worker/scripts/cold-native-ledger-scalars-symbol-profile/setup.py')]
  setup=bounded_child(command,ROOT,PARENT/'setup-child',c['setupBounds'],artifact_setup=True);report['setupChild']=setup
  require(setup['exitCode']==0 and not setup['timedOut'] and not setup['interrupted'],'first setup failure, no retry')
  summary={'setupRecordPin':fingerprint(OUT/'setup-record.json'),'inputPin':fingerprint(OUT/'input.json'),'actualDispatchSha':report['actualDispatchSha'],'setupOnlyDiagnosticRoleShaAlias':report['diagnosticRoleSha']};write(PARENT/'setup-summary.json',summary);pins={str(OUT/'setup-record.json'):summary['setupRecordPin'],str(OUT/'input.json'):summary['inputPin'],str(PARENT/'setup-summary.json'):fingerprint(PARENT/'setup-summary.json')}
  # Literal minimal privileged environment; no ordinary credentials or hooks.
  command=['/usr/bin/sudo','-n','--','/usr/bin/env','-i','PATH=/usr/bin:/bin','PYTHONDONTWRITEBYTECODE=1','GITHUB_SHA='+report['actualDispatchSha'],sys.executable,'-I','-B',str(HERE/'root-entry.py')]
  observer=bounded_child(command,ROOT,PARENT/'observer-child',c['observerBounds']);report['observerChild']=observer
  if (OUT/'result.json').is_file():report['recorder']=read(OUT/'result.json')
  if (PARENT/'root-entry-result.json').is_file():report['rootEntry']=read(PARENT/'root-entry-result.json')
  require(observer['exitCode']==0 and not observer['timedOut'] and not observer['interrupted'],'first observer outcome failure, no retry')
  require(report['recorder']['terminalAudit']['status']=='HELD_FULL_TERMINAL_PARITY_PASS','actual complete terminal proof')
  report['status']='RAW_DIAGNOSTIC_CAPTURE_REQUIRES_INDEPENDENT_SYMBOL_LOSS_UNWIND_AUDIT'
 except BaseException as error:
  primary=error;report['error']=repr(error)
  log_primary_failure(report,error);raise
 finally:finish(report,primary,c,node,before,pins)
if __name__=='__main__':
 for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,interrupted)
 require(len(sys.argv)==2,'one owned mode');main(sys.argv[1])
