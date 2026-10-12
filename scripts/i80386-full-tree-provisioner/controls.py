"""Manufactured small files only; constants patched privately, no real tool bytes."""
import hashlib,importlib.util,os,shutil,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('manufactured_writer',Path(__file__).with_name('provision.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def digest(body):return hashlib.sha256(body).hexdigest()
def chunks(body):return [body[i:i+m.CHUNK] for i in range(0,len(body),m.CHUNK)]
class Controls(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.parent=Path(self.tmp.name)
  self.bodies={f'djgpp/tool{i}':('manufactured-tool-'+str(i)).encode() for i in range(11)}
  self.bodies.update({'djgpp/cc1':b'manufactured-cc1','djgpp/collect2':b'manufactured-collect2'})
  self.rows=[{'path':'djgpp','type':'directory','bytes':0}]+[{'path':p,'type':'file','bytes':len(b),'sha256':digest(b)} for p,b in self.bodies.items()]
  self.rows += [{'path':f'djgpp/alias{i}','type':'hardlink','bytes':0,'target':f'djgpp/tool{i%11}','resolved':f'djgpp/tool{i%11}'} for i in range(13)]
  self.noticebytes={'djgpp-copying':b'notice','djgpp-copying-dj':b'notice-dj','djgpp-copying-lib':b'license\fpage\fend','gcc-copying-runtime':b'runtime','gcc-copying3':b'X'*35147}
  self.noticepins={p:(len(b),digest(b)) for p,b in self.noticebytes.items()}
  for p in [patch.object(m,'ROWS',self.rows),patch.object(m,'NOTICES',self.noticepins)]:p.start();self.addCleanup(p.stop)
  self.contents={p:chunks(b) for p,b in self.bodies.items()};self.notices={p:chunks(b) for p,b in self.noticebytes.items()}
 def owner(self):return m.Provisioner(str(self.parent))
 def root(self,o):return self.parent/o._root_name
 def test_positive13links_and_raw_notice_bytes(self):
  o=self.owner();r=o.provision(self.contents,self.notices)
  self.assertTrue(r['observedPrototypeComplete']);self.assertEqual(r['physicalAliasesObserved'],13);self.assertEqual(r['ordinaryFilesWritten'],13);self.assertEqual(r['selectedNoticeSubsetWritten'],5);self.assertEqual(r['closeRefused'],0)
  for i in range(13):
   alias=self.root(o)/'tool'/f'djgpp/alias{i}';target=self.root(o)/'tool'/f'djgpp/tool{i%11}'
   self.assertTrue(alias.samefile(target));self.assertEqual(target.stat().st_nlink,3 if i%11<2 else 2)
  for name,body in self.noticebytes.items():self.assertEqual((self.root(o)/'notices'/name).read_bytes(),body)
  for key in ['sourceOwnedQualified','filesystemLeaseQualified','fullToolchainReady','completeNoticeRetentionQualified','compilerQualified','guestQualified','performanceQualified']:self.assertIs(r[key],False)
 def test_missing_extra_and_custom_content_no_mkdir(self):
  for change in ('missing','extra','iterator','custom'):
   o=self.owner();c=dict(self.contents)
   if change=='missing':c.pop(next(iter(c)))
   elif change=='extra':c['extra']=[b'x']
   elif change=='iterator':c[next(iter(c))]=iter([b'x'])
   else:
    class Custom(dict):pass
    c=Custom(c)
   with self.assertRaises(m.Refusal):o.provision(c,self.notices)
   self.assertEqual(o.status()['mkdirAttempts'],0)
 def test_hash_refusal_partial_preserved(self):
  o=self.owner();c=dict(self.contents);name=next(iter(c));c[name]=[b'Z'*len(self.bodies[name])]
  with self.assertRaises(m.Refusal):o.provision(c,self.notices)
  self.assertEqual(o.status()['firstFailure'],'content-hash');self.assertTrue((self.root(o)/'tool'/name).exists());self.assertFalse(o.status()['observedPrototypeComplete'])
 def test_per_file_and_aggregate_notice_caps(self):
  for cap in (32768,10):
   o=self.owner()
   with patch.object(m,'NOTICE_FILE_CAP',cap):
    with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
   self.assertEqual(o.status()['mkdirAttempts'],0)
  o=self.owner()
  with patch.object(m,'NOTICE_TOTAL_CAP',1):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['mkdirAttempts'],0)
 def test_full_content_caps_pre_reserved_no_files(self):
  for field,value in [('CONTENT_FILE_CAP',1),('CONTENT_TOTAL_CAP',1)]:
   o=self.owner()
   with patch.object(m,field,value):
    with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
   self.assertEqual(o.status()['fileAttempts'],0)
 def test_parent_symlink_and_session_collision_preserved(self):
  link=self.parent/'link';link.symlink_to(self.parent,target_is_directory=True);o=m.Provisioner(str(link))
  with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['firstFailure'],'directory-type')
  collision=self.parent/('provision-'+'a'*16);collision.mkdir();(collision/'keep').write_bytes(b'keep');o=self.owner()
  with patch.object(m.secrets,'token_hex',return_value='a'*16):
   with self.assertRaises(FileExistsError):o.provision(self.contents,self.notices)
  self.assertEqual((collision/'keep').read_bytes(),b'keep');self.assertGreater(o.status()['closeAttempted'],0)
 def test_short_write_and_zero_progress(self):
  real=os.write;o=self.owner()
  with patch.object(m.os,'write',new=lambda fd,b:real(fd,b[:1])):o.provision(self.contents,self.notices)
  self.assertTrue(o.status()['observedPrototypeComplete'])
  o=self.owner()
  with patch.object(m.os,'write',return_value=0):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['firstFailure'],'write-progress')
 def test_original_write_error_plus_close_refusal(self):
  o=self.owner();original=OSError('manufactured-write');close=os.close
  def refuse(fd):close(fd);raise OSError('manufactured-close')
  o._close_fn=refuse
  with patch.object(m.os,'write',side_effect=original):
   with self.assertRaises(OSError) as caught:o.provision(self.contents,self.notices)
  self.assertIs(caught.exception,original);self.assertEqual(o.status()['firstFailure'],'filesystem-refusal');self.assertGreater(o.status()['closeRefused'],0);self.assertFalse(o.status()['handlesClosedWithoutReportedRefusal'])
 def test_swallowed_status_reentry_stops_later_writes(self):
  o=self.owner();real=os.write;calls=[]
  def write(fd,b):
   calls.append(1);o.status();return real(fd,b)
  with patch.object(m.os,'write',side_effect=write):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(len(calls),1);self.assertEqual(o.status()['firstFailure'],'observer-reentry')
 def test_final_external_link_count_refusal(self):
  o=self.owner();real=o._final_links
  def final(tool):
   os.link(self.root(o)/'tool'/'djgpp/cc1',self.parent/'foreign-link');return real(tool)
  with patch.object(o,'_final_links',side_effect=final):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['physicalAliasesObserved'],13);self.assertFalse(o.status()['observedPrototypeComplete'])
 def test_after_alias_same_extent_mutation_refuses(self):
  o=self.owner();real=o._final_links
  def final(tool):
   p=self.root(o)/'tool'/'djgpp/cc1';p.write_bytes(b'Z'*p.stat().st_size);return real(tool)
  with patch.object(o,'_final_links',side_effect=final):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['firstFailure'],'output-readback-or-race')
 def test_route_rename_stops_before_file_write(self):
  o=self.owner();real=o._write
  def write(*args,**kwargs):
   old=self.root(o)/'tool'/'djgpp';old.rename(self.root(o)/'tool'/'old');old.mkdir();return real(*args,**kwargs)
  with patch.object(o,'_write',side_effect=write):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['fileAttempts'],0);self.assertEqual(o.status()['firstFailure'],'route-changed')
 def test_once_and_closed_no_source_calls(self):
  o=self.owner();o.close()
  with patch.object(m.os,'open') as opener:
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
   o.close();opener.assert_not_called()
 def test_registration_failure_returnedfd_cleanup(self):
  o=self.owner();original=MemoryError('manufactured-register');fds=[];real=os.open
  def opened(*a,**k):
   fd=real(*a,**k);fds.append(fd);return fd
  with patch.object(m.os,'open',side_effect=opened),patch.object(o,'_register',side_effect=original):
   with self.assertRaises(MemoryError) as caught:o.provision(self.contents,self.notices)
  self.assertIs(caught.exception,original);self.assertEqual(len(fds),1)
  with self.assertRaises(OSError):os.fstat(fds[0])
 def test_final_notice_substitution_refuses(self):
  o=self.owner();real=o._final_notices
  def final(root):
   target=self.root(o)/'notices'/'gcc-copying3';target.write_bytes(b'Z'*35147);return real(root)
  with patch.object(o,'_final_notices',side_effect=final):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['firstFailure'],'output-readback-or-race');self.assertFalse(o.status()['observedPrototypeComplete'])
 def test_copied_alias_not_samefile_refuses(self):
  o=self.owner()
  def copied(src,dst,**kwargs):
   source=os.open(src,os.O_RDONLY,dir_fd=kwargs['src_dir_fd']);target=os.open(dst,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600,dir_fd=kwargs['dst_dir_fd'])
   try:os.write(target,os.read(source,100))
   finally:os.close(source);os.close(target)
  with patch.object(m.os,'link',side_effect=copied):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['firstFailure'],'alias-target-after');self.assertFalse(o.status()['observedPrototypeComplete'])
 def test_interrupted_after_registration_close_once(self):
  o=self.owner();realregister=o._register;original=MemoryError('manufactured-after-register');closed=[];realclose=os.close
  def register(fd):realregister(fd);raise original
  def close(fd):closed.append(fd);realclose(fd)
  o._close_fn=close
  with patch.object(o,'_register',side_effect=register):
   with self.assertRaises(MemoryError) as caught:o.provision(self.contents,self.notices)
  self.assertIs(caught.exception,original);self.assertEqual(len(closed),1);self.assertEqual(o.status()['closeAttempted'],1);self.assertEqual(o.status()['closeRefused'],0)
 def test_final_fifo_substitution_nonblocking_refusal(self):
  o=self.owner();real=o._final_links
  def final(tool):
   target=self.root(o)/'tool'/'djgpp/cc1';target.unlink();os.mkfifo(target);return real(tool)
  with patch.object(o,'_final_links',side_effect=final):
   with self.assertRaises(m.Refusal):o.provision(self.contents,self.notices)
  self.assertEqual(o.status()['firstFailure'],'output-shape');self.assertFalse(o.status()['observedPrototypeComplete'])
 def test_mutated_custom_chunks_never_iterated(self):
  for notice in (False,True):
   for kind in ('custom','generator'):
    o=self.owner();entered=[];c=dict(self.contents);n=dict(self.notices);supplied=n if notice else c;name=next(iter(supplied));original=supplied[name]
    class Custom(list):
     def __iter__(self):entered.append('custom');return super().__iter__()
    def generator():
     entered.append('generator');yield original[0]
    realmkdir=os.mkdir;changed=[]
    def mkdir(*args,**kwargs):
     result=realmkdir(*args,**kwargs)
     if not changed:supplied[name]=Custom(original) if kind=='custom' else generator();changed.append(True)
     return result
    with patch.object(m.os,'mkdir',side_effect=mkdir):
     with self.assertRaises(m.Refusal):o.provision(c,n)
    self.assertEqual(entered,[]);self.assertFalse(o.status()['observedPrototypeComplete'])
 def test_mutated_custom_keys_never_compared(self):
  for notice in (False,True):
   o=self.owner();entered=[];c=dict(self.contents);n=dict(self.notices);supplied=n if notice else c;name=next(iter(supplied));body=supplied[name]
   class Key:
    def __hash__(self):return hash(name)
    def __eq__(self,other):entered.append('comparison');return other==name
   realmkdir=os.mkdir;changed=[]
   def mkdir(*args,**kwargs):
    result=realmkdir(*args,**kwargs)
    if not changed:del supplied[name];supplied[Key()]=body;changed.append(True)
    return result
   with patch.object(m.os,'mkdir',side_effect=mkdir):
    with self.assertRaises(m.Refusal):o.provision(c,n)
   self.assertEqual(entered,[]);self.assertFalse(o.status()['observedPrototypeComplete'])
if __name__=='__main__':unittest.main()
