"""Owned tiny Git + manufactured HTTP/TAR/ZIP. Private harness only."""
import bz2,hashlib,importlib.util,io,json,shutil,time,urllib.request,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent;PUBLIC=HERE.parent.parent
sp=importlib.util.spec_from_file_location('connection_controller',HERE/'controller.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
sp=importlib.util.spec_from_file_location('source_fixture',PUBLIC/'scripts/i80386-unarmed-supervisor/controls.py');old=importlib.util.module_from_spec(sp);sp.loader.exec_module(old)
sp=importlib.util.spec_from_file_location('archive_fixture',PUBLIC/'scripts/i80386-full-tree-notice-connection/controls.py');archive=importlib.util.module_from_spec(sp);sp.loader.exec_module(archive)
def sha(b):return hashlib.sha256(b).hexdigest()
class Response:
 def __init__(self,body):self.body=body;self.offset=0;self.closes=0
 def getcode(self):return 200
 def read(self,size):part=self.body[self.offset:self.offset+size];self.offset+=len(part);return part
 def close(self):self.closes+=1
class T(unittest.TestCase):
 def setUp(self):
  self.fixture=old.T('test_integrated_success_honest_negative_actual_packet');self.addCleanup(self.fixture.doCleanups);self.fixture.setUp();self.root=self.fixture.root;self.outputs=[];self.addCleanup(self.clean_outputs);self.owner=None;self.loaded={};self.opened=[];self.on_open=None
  required=set(c.REQUIRED)
  kinds={'controller.py':'runner','controller-controls.py':'executor-control','CONTROLLER.md':'readme','transport.py':'config'}
  for name in required:
   if name in self.fixture.rows:continue
   kind=kinds.get(Path(name).name,'admission'if name.endswith('/admission.py')else'config')
   if name.endswith('.yml'):kind='workflow'
   self.fixture.put(name,(PUBLIC/name).read_bytes(),kind)
  table={'schema':'bw.full-tree-profile-role-table.v1','inheritedRoleCount':14,'roles':self.fixture.rows};self.traw=c.raw(table);self.table_path='scripts/i80386-full-tree-provisioning-launcher/roles.json';(self.root/self.table_path).write_bytes(self.traw);self.fixture.git('add','--','.');self.fixture.git('commit','-qm','controller fixture');head=self.fixture.git('rev-parse','HEAD').decode().strip();self.fixture.git('checkout','--detach','-q',head)
  self.draw=c.raw({'schema':'bw.full-tree-profile-descriptor.v1','status':'UNARMED_SOURCE_ONLY','head':head,'repository':'CrispStrobe/bw-board','origin':'https://github.com/CrispStrobe/bw-board.git','workflow':'.github/workflows/i80386-provisioning-admission-connect.yml','branch':'lane/386-provisioning-admission-connect-20261013','pr':1,'tablePath':self.table_path,'tableBytes':len(self.traw),'tableSha256':sha(self.traw),'tableGitBlob':old.blob(self.traw)})
  self.approval={'schema':'bw.provisioning-controller-approval.v1','status':'UNARMED_SOURCE_CONNECTION_ONLY','head':head,'descriptorSha256':sha(self.draw),'tableSha256':sha(self.traw),'components':{name:{k:row[k]for k in ('bytes','sha256')}for name,row in self.fixture.rows.items()}};self.araw=c.raw(self.approval)
  self.notice={'copying':b'raw\fnotice','copying.dj':b'noticeDJ','copying.lib':b'L'*35147};self.gcc=(b'runtime',b'G'*35147);self.files={'djgpp/cc1':b'small-cc1','djgpp/collect2':b'small-collect2'};self.rows=[{'path':'djgpp','type':'directory','bytes':0}]+[{'path':n,'type':'file','bytes':len(b),'sha256':sha(b)}for n,b in self.files.items()]
  tool=bz2.compress(archive.tar_member('djgpp/',directory=True)+b''.join(archive.tar_member(n,b)for n,b in self.files.items())+bytes(1024));buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_DEFLATED)as z:
   for n,b in self.notice.items():z.writestr(n,b)
  self.inputs=(tool,buf.getvalue(),b'opaque2',b'opaque3',*self.gcc)
 def clean_outputs(self):
  for owner in self.outputs:
   if owner._output is not None:shutil.rmtree(owner._output)
 def harness(self):
  p=patch.object(c,'EXTERNAL_APPROVAL_SHA256',sha(self.araw));p.start();self.addCleanup(p.stop)
  p=patch.object(c,'positive',new=self.tiny_positive);p.start();self.addCleanup(p.stop)
  real=c.Controller._execute;test=self
  def execute(owner,name,body):
   test.assertEqual(owner.verified,len(test.fixture.rows));module=real(owner,name,body);test.loaded[name]=module
   if name=='transport':
    table=tuple((r[0],r[1],len(b),sha(b))for r,b in zip(module._INPUTS,test.inputs));module._INPUTS=table;module._INPUTS_SHA256=sha(json.dumps(table,separators=(',',':')).encode())
    class Opener:
     def open(self,request,timeout):
      index=len(test.opened);test.opened.append(request.full_url)
      if test.on_open is not None:test.on_open(index)
      return Response(test.inputs[index])
    p=patch.object(module.urllib.request,'build_opener',return_value=Opener());p.start();test.addCleanup(p.stop)
   if name=='coordinator':
    pins=tuple((str(i),len(b),sha(b))for i,b in enumerate(test.inputs[:4]));module.extractor.PINS=pins;module.bridge.PINS=pins;module.extractor.SELECTED={n:(len(b),sha(b))for n,b in test.notice.items()};module.GCC_PINS=tuple((role,len(b),sha(b))for(role,_,_),b in zip(module.GCC_PINS,test.gcc));module.bridge.ROWS=test.rows;module.bridge.writer.ROWS=test.rows;module.bridge.writer.NOTICES={module.ROLE_MAP[n]:(len(b),sha(b))for n,b in test.notice.items()};module.bridge.writer.NOTICES.update({r:(n,h)for r,n,h in module.GCC_PINS})
   return module
  p=patch.object(c.Controller,'_execute',new=execute);p.start();self.addCleanup(p.stop)
 def tiny_positive(self,s,parent_depth=None):
  if type(s)is not dict:return False
  w=s['bridgeFacts']['writerStatus'];return s['phase']=='observed-complete'and s['firstFailure']is None and s['closed']is True and s['archiveInputsAuthenticated']==4 and s['gccInputsAuthenticated']==2 and s['noticeRolesIssued']==5 and s['noticeBytesIssued']==sum(map(len,self.notice.values()))+sum(map(len,self.gcc))and w['ordinaryFilesWritten']==2 and w['selectedNoticeSubsetWritten']==5 and w['closeRefused']==0 and w['observedPrototypeComplete']is True
 def controller(self):
  owner=c.Controller(str(self.root),self.araw,self.draw,self.traw);self.outputs.append(owner);self.owner=owner;return owner
 def test_default_unarmed_before_files_git_transport(self):
  with patch.object(c.os,'open')as opens,patch.object(c.Controller,'_execute')as execute,patch.object(old.subprocess,'Popen')as git,patch.object(urllib.request,'build_opener')as opener,patch.object(time,'monotonic',side_effect=AssertionError('clock')):
   with self.assertRaises(c.Refusal):self.controller().run()
   opens.assert_not_called();execute.assert_not_called();git.assert_not_called();opener.assert_not_called()
  self.assertEqual(self.opened,[])
 def test_real_tiny_git_and_tiny_coordinator_connection(self):
  self.harness();owner=self.controller();v=owner.run();self.assertTrue(v['complete']);self.assertEqual(len(self.opened),6);self.assertEqual(v['bootstrapComponentsVerified'],len(self.fixture.rows));self.assertEqual(v['sourceBefore']['roleCount'],len(self.fixture.rows));self.assertEqual(v['sourceAfter']['roleCount'],len(self.fixture.rows));self.assertEqual(v['inheritedProjection']['before']['roleCount'],14);self.assertEqual(v['inheritedProjection']['after']['roleCount'],14)
  for flag in c.FLAGS:self.assertIs(v[flag],False)
  self.assertFalse(v['outerHardBoundImplemented']);self.assertEqual(v['coordinator']['bridgeFacts']['writerStatus']['ordinaryFilesWritten'],2)
 def test_wrong_external_approval_before_files(self):
  self.harness();self.araw=self.araw+b' '
  with patch.object(c.os,'open')as opens:
   with self.assertRaises(c.Refusal):self.controller().run()
   opens.assert_not_called()
 def test_wrong_descriptor_and_table_before_files(self):
  self.harness();before=(self.draw,self.traw)
  for role in ('descriptor','table'):
   with self.subTest(role=role):
    self.draw,self.traw=before
    if role=='descriptor':self.draw+=b' '
    else:self.traw+=b' '
    with patch.object(c.os,'open')as opens:
     with self.assertRaises(c.Refusal):self.controller().run()
     opens.assert_not_called()
 def test_bad_head_before_files(self):
  self.harness();d=json.loads(self.draw);d['head']=True;self.draw=c.raw(d);self.approval['head']=True;self.approval['descriptorSha256']=sha(self.draw);self.araw=c.raw(self.approval)
  with patch.object(c,'EXTERNAL_APPROVAL_SHA256',sha(self.araw)),patch.object(c.os,'open')as opens:
   with self.assertRaises(c.Refusal):self.controller().run()
   opens.assert_not_called()
 def test_changed_bootstrap_component_zero_exec_transport(self):
  self.harness();(self.root/c.PATHS['transport']).write_bytes(b'changed')
  with patch.object(c.Controller,'_execute')as execute:
   with self.assertRaises(c.Refusal):self.controller().run()
   execute.assert_not_called()
  self.assertEqual(self.opened,[])
 def test_second_run_consumed(self):
  self.harness();owner=self.controller();owner.run()
  with self.assertRaises(c.Refusal):owner.run()
  self.assertEqual(len(self.opened),6)
 def test_transport_hash_refusal_before_coordinator(self):
  self.harness()
  def changed(index):
   if index==0:self.inputs=(b'bad',*self.inputs[1:])
  self.on_open=changed;owner=self.controller()
  with self.assertRaises(Exception):owner.run()
  self.assertEqual(len(self.opened),1);self.assertIsNone(owner._coordinator);self.assertEqual(owner.status()['transport']['firstFailure'],'fetch-extent');self.assertIsNotNone(owner.status()['sourceAfter']);self.assertFalse(owner.status()['complete'])
 def test_swallowed_transport_reentry_no_coordinator_or_source_after(self):
  self.harness()
  def reentry(index):
   try:self.owner.status()
   except c.Refusal:pass
  self.on_open=reentry;owner=self.controller()
  with self.assertRaises(Exception):owner.run()
  v=owner.status();self.assertEqual(v['firstFailure'],'controller-reentry');self.assertFalse(v['complete']);self.assertEqual(len(self.opened),1);self.assertIsNone(owner._coordinator);self.assertIsNone(v['sourceAfter'])
 def test_changed_source_after_cannot_complete(self):
  self.harness()
  def changed(index):
   if index==0:(self.root/'scripts/i80386-full-tree-provisioning-launcher/CONTROLLER.md').write_bytes(b'changed source')
  self.on_open=changed;owner=self.controller()
  with self.assertRaises(Exception):owner.run()
  self.assertFalse(owner.status()['complete']);self.assertIsNone(owner.status()['sourceAfter']);self.assertEqual(owner.status()['firstFailure'],'source-after-refused')
 def test_final_only_predicate_reentry_refuses_closed_lifecycle(self):
  self.harness();calls=[];real=self.tiny_positive
  def positive(facts,parent):
   calls.append(1)
   if len(calls)==2:
    try:self.owner.status()
    except c.Refusal:pass
   return real(facts,parent)
  with patch.object(c,'positive',new=positive):
   owner=self.controller()
   with self.assertRaises(c.Refusal):owner.run()
  self.assertEqual(len(calls),2);self.assertEqual(owner.phase,'refused');self.assertFalse(owner.busy);self.assertTrue(owner.closed);self.assertFalse(owner.status()['complete']);self.assertEqual(owner.first,'controller-reentry')
 def test_final_only_predicate_original_exception_preserved(self):
  self.harness();calls=[];original=RuntimeError('final original');real=self.tiny_positive
  def positive(facts,parent):
   calls.append(1)
   if len(calls)==2:raise original
   return real(facts,parent)
  with patch.object(c,'positive',new=positive):
   owner=self.controller()
   with self.assertRaises(RuntimeError)as caught:owner.run()
  self.assertIs(caught.exception,original);self.assertFalse(owner.busy);self.assertTrue(owner.closed);self.assertEqual(owner.phase,'refused')
 def test_approval_checkout_and_fixed_globals_captured_before_hooks(self):
  self.harness();owner=self.controller();original=owner.digest;calls=[]
  def digest(body):
   if not calls:
    calls.append(1);owner.approval_raw=b'changed';owner.descriptor_raw=b'changed';owner.table_raw=b'changed';owner.checkout='/nonexistent';c.FIXED={};c.PATHS={'gate':'foreign','adapter':'foreign','transport':'foreign','coordinator':'foreign'};c.REQUIRED=()
   return original(body)
  saved=(c.FIXED,c.PATHS,c.REQUIRED)
  try:
   with patch.object(owner,'digest',new=digest):v=owner.run()
   self.assertTrue(v['complete']);self.assertEqual(v['sourceBefore']['head'],self.approval['head'])
  finally:c.FIXED,c.PATHS,c.REQUIRED=saved
 def test_sealed_closure_omission_zero_exec_transport(self):
  self.harness();missing='scripts/i80386-full-tree-provisioner/manifest.json';table=json.loads(self.traw);del table['roles'][missing];self.traw=c.raw(table);descriptor=json.loads(self.draw);descriptor.update(tableBytes=len(self.traw),tableSha256=sha(self.traw),tableGitBlob=old.blob(self.traw));self.draw=c.raw(descriptor);approval=dict(self.approval);approval['components']=dict(approval['components']);del approval['components'][missing];approval.update(tableSha256=sha(self.traw),descriptorSha256=sha(self.draw));self.araw=c.raw(approval)
  with patch.object(c,'EXTERNAL_APPROVAL_SHA256',sha(self.araw)),patch.object(c.Controller,'_execute')as execute:
   with self.assertRaises(c.Refusal)as caught:self.controller().run()
   execute.assert_not_called()
  self.assertEqual(str(caught.exception),'source-closure');self.assertEqual(self.opened,[])
 def test_primary_coordinator_error_survives_secondary_close(self):
  self.harness();primary=OSError('manufactured primary');secondary=RuntimeError('manufactured cleanup');original=c.Controller._execute;closed=[]
  def execute(owner,name,body):
   module=original(owner,name,body)
   if name=='coordinator':
    def provision(delegate,*args):raise primary
    def close(delegate):closed.append(1);raise secondary
    module.Coordinator.provision=provision;module.Coordinator.close=close
   return module
  with patch.object(c.Controller,'_execute',new=execute):
   owner=self.controller()
   with self.assertRaises(OSError)as caught:owner.run()
  self.assertIs(caught.exception,primary);self.assertEqual(closed,[1]);v=owner.status();self.assertFalse(v['complete']);self.assertEqual(v['cleanupRefused'],1);self.assertEqual(v['firstFailure'],'operation-refused');self.assertEqual(v['secondaryFailure'],'coordinator-close-refused');self.assertIsNotNone(v['sourceAfter']);self.assertFalse(owner.busy);self.assertTrue(owner.closed)
if __name__=='__main__':unittest.main()
