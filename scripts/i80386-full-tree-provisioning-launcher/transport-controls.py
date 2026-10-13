"""Explicit test-only private wiring, tiny pins and mocked HTTP; no network."""
import gc,hashlib,importlib.util,json,urllib.error,unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('fixed_transport',HERE/'transport.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Response:
 def __init__(self,body,status=200):self.body=body;self.offset=0;self.status=status;self.closes=0;self.requests=[];self.hook=None;self.close_error=None
 def getcode(self):return self.status
 def read(self,cap):
  self.requests.append(cap)
  if self.hook:self.hook()
  part=self.body[self.offset:self.offset+cap];self.offset+=len(part);return part
 def close(self):
  self.closes+=1
  if self.close_error:raise self.close_error
class T(unittest.TestCase):
 def setUp(self):
  self.stack=ExitStack();self.addCleanup(self.stack.close);self.owner=m.Transport();self.bodies=tuple(('manufactured-'+str(i)).encode()for i in range(6));self.table=tuple((row[0],row[1],len(body),hashlib.sha256(body).hexdigest())for row,body in zip(m._INPUTS,self.bodies));self.responses=[Response(body)for body in self.bodies];self.opened=[]
  test=self
  class Opener:
   def open(self,request,timeout):
    index=len(test.opened);test.opened.append((request.full_url,timeout));response=test.responses[index]
    if isinstance(response,BaseException):raise response
    return response
  self.opener=Opener();self.builder=self.stack.enter_context(patch.object(m.urllib.request,'build_opener',return_value=self.opener))
 def harness(self):
  self.stack.enter_context(patch.object(m.Transport,'_admit',return_value=True));self.stack.enter_context(patch.object(m,'_INPUTS',self.table));self.stack.enter_context(patch.object(m,'_INPUTS_SHA256',hashlib.sha256(json.dumps(self.table,separators=(',',':')).encode()).hexdigest()))
 def ready_redirect(self,index=0):
  self.harness();self.owner._inputs=self.table;self.owner.busy=True;self.owner.entered=True;self.owner.admitted=True;self.owner.phase='acquiring';self.owner.current=index;self.owner.started=m.time.monotonic();return m.Redirect(self.owner,index)
 def test_default_actual_and_acquire_refuse_before_opener(self):
  with patch.object(m.time,'monotonic',side_effect=AssertionError('unexpected clock')):
   with self.assertRaises(m.Refusal):m.actual()
   with self.assertRaises(m.Refusal):self.owner.acquire()
  self.builder.assert_not_called();self.assertEqual(self.owner.status()['firstFailure'],'source-unarmed');self.assertIsNone(m._SOURCE_SEAL)
 def test_nonnull_seal_does_not_invent_source_admission(self):
  with patch.object(m,'_SOURCE_SEAL','0'*64):
   with self.assertRaises(m.Refusal):self.owner.acquire()
  self.builder.assert_not_called()
 def test_six_exact_order_close_and_immutable_output(self):
  self.harness();self.assertEqual(self.owner.acquire(),self.bodies);self.assertEqual(self.opened,[(row[1],10)for row in self.table]);self.assertEqual([r.closes for r in self.responses],[1]*6)
  status=self.owner.status();self.assertTrue(status['complete']);self.assertEqual(status['responseCloseAttempted'],6);self.assertEqual(status['responseCloseRefused'],0)
  for flag in ('actualAcquisitionQualified','profileSourceAdmissionQualified','inputLeaseQualified','compilerQualified','guestQualified','performanceQualified'):self.assertIs(status[flag],False)
  status['inputRows'][0]['authenticated']=False;self.assertTrue(self.owner.status()['inputRows'][0]['authenticated'])
 def test_one_attempt_no_retry(self):
  self.harness();self.owner.acquire()
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(len(self.opened),6)
 def test_direct_fetch_open_and_bool_index_have_zero_transport(self):
  for fn in (self.owner._fetch,self.owner._open):
   for index in (0,True,6,-1):
    with self.assertRaises(m.Refusal):fn(index)
  self.builder.assert_not_called();self.assertFalse(self.owner.fetching)
 def test_status_code_exact_int200(self):
  self.harness();self.responses[0].status=True
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(len(self.opened),1);self.assertEqual(self.responses[0].closes,1)
 def test_short_body_preserves_failure_prefix_and_stops_next(self):
  self.harness();self.responses[0].body=b'x'
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(self.owner.status()['inputRows'][0]['receivedBytes'],1);self.assertFalse(self.owner.status()['inputRows'][0]['authenticated']);self.assertEqual(len(self.opened),1)
 def test_extent_plus_one_guard(self):
  self.harness();self.responses[0].body=self.bodies[0]+b'x'
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(self.responses[0].requests,[len(self.bodies[0])+1]);self.assertEqual(self.owner.status()['firstFailure'],'fetch-extent')
 def test_wrong_hash_stops_next(self):
  self.harness();self.responses[0].body=b'x'*len(self.bodies[0])
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(len(self.opened),1);self.assertEqual(self.owner.status()['firstFailure'],'fetch-hash')
 def test_foreign_block_not_converted(self):
  self.harness()
  class Foreign:
   def __bytes__(self):raise AssertionError('foreign conversion')
  self.responses[0].read=lambda cap:Foreign()
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(self.owner.status()['firstFailure'],'fetch-shape')
 def test_primary_read_error_survives_close_error(self):
  self.harness();primary=RuntimeError('original read');secondary=RuntimeError('cleanup')
  def fail(cap):raise primary
  self.responses[0].read=fail;self.responses[0].close_error=secondary
  with self.assertRaises(RuntimeError)as caught:self.owner.acquire()
  self.assertIs(caught.exception,primary);self.assertEqual(self.responses[0].closes,1);self.assertEqual(self.owner.status()['secondaryFailure'],'response-close-refused');self.assertEqual(self.owner.status()['responseCloseRefused'],1)
 def test_close_only_refusal_stops_next(self):
  self.harness();original=RuntimeError('close original');self.responses[0].close_error=original
  with self.assertRaises(RuntimeError)as caught:self.owner.acquire()
  self.assertIs(caught.exception,original);self.assertEqual(len(self.opened),1);self.assertFalse(self.owner.status()['complete'])
 def test_http_error_raw_fp_consumed_once_even_finalizer(self):
  self.harness();fp=Response(b'not read');error=urllib.error.HTTPError(self.table[0][1],404,'missing',{},fp);self.responses[0]=error
  with self.assertRaises(urllib.error.HTTPError)as caught:self.owner.acquire()
  self.assertIs(caught.exception,error);self.assertEqual(fp.closes,1);error.close();gc.collect();self.assertEqual(fp.closes,1)
 def test_http_error_close_uncertainty_keeps_original(self):
  self.harness();fp=Response(b'');fp.close_error=RuntimeError('close');error=urllib.error.HTTPError(self.table[0][1],403,'denied',{},fp);self.responses[0]=error
  with self.assertRaises(urllib.error.HTTPError)as caught:self.owner.acquire()
  self.assertIs(caught.exception,error);self.assertEqual(fp.closes,1);self.assertEqual(self.owner.status()['responseCloseRefused'],1)
 def test_http_error_referencing_consumed_redirect_fp_no_double_close(self):
  self.harness();fp=Response(b'');self.owner._close_response(fp);error=urllib.error.HTTPError(self.table[0][1],404,'missing',{},fp);self.responses[0]=error
  with self.assertRaises(urllib.error.HTTPError):self.owner.acquire()
  error.close();self.assertEqual(fp.closes,1)
 def test_redirect_closes_before_follow_no_body_read(self):
  redirect=self.ready_redirect();fp=Response(b'unread')
  class Parent:
   def open(parent,request,timeout):self.assertEqual(fp.closes,1);self.assertEqual(fp.requests,[]);return 'manufactured-follow'
  redirect.parent=Parent();self.assertEqual(redirect.http_error_302(None,fp,302,'',{'Location':'https://release-assets.githubusercontent.com/fixed'}),'manufactured-follow');self.assertEqual(redirect.hops,1)
 def test_redirect_unknown_origin_protocol_credentials_and_non_toolchain(self):
  redirect=self.ready_redirect()
  for location in ('http://release-assets.githubusercontent.com/x','https://evil.invalid/x','https://u:p@objects.githubusercontent.com/x','https://objects.githubusercontent.com:444/x','https://objects.githubusercontent.com/x#fragment'):
   self.owner.first=None;redirect.hops=0;fp=Response(b'')
   with self.assertRaises(m.Refusal):redirect.http_error_302(None,fp,302,'',{'Location':location})
   self.assertEqual(fp.closes,1);self.assertEqual(fp.requests,[])
  self.owner.first=None;self.owner.current=1;redirect=m.Redirect(self.owner,1);fp=Response(b'')
  with self.assertRaises(m.Refusal):redirect.http_error_302(None,fp,302,'',{'Location':'https://objects.githubusercontent.com/x'})
  self.assertEqual(fp.closes,1)
 def test_fourth_redirect_refuses_without_follow(self):
  redirect=self.ready_redirect();redirect.hops=3;fp=Response(b'');redirect.parent=unittest.mock.Mock()
  with self.assertRaises(m.Refusal):redirect.http_error_302(None,fp,302,'',{'Location':'https://objects.githubusercontent.com/x'})
  redirect.parent.open.assert_not_called();self.assertEqual(fp.closes,1)
 def test_redirect_primary_refusal_preserved_if_close_fails(self):
  redirect=self.ready_redirect();fp=Response(b'');fp.close_error=RuntimeError('secondary')
  with self.assertRaises(m.Refusal)as caught:redirect.http_error_302(None,fp,302,'',{'Location':'https://foreign.invalid'})
  self.assertEqual(str(caught.exception),'redirect-refused');self.assertEqual(self.owner.first,'redirect-refused');self.assertEqual(self.owner.secondary,'response-close-refused')
 def test_swallowed_read_reentry_stops_hash_and_next_open(self):
  self.harness()
  def swallowed():
   try:self.owner.status()
   except m.Refusal:pass
  self.responses[0].hook=swallowed
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(len(self.opened),1);self.assertEqual(self.owner.status()['firstFailure'],'transport-reentry');self.assertIsNone(self.owner.status()['inputRows'][0]['observedSha256'])
 def test_swallowed_close_reentry_no_next_open(self):
  self.harness();response=self.responses[0]
  def close():
   response.closes+=1
   try:self.owner.acquire()
   except m.Refusal:pass
  response.close=close
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(len(self.opened),1);self.assertEqual(response.closes,1);self.assertEqual(self.owner.status()['firstFailure'],'transport-reentry')
 def test_aggregate_deadline_before_opener(self):
  redirect=self.ready_redirect();self.owner.started=0
  with patch.object(m.time,'monotonic',return_value=361):
   with self.assertRaises(m.Refusal):self.owner._open(0)
  self.builder.assert_not_called()
 def test_per_input_deadline_closes_preserves_row(self):
  self.harness();clock=[0]
  def now():clock[0]+=1;return 91 if clock[0]>=5 else 0
  with patch.object(m.time,'monotonic',side_effect=now):
   with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(len(self.opened),1);self.assertEqual(self.responses[0].closes,1);self.assertEqual(self.owner.status()['firstFailure'],'fetch-deadline');self.assertFalse(self.owner.status()['complete'])
 def test_clock_error_during_fetch_clears_busy_lifecycle(self):
  self.harness();original=RuntimeError('clock original');calls=[0]
  def now():
   calls[0]+=1
   if calls[0]==3:raise original
   return 0
  with patch.object(m.time,'monotonic',side_effect=now):
   with self.assertRaises(RuntimeError)as caught:self.owner.acquire()
  self.assertIs(caught.exception,original);self.assertFalse(self.owner.busy);self.assertFalse(self.owner.fetching);self.assertTrue(self.owner.closed)
 def test_every_input_hash_failure_stops_later_fetch(self):
  self.harness()
  for index in range(6):
   with self.subTest(index=index):
    self.owner=m.Transport();self.responses=[Response(body)for body in self.bodies];self.opened=[];self.responses[index].body=b'x'*len(self.bodies[index])
    with self.assertRaises(m.Refusal):self.owner.acquire()
    self.assertEqual(len(self.opened),index+1);self.assertEqual([r.closes for r in self.responses],[1 if j<=index else 0 for j in range(6)]);self.assertFalse(self.owner.status()['complete'])
 def test_wrong_table_seal_and_bool_extent_before_clock_opener(self):
  self.harness()
  with patch.object(m,'_INPUTS_SHA256','0'*64),patch.object(m.time,'monotonic',side_effect=AssertionError('clock')):
   with self.assertRaises(m.Refusal):self.owner.acquire()
  self.builder.assert_not_called();self.owner=m.Transport();bad=list(self.table);bad[0]=(bad[0][0],bad[0][1],True,bad[0][3])
  with patch.object(m,'_INPUTS',tuple(bad)),patch.object(m.time,'monotonic',side_effect=AssertionError('clock')):
   with self.assertRaises(m.Refusal):self.owner.acquire()
  self.builder.assert_not_called()
 def test_builder_swallowed_reentry_never_calls_open(self):
  self.harness()
  def build(*args):
   try:self.owner.status()
   except m.Refusal:pass
   return self.opener
  self.builder.side_effect=build
  with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(self.opened,[]);self.assertEqual(self.owner.status()['firstFailure'],'transport-reentry')
 def test_redirect_close_swallowed_reentry_never_follows(self):
  redirect=self.ready_redirect();fp=Response(b'');redirect.parent=unittest.mock.Mock()
  def close():
   fp.closes+=1
   try:self.owner.status()
   except m.Refusal:pass
  fp.close=close
  with self.assertRaises(m.Refusal):redirect.http_error_302(None,fp,302,'',{'Location':'https://objects.githubusercontent.com/x'})
  self.assertEqual(fp.closes,1);redirect.parent.open.assert_not_called();self.assertEqual(self.owner.first,'transport-reentry')
 def test_request_constructor_swallowed_reentry_zero_open(self):
  self.harness();original=m.urllib.request.Request
  def request(*args,**kwargs):
   try:self.owner.status()
   except m.Refusal:pass
   return original(*args,**kwargs)
  with patch.object(m.urllib.request,'Request',side_effect=request):
   with self.assertRaises(m.Refusal):self.owner.acquire()
  self.assertEqual(self.opened,[]);self.assertEqual(self.owner.status()['firstFailure'],'transport-reentry');self.assertEqual(self.owner.status()['responseCloseAttempted'],0)
if __name__=='__main__':unittest.main()
