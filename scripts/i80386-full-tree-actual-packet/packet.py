"""Private nine-text-role packet consistency writer, no operational authority."""
import json,re,os,stat,hashlib
ROLES={'source-before.json':65536,'source-after.json':65536,'event.json':4096,'report.json':196608,'control.stdout':8192,'control.stderr':8192,'run.stdout':8192,'run.stderr':8192,'status.txt':1024}
ORDER=('event.json','source-before.json','control.stdout','control.stderr','run.stdout','run.stderr','report.json','source-after.json','status.txt')
STAGES=('entry','event','source-before','controls','execution','source-after','complete')
# The terminal status is always present in an admitted assembly; genuinely
# missing source/report bytes remain absent. These are declared artifact stages,
# not proof of authenticated job execution or raw trap provenance.
ALLOWED={
 'entry':('status.txt',),
 'event':('status.txt','event.json'),
 'source-before':('status.txt','event.json','source-before.json'),
 'controls':('status.txt','event.json','source-before.json','control.stdout','control.stderr'),
 'execution':('status.txt','event.json','source-before.json','control.stdout','control.stderr','run.stdout','run.stderr','report.json'),
 'source-after':tuple(ROLES),
 'complete':tuple(ROLES)}
REQUIRED={k:('status.txt',) for k in STAGES}
for k in ('source-before','controls','execution','source-after','complete'):REQUIRED[k]=('status.txt','event.json')
for k in ('controls','execution','source-after','complete'):REQUIRED[k]+=('source-before.json',)
REQUIRED['complete']=tuple(ROLES)
EVENT_KEYS=('schema','event','action','repository','headRepository','pr','head','base','run','attempt','workflow','job','label','authenticatedContextQualified')
EVENT_FIXED={'schema':'bw.full-tree-actual-event.v1','event':'pull_request','action':'labeled','repository':'CrispStrobe/bw-board','headRepository':'CrispStrobe/bw-board','workflow':'.github/workflows/i80386-full-tree-actual.yml','job':'full-tree-materialization','label':'x86-full-tree-and-selected-notice-materialization','authenticatedContextQualified':False}
REPORT_FLAGS=('reportProfileSourceAdmissionQualified','sourceOwnedQualified','inputLeaseQualified','filesystemLeaseQualified','namespaceModeQualified','completeNoticeCoverageQualified','legalClearanceQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified')
REPORT_KEYS=('schema','boundary','complete','phase','stoppedPhase','parentDepth','firstFailure','secondaryFailure','inputs','coordinator','sourceBefore','sourceAfter','responseCloseAttempted','responseCloseRefused','coordinatorCloseAttempted','coordinatorCloseRefused','sourceAfterQualified','resources',*REPORT_FLAGS)
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def keys(v,names):
 need(type(v)is dict and len(v)==len(names) and all(type(k)is str and len(k)<=96 for k in v),'closed-shape');need(set(v)==set(names),'closed-shape')
def bounded(v,depth=0,budget=None):
 if budget is None:budget=[24000]
 budget[0]-=1;need(budget[0]>=0 and depth<=12,'json-cap')
 if v is None or type(v)is bool:return
 if type(v)is int:need(0<=v<2**64,'json-number');return
 if type(v)is str:need(len(v)<=4096,'json-string');return
 if type(v)is list:
  need(len(v)<=1500,'json-cap')
  for x in v:bounded(x,depth+1,budget)
  return
 need(type(v)is dict and len(v)<=1500 and all(type(k)is str and len(k)<=240 for k in v),'json-shape')
 for x in v.values():bounded(x,depth+1,budget)
def load(raw,cap):
 need(type(raw)is bytes and len(raw)<=cap,'bytes-cap')
 def pairs(rows):
  out={}
  for k,v in rows:need(k not in out,'duplicate-json');out[k]=v
  return out
 def forbidden(_):raise Refusal('json-number')
 try:v=json.loads(raw.decode('utf8'),object_pairs_hook=pairs,parse_constant=forbidden,parse_float=forbidden)
 except Refusal:raise
 except (ValueError,UnicodeError,RecursionError):raise Refusal('json-parse') from None
 bounded(v);return v
def event(raw):
 v=load(raw,4096);keys(v,EVENT_KEYS)
 for k,val in EVENT_FIXED.items():need(type(v[k])is type(val) and v[k]==val,'event-identity')
 for k in ('pr','run'):need(type(v[k])is int and 0<v[k]<2**63,'event-integer')
 need(type(v['attempt'])is int and v['attempt']==1,'event-attempt')
 for k in ('head','base'):need(type(v[k])is str and re.fullmatch('[0-9a-f]{40}',v[k])is not None,'event-head')
 return v
def status(raw):
 need(type(raw)is bytes and len(raw)<=1024,'bytes-cap');m=re.fullmatch(rb'phase=(entry|event|source-before|controls|execution|source-after|complete)\nexit=(0|[1-9][0-9]{0,2})\n',raw);need(m is not None,'status-grammar');phase=m[1].decode();exit_code=int(m[2]);need(exit_code<=255 and ((phase=='complete' and exit_code==0) or (phase!='complete' and exit_code>0)),'status-exit');return phase,exit_code
def admit(members):
 need(type(members)is dict and len(members)<=9 and all(type(k)is str and len(k)<=32 for k in members),'members-shape');need(set(members)<=set(ROLES) and 'status.txt'in members,'members-role');total=0
 for name in members:
  raw=members[name];need(type(raw)is bytes and len(raw)<=ROLES[name],'bytes-cap');total+=len(raw)
 need(total<=524288,'packet-cap');phase,exit_code=status(members['status.txt']);need(set(members)<=set(ALLOWED[phase]) and set(REQUIRED[phase])<=set(members),'stage-roles')
 for a,b in (('control.stdout','control.stderr'),('run.stdout','run.stderr')):need((a in members)==(b in members),'log-pair')
 e=event(members['event.json']) if 'event.json'in members else None;report=None;sources={}
 for name in ('source-before.json','source-after.json'):
  if name not in members:continue
  v=load(members[name],ROLES[name]);keys(v,('schema','phase','head','roleCount','roles'));need(v['schema']=='bw.full-tree-actual-source.v1' and v['phase']==('before'if name=='source-before.json'else'after'),'source-shape');need(e is not None and v['head']==e['head'] and type(v['roleCount'])is int and v['roleCount']==14 and type(v['roles'])is dict and len(v['roles'])==14,'source-identity');
  for path,row in v['roles'].items():
   need(type(path)is str and len(path)<=240 and path.startswith('scripts/') and all(c not in ('','.','..') for c in path.split('/')),'source-role-shape');keys(row,('bytes','sha256'));need(type(row['bytes'])is int and 0<row['bytes']<=524288 and type(row['sha256'])is str and re.fullmatch('[0-9a-f]{64}',row['sha256'])is not None,'source-role-shape')
  sources[name]=v
 if 'report.json'in members:
  report=load(members['report.json'],196608);keys(report,REPORT_KEYS);need(report['schema']=='bw.full-tree-actual-report.v1' and report['boundary']=='FINITE_REPORTED_FULL_TREE_AND_SELECTED_NOTICE_CONSISTENCY' and type(report['complete'])is bool and type(report['sourceAfterQualified'])is bool and all(report[k]is False for k in REPORT_FLAGS),'report-shape');need(report['phase']in ('new','source-before','acquiring','coordinator','source-after','complete','refused') and (report['stoppedPhase']is None or report['stoppedPhase']in ('new','source-before','acquiring','coordinator','source-after','complete','refused')),'report-shape');need(type(report['parentDepth'])is int and 1<=report['parentDepth']<=30,'report-shape')
  for key in ('firstFailure','secondaryFailure'):
   value=report[key];need(value is None or (type(value)is str and len(value)<=96 and re.fullmatch('[a-z0-9-]+',value)is not None),'report-shape')
  for name,key in (('source-before.json','sourceBefore'),('source-after.json','sourceAfter')):
   value=report.get(key);need((value is None and name not in sources) or (name in sources and json.dumps(value,sort_keys=True,separators=(',',':'))==json.dumps(sources[name],sort_keys=True,separators=(',',':'))),'source-report-join')
 for name in ('control.stdout','control.stderr','run.stdout','run.stderr'):
  if name not in members:continue
  try:text=members[name].decode('ascii')
  except UnicodeError:raise Refusal('log-grammar') from None
  need(all(len(line)<=240 and re.fullmatch('[A-Za-z0-9_.= :,-]*',line)is not None for line in text.split('\n')) and re.fullmatch('[-A-Za-z0-9_.= :,\n]*',text)is not None,'log-grammar');need(not text or text.endswith('\n'),'log-grammar')
 if phase=='complete':need(report is not None and report['complete']is True and all(members[k]==b'' for k in ('control.stderr','run.stderr')),'complete-join')
 return {'phase':phase,'exit':exit_code,'roleCount':len(members),'eventConsistencyObserved':e is not None,'profileSourceAdmissionQualified':False,'authenticatedContextQualified':False,'controlTranscriptQualified':False,'originalPacketQualified':False}
class Packet:
 def __init__(self,destination):
  need(type(destination)is str and len(destination)<=4096,'destination-shape');need(len(destination.encode('utf8'))<=4096 and destination.startswith('/') and '\0'not in destination,'destination-shape');parts=destination.split('/')[1:];need(len(parts)<=30 and all(x not in ('','.','..') for x in parts),'destination-shape')
  self.parts=parts;self.busy=False;self.entered=False;self.closed=False;self.first=None;self.phase='new';self.attempts=0;self.written=[];self.close_attempted=0;self.close_refused=0;self.scan_close_refused=0;self.slots=[None]*34;self.route=[];self.close_fn=os.close;self.assembly=None
 def fail(self,code):
  if self.first is None:self.first=code
 def check(self):need(self.first is None,'poisoned')
 def reentry(self):self.fail('packet-reentry')
 def close_fd(self,fd):
  for i,v in enumerate(self.slots):
   if v==fd:
    self.slots[i]=None;self.close_attempted+=1
    try:self.close_fn(fd)
    except BaseException:self.close_refused+=1;self.fail('cleanup-refused');raise
    return
 def opening(self,*args,**kwargs):
  self.check();fd=os.open(*args,**kwargs)
  try:
   need(type(fd)is int and fd>=0 and fd not in self.slots,'descriptor-shape');i=self.slots.index(None);self.slots[i]=fd;self.check();return fd
  except BaseException as error:
   self.fail('packet-reentry'if self.first=='packet-reentry'else'filesystem-refused')
   if fd in self.slots:
    try:self.close_fd(fd)
    except BaseException:pass
   else:
    self.close_attempted+=1
    try:self.close_fn(fd)
    except BaseException:self.close_refused+=1
   raise error
 def call(self,fn,*a,**kw):self.check();v=fn(*a,**kw);self.check();return v
 def root(self):
  flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW;fd=self.opening('/',flags)
  for name in self.parts:
   before=self.call(os.stat,name,dir_fd=fd,follow_symlinks=False);need(stat.S_ISDIR(before.st_mode),'directory-kind');child=self.opening(name,flags,dir_fd=fd);opened=self.call(os.fstat,child);named=self.call(os.stat,name,dir_fd=fd,follow_symlinks=False);identity=(before.st_dev,before.st_ino);need(identity==(opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino),'directory-race');self.route.append((fd,name,child,identity));fd=child
  return fd
 def recheck(self):
  for parent,name,fd,identity in self.route:
   opened=self.call(os.fstat,fd);named=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False);need(stat.S_ISDIR(opened.st_mode) and stat.S_ISDIR(named.st_mode) and (opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino)==identity,'directory-race')
 def scan(self,root,expected):
  self.recheck();iterator=None;primary=None;names=[]
  try:
   iterator=os.scandir(root);self.check()
   for _ in range(10):
    try:entry=self.call(next,iterator)
    except StopIteration:break
    need(type(entry)is os.DirEntry,'directory-entry');name=entry.name;self.check();need(type(name)is str and len(name)<=32,'directory-extra');names.append(name)
   need(len(names)<=9 and len(names)==len(expected) and set(names)==set(expected),'directory-extra');self.recheck()
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'filesystem-refused');primary=error
  finally:
   if iterator is not None:
    try:iterator.close()
    except BaseException as error:
     self.scan_close_refused+=1;self.fail('cleanup-refused')
     if primary is None:primary=error
  if primary is not None:raise primary
  self.check()
 def output(self,root,name,raw):
  self.recheck();self.attempts+=1;fd=self.opening(name,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=root);primary=None
  try:
   before=self.call(os.fstat,fd);need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size==0,'output-shape');count=0
   while count<len(raw):
    n=self.call(os.write,fd,raw[count:count+65536]);need(type(n)is int and 0<n<=min(65536,len(raw)-count),'write-progress');count+=n
   copied=bytearray();offset=0
   while True:
    b=self.call(os.pread,fd,min(65536,len(raw)+1-offset),offset);need(type(b)is bytes,'readback-shape')
    if not b:break
    copied.extend(b);offset+=len(b);need(offset<=len(raw),'readback-extent')
   need(bytes(copied)==raw,'readback-bytes');end=self.call(os.fstat,fd);named=self.call(os.stat,name,dir_fd=root,follow_symlinks=False);need(stat.S_ISREG(end.st_mode) and stat.S_ISREG(named.st_mode) and end.st_nlink==named.st_nlink==1 and end.st_size==named.st_size==len(raw) and (before.st_dev,before.st_ino)==(end.st_dev,end.st_ino)==(named.st_dev,named.st_ino),'output-race');self.recheck();h=hashlib.sha256(raw);self.check();digest=h.hexdigest();self.check();self.written.append({'role':name,'bytes':len(raw),'sha256':digest})
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'filesystem-refused');primary=error
  finally:
   try:self.close_fd(fd)
   except BaseException as error:
    if primary is None:primary=error
  if primary is not None:raise primary
 def write(self,members):
  if self.busy:self.reentry();raise Refusal('packet-reentry')
  need(not self.entered and not self.closed,'closed-or-consumed');self.entered=True;self.busy=True;primary=None
  try:
   self.phase='admission';self.assembly=admit(members);owned=dict(members);self.check();self.phase='writing';root=self.root();self.scan(root,())
   for name in ORDER:
    if name in owned:self.output(root,name,owned[name]);self.check()
   self.scan(root,tuple(owned))
   self.phase='written'
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'filesystem-refused');self.phase='refused';primary=error
  finally:
   for fd in reversed(self.slots[:]):
    if fd is None:continue
    try:self.close_fd(fd)
    except BaseException as error:
     if primary is None:primary=error
   self.busy=False;self.closed=True
   if primary is None and self.first is not None:primary=Refusal(self.first)
   if primary is not None:self.phase='refused'
  if primary is not None:raise primary
  return self.status()
 def close(self):
  if self.busy:self.reentry();raise Refusal('packet-reentry')
  self.closed=True;return self.status()
 def status(self):
  if self.busy:self.reentry()
  return {'schema':'private.full-tree-packet-status.v1','phase':self.phase,'closed':self.closed,'firstFailure':self.first,'fileAttempts':self.attempts,'written':[dict(x) for x in self.written],'closeAttempted':self.close_attempted,'closeRefused':self.close_refused,'directoryScanCloseRefused':self.scan_close_refused,'ownedDescriptors':sum(v is not None for v in self.slots),'handlesClosedWithoutReportedRefusal':self.closed and self.close_refused==0 and self.scan_close_refused==0,'assembly':None if self.assembly is None else dict(self.assembly),'authenticatedContextQualified':False,'profileSourceAdmissionQualified':False,'originalPacketQualified':False,'filesystemLeaseQualified':False,'sourceOwnedQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
