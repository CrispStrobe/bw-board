"""Manufactured HTTP bytes only; never invokes actual networking or tools."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch,Mock
p=Path(__file__).with_name('acquire.py');s=importlib.util.spec_from_file_location('acquisition',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
DATA=(b'a'*7,b'b'*9,b'c'*11,b'd'*13)
ROWS=tuple((row[0],row[1],len(data),hashlib.sha256(data).hexdigest()) for row,data in zip(m.INPUTS,DATA))
class Response:
 def __init__(self,data,url):self.data=data;self.url=url;self.status=200;self.reads=[];self.closes=0
 def read(self,n):self.reads.append(n);block=self.data[:n];self.data=self.data[n:];return block
 def geturl(self):return self.url
 def close(self):self.closes+=1
class Runner:
 def __init__(self,parent):self.parent=parent;self.calls=[];self.closes=0
 def materialize(self,*data):self.calls.append(data)
 def report(self):return {'wrapper':{'phase':'complete'},'closeStatus':{'cleanupQualified':True},'materializeStatus':{'cleanupQualified':True}}
 def close(self):self.closes+=1
class Controls(unittest.TestCase):
 def setup_case(self, opener=None, factory=Runner):
  responses=[Response(data,row[1]) for row,data in zip(ROWS,DATA)]
  def opened(owner,url,deadline):return responses.pop(0)
  return patch.object(m,'INPUTS',ROWS),patch.object(m,'TOTAL',sum(map(len,DATA))),patch.object(m,'_open',opener or opened),patch.object(m.runner,'MaterializationRunner',factory)
 def execute(self,opener=None,factory=Runner):
  patches=self.setup_case(opener,factory)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('/manufactured');result=obj.acquire();return obj,result
 def test_positive(self):
  obj,report=self.execute();self.assertEqual(obj._runner.calls,[DATA]);self.assertEqual(obj._runner.closes,1);self.assertEqual(report['acquisition']['phase'],'complete');self.assertEqual(len(report['acquisition']['inputs']),4);self.assertEqual(obj._close_attempted,4);report['acquisition']['inputs'].clear();self.assertEqual(len(obj.status()['inputs']),4)
 def test_read_bounds_eof(self):
  refs=[]
  def opened(owner,url,deadline):r=Response(DATA[len(refs)],url);refs.append(r);return r
  self.execute(opened)
  for r,data in zip(refs,DATA):self.assertEqual(r.reads,[len(data),1]);self.assertEqual(r.closes,1)
 def test_short_long_wronghash(self):
  for data,code in ((b'','extent-refusal'),(DATA[0]+b'x','extent-refusal'),(b'z'*7,'hash-refusal')):
   r=Response(data,ROWS[0][1]);factory=Mock()
   patches=self.setup_case(lambda *args:r,factory)
   with patches[0],patches[1],patches[2],patches[3]:
    obj=m.FixedArchiveAcquisition('x')
    with self.assertRaises(m.Refusal):obj.acquire()
    self.assertEqual(obj.status()['firstFailure'],code);factory.assert_not_called();self.assertEqual(r.closes,1)
 def test_all_authenticated_before_runner(self):
  calls=[]
  def opened(owner,url,deadline):calls.append(url);return Response(DATA[len(calls)-1],url)
  def factory(parent):self.assertEqual(len(calls),4);return Runner(parent)
  self.execute(opened,factory)
 def test_original_read_and_close_error(self):
  original=OSError('private');r=Response(DATA[0],ROWS[0][1]);r.read=Mock(side_effect=original);r.close=Mock(side_effect=OSError('secondary'))
  patches=self.setup_case(lambda *args:r)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(OSError) as caught:obj.acquire()
   self.assertIs(caught.exception,original);self.assertEqual(obj.status()['firstFailure'],'network-refusal');self.assertEqual(obj.status()['responseCloseRefused'],1);r.close.assert_called_once()
 def test_completed_prefix(self):
  refs=[]
  def opened(owner,url,deadline):
   if len(refs)==2:raise OSError('private')
   r=Response(DATA[len(refs)],url);refs.append(r);return r
  patches=self.setup_case(opened)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(OSError):obj.acquire()
   self.assertEqual([r['authenticated'] for r in obj.status()['inputs']],[True,True,False]);self.assertIsNone(obj._runner)
 def test_reentry_no_next_read(self):
  r=Response(DATA[0],ROWS[0][1])
  def opened(owner,url,deadline):
   def read(n):
    try:owner.status()
    except m.Refusal:pass
    return DATA[0]
   r.read=Mock(side_effect=read);return r
  patches=self.setup_case(opened)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(m.Refusal):obj.acquire()
   r.read.assert_called_once();self.assertEqual(r.closes,1);self.assertTrue(obj.status()['reentered'])
 def test_deadline(self):
  with patch.object(m.time,'monotonic',side_effect=[0,91]),patch.object(m,'_open') as opened:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(m.Refusal):obj.acquire()
   opened.assert_not_called();self.assertEqual(obj.status()['firstFailure'],'deadline-refusal')
 def test_redirect_policy(self):
  original=m.INPUTS[0][1]
  for url in ('http://github.com/a','https://evil.example/a','https://github.com/other','https://user@release-assets.githubusercontent.com/a','https://release-assets.githubusercontent.com:444/a'):
   with self.assertRaises(m.Refusal):m._allowed(url,original)
  m._allowed('https://release-assets.githubusercontent.com/asset?signed=secret',original)
  with self.assertRaises(m.Refusal):m._allowed('https://www.delorie.com/other',m.INPUTS[1][1])
 def test_redirect_count_close(self):
  obj=m.FixedArchiveAcquisition('x');handler=m._Redirect(obj,m.INPUTS[0][1],100);response=Response(b'never read',m.INPUTS[0][1]);req=m.urllib.request.Request(m.INPUTS[0][1]);handler.parent=Mock()
  with patch.object(m.time,'monotonic',return_value=0):
   handler.http_error_302(req,response,302,'',{'Location':'https://release-assets.githubusercontent.com/a'})
   self.assertEqual(response.reads,[]);self.assertEqual(response.closes,1)
   handler.count=3
   with self.assertRaises(m.Refusal):handler.http_error_302(req,response,302,'',{'Location':'https://release-assets.githubusercontent.com/a'})
 def test_repeat_and_close_guard(self):
  obj,_=self.execute()
  with patch.object(m,'_open') as opened:
   with self.assertRaises(m.Refusal):obj.acquire()
   obj.close();obj.close();opened.assert_not_called();self.assertEqual(obj._runner.closes,1)
  obj=m.FixedArchiveAcquisition('x');obj.close()
  with patch.object(m,'_open') as opened:
   with self.assertRaises(m.Refusal):obj.acquire()
   opened.assert_not_called()
 def test_materializer_original_and_report(self):
  original=ValueError('private')
  class Failed(Runner):
   def materialize(self,*data):raise original
   def report(self):return {'wrapper':{'phase':'refused'}}
  patches=self.setup_case(factory=Failed)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(ValueError) as caught:obj.acquire()
   self.assertIs(caught.exception,original);self.assertEqual(obj.report()['materialization']['wrapper']['phase'],'refused');self.assertEqual(obj._runner.closes,1)
 def test_bad_status_and_finalurl(self):
  for status,url in ((404,ROWS[0][1]),(200,'https://evil.example/a')):
   r=Response(DATA[0],url);r.status=status;patches=self.setup_case(lambda *args:r)
   with patches[0],patches[1],patches[2],patches[3]:
    obj=m.FixedArchiveAcquisition('x')
    with self.assertRaises(m.Refusal):obj.acquire()
    self.assertEqual(r.closes,1);self.assertIsNone(obj._runner)
 def test_source_hash(self):
  with patch.object(m.hashlib,'sha256') as hashed:
   hashed.return_value.hexdigest.return_value='0'*64
   with self.assertRaises(m.Refusal):m._load_runner()
 def test_fixed_four_pins(self):
  self.assertEqual(sum(row[2] for row in m.INPUTS),86048982);self.assertEqual(len(m.INPUTS),4);self.assertEqual(len({row[1] for row in m.INPUTS}),4)
 def test_hash_reentry_no_runner(self):
  real=m.hashlib.sha256;calls=[]
  def digest(raw):
   calls.append(raw)
   try:obj.status()
   except m.Refusal:pass
   return real(raw)
  patches=self.setup_case(factory=Mock())
  with patches[0],patches[1],patches[2],patches[3],patch.object(m.hashlib,'sha256',digest):
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(m.Refusal):obj.acquire()
   self.assertEqual(len(calls),1);self.assertIsNone(obj._runner)
 def test_report_cap_and_cleanup(self):
  class Huge(Runner):
   def report(self):return {'wrapper':{'phase':'complete'},'huge':'x'*(m.runner.MAX_PACKET+1)}
  patches=self.setup_case(factory=Huge)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(m.Refusal):obj.acquire()
   self.assertEqual(obj.status()['firstFailure'],'report-refusal');self.assertEqual(obj._runner.closes,1)
  class Uncertain(Runner):
   def report(self):return {'wrapper':{'phase':'refused'},'closeStatus':{'cleanupQualified':False}}
   def materialize(self,*data):raise ValueError('private')
  patches=self.setup_case(factory=Uncertain)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(ValueError):obj.acquire()
   self.assertFalse(obj.status()['cleanupQualified'])
 def test_http_error_carried_response(self):
  for code,close_fail in ((404,False),(403,True)):
   response=Response(b'not consumed',ROWS[0][1])
   if close_fail:response.close=Mock(side_effect=OSError('secondary'))
   original=m.urllib.error.HTTPError(ROWS[0][1],code,'private',{},response)
   patches=self.setup_case(Mock(side_effect=original))
   with patches[0],patches[1],patches[2],patches[3]:
    obj=m.FixedArchiveAcquisition('x')
    with self.assertRaises(m.urllib.error.HTTPError) as caught:obj.acquire()
    self.assertIs(caught.exception,original);self.assertEqual(response.reads,[])
    self.assertEqual(obj.status()['responseCloseAttempted'],1)
    self.assertEqual(obj.status()['responseCloseRefused'],int(close_fail))
    self.assertEqual(obj.status()['firstFailure'],'network-refusal')
    if close_fail:response.close.assert_called_once()
    else:self.assertEqual(response.closes,1)
 def test_redirect_chain_carried_error_no_double_close(self):
  old=Response(b'oldbody',ROWS[0][1]);carried=Response(b'newbody',ROWS[0][1]);original=m.urllib.error.HTTPError(ROWS[0][1],403,'private',{},carried)
  def opened(owner,url,deadline):
   handler=m._Redirect(owner,url,deadline);handler.parent=Mock();handler.parent.open.side_effect=original
   return handler.http_error_302(m.urllib.request.Request(url),old,302,'',{'Location':'https://release-assets.githubusercontent.com/asset'})
  patches=self.setup_case(opened)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(m.urllib.error.HTTPError) as caught:obj.acquire()
   self.assertIs(caught.exception,original);self.assertEqual(old.closes,1);self.assertEqual(carried.closes,1);self.assertEqual(obj._close_attempted,2)
  # The library may carry a redirect fp that the custom handler consumed.
  old=Response(b'oldbody',ROWS[0][1]);original=m.urllib.error.HTTPError(ROWS[0][1],302,'private',{},old)
  def opened(owner,url,deadline):
   owner._close_response(old,None)
   raise original
  patches=self.setup_case(opened)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(m.urllib.error.HTTPError):obj.acquire()
   self.assertEqual(old.closes,1);self.assertEqual(obj._close_attempted,1)
 def test_absent_failed_report(self):
  original=ValueError('private')
  class Absent(Runner):
   def materialize(self,*data):raise original
   def report(self):return None
  patches=self.setup_case(factory=Absent)
  with patches[0],patches[1],patches[2],patches[3]:
   obj=m.FixedArchiveAcquisition('x')
   with self.assertRaises(ValueError) as caught:obj.acquire()
   self.assertIs(caught.exception,original);self.assertFalse(obj.status()['hasReport']);self.assertIsNone(obj.report()['materialization']);self.assertEqual(obj._runner.closes,1)
if __name__=='__main__':unittest.main()
