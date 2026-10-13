"""Small synthetic bytes/files only; private pins patched, no actual archive inputs."""
import bz2,hashlib,importlib.util,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('bound_bridge',Path(__file__).with_name('bridge.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def header(name,kind=b'0',size=0,link='',mode=0o644,gnu=False):
 h=bytearray(512);n=name.encode();h[:min(100,len(n))]=n[:100]
 def octal(at,n,v):h[at:at+n]=('%0*o'%(n-1,v)).encode()+b'\0'
 octal(100,8,mode);octal(108,8,0);octal(116,8,0);octal(124,12,size);octal(136,12,0);h[148:156]=b' '*8;h[156:157]=kind;h[157:157+len(link)]=link.encode();h[257:265]=b'ustar  \0' if gnu else b'ustar\00000';h[148:156]=('%06o'%sum(h)).encode()+b'\0 ';return bytes(h)
def member(name,body=b'',kind=b'0',link='',mode=0o644):return header(name,kind,len(body),link,mode)+body+bytes((-len(body))%512)
def long(name):return header('././@LongLink',b'L',len(name)+1,gnu=True)+name.encode()+b'\0'+bytes((-(len(name)+1))%512)
class Controls(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.bodies={'djgpp/cc1':b'synthetic cc1','djgpp/collect2':b'collect'};self.rows=[{'path':'djgpp','type':'directory','bytes':0}]+[{'path':p,'type':'file','bytes':len(b),'sha256':sha(b)} for p,b in self.bodies.items()]+[{'path':'djgpp/alias','type':'hardlink','bytes':0,'resolved':'djgpp/cc1','target':'djgpp/cc1'}]
  self.notices={'notice':[b'a\fb']};self.noticepins={'notice':(3,sha(b'a\fb'))}
  for p in (patch.object(m,'ROWS',self.rows),patch.object(m.writer,'ROWS',self.rows),patch.object(m.writer,'NOTICES',self.noticepins)):
   p.start();self.addCleanup(p.stop)
 def tar(self):return member('djgpp/',kind=b'5')+b''.join(member(p,b) for p,b in self.bodies.items())+member('djgpp/alias',kind=b'1',link='djgpp/cc1')+bytes(1024)
 def inputs(self,tar=None):
  bodies=(bz2.compress(self.tar() if tar is None else tar),b'opaque1',b'opaque2',b'opaque3');pins=tuple((str(i),len(b),sha(b)) for i,b in enumerate(bodies));return bodies,pins
 def execute(self,tar=None,owner=None):
  bodies,pins=self.inputs(tar);o=owner or m.Bridge(self.tmp.name)
  with patch.object(m,'PINS',pins):o.provision(*bodies,self.notices)
  return o
 def refused(self,tar,reason=None):
  o=m.Bridge(self.tmp.name)
  with self.assertRaises((m.Refusal,OSError,EOFError,ValueError)):self.execute(tar,o)
  self.assertIsNone(o.active);self.assertFalse(o.status()['observedPrototypeComplete'])
  if reason:self.assertEqual(o.first,reason)
  return o
 def test_positive_bridge_physical_alias_and_notice(self):
  o=self.execute();r=o.status();self.assertTrue(r['observedPrototypeComplete']);self.assertEqual(r['authenticatedInputs'],4);self.assertEqual(r['writerStatus']['physicalAliasesObserved'],1)
  for key in ('sourceOwnedQualified','fullToolchainReady','noticeSourceOwnedQualified','opaqueZipSourceJoinsQualified','compilerQualified'):self.assertIs(r[key],False)
 def test_all_four_auth_before_parser_writer(self):
  for i in range(4):
   bodies,pins=self.inputs();changed=list(bodies);changed[i]=b'wrong';o=m.Bridge(self.tmp.name)
   with patch.object(m,'PINS',pins),patch.object(o,'parse') as parse,patch.object(m.writer,'Provisioner') as writer:
    with self.assertRaises(m.Refusal):o.provision(*changed,self.notices)
    parse.assert_not_called();writer.assert_not_called()
 def test_hash_mismatch_before_parser(self):
  bodies,pins=self.inputs();pins=list(pins);pins[3]=(pins[3][0],pins[3][1],'0'*64);o=m.Bridge(self.tmp.name)
  with patch.object(m,'PINS',pins),patch.object(o,'parse') as parse:
   with self.assertRaises(m.Refusal):o.provision(*bodies,self.notices)
   parse.assert_not_called()
 def test_gnu_boundaries(self):
  for length in (100,101,240):
   name='djgpp/'+('x'*(length-6));b=b'long';rows=[{'path':'djgpp','type':'directory','bytes':0},{'path':name,'type':'file','bytes':len(b),'sha256':sha(b)}]
   with patch.object(m,'ROWS',rows),patch.object(m.writer,'ROWS',rows):
    o=self.execute(member('djgpp/',kind=b'5')+long(name)+member(name,b)+bytes(1024));self.assertEqual(o.gnu,1);self.assertEqual(o.applied,1);self.assertFalse(o.pending)
 def test_gnu_orphan_duplicate_pending_and_k(self):
  for tar,reason in [(long('djgpp/cc1')+bytes(1024),'gnu-orphan'),(long('djgpp/cc1')+long('djgpp/cc1')+bytes(1024),'gnu-header'),(long('djgpp/cc1')+header('djgpp/cc1',b'K')+bytes(1024),'type')]:self.refused(tar,reason)
 def test_gnu_payload_padding_placeholder(self):
  for tar,reason in [(header('././@LongLink',b'L',3,gnu=True)+b'abx'+bytes(509),'gnu-payload'),(long('djgpp/cc1')[:-1]+b'X','gnu-padding'),(long('djgpp/cc1')+member('djgpp/other',b'xx'),'gnu-placeholder')]:self.refused(tar,reason)
 def test_checksum_mode_and_unsupported(self):
  bad=bytearray(self.tar());bad[0]^=1;self.refused(bytes(bad),'checksum')
  self.refused(member('djgpp/',kind=b'5',mode=0o4644),'mode')
  for k in (b'2',b'x',b'g',b'K'):self.refused(header('djgpp',k),'type')
 def test_missing_extra_duplicate(self):
  self.refused(member('djgpp/',kind=b'5')+bytes(1024),'missing-member');self.refused(member('extra',b'x'),'extra-member');self.refused(member('djgpp/',kind=b'5')*2,'duplicate')
 def test_extent_and_hash(self):
  self.refused(member('djgpp/',kind=b'5')+member('djgpp/cc1',b'bad'),'member-extent')
  self.refused(member('djgpp/',kind=b'5')+member('djgpp/cc1',b'X'*len(self.bodies['djgpp/cc1'])),'member-hash')
 def test_alias_forward_wrong_target_and_type(self):
  self.refused(member('djgpp/',kind=b'5')+member('djgpp/alias',kind=b'1',link='djgpp/cc1'),'alias-target')
  self.refused(member('djgpp/',kind=b'5')+member('djgpp/cc1',self.bodies['djgpp/cc1'])+member('djgpp/alias',kind=b'1',link='djgpp/collect2'),'alias-target')
  self.refused(member('djgpp/',kind=b'5')+member('djgpp/alias',b'x'),'member-type')
 def test_decoded_content_member_caps(self):
  for obj,field,value in [(m,'MAX_DECODED',511),(m,'MAX_MEMBERS',1),(m.writer,'CONTENT_TOTAL_CAP',1),(m.writer,'CONTENT_FILE_CAP',1)]:
   with patch.object(obj,field,value):self.refused(self.tar())
 def test_bz2_concat_truncate_and_raw_tail(self):
  for transform in (lambda b:b+bz2.compress(b''),lambda b:b[:-1],lambda b:b+b'garbage'):
   bodies,pins=self.inputs();b=transform(bodies[0]);bodies=(b,)+bodies[1:];pins=((pins[0][0],len(b),sha(b)),)+pins[1:];o=m.Bridge(self.tmp.name)
   with patch.object(m,'PINS',pins):
    with self.assertRaises((m.Refusal,EOFError,OSError)):o.provision(*bodies,self.notices)
   self.assertIsNone(o.active)
 def test_tar_padding_and_tail(self):
  tar=bytearray(self.tar());tar[1024+len(self.bodies['djgpp/cc1'])]=1;self.refused(bytes(tar),'body-padding');self.refused(self.tar()+b'x','trailing-data')
 def test_notice_missing_custom_before_writer(self):
  for value in ({}, {'notice':iter([b'a\fb'])}):
   o=m.Bridge(self.tmp.name);b,p=self.inputs()
   with patch.object(m,'PINS',p),patch.object(o,'parse') as parse:
    with self.assertRaises(m.writer.Refusal):o.provision(*b,value)
    parse.assert_not_called()
 def test_once_closed_no_hash_or_parse(self):
  o=m.Bridge(self.tmp.name);o.close()
  with patch.object(m.hashlib,'sha256') as h,patch.object(o,'parse') as parse:
   with self.assertRaises(m.Refusal):o.provision(b'',b'',b'',b'',{})
   h.assert_not_called();parse.assert_not_called()
 def test_delegated_reentry_poison_stops_writes(self):
  for method in ('status','close','provision'):
   o=m.Bridge(self.tmp.name);real=os.mkdir;calls=[]
   def mkdir(*a,**kw):
    r=real(*a,**kw);calls.append(1)
    try:getattr(o,method)(*(() if method!='provision' else (b'',b'',b'',b'',{})))
    except m.Refusal:pass
    return r
   with patch.object(m.writer.os,'mkdir',side_effect=mkdir),patch.object(m.writer.os,'write') as write:
    with self.assertRaises((m.Refusal,m.writer.Refusal)):self.execute(owner=o)
    write.assert_not_called()
   self.assertEqual(len(calls),1);self.assertEqual(o.first,'bridge-reentry');self.assertEqual(o.writer_status['firstFailure'],'observer-reentry')
 def test_writer_original_error_and_close_uncertainty(self):
  o=m.Bridge(self.tmp.name);original=OSError('private-test')
  with patch.object(m.writer.os,'write',side_effect=original):
   with self.assertRaises(OSError) as caught:self.execute(owner=o)
  self.assertIs(caught.exception,original);self.assertFalse(o.status()['observedPrototypeComplete']);self.assertEqual(o.writer_status['firstFailure'],'filesystem-refusal')
 def test_deadline_before_parse_and_primitive_inputs(self):
  with patch.object(m,'DEADLINE',-1):self.refused(self.tar(),'deadline')
  b,p=self.inputs();o=m.Bridge(self.tmp.name)
  with patch.object(m,'PINS',p):
   with self.assertRaises(m.Refusal):o.provision(bytearray(b[0]),*b[1:],self.notices)
 def test_file_ancestor_both_orders(self):
  rows=[{'path':'foo','type':'file','bytes':1,'sha256':sha(b'x')},{'path':'foo/bar','type':'file','bytes':1,'sha256':sha(b'y')}]
  with patch.object(m,'ROWS',rows):
   for t in (member('foo',b'x')+member('foo/bar',b'y'),member('foo/bar',b'y')+member('foo',b'x')):self.refused(t,'file-ancestor')
 def test_original_error_with_close_uncertainty(self):
  o=m.Bridge(self.tmp.name);original=OSError('original-write');real=os.close
  def close(fd):real(fd);raise OSError('reported-close-uncertainty')
  with patch.object(m.writer.os,'write',side_effect=original),patch.object(m.writer.os,'close',side_effect=close):
   with self.assertRaises(OSError) as caught:self.execute(owner=o)
  self.assertIs(caught.exception,original);self.assertGreater(o.writer_status['closeRefused'],0);self.assertFalse(o.writer_status['handlesClosedWithoutReportedRefusal']);self.assertFalse(o.status()['observedPrototypeComplete'])
 def test_authentication_swallowed_reentry_stops_parser(self):
  o=m.Bridge(self.tmp.name);b,p=self.inputs();real=m.hashlib.sha256;calls=[]
  def hashbody(body=b''):
   calls.append(1)
   if len(calls)==4:o.status()
   return real(body)
  with patch.object(m,'PINS',p),patch.object(m.hashlib,'sha256',side_effect=hashbody),patch.object(o,'parse') as parse,patch.object(m.writer,'Provisioner') as writer:
   with self.assertRaises(m.Refusal):o.provision(*b,self.notices)
   parse.assert_not_called();writer.assert_not_called()
  self.assertEqual(o.first,'bridge-reentry')
 def test_bz2_cross_chunk_body_and_truncation(self):
  body=bytes(range(256))*513;rows=[{'path':'djgpp','type':'directory','bytes':0},{'path':'djgpp/cc1','type':'file','bytes':len(body),'sha256':sha(body)}]
  with patch.object(m,'ROWS',rows),patch.object(m.writer,'ROWS',rows):
   tar=member('djgpp/',kind=b'5')+member('djgpp/cc1',body)+bytes(1024);o=self.execute(tar);self.assertEqual(o.chunks,3);self.assertEqual(o.reserved,len(body))
   self.refused(tar[:512+512+65537],'archive-truncated')
 def test_direct_parser_entry_refuses_before_decoder(self):
  for state in ('new','closed','wrong-phase','completed'):
   o=m.Bridge(self.tmp.name)
   if state=='closed':o.close()
   elif state=='wrong-phase':o.entered=True;o.authenticated=4;o.phase='writing'
   elif state=='completed':self.execute(owner=o)
   before=(o.headers,o.gnu,o.applied,o.decoded,o.reserved,o.chunks,o.parse_entered)
   with patch.object(m,'Decoder') as decoder:
    with self.assertRaises(m.Refusal):o.parse(b'x')
    decoder.assert_not_called()
   self.assertEqual(before,(o.headers,o.gnu,o.applied,o.decoded,o.reserved,o.chunks,o.parse_entered))
 def test_nested_parser_entry_poisons_before_second_decoder(self):
  o=m.Bridge(self.tmp.name);real=m.Decoder;calls=[]
  def decoder(data,check):
   calls.append(1)
   try:o.parse(b'x')
   except m.Refusal:pass
   return real(data,check)
  with patch.object(m,'Decoder',new=decoder):
   with self.assertRaises(m.Refusal):self.execute(owner=o)
  self.assertEqual(len(calls),1);self.assertEqual(o.first,'bridge-reentry');self.assertIsNone(o.active);self.assertEqual(o.headers,0)
 def test_parser_misuse_during_writer_poisons_writer(self):
  o=m.Bridge(self.tmp.name);real=os.mkdir;calls=[]
  def mkdir(*a,**kw):
   r=real(*a,**kw);calls.append(1)
   try:o.parse(b'x')
   except m.Refusal:pass
   return r
  with patch.object(m.writer.os,'mkdir',new=mkdir),patch.object(m.writer.os,'write') as write:
   with self.assertRaises(m.writer.Refusal):self.execute(owner=o)
   write.assert_not_called()
  self.assertEqual(len(calls),1);self.assertEqual(o.first,'bridge-reentry');self.assertEqual(o.writer_status['firstFailure'],'observer-reentry')
if __name__=='__main__':unittest.main()
