"""Two owned offline cases crosswire the producer and independent reader.

Only this orchestrator imports producer controls. Reader and pure reader controls
never import them. No archive, network, compiler, CPU, or guest is executed.
"""
import importlib.util,os,stat,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
HERE=Path(__file__).parent

def module(name,filename):
 spec=importlib.util.spec_from_file_location(name,HERE/filename)
 value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

reader=module('independent_integration_reader','reader.py')
producer_controls=module('manufactured_integration_producer_controls','controls.py')

def observed_bytes(path,cap):
 before=path.lstat()
 if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or before.st_size>cap:raise AssertionError('fixture file shape')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);primary=None;body=None
 try:
  opened=os.fstat(fd)
  if (before.st_dev,before.st_ino,before.st_size)!=(opened.st_dev,opened.st_ino,opened.st_size):raise AssertionError('fixture file identity')
  chunks=[];extent=0
  while True:
   requested=min(65536,cap+1-extent);chunk=os.read(fd,requested)
   if type(chunk)is not bytes or len(chunk)>requested:raise AssertionError('fixture read shape')
   if not chunk:break
   extent+=len(chunk)
   if extent>cap:raise AssertionError('fixture read cap')
   chunks.append(chunk)
  body=b''.join(chunks);end=os.fstat(fd);named=path.lstat()
  if len(body)!=before.st_size or len(body)>cap or not((before.st_dev,before.st_ino,before.st_size)==(end.st_dev,end.st_ino,end.st_size)==(named.st_dev,named.st_ino,named.st_size)):raise AssertionError('fixture read extent')
  if not stat.S_ISREG(named.st_mode)or end.st_nlink!=1 or named.st_nlink!=1:raise AssertionError('fixture file shape')
 except BaseException as error:primary=error
 finally:
  try:os.close(fd)
  except BaseException as error:
   if primary is None:primary=error
 if primary is not None:raise primary
 return body

class Integration(unittest.TestCase):
 def whole_path(self,case):
  fixture=producer_controls.T('test_integrated_success_honest_negative_actual_packet');primary=None;root=None
  try:
   fixture.setUp()
   owner=fixture.owner();receipt=owner.offline(case);root=Path(owner._output)
   stdout=observed_bytes(root/'raw-child.stdout',8192);stderr=observed_bytes(root/'raw-child.stderr',8192)
   members={name:observed_bytes(root/'packet'/name,cap)for name,cap in reader.PACKET_CAPS.items()}
   held=observed_bytes(HERE/'inherited-roles.json',65536)
   result=reader.validate_supervisor(reader.canonical(receipt),fixture.araw,fixture.draw,fixture.traw,held,stdout,stderr,members)
   self.assertEqual(result['offlineReportedConsistency'],case=='success')
   self.assertEqual(receipt['offlineControlPassed'],case=='success')
   self.assertEqual(result['firstFailure'],None if case=='success'else'manufactured-midstage-refusal')
   self.assertTrue(receipt['execution']['rawLogsComplete']);self.assertEqual(receipt['cleanupRefused'],0)
   self.assertEqual(receipt['execution']['exit'],0 if case=='success'else 7)
   self.assertEqual(members['status.txt'],b'phase=source-after\nexit=1\n')
   for flag in ('actualAcquisitionQualified','officialContextQualified','officialJobQualified','sourceOwnedQualified','filesystemLeaseQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified'):self.assertIs(result[flag],False)
  except BaseException as error:primary=error
  finally:
   try:
    owned=[Path(o._output)for o in getattr(fixture,'outputs',())if o._output is not None]
    temp=getattr(fixture,'temp',None)
    cleaned=fixture.doCleanups()
    if not cleaned or(temp is not None and Path(temp.name).exists())or any(p.exists()for p in owned)or(root is not None and root.exists()):raise AssertionError('owned fixture cleanup')
   except BaseException as error:
    if primary is None:primary=error
  if primary is not None:raise primary
 def test_partial_setup_cleanup_preserves_original_error(self):
  original=RuntimeError('manufactured setup refusal')
  class Partial(unittest.TestCase):
   def setUp(self):
    self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
    raise original
  fixture=Partial()
  with patch.object(producer_controls,'T',return_value=fixture):
   with self.assertRaises(RuntimeError)as caught:self.whole_path('success')
  self.assertIs(caught.exception,original);self.assertFalse(Path(fixture.temp.name).exists())
 def test_success_is_offline_only_and_acquisition_packet_refuses(self):self.whole_path('success')
 def test_midstage_keeps_raw_refusal_and_no_offline_success(self):self.whole_path('midstage-refusal')

if __name__=='__main__':unittest.main()
