"""Pure manufactured controls: no subprocess, namespaces, signals or real /proc."""
import array,errno,importlib.util,os,select,socket,struct,unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace as Row
from unittest.mock import patch
HERE=Path(__file__).parent
sp=importlib.util.spec_from_file_location('outer_boundary',HERE/'boundary.py');b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)
class T(unittest.TestCase):
 def test_actual_is_unsealed_without_host_operation(self):
  with patch.object(b.subprocess,'Popen')as process:
   with self.assertRaises(b.Refusal):b.actual()
   process.assert_not_called();self.assertIsNone(b.HOSTED_SEAL)
 def test_hosted_refuses_local_and_unknown_case_before_tools(self):
  with patch.object(b,'identities')as tools,patch.object(b.os,'geteuid',return_value=1000):
   for case in ('success','unknown',True):
    with self.assertRaises(b.Refusal):b.hosted_case(case)
   tools.assert_not_called()
 def test_partial_prefix_preserved_on_cap_refusal(self):
  target=bytearray(b'a'*(b.CAP-2))
  with self.assertRaises(b.Refusal):b.append_prefix(target,b'bcdef')
  self.assertEqual(len(target),b.CAP);self.assertTrue(target.endswith(b'bc'))
 def test_raw_partial_is_not_normalized(self):
  target=bytearray();b.append_prefix(target,b'original\0\xff\r\n');self.assertEqual(target,b'original\0\xff\r\n')
 def test_output_foreign_type_refuses_without_conversion(self):
  class Foreign:
   def __bytes__(self):raise AssertionError('foreign')
  with self.assertRaises(b.Refusal):b.append_prefix(bytearray(),Foreign())
 def test_census_is_exact_namespace_and_races_only(self):
  class Entries:
   def __enter__(self):return iter([Row(name='123'),Row(name='124'),Row(name='self')])
   def __exit__(self,*args):pass
  with patch.object(b.os,'scandir',return_value=Entries()),patch.object(b.os,'stat',side_effect=[Row(st_dev=1,st_ino=2),FileNotFoundError(errno.ENOENT,'gone'),FileNotFoundError(errno.ENOENT,'gone')]):self.assertEqual(b.census((1,2)),1)
 def test_census_permission_and_cap_are_uncertain(self):
  class Entries:
   def __enter__(self):return iter([Row(name='123')])
   def __exit__(self,*args):pass
  with patch.object(b.os,'scandir',return_value=Entries()),patch.object(b.os,'stat',side_effect=PermissionError(errno.EACCES,'private')):
   with self.assertRaises(b.Refusal)as caught:b.census((1,2))
   self.assertEqual(str(caught.exception),'proc-uncertain')
  with patch.object(b.os,'scandir',return_value=Entries()),patch.object(b,'PROC_CAP',0),patch.object(b.os,'stat')as lookup:
   with self.assertRaises(b.Refusal):b.census((1,2))
   lookup.assert_not_called()
 def test_handshake_bad_shape_closes_returned_handles_once(self):
  channel=Row(recvmsg=lambda*a:(b'wrong',[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',(41,42)).tobytes())],0,None))
  with patch.object(b.os,'close')as close,patch.object(b,'admit_handles')as admit:
   with self.assertRaises(b.Refusal):b.receive_handles(channel)
   self.assertEqual(close.call_args_list,[unittest.mock.call(41),unittest.mock.call(42)]);admit.assert_not_called()
 def test_handshake_admission_before_ack_and_truncation_refuses(self):
  marks=[]
  channel=Row(recvmsg=lambda*a:(b'outer-fixture-v1\n',[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',(41,42)).tobytes()),(socket.SOL_SOCKET,socket.SCM_CREDENTIALS,struct.pack('3i',123,0,0))],0,None),sendall=lambda x:marks.append(('ack',x)))
  with patch.object(b,'admit_handles',side_effect=lambda*a:marks.append(('admit',a))or(1,2)):
   self.assertEqual(b.receive_handles(channel),((41,42),(1,2)));self.assertEqual(marks[0][0],'admit')
  channel.recvmsg=lambda*a:(b'outer-fixture-v1\n',[],socket.MSG_CTRUNC,None)
  with self.assertRaises(b.Refusal):b.receive_handles(channel)
 def test_pidfd_invalid_is_not_terminal_success(self):
  class Poll:
   def register(self,*args):pass
   def poll(self,*args):return[(41,select.POLLNVAL)]
  with patch.object(b.select,'poll',return_value=Poll()):
   with self.assertRaises(b.Refusal):b.pidfd_terminal(41)
 def test_owned_namespace_and_pid1_join_required(self):
  with patch.object(b.os,'fstat',return_value=Row(st_dev=1,st_ino=2)),patch.object(b.os,'stat',side_effect=[Row(st_dev=1,st_ino=3),Row(st_dev=1,st_ino=2)]),patch.object(b.fcntl,'ioctl',return_value=0x20000000),patch.object(b.os,'readlink',return_value='anon_inode:[pidfd]'),patch.object(b,'read_regular_fdinfo',return_value='Pid:\t123\nNSpid:\t123\t1\n'),patch.object(b,'pidfd_terminal',return_value=False):self.assertEqual(b.admit_handles(41,42,(123,0,0)),(1,2))
  with patch.object(b.os,'fstat',return_value=Row(st_dev=1,st_ino=2)),patch.object(b.os,'stat',return_value=Row(st_dev=1,st_ino=2)),patch.object(b.fcntl,'ioctl',return_value=0x20000000),patch.object(b.os,'readlink',return_value='anon_inode:[pidfd]'):
   with self.assertRaises(b.Refusal):b.admit_handles(41,42,(123,0,0))
 def test_census_existing_zombie_is_uncertain(self):
  class Entries:
   def __enter__(self):return iter([Row(name='123')])
   def __exit__(self,*args):pass
  with patch.object(b.os,'scandir',return_value=Entries()),patch.object(b.os,'stat',side_effect=[FileNotFoundError(errno.ENOENT,'missing ns'),Row()]):
   with self.assertRaises(b.Refusal)as caught:b.census((1,2))
   self.assertEqual(str(caught.exception),'proc-uncertain')
 def test_later_fd_chunk_closes_despite_unknown_ancillary(self):
  channel=Row(recvmsg=lambda*a:(b'bad',[(0,0,b''),(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',(41,42)).tobytes())],0,None))
  with patch.object(b.os,'close')as close:
   with self.assertRaises(b.Refusal):b.receive_handles(channel)
   self.assertEqual(close.call_count,2)
 def test_namespace_type_and_sender_are_closed(self):
  with patch.object(b.fcntl,'ioctl',return_value=0):
   with self.assertRaises(b.Refusal):b.admit_handles(41,42,(123,0,0))
  with patch.object(b.fcntl,'ioctl',return_value=0x20000000),patch.object(b.os,'readlink',return_value='anon_inode:[pidfd]'),patch.object(b.os,'fstat',return_value=Row(st_dev=1,st_ino=2)),patch.object(b.os,'stat',return_value=Row(st_dev=1,st_ino=3)),patch.object(b,'read_regular_fdinfo',return_value='Pid:\t123\nNSpid:\t123 1\n'):
   with self.assertRaises(b.Refusal):b.admit_handles(41,42,(124,0,0))
 def mocked_host(self,cleanup_error=False,setup_error=False):
  class Endpoint:
   def __init__(self,fd):self.fd=fd;self.closes=0
   def fileno(self):return self.fd
   def close(self):self.closes+=1
   def setsockopt(self,*args):
    if setup_error:raise RuntimeError('setup original')
   def setblocking(self,*args):pass
   def recv(self,*args):return b'x'
  left=Endpoint(31);right=Endpoint(32);stdout=Endpoint(33);stderr=Endpoint(34)
  class Selector:
   def __init__(self):self.rows={}
   def register(self,fd,event,data):self.rows[fd]=Row(fileobj=fd,data=data)
   def unregister(self,fd):del self.rows[fd]
   def get_map(self):return self.rows
   def select(self,*args):return[(row,1)for row in list(self.rows.values())]
   def close(self):
    if cleanup_error:raise RuntimeError('cleanup original')
  process=Row(stdout=stdout,stderr=stderr,wait=lambda**kwargs:0)
  launches=[]
  def launch(*args,**kwargs):launches.append((args,kwargs));return process
  once=[]
  def read(fd,cap):
   if fd==33 and not once:once.append(True);return b'fixture-success\n'
   return b''
  paths=('/usr/bin/timeout','/usr/bin/unshare','/usr/bin/python3','fixture.py','boundary.py','hosted-controls.py');pins=((1,'0'*64),)*6
  with ExitStack()as stack:
   for obj,name,value in ((b.os,'geteuid',lambda:0),(b,'identities',lambda:(paths,pins)),(b.socket,'socketpair',lambda*a:(left,right)),(b.subprocess,'Popen',launch),(b.selectors,'DefaultSelector',Selector),(b.os,'set_blocking',lambda*a:None),(b.os,'read',read),(b,'receive_handles',lambda*a:((41,42),(1,2))),(b,'pidfd_terminal',lambda*a:True),(b,'census',lambda*a:0),(b.os,'close',lambda*a:None)):
    stack.enter_context(patch.object(obj,name,value))
   stack.enter_context(patch.dict(b.os.environ,{'GITHUB_ACTIONS':'true'}))
   result=b.hosted_case('success')
  self.assertEqual(left.closes,1);self.assertEqual(right.closes,1)
  self.last_launch=launches
  return result
 def test_full_host_flow_is_mocked_and_keeps_raw_output(self):
  result=self.mocked_host();self.assertTrue(result['controlPassed']);self.assertTrue(result['namespaceEmptyObserved']);self.assertEqual(result['stdout'],b'fixture-success\n');self.assertFalse(result['actualQualified'])
 def test_setup_and_cleanup_uncertainty_never_success(self):
  result=self.mocked_host(cleanup_error=True);self.assertFalse(result['controlPassed']);self.assertEqual(result['firstFailure'],'cleanup-uncertain');self.assertEqual(result['cleanupRefused'],1)
  result=self.mocked_host(setup_error=True);self.assertFalse(result['controlPassed']);self.assertEqual(result['firstFailure'],'host-operation-refusal');self.assertFalse(result['namespaceEmptyObserved'])
 def test_direct_signal_and_shell_status_are_distinct(self):
  self.assertEqual(b.exit_signal(-9),(None,9));self.assertEqual(b.exit_signal(137),(137,None))
  with self.assertRaises(b.Refusal):b.exit_signal(True)
  with self.assertRaises(b.Refusal):b.exit_signal(256)
 def test_fixed_root_command_and_no_caller_factory(self):
  self.mocked_host();args,kwargs=self.last_launch[0]
  self.assertEqual(args,(('/usr/bin/timeout','--signal=KILL','5s','/usr/bin/unshare','--pid','--fork','--mount-proc','--kill-child=KILL','--','/usr/bin/python3','-I','-B','fixture.py','success','32'),))
  self.assertEqual(kwargs['env'],{'PATH':'/usr/bin:/bin','LC_ALL':'C','HOME':'/nonexistent'})
  self.assertEqual(kwargs['pass_fds'],(32,));self.assertIs(kwargs['start_new_session'],True)
  self.assertEqual(kwargs['stdin'],b.subprocess.DEVNULL)
  with self.assertRaises(TypeError):b.hosted_case('success',command=['foreign'])
 def test_diagnostic_keeps_bounded_primitive_original_reason(self):
  result=self.mocked_host(setup_error=True)
  self.assertIn(b'setup original',result['diagnostic']);self.assertIn(b'RuntimeError',result['diagnostic'])
  self.assertLessEqual(len(b.error_diagnostic(OSError(13,'x'*10000))),2048)
if __name__=='__main__':unittest.main()
