"""Manufactured GNU name metadata and filesystem fixtures only."""
import bz2,importlib.util,io,json
from pathlib import Path
import tarfile,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('private_gnu_fixture',Path(__file__).with_name('materialize.py'));g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
def header(name='placeholder',kind=b'0',extent=0,mode=0o644,link='',magic=b'ustar '):
 t=tarfile.TarInfo('placeholder');t.type=kind;t.size=extent;t.mode=mode;t.linkname=link
 h=bytearray(t.tobuf(format=tarfile.GNU_FORMAT));h[:100]=name.encode().ljust(100,b'\0')[:100];h[257:263]=magic;h[148:156]=b'        ';h[148:156]=('%06o\0 '%sum(h)).encode();return bytes(h)
def member(h,data=b'',padding=None):
 return h+data+(b'\0'*((-len(data))%512) if padding is None else padding)
def longname(name=None,payload=None,mode=0o644,magic=b'ustar ',sentinel='././@LongLink',link='',padding=None):
 data=name.encode()+b'\0' if payload is None else payload
 return member(header(sentinel,b'L',len(data),mode,link,magic),data,padding)
def compressed(parts):return bz2.compress(b''.join(parts)+b'\0'*1024)
def fixture_module():
 p=Path(__file__).parent.parent/'i80386-cwsdpmi-fixed-archive-materialization/run-control.py';s=importlib.util.spec_from_file_location('private_gnu_runner_fixtures',p);f=importlib.util.module_from_spec(s);s.loader.exec_module(f);return f
class Controls(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.owner=g.FixedAliasMaterializer(self.tmp.name);self.addCleanup(self.owner.close)
 def refuse(self,parts,code=None,reason=None):
  with self.assertRaises(g.base.Refusal) as caught:self.owner._tar(compressed(parts))
  if code:self.assertEqual(caught.exception.args,(code,))
  if reason:self.assertEqual(self.owner.status()['archiveRefusalDiagnostic']['reason'],reason)
 def test_full_materialize_files_dirs_aliases_and_no_metadata_output(self):
  f=fixture_module()
  def callback(runner,inputs):
   raw=bz2.decompress(inputs[0]);parts=[];offset=0;count=0
   while raw[offset:offset+512]!=b'\0'*512:
    h=raw[offset:offset+512];extent=int(h[124:136].strip(b' \0') or b'0',8);length=512+((extent+511)//512)*512;name=h[:100].split(b'\0')[0].decode();prefix=h[345:500].split(b'\0')[0].decode();name=prefix+'/'+name if prefix else name
    parts.extend((longname(name),raw[offset:offset+length]));offset+=length;count+=1
   name='extra/'+('n'*120)+'/';parts.extend((longname(name),header(name[:100],b'5')));count+=1
   name=name+'member';parts.extend((longname(name),member(header(name[:100],extent=1),b'x')));count+=1
   tool=compressed(parts)
   with patch.object(f.m,'TOOL_BYTES',len(tool)),patch.object(f.m,'TOOL_SHA',f.m.sha(tool)):
    packet=runner.materialize(tool,*inputs[1:])
   self.assertEqual(packet['wrapper']['phase'],'complete');self.assertEqual(packet['materializeStatus']['gnuLongNameHeaders'],count);self.assertEqual(packet['materializeStatus']['gnuLongNameNamesApplied'],count);self.assertFalse(packet['closeStatus']['gnuLongNamePending']);self.assertEqual(packet['materializeStatus']['writtenRoles'],list(f.PINS));self.assertEqual(packet['materializeStatus']['validatedAliasCount'],13)
   self.assertEqual(packet['materializeStatus']['archiveRefusalDiagnostic'],None);self.assertEqual(len(packet['observerReceipts']),2)
   root=Path(runner._materializer._observer._owner._parent)
   self.assertEqual(list(root.rglob('@LongLink')),[])
  f.Controls().exercise(callback)
 def test_plain_fixture_acceptance_differential(self):
  f=fixture_module();inputs=f.fixtures()
  with patch.dict(g.base.SELECTED,f.PINS,clear=True),patch.dict(g.TARGETS,f.TARGET_PINS,clear=True):
   new=self.owner._tar(inputs[0]);old=g.old.FixedAliasMaterializer(self.tmp.name)
   try:self.assertEqual(new,old._tar(inputs[0]))
   finally:old.close()
  self.assertEqual(self.owner.status()['gnuLongNameHeaders'],0)
 def test_boundaries_100_101_240_and241(self):
  for size in (100,101,240):
   owner=g.FixedAliasMaterializer(self.tmp.name)
   try:
    with self.assertRaises(g.base.Refusal) as caught:owner._tar(compressed((longname('n'*size),header(('n'*size)[:100]))))
    self.assertEqual(caught.exception.args,('selected-refused',));self.assertEqual(owner.status()['gnuLongNameNamesApplied'],1)
   finally:owner.close()
  self.refuse((longname('n'*241),),'archive-cap','gnu-longname-extent')
 def test_pending_duplicate_orphan(self):
  self.refuse((longname('first'),longname('second')),'archive-type','gnu-longname-pending')
  other=g.FixedAliasMaterializer(self.tmp.name)
  try:
   with self.assertRaises(g.base.Refusal):other._tar(compressed((longname('first'),)))
   self.assertEqual(other.status()['archiveRefusalDiagnostic']['reason'],'gnu-longname-orphan');self.assertTrue(other.status()['gnuLongNamePending'])
  finally:other.close()
 def test_truncated_payload(self):
  with self.assertRaises(g.base.Refusal) as caught:self.owner._tar(bz2.compress(header('././@LongLink',b'L',extent=5)+b'a'))
  self.assertEqual(caught.exception.args,('archive-truncated',));self.assertEqual(self.owner.status()['gnuLongNameHeaders'],0)
 def test_payload_nul_ascii(self):
  for payload in (b'abc',b'ab\0c\0',b'\xff\0',b'a\n\0',b'\0'):
   owner=g.FixedAliasMaterializer(self.tmp.name)
   try:
    with self.assertRaises(g.base.Refusal):owner._tar(compressed((longname(payload=payload),)))
    self.assertEqual(owner.status()['gnuLongNameHeaders'],0)
   finally:owner.close()
 def test_path_policy(self):
  for name in ('/absolute','../escape','a/../b','a:b','a\\b','a//b','././bad'):
   owner=g.FixedAliasMaterializer(self.tmp.name)
   try:
    with self.assertRaises(g.base.Refusal) as caught:owner._tar(compressed((longname(name),)))
    self.assertEqual(caught.exception.args,('archive-path',))
   finally:owner.close()
 def test_metadata_header_policy(self):
  for kwargs in ({'sentinel':'wrong'},{'magic':b'ustar\0'},{'link':'alias'},{'mode':0o4644}):
   owner=g.FixedAliasMaterializer(self.tmp.name)
   try:
    with self.assertRaises(g.base.Refusal):owner._tar(compressed((longname('name',**kwargs),)))
    self.assertEqual(owner.status()['gnuLongNameHeaders'],0)
   finally:owner.close()
 def test_nonzero_padding(self):self.refuse((longname('name',padding=b'x'+b'\0'*506),),'archive-refused','gnu-longname-padding')
 def test_unsupported_next_types(self):
  for kind in (b'K',b'x',b'g',b'2',b'3',b'6'):
   owner=g.FixedAliasMaterializer(self.tmp.name)
   try:
    with self.assertRaises(g.base.Refusal):owner._tar(compressed((longname('name'),header('name',kind))))
    self.assertEqual(owner.status()['archiveRefusalDiagnostic']['reason'],'type-or-mode')
   finally:owner.close()
 def test_checksum_setid_size(self):
  h=bytearray(header('././@LongLink',b'L',5));h[0]=ord('X');self.refuse((member(bytes(h),b'name\0'),),'archive-refused','checksum')
  owner=g.FixedAliasMaterializer(self.tmp.name)
  try:
   with self.assertRaises(g.base.Refusal):owner._tar(compressed((longname('name'),header('name',b'5',extent=1),b'x'+b'\0'*511)))
   self.assertEqual(owner.status()['archiveRefusalDiagnostic']['reason'],'directory-size')
  finally:owner.close()
  for kind in ('checksum','mode'):
   owner=g.FixedAliasMaterializer(self.tmp.name)
   try:
    h=bytearray(header('name',mode=0o4644 if kind=='mode' else 0o644))
    if kind=='checksum':h[0]=ord('X')
    with self.assertRaises(g.base.Refusal):owner._tar(compressed((longname('name'),bytes(h))))
    self.assertEqual(owner.status()['archiveRefusalDiagnostic']['reason'],'checksum' if kind=='checksum' else 'type-or-mode')
   finally:owner.close()
 def test_placeholder_and_alias_overshadow(self):
  for stub in ('wrong','/unsafe','../unsafe',next(iter(g.ALIASES))):
   owner=g.FixedAliasMaterializer(self.tmp.name)
   try:
    with self.assertRaises(g.base.Refusal):owner._tar(compressed((longname('safe'),header(stub))))
    self.assertEqual(owner.status()['archiveRefusalDiagnostic']['reason'],'gnu-longname-placeholder')
   finally:owner.close()
 def test_duplicate_effective_name_and_parent_conflict(self):
  self.refuse((longname('name'),header('name'),longname('name'),header('name')),'archive-duplicate')
  owner=g.FixedAliasMaterializer(self.tmp.name)
  try:
   with self.assertRaises(g.base.Refusal):owner._tar(compressed((longname('name/child'),header('name/child'),longname('name'),header('name'))))
  finally:owner.close()
 def test_hardlink_policy_unchanged(self):
  alias=next(iter(g.ALIASES));self.refuse((longname(alias),header(alias,b'1',link='wrong-target')),'archive-type','hardlink-target')
 def test_metadata_member_and_decoded_caps(self):
  with patch.object(g.base,'MAX_MEMBERS',1):self.refuse((longname('name'),header('name')),'archive-cap','member-cap')
  # Stage the real manufactured decompressor at header/body/padding boundaries.
  # The normal 64KiB eager decode can otherwise refuse before the first header.
  native=g.base.bz2.BZ2Decompressor;real_exact=g.base._BZ2Reader.exact
  for cap,expected in ((516,[512,5]),(1023,[512,5,507])):
   calls=[]
   class Staged:
    def __init__(self):self.inner=native();self.index=0
    def __getattr__(self,name):return getattr(self.inner,name)
    def decompress(self,block,max_length):
     limits=(512,5,507);limit=limits[min(self.index,2)];self.index+=1
     return self.inner.decompress(block,max_length=min(max_length,limit))
   def exact(reader,count):calls.append(count);return real_exact(reader,count)
   owner=g.FixedAliasMaterializer(self.tmp.name);tool=compressed((longname('name'),header('name')));source={k:(0,g.base.sha(b'')) for k in g.base.SOURCE}
   try:
    with patch.object(g.base,'MAX_DECODED',cap),patch.object(g.base.bz2,'BZ2Decompressor',Staged),patch.object(g.base._BZ2Reader,'exact',exact),patch.object(g.base,'TOOL_BYTES',len(tool)),patch.object(g.base,'TOOL_SHA',g.base.sha(tool)),patch.object(g.base,'SOURCE',source),patch.object(owner._observer,'prepare') as prepare:
     with self.assertRaises(g.base.Refusal) as caught:owner.materialize(tool,b'',b'',b'')
     prepare.assert_not_called()
    self.assertEqual(caught.exception.args,('archive-cap',));self.assertEqual(calls,expected);status=owner.status();self.assertEqual(status['gnuLongNameHeaders'],0);self.assertEqual(status['phase'],'refused');self.assertEqual(status['firstFailure'],'archive-cap')
   finally:owner.close()
 def test_swallowed_read_reentry_no_next_normal_call(self):
  original=g.base._BZ2Reader.exact;calls=[]
  def read(reader,count):
   calls.append(count);value=original(reader,count)
   if len(calls)==2:
    try:self.owner.status()
    except BaseException:pass
   return value
  # Public materialize owns the busy fence; inherited raw _tar is private.
  inputs=(compressed((longname('name'),header('name'))),b'',b'',b'')
  source={k:(0,g.base.sha(b'')) for k in g.base.SOURCE}
  with patch.object(g.base,'TOOL_BYTES',len(inputs[0])),patch.object(g.base,'TOOL_SHA',g.base.sha(inputs[0])),patch.object(g.base,'SOURCE',source),patch.object(g.base._BZ2Reader,'exact',read):
   with self.assertRaises(g.base.Refusal):self.owner.materialize(*inputs)
  self.assertEqual(calls,[512,5]);self.assertTrue(self.owner.status()['reentered'])

def inherited_suite():
 p=Path(__file__).parent.parent/'i80386-cwsdpmi-archive-refusal-diagnostic/materialize-control.py';s=importlib.util.spec_from_file_location('private_old_diagnostic_controls',p);d=importlib.util.module_from_spec(s);s.loader.exec_module(d)
 class Adapted(d.Controls):
  def test_full_failure_diagnostic_copied_status(self):
   f=fixture_module()
   def callback(runner,inputs):
    original=runner._materializer._tar;bad=compressed((header(kind=b'K'),))
    with patch.object(runner._materializer,'_tar',lambda unused:original(bad)):
     with self.assertRaises(f.m.Refusal):runner.materialize(*inputs)
    p=runner.report();a=p['materializeStatus']['archiveRefusalDiagnostic'];self.assertEqual(a,p['closeStatus']['archiveRefusalDiagnostic']);self.assertEqual((a['reason'],a['typeByte']),('type-or-mode',75));self.assertEqual(p['observerReceipts'],[])
   f.Controls().exercise(callback)
 p=Path(__file__).parent.parent/'i80386-fixed-archive-acquisition/acquire-control.py';s=importlib.util.spec_from_file_location('private_inherited_acquisition_controls',p);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
 return unittest.TestSuite((unittest.defaultTestLoader.loadTestsFromTestCase(Adapted),unittest.defaultTestLoader.loadTestsFromModule(a)))
if __name__=='__main__':
 suite=unittest.TestSuite((unittest.defaultTestLoader.loadTestsFromTestCase(Controls),inherited_suite()));result=unittest.TextTestRunner().run(suite);raise SystemExit(0 if result.wasSuccessful() else 1)
