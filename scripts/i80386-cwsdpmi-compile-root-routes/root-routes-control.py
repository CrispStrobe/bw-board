"""Manufactured directories only; no compiler/helpers/tool input execution."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('routes',Path(__file__).with_name('root-routes.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Controls(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.base=Path(t.name)
  self.tool=self.base/'tool';self.evidence=self.base/'evidence';self.tool.mkdir();self.evidence.mkdir()
 def owner(self):
  r=m.RootRoutes(str(self.tool),str(self.evidence));self.addCleanup(r.close);return r
 def test_positive_evidence_write_metadata_allowed(self):
  r=self.owner();a=r.capture('before-probes');(self.evidence/'receipt').write_text('synthetic')
  z=r.capture('after-link');self.assertEqual(a['roles'],z['roles']);self.assertEqual(r.status()['ownedDescriptors'],0)
  self.assertFalse(z['sourceOwnedQualified']);self.assertNotIn(str(self.base),str(z))
 def test_component_shape_and_caps(self):
  for p in ['relative','/','/a/','/a//b','/a/../b','/a/./b','/a\0b','/'+'/'.join(['a']*33),'/'+'a'*256]:
   with self.assertRaises(m.Refusal):m.RootRoutes(p,str(self.evidence))
 def test_path_encoding_bound_before_filesystem(self):
  with patch.object(m.os,'stat',side_effect=AssertionError('path refusal filesystem')),patch.object(m.os,'open',side_effect=AssertionError('path refusal open')):
   for value in ['/'+'x'*100000, '/'+'é'*3000, '/bad\ud800']:
    with self.assertRaises(m.Refusal):m.RootRoutes(value,str(self.evidence))
  exact='/'+'/'.join(['a'*255]*16)
  self.assertEqual(len(exact.encode('utf-8')),4096)
  self.assertEqual(len(m.components(exact)),16)
  multi='/'+'/'.join(['é'*127]*16)
  self.assertEqual(len(m.components(multi)),16)
  self.assertLess(len(multi.encode('utf-8')),4096)

 def test_symlink_and_inside_tool(self):
  link=self.base/'link';link.symlink_to(self.tool,target_is_directory=True)
  for path in [link,self.tool]:
   r=m.RootRoutes(str(self.tool),str(path));self.addCleanup(r.close)
   with self.assertRaises(m.Refusal):r.capture('before-probes')
   self.assertEqual(r.status()['ownedDescriptors'],0)
  child=self.tool/'child';child.mkdir();r=m.RootRoutes(str(self.tool),str(child));self.addCleanup(r.close)
  with self.assertRaises(m.Refusal):r.capture('before-probes')
 def test_same_identity_alias_manufactured(self):
  r=self.owner();real_stat=os.stat;real_fstat=os.fstat
  tool_id=(self.tool.stat().st_dev,self.tool.stat().st_ino)
  evidence_id=(self.evidence.stat().st_dev,self.evidence.stat().st_ino)
  def alias(value):
   if (value.st_dev,value.st_ino)==evidence_id:
    from types import SimpleNamespace
    return SimpleNamespace(st_mode=value.st_mode,st_dev=tool_id[0],st_ino=tool_id[1])
   return value
  with patch.object(m.os,'stat',lambda *a,**kw:alias(real_stat(*a,**kw))),patch.object(m.os,'fstat',lambda fd:alias(real_fstat(fd))):
   with self.assertRaises(m.Refusal):r.capture('before-probes')
  self.assertEqual(r.status()['firstFailure'],'evidence-inside-tool')
  self.assertEqual(r.status()['ownedDescriptors'],0)
 def test_ancestor_rename(self):
  r=self.owner();r.capture('before-probes');old=self.tool.with_name('old');self.tool.rename(old);self.tool.mkdir()
  with self.assertRaises(m.Refusal):r.capture('after-link')
  self.assertEqual(r.status()['firstFailure'],'route-changed');self.assertEqual(r.status()['ownedDescriptors'],0)
 def test_open_returned_fd_reentry_closed(self):
  r=self.owner();original=os.open;opened=[];once=False
  def op(*a,**kw):
   nonlocal once
   fd=original(*a,**kw);opened.append(fd)
   if not once:
    once=True
    try:r.status()
    except m.Refusal:pass
   return fd
  with patch.object(m.os,'open',op):
   with self.assertRaises(m.Refusal):r.capture('before-probes')
  self.assertEqual(len(opened),1)
  with self.assertRaises(OSError):os.fstat(opened[0])
  self.assertEqual(r.status()['firstFailure'],'observer-reentry')
 def test_fstat_reentry_and_cleanup_reentry(self):
  r=self.owner();original=os.fstat;seen=0
  def fs(fd):
   nonlocal seen
   seen+=1
   try:r.status()
   except m.Refusal:pass
   return original(fd)
  with patch.object(m.os,'fstat',fs):
   with self.assertRaises(m.Refusal):r.capture('before-probes')
  self.assertEqual(seen,1);self.assertEqual(r.status()['ownedDescriptors'],0)
  q=self.owner();q.capture('before-probes');fds=list(q._fds);original_close=os.close
  def cl(fd):
   original_close(fd)
   try:q.status()
   except m.Refusal:raise
  # Cleanup remains busy during terminal capture and closes every owned fd.
  with patch.object(m.os,'close',cl):
   with self.assertRaises(m.Refusal):q.capture('after-link')
  for fd in fds:
   with self.assertRaises(OSError):os.fstat(fd)
  self.assertEqual(q.status()['firstFailure'],'observer-reentry')

 def test_close_failure_uncertain_accounted_no_retry(self):
  r=self.owner();r.capture('before-probes');fds=list(r._fds);original=os.close;failed=[]
  def cl(fd):
   if not failed:
    failed.append(fd);raise OSError('manufactured uncertain close')
   original(fd)
  with patch.object(m.os,'close',cl):r.close()
  status=r.status();self.assertEqual(status['closeRefused'],1);self.assertFalse(status['cleanupQualified'])
  self.assertEqual(status['closeAttempted'],len(fds));r.close();self.assertEqual(r.status()['closeAttempted'],len(fds))
  # Test owner alone repairs its known manufactured still-open descriptor.
  original(failed[0])
 def test_open_callback_replaces_module_open_returned_fd_closed(self):
  r=self.owner();original=os.open;opened=[]
  def op(*a,**kw):
   fd=original(*a,**kw);opened.append(fd)
   try:r.status()
   except m.Refusal:pass
   m.os.open=lambda *a,**kw: (_ for _ in ()).throw(AssertionError('later source call'))
   return fd
  with patch.object(m.os,'open',op):
   with self.assertRaises(m.Refusal):r.capture('before-probes')
  self.assertEqual(len(opened),1)
  with self.assertRaises(OSError):os.fstat(opened[0])
  self.assertEqual(r.status()['closeAttempted'],1);self.assertEqual(r.status()['closeRefused'],0)

 def test_order_poison_and_no_later_calls(self):
  r=self.owner();r.capture('before-probes')
  with self.assertRaises(m.Refusal):r.capture('before-probes')
  with patch.object(m.os,'open',side_effect=AssertionError('source open after poison')):
   with self.assertRaises(m.Refusal):r.capture('after-link')
  self.assertEqual(r.status()['ownedDescriptors'],0)
 def test_failure_first_and_close(self):
  r=self.owner();r.capture('failure-final');self.assertTrue(r.status()['closed'])
  with self.assertRaises(m.Refusal):r.capture('before-probes')
  r.close();self.assertEqual(r.status()['ownedDescriptors'],0)
 def test_missing_partial_preserved(self):
  self.evidence.rmdir();r=self.owner()
  with self.assertRaises(OSError):r.capture('before-probes')
  s=r.status();self.assertEqual(s['firstFailure'],'filesystem-refusal');self.assertTrue(s['partialRoles']['toolroot']);self.assertEqual(s['ownedDescriptors'],0)
if __name__=='__main__':unittest.main()
