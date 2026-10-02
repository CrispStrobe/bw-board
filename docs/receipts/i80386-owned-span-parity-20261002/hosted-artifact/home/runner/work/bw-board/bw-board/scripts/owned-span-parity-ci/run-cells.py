#!/usr/bin/env python3
"""Exactly three sequential bounded semantic cells, stop at the first failure. No CPU gate."""
import datetime,hashlib,json,os,pathlib,subprocess,sys,signal,time
sys.dont_write_bytecode=True
from common import BASE,RUNTIME,CANDIDATE,COMPILED,PARITY,BLANK,sha,load,persist,source_map,publication

def safe(call):
 try:return call()
 except Exception as e:return {'error':type(e).__name__+': '+str(e)}
def kill_descendants(child):
 # Stop the wrapper before enumerating: it cannot start another session while
 # the existing native child (which owns a distinct session) is discovered.
 try:os.killpg(child.pid,signal.SIGSTOP)
 except ProcessLookupError:pass
 parents={}
 for path in pathlib.Path('/proc').iterdir():
  if not path.name.isdigit():continue
  try:
   text=(path/'stat').read_text();fields=text[text.rfind(')')+2:].split();parents[int(path.name)]=int(fields[1])
  except (OSError,ValueError,IndexError):continue
 descendants={child.pid};changed=True
 while changed:
  new={pid for pid,parent in parents.items()if parent in descendants};changed=not new<=descendants;descendants.update(new)
 killed=[]
 for pid in sorted(descendants-{child.pid},reverse=True):
  try:
   group=os.getpgid(pid)
   if group==pid:os.killpg(group,signal.SIGKILL)
   else:os.kill(pid,signal.SIGKILL)
   killed.append({'pid':pid,'group':group})
  except ProcessLookupError:pass
 try:os.killpg(child.pid,signal.SIGKILL)
 except ProcessLookupError:pass
 return killed
def bounded_command(command,stem,timeout):
 start=time.monotonic();result={'command':command,'timeoutSeconds':timeout,'timedOut':False,'returncode':None,'status':'OUTER_COMMAND_PRELAUNCH'};child=None
 try:
  with pathlib.Path(str(stem)+'.stdout').open('xb')as out,pathlib.Path(str(stem)+'.stderr').open('xb')as err:
   child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True);result['pid']=child.pid
   try:result['returncode']=child.wait(timeout=timeout)
   except subprocess.TimeoutExpired:
    result['timedOut']=True;result['killedDescendants']=kill_descendants(child);result['returncode']=child.wait(timeout=30)
 except Exception as e:
  result['error']=type(e).__name__+': '+str(e)
  if child is not None and child.poll()is None:result['killedDescendants']=kill_descendants(child);result['returncode']=child.wait(timeout=30)
 finally:
  result['wallSeconds']=time.monotonic()-start;result['signal']=-result['returncode']if result['returncode']is not None and result['returncode']<0 else None;result['status']='OUTER_COMMAND_EXIT_PASS'if result['returncode']==0 and not result['timedOut']and not result.get('error')else'OUTER_COMMAND_FAILURE_PRESERVED_NO_RETRY';persist(str(stem)+'.exit.json',result)
 return result
def main():
 root=pathlib.Path(os.environ['BW_SPAN_PUBLICATION']).resolve();context=pathlib.Path(os.environ['BW_SPAN_CONTEXT']).resolve();record={'status':'THREE_NATIVE_PARITY_CELLS_PENDING','startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cells':[],'scope':'OFF, ON journal and traceON/journalOFF semantic qualification only; no build, performance gate, adoption or broader guest admission.'};success=False
 for k in BLANK:os.environ[k]=''
 try:
  material=load(context/'materialization.json');assert material['status']=='HOSTED_NEW_MATERIALIZATION_EXACT_SOURCE_AND_ORACLES_PASS_NO_NATIVE_EXECUTION';assert material['publicationBefore']==material['publicationAfter']==publication(root);assert sha(PARITY/'approved-bindings.json')==material['bindingSha256'];b=load(PARITY/'approved-bindings.json');assert b['revision']==RUNTIME and b['compiledRevision']==BASE
  record['publicationBefore']=publication(root);record['sourceBefore']={'runtime':source_map(CANDIDATE,RUNTIME,b['sourceHashes']),'compiled':source_map(COMPILED,BASE,b['compiledSourceHashes'])};record['bindingBefore']=sha(PARITY/'approved-bindings.json');record['materializationBefore']=sha(context/'materialization.json');persist(context/'cells.json',record)
  for label in ['smoke-off','fulltrace-on','trace-fast']:
   assert not (PARITY/label).exists();cell={'label':label,'nativeTrace':label!='smoke-off','hostJournal':label=='fulltrace-on','status':'CELL_WRAPPER_PENDING'};record['cells'].append(cell);persist(context/'cells.json',record)
   # run.py itself authenticates complete before/after116+103 current/Git,
   # original artifact/reference maps, Node, helpers, binding and12-field input.
   child=bounded_command([sys.executable,str(PARITY/'run.py'),label],context/(label+'.wrapper'),200)
   cell['wrapperExecution']=child;cell['status']='CELL_WRAPPER_RECORDED_BEFORE_ASSERTION';persist(context/'cells.json',record);assert child['status']=='OUTER_COMMAND_EXIT_PASS','Cell failure preserved; no later cells or retry'
   audit=bounded_command([sys.executable,str(PARITY/'parity.py'),label],context/(label+'.audit'),120)
   cell['auditExecution']=audit;persist(context/'cells.json',record);assert audit['status']=='OUTER_COMMAND_EXIT_PASS','Exact semantic audit failure preserved; no later cells or retry';cell['parity']=load(PARITY/label/'parity.json');cell['status']='ACTUAL_CELL_AND_FULL_ORIGINAL_COMPARATOR_PASS';persist(context/'cells.json',record)
  success=True
 except Exception as e:record['error']=type(e).__name__+': '+str(e)
 finally:
  record['publicationAfter']=safe(lambda:publication(root));record['sourceAfter']=safe(lambda:{'runtime':source_map(CANDIDATE,RUNTIME,b['sourceHashes']),'compiled':source_map(COMPILED,BASE,b['compiledSourceHashes'])});record['bindingAfter']=safe(lambda:sha(PARITY/'approved-bindings.json'));record['materializationAfter']=safe(lambda:sha(context/'materialization.json'));record['endedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();persist(context/'cells.json',record)
 if success:
  success=record['publicationAfter']==record['publicationBefore']and record['sourceAfter']==record['sourceBefore']and record['bindingAfter']==record['bindingBefore']and record['materializationAfter']==record['materializationBefore']
 record['status']='THREE_SPAN_NATIVE_PARITY_CELLS_PASS_AWAITING_INDEPENDENT_ARTIFACT_AUDIT'if success else'THREE_SPAN_NATIVE_PARITY_FAILED_OR_AUTH_CHANGED_NO_RETRY';persist(context/'cells.json',record);print(json.dumps({'status':record['status'],'cells':[{'label':c['label'],'status':c['status']}for c in record['cells']]}));return 0 if success else 1
if __name__=='__main__':raise SystemExit(main())
