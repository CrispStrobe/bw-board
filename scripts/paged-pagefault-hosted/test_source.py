"""Finite manufactured source controls. No restoration, provider or genuine child."""
import sys
sys.dont_write_bytecode=True
import json,copy,unittest,tempfile,gzip,io,zipfile,tarfile
from pathlib import Path
from unittest.mock import patch,Mock
from parent import derive_int_parent,_INT_PARENT,_INT_PARENT_SHA,derive_fault_context,derive_transport,derive_stack_parent,_HELD_STACK_PARENT,validate_contract,main,finalize,checkout,HERE,bounded
from archive import digest,zip_members,tar_members
from evidence import read_capture,read_outcome,DECODED_CAP,STORED_CAP
class Controls(unittest.TestCase):
 def ready(self):
  c=json.loads((HERE/'contract.json').read_text());validate_contract(c);return c
 def test_pending_or_null_authority_refuses_before_restoration_or_child(self):
  for pending in (True,False):
   c=self.ready()
   if pending:c['status']='PENDING_FRESH_PF_STATIC_BUILD_AND_READY_DRIVER'
   else:
    for key in ('artifactId','runId','zipBytes','zipSha256','addonSha256'):c[key]=None
    c['zipMembers']={};c['preparedFiles']={}
   with patch('parent.ordinary',return_value=json.dumps(c).encode()),patch('parent.download')as download,patch('parent.exclusive_tree')as restore,patch('parent.bounded')as child:
    with self.assertRaises(ValueError):main('enabled')
    download.assert_not_called();restore.assert_not_called();child.assert_not_called()
 def test_exact_held_lifecycle_and_fault_context_inverse(self):
  self.assertEqual(digest(_INT_PARENT.read_bytes()),_INT_PARENT_SHA)
  outer=derive_int_parent(_INT_PARENT.read_bytes());self.assertIn('derive_fault_context(derive_transport(',outer)
  expanded=derive_fault_context(derive_transport(derive_stack_parent(_HELD_STACK_PARENT.read_bytes())))
  self.assertIn("'compiledCount':243",expanded);self.assertIn("'driverCount':106",expanded)
  self.assertIn("('n','q','faults','attemptOrdinal')]==[57,56,1,57]",expanded)
  self.assertIn('readback-before-HLT',expanded);self.assertIn("capture,worker_outcome=read_capture(OUT/'guest')",expanded)
  self.assertIn("report['workerOutcome']=read_outcome(OUT/'guest')",expanded)
  for derive,arg in [(derive_int_parent,b'unknown'),(derive_fault_context,'unknown')]:
   with self.assertRaises(AssertionError):derive(arg)
 def test_closed_fresh_source_roles_refuse_old_or_invented_artifact(self):
  self.ready()
  mutations=[lambda c:c.update(enabledByDefault=True),lambda c:c.update(driverRevision='f'*40),lambda c:c.update(compiledRevision='e'*40),lambda c:c.update(addonSha256='92a5121df194c6675303913ebd527e7d0253e29e686b2cbd8dd91fb579489b6f'),lambda c:c.update(artifactId=11309320742),lambda c:c.update(runId=37218196080),lambda c:c.update(nodeSha256='c'*64),lambda c:c['compiledFiles'].pop(next(iter(c['compiledFiles']))),lambda c:c['driverFiles'].pop('scripts/bochs-cpu3-native-paged-pagefault/driver-build-binding.json'),lambda c:c['driverFiles'].update({'../escape':{'bytes':0,'sha256':'a'*64}}),lambda c:c['staticAuthority'].update(preparedManifestSha256='0'*64),lambda c:c['driverFiles'].pop('scripts/bochs-cpu3-native-paged-pagefault/actual-first-pf-build-prepare.json.gz'),lambda c:c['zipMembers']['paged-pagefault-build-evidence/prepare.json'].update(bytes=2097152)]
  for mutate in mutations:
   c=self.ready();mutate(c)
   with self.assertRaises(ValueError):validate_contract(c)
 def test_current_git_and_dirty_checkout_are_refused(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);(root/'file').write_bytes(b'owned');record={'file':{'bytes':5,'sha256':digest(b'owned')}}
   def git(_, *args):return {'rev-parse':b'fixed\n','status':b'','show':b'owned'}[args[0]]
   with patch('parent.git',side_effect=git):self.assertEqual(checkout(root,'fixed',record),{'file':record['file']['sha256']})
   (root/'file').write_bytes(b'wrong')
   with patch('parent.git',side_effect=git),self.assertRaises(ValueError):checkout(root,'fixed',record)
   (root/'file').write_bytes(b'owned')
   def dirty(_, *args):return b'?? manufactured\n'if args[0]=='status'else git(_, *args)
   with patch('parent.git',side_effect=dirty),self.assertRaises(ValueError):checkout(root,'fixed',record)
 def test_archive_and_lossless_transport_bounds(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d);s=io.BytesIO()
   with zipfile.ZipFile(s,'w')as z:z.writestr('file',b'owned')
   raw=s.getvalue();(p/'a.zip').write_bytes(raw);expect={'file':{'bytes':5,'sha256':digest(b'owned')}}
   self.assertEqual(zip_members(p/'a.zip',expect,digest(raw),len(raw)),{'file':b'owned'})
   expect['file']['sha256']='0'*64
   with self.assertRaises(ValueError):zip_members(p/'a.zip',expect,digest(raw),len(raw))
   raw=json.dumps({'status':'PASS','progress':{'n':57,'q':56,'faults':1},'boundaries':[{'native':list(range(166))}]}).encode();packed=gzip.compress(raw)
   outcome={'schema':'bw.paged-int-iret.evidence-outcome.v1','status':'PASS','parityStatus':'PASS','bodyComplete':True,'primaryError':None,'persistenceError':None,'progress':{'n':57,'q':56,'faults':1},'body':{'filename':'capture.json.gz','decodedBytes':len(raw),'storedBytes':len(packed),'decodedSha256':digest(raw),'storedSha256':digest(packed),'encoding':'gzip-single-member-json','decodedCap':DECODED_CAP,'storedCap':STORED_CAP}}
   (p/'capture.json.gz').write_bytes(packed);(p/'outcome.json').write_text(json.dumps(outcome));capture,actual=read_capture(p);self.assertEqual(actual,outcome);self.assertEqual(capture,json.loads(raw))
   for broken in [packed+b'\0',packed+gzip.compress(b'{}'),packed[:-1]]:
    (p/'capture.json.gz').write_bytes(broken);outcome['body'].update(storedBytes=len(broken),storedSha256=digest(broken));(p/'outcome.json').write_text(json.dumps(outcome))
    with self.assertRaises(ValueError):read_capture(p)
   outcome.update(status='FAIL',bodyComplete=False,primaryError={'text':'original divergence'});(p/'outcome.json').write_text(json.dumps(outcome));self.assertEqual(read_outcome(p)['primaryError']['text'],'original divergence')
   with self.assertRaises(ValueError):read_capture(p)
 def test_final_auth_and_spawn_refusal_keep_first_error(self):
  a={'files':{'a':'hash'},'head':'fixed'};b={'artifact':'hash'}
  report={'status':'PASS'};self.assertTrue(finalize(report,a,copy.deepcopy(a),b,copy.deepcopy(b)))
  for after,artifacts,error in [({'head':'changed'},b,None),(a,{'artifact':'changed'},None),(None,None,ValueError('partial unavailable'))]:
   report={'status':'PASS','error':'original divergence'};self.assertFalse(finalize(report,a,after,b,artifacts,error));self.assertEqual(report['status'],'FAIL');self.assertEqual(report['error'],'original divergence')
  with tempfile.TemporaryDirectory()as d,patch('parent.OUT',Path(d)),patch('parent.subprocess.Popen',side_effect=OSError('manufactured spawn refusal')),patch('parent.memory_events',return_value={'available':False}):
   launch=Mock()
   with self.assertRaisesRegex(OSError,'spawn refusal'):bounded(['manufactured-not-executed'],Path(d),'refused',on_launch=launch)
   launch.assert_not_called();raw=json.loads((Path(d)/'refused.exit.json').read_text());self.assertIsNone(raw['pid']);self.assertIsNone(raw['exitCode'])
if __name__=='__main__':unittest.main(verbosity=2)
