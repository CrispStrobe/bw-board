"""Integrated offline supervisor. Actual acquisition always refuses."""
import os,json,hashlib,types,tempfile,stat
from pathlib import Path
EXTERNAL_APPROVAL_SHA256=None
FIXED={'gate.py':'0901f69f1d2ef8870e1716fd7418da247efee00021a8acf3a348cdb0a445ae1f','adapter.py':'2583a603c356e853c2de3b26f42df65b670143463223b7ff073e31ebb33391d2','packet.py':'cf6af8db92a6b0722b544171ddfa85060324e322020ab8909eb43e1369316845'}
PREFIX='scripts/i80386-unarmed-supervisor/'
ROLES=tuple(PREFIX+n for n in (*FIXED,'supervisor.py','executor.py'))
FLAGS=('actualAcquisitionQualified','profileSourceAdmissionQualified','sourceOwnedQualified','filesystemLeaseQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified')
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def load(body,cap):
 need(type(body)is bytes and len(body)<=cap,'bytes-cap')
 def pairs(items):
  d={}
  for k,v in items:need(k not in d,'duplicate-json');d[k]=v
  return d
 def bad(_):raise Refusal('json-number')
 try:return json.loads(body.decode('utf8'),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
 except Refusal:raise
 except (ValueError,UnicodeError,RecursionError):raise Refusal('json-parse')from None
def sha(b):return hashlib.sha256(b).hexdigest()
def keys(v,names):need(type(v)is dict and len(v)==len(names)and all(type(k)is str for k in v)and set(v)==set(names),'closed-shape')
def inherited(full,phase):
 if full is None:return None
 rows={name:{'bytes':row['bytes'],'sha256':row['sha256']}for name,row in full['roles'].items()if row['kind']=='inherited'};need(len(rows)==14,'projection');return {'schema':'bw.full-tree-actual-source.v1','phase':phase,'head':full['head'],'roleCount':14,'roles':rows}
class Supervisor:
 def __init__(self,checkout,approval_raw,descriptor_raw,table_raw):
  need(type(checkout)is str and len(checkout)<=4096 and checkout.startswith('/'),'checkout');need(type(approval_raw)is bytes and len(approval_raw)<=16384 and type(descriptor_raw)is bytes and len(descriptor_raw)<=8192 and type(table_raw)is bytes and len(table_raw)<=65536,'bytes-cap')
  self.checkout=checkout;self.approval_raw=approval_raw;self.descriptor_raw=descriptor_raw;self.table_raw=table_raw;self.entered=False;self.busy=False;self.closed=False;self.first=None;self.secondary=None;self.before=None;self.after=None;self.verified=0;self.execution=None;self.packet_status=None;self.cleanup=0;self.passed=False;self.case=None;self._gate=None;self._adapter=None;self._packet=None;self._output=None;self._executor=None;self._reentry=False;self._output_fd=None;self._output_identity=None;self.raw_stored=[];self.projection={'kind':'INHERITED14_DERIVED_FROM_FULL_PROFILE_POSITIONS','roleCount':14,'beforeSha256':None,'afterSha256':None}
 def fail(self,reason):
  if self.first is None:self.first=reason
 def poison(self):
  self._reentry=True;self.fail('supervisor-reentry')
  for owner in (self._gate,self._adapter,self._packet,self._executor):
   if owner is not None:owner.fail('supervisor-reentry')
 def check(self):need(self.first is None,'poisoned')
 def call(self,fn,*args,**kwargs):self.check();v=fn(*args,**kwargs);self.check();return v
 def digest(self,body):
  h=self.call(hashlib.sha256,body);return self.call(h.hexdigest)
 def diag_call(self,fn,*args,**kwargs):
  need(not self._reentry,'supervisor-reentry');v=fn(*args,**kwargs);need(not self._reentry,'supervisor-reentry');return v
 def diag_digest(self,body):
  h=self.diag_call(hashlib.sha256,body);return self.diag_call(h.hexdigest)
 def source(self,name):
  parts=self.checkout.split('/')[1:];need(len(parts)<=30 and all(p not in ('','.','..')for p in parts),'checkout');fds=[];route=[];primary=None;body=None
  try:
   parent=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);fds.append(parent);self.check()
   for part in (*parts,*name.split('/')[:-1]):
    before=self.call(os.stat,part,dir_fd=parent,follow_symlinks=False);fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);fds.append(fd);self.check();opened=self.call(os.fstat,fd);named=self.call(os.stat,part,dir_fd=parent,follow_symlinks=False);need((before.st_dev,before.st_ino)==(opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino),'bootstrap-route');route.append((parent,part,fd,(opened.st_dev,opened.st_ino)));parent=fd
   fd=os.open(name.split('/')[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent);fds.append(fd);self.check();st=self.call(os.fstat,fd);need(stat.S_ISREG(st.st_mode) and st.st_size<=524288 and st.st_nlink==1,'bootstrap-file');data=bytearray()
   while True:
    b=self.call(os.read,fd,min(65536,524289-len(data)))
    if not b:break
    data.extend(b);need(len(data)<=524288,'bootstrap-cap')
   end=self.call(os.fstat,fd);named=self.call(lambda:os.stat(name.split('/')[-1],dir_fd=parent,follow_symlinks=False));need(stat.S_ISREG(end.st_mode) and stat.S_ISREG(named.st_mode) and len(data)==st.st_size and (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns),'bootstrap-race');
   for ancestor,name,owned,identity in route:
    a=self.call(os.fstat,owned);b=self.call(os.stat,name,dir_fd=ancestor,follow_symlinks=False);need(stat.S_ISDIR(a.st_mode)and stat.S_ISDIR(b.st_mode)and(a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)==identity,'bootstrap-route')
   body=bytes(data)
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'bootstrap-refused');primary=error
  finally:
   for fd in reversed(fds):
    try:os.close(fd)
    except BaseException as error:
     self.cleanup+=1
     if primary is None:primary=error
  if primary is not None:raise primary
  self.check();return body
 def bootstrap(self):
  seal=EXTERNAL_APPROVAL_SHA256;approval_raw=self.approval_raw;descriptor_raw=self.descriptor_raw;table_raw=self.table_raw;need(type(seal)is str and len(seal)==64,'approval-unarmed');need(self.digest(approval_raw)==seal,'approval-seal');a=load(approval_raw,16384);keys(a,('schema','status','head','descriptorSha256','tableSha256','components'));need(a['schema']=='private.full-tree-supervisor-approval.v1'and a['status']=='UNARMED_OFFLINE_ONLY','approval');need(self.digest(descriptor_raw)==a['descriptorSha256']and self.digest(table_raw)==a['tableSha256'],'metadata-seal');d=load(descriptor_raw,8192);need(d['head']==a['head'],'head');keys(a['components'],ROLES);bodies={}
  for name in ROLES:
   row=a['components'][name];keys(row,('bytes','sha256'));need(type(row['bytes'])is int and 0<row['bytes']<=524288 and type(row['sha256'])is str and len(row['sha256'])==64,'component');body=self.source(name);need(len(body)==row['bytes']and self.digest(body)==row['sha256'],'component-seal');short=name[len(PREFIX):]
   if short in FIXED:need(row['sha256']==FIXED[short],'fixed-component')
   bodies[short]=body;self.verified+=1
  # All five source bytes have been approved before any component execution.
  modules={}
  for short in ('gate.py','adapter.py','packet.py','executor.py'):
   module=types.ModuleType('owned_'+short[:-3]);self.check();module.__file__=str(Path(self.checkout)/PREFIX/short);code=compile(bodies[short],'<approved-offline-component>','exec');self.check();exec(code,module.__dict__);self.check();modules[short]=module
  modules['gate.py'].EXTERNAL_DESCRIPTOR_SHA256=a['descriptorSha256'];modules['adapter.py'].EXTERNAL_DESCRIPTOR_SHA256=a['descriptorSha256'];self._adapter=modules['adapter.py'].Adapter(self.checkout,descriptor_raw,table_raw);modules['gate.py']._git=self._adapter.read;self._gate=modules['gate.py'].Gate(self.checkout,descriptor_raw,table_raw);return modules
 def actual(self):raise Refusal('actual-acquisition-disabled')
 def offline(self,case):
  if self.busy:self.poison();raise Refusal('supervisor-reentry')
  need(not self.entered and not self.closed and type(case)is str and case in ('success','midstage-refusal'),'case-or-consumed');self.entered=True;self.busy=True;self.case=case;primary=None;modules=None;out=b'';err=b''
  try:
   modules=self.bootstrap();self.before=self.call(self._gate.observe,'before');self._output=tempfile.mkdtemp(prefix='full-tree-offline-');self.check();self._output_fd=os.open(self._output,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);self.check();a=self.diag_call(os.fstat,self._output_fd);b=self.diag_call(os.stat,self._output,follow_symlinks=False);need(stat.S_ISDIR(a.st_mode)and stat.S_ISDIR(b.st_mode)and(a.st_dev,a.st_ino)==(b.st_dev,b.st_ino),'output-route');self._output_identity=(a.st_dev,a.st_ino);self._executor=modules['executor.py'].Executor();self.execution,out,err=self.call(self._executor.execute,case,self._output)
   if self.execution['exit']!=0:self.fail('manufactured-midstage-refusal')
  except BaseException as error:
   self.fail(str(error)if type(error)is Refusal else'operation-refused');primary=error
  finally:
   if self._executor is not None:
    self.execution=self._executor.status();out=self._executor.stdout;err=self._executor.stderr
   if self._gate is not None and self.before is not None:
    try:self.after=self._gate.observe('after')
    except BaseException as error:
     self.cleanup+=1;self.secondary=self.secondary or 'source-after-refused';self.fail('source-after-refused')
     if primary is None:primary=error
   if modules is not None and self._output is not None:
    try:self.write_outputs(modules['packet.py'],out,err)
    except BaseException as error:
     self.secondary=self.secondary or 'packet-refused';self.fail('packet-refused')
     if primary is None:primary=error
   for owner in (self._packet,self._gate,self._adapter):
    if owner is None:continue
    try:owner.close()
    except BaseException as error:
     self.cleanup+=1;self.secondary=self.secondary or 'cleanup-refused';self.fail('cleanup-refused')
     if primary is None:primary=error
   if self._output_fd is not None:
    fd=self._output_fd;self._output_fd=None
    try:os.close(fd)
    except BaseException as error:
     self.cleanup+=1;self.secondary=self.secondary or 'cleanup-refused';self.fail('cleanup-refused')
     if primary is None:primary=error
   self.busy=False;self.closed=True;self.passed=primary is None and self.first is None and self.before is not None and self.after is not None and self.execution is not None and self.execution['exit']==0 and self.execution['signal']is None and self.execution['rawLogsComplete']is True and self.execution['wallTimedOut']is False and self.execution['outputCapRefused']is False and self.execution['observedLimits']=={k:self.execution['limits'][k]for k in ('cpuSeconds','addressSpaceBytes','fileBytes','fdCount','coreBytes')} and self.packet_status is not None and self.packet_status['closed']is True and self.packet_status['firstFailure']is None and self.packet_status['handlesClosedWithoutReportedRefusal']is True and self.packet_status['closeRefused']==0 and len(self.raw_stored)==2 and all(row['bytes']==self.execution['stdoutBytes'if row['role']=='raw-child.stdout'else'stderrBytes']and row['sha256']==self.execution['stdoutSha256'if row['role']=='raw-child.stdout'else'stderrSha256']for row in self.raw_stored) and self.cleanup==0
  if primary is not None:raise primary
  return self.status()
 def output_check(self):
  need(not self._reentry and self._output_fd is not None,'supervisor-reentry');a=self.diag_call(os.fstat,self._output_fd);b=self.diag_call(os.stat,self._output,follow_symlinks=False);need(stat.S_ISDIR(a.st_mode)and stat.S_ISDIR(b.st_mode)and(a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)==self._output_identity,'output-route');need(not self._reentry,'supervisor-reentry')
 def write_outputs(self,packet,out,err):
  need(not self._reentry,'supervisor-reentry');before=inherited(self.before,'before');after=inherited(self.after,'after');self.projection={'kind':'INHERITED14_DERIVED_FROM_FULL_PROFILE_POSITIONS','roleCount':14,'beforeSha256':None if before is None else self.diag_digest(raw(before)),'afterSha256':None if after is None else self.diag_digest(raw(after))};flags=('reportProfileSourceAdmissionQualified','sourceOwnedQualified','inputLeaseQualified','filesystemLeaseQualified','namespaceModeQualified','completeNoticeCoverageQualified','legalClearanceQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified')
  report={'schema':'bw.full-tree-actual-report.v1','boundary':'FINITE_REPORTED_FULL_TREE_AND_SELECTED_NOTICE_CONSISTENCY','complete':False,'phase':'refused','stoppedPhase':'source-before','parentDepth':len(self.checkout.split('/'))-1,'firstFailure':'source-unarmed','secondaryFailure':None,'inputs':[],'coordinator':None,'sourceBefore':before,'sourceAfter':after,'responseCloseAttempted':0,'responseCloseRefused':0,'coordinatorCloseAttempted':0,'coordinatorCloseRefused':0,'sourceAfterQualified':before is not None and after is not None,'resources':{'ordinaryPerFileContentCap':34200152,'ordinaryAggregateContentCap':258686704,'selectedNoticeContentCap':85182,'plannedAddressSpaceBytes':2147483648,'plannedProcessFileBytes':67108864,'outerHardBoundImplemented':False},**{k:False for k in flags}}
  event={**packet.EVENT_FIXED,'pr':1,'head':self.before['head'],'base':'0'*40,'run':1,'attempt':1};members={'event.json':raw(event),'source-before.json':raw(before),'report.json':raw(report),'control.stdout':b'','control.stderr':b'','run.stdout':b'acquisition=disabled\n','run.stderr':b'','status.txt':b'phase=source-after\nexit=1\n'}
  if after is not None:members['source-after.json']=raw(after)
  # Raw child bytes are written/read back under the pinned owned directory FD.
  need(len(out)<=8192 and len(err)<=8192,'raw-log-cap')
  for name,body in (('raw-child.stdout',out),('raw-child.stderr',err)):
   self.output_check();fd=os.open(name,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=self._output_fd);primary=None
   try:
    self.output_check();st=self.diag_call(os.fstat,fd);need(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_size==0,'raw-file');count=0
    while count<len(body):
     self.output_check();n=self.diag_call(os.write,fd,body[count:]);need(type(n)is int and 0<n<=len(body)-count,'raw-write');count+=n;self.output_check()
    copied=self.diag_call(os.pread,fd,len(body)+1,0);self.output_check();need(copied==body,'raw-readback');end=self.diag_call(os.fstat,fd);named=self.diag_call(os.stat,name,dir_fd=self._output_fd,follow_symlinks=False);need(stat.S_ISREG(end.st_mode)and stat.S_ISREG(named.st_mode)and end.st_nlink==named.st_nlink==1 and end.st_size==named.st_size==len(body)and(st.st_dev,st.st_ino)==(end.st_dev,end.st_ino)==(named.st_dev,named.st_ino),'raw-race');self.raw_stored.append({'role':name,'bytes':len(body),'sha256':self.diag_digest(body)});self.output_check()
   except BaseException as error:self.fail('packet-refused');primary=error
   finally:
    try:os.close(fd)
    except BaseException as error:
     self.cleanup+=1
     if primary is None:primary=error
   if primary is not None:raise primary
  self.output_check();destination=Path(self._output)/'packet';os.mkdir('packet',0o700,dir_fd=self._output_fd);self.output_check();self._packet=packet.Packet(str(destination));self.packet_status=self._packet.write(members);self.output_check()
 def status(self):
  if self.busy:self.poison()
  before=inherited(self.before,'before');after=inherited(self.after,'after')
  return {'schema':'private.full-tree-supervisor-result.v1','case':self.case,'offlineControlPassed':self.passed,'firstFailure':self.first,'secondaryFailure':self.secondary,'sourceBefore':None if self.before is None else load(raw(self.before),65536),'sourceAfter':None if self.after is None else load(raw(self.after),65536),'bootstrapComponentsVerified':self.verified,'execution':None if self.execution is None else load(raw(self.execution),8192),'packet':None if self.packet_status is None else load(raw(self.packet_status),16384),'cleanupRefused':self.cleanup,'rawLogsStored':[dict(v)for v in self.raw_stored],'inheritedProjection':dict(self.projection),**{k:False for k in FLAGS}}
