"""Closed fresh-child paired parent. Pending binding never spawns or restores."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,platform,resource,signal,subprocess,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE))
from policy import require,sha,identity_sha,validate_ready_binding,pair_schedule,validate_worker_receipt,summarize_pairs,HOOKS,COMPILED

def ordinary(path,max_bytes=256<<20):
    p=Path(path);require(p.is_absolute() and str(p)==str(p.resolve()) and not any(c in str(p) for c in '\0\r\n'),'canonical ordinary role')
    cursor=Path('/')
    for part in p.parts[1:]:cursor/=part;require(not cursor.is_symlink(),'no symlink component')
    st=p.stat();require(p.is_file() and st.st_size<=max_bytes,'ordinary bounded file');return p,st.st_size
def fingerprint(path,max_bytes=256<<20):
    p,size=ordinary(path,max_bytes);h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(65536),b''):h.update(block)
    require(p.stat().st_size==size,'stable file size');return {'bytes':size,'sha256':h.hexdigest()}
def read_json(path,max_bytes=8<<20):
    p,_=ordinary(path,max_bytes);return json.loads(p.read_bytes())
def write(path,value):
    raw=json.dumps(value,indent=2)+'\n';require(len(raw.encode())<=16<<20,'bounded structured receipt')
    with Path(path).open('x') as f:f.write(raw)
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],timeout=15)
def source_identity(root,revision,files):
    require(str(Path(root).resolve())==root and Path(root).is_dir(),'canonical source root');require(git(root,'rev-parse','HEAD').decode().strip()==revision and not git(root,'status','--porcelain').strip(),'frozen clean HEAD')
    for name,digest in files.items():
        p=Path(name);require(not p.is_absolute() and '..' not in p.parts,'repository relative source')
        require(fingerprint(Path(root)/p)['sha256']==digest and sha(git(root,'show',revision+':'+name))==digest,'current/Git '+name)
    return {'revision':revision,'hashes':dict(sorted(files.items()))}
def parent_identity():
    files={str(p.relative_to(ROOT)):fingerprint(p)['sha256'] for p in HERE.iterdir() if p.is_file() and p.suffix in ('.py','.json','.md')}
    for name in ('package.json','test/i80386-cold-typed-paired-source.test.mjs','.github/workflows/i80386-cold-typed-paired.yml'):files[name]=fingerprint(ROOT/name)['sha256']
    revision=git(ROOT,'rev-parse','HEAD').decode().strip();return source_identity(str(ROOT),revision,files)
def host_context():
    def text(path,limit=1<<20):
        try:
            with open(path) as f:return f.read(limit)
        except OSError as e:return {'unavailable':str(e)}
    domain=None
    try:
        for line in Path('/proc/self/cgroup').read_text().splitlines():
            if line.startswith('0::'):domain=Path('/sys/fs/cgroup')/line[3:].lstrip('/')
    except OSError:pass
    processCgroup={'path':None if domain is None else str(domain),'files':{} if domain is None else {n:text(domain/n) for n in ('cpu.max','cpu.stat','memory.max','memory.current','cpuset.cpus.effective')}}
    return {'processCgroup':processCgroup,'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'platform':platform.platform(),'uname':list(platform.uname()),'python':sys.version,'logicalCpus':os.cpu_count(),'allowedCpuSet':sorted(os.sched_getaffinity(0)),'load':list(os.getloadavg()),'memory':text('/proc/meminfo'),'cpuInfo':text('/proc/cpuinfo'),'selfCgroup':text('/proc/self/cgroup'),'cgroupRootFiles':{n:text('/sys/fs/cgroup/'+n) for n in ('cpu.max','cpu.stat','memory.max','memory.current','cpuset.cpus.effective')},'governors':{str(p):text(p) for p in Path('/sys/devices/system/cpu').glob('cpu*/cpufreq/scaling_governor')},'configuredModel':'Six board clocks per Q at6MHz; virtual pacing only, no physical386 calibration'}
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
def bounded_child(command,cwd,out,bounds,permit_api_token=False):
    """One fresh process. wait4 owns reaping and individual child rusage."""
    require(type(permit_api_token) is bool,'explicit credential scope')
    if permit_api_token:require(len(command)==5 and command[:3]==[sys.executable,'-B',str(HERE/'setup-entry.py')],'API credential only closed setup entry')
    out=Path(out);out.mkdir(exist_ok=False);env=os.environ.copy()
    for k in HOOKS:env[k]=''
    for k in ('BW_COLD_REFERENCE_OUTPUT','PYTHONPATH','PYTHONSTARTUP'):env.pop(k,None)
    if not permit_api_token:env.pop('GH_TOKEN',None)
    write(out/'invocation.json',{'command':command,'cwd':str(cwd),'bounds':bounds,'heapScope':'heapMiB is enforced only by explicit Node --max-old-space-size; Python has no V8 heap limit','blankHooks':{k:'' for k in HOOKS},'processGroup':True,'apiCredentialAllowed':permit_api_token,'rusageScope':'Raw kernel wait4 rusage when this main child exits; descendant accounting follows OS semantics. Separate from execution-phase self process.cpuUsage.'})
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
def worker_for(arm):return 'plainJs' if arm=='plain-JS' else 'native'
def authenticate_workers(b):
    identities={}
    for kind,w in b['workers'].items():
        identities[kind]=source_identity(w['root'],w['revision'],w['files']);lock=read_json(Path(w['root'])/w['binding'],16384)
        if kind=='native':
            require(lock['status']=='CANDIDATE_BUILD_STATIC_AUDIT_READY' and lock['candidateBuild']['sourceRevision']==COMPILED and lock['candidateBuild']['addonSha256']==b['nativeInput']['sha256'],'typed source-owned build authority');lock=lock['captureAuthority']
        require(lock['status']=='INDEPENDENTLY_AUDITED_CAPTURE_READY' and lock['independentAuditApproved'] is True,'own capture authority')
        require(lock['compiledRevision']=='7632e6a0995ceaab88bc8cede91506a5330d2e1c' and lock['targetQ']==b['targetQ'] and lock['captureSha256']==b['capture']['sha256'] and lock['independentAuditSha256']==b['independentAudit']['sha256'],'historical baseline capture identity retained')
    return identities
def immutable_snapshot(b):
    parents=parent_identity();workers=authenticate_workers(b);compiled=source_identity(b['compiledRoot'],COMPILED,b['compiledFiles']);pins={}
    for path,expected in b['pinnedFiles'].items():pins[path]=fingerprint(path);require(pins[path]==expected,'actual artifact/source/input pin '+path)
    require(fingerprint(b['node']['path'])['sha256']==b['node']['sha256'],'Node pin')
    return {'parent':parents,'workers':workers,'compiled':compiled,'pinnedFiles':pins,'node':fingerprint(b['node']['path'])}
def child_input(arm,b,output):
    kind=worker_for(arm);w=b['workers'][kind];data={k:b[k]['path'] for k in ('capture','independentAudit')};data.update(output=str(output),workerRevision=w['revision'],workerSourceSha256=w['sourceSha256'],nodeSha256=b['node']['sha256'])
    if kind=='native':data.update(b['nativeInput']);data['mode']='oneQ' if arm=='native-oneQ' else 'batched'
    return data
def validate_prerequisites(b,capture):
    require(capture['status']=='CLOSED_COLD_BIOS_BOCHS_RESET_MODEL_JS_DIAGNOSTIC_PASS' and capture['input']['compiledRevision']=='7632e6a0995ceaab88bc8cede91506a5330d2e1c','genuine historical capture, not new typed execution')
    require(capture['progress']['q']==b['targetQ'] and capture['progress']['n']==b['targetN'] and capture['closed']=={'native':True,'provider':True,'javascript':True},'held extent/closure')
    require(read_json(b['independentAudit']['path'])['status']=='PASS_INDEPENDENT_EIGHTH_COLD_E16_AUDIT','held capture independent audit')
    from authority import validate_authority
    owned,_=validate_authority(read_json(HERE/'hosted-contract.json'));require(b['workers']==owned['workers'] and b['compiledFiles']==owned['compiledFiles'],'exact source-owned binding maps')
    for role in ('capture','independentAudit','armQualificationAudit'):
        require(b['armQualificationAudit']=={'path':str(HERE/read_json(HERE/'hosted-contract.json')['typedQualificationAudit']['file']),'sha256':read_json(HERE/'hosted-contract.json')['typedQualificationAudit']['sha256']},'source-owned actual typed audit role')
        require(b[role]['path'] in b['pinnedFiles'] and b['pinnedFiles'][b[role]['path']]['sha256']==b[role]['sha256'],'retained source-owned proof '+role)
def validate_final_authentication(report,initial,request_pin):
    require(initial is not None and report.get('finalAuthentication')==initial,'immutable final source authentication unavailable or changed')
    require(request_pin is not None and report.get('requestPinAfter')==request_pin,'immutable final request pin unavailable or changed')
    require(report.get('bindingPinBefore') is not None and report.get('bindingPinAfter')==report['bindingPinBefore'],'immutable final derived binding unavailable or changed')
def main(input_path,binding_path=None):
    request=read_json(input_path,16384);require(set(request)=={'comparison','output','parentRevision','parentSourceSha256'},'closed paired request')
    # Deliberately FIRST: pending configuration cannot spawn even metadata
    # children. This module contains no restoration/download/build operation.
    binding_path=Path(binding_path) if binding_path is not None else HERE/'binding.json'
    binding=validate_ready_binding(read_json(binding_path,1<<20));schedule=pair_schedule(request['comparison']);out=Path(request['output']);require(out.is_absolute() and str(out)==str(out.resolve()) and out.parent.is_dir(),'canonical exclusive output');require(not out.exists(),'exclusive run namespace')
    for root in (str(ROOT),binding['compiledRoot'],*[w['root'] for w in binding['workers'].values()]):require(str(out)!=root and not str(out).startswith(root+'/'),'output outside source trees')
    out.mkdir();report={'schema':'bw.cold-typed-state.paired-result.v1','status':'FAIL','request':request,'bindingPinBefore':fingerprint(binding_path),'bindingSha256':fingerprint(binding_path)['sha256'],'comparison':request['comparison'],'pairs':[],'claims':'Configured functional cold slice only; no physical386 RTx/full AT/Windows/Doom10x/default adoption'}
    initial=None;request_pin=None
    try:
        write(out/'request.json',request);write(out/'binding.json',binding);write(out/'host-before.json',host_context());initial=immutable_snapshot(binding);write(out/'initial-authentication.json',initial)
        require(initial['parent']['revision']==request['parentRevision'] and identity_sha(initial['parent']['revision'],initial['parent']['hashes'])==request['parentSourceSha256'],'frozen parent own closure')
        capture=read_json(binding['capture']['path']);validate_prerequisites(binding,capture);request_pin=fingerprint(input_path);report['requestPinBefore']=request_pin;binding_pin=fingerprint(binding_path)
        for pair in schedule:
            record={**pair,'arms':{}};report['pairs'].append(record)
            for arm in pair['order']:
                ns=out/(f"pair-{pair['pair']:02d}-"+arm);before=immutable_snapshot(binding);require(before==initial and fingerprint(input_path)==request_pin and fingerprint(binding_path)==binding_pin,'immutable pre-child proof');write(out/(ns.name+'-before.json'),before);write(out/(ns.name+'-host.json'),host_context());data=child_input(arm,binding,ns/'receipt');input_file=out/(ns.name+'-input.json');write(input_file,data)
                kind=worker_for(arm);w=binding['workers'][kind];command=[binding['node']['path'],'--max-old-space-size=128',str(Path(w['root'])/w['entry']),str(input_file)]
                lifecycle=bounded_child(command,w['root'],ns,binding['bounds'])
                after=None
                try:after=immutable_snapshot(binding);write(ns/'after-authentication.json',after)
                except BaseException as error:write(ns/'after-authentication-unavailable.json',{'error':repr(error)})
                require(lifecycle['exitCode']==0 and not lifecycle['timedOut'] and not lifecycle['interrupted'],'child failure: stop, no retry');require(after==before and fingerprint(input_path)==request_pin and fingerprint(binding_path)==binding_pin,'immutable post-child proof')
                receipt=read_json(ns/'receipt'/'receipt.json');require(receipt['inputSha256Before']==receipt['inputSha256After']==fingerprint(input_file)['sha256'],'actual child input before/after');metrics=validate_worker_receipt(receipt,arm,data,binding,capture)
                record['arms'][arm]={'execution':metrics,'wholeChild':lifecycle,'rawReceipt':str(ns/'receipt'/'receipt.json'),'rawReceiptSha256':fingerprint(ns/'receipt'/'receipt.json')['sha256']};write(ns/'terminal-validation.json',record['arms'][arm]);write(out/('progress-'+ns.name+'.json'),report)
        report['summary']=summarize_pairs(request['comparison'],report['pairs']);report['status']='PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_PASS' if report['summary']['quantitativeGatePass'] else 'PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_FAIL_KEEP_BASELINE'
    except BaseException as error:report['error']=repr(error);raise
    finally:
        try:report['requestPinAfter']=fingerprint(input_path);report['bindingPinAfter']=fingerprint(binding_path);require(report['bindingPinAfter']['sha256']==report['bindingSha256'],'binding unchanged')
        except BaseException as error:report['requestPinAfterUnavailable']=repr(error)
        try:report['finalAuthentication']=immutable_snapshot(binding)
        except BaseException as error:report['finalAuthenticationUnavailable']=repr(error)
        final_error=None
        try:validate_final_authentication(report,initial,request_pin)
        except BaseException as error:
            final_error=error;report['finalizationError']=repr(error);report['status']='FAIL'
        write(out/'host-after.json',host_context());write(out/'result.json',report)
        # Retain primary failure when one exists, alongside finalizationError.
        # A final-only failure must also exit nonzero after the raw receipt.
        if final_error is not None and 'error' not in report:raise final_error
if __name__=='__main__':
    for s in (signal.SIGINT,signal.SIGTERM):signal.signal(s,interrupted)
    require(len(sys.argv)==2,'one closed request JSON');main(sys.argv[1])
