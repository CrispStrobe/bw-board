"""Unconnected fixed-operation Git plumbing for manufactured repositories."""
import os,stat,json,re,hashlib,subprocess,selectors,time,signal
EXTERNAL_DESCRIPTOR_SHA256=None
GIT='/usr/bin/git'
ENV={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null','GIT_OPTIONAL_LOCKS':'0','GIT_NO_LAZY_FETCH':'1','GIT_TERMINAL_PROMPT':'0','GIT_ATTR_NOSYSTEM':'1','GIT_PAGER':'','PAGER':''}
PREFIX=(GIT,'--no-replace-objects','--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.attributesFile=/dev/null','-c','diff.external=','-c','protocol.allow=never','-c','protocol.file.allow=never','-c','fetch.recurseSubmodules=false')
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def path(v):
 need(type(v)is str and 1<=len(v)<=240,'path');parts=v.split('/');need(len(parts)<=30 and all(p not in ('','.','..')and re.fullmatch('[A-Za-z0-9_.-]+',p)is not None for p in parts),'path');return parts
def sha(v,n):need(type(v)is str and len(v)==n and re.fullmatch('[0-9a-f]{%d}'%n,v)is not None,'digest')
def load(raw,cap):
 need(type(raw)is bytes and len(raw)<=cap,'json-cap')
 def pairs(items):
  d={}
  for k,v in items:need(k not in d,'duplicate-json');d[k]=v
  return d
 def bad(_):raise Refusal('json-number')
 try:return json.loads(raw.decode('utf8'),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
 except Refusal:raise
 except (ValueError,UnicodeError,RecursionError):raise Refusal('json-parse')from None
def keys(v,w):need(type(v)is dict and len(v)==len(w)and all(type(k)is str and len(k)<=240 for k in v)and set(v)==set(w),'closed-shape')
def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
class Adapter:
 def __init__(self,checkout,descriptor_raw,table_raw):
  need(type(checkout)is str and len(checkout)<=4096 and checkout.startswith('/')and '\0'not in checkout,'checkout');need(len(checkout.encode())<=4096,'checkout');parts=checkout.split('/')[1:];need(len(parts)<=30 and all(p not in ('','.','..')for p in parts),'checkout');need(type(descriptor_raw)is bytes and len(descriptor_raw)<=8192 and type(table_raw)is bytes and len(table_raw)<=65536,'json-cap')
  self.parts=parts;self.descriptor_raw=descriptor_raw;self.table_raw=table_raw;self.d=None;self.rows=None;self.first=None;self.busy=False;self.closed=False;self.counts={};self.commands=0;self.stdout_bytes=0;self.stderr_bytes=0;self.close_refused=0;self.close_attempted=0;self.process_cleanup_refused=0;self.slots=[None]*64;self.routes={};self._root=None;self.close_fn=os.close;self.started=None;self.current=None;self.command_busy=False
 def fail(self,code):
  if self.first is None:self.first=code
 def check(self):need(self.first is None,'poisoned')
 def call(self,fn,*a,**kw):self.check();v=fn(*a,**kw);self.check();return v
 def close_fd(self,fd):
  for i,x in enumerate(self.slots):
   if x==fd:
    self.slots[i]=None;self.routes.pop(fd,None);self.close_attempted+=1
    try:self.close_fn(fd)
    except BaseException:self.close_refused+=1;self.fail('close-refused');raise
    return
 def opening(self,*a,**kw):
  self.check();fd=os.open(*a,**kw)
  try:need(type(fd)is int and fd>=0 and fd not in self.slots,'descriptor');i=self.slots.index(None);self.slots[i]=fd;self.check();return fd
  except BaseException as error:
   self.fail(str(error)if type(error)is Refusal else'descriptor-registration-refused')
   if fd in self.slots:
    try:self.close_fd(fd)
    except BaseException:pass
   else:
    self.close_attempted+=1
    try:self.close_fn(fd)
    except BaseException:self.close_refused+=1
   raise error
 def directory(self,parent,name):
  before=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False);need(stat.S_ISDIR(before.st_mode),'directory-kind');fd=self.opening(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);a=self.call(os.fstat,fd);b=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False);need((before.st_dev,before.st_ino)==(a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)and stat.S_ISDIR(b.st_mode),'directory-race');self.routes[fd]=(parent,name,(a.st_dev,a.st_ino));return fd
 def recheck(self):
  for fd,(parent,name,identity)in self.routes.items():
   a=self.call(os.fstat,fd);b=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False);need(stat.S_ISDIR(a.st_mode)and stat.S_ISDIR(b.st_mode)and(a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)==identity,'directory-race')
 def sha256(self,raw):
  h=self.call(hashlib.sha256,raw);return self.call(h.hexdigest)
 def git_blob(self,raw):
  h=self.call(hashlib.sha1,b'blob '+str(len(raw)).encode()+b'\0'+raw);return self.call(h.hexdigest)
 def admission(self):
  dr=self.descriptor_raw;tr=self.table_raw;seal=EXTERNAL_DESCRIPTOR_SHA256;need(type(seal)is str,'unsealed');sha(seal,64);need(self.sha256(dr)==seal,'descriptor-seal');d=load(dr,8192);keys(d,('schema','status','head','repository','origin','workflow','branch','pr','tablePath','tableBytes','tableSha256','tableGitBlob'));need(d['schema']=='bw.full-tree-profile-descriptor.v1'and d['status']=='UNARMED_SOURCE_ONLY'and d['repository']=='CrispStrobe/bw-board'and d['origin']=='https://github.com/CrispStrobe/bw-board.git','descriptor');sha(d['head'],40);path(d['workflow']);path(d['tablePath']);need(type(d['tableBytes'])is int and len(tr)==d['tableBytes']<=65536,'table-extent');sha(d['tableSha256'],64);sha(d['tableGitBlob'],40);need(self.sha256(tr)==d['tableSha256']and self.git_blob(tr)==d['tableGitBlob'],'table-seal');self.check();t=load(tr,65536);keys(t,('schema','inheritedRoleCount','roles'));need(t['schema']=='bw.full-tree-profile-role-table.v1'and type(t['inheritedRoleCount'])is int and t['inheritedRoleCount']==14,'table');rows=t['roles'];need(type(rows)is dict and 21<=len(rows)<=100 and all(type(k)is str and len(k)<=240 for k in rows),'rows');need(d['tablePath']not in rows,'table-cycle');owned={}
  for name,row in rows.items():
   path(name);keys(row,('kind','bytes','sha256','gitBlob'));need(type(row['kind'])is str and 0<len(row['kind'])<=32 and type(row['bytes'])is int and 0<row['bytes']<=524288,'row');sha(row['sha256'],64);sha(row['gitBlob'],40);owned[name]=dict(row)
  owned[d['tablePath']]={'kind':'table','bytes':len(tr),'sha256':d['tableSha256'],'gitBlob':d['tableGitBlob']};self.d=dict(d);self.rows=owned;self.started=self.call(time.monotonic);root=self.opening('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  for component in self.parts:root=self.directory(root,component)
  gitdir=self.directory(root,'.git');objects=self.directory(gitdir,'objects');info=self.directory(objects,'info');self._root=root
  # External object stores are deliberately unsupported in this first adapter.
  for parent,name in ((info,'alternates'),(gitdir,'shallow')):
   try:st=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False)
   except FileNotFoundError:continue
   need(stat.S_ISREG(st.st_mode)and st.st_size==0,'external-object-store')
 def command_spec(self):
  need(self.busy and not self.closed and type(self.current)is tuple,'command-entry');operation,relative=self.current
  if operation=='head':return ((('rev-parse','--verify','HEAD'),41,(0,)),)
  if operation=='origin':return ((('config','--local','--no-includes','--get','remote.origin.url'),128,(0,)),)
  if operation=='detached':return ((('symbolic-ref','-q','HEAD'),256,(1,)),)
  if operation=='clean':return ((('diff-index','--cached','--raw','-z','--no-ext-diff','--no-textconv','--ignore-submodules=all',self.d['head'],'--'),4096,(0,)),)
  need(operation=='blob' and relative in self.rows,'command-entry');return ((('ls-tree','-z',self.d['head'],'--',relative),1024,(0,)),(('cat-file','blob',self.d['head']+':'+relative),self.rows[relative]['bytes'],(0,)))
 def command(self,args,stdout_cap,accepted=(0,)):
  if self.command_busy:self.fail('adapter-reentry');raise Refusal('adapter-reentry')
  need(type(args)is tuple and type(stdout_cap)is int and type(accepted)is tuple and all(type(v)is int for v in accepted),'command-entry');need((args,stdout_cap,accepted)in self.command_spec(),'command-entry');self.command_busy=True
  proc=None;sel=None;primary=None;out=bytearray();err=bytearray()
  try:
   self.recheck();self.check();need(type(args)is tuple and len(args)<=12 and all(type(x)is str and len(x)<=300 for x in args),'argv');self.commands+=1;need(self.commands<=424,'command-cap');now=self.call(time.monotonic);need(now-self.started<=120,'aggregate-deadline');deadline=min(now+5,self.started+120)
   proc=subprocess.Popen((*PREFIX,*args),cwd='/proc/self/fd/%d'%self._root,pass_fds=(self._root,),env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);self.check();sel=selectors.DefaultSelector();self.check()
   for f in (proc.stdout,proc.stderr):os.set_blocking(f.fileno(),False);self.check();sel.register(f,selectors.EVENT_READ);self.check()
   while sel.get_map():
    self.check();remaining=deadline-self.call(time.monotonic);need(remaining>0,'command-deadline')
    events=sel.select(min(remaining,.1));self.check()
    for key,_ in events:
     target=out if key.fileobj is proc.stdout else err;cap=stdout_cap if target is out else 4096;data=self.call(os.read,key.fileobj.fileno(),min(65536,cap+1-len(target)))
     if not data:sel.unregister(key.fileobj);self.check();continue
     need(len(target)+len(data)<=cap,'command-output-cap');target.extend(data)
   remaining=deadline-self.call(time.monotonic);need(remaining>0,'command-deadline');code=proc.wait(timeout=remaining);self.check();need(code in accepted,'git-exit');self.recheck()
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'command-refused');primary=error
  finally:
   if proc is not None:
    if primary is not None:
     try:os.killpg(proc.pid,signal.SIGKILL)
     except ProcessLookupError:pass
     except BaseException:self.process_cleanup_refused+=1
    try:proc.wait(timeout=1)
    except BaseException:self.process_cleanup_refused+=1
    for f in (proc.stdout,proc.stderr):
     if f is not None:
      try:f.close()
      except BaseException:self.process_cleanup_refused+=1
   if sel is not None:
    try:sel.close()
    except BaseException:self.process_cleanup_refused+=1
   self.stdout_bytes+=len(out);self.stderr_bytes+=len(err);self.command_busy=False
  if primary is not None:raise primary
  need(self.process_cleanup_refused==0,'process-cleanup-refused');self.check();return bytes(out),code
 def live(self,name,row):
  parent=self._root;local=[];fd=None;primary=None
  try:
   parts=path(name)
   for component in parts[:-1]:parent=self.directory(parent,component);local.append(parent)
   st=self.call(os.stat,parts[-1],dir_fd=parent,follow_symlinks=False);need(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_size==row['bytes'],'live-kind');fd=self.opening(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent);opened=self.call(os.fstat,fd);need((st.st_dev,st.st_ino,st.st_size)==(opened.st_dev,opened.st_ino,opened.st_size),'live-race');h=self.call(hashlib.sha256);count=0
   while True:
    b=self.call(os.read,fd,min(65536,row['bytes']+1-count))
    if not b:break
    count+=len(b);need(count<=row['bytes'],'live-extent');self.call(h.update,b)
   digest=self.call(h.hexdigest);need(count==row['bytes']and digest==row['sha256'],'live-hash');end=self.call(os.fstat,fd);named=self.call(os.stat,parts[-1],dir_fd=parent,follow_symlinks=False);need((st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns)and end.st_nlink==named.st_nlink==1,'live-race');self.recheck()
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'filesystem-refused');primary=error
  finally:
   for fd in ([fd]if fd is not None else[])+list(reversed(local)):
    try:self.close_fd(fd)
    except BaseException as error:
     if primary is None:primary=error
  if primary is not None:raise primary
  self.check()
 def read(self,operation,relative=None):
  if self.busy:self.fail('adapter-reentry');raise Refusal('adapter-reentry')
  need(not self.closed and type(operation)is str and operation in ('head','origin','detached','clean','blob'),'operation');need((operation=='blob')==(relative is not None),'operation-path');self.busy=True;self.current=(operation,relative);primary=None;result=None
  try:
   if self.d is None:self.admission()
   if operation=='blob':path(relative);need(relative in self.rows,'unadmitted-path')
   key=(operation,relative);limit=2 if operation=='blob'else 4;self.counts[key]=self.counts.get(key,0)+1;need(self.counts[key]<=limit,'operation-consumed')
   if operation=='head':out,_=self.command(('rev-parse','--verify','HEAD'),41);need(out==self.d['head'].encode()+b'\n','head-drift');result=self.d['head']
   elif operation=='origin':out,_=self.command(('config','--local','--no-includes','--get','remote.origin.url'),128);need(out==self.d['origin'].encode()+b'\n','origin-drift');result=self.d['origin']
   elif operation=='detached':out,code=self.command(('symbolic-ref','-q','HEAD'),256,(1,));need(code==1 and out==b'','attached-head');result=True
   elif operation=='clean':
    out,_=self.command(('diff-index','--cached','--raw','-z','--no-ext-diff','--no-textconv','--ignore-submodules=all',self.d['head'],'--'),4096);need(out==b'','index-dirty')
    for name,row in self.rows.items():self.live(name,row)
    result=True
   else:
    row=self.rows[relative];out,_=self.command(('ls-tree','-z',self.d['head'],'--',relative),1024);need(out==b'100644 blob '+row['gitBlob'].encode()+b'\t'+relative.encode()+b'\0','blob-mode-identity');out,_=self.command(('cat-file','blob',self.d['head']+':'+relative),row['bytes']);need(len(out)==row['bytes']and self.sha256(out)==row['sha256']and self.git_blob(out)==row['gitBlob'],'blob-content');self.check();result=out
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'operation-refused');primary=error
  finally:self.busy=False;self.current=None
  if primary is not None:
   try:self.close()
   except BaseException:pass
   raise primary
  self.check();return result
 def close(self):
  if self.busy:self.fail('adapter-reentry');raise Refusal('adapter-reentry')
  self.closed=True;self.busy=True;primary=None
  try:
   for fd in reversed(self.slots[:]):
    if fd is None:continue
    try:self.close_fd(fd)
    except BaseException as error:
     if primary is None:primary=error
  finally:self.busy=False
  if primary is None and self.first is not None:primary=Refusal(self.first)
  if primary is not None:raise primary
  return self.status()
 def status(self):
  if self.busy:self.fail('adapter-reentry')
  return {'schema':'private.full-tree-git-adapter-status.v1','closed':self.closed,'firstFailure':self.first,'commands':self.commands,'stdoutBytes':self.stdout_bytes,'stderrBytes':self.stderr_bytes,'closeAttempted':self.close_attempted,'closeRefused':self.close_refused,'processCleanupRefused':self.process_cleanup_refused,'ownedDescriptors':sum(x is not None for x in self.slots),'cleanScope':'INDEX_AND_EXPLICIT_SOURCE_ROLES_ONLY','connectedToGate':False,'operationalSourceAdmissionQualified':False,'continuousSourceOwnershipQualified':False,'filesystemLeaseQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
