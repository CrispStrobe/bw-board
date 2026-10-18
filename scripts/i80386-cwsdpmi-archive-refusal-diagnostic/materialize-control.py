"""Manufactured archives only: diagnostic facts and unchanged parser acceptance."""
import bz2,hashlib,importlib.util,io,json
from pathlib import Path
import tarfile,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('diagnostic_fixture',Path(__file__).with_name('materialize.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

def header(kind=b'0',magic=b'ustar\x00',mode=0o644):
 r=bytearray(tarfile.TarInfo('fixture').tobuf(format=tarfile.USTAR_FORMAT));r[156:157]=kind;r[257:263]=magic;r[100:108]=('%07o\0'%mode).encode();r[148:156]=b'        ';r[148:156]=('%06o\0 '%sum(r)).encode();return bytes(r)
def archive(h):return bz2.compress(h+b'\x00'*1024)
class Controls(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.owner=d.FixedAliasMaterializer(self.tmp.name);self.addCleanup(self.owner.close)
 def refusal(self,h,reason):
  with self.assertRaises(d.base.Refusal) as caught:self.owner._tar(archive(h))
  value=self.owner.status()['archiveRefusalDiagnostic'];self.assertEqual(value['reason'],reason);self.assertEqual(value['headerOrdinal'],1);self.assertEqual(value['decodedOffset'],0);self.assertEqual(value['typeByte'],h[156]);self.assertEqual(json.loads(json.dumps(value)),value)
  return caught.exception
 def test_unsupported_types_differential(self):
  for kind in (b'L',b'K',b'x',b'g',b'2'):
   with self.subTest(kind=kind):
    owner=d.FixedAliasMaterializer(self.tmp.name)
    try:
     with self.assertRaises(d.base.Refusal) as a:owner._tar(archive(header(kind)))
     old=d.old.FixedAliasMaterializer(self.tmp.name)
     try:
      with self.assertRaises(d.base.Refusal) as b:old._tar(archive(header(kind)))
      self.assertEqual(a.exception.args,b.exception.args);self.assertEqual(owner.status()['archiveRefusalDiagnostic']['reason'],'type-or-mode')
     finally:old.close()
    finally:owner.close()
 def test_magic(self):self.refusal(header(magic=b'other!'),'magic')
 def test_mode(self):self.refusal(header(mode=0o4644),'type-or-mode')
 def test_base256(self):
  h=bytearray(header());h[124]=128;h[148:156]=b'        ';h[148:156]=('%06o\0 '%sum(h)).encode();self.refusal(bytes(h),'extent-number')
 def test_checksum(self):
  h=bytearray(header());h[0]=ord('X');self.refusal(bytes(h),'checksum')
 def test_first_retained_and_offset(self):
  h=header(b'L');self.refusal(h,'type-or-mode');first=self.owner.status()['archiveRefusalDiagnostic']
  with self.assertRaises(d.base.Refusal):self.owner._tar(archive(header(magic=b'other!')))
  self.assertEqual(first,self.owner.status()['archiveRefusalDiagnostic'])
 def test_full_positive_inherited_fixture(self):
  path=Path(__file__).parent.parent/'i80386-cwsdpmi-fixed-archive-materialization/run-control.py';spec=importlib.util.spec_from_file_location('private_runner_fixture',path);f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
  inputs=f.fixtures()
  with patch.dict(d.base.SELECTED,f.PINS,clear=True),patch.dict(d.TARGETS,f.TARGET_PINS,clear=True):
   result=self.owner._tar(inputs[0]);self.assertEqual(set(result),set(d.base.SELECTED));self.assertIsNone(self.owner.status()['archiveRefusalDiagnostic'])
   old=d.old.FixedAliasMaterializer(self.tmp.name)
   try:self.assertEqual(result,old._tar(inputs[0]))
   finally:old.close()
 def test_malformed_alias_differential(self):
  h=bytearray(header(b'1'));name=next(iter(d.ALIASES));target='wrong-target';h[:100]=name.encode().ljust(100,b'\0');h[157:257]=target.encode().ljust(100,b'\0');h[148:156]=b'        ';h[148:156]=('%06o\0 '%sum(h)).encode()
  old=d.old.FixedAliasMaterializer(self.tmp.name)
  try:
   with self.assertRaises(d.base.Refusal) as a:self.owner._tar(archive(bytes(h)))
   with self.assertRaises(d.base.Refusal) as b:old._tar(archive(bytes(h)))
   self.assertEqual(a.exception.args,b.exception.args);self.assertEqual(self.owner.status()['archiveRefusalDiagnostic']['reason'],'hardlink-target')
  finally:old.close()
 def test_full_failure_diagnostic_copied_status(self):
  path=Path(__file__).parent.parent/'i80386-cwsdpmi-fixed-archive-materialization/run-control.py';spec=importlib.util.spec_from_file_location('private_failed_runner_fixture',path);f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
  def callback(runner,inputs):
   bad=archive(header(b'L'));original=runner._materializer._tar
   with patch.object(runner._materializer,'_tar',lambda unused:original(bad)):
    with self.assertRaises(f.m.Refusal):runner.materialize(*inputs)
   packet=runner.report();a=packet['materializeStatus']['archiveRefusalDiagnostic'];b=packet['closeStatus']['archiveRefusalDiagnostic']
   self.assertEqual(a,b);self.assertEqual(a['reason'],'type-or-mode');self.assertEqual(a['typeByte'],76)
   self.assertEqual(packet['observerReceipts'],[]);self.assertFalse(packet['wrapper']['phase']=='complete')
   self.assertEqual(len(packet['materializeStatus']['authenticatedArchives']),4)
  f.Controls().exercise(callback)
 def test_later_header_offset(self):
  h=bytearray(header(b'5'));h[:100]=b'dir'+b'\0'*97;h[148:156]=b'        ';h[148:156]=('%06o\0 '%sum(h)).encode()
  with self.assertRaises(d.base.Refusal):self.owner._tar(bz2.compress(bytes(h)+header(b'L')+b'\0'*1024))
  v=self.owner.status()['archiveRefusalDiagnostic'];self.assertEqual((v['headerOrdinal'],v['decodedOffset']),(2,512))
if __name__=='__main__':
 path=Path(__file__).parent.parent/'i80386-fixed-archive-acquisition/acquire-control.py'
 spec=importlib.util.spec_from_file_location('manufactured_acquisition_controls',path);a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
 suite=unittest.TestSuite((unittest.defaultTestLoader.loadTestsFromTestCase(Controls),unittest.defaultTestLoader.loadTestsFromModule(a)))
 result=unittest.TextTestRunner().run(suite)
 raise SystemExit(0 if result.wasSuccessful() else 1)
