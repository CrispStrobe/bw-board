import ast,hashlib,importlib.util,json,os,shutil,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent;sp=importlib.util.spec_from_file_location('owned_supervisor',HERE/'supervisor.py');s=importlib.util.module_from_spec(sp);sp.loader.exec_module(s)
PUBLIC=HERE.parent.parent
PROVIDERS={name:HERE/name for name in ('gate.py','adapter.py','packet.py')}
def raw(v):return s.raw(v)
def blob(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
class T(unittest.TestCase):
 def git(self,*args):return subprocess.run(('/usr/bin/git','--no-replace-objects','-C',str(self.root),*args),env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,stdin=subprocess.DEVNULL,timeout=5,check=True).stdout
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.rows={};self.outputs=[];self.addCleanup(self.cleanup_outputs)
  tree=ast.parse(PROVIDERS['gate.py'].read_text());held=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='INHERITED'for t in n.targets))
  for name,fact in held.items():self.put(name,(PUBLIC/name).read_bytes(),'inherited')
  kinds={'gate.py':'admission','adapter.py':'config','packet.py':'packet','supervisor.py':'runner','executor.py':'executor','controls.py':'executor-control','gate-controls.py':'admission-control','README.md':'readme'}
  for name,kind in kinds.items():
   source=PROVIDERS.get(name,HERE/name)
   if name=='gate-controls.py':source=HERE/'gate-controls.py'
   self.put(s.PREFIX+name,source.read_bytes(),kind)
  self.put('.github/workflows/offline-fixture.yml',b'# manufactured offline source only\n','workflow')
  table={'schema':'bw.full-tree-profile-role-table.v1','inheritedRoleCount':14,'roles':self.rows};self.traw=raw(table);self.table_path=s.PREFIX+'roles.json';p=self.root/self.table_path;p.write_bytes(self.traw)
  self.git('init','-q');self.git('config','user.name','Manufactured');self.git('config','user.email','manufactured@example.invalid');self.git('remote','add','origin','https://github.com/CrispStrobe/bw-board.git');self.git('add','--','.');self.git('commit','-qm','offline fixture');head=self.git('rev-parse','HEAD').decode().strip();self.git('checkout','--detach','-q',head)
  self.draw=raw({'schema':'bw.full-tree-profile-descriptor.v1','status':'UNARMED_SOURCE_ONLY','head':head,'repository':'CrispStrobe/bw-board','origin':'https://github.com/CrispStrobe/bw-board.git','workflow':'.github/workflows/offline-fixture.yml','branch':'lane/offline-fixture','pr':1,'tablePath':self.table_path,'tableBytes':len(self.traw),'tableSha256':s.sha(self.traw),'tableGitBlob':blob(self.traw)})
  self.approval={'schema':'private.full-tree-supervisor-approval.v1','status':'UNARMED_OFFLINE_ONLY','head':head,'descriptorSha256':s.sha(self.draw),'tableSha256':s.sha(self.traw),'components':{name:{k:self.rows[name][k]for k in ('bytes','sha256')}for name in s.ROLES}};self.araw=raw(self.approval);p=patch.object(s,'EXTERNAL_APPROVAL_SHA256',s.sha(self.araw));p.start();self.addCleanup(p.stop)
 def put(self,name,b,kind):
  p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);self.rows[name]={'kind':kind,'bytes':len(b),'sha256':s.sha(b),'gitBlob':blob(b)}
 def owner(self):
  o=s.Supervisor(str(self.root),self.araw,self.draw,self.traw);self.outputs.append(o);return o
 def cleanup_outputs(self):
  for o in self.outputs:
   if o._output is not None:shutil.rmtree(o._output)
 def test_integrated_success_honest_negative_actual_packet(self):
  o=self.owner();v=o.offline('success');self.assertTrue(v['offlineControlPassed']);self.assertEqual(v['bootstrapComponentsVerified'],5);self.assertEqual(v['execution']['observedLimits']['addressSpaceBytes'],134217728);self.assertIsNotNone(v['sourceBefore']);self.assertIsNotNone(v['sourceAfter']);self.assertEqual(v['packet']['assembly']['exit'],1);self.assertFalse(v['actualAcquisitionQualified']);self.assertEqual(Path(o._output,'raw-child.stderr').read_bytes(),b'')
 def test_integrated_midstage_refusal_raw_preserved(self):
  o=self.owner();v=o.offline('midstage-refusal');self.assertFalse(v['offlineControlPassed']);self.assertEqual(v['firstFailure'],'manufactured-midstage-refusal');self.assertEqual(v['execution']['exit'],7);self.assertIsNotNone(v['sourceAfter']);self.assertEqual(Path(o._output,'raw-child.stderr').read_bytes(),b'manufactured-midstage-refusal\n')
 def test_default_approval_refuses_before_loader(self):
  o=self.owner()
  with patch.object(s,'EXTERNAL_APPROVAL_SHA256',None),patch.object(s,'types')as loader:
   with self.assertRaises(s.Refusal):o.offline('success')
   loader.ModuleType.assert_not_called()
 def test_actual_refuses_before_source(self):
  o=self.owner()
  with patch.object(o,'bootstrap')as bootstrap:
   with self.assertRaises(s.Refusal):o.actual()
   bootstrap.assert_not_called()
 def test_changed_component_refuses_before_modules(self):
  (self.root/s.PREFIX/'gate.py').write_bytes(b'changed')
  with patch.object(s,'types')as loader:
   with self.assertRaises(s.Refusal):self.owner().offline('success')
   loader.ModuleType.assert_not_called()
 def executor(self):
  spec=importlib.util.spec_from_file_location('owned_executor_test',HERE/'executor.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
 def test_executor_overflow_keeps_observed_prefix(self):
  e=self.executor();owner=e.Executor()
  class Pipe:
   def __init__(self,fd):self.fd=fd
   def fileno(self):return self.fd
   def close(self):pass
  class Process:
   stdout=Pipe(42);stderr=Pipe(43);pid=999999;returncode=-9
   def wait(self,timeout=None):return self.returncode
  process=Process()
  class Key:fileobj=process.stdout
  class Selector:
   def register(self,*args):pass
   def get_map(self):return {1:1}
   def select(self,*args):return [(Key(),1)]
   def close(self):pass
  with patch.object(e.subprocess,'Popen',return_value=process),patch.object(e.selectors,'DefaultSelector',return_value=Selector()),patch.object(e.os,'set_blocking'),patch.object(e.os,'read',return_value=b'x'*8193),patch.object(e.os,'killpg'):
   with self.assertRaises(e.Refusal):owner.execute('success',str(self.root))
  self.assertEqual(owner.stdout,b'x'*8192);self.assertTrue(owner.receipt['outputCapRefused']);self.assertFalse(owner.receipt['rawLogsComplete']);self.assertEqual(owner.receipt['stdoutSha256'],s.sha(owner.stdout))
 def test_executor_setup_error_keeps_receipt_original(self):
  e=self.executor();owner=e.Executor();original=ValueError('private-setup')
  with patch.object(e.subprocess,'Popen',side_effect=original):
   with self.assertRaises(ValueError)as c:owner.execute('success',str(self.root))
  self.assertIs(c.exception,original);self.assertIsNotNone(owner.receipt);self.assertFalse(owner.receipt['rawLogsComplete']);self.assertEqual(owner.stdout,b'')
 def test_first_secondary_sourceafter_survives_packet_cleanup(self):
  o=self.owner();bootstrap=o.bootstrap;original=OSError('private-after')
  def bound():
   modules=bootstrap();observe=o._gate.observe
   def observation(position):
    if position=='after':raise original
    return observe(position)
   o._gate.observe=observation;return modules
  with patch.object(o,'bootstrap',new=bound),patch.object(o,'write_outputs',side_effect=ValueError('private-packet')):
   with self.assertRaises(OSError)as c:o.offline('success')
  self.assertIs(c.exception,original);self.assertEqual(o.secondary,'source-after-refused');self.assertFalse(o.status()['offlineControlPassed'])
 def test_bootstrap_constructor_reentry_no_exec(self):
  o=self.owner();original=s.types.ModuleType;count=[0]
  def constructor(name):o.status();count[0]+=1;return original(name)
  with patch.object(s.types,'ModuleType',new=constructor):
   with self.assertRaises(s.Refusal):o.offline('success')
  self.assertEqual(count[0],1);self.assertIsNone(o._gate)
 def finalwait_case(self,expired=False):
  from unittest.mock import Mock
  e=self.executor();owner=e.Executor();original=subprocess.TimeoutExpired('manufactured-child',5)
  class Pipe:
   def fileno(self):return 42
   def close(self):pass
  process=Mock();process.stdout=Pipe();process.stderr=Pipe();process.pid=424242;process.returncode=None;calls=[0]
  def wait(timeout):
   calls[0]+=1
   if calls[0]==1 and expired:raise original
   process.returncode=-9;return -9
  process.wait.side_effect=wait
  class Selector:
   def register(self,*args):pass
   def get_map(self):return {}
   def close(self):pass
  clock=(0,6)if not expired else(0,0)
  with patch.object(e.subprocess,'Popen',return_value=process),patch.object(e.selectors,'DefaultSelector',return_value=Selector()),patch.object(e.os,'set_blocking'),patch.object(e.time,'monotonic',side_effect=clock),patch.object(e.os,'killpg')as kill:
   with self.assertRaises(subprocess.TimeoutExpired if expired else e.Refusal)as c:owner.execute('success',str(self.root))
   if expired:self.assertIs(c.exception,original)
   kill.assert_called_once_with(process.pid,e.signal.SIGKILL)
  self.assertTrue(owner.receipt['wallTimedOut']);self.assertEqual(owner.receipt['signal'],9);self.assertIsNone(owner.receipt['exit']);self.assertFalse(owner.receipt['rawLogsComplete']);self.assertEqual(owner.stdout,b'')
 def test_finalwait_elapsed_sets_flag_and_cleanup_signal(self):self.finalwait_case(False)
 def test_finalwait_timeout_preserves_original_and_flag(self):self.finalwait_case(True)
 def test_executor_eof_reentry_no_later_stream_read(self):
  from unittest.mock import Mock
  e=self.executor();owner=e.Executor();calls=[]
  class Pipe:
   def __init__(self,fd):self.fd=fd
   def fileno(self):return self.fd
   def close(self):pass
  process=Mock();process.stdout=Pipe(42);process.stderr=Pipe(43);process.pid=424242;process.returncode=-9;process.wait.return_value=-9
  class Key:
   def __init__(self,obj):self.fileobj=obj
  class Selector:
   def register(self,*args):pass
   def get_map(self):return {1:1}
   def select(self,*args):return [(Key(process.stdout),1),(Key(process.stderr),1)]
   def unregister(self,*args):raise AssertionError('post-poison unregister')
   def close(self):pass
  def read(fd,count):calls.append(fd);owner.status();return b''
  with patch.object(e.subprocess,'Popen',return_value=process),patch.object(e.selectors,'DefaultSelector',return_value=Selector()),patch.object(e.os,'set_blocking'),patch.object(e.os,'read',new=read),patch.object(e.os,'killpg'):
   with self.assertRaises(e.Refusal):owner.execute('success',str(self.root))
  self.assertEqual(calls,[42]);self.assertFalse(owner.receipt['rawLogsComplete']);self.assertEqual(owner.first,'executor-reentry')
 def test_executor_policy_mutation_after_capture_cannot_substitute(self):
  e=self.executor();owner=e.Executor();statvfs=e.os.statvfs
  def observe(path):e.LIMITS['cpuSeconds']=2;return statvfs(path)
  with patch.object(e.os,'statvfs',new=observe):receipt,out,err=owner.execute('success',str(self.root))
  self.assertEqual(receipt['limits']['cpuSeconds'],3);self.assertEqual(receipt['observedLimits']['cpuSeconds'],3);self.assertEqual(json.loads(out)['limits']['cpuSeconds'],3);self.assertTrue(receipt['rawLogsComplete'])
 def test_child_command_captured_before_observation_hook(self):
  e=self.executor();owner=e.Executor();original=e.CHILD;statvfs=e.os.statvfs;seen=[];stopped=ValueError('manufactured-stop')
  def observe(path):e.CHILD='unapproved replacement';e.sys.executable='/unapproved/interpreter';return statvfs(path)
  def spawn(argv,**kw):seen.append(argv);raise stopped
  with patch.object(e.sys,'executable',e.sys.executable),patch.object(e.os,'statvfs',new=observe),patch.object(e.subprocess,'Popen',new=spawn):
   with self.assertRaises(ValueError)as c:owner.execute('success',str(self.root))
  self.assertIs(c.exception,stopped);self.assertEqual(len(seen),1);self.assertEqual(seen[0][5],original);self.assertNotEqual(seen[0][0],'/unapproved/interpreter')
 def test_child_program_altered_before_entry_refuses_before_hooks(self):
  e=self.executor();owner=e.Executor()
  with patch.object(e,'CHILD','unapproved'),patch.object(e.os,'statvfs')as observed,patch.object(e.subprocess,'Popen')as spawned:
   with self.assertRaises(e.Refusal):owner.execute('success',str(self.root))
   observed.assert_not_called();spawned.assert_not_called()
if __name__=='__main__':unittest.main()
