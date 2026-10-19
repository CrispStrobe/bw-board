import sys
sys.dont_write_bytecode=True
import json,os,platform,resource,signal,subprocess,time
from pathlib import Path
from policy import require
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
def write(path,value):
    data=json.dumps(value,indent=2)+'\n';require(len(data.encode())<=16<<20,'bounded structured receipt')
    with Path(path).open('x') as f:f.write(data)
def host_context():
    def text(path,limit=1<<20):
        try:
            with open(path) as f:return f.read(limit)
        except OSError as e:return {'unavailable':str(e)}
    return {'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'platform':platform.platform(),'uname':list(platform.uname()),'python':sys.version,'logicalCpus':os.cpu_count(),'allowedCpuSet':sorted(os.sched_getaffinity(0)),'load':list(os.getloadavg()),'memory':text('/proc/meminfo'),'cpuInfo':text('/proc/cpuinfo'),'selfCgroup':text('/proc/self/cgroup'),'cgroups':{n:text('/sys/fs/cgroup/'+n) for n in ('cpu.max','cpu.stat','memory.max','memory.current','cpuset.cpus.effective')},'governors':{str(p):text(p) for p in Path('/sys/devices/system/cpu').glob('cpu*/cpufreq/scaling_governor')},'configuredModel':'Six board clocks per Q at6MHz; virtual pacing only, no physical386 calibration'}
def stopped_descendants(pid):
    parents={pid};stopped=set()
    try:os.killpg(pid,signal.SIGSTOP)
    except ProcessLookupError:pass
    for _ in range(6):
        changed=False
        for entry in Path('/proc').iterdir():
            if not entry.name.isdecimal():continue
            try:
                fields=(entry/'stat').read_text().rsplit(')',1)[1].split();number=int(entry.name);ppid=int(fields[1])
                if number==pid or ppid in parents:
                    if number not in parents:parents.add(number);changed=True
                    if number not in stopped:os.kill(number,signal.SIGSTOP);stopped.add(number)
            except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError,IndexError):pass
        if not changed:break
    return stopped
def kill_tree(pid):
    stopped=stopped_descendants(pid)
    for number in stopped:
        try:os.kill(number,signal.SIGKILL)
        except ProcessLookupError:pass
    try:os.killpg(pid,signal.SIGKILL)
    except ProcessLookupError:pass
    return sorted(stopped)
ACTIVE=set()
def interrupted(signum,frame):
    owned=set(ACTIVE)
    # Also catch the brief Popen-launch interval before ACTIVE registration.
    for entry in Path('/proc').iterdir():
        if entry.name.isdecimal():
            try:
                fields=(entry/'stat').read_text().rsplit(')',1)[1].split()
                if int(fields[1])==os.getpid():owned.add(int(entry.name))
            except (OSError,ValueError,IndexError):pass
    for pid in owned:kill_tree(pid)
    raise SystemExit(128+signum)
def scoped_setup_environment(command,env):
    from policy import contract
    c=contract(json.loads((Path(__file__).resolve().parent/'contract.json').read_text()))
    require(command==[sys.executable,'-B','/home/runner/work/bw-board/bw-board/symbol-worker/scripts/cold-native-ledger-scalars-symbol-profile/setup.py'],'token only fixed authenticated diagnostic setup-only child')
    env=dict(env);dispatch_sha=env['GITHUB_SHA'];env['BW_ACTUAL_DISPATCH_SHA']=dispatch_sha;env['GITHUB_SHA']=c['roles']['diagnostic']['revision']
    require(len(dispatch_sha)==40 and all(x in '0123456789abcdef' for x in dispatch_sha),'retained actual dispatch SHA')
    return env
def bounded_child(command,cwd,out,bounds,artifact_setup=False):
    """One fresh process. wait4 owns reaping and individual child rusage."""
    out=Path(out);out.mkdir(exist_ok=False);env=os.environ.copy()
    for k in HOOKS:env[k]=''
    if artifact_setup:
        env=scoped_setup_environment(command,env)
    else:env.pop('GH_TOKEN',None)
    for k in ('GITHUB_TOKEN','BW_COLD_REFERENCE_OUTPUT','PYTHONPATH','PYTHONSTARTUP','PYTHONHOME'):env.pop(k,None)
    write(out/'invocation.json',{'command':command,'cwd':str(cwd),'bounds':bounds,'blankHooks':{k:'' for k in HOOKS},'processGroup':True,'actualDispatchSha':os.environ.get('GITHUB_SHA'),'setupOnlyDiagnosticRoleShaAlias':env.get('GITHUB_SHA') if artifact_setup else None,'aliasScope':'Only authenticated setup child uses diagnostic role SHA; never the actual dispatch SHA','rusageScope':'Raw kernel wait4 rusage when this main child exits; descendant accounting follows OS semantics. Separate from execution-phase self process.cpuUsage.'})
    def limits():
        os.nice(bounds['niceIncrement']);resource.setrlimit(resource.RLIMIT_CPU,(bounds['cpuSeconds'],bounds['cpuSeconds']));resource.setrlimit(resource.RLIMIT_FSIZE,(bounds['fileBytes'],bounds['fileBytes']));resource.setrlimit(resource.RLIMIT_CORE,(bounds['coreBytes'],bounds['coreBytes']))
    start=time.monotonic();timed_out=False;terminated=[];interruption=None;usage=None;raw_status=None
    with (out/'stdout').open('xb') as so,(out/'stderr').open('xb') as se:
        try:proc=subprocess.Popen(command,cwd=cwd,env=env,stdout=so,stderr=se,start_new_session=True,preexec_fn=limits)
        except OSError as error:
            result={'pid':None,'exitCode':None,'rawWaitStatus':None,'timedOut':False,'wallSeconds':time.monotonic()-start,'terminatedPids':[],'interrupted':None,'launchError':repr(error),'rusage':None}
            write(out/'exit.json',result);return result
        ACTIVE.add(proc.pid)
        try:
            while True:
                done,status,used=os.wait4(proc.pid,os.WNOHANG)
                if done:raw_status,usage=status,used;break
                if time.monotonic()-start>=bounds['wallSeconds']:
                    timed_out=True;terminated=kill_tree(proc.pid);_,raw_status,usage=os.wait4(proc.pid,0);break
                time.sleep(0.025)
        except BaseException as error:
            interruption=repr(error);terminated=kill_tree(proc.pid)
            try:_,raw_status,usage=os.wait4(proc.pid,0)
            except ChildProcessError:pass
        finally:ACTIVE.discard(proc.pid)
        if raw_status is not None:proc.returncode=os.waitstatus_to_exitcode(raw_status)
    result={'pid':proc.pid,'exitCode':proc.returncode,'rawWaitStatus':raw_status,'timedOut':timed_out,'wallSeconds':time.monotonic()-start,'terminatedPids':terminated,'interrupted':interruption,'rusage':None if usage is None else {k:getattr(usage,k) for k in ('ru_utime','ru_stime','ru_maxrss','ru_minflt','ru_majflt','ru_inblock','ru_oublock','ru_nvcsw','ru_nivcsw')}}
    if usage is not None:result['cpuSeconds']=usage.ru_utime+usage.ru_stime
    write(out/'exit.json',result) # Raw lifecycle receipt precedes every assertion.
    return result
