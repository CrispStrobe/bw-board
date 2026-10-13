"""Manufactured same-call notice composition, no authority admission."""
import hashlib,types
from pathlib import Path
HERE=Path(__file__).parent
EXTRACTOR_SHA='bde66cf5de7fc0d02508d88176e51b47a3acf208770bbd8904afa87c9eb3d501'
BRIDGE_SHA='f9c408854dc983274787c266f1a32be50f364e313a281603117a972d292a33d0'
WRITER_SHA='e0a844ce3445b344a02e09ebee02ce8eca4a9ef7afc5a26d741b00902db561a2'
def _load(path,digest,name):
 with path.open('rb') as f:raw=f.read(65537)
 if len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('dependency-seal-refused')
 module=types.ModuleType(name);module.__file__=str(path);exec(compile(raw,'<fixed-source-dependency>','exec'),module.__dict__);return module
extractor=_load(HERE.parent/'i80386-djgpp-notice-extractor'/'extractor.py',EXTRACTOR_SHA,'bound_notice_extractor')
bridge=_load(HERE.parent/'i80386-full-tree-archive-bridge'/'bridge.py',BRIDGE_SHA,'bound_notice_bridge')
if bridge.WRITER_SHA!=WRITER_SHA:raise ValueError('writer-protocol-refused')
GCC_PINS=(('gcc-copying-runtime',3324,'9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74'),('gcc-copying3',35147,'8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'))
ROLE_MAP={'copying':'djgpp-copying','copying.dj':'djgpp-copying-dj','copying.lib':'djgpp-copying-lib'}
class Refusal(ValueError):pass
def need(ok,why):
 if not ok:raise Refusal(why)
def _copy(value,budget=None,depth=0):
 if budget is None:budget=[256]
 budget[0]-=1;need(budget[0]>=0 and depth<=6,'status-cap')
 if value is None or type(value)is bool:return value
 if type(value)is int:need(0<=value<2**64,'status-int');return value
 if type(value)is str:need(len(value)<=96,'status-string');return value
 if type(value)is list:
  need(len(value)<=32,'status-list');return [_copy(v,budget,depth+1) for v in value]
 need(type(value)is dict and len(value)<=64,'status-shape');need(all(type(k)is str and len(k)<=64 for k in value),'status-key');return {k:_copy(v,budget,depth+1) for k,v in value.items()}
class Coordinator:
 def __init__(self,parent):
  need(type(parent)is str and len(parent)<=4046 and parent.startswith('/') and '\0'not in parent,'parent-shape');need(len(parent.encode('utf8'))<=4046,'parent-shape');parts=parent.split('/')[1:];need(len(parts)<=30 and all(v not in ('','.','..') for v in parts),'parent-shape')
  self.parent=parent;self.busy=False;self.closed=False;self.entered=False;self.first=None;self.phase='new';self.archive_auth=0;self.gcc_auth=0;self.notice_count=0;self.notice_bytes=0;self.flow=False;self.cleanup_refused=0;self._extractor=None;self._bridge=None;self._extractor_facts=None;self._bridge_facts=None
 def fail(self,reason):
  if self.first is None:self.first=reason
 def reentry(self):
  self.fail('coordinator-reentry')
  if self._extractor is not None:self._extractor.fail('extractor-reentry')
  if self._bridge is not None:self._bridge.reentry()
 def check(self):need(self.first is None,'poisoned')
 def _authenticate(self,bodies,pins):
  for body,(role,extent,digest) in zip(bodies,pins):
   self.check();need(type(body)is bytes and len(body)==extent,'input-extent');h=hashlib.sha256(body);self.check();observed=h.hexdigest();self.check();need(observed==digest,'input-hash')
   if role.startswith('gcc-'):self.gcc_auth+=1
   else:self.archive_auth+=1
 def _adopt(self):
  self.check();owner=self._extractor;need(owner is not None and owner.closed and owner.phase=='observed-complete' and owner.first is None and owner.authenticated==4,'extractor-state')
  selected=owner._selected;need(type(selected)is dict and len(selected)==3,'selected-shape');need(all(type(k)is str and len(k)<=32 for k in selected),'selected-key');need(set(selected)==set(ROLE_MAP),'selected-set')
  notices={}
  for name,role in ROLE_MAP.items():
   self.check();need(type(selected)is dict and len(selected)==3,'selected-shape');need(all(type(k)is str and len(k)<=32 for k in selected),'selected-key');need(set(selected)==set(ROLE_MAP),'selected-set');blocks=selected[name];extent,digest=extractor.SELECTED[name];need(type(blocks)is tuple and len(blocks)<=extent+1 and 0<extent<=65536,'selected-blocks');size=0
   for body in blocks:need(type(body)is bytes and 0<len(body)<=65536,'selected-body');size+=len(body);need(size<=extent,'selected-extent')
   need(size==extent,'selected-extent');body=b''.join(blocks);self.check();h=hashlib.sha256(body);self.check();observed=h.hexdigest();self.check();need(observed==digest,'selected-hash');need(bridge.writer.NOTICES[role]==(extent,digest),'notice-pin-join');notices[role]=tuple(body[i:i+65536] for i in range(0,extent,65536));self.notice_count+=1;self.notice_bytes+=extent
  return notices
 def provision(self,toolchain,djcrx,djdev,djlsr,gcc_runtime,gcc_copying3):
  if self.busy:self.reentry();raise Refusal('coordinator-reentry')
  need(not self.entered and not self.closed,'closed-or-consumed');self.entered=True;self.busy=True;primary=None;notices=None
  try:
   self._authenticate((toolchain,djcrx,djdev,djlsr),extractor.PINS);self._authenticate((gcc_runtime,gcc_copying3),GCC_PINS);need(self.archive_auth==4 and self.gcc_auth==2,'input-count');self.check()
   self.phase='extracting';self._extractor=extractor.Extractor();self.check();self._extractor.extract(toolchain,djcrx,djdev,djlsr);self.check();notices=self._adopt();self.check()
   for body,(role,extent,digest) in zip((gcc_runtime,gcc_copying3),GCC_PINS):
    need(bridge.writer.NOTICES[role]==(extent,digest),'notice-pin-join');notices[role]=tuple(body[i:i+65536] for i in range(0,extent,65536));self.notice_count+=1;self.notice_bytes+=extent
   need(self.notice_count==5 and self.notice_bytes<=85182,'notice-count');self.check();self.phase='bridging';self._bridge=bridge.Bridge(self.parent);self.check();self._bridge.provision(toolchain,djcrx,djdev,djlsr,notices);self.check();need(self._bridge.closed and self._bridge.phase=='observed-complete' and self._bridge.first is None and type(self._bridge.writer_status)is dict and self._bridge.writer_status.get('observedPrototypeComplete')is True and self._bridge.writer_status.get('handlesClosedWithoutReportedRefusal')is True,'bridge-state');self.flow=True;self.phase='observed-complete'
  except BaseException as error:
   self.fail(str(error) if type(error)is Refusal else ('extractor-refused' if self.phase=='extracting' else 'bridge-refused' if self.phase=='bridging' else 'operation-refused'));self.phase='refused';primary=error
  finally:
   if notices is not None:notices.clear()
   for owner,name in ((self._extractor,'_extractor_facts'),(self._bridge,'_bridge_facts')):
    if owner is None:continue
    try:owner.close()
    except BaseException as error:
     self.cleanup_refused+=1;self.fail('cleanup-refused')
     if primary is None:primary=error
    try:setattr(self,name,_copy(owner.status()))
    except BaseException as error:
     self.cleanup_refused+=1;self.fail('cleanup-refused')
     if primary is None:primary=error
   self._extractor=None;self._bridge=None;self.busy=False;self.closed=True
  if primary is not None:raise primary
  self.check();return self.status()
 def close(self):
  if self.busy:self.reentry();raise Refusal('coordinator-reentry')
  self.closed=True;return self.status()
 def status(self):
  if self.busy:self.reentry()
  return {'schema':'bw.notice-connection.v1','phase':self.phase,'closed':self.closed,'firstFailure':self.first,'archiveInputsAuthenticated':self.archive_auth,'gccInputsAuthenticated':self.gcc_auth,'noticeRolesIssued':self.notice_count,'noticeBytesIssued':self.notice_bytes,'observedInternalSameCallNoticeFlow':self.flow and self.first is None,'cleanupRefused':self.cleanup_refused,'extractorFacts':_copy(self._extractor_facts),'bridgeFacts':_copy(self._bridge_facts),'sourceOwnedQualified':False,'inputLeaseQualified':False,'filesystemLeaseQualified':False,'completeNoticeCoverageQualified':False,'legalClearanceQualified':False,'fullToolchainReady':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
