"""Manufactured filesystem/lifecycle controls; no root, recorder or guest calls."""
import sys
sys.dont_write_bytecode=True
import os,json,tempfile,hashlib,importlib.util,socket,io
from pathlib import Path
from unittest import TestCase,main
from unittest.mock import patch,Mock
import hosted
spec=importlib.util.spec_from_file_location('exporter',Path(__file__).parent/'export-evidence.py');e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
def report():return {'files':{},'skipped':[],'cleanupGate':{},'streamedBytes':0,'entryCount':0,'ordinaryOwnerUid':os.getuid()}
class ExportControls(TestCase):
 def setUp(self):
  p=patch.object(e.subprocess,'Popen',side_effect=AssertionError('real program forbidden'));p.start();self.addCleanup(p.stop)
 def copy(self,source,dest,r):
  a=e.open_directory(source);b=e.open_directory(dest)
  try:e.copy_tree(a,b,e.OUT.name,r)
  finally:os.close(a);os.close(b)
 def test_regular_copy_preserves_original_and_partial_refusal(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);source=root/'source';dest=root/'dest';source.mkdir();dest.mkdir();f=source/'a-good';f.write_bytes(b'actual manufactured bytes');f.chmod(0o400);before=e.identity(f.stat());(source/'z-symlink').symlink_to('/etc/passwd');r=report()
   with self.assertRaisesRegex(ValueError,'regular single-link'):self.copy(source,dest,r)
   self.assertEqual((dest/'a-good').read_bytes(),f.read_bytes());self.assertEqual(e.identity(f.stat()),before);self.assertEqual((dest/'a-good').stat().st_mode&0o777,0o644);self.assertTrue(r['files'][e.OUT.name+'/a-good']['complete']);self.assertEqual(r['files'][e.OUT.name+'/a-good']['sha256'],hashlib.sha256(f.read_bytes()).hexdigest());self.assertFalse((dest/'z-symlink').exists())
 def test_special_hardlink_bounds_and_changed_source_refused(self):
  for kind in ('fifo','hardlink','socket','size','mutation'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as t:
    root=Path(t);source=root/'source';dest=root/'dest';source.mkdir();dest.mkdir();f=source/'evidence';sock=None
    if kind=='fifo':os.mkfifo(f)
    elif kind=='socket':sock=socket.socket(socket.AF_UNIX);sock.bind(str(f))
    elif kind=='hardlink':f.write_bytes(b'one');os.link(f,source/'second')
    else:f.write_bytes(b'one')
    r=report();read=e.os.read
    def mutate(fd,n):
     data=read(fd,n)
     if data:f.write_bytes(b'changed')
     return data
    try:
     with patch.object(e,'MAX_MEMBER',2 if kind=='size' else 64<<20),patch.object(e.os,'read',side_effect=mutate if kind=='mutation' else read):
      with self.assertRaisesRegex(ValueError,'regular single-link|bounded export member|source unchanged'):self.copy(source,dest,r)
     if kind=='mutation':self.assertFalse(r['files'][e.OUT.name+'/evidence']['complete']);self.assertIn('error',r['files'][e.OUT.name+'/evidence'])
    finally:
     if sock:sock.close()
 def test_exact_socket_exception_and_directory_nofollow(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);source=root/'source';dest=root/'dest';source.mkdir();dest.mkdir();sock=socket.socket(socket.AF_UNIX);sock.bind(str(source/'control.sock'))
   try:
    r=report();self.copy(source,dest,r);self.assertEqual(len(r['skipped']),1);self.assertEqual(r['files'],{})
    (root/'alias').symlink_to(source,target_is_directory=True)
    with self.assertRaises(OSError):e.open_directory(root/'alias')
   finally:sock.close()
 def test_cleanup_gate_requires_reaped_absent_groups_and_no_active_users(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);child=p/'observer-child';child.mkdir();(child/'exit.json').write_text(json.dumps({'pid':321,'rawWaitStatus':256}));fd=e.open_directory(p)
   try:
    for groups,users,message in [({321},[],'still active'),(set(),[{'pid':7}],'active evidence user')]:
     r=report()
     with patch.object(e,'live_process_evidence',return_value=(groups,users)):
      with self.assertRaisesRegex(ValueError,message):e.cleanup_gate(fd,r)
    r=report()
    with patch.object(e,'live_process_evidence',return_value=(set(),[])):e.cleanup_gate(fd,r)
    self.assertTrue(r['cleanupGate']['observer-child']['reaped']);self.assertTrue(r['cleanupGate']['observer-child']['groupAbsent'])
    (child/'exit.json').write_text(json.dumps({'pid':321,'rawWaitStatus':None}))
    with patch.object(e,'live_process_evidence',return_value=(set(),[])):
     with self.assertRaisesRegex(ValueError,'reaped'):e.cleanup_gate(fd,report())
   finally:os.close(fd)
 def test_actual_main_partial_manifest_and_cleanup_before_copy(self):
  with tempfile.TemporaryDirectory() as t:
   base=Path(t);(base/'symbol-worker').mkdir();out=base/'out';parent=base/'parent';out.mkdir();parent.mkdir();(out/'a-good').write_bytes(b'retained');(out/'z-bad').symlink_to('/etc/passwd');export=base/'export';order=[]
   def create(fd):os.mkdir(export.name,0o700,dir_fd=fd);return os.open(export.name,e.DIR_FLAGS,dir_fd=fd)
   def gate(fd,r):order.append('cleanup')
   original=e.copy_tree
   def copy(*args,**kwargs):self.assertEqual(order,['cleanup']);return original(*args,**kwargs)
   with patch.object(e,'BASE',base),patch.object(e,'OUT',out),patch.object(e,'PARENT',parent),patch.object(e,'EXPORT',export),patch.object(e,'ROOTS',(out,parent)),patch.object(e,'authenticate_dispatch',return_value={'revision':'manufactured'}),patch.object(e,'create_export',side_effect=create),patch.object(e,'cleanup_gate',side_effect=gate),patch.object(e,'copy_tree',side_effect=copy),patch.object(e.os,'geteuid',return_value=0),patch.object(e.resource,'setrlimit'),patch.object(e.os,'nice'),patch.object(e.signal,'signal'),patch.object(e.signal,'alarm'),patch.object(e,'WS',base),patch.object(e.sys,'argv',['export-evidence.py']):
    with self.assertRaisesRegex(ValueError,'regular single-link'):e.main()
   result=json.loads((export/'export-manifest.json').read_bytes());self.assertEqual(result['status'],'FAIL');self.assertIn('regular single-link',result['error']);self.assertTrue(result['files']['out/a-good']['complete']);self.assertEqual(export.stat().st_mode&0o777,0o755);self.assertEqual((export/'out').stat().st_mode&0o777,0o755);self.assertTrue((out/'z-bad').is_symlink())
 def test_primary_error_log_survives_unreadable_observer_stream(self):
  with patch.object(hosted,'PARENT',Path('/manufactured')),patch.object(hosted.Path,'is_file',return_value=True),patch.object(hosted.Path,'open',side_effect=PermissionError('unreadable original stream')),patch.object(hosted.sys,'stderr',io.StringIO()) as stream:
   error=RuntimeError('original observer failure');hosted.log_primary_failure({'observerChild':{'exitCode':1}},error);value=json.loads(stream.getvalue());self.assertIn('original observer failure',value['primary']);self.assertIn('unreadable',value['stderrReadError']);self.assertEqual(value['observerChild']['exitCode'],1)
if __name__=='__main__':main()
