"""Fresh process-group execution with per-child wait4 and observed RSS bound."""
import os,resource,signal,subprocess,time
from pathlib import Path

def run_bounded(cmd,cwd,stdout_path,stderr_path,seconds=300,
                cpu_seconds=240,max_rss_bytes=1536*1024**2):
    assert 0<seconds<=300 and 0<cpu_seconds<=245 and 0<max_rss_bytes<=2*1024**3
    def limits():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU,(cpu_seconds,cpu_seconds+5))
        resource.setrlimit(resource.RLIMIT_AS,(64*1024**3,64*1024**3))
        resource.setrlimit(resource.RLIMIT_FSIZE,(64*1024**2,64*1024**2))
        resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    clean_env={**os.environ,'NODE_OPTIONS':'','NODE_PATH':'','NODE_V8_COVERAGE':'',
               'LD_PRELOAD':'','LD_AUDIT':'','BW_HOT_NAPI_PROFILE':''}
    start=time.monotonic()
    with Path(stdout_path).open('wb') as stdout,Path(stderr_path).open('wb') as stderr:
        process=subprocess.Popen(cmd,cwd=cwd,stdout=stdout,stderr=stderr,
                                 preexec_fn=limits,env=clean_env)
        timed_out=rss_exceeded=False;peak_rss=0
        while True:
            pid,status,usage=os.wait4(process.pid,os.WNOHANG)
            if pid:
                code=os.waitstatus_to_exitcode(status);process.returncode=code;break
            if time.monotonic()-start>seconds:timed_out=True
            try:
                for line in Path(f'/proc/{process.pid}/status').read_text().splitlines():
                    if line.startswith('VmRSS:'):
                        peak_rss=max(peak_rss,int(line.split()[1])*1024);break
            except FileNotFoundError:pass
            if peak_rss>max_rss_bytes:rss_exceeded=True
            if timed_out or rss_exceeded:
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                _,status,usage=os.wait4(process.pid,0)
                code=os.waitstatus_to_exitcode(status);process.returncode=code;break
            time.sleep(0.05)
    try:os.killpg(process.pid,0);group_empty=False
    except ProcessLookupError:group_empty=True
    if not group_empty:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    return {'exitCode':code,'timedOut':timed_out,'rssExceeded':rss_exceeded,
            'processGroupEmptyAfterExit':group_empty,'wallSeconds':time.monotonic()-start,
            'cpuSeconds':usage.ru_utime+usage.ru_stime,'childMaxRssKilobytes':usage.ru_maxrss,
            'peakObservedRssBytes':peak_rss}
