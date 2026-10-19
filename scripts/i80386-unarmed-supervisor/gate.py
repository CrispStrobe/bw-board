"""Portable unarmed exact profile source-position gate; no imports or Git execution."""
import os,stat,json,re,hashlib
EXTERNAL_DESCRIPTOR_SHA256=None
INHERITED={'scripts/i80386-djgpp-notice-extractor/README.md': {'bytes': 5233, 'sha256': '0d3aa04e84ef72d6ee99a6e69ebaa8c12cf15823486561daee9eb4366566f769', 'gitBlob': 'bf6c36ac0e6ec1a79551895e088ba6d9ad2345de'}, 'scripts/i80386-djgpp-notice-extractor/controls.py': {'bytes': 10369, 'sha256': 'c0bb4b39195b62b9befa7eb96ab90281f091c704f4d9e754e26388110d85551f', 'gitBlob': '29c76a09ac9e50bda7558dee18c3a9ea548f05a6'}, 'scripts/i80386-djgpp-notice-extractor/extractor.py': {'bytes': 8801, 'sha256': 'bde66cf5de7fc0d02508d88176e51b47a3acf208770bbd8904afa87c9eb3d501', 'gitBlob': 'a2414e18eaf2e1f6c1464f04afe6d0c103150a01'}, 'scripts/i80386-full-tree-archive-bridge/README.md': {'bytes': 5899, 'sha256': '5990fe67175c4c2a5b7abfa62485ce8bf9f1fdaa122ccc078ca088c49a6f3eb8', 'gitBlob': '6cbdde0ea93a9a8a51dfa4748a268eda306c5a2a'}, 'scripts/i80386-full-tree-archive-bridge/bridge.py': {'bytes': 9562, 'sha256': 'f9c408854dc983274787c266f1a32be50f364e313a281603117a972d292a33d0', 'gitBlob': 'b3f342cb11831b616880ccca15d8099202bf6807'}, 'scripts/i80386-full-tree-archive-bridge/controls.py': {'bytes': 12528, 'sha256': 'a65ade6ec2b7ad03bcdaafb80dc2cdcd415980b1a317d76de87fd39abdf44170', 'gitBlob': '47426d44214d4991bc96427588adc0eef4ad78ed'}, 'scripts/i80386-full-tree-notice-connection/README.md': {'bytes': 5260, 'sha256': 'efc7fe41b267eeb27d887cdfa0b98ea53a4f22df8ac99cf5b5c59e112e07fa5e', 'gitBlob': '8adb1949d663de44be1a569a5aa5c8eb68131a92'}, 'scripts/i80386-full-tree-notice-connection/controls.py': {'bytes': 10312, 'sha256': '51bfcc82d5805f3951395415cd007b32b9182088a9024b0fe884a713df29a5e8', 'gitBlob': '8ecccd485eefd70b649e73542d23085db1923a0b'}, 'scripts/i80386-full-tree-notice-connection/coordinator.py': {'bytes': 7975, 'sha256': '0db65c2067c6e9e3945b5b3ce6c73ded47052c827ae07e876bd9d545016265e7', 'gitBlob': '08c47105a5a786a5430a78d0b20b9dc684704349'}, 'scripts/i80386-full-tree-provisioner/README.md': {'bytes': 6256, 'sha256': 'ec09d6db103bfe6464c805e8c08abc94620bb3b254874a3634c29e48e2d2bae9', 'gitBlob': '3c8bcc4366d1ba0e7b407531caf1e27768ed271d'}, 'scripts/i80386-full-tree-provisioner/controls.py': {'bytes': 12294, 'sha256': '68514bbc1ef4610259d21ebb445b0e72ca0fbb1f2d1d3bf3c586660f9a004a6a', 'gitBlob': 'fb9ada9482555bc91deb3a46d30444e3173712ce'}, 'scripts/i80386-full-tree-provisioner/manifest.json': {'bytes': 289038, 'sha256': '39955b4c493fe7468d86bf7936a2b427af49fbb938fe0790e92c1881d0bb90b9', 'gitBlob': '06807fd9952c5cd518e59cef5eff6721dd301a4d'}, 'scripts/i80386-full-tree-provisioner/provenance.json': {'bytes': 1598, 'sha256': '8a7a991dbab3b981602168201d66a1e6d7e79582386f307b854cd573232ef453', 'gitBlob': 'b923493f0d06e163cbdbd67d5f57a77b2fcd0d36'}, 'scripts/i80386-full-tree-provisioner/provision.py': {'bytes': 15126, 'sha256': 'e0a844ce3445b344a02e09ebee02ce8eca4a9ef7afc5a26d741b00902db561a2', 'gitBlob': 'b11d4ee2e5f64c7d402eabf1f5151fc077d18a5a'}}
KINDS=('inherited','runner','packet','admission','admission-control','executor','executor-control','workflow','config','control','readme')
REQUIRED=('runner','packet','admission','admission-control','executor','executor-control','workflow')
FLAGS=('profileSourceAdmissionQualified','gitJoinImplemented','continuousSourceOwnershipQualified','inputLeaseQualified','filesystemLeaseQualified','compilerQualified','guestQualified','performanceQualified')
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def keys(v,wanted):need(type(v)is dict and len(v)==len(wanted) and all(type(k)is str and len(k)<=240 for k in v) and set(v)==set(wanted),'closed-shape')
def integer(v,a,b):need(type(v)is int and a<=v<=b,'integer')
def digest(v,n):need(type(v)is str and len(v)==n and re.fullmatch('[0-9a-f]{%d}'%n,v)is not None,'digest')
def path(v):
 need(type(v)is str and 0<len(v)<=240,'path');parts=v.split('/');need(len(parts)<=30 and all(p not in ('','.','..') and len(p)<=255 and re.fullmatch('[A-Za-z0-9_.-]+',p)is not None for p in parts),'path');return parts
def bounded(v,depth=0,budget=None):
 if budget is None:budget=[3000]
 budget[0]-=1;need(budget[0]>=0 and depth<=6,'json-cap')
 if v is None or type(v)is bool:return
 if type(v)is int:integer(v,0,2**64-1);return
 if type(v)is str:need(len(v)<=512,'json-cap');return
 need(type(v)is dict and len(v)<=100 and all(type(k)is str and len(k)<=240 for k in v),'json-shape')
 for x in v.values():bounded(x,depth+1,budget)
def load(raw,cap):
 need(type(raw)is bytes and len(raw)<=cap,'json-cap')
 def pairs(rows):
  out={}
  for k,v in rows:need(k not in out,'duplicate-json');out[k]=v
  return out
 def bad(_):raise Refusal('json-number')
 try:v=json.loads(raw.decode('utf8'),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
 except Refusal:raise
 except (ValueError,UnicodeError,RecursionError):raise Refusal('json-parse') from None
 bounded(v);return v
def blob(raw):return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
def _git(operation,relative=None):raise Refusal('git-unimplemented')
class Gate:
 def __init__(self,checkout,descriptor_raw,table_raw):
  need(type(checkout)is str and len(checkout)<=4096,'checkout');need(checkout.startswith('/') and '\0'not in checkout and len(checkout.encode('utf8'))<=4096,'checkout');parts=checkout.split('/')[1:];need(len(parts)<=30 and all(p not in ('','.','..') for p in parts),'checkout');need(type(descriptor_raw)is bytes and len(descriptor_raw)<=8192 and type(table_raw)is bytes and len(table_raw)<=65536,'json-cap')
  self.parts=parts;self.descriptor_raw=descriptor_raw;self.table_raw=table_raw;self.busy=False;self.closed=False;self.phase='new';self.first=None;self.close_attempted=0;self.close_refused=0;self.file_observations=0;self.total_read=0;self.fds=[None]*64;self.close_fn=os.close;self.before=None;self.after=None;self.routes={}
 def fail(self,code):
  if self.first is None:self.first=code
 def check(self):need(self.first is None,'poisoned')
 def call(self,fn,*a,**k):self.check();v=fn(*a,**k);self.check();return v
 def closing(self,fd):
  for i,x in enumerate(self.fds):
   if x==fd:
    self.fds[i]=None;self.routes.pop(fd,None);self.close_attempted+=1
    try:self.close_fn(fd)
    except BaseException:self.close_refused+=1;self.fail('cleanup-refused');raise
    return
 def opening(self,*a,**k):
  self.check();fd=os.open(*a,**k)
  try:need(type(fd)is int and fd>=0 and fd not in self.fds,'descriptor');i=self.fds.index(None);self.fds[i]=fd;self.check();return fd
  except BaseException as error:
   self.fail('filesystem-refused')
   if fd in self.fds:
    try:self.closing(fd)
    except BaseException:pass
   else:
    self.close_attempted+=1
    try:self.close_fn(fd)
    except BaseException:self.close_refused+=1
   raise error
 def directory(self,parent,name):
  before=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False);need(stat.S_ISDIR(before.st_mode),'directory-kind');fd=self.opening(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);opened=self.call(os.fstat,fd);named=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False);need((before.st_dev,before.st_ino)==(opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino) and stat.S_ISDIR(named.st_mode),'directory-race');self.routes[fd]=(parent,name,(before.st_dev,before.st_ino));return fd
 def recheck(self):
  for fd,(parent,name,identity) in self.routes.items():
   opened=self.call(os.fstat,fd);named=self.call(os.stat,name,dir_fd=parent,follow_symlinks=False);need(stat.S_ISDIR(opened.st_mode) and stat.S_ISDIR(named.st_mode) and (opened.st_dev,opened.st_ino)==(named.st_dev,named.st_ino)==identity,'directory-race')
 def sha(self,raw):
  h=self.call(hashlib.sha256,raw);return self.call(h.hexdigest)
 def git_blob(self,raw):
  h=self.call(hashlib.sha1,b'blob '+str(len(raw)).encode()+b'\0'+raw);return self.call(h.hexdigest)
 def read(self,root,relative,extent):
  self.recheck();parts=path(relative);parent=root;local=[];fd=None;primary=None;raw=None
  try:
   for name in parts[:-1]:parent=self.directory(parent,name);local.append(parent)
   before=self.call(os.stat,parts[-1],dir_fd=parent,follow_symlinks=False);need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size==extent,'file-kind');fd=self.opening(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent);opened=self.call(os.fstat,fd);need((before.st_dev,before.st_ino,before.st_size)==(opened.st_dev,opened.st_ino,opened.st_size),'file-race');data=bytearray()
   while True:
    b=self.call(os.read,fd,min(65536,extent+1-len(data)));need(type(b)is bytes,'read-shape')
    if not b:break
    data.extend(b);need(len(data)<=extent,'read-extent')
   need(len(data)==extent,'read-extent');end=self.call(os.fstat,fd);named=self.call(os.stat,parts[-1],dir_fd=parent,follow_symlinks=False);need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns,end.st_ctime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns,named.st_ctime_ns) and end.st_nlink==named.st_nlink==1 and stat.S_ISREG(named.st_mode),'file-race');self.recheck();raw=bytes(data);self.total_read+=len(raw);self.file_observations+=1
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'filesystem-refused');primary=error
  finally:
   for owned in ([fd]if fd is not None else[])+list(reversed(local)):
    try:self.closing(owned)
    except BaseException as error:
     if primary is None:primary=error
  if primary is not None:raise primary
  self.check();return raw
 def admission(self):
  descriptor_raw=self.descriptor_raw;table_raw=self.table_raw;seal=EXTERNAL_DESCRIPTOR_SHA256;need(type(descriptor_raw)is bytes and len(descriptor_raw)<=8192 and type(table_raw)is bytes and len(table_raw)<=65536,'json-cap')
  need(type(seal)is str,'unsealed-descriptor');digest(seal,64);observed=self.sha(descriptor_raw);need(observed==seal,'descriptor-seal');d=load(descriptor_raw,8192);keys(d,('schema','status','head','repository','origin','workflow','branch','pr','tablePath','tableBytes','tableSha256','tableGitBlob'));need(d['schema']=='bw.full-tree-profile-descriptor.v1' and d['status']=='UNARMED_SOURCE_ONLY' and d['repository']=='CrispStrobe/bw-board' and d['origin']=='https://github.com/CrispStrobe/bw-board.git','descriptor-identity');digest(d['head'],40);integer(d['pr'],1,2**63-1);path(d['workflow']);need(d['workflow'].startswith('.github/workflows/') and d['workflow'].endswith('.yml'),'workflow');need(type(d['branch'])is str and 1<=len(d['branch'])<=120 and re.fullmatch('[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',d['branch'])is not None,'branch');path(d['tablePath']);integer(d['tableBytes'],1,65536);digest(d['tableSha256'],64);digest(d['tableGitBlob'],40);need(len(table_raw)==d['tableBytes'] and self.sha(table_raw)==d['tableSha256'] and self.git_blob(table_raw)==d['tableGitBlob'],'table-seal');self.check();t=load(table_raw,65536);keys(t,('schema','inheritedRoleCount','roles'));need(t['schema']=='bw.full-tree-profile-role-table.v1' and type(t['inheritedRoleCount'])is int and t['inheritedRoleCount']==14,'table-schema');roles=t['roles'];need(type(roles)is dict and 21<=len(roles)<=100 and all(type(k)is str and len(k)<=240 for k in roles),'role-count');need(d['tablePath']not in roles,'cyclic-table');seen=[]
  for name,row in roles.items():
   path(name);keys(row,('kind','bytes','sha256','gitBlob'));need(type(row['kind'])is str and row['kind']in KINDS,'role-kind');integer(row['bytes'],1,524288);digest(row['sha256'],64);digest(row['gitBlob'],40);seen.append(row['kind'])
   if row['kind']=='inherited':need(name in INHERITED and row=={'kind':'inherited',**INHERITED[name]},'inherited-role')
  need(seen.count('inherited')==14 and all(k in seen for k in REQUIRED),'role-closure');need(d['workflow']in roles and roles[d['workflow']]['kind']=='workflow','workflow-role');path(d['branch']);seen_paths=set();required_dirs=set()
  for name in (*roles,d['tablePath']):
   parts=path(name);need(name not in seen_paths and name not in required_dirs,'role-ancestor')
   for i in range(1,len(parts)):
    ancestor='/'.join(parts[:i]);need(ancestor not in seen_paths,'role-ancestor');required_dirs.add(ancestor)
   seen_paths.add(name)
  return d,roles,seal,table_raw
 def observe(self,position):
  if self.busy:self.fail('gate-reentry');raise Refusal('gate-reentry')
  need(type(position)is str and position in ('before','after') and not self.closed and ((position=='before'and self.phase=='new')or(position=='after'and self.phase=='before')),'phase-order');self.busy=True;primary=None;result=None
  try:
   d,roles,admitted_seal,admitted_table=self.admission();need(self.call(_git,'head')==d['head'] and self.call(_git,'origin')==d['origin'] and self.call(_git,'detached')is True and self.call(_git,'clean')is True,'git-context');root=self.opening('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
   for component in self.parts:root=self.directory(root,component)
   observed={}
   for name,row in roles.items():
    git_raw=self.call(_git,'blob',name);need(type(git_raw)is bytes and len(git_raw)==row['bytes'],'git-blob');need(self.sha(git_raw)==row['sha256'] and self.git_blob(git_raw)==row['gitBlob'],'git-blob');self.check();raw=self.read(root,name,row['bytes']);need(self.sha(raw)==row['sha256'],'live-hash');observed[name]=dict(row)
   git_raw=self.call(_git,'blob',d['tablePath']);need(type(git_raw)is bytes and len(git_raw)==d['tableBytes'] and self.sha(git_raw)==d['tableSha256'] and self.git_blob(git_raw)==d['tableGitBlob'] and git_raw==admitted_table,'git-table');raw=self.read(root,d['tablePath'],d['tableBytes']);need(self.sha(raw)==d['tableSha256'] and self.git_blob(raw)==d['tableGitBlob'] and raw==admitted_table,'live-table');self.recheck();need(self.call(_git,'head')==d['head'] and self.call(_git,'origin')==d['origin'] and self.call(_git,'detached')is True and self.call(_git,'clean')is True,'git-context');result={'schema':'bw.full-tree-profile-source.v1','position':position,'head':d['head'],'repository':d['repository'],'roleCount':len(roles),'roles':observed,'table':{'path':d['tablePath'],'bytes':d['tableBytes'],'sha256':d['tableSha256'],'gitBlob':d['tableGitBlob']},'descriptorSha256':admitted_seal,**{k:False for k in FLAGS}};need(len(json.dumps(result,separators=(',',':')).encode())<=65536,'snapshot-cap');self.check();setattr(self,position,result);self.phase=position
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'filesystem-refused');primary=error
  finally:
   for fd in reversed(self.fds[:]):
    if fd is None:continue
    try:self.closing(fd)
    except BaseException as error:
     if primary is None:primary=error
   if primary is None and self.first is not None:primary=Refusal(self.first)
   self.busy=False
   if primary is not None:self.phase='refused';self.closed=True
   elif position=='after':self.closed=True
  if primary is not None:raise primary
  return json.loads(json.dumps(result))
 def close(self):
  if self.busy:self.fail('gate-reentry');raise Refusal('gate-reentry')
  self.closed=True;return self.status()
 def status(self):
  if self.busy:self.fail('gate-reentry')
  return {'schema':'private.full-tree-profile-gate-status.v1','phase':self.phase,'closed':self.closed,'firstFailure':self.first,'fileObservations':self.file_observations,'contentBytesRead':self.total_read,'closeAttempted':self.close_attempted,'closeRefused':self.close_refused,'ownedDescriptors':sum(fd is not None for fd in self.fds),'beforeObserved':self.before is not None,'afterObserved':self.after is not None,**{k:False for k in FLAGS}}
