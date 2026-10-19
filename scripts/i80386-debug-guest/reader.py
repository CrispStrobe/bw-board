"""Fixed source admission CLI and independent byte-only guest packet reader."""
import base64,hashlib,json,os,re,selectors,signal,stat,subprocess,sys,time
from pathlib import Path
class Refusal(ValueError):pass
def need(v,why):
    if not v:raise Refusal(why)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def unique(items):
    result={}
    for k,v in items:need(k not in result,'duplicate key');result[k]=v
    return result
def parse(raw,cap):
    need(type(raw) is bytes and 0<len(raw)<=cap,'original extent')
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda v:(_ for _ in ()).throw(Refusal('nonfinite')))
def exact(a,b,why):
    need(type(a) is type(b),why+' type')
    if type(b) is dict:
        need(set(a)==set(b),why+' keys')
        for k,v in b.items():exact(a[k],v,why+'.'+k)
    elif type(b) is list:
        need(len(a)==len(b),why+' length')
        for x,y in zip(a,b):exact(x,y,why)
    else:need(a==b,why)
def file_bytes(path,cap):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);primary=None;parts=[];n=0
    try:
        a=os.fstat(fd);need(stat.S_ISREG(a.st_mode) and a.st_nlink==1 and 0<=a.st_size<=cap,'regular original')
        while True:
            piece=os.read(fd,min(65536,cap+1-n));n+=len(piece);need(n<=cap,'file cap')
            if not piece:break
            parts.append(piece)
        b=os.fstat(fd);c=os.stat(path,follow_symlinks=False)
        ident=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_mode,s.st_nlink)
        need(n==a.st_size and ident(a)==ident(b)==ident(c),'original changed')
    except BaseException as error:primary=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary
    return b''.join(parts)

def before_mode(e):
    after=e['registersAfter'];pre=dict(after)
    for k,change in e['changes']['registers'].items():
        if 'before' in change:pre[k]=change['before']
    return pre
def eligible(r):return bool(r['cr0']&1) and not(r['eflags']&0x20000) and r['csCacheDefault32'] is True and r['cpl']==3 and r['halted'] is False

def row(value, cap):
    need(type(value) is dict and set(value)=={'bytes','sha256'},'closed byte identity')
    need(type(value['bytes']) is int and 0<value['bytes']<=cap,'identity extent')
    need(type(value['sha256']) is str and re.fullmatch('[0-9a-f]{64}',value['sha256']) is not None,'identity digest')

def admitted(value):
    need(type(value) is dict and set(value)=={'schema','head','source','qualification','inputs','runtime','officialAuthority'},'closed admission')
    exact(value['schema'],'bw.debug-guest-source-admission.v1','admission schema')
    exact(value['officialAuthority'],False,'no self authentication')
    need(type(value['head']) is str and re.fullmatch('[0-9a-f]{40}',value['head']) is not None,'source head')
    for field,paths in [('source',SOURCE_PATHS),('qualification',QUALIFICATION_PATHS)]:
        need(type(value[field]) is dict and set(value[field])==set(paths),'closed '+field+' inventory')
        for entry in value[field].values():row(entry,4194304)
    need(type(value['inputs']) is dict and set(value['inputs'])=={'bios','vga','image','filesystem','kernel','buildReceipt'},'closed guest inputs')
    for entry in value['inputs'].values():row(entry,16777216)
    runtime=value['runtime']
    need(type(runtime) is dict and set(runtime)=={'nodePath','nodeVersion','bytes','sha256'},'closed runtime')
    exact(runtime['nodeVersion'],'v22.23.3','observed Node version')
    exact(runtime['nodePath'],'/opt/hostedtoolcache/node/22.23.3/x64/bin/node','selected Node executable')
    row({k:runtime[k] for k in ('bytes','sha256')},134217728)

def _audit(control_raw,observed_raw,observer_raw,before_raw,after_raw,build_raw,control_stderr=b'',observed_stderr=b'',execution_raw=None):
    exact(control_stderr,b'','unexpected control stderr')
    exact(observed_stderr,b'','unexpected subscribed stderr')
    need(execution_raw is not None and len(execution_raw)==2,'both original execution outcomes')
    runtime_identity={k:parse(before_raw,262144)['runtime'][k] for k in ('bytes','sha256')}
    for kind,raw_execution,stdout_raw in zip(('control','observed'),execution_raw,(control_raw,observed_raw)):
        execution=parse(raw_execution,16384)
        exact(execution,{'schema':'bw.debug-guest-execution.v1','kind':kind,'argv':list(COMMAND),'environment':child_env(kind),'runtimeBefore':runtime_identity,'runtimeAfter':runtime_identity,'exitCode':0,'reaped':True,'timedOut':False,'captureEOF':{'stdout':True,'stderr':True},'prefixBytes':{'stdout':len(stdout_raw),'stderr':0},'cleanupErrors':[],'firstFailure':None,'complete':True},'original '+kind+' execution')
    control=parse(control_raw,4194304)
    observed=parse(observed_raw,4194304)
    exact(control,observed,'complete unchanged guest semantic report')
    need(control['firmware']=='bochs' and control['profile']=='4m','fixed memory profile')
    need('\nBW_XV6_FREE_BIOS_FS_OK\n$ ' in control['serial'] and control['milestones'].get('exec') and control['userModeEntries'],'actual filesystem guest success')
    need(type(control['steps']) is int and 0<control['steps']<=30000000,'unchanged step bound')
    before=parse(before_raw,262144)
    after=parse(after_raw,262144)
    admitted(before)
    admitted(after)
    exact(before,after,'source/runtime/input finite before-after')
    build=parse(build_raw,131072)
    need(build['schema']=='astra.xv6-stock-build.v2' and build['sourceRevision']=='eeb7b415dbcb12cc362d0783e41c3d1f44066b17' and build['phystop']=='0x400000' and build['profile']=='4m' and build['stockSmp'] is True,'unchanged MIT guest build')
    need(sha(build_raw)==before['inputs']['buildReceipt']['sha256'] and len(build_raw)==before['inputs']['buildReceipt']['bytes'],'original build receipt identity')
    need(build['imageSha256']==before['inputs']['image']['sha256'] and build['filesystemImageSha256']==before['inputs']['filesystem']['sha256'],'builder/input joins')
    need(control['executionRevision']==before['head'],'guest source head')
    guest_map={}
    need(type(control['sourceSha256']) is dict,'guest source map')
    for relative,digest in control['sourceSha256'].items():
        path=os.path.normpath(str(Path('scripts')/relative))
        need(path not in guest_map,'aliased guest source role')
        guest_map[path]=digest
    need(set(guest_map)==set(SOURCE_PATHS),'explicit complete probe inventory')
    for path,digest in guest_map.items():
        exact(digest,before['source'][path]['sha256'],'guest source identity '+path)
    for role,field in [('bios','rom'),('image','image'),('filesystem','slaveImage')]:
        exact(control[field]['sha256'],before['inputs'][role]['sha256'],'guest media join')
    o=parse(observer_raw,1048576)
    need(type(o) is dict and set(o)=={'schema','started','closed','firstFailure','complete','startStep','attempts','instructionEvents','ring3Retirements','memoryEvents','eventBytes','eventSha256','eventEncoding','eventsBase64','initial','final','boundaries','ordinaryMachineStepPreserved','checkpointQualified','GUIQualified'},'closed observer projection')
    for k,v in [('schema','bw.debug-guest-observer.v1'),('started',True),('closed',True),('complete',True),('firstFailure',None),('attempts',64),('instructionEvents',64),('ordinaryMachineStepPreserved',True),('checkpointQualified',False),('GUIQualified',False)]:
        exact(o[k],v,'observer '+k)
    need(type(o['startStep']) is int and 0<=o['startStep']<control['steps'],'eligible step position')
    exact(o['eventEncoding'],'JSON_LINES_BIGINT_TAG_V1','event projection encoding')
    need(type(o['eventBytes']) is int and 0<o['eventBytes']<=524288,'bounded event extent')
    raw=base64.b64decode(o['eventsBase64'],validate=True)
    need(len(raw)==o['eventBytes'] and sha(raw)==o['eventSha256'],'retained original event prefix')
    events=[parse(line,65536) for line in raw.splitlines()]
    need(all(e.get('kind') in ('instruction','memory','port','interrupt') for e in events),'known event role')
    instructions=[e for e in events if e['kind']=='instruction' and e.get('phase')=='retire']
    memory=[e for e in events if e['kind']=='memory']
    need(len(instructions)==64 and type(o['memoryEvents']) is int and len(memory)==o['memoryEvents']<=1024,'event census')
    for event in events:
        need(type(event.get('time')) is dict and set(event['time'])=={'ticks','domain'},'closed completion time')
        exact(event['time']['domain'],'i80386-completed-instructions','CPU completion domain')
        ticks=event['time']['ticks']
        need(type(ticks) is dict and set(ticks)=={'$bigint'} and type(ticks['$bigint']) is str and re.fullmatch('0|[1-9][0-9]*',ticks['$bigint']) is not None,'original bigint tick projection')
        need(event.get('cpuId')=='i80386','event CPU identity')
    ring3=0
    for e in instructions:
        pre=before_mode(e)
        post=e['registersAfter']
        for regs,pc in [(pre,e['pcBefore']),(post,e['pcAfter'])]:
            need(type(pc) is int and 0<=pc<=0xffffffff and ((regs['csCacheBase']+regs['eip'])&0xffffffff)==pc,'cached linear PC')
        exact(e['changes']['cycles'],1,'actual instruction completion count')
        if eligible(pre):ring3+=1
    need(type(o['ring3Retirements']) is int and ring3==o['ring3Retirements'] and ring3>0,'actual preinstruction ring3 evidence')
    for e in memory:
        a=e['memory']['address']
        need(type(a) is int and 0<=a<=0xffffffff,'unsigned physical memory fact')
        exact(e['memory']['width'],1,'byte memory event')
        need(e['memory']['direction'] in ('read','write') and type(e['memory']['value']) is int and 0<=e['memory']['value']<=255,'memory direction/value')
    need(type(o['boundaries']) is list and len(o['boundaries'])==64,'direct finite boundaries')
    for i,b in enumerate(o['boundaries']):
        for k in ('step','cpuBefore','cpuAfter','machineBefore','machineAfter','eventStart','eventEnd'):
            need(type(b[k]) is int and b[k]>=0,'boundary integer')
        need(b['step']==o['startStep']+i,'consecutive ordinary steps')
        need(b['cpuAfter']-b['cpuBefore']==1 and b['machineAfter']-b['machineBefore']==6,'ordinary same-step charge')
        need(b['eventStart']==i and b['eventEnd']==i+1,'ordered actual retirement')
        if i:
            need(b['cpuBefore']==o['boundaries'][i-1]['cpuAfter'] and b['machineBefore']==o['boundaries'][i-1]['machineAfter'],'contiguous source counters')
        e=instructions[i]
        required={'eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cr4','es','cs','ss','ds','fs','gs','csCacheBase','csCacheDefault32','cpl','halted','pc'}
        for side in ('before','after'):
            need(type(b[side]) is dict and set(b[side])==required,'closed direct '+side+' architectural boundary')
            for k,value in b[side].items():
                if k in ('halted','csCacheDefault32'):
                    need(type(value) is bool,'direct boolean scalar')
                else:
                    need(type(value) is int and 0<=value<=0xffffffff,'direct unsigned scalar')
                    if k in ('es','cs','ss','ds','fs','gs'):need(value<=65535,'visible segment selector')
                    if k=='cpl':need(value<=3,'direct privilege scalar')
        if i:exact(b['before'],o['boundaries'][i-1]['after'],'consecutive outer architectural state')
        # IRQ arbitration is inside machine.step: instruction pre-state may
        # differ from this outer before-state and must never be equated to it.
        need(required<=set(e['registersAfter']),'all direct fields captured')
        for k,value in b['after'].items():
            exact(e['registersAfter'][k],value,'direct after-state '+k)
        need(int(e['time']['ticks']['$bigint'])==b['cpuAfter'],'completion counter join')
    need(eligible(o['initial']['regs']),'actual first eligible boundary')
    exact(o['initial']['regs'],o['boundaries'][0]['before'],'initial direct boundary')
    exact(o['final']['regs'],o['boundaries'][-1]['after'],'final direct boundary')
    need(o['startStep']+64<=control['steps'],'capture inside guest bound')
    return {'schema':'bw.debug-guest-original-reader.v1','reportedConsistencyPassed':True,'ring3Retirements':ring3,'instructionEvents':64,'memoryEvents':len(memory),'completeGuestParity':True,'officialMetadataAuthenticated':False,'GUIQualified':False,'OSQualified':False}

def audit(*originals):
    try:return _audit(*originals)
    except Refusal:raise
    except (KeyError,TypeError,IndexError,ValueError,RecursionError,OverflowError) as error:
        raise Refusal('malformed original: '+type(error).__name__) from error

# The fixed admission adapter uses Git only before/after execution; audit() above
# accepts bytes and imports no observer, debugger or guest validators.
def _read_command(root,argv):
    process=None;selector=None;primary=None;buffers=[bytearray(),bytearray()];reaped=False;started=time.monotonic()
    try:
        process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null','GIT_CONFIG_NOSYSTEM':'1','GIT_NO_LAZY_FETCH':'1','GIT_OPTIONAL_LOCKS':'0'},close_fds=True,start_new_session=True)
        selector=selectors.DefaultSelector()
        for i,p in enumerate((process.stdout,process.stderr)):os.set_blocking(p.fileno(),False);selector.register(p,selectors.EVENT_READ,i)
        while selector.get_map():
            remaining=10-(time.monotonic()-started);need(remaining>0,'Git deadline')
            for key,_ in selector.select(min(remaining,0.05)):
                cap=4194304 if key.data==0 else 8192;left=cap-len(buffers[key.data]);p=os.read(key.fileobj.fileno(),min(65536,left+1));buffers[key.data].extend(p[:left]);need(len(p)<=left,'Git cap')
                if not p:selector.unregister(key.fileobj)
        remaining=10-(time.monotonic()-started);need(remaining>0,'Git wait deadline');code=process.wait(timeout=remaining);reaped=True;need(code==0,'Git source refusal')
    except BaseException as e:primary=e
    finally:
        if process is not None and not reaped and type(process.returncode) is int:
            code=process.returncode;reaped=True
        if process is not None and not reaped:
            try:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=1)
            except BaseException as e:
                if primary is None:primary=e
        for h in (selector,getattr(process,'stdout',None),getattr(process,'stderr',None)):
            if h is not None and not getattr(h,'closed',False):
                try:h.close()
                except BaseException as e:
                    if primary is None:primary=e
    if primary is not None:raise primary
    return bytes(buffers[0])

def git(root,*args):
    return _read_command(root,('/usr/bin/git','--no-replace-objects','-C',str(root),*args))

SOURCE_PATHS = ('scripts/i80386-debug-guest/observer.mjs', 'scripts/lib/i80386-at-hdd-image.mjs', 'scripts/lib/i80386-source-inventory.mjs', 'scripts/lib/xv6-serial-tee.mjs', 'scripts/probe-xv6-stock.mjs', 'scripts/summarize-i80386-expanded-grouped-result.mjs', 'scripts/summarize-i80386-register-stack-result.mjs', 'src/adc0809.js', 'src/at-8042-a20.js', 'src/at-ps2-mouse.js', 'src/at-system-control.js', 'src/audio-bus.js', 'src/cga-card.js', 'src/chip-ledger.js', 'src/dac0832.js', 'src/debug-replay-contract.js', 'src/ega-card.js', 'src/experimental/ata16.js', 'src/experimental/i80286-protected.js', 'src/experimental/i80386-at-machine.js', 'src/experimental/i80386-block-spike.js', 'src/experimental/i80386-broad-block-census.js', 'src/experimental/i80386-code16-block-decode.js', 'src/experimental/i80386-code16-coverage.js', 'src/experimental/i80386-code16-data-window.js', 'src/experimental/i80386-code16-ea.js', 'src/experimental/i80386-code16-event-run-observer.js', 'src/experimental/i80386-code16-form-census.js', 'src/experimental/i80386-code16-load-exec.js', 'src/experimental/i80386-code16-wasm-block.js', 'src/experimental/i80386-code16-wasm.c', 'src/experimental/i80386-code16-window.js', 'src/experimental/i80386-cross-mode-potential-trace-observer.js', 'src/experimental/i80386-expanded-grouped-admission.js', 'src/experimental/i80386-first-refusal-shape.js', 'src/experimental/i80386-form-resolved-admission.js', 'src/experimental/i80386-hot-loop-locator.js', 'src/experimental/i80386-native-byte-block.js', 'src/experimental/i80386-native-dispatch.js', 'src/experimental/i80386-native-successor-census.js', 'src/experimental/i80386-native32-census.js', 'src/experimental/i80386-ram-bridge.js', 'src/experimental/i80386-read-window.js', 'src/experimental/i80386-register-stack-admission.js', 'src/experimental/i80386-write-window.js', 'src/experimental/i80386.js', 'src/experimental/vga-memory.js', 'src/funscii-font.js', 'src/hercules-card.js', 'src/i80386-debug.js', 'src/i8086-cga.js', 'src/i8086-debug.js', 'src/i8086-disasm.js', 'src/i8086-machine.js', 'src/i8086-ram-words.js', 'src/i8086.js', 'src/i8088-cycles.js', 'src/i8088-timing.js', 'src/i8237.js', 'src/i8251.js', 'src/i8254.js', 'src/i8255.js', 'src/i8259.js', 'src/instruction-debug-events.js', 'src/machine-checkpoint.js', 'src/mc146818.js', 'src/mc6845.js', 'src/mc6850.js', 'src/ne2000.js', 'src/ns16c550.js', 'src/pc-speaker.js', 'src/sb-dsp.js', 'src/upd765.js', 'src/vga-card.js', 'src/ym3812.js', 'wasm/i80386-block-spike.wasm', 'wasm/i80386-code16-wasm.wasm', 'wasm/i80386-ram-bridge.wasm')
QUALIFICATION_PATHS = ('roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin','roms/free-at-bios/LICENSE','roms/free-at-bios/README.md','package.json','scripts/build-xv6-stock-4m.mjs','scripts/i80386-debug-guest/reader.py','scripts/i80386-debug-guest/README.md','test/i80386-debug-guest-observer.test.mjs','.github/workflows/i80386-debug-guest.yml')
ROOT=Path(__file__).resolve().parents[2]
def source_admission():
    head=git(ROOT,'rev-parse','HEAD').decode('ascii').strip()
    need(re.fullmatch('[0-9a-f]{40}',head) is not None,'HEAD shape')
    need(head==os.environ.get('BW_EXPECTED_HEAD'),'externally selected workflow head')
    rows={}
    for path in SOURCE_PATHS+QUALIFICATION_PATHS:
        raw=file_bytes(ROOT/path,4194304)
        exact(raw,git(ROOT,'cat-file','blob',head+':'+path),'Git/live '+path)
        rows[path]={'bytes':len(raw),'sha256':sha(raw)}
    return head,rows
def admission():
    head,rows=source_admission()
    inputs={}
    paths={'bios':ROOT/'roms/free-at-bios/BIOS-bochs-legacy','vga':ROOT/'roms/free-at-bios/vgabios-lgpl.bin','image':Path('/tmp/xv6-stock-4m/xv6.img'),'filesystem':Path('/tmp/xv6-stock-4m/fs.img'),'kernel':Path('/tmp/xv6-stock-4m/kernel'),'buildReceipt':Path('/tmp/xv6-stock-4m/bw-xv6-stock-4m-receipt.json')}
    for role,path in paths.items():
        raw=file_bytes(path,16777216);inputs[role]={'bytes':len(raw),'sha256':sha(raw)}
    node=Path('/opt/hostedtoolcache/node/22.23.3/x64/bin/node')
    raw=file_bytes(node,134217728)
    result={'schema':'bw.debug-guest-source-admission.v1','head':head,'source':{p:rows[p] for p in SOURCE_PATHS},'qualification':{p:rows[p] for p in QUALIFICATION_PATHS},'inputs':inputs,'runtime':{'nodePath':str(node),'nodeVersion':_read_command(ROOT,(str(node),'--version')).decode('ascii').strip(),'bytes':len(raw),'sha256':sha(raw)},'officialAuthority':False}
    admitted(result)
    return result
NODE='/opt/hostedtoolcache/node/22.23.3/x64/bin/node'
COMMAND=(NODE,'scripts/probe-xv6-stock.mjs')
RUN_ENV={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','XV6_FIRMWARE':'bochs','XV6_PROFILE':'4m','XV6_STEPS':'30000000','XV6_STOP_ON_EXPECT':'1','XV6_COMMAND':'echo BW_XV6_FREE_BIOS_FS_OK > bwfile; cat bwfile; rm bwfile\r','XV6_EXPECT_SERIAL':'\nBW_XV6_FREE_BIOS_FS_OK\n$ '}
def child_env(kind):
    need(kind in ('control','observed'),'fixed capture arm')
    env={**RUN_ENV,'XV6_DEBUG_GUEST':'1' if kind=='observed' else '0'}
    if kind=='observed':env['XV6_DEBUG_GUEST_OUTPUT']='debug-guest-originals/observer.json'
    return env

def execute(kind):
    # Only this fixed guest command is reachable from the CLI. Tests mock every
    # process/FD/time edge; local controls never call this real execution path.
    env=child_env(kind)
    directory=ROOT/'debug-guest-originals'
    process=None;selector=None;handles=[];primary=None;reaped=False;code=None
    outputs={};counts={'stdout':0,'stderr':0};eof={'stdout':False,'stderr':False}
    cleanup=[];timed_out=False;runtime_before=None;runtime_after=None;start=time.monotonic()
    try:
        node_raw=file_bytes(NODE,134217728);runtime_before={'bytes':len(node_raw),'sha256':sha(node_raw)}
        for name in ('stdout','stderr'):
            handle=open(directory/(kind+'.'+name),'xb');handles.append(handle);outputs[name]=handle
        process=subprocess.Popen(COMMAND,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,close_fds=True)
        selector=selectors.DefaultSelector()
        for name in ('stdout','stderr'):
            pipe=getattr(process,name);os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,name)
        while selector.get_map():
            left=600-(time.monotonic()-start)
            if left<=0:timed_out=True;raise Refusal('fixed guest wall deadline')
            for key,_ in selector.select(min(left,0.05)):
                name=key.data;cap=4194304 if name=='stdout' else 65536
                available=cap-counts[name]
                raw=os.read(key.fileobj.fileno(),min(65536,available+1))
                if raw:
                    prefix=raw[:available];written=outputs[name].write(prefix)
                    need(type(written) is int and 0<=written<=len(prefix),'capture write extent')
                    counts[name]+=written
                    need(written==len(prefix),'partial capture write')
                    need(len(raw)<=available,name+' capture cap')
                else:eof[name]=True;selector.unregister(key.fileobj)
        left=600-(time.monotonic()-start)
        if left<=0:timed_out=True;raise Refusal('fixed guest wait deadline')
        code=process.wait(timeout=left);reaped=True
        need(type(code) is int and code==0,'guest original exit')
    except BaseException as error:
        primary=error
        if isinstance(error,subprocess.TimeoutExpired):timed_out=True
    finally:
        if process is not None and not reaped and type(process.returncode) is int:
            code=process.returncode;reaped=True
        if process is not None and not reaped:
            try:
                os.killpg(process.pid,signal.SIGTERM)
                try:code=process.wait(timeout=5);reaped=True
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid,signal.SIGKILL);code=process.wait(timeout=5);reaped=True
            except BaseException as error:
                cleanup.append(type(error).__name__)
                if primary is None:primary=error
        for handle in (selector,getattr(process,'stdout',None),getattr(process,'stderr',None),*handles):
            if handle is not None:
                try:handle.close()
                except BaseException as error:
                    cleanup.append(type(error).__name__)
                    if primary is None:primary=error
        try:
            node_raw=file_bytes(NODE,134217728);runtime_after={'bytes':len(node_raw),'sha256':sha(node_raw)}
            exact(runtime_before,runtime_after,'Node finite capture positions')
        except BaseException as error:
            cleanup.append('runtime-after:'+type(error).__name__)
            if primary is None:primary=error
        record={'schema':'bw.debug-guest-execution.v1','kind':kind,'argv':list(COMMAND),'environment':env,'runtimeBefore':runtime_before,'runtimeAfter':runtime_after,'exitCode':code,'reaped':reaped,'timedOut':timed_out,'captureEOF':eof,'prefixBytes':counts,'cleanupErrors':cleanup,'firstFailure':None if primary is None else type(primary).__name__+':'+str(primary)[:256],'complete':primary is None}
        try:write_original(directory/(kind+'.execution.json'),record)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary

def write_original(path,value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();need(len(raw)<=262144,'admission cap')
    with open(path,'xb') as out:out.write(raw)
def main():
    if len(sys.argv)==3 and sys.argv[1]=='--source-preload':
        head,rows=source_admission();write_original(sys.argv[2],{'head':head,'roles':rows});return
    if len(sys.argv)==3 and sys.argv[1]=='--execute':execute(sys.argv[2]);return
    if len(sys.argv)==3 and sys.argv[1]=='--admit':write_original(sys.argv[2],admission());return
    if len(sys.argv)==3 and sys.argv[1]=='--packet':
        directory=Path(sys.argv[2])
        names=('control.stdout','observed.stdout','observer.json','before.json','after.json')
        originals=[file_bytes(directory/n,4194304 if n.endswith('stdout') else 1048576) for n in names]
        result=audit(*originals,file_bytes('/tmp/xv6-stock-4m/bw-xv6-stock-4m-receipt.json',131072),file_bytes(directory/'control.stderr',65536),file_bytes(directory/'observed.stderr',65536),[file_bytes(directory/(k+'.execution.json'),16384) for k in ('control','observed')])
        write_original(directory/'reader-result.json',result);return
    raise Refusal('fixed --admit OUTPUT or --packet DIRECTORY only')
def controls():
    import unittest,copy
    encode=lambda value:(json.dumps(value,separators=(',',':'))+'\n').encode()
    def manufactured():
        identity={'bytes':1,'sha256':'1'*64}
        before={'schema':'bw.debug-guest-source-admission.v1','head':'a'*40,'source':{p:dict(identity) for p in SOURCE_PATHS},'qualification':{p:dict(identity) for p in QUALIFICATION_PATHS},'inputs':{p:dict(identity) for p in ('bios','vga','image','filesystem','kernel','buildReceipt')},'runtime':{'nodePath':NODE,'nodeVersion':'v22.23.3',**identity},'officialAuthority':False}
        build={'schema':'astra.xv6-stock-build.v2','sourceRevision':'eeb7b415dbcb12cc362d0783e41c3d1f44066b17','phystop':'0x400000','profile':'4m','stockSmp':True,'imageSha256':'1'*64,'filesystemImageSha256':'1'*64}
        build_raw=encode(build);before['inputs']['buildReceipt']={'bytes':len(build_raw),'sha256':sha(build_raw)}
        guest={'firmware':'bochs','profile':'4m','serial':'\nBW_XV6_FREE_BIOS_FS_OK\n$ ','milestones':{'exec':{'count':1}},'userModeEntries':[{'step':1}],'steps':100,'executionRevision':'a'*40,'sourceSha256':{os.path.relpath(p,'scripts'):'1'*64 for p in SOURCE_PATHS},'rom':{'sha256':'1'*64},'image':{'sha256':'1'*64},'slaveImage':{'sha256':'1'*64}}
        registers={k:0 for k in ('eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cr4','es','cs','ss','ds','fs','gs','csCacheBase','cpl','pc')}
        registers.update(cr0=1,csCacheDefault32=True,cpl=3,halted=False,eax=0x89abcdef)
        events=[];boundaries=[]
        for i in range(64):
            pre={**registers,'eip':i,'pc':i};post={**registers,'eip':i+1,'pc':i+1}
            events.append({'cpuId':'i80386','kind':'instruction','phase':'retire','time':{'ticks':{'$bigint':str(i+1)},'domain':'i80386-completed-instructions'},'pcBefore':i,'pcAfter':i+1,'registersAfter':post,'changes':{'cycles':1,'registers':{'eip':{'before':i,'after':i+1},'pc':{'before':i,'after':i+1}}}})
            boundaries.append({'step':i,'before':pre,'after':post,'cpuBefore':i,'cpuAfter':i+1,'machineBefore':6*i,'machineAfter':6*(i+1),'eventStart':i,'eventEnd':i+1})
        event_raw=b''.join(encode(e) for e in events)
        observer={'schema':'bw.debug-guest-observer.v1','started':True,'closed':True,'complete':True,'firstFailure':None,'startStep':0,'attempts':64,'instructionEvents':64,'ring3Retirements':64,'memoryEvents':0,'eventBytes':len(event_raw),'eventSha256':sha(event_raw),'eventEncoding':'JSON_LINES_BIGINT_TAG_V1','eventsBase64':base64.b64encode(event_raw).decode(),'initial':{'regs':boundaries[0]['before']},'final':{'regs':boundaries[-1]['after']},'boundaries':boundaries,'ordinaryMachineStepPreserved':True,'checkpointQualified':False,'GUIQualified':False}
        return {'control':guest,'observed':copy.deepcopy(guest),'observer':observer,'before':before,'after':copy.deepcopy(before),'build':build,'stderr':[b'',b''],'execution':None}
    def wire(packet):
        report=[encode(packet[n]) for n in ('control','observed')]
        execution=packet['execution']
        if execution is None:
            execution=[{'schema':'bw.debug-guest-execution.v1','kind':k,'argv':list(COMMAND),'environment':child_env(k),'runtimeBefore':{'bytes':1,'sha256':'1'*64},'runtimeAfter':{'bytes':1,'sha256':'1'*64},'exitCode':0,'reaped':True,'timedOut':False,'captureEOF':{'stdout':True,'stderr':True},'prefixBytes':{'stdout':len(raw),'stderr':0},'cleanupErrors':[],'firstFailure':None,'complete':True} for k,raw in zip(('control','observed'),report)]
        return (*report,encode(packet['observer']),encode(packet['before']),encode(packet['after']),encode(packet['build']),*packet['stderr'],[encode(e) for e in execution])
    def mocked_capture(wait_error=None,close_error=None):
        from unittest.mock import patch
        from types import SimpleNamespace
        captures=[];closed=[];signals=[]
        class Handle:
            def __init__(self,name,fd):self.name=name;self.fd=fd
            def fileno(self):return self.fd
            def write(self,raw):return len(raw)
            def close(self):
                closed.append(self.name)
                if self.name=='stderr' and close_error is not None:raise close_error
        stdout=Handle('stdout',40);stderr=Handle('stderr',41)
        class Process:
            returncode=None;pid=12345
            def __init__(self):self.stdout=stdout;self.stderr=stderr;self.waits=0
            def wait(self,timeout):
                self.waits+=1
                if self.waits==1 and wait_error is not None:raise wait_error
                self.returncode=0;return 0
        process=Process()
        class Selector:
            def __init__(self):self.rows={}
            def register(self,pipe,_event,name):self.rows[pipe.fd]=SimpleNamespace(fileobj=pipe,data=name)
            def get_map(self):return self.rows
            def select(self,_timeout):return [(v,None) for v in list(self.rows.values())]
            def unregister(self,pipe):del self.rows[pipe.fd]
            def close(self):closed.append('selector')
        reads={40:iter((b'{}',b'')),41:iter((b'',))}
        with patch('builtins.open',side_effect=lambda path,_mode:Handle(str(path),99)),patch.object(subprocess,'Popen',return_value=process) as popen,patch.object(selectors,'DefaultSelector',Selector),patch.object(os,'set_blocking'),patch.object(os,'read',side_effect=lambda fd,_count:next(reads[fd])),patch.object(os,'killpg',side_effect=lambda pid,sig:signals.append((pid,sig))),patch.object(time,'monotonic',return_value=0),patch.dict(globals(),{'write_original':lambda path,value:captures.append(value),'file_bytes':lambda path,cap:b'N'}):
            error=None
            try:execute('control')
            except BaseException as caught:error=caught
            if popen.call_count:
                assert popen.call_args.args[0]==COMMAND
                assert popen.call_args.kwargs['env']==child_env('control')
        return error,captures,closed,signals
    class C(unittest.TestCase):
        def test_owned_capture_fixed_command(self):
            error,records,closed,signals=mocked_capture()
            self.assertIsNone(error);self.assertTrue(records[0]['complete']);self.assertTrue(records[0]['reaped']);self.assertEqual(signals,[])
            self.assertEqual(records[0]['prefixBytes'],{'stdout':2,'stderr':0});self.assertEqual(closed.count('stdout'),1);self.assertEqual(closed.count('stderr'),1)
        def test_owned_capture_primary_survives_close_error(self):
            marker=RuntimeError('owned primary');secondary=OSError('secondary close')
            error,records,closed,signals=mocked_capture(marker,secondary)
            self.assertIs(error,marker);self.assertFalse(records[0]['complete']);self.assertEqual(records[0]['cleanupErrors'],['OSError']);self.assertEqual(len(signals),1)
            self.assertEqual(closed.count('stdout'),1);self.assertEqual(closed.count('stderr'),1)
        def test_owned_capture_timeout_not_eof_success(self):
            error,records,closed,signals=mocked_capture(subprocess.TimeoutExpired(COMMAND,600))
            self.assertIsInstance(error,subprocess.TimeoutExpired);self.assertTrue(records[0]['timedOut']);self.assertFalse(records[0]['complete']);self.assertTrue(records[0]['reaped']);self.assertEqual(len(signals),1)
        def test_complete_manufactured_packet(self):
            self.assertTrue(audit(*wire(manufactured()))['reportedConsistencyPassed'])
        def test_packet_mutations_refuse(self):
            def missing_source(p):p['before']['source'].pop(SOURCE_PATHS[0]);p['after']=copy.deepcopy(p['before'])
            def foreign_source(p):p['before']['source']['foreign.js']=p['before']['source'].pop(SOURCE_PATHS[0]);p['after']=copy.deepcopy(p['before'])
            def runtime(p):p['before']['runtime']['nodePath']='/usr/bin/node';p['after']=copy.deepcopy(p['before'])
            def runtime_hash(p):p['before']['runtime']['sha256']='2'*64;p['after']=copy.deepcopy(p['before'])
            def media(p):p['before']['inputs']['image']['sha256']='2'*64;p['after']=copy.deepcopy(p['before'])
            def drift(p):p['after']['source'][SOURCE_PATHS[0]]['sha256']='2'*64
            def marker(p):p['control']['serial']='wrong';p['observed']['serial']='wrong'
            def stderr(p):p['stderr'][1]=b'original refusal'
            def partial(p):p['observer']['closed']=False
            def gap(p):p['observer']['boundaries'][4]['step']=8
            def before(p):p['observer']['initial']['regs']['cpl']=0
            def missing_high_register(p):
                o=p['observer'];events=[parse(line,65536) for line in base64.b64decode(o['eventsBase64']).splitlines()];del events[0]['registersAfter']['eax'];raw=b''.join(encode(e) for e in events);o.update(eventsBase64=base64.b64encode(raw).decode(),eventBytes=len(raw),eventSha256=sha(raw))
            def later_before(p):p['observer']['boundaries'][7]['before']['eax']=0x76543210
            def high_register(p):p['observer']['boundaries'][0]['after']['eax']=0xabcdef12
            for mutation in (missing_source,foreign_source,runtime,runtime_hash,media,drift,marker,stderr,partial,gap,before,missing_high_register,high_register,later_before):
                with self.subTest(mutation=mutation.__name__):
                    p=manufactured();mutation(p)
                    with self.assertRaises(Refusal):audit(*wire(p))
        def test_execution_mutations_refuse(self):
            for field,value in [('argv',['node','scripts/probe-xv6-stock.mjs']),('timedOut',True),('reaped',False),('cleanupErrors',['close-refused']),('exitCode',-9),('complete',False)]:
                p=manufactured();args=wire(p);p['execution']=[parse(b,16384) for b in args[-1]];p['execution'][1][field]=value
                with self.subTest(field=field):
                    with self.assertRaises(Refusal):audit(*wire(p))
        def test_duplicate_original(self):
            with self.assertRaises(Refusal):parse(b'{"complete":true,"complete":false}',100)
        def test_nonfinite_original(self):
            with self.assertRaises(Refusal):parse(b'{"v":NaN}',100)
        def test_bool_is_not_integer(self):
            with self.assertRaises(Refusal):exact(True,1,'counter')
        def test_zero_before_is_not_dropped(self):
            e={'registersAfter':{'cpl':3,'eflags':514},'changes':{'registers':{'cpl':{'before':0,'after':3},'eflags':{'before':0,'after':514}}}}
            self.assertEqual(before_mode(e),{'cpl':0,'eflags':0})
        def test_fixed_inventory(self):
            self.assertEqual(len(SOURCE_PATHS),78);self.assertEqual(len(set(SOURCE_PATHS)),78)
            self.assertIn('src/i80386-debug.js',SOURCE_PATHS)
            self.assertNotIn('src/debug-target-factory.js',SOURCE_PATHS)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(C))
    if not result.wasSuccessful():raise SystemExit(1)
if __name__=='__main__':
    if sys.argv[1:]==['--controls']:controls()
    else:main()
