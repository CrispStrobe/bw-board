import bz2,hashlib,importlib.util,io,os,struct,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('notice_connection_controls',Path(__file__).with_name('coordinator.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def tar_member(name,body=b'',directory=False):
 h=bytearray(512);n=name.encode();h[:len(n)]=n
 for offset,size,v in ((100,8,0o644),(108,8,0),(116,8,0),(124,12,len(body)),(136,12,0)):h[offset:offset+size]=('%0*o'%(size-1,v)).encode()+b'\0'
 h[148:156]=b' '*8;h[156:157]=b'5' if directory else b'0';h[257:265]=b'ustar\00000';h[148:156]=('%06o'%sum(h)).encode()+b'\0 ';return bytes(h)+body+bytes((-len(body))%512)
class Controls(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.notice_bodies={'copying':b'raw\fnotice','copying.dj':b'noticeDJ','copying.lib':b'L'*35147};self.gcc=(b'runtime',b'G'*35147);self.files={'djgpp/cc1':b'small-cc1','djgpp/collect2':b'small-collect2'}
  rows=[{'path':'djgpp','type':'directory','bytes':0}]+[{'path':n,'type':'file','bytes':len(b),'sha256':sha(b)} for n,b in self.files.items()]
  tool=bz2.compress(tar_member('djgpp/',directory=True)+b''.join(tar_member(n,b) for n,b in self.files.items())+bytes(1024));buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_DEFLATED) as z:
   for n,b in self.notice_bodies.items():z.writestr(n,b)
  self.inputs=(tool,buf.getvalue(),b'opaque2',b'opaque3',*self.gcc);pins=tuple((str(i),len(b),sha(b)) for i,b in enumerate(self.inputs[:4]));selected={n:(len(b),sha(b)) for n,b in self.notice_bodies.items()};gccpins=tuple((role,len(b),sha(b)) for (role,_,_),b in zip(m.GCC_PINS,self.gcc));noticepins={m.ROLE_MAP[n]:(len(b),sha(b)) for n,b in self.notice_bodies.items()};noticepins.update({role:(extent,digest) for role,extent,digest in gccpins})
  for p in (patch.object(m.extractor,'PINS',pins),patch.object(m.bridge,'PINS',pins),patch.object(m.extractor,'SELECTED',selected),patch.object(m,'GCC_PINS',gccpins),patch.object(m.bridge,'ROWS',rows),patch.object(m.bridge.writer,'ROWS',rows),patch.object(m.bridge.writer,'NOTICES',noticepins)):
   p.start();self.addCleanup(p.stop)
 def owner(self):return m.Coordinator(self.tmp.name)
 def test_positive_same_call_fivebytes_and_copy_status(self):
  o=self.owner();r=o.provision(*self.inputs);self.assertTrue(r['observedInternalSameCallNoticeFlow']);self.assertEqual(r['noticeRolesIssued'],5);self.assertEqual(r['noticeBytesIssued'],sum(map(len,self.notice_bodies.values()))+sum(map(len,self.gcc)));self.assertIsNone(o._extractor);self.assertIsNone(o._bridge)
  for p in Path(self.tmp.name).glob('provision-*/notices/*'):
   bodies={**{m.ROLE_MAP[n]:b for n,b in self.notice_bodies.items()},'gcc-copying-runtime':self.gcc[0],'gcc-copying3':self.gcc[1]};self.assertEqual(p.read_bytes(),bodies[p.name])
  r['extractorFacts']['selectedFacts'][0]['bytes']=0;r['bridgeFacts']['writerStatus']['firstFailure']='fake';again=o.status();self.assertGreater(again['extractorFacts']['selectedFacts'][0]['bytes'],0);self.assertIsNone(again['bridgeFacts']['writerStatus']['firstFailure'])
 def test_all_six_auth_before_delegates(self):
  for i in range(6):
   o=self.owner();inputs=list(self.inputs);inputs[i]=b'wrong'
   with patch.object(m.extractor,'Extractor') as e,patch.object(m.bridge,'Bridge') as b:
    with self.assertRaises(m.Refusal):o.provision(*inputs)
    e.assert_not_called();b.assert_not_called()
   self.assertEqual(list(Path(self.tmp.name).iterdir()),[])
 def test_all_shapes_and_sameextent_badsha_before_parser(self):
  for value in (bytearray(self.inputs[-1]),b'X'*len(self.inputs[-1])):
   inputs=list(self.inputs);inputs[-1]=value;o=self.owner()
   with patch.object(m.extractor,'Extractor') as e:
    with self.assertRaises(m.Refusal):o.provision(*inputs)
    e.assert_not_called()
 def test_fragmented_extractor_blocks_reassembled(self):
  o=self.owner();real=m.extractor.Extractor.extract
  def extract(owner,*args):
   result=real(owner,*args);owner._selected={n:tuple(b[i:i+7] for i in range(0,len(b),7)) for n,b in self.notice_bodies.items()};return result
  with patch.object(m.extractor.Extractor,'extract',new=extract):r=o.provision(*self.inputs)
  self.assertTrue(r['observedInternalSameCallNoticeFlow'])
 def test_bad_source_shape_no_bridge_or_hooks(self):
  for case in ('custom-key','custom-tuple','wrong-body'):
   o=self.owner();real=m.extractor.Extractor.extract;entered=[]
   class Key:
    def __hash__(self):return hash('copying')
    def __eq__(self,other):entered.append(True);return other=='copying'
   class Tuple(tuple):
    def __iter__(self):entered.append(True);return super().__iter__()
   def extract(owner,*args):
    result=real(owner,*args)
    if case=='custom-key':value=owner._selected.pop('copying');owner._selected[Key()]=value
    elif case=='custom-tuple':owner._selected['copying']=Tuple(owner._selected['copying'])
    else:owner._selected['copying']=(b'X'*len(self.notice_bodies['copying']),)
    return result
   with patch.object(m.extractor.Extractor,'extract',new=extract),patch.object(m.bridge,'Bridge') as b:
    with self.assertRaises(m.Refusal):o.provision(*self.inputs)
    b.assert_not_called()
   self.assertEqual(entered,[])
 def test_extractor_reentry_no_bridge(self):
  o=self.owner();real=m.extractor.zlib.decompressobj;calls=[]
  def decoder(*args):calls.append(1);o.status();return real(*args)
  with patch.object(m.extractor.zlib,'decompressobj',new=decoder),patch.object(m.bridge,'Bridge') as b:
   with self.assertRaises(m.extractor.Refusal):o.provision(*self.inputs)
   b.assert_not_called()
  self.assertEqual(len(calls),1);self.assertEqual(o.first,'coordinator-reentry');self.assertEqual(o.status()['extractorFacts']['firstFailure'],'extractor-reentry')
 def test_bridge_reentry_no_writer(self):
  o=self.owner();real=m.bridge.Decoder;calls=[]
  def decoder(*args):calls.append(1);o.status();return real(*args)
  with patch.object(m.bridge,'Decoder',new=decoder),patch.object(m.bridge.writer,'Provisioner') as writer:
   with self.assertRaises(m.bridge.Refusal):o.provision(*self.inputs)
   writer.assert_not_called()
  self.assertEqual(len(calls),1);self.assertEqual(o.first,'coordinator-reentry')
 def test_writer_reentry_stops_later_writes(self):
  for method in ('status','close','provision'):
   o=self.owner();real=os.mkdir;calls=[]
   def mkdir(*a,**kw):
    result=real(*a,**kw);calls.append(1)
    try:getattr(o,method)(*(() if method!='provision' else self.inputs))
    except m.Refusal:pass
    return result
   with patch.object(m.bridge.writer.os,'mkdir',new=mkdir),patch.object(m.bridge.writer.os,'write') as write:
    with self.assertRaises(m.bridge.writer.Refusal):o.provision(*self.inputs)
    write.assert_not_called()
   self.assertEqual(len(calls),1);self.assertEqual(o.first,'coordinator-reentry');self.assertEqual(o.status()['bridgeFacts']['writerStatus']['firstFailure'],'observer-reentry')
 def test_original_error_plus_cleanup_refusal(self):
  original=OSError('private-original');o=self.owner()
  with patch.object(m.extractor.zlib,'decompressobj',side_effect=original),patch.object(m.extractor.Extractor,'close',side_effect=RuntimeError('cleanup')):
   with self.assertRaises(OSError) as caught:o.provision(*self.inputs)
  self.assertIs(caught.exception,original);self.assertEqual(o.first,'extractor-refused');self.assertEqual(o.cleanup_refused,1);self.assertFalse(o.status()['observedInternalSameCallNoticeFlow'])
 def test_cleanup_only_original_identity(self):
  original=OSError('cleanup-only');o=self.owner()
  with patch.object(m.extractor.Extractor,'close',side_effect=original):
   with self.assertRaises(OSError) as caught:o.provision(*self.inputs)
  self.assertIs(caught.exception,original);self.assertEqual(o.first,'cleanup-refused');self.assertFalse(o.status()['observedInternalSameCallNoticeFlow'])
 def test_closed_once_no_auth_or_delegates(self):
  o=self.owner();o.close()
  with patch.object(m.hashlib,'sha256') as h,patch.object(m.extractor,'Extractor') as e:
   with self.assertRaises(m.Refusal):o.provision(*self.inputs)
   h.assert_not_called();e.assert_not_called()
 def test_no_delegate_or_receipt_admission_signature(self):
  import inspect
  self.assertEqual(list(inspect.signature(m.Coordinator.provision).parameters),['self','toolchain','djcrx','djdev','djlsr','gcc_runtime','gcc_copying3'])
 def test_output_write_error_plus_close_uncertainty(self):
  original=OSError('write-original');o=self.owner();real=os.close
  def close(fd):real(fd);raise OSError('reported-close-uncertainty')
  with patch.object(m.bridge.writer.os,'write',side_effect=original),patch.object(m.bridge.writer.os,'close',new=close):
   with self.assertRaises(OSError) as caught:o.provision(*self.inputs)
  self.assertIs(caught.exception,original);self.assertGreater(o.status()['bridgeFacts']['writerStatus']['closeRefused'],0);self.assertFalse(o.status()['observedInternalSameCallNoticeFlow'])
 def test_adoption_hash_mutated_key_no_foreign_equality(self):
  o=self.owner();real=m.hashlib.sha256;entered=[]
  class Key:
   def __hash__(self):return hash('copying.dj')
   def __eq__(self,other):entered.append(True);return other=='copying.dj'
  def hashfn(body=b''):
   if o._extractor is not None and o._extractor.closed and body==self.notice_bodies['copying']:
    selected=o._extractor._selected;value=selected.pop('copying.dj');selected[Key()]=value
   return real(body)
  with patch.object(m.hashlib,'sha256',new=hashfn),patch.object(m.bridge,'Bridge') as b:
   with self.assertRaises(m.Refusal):o.provision(*self.inputs)
   b.assert_not_called()
  self.assertEqual(entered,[])
 def test_adoption_hash_reentry_no_bridge(self):
  o=self.owner();real=m.hashlib.sha256
  def hashfn(body=b''):
   if o._extractor is not None and o._extractor.closed and body==self.notice_bodies['copying']:o.status()
   return real(body)
  with patch.object(m.hashlib,'sha256',new=hashfn),patch.object(m.bridge,'Bridge') as b:
   with self.assertRaises(m.Refusal):o.provision(*self.inputs)
   b.assert_not_called()
  self.assertEqual(o.first,'coordinator-reentry');self.assertFalse(o.status()['observedInternalSameCallNoticeFlow'])
if __name__=='__main__':unittest.main()
