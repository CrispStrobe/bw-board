import importlib.util,unittest,tempfile,json,os,errno
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('packet',Path(__file__).with_name('packet.py'));m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def raw(v):return (json.dumps(v,sort_keys=True)+'\n').encode()
def event():return {**m.EVENT_FIXED,'pr':530,'head':'a'*40,'base':'b'*40,'run':123,'attempt':1}
def partial():return {'event.json':raw(event()),'status.txt':b'phase=event\nexit=1\n'}
class T(unittest.TestCase):
 def test_partial(self):
  with tempfile.TemporaryDirectory() as d:
   s=m.Packet(d).write(partial());self.assertEqual(s['fileAttempts'],2);self.assertEqual(set(os.listdir(d)),set(partial()));self.assertFalse(s['originalPacketQualified'])
 def test_status_only(self):
  with tempfile.TemporaryDirectory() as d:self.assertEqual(m.Packet(d).write({'status.txt':b'phase=entry\nexit=1\n'})['fileAttempts'],1)
 def test_complete_missing_refused(self):
  v=partial();v['status.txt']=b'phase=complete\nexit=0\n'
  with self.assertRaises(m.Refusal):m.admit(v)
 def test_duplicate_json(self):
  with self.assertRaises(m.Refusal):m.load(b'{"a":1,"a":2}',100)
 def test_numbers(self):
  for v in (b'{"x":NaN}',b'{"x":1.0}'):
   with self.assertRaises(m.Refusal):m.load(v,100)
 def test_event(self):
  for key,val in [('attempt',True),('action','synchronize'),('headRepository','foreign/repo'),('authenticatedContextQualified',True),('head','z'*40)]:
   v=event();v[key]=val
   with self.assertRaises(m.Refusal):m.event(raw(v))
 def test_event_extra(self):
  v=event();v['extra']=0
  with self.assertRaises(m.Refusal):m.event(raw(v))
 def test_status(self):
  for v in (b'phase=event\nexit=0\n',b'phase=complete\nexit=1\n',b'phase=event\nexit=01\n',b'phase=event\nexit=256\n',b'phase=event\nexit=1'):
   with self.assertRaises(m.Refusal):m.status(v)
 def test_caps(self):
  v=partial();v['event.json']=b'x'*4097
  with self.assertRaises(m.Refusal):m.admit(v)
 def test_stage_extra(self):
  v=partial();v['report.json']=b'{}'
  with self.assertRaises(m.Refusal):m.admit(v)
 def test_log_pair(self):
  v=partial();v['status.txt']=b'phase=execution\nexit=1\n';v['source-before.json']=raw({'schema':'bw.full-tree-actual-source.v1','phase':'before','head':'a'*40,'roleCount':14,'roles':{str(i):{} for i in range(14)}});v['run.stdout']=b'count=1\n'
  with self.assertRaises(m.Refusal):m.admit(v)
 def test_hidden_log_separators(self):
  for separator in (b'\x0b',b'\x0c',b'\x1c',b'\r',b'\t'):
   v={'event.json':raw(event()),'source-before.json':raw({'schema':'bw.full-tree-actual-source.v1','phase':'before','head':'a'*40,'roleCount':14,'roles':{'scripts/unit/role%d.py'%i:{'bytes':1,'sha256':'0'*64} for i in range(14)}}),'status.txt':b'phase=execution\nexit=1\n','run.stdout':separator+b'\n','run.stderr':b''}
   with self.assertRaises(m.Refusal):m.admit(v)
 def test_complete_nine_serialization_only(self):
  before={'schema':'bw.full-tree-actual-source.v1','phase':'before','head':'a'*40,'roleCount':14,'roles':{'scripts/unit/role%d.py'%i:{'bytes':1,'sha256':'0'*64} for i in range(14)}};after={**before,'phase':'after'}
  # This serializer test deliberately supplies no semantic/source authority.
  report={k:False for k in m.REPORT_FLAGS};report.update(schema='bw.full-tree-actual-report.v1',boundary='FINITE_REPORTED_FULL_TREE_AND_SELECTED_NOTICE_CONSISTENCY',complete=True,phase='complete',stoppedPhase=None,parentDepth=3,firstFailure=None,secondaryFailure=None,inputs=[],coordinator=None,sourceBefore=before,sourceAfter=after,responseCloseAttempted=0,responseCloseRefused=0,coordinatorCloseAttempted=0,coordinatorCloseRefused=0,sourceAfterQualified=True,resources={})
  v={'event.json':raw(event()),'source-before.json':raw(before),'source-after.json':raw(after),'report.json':raw(report),'status.txt':b'phase=complete\nexit=0\n','control.stdout':b'count=35\n','control.stderr':b'','run.stdout':b'complete=true\n','run.stderr':b''}
  with tempfile.TemporaryDirectory() as d:
   s=m.Packet(d).write(v);self.assertEqual(s['fileAttempts'],9);self.assertFalse(s['assembly']['profileSourceAdmissionQualified']);self.assertFalse(s['assembly']['controlTranscriptQualified'])
 def test_negative_preserves_historical_complete_report(self):
  before={'schema':'bw.full-tree-actual-source.v1','phase':'before','head':'a'*40,'roleCount':14,'roles':{'scripts/unit/role%d.py'%i:{'bytes':1,'sha256':'0'*64} for i in range(14)}};after={**before,'phase':'after'}
  report={k:False for k in m.REPORT_FLAGS};report.update(schema='bw.full-tree-actual-report.v1',boundary='FINITE_REPORTED_FULL_TREE_AND_SELECTED_NOTICE_CONSISTENCY',complete=True,phase='complete',stoppedPhase=None,parentDepth=3,firstFailure=None,secondaryFailure=None,inputs=[],coordinator=None,sourceBefore=before,sourceAfter=after,responseCloseAttempted=0,responseCloseRefused=0,coordinatorCloseAttempted=0,coordinatorCloseRefused=0,sourceAfterQualified=True,resources={})
  v={'event.json':raw(event()),'source-before.json':raw(before),'source-after.json':raw(after),'report.json':raw(report),'status.txt':b'phase=source-after\nexit=1\n'}
  with tempfile.TemporaryDirectory() as d:
   s=m.Packet(d).write(v);self.assertFalse(s['originalPacketQualified']);self.assertEqual(Path(d,'report.json').read_bytes(),raw(report));self.assertEqual(s['assembly']['exit'],1)
 def test_no_null_report(self):
  v={'event.json':raw(event()),'source-before.json':raw({'schema':'bw.full-tree-actual-source.v1','phase':'before','head':'a'*40,'roleCount':14,'roles':{'scripts/unit/role%d.py'%i:{'bytes':1,'sha256':'0'*64} for i in range(14)}}),'status.txt':b'phase=execution\nexit=1\n','report.json':b'null'}
  with self.assertRaises(m.Refusal):m.admit(v)
 def test_foreign_custom_mapping(self):
  class D(dict):pass
  with self.assertRaises(m.Refusal):m.admit(D(partial()))
 def test_symlink_destination(self):
  with tempfile.TemporaryDirectory() as d:
   os.mkdir(d+'/real');os.symlink('real',d+'/alias')
   with self.assertRaises(m.Refusal):m.Packet(d+'/alias').write(partial())
 def test_existing_extra_preserved(self):
  with tempfile.TemporaryDirectory() as d:
   Path(d,'foreign').write_bytes(b'keep')
   with self.assertRaises(m.Refusal):m.Packet(d).write(partial())
   self.assertEqual(Path(d,'foreign').read_bytes(),b'keep');self.assertFalse(Path(d,'event.json').exists())
 def test_mutated_caller_mapping_not_used(self):
  with tempfile.TemporaryDirectory() as d:
   v=partial();original=os.open;once=[False]
   def opened(*a,**kw):
    fd=original(*a,**kw)
    if not once[0]:once[0]=True;v['status.txt']=object();v['event.json']=b'x'*10000
    return fd
   with patch.object(m.os,'open',new=opened):s=m.Packet(d).write(v)
   self.assertEqual(s['fileAttempts'],2);self.assertEqual(Path(d,'status.txt').read_bytes(),b'phase=event\nexit=1\n')
 def test_open_reentry_closes_returned_fd(self):
  with tempfile.TemporaryDirectory() as d:
   p=m.Packet(d);original=os.open;returned=[]
   def opened(*a,**kw):
    fd=original(*a,**kw);returned.append(fd);p.status();return fd
   with patch.object(m.os,'open',new=opened):
    with self.assertRaises(m.Refusal):p.write(partial())
   self.assertEqual(len(returned),1)
   with self.assertRaises(OSError) as c:os.fstat(returned[0])
   self.assertEqual(c.exception.errno,errno.EBADF);self.assertEqual(p.first,'packet-reentry')
 def test_directory_cleanup_reentry_refuses_after_complete_writes(self):
  import stat
  with tempfile.TemporaryDirectory() as d:
   p=m.Packet(d);original=os.close;calls=[0]
   def close(fd):
    directory=stat.S_ISDIR(os.fstat(fd).st_mode);original(fd);calls[0]+=1
    if directory:p.status()
   p.close_fn=close
   with self.assertRaises(m.Refusal) as c:p.write(partial())
   self.assertEqual(str(c.exception),'packet-reentry');self.assertEqual(p.phase,'refused');self.assertEqual(p.status()['ownedDescriptors'],0);self.assertEqual(p.status()['fileAttempts'],2);self.assertGreater(calls[0],2)
 def test_primary_survives_output_close(self):
  with tempfile.TemporaryDirectory() as d:
   primary=OSError('private');original=os.close;p=m.Packet(d);count=[0]
   def close(fd):
    count[0]+=1;original(fd)
    if count[0]==1:raise ValueError('private-cleanup')
   p.close_fn=close
   with patch.object(m.os,'write',side_effect=primary):
    with self.assertRaises(OSError) as c:p.write(partial())
   self.assertIs(c.exception,primary);self.assertEqual(p.first,'filesystem-refused');self.assertEqual(p.close_refused,1)
 def test_readback_mutation(self):
  with tempfile.TemporaryDirectory() as d:
   original=os.write
   def write(fd,b):
    n=original(fd,b);os.pwrite(fd,b'X',0);return n
   with patch.object(m.os,'write',new=write):
    with self.assertRaises(m.Refusal):m.Packet(d).write(partial())
   self.assertTrue(Path(d,'event.json').exists())
 def test_final_extra_refused(self):
  with tempfile.TemporaryDirectory() as d:
   original=os.write;once=[False]
   def write(fd,b):
    n=original(fd,b)
    if not once[0]:once[0]=True;Path(d,'foreign').write_bytes(b'keep')
    return n
   with patch.object(m.os,'write',new=write):
    with self.assertRaises(m.Refusal):m.Packet(d).write(partial())
   self.assertTrue(Path(d,'foreign').exists())
 def test_once(self):
  with tempfile.TemporaryDirectory() as d:
   p=m.Packet(d);p.write(partial())
   with patch.object(m.os,'open') as o:
    with self.assertRaises(m.Refusal):p.write(partial())
    o.assert_not_called()
if __name__=='__main__':unittest.main()
