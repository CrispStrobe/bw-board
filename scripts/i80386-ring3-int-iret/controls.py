#!/usr/bin/env python3
"""MIT. Inert original-reader controls; no CPU, QEMU, cgroup or guest execution.

Only the pure authored ROM byte builder runs in Node. All observations, process,
runtime and kernel records below are manufactured and never actual admission.
The full positive includes independently assembled register/frame/RAM goldens.
"""
import copy
import importlib.util
import io
import json
import struct
import subprocess
import zipfile
from hashlib import sha256
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('standalone_ring3_reader', HERE / 'reader.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def sha(value):
    return sha256(value).hexdigest()


def pure_fixture():
    # The only child in these controls is this deterministic pure byte builder.
    # It imports fixture.mjs, never probe.mjs or any CPU module.
    script = "import {buildFixture} from './scripts/i80386-ring3-int-iret/fixture.mjs';const f=buildFixture();console.log(JSON.stringify({rom:Buffer.from(f.rom).toString('hex'),manifest:f.manifest}));"
    done = subprocess.run(['node', '--input-type=module', '--eval', script], cwd=HERE.parents[1],
                          capture_output=True, timeout=10, check=True)
    assert done.stderr == b'' and len(done.stdout) < 150000
    value = json.loads(done.stdout)
    rom = bytes.fromhex(value['rom'])
    assert len(rom) == 65536 and sha(rom) == 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529'
    return rom, value['manifest']


def independent_memory(rom):
    memory = bytearray(1048576)
    for address, count in ((4096,48),(7168,16),(8192,104),(32704,96),(36800,96),(40896,96),
                           (16384,95),(20480,198),(24576,167),(25088,145)):
        memory[address:address+count] = rom[address:address+count]
    for address, byte in ((4109,155),(4117,147),(4125,251),(4133,243),(4141,139)):
        memory[address] = byte
    struct.pack_into('<I', memory, 8196, 40960)
    # Literal golden arrays, independent of the reader's expectations/functions.
    before = (287454020,2578103244,3723427584,1432778632,36864,195936478,305419896,2271560481)
    for at, values, selectors, flags in (
        (28672,before,(35,27,35,35,35,35),514),
        (28736,before[:4]+(32748,)+before[5:],(35,8,16,35,35,35),2),
        (28800,(2712847316,)+before[1:],(35,27,35,35,35,35),514)):
        struct.pack_into('<8I6HI', memory, at, *values, *selectors, flags)
    for at, eip in ((28864,20573),(32748,20573),(40940,20676),(45036,20480)):
        struct.pack_into('<5I', memory, at, eip,27,514,36864,35)
    for at,value in ((32744,2),(36860,514),(28884,1212239428),(28888,1380275278)):
        struct.pack_into('<I',memory,at,value)
    return bytes(memory)


def wire(memory):
    return b'BW-RING3-V1\n'+b''.join(memory[a:a+n] for a,n in
        ((28672,224),(4096,48),(6144,1040),(8192,104),(32704,96),(36800,96),(40896,96)))+b'\nBW-RING3-END\n'


def snapshot(inode, pid=None, enclosing=False, after=False):
    return {'identity':{'device':1,'inode':inode},
        'limits':{'cpuMax':'100000 100000','memoryMax':'1073741824','swapMax':'0','pidsMax':'64'},
        'raw':{'memoryEvents':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n',
               'cpuStat':'usage_usec %d\nuser_usec %d\nsystem_usec %d\n'%((20,10,10) if after else (0,0,0)),
               'cgroupEvents':'populated %d\nfrozen 0\n'%int(bool(pid) or enclosing),
               'memoryCurrent':'0\n','memoryPeak':'1024\n','pidsCurrent':'%d\n'%int(bool(pid) or enclosing)},
        'procs':[] if pid is None else [pid]}


def manufacture(rom, manifest):
    memory = independent_memory(rom); output = wire(memory)
    assert sha(output) == '488a9d4adb4431184ed56e6c6807be5fafbf1d93cf3dfe985196e5cd0ef001c0'
    packet = {'inputs/fixture.rom':rom,'inputs/fixture.json':encode(manifest),
              'js/memory.before.bin':bytes(1048576),'js/memory.after.bin':memory,
              'js/stdout':output,'js/stderr':b'','qemu/stdout':output,'qemu/stderr':b''}
    files = {name:{'bytes':100,'sha256':'1'*64,'mode':'100644','blob':'2'*40} for name in (
        'LICENSE','src/experimental/i80386.js','test/i80386-ring3-int-iret.test.mjs',
        '.github/workflows/i80386-ring3-int-iret.yml',
        *('scripts/i80386-ring3-int-iret/'+x for x in ('fixture.mjs','probe.mjs','reader.py','controls.py','run.py','README.md')))}
    source = {'head':'a'*40,'tree':'b'*40,'files':files}
    for when in ('before','after'): packet['source.'+when+'.json'] = encode({'schema':'bw.ring3.source.v1',**source})
    runtime = {'schema':'bw.ring3.runtime.v2','observationPolicy':'prelaunch-probes-and-before-after-file-readback',
        'platform':{'sysname':'Linux','release':'manufactured-not-runtime','machine':'x86_64'},
        'executables':{name:{'path':'/manufactured/'+name,'bytes':100,'sha256':digit*64} for name,digit in (('node','3'),('python','4'),('qemu','5'))},
        'versions':{'node':'v22.23.3','python':'Python 3.12.3','qemu':'QEMU emulator version 8.2.2 (manufactured)'},
        'qemuPackage':{'name':'qemu-system-x86','version':'1:8.2.2+ds-0ubuntu1','architecture':'amd64',
                       'files':{},'aliases':{},'probes':[]}}
    package=runtime['qemuPackage']
    for name,item in runtime['executables'].items():package['files'][item['path']]={k:item[k] for k in ('bytes','sha256')}|{'kind':name+'-binary'}
    for path,kind in (('/usr/bin/ldd','observation-tool'),('/usr/bin/dpkg-query','observation-tool'),
        ('/usr/bin/bash','tool-interpreter'),('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2','elf-interpreter'),
        ('/usr/lib/x86_64-linux-gnu/libc.so.6','shared-library'),
        ('/usr/lib/x86_64-linux-gnu/libtcg-needed.so.1','shared-library'),
        ('/usr/lib/x86_64-linux-gnu/qemu/accel-tcg-i386.so','tcg-module'),('/usr/share/qemu/keymaps/en-us','qemu-data')):
        package['files'][path]={'bytes':100,'sha256':'6'*64,'kind':kind}
    package['aliases']={'/lib':{'linkText':'usr/lib','target':'/usr/lib'},
        '/lib64':{'linkText':'usr/lib64','target':'/usr/lib64'},
        '/usr/lib64/ld-linux-x86-64.so.2':{'linkText':'../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2',
                                      'target':'/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'}}
    ldd='linux-vdso.so.1 (0x1234)\n\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x2345)\n\t/lib64/ld-linux-x86-64.so.2 (0x3456)\n'
    def probe(role,argv,stdout):
        package['probes'].append({'role':role,'argv':argv,'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},'exitCode':0,'stdout':stdout,'stderr':''})
    for name in ('node','python','qemu'):
        probe(name+'-version',[runtime['executables'][name]['path'],'--version'],runtime['versions'][name]+'\n')
        probe('ldd-'+name,['/usr/bin/ldd',runtime['executables'][name]['path']],ldd)
    probe('ldd-shell',['/usr/bin/ldd','/usr/bin/bash'],ldd)
    probe('ldd-dpkg-query',['/usr/bin/ldd','/usr/bin/dpkg-query'],ldd)
    probe('ldd-tcg',['/usr/bin/ldd','/usr/lib/x86_64-linux-gnu/qemu/accel-tcg-i386.so'],
          ldd+'\tlibtcg-needed.so.1 => /lib/x86_64-linux-gnu/libtcg-needed.so.1 (0x4567)\n')
    packages=['qemu-system-x86','qemu-system-common','qemu-system-data','seabios','ipxe-qemu']
    probe('package-version',['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*packages],
          ''.join(name+'\t1:8.2.2+ds-0ubuntu1\tamd64\n' for name in packages))
    probe('package-files',['/usr/bin/dpkg-query','-L',*packages],
          '/manufactured/qemu\n/usr/lib/x86_64-linux-gnu/qemu/accel-tcg-i386.so\n/usr/share/qemu/keymaps/en-us\n')
    for when in ('before','after'): packet['runtime.'+when+'.json'] = encode(runtime)
    # Actual argv predicates are tested by mutating these retained launch facts.
    # The bridge is source-bound separately; manufacturing argv is not execution.
    for role,pid,start,end,status in (('js',101,1000000000,2000000000,0),('qemu',102,3000000000,4000000000,1)):
        proc = {'schema':'bw.ring3.process.v1','role':role,
            'argv':['/manufactured/node','--input-type=module','--eval',reader.JS_DRIVER] if role=='js' else reader.qemu_argv('/manufactured/qemu'),
            'cwdRole':'checkout','environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
            'pid':pid,'pgid':pid,'parentPid':100,'startTicks':123,'spawnMonoNs':start,'reapMonoNs':end,
            'exitCode':status,'signal':None,'waitStatus':status<<8,'timedOut':False,
            'rusage':{'userSeconds':0.1,'systemSeconds':0.01,'maxRssKiB':1024},'firstFailure':None,'secondary':[]}
        packet[role+'/process.json'] = encode(proc)
    resources = {'schema':'bw.ring3.resources.v1',
        'enclosing':{'before':snapshot(1,enclosing=True),'after':snapshot(1,after=True)},
        'controller':{'pid':100,'before':snapshot(2,pid=100),'after':snapshot(2,after=True)},
        'children':{role:{'before':snapshot(inode),'after':snapshot(inode,after=True)} for role,inode in (('js',3),('qemu',4))},
        'firstFailure':None,'secondary':[]}
    packet['resources.json'] = encode(resources)
    observations = []
    names = ('eax','ecx','edx','ebx','esp','ebp','esi','edi')
    before = (287454020,2578103244,3723427584,1432778632,36864,195936478,305419896,2271560481)
    for i,(stage,eip,cpl,flags,call) in enumerate(zip(('before-int80','handler-entry','before-iretd','returned-ring3'),
            (20571,24576,24742,20573),(3,0,0,3),(514,2,2,514),(1000,1001,2000,2001))):
        regs = dict(zip(names,before));regs['esp'] = 32748 if cpl==0 else 36864
        if i>=2:regs['eax']=2712847316
        observations.append({'stage':stage,'beforeCall':call,'eip':eip,'linear':eip,'cpl':cpl,'eflags':flags,'cr0':1,'cr3':0,
            'registers':regs,'selectors':dict(zip(('es','cs','ss','ds','fs','gs'),(35,8 if cpl==0 else 27,16 if cpl==0 else 35,35,35,35))),
            'cs':{'base':0,'limit':4294967295,'default32':True},'ss':{'base':0,'limit':4294967295,'default32':True},
            'tr':{'selector':40,'base':8192,'limit':103,'present':True},'opcode':[205,128] if i==0 else [207] if i==2 else [137],
            'frame':[204]*20 if i==0 else list(memory[32748:32768])})
    packet['js/observations.json']=encode(observations)
    # Manufacture a causally possible journal, including zero-valued MOV bytes,
    # guard initialization and the later overwrite of actual interrupt frames.
    writes=[]; replay=bytearray(1048576)
    def store(address,data,call):
        for offset,value in enumerate(data):
            at=address+offset
            writes.append({'index':len(writes),'call':call,'address':at,'before':replay[at],'after':value})
            replay[at]=value
    for address,count in ((4096,48),(7168,16),(8192,104),(32704,96),(36800,96),(40896,96),
                           (16384,95),(20480,198),(24576,167),(25088,145)):
        store(address,rom[address:address+count],10)
    for at in (4109,4117,4125,4133,4141):store(at,memory[at:at+1],20)
    store(45036,memory[45036:45056],30)
    store(28672,memory[28672:28720],900);store(36860,memory[36860:36864],901)
    store(32748,memory[32748:32768],1000)
    store(28736,memory[28736:28784],1001)
    store(28864,memory[28864:28884],1100)
    store(32744,memory[32744:32748],1200)
    store(8196,memory[8196:8200],1300);store(28884,memory[28884:28888],1400)
    store(28800,memory[28800:28848],2001);store(36860,memory[36860:36864],2100)
    store(28888,memory[28888:28892],2200);store(40940,memory[40940:40960],2300)
    assert bytes(replay)==memory
    packet['js/writes.json']=encode(writes)
    packet['js/report.json']=encode({'schema':'bw.ring3.js-probe.v1','finiteRoundTripPass':True,'firstFailure':None,
        'calls':3000,'completed':True,'fixtureSha256':sha(rom),'memoryBeforeSha256':sha(bytes(1048576)),
        'memoryAfterSha256':sha(memory),'outputSha256':sha(output),'observations':4,
        'ports':[{'port':33,'value':255,'call':1},{'port':161,'value':255,'call':2}]})
    packet['qemu/report.json']=encode({'schema':'bw.ring3.qemu.v1','fixtureSha256':sha(rom),'outputSha256':sha(output),'firstFailure':None,'secondary':[]})
    packet['audit.json']=encode({'schema':'bw.ring3.audit.v1','head':source['head'],'sourceTree':source['tree'],
        'workflowSha256':'1'*64,'roles':[],'caps':dict(reader.CAPS),'firstFailure':None,'secondary':[]})
    external={'source':source,'runtime':runtime,'official':{'repository':'CrispStrobe/bw-board',
        'workflowPath':'.github/workflows/i80386-ring3-int-iret.yml','workflowSha256':'1'*64,'runId':1,'attempt':1,
        'event':'pull_request','eventAction':'labeled','head':source['head'],'label':'x86-ring3-int-iret-actual','jobId':2,
        'jobName':'actual','conclusion':'success','artifactId':3,'artifactBytes':0,'artifactSha256':'0'*64,
        'requiredSteps':dict.fromkeys(('Bounded JS and QEMU ring3 cases','Owned controller terminal and empty','Retain original evidence'),'success'),
        'enclosingCleanupSuccess':True}}
    return packet,external


def repack(packet, external):
    # Refresh nested byte-digest joins too. Semantic wire/RAM refusals must not
    # be accidental stale-report-hash refusals after the outer role rehash.
    if 'js/report.json' in packet:
        report=json.loads(packet['js/report.json'])
        for field,name in (('memoryBeforeSha256','js/memory.before.bin'),
                           ('memoryAfterSha256','js/memory.after.bin'),('outputSha256','js/stdout')):
            if name in packet:report[field]=sha(packet[name])
        packet['js/report.json']=encode(report)
    if 'qemu/report.json' in packet and 'qemu/stdout' in packet:
        report=json.loads(packet['qemu/report.json']);report['outputSha256']=sha(packet['qemu/stdout'])
        packet['qemu/report.json']=encode(report)
    audit=json.loads(packet['audit.json'])
    audit['roles']=[{'path':name,'bytes':len(data),'sha256':sha(data)} for name,data in sorted(packet.items()) if name!='audit.json']
    packet['audit.json']=encode(audit)
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,data in sorted(packet.items()):archive.writestr(name,data)
    raw=output.getvalue();external['official']['artifactBytes']=len(raw);external['official']['artifactSha256']=sha(raw)
    return raw


def change(packet, name, function):
    value=json.loads(packet[name]);function(value);packet[name]=encode(value)


def main():
    rom,manifest=pure_fixture();base,admission=manufacture(rom,manifest)
    assert reader.verify_artifact(repack(base,admission),admission)['pass'] is True
    results=[]
    def reject(name,mutation):
        packet,external=copy.deepcopy((base,admission));mutation(packet,external)
        raw=repack(packet,external)
        try:reader.verify_artifact(raw,external)
        except (reader.Refusal,ValueError,KeyError) as error:
            results.append({'name':name,'refused':True,'first':str(error)});return
        raise AssertionError('false acceptance: '+name)
    def frame_byte(packet,external,offset,value):
        change(packet,'js/observations.json',lambda rows:rows[1]['frame'].__setitem__(offset,value))
    reject('return-eip',lambda p,e:frame_byte(p,e,0,0))
    reject('saved-cs',lambda p,e:frame_byte(p,e,4,8))
    reject('saved-flags',lambda p,e:frame_byte(p,e,9,0))
    reject('old-esp',lambda p,e:frame_byte(p,e,13,0))
    reject('old-ss',lambda p,e:frame_byte(p,e,16,16))
    reject('missing-frame',lambda p,e:change(p,'js/observations.json',lambda x:x[1].update(frame=[])))
    reject('truncated-frame',lambda p,e:change(p,'js/observations.json',lambda x:x[1]['frame'].pop()))
    reject('missing-stage',lambda p,e:change(p,'js/observations.json',lambda x:x.pop()))
    reject('wrong-entry-cpl',lambda p,e:change(p,'js/observations.json',lambda x:x[1].update(cpl=3)))
    reject('wrong-return-cpl',lambda p,e:change(p,'js/observations.json',lambda x:x[3].update(cpl=0)))
    reject('uncleared-if',lambda p,e:change(p,'js/observations.json',lambda x:x[1].update(eflags=514)))
    reject('unrestored-if',lambda p,e:change(p,'js/observations.json',lambda x:x[3].update(eflags=2)))
    reject('register-changed',lambda p,e:change(p,'js/observations.json',lambda x:x[3]['registers'].update(ebx=1)))
    reject('wrong-iret-opcode',lambda p,e:change(p,'js/observations.json',lambda x:x[2].update(opcode=[144])))
    reject('wrong-tss',lambda p,e:change(p,'js/observations.json',lambda x:x[1]['tr'].update(base=0)))
    reject('instruction-order',lambda p,e:change(p,'js/observations.json',lambda x:x[2].update(beforeCall=1)))
    reject('calls-before-return',lambda p,e:change(p,'js/report.json',lambda x:x.update(calls=2000)))
    reject('reported-fault',lambda p,e:change(p,'js/report.json',lambda x:x.update(firstFailure={'name':'fault'})))
    reject('wrong-rom-source',lambda p,e:p.__setitem__('inputs/fixture.rom',bytes(65536)))
    reject('missing-runtime-after',lambda p,e:p.pop('runtime.after.json'))
    reject('source-after-drift',lambda p,e:change(p,'source.after.json',lambda x:x['files']['src/experimental/i80386.js'].update(sha256='9'*64)))
    reject('runtime-after-drift',lambda p,e:change(p,'runtime.after.json',lambda x:x['executables']['qemu'].update(sha256='9'*64)))
    def both_runtimes(packet,external,mutation):
        for when in ('before','after'):change(packet,'runtime.'+when+'.json',mutation)
        mutation(external['runtime'])
    reject('old-runtime-v1',lambda p,e:both_runtimes(p,e,lambda x:x.update(schema='bw.ring3.runtime.v1')))
    reject('missing-tcg-module',lambda p,e:both_runtimes(p,e,lambda x:x['qemuPackage']['files'].pop('/usr/lib/x86_64-linux-gnu/qemu/accel-tcg-i386.so')))
    reject('missing-ldd-interpreter',lambda p,e:both_runtimes(p,e,lambda x:x['qemuPackage']['files'].pop('/usr/bin/bash')))
    reject('missing-elf-interpreter',lambda p,e:both_runtimes(p,e,lambda x:x['qemuPackage']['files'].pop('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')))
    reject('missing-module-library',lambda p,e:both_runtimes(p,e,lambda x:x['qemuPackage']['files'].pop('/usr/lib/x86_64-linux-gnu/libtcg-needed.so.1')))
    reject('wrong-alias-target',lambda p,e:both_runtimes(p,e,lambda x:x['qemuPackage']['aliases']['/lib'].update(target='/usr')))
    reject('injected-probe-environment',lambda p,e:both_runtimes(p,e,lambda x:x['qemuPackage']['probes'][0]['environment'].update(LD_PRELOAD='/unadmitted.so')))
    reject('changed-historical-probe-stdout',lambda p,e:change(p,'runtime.after.json',lambda x:x['qemuPackage']['probes'][1].update(stdout='changed original\n')))
    reject('changed-after-file-readback',lambda p,e:change(p,'runtime.after.json',lambda x:x['qemuPackage']['files']['/usr/lib/x86_64-linux-gnu/libc.so.6'].update(sha256='9'*64)))
    reject('changed-after-alias-readback',lambda p,e:change(p,'runtime.after.json',lambda x:x['qemuPackage']['aliases']['/lib'].update(linkText='wrong',target='/wrong')))
    reject('missing-module-ldd-original',lambda p,e:both_runtimes(p,e,lambda x:x['qemuPackage'].update(probes=[row for row in x['qemuPackage']['probes'] if row['role']!='ldd-tcg'])))
    reject('wrong-probe-history-policy',lambda p,e:both_runtimes(p,e,lambda x:x.update(observationPolicy='copied-after-without-readback')))
    reject('wrong-official-attempt',lambda p,e:e['official'].update(attempt=2))
    reject('wrong-event-action',lambda p,e:e['official'].update(eventAction='opened'))
    reject('reporter-source-substitution',lambda p,e:change(p,'source.before.json',lambda x:x['files']['scripts/i80386-ring3-int-iret/fixture.mjs'].update(sha256='9'*64)))
    reject('wrong-qemu-launch',lambda p,e:change(p,'qemu/process.json',lambda x:x['argv'].__setitem__(8,'pentium')))
    reject('overlapping-engines',lambda p,e:change(p,'qemu/process.json',lambda x:x.update(spawnMonoNs=1000000001)))
    reject('timeout',lambda p,e:change(p,'qemu/process.json',lambda x:x.update(timedOut=True)))
    reject('unreaped-status',lambda p,e:change(p,'qemu/process.json',lambda x:x.update(waitStatus=15)))
    reject('populated-terminal',lambda p,e:change(p,'resources.json',lambda x:x['children']['js']['after'].update(procs=[101])))
    reject('oom',lambda p,e:change(p,'resources.json',lambda x:x['enclosing']['after']['raw'].update(memoryEvents='low 0\nhigh 0\nmax 0\noom 1\noom_kill 0\n')))
    reject('missing-noswap',lambda p,e:change(p,'resources.json',lambda x:x['controller']['before']['limits'].update(swapMax='max')))
    reject('parent-populated-with-zero-hierarchical-pids',lambda p,e:change(p,'resources.json',lambda x:x['enclosing']['before']['raw'].update(pidsCurrent='0\n')))
    reject('resource-alias',lambda p,e:change(p,'resources.json',lambda x:x['children']['qemu'].update(before=x['children']['js']['before'],after=x['children']['js']['after'])))
    reject('write-replay-missing',lambda p,e:change(p,'js/writes.json',lambda x:x.pop()))
    reject('write-before-altered',lambda p,e:change(p,'js/writes.json',lambda x:x[0].update(before=1)))
    def startup_padding(packet,external):
        # PUSH imm32 authored these zero high words. Co-mutate actual RAM and
        # its original byte journal, then repack refreshes EVERY hash join.
        after=bytearray(packet['js/memory.after.bin']);after[0xafec+6]=1
        packet['js/memory.after.bin']=bytes(after)
        change(packet,'js/writes.json',lambda rows:[row.update(after=1) for row in rows if row['address']==0xafec+6])
    reject('defined-startup-selector-high-word',startup_padding)
    def observation_prefix(packet,external):
        def mutate(rows):
            index=next(i for i,row in enumerate(rows) if row['call']==1000)
            rows.insert(index,{'index':index,'call':999,'address':0x7fec,'before':204,'after':42})
            for i,row in enumerate(rows):
                row['index']=i
                if row['call']==1000 and row['address']==0x7fec:row['before']=42
        change(packet,'js/writes.json',mutate)
    reject('observed-frame-disagrees-with-journal-prefix',observation_prefix)
    reject('delayed-handler-entry',lambda p,e:change(p,'js/observations.json',lambda x:x[1].update(beforeCall=1002)))
    reject('delayed-iret-return',lambda p,e:change(p,'js/observations.json',lambda x:x[3].update(beforeCall=2002)))
    reject('frame-write-before-int',lambda p,e:change(p,'js/writes.json',lambda x:[row.update(call=999) for row in x if 32748<=row['address']<32768 and row['call']==1000]))
    reject('returned-record-before-return',lambda p,e:change(p,'js/writes.json',lambda x:[row.update(call=2000) for row in x if 28800<=row['address']<28848]))
    reject('qemu-truncated-wire',lambda p,e:p.__setitem__('qemu/stdout',p['qemu/stdout'][:-1]))
    reject('qemu-register-mutant',lambda p,e:p.__setitem__('qemu/stdout',p['qemu/stdout'][:12]+b'\0'+p['qemu/stdout'][13:]))
    reject('qemu-stack-guard',lambda p,e:p.__setitem__('qemu/stdout',p['qemu/stdout'][:1429]+b'\0'+p['qemu/stdout'][1430:]))
    reject('qemu-copy-padding-only',lambda p,e:p.__setitem__('qemu/stdout',p['qemu/stdout'][:210]+b'\xaa'+p['qemu/stdout'][211:]))
    reject('packet-extra-role',lambda p,e:p.__setitem__('unclaimed',b'no'))
    reject('cleanup-primary',lambda p,e:change(p,'audit.json',lambda x:x.update(firstFailure={'phase':'cleanup'})))
    # Padding-only QEMU difference is allowed when its ORIGINAL and COPIED
    # padding still agree. Output equality across engines is not a predicate.
    positive,external=copy.deepcopy((base,admission))
    data=bytearray(positive['qemu/stdout'])
    for address in (0x70c0,0x7fec,0x9fec):
        offset=12
        for start,count in ((0x7000,224),(0x1000,48),(0x1800,1040),(0x2000,104),(0x7fc0,96),(0x8fc0,96),(0x9fc0,96)):
            if start <= address < start+count:
                for index in (6,7,18,19):data[offset+address-start+index]=0xa5
                break
            offset+=count
    positive['qemu/stdout']=bytes(data)
    change(positive,'qemu/report.json',lambda x:x.update(outputSha256=sha(data)))
    assert reader.verify_artifact(repack(positive,external),external)['pass'] is True
    print(json.dumps({'testOnly':True,'guestOrCpuExecuted':False,'qemuExecuted':False,
        'fullTwentyRolePositive':True,'independentPaddingPositive':True,
        'fullyRehashedSemanticRefusals':len(results),'controls':results},sort_keys=True))


if __name__=='__main__':main()
