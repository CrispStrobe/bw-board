"""Exactly held a200 setup()/proof, never its guest main; separate module namespace."""
import sys
sys.dont_write_bytecode=True
import json,traceback,hashlib
from pathlib import Path
from policy import contract,require,diagnostic_worker_role,terminal_projection
from admission import HERE,Q,N,read,ordinary,fingerprint,sources
c=contract(read(HERE/'contract.json'))
require(len(sys.argv)==4 and sys.argv[1] in ('setup','validate'),'fixed internal setup/proof CLI')
mode,node,out=sys.argv[1],Path(sys.argv[2]),Path(sys.argv[3]);require(out.is_absolute() and out.resolve()==out,'canonical owned output')
source_before=sources(c,node)
require(fingerprint(Q/'scripts/cold-memory-fusion-qualification/contract.json')['sha256']==c['heldSetupContractSha256'],'held setup contract')
# No own policy/lifecycle modules are reused by the held import.
for name in ('policy','admission','lifecycle','archive','restore'):sys.modules.pop(name,None)
sys.path.insert(0,str(Q/'scripts/cold-memory-fusion-qualification'))
import qualify as q
held=q.contract(q.read_json(q.HERE/'contract.json'));report={'mode':mode,'status':'FAIL','sourceBefore':source_before};primary=None
try:
 if mode=='setup':
  b,data=q.setup(held,node,out,report)
  b['workers']['native']=diagnostic_worker_role(c)
  data.update(workerRevision=c['diagnosticWorker']['revision'],workerSourceSha256=c['diagnosticWorker']['sourceSha256'],output=str(out/'guest/receipt'))
  q.write(out/'derived-binding.json',b);q.write(out/'input.json',data);report['restoredBefore']=q.restored(held,node,out);report['inputPin']=fingerprint(out/'input.json');report['bindingPin']=fingerprint(out/'derived-binding.json');report['status']='SETUP_STATIC_ADMISSION_COMPLETE_NO_GUEST'
 else:
  setup=q.read_json(out/'setup-record.json');require(fingerprint(out/'input.json')==setup['inputPin'] and fingerprint(out/'derived-binding.json')==setup['bindingPin'],'derived inputs immutable')
  report['originalInputsAfter']=q.original_inputs(out);require(report['originalInputsAfter']==setup['inputsBeforeRestore'],'original build/capture/restore inputs unchanged');report['restoredAfter']=q.restored(held,node,out);require(report['restoredAfter']==setup['restoredBefore'],'restored/source final equality')
  r=q.read_json(out/'guest/receipt/receipt.json');semantic=terminal_projection(r)
  # Exact old semantic projection only; the authentic raw diagnostic receipt remains unchanged.
  report['terminal']=q.terminal(semantic,q.read_json(out/'input.json'),q.read_json(out/'derived-binding.json'),q.read_json(out/'capture.json'))
  require(r['executionProfile']['status']=='PROFILE_CAPTURE_COMPLETE' and not r['executionProfile']['errors'],'actual sampler outcome');pin=r['executionProfile']['rawProfile'];require(pin['file']=='execution.cpuprofile' and fingerprint(out/'guest/receipt/execution.cpuprofile')=={'bytes':pin['bytes'],'sha256':pin['sha256']},'raw profile retained')
  report['status']='DIAGNOSTIC_PARITY_AND_RAW_PROFILE_CAPTURE_COMPLETE'
except BaseException as e:primary=e;report['error']=repr(e);raise
finally:
 report['finalizationErrors']=[];finalerror=None
 guards=[('sourceAfter',lambda:sources(c,node),source_before)]
 if 'inputsBeforeRestore' in report:guards.append(('inputsAfter',lambda:q.original_inputs(out),report['inputsBeforeRestore']))
 for name,reader,expected in guards:
  try:report[name]=reader();require(report[name]==expected,name+' final equality')
  except BaseException as e:
   report[name+'Unavailable']=repr(e);report['status']='FAIL';report['finalizationErrors'].append({'phase':name,'error':repr(e)})
   if finalerror is None:finalerror=e;report['finalizationError']=repr(e)
 q.write(out/('setup-record.json' if mode=='setup' else 'validation-record.json'),report)
 if finalerror is not None and primary is None:raise finalerror
