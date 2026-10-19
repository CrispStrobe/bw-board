#!/usr/bin/env python3
"""Independent QEMU pc/486 compatibility execution; no target emulator imports."""
import hashlib
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

OLD = Path(__file__).parents[1]/'i80386-dos32a-owned/oracle.py'
PIN = '0e03f3fe484d76e4b7c8479fea79f99328a0fcf6aeba0d29157c817ee9533765'

def helper():
    if hashlib.sha256(OLD.read_bytes()).hexdigest()!=PIN: raise ValueError('QMP helper changed')
    spec=importlib.util.spec_from_file_location('held_qmp',OLD); mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

def run(inp,out):
    h=helper(); out=Path(out); scratch=out/'scratch'; scratch.mkdir()
    initial=h.ordinary(Path(inp['disk']),h.GEOMETRY_BYTES,inp['diskSha256'])
    initial_fat=bytes(initial[9216:30208])
    h.ordinary(Path(inp['floppy']),1228800,h.FLOPPY_SHA)
    if inp['key'] not in ('a','b'): raise ValueError('fixed key')
    disk=out/'disk.raw';disk.write_bytes(initial)
    sock=scratch/'qmp.sock';qemu=inp['qemu']
    for role in ['oracleBios','oracleVga']:
      row=inp[role];h.ordinary(Path(row['path']),row['bytes'],row['sha256'])
    command=[qemu,'-accel','tcg','-machine','pc','-cpu','486','-m','4','-display','none','-nic','none','-bios',inp['oracleBios']['path'],'-vga','none','-device','VGA,romfile='+inp['oracleVga']['path'],'-no-reboot','-boot','order=a',
      '-drive',f"file={inp['floppy']},if=floppy,index=0,format=raw,readonly=on",'-drive',f'file={disk},if=ide,index=0,format=raw,cache=directsync','-qmp',f'unix:{sock},server=on,wait=off']
    report={'schema':'bw.le-key.oracle.v1','key':inp['key'],'profile':'QEMU pc/486 compatibility oracle, independent BIOS/VGA','command':command,'events':[],'screens':[],'firstFailure':None,'initialDiskSha256':h.sha(initial)}
    proc=None;monitor=None;reaped=False;start=time.monotonic();primary=None
    try:
      with (out/'qemu.stdout').open('xb') as stdout,(out/'qemu.stderr').open('xb') as stderr:
        proc=subprocess.Popen(command,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=h.child_limit);report['pid']=proc.pid
        def ensure():
          if time.monotonic()-start>590: raise TimeoutError('QEMU deadline')
          if os.waitid(os.P_PID,proc.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT): raise ValueError('QEMU exited before quit')
          if (out/'qemu.stdout').stat().st_size>1048576 or (out/'qemu.stderr').stat().st_size>1048576: raise ValueError('QEMU stream cap')
        while not sock.exists(): ensure();time.sleep(.05)
        monitor=h.QMP(sock)
        def capture(role=None):
          ensure();lines,raw=monitor.screen(scratch)
          if role:
            name=f'vga-{role}.bin';(out/name).write_bytes(raw)
            from source import regions
            report['screens'].append({'regions':regions(h.ordinary(disk,h.GEOMETRY_BYTES),initial_fat),'role':role,'elapsedNs':int((time.monotonic()-start)*1e9),'file':name,'sha256':h.sha(raw),'rows':lines})
          return lines,raw
        def offer(role,text):
          report['events'].append({'role':role,'elapsedNs':int((time.monotonic()-start)*1e9),'textHex':text.encode('ascii').hex(),'qcodes':h.keys(text)});monitor.send(text);report['events'][-1]['completedElapsedNs']=int((time.monotonic()-start)*1e9)
        declined=False;entered=False
        while True:
          lines,_=capture()
          if h.has_prompt(lines) and declined: capture('boot');break
          if not declined and any('Do you want to proceed' in x for x in lines): offer('decline','n\r');declined=True
          elif not entered and not declined and any('press [ENTER]' in x or 'Select from Menu' in x for x in lines):offer('menu','\r');entered=True
          time.sleep(.25)
        offer('run','c:\\runkey.bat\r')
        while True:
          lines,_=capture()
          if any(x.strip()=='BW-LE-INPUT-READY' for x in lines):capture('ready');break
          time.sleep(.25)
        offer('challenge',inp['key'])
        def observed(): return {k:h.root_file(h.ordinary(disk,h.GEOMETRY_BYTES),n) for k,n in {'result':b'RESULT  BIN','ok':b'KEYOK   TXT','fail':b'KEYFAIL TXT','returned':b'RETURN  TXT'}.items()}
        while True:
          lines,_=capture();f=observed()
          if f['fail'] is not None:raise ValueError('QEMU guest failure')
          if f['result'] is not None and f['ok'] is not None and h.has_prompt(lines):
            if f['returned'] is not None:raise ValueError('preexisting return')
            capture('response');break
          time.sleep(.25)
        offer('verify','c:\\verify.bat\r')
        while True:
          lines,_=capture();f=observed()
          if f['returned'] is not None and h.has_prompt(lines):capture('final');break
          time.sleep(.25)
        try:monitor.call('quit')
        except (EOFError,BrokenPipeError,ValueError,OSError):pass
        # Do not poll()/Popen.wait() reap: one wait4 owns the original status/usage.
        while not os.waitid(os.P_PID,proc.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT):
          if time.monotonic()-start>595:raise TimeoutError('QEMU quit deadline')
          time.sleep(.05)
        from source import group_members
        descendants=any(p!=proc.pid for p in group_members(proc.pid))
        if descendants:os.killpg(proc.pid,signal.SIGKILL)
        pid,status,usage=os.wait4(proc.pid,0);reaped=True;proc.returncode=os.waitstatus_to_exitcode(status)
        report['groupEmpty']=not group_members(proc.pid)
        if descendants or not report['groupEmpty']:raise ValueError('QEMU group not empty at terminal cut')
        report.update(exitCode=os.waitstatus_to_exitcode(status),cpuSeconds=usage.ru_utime+usage.ru_stime,reaped=True)
        if report['exitCode']!=0:raise ValueError('QEMU exit')
        report['files']={k:None if v is None else v.hex() for k,v in observed().items()}
        report['diskSha256']=h.sha(disk.read_bytes())
    except BaseException as error:primary=error;report['firstFailure']=str(error)[:1000]
    finally:
      signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
      if monitor:
        try:monitor.close()
        except Exception as e:
          if primary is None:primary=e;report['firstFailure']=str(e)
      if proc and not reaped:
        try:os.killpg(proc.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        pid,status,usage=os.wait4(proc.pid,0);reaped=True;proc.returncode=os.waitstatus_to_exitcode(status);report['cleanupExitCode']=os.waitstatus_to_exitcode(status)
      report['reaped']=reaped
      report['elapsedSeconds']=time.monotonic()-start
      try:(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
      except Exception as e:
        if primary is None:primary=e
    if primary:raise primary
    return report

if __name__=='__main__':
 def interrupted(signum,frame):raise InterruptedError('oracle signal '+str(signum))
 signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 run(json.loads(Path(sys.argv[1]).read_text()),sys.argv[2])
