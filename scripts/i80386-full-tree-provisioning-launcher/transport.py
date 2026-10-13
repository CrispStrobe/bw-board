"""Unconnected fixed six-input transport. Production admission is unimplemented."""
import hashlib,json,re,time,urllib.error,urllib.parse,urllib.request
_SOURCE_SEAL=None
_ROLES=('toolchain','djcrx','djdev','djlsr','gcc-copying-runtime','gcc-copying3')
_INPUTS=(('toolchain', 'https://github.com/andrewwutw/build-djgpp/releases/download/v3.4/djgpp-linux64-gcc1220.tar.bz2', 80596981, '8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'), ('djcrx', 'https://www.delorie.com/pub/djgpp/current/v2/djcrx205.zip', 895256, '22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'), ('djdev', 'https://www.delorie.com/pub/djgpp/current/v2/djdev205.zip', 2509574, '4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'), ('djlsr', 'https://www.delorie.com/pub/djgpp/current/v2/djlsr205.zip', 2047171, '80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea'), ('gcc-copying-runtime', 'https://raw.githubusercontent.com/gcc-mirror/gcc/2ee5e4300186a92ad73f1a1a64cb918dc76c8d67/COPYING.RUNTIME', 3324, '9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74'), ('gcc-copying3', 'https://raw.githubusercontent.com/gcc-mirror/gcc/2ee5e4300186a92ad73f1a1a64cb918dc76c8d67/COPYING3', 35147, '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'))
_INPUTS_SHA256='bab40026d22af2ce76b9c896d799a29d6d226b53c93fd90c3684c0c7ad0754c4'
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def actual():raise Refusal('source-unarmed')
class ConsumedResponse:
 def close(self):pass
class Redirect(urllib.request.HTTPRedirectHandler):
 def __init__(self,owner,index):self.owner=owner;self.index=index;self.hops=0
 def http_error_302(self,req,fp,code,msg,headers):
  o=self.owner;primary=None;request=None
  try:
   o._guard(self.index);self.hops+=1;need(self.hops<=3 and o._inputs[self.index][0]=='toolchain','redirect-refused')
   location=headers.get('Location');o._check();need(type(location)is str and len(location)<=8192,'redirect-refused');u=urllib.parse.urlsplit(location);o._check()
   need(u.scheme=='https' and u.hostname in ('release-assets.githubusercontent.com','objects.githubusercontent.com') and u.username is None and u.password is None and u.port in (None,443) and not u.fragment,'redirect-refused')
   request=urllib.request.Request(location,headers={'User-Agent':'bw-fixed-source-materialization'});o._check()
  except BaseException as error:o._fail('redirect-refused');primary=error
  try:o._close_response(fp)
  except BaseException as error:
   o._fail('response-close-refused');o.secondary='response-close-refused'
   if primary is None:primary=error
  if primary is not None:raise primary
  o._guard(self.index);return self.parent.open(request,timeout=10)
 http_error_301=http_error_303=http_error_307=http_error_308=http_error_302
class Transport:
 def __init__(self):
  self.entered=False;self.busy=False;self.closed=False;self.phase='new';self.first=None;self.secondary=None;self.rows=[];self.responses=[];self.close_attempts=0;self.close_refused=0;self.current=None;self.fetching=False;self.started=None;self.admitted=False;self._inputs=None;self.complete=False
 def _fail(self,code):
  if self.first is None:self.first=code
 def _reentry(self):self._fail('transport-reentry')
 def _check(self):need(self.first is None,'poisoned')
 def _admit(self):
  # A non-null string alone cannot manufacture missing full-profile admission.
  raise Refusal('source-unarmed'if _SOURCE_SEAL is None else'source-admission-unimplemented')
 def _table(self):
  inputs=_INPUTS;seal=_INPUTS_SHA256
  need(type(inputs)is tuple and len(inputs)==6,'input-table')
  for index,row in enumerate(inputs):
   need(type(row)is tuple and len(row)==4,'input-table');role,url,extent,digest=row
   need(type(role)is str and role==_ROLES[index]and type(url)is str and len(url)<=8192 and url.startswith('https://')and type(extent)is int and 0<extent<=80596981 and type(digest)is str and re.fullmatch('[0-9a-f]{64}',digest)is not None,'input-table')
  need(type(seal)is str and hashlib.sha256(json.dumps(inputs,separators=(',',':')).encode()).hexdigest()==seal,'input-table-seal');self._check();return inputs
 def _guard(self,index):
  need(type(index)is int and 0<=index<6,'transport-entry')
  need(self.busy and self.entered and not self.closed and self.phase=='acquiring'and self.admitted and self.current==index and self._inputs is not None,'transport-entry');self._check()
  now=time.monotonic();self._check();need(self.started is not None and now-self.started<=360,'fetch-deadline')
 def _close_response(self,response):
  if response is None:return
  if type(response)is urllib.error.HTTPError:
   error=response;response=error.fp
   # Preserve the reviewed CPython wrapper-specific finalizer detachment.
   error._closer.file=ConsumedResponse()
   if response is None:return
  if any(response is x for x in self.responses):return
  need(len(self.responses)<32,'response-cap');self.responses.append(response);self.close_attempts+=1
  try:response.close()
  except BaseException:self.close_refused+=1;raise
 def _open(self,index):
  self._guard(index);need(self.fetching,'transport-entry');url=self._inputs[index][1];redirect=Redirect(self,index);opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),redirect);self._check();request=urllib.request.Request(url,headers={'User-Agent':'bw-fixed-source-materialization'});self._check();return opener.open(request,timeout=10),redirect
 def _fetch(self,index):
  if self.fetching:self._reentry();raise Refusal('transport-reentry')
  self._guard(index);self.fetching=True;role,url,extent,digest=self._inputs[index]
  row={'role':role,'expectedBytes':extent,'expectedSha256':digest,'receivedBytes':0,'observedSha256':None,'authenticated':False,'closeAttempted':0,'closeRefused':0,'redirects':0};self.rows.append(row);response=None;primary=None;body=None;redirect=None;ca=self.close_attempts;cr=self.close_refused
  try:
   t=time.monotonic();self._check()
   try:response,redirect=self._open(index)
   except urllib.error.HTTPError as error:response=error;raise
   self._check();status=response.getcode();self._check();need(type(status)is int and status==200,'response-status');data=bytearray()
   while True:
    self._check();now=time.monotonic();self._check();need(now-t<=90 and now-self.started<=360,'fetch-deadline');requested=min(65536,extent+1-len(data));block=response.read(requested);self._check();need(type(block)is bytes,'fetch-shape');need(len(block)<=requested,'fetch-extent')
    if not block:break
    data.extend(block);row['receivedBytes']=len(data);need(len(data)<=extent,'fetch-extent')
   need(len(data)==extent,'fetch-extent');body=bytes(data);h=hashlib.sha256(body);self._check();row['observedSha256']=h.hexdigest();self._check();need(row['observedSha256']==digest,'fetch-hash');row['authenticated']=True
  except BaseException as error:self._fail(str(error)if type(error)is Refusal else'fetch-refused');primary=error
  finally:
   try:self._close_response(response)
   except BaseException as error:
    self._fail('response-close-refused')
    if primary is None:primary=error
    else:self.secondary='response-close-refused'
   row['closeAttempted']=self.close_attempts-ca;row['closeRefused']=self.close_refused-cr;row['redirects']=redirect.hops if redirect else 0;self.fetching=False
  if primary is not None:raise primary
  self._check();return body
 def acquire(self):
  if self.busy:self._reentry();raise Refusal('transport-reentry')
  need(not self.entered and not self.closed,'transport-once');self.entered=True;self.busy=True;self.phase='admission';bodies=[];primary=None
  try:
   self._inputs=self._table();self._check();need(self._admit()is True,'source-unarmed');self._check();self.admitted=True;self.phase='acquiring';self.started=time.monotonic();self._check()
   for index in range(6):self.current=index;bodies.append(self._fetch(index));self._check()
   need(len(bodies)==6 and all(row['authenticated']is True for row in self.rows)and self.close_refused==0,'acquisition-incomplete');self.complete=True;self.phase='complete'
  except BaseException as error:self._fail(str(error)if type(error)is Refusal else'acquisition-refused');primary=error;self.phase='refused'
  finally:self.busy=False;self.closed=True;self.current=None;self._inputs=None
  if primary is not None:bodies.clear();raise primary
  return tuple(bodies)
 def status(self):
  if self.busy:self._reentry();raise Refusal('transport-reentry')
  return {'schema':'bw.fixed-six-input-transport.v1','phase':self.phase,'closed':self.closed,'firstFailure':self.first,'secondaryFailure':self.secondary,'complete':self.complete and self.first is None,'inputRows':[dict(row)for row in self.rows],'responseCloseAttempted':self.close_attempts,'responseCloseRefused':self.close_refused,'actualAcquisitionQualified':False,'profileSourceAdmissionQualified':False,'inputLeaseQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
