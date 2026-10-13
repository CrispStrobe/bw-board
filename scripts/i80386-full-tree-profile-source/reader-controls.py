"""Manufactured JSON source packet controls, no producers/Git/process/FS observation."""
import copy,hashlib,importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
p=Path(__file__).parent;s=importlib.util.spec_from_file_location('independent_source_reader',p/'reader.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def raw(v):return json.dumps(v,separators=(',',':')).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
class T(unittest.TestCase):
 def setUp(self):
  self.held=(p/'inherited-roles.json').read_bytes();held=json.loads(self.held);rows={name:{'kind':'inherited',**row,'gitBlob':r.HELD_GIT_BLOBS[name]}for name,row in held.items()}
  for kind in r.REQUIRED_NEW_KINDS:rows['.github/workflows/proposed.yml'if kind=='workflow'else'scripts/proposed/'+kind+'.py']={'kind':kind,'bytes':1,'sha256':sha(b'x'),'gitBlob':'c'*40}
  self.table={'schema':'bw.full-tree-profile-role-table.v1','inheritedRoleCount':14,'roles':rows};self.t=raw(self.table)
  self.d={'schema':'bw.full-tree-profile-descriptor.v1','status':'UNARMED_SOURCE_ONLY','head':'a'*40,'repository':'CrispStrobe/bw-board','origin':'https://github.com/CrispStrobe/bw-board.git','workflow':'.github/workflows/proposed.yml','branch':'lane/proposed','pr':1,'tablePath':'scripts/proposed/table.json','tableBytes':len(self.t),'tableSha256':sha(self.t),'tableGitBlob':'d'*40}
  self.refresh()
 def refresh(self):
  self.t=raw(self.table);self.d['tableBytes']=len(self.t);self.d['tableSha256']=sha(self.t);self.d['tableGitBlob']=hashlib.sha1(b'blob '+str(len(self.t)).encode()+b'\0'+self.t).hexdigest();self.dr=raw(self.d)
  self.before={'schema':'bw.full-tree-profile-source.v1','position':'before','head':self.d['head'],'repository':self.d['repository'],'roleCount':len(self.table['roles']),'roles':copy.deepcopy(self.table['roles']),'table':{k:self.d['table'+k[0].upper()+k[1:]]for k in ('path','bytes','sha256','gitBlob')},'descriptorSha256':sha(self.dr),**{k:False for k in r.FLAGS}}
  self.after=copy.deepcopy(self.before);self.after['position']='after'
 def check(self):return r.validate_source_pair(self.dr,self.t,raw(self.before),raw(self.after),self.held)
 def test_manufactured_complete_graph_no_authority(self):
  v=self.check();self.assertEqual(v['sourceRoleCount'],21);self.assertTrue(v['reportedPositionConsistency'])
  for k in r.FLAGS:self.assertIs(v[k],False)
 def test_external_seals_unset(self):
  with self.assertRaises(r.Refusal):r.audit_source_pair(self.dr,self.t,raw(self.before),raw(self.after),self.held)
 def test_duplicate_nonfinite_float_complexity(self):
  for b in (b'{"x":1,"x":2}',b'{"x":NaN}',b'{"x":1.0}',b'{"x":-1}',b'['*10+b'0'+b']'*10):
   with self.assertRaises(r.Refusal):r.load(b,65536)
 def test_held14_is_not_full_graph(self):
  self.table['roles']={k:v for k,v in self.table['roles'].items()if v['kind']=='inherited'};self.refresh()
  with self.assertRaises(r.Refusal):self.check()
 def test_each_new_kind_required(self):
  for kind in r.REQUIRED_NEW_KINDS:
   self.setUp();self.table['roles']['.github/workflows/proposed.yml'if kind=='workflow'else'scripts/proposed/'+kind+'.py']['kind']='readme';self.refresh()
   with self.assertRaises(r.Refusal):self.check()
 def test_inherited_bytes_hash_git_and_kind_binding(self):
  name=next(iter(self.table['roles']))
  for key,value in [('bytes',True),('sha256','0'*64),('gitBlob','0'*40),('kind','readme')]:
   self.setUp();self.table['roles'][name][key]=value;self.refresh()
   with self.assertRaises(r.Refusal):self.check()
 def test_self_cycle_and_both_order_ancestors(self):
  for paths in (['scripts/x','scripts/x/y'],['scripts/x/y','scripts/x']):
   with self.assertRaises(r.Refusal):r.no_ancestors(paths)
  self.table['roles'][self.d['tablePath']]={'kind':'config','bytes':1,'sha256':'a'*64,'gitBlob':'a'*40};self.refresh()
  with self.assertRaises(r.Refusal):self.check()
 def test_paths_aliases_and_host_paths(self):
  for name in ('/host/path','scripts/../escape','scripts//x','scripts/x\\y','scripts/x\x00'):
   with self.assertRaises(r.Refusal):r.path(name)
  with self.assertRaises(r.Refusal):r.no_ancestors(['scripts/x','scripts/x'])
 def test_descriptor_own_repo_status_head_types(self):
  for key,value in [('pr',True),('head','b'*39),('repository','foreign/repo'),('origin','https://foreign.invalid'),('status','READY'),('tableBytes',True)]:
   self.setUp();self.d[key]=value;self.dr=raw(self.d)
   with self.assertRaises(r.Refusal):self.check()
 def test_snapshot_drift_position_extra_and_flags(self):
  for key,value in [('position','before'),('head','b'*40),('roleCount',True),('descriptorSha256','0'*64),('gitJoinImplemented',True),('continuousSourceOwnershipQualified',0)]:
   self.setUp();self.after[key]=value
   with self.assertRaises(r.Refusal):self.check()
  self.setUp();self.after['extra']=None
  with self.assertRaises(r.Refusal):self.check()
 def test_separate_table_and_role_raw_drift(self):
  self.after['table']['gitBlob']='e'*40
  with self.assertRaises(r.Refusal):self.check()
  self.setUp();self.after['roles'][next(iter(self.after['roles']))]['sha256']='0'*64
  with self.assertRaises(r.Refusal):self.check()
 def test_exact_workflow_omission_and_wrong_kind(self):
  for mode in ('omitted','miskind','wrong-descriptor'):
   self.setUp()
   if mode=='omitted':del self.table['roles']['.github/workflows/proposed.yml']
   elif mode=='miskind':self.table['roles']['.github/workflows/proposed.yml']['kind']='readme'
   else:self.d['workflow']='.github/workflows/other.yml'
   # A different workflow row cannot substitute for the exact descriptor path.
   self.table['roles']['.github/workflows/extra.yml']={'kind':'workflow','bytes':1,'sha256':sha(b'x'),'gitBlob':'c'*40};self.refresh()
   with self.assertRaises(r.Refusal):self.check()
 def test_table_git_blob_and_depth_bounds(self):
  self.d['tableGitBlob']='0'*40;self.dr=raw(self.d)
  with self.assertRaises(r.Refusal):self.check()
  for value in ('lane/'+('/'.join(['x']*30)), 'lane/..', 'lane/.'):
   self.setUp();self.d['branch']=value;self.dr=raw(self.d)
   with self.assertRaises(r.Refusal):self.check()
  for value in ('/'.join(['x']*31),):
   with self.assertRaises(r.Refusal):r.path(value)
 def test_descriptor_8192_cap_and_100_roles_plus_table(self):
  with self.assertRaises(r.Refusal):r.descriptor(self.dr+b' '*(8193-len(self.dr)))
  for i in range(79):self.table['roles']['scripts/proposed/config'+str(i)+'.json']={'kind':'config','bytes':1,'sha256':sha(b'x'),'gitBlob':'c'*40}
  self.refresh();self.assertEqual(len(self.table['roles']),100);self.assertEqual(self.check()['sourceRoleCount'],100)
  self.table['roles']['scripts/proposed/overflow.json']={'kind':'config','bytes':1,'sha256':sha(b'x'),'gitBlob':'c'*40};self.refresh()
  with self.assertRaises(r.Refusal):self.check()
 def test_extra_inherited_kind_cannot_claim_held_membership(self):
  self.table['roles']['scripts/proposed/fake-inherited.py']={'kind':'inherited','bytes':1,'sha256':sha(b'x'),'gitBlob':'c'*40};self.refresh()
  with self.assertRaises(r.Refusal):self.check()
 def test_caps_before_decode_and_custom_values(self):
  for b in (b'x'*65537,bytearray(b'{}')):
   with self.assertRaises(r.Refusal):r.load(b,65536)
  class Foreign(dict):pass
  with self.assertRaises(r.Refusal):r.keys(Foreign(),())
if __name__=='__main__':unittest.main()
