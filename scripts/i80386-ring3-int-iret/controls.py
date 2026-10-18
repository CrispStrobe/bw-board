#!/usr/bin/env python3
"""MIT. Inert original-reader controls; no CPU, QEMU, cgroup or guest execution.

Only the pure authored ROM byte builder runs in Node. All observations, process,
runtime and kernel records below are manufactured and never actual admission.
The full positive includes independently assembled register/frame/RAM goldens.
"""
import copy
import contextlib
import importlib.util
import io
import json
import os
import stat
import struct
import subprocess
import sys
import unittest
import zipfile
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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


def prerequisite_fixture():
    """Manufactured literals only. No Node builder, CPU or kernel edges."""
    canonical=reader.canonical
    def wrapper(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
    data={name:('held '+name+'\n').encode() for name in reader.SETUP_SOURCE_PATHS}
    source={'schema':'bw.ring3.source.v1','head':'a'*40,'tree':'b'*40,'files':{name:{'bytes':len(raw),'sha256':sha(raw),
        'mode':'100644','blob':reader.hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()} for name,raw in data.items()}}
    runtime=b'{"pendingIndependentRuntimeAdmission":true}\n'
    request={'schema':'bw.ring3.approval-request.v1','repository':'CrispStrobe/bw-board','pullRequest':645,'head':'a'*40,'tree':'b'*40,
        'source':wrapper(canonical(source)),'runtime':{'commit':'c'*40,'tree':'d'*40,'path':'ring3-runtime-expectation.json','mode':'100644',
            'blob':reader.hashlib.sha1(b'blob '+str(len(runtime)).encode()+b'\0'+runtime).hexdigest(),'bytes':len(runtime),'sha256':sha(runtime)}}
    request_raw=canonical(request);expected={'schema':'bw.ring3.prerequisite-expectation.v1','runId':'123','attempt':1,
        'head':'a'*40,'tree':'b'*40,'requestSha256':sha(request_raw),'invoker':[1001,1002]}
    env={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40,
        'BW_RING3_APPROVED_REQUEST_SHA256':sha(request_raw),'SUDO_UID':'1001','SUDO_GID':'1002'}
    event={'action':'labeled','number':645,'repository':{'full_name':'CrispStrobe/bw-board'},'sender':{'login':'CrispStrobe'},
        'label':{'name':reader.LABEL},'pull_request':{'number':645,'state':'open',
            'body':'<!-- BW_RING3_ACTUAL_REQUEST_V1\n'+canonical(wrapper(request_raw)).decode().rstrip('\n')+'\nBW_RING3_ACTUAL_REQUEST_V1 -->',
            'head':{'sha':'a'*40,'repo':{'full_name':'CrispStrobe/bw-board','fork':False}},
            'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}}
    plan=canonical({'schema':'bw.ring3.launch-plan.v1','runId':'123','attempt':1,'head':'a'*40,'tree':'b'*40,'source':request['source']})
    originals={'request.original.json':request_raw,'event.original.json':canonical(event),'runtime-expectation.json':runtime,'launch-plan.json':plan}
    return env,expected,originals,data


@contextlib.contextmanager
def prerequisite_observer_edges(env,originals,data):
    state={'rows':{},'fds':{},'next':20,'events':[],'faults':{},'peakFds':0}
    def row(path,mode,uid=0,gid=0,raw=b'',device=1):
        state['rows'][str(path)]={'st_dev':device,'st_ino':len(state['rows'])+100,'st_mode':mode,'st_uid':uid,'st_gid':gid,
            'st_nlink':1,'st_size':len(raw) if stat.S_ISREG(mode) and device==1 else 0,'st_mtime_ns':1700000000000000000,'raw':raw}
    for path in ('/','/run','/checkout'):row(path,0o40755,*((1001,1002) if path=='/checkout' else (0,0)))
    row('/proc/self/cgroup',0o100444,raw=b'0::/actions/job\n')
    row('/proc/self/status',0o100444,raw=b'CapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapAmb:\t0000000000000000\n')
    admission='/run/bw-ring3-123-1-admission';row(admission,0o40755)
    for name,raw in originals.items():row(admission+'/'+name,0o100444,raw=raw)
    for name,raw in data.items():row('/checkout/'+name,0o100644,1001,1002,raw)
    base='/sys/fs/cgroup';row(base,0o40755,device=2)
    for name in ('cgroup.controllers','cgroup.subtree_control'):row(base+'/'+name,0o100644,raw=b'cpu memory pids\n',device=2)
    values={**{name:(value+'\n').encode() for name,value in reader.SETUP_LIMITS.items()},'cgroup.type':b'domain\n','cgroup.procs':b'',
        'pids.current':b'0\n','cgroup.events':b'populated 0\nfrozen 0\n','memory.events':b'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n',
        'cpu.stat':b'usage_usec 0\nuser_usec 0\nsystem_usec 0\n','memory.current':b'0\n','memory.peak':b'0\n','cgroup.subtree_control':b'cpu memory pids\n'}
    for role in reader.SETUP_ROLES:
        path=base+'/bw-ring3-123-1'+('-preparation' if role=='preparation' else '' if role=='enclosing' else '/'+role)
        owner=(0,0) if role=='preparation' else (1001,1002);row(path,0o40755,*owner,device=2)
        names=reader.SETUP_READS+(('cgroup.subtree_control',) if role=='enclosing' else ())+(('cgroup.kill',) if role in ('js','qemu') else ())
        for name in names:
            delegated=(role=='enclosing' and name=='cgroup.procs') or (role in ('js','qemu') and name in ('cgroup.procs','cgroup.kill'))
            row(path+'/'+name,0o100200 if name=='cgroup.kill' else 0o100644,*((1001,1002) if delegated else (0,0)),
                raw=values.get(name,b''),device=2)
    def info(path):
        if ('stat',path) in state['faults']:raise state['faults']['stat',path]
        return SimpleNamespace(**{key:value for key,value in state['rows'][path].items() if key!='raw'})
    def pathof(path,dir_fd=None):return str(Path(state['fds'][dir_fd]['path'])/path) if dir_fd is not None else str(path)
    def opened(path,flags,dir_fd=None):
        path=pathof(path,dir_fd);state['events'].append(('open',path,flags));info(path)
        assert not flags&(os.O_CREAT|os.O_TRUNC) and flags&os.O_NOFOLLOW
        if path.endswith('/cgroup.kill'):assert flags&os.O_PATH
        else:assert flags&os.O_ACCMODE==os.O_RDONLY
        state['next']+=1;fd=state['next'];state['fds'][fd]={'path':path,'offset':0};state['peakFds']=max(state['peakFds'],len(state['fds']));return fd
    def read(fd,cap):
        record=state['fds'][fd];path=record['path'];state['events'].append(('read',path))
        assert not path.endswith('/cgroup.kill')
        if ('read',path) in state['faults']:raise state['faults']['read',path]
        raw=state['rows'][path]['raw'];start=record['offset'];record['offset']+=cap;return raw[start:start+cap]
    def close(fd):
        path=state['fds'].pop(fd)['path'];state['events'].append(('close',path))
        if ('close',path) in state['faults']:raise state['faults']['close',path]
    with contextlib.ExitStack() as stack:
        for context in (patch.object(os,'getresuid',return_value=(0,)*3),patch.object(os,'getresgid',return_value=(0,)*3),
            patch.object(os,'open',side_effect=opened),patch.object(os,'read',side_effect=read),patch.object(os,'close',side_effect=close),
            patch.object(os,'fstat',side_effect=lambda fd:info(state['fds'][fd]['path'])),
            patch.object(os,'stat',side_effect=lambda path,dir_fd=None,**kw:info(pathof(path,dir_fd))),
            patch.object(Path,'lstat',lambda path:info(str(path))),patch.object(Path,'cwd',return_value=Path('/checkout')),
            patch.object(Path,'resolve',lambda path,**kw:path),patch.object(Path,'read_text',return_value='0::/actions/job\n'),
            patch.object(os,'write',side_effect=AssertionError('observer must never write')),
            patch.object(os,'fchown',side_effect=AssertionError('observer must never chown')),
            patch.object(os,'fchmod',side_effect=AssertionError('observer must never chmod')),
            patch.object(os,'mkdir',side_effect=AssertionError('observer must never mkdir'))):stack.enter_context(context)
        yield state


def prerequisite_manufactured():
    env,expected,originals,data=prerequisite_fixture();admission='/run/bw-ring3-123-1-admission'
    with prerequisite_observer_edges(env,originals,data) as state:
        rows={}
        for name,raw in originals.items():
            info=state['rows'][admission+'/'+name]
            rows[name]={'identity':{key:info['st_'+key] for key in ('dev','ino','mode','uid','gid','nlink','size','mtime_ns')},'bytes':len(raw),'sha256':sha(raw)}
        record={'schema':'bw.ring3.installation-envelope.v1','runId':'123','attempt':1,'requestSha256':expected['requestSha256'],
            'launchPlanSha256':sha(originals['launch-plan.json']),'files':rows,'directory':{},'ancestors':{},'observations':{}}
    originals['installation.original.json']=reader.canonical(record)
    with prerequisite_observer_edges(env,originals,data):stdout,passed=reader.observe_hosted_setup(env)
    assert passed,stdout.decode(errors='replace')
    process={'schema':'bw.ring3.process.v1','role':'discovery','argv':['/usr/bin/python3','-I','-B','scripts/i80386-ring3-int-iret/reader.py','--observe-hosted-setup'],
        'cwdRole':'checkout','environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',**env},'pid':201,'pgid':201,'parentPid':101,
        'startTicks':1,'spawnMonoNs':1,'reapMonoNs':2,'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
        'rusage':{'userSeconds':0.001,'systemSeconds':0.001,'maxRssKiB':1024},'firstFailure':None,'secondary':[]}
    def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
    originals['setup.observer.json']=reader.canonical({'schema':'bw.ring3.setup-observer-original.v1','process':process,'stdout':wrap(stdout),'stderr':wrap(b'')})
    originals['prerequisite.outer.json']=reader.canonical({'schema':'bw.ring3.prerequisites-original.v1','expectation':expected,
        'installation':True,'setup':True,'partialInstallation':{},'partialSetup':{},'firstFailure':None,'secondary':[]})
    return env,expected,originals,data


def prerequisite_controls():
    class Tests(unittest.TestCase):
        def test_independent_observer_and_original_reader_positive(self):
            env,expected,originals,data=prerequisite_manufactured()
            verdict=reader.verify_prerequisites(originals,expected)
            self.assertTrue(verdict['prerequisitesObserved']);self.assertFalse(verdict['guestQualified']);self.assertFalse(verdict['runtimeAdmitted'])
            self.assertEqual(len(reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(originals['setup.observer.json'])['stdout'])))['directories']),5)

        def test_observer_real_readonly_edges_partial_failures_and_write_only_metadata(self):
            env,expected,originals,data=prerequisite_manufactured()
            originals={name:originals[name] for name in reader.SETUP_INPUTS}
            for fault in ('none','read','read-close','owner','cap','membership','missing','close','source'):
                with prerequisite_observer_edges(env,originals,data) as state:
                    path='/sys/fs/cgroup/bw-ring3-123-1/js/memory.max'
                    if fault in ('read','read-close'):
                        state['faults']['read',path]=OSError('FIRST_READ')
                        if fault=='read-close':state['faults']['close',path]=OSError('SECOND_CLOSE')
                    elif fault=='owner':state['rows'][path]['st_uid']=1001
                    elif fault=='cap':state['rows'][path]['raw']=b'max\n'
                    elif fault=='missing':del state['rows']['/run/bw-ring3-123-1-admission/request.original.json']
                    elif fault=='close':state['faults']['close',path]=OSError('FIRST_CLOSE')
                    elif fault=='source':state['rows']['/checkout/scripts/i80386-ring3-int-iret/run.py']['st_mode']=0o100755
                    if fault=='membership':state['rows']['/proc/self/cgroup'].update(raw=b'0::/bw-ring3-123-1/js\n',st_size=len(b'0::/bw-ring3-123-1/js\n'))
                    raw,passed=reader.observe_hosted_setup(env)
                    self.assertEqual(passed,fault=='none',fault);self.assertLessEqual(len(raw),16384);self.assertEqual(state['fds'],{})
                    value=reader.parse(raw);self.assertLessEqual(state['peakFds'],11)
                    if fault in ('read','read-close'):self.assertEqual(value['firstFailure']['message'],'FIRST_READ');self.assertTrue(value['source'])
                    if fault=='read-close':self.assertIn('SECOND_CLOSE',[row['message'] for row in value['secondary']])
                    if fault=='none':
                        for role in ('js','qemu'):
                            self.assertEqual(value['directories'][role]['controls']['cgroup.kill']['meta'][2],0o100200)
                        self.assertFalse(any(item[0]=='read' and item[1].endswith('/cgroup.kill') for item in state['events']))

        def test_independent_reader_mutated_observations_and_coherent_rehashes_refuse(self):
            env,expected,originals,data=prerequisite_manufactured()
            def mutate_observer(records,mutate):
                observer=reader.parse(records['setup.observer.json'])
                value=reader.parse(reader.prerequisite_original(reader.canonical(observer['stdout'])));mutate(value)
                raw=reader.canonical(value);observer['stdout']={'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
                records['setup.observer.json']=reader.canonical(observer)
            mutations=[lambda v:v['directories']['preparation']['meta'].__setitem__(3,1001),
                lambda v:v['directories']['js']['controls']['cgroup.kill']['meta'].__setitem__(3,0),
                lambda v:v['directories']['enclosing']['controls']['cgroup.procs']['meta'].__setitem__(3,0),
                lambda v:v['directories']['controller']['controls']['memory.max'].__setitem__('raw','max\n'),
                lambda v:v['directories']['qemu']['controls']['cgroup.procs'].__setitem__('raw','999\n'),
                lambda v:v['directories']['qemu'].__setitem__('meta',v['directories']['js']['meta']),
                lambda v:v['inputs']['launch-plan.json'].__setitem__('sha256','f'*64),
                lambda v:v['source']['scripts/i80386-ring3-int-iret/run.py'].__setitem__('sha256','f'*64),
                lambda v:v.__setitem__('membership','0::/bw-ring3-123-1-preparation\n')]
            for mutation in mutations:
                changed=copy.deepcopy(originals);mutate_observer(changed,mutation)
                with self.assertRaises((reader.Refusal,ValueError)):reader.verify_prerequisites(changed,expected)
            for key,value in (('requestSha256','0'*64),('head','f'*40),('tree','f'*40),('attempt',True),('invoker',[0,0])):
                with self.assertRaises(reader.Refusal):reader.verify_prerequisites(originals,dict(expected,**{key:value}))
            for name in originals:
                changed=dict(originals);changed.pop(name)
                with self.assertRaises(reader.Refusal):reader.verify_prerequisites(changed,expected)

        def test_dropped_admitter_fixed_readonly_file_edges_and_uid_capability_refusals(self):
            env,expected,originals,data=prerequisite_manufactured()
            for fault in ('none','root','capability','membership','file-mode','file-links'):
                with prerequisite_observer_edges(env,originals,data) as state:
                    directory='/checkout/build/i80386-ring3-int-iret-prerequisites'
                    def add(path,mode,raw=b''):
                        state['rows'][path]={'st_dev':1,'st_ino':len(state['rows'])+100,'st_mode':mode,'st_uid':1001,'st_gid':1002,
                            'st_nlink':1,'st_size':len(raw),'st_mtime_ns':1700000000000000000,'raw':raw}
                    add(directory,0o40700)
                    for name,raw in originals.items():add(directory+'/'+name,0o100400,raw)
                    if fault=='capability':state['rows']['/proc/self/status']['raw']=state['rows']['/proc/self/status']['raw'].replace(
                        b'CapEff:\t0000000000000000',b'CapEff:\t0000000000000001')
                    elif fault=='membership':state['rows']['/proc/self/cgroup']['raw']=b'0::/bw-ring3-123-1/controller\n'
                    elif fault=='file-mode':state['rows'][directory+'/request.original.json']['st_mode']=0o100600
                    elif fault=='file-links':state['rows'][directory+'/request.original.json']['st_nlink']=2
                    with patch.object(os,'getresuid',return_value=(0,)*3 if fault=='root' else (1001,)*3),\
                         patch.object(os,'getresgid',return_value=(1002,)*3),patch.object(os,'getgroups',return_value=[]):
                        if fault=='none':self.assertTrue(reader.admit_hosted_prerequisites(env)['prerequisitesObserved'])
                        else:
                            with self.assertRaises(reader.Refusal):reader.admit_hosted_prerequisites(env)
                    self.assertEqual(state['fds'],{})

        def test_prerequisite_log_version_framing_and_original_only_positive(self):
            env,expected,originals,data=prerequisite_manufactured();verdict=reader.verify_prerequisites(originals,expected)
            observer=reader.parse(originals['setup.observer.json']);process=copy.deepcopy(observer['process'])
            process.update(argv=['/usr/bin/python3','-I','-B','scripts/i80386-ring3-int-iret/reader.py','--admit-hosted-prerequisites'],
                pid=202,pgid=202,startTicks=2,spawnMonoNs=3,reapMonoNs=4)
            raw=reader.canonical(verdict);wrapper={'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            originals['prerequisite.reader.json']=reader.canonical({'schema':'bw.ring3.prerequisite-reader-original.v1','process':process,'stdout':wrapper,'stderr':observer['stderr']})
            lines=[]
            for name,raw in sorted(originals.items()):
                encoded=reader.base64.b64encode(raw).decode();chunks=[encoded[i:i+3072] for i in range(0,len(encoded),3072)]
                for index,part in enumerate(chunks):lines.append(b'RING3_PREREQUISITE '+reader.canonical({'schema':'bw.ring3.prerequisite-log.v1',
                    'name':name,'index':index,'count':len(chunks),'bytes':len(raw),'sha256':sha(raw),'data':part}))
            log=b''.join(lines);self.assertEqual(reader.verify_prerequisite_log(log,expected),verdict)
            for changed in (b''.join(lines[:-1]),lines[0]+log,log.replace(b'RING3_PREREQUISITE ',b'RING3_ORIGINAL '),
                log.replace(b'"schema":"bw.ring3.prerequisite-log.v1"',b'"schema":"bw.ring3.prerequisite-log.v0"',1),
                b'not-a-timestamp '+log):
                with self.assertRaises((reader.Refusal,ValueError)):reader.verify_prerequisite_log(changed,expected)
            for path in ('0::/actions/../job\n','0:://actions\n','0::/actions/./job\n','0::/actions/job/\n'):
                with self.assertRaises(reader.Refusal):reader.setup_membership(path,'123')
            same_data=bytes(4608)
            row={'schema':'bw.ring3.prerequisite-log.v1','name':'setup.observer.json','index':0,'count':2,
                 'bytes':len(same_data),'sha256':sha(same_data),'data':'A'*3072}
            duplicate=b'RING3_PREREQUISITE '+reader.canonical(row)
            with self.assertRaises(reader.Refusal):reader.decode_prerequisite_log(duplicate+duplicate)

    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'prerequisite controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'guestOrResourceOperationExecuted':False,'pass':True}))


def runtime_fixture():
    class Files:
        def __init__(self):
            paths=[reader.RUNTIME_NODE,'/usr/bin/python3.12',reader.RUNTIME_QEMU,'/usr/bin/ldd','/usr/bin/dpkg-query','/usr/bin/bash',reader.RUNTIME_TCG,
                '/usr/lib/x86_64-linux-gnu/libc.so.6','/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2','/usr/share/qemu/bios.bin',
                '/usr/lib/python3.12/ssl.py','/usr/lib/python3.12/zipfile/__init__.py']
            self.facts={path:{'bytes':1024,'sha256':sha(path.encode()),'mode':0o755 if path in paths[:6] or 'ld-linux' in path else 0o644} for path in paths}
            for name,path in (('node',reader.RUNTIME_NODE),('qemu',reader.RUNTIME_QEMU)):self.facts[path].update(reader.RUNTIME_SELECTED[name])
            self.prefixes={path:b'\x7fELF inert metadata fixture' for path in paths};self.prefixes['/usr/bin/ldd']=b'#!/bin/bash\n'
            self.metadata={};self.events=[]
            self.aliases={'/bin':{'linkText':'usr/bin','target':'/usr/bin'},'/usr/bin/python3':{'linkText':'python3.12','target':'/usr/bin/python3.12'},
                '/lib64/ld-linux-x86-64.so.2':{'linkText':'/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2','target':'/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'}}
        def resolve(self,path):
            target=reader.resolve_alias(path,self.aliases)
            return target,{name:item for name,item in self.aliases.items() if path==name or path.startswith(name+'/')}
        def fact(self,path):
            self.events.append(('file',path));row=self.facts[path]
            self.metadata[path]=[1,list(self.facts).index(path)+100,stat.S_IFREG|row['mode'],0,0,1,row['bytes'],1700000000000000000]
            return dict(row)
        def alias(self,path):self.events.append(('alias',path));return dict(self.aliases[path])
        def is_file(self,path):return self.resolve(path)[0] in self.facts
        def python_files(self):return ['/usr/lib/python3.12/ssl.py','/usr/lib/python3.12/zipfile/__init__.py']
        def mapped_libraries(self):
            raw=b'1000-2000 r-xp 00000000 00:00 1 /usr/lib/x86_64-linux-gnu/libc.so.6\n'
            self.maps_original={'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            return ['/usr/lib/x86_64-linux-gnu/libc.so.6']
        def platform(self):return {'sysname':'Linux','release':'6.8.0-fixture','machine':'x86_64'}
    files=Files();processes=[]
    def probe(argv):
        files.events.append(('probe',list(argv)))
        if argv[0]=='/usr/bin/ldd':output='libc.so.6 => /usr/lib/x86_64-linux-gnu/libc.so.6 (0x1234)\n/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 (0x5678)\n'
        elif '-W' in argv:output=''.join(name+'\t'+('1:8.2.2+ds-0ubuntu1.18' if name.startswith('qemu-') else '1.0')+'\t'+('amd64' if name in ('qemu-system-x86','qemu-system-common') else 'all')+'\n' for name in reader.PACKAGE_NAMES)
        elif '-L' in argv:output=reader.RUNTIME_QEMU+'\n'+reader.RUNTIME_TCG+'\n/usr/share/qemu/bios.bin\n'
        else:output=('v22.23.3' if argv[0]==reader.RUNTIME_NODE else 'QEMU emulator version 8.2.2 (manufactured)' if argv[0]==reader.RUNTIME_QEMU else 'Python 3.12.3')+'\n'
        process={'schema':'bw.ring3.inventory-process.v1','argv':list(argv),'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
            'pid':201+len(processes),'pgid':201+len(processes),'parentPid':101,'startTicks':1+len(processes),
            'spawnMonoNs':1+len(processes)*10,'reapMonoNs':2+len(processes)*10,'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
            'rusage':{'userSeconds':0.001,'systemSeconds':0.001,'maxRssKiB':1024},'firstFailure':None,'secondary':[]}
        processes.append(process);return process,{'stdout':output.encode(),'stderr':b''}
    return files,probe


def runtime_manufactured():
    files,probe=runtime_fixture();inventory=reader.RuntimeInventory(files,probe);raw=inventory.discover();value=reader.parse(raw)
    qemu=next(row for row in value['packages'] if row['name']=='qemu-system-x86')
    original={'schema':'bw.ring3.runtime.v2','observationPolicy':'prelaunch-probes-and-before-after-file-readback','platform':value['platform'],
        'executables':value['executables'],'versions':value['versions'],'qemuPackage':{'name':qemu['name'],'version':qemu['version'],
        'architecture':qemu['architecture'],'files':{path:{key:row[key] for key in ('bytes','sha256','kind')} for path,row in value['files'].items()
            if path!='/usr/lib/python3.12/zipfile/__init__.py'},'aliases':value['aliases'],'probes':inventory.probes}}
    return raw,value,original,files,inventory


def runtime_controls():
    class Tests(unittest.TestCase):
        @contextlib.contextmanager
        def process_edges(self,fault=None):
            state={'fds':{},'events':[],'clock':0,'clockCalls':0,'waited':False,'out':0}
            stdout=SimpleNamespace(fileno=lambda:10,close=lambda:state['events'].append('stdout-close'))
            stderr=SimpleNamespace(fileno=lambda:11,close=lambda:state['events'].append('stderr-close'))
            process=SimpleNamespace(pid=201,stdout=stdout,stderr=stderr,returncode=None)
            class Selector:
                def __init__(self):self.rows={}
                def register(self,stream,events,name):self.rows[stream.fileno()]=SimpleNamespace(fileobj=stream,data=name)
                def unregister(self,stream):self.rows.pop(stream.fileno())
                def select(self,timeout):return [(row,None) for row in list(self.rows.values())]
                def get_map(self):return self.rows
                def close(self):state['events'].append('selector-close')
            def opened(path,flags):
                assert path=='/proc/201/stat' and flags&os.O_NOFOLLOW;state['events'].append('identity-open');return 12
            def read(fd,cap):
                if fd==12:
                    fields=['R','102' if fault=='identity' else '101','201','201']+['0']*15+['9']
                    return ('201 (metadata) '+' '.join(fields)).encode()
                if fd==11:return b''
                state['out']+=1
                if fault=='overflow':return b'x'*16385 if state['out']<3 else b''
                if fault=='late-overflow':return b'x' if state['out']==1 else b'x'*16385 if state['out']==2 else b''
                if fault=='noisy':return b'x'*16385
                if fault=='drain':return b'x'
                return b'ORIGINAL_METADATA' if state['out']==1 else b''
            def wait(pid,flags):
                assert pid==201 and flags==os.WNOHANG
                if state['waited']:return 0,0,None
                state['waited']=True;return 201,(7<<8 if fault=='nonzero' else 0),SimpleNamespace(ru_utime=.001,ru_stime=.001,ru_maxrss=1024)
            def clock():
                state['clockCalls']+=1
                if state['clockCalls']>100:raise AssertionError('MOCK_CLOCK_AUDIT_LIMIT')
                state['clock']+=11000000000 if fault=='timeout' else 100000000 if fault=='noisy' else 1000000000
                return state['clock']
            with contextlib.ExitStack() as stack:
                for context in (patch.object(reader.subprocess,'Popen',return_value=process),patch.object(reader.selectors,'DefaultSelector',Selector),
                    patch.object(os,'open',side_effect=opened),patch.object(os,'read',side_effect=read),patch.object(os,'close',side_effect=lambda fd:state['events'].append('identity-close')),
                    patch.object(os,'set_blocking'),patch.object(os,'wait4',side_effect=wait),patch.object(os,'getpid',return_value=101),
                    patch.object(os,'killpg',side_effect=lambda pid,sig:state['events'].append(('kill',pid,sig))),
                    patch.object(reader.signal,'signal'),patch.object(reader.signal,'getsignal',return_value=reader.signal.SIG_DFL),
                    patch.object(reader.time,'monotonic_ns',side_effect=clock)):
                    stack.enter_context(context)
                yield state

        def test_independent_inventory_and_stable_projection_accept_aslr_changes(self):
            raw,value,original,files,inventory=runtime_manufactured()
            self.assertEqual(reader.runtime_expectation(raw,sha(raw)),value)
            self.assertEqual(reader.verify_runtime_stable_original(original,raw,sha(raw)),value)
            changed=copy.deepcopy(original)
            for probe in changed['qemuPackage']['probes']:
                if probe['role'].startswith('ldd-'):probe['stdout']=probe['stdout'].replace('0x1234','0xabcdef1234').replace('0x5678','0xabcdef5678')
            self.assertEqual(reader.verify_runtime_stable_original(changed,raw,sha(raw)),value)
            self.assertNotEqual(original['qemuPackage']['probes'],changed['qemuPackage']['probes'])
            self.assertEqual(len(inventory.processes),11)
            before=len(files.events)
            with self.assertRaises(reader.Refusal):inventory.discover()
            self.assertEqual(len(files.events),before)

        def test_inventory_selected_engine_mismatch_refuses_before_any_tool(self):
            for name,path in (('node',reader.RUNTIME_NODE),('qemu',reader.RUNTIME_QEMU),('mode',reader.RUNTIME_NODE)):
                files,probe=runtime_fixture()
                if name=='mode':files.facts[path]['mode']=0o644
                else:files.facts[path]['sha256']='0'*64
                inventory=reader.RuntimeInventory(files,probe)
                with self.assertRaisesRegex(reader.Refusal,'historical selected|executable mode'):inventory.discover()
                self.assertEqual(inventory.probes,[]);self.assertEqual(inventory.processes,[])
                self.assertTrue(inventory.partial['files'])
                with self.assertRaisesRegex(reader.Refusal,'consumed'):inventory.discover()
            files,probe=runtime_fixture();inventory=reader.RuntimeInventory(files,probe)
            with self.assertRaises(reader.Refusal):inventory.observe('qemu-version',['/arbitrary/qemu','--version'])
            self.assertFalse(any(item[0]=='probe' for item in files.events))

        def test_stable_expectation_wrong_pins_unknown_graph_and_rehashed_policy_refuse(self):
            raw,value,original,files,inventory=runtime_manufactured()
            with self.assertRaises(reader.Refusal):reader.runtime_expectation(raw,'0'*64)
            edits=[lambda v:v['files'][reader.RUNTIME_QEMU].__setitem__('mode',0o777),
                lambda v:v['executables']['qemu'].__setitem__('sha256','0'*64),
                lambda v:v['packages'][3].__setitem__('version','8.2.2-changed'),
                lambda v:v['probes'][0]['argv'].__setitem__(0,'/arbitrary/tool'),
                lambda v:v['files'].__setitem__('/alias/../bad',dict(next(iter(v['files'].values())))),
                lambda v:v['probes'].pop(),lambda v:v.__setitem__('extra',True)]
            for edit in edits:
                changed=copy.deepcopy(value);edit(changed);encoded=reader.canonical(changed)
                with self.assertRaises((reader.Refusal,KeyError,ValueError)):reader.runtime_expectation(encoded,sha(encoded))
            for fault in ('extra-file','ldd-path','package-version','package-path','omit-tool'):
                changed=copy.deepcopy(original);package=changed['qemuPackage']
                if fault=='extra-file':package['files']['/usr/lib/extra.so']={'bytes':1,'sha256':'f'*64,'kind':'shared-library'}
                elif fault=='ldd-path':package['probes'][0]['stdout']=package['probes'][0]['stdout'].replace('/usr/lib/x86_64-linux-gnu/libc.so.6','/usr/lib/unapproved.so')
                elif fault=='package-version':next(row for row in package['probes'] if row['role']=='package-version')['stdout']=next(row for row in package['probes'] if row['role']=='package-version')['stdout'].replace('1:8.2.2+ds-0ubuntu1.18','1:8.2.2+ds-0ubuntu1.19')
                elif fault=='package-path':next(row for row in package['probes'] if row['role']=='package-files')['stdout']+='/usr/share/qemu/extra.bin\n'
                else:package['files'].pop('/usr/bin/dpkg-query')
                with self.assertRaises((reader.Refusal,KeyError)):reader.verify_runtime_stable_original(changed,raw,sha(raw))

        def test_real_inventory_metadata_process_edges_caps_identity_and_no_signal_after_reap(self):
            for fault in (None,'nonzero','overflow','late-overflow','noisy','timeout','identity','drain'):
                with self.process_edges(fault) as state:
                    process,streams=reader.inventory_probe(['/usr/bin/ldd','/usr/bin/bash'])
                self.assertLessEqual(len(streams['stdout']),16384);self.assertLessEqual(len(streams['stderr']),16384)
                self.assertIn('stdout-close',state['events']);self.assertIn('stderr-close',state['events'])
                if fault is None:self.assertIsNone(process['firstFailure']);self.assertEqual(streams['stdout'],b'ORIGINAL_METADATA');self.assertEqual(process['exitCode'],0)
                else:self.assertIsNotNone(process['firstFailure'])
                kills=[event for event in state['events'] if isinstance(event,tuple) and event[0]=='kill']
                self.assertLessEqual(len(kills),1)
                if fault in ('identity','drain','nonzero','late-overflow',None):self.assertEqual(kills,[])
                if fault=='overflow':self.assertEqual(streams['stdout'],b'x'*16384)
                if fault=='timeout':self.assertTrue(process['timedOut'])
                if fault=='noisy':self.assertLess(state['clockCalls'],50);self.assertLessEqual(len(process['secondary']),2)

        def test_independent_real_file_hash_modes_and_bounded_metadata_backend(self):
            env,expected,originals,data=prerequisite_manufactured()
            for fault in ('none','mode','extent','close'):
                with prerequisite_observer_edges(env,originals,data) as state:
                    path='/fixture/selected.so';raw=b'\x7fELF exact held metadata'
                    state['rows'][path]={'st_dev':1,'st_ino':999,'st_mode':0o100644,'st_uid':0,'st_gid':0,'st_nlink':1,'st_size':len(raw),
                        'st_mtime_ns':1700000000000000000,'raw':raw}
                    if fault=='mode':state['rows'][path]['st_mode']=0o100666
                    elif fault=='extent':state['rows'][path]['st_size']+=1
                    elif fault=='close':state['faults']['close',path]=OSError('ORIGINAL_HASH_CLOSE')
                    backend=reader.InventoryFiles()
                    if fault=='none':self.assertEqual(backend.fact(path),{'bytes':len(raw),'sha256':sha(raw),'mode':0o644});self.assertEqual(backend.prefixes[path],raw)
                    else:
                        with self.assertRaises((reader.Refusal,OSError)):backend.fact(path)
                    self.assertEqual(state['fds'],{})

        def test_real_inventory_event_source_parent_entry_to_offline_log_admission(self):
            env,expected,old_originals,data=prerequisite_fixture();source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old_originals['request.original.json'])['source'])))
            source_raw=reader.canonical(source)
            def wrapper(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            request={'schema':'bw.ring3.inventory-request.v1','repository':'CrispStrobe/bw-board','pullRequest':645,'head':'a'*40,'tree':'b'*40,
                'source':wrapper(source_raw),'selected':{'node':{'path':reader.RUNTIME_NODE,**reader.RUNTIME_SELECTED['node']},'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}}}
            request_raw=reader.canonical(request);event=reader.parse(old_originals['event.original.json'])
            event['label']['name']='x86-ring3-runtime-inventory'
            event['pull_request']['body']='<!-- BW_RING3_RUNTIME_INVENTORY_V1\n'+reader.canonical(wrapper(request_raw)).decode().rstrip('\n')+'\nBW_RING3_RUNTIME_INVENTORY_V1 -->'
            event_raw=reader.canonical(event)
            env={**env,'GITHUB_EVENT_PATH':'/inventory-event.json','GITHUB_EVENT_NAME':'pull_request','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
                'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'runtime-inventory','GITHUB_WORKFLOW_SHA':'e'*40,
                'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge',
                'BW_RING3_INVENTORY_REQUEST_SHA256':sha(request_raw)}
            for fault in ('none','pin','source','historical','parent-disabled'):
                with prerequisite_observer_edges(env,old_originals,data) as state:
                    state['rows']['/inventory-event.json']={'st_dev':1,'st_ino':999,'st_mode':0o100644,'st_uid':1001,'st_gid':1002,
                        'st_nlink':1,'st_size':len(event_raw),'st_mtime_ns':1700000000000000000,'raw':event_raw}
                    changed_env=dict(env);files,probe=runtime_fixture()
                    if fault=='pin':changed_env['BW_RING3_INVENTORY_REQUEST_SHA256']='0'*64
                    elif fault=='source':state['rows']['/checkout/scripts/i80386-ring3-int-iret/reader.py']['raw']=b'changed source'
                    elif fault=='historical':files.facts[reader.RUNTIME_QEMU]['sha256']='f'*64
                    elif fault=='parent-disabled':state['rows']['/sys/fs/cgroup/cgroup.subtree_control']['raw']=b'cpu\n'
                    with patch.object(os,'getresuid',return_value=(1001,)*3),patch.object(os,'getresgid',return_value=(1002,)*3):
                        originals,passed=reader.runtime_inventory_entry(changed_env,files,probe)
                    self.assertEqual(passed,fault in ('none','parent-disabled'),fault);self.assertEqual(state['fds'],{})
                    log=io.BytesIO();reader.emit_runtime_inventory(originals,log.write,log.flush);raw=log.getvalue()
                    if fault not in ('none','parent-disabled'):
                        value=reader.parse(originals['runtime.inventory.json']);self.assertIsNotNone(value['firstFailure'])
                        if fault in ('pin','source','historical'):self.assertFalse(any(row[0]=='probe' for row in files.events))
                        continue
                    external={'schema':'bw.ring3.inventory-expectation.v1','requestSha256':sha(request_raw),'runId':'123','attempt':1,
                        'head':'a'*40,'tree':'b'*40,'workflowSha':'e'*40,'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                        'jobId':12345,'jobName':'runtime-inventory','conclusion':'success','logBytes':len(raw),'logSha256':sha(raw)}
                    verdict=reader.verify_runtime_inventory_log(raw,external)
                    self.assertFalse(verdict['candidateReviewed']);self.assertFalse(verdict['actualRunApproved'])
                    self.assertEqual(verdict['parentControllersAlreadyEnabled'],fault=='none')
                    for cut in ('maps','python','process'):
                        changed_originals=dict(originals);changed_value=reader.parse(originals['runtime.inventory.json'])
                        held=changed_value['inventory']
                        if cut=='maps':held['mappedLibraries']=[]
                        elif cut=='python':held['pythonFiles']=['/unapproved/python.py']
                        else:held['processes'][0]['process']['argv'][0]='/unapproved/tool'
                        changed_originals['runtime.inventory.json']=reader.canonical(changed_value)
                        output=io.BytesIO();reader.emit_runtime_inventory(changed_originals,output.write,output.flush);changed=output.getvalue()
                        with self.assertRaises(reader.Refusal):reader.verify_runtime_inventory_log(changed,dict(external,logBytes=len(changed),logSha256=sha(changed)))
                    for key,value in (('requestSha256','0'*64),('workflowSha','f'*40),('workflowFileSha256','0'*64),('attempt',True)):
                        with self.assertRaises(reader.Refusal):reader.verify_runtime_inventory_log(raw,dict(external,**{key:value}))
                    changed=raw+raw.splitlines(keepends=True)[0]
                    with self.assertRaises(reader.Refusal):reader.verify_runtime_inventory_log(changed,dict(external,logBytes=len(changed),logSha256=sha(changed)))

        def test_inventory_cli_guard_and_coherent_callback_descriptor_replacement_refuse(self):
            with patch.object(sys,'argv',['reader.py','--inventory-runtime']),patch.object(reader,'runtime_inventory_entry',side_effect=AssertionError('no event or factory before inventory guard')):
                with self.assertRaisesRegex(reader.Refusal,'metadata inventory disabled'):reader.main()
            files,probe=runtime_fixture();inventory=reader.RuntimeInventory(files,probe)
            inventory.executables={'node':reader.RUNTIME_NODE,'python':'/usr/bin/python3.12','qemu':reader.RUNTIME_QEMU}
            def malicious(argv):
                argv[0]='/unapproved/tool';return probe(argv)
            inventory.probe=malicious
            with self.assertRaises(reader.Refusal):inventory.observe('qemu-version',[reader.RUNTIME_QEMU,'--version'])

    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'independent runtime controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'guestOrResourceOperationExecuted':False,'pass':True}))


if __name__=='__main__':
    if sys.argv[1:]==['--prerequisites-only']:prerequisite_controls()
    elif sys.argv[1:]==['--runtime-only']:runtime_controls()
    else:main()
