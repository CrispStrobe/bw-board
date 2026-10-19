"""Unarmed exact-source admission/transport/coordinator connection."""
import os,json,hashlib,re,types,tempfile,stat
from pathlib import Path
EXTERNAL_APPROVAL_SHA256=None
PATHS={'gate': 'scripts/i80386-full-tree-profile-source/admission.py', 'adapter': 'scripts/i80386-full-tree-profile-source/git-adapter.py', 'transport': 'scripts/i80386-full-tree-provisioning-launcher/transport.py', 'coordinator': 'scripts/i80386-full-tree-notice-connection/coordinator.py'}
FIXED={'scripts/i80386-djgpp-notice-extractor/README.md': '0d3aa04e84ef72d6ee99a6e69ebaa8c12cf15823486561daee9eb4366566f769', 'scripts/i80386-djgpp-notice-extractor/controls.py': 'c0bb4b39195b62b9befa7eb96ab90281f091c704f4d9e754e26388110d85551f', 'scripts/i80386-djgpp-notice-extractor/extractor.py': 'bde66cf5de7fc0d02508d88176e51b47a3acf208770bbd8904afa87c9eb3d501', 'scripts/i80386-full-tree-archive-bridge/README.md': '5990fe67175c4c2a5b7abfa62485ce8bf9f1fdaa122ccc078ca088c49a6f3eb8', 'scripts/i80386-full-tree-archive-bridge/bridge.py': 'f9c408854dc983274787c266f1a32be50f364e313a281603117a972d292a33d0', 'scripts/i80386-full-tree-archive-bridge/controls.py': 'a65ade6ec2b7ad03bcdaafb80dc2cdcd415980b1a317d76de87fd39abdf44170', 'scripts/i80386-full-tree-notice-connection/README.md': 'efc7fe41b267eeb27d887cdfa0b98ea53a4f22df8ac99cf5b5c59e112e07fa5e', 'scripts/i80386-full-tree-notice-connection/controls.py': '51bfcc82d5805f3951395415cd007b32b9182088a9024b0fe884a713df29a5e8', 'scripts/i80386-full-tree-notice-connection/coordinator.py': '0db65c2067c6e9e3945b5b3ce6c73ded47052c827ae07e876bd9d545016265e7', 'scripts/i80386-full-tree-provisioner/README.md': 'ec09d6db103bfe6464c805e8c08abc94620bb3b254874a3634c29e48e2d2bae9', 'scripts/i80386-full-tree-provisioner/controls.py': '68514bbc1ef4610259d21ebb445b0e72ca0fbb1f2d1d3bf3c586660f9a004a6a', 'scripts/i80386-full-tree-provisioner/manifest.json': '39955b4c493fe7468d86bf7936a2b427af49fbb938fe0790e92c1881d0bb90b9', 'scripts/i80386-full-tree-provisioner/provenance.json': '8a7a991dbab3b981602168201d66a1e6d7e79582386f307b854cd573232ef453', 'scripts/i80386-full-tree-provisioner/provision.py': 'e0a844ce3445b344a02e09ebee02ce8eca4a9ef7afc5a26d741b00902db561a2', 'scripts/i80386-full-tree-profile-source/admission.py': '0901f69f1d2ef8870e1716fd7418da247efee00021a8acf3a348cdb0a445ae1f', 'scripts/i80386-full-tree-profile-source/git-adapter.py': '2583a603c356e853c2de3b26f42df65b670143463223b7ff073e31ebb33391d2', 'scripts/i80386-full-tree-provisioning-launcher/transport.py': 'ef29e27fc03d8311f3d2ca354b30fbd0d628de94ee123f061432d2cbaa300842'}
REQUIRED=('scripts/i80386-djgpp-notice-extractor/README.md', 'scripts/i80386-djgpp-notice-extractor/controls.py', 'scripts/i80386-djgpp-notice-extractor/extractor.py', 'scripts/i80386-full-tree-archive-bridge/README.md', 'scripts/i80386-full-tree-archive-bridge/bridge.py', 'scripts/i80386-full-tree-archive-bridge/controls.py', 'scripts/i80386-full-tree-notice-connection/README.md', 'scripts/i80386-full-tree-notice-connection/controls.py', 'scripts/i80386-full-tree-notice-connection/coordinator.py', 'scripts/i80386-full-tree-provisioner/README.md', 'scripts/i80386-full-tree-provisioner/controls.py', 'scripts/i80386-full-tree-provisioner/manifest.json', 'scripts/i80386-full-tree-provisioner/provenance.json', 'scripts/i80386-full-tree-provisioner/provision.py', 'scripts/i80386-full-tree-profile-source/admission.py', 'scripts/i80386-full-tree-profile-source/git-adapter.py', 'scripts/i80386-full-tree-provisioning-launcher/transport.py', 'scripts/i80386-full-tree-provisioning-launcher/controller.py', 'scripts/i80386-full-tree-provisioning-launcher/controller-controls.py', 'scripts/i80386-full-tree-provisioning-launcher/CONTROLLER.md', '.github/workflows/i80386-provisioning-admission-connect.yml')
FLAGS=('actualAcquisitionQualified','profileSourceAdmissionQualified','sourceOwnedQualified','inputLeaseQualified','filesystemLeaseQualified','namespaceModeQualified','completeNoticeCoverageQualified','legalClearanceQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified')
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def raw(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def load(body,cap):
 need(type(body)is bytes and len(body)<=cap,'bytes-cap')
 def pairs(items):
  out={}
  for key,value in items:need(key not in out,'duplicate-json');out[key]=value
  return out
 def bad(_):raise Refusal('json-number')
 try:return json.loads(body.decode('utf8'),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
 except Refusal:raise
 except(ValueError,UnicodeError,RecursionError):raise Refusal('json-parse')from None
def keys(v,names):need(type(v)is dict and len(v)==len(names)and all(type(k)is str for k in v)and set(v)==set(names),'closed-shape')
def path(name):
 need(type(name)is str and 0<len(name)<=240,'path');parts=name.split('/');need(len(parts)<=30 and all(re.fullmatch('[A-Za-z0-9_.-]+',p)is not None and p not in('.','..')for p in parts),'path');return parts
def inherited(full,phase,fixed):
 if full is None:return None
 rows={name:{'bytes':row['bytes'],'sha256':row['sha256']}for name,row in full['roles'].items()if row['kind']=='inherited'};need(set(rows)==set(p for p in fixed if p.startswith(('scripts/i80386-djgpp-','scripts/i80386-full-tree-archive-','scripts/i80386-full-tree-notice-','scripts/i80386-full-tree-provisioner/'))),'projection');return{'schema':'bw.full-tree-actual-source.v1','phase':phase,'head':full['head'],'roleCount':14,'roles':rows}
def positive(s,parent_depth=None):
 if type(s)is not dict:return False
 def closed(v,schema):return type(v)is dict and v.get('schema')==schema and v.get('phase')=='observed-complete' and v.get('closed')is True and v.get('firstFailure')is None
 def ints(v,expected):return all(type(v.get(k))is int and v[k]==n for k,n in expected.items())
 def false(v,keys):return all(v.get(k)is False for k in keys)
 e=s.get('extractorFacts');b=s.get('bridgeFacts');w=b.get('writerStatus') if type(b)is dict else None
 return (closed(s,'bw.notice-connection.v1') and ints(s,{'cleanupRefused':0,'archiveInputsAuthenticated':4,'gccInputsAuthenticated':2,'noticeRolesIssued':5,'noticeBytesIssued':85182}) and s.get('observedInternalSameCallNoticeFlow')is True and false(s,('sourceOwnedQualified','inputLeaseQualified','filesystemLeaseQualified','completeNoticeCoverageQualified','legalClearanceQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified'))
 and closed(e,'bw.djgpp-notice-extractor.v1') and ints(e,{'authenticatedInputs':4}) and e.get('observedSyntheticSelectedConsistency')is True and false(e,('opaqueInputSourceJoinsQualified','actualZipCompatibilityQualified','sourceIssuedHandoffQualified','sourceOwnershipQualified','filesystemLeaseQualified','completeNoticeCoverageQualified','legalClearanceQualified','gccNoticesAcquired','compilerQualified','guestQualified'))
 and closed(b,'bw.full-tree-archive-bridge.v1') and ints(b,{'authenticatedInputs':4,'reservedContentBytes':258686704}) and b.get('gnuPending')is False and b.get('observedPrototypeComplete')is True and b.get('bridgeCleanupRefused')is False and false(b,('opaqueZipSourceJoinsQualified','noticeSourceOwnedQualified','completeNoticesQualified','rawActualArchiveCompatibilityQualified','filesystemLeaseQualified','sourceOwnedQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified'))
 and closed(w,'private.full-tree-writer-status.v1') and ints(w,{'mkdirAttempts':81,'fileAttempts':1201,'aliasAttempts':13,'ordinaryReservedBytes':258686704,'noticeReservedBytes':85182,'ordinaryFilesWritten':1196,'selectedNoticeSubsetWritten':5,'physicalAliasesObserved':13,'closeRefused':0}) and type(w.get('closeAttempted'))is int and w['closeAttempted']>=2484 and (parent_depth is None or w['closeAttempted']==2484+parent_depth) and w.get('handlesClosedWithoutReportedRefusal')is True and w.get('observedPrototypeComplete')is True and false(w,('sourceOwnedQualified','parentTrustQualified','filesystemLeaseQualified','rawArchiveCompatibilityQualified','minimalCClosureQualified','fullToolchainReady','completeNoticeRetentionQualified','compilerQualified','guestQualified','performanceQualified')))
class Controller:
 def __init__(self,checkout,approval_raw,descriptor_raw,table_raw):
  need(type(checkout)is str and len(checkout)<=4046 and checkout.startswith('/')and '\0'not in checkout,'checkout');parts=checkout.split('/')[1:];need(len(parts)<=30 and all(p not in('','.','..')for p in parts),'checkout');need(type(approval_raw)is bytes and len(approval_raw)<=32768 and type(descriptor_raw)is bytes and len(descriptor_raw)<=8192 and type(table_raw)is bytes and len(table_raw)<=65536,'bytes-cap')
  self.checkout=checkout;self._checkout=None;self._paths=None;self._fixed=None;self._positive=None;self.approval_raw=approval_raw;self.descriptor_raw=descriptor_raw;self.table_raw=table_raw;self.busy=False;self.entered=False;self.closed=False;self.first=None;self.secondary=None;self.before=None;self.after=None;self.verified=0;self.phase='new';self.cleanup=0;self.complete=False;self._reentry=False;self._gate=None;self._adapter=None;self._transport=None;self._coordinator=None;self.transport_facts=None;self.coordinator_facts=None;self._output=None;self.modules=None
 def fail(self,code):
  if self.first is None:self.first=code
 def poison(self):
  self._reentry=True;self.fail('controller-reentry')
  for owner,method in((self._gate,'fail'),(self._adapter,'fail'),(self._transport,'_fail')):
   if owner is not None:getattr(owner,method)('controller-reentry')
  if self._coordinator is not None:self._coordinator.reentry()
 def check(self):need(self.first is None,'poisoned')
 def call(self,fn,*args,**kwargs):self.check();value=fn(*args,**kwargs);self.check();return value
 def digest(self,body):
  h=self.call(hashlib.sha256,body);return self.call(h.hexdigest)
 def source(self,name):
  parts=self._checkout.split('/')[1:];need(len(parts)<=30 and all(p not in ('','.','..')for p in parts),'checkout');fds=[];route=[];primary=None;body=None
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
 def _execute(self,name,body):
  module=types.ModuleType('admitted_'+name);module.__file__=str(Path(self._checkout)/self._paths[name]);code=self.call(compile,body,'<approved-connection-component>','exec');self.call(exec,code,module.__dict__);return module
 def bootstrap(self):
  seal=EXTERNAL_APPROVAL_SHA256;approval_raw=self.approval_raw;descriptor_raw=self.descriptor_raw;table_raw=self.table_raw;checkout=self.checkout
  need(type(PATHS)is dict and len(PATHS)==4 and all(type(k)is str and type(v)is str for k,v in PATHS.items())and set(PATHS)=={'gate','adapter','transport','coordinator'},'path-policy');paths=dict(PATHS);need(type(FIXED)is dict and all(type(k)is str and type(v)is str and len(v)==64 for k,v in FIXED.items()),'fixed-policy');fixed=dict(FIXED);required=tuple(REQUIRED);self._checkout=checkout;self._paths=paths;self._fixed=fixed;self._positive=positive
  need(type(seal)is str and re.fullmatch('[0-9a-f]{64}',seal)is not None,'approval-unarmed');need(self.digest(approval_raw)==seal,'approval-seal');a=load(approval_raw,32768);keys(a,('schema','status','head','descriptorSha256','tableSha256','components'));need(a['schema']=='bw.provisioning-controller-approval.v1'and a['status']=='UNARMED_SOURCE_CONNECTION_ONLY','approval');need(self.digest(descriptor_raw)==a['descriptorSha256']and self.digest(table_raw)==a['tableSha256'],'metadata-seal');d=load(descriptor_raw,8192);need(type(a['head'])is str and re.fullmatch('[0-9a-f]{40}',a['head'])is not None and d.get('head')==a['head'],'head');table=load(table_raw,65536);keys(table,('schema','inheritedRoleCount','roles'));roles=table['roles'];need(type(roles)is dict and 21<=len(roles)<=100 and all(type(k)is str for k in roles),'roles');need(set(required)<=set(roles),'source-closure');need(type(d.get('workflow'))is str and d['workflow']in roles and type(roles[d['workflow']])is dict and roles[d['workflow']].get('kind')=='workflow','workflow-role');keys(a['components'],roles);bodies={}
  for name in roles:
   path(name);row=a['components'][name];keys(row,('bytes','sha256'));need(type(row['bytes'])is int and 0<row['bytes']<=524288 and type(row['sha256'])is str and re.fullmatch('[0-9a-f]{64}',row['sha256'])is not None,'component');fact=roles[name];keys(fact,('kind','bytes','sha256','gitBlob'));need(type(fact['kind'])is str and type(fact['bytes'])is int and fact['bytes']==row['bytes']and fact['sha256']==row['sha256']and type(fact['gitBlob'])is str and re.fullmatch('[0-9a-f]{40}',fact['gitBlob'])is not None,'table-component-join');body=self.source(name);need(len(body)==row['bytes']and self.digest(body)==row['sha256'],'component-seal')
   if name in fixed:need(row['sha256']==fixed[name],'fixed-component')
   bodies[name]=body;self.verified+=1
  # All declared executable/data bytes were checked before any component exec.
  modules={name:self._execute(name,bodies[relative])for name,relative in paths.items()};self.check();modules['gate'].EXTERNAL_DESCRIPTOR_SHA256=a['descriptorSha256'];modules['adapter'].EXTERNAL_DESCRIPTOR_SHA256=a['descriptorSha256'];self._adapter=self.call(modules['adapter'].Adapter,checkout,descriptor_raw,table_raw);modules['gate']._git=self._adapter.read;self._gate=self.call(modules['gate'].Gate,checkout,descriptor_raw,table_raw);self.modules=modules;return modules
 def _transport_admit(self):
  self.check();need(self.before is not None and self.phase=='acquiring'and self._gate is not None and self._transport is not None,'transport-source-entry');return True
 def run(self):
  if self.busy:self.poison();raise Refusal('controller-reentry')
  need(not self.entered and not self.closed,'controller-once');self.entered=True;self.busy=True;primary=None;bodies=()
  try:
   self.phase='bootstrap';modules=self.bootstrap();self.phase='source-before';self.before=self.call(self._gate.observe,'before');self.phase='acquiring';self._transport=self.call(modules['transport'].Transport);self._transport._admit=self._transport_admit;bodies=self.call(self._transport.acquire);self.transport_facts=self.call(self._transport.status);need(type(bodies)is tuple and len(bodies)==6 and all(type(body)is bytes for body in bodies),'transport-result');need(self.transport_facts['complete']is True and len(self.transport_facts['inputRows'])==6 and all(row['authenticated']is True for row in self.transport_facts['inputRows']),'transport-incomplete')
   self.phase='coordinator';self._output=self.call(tempfile.mkdtemp,prefix='provisioning-connection-');self._coordinator=self.call(modules['coordinator'].Coordinator,self._output);self.call(self._coordinator.provision,*bodies);self.coordinator_facts=self.call(self._coordinator.status);need(self.call(self._positive,self.coordinator_facts,len(self._output.split('/'))-1),'coordinator-incomplete')
  except BaseException as error:self.fail(str(error)if type(error)is Refusal else'operation-refused');primary=error
  finally:
   bodies=()
   if self._transport is not None:
    try:self.transport_facts=self._transport.status()
    except BaseException:self.secondary=self.secondary or 'transport-status-refused';self.fail('transport-status-refused')
   if self._coordinator is not None:
    try:self._coordinator.close();self.coordinator_facts=self._coordinator.status()
    except BaseException as error:
     self.cleanup+=1;self.secondary=self.secondary or 'coordinator-close-refused';self.fail('coordinator-close-refused')
     if primary is None:primary=error
   if self._gate is not None and self.before is not None and not self._reentry:
    self.phase='source-after'
    try:self.after=self._gate.observe('after')
    except BaseException as error:
     self.secondary=self.secondary or 'source-after-refused';self.fail('source-after-refused')
     if primary is None:primary=error
   for owner in(self._gate,self._adapter):
    if owner is None:continue
    try:owner.close()
    except BaseException as error:
     self.cleanup+=1;self.secondary=self.secondary or 'source-close-refused';self.fail('source-close-refused')
     if primary is None:primary=error
   try:self.complete=primary is None and self.first is None and self.before is not None and self.after is not None and self.cleanup==0 and self.coordinator_facts is not None and self.call(self._positive,self.coordinator_facts,len(self._output.split('/'))-1)
   except BaseException as error:
    self.fail('final-coordinator-refused');self.complete=False
    if primary is None:primary=error
   self.phase='complete'if self.complete else'refused';self.busy=False;self.closed=True
  if primary is not None:raise primary
  self.check();return self.status()
 def status(self):
  if self.busy:self.poison();raise Refusal('controller-reentry')
  before=None if self.before is None else load(raw(self.before),65536);after=None if self.after is None else load(raw(self.after),65536)
  return{'schema':'bw.provisioning-controller-result.v1','phase':self.phase,'closed':self.closed,'complete':self.complete and self.first is None,'firstFailure':self.first,'secondaryFailure':self.secondary,'bootstrapComponentsVerified':self.verified,'sourceBefore':before,'sourceAfter':after,'inheritedProjection':{'kind':'INHERITED14_DERIVED_FROM_FULL_PROFILE_POSITIONS','before':inherited(before,'before',self._fixed),'after':inherited(after,'after',self._fixed)},'transport':None if self.transport_facts is None else load(raw(self.transport_facts),32768),'coordinator':None if self.coordinator_facts is None else load(raw(self.coordinator_facts),65536),'cleanupRefused':self.cleanup,'outerHardBoundImplemented':False,**{k:False for k in FLAGS}}
