"""Fixed manufactured stdlib child with enforced Unix resource/process bounds."""
import os,sys,time,signal,resource,subprocess,selectors,json,hashlib
LIMITS={'cpuSeconds':3,'addressSpaceBytes':134217728,'fileBytes':65536,'fdCount':64,'wallSeconds':5,'stdoutBytes':8192,'stderrBytes':8192,'coreBytes':0}
CHILD="""import json,sys,resource
limits={k:resource.getrlimit(v)[0] for k,v in [('cpuSeconds',resource.RLIMIT_CPU),('addressSpaceBytes',resource.RLIMIT_AS),('fileBytes',resource.RLIMIT_FSIZE),('fdCount',resource.RLIMIT_NOFILE),('coreBytes',resource.RLIMIT_CORE)]}
print(json.dumps({'schema':'private.fixed-offline-child.v1','case':sys.argv[1],'limits':limits,'offline':True},sort_keys=True),flush=True)
if sys.argv[1]=='midstage-refusal':
 sys.stderr.write('manufactured-midstage-refusal\\n');sys.stderr.flush();sys.exit(7)
"""
class Refusal(ValueError):pass
def need(ok,why):
 if not ok:raise Refusal(why)
def fixed_policy():
 expected=(('cpuSeconds',3),('addressSpaceBytes',134217728),('fileBytes',65536),('fdCount',64),('wallSeconds',5),('stdoutBytes',8192),('stderrBytes',8192),('coreBytes',0))
 need(type(LIMITS)is dict and len(LIMITS)==len(expected)and all(type(k)is str for k in LIMITS)and set(LIMITS)=={k for k,v in expected},'limit-policy')
 need(all(type(LIMITS[k])is int and LIMITS[k]==v for k,v in expected),'limit-policy');return expected
def fixed_command(case):
 body=CHILD;interpreter=sys.executable
 need(type(body)is str and len(body)==515 and hashlib.sha256(body.encode('utf8')).hexdigest()=='316fcdc3986f9e3addaf8c29631d8da893b84e17c6cb3ae561459c9dda7d90c3','child-program')
 need(type(interpreter)is str and 0<len(interpreter)<=4096 and interpreter.startswith('/')and '\0'not in interpreter and all(part not in ('','.', '..')for part in interpreter.split('/')[1:]),'interpreter-path')
 return (interpreter,'-I','-S','-B','-c',body,case)
def _execute(owner,case,output_root):
 need(type(case)is str and case in ('success','midstage-refusal'),'case');policy=fixed_policy();command=fixed_command(case);expected_child=tuple((k,v)for k,v in policy if k in ('cpuSeconds','addressSpaceBytes','fileBytes','fdCount','coreBytes'))
 def install():
  for key,kind in (('cpuSeconds',resource.RLIMIT_CPU),('addressSpaceBytes',resource.RLIMIT_AS),('fileBytes',resource.RLIMIT_FSIZE),('fdCount',resource.RLIMIT_NOFILE),('coreBytes',resource.RLIMIT_CORE)):
   value=dict(policy)[key];resource.setrlimit(kind,(value,value))
 owner.check();st=os.statvfs(output_root);owner.check();free=st.f_bavail*st.f_frsize;need(free>=1048576,'storage-preflight');proc=None;sel=None;primary=None;out=bytearray();err=bytearray();cleanup=0;timeout=False;cap_refusal=False;code=None;start=owner.call(time.monotonic)
 try:
  owner.check();proc=subprocess.Popen(command,env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'},stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=install);owner._proc=proc;owner.check();sel=selectors.DefaultSelector();owner.check()
  for f in (proc.stdout,proc.stderr):
   fd=owner.call(f.fileno);owner.call(os.set_blocking,fd,False);owner.call(sel.register,f,selectors.EVENT_READ)
  while owner.call(sel.get_map):
   owner.check();remaining=5-(owner.call(time.monotonic)-start);owner.check()
   if remaining<=0:timeout=True;raise Refusal('wall-timeout')
   events=owner.call(sel.select,min(remaining,.1))
   for key,_ in events:
    owner.check()
    target=out if key.fileobj is proc.stdout else err;fd=owner.call(key.fileobj.fileno);b=owner.call(os.read,fd,min(65536,8193-len(target)))
    if not b:owner.call(sel.unregister,key.fileobj);continue
    if len(target)+len(b)>8192:target.extend(b[:8192-len(target)]);cap_refusal=True;raise Refusal('output-cap')
    target.extend(b);owner.check()
  owner.check();remaining=5-(owner.call(time.monotonic)-start);owner.check()
  if remaining<=0:timeout=True;raise Refusal('wall-timeout')
  try:code=proc.wait(timeout=remaining);owner.check()
  except subprocess.TimeoutExpired:timeout=True;raise
 except BaseException as error:primary=error
 finally:
  if proc is not None:
   if primary is not None:
    try:os.killpg(proc.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    except BaseException:cleanup+=1
   try:proc.wait(timeout=1);code=proc.returncode
   except BaseException:cleanup+=1
   for f in (proc.stdout,proc.stderr):
    if f is not None:
     try:f.close()
     except BaseException:cleanup+=1
  if sel is not None:
   try:sel.close()
   except BaseException:cleanup+=1
 observed=None
 if primary is None:
  try:
   parsed=json.loads(bytes(out).decode('utf8'));need(type(parsed)is dict and set(parsed)=={'schema','case','limits','offline'} and parsed['schema']=='private.fixed-offline-child.v1' and parsed['case']==case and parsed['offline']is True,'child-shape');expected=dict(expected_child);need(type(parsed['limits'])is dict and parsed['limits']==expected and all(type(v)is int for v in parsed['limits'].values()),'child-limits');observed=dict(parsed['limits'])
  except BaseException as error:primary=error
 receipt={'schema':'private.full-tree-offline-execution.v1','case':case,'exit':code if code is not None and code>=0 else None,'signal':-code if code is not None and code<0 else None,'wallTimedOut':timeout,'outputCapRefused':cap_refusal,'stdoutBytes':len(out),'stderrBytes':len(err),'stdoutSha256':hashlib.sha256(out).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest(),'limits':dict(policy),'observedLimits':observed,'storage':{'minimumFreeBytes':1048576,'observedFreeBytes':free,'rawLogByteCap':16384,'storageQuotaQualified':False},'cleanupRefused':cleanup,'rawLogsComplete':primary is None and cleanup==0,'executionScope':'FIXED_MANUFACTURED_STDLIB_CHILD_ONLY','actual':False}
 owner.receipt=receipt;owner.stdout=bytes(out);owner.stderr=bytes(err);owner._proc=None
 if primary is not None:raise primary
 need(cleanup==0,'cleanup-refused');return receipt,bytes(out),bytes(err)

class Executor:
 def __init__(self):self.busy=False;self.entered=False;self.first=None;self.receipt=None;self.stdout=b'';self.stderr=b'';self._proc=None
 def fail(self,code):
  if self.first is None:self.first=code
 def check(self):need(self.first is None,'executor-poisoned')
 def call(self,fn,*args):self.check();v=fn(*args);self.check();return v
 def execute(self,case,output_root):
  if self.busy:self.fail('executor-reentry');raise Refusal('executor-reentry')
  need(not self.entered,'executor-consumed');self.entered=True;self.busy=True
  try:return _execute(self,case,output_root)
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'child-refused');raise
  finally:self.busy=False
 def status(self):
  if self.busy:self.fail('executor-reentry')
  return None if self.receipt is None else json.loads(json.dumps(self.receipt))
