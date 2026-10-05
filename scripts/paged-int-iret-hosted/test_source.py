"""Manufactured source refusals only. No download, restore or real child."""
import sys
sys.dont_write_bytecode=True
import json,copy,unittest,io,zipfile,tarfile,tempfile,gzip
from pathlib import Path
from unittest.mock import patch
from parent import derive_parent,_PARENT,_PARENT_SHA,derive_transport,derive_stack_parent,_HELD_STACK_PARENT,validate_contract,finalize,https_origin,checkout,main,HERE,bounded
from archive import zip_members,tar_members,digest
from evidence import read_capture,read_outcome,DECODED_CAP,STORED_CAP
class Controls(unittest.TestCase):
 def ready(self):
  c=json.loads((HERE/'contract.json').read_text());validate_contract(c);return c
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
  self.assertEqual(digest(_PARENT.read_bytes()),_PARENT_SHA);self.assertIn('compiledCount\':208',derive_parent(_PARENT.read_bytes()))
  with self.assertRaises(AssertionError):derive_parent(b'unknown')
  actual=derive_transport(derive_stack_parent(_HELD_STACK_PARENT.read_bytes()));self.assertIn("capture,worker_outcome=read_capture(OUT/'guest')",actual);self.assertIn("report['workerOutcome']=read_outcome(OUT/'guest')",actual)
  with self.assertRaises(AssertionError):derive_transport('unknown')
  for change in [lambda c:c.update(enabledByDefault=True),lambda c:c.update(driverRevision='f'*40),lambda c:c.update(driverRevision='8df2dd7d6b88648b3fcedb6dd559e0dfc5daeb54'),lambda c:c.update(driverRevision='3f4a65de3cc4f99f62bf8f1d1c632499f3b69dd6'),lambda c:c['driverFiles'].pop('scripts/bochs-cpu3-native-paged-int-iret/evidence.mjs'),lambda c:c['driverFiles'].pop('scripts/bochs-cpu3-native-paged-int-iret/driver-build-binding.json'),lambda c:c.update(compiledRevision='e'*40),lambda c:c.update(addonSha256='d'*64),lambda c:c.update(nodeSha256='c'*64),lambda c:c.update(artifactId=1),lambda c:c.update(zipBytes=1),lambda c:c['preparedFiles'].pop(next(iter(c['preparedFiles']))),lambda c:c['driverFiles'].update({'../escape':{'bytes':0,'sha256':'a'*64}})]:
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
 def body_fixture(self,directory,raw=None,packed=None):
  raw=raw if raw is not None else json.dumps({'status':'PASS','progress':{'n':41,'q':41},'boundaries':[{'native':list(range(166)),'pages':{'manufactured':[0,255]}}]}).encode()
  packed=packed if packed is not None else gzip.compress(raw)
  outcome={'schema':'bw.paged-int-iret.evidence-outcome.v1','status':'PASS','parityStatus':'PASS','bodyComplete':True,'primaryError':None,'persistenceError':None,'progress':{'n':41,'q':41},'body':{'filename':'capture.json.gz','decodedBytes':len(raw),'storedBytes':len(packed),'decodedSha256':digest(raw),'storedSha256':digest(packed),'encoding':'gzip-single-member-json','decodedCap':DECODED_CAP,'storedCap':STORED_CAP}}
  (directory/'capture.json.gz').write_bytes(packed);(directory/'outcome.json').write_text(json.dumps(outcome));return outcome,raw,packed
 def test_capped_lossless_decoder_accepts_complete_body_and_independent_outcome(self):
  with tempfile.TemporaryDirectory()as d:
   out,raw,_=self.body_fixture(Path(d));capture,actual=read_capture(d);self.assertEqual(actual,out);self.assertEqual(capture,json.loads(raw));self.assertEqual(capture['boundaries'][0]['native'],list(range(166)))
 def test_capped_decoder_rejects_trailing_members_truncation_hashes_and_caps(self):
  with tempfile.TemporaryDirectory()as d:
   path=Path(d);out,raw,packed=self.body_fixture(path)
   for malformed in [packed+b'\x00',packed+gzip.compress(b'{}'),packed[:-1]]:
    self.body_fixture(path,raw,malformed)
    with self.assertRaises(ValueError):read_capture(path)
   for mutate in [lambda o:o['body'].update(decodedBytes=DECODED_CAP+1),lambda o:o['body'].update(storedBytes=STORED_CAP+1),lambda o:o['body'].update(storedSha256='0'*64),lambda o:o['body'].update(decodedSha256='0'*64),lambda o:o.update(progress={'n':0,'q':0}),lambda o:o.update(bodyComplete=False),lambda o:o.update(status='FAIL'),lambda o:o['body'].update(filename='../capture.json.gz')]:
    out,_,_=self.body_fixture(path);mutate(out);(path/'outcome.json').write_text(json.dumps(out))
    with self.assertRaises(ValueError):read_capture(path)
 def test_independent_failed_outcome_is_readable_without_bulk_body_or_pass(self):
  with tempfile.TemporaryDirectory()as d:
   path=Path(d);out={'schema':'bw.paged-int-iret.evidence-outcome.v1','status':'FAIL','parityStatus':'FAIL','bodyComplete':False,'primaryError':{'text':'manufactured original divergence','utf8Bytes':31,'sha256':'a'*64,'truncated':False},'persistenceError':{'text':'manufactured storage failure'},'progress':{'n':39,'q':39},'lastNative':{'segments':list(range(90))}}
   (path/'outcome.json').write_text(json.dumps(out));self.assertEqual(read_outcome(path),out)
   with self.assertRaisesRegex(ValueError,'outcome PASS'):read_capture(path)
if __name__=='__main__':unittest.main(verbosity=2)
