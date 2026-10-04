"""Owned root watchdog around fixed recorder; no caller tool/source arguments."""
import sys
sys.dont_write_bytecode=True
import os,signal,importlib.util
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from policy import contract,require
from admission import HERE,ROOT,WS,OUT,PARENT,read,fingerprint
from lifecycle import write

def authenticated_bytes(c):
 before=read(PARENT/'source-before.json');require(before['dispatch']['revision']==os.environ['GITHUB_SHA'],'original dispatch SHA, never setup-role alias');result={}
 for name,role in c['roles'].items():
  result[name]={}
  for path,h in role['files'].items():require(fingerprint(Path(role['root'])/path)['sha256']==h,'root fixed role byte '+name+'/'+path);result[name][path]=h
 require(before['roles']=={n:{'revision':r['revision'],'hashes':r['files']} for n,r in c['roles'].items()},'source-authenticated fixed role maps')
 for path,h in before['dispatch']['hashes'].items():require(fingerprint(ROOT/path)['sha256']==h,'authenticated dispatch executable '+path)
 return {'actualDispatchRevision':before['dispatch']['revision'],'dispatch':before['dispatch'],'sourceRecordPin':fingerprint(PARENT/'source-before.json'),'fixedRoles':result}
def finish_root(report,c,before,primary):
 for name,role in c['roles'].items():
  report.setdefault('sourceAfter',{})[name]={}
  for path,h in role['files'].items():
   try:report['sourceAfter'][name][path]=fingerprint(Path(role['root'])/path)['sha256'];require(report['sourceAfter'][name][path]==h,'root role after pin')
   except BaseException as error:report.setdefault('finalizationErrors',{})[name+'/'+path]=repr(error)
 for path,h in before['dispatch']['hashes'].items():
  try:require(fingerprint(ROOT/path)['sha256']==h,'root executable after pin')
  except BaseException as error:report.setdefault('finalizationErrors',{})['dispatch/'+path]=repr(error)
 for path,pin in report.get('inputPinsBefore',{}).items():
  try:report.setdefault('inputPinsAfter',{})[path]=fingerprint(Path(path));require(report['inputPinsAfter'][path]==pin,'root immutable input after')
  except BaseException as error:report.setdefault('finalizationErrors',{})['input:'+path]=repr(error)
 if report.get('cleanupErrors') or report.get('finalizationErrors'):report['status']='FAIL'
 write(PARENT/'root-entry-result.json',report)
 if primary is None and report['status']=='FAIL':raise ValueError('retained root finalization failure')
 return report
def main():
 c=contract(read(HERE/'contract.json'));require(os.geteuid()==0 and ROOT==WS/'runtime','fixed root owned wrapper')
 before=authenticated_bytes(c);report={'status':'FAIL','scope':c['scope'],'sourceBefore':before};primary=None;recorder=None
 try:
  summary=read(PARENT/'setup-summary.json');require(summary['setupRecordPin']==fingerprint(OUT/'setup-record.json') and summary['inputPin']==fingerprint(OUT/'input.json'),'ordinary authenticated setup-record/input pins before root recorder')
  report['inputPinsBefore']={str(PARENT/'source-before.json'):before['sourceRecordPin'],str(PARENT/'setup-summary.json'):fingerprint(PARENT/'setup-summary.json'),str(OUT/'setup-record.json'):summary['setupRecordPin'],str(OUT/'input.json'):summary['inputPin']}
  path=Path(c['roles']['diagnostic']['root'])/'scripts/cold-native-ledger-scalars-symbol-profile/recorder.py';spec=importlib.util.spec_from_file_location('owned_recorder',path);recorder=importlib.util.module_from_spec(spec);spec.loader.exec_module(recorder)
  require(recorder.ROOT==WS/'symbol-worker','fixed recorder source role')
  for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGALRM):signal.signal(sig,recorder.interrupted)
  signal.alarm(c['rootWatchdogSeconds']);report['watchdogSeconds']=c['rootWatchdogSeconds'];recorder.main();report['status']='RAW_RECORDER_OUTCOME_REQUIRES_INDEPENDENT_TERMINAL_SAMPLE_AUDIT'
 except BaseException as error:primary=error;report['error']=repr(error);raise
 finally:
  signal.alarm(0)
  if recorder is not None:
   for name,child in list(recorder.ACTIVE.items()):
    try:
     if child.poll() is None:recorder.terminate(child)
    except BaseException as error:report.setdefault('cleanupErrors',{})[name]=repr(error)
  finish_root(report,c,before,primary)
if __name__=='__main__':require(len(sys.argv)==1,'no caller root authority');main()
