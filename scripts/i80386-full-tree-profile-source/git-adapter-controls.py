import importlib.util,unittest,tempfile,subprocess,json,hashlib,os
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('adapter',Path(__file__).with_name('git-adapter.py'));m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def raw(v):return json.dumps(v,sort_keys=True).encode()
class T(unittest.TestCase):
 def git(self,*args):return subprocess.run((m.GIT,'--no-replace-objects','-C',str(self.root),*args),env=m.ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,check=True).stdout
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup);self.root=Path(self.t.name);self.git('init','-q');self.git('config','user.name','Manufactured');self.git('config','user.email','manufactured@example.invalid');self.git('remote','add','origin','https://github.com/CrispStrobe/bw-board.git');rows={}
  for i in range(21):
   name='scripts/fixture/source%d.py'%i;b=('value=%d\n'%i).encode();p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);rows[name]={'kind':'inherited'if i<14 else'config','bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':m.blob(b)}
  table={'schema':'bw.full-tree-profile-role-table.v1','inheritedRoleCount':14,'roles':rows};self.traw=raw(table);self.table_path='scripts/fixture/table.json';(self.root/self.table_path).write_bytes(self.traw);self.git('add','--','scripts');self.git('commit','-qm','manufactured sources');head=self.git('rev-parse','HEAD').decode().strip();self.git('checkout','--detach','-q',head)
  self.d={'schema':'bw.full-tree-profile-descriptor.v1','status':'UNARMED_SOURCE_ONLY','head':head,'repository':'CrispStrobe/bw-board','origin':'https://github.com/CrispStrobe/bw-board.git','workflow':'.github/workflows/proposed.yml','branch':'lane/proposed','pr':1,'tablePath':self.table_path,'tableBytes':len(self.traw),'tableSha256':hashlib.sha256(self.traw).hexdigest(),'tableGitBlob':m.blob(self.traw)};self.draw=raw(self.d);self.rows=rows;p=patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256',hashlib.sha256(self.draw).hexdigest());p.start();self.addCleanup(p.stop)
 def adapter(self):a=m.Adapter(str(self.root),self.draw,self.traw);self.addCleanup(lambda:self.cleanup_adapter(a));return a
 def cleanup_adapter(self,a):
  try:a.close()
  except m.Refusal:pass
 def test_final_directory_cleanup_reentry_refuses(self):
  a=self.adapter();a.read('head');original=os.close
  def closing(fd):original(fd);a.status()
  a.close_fn=closing
  with self.assertRaises(m.Refusal):a.close()
  self.assertEqual(a.first,'adapter-reentry');self.assertEqual(a.status()['ownedDescriptors'],0)
 def test_fixed_operations(self):
  a=self.adapter();self.assertEqual(a.read('head'),self.d['head']);self.assertEqual(a.read('origin'),self.d['origin']);self.assertIs(a.read('detached'),True);self.assertIs(a.read('clean'),True);name=next(iter(self.rows));self.assertEqual(a.read('blob',name),(self.root/name).read_bytes());self.assertFalse(a.status()['operationalSourceAdmissionQualified'])
 def test_unarmed_before_process(self):
  with patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256',None),patch.object(m.subprocess,'Popen') as p:
   with self.assertRaises(m.Refusal):self.adapter().read('head')
   p.assert_not_called()
 def test_unknown_operations_and_paths(self):
  for operation,path in [('fetch',None),('blob','scripts/unknown.py'),('blob','../escape')]:
   with self.assertRaises(m.Refusal):self.adapter().read(operation,path)
 def test_wrong_origin(self):
  self.git('remote','set-url','origin','https://foreign.invalid/repo')
  with self.assertRaises(m.Refusal):self.adapter().read('origin')
 def test_attached_refuses(self):
  self.git('checkout','-qb','manufactured-attached')
  with self.assertRaises(m.Refusal):self.adapter().read('detached')
 def test_index_change_refuses(self):
  name=next(iter(self.rows));(self.root/name).write_bytes(b'changed');self.git('add','--',name)
  with self.assertRaises(m.Refusal):self.adapter().read('clean')
 def test_live_change_refuses(self):
  name=next(iter(self.rows));(self.root/name).write_bytes(b'changed')
  with self.assertRaises(m.Refusal):self.adapter().read('clean')
 def test_symlink_checkout(self):
  alias=self.root.parent/(self.root.name+'-alias');alias.symlink_to(self.root);self.addCleanup(alias.unlink)
  with self.assertRaises(m.Refusal):m.Adapter(str(alias),self.draw,self.traw).read('head')
 def test_local_filter_never_executed(self):
  marker=self.root/'marker';self.git('config','filter.evil.clean','touch '+str(marker));self.git('config','filter.evil.smudge','touch '+str(marker));(self.root/'.gitattributes').write_text('*.py filter=evil\n');a=self.adapter();self.assertTrue(a.read('clean'));a.read('blob',next(iter(self.rows)));self.assertFalse(marker.exists())
 def test_consumed_blob(self):
  a=self.adapter();name=next(iter(self.rows));a.read('blob',name);a.read('blob',name)
  with self.assertRaises(m.Refusal):a.read('blob',name)
 def test_close_no_process(self):
  a=self.adapter();a.close()
  with patch.object(m.subprocess,'Popen') as p:
   with self.assertRaises(m.Refusal):a.read('head')
   p.assert_not_called()
 def test_git_process_setup_original_preserved(self):
  a=self.adapter();error=ValueError('private')
  with patch.object(m.selectors,'DefaultSelector',side_effect=error):
   with self.assertRaises(ValueError) as c:a.read('head')
  self.assertIs(c.exception,error);self.assertTrue(a.closed);self.assertEqual(a.status()['ownedDescriptors'],0)
 def test_returned_fd_reentry_closed(self):
  a=self.adapter();original=os.open;fdlist=[]
  def opened(*args,**kw):fd=original(*args,**kw);fdlist.append(fd);a.status();return fd
  with patch.object(m.os,'open',new=opened):
   with self.assertRaises(m.Refusal):a.read('head')
  self.assertEqual(len(fdlist),1)
  with self.assertRaises(OSError):os.fstat(fdlist[0])
 def test_direct_command_cannot_delegate(self):
  a=self.adapter();a.read('head')
  with patch.object(m.subprocess,'Popen')as p:
   with self.assertRaises(m.Refusal):a.command(('fetch','https://foreign.invalid'),64)
   p.assert_not_called()
 def test_symlink_git_directory(self):
  gitdir=self.root/'.git';gitdir.rename(self.root/'original-git');gitdir.symlink_to('original-git')
  with self.assertRaises(m.Refusal):self.adapter().read('head')
 def test_alternates_refused(self):
  (self.root/'.git/objects/info/alternates').write_text('/untrusted/object/store\n')
  with patch.object(m.subprocess,'Popen')as p:
   with self.assertRaises(m.Refusal):self.adapter().read('head')
   p.assert_not_called()
 def test_selector_close_secondary_does_not_mask_setup(self):
  a=self.adapter();primary=ValueError('private-primary')
  class S:
   def register(self,*args):raise primary
   def close(self):raise OSError('private-secondary')
  with patch.object(m.selectors,'DefaultSelector',return_value=S()):
   with self.assertRaises(ValueError)as c:a.read('head')
  self.assertIs(c.exception,primary);self.assertEqual(a.process_cleanup_refused,1)
 def test_exited_leader_pipe_deadline_still_kills_owned_group(self):
  from unittest.mock import Mock
  a=self.adapter();a.read('head');a.busy=True;a.current=('head',None);a.started=0
  class Pipe:
   def fileno(self):return 42
   def close(self):pass
  proc=Mock();proc.pid=424242;proc.stdout=Pipe();proc.stderr=Pipe();proc.wait.return_value=0;proc.poll.return_value=0
  class S:
   def register(self,*args):pass
   def get_map(self):return {1:1}
   def close(self):pass
  with patch.object(m.subprocess,'Popen',return_value=proc),patch.object(m.selectors,'DefaultSelector',return_value=S()),patch.object(m.os,'set_blocking'),patch.object(m.time,'monotonic',side_effect=(0,10)),patch.object(m.os,'killpg')as kill:
   with self.assertRaises(m.Refusal):a.command(('rev-parse','--verify','HEAD'),41)
   kill.assert_called_once_with(proc.pid,m.signal.SIGKILL)
  a.busy=False;a.current=None
 def test_hash_constructor_reentry_stops_hexdigest(self):
  a=self.adapter();count=[0]
  class H:
   def hexdigest(self):count[0]+=1;return '0'*64
  def ctor(*args):a.status();return H()
  with patch.object(m.hashlib,'sha256',new=ctor):
   with self.assertRaises(m.Refusal):a.read('head')
  self.assertEqual(count[0],0)
 def test_unregistered_returned_fd_cleanup_refusal_original(self):
  a=self.adapter();original=ValueError('private-registration');cleanup=OSError('private-cleanup');count=[0]
  class Slots(list):
   def index(self,value):raise original
  a.slots=Slots([None]*64)
  def close(fd):count[0]+=1;a.status();raise cleanup
  a.close_fn=close;a.busy=True
  with patch.object(m.os,'open',return_value=987654):
   with self.assertRaises(ValueError)as c:a.opening('/manufactured',0)
  a.busy=False
  self.assertIs(c.exception,original);self.assertEqual(a.first,'descriptor-registration-refused');self.assertEqual(a.close_attempted,1);self.assertEqual(a.close_refused,1);self.assertEqual(count[0],1);self.assertEqual(a.status()['ownedDescriptors'],0)
 def test_command_setup_refusal_clears_busy(self):
  a=self.adapter();a.read('head');a.busy=True;a.current=('head',None);error=OSError('private-route')
  with patch.object(a,'recheck',side_effect=error),patch.object(m.subprocess,'Popen')as p:
   with self.assertRaises(OSError)as c:a.command(('rev-parse','--verify','HEAD'),41)
   self.assertIs(c.exception,error);p.assert_not_called()
  self.assertFalse(a.command_busy);a.busy=False;a.current=None
 def test_replacement_environment_scrubbed(self):
  with patch.dict(os.environ,{'GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'remote.origin.url','GIT_CONFIG_VALUE_0':'https://foreign.invalid','LD_PRELOAD':'invalid'},clear=False):self.assertEqual(self.adapter().read('origin'),self.d['origin'])
if __name__=='__main__':unittest.main()
