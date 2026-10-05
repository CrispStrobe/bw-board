"""Manufactured source refusals only. No download, restore or real child."""
import sys
sys.dont_write_bytecode=True
import json,copy,unittest,io,zipfile,tarfile,tempfile
from pathlib import Path
from unittest.mock import patch
from parent import validate_contract,finalize,https_origin,checkout,main,HERE,bounded
from archive import zip_members,tar_members,digest
class Controls(unittest.TestCase):
 def ready(self):
  c=json.loads((HERE/'contract.json').read_text());c['status']='ROOT_REVIEWED_PROTECTED_RAM_SOURCE_READY';return c
 def test_pending_refuses_before_any_download_or_restore(self):
  c=self.ready();c['status']='SOURCE_REVIEW_PENDING'
  with patch('parent.ordinary',return_value=json.dumps(c).encode()),patch('parent.download')as download,patch('parent.exclusive_tree')as restore:
   with self.assertRaisesRegex(ValueError,'reviewed source'):main('enabled')
   download.assert_not_called();restore.assert_not_called()
  with tempfile.TemporaryDirectory()as d,patch('parent.OUT',Path(d)),patch('parent.subprocess.Popen',side_effect=OSError('manufactured spawn refusal')),patch('parent.memory_events',return_value={'available':False}):
   launch=unittest.mock.Mock()
   with self.assertRaisesRegex(OSError,'spawn refusal'):bounded(['manufactured-not-executed'],Path(d),'refused',on_launch=launch)
   launch.assert_not_called();raw=json.loads((Path(d)/'refused.exit.json').read_text());self.assertIsNone(raw['pid']);self.assertIsNone(raw['exitCode']);self.assertIn('spawn refusal',raw['error'])
 def test_fixed_artifact_sources_counts_node_and_addon(self):
  validate_contract(self.ready())
  for change in [lambda c:c.update(enabledByDefault=True),lambda c:c.update(driverRevision='f'*40),lambda c:c.update(driverRevision='e3b363eae9ff7aeb82fe581cf422d6472752d840'),lambda c:c['driverFiles'].pop('test/fixtures/i80386-protected-ram-first-failure-milestones.json'),lambda c:c.update(compiledRevision='e'*40),lambda c:c.update(addonSha256='d'*64),lambda c:c.update(nodeSha256='c'*64),lambda c:c.update(artifactId=1),lambda c:c.update(zipBytes=1),lambda c:c['preparedFiles'].pop(next(iter(c['preparedFiles']))),lambda c:c['driverFiles'].update({'../escape':{'bytes':0,'sha256':'a'*64}})]:
   c=self.ready();change(c)
   with self.assertRaises(ValueError):validate_contract(c)
 def test_https_redirect_origin_domains(self):
  self.assertEqual(https_origin('https://EXAMPLE.com/a'),('example.com',443))
  for url in ['http://example.com','https://x:0','https://user:pass@example.com','https://@example.com','https://x:65536']:
   with self.assertRaises(ValueError):https_origin(url)
 def test_source_current_and_git_are_required(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);(root/'file').write_bytes(b'owned');record={'file':{'bytes':5,'sha256':digest(b'owned')}}
   def git(_, *args):return {'rev-parse':b'fixed\n','status':b'','show':b'owned'}[args[0]]
   with patch('parent.git',side_effect=git):self.assertEqual(checkout(root,'fixed',record),{'file':record['file']['sha256']})
   (root/'file').write_bytes(b'wrong')
   with patch('parent.git',side_effect=git),self.assertRaises(ValueError):checkout(root,'fixed',record)
 def test_authenticated_archive_rejects_unsafe_or_modified_members(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'a.zip';stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w')as z:z.writestr('file',b'owned')
   raw=stream.getvalue();p.write_bytes(raw);expect={'file':{'bytes':5,'sha256':digest(b'owned')}};self.assertEqual(zip_members(p,expect,digest(raw),len(raw)),{'file':b'owned'})
   expect['file']['sha256']='0'*64
   with self.assertRaises(ValueError):zip_members(p,expect,digest(raw),len(raw))
   stream=io.BytesIO()
   with tarfile.open(fileobj=stream,mode='w:gz')as t:
    m=tarfile.TarInfo('../escape');m.size=1;t.addfile(m,io.BytesIO(b'x'))
   with self.assertRaises(ValueError):tar_members(stream.getvalue(),{})
 def test_final_authentication_cannot_leave_pass_on_mutation_or_missing_maps(self):
  a={'files':{'a':'hash'},'head':'fixed'};b={'artifact':'hash'}
  report={'status':'PASS'};self.assertTrue(finalize(report,a,copy.deepcopy(a),b,copy.deepcopy(b)));self.assertEqual(report['status'],'PASS')
  for after,artifacts,error in [({'head':'changed'},b,None),(a,{'artifact':'changed'},None),(None,None,ValueError('partial unavailable'))]:
   report={'status':'PASS','error':'original worker divergence'};self.assertFalse(finalize(report,a,after,b,artifacts,error));self.assertEqual(report['status'],'FAIL');self.assertEqual(report['error'],'original worker divergence');self.assertIn('finalAuthenticationError',report)
if __name__=='__main__':unittest.main(verbosity=2)
