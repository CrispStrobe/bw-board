import importlib.util,json,hashlib,tempfile,os,unittest
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('gate',Path(__file__).with_name('gate.py'));m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def raw(v):return (json.dumps(v,sort_keys=True)+'\n').encode()
class T(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.bodies={};self.held={};roles={}
  for i in range(14):
   name='scripts/held/r%d.py'%i;b=('held%d'%i).encode();self.bodies[name]=b;fact={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':m.blob(b)};self.held[name]=fact;roles[name]={'kind':'inherited',**fact}
  for kind in m.REQUIRED:
   name='.github/workflows/full-tree.yml' if kind=='workflow' else 'scripts/profile/'+kind+'.py';b=kind.encode();self.bodies[name]=b;roles[name]={'kind':kind,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':m.blob(b)}
  self.table={'schema':'bw.full-tree-profile-role-table.v1','inheritedRoleCount':14,'roles':roles};self.traw=raw(self.table);self.name='scripts/profile/roles.json';self.bodies[self.name]=self.traw
  self.descriptor={'schema':'bw.full-tree-profile-descriptor.v1','status':'UNARMED_SOURCE_ONLY','head':'a'*40,'repository':'CrispStrobe/bw-board','origin':'https://github.com/CrispStrobe/bw-board.git','workflow':'.github/workflows/full-tree.yml','branch':'lane/full-tree','pr':1,'tablePath':self.name,'tableBytes':len(self.traw),'tableSha256':hashlib.sha256(self.traw).hexdigest(),'tableGitBlob':m.blob(self.traw)};self.draw=raw(self.descriptor)
  for name,b in self.bodies.items():p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
  def git(op,name=None):return {'head':'a'*40,'origin':self.descriptor['origin'],'detached':True,'clean':True}[op] if op!='blob' else self.bodies[name]
  for p in (patch.object(m,'INHERITED',self.held),patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256',hashlib.sha256(self.draw).hexdigest()),patch.object(m,'_git',side_effect=git)):
   p.start();self.addCleanup(p.stop)
 def gate(self):return m.Gate(str(self.root),self.draw,self.traw)
 def test_before_after(self):
  g=self.gate();a=g.observe('before');b=g.observe('after');self.assertEqual(a['roles'],b['roles']);self.assertEqual(b['roleCount'],21);self.assertFalse(b['profileSourceAdmissionQualified']);self.assertTrue(g.closed)
 def test_unsealed_no_git_or_open(self):
  with patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256',None),patch.object(m,'_git') as git,patch.object(m.os,'open') as opened:
   with self.assertRaises(m.Refusal):self.gate().observe('before')
   git.assert_not_called();opened.assert_not_called()
 def test_wrong_seal(self):
  with patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256','0'*64):
   with self.assertRaises(m.Refusal):self.gate().observe('before')
 def test_bad_live(self):
  name=next(iter(self.bodies));(self.root/name).write_bytes(b'wrong')
  with self.assertRaises(m.Refusal):self.gate().observe('before')
 def test_symlink_leaf(self):
  name=next(iter(self.bodies));p=self.root/name;p.unlink();p.symlink_to('/dev/null')
  with self.assertRaises(m.Refusal):self.gate().observe('before')
 def test_symlink_ancestor(self):
  old=self.root/'scripts/held';old.rename(self.root/'scripts/original');old.symlink_to('original')
  with self.assertRaises(m.Refusal):self.gate().observe('before')
 def test_wrong_git_bytes(self):
  original=m._git
  def git(op,name=None):return b'wrong'if op=='blob'else original(op,name)
  with patch.object(m,'_git',side_effect=git):
   with self.assertRaises(m.Refusal):self.gate().observe('before')
 def test_order(self):
  g=self.gate()
  with patch.object(m.os,'open') as opened:
   with self.assertRaises(m.Refusal):g.observe('after')
   opened.assert_not_called()
  g.observe('before')
  with self.assertRaises(m.Refusal):g.observe('before')
 def test_close_before(self):
  g=self.gate();g.close()
  with patch.object(m.os,'open') as opened:
   with self.assertRaises(m.Refusal):g.observe('before')
   opened.assert_not_called()
 def test_git_reentry(self):
  g=self.gate()
  def git(*a):g.status();return 'a'*40
  with patch.object(m,'_git',side_effect=git),patch.object(m.os,'open') as opened:
   with self.assertRaises(m.Refusal):g.observe('before')
   opened.assert_not_called();self.assertEqual(g.first,'gate-reentry')
 def test_cleanup_reentry(self):
  g=self.gate();close=os.close
  def closing(fd):close(fd);g.status()
  g.close_fn=closing
  with self.assertRaises(m.Refusal):g.observe('before')
  self.assertEqual(g.first,'gate-reentry');self.assertEqual(g.status()['ownedDescriptors'],0)
 def test_json_types(self):
  for value in (b'{"x":NaN}',b'{"x":1.0}',b'{"x":1,"x":2}'):
   with self.assertRaises(m.Refusal):m.load(value,65536)
 def test_declared_inherited_missing(self):
  t=json.loads(self.traw);name=next(iter(t['roles']));t['roles'][name]['kind']='control';traw=raw(t);d={**self.descriptor,'tableBytes':len(traw),'tableSha256':hashlib.sha256(traw).hexdigest(),'tableGitBlob':m.blob(traw)};draw=raw(d)
  with patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256',hashlib.sha256(draw).hexdigest()):
   with self.assertRaises(m.Refusal):m.Gate(str(self.root),draw,traw).observe('before')
 def reseal_table(self,t,dchanges=None):
  traw=raw(t);d={**self.descriptor,'tableBytes':len(traw),'tableSha256':hashlib.sha256(traw).hexdigest(),'tableGitBlob':m.blob(traw),**(dchanges or {})};draw=raw(d);return draw,traw
 def test_advertised_workflow_missing_or_miskind(self):
  for changes in ({'workflow':'.github/workflows/other.yml'},{}):
   t=json.loads(self.traw)
   if not changes:t['roles']['.github/workflows/full-tree.yml']['kind']='control'
   draw,traw=self.reseal_table(t,changes)
   with patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256',hashlib.sha256(draw).hexdigest()),patch.object(m.os,'open') as opened:
    with self.assertRaises(m.Refusal):m.Gate(str(self.root),draw,traw).observe('before')
    opened.assert_not_called()
 def test_ancestor_conflicts_both_orders(self):
  for order in (('scripts/extra','scripts/extra/child'),('scripts/extra/child','scripts/extra')):
   t=json.loads(self.traw)
   for name in order:t['roles'][name]={'kind':'config','bytes':1,'sha256':'0'*64,'gitBlob':'0'*40}
   draw,traw=self.reseal_table(t)
   with patch.object(m,'EXTERNAL_DESCRIPTOR_SHA256',hashlib.sha256(draw).hexdigest()),patch.object(m.os,'open') as opened:
    with self.assertRaises(m.Refusal):m.Gate(str(self.root),draw,traw).observe('before')
    opened.assert_not_called()
 def test_hash_constructor_reentry_no_hexdigest(self):
  g=self.gate();original=hashlib.sha256;calls=[0]
  class H:
   def hexdigest(self):calls[0]+=1;return original(self.draw).hexdigest()
  def ctor(b):g.status();return H()
  with patch.object(m.hashlib,'sha256',new=ctor):
   with self.assertRaises(m.Refusal):g.observe('before')
  self.assertEqual(calls[0],0)
 def test_primary_read_error_survives_close(self):
  g=self.gate();primary=OSError('private');original=os.close;count=[0]
  def closing(fd):
   original(fd);count[0]+=1
   if count[0]==1:raise ValueError('private-close')
  g.close_fn=closing
  with patch.object(m.os,'read',side_effect=primary):
   with self.assertRaises(OSError) as c:g.observe('before')
  self.assertIs(c.exception,primary);self.assertEqual(g.first,'filesystem-refused');self.assertEqual(g.close_refused,1)
 def test_metadata_field_mutation_does_not_change_original_seal(self):
  g=self.gate();original=m._git;once=[False];seal=hashlib.sha256(self.draw).hexdigest()
  def git(op,name=None):
   if not once[0]:once[0]=True;g.table_raw=b'changed';m.EXTERNAL_DESCRIPTOR_SHA256='0'*64
   return original(op,name)
  with patch.object(m,'_git',side_effect=git):v=g.observe('before')
  self.assertEqual(v['descriptorSha256'],seal);self.assertEqual(v['table']['sha256'],self.descriptor['tableSha256'])
 def test_changed_actual_table_rejected_after_metadata_mutation(self):
  g=self.gate();original=m._git
  def git(op,name=None):
   if op=='blob' and name==self.name:g.table_raw=b'changed';return b'changed'
   return original(op,name)
  with patch.object(m,'_git',side_effect=git):
   with self.assertRaises(m.Refusal):g.observe('before')
 def test_returned_open_reentry_refused_close_count_once(self):
  g=self.gate();opened=os.open;closed=os.close;count=[0]
  def open_fn(*a,**k):fd=opened(*a,**k);g.status();return fd
  def close_fn(fd):count[0]+=1;closed(fd);raise OSError('private-close')
  g.close_fn=close_fn
  with patch.object(m.os,'open',new=open_fn):
   with self.assertRaises(m.Refusal):g.observe('before')
  self.assertEqual(g.first,'gate-reentry');self.assertEqual(count[0],1);self.assertEqual(g.close_refused,1);self.assertEqual(g.status()['ownedDescriptors'],0)
 def test_final_context_drift(self):
  original=m._git;count=[0]
  def git(op,name=None):
   if op=='head':count[0]+=1;return 'a'*40 if count[0]==1 else 'b'*40
   return original(op,name)
  with patch.object(m,'_git',side_effect=git):
   with self.assertRaises(m.Refusal):self.gate().observe('before')
if __name__=='__main__':unittest.main()
