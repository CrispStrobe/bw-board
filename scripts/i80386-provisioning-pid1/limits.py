"""Unarmed Linux PID1 process-limit preparation; no bootstrap or delegate."""
import os,resource,sys
ACTUAL_SEAL=None
POLICY=(('cpuSeconds',0,180,180),('addressSpaceBytes',9,2147483648,2147483648),('fileBytes',1,67108864,67108864),('fdCount',7,256,256),('coreBytes',4,0,0))
class Refusal(ValueError):pass
def actual():raise Refusal('actual-unsealed')
class Limits:
 def __init__(self):
  self.entered=False;self.busy=False;self.closed=False;self.complete=False;self.phase='new';self.first=None;self.stopped=None;self._original=None;self.policy=None;self.eligibility=None;self.rows=[];self.set_attempts=0;self.get_attempts=0
 def _fail(self,reason,error):
  if self.first is None:self.first=reason;self.stopped=self.phase;self._original=error
 def _poison(self):
  error=Refusal('pid1-reentry');self._fail('pid1-reentry',error);raise self._original
 def _check(self):
  if self.first is not None:raise self._original
 def _need(self,ok,code):
  if not ok:raise Refusal(code)
 def _capture_policy(self):
  value=POLICY;expected=(('cpuSeconds',0,180,180),('addressSpaceBytes',9,2147483648,2147483648),('fileBytes',1,67108864,67108864),('fdCount',7,256,256),('coreBytes',4,0,0))
  self._need(type(value)is tuple and len(value)==5,'policy-shape')
  for row,wanted in zip(value,expected):
   self._need(type(row)is tuple and len(row)==4,'policy-shape');self._need(type(row[0])is str and all(type(x)is int for x in row[1:]),'policy-type');self._need(row==wanted,'policy-literal')
  self._need((resource.RLIMIT_CPU,resource.RLIMIT_AS,resource.RLIMIT_FSIZE,resource.RLIMIT_NOFILE,resource.RLIMIT_CORE)==(0,9,1,7,4),'linux-resource-ids')
  return tuple((name,kind,soft,hard)for name,kind,soft,hard in value)
 def _call(self,fn,*args,operation=None):
  self._check()
  if operation=='set':self.set_attempts+=1
  elif operation=='get':self.get_attempts+=1
  value=fn(*args);self._check();return value
 def _observe(self,getter,row,position):
  observed=self._call(getter,row['resource'],operation='get');item={'position':position,'shapeValid':False,'soft':None,'hard':None,'matchesPolicy':False};row['observations'].append(item)
  shape=type(observed)is tuple and len(observed)==2 and all(type(v)is int and -1<=v<=2**64-1 for v in observed)
  if shape:item.update(shapeValid=True,soft=observed[0],hard=observed[1],matchesPolicy=observed==(row['soft'],row['hard']))
  self._need(shape,'limit-readback-shape');self._need(item['matchesPolicy'],'limit-readback-mismatch')
 def _prepare(self):
  if self.busy:self._poison()
  self._need(not self.entered and not self.closed,'limits-once');self.entered=True;self.busy=True;primary=None;reason='policy-refused'
  try:
   self.phase='policy';policy=self._capture_policy();self._check();self.policy=policy
   # Capture literal policy and all source-owned callable bindings before hooks.
   set_limit=resource.setrlimit;get_limit=resource.getrlimit;pid=os.getpid;euid=os.geteuid;gid=os.getgid;egid=os.getegid;env_get=os.environ.get;platform=sys.platform
   self.phase='eligibility';reason='eligibility-refused';self._need(type(platform)is str and platform=='linux','linux-required')
   facts={'pid':self._call(pid),'euid':self._call(euid),'gid':self._call(gid),'egid':self._call(egid),'githubActions':self._call(env_get,'GITHUB_ACTIONS'),'repository':self._call(env_get,'GITHUB_REPOSITORY'),'attempt':self._call(env_get,'GITHUB_RUN_ATTEMPT')}
   self._need(all(type(facts[k])is int for k in ('pid','euid','gid','egid')),'eligibility-types');self._need(facts['pid']==1 and facts['euid']==0 and facts['gid']==0 and facts['egid']==0,'pid1-root-required');self._need(all(type(facts[k])is str for k in ('githubActions','repository','attempt')),'context-types');self._need(facts['githubActions']=='true'and facts['repository']=='CrispStrobe/bw-board'and facts['attempt']=='1','hosted-context-required');self.eligibility={'linuxObserved':True,'pid1Observed':True,'rootCredentialsObserved':True,'githubContextObserved':True}
   for name,kind,soft,hard in policy:
    self.phase='install';row={'name':name,'resource':kind,'soft':soft,'hard':hard,'setReturned':False,'observations':[]};self.rows.append(row);reason='limit-set-refused';result=self._call(set_limit,kind,(soft,hard),operation='set');self._need(result is None,'limit-set-return');row['setReturned']=True;self.phase='immediate-readback';reason='limit-readback-refused';self._observe(get_limit,row,'immediate')
   self.phase='final-readback';reason='final-readback-refused'
   for row in self.rows:self._observe(get_limit,row,'final')
   self._check();self.complete=True;self.phase='prepared'
  except BaseException as error:self._fail(reason,error);primary=self._original;self.complete=False;self.phase='refused'
  finally:self.busy=False;self.closed=True
  if primary is not None:raise primary
  self._check();return self.status()
 def status(self):
  if self.busy:self._poison()
  return{'schema':'bw.provisioning-pid1-limits.v1','phase':self.phase,'closed':self.closed,'prepared':self.complete and self.first is None,'firstFailure':self.first,'stoppedPhase':self.stopped,'eligibility':None if self.eligibility is None else dict(self.eligibility),'policy':None if self.policy is None else [{'name':n,'resource':r,'soft':s,'hard':h}for n,r,s,h in self.policy],'rows':[dict(row,observations=[dict(o)for o in row['observations']])for row in self.rows],'setAttempted':self.set_attempts,'getAttempted':self.get_attempts,'processLimitsPrepared':self.complete and self.first is None,'namespaceOwnershipQualified':False,'officialHostQualified':False,'aggregateResourceQuotaQualified':False,'diskQuotaQualified':False,'actualResourceSufficiencyQualified':False,'outerTimeoutQualified':False,'bootstrapConnected':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
