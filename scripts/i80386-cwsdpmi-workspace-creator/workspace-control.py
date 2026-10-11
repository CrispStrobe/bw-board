"""Manufactured directory actions only; no tools/compiler/handoff."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('creator',Path(__file__).with_name('workspace.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Controls(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.parent=Path(t.name)/'parent';self.parent.mkdir()
 def owner(self):
  o=m.WorkspaceCreator(str(self.parent));self.addCleanup(o.close);return o
 def test_fixed_three_creations_preserved_after_close(self):
  o=self.owner();s=o.create();self.assertEqual(s['attemptedRoles'],['session','tool','evidence']);self.assertEqual(set(s['verifiedRoles']),{'session','tool','evidence'})
  self.assertTrue(s['creationComplete']);self.assertFalse(s['sourceOwnedQualified']);self.assertNotIn(str(self.parent),str(s));self.assertNotIn(o._name,str(s))
  o.close();self.assertEqual(o.status()['ownedDescriptors'],0);self.assertEqual(sorted(p.name for p in (self.parent/o._name).iterdir()),['evidence','tool'])
 def test_malformed_parent_and_generated_name_zero_filesystem(self):
  with patch.object(m.os,'open',side_effect=AssertionError('unexpected open')),patch.object(m.os,'mkdir',side_effect=AssertionError('unexpected mkdir')):
   for p in ['relative','/a/../b','/a//b','/','/'+'x'*100000,'/bad\ud800']:
    with self.assertRaises(m.Refusal):m.WorkspaceCreator(p)
   for token in ['X'*32,'a'*100000,True]:
    with patch.object(m.secrets,'token_hex',return_value=token):
     with self.assertRaises(m.Refusal):m.WorkspaceCreator(str(self.parent))
 def test_collision_consumed_no_retry(self):
  o=self.owner();(self.parent/o._name).mkdir()
  with self.assertRaises(FileExistsError):o.create()
  with patch.object(m.os,'mkdir',side_effect=AssertionError('retry')):
   with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(o.status()['attemptedRoles'],['session']);self.assertEqual(o.status()['verifiedRoles'],{})
 def test_second_child_failure_original_identity_partial_artifacts(self):
  o=self.owner();real=os.mkdir;original=OSError('original');calls=0
  def mk(*a,**kw):
   nonlocal calls
   calls+=1
   if calls==3:raise original
   return real(*a,**kw)
  with patch.object(m.os,'mkdir',mk):
   with self.assertRaises(OSError) as raised:o.create()
  self.assertIs(raised.exception,original);self.assertEqual(o.status()['attemptedRoles'],['session','tool','evidence']);self.assertEqual(set(o.status()['verifiedRoles']),{'session','tool'});self.assertTrue((self.parent/o._name/'tool').is_dir())
 def test_parent_symlink_refuses(self):
  link=self.parent.with_name('link');link.symlink_to(self.parent,target_is_directory=True);o=m.WorkspaceCreator(str(link));self.addCleanup(o.close)
  with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(o.status()['attemptedRoles'],[])
 def test_parent_swap_on_mkdir_retains_unknown_action(self):
  o=self.owner();real=os.mkdir;done=False
  def mk(*a,**kw):
   nonlocal done
   value=real(*a,**kw)
   if not done:
    done=True;self.parent.rename(self.parent.with_name('old'));self.parent.mkdir()
   return value
  with patch.object(m.os,'mkdir',mk):
   with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(o.status()['attemptedRoles'],['session']);self.assertEqual(o.status()['verifiedRoles'],{});self.assertTrue((self.parent.with_name('old')/o._name).exists())
 def test_mkdir_reentry_may_create_no_verified_credit(self):
  o=self.owner();real=os.mkdir
  def mk(*a,**kw):
   value=real(*a,**kw)
   try:o.status()
   except m.Refusal:pass
   return value
  with patch.object(m.os,'mkdir',mk):
   with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(o.status()['attemptedRoles'],['session']);self.assertEqual(o.status()['verifiedRoles'],{});self.assertTrue((self.parent/o._name).is_dir())
 def test_returned_open_swapped_function_reentry_closed(self):
  o=self.owner();real=os.open;opened=[]
  def op(*a,**kw):
   fd=real(*a,**kw);opened.append(fd)
   try:o.status()
   except m.Refusal:pass
   m.os.open=lambda *a,**kw:(_ for _ in ()).throw(AssertionError('later open'))
   return fd
  with patch.object(m.os,'open',op):
   with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(len(opened),1)
  with self.assertRaises(OSError):os.fstat(opened[0])
 def test_sibling_alias_exact_branch(self):
  o=self.owner();real_stat=os.stat;real_fstat=os.fstat
  # Use unpatched stat for existence to avoid recursion.
  def alias(s):
   try:t=real_stat(self.parent/o._name/'tool');e=real_stat(self.parent/o._name/'evidence')
   except FileNotFoundError:return s
   if (s.st_dev,s.st_ino)==(e.st_dev,e.st_ino):
    from types import SimpleNamespace
    return SimpleNamespace(st_mode=s.st_mode,st_dev=t.st_dev,st_ino=t.st_ino)
   return s
  with patch.object(m.os,'stat',lambda *a,**kw:alias(real_stat(*a,**kw))),patch.object(m.os,'fstat',lambda fd:alias(real_fstat(fd))):
   with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(o.status()['firstFailure'],'sibling-alias');self.assertNotIn('evidence',o.status()['verifiedRoles'])
 def test_fstat_reentry_stops_before_creation(self):
  o=self.owner();real=os.fstat;calls=0
  def fs(fd):
   nonlocal calls
   calls+=1
   try:o.status()
   except m.Refusal:pass
   return real(fd)
  with patch.object(m.os,'fstat',fs):
   with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(calls,1);self.assertEqual(o.status()['attemptedRoles'],[]);self.assertEqual(o.status()['ownedDescriptors'],0)
 def test_cleanup_reentry_closes_all_owned_without_deletion(self):
  o=self.owner();o.create();fds=list(o._fds);real=os.close
  def cl(fd):
   real(fd)
   try:o.status()
   except m.Refusal:raise
  with patch.object(m.os,'close',cl):o.close()
  self.assertEqual(o.status()['firstFailure'],'creator-reentry');self.assertEqual(o.status()['closeRefused'],len(fds));self.assertFalse(o.status()['cleanupQualified'])
  for fd in fds:
   with self.assertRaises(OSError):os.fstat(fd)
  self.assertTrue((self.parent/o._name/'evidence').is_dir())

 def test_session_identity_alias_to_parent_refuses(self):
  o=self.owner();real_stat=os.stat;real_fstat=os.fstat;parent_id=real_stat(self.parent)
  def alias(value):
   try:session_id=real_stat(self.parent/o._name)
   except FileNotFoundError:return value
   if (value.st_dev,value.st_ino)==(session_id.st_dev,session_id.st_ino):
    from types import SimpleNamespace
    return SimpleNamespace(st_mode=value.st_mode,st_dev=parent_id.st_dev,st_ino=parent_id.st_ino)
   return value
  with patch.object(m.os,'stat',lambda *a,**kw:alias(real_stat(*a,**kw))),patch.object(m.os,'fstat',lambda fd:alias(real_fstat(fd))):
   with self.assertRaises(m.Refusal):o.create()
  self.assertEqual(o.status()['firstFailure'],'sibling-alias');self.assertEqual(o.status()['verifiedRoles'],{})
 def test_preobservation_replacement_does_not_grant_created_inode_authority(self):
  o=self.owner();real=os.mkdir;done=False
  def mk(*args,**kw):
   nonlocal done
   value=real(*args,**kw)
   if not done:
    done=True
    original=self.parent/o._name;original.rename(self.parent/'preserved-original')
    real(original)
   return value
  with patch.object(m.os,'mkdir',mk):s=o.create()
  self.assertTrue(s['creationComplete']);self.assertFalse(s['sourceOwnedQualified']);self.assertFalse(s['continuousIdentityQualified'])
  self.assertEqual(s['verifiedRoles']['session']['ino'],(self.parent/o._name).stat().st_ino)
  self.assertTrue((self.parent/'preserved-original').is_dir())

 def test_original_mkdir_failure_precedes_cleanup_uncertainty(self):
  o=self.owner();original=OSError('mkdir');real=os.close;failed=[]
  def cl(fd):
   if not failed:failed.append(fd);raise OSError('close')
   return real(fd)
  with patch.object(m.os,'mkdir',side_effect=original),patch.object(m.os,'close',cl):
   with self.assertRaises(OSError) as raised:o.create()
  self.assertIs(raised.exception,original);self.assertEqual(o.status()['firstFailure'],'filesystem-refusal');self.assertEqual(o.status()['closeRefused'],1);real(failed[0])
 def test_close_before_create_and_repeat_create_refuse(self):
  o=self.owner();o.close()
  with self.assertRaises(m.Refusal):o.create()
  q=self.owner();q.create()
  with self.assertRaises(m.Refusal):q.create()
  self.assertEqual(q.status()['attemptedRoles'],['session','tool','evidence']);self.assertEqual(q.status()['ownedDescriptors'],0)
if __name__=='__main__':unittest.main()
