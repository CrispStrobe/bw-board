"""Fixed hosted namespace fixture. No arbitrary command or input program."""
import array,os,socket,sys,time
CASES=('success','startup-stall','detached-sleeper','partial-stderr','setup-refusal')
def main():
 if len(sys.argv)!=3 or sys.argv[1]not in CASES:raise SystemExit(2)
 case=sys.argv[1];fd=int(sys.argv[2]);channel=socket.socket(fileno=fd)
 if os.getpid()!=1:raise SystemExit(3)
 if case=='setup-refusal':
  os.write(2,b'fixture-setup-refusal\n');raise SystemExit(4)
 ns=os.open('/proc/self/ns/pid',os.O_RDONLY);pidfd=os.pidfd_open(1)
 try:
  channel.sendmsg([b'outer-fixture-v1\n'],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',(ns,pidfd)))])
  if channel.recv(4)!=b'ACK\n':raise SystemExit(5)
 finally:os.close(ns);os.close(pidfd);channel.close()
 if case=='success':os.write(1,b'fixture-success\n');return
 if case=='detached-sleeper':
  child=os.fork()
  if child==0:
   os.setsid();os.write(2,b'fixture-detached\n')
   while True:time.sleep(60)
  os.write(1,b'fixture-parent\n')
 elif case=='partial-stderr':os.write(2,b'fixture-partial-original\x00\xff\n')
 else:os.write(1,b'fixture-startup-stall\n')
 while True:time.sleep(60)
if __name__=='__main__':main()
