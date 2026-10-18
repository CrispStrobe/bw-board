"""Manufactured filesystem bytes only; no compiler/tool inputs."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('owner',Path(__file__).with_name('evidence-owner.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Controls(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.base=Path(t.name)
  self.tool=self.base/'tool';self.out=self.base/'evidence';self.tool.mkdir();self.out.mkdir()
 def owner(self):
  o=m.EvidenceOwner(str(self.tool),str(self.out));self.addCleanup(o.close);return o
 def test_positive_fixed_names_retained_fd(self):
  o=self.owner();o.before(b'{}\n');s=o.terminal('after-link',b'{"terminal":true}\n')
  self.assertEqual(sorted(p.name for p in self.out.iterdir()),['tool-before.json','tool-terminal.json'])
  self.assertEqual(s['phase'],'complete');self.assertEqual(s['routes']['ownedDescriptors'],0)
  self.assertFalse(s['sourceOwnedQualified']);self.assertFalse(s['inputAliasQualified'])
 def test_payload_bound_type_no_open(self):
  for value in [bytearray(b'x'),b'x'*32769,'x']:
   o=self.owner()
   with patch.object(m.os,'open',side_effect=AssertionError('payload opens')):
    with self.assertRaises(m.Refusal):o.before(value)
   self.assertEqual(o.status()['attemptedFiles'],[])
 def test_preexisting_symlink_hardlink_exclusive(self):
  target=self.base/'target';target.write_bytes(b'keep')
  for kind in ['regular','symlink','hardlink']:
   dest=self.out/'tool-before.json'
   if kind=='regular':dest.write_bytes(b'keep')
   elif kind=='symlink':dest.symlink_to(target)
   else:os.link(target,dest)
   o=self.owner()
   with self.assertRaises(FileExistsError):o.before(b'new')
   with self.assertRaises(m.Refusal):o.before(b'again')
   self.assertEqual(o.status()['attemptedFiles'],['tool-before.json']);self.assertEqual(target.read_bytes(),b'keep');dest.unlink()
 def test_short_writes_and_zero_progress(self):
  o=self.owner();real=os.write;calls=[]
  def short(fd,raw):calls.append(len(raw));return real(fd,raw[:1])
  with patch.object(m.os,'write',short):o.before(b'1234')
  self.assertEqual(len(calls),4);self.assertEqual((self.out/'tool-before.json').read_bytes(),b'1234');o.close()
  (self.out/'tool-before.json').unlink();q=self.owner()
  with patch.object(m.os,'write',return_value=0):
   with self.assertRaises(m.Refusal):q.before(b'1234')
  self.assertEqual(q.status()['firstFailure'],'write-progress')
 def test_named_replacement_and_hardlink_race(self):
  real=os.write
  for action in ['replace','link']:
   o=self.owner();done=False
   def wr(fd,raw):
    nonlocal done
    n=real(fd,raw)
    if not done:
     done=True;p=self.out/'tool-before.json'
     if action=='replace':p.unlink();p.write_bytes(raw)
     else:os.link(p,self.out/'alias')
    return n
   with patch.object(m.os,'write',wr):
    with self.assertRaises(m.Refusal):o.before(b'x')
   self.assertEqual(o.status()['writtenFiles'],[])
   for p in self.out.iterdir():p.unlink()
 def test_route_change_before_terminal_no_output_open(self):
  o=self.owner();o.before(b'x');self.out.rename(self.base/'old');self.out.mkdir()
  with self.assertRaises(m.routes.Refusal):o.terminal('after-link',b'y')
  self.assertEqual(o.status()['attemptedFiles'],['tool-before.json']);self.assertEqual(o.status()['routes']['firstFailure'],'route-changed')
 def test_writer_status_reentry_stops_syscalls(self):
  o=self.owner();real=os.write;calls=0
  def wr(fd,raw):
   nonlocal calls
   calls+=1
   try:o.status()
   except m.Refusal:pass
   return real(fd,raw[:1])
  with patch.object(m.os,'write',wr):
   with self.assertRaises(m.Refusal):o.before(b'123')
  self.assertEqual(calls,1);self.assertEqual(o.status()['firstFailure'],'writer-reentry');self.assertEqual(o.status()['writtenFiles'],[])
 def test_returned_open_reentry_and_swapped_function(self):
  o=self.owner();real=os.open;returned=[]
  def op(*a,**kw):
   fd=real(*a,**kw)
   if a[0]=='tool-before.json':
    returned.append(fd)
    try:o.status()
    except m.Refusal:pass
    m.os.open=lambda *a,**kw:(_ for _ in ()).throw(AssertionError('later open'))
   return fd
  with patch.object(m.os,'open',op):
   with self.assertRaises(m.Refusal):o.before(b'x')
  self.assertEqual(len(returned),1)
  with self.assertRaises(OSError):os.fstat(returned[0])
 def test_closed_order_and_terminal_phase_no_retry(self):
  for phase in ['before-probes','invalid',True]:
   o=self.owner();o.before(b'x')
   with self.assertRaises(m.Refusal):o.terminal(phase,b'y')
   self.assertEqual(o.status()['attemptedFiles'],['tool-before.json']);(self.out/'tool-before.json').unlink()
 def test_exact_cap_failure_final_and_terminal_collision(self):
  o=self.owner();o.before(b'x'*32768);s=o.terminal('failure-final',b'partial')
  self.assertEqual((self.out/'tool-before.json').stat().st_size,32768);self.assertEqual(s['phase'],'complete')
  # Complete here means writes/routes finished; payload content never qualifies a compiler.
  for p in self.out.iterdir():p.unlink()
  q=self.owner();q.before(b'x');(self.out/'tool-terminal.json').write_bytes(b'old')
  with self.assertRaises(FileExistsError):q.terminal('after-link',b'new')
  with self.assertRaises(m.Refusal):q.terminal('failure-final',b'again')
  self.assertEqual(q.status()['writtenFiles'],['tool-before.json']);self.assertEqual((self.out/'tool-terminal.json').read_bytes(),b'old')
 def test_output_fstat_reentry_no_write(self):
  o=self.owner();real=os.fstat;write_calls=[]
  def fs(fd):
   value=real(fd)
   import stat
   if stat.S_ISREG(value.st_mode):
    try:o.status()
    except m.Refusal:pass
   return value
  with patch.object(m.os,'fstat',fs),patch.object(m.os,'write',side_effect=lambda *a:write_calls.append(a)):
   with self.assertRaises(m.Refusal):o.before(b'x')
  self.assertEqual(write_calls,[]);self.assertEqual(o.status()['firstFailure'],'writer-reentry')

 def test_same_extent_content_overwrite_refuses_readback(self):
  o=self.owner();real=os.write;done=False
  def wr(fd,raw):
   nonlocal done
   n=real(fd,raw)
   if not done:
    done=True
    with (self.out/'tool-before.json').open('r+b') as stream:stream.write(b'z'*len(raw))
   return n
  with patch.object(m.os,'write',wr):
   with self.assertRaises(m.Refusal):o.before(b'abc')
  self.assertEqual(o.status()['firstFailure'],'output-readback');self.assertEqual(o.status()['writtenFiles'],[])
 def test_terminal_route_cleanup_reentry_no_complete(self):
  o=self.owner();o.before(b'x');real=os.close;seen=False
  def cl(fd):
   nonlocal seen
   import stat
   directory=stat.S_ISDIR(os.fstat(fd).st_mode)
   real(fd)
   if directory and not seen:
    seen=True
    try:o.status()
    except m.Refusal:pass
  with patch.object(m.os,'close',cl):
   with self.assertRaises(m.routes.Refusal):o.terminal('after-link',b'y')
  self.assertNotEqual(o.status()['phase'],'complete');self.assertEqual(o.status()['firstFailure'],'writer-reentry')
  self.assertEqual(o.status()['writtenFiles'],['tool-before.json','tool-terminal.json']);self.assertEqual(o.status()['routes']['ownedDescriptors'],0)

 def test_readback_swallowed_reentry_stops_after_one_read(self):
  o=self.owner();real=os.pread;calls=0
  def rd(*args):
   nonlocal calls
   calls+=1
   try:o.status()
   except m.Refusal:pass
   m.os.pread=lambda *a:(_ for _ in ()).throw(AssertionError('later read'))
   return real(*args)
  with patch.object(m.os,'pread',rd):
   with self.assertRaises(m.Refusal):o.before(b'abc')
  self.assertEqual(calls,1);self.assertEqual(o.status()['firstFailure'],'writer-reentry');self.assertEqual(o.status()['writtenFiles'],[])

 def test_original_write_failure_precedes_cleanup_failure(self):
  o=self.owner();original=OSError('original write error');real_close=os.close;failed=[]
  def cl(fd):
   if not failed:
    failed.append(fd);raise OSError('secondary close error')
   real_close(fd)
  with patch.object(m.os,'write',side_effect=original),patch.object(m.os,'close',cl):
   with self.assertRaises(OSError) as raised:o.before(b'x')
  self.assertIs(raised.exception,original);self.assertEqual(o.status()['firstFailure'],'filesystem-refusal');self.assertEqual(o.status()['closeRefused'],1)
  self.assertEqual(o.status()['writtenFiles'],[]);real_close(failed[0])

 def test_output_close_uncertain_accounted(self):
  o=self.owner();real=os.close;uncertain=[]
  def cl(fd):
   if not uncertain:
    uncertain.append(fd);raise OSError('uncertain')
   real(fd)
  # Capture/route setup performs no closes until writer output finally.
  with patch.object(m.os,'close',cl):
   with self.assertRaises(m.Refusal):o.before(b'x')
  self.assertEqual(o.status()['closeRefused'],1);self.assertEqual(o.status()['writtenFiles'],[])
  real(uncertain[0])
if __name__=='__main__':unittest.main()
