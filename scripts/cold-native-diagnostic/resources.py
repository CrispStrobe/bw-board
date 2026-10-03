"""Read-only correctness-child accounting, not benchmark measurements."""
import os
from pathlib import Path
import time

def wait4_until(proc,deadline):
    while True:
        pid,status,usage=os.wait4(proc.pid,os.WNOHANG)
        if pid:
            proc.returncode=os.waitstatus_to_exitcode(status)
            return {'userSeconds':usage.ru_utime,'systemSeconds':usage.ru_stime,'maxRssKiB':usage.ru_maxrss,'minorFaults':usage.ru_minflt,'majorFaults':usage.ru_majflt,'voluntaryContextSwitches':usage.ru_nvcsw,'involuntaryContextSwitches':usage.ru_nivcsw},False
        if time.monotonic()>=deadline:return None,True
        time.sleep(min(.01,max(0,deadline-time.monotonic())))

def wait4_reap(proc):
    _,status,usage=os.wait4(proc.pid,0);proc.returncode=os.waitstatus_to_exitcode(status)
    return {'userSeconds':usage.ru_utime,'systemSeconds':usage.ru_stime,'maxRssKiB':usage.ru_maxrss,'minorFaults':usage.ru_minflt,'majorFaults':usage.ru_majflt,'voluntaryContextSwitches':usage.ru_nvcsw,'involuntaryContextSwitches':usage.ru_nivcsw}

def memory_events(path=None):
    try:
        if path is None:
            entries=[line.split(':',2) for line in Path('/proc/self/cgroup').read_text().splitlines()]
            domains=[entry[2] for entry in entries if entry[:2]==['0','']];assert len(domains)==1
            domain=domains[0];assert domain.startswith('/') and '..' not in Path(domain).parts
            path=Path('/sys/fs/cgroup')/domain.lstrip('/')/'memory.events'
        raw=path.read_text();events={}
        for line in raw.splitlines():
            key,value=line.split();assert key not in events and value.isdecimal();events[key]=int(value)
        assert all(k in events for k in ['low','high','max','oom','oom_kill'])
        return {'available':True,'path':str(path),'events':events,'raw':raw,'scope':'Cgroup aggregate events; concurrent processes may contribute'}
    except (OSError,ValueError,AssertionError) as error:return {'available':False,'path':str(path),'reason':type(error).__name__,'scope':'No cgroup memory attribution available'}

def memory_delta(before,after):
    if not(before.get('available') and after.get('available')):return {'available':False,'reason':'before or after unavailable'}
    if before['path']!=after['path'] or before['events'].keys()!=after['events'].keys():return {'available':False,'reason':'cgroup/domain changed'}
    delta={k:after['events'][k]-v for k,v in before['events'].items()}
    if any(v<0 for v in delta.values()):return {'available':False,'reason':'counter regression'}
    return {'available':True,'events':delta,'scope':'Cgroup aggregate deltas; not proof this child caused an event'}
