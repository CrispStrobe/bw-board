import hashlib,importlib.util,struct,tempfile,unittest,zlib
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('djgpp_notice_controls',Path(__file__).with_name('extractor.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def zipbytes(entries):
 local=bytearray();central=bytearray()
 for e in entries:
  name=e['name'].encode();body=e.get('body',b'');method=e.get('method',0);flags=e.get('flags',0);extent=e.get('extent',len(body));crc=e.get('crc',zlib.crc32(body)&0xffffffff);attrs=e.get('attrs',0);extra=e.get('extra',b'');comment=e.get('comment',b'');offset=len(local)
  if method==8:
   d=zlib.compressobj(wbits=-15);payload=d.compress(body)+d.flush()+e.get('tail',b'')
  else:payload=body
  local+=struct.pack('<4s5H3L2H',b'PK\x03\x04',20,flags,method,0,0,crc,len(payload),extent,len(name),len(extra))+name+extra+payload
  central+=struct.pack('<4s6H3L5H2L',b'PK\x01\x02',20,20,flags,method,0,0,crc,len(payload),extent,len(name),len(extra),len(comment),0,0,attrs,offset)+name+extra+comment
 return bytes(local+central+struct.pack('<4s4H2LH',b'PK\x05\x06',0,0,len(entries),len(entries),len(central),len(local),0))
class Controls(unittest.TestCase):
 def setUp(self):
  self.bodies={'copying':b'raw\fnotice','copying.dj':b'separate','copying.lib':b'Q'*35147};p=patch.object(m,'SELECTED',{n:(len(b),sha(b)) for n,b in self.bodies.items()});p.start();self.addCleanup(p.stop)
 def entries(self,method=0):return [{'name':'docs/','body':b''}]+[{'name':n,'body':b,'method':method} for n,b in self.bodies.items()]
 def fixture(self,entries=None,raw=None):
  raw=zipbytes(self.entries() if entries is None else entries) if raw is None else raw;inputs=(b'opaque0',raw,b'opaque2',b'opaque3');pins=tuple((str(i),len(b),sha(b)) for i,b in enumerate(inputs));return inputs,pins
 def execute(self,entries=None,raw=None,o=None):
  b,p=self.fixture(entries,raw);o=o or m.Extractor()
  with patch.object(m,'PINS',p):o.extract(*b)
  return o
 def refuse(self,entries=None,raw=None,reason=None):
  o=m.Extractor()
  with self.assertRaises((m.Refusal,zlib.error)):self.execute(entries,raw,o)
  self.assertFalse(o.status()['observedSyntheticSelectedConsistency']);self.assertEqual(o._selected,{})
  if reason:self.assertEqual(o.first,reason)
  return o
 def test_stored_deflate_and_raw_notices(self):
  for method in (0,8):
   o=self.execute(self.entries(method));self.assertEqual(o.authenticated,4);self.assertTrue(o.status()['observedSyntheticSelectedConsistency']);self.assertEqual(len(o._selected),3)
   for n,b in self.bodies.items():self.assertEqual(b''.join(o._selected[n]),b)
   self.assertFalse(o.status()['sourceIssuedHandoffQualified']);self.assertFalse(o.status()['actualZipCompatibilityQualified'])
 def test_wrong_every_input_before_parser(self):
  for i in range(4):
   b,p=self.fixture();b=list(b);b[i]=b'wrong';o=m.Extractor()
   with patch.object(m,'PINS',p),patch.object(o,'parse') as parse,patch.object(o,'_unpack') as unpack:
    with self.assertRaises(m.Refusal):o.extract(*b)
    parse.assert_not_called();unpack.assert_not_called()
 def test_same_length_hash_and_custom_bytes(self):
  for transform in (lambda b:b'X'*len(b),lambda b:bytearray(b)):
   b,p=self.fixture();b=list(b);b[3]=transform(b[3]);o=m.Extractor()
   with patch.object(m,'PINS',p),patch.object(o,'parse') as parse:
    with self.assertRaises(m.Refusal):o.extract(*b)
    parse.assert_not_called()
 def test_direct_parser_no_struct_or_decoder(self):
  for state in ('new','closed','completed'):
   o=m.Extractor()
   if state=='closed':o.close()
   if state=='completed':self.execute(o=o)
   before=(o.members,o.decoded,o.reserved,o.parse_entered)
   with patch.object(o,'_unpack') as unpack,patch.object(m.zlib,'decompressobj') as decoder:
    with self.assertRaises(m.Refusal):o.parse(b'x')
    unpack.assert_not_called();decoder.assert_not_called()
   self.assertEqual(before,(o.members,o.decoded,o.reserved,o.parse_entered))
 def test_duplicate_ancestors_both_orders(self):
  self.refuse(self.entries()+[self.entries()[1]],reason='duplicate')
  for es in ([{'name':'foo','body':b'x'},{'name':'foo/bar','body':b'y'}],[{'name':'foo/bar','body':b'y'},{'name':'foo','body':b'x'}]):self.refuse(es+self.entries(),reason='file-ancestor')
 def test_unsafe_names(self):
  for name in ('../evil','/absolute','foo\\bar','foo:bar','a//b','docs//','nul\0name'):
   self.refuse([{'name':name}]+self.entries())
 def test_type_mode_and_directory_crc(self):
  for attrs in (0o120777<<16,0o020600<<16,0o104755<<16,8):self.refuse([{'name':'special','body':b'x','attrs':attrs}]+self.entries(),reason='member-mode')
  self.refuse([{'name':'docs/','crc':1}]+self.entries()[1:],reason='crc-or-extent')
  self.refuse([{'name':'ordinary','attrs':0x10}]+self.entries(),reason='member-mode')
 def test_flag_methods_extra_comment(self):
  for key,value in [('flags',1),('flags',8),('method',12),('extra',b'xx'),('comment',b'x')]:
   es=self.entries();es[1][key]=value;self.refuse(es)
 def test_crc_extent_hash_and_missing(self):
  es=self.entries();es[1]['crc']=0;self.refuse(es,reason='crc-or-extent')
  es=self.entries();es[1]['extent']=1;self.refuse(es,reason='stored-extent')
  es=self.entries();es[1]['body']=b'X'*len(es[1]['body']);self.refuse(es,reason='selected-hash')
  self.refuse(self.entries()[:-1],reason='selected-set')
 def test_deflate_tail_truncation_and_output_guard(self):
  es=self.entries(8);es[1]['tail']=b'x';self.refuse(es,reason='deflate-tail')
  es=[{'name':'extra','body':b'Z'*2000,'method':8,'extent':1}]+self.entries();self.refuse(es,reason='decoded-extent')
  raw=zipbytes(self.entries(8));self.refuse(raw=raw[:-1],reason='eocd')
 def test_local_central_mismatch(self):
  raw=bytearray(zipbytes(self.entries()));raw[30]=ord('X');self.refuse(raw=bytes(raw),reason='local-name-extent')
  raw=bytearray(zipbytes(self.entries()));raw[14]^=1;self.refuse(raw=bytes(raw),reason='local-central')
 def test_eocd_multidisk_count_zip64(self):
  for offset,value,fmt in [(4,1,'<H'),(10,65535,'<H'),(16,0xffffffff,'<L')]:
   raw=bytearray(zipbytes(self.entries()));struct.pack_into(fmt,raw,len(raw)-22+offset,value);self.refuse(raw=bytes(raw))
 def test_unindexed_prefix_gap_tail_overlap(self):
  raw=zipbytes(self.entries());self.refuse(raw=b'prefix'+raw);self.refuse(raw=raw+b'tail')
  central=struct.unpack_from('<L',raw,len(raw)-6)[0];r=bytearray(raw);struct.pack_into('<L',r,central+42,1);self.refuse(raw=bytes(r),reason='local-topology')
 def test_all_reservations_before_decompression(self):
  for field,value in [('MAX_TOTAL',1),('MAX_FILE',1),('MAX_RATIO',1),('MAX_MEMBERS',1)]:
   with patch.object(m,field,value),patch.object(m.zlib,'decompressobj') as decoder:
    self.refuse(self.entries(8));decoder.assert_not_called()
 def test_swallowed_decoder_reentry_no_selected_adoption(self):
  o=m.Extractor();real=m.zlib.decompressobj;calls=[]
  def decoder(*a):calls.append(1);o.status();return real(*a)
  with patch.object(m.zlib,'decompressobj',new=decoder):
   with self.assertRaises(m.Refusal):self.execute(self.entries(8),o=o)
  self.assertEqual(len(calls),1);self.assertEqual(o.first,'extractor-reentry');self.assertEqual(o._selected,{})
 def test_nested_parser_and_closed_once(self):
  o=m.Extractor();real=o._unpack;calls=[]
  def unpack(*a):
   calls.append(1)
   try:o.parse(b'x')
   except m.Refusal:pass
   return real(*a)
  with patch.object(o,'_unpack',new=unpack):
   with self.assertRaises(m.Refusal):self.execute(o=o)
  self.assertEqual(len(calls),1);self.assertEqual(o.first,'extractor-reentry')
  o=m.Extractor();o.close()
  with patch.object(m.hashlib,'sha256') as hashfn:
   with self.assertRaises(m.Refusal):o.extract(b'',b'',b'',b'')
   hashfn.assert_not_called()
 def test_original_decoder_error_identity(self):
  original=OSError('synthetic-original');o=m.Extractor()
  with patch.object(m.zlib,'decompressobj',side_effect=original):
   with self.assertRaises(OSError) as caught:self.execute(self.entries(8),o=o)
  self.assertIs(caught.exception,original);self.assertEqual(o.first,'operation-refused');self.assertEqual(o._selected,{})
 def test_crc_reentry_stops_hash_update_and_selection(self):
  o=m.Extractor();realsha=m.hashlib.sha256;realcrc=m.zlib.crc32;updates=[];hexes=[]
  class Hash:
   def __init__(self):self.h=realsha()
   def update(self,body):updates.append(1);self.h.update(body)
   def hexdigest(self):hexes.append(1);return self.h.hexdigest()
  def constructor(body=None):return realsha(body) if body is not None else Hash()
  def crc(*args):value=realcrc(*args);o.status();return value
  b,p=self.fixture()
  with patch.object(m,'PINS',p),patch.object(m.hashlib,'sha256',new=constructor),patch.object(m.zlib,'crc32',new=crc):
   with self.assertRaises(m.Refusal):o.extract(*b)
  self.assertEqual(updates,[]);self.assertEqual(hexes,[]);self.assertEqual(o._selected,{});self.assertEqual(o.first,'extractor-reentry')
 def test_hash_constructor_reentry_no_crc_decode_or_hash(self):
  for auth in (False,True):
   o=m.Extractor();real=m.hashlib.sha256;later=[]
   class Hash:
    def update(self,body):later.append('update')
    def hexdigest(self):later.append('hex');return '0'*64
   def constructor(body=None):
    if auth or body is None:o.status();return Hash()
    return real(body)
   b,p=self.fixture()
   with patch.object(m,'PINS',p),patch.object(m.hashlib,'sha256',new=constructor),patch.object(m.zlib,'crc32') as crc,patch.object(m.zlib,'decompressobj') as decoder:
    with self.assertRaises(m.Refusal):o.extract(*b)
    crc.assert_not_called();decoder.assert_not_called()
   self.assertEqual(later,[]);self.assertEqual(o._selected,{});self.assertEqual(o.first,'extractor-reentry')
 def test_body_hexdigest_reentry_no_next_body(self):
  o=m.Extractor();real=m.hashlib.sha256;updates=[]
  class Hash:
   def __init__(self):self.h=real()
   def update(self,body):updates.append(1);self.h.update(body)
   def hexdigest(self):o.status();return self.h.hexdigest()
  def constructor(body=None):return real(body) if body is not None else Hash()
  b,p=self.fixture()
  with patch.object(m,'PINS',p),patch.object(m.hashlib,'sha256',new=constructor):
   with self.assertRaises(m.Refusal):o.extract(*b)
  self.assertEqual(len(updates),1);self.assertEqual(o._selected,{});self.assertEqual(o._facts,[])
if __name__=='__main__':unittest.main()
