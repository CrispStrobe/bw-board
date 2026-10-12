"""Fixed immutable-byte acquisition only; no compiler or guest execution."""
import hashlib
import json
from pathlib import Path
import time
import types
import urllib.error
import urllib.parse
import urllib.request

RUNNER_SHA = '84b845505f4ed28324c89c840dfa889ffdef31b95219584aeaa8d05860807c5e'
INPUTS = (
 ('toolchain', 'https://github.com/andrewwutw/build-djgpp/releases/download/v3.4/djgpp-linux64-gcc1220.tar.bz2', 80596981, '8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'),
 ('djcrx', 'https://www.delorie.com/pub/djgpp/current/v2/djcrx205.zip', 895256, '22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'),
 ('djdev', 'https://www.delorie.com/pub/djgpp/current/v2/djdev205.zip', 2509574, '4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'),
 ('djlsr', 'https://www.delorie.com/pub/djgpp/current/v2/djlsr205.zip', 2047171, '80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea'))
TOTAL = 86048982
CODES = frozenset(('phase-order','acquisition-reentry','network-refusal','extent-refusal','hash-refusal','deadline-refusal','redirect-refusal','cleanup-refusal','source-refusal','report-refusal','materialization-refusal'))
class Refusal(ValueError):
    pass

def need(ok, code):
    if not ok: raise Refusal(code)

def _load_runner():
    path = Path(__file__).parent.parent/'i80386-cwsdpmi-fixed-archive-materialization/run.py'
    with path.open('rb') as stream: raw = stream.read(65537)
    need(len(raw)<=65536 and hashlib.sha256(raw).hexdigest()==RUNNER_SHA,'source-refusal')
    module=types.ModuleType('private_fixed_archive_runner');module.__file__=str(path)
    exec(compile(raw,'<fixed-archive-runner>','exec'),module.__dict__)
    return module

runner = _load_runner()

def _allowed(url, original):
    need(type(url)is str and len(url)<=8192,'redirect-refusal')
    p=urllib.parse.urlsplit(url)
    need(p.scheme=='https' and p.username is None and p.password is None and not p.fragment and p.port in (None,443),'redirect-refusal')
    if original==INPUTS[0][1]:
        need(p.hostname in ('github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'),'redirect-refusal')
        if p.hostname=='github.com': need(url==original,'redirect-refusal')
    else: need(url==original,'redirect-refusal')

class _Redirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, owner, original, deadline):
        self.owner=owner;self.original=original;self.deadline=deadline;self.count=0
    def http_error_302(self, req, fp, code, msg, headers):
        error=None
        try:
            location=headers.get("Location")
            need(type(location)is str and len(location)<=8192,"redirect-refusal")
            newurl=urllib.parse.urljoin(req.full_url,location)
            request=self.redirect_request(req,fp,code,msg,headers,newurl)
        except BaseException as caught:
            error=caught;self.owner._latch(caught,"redirect-refusal");raise
        finally:
            self.owner._close_response(fp,error)
        self.owner._check(self.deadline)
        return self.parent.open(request,timeout=10)
    http_error_301=http_error_303=http_error_307=http_error_308=http_error_302
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.owner._check(self.deadline);self.count+=1
        need(self.count<=3 and code in (301,302,303,307,308),'redirect-refusal')
        _allowed(newurl,self.original)
        result=super().redirect_request(req,fp,code,msg,headers,newurl)
        self.owner._check(self.deadline)
        return result

def _open(owner, url, deadline):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),_Redirect(owner,url,deadline))
    return opener.open(urllib.request.Request(url,headers={'Accept-Encoding':'identity'}),timeout=10)

class FixedArchiveAcquisition:
    def __init__(self,parent):
        self._parent=parent;self._runner=None;self._busy=False;self._reentered=False
        self._consumed=False;self._closed=False;self._first=None;self._secondary=None
        self._phase='new';self._facts=[];self._close_attempted=0;self._close_refused=0
        self._runner_close=False;self._packet=None;self._active_fact=None;self._closed_responses=[]
    def _enter(self):
        if self._busy:
            self._reentered=True;self._first=self._first or 'acquisition-reentry'
            if self._runner is not None:
                r=self._runner;r._reentered=True;r._first=r._first or 'runner-reentry'
                m=r._materializer;m._reentered=True;m._first=m._first or 'materializer-reentry'
                o=m._observer;o._reentered=True;o._epoch+=1;o._first=o._first or 'observer-reentry';o._owner._poison()
            raise Refusal('acquisition-reentry')
        self._busy=True
    def _check(self,deadline=None):
        need(not self._reentered,'acquisition-reentry')
        if deadline is not None: need(time.monotonic()<=deadline,'deadline-refusal')
    def _latch(self,error,default):
        args=error.args if type(error)is Refusal else ()
        code=args[0] if len(args)==1 and type(args[0])is str and len(args[0])<=32 and args[0] in CODES else default
        self._first=self._first or code
    def _close_response(self,response,error):
        key=response.fp if isinstance(response,urllib.error.HTTPError) else response
        if any(key is prior for prior in self._closed_responses):return
        # At most four inputs, each with three followed redirects, one rejected
        # redirect/final response. Retain identities until this consumed attempt
        # ends; an uncertain close is never retried via a carried HTTPError.
        self._closed_responses.append(key)
        self._close_attempted+=1
        try:
            response.close();self._check()
        except BaseException as caught:
            self._close_refused+=1;self._secondary=self._secondary or "cleanup-refusal"
            if error is None:
                self._latch(caught,"cleanup-refusal");raise
    def _fetch(self,row):
        role,url,extent,digest=row;deadline=time.monotonic()+90
        response=None;raw=bytearray();error=None
        fact={'role':role,'expectedBytes':extent,'bytesRead':0,'authenticated':False,'closeAttempted':False,'closeRefused':False}
        self._facts.append(fact);self._active_fact=fact
        try:
            self._check(deadline);response=_open(self,url,deadline);self._check(deadline)
            need(response.status==200,'network-refusal');self._check(deadline)
            _allowed(response.geturl(),url);self._check(deadline)
            while len(raw)<extent:
                self._check(deadline);limit=min(65536,extent-len(raw));block=response.read(limit);self._check(deadline)
                need(type(block)is bytes and 0<len(block)<=limit,'extent-refusal')
                raw.extend(block);fact['bytesRead']=len(raw)
            self._check(deadline);guard=response.read(1);self._check(deadline)
            need(type(guard)is bytes and guard==b'','extent-refusal')
            immutable=bytes(raw);actual=hashlib.sha256(immutable).hexdigest();self._check(deadline)
            need(actual==digest,'hash-refusal');fact['authenticated']=True;fact['sha256']=actual
            return immutable
        except BaseException as caught:
            error=caught;self._latch(caught,'network-refusal')
            if response is None and isinstance(caught,urllib.error.HTTPError) and caught.fp is not None:
                response=caught
            raise
        finally:
            if response is not None:
                fact['closeAttempted']=True
                prior=self._close_refused
                try:self._close_response(response,error)
                finally:fact['closeRefused']=self._close_refused>prior
    def _close_runner(self):
        if self._runner is None or self._runner_close:return
        self._runner_close=True
        try:self._runner.close();self._check()
        except BaseException:
            self._secondary=self._secondary or 'cleanup-refusal';raise
    def _copy_report(self):
        if self._runner is None or self._reentered:return
        report=self._runner.report();self._check()
        if report is None:
            self._packet=None
            return
        need(type(report)is dict,'report-refusal')
        raw=json.dumps(report,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')
        need(len(raw)<=runner.MAX_PACKET,'report-refusal')
        self._packet=raw
    def acquire(self):
        self._enter()
        try:
            need(not self._consumed and not self._closed,'phase-order')
            self._consumed=True;self._phase='acquisition-consumed';inputs=[]
            try:
                need(sum(row[2] for row in INPUTS)==TOTAL,'source-refusal')
                for row in INPUTS:inputs.append(self._fetch(row));self._check()
                self._runner=runner.MaterializationRunner(self._parent);self._check()
                self._phase='materialization-consumed'
                self._runner.materialize(*inputs);self._check();self._copy_report()
                need(self._packet is not None and json.loads(self._packet)['wrapper']['phase']=='complete','report-refusal')
                self._close_runner();self._check();self._phase='complete'
            except BaseException as error:
                self._latch(error,'materialization-refusal' if self._runner is not None else 'network-refusal');self._phase='refused'
                try:self._copy_report()
                except BaseException:self._secondary=self._secondary or 'report-refusal'
                try:self._close_runner()
                except BaseException:self._secondary=self._secondary or 'cleanup-refusal'
                raise
            finally:inputs.clear()
        finally:self._busy=False
        return self.report()
    def _status(self):
        inner_cleanup=True
        if self._packet is not None:
            packet=json.loads(self._packet)
            if type(packet)is dict:
                for key in ('materializeStatus','closeStatus'):
                    row=packet.get(key)
                    if type(row)is dict and row.get('cleanupQualified') is not True:inner_cleanup=False
            else:inner_cleanup=False
        return {'phase':self._phase,'firstFailure':self._first,'secondary':self._secondary,'reentered':self._reentered,'consumed':self._consumed,'closed':self._closed,'inputs':[dict(row) for row in self._facts],'responseCloseAttempted':self._close_attempted,'responseCloseRefused':self._close_refused,'cleanupQualified':self._close_refused==0 and self._secondary is None and inner_cleanup,'runnerConstructed':self._runner is not None,'runnerCloseAttempted':self._runner_close,'hasReport':self._packet is not None,'inputFilesystemLeaseQualified':False,'sourceOwnedQualified':False,'physicalNamespaceObserved':False,'readonlyModesObserved':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False,'fullToolchainReady':False}
    def status(self):
        if self._busy:self._enter()
        return self._status()
    def report(self):
        if self._busy:self._enter()
        return {'schema':'bw.fixed-archive-acquisition.v2','runnerSha256':RUNNER_SHA,'acquisition':self._status(),'materialization':None if self._packet is None else json.loads(self._packet)}
    def close(self):
        self._enter()
        try:
            if not self._closed:self._closed=True;self._close_runner()
            if self._phase!='complete':self._phase='closed'
        finally:self._busy=False
        return self.status()
