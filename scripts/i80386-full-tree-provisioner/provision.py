"""Manufactured-only full-tree writer prototype; never an archive parser.
Caller parent and content are untrusted, not source-issued archive authority.
Fixed builtin chunk containers only; no producer iterator/callback or caller pins.
"""
import hashlib,json,os,secrets,stat
from pathlib import Path
HERE=Path(__file__).parent
POLICY_MANIFEST_SHA='39955b4c493fe7468d86bf7936a2b427af49fbb938fe0790e92c1881d0bb90b9'
with (HERE/'manifest.json').open('rb') as stream:raw=stream.read(524289)
if len(raw)>524288 or hashlib.sha256(raw).hexdigest()!=POLICY_MANIFEST_SHA:raise ValueError('policy-seal-refused')
ROWS=json.loads(raw)['rows']
NOTICES={
 'djgpp-copying':(18092,'8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643'),
 'djgpp-copying-dj':(2089,'f7b76a85cfe1407ea99a933699f1b9e79e74b7689cf6db9dc7c406f3c02dc884'),
 'djgpp-copying-lib':(26530,'dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551'),
 'gcc-copying-runtime':(3324,'9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74'),
 'gcc-copying3':(35147,'8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903')}
ARCHIVE_PINS=(('toolchain',80596981,'8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'),('djcrx',895256,'22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'),('djdev',2509574,'4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'),('djlsr',2047171,'80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea'))
CONTENT_FILE_CAP=34200152
CONTENT_TOTAL_CAP=258686704
NOTICE_FILE_CAP=65536
NOTICE_TOTAL_CAP=85182
CHUNK=65536
class Refusal(ValueError):pass
def need(ok,why):
 if not ok:raise Refusal(why)
def parts(name):
 need(type(name)is str and 0<len(name)<=240,'path-shape')
 p=name.split('/');need(len(p)<=32 and all(v not in ('','.','..') for v in p) and not any(c in name for c in ('\\',':')) and all(32<=ord(c)<127 for c in name),'path-shape');return p
def identity(r):return r.st_dev,r.st_ino
def file_identity(r):return r.st_dev,r.st_ino,r.st_size,r.st_nlink,r.st_mtime_ns,r.st_ctime_ns

def mapping_admit(supplied,expected):
 need(type(supplied)is dict and len(supplied)==len(expected) and len(supplied)<=1196,'content-shape')
 need(all(type(k)is str and 0<len(k)<=240 for k in supplied),'content-path-set')
 need(set(supplied)==set(expected),'content-path-set')
def container_admit(chunks,extent):
 need(type(chunks)in (tuple,list) and len(chunks)==(extent+CHUNK-1)//CHUNK,'chunk-container')
def chunks_admit(supplied,expected,perfile,totalcap):
 mapping_admit(supplied,expected)
 total=0
 for name,(extent,digest) in expected.items():
  need(type(extent)is int and 0<=extent<=perfile,'extent-cap');total+=extent;need(total<=totalcap,'aggregate-cap')
  chunks=supplied[name];need(type(chunks)in (tuple,list) and len(chunks)==(extent+CHUNK-1)//CHUNK,'chunk-container')
  for i,body in enumerate(chunks):need(type(body)is bytes and len(body)==min(CHUNK,extent-i*CHUNK),'chunk-shape')
 return total

class Provisioner:
 def __init__(self,parent):
  self._first=None;self._phase='new';self._busy=False;self._closed=False
  self._close_fn=os.close;self._slots=[None]*128;self._slot_count=0
  self._close_attempted=0;self._close_refused=0;self._mkdir_attempts=0;self._file_attempts=0;self._alias_attempts=0
  self._ordinary_reserved=0;self._notice_reserved=0;self._written=0;self._notices_written=0;self._linked=0;self._root_name=None
  self._routes={};self._file_facts={};self._notice_facts={};self._alias_counts={};self._entered=False
  # No OS calls in construction. Parent admission runs under the busy fence.
  need(type(parent)is str and len(parent)<=4046 and parent.startswith('/') and '\0'not in parent,'parent-shape')
  need(len(parent.encode('utf8'))<=4046,'parent-shape');self._parent_parts=parent.split('/')[1:]
  need(len(self._parent_parts)<=30 and all(p not in ('','.','..') for p in self._parent_parts),'parent-shape')
 def _fail(self,reason):
  if self._first is None:self._first=reason
 def _check(self):need(self._first is None,'poisoned')
 def _call(self,fn,*args,returns_fd=False,**kwargs):
  self._check()
  try:value=fn(*args,**kwargs)
  except BaseException:
   self._fail('filesystem-refusal');raise
  try:self._check()
  except BaseException:
   if returns_fd:self._close(value)
   raise
  return value
 def _close(self,fd):
  self._close_attempted+=1
  try:self._close_fn(fd)
  except BaseException:self._close_refused+=1;self._fail('cleanup-refusal')
 def _register(self,fd):
  need(type(fd)is int and fd>=0 and self._slot_count<128 and fd not in self._slots,'descriptor-cap')
  self._slots[self._slot_count]=fd;self._slot_count+=1
 def _directory(self,parent,name,key):
  before=self._call(os.stat,name,dir_fd=parent,follow_symlinks=False) if parent is not None else self._call(os.lstat,'/')
  need(stat.S_ISDIR(before.st_mode),'directory-type')
  fd=self._call(os.open,name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent,returns_fd=True)
  try:self._register(fd)
  except BaseException as error:
   self._fail(str(error) if type(error)is Refusal else 'filesystem-refusal')
   # Registration can be interrupted after assignment. Consume any matching
   # directory slot before the one fallback close; never close a reused fd twice.
   for i in range(self._slot_count):
    if self._slots[i]==fd:self._slots[i]=None
   self._close(fd);raise
  opened=self._call(os.fstat,fd);named=self._call(os.stat,name,dir_fd=parent,follow_symlinks=False) if parent is not None else self._call(os.lstat,'/')
  need(stat.S_ISDIR(opened.st_mode) and identity(before)==identity(opened)==identity(named),'directory-race')
  self._routes[key]=(fd,parent,name,identity(opened));return fd
 def _recheck(self):
  for fd,parent,name,pinned in self._routes.values():
   opened=self._call(os.fstat,fd);named=self._call(os.stat,name,dir_fd=parent,follow_symlinks=False) if parent is not None else self._call(os.lstat,'/')
   need(stat.S_ISDIR(opened.st_mode) and stat.S_ISDIR(named.st_mode) and identity(opened)==identity(named)==pinned,'route-changed')
 def _mkdir(self,parent,name,key):
  self._recheck();self._mkdir_attempts+=1;self._call(os.mkdir,name,0o700,dir_fd=parent);return self._directory(parent,name,key)
 def _setup(self):
  parent=self._directory(None,'/','osroot')
  for i,name in enumerate(self._parent_parts):parent=self._directory(parent,name,('parent',i))
  self._root_name='provision-'+secrets.token_hex(8);need(type(self._root_name)is str and len(self._root_name)==26,'session-name')
  session=self._mkdir(parent,self._root_name,'session');tool=self._mkdir(session,'tool','tool');notices=self._mkdir(session,'notices','notices')
  directories=[r['path'] for r in ROWS if r['type']=='directory'];need(len(directories)<=78,'directory-cap')
  for name in sorted(directories,key=lambda n:(len(parts(n)),n)):
   ps=parts(name);up=tool if len(ps)==1 else self._routes[('tool', '/'.join(ps[:-1]))][0]
   self._mkdir(up,ps[-1],('tool',name))
  return tool,notices
 def _location(self,tool,name):
  ps=parts(name);return (tool if len(ps)==1 else self._routes[('tool','/'.join(ps[:-1]))][0]),ps[-1]
 def _verify(self,parent,name,fd,extent,digest,links=1):
  before=self._call(os.fstat,fd);need(stat.S_ISREG(before.st_mode) and before.st_nlink==links and before.st_size==extent,'output-shape')
  h=hashlib.sha256();count=0
  while count<=extent:
   body=self._call(os.pread,fd,min(CHUNK,extent+1-count),count)
   if not body:break
   count+=len(body);need(count<=extent,'readback-extent');h.update(body);self._check()
  after=self._call(os.fstat,fd);named=self._call(os.stat,name,dir_fd=parent,follow_symlinks=False)
  need(count==extent and h.hexdigest()==digest and file_identity(before)==file_identity(after)==file_identity(named),'output-readback-or-race');return identity(after)
 def _write(self,parent,name,chunks,extent,digest,notice=False):
  self._recheck();container_admit(chunks,extent)
  if notice:self._notice_reserved+=extent;need(self._notice_reserved<=NOTICE_TOTAL_CAP,'notice-cap')
  else:self._ordinary_reserved+=extent;need(self._ordinary_reserved<=CONTENT_TOTAL_CAP,'content-cap')
  self._file_attempts+=1
  fd=self._call(os.open,name,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent,returns_fd=True)
  primary=None;result=None
  try:
   initial=self._call(os.fstat,fd);need(stat.S_ISREG(initial.st_mode) and initial.st_nlink==1 and initial.st_size==0,'initial-output-shape')
   h=hashlib.sha256();count=0
   container_admit(chunks,extent)
   for i,body in enumerate(chunks):
    self._check();need(type(chunks)in (tuple,list) and len(chunks)==(extent+CHUNK-1)//CHUNK and i<(extent+CHUNK-1)//CHUNK and type(body)is bytes and len(body)==min(CHUNK,extent-i*CHUNK),'chunk-shape');offset=0
    while offset<len(body):
     n=self._call(os.write,fd,body[offset:]);need(type(n)is int and 0<n<=len(body)-offset,'write-progress');offset+=n;count+=n
    h.update(body);self._check()
   need(count==extent and h.hexdigest()==digest,'content-hash');result=self._verify(parent,name,fd,extent,digest)
   self._recheck()
  except BaseException as error:self._fail(str(error) if type(error)is Refusal else 'filesystem-refusal');primary=error
  finally:self._close(fd)
  if primary is not None:raise primary
  self._check();return result
 def _link(self,tool,row):
  self._recheck();srcparent,srcname=self._location(tool,row['resolved']);dstparent,dstname=self._location(tool,row['path'])
  target=self._call(os.stat,srcname,dir_fd=srcparent,follow_symlinks=False);done=self._alias_counts.get(row['resolved'],0)
  need(stat.S_ISREG(target.st_mode) and identity(target)==self._file_facts[row['resolved']] and target.st_nlink==1+done,'alias-target-before')
  self._alias_attempts+=1;self._call(os.link,srcname,dstname,src_dir_fd=srcparent,dst_dir_fd=dstparent,follow_symlinks=False)
  after=self._call(os.stat,srcname,dir_fd=srcparent,follow_symlinks=False);alias=self._call(os.stat,dstname,dir_fd=dstparent,follow_symlinks=False)
  need(stat.S_ISREG(after.st_mode) and stat.S_ISREG(alias.st_mode) and identity(target)==identity(after)==identity(alias) and after.st_nlink==alias.st_nlink==2+done,'alias-target-after')
  self._alias_counts[row['resolved']]=done+1;self._linked+=1;self._recheck()
 def _final_links(self,tool):
  # After ALL physical aliases, re-observe every ordinary file's bytes and link
  # count; alias names then join the canonical identities. This is finite, not
  # a continuous filesystem lease or hostile-process namespace proof.
  for row in ROWS:
   if row['type']!='file':continue
   parent,name=self._location(tool,row['path']);self._recheck()
   fd=self._call(os.open,name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK,dir_fd=parent,returns_fd=True);primary=None
   try:
    observed=self._verify(parent,name,fd,row['bytes'],row['sha256'],1+self._alias_counts.get(row['path'],0))
    need(observed==self._file_facts[row['path']],'final-file-identity')
   except BaseException as error:self._fail(str(error) if type(error)is Refusal else 'filesystem-refusal');primary=error
   finally:self._close(fd)
   if primary is not None:raise primary
   self._check()
  for row in ROWS:
   if row['type']!='hardlink':continue
   parent,name=self._location(tool,row['path']);r=self._call(os.stat,name,dir_fd=parent,follow_symlinks=False);target=row['resolved']
   expected=next(f for f in ROWS if f['path']==target)
   need(stat.S_ISREG(r.st_mode) and identity(r)==self._file_facts[target] and r.st_size==expected['bytes'] and r.st_nlink==1+self._alias_counts[target],'final-link-count')
  self._recheck()
 def _final_notices(self,notice_root):
  for name,(extent,digest) in NOTICES.items():
   self._recheck();fd=self._call(os.open,name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK,dir_fd=notice_root,returns_fd=True);primary=None
   try:
    observed=self._verify(notice_root,name,fd,extent,digest)
    need(observed==self._notice_facts[name],'final-notice-identity')
   except BaseException as error:self._fail(str(error) if type(error)is Refusal else 'filesystem-refusal');primary=error
   finally:self._close(fd)
   if primary is not None:raise primary
   self._check()
 def _cleanup(self):
  for i in range(self._slot_count-1,-1,-1):
   fd=self._slots[i]
   if fd is not None:self._slots[i]=None;self._close(fd)
 def provision(self,contents,notices):
  if self._busy:self._fail('observer-reentry');raise Refusal('observer-reentry')
  need(not self._entered and not self._closed,'closed-or-consumed');self._entered=True;self._busy=True;primary=None
  try:
   expected={r['path']:(r['bytes'],r['sha256']) for r in ROWS if r['type']=='file'}
   need(len(ROWS)<=1287 and len(expected)<=1196,'inventory-cap')
   chunks_admit(contents,expected,CONTENT_FILE_CAP,CONTENT_TOTAL_CAP);chunks_admit(notices,NOTICES,NOTICE_FILE_CAP,NOTICE_TOTAL_CAP)
   tool,notice_root=self._setup();self._phase='writing'
   for name,(extent,digest) in expected.items():
    mapping_admit(contents,expected)
    parent,leaf=self._location(tool,name);self._file_facts[name]=self._write(parent,leaf,contents[name],extent,digest);self._written+=1
   for name,(extent,digest) in NOTICES.items():
    mapping_admit(notices,NOTICES)
    self._notice_facts[name]=self._write(notice_root,name,notices[name],extent,digest,True);self._notices_written+=1
   aliases=[r for r in ROWS if r['type']=='hardlink'];need(len(aliases)<=13,'alias-cap')
   for row in aliases:self._link(tool,row)
   self._final_links(tool);self._final_notices(notice_root);self._phase='observed-complete'
  except BaseException as error:self._fail(str(error) if type(error)is Refusal else 'filesystem-refusal');primary=error;self._phase='refused'
  finally:
   self._cleanup();self._busy=False;self._closed=True
  if primary is not None:raise primary
  self._check();return self.status()
 def close(self):
  if self._busy:self._fail('observer-reentry');raise Refusal('observer-reentry')
  if self._closed:return self.status()
  self._closed=True;self._busy=True
  try:self._cleanup()
  finally:self._busy=False;self._phase='closed'
  return self.status()
 def status(self):
  if self._busy:self._fail('observer-reentry')
  return {'schema':'private.full-tree-writer-status.v1','phase':self._phase,'firstFailure':self._first,'closed':self._closed,'mkdirAttempts':self._mkdir_attempts,'fileAttempts':self._file_attempts,'aliasAttempts':self._alias_attempts,'ordinaryReservedBytes':self._ordinary_reserved,'noticeReservedBytes':self._notice_reserved,'ordinaryFilesWritten':self._written,'selectedNoticeSubsetWritten':self._notices_written,'physicalAliasesObserved':self._linked,'closeAttempted':self._close_attempted,'closeRefused':self._close_refused,'handlesClosedWithoutReportedRefusal':self._closed and self._close_refused==0,'observedPrototypeComplete':self._phase=='observed-complete' and self._first is None,'sourceOwnedQualified':False,'parentTrustQualified':False,'filesystemLeaseQualified':False,'rawArchiveCompatibilityQualified':False,'minimalCClosureQualified':False,'fullToolchainReady':False,'completeNoticeRetentionQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
