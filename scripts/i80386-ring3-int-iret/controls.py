#!/usr/bin/env python3
"""MIT. Inert original-reader controls; no CPU, QEMU, cgroup or guest execution.

Only the pure authored ROM byte builder runs in Node. All observations, process,
runtime and kernel records below are manufactured and never actual admission.
The full positive includes independently assembled register/frame/RAM goldens.
"""
import copy
import base64
import contextlib
import importlib.util
import inspect
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

        def test_rejected_file_raw_stat_extent_readback_and_close_preserve_primary(self):
            env,expected,originals,data=prerequisite_fixture()
            for fault in ('none','mode','directory','zero','oversize','read','open','close','mode-readback-close'):
                with self.subTest(fault=fault),prerequisite_observer_edges(env,originals,data) as state:
                    path='/fixture/rejected.so';raw=b'\x7fELF inert selected bytes'
                    row={'st_dev':1,'st_ino':999,'st_mode':0o100644,'st_uid':0,'st_gid':0,'st_nlink':1,'st_size':len(raw),
                        'st_mtime_ns':1700000000000000000,'raw':raw};state['rows'][path]=row
                    if fault in ('mode','mode-readback-close'):row['st_mode']=0o100666
                    elif fault=='directory':row['st_mode']=0o40755
                    elif fault=='zero':row['st_size']=0
                    elif fault=='oversize':row['st_size']=268435457
                    elif fault=='read':state['faults']['read',path]=OSError('FIRST_REJECTED_READ')
                    if fault in ('close','mode-readback-close'):state['faults']['close',path]=OSError('SECONDARY_REJECTED_CLOSE')
                    held_stat=os.fstat;opened=os.open;calls=0
                    def fstat(fd):
                        nonlocal calls
                        calls+=1
                        if fault=='mode-readback-close' and calls>1:raise OSError('SECONDARY_REJECTED_READBACK')
                        return held_stat(fd)
                    def open_(name,flags,**kw):
                        if fault=='open':raise PermissionError('FIRST_REJECTED_OPEN')
                        return opened(name,flags,**kw)
                    backend=reader.InventoryFiles()
                    with patch.object(os,'fstat',side_effect=fstat),patch.object(os,'open',side_effect=open_):
                        if fault=='none':
                            self.assertEqual(backend.fact(path),{'bytes':len(raw),'sha256':sha(raw),'mode':0o644})
                            self.assertEqual(backend.rejected,{})
                        else:
                            with self.assertRaises((reader.Refusal,OSError)) as caught:backend.fact(path)
                            rejected=backend.rejected[path]
                            self.assertEqual(rejected['path'],path);self.assertTrue(rejected['canonical'])
                            self.assertEqual(rejected['namedBefore'],reader.setup_metadata(SimpleNamespace(**row)))
                            self.assertEqual(rejected['firstFailure']['message'],str(caught.exception))
                            self.assertEqual(rejected['secondary'],getattr(caught.exception,'setup_secondary',[]))
                            self.assertEqual(rejected['closeAttempted'],fault!='open')
                            self.assertEqual(rejected['closeSucceeded'],fault not in ('open','close','mode-readback-close'))
                            if fault in ('mode','directory','zero','oversize','mode-readback-close'):
                                self.assertEqual(rejected['firstFailure']['message'],'bounded inventory regular file and mode')
                                self.assertEqual(rejected['heldBefore'],rejected['namedBefore'])
                                self.assertEqual(rejected['bytesRead'],0)
                                self.assertNotIn(('read',path),state['events'])
                            if fault=='mode-readback-close':
                                self.assertEqual([r['message'] for r in rejected['secondary']],
                                    ['SECONDARY_REJECTED_READBACK','SECONDARY_REJECTED_CLOSE'])
                    self.assertEqual(state['fds'],{})

        def test_rejected_file_real_inventory_cli_retains_failed_raw_original_without_tools(self):
            env,expected,old_originals,data=prerequisite_fixture()
            source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old_originals['request.original.json'])['source'])))
            def wrapper(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            request={'schema':'bw.ring3.inventory-request.v1','repository':'CrispStrobe/bw-board','pullRequest':645,'head':'a'*40,'tree':'b'*40,
                'source':wrapper(reader.canonical(source)),'selected':{'node':{'path':reader.RUNTIME_NODE,**reader.RUNTIME_SELECTED['node']},
                'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}}}
            request_raw=reader.canonical(request);event=reader.parse(old_originals['event.original.json']);event['label']['name']='x86-ring3-runtime-inventory'
            event['pull_request']['body']='<!-- BW_RING3_RUNTIME_INVENTORY_V1\n'+reader.canonical(wrapper(request_raw)).decode().rstrip('\n')+'\nBW_RING3_RUNTIME_INVENTORY_V1 -->'
            event_raw=reader.canonical(event)
            env={**env,'GITHUB_EVENT_PATH':'/inventory-event.json','GITHUB_EVENT_NAME':'pull_request','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
                'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'runtime-inventory','GITHUB_WORKFLOW_SHA':'e'*40,
                'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge',
                'BW_RING3_INVENTORY_REQUEST_SHA256':sha(request_raw)}
            with prerequisite_observer_edges(env,old_originals,data) as state:
                state['rows']['/inventory-event.json']={'st_dev':1,'st_ino':998,'st_mode':0o100644,'st_uid':1001,'st_gid':1002,
                    'st_nlink':1,'st_size':len(event_raw),'st_mtime_ns':1700000000000000000,'raw':event_raw}
                for path in reversed(Path(reader.RUNTIME_NODE).parents):
                    state['rows'].setdefault(str(path),{'st_dev':1,'st_ino':900+len(state['rows']),'st_mode':0o40755,'st_uid':0,'st_gid':0,
                        'st_nlink':1,'st_size':0,'st_mtime_ns':1700000000000000000,'raw':b''})
                state['rows'][reader.RUNTIME_NODE]={'st_dev':1,'st_ino':999,'st_mode':0o100777,'st_uid':1001,'st_gid':1002,
                    'st_nlink':1,'st_size':124827920,'st_mtime_ns':1700000000000000000,'raw':b'never read rejected executable'}
                output=io.BytesIO()
                with patch.object(os,'getresuid',return_value=(1001,)*3),patch.object(os,'getresgid',return_value=(1002,)*3),\
                    patch.object(os,'lstat',side_effect=lambda path:Path(path).lstat()),\
                    patch.object(sys,'argv',['reader.py','--inventory-runtime']),patch.dict(os.environ,env,clear=True),\
                    patch.object(sys,'stdout',SimpleNamespace(buffer=output)),\
                    patch.object(reader.subprocess,'Popen',side_effect=AssertionError('no tool before rejected-file guard')) as popen:
                    with self.assertRaises(SystemExit) as caught:reader.main()
                    self.assertEqual(caught.exception.code,1);popen.assert_not_called()
                originals=reader.decode_runtime_inventory_log(output.getvalue());value=reader.parse(originals['runtime.inventory.json'])
                self.assertEqual(originals['inventory.request.json'],request_raw);self.assertEqual(originals['inventory.event.json'],event_raw)
                self.assertEqual(set(value['source']),reader.SETUP_SOURCE_PATHS);self.assertTrue(value['parent']['alreadyEnabled'])
                self.assertEqual(value['firstFailure']['message'],'bounded inventory regular file and mode');self.assertEqual(value['secondary'],[])
                self.assertIsNone(value['candidate']);self.assertEqual(value['inventory']['files'],{});self.assertEqual(value['inventory']['fileMetadata'],{})
                self.assertEqual(value['inventory']['probes'],[]);self.assertEqual(value['inventory']['processes'],[])
                rejected=value['inventory']['rejectedFiles'][reader.RUNTIME_NODE]
                self.assertEqual(rejected['heldBefore'][2],0o100777);self.assertEqual(rejected['heldBefore'][6],124827920)
                self.assertEqual(rejected['heldBefore'],rejected['heldAfter']);self.assertEqual(rejected['namedBefore'],rejected['namedAfter'])
                self.assertEqual(rejected['bytesRead'],0);self.assertTrue(rejected['closeAttempted']);self.assertTrue(rejected['closeSucceeded'])
                self.assertNotIn(('read',reader.RUNTIME_NODE),state['events']);self.assertEqual(state['fds'],{})

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
            with patch.object(reader,'INVENTORY_ENTRY_ENABLED',False),patch.object(sys,'argv',['reader.py','--inventory-runtime']),patch.object(reader,'runtime_inventory_entry',side_effect=AssertionError('no event or factory before inventory guard')):
                with self.assertRaisesRegex(reader.Refusal,'metadata inventory disabled'):reader.main()
            self.assertIs(reader.INVENTORY_ENTRY_ENABLED,True)
            originals={'inventory.request.json':b'{"manufacturedRequest":true}\n','inventory.event.json':b'{"manufacturedEvent":true}\n',
                'runtime.inventory.json':b'{"manufacturedObservations":true}\n'}
            output=io.BytesIO()
            with patch.object(sys,'argv',['reader.py','--inventory-runtime']),patch.dict(os.environ,{},clear=True),\
                patch.object(sys,'stdout',SimpleNamespace(buffer=output)),patch.object(reader,'runtime_inventory_entry',return_value=(originals,True)) as entry,\
                patch.object(os,'open',side_effect=AssertionError('all real input/kernel edges mocked')),\
                patch.object(os,'mkdir',side_effect=AssertionError('metadata CLI never creates resources')),\
                patch.object(reader.subprocess,'Popen',side_effect=AssertionError('all real probe edges mocked')):
                with self.assertRaises(SystemExit) as caught:reader.main()
                self.assertEqual(caught.exception.code,0);entry.assert_called_once_with({})
            self.assertEqual(reader.decode_runtime_inventory_log(output.getvalue()),originals)
            files,probe=runtime_fixture();inventory=reader.RuntimeInventory(files,probe)
            inventory.executables={'node':reader.RUNTIME_NODE,'python':'/usr/bin/python3.12','qemu':reader.RUNTIME_QEMU}
            def malicious(argv):
                argv[0]='/unapproved/tool';return probe(argv)
            inventory.probe=malicious
            with self.assertRaises(reader.Refusal):inventory.observe('qemu-version',[reader.RUNTIME_QEMU,'--version'])

    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'independent runtime controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'guestOrResourceOperationExecuted':False,'pass':True}))



def producer_fixture_case():
    """Extract only the inert source fixture class; no producer command runs."""
    import ast
    source=(HERE/'run.py').read_text();module=SimpleNamespace(__file__=str(HERE/'run.py'),__name__='inert_ring3_v8_producer')
    exec(compile(source,module.__file__,'exec'),module.__dict__)
    tree=ast.parse(source);function=next(row for row in tree.body if isinstance(row,ast.FunctionDef) and row.name=='controls')
    cut=next(index for index,row in enumerate(function.body) if isinstance(row,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='result' for target in row.targets))
    function.body=function.body[:cut]+[ast.Return(ast.Name('Tests',ast.Load()))]
    exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),'<inert-source-fixtures>','exec'),module.__dict__)
    return module,module.controls()()


@contextlib.contextmanager
def v8_manufactured(producer,case,architectural=None):
    """Real finalizer/independent observer over manufactured OS/process facts.

    Architectural bytes are an optional separately manufactured full packet;
    the node-free delivery controls declare its predicate boundary explicitly.
    """
    p=producer
    with case.admitted_original_edges() as (ops,outside,env,pre,post,state),patch.dict(p.__dict__,
            GENERATION_NODE_PIN=(reader.RUNTIME_SELECTED['node']['bytes'],reader.RUNTIME_SELECTED['node']['sha256'])):
        raw,selected,runtime,files,inventory=runtime_manufactured()
        source=p.final_json(state['data']['source.before.json']);source_raw=p.encode(source)
        entry=p.final_json(state['data']['.entry.json']);entry['python']=selected['executables']['python']
        controller=p.final_json(state['data']['.controller.json']);before=p.final_json(state['data']['.controller.before.json'])
        for snapshots in (entry['cgroups'],controller['before'],before['before'],outside['cleanup']['beforeCleanup'],outside['cleanup']['afterCleanup']):
            for snapshot_value in snapshots.values():
                snapshot_value['raw']['memoryEvents']='low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n'
                snapshot_value['raw']['cpuStat']='usage_usec 0\nuser_usec 0\nsystem_usec 0\n'
        for when in ('before','after'):state['data']['runtime.'+when+'.json']=p.encode(runtime)
        controller['barrier']['runtime']=runtime
        if architectural is not None:
            for name,value in architectural.items():
                if name.startswith(('inputs/','js/','qemu/')) and not name.endswith('/process.json'):state['data'][name]=value
        refs=lambda names,prefix:{name:{'bytes':len(state['data'][prefix+name]),'sha256':sha(state['data'][prefix+name])} for name in names}
        input_refs=refs(('fixture.rom','fixture.json'),'inputs/')
        for key in ('inputsBefore','inputsAfter','barrierInputs'):controller[key]=input_refs
        controller['jsOriginals']=refs(('report.json','observations.json','writes.json','memory.before.bin','memory.after.bin'),'js/')
        state['data']['.entry.json']=p.encode(entry);state['data']['.controller.json']=p.encode(controller);state['data']['.controller.before.json']=p.encode(before)
        env0,expected,originals,data=prerequisite_fixture();request=reader.parse(originals['request.original.json'])
        wrapper=lambda value:{'bytes':len(value),'sha256':sha(value),'base64':reader.base64.b64encode(value).decode()}
        request['source']=wrapper(source_raw);request['runtime'].update(bytes=len(raw),sha256=sha(raw),blob=reader.hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest())
        request_raw=reader.canonical(request);pin=sha(request_raw);expected['requestSha256']=pin
        event=reader.parse(originals['event.original.json']);event['pull_request']['body']='<!-- BW_RING3_ACTUAL_REQUEST_V1\n'+reader.canonical(wrapper(request_raw)).decode().rstrip('\n')+'\nBW_RING3_ACTUAL_REQUEST_V1 -->'
        plan=reader.canonical({'schema':'bw.ring3.launch-plan.v1','runId':'123','attempt':1,'head':source['head'],'tree':source['tree'],'source':request['source']})
        originals={'request.original.json':request_raw,'event.original.json':reader.canonical(event),'runtime-expectation.json':raw,'launch-plan.json':plan}
        env.update(BW_RING3_APPROVED_REQUEST_SHA256=pin,GITHUB_JOB='actual',GITHUB_EVENT_NAME='pull_request',GITHUB_REPOSITORY='CrispStrobe/bw-board',
            GITHUB_ACTOR='CrispStrobe',GITHUB_WORKFLOW_SHA='e'*40,GITHUB_WORKFLOW_REF='CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge')
        generation=p.final_json(ops._generation_original)
        for when in ('before','after'):generation[when]['files']['node']=dict(reader.V8_NODE_PIN)
        generation['outputs']=input_refs;generation_raw=p.encode(generation)
        phase=p.final_json(ops._preparation_original);phase['schema']='bw.ring3.preparation-original.v4';phase['python']=entry['python']
        phase['process']['argv'][-1]='--prepare-runtime-admitted';phase['process']['environment'].update(BW_RING3_APPROVED_REQUEST_SHA256=pin,BW_LAUNCH_PLAN_SHA256=sha(plan))
        phase['stdout']=wrapper(p.generation_frame(generation_raw,pre))
        outside['process']['argv'][-1]='--bootstrap-runtime-admitted';outside['process']['environment']['BW_RING3_APPROVED_REQUEST_SHA256']=pin
        state['data']['.outside.json']=p.encode(dict(outside,firstFailure=None,secondary=[],streamsHex={'stdout':'','stderr':''}))
        context=p.RuntimeFinalizerContext(request_raw,raw,env)
        result,failure=p.finalize_runtime_packet(context,outside,p.FirstFailure(),pre,env,post_observer=post,preparation_original=p.encode(phase),
            generation_original=generation_raw,launch_plan_original=plan,launch_plan_sha256=sha(plan))
        assert result['pass'] and failure.first is None,(failure.first,failure.secondary)
        packet=dict(state['export']);originals.update(context.originals)
        data={name:('authored '+name).encode() for name in reader.SETUP_SOURCE_PATHS}
        admission='/run/bw-ring3-123-1-admission'
        def adapt(rows):
            for name,row in rows.items():
                if name.startswith('/sys/fs/cgroup'):row['st_dev']=3
            for role in reader.SETUP_ROLES:
                path='/sys/fs/cgroup/bw-ring3-123-1'+('-preparation' if role=='preparation' else '' if role=='enclosing' else '/'+role)
                rows[path]['st_ino']=phase['ownership']['identity']['inode'] if role=='preparation' else entry['cgroups'][role]['identity']['inode']
        installed={name:originals[name] for name in reader.SETUP_INPUTS if name!='installation.original.json'}
        with prerequisite_observer_edges(env,installed,data) as observed:
            adapt(observed['rows']);rows={}
            for name,value in installed.items():
                info=observed['rows'][admission+'/'+name];rows[name]={'identity':{key:info['st_'+key] for key in ('dev','ino','mode','uid','gid','nlink','size','mtime_ns')},'bytes':len(value),'sha256':sha(value)}
            installed['installation.original.json']=reader.canonical({'schema':'bw.ring3.installation-envelope.v1','runId':'123','attempt':1,'requestSha256':pin,
                'launchPlanSha256':sha(plan),'files':rows,'directory':{},'ancestors':{},'observations':{}})
        with prerequisite_observer_edges(env,installed,data) as observed:
            adapt(observed['rows']);stdout,passed=reader.observe_hosted_setup(env);assert passed,stdout
        originals.update(installed)
        process_environment={**reader.V8_ENV,**{name:env[name] for name in p.PREREQUISITE_ENV}}
        def process(pid,start,end,argv):return {'schema':'bw.ring3.process.v1','role':'discovery','argv':argv,'cwdRole':'checkout','environment':process_environment,
            'pid':pid,'pgid':pid,'parentPid':100,'startTicks':pid,'spawnMonoNs':start,'reapMonoNs':end,'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
            'rusage':{'userSeconds':.001,'systemSeconds':.001,'maxRssKiB':1024},'firstFailure':None,'secondary':[]}
        argv=['/usr/bin/python3','-I','-B','scripts/i80386-ring3-int-iret/reader.py']
        originals['setup.observer.json']=reader.canonical({'schema':'bw.ring3.setup-observer-original.v1','process':process(301,3,4,argv+['--observe-hosted-setup']),'stdout':wrapper(stdout),'stderr':wrapper(b'')})
        originals['prerequisite.outer.json']=reader.canonical({'schema':'bw.ring3.prerequisites-original.v1','expectation':expected,'installation':True,'setup':True,
            'partialInstallation':{},'partialSetup':{},'firstFailure':None,'secondary':[]})
        verdict=reader.verify_prerequisites({name:originals[name] for name in set(reader.SETUP_INPUTS)|{'setup.observer.json','prerequisite.outer.json'}},expected)
        originals['prerequisite.reader.json']=reader.canonical({'schema':'bw.ring3.prerequisite-reader-original.v1','process':process(302,22000,22001,argv+['--admit-hosted-prerequisites']),
            'stdout':wrapper(reader.canonical(verdict)),'stderr':wrapper(b'')})
        def observation(start,end):return {'files':{path:{key:row[key] for key in ('bytes','sha256','mode')} for path,row in selected['files'].items()},
            'aliases':selected['aliases'],'platform':selected['platform'],'startMonoNs':start,'finishMonoNs':end}
        common={'requestSha256':pin,'runtimeSha256':sha(raw),'firstFailure':None,'secondary':[]}
        originals['root.runtime.json']=reader.canonical(dict(common,schema='bw.ring3.root-runtime-original.v1',pid=100,
            observations={'before-probes':observation(1,2),'after-guests':observation(20001,21000)}))
        originals['preparation.runtime.json']=reader.canonical(dict(common,schema='bw.ring3.preparation-runtime-original.v1',pid=401,
            observations={'before-probes':observation(51,52),'after-probes':observation(400,401)}))
        census={role:controller['before'][role] for role in ('controller','js','qemu')};records=[]
        for index,descriptor in enumerate(selected['probes']):
            value=process(600+index,10100+20*index,10101+20*index,descriptor['argv']);value.update(parentPid=outside['process']['pid'],environment=dict(reader.V8_ENV))
            records.append({'role':descriptor['role'],'process':value,'census':census})
        originals['controller.runtime.json']=reader.canonical(dict(common,schema='bw.ring3.runtime-admission-original.v2',pid=outside['process']['pid'],probeProcesses=records,
            observations={'before-probes':observation(10001,10002),'after-probes':observation(10500,10501),'after-guests':observation(15000,15001)}))
        dropped={'uids':[1001]*3,'gids':[1002]*3,'groups':[],'pid':100,'status':'CapInh:\t0\nCapPrm:\t0\nCapEff:\t0\nCapAmb:\t0\n','membership':'0::/actions/job\n'}
        originals['execution.outer.json']=reader.canonical({'schema':'bw.ring3.execution-outer-original.v8','requestSha256':pin,
            'platform':{name:env[name] for name in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_ACTOR','GITHUB_JOB','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},
            'drop':dropped,'firstFailure':None,'secondary':[]})
        execution_expected=dict(expected,schema='bw.ring3.execution-expectation.v8')
        yield env,execution_expected,originals,packet,selected,files,state




@contextlib.contextmanager
def delivery_file_edges(originals=None,packet=None):
    state={'rows':{},'fds':{},'next':20,'faults':{},'events':[],'peak':0}
    def row(path,raw=None,mode=None):
        state['rows'][path]={'st_dev':1,'st_ino':100+len(state['rows']),'st_mode':mode or (0o40700 if raw is None else 0o100400),
            'st_uid':1001,'st_gid':1002,'st_nlink':1,'st_size':0 if raw is None else len(raw),'st_mtime_ns':1700000000000000000,'raw':raw}
    for name in ('/checkout','/checkout/build','/checkout/build/i80386-ring3-int-iret-runtime','/checkout/'+str(reader.V8_DIRECTORY),
        '/checkout/build/i80386-ring3-int-iret-export','/checkout/build/i80386-ring3-int-iret-export/inputs',
        '/checkout/build/i80386-ring3-int-iret-export/js','/checkout/build/i80386-ring3-int-iret-export/qemu'):row(name)
    for name,raw in (originals or {}).items():row('/checkout/'+str(reader.V8_DIRECTORY)+'/'+name,raw)
    for name,raw in (packet or {}).items():row('/checkout/build/i80386-ring3-int-iret-export/'+name,raw,0o100600)
    row('/proc/self/status',b'CapInh:\t0\nCapPrm:\t0\nCapEff:\t0\nCapAmb:\t0\n',0o100444)
    row('/proc/self/cgroup',b'0::/actions/job\n',0o100444)
    def pathname(name,dir_fd=None):return str(Path(state['fds'][dir_fd]['path'])/name) if dir_fd is not None else str(name)
    def info(name):
        if ('stat',name) in state['faults']:raise state['faults']['stat',name]
        return SimpleNamespace(**{key:value for key,value in state['rows'][name].items() if key!='raw'})
    def opened(name,flags,mode=0o777,dir_fd=None):
        path=pathname(name,dir_fd);state['events'].append(('open',path,flags));assert flags&os.O_NOFOLLOW
        if flags&os.O_CREAT:
            if path in state['rows']:raise FileExistsError('exclusive existing runtime original')
            row(path,b'',stat.S_IFREG|mode);state['rows'][str(Path(path).parent)]['st_mtime_ns']+=1
        info(path);state['next']+=1;fd=state['next'];state['fds'][fd]={'path':path,'offset':0};state['peak']=max(state['peak'],len(state['fds']));return fd
    def read(fd,cap):
        record=state['fds'][fd];path=record['path']
        if ('read',path) in state['faults']:raise state['faults']['read',path]
        raw=state['rows'][path]['raw'];start=record['offset'];record['offset']+=cap;return raw[start:start+cap]
    def write(fd,raw):
        path=state['fds'][fd]['path'];state['rows'][path]['raw']+=raw;state['rows'][path]['st_size']+=len(raw);return len(raw)
    def closed(fd):
        path=state['fds'].pop(fd)['path'];state['events'].append(('close',path))
        if ('close',path) in state['faults']:raise state['faults']['close',path]
    def listing(fd):
        path=state['fds'][fd]['path'];return sorted({name[len(path)+1:].split('/')[0] for name in state['rows'] if name.startswith(path+'/')})
    def chmod(fd,mode):state['rows'][state['fds'][fd]['path']]['st_mode']=stat.S_IFREG|mode
    with contextlib.ExitStack() as stack:
        for context in (patch.object(Path,'cwd',return_value=Path('/checkout')),patch.object(Path,'resolve',lambda path,**kw:path),
            patch.object(Path,'lstat',lambda path:info(str(path))),patch.object(os,'open',side_effect=opened),patch.object(os,'read',side_effect=read),
            patch.object(os,'write',side_effect=write),patch.object(os,'close',side_effect=closed),patch.object(os,'listdir',side_effect=listing),
            patch.object(os,'lseek',side_effect=lambda fd,position,how:state['fds'][fd].update(offset=position)),patch.object(os,'fchmod',side_effect=chmod),
            patch.object(os,'fstat',side_effect=lambda fd:info(state['fds'][fd]['path'])),patch.object(os,'stat',side_effect=lambda name,dir_fd=None,**kw:info(pathname(name,dir_fd))),
            patch.object(os,'getresuid',return_value=(1001,)*3),patch.object(os,'getresgid',return_value=(1002,)*3),patch.object(os,'getgroups',return_value=[]),
            patch.object(os,'getpid',return_value=303),patch.object(os,'getppid',return_value=100)):stack.enter_context(context)
        yield state


def delivery_controls():
    producer,case=producer_fixture_case();p=producer
    class Tests(unittest.TestCase):
        def test_v8_real_finalizer_observer_and_independent_reader_with_rehashed_conflicts(self):
            import ast
            tree=ast.parse((HERE/'reader.py').read_text());functions={node.name:node for node in tree.body if isinstance(node,ast.FunctionDef)}
            with v8_manufactured(p,case) as (env,expected,originals,packet,selected,files,state),patch.object(reader,'v8_packet_predicates',return_value={'guestPredicatesObserved':True}) as architectural:
                verdict=reader.verify_v8_delivery(originals,packet,expected)
                self.assertTrue(verdict['guestPredicatesObserved']);self.assertFalse(verdict['officialQualified']);architectural.assert_called_once()
                self.assertEqual(len(packet),20);self.assertEqual(len(originals),21)
                cuts=[('source',lambda values:values['request.original.json']['source'].__setitem__('sha256','0'*64)),
                    ('legacy-phase',lambda values:values['preparation.phase.json'].__setitem__('schema','bw.ring3.preparation-original.v3')),
                    ('prep-pin',lambda values:values['preparation.phase.json']['process']['environment'].__setitem__('BW_RING3_APPROVED_REQUEST_SHA256','0'*64)),
                    ('outer-mode',lambda values:values['.outside.json']['process']['argv'].__setitem__(-1,'--bootstrap')),
                    ('legacy-job',lambda values:values['execution.outer.json']['platform'].__setitem__('GITHUB_JOB','hosted-envelope-installation')),
                    ('unknown-drop',lambda values:values['execution.outer.json']['drop'].__setitem__('uids',None)),
                    ('drop-root',lambda values:values['execution.outer.json']['drop'].__setitem__('uids',[0]*3)),
                    ('first-error',lambda values:values['execution.outer.json'].__setitem__('firstFailure',{'name':'Original','message':'FAILED','phase':'source'})),
                    ('prep-inode',lambda values:values['preparation.phase.json']['ownership']['identity'].__setitem__('inode',9999)),
                    ('early-generator',lambda values:values['preparation.runtime.json']['observations']['before-probes'].__setitem__('finishMonoNs',60)),
                    ('late-observer',lambda values:values['setup.observer.json']['process'].__setitem__('reapMonoNs',51)),
                    ('missing-file',lambda values:values['controller.runtime.json']['observations']['before-probes']['files'].pop('/usr/bin/ldd')),
                    ('late-file',lambda values:values['controller.runtime.json']['observations']['after-guests']['files']['/usr/bin/ldd'].__setitem__('sha256','f'*64)),
                    ('probe-parent',lambda values:values['controller.runtime.json']['probeProcesses'][0]['process'].__setitem__('parentPid',999)),
                    ('probe-argv',lambda values:values['controller.runtime.json']['probeProcesses'][0]['process']['argv'].__setitem__(0,'/unapproved/tool')),
                    ('invented-raw-procs',lambda values:values['controller.runtime.json']['probeProcesses'][0]['census']['js']['raw'].__setitem__('cgroupProcs','999\n')),
                    ('invented-raw-limit',lambda values:values['controller.runtime.json']['probeProcesses'][0]['census']['js']['raw'].__setitem__('pidsMax','999\n')),
                    ('duplicate-populated',lambda values:values['controller.runtime.json']['probeProcesses'][0]['census']['js']['raw'].__setitem__('cgroupEvents','populated 0\nfrozen 0\npopulated 1\n')),
                    ('peer-duplicate-populated',lambda values:values['controller.runtime.json']['probeProcesses'][0]['census']['js']['raw'].__setitem__('cgroupEvents','populated 1\npopulated 0\n')),
                    ('peer-invalid-memory-scalar',lambda values:values['controller.runtime.json']['probeProcesses'][0]['census']['js']['raw'].__setitem__('memoryCurrent','not-a-number\n')),
                    ('frozen-probe',lambda values:values['controller.runtime.json']['probeProcesses'][0]['census']['js']['raw'].__setitem__('cgroupEvents','populated 0\nfrozen 1\n')),
                    ('probe-census',lambda values:values['controller.runtime.json']['probeProcesses'][0]['census']['js'].__setitem__('procs',[999]))]
                for name,edit in cuts:
                    values={key:reader.parse(raw) for key,raw in originals.items()};edit(values);changed={key:reader.canonical(value) for key,value in values.items()}
                    with self.assertRaises((reader.Refusal,KeyError,TypeError),msg=name):reader.verify_v8_delivery(changed,packet,expected)
                for field,value in (('requestSha256','0'*64),('attempt',True),('invoker',[True,1002])):
                    with self.assertRaises(reader.Refusal):reader.verify_v8_delivery(originals,packet,dict(expected,**{field:value}))
                # The new internal packet policy holds the entire old
                # architecture body, from audit through the final QEMU joins.
                old=functions['verify_artifact'].body;new=functions['v8_packet_predicates'].body
                index=next(i for i,node in enumerate(old) if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='audit' for target in node.targets))
                self.assertEqual([ast.dump(node,include_attributes=False) for node in old[index:-1]],
                    [ast.dump(node,include_attributes=False) for node in new[3:-1]])

        def test_actual_installer_job_selection_bootstrap_exec_boundary_and_cli_guards(self):
            env,event,request,raw,runtime_data,source_data,responses=case.envelope_fixture()
            event=p.encode(event)
            actual_env=dict(env,GITHUB_JOB='actual');installer=p.RuntimeInstaller(actual_env)
            self.assertEqual(installer.admit_event(event)[0],raw)
            with self.assertRaises(ValueError):p.RuntimeInstaller(env).admit_event(event)
            with self.assertRaises(ValueError):p.HostedEnvelopeInstaller(actual_env).admit_event(event)
            owner=p.RuntimeBootstrapOps(dict(actual_env,BW_RING3_APPROVED_REQUEST_SHA256=sha(raw)))
            owner.invoker={'uid':1001,'gid':1002};owner.owner={'python':{'path':'/usr/bin/python3.12'}};owner.runtime_request_sha256=sha(raw)
            events=[]
            with patch.dict(p.__dict__,entry_ids=lambda uid,gid:events.append(('ids',uid,gid))),patch.object(owner,'entered',side_effect=lambda:events.append('entered')),patch.object(os,'execve') as execute:
                with self.assertRaisesRegex(RuntimeError,'exec unexpectedly returned'):owner.execute()
                argv=execute.call_args.args;self.assertEqual(argv[1][-1],'--controller-runtime-admitted');self.assertEqual(argv[2]['BW_RING3_APPROVED_REQUEST_SHA256'],sha(raw))
                self.assertNotIn('SUDO_UID',argv[2]);self.assertNotIn('SUDO_GID',argv[2]);self.assertEqual(events,[('ids',1001,1002),'entered'])
            for flag in ('--prepare-runtime-admitted','--bootstrap-runtime-admitted','--controller-runtime-admitted','--hosted-runtime-actual'):
                output=io.BytesIO()
                with patch.object(sys,'stderr',SimpleNamespace(buffer=output)):
                    self.assertEqual(p.dispatch_cli([flag],{'ACTUAL_ENTRY_ENABLED':'1'}),1)
                self.assertIn(b'actual entry disabled',output.getvalue())
                for argv in ([flag,flag],[flag,'--help']):
                    with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as caught:p.dispatch_cli(argv,{})
                    self.assertEqual(caught.exception.code,2)

        def test_dropped_preparation_entire_graph_gate_before_generator_and_retained_failure(self):
            with v8_manufactured(p,case) as (env,expected,originals,packet,selected,files,state):
                env=dict(env,BW_LAUNCH_PLAN_SHA256=sha(originals['launch-plan.json']));real_gate=p.RuntimeExpectationGate
                for fault in ('none','node','root','request'):
                    backend,unused=runtime_fixture();events=[];saved={};changed_env=dict(env)
                    if fault=='node':backend.facts[reader.RUNTIME_NODE]['sha256']='0'*64
                    elif fault=='request':changed_env['BW_RING3_APPROVED_REQUEST_SHA256']='0'*64
                    def dropped(uid,gid):
                        events.append('dropped')
                        if fault=='root':raise ValueError('ROOT_BEFORE_READ')
                    def read(environ,name,cap):events.append('read-'+name);return originals[name]
                    def generate(environ,**kwargs):
                        self.assertTrue(set(selected['files'])<=set(path for kind,path in backend.events if kind=='file'));events.append('generator');return {'pass':True},p.FirstFailure()
                    with patch.dict(p.__dict__,entry_ids=dropped,entry_proc=lambda path:'0::/bw-ring3-123-1-preparation\n',
                        read_admission_input=read,read_launch_plan=lambda *args:originals['launch-plan.json'],
                        RuntimeExpectationGate=lambda raw,digest:real_gate(raw,digest,backend),generated_preparation_child=generate,
                        runtime_delivery_original=lambda name,raw=None:saved.setdefault(name,raw)):
                        result,failure=p.runtime_preparation_child(changed_env,emit=lambda raw:len(raw),flush=lambda:None)
                    self.assertEqual(result['pass'],fault=='none');self.assertEqual(events[0],'dropped')
                    if fault!='none':self.assertNotIn('generator',events);self.assertIsNotNone(failure.first)
                    if fault=='root':self.assertEqual(events,['dropped','dropped'])
                    else:self.assertIn('preparation.runtime.json',saved)
                    if fault=='none':self.assertEqual(set(reader.parse(saved['preparation.runtime.json'])['observations']),{'before-probes','after-probes'})

        def test_dropped_runtime_original_real_file_edges_exclusive_mode_caps_and_first_error(self):
            path='/checkout/build/i80386-ring3-int-iret-runtime/preparation.runtime.json';raw=b'{"held":true}\n'
            for fault in ('none','mode','read-close'):
                with delivery_file_edges() as state:
                    if fault!='none':
                        state['rows'][path]={'st_dev':1,'st_ino':900,'st_mode':0o100600 if fault=='mode' else 0o100400,'st_uid':1001,'st_gid':1002,
                            'st_nlink':1,'st_size':len(raw),'st_mtime_ns':1,'raw':raw}
                    if fault=='read-close':state['faults']['read',path]=OSError('ORIGINAL_RUNTIME_READ');state['faults']['close',path]=OSError('RUNTIME_CLOSE')
                    if fault=='none':
                        self.assertEqual(p.runtime_delivery_original('preparation.runtime.json',raw),raw)
                        self.assertEqual(p.runtime_delivery_original('preparation.runtime.json'),raw)
                        with self.assertRaises(FileExistsError):p.runtime_delivery_original('preparation.runtime.json',raw)
                    elif fault=='mode':
                        with self.assertRaises(ValueError):p.runtime_delivery_original('preparation.runtime.json')
                    else:
                        with self.assertRaisesRegex(OSError,'ORIGINAL_RUNTIME_READ') as caught:p.runtime_delivery_original('preparation.runtime.json')
                        self.assertEqual(caught.exception.ring3_secondary[0]['message'],'RUNTIME_CLOSE')
                    self.assertEqual(state['fds'],{});self.assertLessEqual(state['peak'],4)

        def test_root_runtime_sink_uses_held_directory_creation_and_fchown_only(self):
            for fault in ('none','parent-mode','parent-drift'):
                with delivery_file_edges() as state:
                    path='/checkout/build/i80386-ring3-int-iret-runtime';del state['rows'][path]
                    owner=p.HostedRuntimeActual({});owner.invoker={'uid':1001,'gid':1002}
                    owner.setup=SimpleNamespace(facts={},verify=lambda:None);mutations=[]
                    if fault=='parent-mode':state['rows']['/checkout/build']['st_mode']=0o40777
                    def mkdir(name,mode,dir_fd):
                        self.assertEqual(name,'i80386-ring3-int-iret-runtime');self.assertEqual(mode,0o700)
                        self.assertEqual(state['fds'][dir_fd]['path'],'/checkout/build');mutations.append('mkdir')
                        state['rows'][path]={'st_dev':1,'st_ino':999,'st_mode':0o40700,'st_uid':0,'st_gid':0,'st_nlink':1,'st_size':0,'st_mtime_ns':1,'raw':None}
                    def chown(fd,uid,gid):
                        self.assertEqual((uid,gid),(1001,1002));self.assertEqual(state['fds'][fd]['path'],path);mutations.append('fchown')
                        state['rows'][path].update(st_uid=uid,st_gid=gid)
                        if fault=='parent-drift':state['rows']['/checkout/build']['st_ino']+=1
                    with patch.object(os,'mkdir',side_effect=mkdir),patch.object(os,'fchown',side_effect=chown),patch.object(os,'chown',side_effect=AssertionError('no pathname chown')):
                        if fault=='none':owner.create_runtime_sink()
                        else:
                            with self.assertRaises(ValueError):owner.create_runtime_sink()
                    self.assertEqual(state['fds'],{});self.assertLessEqual(state['peak'],3)
                    self.assertEqual(mutations,[] if fault=='parent-mode' else ['mkdir','fchown'])
                    if fault!='parent-mode':self.assertEqual(owner.setup.facts['runtimeCreated'],['build/i80386-ring3-int-iret-runtime'])

        def test_independent_dropped_v8_reader_real_readonly_roster_and_uid_before_decode(self):
            with v8_manufactured(p,case) as (env,expected,originals,packet,selected,files,stage):
                with delivery_file_edges(originals,packet) as state,patch.object(reader,'v8_packet_predicates',return_value={'guestPredicatesObserved':True}):
                    result=reader.admit_hosted_runtime(env);self.assertTrue(result['verdict']['guestPredicatesObserved']);self.assertFalse(result['verdict']['officialQualified'])
                    self.assertEqual(result['identity']['uids'],[1001]*3);self.assertEqual(state['fds'],{});self.assertLessEqual(state['peak'],5)
                    self.assertTrue(all(event[2]&os.O_ACCMODE==os.O_RDONLY for event in state['events'] if event[0]=='open'))
                with patch.object(os,'getresuid',return_value=(0,)*3),patch.object(os,'getresgid',return_value=(0,)*3),patch.object(os,'getgroups',return_value=[]),patch.object(os,'open') as opened:
                    with self.assertRaisesRegex(reader.Refusal,'actual dropped'):reader.admit_hosted_runtime(env)
                    opened.assert_not_called()
                path='/checkout/'+str(reader.V8_DIRECTORY)+'/controller.runtime.json'
                with delivery_file_edges(originals,packet) as state:
                    state['faults']['read',path]=OSError('ORIGINAL_V8_READ');state['faults']['close',path]=OSError('V8_CLOSE')
                    with self.assertRaisesRegex(OSError,'ORIGINAL_V8_READ') as caught:reader.v8_read_roster(reader.V8_DIRECTORY,reader.V8_BASE_NAMES,1001,1002)
                    self.assertEqual(caught.exception.setup_secondary[0]['message'],'V8_CLOSE');self.assertEqual(state['fds'],{})

        def test_full_mocked_actual_cli_parent_gates_collectors_and_separate_reader(self):
            for fault in ('none','node','setup','reader','unknown'):
                with v8_manufactured(p,case) as (env,expected,originals,packet,selected,files,state):
                    uid_state={'uid':0,'gid':0};events=[];captured={};real_gate=p.RuntimeExpectationGate
                    if fault=='node':files.facts[reader.RUNTIME_NODE]['sha256']='0'*64
                    if fault=='unknown':env=dict(env,SUDO_UID='')
                    owner=p.HostedRuntimeActual(env)
                    setup=SimpleNamespace(environ=env,expected_plan_sha256=sha(originals['launch-plan.json']),plan_original=originals['launch-plan.json'],facts={'created':['owned-fixed-resource']},verify=lambda:events.append('setup-verify'))
                    def setup_prepare():
                        events.append('setup-prepare');failure=p.FirstFailure()
                        if fault=='setup':failure.add(OSError('FIRST_SETUP'),'hosted-setup')
                        return {'pass':fault!='setup','facts':setup.facts},failure
                    setup.prepare=setup_prepare
                    facts={'requestOriginal':originals['request.original.json'],'eventOriginal':originals['event.original.json'],'installationOriginal':originals['installation.original.json'],
                        'inputOriginals':{name:originals[name] for name in ('request.original.json','event.original.json','runtime-expectation.json','launch-plan.json')}}
                    installer=SimpleNamespace(facts=facts,prepare=lambda:({'installationComplete':True},p.FirstFailure()))
                    def drop():uid_state.update(uid=1001,gid=1002);events.append('drop')
                    owner.drop=drop;owner.create_runtime_sink=lambda:events.append('runtime-sink')
                    def compose(composition):
                        self.assertIsInstance(composition,p.RuntimeEntryComposition);self.assertTrue(owner.runtime_gate.before_complete);events.append('compose')
                        composition.runtime_context.originals.update({name:value for name,value in originals.items() if name in reader.V8_PHASE_NAMES});drop()
                        return {'pass':True},p.FirstFailure()
                    def retain():self.assertEqual(uid_state['uid'],1001);events.append('retain-prerequisites')
                    owner.retain=retain
                    def retain_v8(values):
                        self.assertEqual(uid_state['uid'],1001);captured.update(values);owner.v8_collector='/owned-v8';events.append('retain-v8')
                    owner.retain_v8=retain_v8
                    def prerequisite(mode,environ):events.append(mode);value=reader.parse(originals['setup.observer.json' if mode=='observe' else 'prerequisite.reader.json']);return reader.canonical(value),value['process']
                    def admit(environ):
                        events.append('V8-reader');value=reader.verify_v8_delivery(captured,packet,expected)
                        if fault=='reader':value['guestPredicatesObserved']=False
                        process=reader.parse(originals['prerequisite.reader.json'])['process'];process.update(pid=303,pgid=303,startTicks=303,spawnMonoNs=23000,reapMonoNs=23001)
                        process['argv'][-1]='--admit-hosted-runtime'
                        payload=reader.canonical({'schema':'bw.ring3.execution-reader-admission.v8','verdict':value,'identity':{}})
                        wrap=lambda raw:{'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
                        return reader.canonical({'schema':'bw.ring3.execution-reader-original.v8','process':process,'stdout':wrap(payload),'stderr':wrap(b'')}),process
                    ticks=iter((1,2,20001,21000));output=io.BytesIO();saved_env=dict(env)
                    def setup_factory(*args):self.assertTrue(owner.runtime_gate.before_complete);return setup
                    with patch.dict(p.__dict__,ACTUAL_ENTRY_ENABLED=True,HostedRuntimeActual=lambda env:owner,RuntimeInstaller=lambda env:installer,
                        HostedSetupOps=setup_factory,RuntimeExpectationGate=lambda raw,digest:real_gate(raw,digest,files),compose_entry=compose,
                        prerequisite_process=prerequisite,runtime_admission_process=admit,
                        runtime_delivery_original=lambda name,raw=None:originals[name],write_new=lambda *args:None),\
                        patch.object(os,'getresuid',side_effect=lambda:(uid_state['uid'],)*3),patch.object(os,'getresgid',side_effect=lambda:(uid_state['gid'],)*3),\
                        patch.object(os,'getgroups',return_value=[]),patch.object(os,'getpid',return_value=100),patch.object(os,'chmod'),\
                        patch.object(p.time,'monotonic_ns',side_effect=lambda:next(ticks)),patch.object(sys,'stdout',SimpleNamespace(buffer=output)),\
                        patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())),patch.object(reader,'v8_packet_predicates',return_value={'guestPredicatesObserved':True}):
                        status=p.dispatch_cli(['--hosted-runtime-actual'],saved_env)
                    self.assertEqual(status,0 if fault=='none' else 1,fault)
                    if fault=='none':
                        self.assertEqual(events,['setup-prepare','runtime-sink','observe','compose','drop','retain-prerequisites','admit','retain-v8','V8-reader'])
                        decoded=reader.decode_v8_log(output.getvalue());self.assertEqual(set(decoded),reader.V8_ORIGINAL_NAMES)
                    else:
                        self.assertNotIn('compose',events) if fault in ('node','setup','unknown') else None
                        if fault=='unknown':self.assertEqual(output.getvalue(),b'');self.assertEqual(events,[])
                        elif fault=='setup':self.assertEqual(reader.parse(reader.decode_v8_log(output.getvalue())['execution.outer.json'])['firstFailure']['message'],'FIRST_SETUP')
                    self.assertTrue(owner.attempted)
                    repeated,failure=owner.run();self.assertFalse(repeated['pass']);self.assertEqual(failure.first['message'],'hosted V8 execution consumed; no retry')

    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'inert V8 delivery controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'guestOrResourceOperationExecuted':False,'architecturalPredicateBoundary':'held separately; mocked only in node-free source routing controls','pass':True}))


def delivery_full_control():
    """Hosted source control only: existing pure Node builder; no CPU/guest."""
    rom,manifest=pure_fixture();architectural,external=manufacture(rom,manifest);producer,case=producer_fixture_case()
    with v8_manufactured(producer,case,architectural) as (env,expected,originals,packet,selected,files,state):
        verdict=reader.verify_v8_delivery(originals,packet,expected)
        assert verdict['guestPredicatesObserved'] is True and verdict['officialQualified'] is False
        process=reader.parse(originals['prerequisite.reader.json'])['process'];process.update(pid=303,pgid=303,startTicks=303,spawnMonoNs=23000,reapMonoNs=23001)
        process['argv'][-1]='--admit-hosted-runtime';identity=reader.parse(originals['execution.outer.json'])['drop'];identity.update(pid=303,parentPid=100)
        wrap=lambda raw:{'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
        originals['v8.reader.json']=reader.canonical({'schema':'bw.ring3.execution-reader-original.v8','process':process,
            'stdout':wrap(reader.canonical({'schema':'bw.ring3.execution-reader-admission.v8','verdict':verdict,'identity':identity})),'stderr':wrap(b'')})
        official=dict(external['official'],runId=123,workflowSha256=reader.parse(packet['source.before.json'])['files'][reader.WORKFLOW]['sha256'])
        artifact=repack(packet,{'official':official});log=io.BytesIO();failure=producer.FirstFailure()
        progress=producer.emit_v8_originals(originals,log.write,log.flush,failure);assert progress['complete'] and failure.first is None
        raw=log.getvalue();admission={**expected,'schema':'bw.ring3.execution-official-expectation.v8','official':official,'workflowSha':'e'*40,
            'logBytes':len(raw),'logSha256':sha(raw)}
        result=reader.verify_v8_artifact(raw,artifact,admission);assert result['pass'] is True and result['versionedExecutionProvenance'] is True
        for field,value in (('requestSha256','0'*64),('workflowSha','f'*40),('logSha256','0'*64)):
            try:reader.verify_v8_artifact(raw,artifact,dict(admission,**{field:value}))
            except reader.Refusal:pass
            else:raise AssertionError('independently selected original pin replacement accepted: '+field)
    print(json.dumps({'testOnly':True,'fullV8AndTwentyRolePositive':True,'fullOriginalLogAndArtifactReaderPositive':True,'guestOrCpuExecuted':False}))


def node_stage_controls():
    """Compact authored copy data; every OS/identity/process edge is mocked."""
    p,_=producer_fixture_case();payload=b'\x7fELF authored compact staging bytes\n'
    historical=p.GENERATION_NODE_PIN
    assert historical==(124827920,'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48')

    @contextlib.contextmanager
    def edges(fault=None):
        env,expected,old,data=prerequisite_fixture();source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old['request.original.json'])['source'])))
        def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
        request={'schema':'bw.ring3.inventory-request.v2','repository':'CrispStrobe/bw-board','pullRequest':645,'head':'a'*40,'tree':'b'*40,
            'source':wrap(reader.canonical(source)),'selected':{'node':{'path':reader.RUNTIME_NODE,'bytes':len(payload),'sha256':sha(payload)},
            'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}},
            'nodeStage':{'source':reader.RUNTIME_NODE,'destination':reader.NODE_STAGE_TARGET,'owner':[0,0],'fileMode':0o555,'directoryMode':0o555}}
        raw=reader.canonical(request);event=reader.parse(old['event.original.json']);event['label']['name']='x86-ring3-node-stage-inventory'
        event['pull_request']['body']='<!-- BW_RING3_NODE_STAGE_V2\n'+reader.canonical(wrap(raw)).decode().rstrip('\n')+'\nBW_RING3_NODE_STAGE_V2 -->'
        event_raw=reader.canonical(event)
        env={**env,'GITHUB_EVENT_PATH':'/event.json','BW_RING3_NODE_STAGE_REQUEST_SHA256':sha(raw),'GITHUB_EVENT_NAME':'pull_request',
            'GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'node-stage-inventory','GITHUB_WORKFLOW_SHA':'e'*40,
            'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge'}
        state={'rows':{},'fds':{},'next':10,'events':[],'uid':0,'gid':0,'groups':[0],'exec':None,'observation':None,'observerOriginal':None,'statSource':0}
        def put(path,mode,uid=0,gid=0,body=b''):
            state['rows'][path]={'st_dev':1,'st_ino':100+len(state['rows']),'st_mode':mode,'st_uid':uid,'st_gid':gid,'st_nlink':1,
                'st_size':len(body),'st_mtime_ns':100,'raw':body}
        for path in ('/','/run'):put(path,0o40755)
        put('/checkout',0o40755,1001,1002)
        for name,body in data.items():put('/checkout/'+name,0o100644,1001,1002,body)
        put('/event.json',0o100644,1001,1002,event_raw);put(reader.RUNTIME_NODE,0o100777,1001,1000,payload)
        put('/proc/self/status',0o100444,body=b'CapInh:\t0\nCapPrm:\t0\nCapEff:\t0\nCapAmb:\t0\n');put('/proc/self/cgroup',0o100444,body=b'0::/actions/job\n')
        if fault=='existing':put(str(p.NODE_STAGE_DIRECTORY),0o40555)
        elif fault in ('source-hash','drop-error'):state['rows'][reader.RUNTIME_NODE]['raw']=payload[:-2]+b'X\n'
        elif fault=='source-kind':state['rows'][reader.RUNTIME_NODE]['st_mode']=0o40777
        elif fault=='source-link':state['rows'][reader.RUNTIME_NODE]['st_nlink']=2
        elif fault=='parent-owner':state['rows']['/run']['st_uid']=1001
        elif fault=='checkout-owner':state['rows']['/checkout']['st_uid']=1003
        elif fault=='file-owner':state['rows']['/checkout/'+next(iter(data))]['st_uid']=1003
        elif fault=='source-data':state['rows']['/checkout/'+next(iter(data))]['raw']=b'drift'
        elif fault=='pin':env['BW_RING3_NODE_STAGE_REQUEST_SHA256']='0'*64
        def pathof(path,dir_fd=None):
            target=Path(state['fds'][dir_fd]['path'])/path if dir_fd is not None else Path(path)
            return str(target if target.is_absolute() else Path('/checkout')/target)
        def info(path):
            if path not in state['rows']:raise FileNotFoundError(path)
            return SimpleNamespace(**{k:v for k,v in state['rows'][path].items() if k!='raw'})
        def opened(path,flags,mode=0o777,dir_fd=None):
            path=pathof(path,dir_fd);state['events'].append(('open',path,flags))
            if flags&os.O_CREAT:
                assert flags&os.O_EXCL and path in (reader.NODE_STAGE_TARGET,str(p.NODE_STAGE_RECORD))
                if path in state['rows']:raise FileExistsError(path)
                put(path,stat.S_IFREG|mode)
            if fault=='reopen-corrupt' and path==reader.NODE_STAGE_TARGET and flags&os.O_ACCMODE==os.O_RDONLY:
                state['rows'][path]['raw']=payload[:-2]+b'Y\n'
            info(path);state['next']+=1;fd=state['next'];state['fds'][fd]={'path':path,'offset':0,'flags':flags};return fd
        def read(fd,cap):
            record=state['fds'][fd];path=record['path'];state['events'].append(('read',path))
            body=state['rows'][path]['raw']
            if path=='/proc/self/status':
                body=('Pid:\t101\nUid:\t'+'\t'.join([str(state['uid'])]*4)+'\nGid:\t'+'\t'.join([str(state['gid'])]*4)+
                    '\nGroups:\t'+' '.join(map(str,state['groups']))+'\n').encode()+body
            at=record['offset'];chunk=body[at:at+cap];record['offset']+=len(chunk);return chunk
        def written(fd,body):
            record=state['fds'][fd];path=record['path'];assert path in (reader.NODE_STAGE_TARGET,str(p.NODE_STAGE_RECORD))
            state['events'].append(('write',path,len(body)))
            if fault=='write-error' and path==reader.NODE_STAGE_TARGET:raise OSError('FIRST_STAGE_WRITE')
            count=2 if fault in ('short-write','copy-and-close') and path==reader.NODE_STAGE_TARGET else len(body)
            row=state['rows'][path];at=record['offset'];row['raw']=row['raw'][:at]+body[:count];record['offset']+=count;row['st_size']=len(row['raw']);return count
        def close(fd):
            record=state['fds'].pop(fd);path=record['path'];state['events'].append(('close',path))
            if fault in ('late-close','copy-and-close') and path==reader.NODE_STAGE_TARGET and (fault=='copy-and-close' or stat.S_IMODE(state['rows'][path]['st_mode'])==0o555):
                raise OSError('LATE_PUBLISHED_CLOSE')
            if fault=='parent-close' and path==str(p.NODE_STAGE_DIRECTORY):raise OSError('LATE_PARENT_CLOSE')
        def mkdir(name,mode=0o777,dir_fd=None):
            path=pathof(name,dir_fd);assert path==str(p.NODE_STAGE_DIRECTORY);state['events'].append(('mkdir',path))
            if path in state['rows']:raise FileExistsError(path)
            put(path,stat.S_IFDIR|mode)
        def chmod(fd,mode):
            path=state['fds'][fd]['path'];assert path in (str(p.NODE_STAGE_DIRECTORY),reader.NODE_STAGE_TARGET,str(p.NODE_STAGE_RECORD))
            state['events'].append(('chmod',path,mode))
            if fault=='directory-publication' and path==str(p.NODE_STAGE_DIRECTORY) and mode==0o555:mode=0o755
            state['rows'][path]['st_mode']=stat.S_IFMT(state['rows'][path]['st_mode'])|mode
            if mode==0o555 and ((fault=='file-chmod-error' and path==reader.NODE_STAGE_TARGET) or
                (fault=='directory-chmod-error' and path==str(p.NODE_STAGE_DIRECTORY))):raise OSError('UNCERTAIN_PUBLICATION')
        def resolve(path,**kw):
            if str(path)==p.__file__:return Path('/checkout')/p.RUN_FILE
            return path if path.is_absolute() else Path('/checkout')/path
        def collect(child,role,argv,**kw):
            state['events'].append(('git',argv))
            if argv[-2:]==['rev-parse','HEAD']:body=b'a'*40+b'\n'
            elif argv[-2:]==['rev-parse','HEAD^{tree}']:body=b'b'*40+b'\n'
            else:body=''.join(source['files'][name]['mode']+' blob '+source['files'][name]['blob']+'\t'+name+'\n' for name in sorted(source['files'])).encode()
            index=len([item for item in state['events'] if item[0]=='git'])
            process={'schema':'bw.ring3.process.v1','role':'discovery','argv':argv,'cwdRole':'checkout','environment':child.environment,
                'pid':200+index,'pgid':200+index,'parentPid':101,'startTicks':index,'spawnMonoNs':index*10000000,'reapMonoNs':index*10000000+1000000,
                'firstFailure':None,'secondary':[],'exitCode':0,'waitStatus':0,'signal':None,'timedOut':False,
                'rusage':{'userSeconds':0,'systemSeconds':0,'maxRssKiB':0}}
            return process,{'stdout':body,'stderr':b''}
        def setuid(*ids):
            if fault=='drop-error':raise OSError('ACQUIRED_DROP_DIAGNOSTIC')
            state['uid']=ids[0]
        def exec_(path,argv,environment):
            state['exec']=(path,argv,environment);output=io.BytesIO()
            with patch.object(reader,'NODE_STAGE_OBSERVER_ENABLED',True),patch.object(sys,'argv',argv[3:]),patch.dict(os.environ,environment,clear=True),\
                patch.object(sys,'stdout',SimpleNamespace(buffer=output)):
                try:reader.main()
                except SystemExit as error:assert error.code==1
            state['observerOriginal']=output.getvalue();state['observation']=reader.parse(output.getvalue())
            return None  # Real exec cannot return; production must refuse this test boundary.
        with contextlib.ExitStack() as stack:
            for context in (patch.dict(p.__dict__,GENERATION_NODE_PIN=(len(payload),sha(payload))),patch.dict(reader.RUNTIME_SELECTED,{'node':{'bytes':len(payload),'sha256':sha(payload)}}),
                patch.object(Path,'cwd',return_value=Path('/checkout')),patch.object(Path,'resolve',resolve),patch.object(Path,'lstat',lambda path:info(pathof(path))),
                patch.object(os,'stat',side_effect=lambda path,dir_fd=None,**kw:info(pathof(path,dir_fd))),patch.object(os,'fstat',side_effect=lambda fd:info(state['fds'][fd]['path'])),
                patch.object(os,'open',side_effect=opened),patch.object(os,'read',side_effect=read),patch.object(os,'write',side_effect=written),patch.object(os,'close',side_effect=close),
                patch.object(os,'lseek',side_effect=lambda fd,at,whence:state['fds'][fd].update(offset=at)),patch.object(os,'mkdir',side_effect=mkdir),patch.object(os,'fchmod',side_effect=chmod),
                patch.object(os,'getresuid',side_effect=lambda:(state['uid'],)*3),patch.object(os,'getresgid',side_effect=lambda:(state['gid'],)*3),patch.object(os,'getgroups',side_effect=lambda:state['groups']),
                patch.object(os,'setgroups',side_effect=lambda groups:state.update(groups=groups)),patch.object(os,'setresuid',side_effect=setuid),
                patch.object(os,'setresgid',side_effect=lambda *ids:state.update(gid=ids[0])),patch.object(os,'execve',side_effect=exec_),patch.object(os,'getpid',return_value=101),
                patch.object(p,'collect_child',side_effect=collect),patch.object(p.subprocess,'Popen',side_effect=AssertionError('no Node/process execution in staging controls'))):stack.enter_context(context)
            yield p,env,request,raw,state

    class Tests(unittest.TestCase):
        def test_disabled_new_modes_before_any_edges_and_old_actual_false(self):
            self.assertIs(p.NODE_STAGE_ENTRY_ENABLED,False);self.assertIs(reader.NODE_STAGE_OBSERVER_ENABLED,False);self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            with patch.object(p,'stage_inventory_node',side_effect=AssertionError('no entry before guard')),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--stage-inventory-node'],{}),1)
            with patch.object(sys,'argv',['reader.py','--observe-staged-node']),patch.object(reader,'observe_staged_node',side_effect=AssertionError('no observer before guard')):
                with self.assertRaisesRegex(reader.Refusal,'disabled'):reader.main()
        def test_real_copy_drop_exec_observer_and_independent_original_positive_before_refusal(self):
            with edges() as (producer,env,request,raw,state):
                result,failure=producer.stage_inventory_node(env)
                self.assertFalse(result['pass']);self.assertIn('exec unexpectedly returned',failure.first['message'])
                value=state['observation'];self.assertTrue(value['stageObserved'],value);self.assertEqual(value['firstFailure'],reader.NODE_STAGE_BOUNDARY)
                self.assertEqual(value['secondary'],[]);self.assertFalse(value['runtimeCandidate']);self.assertFalse(value['qualified'])
                self.assertEqual(state['exec'][1][-1],'--observe-staged-node');self.assertEqual(state['uid'],1001);self.assertEqual(state['groups'],[])
                self.assertEqual(stat.S_IMODE(state['rows'][reader.RUNTIME_NODE]['st_mode']),0o777)
                self.assertEqual(stat.S_IMODE(state['rows'][reader.NODE_STAGE_TARGET]['st_mode']),0o555);self.assertEqual(state['fds'],{})
                observed=state['observerOriginal'];self.assertEqual(observed,reader.canonical(value));expected={'schema':'bw.ring3.node-stage-expectation.v1','requestSha256':sha(raw),'head':'a'*40,'tree':'b'*40,
                    'runId':123,'workflowSha':'e'*40,'invoker':[1001,1002],'observation':{'bytes':len(observed),'sha256':sha(observed)}}
                verdict=reader.verify_node_stage_observation(observed,expected);self.assertTrue(verdict['stagedNodeObserved']);self.assertFalse(verdict['qualified'])
                for mutate in (lambda v:v['files']['node'].__setitem__('sha256','0'*64),lambda v:v['identity'].__setitem__('groups',[0]),
                    lambda v:v['files']['installation.original.json'].__setitem__('prefix','ffffffff'),
                    lambda v:v.__setitem__('stageObserved',False),lambda v:v['directories'][-1]['before'].__setitem__(2,0o40777),
                    lambda v:v['files']['node']['before'].__setitem__(0,2**64),
                    lambda v:v['identity'].__setitem__('status',v['identity']['status'].replace('Uid:\t1001\t1001\t1001\t1001','Uid:\t0\t0\t0\t0')),
                    lambda v:v['identity'].__setitem__('status',v['identity']['status']+'Gid:\t1002\t1002\t1002\t1002\n'),
                    lambda v:v['identity'].__setitem__('status',v['identity']['status'].replace('Groups:\t\n','Groups:\t0\n')),
                    lambda v:v['identity'].__setitem__('status',v['identity']['status'].replace('Pid:\t101','Pid:\t999')),
                    lambda v:(v['identity'].__setitem__('pid',999),v['identity'].__setitem__('status',v['identity']['status'].replace('Pid:\t101','Pid:\t999')))):
                    changed=copy.deepcopy(value);mutate(changed);bad=reader.canonical(changed)
                    with self.assertRaises(reader.Refusal):reader.verify_node_stage_observation(bad,dict(expected,observation={'bytes':len(bad),'sha256':sha(bad)}))
                for field,replacement in (('timedOut',True),('signal',9),('schema','unknown'),('extra',0)):
                    changed=copy.deepcopy(value);root=reader.parse(reader.prerequisite_original(reader.canonical(changed['record'])))
                    root['sourceCommands'][0]['process'][field]=replacement;root_raw=reader.canonical(root)
                    changed['record']={'bytes':len(root_raw),'sha256':sha(root_raw),'base64':reader.base64.b64encode(root_raw).decode()}
                    file=changed['files']['installation.original.json'];file.update(bytes=len(root_raw),sha256=sha(root_raw))
                    for name in ('before','after','namedAfter'):file[name][6]=len(root_raw)
                    bad=reader.canonical(changed)
                    with self.assertRaises(reader.Refusal):reader.verify_node_stage_observation(bad,dict(expected,observation={'bytes':len(bad),'sha256':sha(bad)}))
        def test_prewrite_source_request_and_parent_refusals(self):
            for fault in ('pin','source-data','parent-owner','checkout-owner','file-owner','existing'):
                with self.subTest(fault=fault),edges(fault) as (producer,env,request,raw,state),patch.object(sys,'stdout',SimpleNamespace(buffer=io.BytesIO())):
                    result,failure=producer.stage_inventory_node(env);self.assertIsNotNone(failure.first);self.assertIsNone(state['exec']);self.assertEqual(state['fds'],{})
                    self.assertFalse(any(event[0]=='write' for event in state['events']))
                    if fault in ('pin','source-data','parent-owner','checkout-owner','file-owner'):self.assertFalse(any(event[0]=='mkdir' for event in state['events']))
        def test_copy_write_hash_and_late_publication_failures_remain_truthful(self):
            for fault in ('source-hash','source-kind','source-link','reopen-corrupt','short-write','write-error','late-close','directory-publication','file-chmod-error','directory-chmod-error','copy-and-close','parent-close'):
                with self.subTest(fault=fault),edges(fault) as (producer,env,request,raw,state),patch.object(sys,'stdout',SimpleNamespace(buffer=io.BytesIO())):
                    result,failure=producer.stage_inventory_node(env);self.assertIsNotNone(failure.first);self.assertIsNone(state['exec']);self.assertEqual(state['fds'],{})
                    facts=result['copy'];self.assertEqual(stat.S_IMODE(state['rows'][reader.RUNTIME_NODE]['st_mode']),0o777)
                    if fault=='short-write':self.assertEqual(facts['bytesCopied'],2);self.assertEqual(facts['sourceBytesRead'],len(payload));self.assertFalse(facts['filePublished'])
                    if fault=='write-error':self.assertEqual(facts['bytesCopied'],0);self.assertTrue(facts['writeUncertain']);self.assertEqual(failure.first['message'],'FIRST_STAGE_WRITE')
                    if fault=='late-close':self.assertTrue(facts['filePublished']);self.assertEqual(failure.first['message'],'LATE_PUBLISHED_CLOSE')
                    if fault=='directory-publication':self.assertTrue(facts['directoryPublished']);self.assertIn('publication readback',failure.first['message'])
                    if fault=='file-chmod-error':
                        self.assertTrue(facts['filePublicationAttempted']);self.assertFalse(facts['filePublished']);self.assertEqual(stat.S_IMODE(facts['file'][2]),0o555)
                    if fault=='directory-chmod-error':
                        self.assertTrue(facts['directoryPublicationAttempted']);self.assertFalse(facts['directoryPublished']);self.assertEqual(stat.S_IMODE(facts['directoryAfterFailure'][2]),0o555)
                    if fault=='copy-and-close':
                        self.assertEqual(failure.first['message'],'complete Node-stage chunk write');self.assertEqual(facts['bytesCopied'],2)
                        self.assertTrue(any(item['message']=='LATE_PUBLISHED_CLOSE' for item in failure.secondary))
                    if fault=='parent-close':self.assertTrue(facts['directoryPublished']);self.assertEqual(failure.first['message'],'LATE_PARENT_CLOSE')
        def test_mocked_enabled_fixed_cli_and_exact_mode_arity(self):
            with edges() as (producer,env,request,raw,state),patch.object(producer,'NODE_STAGE_ENTRY_ENABLED',True),\
                patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(producer.dispatch_cli(['--stage-inventory-node'],env),1)
                self.assertTrue(state['observation']['stageObserved']);self.assertEqual(state['observation']['firstFailure'],reader.NODE_STAGE_BOUNDARY)
                self.assertFalse(state['observation']['runtimeCandidate']);self.assertEqual(state['fds'],{})
            for args in (['--stage-inventory-node','--stage-inventory-node'],['--stage-inventory-node','--help'],['--stage-inventory-nod']):
                with patch.object(producer,'stage_inventory_node',side_effect=AssertionError('no malformed mode entry')),patch.object(sys,'stderr',io.StringIO()):
                    with self.assertRaises(SystemExit) as error:producer.dispatch_cli(args,{})
                    self.assertEqual(error.exception.code,2)
        def test_unverified_drop_suppresses_acquired_stdout_and_stderr(self):
            output=io.BytesIO();diagnostic=io.BytesIO()
            with edges('drop-error') as (producer,env,request,raw,state),patch.object(producer,'NODE_STAGE_ENTRY_ENABLED',True),\
                patch.object(sys,'stdout',SimpleNamespace(buffer=output)),patch.object(sys,'stderr',SimpleNamespace(buffer=diagnostic)):
                self.assertEqual(producer.dispatch_cli(['--stage-inventory-node'],env),1)
                self.assertIsNone(state['exec']);self.assertEqual(output.getvalue(),b'');self.assertEqual(diagnostic.getvalue(),b'');self.assertEqual(state['fds'],{})
            with edges('drop-error') as (producer,env,request,raw,state),patch.object(sys,'stdout',SimpleNamespace(buffer=io.BytesIO())):
                result,failure=producer.stage_inventory_node(env);self.assertFalse(result['publicationSafe'])
                self.assertEqual(failure.first['message'],'historical Node bytes and held source readback')
                self.assertTrue(any(row['message']=='ACQUIRED_DROP_DIAGNOSTIC' for row in failure.secondary))
        def test_v2_owner_modes_are_typed_and_v1_is_not_reinterpreted(self):
            with edges() as (producer,env,request,raw,state):
                producer.admit_node_stage_request(raw,sha(raw));reader.node_stage_request(raw,sha(raw))
                for change in (lambda v:v['nodeStage'].__setitem__('fileMode',True),lambda v:v['nodeStage'].__setitem__('fileMode',365.0),
                    lambda v:v['nodeStage'].__setitem__('owner',[False,0]),lambda v:v['nodeStage'].__setitem__('destination','/arbitrary/node'),
                    lambda v:v.__setitem__('schema','bw.ring3.inventory-request.v1')):
                    changed=copy.deepcopy(request);change(changed);bad=reader.canonical(changed)
                    for admit in (producer.admit_node_stage_request,reader.node_stage_request):
                        with self.assertRaises(ValueError):admit(bad,sha(bad))
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests));assert result.wasSuccessful(),'Node-stage controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'OSAndIdentityEdgesMocked':True,'compactAuthoredFixturePinsOnly':True,
        'historicalProductionPinHeld':p.GENERATION_NODE_PIN==historical,'runtimeCandidate':False,'qualified':False,'pass':True}))


def staged_runtime_controls(export_edges=False):
    """Full staged inventory routing; OS/process edges and compact pins are test-only."""
    p,_=producer_fixture_case();payload=b'\x7fELF authored compact staging bytes\n';historical=p.GENERATION_NODE_PIN
    assert historical==(124827920,'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48')
    @contextlib.contextmanager
    def edges(fault=None):
        env,expected,old,data=prerequisite_fixture();source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old['request.original.json'])['source'])))
        def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
        request={'schema':'bw.ring3.inventory-request.v3','repository':'CrispStrobe/bw-board','pullRequest':645,'head':'a'*40,'tree':'b'*40,
            'source':wrap(reader.canonical(source)),'selected':{'node':{'path':reader.NODE_STAGE_TARGET,'bytes':len(payload),'sha256':sha(payload)},
            'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}},
            'nodeStage':{'source':reader.RUNTIME_NODE,'destination':reader.NODE_STAGE_TARGET,'owner':[0,0],'fileMode':0o555,'directoryMode':0o555},'emptyPythonSources':copy.deepcopy(reader.STAGED_EMPTY_PYTHON_SOURCES)}
        raw=reader.canonical(request);event=reader.parse(old['event.original.json']);event['label']['name']='x86-ring3-staged-runtime-inventory'
        event['pull_request']['body']='<!-- BW_RING3_STAGED_RUNTIME_INVENTORY_V3\n'+reader.canonical(wrap(raw)).decode().rstrip('\n')+'\nBW_RING3_STAGED_RUNTIME_INVENTORY_V3 -->'
        event_raw=reader.canonical(event)
        env={**env,'GITHUB_EVENT_PATH':'/event.json','BW_RING3_STAGED_INVENTORY_REQUEST_SHA256':sha(raw),'GITHUB_EVENT_NAME':'pull_request',
            'GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'staged-runtime-inventory','GITHUB_WORKFLOW_SHA':'e'*40,
            'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge'}
        state={'rows':{},'fds':{},'next':10,'events':[],'uid':0,'gid':0,'groups':[0],'exec':None,'observation':None,'observerOriginal':None,'statSource':0}
        def put(path,mode,uid=0,gid=0,body=b''):
            state['rows'][path]={'st_dev':1,'st_ino':100+len(state['rows']),'st_mode':mode,'st_uid':uid,'st_gid':gid,'st_nlink':1,
                'st_size':len(body),'st_mtime_ns':100,'raw':body}
        for path in ('/','/run'):put(path,0o40755)
        put('/checkout',0o40755,1001,1002)
        for name,body in data.items():put('/checkout/'+name,0o100644,1001,1002,body)
        put('/event.json',0o100644,1001,1002,event_raw);put(reader.RUNTIME_NODE,0o100777,1001,1000,payload)
        put('/proc/self/status',0o100444,body=b'CapInh:\t0\nCapPrm:\t0\nCapEff:\t0\nCapAmb:\t0\n');put('/proc/self/cgroup',0o100444,body=b'0::/actions/job\n')
        empty_path=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES));put(empty_path,0o100644)
        put('/sys/fs/cgroup',0o40755)
        for name in ('cgroup.controllers','cgroup.subtree_control'):put('/sys/fs/cgroup/'+name,0o100644,body=b'cpu memory pids\n')
        if fault=='empty-extent':state['rows'][empty_path].update(st_size=1,raw=b'X')
        elif fault=='empty-link':state['rows'][empty_path]['st_nlink']=2
        elif fault=='empty-owner':state['rows'][empty_path]['st_uid']=1001
        elif fault=='empty-mode':state['rows'][empty_path]['st_mode']=0o100666
        if fault=='existing':put(str(p.NODE_STAGE_DIRECTORY),0o40555)
        elif fault in ('source-hash','drop-error'):state['rows'][reader.RUNTIME_NODE]['raw']=payload[:-2]+b'X\n'
        elif fault=='source-kind':state['rows'][reader.RUNTIME_NODE]['st_mode']=0o40777
        elif fault=='source-link':state['rows'][reader.RUNTIME_NODE]['st_nlink']=2
        elif fault=='parent-owner':state['rows']['/run']['st_uid']=1001
        elif fault=='checkout-owner':state['rows']['/checkout']['st_uid']=1003
        elif fault=='file-owner':state['rows']['/checkout/'+next(iter(data))]['st_uid']=1003
        elif fault=='source-data':state['rows']['/checkout/'+next(iter(data))]['raw']=b'drift'
        elif fault=='pin':env['BW_RING3_STAGED_INVENTORY_REQUEST_SHA256']='0'*64
        def pathof(path,dir_fd=None):
            target=Path(state['fds'][dir_fd]['path'])/path if dir_fd is not None else Path(path)
            return str(target if target.is_absolute() else Path('/checkout')/target)
        def info(path):
            if path not in state['rows']:raise FileNotFoundError(path)
            return SimpleNamespace(**{k:v for k,v in state['rows'][path].items() if k!='raw'})
        def opened(path,flags,mode=0o777,dir_fd=None):
            path=pathof(path,dir_fd);state['events'].append(('open',path,flags))
            if flags&os.O_CREAT:
                assert flags&os.O_EXCL and path in (reader.NODE_STAGE_TARGET,str(p.NODE_STAGE_RECORD))
                if path in state['rows']:raise FileExistsError(path)
                put(path,stat.S_IFREG|mode)
            if fault=='reopen-corrupt' and path==reader.NODE_STAGE_TARGET and flags&os.O_ACCMODE==os.O_RDONLY:
                state['rows'][path]['raw']=payload[:-2]+b'Y\n'
            info(path);state['next']+=1;fd=state['next'];state['fds'][fd]={'path':path,'offset':0,'flags':flags};return fd
        def read(fd,cap):
            record=state['fds'][fd];path=record['path'];state['events'].append(('read',path))
            body=state['rows'][path]['raw']
            if path==empty_path:
                if fault=='empty-read-close':raise OSError('FIRST_EMPTY_READ')
                if fault=='empty-eof':body=b'X'
            if path=='/proc/self/status':
                body=('Pid:\t101\nUid:\t'+'\t'.join([str(state['uid'])]*4)+'\nGid:\t'+'\t'.join([str(state['gid'])]*4)+
                    '\nGroups:\t'+' '.join(map(str,state['groups']))+'\n').encode()+body
            at=record['offset'];chunk=body[at:at+cap];record['offset']+=len(chunk);return chunk
        def written(fd,body):
            record=state['fds'][fd];path=record['path'];assert path in (reader.NODE_STAGE_TARGET,str(p.NODE_STAGE_RECORD))
            state['events'].append(('write',path,len(body)))
            if fault=='write-error' and path==reader.NODE_STAGE_TARGET:raise OSError('FIRST_STAGE_WRITE')
            count=2 if fault in ('short-write','copy-and-close') and path==reader.NODE_STAGE_TARGET else len(body)
            row=state['rows'][path];at=record['offset'];row['raw']=row['raw'][:at]+body[:count];record['offset']+=count;row['st_size']=len(row['raw']);return count
        def close(fd):
            record=state['fds'].pop(fd);path=record['path'];state['events'].append(('close',path))
            if path==empty_path and fault in ('empty-close','empty-read-close'):raise OSError('LATE_EMPTY_CLOSE')
            if fault in ('late-close','copy-and-close') and path==reader.NODE_STAGE_TARGET and (fault=='copy-and-close' or stat.S_IMODE(state['rows'][path]['st_mode'])==0o555):
                raise OSError('LATE_PUBLISHED_CLOSE')
            if fault=='parent-close' and path==str(p.NODE_STAGE_DIRECTORY):raise OSError('LATE_PARENT_CLOSE')
        def mkdir(name,mode=0o777,dir_fd=None):
            path=pathof(name,dir_fd);assert path==str(p.NODE_STAGE_DIRECTORY);state['events'].append(('mkdir',path))
            if path in state['rows']:raise FileExistsError(path)
            put(path,stat.S_IFDIR|mode)
        def chmod(fd,mode):
            path=state['fds'][fd]['path'];assert path in (str(p.NODE_STAGE_DIRECTORY),reader.NODE_STAGE_TARGET,str(p.NODE_STAGE_RECORD))
            state['events'].append(('chmod',path,mode))
            if fault=='directory-publication' and path==str(p.NODE_STAGE_DIRECTORY) and mode==0o555:mode=0o755
            state['rows'][path]['st_mode']=stat.S_IFMT(state['rows'][path]['st_mode'])|mode
            if mode==0o555 and ((fault=='file-chmod-error' and path==reader.NODE_STAGE_TARGET) or
                (fault=='directory-chmod-error' and path==str(p.NODE_STAGE_DIRECTORY))):raise OSError('UNCERTAIN_PUBLICATION')
        def resolve(path,**kw):
            if str(path)==p.__file__:return Path('/checkout')/p.RUN_FILE
            return path if path.is_absolute() else Path('/checkout')/path
        def collect(child,role,argv,**kw):
            state['events'].append(('git',argv))
            if argv[-2:]==['rev-parse','HEAD']:body=b'a'*40+b'\n'
            elif argv[-2:]==['rev-parse','HEAD^{tree}']:body=b'b'*40+b'\n'
            else:body=''.join(source['files'][name]['mode']+' blob '+source['files'][name]['blob']+'\t'+name+'\n' for name in sorted(source['files'])).encode()
            index=len([item for item in state['events'] if item[0]=='git'])
            process={'schema':'bw.ring3.process.v1','role':'discovery','argv':argv,'cwdRole':'checkout','environment':child.environment,
                'pid':200+index,'pgid':200+index,'parentPid':101,'startTicks':index,'spawnMonoNs':index*10000000,'reapMonoNs':index*10000000+1000000,
                'firstFailure':None,'secondary':[],'exitCode':0,'waitStatus':0,'signal':None,'timedOut':False,
                'rusage':{'userSeconds':0,'systemSeconds':0,'maxRssKiB':0}}
            return process,{'stdout':body,'stderr':b''}
        def setuid(*ids):
            if fault=='drop-error':raise OSError('ACQUIRED_DROP_DIAGNOSTIC')
            state['uid']=ids[0]
        def exec_(path,argv,environment):
            state['exec']=(path,argv,environment);output=io.BytesIO();files,probe=runtime_fixture()
            cache=files.facts.pop(reader.RUNTIME_NODE);files.facts[reader.NODE_STAGE_TARGET]=dict(cache,mode=0o555)
            files.prefixes[reader.NODE_STAGE_TARGET]=files.prefixes.pop(reader.RUNTIME_NODE);files.rejected={}
            native_class=reader.StagedInventoryFiles;file_fact=files.fact;python_files=files.python_files
            def fact(name):
                value=reader.InventoryFiles.fact(files,name) if name==reader.NODE_STAGE_TARGET else file_fact(name)
                if fault=='node-metadata-float' and name==reader.NODE_STAGE_TARGET:files.metadata[name][3]=0.0
                return value
            files.fact=fact
            files.empty_python=lambda name:native_class.empty_python(files,name)
            files.python_files=lambda:sorted(python_files()+[empty_path])
            if fault=='tool-setuid':files.facts['/usr/bin/dpkg-query']['mode']=0o4755
            if fault=='qemu-hash':files.facts[reader.RUNTIME_QEMU]['sha256']='0'*64
            if fault=='missing-empty-census':files.python_files=python_files
            def probe_(arguments):
                process,streams=probe(arguments)
                process['spawnMonoNs']+=100000000;process['reapMonoNs']+=100000000  # After root Git/source/copy/drop, unlike the held legacy fixture.
                if arguments==[reader.NODE_STAGE_TARGET,'--version']:streams['stdout']=b'v22.23.3\n'
                if fault=='probe-first':
                    process['firstFailure']={'phase':'metadata-probe','name':'OSError','message':'FIRST_PROBE'};process['secondary']=[]
                return process,streams
            state['runtimeFiles']=files
            with patch.object(reader,'STAGED_RUNTIME_INVENTORY_ENABLED',True),patch.object(sys,'argv',argv[3:]),patch.dict(os.environ,environment,clear=True),\
                patch.object(sys,'stdout',SimpleNamespace(buffer=output)),patch.object(reader,'StagedInventoryFiles',return_value=files),patch.object(reader,'inventory_probe',side_effect=probe_):
                try:reader.main()
                except SystemExit as error:state['observerExit']=error.code
            state['observerOriginal']=output.getvalue();state['originals']=reader.decode_staged_inventory_log(output.getvalue())
            state['observation']=reader.parse(state['originals']['runtime.staged-inventory.json'])
            return None  # A real successful exec never returns.
        with contextlib.ExitStack() as stack:
            for context in (patch.dict(p.__dict__,GENERATION_NODE_PIN=(len(payload),sha(payload))),patch.dict(reader.RUNTIME_SELECTED,{'node':{'bytes':len(payload),'sha256':sha(payload)}}),
                patch.object(Path,'cwd',return_value=Path('/checkout')),patch.object(Path,'resolve',resolve),patch.object(Path,'lstat',lambda path:info(pathof(path))),
                patch.object(os,'stat',side_effect=lambda path,dir_fd=None,**kw:info(pathof(path,dir_fd))),patch.object(os,'fstat',side_effect=lambda fd:info(state['fds'][fd]['path'])),
                patch.object(os,'open',side_effect=opened),patch.object(os,'read',side_effect=read),patch.object(os,'write',side_effect=written),patch.object(os,'close',side_effect=close),
                patch.object(os,'lseek',side_effect=lambda fd,at,whence:state['fds'][fd].update(offset=at)),patch.object(os,'mkdir',side_effect=mkdir),patch.object(os,'fchmod',side_effect=chmod),
                patch.object(os,'getresuid',side_effect=lambda:(state['uid'],)*3),patch.object(os,'getresgid',side_effect=lambda:(state['gid'],)*3),patch.object(os,'getgroups',side_effect=lambda:state['groups']),
                patch.object(os,'setgroups',side_effect=lambda groups:state.update(groups=groups)),patch.object(os,'setresuid',side_effect=setuid),
                patch.object(os,'setresgid',side_effect=lambda *ids:state.update(gid=ids[0])),patch.object(os,'execve',side_effect=exec_),patch.object(os,'getpid',return_value=101),
                patch.object(p,'collect_child',side_effect=collect),patch.object(p.subprocess,'Popen',side_effect=AssertionError('no Node/process execution in staging controls'))):stack.enter_context(context)
            yield p,env,request,raw,state

    def external(raw,request,env):
        source=reader.parse(reader.prerequisite_original(reader.canonical(request['source'])))
        return {'schema':'bw.ring3.staged-inventory-expectation.v1','requestSha256':sha(reader.canonical(request)),'runId':env['GITHUB_RUN_ID'],
            'attempt':1,'head':request['head'],'tree':request['tree'],'workflowSha':env['GITHUB_WORKFLOW_SHA'],
            'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],'jobId':456,'jobName':'staged-runtime-inventory','conclusion':'success',
            'logBytes':len(raw),'logSha256':sha(raw),'invoker':[1001,1002]}
    def log(originals):
        output=io.BytesIO();reader.emit_staged_inventory(originals,output.write,output.flush);return output.getvalue()
    if export_edges:return edges
    class Tests(unittest.TestCase):
        def test_reviewed_metadata_guards_and_disabled_boundary(self):
            self.assertIs(p.STAGED_RUNTIME_ENTRY_ENABLED,True);self.assertIs(reader.STAGED_RUNTIME_INVENTORY_ENABLED,True)
            self.assertIs(p.NODE_STAGE_ENTRY_ENABLED,False);self.assertIs(reader.NODE_STAGE_OBSERVER_ENABLED,False);self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            with patch.object(p,'STAGED_RUNTIME_ENTRY_ENABLED',False),patch.object(p,'stage_runtime_inventory_node',side_effect=AssertionError('no factory')),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                for environ in ({},{'STAGED_RUNTIME_ENTRY_ENABLED':'true'}):
                    self.assertEqual(p.dispatch_cli(['--stage-runtime-inventory-node'],environ),1)
            with patch.object(reader,'STAGED_RUNTIME_INVENTORY_ENABLED',False),patch.object(sys,'argv',['reader.py','--inventory-staged-runtime']),patch.object(reader,'staged_runtime_inventory_entry',side_effect=AssertionError('no observer')):
                for environ in ({},{'STAGED_RUNTIME_INVENTORY_ENABLED':'true'}):
                    with patch.dict(os.environ,environ,clear=True):
                        with self.assertRaisesRegex(reader.Refusal,'disabled'):reader.main()
        def test_complete_root_copy_drop_eleven_probes_reread_log_and_independent_reader(self):
            with edges() as (producer,env,request,raw,state):
                result,failure=producer.stage_runtime_inventory_node(env)
                self.assertFalse(result['pass']);self.assertIn('exec unexpectedly returned',failure.first['message']);self.assertEqual(state['observerExit'],0)
                value=state['observation'];self.assertIsNone(value['firstFailure']);self.assertEqual(value['secondary'],[])
                self.assertTrue(value['stageBefore']['stageObserved']);self.assertTrue(value['stageAfter']['stageObserved'])
                self.assertEqual(len(value['inventory']['processes']),11);self.assertEqual(state['fds'],{})
                candidate=reader.staged_runtime_expectation(reader.prerequisite_original(reader.canonical(value['candidate'])),value['candidate']['sha256'])
                self.assertEqual(candidate['executables']['node']['path'],reader.NODE_STAGE_TARGET);self.assertNotIn(reader.RUNTIME_NODE,candidate['files'])
                self.assertEqual(candidate['emptyPythonSources'],reader.STAGED_EMPTY_PYTHON_SOURCES)
                reader.verify_staged_empty_python(value['inventory']['emptyPythonSources'])
                verdict=reader.verify_staged_runtime_inventory_log(state['observerOriginal'],external(state['observerOriginal'],request,env))
                self.assertFalse(verdict['candidateReviewed']);self.assertFalse(verdict['actualRunApproved'])
                self.assertEqual(stat.S_IMODE(state['rows'][reader.RUNTIME_NODE]['st_mode']),0o777)
                self.assertEqual(state['exec'][1][-1],'--inventory-staged-runtime')
                for entry in value['inventory']['processes']:
                    self.assertNotIn(reader.RUNTIME_NODE,entry['process']['argv'])
                # Coherently rewrite each complete candidate or original, never only an outer checksum.
                for change in (lambda v:v['stageAfter']['identity'].__setitem__('groups',[0]),
                    lambda v:v['inventory']['candidate'].__setitem__('bytes',float(v['candidate']['bytes'])),
                    lambda v:v['inventory']['candidate'].__setitem__('bytes',True),
                    lambda v:v['inventory']['candidate'].__setitem__('extra',0),
                    lambda v:v['parent']['meta'].__setitem__(3,False),
                    lambda v:v['parent']['controls']['cgroup.controllers']['meta'].__setitem__(3,0.0),
                    lambda v:v['inventory']['emptyPythonSources']['before'].__setitem__('sha256','0'*64),
                    lambda v:v['inventory']['emptyPythonSources']['after'].__setitem__('eof',False),
                    lambda v:v['inventory']['processes'][0]['process'].__setitem__('timedOut',True),
                    lambda v:v['inventory']['processes'][0]['process'].__setitem__('parentPid',999),
                    lambda v:(v['inventory']['processes'][0]['process'].__setitem__('spawnMonoNs',1),v['inventory']['processes'][0]['process'].__setitem__('reapMonoNs',2)),
                    lambda v:v['inventory'].__setitem__('pythonFiles',[name for name in v['inventory']['pythonFiles'] if name not in reader.STAGED_EMPTY_PYTHON_SOURCES])):
                    changed=copy.deepcopy(value);change(changed);originals=dict(state['originals']);originals['runtime.staged-inventory.json']=reader.canonical(changed);changed_log=log(originals)
                    with self.assertRaises(reader.Refusal):reader.verify_staged_runtime_inventory_log(changed_log,external(changed_log,request,env))
                changed=copy.deepcopy(candidate);empty=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES));target='/usr/lib/python3.12/ssl.py'
                changed['aliases'][empty]={'linkText':target,'target':target};changed_raw=reader.canonical(changed)
                with self.assertRaises(reader.Refusal):reader.staged_runtime_expectation(changed_raw,sha(changed_raw))
        def test_v4_coherent_full_original_graph_reader_and_outer_terminal_cuts(self):
            setup,witness=setup_v4_controls(export_sample=True)
            self.assertEqual(reader.SETUP_V4_STATUS_SHA,
                '4144e0299e81507b7a856beef9fe6e67f55bffd0c0d7e9245265b6920721d1ac')
            self.assertEqual(reader.SETUP_V4_STATUS_BYTES,1231069)
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env)
                self.assertEqual(state['observerExit'],0)
                def status_row(name,version,arch='amd64',state='install ok installed',pending=None):
                    lines=['Package: '+name,'Version: '+version,'Architecture: '+arch,'Status: '+state]
                    if pending is not None:lines.append('Triggers-Pending: '+pending)
                    return '\n'.join(lines).encode()
                base=[status_row('installed-'+str(i).zfill(4),'1',
                    state='deinstall ok config-files' if i==0 else 'install ok installed')
                    for i in range(1210)]
                pre_status=b'\n\n'.join(base+[status_row('libc-bin','2')])+b'\n'
                selected=[status_row(name,version,arch) for name,version,arch,*_ in producer.SETUP_V4_PACKAGE_ROWS]
                post_status=b'\n\n'.join(base+[status_row('libc-bin','2',state='install ok triggers-pending',pending='ldconfig'),
                    *selected])+b'\n'
                status_log=io.BytesIO()
                pre_meta=producer.emit_setup_v4_status('pre',pre_status,status_log.write,status_log.flush)
                post_meta=producer.emit_setup_v4_status('post',post_status,status_log.write,status_log.flush)
                setup['preflight'].update(statusSha256=sha(pre_status),statusBytes=len(pre_status),statusOriginal=pre_meta)
                setup['postStatus'].update(sha256=sha(post_status),bytes=len(post_status),statusOriginal=post_meta)
                v4_request=copy.deepcopy(request);v4_request['schema']='bw.ring3.inventory-request.v4'
                v4_request['setup']=producer.setup_v4_policy();v4_request['payloadWitness']=witness
                v4_request['setup']['statusSha256']=sha(pre_status)
                request_raw=reader.canonical(v4_request)
                v4_event=reader.parse(state['originals']['staged.event.json'])
                v4_event['label']['name']='x86-ring3-setup-runtime-inventory-v1'
                wrapper={'bytes':len(request_raw),'sha256':sha(request_raw),
                    'base64':reader.base64.b64encode(request_raw).decode()}
                v4_event['pull_request']['body']='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V4\n'+\
                    reader.canonical(wrapper).decode().rstrip('\n')+'\nBW_RING3_SETUP_RUNTIME_INVENTORY_V4 -->'
                event_raw=reader.canonical(v4_event)
                old_record=reader.parse(reader.prerequisite_original(reader.canonical(state['observation']['stageBefore']['record'])))
                record=copy.deepcopy(old_record);record['schema']='bw.ring3.node-stage-original.v4'
                record['request']=wrapper;record['event']={'bytes':len(event_raw),'sha256':sha(event_raw),
                    'base64':reader.base64.b64encode(event_raw).decode()}
                record['platform'].pop('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256')
                record['platform']['BW_RING3_SETUP_INVENTORY_REQUEST_SHA256']=sha(request_raw)
                record['platform']['GITHUB_JOB']='setup-runtime-inventory'
                record['eventIdentity']['st_size']=len(event_raw)
                record['setup']=setup
                record['recordBoundary']='verified copy after selected setup and policy cleanup, before directory publication'
                record_raw=reader.canonical(record)
                self.assertLessEqual(len(record_raw),1<<20)
                worst=copy.deepcopy(record);full=b'X'*(128<<10)
                encoded={'bytes':len(full),'sha256':sha(full),'base64':reader.base64.b64encode(full).decode()}
                for phase in ('unpack','configure'):
                    for stream in ('stdout','stderr'):worst['setup'][phase][stream]=encoded
                self.assertLessEqual(len(reader.canonical(worst)),1<<20)
                value=copy.deepcopy(state['observation'])
                value['schema']='bw.ring3.setup-runtime-inventory-original.v4'
                value['actualGuestApproved']=False;value['completeHostConfiguration']=False
                for field in ('stageBefore','stageAfter'):
                    stage=value[field];stage['schema']='bw.ring3.setup-node-observation.v4'
                    stage['record']={'bytes':len(record_raw),'sha256':sha(record_raw),
                        'base64':reader.base64.b64encode(record_raw).decode()}
                    file=stage['files']['installation.original.json']
                    file['bytes']=len(record_raw);file['sha256']=sha(record_raw)
                    file['prefix']=record_raw[:4].hex()
                    for name in ('before','after','namedAfter'):file[name][6]=len(record_raw)
                v4_originals={'setup.request.json':request_raw,'setup.event.json':event_raw,
                    'runtime.setup-inventory.json':reader.canonical(value)}
                output=io.BytesIO();output.write(status_log.getvalue())
                reader.emit_setup_v4_inventory(v4_originals,output.write,output.flush)
                v4_log=output.getvalue()
                outer=reader.canonical({'schema':'bw.ring3.setup-outer-terminal.v4','runId':env['GITHUB_RUN_ID'],
                    'unit':'/sys/fs/cgroup/system.slice/bw-ring3-setup-v4-'+env['GITHUB_RUN_ID']+'-1.service',
                    'systemdRunExitCode':0,'outsideCleanupExitCode':0,'cgroupAfter':'absent'})
                cleanup=reader.canonical({'schema':'bw.ring3.setup-outside-cleanup.v4','runId':env['GITHUB_RUN_ID'],
                    'serviceExitCode':0,'cgroupTerminal':'absent','unitCensus':None,'policy':None,'action':'not-needed',
                    'firstFailure':None,'secondary':[],'setupApproved':False})
                source=reader.parse(reader.prerequisite_original(reader.canonical(request['source'])))
                external_v4={'schema':'bw.ring3.setup-inventory-expectation.v4','requestSha256':sha(request_raw),
                    'runId':env['GITHUB_RUN_ID'],'attempt':1,'head':request['head'],'tree':request['tree'],
                    'workflowSha':env['GITHUB_WORKFLOW_SHA'],
                    'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                    'jobId':456,'jobName':'setup-runtime-inventory','conclusion':'success',
                    'logBytes':len(v4_log),'logSha256':sha(v4_log),
                    'outerBytes':len(outer),'outerSha256':sha(outer),
                    'cleanupBytes':len(cleanup),'cleanupSha256':sha(cleanup),'invoker':[1001,1002]}
                with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                    verdict=reader.verify_setup_v4_log(v4_log,external_v4,outer,cleanup)
                self.assertTrue(verdict['setupObserved']);self.assertTrue(verdict['outsideTerminalObserved'])
                self.assertFalse(verdict['actualGuestApproved']);self.assertFalse(verdict['completeHostConfiguration'])
                failed_setup=copy.deepcopy(setup)
                failed_setup['firstFailure']={'phase':'v4-setup','name':'ValueError','message':'mock preflight refusal'}
                failed_setup['preflight']['imageVersion']='drift';failed_setup['postStatus']=None
                failed_setup['nodeStage']=None;failed_setup['runtime']=None
                failure_packet={'schema':'bw.ring3.setup-entry-failure.v4',
                    'context':{'request':record['request'],'event':record['event'],
                        'platform':record['platform'],'source':record['source'],
                        'sourceCommands':record['sourceCommands'],'eventIdentity':record['eventIdentity']},
                    'setup':failed_setup,'firstFailure':failed_setup['firstFailure'],
                    'secondary':[],'publicationSafe':False,'actualGuestApproved':False,
                    'completeHostConfiguration':False}
                failed_log=status_log.getvalue().splitlines()[0]+b'\n'+reader.canonical(failure_packet)
                failed_outer=reader.parse(outer);failed_outer['systemdRunExitCode']=1
                failed_outer=reader.canonical(failed_outer)
                failed_cleanup=reader.parse(cleanup);failed_cleanup['serviceExitCode']=1
                failed_cleanup=reader.canonical(failed_cleanup)
                failed_external=copy.deepcopy(external_v4)
                failed_external.update(conclusion='failure',logBytes=len(failed_log),logSha256=sha(failed_log),
                    outerBytes=len(failed_outer),outerSha256=sha(failed_outer),
                    cleanupBytes=len(failed_cleanup),cleanupSha256=sha(failed_cleanup))
                with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                    held=reader.verify_setup_v4_failure_log(failed_log,failed_external,failed_outer,failed_cleanup)
                self.assertTrue(held['failedAttemptRetained']);self.assertFalse(held['actualRunApproved'])
                self.assertEqual(held['retainedStatusRoles'],['pre'])
                self.assertTrue(held['rawStatusBytesIndependentlyVerified'])
                for mutation in (lambda p:p['context']['platform'].__setitem__('GITHUB_RUN_ID','999'),
                    lambda p:p['context']['sourceCommands'].clear(),
                    lambda p:p['context']['sourceCommands'][0]['stdout'].__setitem__('sha256','0'*64),
                    lambda p:p.__setitem__('firstFailure',None)):
                    altered_failure=copy.deepcopy(failure_packet);mutation(altered_failure)
                    altered_log=reader.canonical(altered_failure);changed_external=copy.deepcopy(failed_external)
                    changed_external.update(logBytes=len(altered_log),logSha256=sha(altered_log))
                    with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                         patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                        with self.assertRaises(reader.Refusal):
                            reader.verify_setup_v4_failure_log(altered_log,changed_external,failed_outer,failed_cleanup)
                pre_line=failed_log.splitlines()[0]+b'\n'
                for altered_log in (failed_log[len(pre_line):],pre_line+failed_log):
                    changed_external=copy.deepcopy(failed_external)
                    changed_external.update(logBytes=len(altered_log),logSha256=sha(altered_log))
                    with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                         patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                        with self.assertRaises(reader.Refusal):
                            reader.verify_setup_v4_failure_log(altered_log,changed_external,failed_outer,failed_cleanup)
                stage_failure=copy.deepcopy(failure_packet)
                stage_failure['firstFailure']={'phase':'v4-node-stage','name':'OSError','message':'FIRST_COPY'}
                stage_failure['secondary']=[{'phase':'Node-stage-parent-close','name':'OSError','message':'SECOND_CLOSE'}]
                stage_setup=stage_failure['setup']=copy.deepcopy(setup)
                stage_setup['firstFailure']=copy.deepcopy(stage_failure['firstFailure'])
                stage_setup['secondary']=copy.deepcopy(stage_failure['secondary'])
                stage_setup['nodeStage']=None;stage_setup['runtime']=None
                stage_setup['partial']={'phase':'node-stage','copy':copy.deepcopy(record['copy']),
                    'record':None,'dropProgress':[],'invoker':list(external_v4['invoker'])}
                stage_log=status_log.getvalue()+reader.canonical(stage_failure)
                stage_external=copy.deepcopy(failed_external)
                stage_external.update(logBytes=len(stage_log),logSha256=sha(stage_log))
                with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                    retained=reader.verify_setup_v4_failure_log(stage_log,stage_external,failed_outer,failed_cleanup)
                self.assertTrue(retained['stageAttemptObserved'])
                self.assertEqual(retained['retainedStatusRoles'],['post','pre'])
                for bad_outer in ({'cgroupAfter':'present'},{'systemdRunExitCode':1}):
                    changed=reader.parse(outer);changed.update(bad_outer);changed_raw=reader.canonical(changed)
                    expected=copy.deepcopy(external_v4);expected['outerBytes']=len(changed_raw);expected['outerSha256']=sha(changed_raw)
                    with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                         patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                        with self.assertRaises(reader.Refusal):reader.verify_setup_v4_log(v4_log,expected,changed_raw,cleanup)
                bad=copy.deepcopy(value);bad['stageAfter']['record']['sha256']='0'*64
                altered=dict(v4_originals,**{'runtime.setup-inventory.json':reader.canonical(bad)})
                output=io.BytesIO();output.write(status_log.getvalue())
                reader.emit_setup_v4_inventory(altered,output.write,output.flush)
                changed_log=output.getvalue();expected=copy.deepcopy(external_v4)
                expected['logBytes']=len(changed_log);expected['logSha256']=sha(changed_log)
                with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                    with self.assertRaises(reader.Refusal):reader.verify_setup_v4_log(changed_log,expected,outer,cleanup)
                def rewrite_record(change,raw_status_log=None):
                    altered_record=copy.deepcopy(record);change(altered_record)
                    changed_raw=reader.canonical(altered_record);altered_value=copy.deepcopy(value)
                    for field in ('stageBefore','stageAfter'):
                        stage=altered_value[field]
                        stage['record']={'bytes':len(changed_raw),'sha256':sha(changed_raw),
                            'base64':reader.base64.b64encode(changed_raw).decode()}
                        file=stage['files']['installation.original.json']
                        file['bytes']=len(changed_raw);file['sha256']=sha(changed_raw)
                        for name in ('before','after','namedAfter'):file[name][6]=len(changed_raw)
                    altered=dict(v4_originals,**{'runtime.setup-inventory.json':reader.canonical(altered_value)})
                    output=io.BytesIO();output.write(status_log.getvalue() if raw_status_log is None else raw_status_log)
                    reader.emit_setup_v4_inventory(altered,output.write,output.flush)
                    changed_log=output.getvalue();expected=copy.deepcopy(external_v4)
                    expected['logBytes']=len(changed_log);expected['logSha256']=sha(changed_log)
                    return changed_log,expected
                changes=(lambda r:r['setup']['unpack']['process'].__setitem__('parentPid',999),
                    lambda r:r['setup']['configure']['process'].__setitem__('parentPid',999),
                    lambda r:(r['setup']['unpack']['process'].__setitem__('spawnMonoNs',1),
                        r['setup']['unpack']['process'].__setitem__('reapMonoNs',2)),
                    lambda r:r['setup']['configure']['process'].__setitem__('reapMonoNs',110000000),
                    lambda r:r['setup']['unpack']['cgroupAfter'].__setitem__('cgroupProcs','101\n202\n'),
                    lambda r:r['setup']['unpack']['cgroupAfter'].__setitem__('cgroupStat','nr_descendants 1\nnr_dying_descendants 0\n'),
                    lambda r:r['setup']['unpack']['cgroupAfter'].__setitem__('cgroupStat','nr_descendants 0\n'),
                    lambda r:r['setup']['postStatus']['selected']['qemu-system-x86'].__setitem__('Status','install ok triggers-pending'))
                for index,change in enumerate(changes):
                    with self.subTest(coherentChange=index):
                        changed_log,expected=rewrite_record(change)
                        with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                             patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                            with self.assertRaises(reader.Refusal):reader.verify_setup_v4_log(changed_log,expected,outer,cleanup)
                for field,replacement in (('Version','0'),('Status','install ok half-configured')):
                    with self.subTest(rawStatusMutation=field):
                        qemu_row=next(row for row in producer.SETUP_V4_PACKAGE_ROWS if row[0]=='qemu-system-x86')
                        old_row=status_row(*qemu_row[:3])
                        if field=='Version':
                            new_row=status_row('qemu-system-x86',replacement,qemu_row[2])
                        else:
                            new_row=status_row(*qemu_row[:3],state=replacement)
                        self.assertEqual(post_status.count(old_row),1)
                        changed_post=post_status.replace(old_row,new_row)
                        changed_status_log=io.BytesIO()
                        producer.emit_setup_v4_status('pre',pre_status,changed_status_log.write,changed_status_log.flush)
                        changed_meta=producer.emit_setup_v4_status('post',changed_post,changed_status_log.write,changed_status_log.flush)
                        def change_post(record):
                            post=record['setup']['postStatus']
                            post.update(sha256=sha(changed_post),bytes=len(changed_post),statusOriginal=changed_meta)
                            post['selected']['qemu-system-x86'][field]=replacement
                        changed_log,expected=rewrite_record(change_post,changed_status_log.getvalue())
                        with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                             patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                            with self.assertRaises(reader.Refusal):reader.verify_setup_v4_log(changed_log,expected,outer,cleanup)
                existing=status_row('installed-0001','1')
                for label,changed_post in (
                    ('upgrade',post_status.replace(existing,status_row('installed-0001','2'))),
                    ('removal',post_status.replace(existing+b'\n\n',b'')),
                    ('extra',post_status+b'\n'+status_row('unreviewed-extra','1')+b'\n'),
                    ('partial-deconfigured',post_status.replace(base[0],status_row('installed-0000','1')))):
                    with self.subTest(rawBaselineDelta=label):
                        changed_rows=reader.setup_v4_status_rows(changed_post)
                        changed_status_log=io.BytesIO()
                        producer.emit_setup_v4_status('pre',pre_status,changed_status_log.write,changed_status_log.flush)
                        changed_meta=producer.emit_setup_v4_status('post',changed_post,changed_status_log.write,changed_status_log.flush)
                        def change_post(record):
                            post=record['setup']['postStatus']
                            post.update(sha256=sha(changed_post),bytes=len(changed_post),
                                        records=len(changed_rows),statusOriginal=changed_meta)
                        changed_log,expected=rewrite_record(change_post,changed_status_log.getvalue())
                        with patch.object(reader,'SETUP_V4_STATUS_SHA',sha(pre_status)),\
                             patch.object(reader,'SETUP_V4_STATUS_BYTES',len(pre_status)):
                            with self.assertRaises(reader.Refusal):
                                reader.verify_setup_v4_log(changed_log,expected,outer,cleanup)

        def test_v6_complete_original_shell_and_reader(self):
            setup,witness=setup_v6_controls(export_sample=True)
            self.assertEqual(reader.SETUP_V6_STATUS_SHA,
                '4144e0299e81507b7a856beef9fe6e67f55bffd0c0d7e9245265b6920721d1ac')
            self.assertEqual(reader.SETUP_V6_STATUS_BYTES,1231069)
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env)
                self.assertEqual(state['observerExit'],0)
                def status_row(name,version,arch='amd64',state='install ok installed',pending=None):
                    lines=['Package: '+name,'Version: '+version,'Architecture: '+arch,'Status: '+state]
                    if pending is not None:lines.append('Triggers-Pending: '+pending)
                    return '\n'.join(lines).encode()
                base=[status_row('installed-'+str(i).zfill(4),'1',
                    state='deinstall ok config-files' if i==0 else 'install ok installed')
                    for i in range(1210)]
                pre_status=b'\n\n'.join(base+[status_row('libc-bin','2')])+b'\n'
                selected=[status_row(name,version,arch) for name,version,arch,*_ in producer.SETUP_V6_PACKAGE_ROWS]
                post_status=b'\n\n'.join(base+[status_row('libc-bin','2',state='install ok triggers-pending',pending='ldconfig'),
                    *selected])+b'\n'
                status_log=io.BytesIO()
                pre_meta=producer.emit_setup_v6_status('pre',pre_status,status_log.write,status_log.flush)
                post_meta=producer.emit_setup_v6_status('post',post_status,status_log.write,status_log.flush)
                setup['preflight'].update(statusSha256=sha(pre_status),statusBytes=len(pre_status),statusOriginal=pre_meta)
                setup['postStatus'].update(sha256=sha(post_status),bytes=len(post_status),statusOriginal=post_meta)
                v6_request=copy.deepcopy(request);v6_request['schema']='bw.ring3.inventory-request.v6'
                v6_request['setup']=producer.setup_v6_policy();v6_request['payloadWitness']=witness
                v6_request['setup']['statusSha256']=sha(pre_status)
                request_raw=reader.canonical(v6_request)
                v6_event=reader.parse(state['originals']['staged.event.json'])
                v6_event['label']['name']='x86-ring3-setup-runtime-inventory-v6'
                wrapper={'bytes':len(request_raw),'sha256':sha(request_raw),
                    'base64':reader.base64.b64encode(request_raw).decode()}
                v6_event['pull_request']['body']='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V6\n'+\
                    sha(request_raw)+'\nBW_RING3_SETUP_RUNTIME_INVENTORY_V6 -->'
                event_raw=reader.canonical(v6_event)
                old_record=reader.parse(reader.prerequisite_original(reader.canonical(state['observation']['stageBefore']['record'])))
                record=copy.deepcopy(old_record);record['schema']='bw.ring3.node-stage-original.v6'
                record['request']=wrapper;record['event']={'bytes':len(event_raw),'sha256':sha(event_raw),
                    'base64':reader.base64.b64encode(event_raw).decode()}
                record['platform'].pop('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256')
                record['platform']['BW_RING3_SETUP_INVENTORY_V6_REQUEST_SHA256']=sha(request_raw)
                record['platform']['BW_RING3_SETUP_INVENTORY_V6_REQUEST_B64']=reader.base64.b64encode(request_raw).decode()
                record['platform']['GITHUB_JOB']='setup-runtime-inventory-v6'
                record['eventIdentity']['st_size']=len(event_raw)
                record['setup']=setup
                record['recordBoundary']='verified copy after selected setup and policy cleanup, before directory publication'
                record_raw=reader.canonical(record)
                self.assertLessEqual(len(record_raw),1<<20)
                worst=copy.deepcopy(record);full=b'X'*(128<<10)
                encoded={'bytes':len(full),'sha256':sha(full),'base64':reader.base64.b64encode(full).decode()}
                for phase in ('unpack','configure'):
                    for stream in ('stdout','stderr'):worst['setup'][phase][stream]=encoded
                self.assertLessEqual(len(reader.canonical(worst)),1<<20)
                value=copy.deepcopy(state['observation'])
                value['schema']='bw.ring3.setup-runtime-inventory-original.v6'
                value['actualGuestApproved']=False;value['completeHostConfiguration']=False
                for field in ('stageBefore','stageAfter'):
                    stage=value[field];stage['schema']='bw.ring3.setup-node-observation.v6'
                    stage['record']={'bytes':len(record_raw),'sha256':sha(record_raw),
                        'base64':reader.base64.b64encode(record_raw).decode()}
                    file=stage['files']['installation.original.json']
                    file['bytes']=len(record_raw);file['sha256']=sha(record_raw)
                    file['prefix']=record_raw[:4].hex()
                    for name in ('before','after','namedAfter'):file[name][6]=len(record_raw)
                v6_originals={'setup.request.json':request_raw,'setup.event.json':event_raw,
                    'runtime.setup-inventory.json':reader.canonical(value)}
                output=io.BytesIO();output.write(status_log.getvalue())
                reader.emit_setup_v6_inventory(v6_originals,output.write,output.flush)
                v6_log=output.getvalue()
                outer=reader.canonical({'schema':'bw.ring3.setup-outer-terminal.v6','runId':env['GITHUB_RUN_ID'],
                    'unit':'/sys/fs/cgroup/system.slice/bw-ring3-setup-v6-'+env['GITHUB_RUN_ID']+'-1.service',
                    'systemdRunExitCode':0,'outsideCleanupExitCode':0,'cgroupAfter':'absent'})
                source=reader.parse(reader.prerequisite_original(reader.canonical(request['source'])))
                unit='bw-ring3-setup-v6-'+env['GITHUB_RUN_ID']+'-1.service'
                absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
                admission={'requestSha256':sha(request_raw),'eventSha256':sha(event_raw),
                    'head':request['head'],'tree':request['tree'],'source':source,'unit':unit}
                cleanup=reader.canonical({'schema':'bw.ring3.setup-outside-cleanup.v6','runId':env['GITHUB_RUN_ID'],
                    'serviceExitCode':0,'sourceAdmission':admission,'preCensus':absent,
                    'stop':{'attempted':False,'argv':None,'exitCode':None,'timedOut':False},
                    'postCensus':absent,'cgroupTerminal':'absent','unitCensus':None,
                    'policy':None,'action':'not-needed','firstFailure':None,
                    'secondary':[],'setupApproved':False})
                source=reader.parse(reader.prerequisite_original(reader.canonical(request['source'])))
                shell=reader.canonical({'schema':'bw.ring3.setup-image-shell.v6',
                    'fields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                        'ImageVersion':{'present':True,'value':'20261012.334.1'}},
                    'fieldErrors':[],'setupAttempted':False,'guestAttempted':False,
                    'setupApproved':False})
                external_v6={'schema':'bw.ring3.setup-inventory-expectation.v6','requestSha256':sha(request_raw),
                    'runId':env['GITHUB_RUN_ID'],'attempt':1,'head':request['head'],'tree':request['tree'],
                    'workflowSha':env['GITHUB_WORKFLOW_SHA'],
                    'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                    'jobId':456,'jobName':'setup-runtime-inventory-v6','conclusion':'success',
                    'logBytes':len(v6_log),'logSha256':sha(v6_log),
                    'outerBytes':len(outer),'outerSha256':sha(outer),
                    'cleanupBytes':len(cleanup),'cleanupSha256':sha(cleanup),
                    'shellBytes':len(shell),'shellSha256':sha(shell),'invoker':[1001,1002]}
                with patch.object(reader,'SETUP_V6_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V6_STATUS_BYTES',len(pre_status)):
                    verdict=reader.verify_setup_v6_log(v6_log,external_v6,outer,cleanup,shell)
                self.assertTrue(verdict['setupObserved']);self.assertTrue(verdict['outsideTerminalObserved'])
                self.assertFalse(verdict['actualGuestApproved']);self.assertFalse(verdict['completeHostConfiguration'])
                bad_shell=reader.parse(shell)
                bad_shell['fields']['ImageVersion']['value']='different'
                changed=reader.canonical(bad_shell)
                selected=dict(external_v6,shellBytes=len(changed),shellSha256=sha(changed))
                with patch.object(reader,'SETUP_V6_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V6_STATUS_BYTES',len(pre_status)):
                    with self.assertRaises(reader.Refusal):
                        reader.verify_setup_v6_log(v6_log,selected,outer,cleanup,changed)
                failed_setup=copy.deepcopy(setup)
                failed_setup.update(preflight=None,archives=[],policy=None,unpack=None,
                    configure=None,postStatus=None,cleanup=None,policyCleanupCgroup=None,
                    nodeStage=None,runtime=None)
                service_fields={'ImageOS':{'present':True,'value':'ubuntu24'},
                    'ImageVersion':{'present':True,'value':'drift'}}
                failed_setup['partial']={'phase':'preflight','prefix':{
                    'statusOriginal':None,'statusSha256':None,'statusBytes':None,
                    'statusRecords':None,'completedHelpers':[],'helperWitness':{},
                    'imageFields':service_fields,'imageFieldErrors':[]},'failedHelper':None}
                first={'phase':'v6-setup','name':'ValueError','message':'fresh exact hosted image labels'}
                failed_setup['firstFailure']=first
                packet={'schema':'bw.ring3.setup-entry-failure.v6',
                    'context':{'request':record['request'],'event':record['event'],
                        'platform':record['platform'],'source':record['source'],
                        'sourceCommands':record['sourceCommands'],'eventIdentity':record['eventIdentity'],
                        'imageFields':service_fields,'imageFieldErrors':[]},
                    'setup':failed_setup,'firstFailure':first,'secondary':[],
                    'publicationSafe':False,'actualGuestApproved':False,
                    'completeHostConfiguration':False}
                failed_log=reader.canonical(packet)
                failed_outer=reader.parse(outer);failed_outer['systemdRunExitCode']=1
                failed_outer=reader.canonical(failed_outer)
                failed_cleanup=reader.parse(cleanup);failed_cleanup['serviceExitCode']=1
                failed_cleanup=reader.canonical(failed_cleanup)
                failed_external=dict(external_v6,conclusion='failure',logBytes=len(failed_log),
                    logSha256=sha(failed_log),outerBytes=len(failed_outer),
                    outerSha256=sha(failed_outer),cleanupBytes=len(failed_cleanup),
                    cleanupSha256=sha(failed_cleanup))
                with patch.object(reader,'SETUP_V6_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V6_STATUS_BYTES',len(pre_status)):
                    held=reader.verify_setup_v6_failure_log(failed_log,failed_external,
                        failed_outer,failed_cleanup,shell)
                self.assertTrue(held['failedAttemptRetained'])
                self.assertFalse(held['forwardingMatchesExpected'])
                self.assertEqual(held['serviceImageFields'],service_fields)
                self.assertFalse(held['setupObserved'])
                # Inner graph may be complete while the outer bounded client
                # times out: preserve the failed official attempt, never admit it.
                timed_outer=reader.parse(outer);timed_outer['systemdRunExitCode']=124
                timed_outer=reader.canonical(timed_outer)
                timed_cleanup=reader.parse(cleanup);timed_cleanup['serviceExitCode']=124
                timed_cleanup['firstFailure']={'phase':'v6-outer-client','name':'ValueError',
                    'message':'bounded outer setup client exit 124'}
                timed_cleanup=reader.canonical(timed_cleanup)
                timed_external=dict(external_v6,conclusion='failure',
                    outerBytes=len(timed_outer),outerSha256=sha(timed_outer),
                    cleanupBytes=len(timed_cleanup),cleanupSha256=sha(timed_cleanup))
                with patch.object(reader,'SETUP_V6_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V6_STATUS_BYTES',len(pre_status)):
                    timed=reader.verify_setup_v6_failure_log(v6_log,timed_external,
                        timed_outer,timed_cleanup,shell)
                self.assertTrue(timed['innerMetadataCompleteReported'])
                self.assertFalse(timed['setupObserved'])
                self.assertFalse(timed['actualGuestApproved'])
                self.assertEqual(timed['firstFailure']['phase'],'v6-outer-client')
                populated={'terminal':'populated','cgroupProcs':'202\n',
                    'cgroupEvents':'populated 1\n',
                    'cgroupStat':'nr_descendants 0\nnr_dying_descendants 0\n'}
                stop_failed=reader.parse(timed_cleanup)
                stop_failed['preCensus']=populated;stop_failed['postCensus']=populated
                stop_failed['cgroupTerminal']='populated'
                stop_failed['unitCensus']={key:populated[key] for key in
                    ('cgroupProcs','cgroupEvents','cgroupStat')}
                stop_failed['action']=None
                stop_failed['stop']={'attempted':True,'argv':['/usr/bin/timeout','--kill-after=5s',
                    '20s','/usr/bin/systemctl','stop','--',unit],
                    'exitCode':124,'timedOut':True}
                stop_failed['secondary']=[{'phase':'v6-outside-exact-stop',
                    'name':'ValueError','message':'bounded exact-unit stop completed'}]
                stop_failed_raw=reader.canonical(stop_failed)
                live_outer=reader.parse(timed_outer);live_outer['cgroupAfter']='present'
                live_outer=reader.canonical(live_outer)
                live_external=dict(timed_external,outerBytes=len(live_outer),
                    outerSha256=sha(live_outer),cleanupBytes=len(stop_failed_raw),
                    cleanupSha256=sha(stop_failed_raw))
                with patch.object(reader,'SETUP_V6_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V6_STATUS_BYTES',len(pre_status)):
                    retained=reader.verify_setup_v6_failure_log(v6_log,live_external,
                        live_outer,stop_failed_raw,shell)
                    with self.assertRaises(reader.Refusal):
                        reader.verify_setup_v6_log(v6_log,dict(live_external,conclusion='success'),
                            live_outer,stop_failed_raw,shell)
                self.assertTrue(retained['failedAttemptRetained'])
                identity_failed=reader.parse(timed_cleanup)
                identity_failed.update(preCensus=None,postCensus=None,stop=None,
                    cgroupTerminal=None,unitCensus=None,policy=None,action=None)
                identity_failed['secondary']=[{'phase':'v6-outside-policy-cleanup',
                    'name':'ValueError','message':'root-owned exact transient unit directory'}]
                identity_failed_raw=reader.canonical(identity_failed)
                identity_external=dict(timed_external,outerBytes=len(live_outer),
                    outerSha256=sha(live_outer),cleanupBytes=len(identity_failed_raw),
                    cleanupSha256=sha(identity_failed_raw))
                with patch.object(reader,'SETUP_V6_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V6_STATUS_BYTES',len(pre_status)):
                    identity_retained=reader.verify_setup_v6_failure_log(v6_log,identity_external,
                        live_outer,identity_failed_raw,shell)
                self.assertTrue(identity_retained['failedAttemptRetained'])
                self.assertFalse(identity_retained['setupObserved'])
                cut_log=b'2026-10-24T00:00:00Z '+reader.SETUP_V6_LOG_MARKER+b'{"schema":'
                cut_external=dict(timed_external,logBytes=len(cut_log),logSha256=sha(cut_log))
                incomplete=reader.verify_setup_v6_failure_log(cut_log,cut_external,
                    timed_outer,timed_cleanup,shell)
                self.assertTrue(incomplete['innerOriginalIncomplete'])
                self.assertFalse(incomplete['setupObserved'])
                self.assertEqual(incomplete['retainedLogSha256'],sha(cut_log))
                wrong_outer=reader.parse(timed_outer);wrong_outer['systemdRunExitCode']=1
                wrong_outer=reader.canonical(wrong_outer)
                wrong_external=dict(cut_external,outerBytes=len(wrong_outer),outerSha256=sha(wrong_outer))
                with self.assertRaises(reader.Refusal):
                    reader.verify_setup_v6_failure_log(cut_log,wrong_external,
                        wrong_outer,timed_cleanup,shell)
                mismatched=reader.parse(timed_cleanup)
                mismatched['sourceAdmission']['eventSha256']='f'*64
                mismatched_raw=reader.canonical(mismatched)
                mismatched_external=dict(timed_external,cleanupBytes=len(mismatched_raw),
                    cleanupSha256=sha(mismatched_raw))
                with patch.object(reader,'SETUP_V6_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V6_STATUS_BYTES',len(pre_status)),\
                     self.assertRaises(reader.Refusal):
                    reader.verify_setup_v6_failure_log(v6_log,mismatched_external,
                        timed_outer,mismatched_raw,shell)
                self.assertFalse(retained['setupObserved'])
                self.assertEqual(retained['outsideCgroupAfter'],'present')
                self.assertEqual(retained['outerClientExitCode'],124)
        def test_v5_coherent_full_original_graph_reader_and_outer_terminal_cuts(self):
            setup,witness=setup_v5_controls(export_sample=True)
            self.assertEqual(reader.SETUP_V5_STATUS_SHA,
                '4144e0299e81507b7a856beef9fe6e67f55bffd0c0d7e9245265b6920721d1ac')
            self.assertEqual(reader.SETUP_V5_STATUS_BYTES,1231069)
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env)
                self.assertEqual(state['observerExit'],0)
                def status_row(name,version,arch='amd64',state='install ok installed',pending=None):
                    lines=['Package: '+name,'Version: '+version,'Architecture: '+arch,'Status: '+state]
                    if pending is not None:lines.append('Triggers-Pending: '+pending)
                    return '\n'.join(lines).encode()
                base=[status_row('installed-'+str(i).zfill(4),'1',
                    state='deinstall ok config-files' if i==0 else 'install ok installed')
                    for i in range(1210)]
                pre_status=b'\n\n'.join(base+[status_row('libc-bin','2')])+b'\n'
                selected=[status_row(name,version,arch) for name,version,arch,*_ in producer.SETUP_V5_PACKAGE_ROWS]
                post_status=b'\n\n'.join(base+[status_row('libc-bin','2',state='install ok triggers-pending',pending='ldconfig'),
                    *selected])+b'\n'
                status_log=io.BytesIO()
                pre_meta=producer.emit_setup_v5_status('pre',pre_status,status_log.write,status_log.flush)
                post_meta=producer.emit_setup_v5_status('post',post_status,status_log.write,status_log.flush)
                setup['preflight'].update(statusSha256=sha(pre_status),statusBytes=len(pre_status),statusOriginal=pre_meta)
                setup['postStatus'].update(sha256=sha(post_status),bytes=len(post_status),statusOriginal=post_meta)
                v5_request=copy.deepcopy(request);v5_request['schema']='bw.ring3.inventory-request.v5'
                v5_request['setup']=producer.setup_v5_policy();v5_request['payloadWitness']=witness
                v5_request['setup']['statusSha256']=sha(pre_status)
                request_raw=reader.canonical(v5_request)
                v5_event=reader.parse(state['originals']['staged.event.json'])
                v5_event['label']['name']='x86-ring3-setup-runtime-inventory-v5'
                wrapper={'bytes':len(request_raw),'sha256':sha(request_raw),
                    'base64':reader.base64.b64encode(request_raw).decode()}
                v5_event['pull_request']['body']='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V5\n'+\
                    reader.canonical(wrapper).decode().rstrip('\n')+'\nBW_RING3_SETUP_RUNTIME_INVENTORY_V5 -->'
                event_raw=reader.canonical(v5_event)
                old_record=reader.parse(reader.prerequisite_original(reader.canonical(state['observation']['stageBefore']['record'])))
                record=copy.deepcopy(old_record);record['schema']='bw.ring3.node-stage-original.v5'
                record['request']=wrapper;record['event']={'bytes':len(event_raw),'sha256':sha(event_raw),
                    'base64':reader.base64.b64encode(event_raw).decode()}
                record['platform'].pop('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256')
                record['platform']['BW_RING3_SETUP_INVENTORY_V5_REQUEST_SHA256']=sha(request_raw)
                record['platform']['GITHUB_JOB']='setup-runtime-inventory-v5'
                record['eventIdentity']['st_size']=len(event_raw)
                record['setup']=setup
                record['recordBoundary']='verified copy after selected setup and policy cleanup, before directory publication'
                record_raw=reader.canonical(record)
                self.assertLessEqual(len(record_raw),1<<20)
                worst=copy.deepcopy(record);full=b'X'*(128<<10)
                encoded={'bytes':len(full),'sha256':sha(full),'base64':reader.base64.b64encode(full).decode()}
                for phase in ('unpack','configure'):
                    for stream in ('stdout','stderr'):worst['setup'][phase][stream]=encoded
                self.assertLessEqual(len(reader.canonical(worst)),1<<20)
                value=copy.deepcopy(state['observation'])
                value['schema']='bw.ring3.setup-runtime-inventory-original.v5'
                value['actualGuestApproved']=False;value['completeHostConfiguration']=False
                for field in ('stageBefore','stageAfter'):
                    stage=value[field];stage['schema']='bw.ring3.setup-node-observation.v5'
                    stage['record']={'bytes':len(record_raw),'sha256':sha(record_raw),
                        'base64':reader.base64.b64encode(record_raw).decode()}
                    file=stage['files']['installation.original.json']
                    file['bytes']=len(record_raw);file['sha256']=sha(record_raw)
                    file['prefix']=record_raw[:4].hex()
                    for name in ('before','after','namedAfter'):file[name][6]=len(record_raw)
                v5_originals={'setup.request.json':request_raw,'setup.event.json':event_raw,
                    'runtime.setup-inventory.json':reader.canonical(value)}
                output=io.BytesIO();output.write(status_log.getvalue())
                reader.emit_setup_v5_inventory(v5_originals,output.write,output.flush)
                v5_log=output.getvalue()
                outer=reader.canonical({'schema':'bw.ring3.setup-outer-terminal.v5','runId':env['GITHUB_RUN_ID'],
                    'unit':'/sys/fs/cgroup/system.slice/bw-ring3-setup-v5-'+env['GITHUB_RUN_ID']+'-1.service',
                    'systemdRunExitCode':0,'outsideCleanupExitCode':0,'cgroupAfter':'absent'})
                cleanup=reader.canonical({'schema':'bw.ring3.setup-outside-cleanup.v5','runId':env['GITHUB_RUN_ID'],
                    'serviceExitCode':0,'cgroupTerminal':'absent','unitCensus':None,'policy':None,'action':'not-needed',
                    'firstFailure':None,'secondary':[],'setupApproved':False})
                source=reader.parse(reader.prerequisite_original(reader.canonical(request['source'])))
                external_v5={'schema':'bw.ring3.setup-inventory-expectation.v5','requestSha256':sha(request_raw),
                    'runId':env['GITHUB_RUN_ID'],'attempt':1,'head':request['head'],'tree':request['tree'],
                    'workflowSha':env['GITHUB_WORKFLOW_SHA'],
                    'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                    'jobId':456,'jobName':'setup-runtime-inventory-v5','conclusion':'success',
                    'logBytes':len(v5_log),'logSha256':sha(v5_log),
                    'outerBytes':len(outer),'outerSha256':sha(outer),
                    'cleanupBytes':len(cleanup),'cleanupSha256':sha(cleanup),'invoker':[1001,1002]}
                with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                    verdict=reader.verify_setup_v5_log(v5_log,external_v5,outer,cleanup)
                self.assertTrue(verdict['setupObserved']);self.assertTrue(verdict['outsideTerminalObserved'])
                self.assertFalse(verdict['actualGuestApproved']);self.assertFalse(verdict['completeHostConfiguration'])
                failed_setup=copy.deepcopy(setup)
                failed_setup['firstFailure']={'phase':'v5-setup','name':'ValueError','message':'mock preflight refusal'}
                failed_setup['preflight']['imageVersion']='drift';failed_setup['postStatus']=None
                failed_setup['nodeStage']=None;failed_setup['runtime']=None
                failure_packet={'schema':'bw.ring3.setup-entry-failure.v5',
                    'context':{'request':record['request'],'event':record['event'],
                        'platform':record['platform'],'source':record['source'],
                        'sourceCommands':record['sourceCommands'],'eventIdentity':record['eventIdentity']},
                    'setup':failed_setup,'firstFailure':failed_setup['firstFailure'],
                    'secondary':[],'publicationSafe':False,'actualGuestApproved':False,
                    'completeHostConfiguration':False}
                failed_log=status_log.getvalue().splitlines()[0]+b'\n'+reader.canonical(failure_packet)
                failed_outer=reader.parse(outer);failed_outer['systemdRunExitCode']=1
                failed_outer=reader.canonical(failed_outer)
                failed_cleanup=reader.parse(cleanup);failed_cleanup['serviceExitCode']=1
                failed_cleanup=reader.canonical(failed_cleanup)
                failed_external=copy.deepcopy(external_v5)
                failed_external.update(conclusion='failure',logBytes=len(failed_log),logSha256=sha(failed_log),
                    outerBytes=len(failed_outer),outerSha256=sha(failed_outer),
                    cleanupBytes=len(failed_cleanup),cleanupSha256=sha(failed_cleanup))
                with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                    held=reader.verify_setup_v5_failure_log(failed_log,failed_external,failed_outer,failed_cleanup)
                self.assertTrue(held['failedAttemptRetained']);self.assertFalse(held['actualRunApproved'])
                self.assertEqual(held['retainedStatusRoles'],['pre'])
                self.assertTrue(held['rawStatusBytesIndependentlyVerified'])
                pre_line=failed_log.splitlines()[0]+b'\n'
                prefix_packet=copy.deepcopy(failure_packet)
                prefix_setup=prefix_packet['setup']
                prefix_setup.update(preflight=None,archives=[],policy=None,unpack=None,configure=None,
                    postStatus=None,cleanup=None,policyCleanupCgroup=None)
                completed=list(producer.SETUP_V5_HELPERS)[:3]
                failed_path=list(producer.SETUP_V5_HELPERS)[3]
                failed_witness={'path':failed_path,'namedBefore':None,'heldBefore':None,
                    'heldAfter':None,'namedAfter':None,'bytesRead':0,'sha256':None,
                    'closeAttempted':False,'closeSucceeded':False}
                prefix_setup['partial']={'phase':'preflight','prefix':{
                    'statusOriginal':pre_meta,'statusSha256':sha(pre_status),
                    'statusBytes':len(pre_status),'statusRecords':1211,
                    'completedHelpers':completed,
                    'helperWitness':{path:copy.deepcopy(setup['preflight']['helperWitness'][path])
                        for path in completed}},
                    'failedHelper':{'phase':'helper','witness':failed_witness}}
                prefix_packet['firstFailure']=prefix_setup['firstFailure']={
                    'phase':'v5-setup','name':'OSError','message':'FIRST_HELPER_READ'}
                def grade_prefix(packet,include_status=True):
                    log=(pre_line if include_status else b'')+reader.canonical(packet)
                    expected=copy.deepcopy(failed_external)
                    expected.update(logBytes=len(log),logSha256=sha(log))
                    with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                         patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                        return reader.verify_setup_v5_failure_log(log,expected,failed_outer,failed_cleanup)
                self.assertFalse(grade_prefix(prefix_packet)['setupObserved'])
                for mutate in (
                    lambda item:item['setup']['partial']['prefix']['completedHelpers'].reverse(),
                    lambda item:item['setup']['partial']['prefix']['helperWitness'][completed[0]]
                        ['namedAfter'].__setitem__(1,999),
                    lambda item:item['setup']['partial']['prefix']['statusOriginal']
                        .__setitem__('sha256','0'*64),
                    lambda item:item['setup']['partial']['failedHelper']['witness']
                        .__setitem__('path','/usr/bin/dash')):
                    changed=copy.deepcopy(prefix_packet);mutate(changed)
                    with self.assertRaises(reader.Refusal):grade_prefix(changed)
                with self.assertRaises(reader.Refusal):grade_prefix(prefix_packet,False)
                no_baseline=copy.deepcopy(prefix_packet)
                blank=no_baseline['setup']['partial']['prefix']
                blank.update(statusOriginal=None,statusSha256=None,statusBytes=None,
                    statusRecords=None,completedHelpers=[],helperWitness={})
                no_baseline['setup']['partial']['failedHelper']['witness']['path']=list(producer.SETUP_V5_HELPERS)[0]
                with self.assertRaises(reader.Refusal):grade_prefix(no_baseline,False)
                drift=copy.deepcopy(prefix_packet)
                drift['setup']['partial']['prefix']['statusSha256']='0'*64
                drift['setup']['partial']['prefix']['statusOriginal']['sha256']='0'*64
                with self.assertRaises(reader.Refusal):grade_prefix(drift)
                for mutation in (lambda p:p['context']['platform'].__setitem__('GITHUB_RUN_ID','999'),
                    lambda p:p['context']['sourceCommands'].clear(),
                    lambda p:p['context']['sourceCommands'][0]['stdout'].__setitem__('sha256','0'*64),
                    lambda p:p.__setitem__('firstFailure',None)):
                    altered_failure=copy.deepcopy(failure_packet);mutation(altered_failure)
                    altered_log=reader.canonical(altered_failure);changed_external=copy.deepcopy(failed_external)
                    changed_external.update(logBytes=len(altered_log),logSha256=sha(altered_log))
                    with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                         patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                        with self.assertRaises(reader.Refusal):
                            reader.verify_setup_v5_failure_log(altered_log,changed_external,failed_outer,failed_cleanup)
                pre_line=failed_log.splitlines()[0]+b'\n'
                for altered_log in (failed_log[len(pre_line):],pre_line+failed_log):
                    changed_external=copy.deepcopy(failed_external)
                    changed_external.update(logBytes=len(altered_log),logSha256=sha(altered_log))
                    with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                         patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                        with self.assertRaises(reader.Refusal):
                            reader.verify_setup_v5_failure_log(altered_log,changed_external,failed_outer,failed_cleanup)
                stage_failure=copy.deepcopy(failure_packet)
                stage_failure['firstFailure']={'phase':'v5-node-stage','name':'OSError','message':'FIRST_COPY'}
                stage_failure['secondary']=[{'phase':'Node-stage-parent-close','name':'OSError','message':'SECOND_CLOSE'}]
                stage_setup=stage_failure['setup']=copy.deepcopy(setup)
                stage_setup['firstFailure']=copy.deepcopy(stage_failure['firstFailure'])
                stage_setup['secondary']=copy.deepcopy(stage_failure['secondary'])
                stage_setup['nodeStage']=None;stage_setup['runtime']=None
                stage_setup['partial']={'phase':'node-stage','copy':copy.deepcopy(record['copy']),
                    'record':None,'dropProgress':[],'invoker':list(external_v5['invoker'])}
                stage_log=status_log.getvalue()+reader.canonical(stage_failure)
                stage_external=copy.deepcopy(failed_external)
                stage_external.update(logBytes=len(stage_log),logSha256=sha(stage_log))
                with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                    retained=reader.verify_setup_v5_failure_log(stage_log,stage_external,failed_outer,failed_cleanup)
                self.assertTrue(retained['stageAttemptObserved'])
                self.assertEqual(retained['retainedStatusRoles'],['post','pre'])
                for bad_outer in ({'cgroupAfter':'present'},{'systemdRunExitCode':1}):
                    changed=reader.parse(outer);changed.update(bad_outer);changed_raw=reader.canonical(changed)
                    expected=copy.deepcopy(external_v5);expected['outerBytes']=len(changed_raw);expected['outerSha256']=sha(changed_raw)
                    with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                         patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                        with self.assertRaises(reader.Refusal):reader.verify_setup_v5_log(v5_log,expected,changed_raw,cleanup)
                bad=copy.deepcopy(value);bad['stageAfter']['record']['sha256']='0'*64
                altered=dict(v5_originals,**{'runtime.setup-inventory.json':reader.canonical(bad)})
                output=io.BytesIO();output.write(status_log.getvalue())
                reader.emit_setup_v5_inventory(altered,output.write,output.flush)
                changed_log=output.getvalue();expected=copy.deepcopy(external_v5)
                expected['logBytes']=len(changed_log);expected['logSha256']=sha(changed_log)
                with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                     patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                    with self.assertRaises(reader.Refusal):reader.verify_setup_v5_log(changed_log,expected,outer,cleanup)
                def rewrite_record(change,raw_status_log=None):
                    altered_record=copy.deepcopy(record);change(altered_record)
                    changed_raw=reader.canonical(altered_record);altered_value=copy.deepcopy(value)
                    for field in ('stageBefore','stageAfter'):
                        stage=altered_value[field]
                        stage['record']={'bytes':len(changed_raw),'sha256':sha(changed_raw),
                            'base64':reader.base64.b64encode(changed_raw).decode()}
                        file=stage['files']['installation.original.json']
                        file['bytes']=len(changed_raw);file['sha256']=sha(changed_raw)
                        for name in ('before','after','namedAfter'):file[name][6]=len(changed_raw)
                    altered=dict(v5_originals,**{'runtime.setup-inventory.json':reader.canonical(altered_value)})
                    output=io.BytesIO();output.write(status_log.getvalue() if raw_status_log is None else raw_status_log)
                    reader.emit_setup_v5_inventory(altered,output.write,output.flush)
                    changed_log=output.getvalue();expected=copy.deepcopy(external_v5)
                    expected['logBytes']=len(changed_log);expected['logSha256']=sha(changed_log)
                    return changed_log,expected
                changes=(lambda r:r['setup']['unpack']['process'].__setitem__('parentPid',999),
                    lambda r:r['setup']['configure']['process'].__setitem__('parentPid',999),
                    lambda r:(r['setup']['unpack']['process'].__setitem__('spawnMonoNs',1),
                        r['setup']['unpack']['process'].__setitem__('reapMonoNs',2)),
                    lambda r:r['setup']['configure']['process'].__setitem__('reapMonoNs',110000000),
                    lambda r:r['setup']['unpack']['cgroupAfter'].__setitem__('cgroupProcs','101\n202\n'),
                    lambda r:r['setup']['unpack']['cgroupAfter'].__setitem__('cgroupStat','nr_descendants 1\nnr_dying_descendants 0\n'),
                    lambda r:r['setup']['unpack']['cgroupAfter'].__setitem__('cgroupStat','nr_descendants 0\n'),
                    lambda r:r['setup']['postStatus']['selected']['qemu-system-x86'].__setitem__('Status','install ok triggers-pending'))
                for index,change in enumerate(changes):
                    with self.subTest(coherentChange=index):
                        changed_log,expected=rewrite_record(change)
                        with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                             patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                            with self.assertRaises(reader.Refusal):reader.verify_setup_v5_log(changed_log,expected,outer,cleanup)
                for field,replacement in (('Version','0'),('Status','install ok half-configured')):
                    with self.subTest(rawStatusMutation=field):
                        qemu_row=next(row for row in producer.SETUP_V5_PACKAGE_ROWS if row[0]=='qemu-system-x86')
                        old_row=status_row(*qemu_row[:3])
                        if field=='Version':
                            new_row=status_row('qemu-system-x86',replacement,qemu_row[2])
                        else:
                            new_row=status_row(*qemu_row[:3],state=replacement)
                        self.assertEqual(post_status.count(old_row),1)
                        changed_post=post_status.replace(old_row,new_row)
                        changed_status_log=io.BytesIO()
                        producer.emit_setup_v5_status('pre',pre_status,changed_status_log.write,changed_status_log.flush)
                        changed_meta=producer.emit_setup_v5_status('post',changed_post,changed_status_log.write,changed_status_log.flush)
                        def change_post(record):
                            post=record['setup']['postStatus']
                            post.update(sha256=sha(changed_post),bytes=len(changed_post),statusOriginal=changed_meta)
                            post['selected']['qemu-system-x86'][field]=replacement
                        changed_log,expected=rewrite_record(change_post,changed_status_log.getvalue())
                        with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                             patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                            with self.assertRaises(reader.Refusal):reader.verify_setup_v5_log(changed_log,expected,outer,cleanup)
                existing=status_row('installed-0001','1')
                for label,changed_post in (
                    ('upgrade',post_status.replace(existing,status_row('installed-0001','2'))),
                    ('removal',post_status.replace(existing+b'\n\n',b'')),
                    ('extra',post_status+b'\n'+status_row('unreviewed-extra','1')+b'\n'),
                    ('partial-deconfigured',post_status.replace(base[0],status_row('installed-0000','1')))):
                    with self.subTest(rawBaselineDelta=label):
                        changed_rows=reader.setup_v5_status_rows(changed_post)
                        changed_status_log=io.BytesIO()
                        producer.emit_setup_v5_status('pre',pre_status,changed_status_log.write,changed_status_log.flush)
                        changed_meta=producer.emit_setup_v5_status('post',changed_post,changed_status_log.write,changed_status_log.flush)
                        def change_post(record):
                            post=record['setup']['postStatus']
                            post.update(sha256=sha(changed_post),bytes=len(changed_post),
                                        records=len(changed_rows),statusOriginal=changed_meta)
                        changed_log,expected=rewrite_record(change_post,changed_status_log.getvalue())
                        with patch.object(reader,'SETUP_V5_STATUS_SHA',sha(pre_status)),\
                             patch.object(reader,'SETUP_V5_STATUS_BYTES',len(pre_status)):
                            with self.assertRaises(reader.Refusal):
                                reader.verify_setup_v5_log(changed_log,expected,outer,cleanup)

        def test_empty_extent_owner_mode_links_eof_and_close_refuse_without_hiding_first_error(self):
            for fault in ('empty-extent','empty-owner','empty-mode','empty-link','empty-eof','empty-close','empty-read-close'):
                with self.subTest(fault=fault),edges(fault) as (producer,env,request,raw,state):
                    producer.stage_runtime_inventory_node(env);value=state['observation'];self.assertEqual(state['observerExit'],1)
                    self.assertIsNotNone(value['firstFailure']);self.assertIsNone(value['candidate']);self.assertEqual(value['inventory']['probes'] if 'probes' in value['inventory'] else [],[])
                    self.assertEqual(state['fds'],{});self.assertFalse(any(item[0]=='probe' for item in state['runtimeFiles'].events))
                    if fault=='empty-read-close':
                        self.assertEqual(value['firstFailure']['message'],'FIRST_EMPTY_READ');self.assertTrue(any(row['message']=='LATE_EMPTY_CLOSE' for row in value['secondary']))
        def test_selected_mismatch_and_setuid_tools_refuse_before_every_probe(self):
            for fault in ('qemu-hash','tool-setuid','node-metadata-float'):
                with self.subTest(fault=fault),edges(fault) as (producer,env,request,raw,state):
                    producer.stage_runtime_inventory_node(env);value=state['observation'];self.assertIsNotNone(value['firstFailure']);self.assertIsNone(value['candidate'])
                    self.assertEqual(value['inventory']['probes'],[]);self.assertFalse(any(item[0]=='probe' for item in state['runtimeFiles'].events));self.assertEqual(state['fds'],{})
        def test_probe_first_error_and_missing_typed_census_remain_failure_originals(self):
            for fault in ('probe-first','missing-empty-census'):
                with self.subTest(fault=fault),edges(fault) as (producer,env,request,raw,state):
                    producer.stage_runtime_inventory_node(env);value=state['observation'];self.assertEqual(state['observerExit'],1);self.assertIsNotNone(value['firstFailure'])
                    self.assertIsNone(value['candidate']);self.assertTrue(value['stageAfter']['stageObserved']);self.assertEqual(state['fds'],{})
                    if fault=='probe-first':self.assertEqual(value['firstFailure']['message'],'FIRST_PROBE')
        def test_new_request_typed_empty_role_and_staged_path_are_explicit(self):
            with edges() as (producer,env,request,raw,state):
                producer.admit_staged_runtime_request(raw,sha(raw));reader.staged_runtime_request(raw,sha(raw))
                for change in (lambda v:v['selected']['node'].__setitem__('path',reader.RUNTIME_NODE),lambda v:v['emptyPythonSources'].clear(),
                    lambda v:next(iter(v['emptyPythonSources'].values())).__setitem__('bytes',False),
                    lambda v:next(iter(v['emptyPythonSources'].values())).__setitem__('mode',420.0),lambda v:v.__setitem__('schema','bw.ring3.inventory-request.v2')):
                    changed=copy.deepcopy(request);change(changed);bad=reader.canonical(changed)
                    for admit in (producer.admit_staged_runtime_request,reader.staged_runtime_request):
                        with self.assertRaises(ValueError):admit(bad,sha(bad))
        def test_enabled_fixed_cli_drop_failure_and_unprivileged_reader_boundary(self):
            with edges() as (producer,env,request,raw,state),patch.object(producer,'STAGED_RUNTIME_ENTRY_ENABLED',True),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(producer.dispatch_cli(['--stage-runtime-inventory-node'],env),1)
                self.assertEqual(state['observerExit'],0);self.assertIsNone(state['observation']['firstFailure']);self.assertEqual(state['fds'],{})
            output=io.BytesIO();diagnostic=io.BytesIO()
            with edges('drop-error') as (producer,env,request,raw,state),patch.object(producer,'STAGED_RUNTIME_ENTRY_ENABLED',True),\
                patch.object(sys,'stdout',SimpleNamespace(buffer=output)),patch.object(sys,'stderr',SimpleNamespace(buffer=diagnostic)):
                self.assertEqual(producer.dispatch_cli(['--stage-runtime-inventory-node'],env),1);self.assertEqual(output.getvalue(),b'');self.assertEqual(diagnostic.getvalue(),b'')
            with edges() as (producer,env,request,raw,state),patch.object(reader,'STAGED_RUNTIME_INVENTORY_ENABLED',True),\
                patch.object(sys,'argv',['reader.py','--inventory-staged-runtime']),patch.dict(os.environ,env,clear=True),patch.object(sys,'stdout',SimpleNamespace(buffer=io.BytesIO())):
                with self.assertRaises(SystemExit) as error:reader.main()
                self.assertEqual(error.exception.code,1);self.assertEqual(sys.stdout.buffer.getvalue(),b'');self.assertEqual(state['events'],[])
            for args in (['--stage-runtime-inventory-node','--stage-runtime-inventory-node'],['--stage-runtime-inventory-node','--help'],['--stage-runtime-inventory-nod']):
                with patch.object(producer,'stage_runtime_inventory_node',side_effect=AssertionError('no malformed entry')),patch.object(sys,'stderr',io.StringIO()):
                    with self.assertRaises(SystemExit) as error:producer.dispatch_cli(args,{})
                    self.assertEqual(error.exception.code,2)
        def test_shared_cap_one_shot_and_held_generic_positive_extent(self):
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env);value=state['observation']
                candidate=reader.parse(reader.prerequisite_original(reader.canonical(value['candidate'])))
                for index in range(511-len(candidate['files'])):
                    candidate['files']['/usr/lib/staged-test-extra-'+str(index)+'.so']={'bytes':1,'sha256':sha(b'X'),'kind':'shared-library','mode':0o644}
                raw=reader.canonical(candidate);reader.staged_runtime_expectation(raw,sha(raw))
                candidate['files']['/usr/lib/staged-test-overflow.so']={'bytes':1,'sha256':sha(b'X'),'kind':'shared-library','mode':0o644}
                raw=reader.canonical(candidate)
                with self.assertRaisesRegex(reader.Refusal,'shared cap'):reader.staged_runtime_expectation(raw,sha(raw))
                backend=reader.StagedInventoryFiles();empty=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES));before=len(state['events'])
                with self.assertRaisesRegex(reader.Refusal,'regular file and mode'):backend.fact(empty)
                self.assertFalse(any(row[0]=='read' and row[1]==empty for row in state['events'][before:]))
                files=state['runtimeFiles'];pin=files.facts[reader.RUNTIME_QEMU]['sha256'];files.facts[reader.RUNTIME_QEMU]['sha256']='0'*64
                inventory=reader.StagedRuntimeInventory(value['stageBefore']['files']['node']['before'],files,lambda argv:(_ for _ in ()).throw(AssertionError('no probe')))
                with self.assertRaisesRegex(reader.Refusal,'qemu mismatch'):inventory.discover()
                files.facts[reader.RUNTIME_QEMU]['sha256']=pin;before=len(state['events'])
                with self.assertRaisesRegex(reader.Refusal,'no retry'):inventory.discover()
                self.assertEqual(len(state['events']),before)
        def test_v8_complete_manufactured_six_role_envelope_and_coherent_cuts(self):
            # Only this control substitutes a small authored Node and status baseline.
            # The source candidate retains the selected production pins outside it.
            def status_row(name,version,arch='amd64',state='install ok installed',pending=None):
                lines=['Package: '+name,'Version: '+version,'Architecture: '+arch,'Status: '+state]
                if pending is not None:lines.append('Triggers-Pending: '+pending)
                return '\n'.join(lines).encode()
            base=[status_row('installed-'+str(i).zfill(4),'1',
                state='deinstall ok config-files' if i==0 else 'install ok installed')
                for i in range(1210)]
            pre=b'\n\n'.join(base+[status_row('libc-bin','2')])+b'\n'
            selected=[status_row(name,version,arch) for name,version,arch,*_ in p.SETUP_V8_PACKAGE_ROWS]
            post=b'\n\n'.join(base+[status_row('libc-bin','2',state='install ok triggers-pending',pending='ldconfig'),*selected])+b'\n'
            production=(reader.SETUP_V8_STATUS_SHA,reader.SETUP_V8_STATUS_BYTES,p.SETUP_V8_STATUS_SHA)
            self.assertEqual(production[:2],('4144e0299e81507b7a856beef9fe6e67f55bffd0c0d7e9245265b6920721d1ac',1231069))
            with edges() as (producer,env,request,raw,state),\
                 patch.object(reader,'SETUP_V8_STATUS_SHA',sha(pre)),\
                 patch.object(reader,'SETUP_V8_STATUS_BYTES',len(pre)),\
                 patch.object(producer,'SETUP_V8_STATUS_SHA',sha(pre)):
                producer.stage_runtime_inventory_node(env)
                self.assertEqual(state['observerExit'],0)
                setup,witness=setup_v8_controls(export_sample=True)
                status_log=io.BytesIO()
                pre_meta=producer.emit_setup_v8_status('pre',pre,status_log.write,status_log.flush)
                post_meta=producer.emit_setup_v8_status('post',post,status_log.write,status_log.flush)
                setup['preflight'].update(statusSha256=sha(pre),statusBytes=len(pre),statusOriginal=pre_meta)
                setup['postStatus'].update(sha256=sha(post),bytes=len(post),records=1226,statusOriginal=post_meta)
                v8_request=copy.deepcopy(request)
                v8_request.update(schema='bw.ring3.inventory-request.v8',setup=producer.setup_v8_policy(),payloadWitness=witness)
                request_raw=reader.canonical(v8_request)
                wrap=lambda data:{'bytes':len(data),'sha256':sha(data),'base64':base64.b64encode(data).decode()}
                event=reader.parse(state['originals']['staged.event.json'])
                event['label']['name']='x86-ring3-setup-runtime-inventory-v8'
                event['pull_request']['body']='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V8\n'+sha(request_raw)+'\nBW_RING3_SETUP_RUNTIME_INVENTORY_V8 -->'
                event_raw=reader.canonical(event)
                old_record=reader.parse(reader.prerequisite_original(reader.canonical(state['observation']['stageBefore']['record'])))
                record=copy.deepcopy(old_record)
                record.update(schema='bw.ring3.node-stage-original.v8',request=wrap(request_raw),event=wrap(event_raw),
                    setup=setup,recordBoundary='verified copy after selected setup and policy cleanup, before directory publication')
                record['platform'].pop('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256')
                record['platform'].update(BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256=sha(request_raw),
                    BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64=base64.b64encode(request_raw).decode(),
                    GITHUB_JOB='setup-runtime-inventory-v8')
                record['eventIdentity']['st_size']=len(event_raw)
                record_raw=reader.canonical(record)
                state['rows']['/event.json'].update(raw=event_raw,st_size=len(event_raw))
                state['rows'][str(producer.NODE_STAGE_RECORD)].update(raw=record_raw,st_size=len(record_raw))
                state['rows']['/proc/self/cgroup']['raw']=b'0::/system.slice/bw-ring3-setup-v8-123-1.service\n'
                v8_env={**record['platform'],'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
                actual_stage=reader.observe_setup_v8_stage(v8_env)
                self.assertIsNone(actual_stage['firstFailure'],actual_stage['firstFailure'])
                self.assertTrue(actual_stage['stageObserved'])
                self.assertEqual(reader.CAPS['jsonBytes'],producer.JSON_CAP)
                pretty=json.dumps(event,indent=2,sort_keys=False).encode()+b'\n'
                reader.setup_v8_event(pretty,v8_request,sha(request_raw),v8_env)
                self.assertEqual(producer.admit_setup_v8_event(pretty,v8_env)[0],request_raw)
                self.assertTrue(event_raw.endswith(b'}\n'))
                append_event=lambda suffix:event_raw[:-2]+suffix+b'\n'
                finite_extra=append_event(b',"ignoredOverflow":1e3}')
                reader.setup_v8_event(finite_extra,v8_request,sha(request_raw),v8_env)
                self.assertEqual(producer.admit_setup_v8_event(finite_extra,v8_env)[0],request_raw)
                bad_event_bytes=(
                    append_event(b',"ignored":{"x":1,"x":2}}'),
                    append_event(b',"ignored":NaN}'),
                    append_event(b',"ignored":Infinity}'),
                    append_event(b',"ignored":-Infinity}'),
                    append_event(b',"ignored":1e999}'),
                    append_event(b',"ignored":-1e999}'),
                    append_event(b',"ignored":"\xff"}'),
                    event_raw+b'{}',b'[]',b' '*(reader.CAPS['jsonBytes']+1))
                self.assertEqual(reader.parse(append_event(b',"ignoredOverflow":1e999}'))['ignoredOverflow'],float('inf'))
                for bad_raw in bad_event_bytes:
                    with self.subTest(rawSuffix=bad_raw[-24:]),self.assertRaises((ValueError,UnicodeError,TypeError,AttributeError)):
                        producer.admit_setup_v8_event(bad_raw,v8_env)
                    with self.subTest(rawSuffix=bad_raw[-24:]),self.assertRaises((reader.Refusal,ValueError,UnicodeError,TypeError)):
                        reader.setup_v8_event(bad_raw,v8_request,sha(request_raw),v8_env)
                files,old_probe=runtime_fixture()
                node=files.facts.pop(reader.RUNTIME_NODE)
                files.facts[reader.NODE_STAGE_TARGET]=dict(node,mode=0o555)
                files.prefixes[reader.NODE_STAGE_TARGET]=files.prefixes.pop(reader.RUNTIME_NODE)
                files.rejected={}
                empty=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES))
                python_files=files.python_files
                files.python_files=lambda:sorted(python_files()+[empty])
                files.empty_python=lambda name:reader.StagedInventoryFiles.empty_python(files,name)
                original_fact=files.fact
                def fact(path):
                    row=original_fact(path)
                    if path==reader.NODE_STAGE_TARGET:
                        files.metadata[path]=copy.deepcopy(actual_stage['files']['node']['before'])
                    return row
                files.fact=fact
                listings={'qemu-system-x86':[reader.RUNTIME_QEMU,reader.RUNTIME_TCG,'/usr/share/qemu/bios.bin'],
                    'qemu-system-common':['/usr/share/qemu/common-keymap'],
                    'qemu-system-data':['/usr/share/qemu/data-blob',*reader.SETUP_V8_SIGNED_DATA],
                    'seabios':['/usr/share/seabios/bios.bin'],'ipxe-qemu':['/usr/share/ipxe/rom.bin']}
                for path,pin in reader.SETUP_V8_SIGNED_DATA.items():
                    files.facts[path]=dict(pin);files.prefixes[path]=b'inert signed DATA mock'
                def probe(argv):
                    process,streams=old_probe(argv)
                    index=len(observed_probes);observed_probes.append(list(argv))
                    process.update(pid=300+index,pgid=300+index,parentPid=101,
                        startTicks=index+1,spawnMonoNs=60000000+index*1000000,reapMonoNs=60001000+index*1000000)
                    if argv==[reader.NODE_STAGE_TARGET,'--version']:streams['stdout']=b'v22.23.3\n'
                    if argv[:2]==['/usr/bin/dpkg-query','-W']:
                        rows={name:(version,arch) for name,version,arch,*_ in reader.SETUP_V8_PACKAGES if name in reader.PACKAGE_NAMES}
                        streams['stdout']=''.join(name+'\t'+rows[name][0]+'\t'+rows[name][1]+'\n' for name in reader.PACKAGE_NAMES).encode()
                    if argv[:2]==['/usr/bin/dpkg-query','-L']:
                        streams['stdout']=('/.\n'+'\n'.join(listings[argv[2]])+'\n').encode()
                    return process,streams
                observed_probes=[]
                entry_originals,entry_passed,entry_safe=reader.setup_v8_inventory_entry(v8_env,files,probe)
                self.assertEqual((entry_passed,entry_safe),(True,True),
                    reader.parse(entry_originals['runtime.setup-inventory.json'])['firstFailure'])
                self.assertEqual(len(observed_probes),15)
                originals=entry_originals
                value=reader.parse(originals['runtime.setup-inventory.json'])
                candidate_raw=reader.prerequisite_original(reader.canonical(value['candidate']))
                output=io.BytesIO();output.write(status_log.getvalue())
                reader.emit_setup_v8_inventory(originals,output.write,output.flush)
                log=output.getvalue()
                unit='bw-ring3-setup-v8-123-1.service';absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
                source=reader.parse(reader.prerequisite_original(reader.canonical(v8_request['source'])))
                admission={'requestSha256':sha(request_raw),'eventSha256':sha(event_raw),
                    'head':v8_request['head'],'tree':v8_request['tree'],'source':source,'unit':unit}
                cleanup=reader.canonical({'schema':'bw.ring3.setup-outside-cleanup.v8','runId':'123',
                    'serviceExitCode':0,'sourceAdmission':admission,'preCensus':absent,
                    'stop':{'attempted':False,'argv':None,'exitCode':None,'timedOut':False},
                    'postCensus':absent,'cgroupTerminal':'absent','unitCensus':None,'policy':None,
                    'action':'not-needed','firstFailure':None,'secondary':[],'setupApproved':False})
                outer=reader.canonical({'schema':'bw.ring3.setup-outer-terminal.v8','runId':'123',
                    'unit':'/sys/fs/cgroup/system.slice/'+unit,'systemdRunExitCode':0,
                    'outsideCleanupExitCode':0,'cgroupAfter':'absent'})
                shell=reader.canonical({'schema':'bw.ring3.setup-image-shell.v8',
                    'fields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                        'ImageVersion':{'present':True,'value':'20261012.334.1'}},'fieldErrors':[],
                    'setupAttempted':False,'guestAttempted':False,'setupApproved':False})
                external={'schema':'bw.ring3.setup-inventory-expectation.v8','requestSha256':sha(request_raw),
                    'runId':'123','attempt':1,'head':request['head'],'tree':request['tree'],
                    'workflowSha':env['GITHUB_WORKFLOW_SHA'],
                    'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                    'jobId':456,'jobName':'setup-runtime-inventory-v8','conclusion':'success',
                    'logBytes':len(log),'logSha256':sha(log),'outerBytes':len(outer),'outerSha256':sha(outer),
                    'cleanupBytes':len(cleanup),'cleanupSha256':sha(cleanup),
                    'shellBytes':len(shell),'shellSha256':sha(shell),'invoker':[1001,1002]}
                verdict=reader.verify_setup_v8_log(log,external,outer,cleanup,shell)
                self.assertTrue(verdict['setupObserved']);self.assertTrue(verdict['outsideTerminalObserved'])
                self.assertFalse(verdict['actualGuestApproved']);self.assertFalse(verdict['officialJobAuthenticated'])
                self.assertEqual(set(reader.decode_setup_v8_log(log)),set(reader.SETUP_V8_LOG_ROLES))
                self.assertEqual(len(value['inventory']['processes']),15)
                self.assertEqual([row['role'] for row in value['inventory']['probes']],list(reader.SETUP_V8_PROBE_ORDER))
                self.assertEqual({path:value['inventory']['files'][path]['bytes'] for path in reader.SETUP_V8_SIGNED_DATA},
                    {path:pin['bytes'] for path,pin in reader.SETUP_V8_SIGNED_DATA.items()})
                six={'shell-image.original.json':shell,'inventory.original.log':log,
                    'controller.stderr':b'','outside-cleanup.original.json':cleanup,
                    'outside-cleanup.stderr':b'','outer.original.json':outer}
                archive=io.BytesIO()
                with zipfile.ZipFile(archive,'w',zipfile.ZIP_STORED) as output:
                    for name,raw_body in six.items():output.writestr(name,raw_body)
                with zipfile.ZipFile(io.BytesIO(archive.getvalue())) as held:
                    self.assertEqual(set(held.namelist()),set(six))
                    self.assertTrue(all(held.read(name)==raw_body for name,raw_body in six.items()))
                    self.assertLessEqual(held.getinfo('inventory.original.log').file_size,8<<20)
                    self.assertLessEqual(held.getinfo('outside-cleanup.original.json').file_size,16384)
                paths=dict(zip(('log','external','outer','cleanup','shell'),
                    (log,reader.canonical(external),outer,cleanup,shell)))
                argv=['reader.py','--setup-v8-inventory-log','log','--external-admission','external',
                    '--outer-resource-original','outer','--outside-cleanup-original','cleanup',
                    '--shell-image-original','shell']
                with patch.object(reader.sys,'argv',argv),patch.object(reader.sys,'stdout',io.StringIO()) as output,\
                     patch.object(reader.Path,'open',lambda path,*a,**kw:io.BytesIO(paths[str(path)])),\
                     patch.object(reader,'setup_v8_inventory_entry',side_effect=AssertionError('no live inventory')),\
                     patch.object(reader,'inventory_probe',side_effect=AssertionError('no metadata child')):
                    reader.main()
                    self.assertTrue(json.loads(output.getvalue())['setupObserved'])
                def regrade(changed,changed_originals=None,changed_outer=outer,changed_cleanup=cleanup,
                            changed_shell=shell,changed_external=None,status_wire=None):
                    roles=dict(originals) if changed_originals is None else dict(changed_originals)
                    roles['runtime.setup-inventory.json']=reader.canonical(changed)
                    stream=io.BytesIO();stream.write(status_log.getvalue() if status_wire is None else status_wire)
                    reader.emit_setup_v8_inventory(roles,stream.write,stream.flush)
                    wire=stream.getvalue()
                    expected=dict(external,logBytes=len(wire),logSha256=sha(wire),
                        outerBytes=len(changed_outer),outerSha256=sha(changed_outer),
                        cleanupBytes=len(changed_cleanup),cleanupSha256=sha(changed_cleanup),
                        shellBytes=len(changed_shell),shellSha256=sha(changed_shell))
                    if changed_external is not None:expected.update(changed_external)
                    with self.assertRaises(reader.Refusal):
                        reader.verify_setup_v8_log(wire,expected,changed_outer,changed_cleanup,changed_shell)
                def replace_stage_record(changed,new_record):
                    raw_record=reader.canonical(new_record)
                    for role in ('stageBefore','stageAfter'):
                        stage=changed[role];stage['record']=wrap(raw_record)
                        file=stage['files']['installation.original.json']
                        file.update(bytes=len(raw_record),sha256=sha(raw_record),prefix=raw_record[:4].hex())
                        for key in ('before','after','namedAfter'):file[key][6]=len(raw_record)
                    return changed
                bad_request=copy.deepcopy(v8_request);bad_request['schema']='bw.ring3.inventory-request.v7'
                bad_request_raw=reader.canonical(bad_request)
                bad_event=copy.deepcopy(event)
                bad_event['pull_request']['body']=bad_event['pull_request']['body'].replace(sha(request_raw),sha(bad_request_raw))
                bad_event_raw=reader.canonical(bad_event)
                bad_record=copy.deepcopy(record);bad_record['request']=wrap(bad_request_raw)
                bad_record['event']=wrap(bad_event_raw)
                bad_record['platform']['BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256']=sha(bad_request_raw)
                bad_record['platform']['BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64']=base64.b64encode(bad_request_raw).decode()
                bad_record['eventIdentity']['st_size']=len(bad_event_raw)
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                bad_cleanup=reader.parse(cleanup)
                bad_cleanup['sourceAdmission'].update(requestSha256=sha(bad_request_raw),eventSha256=sha(bad_event_raw))
                regrade(changed,dict(originals,**{'setup.request.json':bad_request_raw,'setup.event.json':bad_event_raw}),
                    changed_cleanup=reader.canonical(bad_cleanup),changed_external={'requestSha256':sha(bad_request_raw)})
                bad_event=copy.deepcopy(event);bad_event['sender']['login']='other'
                bad_event_raw=reader.canonical(bad_event)
                bad_record=copy.deepcopy(record);bad_record['event']=wrap(bad_event_raw)
                bad_record['eventIdentity']['st_size']=len(bad_event_raw)
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                bad_cleanup=reader.parse(cleanup)
                bad_cleanup['sourceAdmission']['eventSha256']=sha(bad_event_raw)
                regrade(changed,dict(originals,**{'setup.event.json':bad_event_raw}),
                    changed_cleanup=reader.canonical(bad_cleanup))
                bad_event_raw=append_event(b',"ignoredOverflow":1e999}')
                bad_record=copy.deepcopy(record);bad_record['event']=wrap(bad_event_raw)
                bad_record['eventIdentity']['st_size']=len(bad_event_raw)
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                bad_cleanup=reader.parse(cleanup)
                bad_cleanup['sourceAdmission']['eventSha256']=sha(bad_event_raw)
                regrade(changed,dict(originals,**{'setup.event.json':bad_event_raw}),
                    changed_cleanup=reader.canonical(bad_cleanup))
                old_event_parser=reader.parse_setup_v8_outer
                changed_roles=dict(originals,**{'setup.event.json':bad_event_raw,
                    'runtime.setup-inventory.json':reader.canonical(changed)})
                changed_stream=io.BytesIO();changed_stream.write(status_log.getvalue())
                reader.emit_setup_v8_inventory(changed_roles,changed_stream.write,changed_stream.flush)
                changed_log=changed_stream.getvalue()
                changed_cleanup=reader.canonical(bad_cleanup)
                changed_external=dict(external,logBytes=len(changed_log),logSha256=sha(changed_log),
                    cleanupBytes=len(changed_cleanup),cleanupSha256=sha(changed_cleanup))
                with patch.object(reader,'parse_setup_v8_outer',side_effect=lambda raw:
                        reader.parse(raw) if raw==bad_event_raw else old_event_parser(raw)):
                    old_parser_verdict=reader.verify_setup_v8_log(changed_log,changed_external,outer,
                        changed_cleanup,shell)
                self.assertTrue(old_parser_verdict['setupObserved'])
                old_version=b'Package: qemu-system-data\nVersion: 1:8.2.2+ds-0ubuntu1.18\n'
                new_version=b'Package: qemu-system-data\nVersion: 1:8.2.2+ds-0ubuntu1.19\n'
                self.assertIn(old_version,post)
                bad_post=post.replace(old_version,new_version)
                bad_status=io.BytesIO()
                producer.emit_setup_v8_status('pre',pre,bad_status.write,bad_status.flush)
                bad_post_meta=producer.emit_setup_v8_status('post',bad_post,bad_status.write,bad_status.flush)
                bad_record=copy.deepcopy(record)
                bad_record['setup']['postStatus'].update(sha256=sha(bad_post),bytes=len(bad_post),statusOriginal=bad_post_meta)
                bad_record['setup']['postStatus']['selected']['qemu-system-data']['Version']='1:8.2.2+ds-0ubuntu1.19'
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                regrade(changed,status_wire=bad_status.getvalue())
                def coherent_data_change(path,field,replacement):
                    changed=copy.deepcopy(value);candidate=reader.parse(candidate_raw)
                    candidate['files'][path][field]=replacement
                    changed['inventory']['files'][path][field]=replacement
                    if field=='bytes':changed['inventory']['fileMetadata'][path][6]=replacement
                    if field=='mode':changed['inventory']['fileMetadata'][path][2]=stat.S_IFREG|replacement
                    changed_candidate=reader.canonical(candidate)
                    changed['candidate']=changed['inventory']['candidate']=wrap(changed_candidate)
                    return changed
                for path in reader.SETUP_V8_SIGNED_DATA:
                    for field,replacement in (('sha256','0'*64),('bytes',1),('mode',0o600)):
                        changed=coherent_data_change(path,field,replacement)
                        with self.subTest(path=path,field=field):regrade(changed)
                selected_path=next(iter(reader.SETUP_V8_SIGNED_DATA))
                changed=coherent_data_change(selected_path,'sha256','0'*64)
                selected_roles=dict(originals,**{'runtime.setup-inventory.json':reader.canonical(changed)})
                selected_stream=io.BytesIO();selected_stream.write(status_log.getvalue())
                reader.emit_setup_v8_inventory(selected_roles,selected_stream.write,selected_stream.flush)
                selected_wire=selected_stream.getvalue()
                selected_external=dict(external,logBytes=len(selected_wire),logSha256=sha(selected_wire))
                weakened=copy.deepcopy(reader.SETUP_V8_SIGNED_DATA)
                weakened[selected_path]['sha256']='0'*64
                with patch.object(reader,'SETUP_V8_SIGNED_DATA',weakened):
                    weakened_verdict=reader.verify_setup_v8_log(selected_wire,selected_external,outer,cleanup,shell)
                self.assertTrue(weakened_verdict['setupObserved'])
                self.assertFalse(weakened_verdict['actualGuestApproved'])
                renamed='/usr/share/qemu/QEMU,other.bin'
                candidate=reader.parse(candidate_raw)
                candidate['files'][renamed]=candidate['files'].pop(selected_path)
                candidate['packagePaths']=sorted(renamed if path==selected_path else path
                    for path in candidate['packagePaths'])
                data_paths=candidate['packagePathsByPackage']['qemu-system-data']
                candidate['packagePathsByPackage']['qemu-system-data']=sorted(
                    renamed if path==selected_path else path for path in data_paths)
                candidate['probes']=reader.setup_v8_probe_descriptors(candidate)
                changed=copy.deepcopy(value)
                changed['inventory']['files']=copy.deepcopy(candidate['files'])
                changed['inventory']['fileMetadata'][renamed]=changed['inventory']['fileMetadata'].pop(selected_path)
                role='package-files-qemu-system-data'
                item=next(probe for probe in changed['inventory']['probes'] if probe['role']==role)
                item['stdout']=item['stdout'].replace(selected_path,renamed)
                process=next(row for row in changed['inventory']['processes'] if row['role']==role)
                process['stdout']=wrap(item['stdout'].encode())
                changed_candidate=reader.canonical(candidate)
                changed['candidate']=changed['inventory']['candidate']=wrap(changed_candidate)
                regrade(changed)
                selected_roles=dict(originals,**{'runtime.setup-inventory.json':reader.canonical(changed)})
                selected_stream=io.BytesIO();selected_stream.write(status_log.getvalue())
                reader.emit_setup_v8_inventory(selected_roles,selected_stream.write,selected_stream.flush)
                selected_wire=selected_stream.getvalue()
                selected_external=dict(external,logBytes=len(selected_wire),logSha256=sha(selected_wire))
                weakened=copy.deepcopy(reader.SETUP_V8_SIGNED_DATA)
                weakened[renamed]=weakened.pop(selected_path)
                with patch.object(reader,'SETUP_V8_SIGNED_DATA',weakened):
                    weakened_verdict=reader.verify_setup_v8_log(selected_wire,selected_external,outer,cleanup,shell)
                self.assertTrue(weakened_verdict['setupObserved'])
                changed=copy.deepcopy(value);candidate=reader.parse(candidate_raw)
                alias={'linkText':'other.bin','target':'/usr/share/qemu/other.bin'}
                candidate['aliases'][selected_path]=alias
                changed['inventory']['aliases'][selected_path]=copy.deepcopy(alias)
                changed_candidate=reader.canonical(candidate)
                changed['candidate']=changed['inventory']['candidate']=wrap(changed_candidate)
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['stageAfter']['identity']['groups']=[0]
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['inventory']['probes'][8]['stdout']=changed['inventory']['probes'][8]['stdout'].replace(
                    '/usr/share/qemu/QEMU,VGA.bin','/usr/share/qemu/QEMU,other.bin')
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['stageAfter']['source'][reader.WORKFLOW]['sha256']='0'*64
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['stageBefore']['record']['sha256']='0'*64
                regrade(changed)
                changed=copy.deepcopy(value)
                tampered=dict(originals)
                tampered['setup.request.json']=tampered['setup.request.json'][:-1]+b' '
                regrade(changed,tampered)
                changed_outer=reader.parse(outer);changed_outer['cgroupAfter']='present'
                regrade(copy.deepcopy(value),changed_outer=reader.canonical(changed_outer))
                changed_shell=reader.parse(shell);changed_shell['fields']['ImageVersion']['value']='different'
                regrade(copy.deepcopy(value),changed_shell=reader.canonical(changed_shell))
            self.assertEqual((reader.SETUP_V8_STATUS_SHA,reader.SETUP_V8_STATUS_BYTES,p.SETUP_V8_STATUS_SHA),production)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests));assert result.wasSuccessful(),'staged runtime controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'completeRootDropStageGraphOriginalReader':True,'metadataProbes':11,'OSAndProcessesMocked':True,
        'compactAuthoredNodePinOnlyInControls':True,'historicalProductionPinHeld':p.GENERATION_NODE_PIN==historical,'actualRunApproved':False,'pass':True}))


def setup_v4_controls(export_sample=False):
    """Injected v4 setup chain only; no network, dpkg, service or guest edge."""
    p,_=producer_fixture_case()
    witness=copy.deepcopy(p.SETUP_V4_PAYLOAD_PINS)
    assert witness==reader.SETUP_V4_PAYLOAD_PINS and len(witness['archives'])==15
    class FakeOps:
        def __init__(self,fault=None):self.fault=fault;self.events=[];self.snapshot=None
        def preflight(self,request):
            self.events.append('preflight');value={'imageOS':'ubuntu24','imageVersion':p.SETUP_V4_IMAGE,
                'statusSha256':p.SETUP_V4_STATUS_SHA,'statusBytes':1231069,'statusRecords':1211,
                'statusOriginal':{'role':'pre','bytes':1231069,'sha256':p.SETUP_V4_STATUS_SHA,
                    'packedBytes':286949,'packedSha256':'a'*64},
                'helperSha256':p.SETUP_V4_HELPERS,'helperAliases':copy.deepcopy(p.SETUP_V4_HELPER_ALIASES),
                'policyAbsent':True,'newPackagesAbsent':True,
                'resource':{'membership':'0::/system.slice/bw-ring3-setup-v4-123-1.service\n',
                    'limits':dict(p.LIMITS)},
                'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}
            if self.fault=='image':value['imageVersion']='drift'
            if self.fault=='status':value['statusSha256']='0'*64
            if self.fault=='helper':value['helperSha256']=dict(value['helperSha256'],**{'/usr/bin/dash':'0'*64})
            if self.fault=='alias':value['helperAliases']['/bin/sh']['target']='/usr/bin/bash'
            if self.fault=='preexisting-policy':value['policyAbsent']=False
            return value
        def acquire(self,package):
            self.events.append('acquire');index=self.events.count('acquire')-1
            row={'package':package,'path':'/run/bw-ring3-setup-v4-123-1/'+str(index).zfill(2)+'.deb',
                'url':'https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+package['filename'],
                'bytes':package['size'],
                'sha256':package['sha256'],'identity':[1,100+index,0o100600,0,0,1,package['size'],100],
                'closeSucceeded':True}
            if self.fault=='archive' and index==4:row['sha256']='0'*64
            return row
        def create_policy(self,data):
            self.events.append('policy');row={'path':'/usr/sbin/policy-rc.d','identity':[1,500,0o100755,0,0,1,19,100],
                'sha256':sha(data),'mode':0o755,'exclusive':True}
            if self.fault=='policy':row['exclusive']=False
            return row
        def dpkg(self,args):
            phase='unpack' if '--unpack' in args else 'configure';self.events.append(phase)
            argv=['/usr/bin/dpkg',*args];start=40000000 if phase=='unpack' else 50000000
            process={'schema':'bw.ring3.process.v1','role':'setup-v4','argv':argv,'cwdRole':'checkout',
                'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
                'pid':200 if phase=='unpack' else 201,'pgid':200 if phase=='unpack' else 201,
                'parentPid':101,'startTicks':7,'spawnMonoNs':start,'reapMonoNs':start+1000,
                'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0.1,'systemSeconds':0.1,'maxRssKiB':1200},
                'firstFailure':None,'secondary':[]}
            row={'argv':argv,'process':process,'stdout':None,'stderr':None,'exitCode':0,
                'timedOut':False,'firstFailure':None,'secondary':[]}
            if self.fault==phase:row['exitCode']=1
            return row
        def quiescent(self,phase):
            self.events.append('census-'+phase)
            members='101\n202\n' if self.fault=='descendant' else '101\n'
            return {'phase':phase,'cgroupProcs':members,'cgroupEvents':'populated 1\nfrozen 0\n',
                'cgroupStat':'nr_descendants '+('1' if self.fault=='nested' else '0')+'\nnr_dying_descendants 0\n',
                'onlyController':members=='101\n' and self.fault!='nested'}
        def post_status(self,request):
            self.events.append('post-status');selected={name:{'Package':name,'Version':version,'Architecture':arch,
                'Status':'install ok installed','Triggers-Pending':None,'Triggers-Awaited':None}
                for name,version,arch,*_ in p.SETUP_V4_PACKAGE_ROWS}
            row={'sha256':'e'*64,'bytes':1234000,'records':1226,'selected':selected,
                'statusOriginal':{'role':'post','bytes':1234000,'sha256':'e'*64,
                    'packedBytes':300000,'packedSha256':'b'*64},
                'pendingHostTriggers':{'libc-bin:amd64':{'status':'install ok triggers-pending',
                    'pending':'ldconfig','awaited':None}},
                'serviceObserved':{'unit':copy.deepcopy(witness['serviceUnit']),
                    'init':copy.deepcopy(witness['initScript'])},
                'allSelectedPresent':True,'allowedStates':True,'deferredHostTriggers':True,'configurationComplete':False}
            if self.fault=='deferred':row['deferredHostTriggers']=False
            if self.fault=='post-status':selected['qemu-system-x86']['Status']='install ok half-configured'
            return row
        def remove_policy(self,record):
            self.events.append('cleanup')
            if self.fault=='cleanup':raise ValueError('mock exact cleanup failure')
            return {'removedExactOwnIdentity':True,'identity':record['identity']}
        def close_archives(self,archives):self.events.append('archive-cleanup')
        def stage_drop_inventory(self,request,facts):
            self.events.append('stage');self.snapshot=copy.deepcopy(facts)
            if self.fault=='drop':return {'verifiedCopy':True,'irreversibleDrop':False},{'graphObserved':False,'actualGuestApproved':False}
            if self.fault=='graph':return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':False,'actualGuestApproved':False}
            return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':True,'actualGuestApproved':False}
    class Tests(unittest.TestCase):
        def request(self):
            env,expected,old,data=prerequisite_fixture()
            source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old['request.original.json'])['source'])))
            def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            request={'schema':'bw.ring3.inventory-request.v4','repository':'CrispStrobe/bw-board',
                'pullRequest':645,'head':'a'*40,'tree':'b'*40,'source':wrap(reader.canonical(source)),
                'selected':{'node':{'path':reader.NODE_STAGE_TARGET,'bytes':p.GENERATION_NODE_PIN[0],
                    'sha256':p.GENERATION_NODE_PIN[1]},'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}},
                'nodeStage':{'source':reader.RUNTIME_NODE,'destination':reader.NODE_STAGE_TARGET,'owner':[0,0],
                    'fileMode':0o555,'directoryMode':0o555},
                'emptyPythonSources':copy.deepcopy(reader.STAGED_EMPTY_PYTHON_SOURCES),
                'setup':p.setup_v4_policy(),'payloadWitness':copy.deepcopy(witness)}
            return request
        def test_explicit_disabled_guard_refuses_before_host_edges(self):
            with patch.object(p,'SETUP_V4_ENABLED',False),patch.object(p,'setup_v4_entry',side_effect=AssertionError('no host')),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v4'],{}),1)
        def test_enabled_metadata_dispatch_still_uses_admission_entry(self):
            self.assertIs(p.SETUP_V4_ENABLED,True);self.assertIs(reader.SETUP_V4_READER_ENABLED,True)
            self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            for mode,name in (('setup-runtime-inventory-v4','setup_v4_entry'),('cleanup-setup-v4-policy','setup_v4_outside_cleanup')):
                with self.subTest(mode=mode),patch.object(p,name,return_value=17) as entry:
                    self.assertEqual(p.dispatch_cli(['--'+mode],{'test':'inert'}),17)
                    entry.assert_called_once_with({'test':'inert'})
            with patch.object(sys,'argv',['reader.py','--inventory-setup-v4']),patch.object(reader,'setup_v4_inventory_entry',return_value=({},False,False)) as entry:
                with self.assertRaises(SystemExit) as stopped: reader.main()
                self.assertEqual(stopped.exception.code,1);entry.assert_called_once()
        def test_exact_distinct_request_and_mutations(self):
            request=self.request();raw=reader.canonical(request)
            self.assertEqual(p.admit_setup_v4_request(raw,sha(raw)),request)
            self.assertEqual(reader.setup_v4_request(raw,sha(raw))[0],request)
            for field,value in (('schema','bw.ring3.inventory-request.v3'),('head','f'*40),
                ('payloadWitness',dict(witness,schema='wrong')),('setup',dict(request['setup'],force=True))):
                candidate=copy.deepcopy(request);candidate[field]=value;bad=reader.canonical(candidate)
                with self.subTest(field=field),self.assertRaises((ValueError,reader.Refusal)):
                    reader.setup_v4_request(bad,sha(bad))
            with self.assertRaises((ValueError,reader.Refusal)):p.admit_setup_v4_request(raw,'0'*64)
        def test_mock_positive_full_chain_and_independent_setup_reader(self):
            request=self.request();ops=FakeOps();facts=p.setup_v4_sequence(ops,request)
            self.assertIsNone(facts['firstFailure']);self.assertEqual(facts['secondary'],[])
            self.assertEqual(ops.events,['preflight']+['acquire']*15+['policy','unpack','census-unpack',
                'configure','census-configure','post-status','census-policy-cleanup','cleanup',
                'archive-cleanup','stage'])
            self.assertTrue(facts['nodeStage']['irreversibleDrop']);self.assertTrue(facts['runtime']['graphObserved'])
            self.assertTrue(reader.setup_v4_facts(ops.snapshot,'123',101,31000000)['setupObserved'])
            self.assertFalse(reader.setup_v4_facts(ops.snapshot,'123',101,31000000)['completeHostConfiguration'])
        def test_coherent_setup_cuts_never_reach_stage(self):
            for fault in ('image','status','helper','alias','preexisting-policy','archive','policy','unpack','configure','deferred','cleanup','descendant','nested'):
                with self.subTest(fault=fault):
                    ops=FakeOps(fault);facts=p.setup_v4_sequence(ops,self.request())
                    self.assertIsNotNone(facts['firstFailure']);self.assertNotIn('stage',ops.events)
            for fault in ('drop','graph'):
                ops=FakeOps(fault);facts=p.setup_v4_sequence(ops,self.request())
                self.assertIsNotNone(facts['firstFailure']);self.assertIn('stage',ops.events)
        def test_partial_acquisition_primary_and_cleanup_secondary(self):
            class Partial(FakeOps):
                def acquire(self,package):
                    if self.events.count('acquire')==4:
                        error=OSError('FIRST_PARTIAL_ARCHIVE')
                        error.ring3_partial={'phase':'archive','receivedBytes':37,'writtenBytes':12,
                            'writeUncertain':True}
                        raise error
                    return super().acquire(package)
                def close_archives(self,archives):
                    self.events.append('archive-cleanup')
                    raise OSError('SECOND_ARCHIVE_CLEANUP')
            ops=Partial();facts=p.setup_v4_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_PARTIAL_ARCHIVE')
            self.assertEqual(facts['secondary'][0]['message'],'SECOND_ARCHIVE_CLEANUP')
            self.assertEqual(facts['partial']['receivedBytes'],37)
        def test_child_first_survives_census_failure(self):
            class ChildAndCensus(FakeOps):
                def dpkg(self,args):
                    item=super().dpkg(args)
                    item['firstFailure']={'phase':'setup-v4','name':'TimeoutError','message':'FIRST_CHILD_TIMEOUT'}
                    item['timedOut']=True
                    return item
                def quiescent(self,phase):
                    self.events.append('census-'+phase)
                    raise OSError('SECOND_CGROUP_READ')
            ops=ChildAndCensus();facts=p.setup_v4_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_CHILD_TIMEOUT')
            self.assertIn('SECOND_CGROUP_READ',[item['message'] for item in facts['secondary']])
            self.assertNotIn('configure',ops.events);self.assertNotIn('stage',ops.events)
            self.assertIsNone(facts['unpack']['cgroupAfter'])
        def test_real_host_oexcl_fstat_faults_close_and_refuse_unknown_unlink(self):
            host=p.SetupV4Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            root=Path('/run/bw-ring3-setup-v4-123-1');host.root=root
            closed=[];unlinked=[]
            with patch.object(host,'archive_root',return_value=root),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_ARCHIVE_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)),\
                 patch.object(p.urllib.request,'build_opener',side_effect=AssertionError('no GET')):
                with self.assertRaisesRegex(OSError,'FIRST_ARCHIVE_FSTAT') as caught:
                    host.acquire(p.setup_v4_policy()['packages'][0])
                self.assertEqual(caught.exception.ring3_partial['ownedIdentity'],None)
                with self.assertRaisesRegex(ValueError,'identity unknown'):host.close_archives([])
            self.assertEqual(closed,[77]);self.assertEqual(unlinked,[])
            closed=[]
            with patch.object(Path,'exists',return_value=False),patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(p.os,'open',return_value=78),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_POLICY_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)):
                with self.assertRaisesRegex(OSError,'FIRST_POLICY_FSTAT') as caught:
                    host.create_policy(p.SETUP_V4_POLICY_BYTES)
                self.assertIsNone(caught.exception.ring3_partial['createdIdentity'])
                self.assertIn('identity unknown',caught.exception.ring3_secondary[0]['message'])
            self.assertEqual(closed,[78]);self.assertEqual(unlinked,[])
            host=p.SetupV4Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            with patch.object(p.os,'mkdir',return_value=None),\
                 patch.object(Path,'lstat',side_effect=OSError('FIRST_DIRECTORY_STAT')),\
                 patch.object(p.os,'rmdir',side_effect=AssertionError('no unknown rmdir')):
                with self.assertRaisesRegex(OSError,'FIRST_DIRECTORY_STAT') as caught:host.archive_root()
                self.assertEqual(caught.exception.ring3_partial['phase'],'archive-directory')
                self.assertEqual(host.root,root);self.assertIsNone(host.root_identity)
                with self.assertRaisesRegex(ValueError,'identity before removal'):host.close_archives([])
        def test_stage_copy_first_and_close_secondary_then_drop_exec_progress(self):
            owner=SimpleNamespace(facts={'source':{},'sourceCommands':[],'eventIdentity':{}})
            env={key:'fixed' for key in p.SETUP_V4_ENV}
            env.update(SUDO_UID='1001',SUDO_GID='1002')
            host=p.SetupV4Host(env,b'event',b'request',owner)
            metadata=SimpleNamespace(st_uid=1001,st_gid=1002,st_mode=0o100644)
            class CopyEdge:
                def __init__(self,fail):self.fail=fail;self.facts={'created':['/run/fake']}
                def copy(self):
                    if self.fail:raise ValueError('FIRST_NODE_COPY')
                def record(self,raw):pass
                def close(self,failure):
                    if self.fail:failure.add(OSError('SECOND_PARENT_CLOSE'),'Node-stage-parent-close')
            for fail in (True,False):
                edge=CopyEdge(fail)
                with self.subTest(copyFailure=fail),\
                     patch.object(p,'NodeStageCopy',return_value=edge),\
                     patch.object(Path,'lstat',return_value=metadata),\
                     patch.object(p.os,'setgroups',return_value=None),\
                     patch.object(p.os,'setresgid',return_value=None),\
                     patch.object(p.os,'setresuid',return_value=None),\
                     patch.object(p,'entry_ids',return_value=None),\
                     patch.object(p.os,'execve',side_effect=OSError('FIRST_EXEC')):
                    with self.assertRaises(p.ObservedFailure if fail else OSError) as caught:
                        host.stage_drop_inventory({}, {})
                error=caught.exception
                self.assertEqual(error.firstFailure['message'] if fail else str(error),
                                 'FIRST_NODE_COPY' if fail else 'FIRST_EXEC')
                if fail:self.assertEqual(error.secondary[0]['message'],'SECOND_PARENT_CLOSE')
                self.assertEqual(error.ring3_partial['copy'],edge.facts)
                self.assertEqual(error.ring3_partial['dropProgress'],[] if fail else
                                 ['groups','gid','uid','ids-verified'])
        def test_outside_cleanup_refuses_live_descendant_and_records_absent_policy(self):
            env={'GITHUB_RUN_ID':'123','BW_SYSTEMD_RUN_EXIT_CODE':'0'}
            for mode,expected_exit in (('absent',0),('direct-child',1),('nested-child',1),
                                       ('missing-dying-counter',1)):
                unit_exists=mode!='absent'
                with self.subTest(mode=mode):
                    output=io.BytesIO();unlinks=[]
                    def exists(path):
                        return unit_exists if str(path).startswith('/sys/fs/cgroup/system.slice/') else False
                    def census(_,path):
                        if path.name=='cgroup.procs':return '101\n202\n' if mode=='direct-child' else ''
                        if path.name=='cgroup.events':return 'populated 1\n' if mode=='direct-child' else 'populated 0\n'
                        return ('nr_descendants '+('1' if mode=='nested-child' else '0')+'\n'+
                            ('' if mode=='missing-dying-counter' else 'nr_dying_descendants 0\n'))
                    with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                         patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                         patch.object(Path,'exists',exists),\
                         patch.object(Path,'is_symlink',return_value=False),\
                         patch.object(p.Cgroups,'text',side_effect=census),\
                         patch.object(p.os,'unlink',side_effect=lambda path:unlinks.append(path)),\
                         patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                        code=p.setup_v4_outside_cleanup(env)
                    self.assertEqual(code,expected_exit)
                    packet=reader.parse(output.getvalue())
                    self.assertIs(packet['setupApproved'],False)
                    self.assertEqual(packet['firstFailure'] is None,expected_exit==0)
                    self.assertEqual(packet['action'],'not-needed' if expected_exit==0 else None)
                    self.assertEqual(unlinks,[])
            for helper in (p.setup_v4_cgroup_quiet,reader.setup_v4_cgroup_quiet):
                with self.assertRaises((ValueError,reader.Refusal)):
                    helper('101\n','populated 1\n','nr_descendants 0\n',101)
        def test_raw_status_decoder_duplicate_tail_truncation_and_bomb(self):
            pre=b'Package: authored\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n'
            post=pre+b'\nPackage: second\nVersion: 1\nArchitecture: all\nStatus: install ok installed\n'
            output=io.BytesIO();p.emit_setup_v4_status('pre',pre,output.write,output.flush)
            pre_line=output.getvalue();p.emit_setup_v4_status('post',post,output.write,output.flush)
            raw=output.getvalue();self.assertEqual(reader.decode_setup_v4_status_log(raw)['pre']['raw'],pre)
            for malformed in (pre+b'Status:other\n',pre+b'Status:\tother\n',
                              pre+b' continued-authority\n'):
                with self.assertRaises((reader.Refusal,ValueError)):
                    reader.setup_v4_status_rows(malformed)
                with self.assertRaises(ValueError):p.setup_v4_status_rows(malformed)
            with self.assertRaises(reader.Refusal):reader.decode_setup_v4_status_log(raw+pre_line)
            for state in ('overflow','incomplete','tail'):
                class RefusingDecoder:
                    eof=state!='incomplete'
                    unused_data=b'X' if state=='tail' else b''
                    unconsumed_tail=b''
                    def decompress(self,data,limit):
                        return b'X'*(limit if state=='overflow' else 1)
                    def flush(self):raise AssertionError('flush before bounded stream validation')
                with self.subTest(decompressState=state),\
                     patch.object(reader.zlib,'decompressobj',return_value=RefusingDecoder()):
                    with self.assertRaises(reader.Refusal):reader.decode_setup_v4_status_log(raw)
            marker=p.SETUP_V4_STATUS_MARKER
            packet=reader.parse(pre_line[len(marker):]);packed=reader.base64.b64decode(packet['packed'])
            for invalid in (packed[:-2],packed+b'\0\0\0\0',p.zlib.compress(b'A'*((8<<20)+1))):
                changed=copy.deepcopy(packet);changed['packed']=reader.base64.b64encode(invalid).decode()
                changed['packedBytes']=len(invalid);changed['packedSha256']=sha(invalid)
                if invalid!=packed[:-2]:changed['rawBytes']=8<<20
                line=marker+reader.canonical(changed)+raw[len(pre_line):]
                with self.assertRaises(reader.Refusal):reader.decode_setup_v4_status_log(line)
        def test_versioned_outer_json_and_combined_wire_subbudgets(self):
            outer=reader.canonical({'schema':'bw.ring3.setup-runtime-inventory-original.v4',
                                    'largeObservedGraph':'x'*(1<<20)})
            self.assertGreater(len(outer),1<<20)
            self.assertEqual(reader.parse_setup_v4_outer(outer)['schema'],
                             'bw.ring3.setup-runtime-inventory-original.v4')
            with self.assertRaises(reader.Refusal):reader.parse(outer)
            for invalid in (b'{"a":1,"a":2}',b'{"a":1e10000}',b'"'+b'x'*(4<<20)+b'"'):
                with self.assertRaises(reader.Refusal):reader.parse_setup_v4_outer(invalid)
            oversized_roles={'runtime.setup-inventory.json':b'X'*(4<<20),
                'setup.event.json':b'E'*(512<<10),'setup.request.json':b'R'*(512<<10)}
            output=io.BytesIO()
            with self.assertRaisesRegex(reader.Refusal,'six-MiB v4 runtime component'):
                reader.emit_setup_v4_inventory(oversized_roles,output.write,output.flush)
            self.assertLessEqual(len(output.getvalue()),6<<20)
        def test_independent_packet_mutations(self):
            ops=FakeOps();p.setup_v4_sequence(ops,self.request());base=ops.snapshot
            for field,change in [('archives',lambda x:x[0].update(sha256='0'*64)),
                ('archives',lambda x:x[0].update(url='https://archive.ubuntu.com/ubuntu/'+x[0]['package']['filename'])),
                ('policy',lambda x:x.update(identity=[1,1,0o100755,0,0,1,19,100])),
                ('preflight',lambda x:x['helperAliases']['/bin/sh'].update(target='/usr/bin/bash')),
                ('configure',lambda x:x.update(exitCode=1)),
                ('postStatus',lambda x:x.update(configurationComplete=True))]:
                bad=copy.deepcopy(base);change(bad[field])
                with self.subTest(field=field),self.assertRaises(reader.Refusal):reader.setup_v4_facts(bad,'123',101,31000000)
    if export_sample:
        request=Tests().request();ops=FakeOps();facts=p.setup_v4_sequence(ops,request)
        assert facts['firstFailure'] is None and ops.snapshot is not None
        return copy.deepcopy(ops.snapshot),copy.deepcopy(witness)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure v4 setup controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'dpkg':False,
        'guest':False,'actualRunApproved':False,'pass':True}))


def setup_v5_controls(export_sample=False):
    """Injected v5 setup chain only; no network, dpkg, service or guest edge."""
    p,_=producer_fixture_case()
    witness=copy.deepcopy(p.SETUP_V5_PAYLOAD_PINS)
    assert witness==reader.SETUP_V5_PAYLOAD_PINS and len(witness['archives'])==15
    class FakeOps:
        def __init__(self,fault=None):self.fault=fault;self.events=[];self.snapshot=None
        def preflight(self,request):
            self.events.append('preflight');value={'imageOS':'ubuntu24','imageVersion':p.SETUP_V5_IMAGE,
                'statusSha256':p.SETUP_V5_STATUS_SHA,'statusBytes':1231069,'statusRecords':1211,
                'statusOriginal':{'role':'pre','bytes':1231069,'sha256':p.SETUP_V5_STATUS_SHA,
                    'packedBytes':286949,'packedSha256':'a'*64},
                'helperSha256':p.SETUP_V5_HELPERS,'helperAliases':copy.deepcopy(p.SETUP_V5_HELPER_ALIASES),
                'helperWitness':{path:{'path':path,'namedBefore':info,'heldBefore':info[:],
                    'heldAfter':info[:],'namedAfter':info[:],
                    'bytesRead':info[6],'sha256':pin,'closeAttempted':True,'closeSucceeded':True}
                    for path,pin in p.SETUP_V5_HELPERS.items()
                    for info in ([1,100+list(p.SETUP_V5_HELPERS).index(path),0o100755,0,0,1,
                        p.SETUP_V5_NEW_HELPER_BYTES.get(path,1234),100],)},
                'policyAbsent':True,'newPackagesAbsent':True,
                'resource':{'membership':'0::/system.slice/bw-ring3-setup-v5-123-1.service\n',
                    'limits':dict(p.LIMITS)},
                'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}
            if self.fault=='image':value['imageVersion']='drift'
            if self.fault=='status':value['statusSha256']='0'*64
            if self.fault=='helper':value['helperSha256']=dict(value['helperSha256'],**{'/usr/bin/dash':'0'*64})
            if self.fault=='alias':value['helperAliases']['/bin/sh']['target']='/usr/bin/bash'
            if self.fault=='preexisting-policy':value['policyAbsent']=False
            return value
        def acquire(self,package):
            self.events.append('acquire');index=self.events.count('acquire')-1
            row={'package':package,'path':'/run/bw-ring3-setup-v5-123-1/'+str(index).zfill(2)+'.deb',
                'url':'https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+package['filename'],
                'bytes':package['size'],
                'sha256':package['sha256'],'identity':[1,100+index,0o100600,0,0,1,package['size'],100],
                'closeSucceeded':True}
            if self.fault=='archive' and index==4:row['sha256']='0'*64
            return row
        def create_policy(self,data):
            self.events.append('policy');row={'path':'/usr/sbin/policy-rc.d','identity':[1,500,0o100755,0,0,1,19,100],
                'sha256':sha(data),'mode':0o755,'exclusive':True}
            if self.fault=='policy':row['exclusive']=False
            return row
        def dpkg(self,args):
            phase='unpack' if '--unpack' in args else 'configure';self.events.append(phase)
            argv=['/usr/bin/dpkg',*args];start=40000000 if phase=='unpack' else 50000000
            process={'schema':'bw.ring3.process.v1','role':'setup-v5','argv':argv,'cwdRole':'checkout',
                'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'},
                'pid':200 if phase=='unpack' else 201,'pgid':200 if phase=='unpack' else 201,
                'parentPid':101,'startTicks':7,'spawnMonoNs':start,'reapMonoNs':start+1000,
                'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0.1,'systemSeconds':0.1,'maxRssKiB':1200},
                'firstFailure':None,'secondary':[]}
            row={'argv':argv,'process':process,'stdout':None,'stderr':None,'exitCode':0,
                'timedOut':False,'firstFailure':None,'secondary':[]}
            if self.fault==phase:row['exitCode']=1
            return row
        def quiescent(self,phase):
            self.events.append('census-'+phase)
            members='101\n202\n' if self.fault=='descendant' else '101\n'
            return {'phase':phase,'cgroupProcs':members,'cgroupEvents':'populated 1\nfrozen 0\n',
                'cgroupStat':'nr_descendants '+('1' if self.fault=='nested' else '0')+'\nnr_dying_descendants 0\n',
                'onlyController':members=='101\n' and self.fault!='nested'}
        def post_status(self,request):
            self.events.append('post-status');selected={name:{'Package':name,'Version':version,'Architecture':arch,
                'Status':'install ok installed','Triggers-Pending':None,'Triggers-Awaited':None}
                for name,version,arch,*_ in p.SETUP_V5_PACKAGE_ROWS}
            row={'sha256':'e'*64,'bytes':1234000,'records':1226,'selected':selected,
                'statusOriginal':{'role':'post','bytes':1234000,'sha256':'e'*64,
                    'packedBytes':300000,'packedSha256':'b'*64},
                'pendingHostTriggers':{'libc-bin:amd64':{'status':'install ok triggers-pending',
                    'pending':'ldconfig','awaited':None}},
                'serviceObserved':{'unit':copy.deepcopy(witness['serviceUnit']),
                    'init':copy.deepcopy(witness['initScript'])},
                'allSelectedPresent':True,'allowedStates':True,'deferredHostTriggers':True,'configurationComplete':False}
            if self.fault=='deferred':row['deferredHostTriggers']=False
            if self.fault=='post-status':selected['qemu-system-x86']['Status']='install ok half-configured'
            return row
        def remove_policy(self,record):
            self.events.append('cleanup')
            if self.fault=='cleanup':raise ValueError('mock exact cleanup failure')
            return {'removedExactOwnIdentity':True,'identity':record['identity']}
        def close_archives(self,archives):self.events.append('archive-cleanup')
        def stage_drop_inventory(self,request,facts):
            self.events.append('stage');self.snapshot=copy.deepcopy(facts)
            if self.fault=='drop':return {'verifiedCopy':True,'irreversibleDrop':False},{'graphObserved':False,'actualGuestApproved':False}
            if self.fault=='graph':return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':False,'actualGuestApproved':False}
            return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':True,'actualGuestApproved':False}
    class Tests(unittest.TestCase):
        def request(self):
            env,expected,old,data=prerequisite_fixture()
            source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old['request.original.json'])['source'])))
            def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            request={'schema':'bw.ring3.inventory-request.v5','repository':'CrispStrobe/bw-board',
                'pullRequest':645,'head':'a'*40,'tree':'b'*40,'source':wrap(reader.canonical(source)),
                'selected':{'node':{'path':reader.NODE_STAGE_TARGET,'bytes':p.GENERATION_NODE_PIN[0],
                    'sha256':p.GENERATION_NODE_PIN[1]},'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}},
                'nodeStage':{'source':reader.RUNTIME_NODE,'destination':reader.NODE_STAGE_TARGET,'owner':[0,0],
                    'fileMode':0o555,'directoryMode':0o555},
                'emptyPythonSources':copy.deepcopy(reader.STAGED_EMPTY_PYTHON_SOURCES),
                'setup':p.setup_v5_policy(),'payloadWitness':copy.deepcopy(witness)}
            return request
        def test_explicit_disabled_guard_refuses_before_host_edges(self):
            with patch.object(p,'SETUP_V5_ENABLED',False),patch.object(p,'setup_v5_entry',side_effect=AssertionError('no host')),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v5'],{}),1)
            with patch.object(reader,'SETUP_V5_READER_ENABLED',False),\
                 patch.object(sys,'argv',['reader.py','--inventory-setup-v5']),\
                 patch.object(reader,'setup_v5_inventory_entry',side_effect=AssertionError('no reader')):
                with self.assertRaises(reader.Refusal):reader.main()
        def test_enabled_metadata_dispatch_still_uses_admission_entry(self):
            self.assertIs(p.SETUP_V5_ENABLED,True);self.assertIs(reader.SETUP_V5_READER_ENABLED,True)
            self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            for mode,name in (('setup-runtime-inventory-v5','setup_v5_entry'),('cleanup-setup-v5-policy','setup_v5_outside_cleanup')):
                with self.subTest(mode=mode),patch.object(p,name,return_value=17) as entry:
                    self.assertEqual(p.dispatch_cli(['--'+mode],{'test':'inert'}),17)
                    entry.assert_called_once_with({'test':'inert'})
            with patch.object(sys,'argv',['reader.py','--inventory-setup-v5']),patch.object(reader,'setup_v5_inventory_entry',return_value=({},False,False)) as entry:
                with self.assertRaises(SystemExit) as stopped: reader.main()
                self.assertEqual(stopped.exception.code,1);entry.assert_called_once()
        def test_exact_distinct_request_and_mutations(self):
            request=self.request();raw=reader.canonical(request)
            self.assertEqual(p.admit_setup_v5_request(raw,sha(raw)),request)
            self.assertEqual(reader.setup_v5_request(raw,sha(raw))[0],request)
            for field,value in (('schema','bw.ring3.inventory-request.v3'),('head','f'*40),
                ('payloadWitness',dict(witness,schema='wrong')),('setup',dict(request['setup'],force=True))):
                candidate=copy.deepcopy(request);candidate[field]=value;bad=reader.canonical(candidate)
                with self.subTest(field=field),self.assertRaises((ValueError,reader.Refusal)):
                    reader.setup_v5_request(bad,sha(bad))
            with self.assertRaises((ValueError,reader.Refusal)):p.admit_setup_v5_request(raw,'0'*64)
        def test_mock_positive_full_chain_and_independent_setup_reader(self):
            request=self.request();ops=FakeOps();facts=p.setup_v5_sequence(ops,request)
            self.assertIsNone(facts['firstFailure']);self.assertEqual(facts['secondary'],[])
            self.assertEqual(ops.events,['preflight']+['acquire']*15+['policy','unpack','census-unpack',
                'configure','census-configure','post-status','census-policy-cleanup','cleanup',
                'archive-cleanup','stage'])
            self.assertTrue(facts['nodeStage']['irreversibleDrop']);self.assertTrue(facts['runtime']['graphObserved'])
            self.assertTrue(reader.setup_v5_facts(ops.snapshot,'123',101,31000000)['setupObserved'])
            self.assertFalse(reader.setup_v5_facts(ops.snapshot,'123',101,31000000)['completeHostConfiguration'])
        def test_coherent_setup_cuts_never_reach_stage(self):
            for fault in ('image','status','helper','alias','preexisting-policy','archive','policy','unpack','configure','deferred','cleanup','descendant','nested'):
                with self.subTest(fault=fault):
                    ops=FakeOps(fault);facts=p.setup_v5_sequence(ops,self.request())
                    self.assertIsNotNone(facts['firstFailure']);self.assertNotIn('stage',ops.events)
            for fault in ('drop','graph'):
                ops=FakeOps(fault);facts=p.setup_v5_sequence(ops,self.request())
                self.assertIsNotNone(facts['firstFailure']);self.assertIn('stage',ops.events)
        def test_partial_acquisition_primary_and_cleanup_secondary(self):
            class Partial(FakeOps):
                def acquire(self,package):
                    if self.events.count('acquire')==4:
                        error=OSError('FIRST_PARTIAL_ARCHIVE')
                        error.ring3_partial={'phase':'archive','receivedBytes':37,'writtenBytes':12,
                            'writeUncertain':True}
                        raise error
                    return super().acquire(package)
                def close_archives(self,archives):
                    self.events.append('archive-cleanup')
                    raise OSError('SECOND_ARCHIVE_CLEANUP')
            ops=Partial();facts=p.setup_v5_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_PARTIAL_ARCHIVE')
            self.assertEqual(facts['secondary'][0]['message'],'SECOND_ARCHIVE_CLEANUP')
            self.assertEqual(facts['partial']['receivedBytes'],37)
        def test_child_first_survives_census_failure(self):
            class ChildAndCensus(FakeOps):
                def dpkg(self,args):
                    item=super().dpkg(args)
                    item['firstFailure']={'phase':'setup-v5','name':'TimeoutError','message':'FIRST_CHILD_TIMEOUT'}
                    item['timedOut']=True
                    return item
                def quiescent(self,phase):
                    self.events.append('census-'+phase)
                    raise OSError('SECOND_CGROUP_READ')
            ops=ChildAndCensus();facts=p.setup_v5_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_CHILD_TIMEOUT')
            self.assertIn('SECOND_CGROUP_READ',[item['message'] for item in facts['secondary']])
            self.assertNotIn('configure',ops.events);self.assertNotIn('stage',ops.events)
            self.assertIsNone(facts['unpack']['cgroupAfter'])
        def test_real_host_oexcl_fstat_faults_close_and_refuse_unknown_unlink(self):
            host=p.SetupV5Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            root=Path('/run/bw-ring3-setup-v5-123-1');host.root=root
            closed=[];unlinked=[]
            with patch.object(host,'archive_root',return_value=root),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_ARCHIVE_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)),\
                 patch.object(p.urllib.request,'build_opener',side_effect=AssertionError('no GET')):
                with self.assertRaisesRegex(OSError,'FIRST_ARCHIVE_FSTAT') as caught:
                    host.acquire(p.setup_v5_policy()['packages'][0])
                self.assertEqual(caught.exception.ring3_partial['ownedIdentity'],None)
                with self.assertRaisesRegex(ValueError,'identity unknown'):host.close_archives([])
            self.assertEqual(closed,[77]);self.assertEqual(unlinked,[])
            closed=[]
            with patch.object(Path,'exists',return_value=False),patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(p.os,'open',return_value=78),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_POLICY_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)):
                with self.assertRaisesRegex(OSError,'FIRST_POLICY_FSTAT') as caught:
                    host.create_policy(p.SETUP_V5_POLICY_BYTES)
                self.assertIsNone(caught.exception.ring3_partial['createdIdentity'])
                self.assertIn('identity unknown',caught.exception.ring3_secondary[0]['message'])
            self.assertEqual(closed,[78]);self.assertEqual(unlinked,[])
            host=p.SetupV5Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            with patch.object(p.os,'mkdir',return_value=None),\
                 patch.object(Path,'lstat',side_effect=OSError('FIRST_DIRECTORY_STAT')),\
                 patch.object(p.os,'rmdir',side_effect=AssertionError('no unknown rmdir')):
                with self.assertRaisesRegex(OSError,'FIRST_DIRECTORY_STAT') as caught:host.archive_root()
                self.assertEqual(caught.exception.ring3_partial['phase'],'archive-directory')
                self.assertEqual(host.root,root);self.assertIsNone(host.root_identity)
                with self.assertRaisesRegex(ValueError,'identity before removal'):host.close_archives([])
        def test_stage_copy_first_and_close_secondary_then_drop_exec_progress(self):
            owner=SimpleNamespace(facts={'source':{},'sourceCommands':[],'eventIdentity':{}})
            env={key:'fixed' for key in p.SETUP_V5_ENV}
            env.update(SUDO_UID='1001',SUDO_GID='1002')
            host=p.SetupV5Host(env,b'event',b'request',owner)
            metadata=SimpleNamespace(st_uid=1001,st_gid=1002,st_mode=0o100644)
            class CopyEdge:
                def __init__(self,fail):self.fail=fail;self.facts={'created':['/run/fake']}
                def copy(self):
                    if self.fail:raise ValueError('FIRST_NODE_COPY')
                def record(self,raw):pass
                def close(self,failure):
                    if self.fail:failure.add(OSError('SECOND_PARENT_CLOSE'),'Node-stage-parent-close')
            for fail in (True,False):
                edge=CopyEdge(fail)
                with self.subTest(copyFailure=fail),\
                     patch.object(p,'NodeStageCopy',return_value=edge),\
                     patch.object(Path,'lstat',return_value=metadata),\
                     patch.object(p.os,'setgroups',return_value=None),\
                     patch.object(p.os,'setresgid',return_value=None),\
                     patch.object(p.os,'setresuid',return_value=None),\
                     patch.object(p,'entry_ids',return_value=None),\
                     patch.object(p.os,'execve',side_effect=OSError('FIRST_EXEC')):
                    with self.assertRaises(p.ObservedFailure if fail else OSError) as caught:
                        host.stage_drop_inventory({}, {})
                error=caught.exception
                self.assertEqual(error.firstFailure['message'] if fail else str(error),
                                 'FIRST_NODE_COPY' if fail else 'FIRST_EXEC')
                if fail:self.assertEqual(error.secondary[0]['message'],'SECOND_PARENT_CLOSE')
                self.assertEqual(error.ring3_partial['copy'],edge.facts)
                self.assertEqual(error.ring3_partial['dropProgress'],[] if fail else
                                 ['groups','gid','uid','ids-verified'])
        def test_outside_cleanup_refuses_live_descendant_and_records_absent_policy(self):
            env={'GITHUB_RUN_ID':'123','BW_SYSTEMD_RUN_EXIT_CODE':'0'}
            for mode,expected_exit in (('absent',0),('direct-child',1),('nested-child',1),
                                       ('missing-dying-counter',1)):
                unit_exists=mode!='absent'
                with self.subTest(mode=mode):
                    output=io.BytesIO();unlinks=[]
                    def exists(path):
                        return unit_exists if str(path).startswith('/sys/fs/cgroup/system.slice/') else False
                    def census(_,path):
                        if path.name=='cgroup.procs':return '101\n202\n' if mode=='direct-child' else ''
                        if path.name=='cgroup.events':return 'populated 1\n' if mode=='direct-child' else 'populated 0\n'
                        return ('nr_descendants '+('1' if mode=='nested-child' else '0')+'\n'+
                            ('' if mode=='missing-dying-counter' else 'nr_dying_descendants 0\n'))
                    with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                         patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                         patch.object(Path,'exists',exists),\
                         patch.object(Path,'is_symlink',return_value=False),\
                         patch.object(p.Cgroups,'text',side_effect=census),\
                         patch.object(p.os,'unlink',side_effect=lambda path:unlinks.append(path)),\
                         patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                        code=p.setup_v5_outside_cleanup(env)
                    self.assertEqual(code,expected_exit)
                    packet=reader.parse(output.getvalue())
                    self.assertIs(packet['setupApproved'],False)
                    self.assertEqual(packet['firstFailure'] is None,expected_exit==0)
                    self.assertEqual(packet['action'],'not-needed' if expected_exit==0 else None)
                    self.assertEqual(unlinks,[])
            for helper in (p.setup_v5_cgroup_quiet,reader.setup_v5_cgroup_quiet):
                with self.assertRaises((ValueError,reader.Refusal)):
                    helper('101\n','populated 1\n','nr_descendants 0\n',101)
        def test_raw_status_decoder_duplicate_tail_truncation_and_bomb(self):
            pre=b'Package: authored\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n'
            post=pre+b'\nPackage: second\nVersion: 1\nArchitecture: all\nStatus: install ok installed\n'
            output=io.BytesIO();p.emit_setup_v5_status('pre',pre,output.write,output.flush)
            pre_line=output.getvalue();p.emit_setup_v5_status('post',post,output.write,output.flush)
            raw=output.getvalue();self.assertEqual(reader.decode_setup_v5_status_log(raw)['pre']['raw'],pre)
            for malformed in (pre+b'Status:other\n',pre+b'Status:\tother\n',
                              pre+b' continued-authority\n'):
                with self.assertRaises((reader.Refusal,ValueError)):
                    reader.setup_v5_status_rows(malformed)
                with self.assertRaises(ValueError):p.setup_v5_status_rows(malformed)
            with self.assertRaises(reader.Refusal):reader.decode_setup_v5_status_log(raw+pre_line)
            for state in ('overflow','incomplete','tail'):
                class RefusingDecoder:
                    eof=state!='incomplete'
                    unused_data=b'X' if state=='tail' else b''
                    unconsumed_tail=b''
                    def decompress(self,data,limit):
                        return b'X'*(limit if state=='overflow' else 1)
                    def flush(self):raise AssertionError('flush before bounded stream validation')
                with self.subTest(decompressState=state),\
                     patch.object(reader.zlib,'decompressobj',return_value=RefusingDecoder()):
                    with self.assertRaises(reader.Refusal):reader.decode_setup_v5_status_log(raw)
            marker=p.SETUP_V5_STATUS_MARKER
            packet=reader.parse(pre_line[len(marker):]);packed=reader.base64.b64decode(packet['packed'])
            for invalid in (packed[:-2],packed+b'\0\0\0\0',p.zlib.compress(b'A'*((8<<20)+1))):
                changed=copy.deepcopy(packet);changed['packed']=reader.base64.b64encode(invalid).decode()
                changed['packedBytes']=len(invalid);changed['packedSha256']=sha(invalid)
                if invalid!=packed[:-2]:changed['rawBytes']=8<<20
                line=marker+reader.canonical(changed)+raw[len(pre_line):]
                with self.assertRaises(reader.Refusal):reader.decode_setup_v5_status_log(line)
        def test_versioned_outer_json_and_combined_wire_subbudgets(self):
            outer=reader.canonical({'schema':'bw.ring3.setup-runtime-inventory-original.v5',
                                    'largeObservedGraph':'x'*(1<<20)})
            self.assertGreater(len(outer),1<<20)
            self.assertEqual(reader.parse_setup_v5_outer(outer)['schema'],
                             'bw.ring3.setup-runtime-inventory-original.v5')
            with self.assertRaises(reader.Refusal):reader.parse(outer)
            for invalid in (b'{"a":1,"a":2}',b'{"a":1e10000}',b'"'+b'x'*(4<<20)+b'"'):
                with self.assertRaises(reader.Refusal):reader.parse_setup_v5_outer(invalid)
            oversized_roles={'runtime.setup-inventory.json':b'X'*(4<<20),
                'setup.event.json':b'E'*(512<<10),'setup.request.json':b'R'*(512<<10)}
            output=io.BytesIO()
            with self.assertRaisesRegex(reader.Refusal,'six-MiB v5 runtime component'):
                reader.emit_setup_v5_inventory(oversized_roles,output.write,output.flush)
            self.assertLessEqual(len(output.getvalue()),6<<20)
        def test_independent_packet_mutations(self):
            ops=FakeOps();p.setup_v5_sequence(ops,self.request());base=ops.snapshot
            for field,change in [('archives',lambda x:x[0].update(sha256='0'*64)),
                ('archives',lambda x:x[0].update(url='https://archive.ubuntu.com/ubuntu/'+x[0]['package']['filename'])),
                ('policy',lambda x:x.update(identity=[1,1,0o100755,0,0,1,19,100])),
                ('preflight',lambda x:x['helperAliases']['/bin/sh'].update(target='/usr/bin/bash')),
                ('preflight',lambda x:x['helperWitness']['/usr/sbin/ldconfig.real']['namedAfter'].__setitem__(1,999)),
                ('configure',lambda x:x.update(exitCode=1)),
                ('postStatus',lambda x:x.update(configurationComplete=True))]:
                bad=copy.deepcopy(base);change(bad[field])
                with self.subTest(field=field),self.assertRaises(reader.Refusal):reader.setup_v5_facts(bad,'123',101,31000000)
        def test_repaired_helper_alias_and_installer_environment_are_exact(self):
            request=self.request();raw=reader.canonical(request)
            for setup in (dict(request['setup'],installerPath='/usr/bin:/bin'),
                          dict(request['setup'],helperSha256=dict(request['setup']['helperSha256'],
                              **{'/usr/sbin/ldconfig.real':'0'*64})),
                          dict(request['setup'],helperAliases=dict(request['setup']['helperAliases'],
                              **{'/sbin':dict(request['setup']['helperAliases']['/sbin'],target='/elsewhere')}))):
                bad=dict(request,setup=setup);wire=reader.canonical(bad)
                with self.assertRaises((ValueError,reader.Refusal)):
                    p.admit_setup_v5_request(wire,sha(wire))
                with self.assertRaises(reader.Refusal):reader.setup_v5_request(wire,sha(wire))
            ops=FakeOps();p.setup_v5_sequence(ops,request);bad=copy.deepcopy(ops.snapshot)
            bad['unpack']['process']['environment']['PATH']='/usr/bin:/bin'
            with self.assertRaises(reader.Refusal):reader.setup_v5_facts(bad,'123',101,31000000)
            tool=p.SetupV5Tool(['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V5_CONFIGURE_ORDER])
            self.assertEqual(tool.environment['PATH'],'/usr/sbin:/usr/bin:/bin')
            self.assertEqual(p.ENV['PATH'],'/usr/bin:/bin')
            self.assertEqual(raw,reader.canonical(reader.setup_v5_request(raw,sha(raw))[0]))
        def test_distinct_v5_event_and_job_cannot_use_consumed_v4_marker(self):
            request=self.request();raw=reader.canonical(request);pin=sha(raw)
            wrapper=reader.canonical(p.original_bytes(raw)).decode().rstrip('\n')
            marker='BW_RING3_SETUP_RUNTIME_INVENTORY_V5'
            body='<!-- '+marker+'\n'+wrapper+'\n'+marker+' -->'
            event={'action':'labeled','label':{'name':'x86-ring3-setup-runtime-inventory-v5'},
                'repository':{'full_name':'CrispStrobe/bw-board'},'sender':{'login':'CrispStrobe'},
                'number':645,'pull_request':{'number':645,'state':'open','body':body,
                    'head':{'sha':request['head'],'repo':{'full_name':'CrispStrobe/bw-board','fork':False}},
                    'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}}
            env={'BW_RING3_SETUP_INVENTORY_V5_REQUEST_SHA256':pin,'GITHUB_RUN_ID':'123',
                'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
                'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe',
                'GITHUB_JOB':'setup-runtime-inventory-v5','BW_EXPECTED_HEAD':request['head'],
                'BW_EXPECTED_TREE':request['tree'],'GITHUB_WORKFLOW_SHA':'c'*40,
                'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge'}
            wire=reader.canonical(event)
            with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                self.assertEqual(p.admit_setup_v5_event(wire,env)[1],request)
            reader.setup_v5_event(wire,request,pin,env)
            for bad_event,bad_env in ((dict(event,label={'name':'x86-ring3-setup-runtime-inventory-v1'}),env),
                                      (dict(event,pull_request=dict(event['pull_request'],
                                          body=body.replace('V5','V4'))),env),
                                      (event,dict(env,GITHUB_JOB='setup-runtime-inventory')),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V5_REQUEST_SHA256='0'*64))):
                with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                    with self.assertRaises((ValueError,reader.Refusal)):
                        p.admit_setup_v5_event(reader.canonical(bad_event),bad_env)
                with self.assertRaises(reader.Refusal):
                    reader.setup_v5_event(reader.canonical(bad_event),request,pin,bad_env)
        def test_new_child_profile_still_binds_role_and_terminal(self):
            class Child:
                role='setup-v5'
                environment=dict(p.SETUP_V5_INSTALLER_ENV)
                def __init__(self):self.clock=0
                def now(self):self.clock+=1000;return self.clock
                def spawn(self):return {'pid':201,'pgid':201,'parentPid':101,'startTicks':7}
                def read_available(self,timeout):return []
                def reap(self):return {'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                    'rusage':{'userSeconds':0.0,'systemSeconds':0.0,'maxRssKiB':1}}
                def close(self):pass
                def kill(self):raise AssertionError('no kill of completed child')
            argv=['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V5_CONFIGURE_ORDER]
            process,streams=p.collect_child(Child(),'setup-v5',argv,profile='setup-v5')
            self.assertIsNone(process['firstFailure']);self.assertEqual(process['environment'],p.SETUP_V5_INSTALLER_ENV)
            self.assertEqual(streams,{'stdout':b'','stderr':b''})
            with self.assertRaises(ValueError):p.collect_child(Child(),'setup-v4',argv,profile='setup-v5')
        def test_named_held_helper_readback_and_primary_close_failure(self):
            path='/usr/sbin/ldconfig.real';body=b'pure fixture only'
            named=SimpleNamespace(st_dev=1,st_ino=2,st_mode=0o100755,st_uid=0,st_gid=0,
                st_nlink=1,st_size=len(body),st_mtime_ns=3)
            changed=SimpleNamespace(**dict(vars(named),st_ino=99))
            with patch.object(p,'SETUP_V5_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V5_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                row=p.setup_v5_helper_witness(path,sha(body))
                self.assertTrue(row['closeSucceeded']);self.assertEqual(row['bytesRead'],len(body))
                self.assertEqual(row['namedBefore'],row['heldAfter']);closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V5_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V5_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',side_effect=[named,changed]),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                with self.assertRaisesRegex(ValueError,'closed selected helper identity') as caught:
                    p.setup_v5_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_partial['witness']['namedAfter'][1],99)
                closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V5_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V5_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=OSError('FIRST_HELPER_READ')),\
                 patch.object(p.os,'close',side_effect=OSError('SECOND_HELPER_CLOSE')):
                with self.assertRaisesRegex(OSError,'FIRST_HELPER_READ') as caught:
                    p.setup_v5_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_secondary[0]['message'],'SECOND_HELPER_CLOSE')
                self.assertTrue(caught.exception.ring3_partial['witness']['closeAttempted'])
    if export_sample:
        request=Tests().request();ops=FakeOps();facts=p.setup_v5_sequence(ops,request)
        assert facts['firstFailure'] is None and ops.snapshot is not None
        return copy.deepcopy(ops.snapshot),copy.deepcopy(witness)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure v5 setup controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'dpkg':False,
        'guest':False,'actualRunApproved':False,'pass':True}))


def setup_v6_controls(export_sample=False):
    """Injected v6 setup chain only; no network, dpkg, service or guest edge."""
    p,_=producer_fixture_case()
    witness=copy.deepcopy(p.SETUP_V6_PAYLOAD_PINS)
    assert witness==reader.SETUP_V6_PAYLOAD_PINS and len(witness['archives'])==15
    class FakeOps:
        def __init__(self,fault=None):self.fault=fault;self.events=[];self.snapshot=None
        def preflight(self,request):
            self.events.append('preflight');value={'imageOS':'ubuntu24','imageVersion':p.SETUP_V6_IMAGE,
                'imageFields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                    'ImageVersion':{'present':True,'value':p.SETUP_V6_IMAGE}},
                'imageFieldErrors':[],
                'statusSha256':p.SETUP_V6_STATUS_SHA,'statusBytes':1231069,'statusRecords':1211,
                'statusOriginal':{'role':'pre','bytes':1231069,'sha256':p.SETUP_V6_STATUS_SHA,
                    'packedBytes':286949,'packedSha256':'a'*64},
                'helperSha256':p.SETUP_V6_HELPERS,'helperAliases':copy.deepcopy(p.SETUP_V6_HELPER_ALIASES),
                'helperWitness':{path:{'path':path,'namedBefore':info,'heldBefore':info[:],
                    'heldAfter':info[:],'namedAfter':info[:],
                    'bytesRead':info[6],'sha256':pin,'closeAttempted':True,'closeSucceeded':True}
                    for path,pin in p.SETUP_V6_HELPERS.items()
                    for info in ([1,100+list(p.SETUP_V6_HELPERS).index(path),0o100755,0,0,1,
                        p.SETUP_V6_NEW_HELPER_BYTES.get(path,1234),100],)},
                'policyAbsent':True,'newPackagesAbsent':True,
                'resource':{'membership':'0::/system.slice/bw-ring3-setup-v6-123-1.service\n',
                    'limits':dict(p.LIMITS)},
                'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}
            if self.fault=='image':value['imageVersion']='drift'
            if self.fault=='status':value['statusSha256']='0'*64
            if self.fault=='helper':value['helperSha256']=dict(value['helperSha256'],**{'/usr/bin/dash':'0'*64})
            if self.fault=='alias':value['helperAliases']['/bin/sh']['target']='/usr/bin/bash'
            if self.fault=='preexisting-policy':value['policyAbsent']=False
            return value
        def acquire(self,package):
            self.events.append('acquire');index=self.events.count('acquire')-1
            row={'package':package,'path':'/run/bw-ring3-setup-v6-123-1/'+str(index).zfill(2)+'.deb',
                'url':'https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+package['filename'],
                'bytes':package['size'],
                'sha256':package['sha256'],'identity':[1,100+index,0o100600,0,0,1,package['size'],100],
                'closeSucceeded':True}
            if self.fault=='archive' and index==4:row['sha256']='0'*64
            return row
        def create_policy(self,data):
            self.events.append('policy');row={'path':'/usr/sbin/policy-rc.d','identity':[1,500,0o100755,0,0,1,19,100],
                'sha256':sha(data),'mode':0o755,'exclusive':True}
            if self.fault=='policy':row['exclusive']=False
            return row
        def dpkg(self,args):
            phase='unpack' if '--unpack' in args else 'configure';self.events.append(phase)
            argv=['/usr/bin/dpkg',*args];start=40000000 if phase=='unpack' else 50000000
            process={'schema':'bw.ring3.process.v1','role':'setup-v6','argv':argv,'cwdRole':'checkout',
                'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'},
                'pid':200 if phase=='unpack' else 201,'pgid':200 if phase=='unpack' else 201,
                'parentPid':101,'startTicks':7,'spawnMonoNs':start,'reapMonoNs':start+1000,
                'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0.1,'systemSeconds':0.1,'maxRssKiB':1200},
                'firstFailure':None,'secondary':[]}
            row={'argv':argv,'process':process,'stdout':None,'stderr':None,'exitCode':0,
                'timedOut':False,'firstFailure':None,'secondary':[]}
            if self.fault==phase:row['exitCode']=1
            return row
        def quiescent(self,phase):
            self.events.append('census-'+phase)
            members='101\n202\n' if self.fault=='descendant' else '101\n'
            return {'phase':phase,'cgroupProcs':members,'cgroupEvents':'populated 1\nfrozen 0\n',
                'cgroupStat':'nr_descendants '+('1' if self.fault=='nested' else '0')+'\nnr_dying_descendants 0\n',
                'onlyController':members=='101\n' and self.fault!='nested'}
        def post_status(self,request):
            self.events.append('post-status');selected={name:{'Package':name,'Version':version,'Architecture':arch,
                'Status':'install ok installed','Triggers-Pending':None,'Triggers-Awaited':None}
                for name,version,arch,*_ in p.SETUP_V6_PACKAGE_ROWS}
            row={'sha256':'e'*64,'bytes':1234000,'records':1226,'selected':selected,
                'statusOriginal':{'role':'post','bytes':1234000,'sha256':'e'*64,
                    'packedBytes':300000,'packedSha256':'b'*64},
                'pendingHostTriggers':{'libc-bin:amd64':{'status':'install ok triggers-pending',
                    'pending':'ldconfig','awaited':None}},
                'serviceObserved':{'unit':copy.deepcopy(witness['serviceUnit']),
                    'init':copy.deepcopy(witness['initScript'])},
                'allSelectedPresent':True,'allowedStates':True,'deferredHostTriggers':True,'configurationComplete':False}
            if self.fault=='deferred':row['deferredHostTriggers']=False
            if self.fault=='post-status':selected['qemu-system-x86']['Status']='install ok half-configured'
            return row
        def remove_policy(self,record):
            self.events.append('cleanup')
            if self.fault=='cleanup':raise ValueError('mock exact cleanup failure')
            return {'removedExactOwnIdentity':True,'identity':record['identity']}
        def close_archives(self,archives):self.events.append('archive-cleanup')
        def stage_drop_inventory(self,request,facts):
            self.events.append('stage');self.snapshot=copy.deepcopy(facts)
            if self.fault=='drop':return {'verifiedCopy':True,'irreversibleDrop':False},{'graphObserved':False,'actualGuestApproved':False}
            if self.fault=='graph':return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':False,'actualGuestApproved':False}
            return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':True,'actualGuestApproved':False}
    class Tests(unittest.TestCase):
        def request(self):
            env,expected,old,data=prerequisite_fixture()
            source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old['request.original.json'])['source'])))
            def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            request={'schema':'bw.ring3.inventory-request.v6','repository':'CrispStrobe/bw-board',
                'pullRequest':645,'head':'a'*40,'tree':'b'*40,'source':wrap(reader.canonical(source)),
                'selected':{'node':{'path':reader.NODE_STAGE_TARGET,'bytes':p.GENERATION_NODE_PIN[0],
                    'sha256':p.GENERATION_NODE_PIN[1]},'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}},
                'nodeStage':{'source':reader.RUNTIME_NODE,'destination':reader.NODE_STAGE_TARGET,'owner':[0,0],
                    'fileMode':0o555,'directoryMode':0o555},
                'emptyPythonSources':copy.deepcopy(reader.STAGED_EMPTY_PYTHON_SOURCES),
                'setup':p.setup_v6_policy(),'payloadWitness':copy.deepcopy(witness)}
            return request
        def test_disabled_v6_workflow_matches_failed_service_topology(self):
            workflow=(HERE.parent.parent/'.github/workflows/i80386-ring3-int-iret.yml').read_text()
            tail=workflow.split('  setup-runtime-inventory-v6:\n',1)[1]
            lines=[]
            for line in tail.splitlines(keepends=True):
                if line.startswith('  ') and line[2:3].isalnum() and line.endswith(':\n'):
                    break
                lines.append(line)
            route=''.join(lines)
            self.assertTrue(route and route != tail)
            self.assertIn("if: ${{ github.event.action == 'labeled'",route)
            checkout='actions/checkout@11d5960a326750d5838078e36cf38b85af677262'
            node='actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
            self.assertEqual(route.count(checkout),1);self.assertEqual(route.count(node),1)
            self.assertLess(route.index(checkout),route.index(node))
            self.assertLess(route.index(node),route.index('--setup-v6-image-shell'))
            self.assertLess(route.index('--setup-v6-image-shell'),route.index('ring3_v6_service()'))
            self.assertIn('node-version: 22.23.3',route)
            self.assertIn('ImageOS="${ImageOS-}" ImageVersion="${ImageVersion-}"',route)
            self.assertIn('/usr/bin/python3 -I -B scripts/i80386-ring3-int-iret/run.py --setup-runtime-inventory-v6',route)
            self.assertIn('BW_RING3_SETUP_INVENTORY_V6_REQUEST_B64',route)
            self.assertIn('shell-image.original.json',route)
            self.assertIn('sudo -- /usr/bin/timeout --kill-after=5s 720s /usr/bin/systemd-run --wait --pipe',route)
            self.assertIn('/usr/bin/timeout --kill-after=5s 60s /usr/bin/python3 -I -B',route)
            self.assertNotIn('--hosted-actual',route)
        def test_explicit_disabled_guard_refuses_before_host_edges(self):
            with patch.object(p,'SETUP_V6_ENABLED',False),patch.object(p,'setup_v6_entry',side_effect=AssertionError('no host')),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v6'],{}),1)
            with patch.object(p,'SETUP_V6_ENABLED',False),\
                 patch.object(p,'setup_v6_image_shell',side_effect=AssertionError('no shell')),\
                 patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-v6-image-shell'],{}),1)
            with patch.object(p,'SETUP_V6_ENABLED',False),\
                 patch.object(p,'setup_v6_outside_cleanup',side_effect=AssertionError('no cleanup')),\
                 patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--cleanup-setup-v6-policy'],{}),1)
            with patch.object(reader,'SETUP_V6_READER_ENABLED',False),\
                 patch.object(sys,'argv',['reader.py','--inventory-setup-v6']),\
                 patch.object(reader,'setup_v6_inventory_entry',side_effect=AssertionError('no reader')):
                with self.assertRaises(reader.Refusal):reader.main()
        def test_enabled_metadata_dispatch_still_uses_admission_entry(self):
            self.assertIs(p.SETUP_V6_ENABLED,True);self.assertIs(reader.SETUP_V6_READER_ENABLED,True)
            self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            for mode,name in (('setup-runtime-inventory-v6','setup_v6_entry'),('cleanup-setup-v6-policy','setup_v6_outside_cleanup')):
                with self.subTest(mode=mode),patch.object(p,name,return_value=17) as entry:
                    self.assertEqual(p.dispatch_cli(['--'+mode],{'test':'inert'}),17)
                    entry.assert_called_once_with({'test':'inert'})
            with patch.object(sys,'argv',['reader.py','--inventory-setup-v6']),patch.object(reader,'setup_v6_inventory_entry',return_value=({},False,False)) as entry:
                with self.assertRaises(SystemExit) as stopped: reader.main()
                self.assertEqual(stopped.exception.code,1);entry.assert_called_once()
        def test_active_invalid_event_refuses_before_setup_or_network(self):
            class InvalidObserver:
                def __init__(self,environ):
                    self.facts={'eventIdentity':None,'sourceCommands':[],'source':None}
                def event(self):return b'{}'
                def source(self,request):raise AssertionError('invalid event reached source')
            output=io.BytesIO()
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',InvalidObserver),\
                 patch.object(p,'SetupV6Host',side_effect=AssertionError('no setup')),\
                 patch.object(p,'setup_v6_sequence',side_effect=AssertionError('no sequence')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v6'],{}),1)
            failure=reader.parse_setup_v6_outer(output.getvalue())
            self.assertEqual(failure['schema'],'bw.ring3.setup-entry-failure.v6')
            self.assertIsNone(failure['setup'])
            self.assertFalse(failure['actualGuestApproved'])
            cleanup=io.BytesIO()
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',side_effect=AssertionError('invalid context reached event')),\
                 patch.object(p,'setup_v6_stop_unit',side_effect=AssertionError('no unit stop')),\
                 patch.object(p.os,'unlink',side_effect=AssertionError('no policy unlink')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=cleanup)):
                self.assertEqual(p.dispatch_cli(['--cleanup-setup-v6-policy'],{}),1)
            partial=reader.parse(cleanup.getvalue())
            self.assertIsNone(partial['sourceAdmission'])
            self.assertIsNone(partial['stop'])
            self.assertIsNone(partial['policy'])
        def test_exact_distinct_request_and_mutations(self):
            request=self.request();raw=reader.canonical(request)
            self.assertEqual(p.admit_setup_v6_request(raw,sha(raw)),request)
            self.assertEqual(reader.setup_v6_request(raw,sha(raw))[0],request)
            for field,value in (('schema','bw.ring3.inventory-request.v3'),('head','f'*40),
                ('payloadWitness',dict(witness,schema='wrong')),('setup',dict(request['setup'],force=True))):
                candidate=copy.deepcopy(request);candidate[field]=value;bad=reader.canonical(candidate)
                with self.subTest(field=field),self.assertRaises((ValueError,reader.Refusal)):
                    reader.setup_v6_request(bad,sha(bad))
            with self.assertRaises((ValueError,reader.Refusal)):p.admit_setup_v6_request(raw,'0'*64)
        def test_mock_positive_full_chain_and_independent_setup_reader(self):
            request=self.request();ops=FakeOps();facts=p.setup_v6_sequence(ops,request)
            self.assertIsNone(facts['firstFailure']);self.assertEqual(facts['secondary'],[])
            self.assertEqual(ops.events,['preflight']+['acquire']*15+['policy','unpack','census-unpack',
                'configure','census-configure','post-status','census-policy-cleanup','cleanup',
                'archive-cleanup','stage'])
            self.assertTrue(facts['nodeStage']['irreversibleDrop']);self.assertTrue(facts['runtime']['graphObserved'])
            self.assertTrue(reader.setup_v6_facts(ops.snapshot,'123',101,31000000)['setupObserved'])
            self.assertFalse(reader.setup_v6_facts(ops.snapshot,'123',101,31000000)['completeHostConfiguration'])
        def test_pre_guard_image_fields_refuse_before_status_or_get(self):
            cgroup='0::/system.slice/bw-ring3-setup-v6-123-1.service\n'
            limits={name:value for name,value in p.LIMITS.items()}
            names={'cpu.max':'cpuMax','memory.max':'memoryMax','memory.swap.max':'swapMax',
                   'pids.max':'pidsMax'}
            def cgroup_text(_fd,path):
                name=str(path)
                if name=='/proc/self/cgroup':return cgroup
                return limits[names[name.rsplit('/',1)[-1]]]
            for environ in ({'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24','ImageVersion':'drift'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'','ImageVersion':'20261012.334.1'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24','ImageVersion':'X'*257}):
                host=p.SetupV6Host(environ,b'',b'',None)
                with self.subTest(environ=environ),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p.Cgroups,'text',side_effect=cgroup_text),\
                     patch.object(p,'bounded_read',side_effect=AssertionError('status before image')),\
                     patch.object(host,'acquire',side_effect=AssertionError('GET before image')):
                    with self.assertRaisesRegex(ValueError,'fresh exact hosted image labels') as caught:
                        host.preflight(self.request())
                prefix=caught.exception.ring3_partial['prefix']
                self.assertIsNone(prefix['statusOriginal'])
                self.assertIsNotNone(prefix['imageFields'])
                self.assertEqual(prefix['imageFields']['ImageVersion']['present'],
                                 'ImageVersion' in environ)
        def test_shell_original_canonical_forwarding_and_corruption(self):
            cases=({'ImageOS':'ubuntu24','ImageVersion':'20261012.334.1'},
                   {'ImageOS':'ubuntu24'},
                   {'ImageOS':'','ImageVersion':'different'},
                   {'ImageOS':'ubuntu24','ImageVersion':'X'*257})
            for fields in cases:
                with self.subTest(fields=fields):
                    output=io.BytesIO()
                    with patch.object(sys,'stdout',SimpleNamespace(buffer=output)):
                        self.assertEqual(p.setup_v6_image_shell(fields),0)
                    raw=output.getvalue();external={'shellBytes':len(raw),'shellSha256':sha(raw)}
                    shell=reader.decode_setup_v6_shell(raw,external)
                    self.assertEqual(shell['fields'],p.image_env_fields(fields)[0])
                    expected=reader.setup_v6_expected_forwarded(shell['fields'])
                    self.assertTrue(all(expected[name]['present'] for name in expected))
                    with self.assertRaises(reader.Refusal):
                        reader.decode_setup_v6_shell(raw,dict(external,shellSha256='0'*64))
            bad=reader.parse(raw);bad['fields']['ImageVersion']['value']='invented'
            changed=reader.canonical(bad)
            with self.assertRaises(reader.Refusal):
                reader.decode_setup_v6_shell(changed,{'shellBytes':len(changed),'shellSha256':sha(changed)})
        def test_coherent_setup_cuts_never_reach_stage(self):
            for fault in ('image','status','helper','alias','preexisting-policy','archive','policy','unpack','configure','deferred','cleanup','descendant','nested'):
                with self.subTest(fault=fault):
                    ops=FakeOps(fault);facts=p.setup_v6_sequence(ops,self.request())
                    self.assertIsNotNone(facts['firstFailure']);self.assertNotIn('stage',ops.events)
            for fault in ('drop','graph'):
                ops=FakeOps(fault);facts=p.setup_v6_sequence(ops,self.request())
                self.assertIsNotNone(facts['firstFailure']);self.assertIn('stage',ops.events)
        def test_partial_acquisition_primary_and_cleanup_secondary(self):
            class Partial(FakeOps):
                def acquire(self,package):
                    if self.events.count('acquire')==4:
                        error=OSError('FIRST_PARTIAL_ARCHIVE')
                        error.ring3_partial={'phase':'archive','receivedBytes':37,'writtenBytes':12,
                            'writeUncertain':True}
                        raise error
                    return super().acquire(package)
                def close_archives(self,archives):
                    self.events.append('archive-cleanup')
                    raise OSError('SECOND_ARCHIVE_CLEANUP')
            ops=Partial();facts=p.setup_v6_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_PARTIAL_ARCHIVE')
            self.assertEqual(facts['secondary'][0]['message'],'SECOND_ARCHIVE_CLEANUP')
            self.assertEqual(facts['partial']['receivedBytes'],37)
        def test_child_first_survives_census_failure(self):
            class ChildAndCensus(FakeOps):
                def dpkg(self,args):
                    item=super().dpkg(args)
                    item['firstFailure']={'phase':'setup-v6','name':'TimeoutError','message':'FIRST_CHILD_TIMEOUT'}
                    item['timedOut']=True
                    return item
                def quiescent(self,phase):
                    self.events.append('census-'+phase)
                    raise OSError('SECOND_CGROUP_READ')
            ops=ChildAndCensus();facts=p.setup_v6_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_CHILD_TIMEOUT')
            self.assertIn('SECOND_CGROUP_READ',[item['message'] for item in facts['secondary']])
            self.assertNotIn('configure',ops.events);self.assertNotIn('stage',ops.events)
            self.assertIsNone(facts['unpack']['cgroupAfter'])
        def test_real_host_oexcl_fstat_faults_close_and_refuse_unknown_unlink(self):
            host=p.SetupV6Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            root=Path('/run/bw-ring3-setup-v6-123-1');host.root=root
            closed=[];unlinked=[]
            with patch.object(host,'archive_root',return_value=root),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_ARCHIVE_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)),\
                 patch.object(p.urllib.request,'build_opener',side_effect=AssertionError('no GET')):
                with self.assertRaisesRegex(OSError,'FIRST_ARCHIVE_FSTAT') as caught:
                    host.acquire(p.setup_v6_policy()['packages'][0])
                self.assertEqual(caught.exception.ring3_partial['ownedIdentity'],None)
                with self.assertRaisesRegex(ValueError,'identity unknown'):host.close_archives([])
            self.assertEqual(closed,[77]);self.assertEqual(unlinked,[])
            closed=[]
            with patch.object(Path,'exists',return_value=False),patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(p.os,'open',return_value=78),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_POLICY_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)):
                with self.assertRaisesRegex(OSError,'FIRST_POLICY_FSTAT') as caught:
                    host.create_policy(p.SETUP_V6_POLICY_BYTES)
                self.assertIsNone(caught.exception.ring3_partial['createdIdentity'])
                self.assertIn('identity unknown',caught.exception.ring3_secondary[0]['message'])
            self.assertEqual(closed,[78]);self.assertEqual(unlinked,[])
            host=p.SetupV6Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            with patch.object(p.os,'mkdir',return_value=None),\
                 patch.object(Path,'lstat',side_effect=OSError('FIRST_DIRECTORY_STAT')),\
                 patch.object(p.os,'rmdir',side_effect=AssertionError('no unknown rmdir')):
                with self.assertRaisesRegex(OSError,'FIRST_DIRECTORY_STAT') as caught:host.archive_root()
                self.assertEqual(caught.exception.ring3_partial['phase'],'archive-directory')
                self.assertEqual(host.root,root);self.assertIsNone(host.root_identity)
                with self.assertRaisesRegex(ValueError,'identity before removal'):host.close_archives([])
        def test_stage_copy_first_and_close_secondary_then_drop_exec_progress(self):
            owner=SimpleNamespace(facts={'source':{},'sourceCommands':[],'eventIdentity':{}})
            env={key:'fixed' for key in p.SETUP_V6_ENV}
            env.update(SUDO_UID='1001',SUDO_GID='1002')
            host=p.SetupV6Host(env,b'event',b'request',owner)
            metadata=SimpleNamespace(st_uid=1001,st_gid=1002,st_mode=0o100644)
            class CopyEdge:
                def __init__(self,fail):self.fail=fail;self.facts={'created':['/run/fake']}
                def copy(self):
                    if self.fail:raise ValueError('FIRST_NODE_COPY')
                def record(self,raw):pass
                def close(self,failure):
                    if self.fail:failure.add(OSError('SECOND_PARENT_CLOSE'),'Node-stage-parent-close')
            for fail in (True,False):
                edge=CopyEdge(fail)
                with self.subTest(copyFailure=fail),\
                     patch.object(p,'NodeStageCopy',return_value=edge),\
                     patch.object(Path,'lstat',return_value=metadata),\
                     patch.object(p.os,'setgroups',return_value=None),\
                     patch.object(p.os,'setresgid',return_value=None),\
                     patch.object(p.os,'setresuid',return_value=None),\
                     patch.object(p,'entry_ids',return_value=None),\
                     patch.object(p.os,'execve',side_effect=OSError('FIRST_EXEC')):
                    with self.assertRaises(p.ObservedFailure if fail else OSError) as caught:
                        host.stage_drop_inventory({}, {})
                error=caught.exception
                self.assertEqual(error.firstFailure['message'] if fail else str(error),
                                 'FIRST_NODE_COPY' if fail else 'FIRST_EXEC')
                if fail:self.assertEqual(error.secondary[0]['message'],'SECOND_PARENT_CLOSE')
                self.assertEqual(error.ring3_partial['copy'],edge.facts)
                self.assertEqual(error.ring3_partial['dropProgress'],[] if fail else
                                 ['groups','gid','uid','ids-verified'])
        def test_outside_cleanup_bounded_exact_unit_stop_and_terminal_census(self):
            request=self.request();source=reader.parse(reader.prerequisite_original(
                reader.canonical(request['source'])))
            unit='bw-ring3-setup-v6-123-1.service'
            env={'GITHUB_RUN_ID':'123','BW_SYSTEMD_RUN_EXIT_CODE':'124',
                'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree']}
            absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
            populated={'terminal':'populated','cgroupProcs':'202\n','cgroupEvents':'populated 1\n',
                'cgroupStat':'nr_descendants 0\nnr_dying_descendants 0\n'}
            class Observer:
                def __init__(self,environ):self.facts={'source':source}
                def event(self):return b'{}'
                def source(self,selected):self.facts['source']=source
            for mode,pre,post,stop_error in (('absent',absent,absent,None),
                    ('stopped',populated,absent,None),
                    ('stop-error',populated,populated,OSError('STOP_FIRST')),
                    ('still-populated',populated,populated,None)):
                output=io.BytesIO();calls=[]
                def census(path):
                    calls.append(('census',path.name))
                    return pre if len([x for x in calls if x[0]=='census'])==1 else post
                def stop(name):
                    calls.append(('stop',name))
                    if stop_error:raise stop_error
                    return {'attempted':True,'argv':['/usr/bin/timeout','--kill-after=5s',
                        '20s','/usr/bin/systemctl','stop','--',unit],
                        'exitCode':0,'timedOut':False}
                def exists(path):return str(path)=='/usr/sbin/policy-rc.d'
                with self.subTest(mode=mode),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p,'HostedEnvelopeInstaller',Observer),\
                     patch.object(p,'admit_setup_v6_event',return_value=(b'{}',request)),\
                     patch.object(p,'setup_v6_owned_unit',return_value=mode!='absent'),\
                     patch.object(p,'setup_v6_outside_census',side_effect=census),\
                     patch.object(p,'setup_v6_stop_unit',side_effect=stop),\
                     patch.object(Path,'exists',exists),patch.object(Path,'is_symlink',return_value=False),\
                     patch.object(p.os,'unlink',side_effect=AssertionError('no policy unlink')),\
                     patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                    code=p.setup_v6_outside_cleanup(env)
                packet=reader.parse(output.getvalue())
                self.assertEqual(code,1);self.assertEqual(packet['firstFailure']['phase'],'v6-outer-client')
                self.assertEqual(packet['sourceAdmission']['unit'],unit)
                self.assertEqual([name for kind,name in calls if kind=='stop'],
                    [] if mode=='absent' else [unit])
                self.assertEqual(packet['postCensus'],post)
                self.assertNotEqual(packet['action'],'removed-exact')
                if mode=='stop-error':self.assertTrue(packet['secondary'])
            # Source admission failure forbids even an exact-unit stop.
            output=io.BytesIO()
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',Observer),\
                 patch.object(p,'admit_setup_v6_event',side_effect=ValueError('BAD_REQUEST')),\
                 patch.object(p,'setup_v6_stop_unit',side_effect=AssertionError('stop before admission')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                self.assertEqual(p.setup_v6_outside_cleanup(env),1)
            self.assertIsNone(reader.parse(output.getvalue())['sourceAdmission'])
        def test_exact_stop_command_is_finitely_bounded(self):
            completed=SimpleNamespace(returncode=124)
            with patch.object(p.subprocess,'run',return_value=completed) as run:
                fact=p.setup_v6_stop_unit('bw-ring3-setup-v6-123-1.service')
            self.assertEqual(fact['exitCode'],124);self.assertTrue(fact['timedOut'])
            argv=run.call_args.args[0]
            self.assertEqual(argv,['/usr/bin/timeout','--kill-after=5s','20s',
                '/usr/bin/systemctl','stop','--','bw-ring3-setup-v6-123-1.service'])
            self.assertEqual(run.call_args.kwargs['timeout'],30)
            with self.assertRaises(ValueError):p.setup_v6_stop_unit('unowned.service')
        def test_exact_owned_unit_identity_refuses_alias_and_wrong_name(self):
            unit=Path('/sys/fs/cgroup/system.slice/bw-ring3-setup-v6-123-1.service')
            with patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(Path,'exists',return_value=False):
                self.assertIs(p.setup_v6_owned_unit(unit),False)
            with patch.object(Path,'is_symlink',return_value=True),\
                 patch.object(Path,'exists',side_effect=AssertionError('alias must not be followed')):
                with self.assertRaises(ValueError):p.setup_v6_owned_unit(unit)
            for bad in (Path('/sys/fs/cgroup/system.slice/foreign.service'),
                        Path('/sys/fs/cgroup/foreign/bw-ring3-setup-v6-123-1.service')):
                with self.assertRaises(ValueError):p.setup_v6_owned_unit(bad)
            with patch.object(p,'setup_v6_owned_unit',return_value=True),\
                 patch.object(p.Cgroups,'text',side_effect=['1'*1025,'populated 1\n',
                                                            'nr_descendants 0\nnr_dying_descendants 0\n']):
                with self.assertRaises(ValueError):p.setup_v6_outside_census(unit)
        def test_raw_status_decoder_duplicate_tail_truncation_and_bomb(self):
            pre=b'Package: authored\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n'
            post=pre+b'\nPackage: second\nVersion: 1\nArchitecture: all\nStatus: install ok installed\n'
            output=io.BytesIO();p.emit_setup_v6_status('pre',pre,output.write,output.flush)
            pre_line=output.getvalue();p.emit_setup_v6_status('post',post,output.write,output.flush)
            raw=output.getvalue();self.assertEqual(reader.decode_setup_v6_status_log(raw)['pre']['raw'],pre)
            for malformed in (pre+b'Status:other\n',pre+b'Status:\tother\n',
                              pre+b' continued-authority\n'):
                with self.assertRaises((reader.Refusal,ValueError)):
                    reader.setup_v6_status_rows(malformed)
                with self.assertRaises(ValueError):p.setup_v6_status_rows(malformed)
            with self.assertRaises(reader.Refusal):reader.decode_setup_v6_status_log(raw+pre_line)
            for state in ('overflow','incomplete','tail'):
                class RefusingDecoder:
                    eof=state!='incomplete'
                    unused_data=b'X' if state=='tail' else b''
                    unconsumed_tail=b''
                    def decompress(self,data,limit):
                        return b'X'*(limit if state=='overflow' else 1)
                    def flush(self):raise AssertionError('flush before bounded stream validation')
                with self.subTest(decompressState=state),\
                     patch.object(reader.zlib,'decompressobj',return_value=RefusingDecoder()):
                    with self.assertRaises(reader.Refusal):reader.decode_setup_v6_status_log(raw)
            marker=p.SETUP_V6_STATUS_MARKER
            packet=reader.parse(pre_line[len(marker):]);packed=reader.base64.b64decode(packet['packed'])
            for invalid in (packed[:-2],packed+b'\0\0\0\0',p.zlib.compress(b'A'*((8<<20)+1))):
                changed=copy.deepcopy(packet);changed['packed']=reader.base64.b64encode(invalid).decode()
                changed['packedBytes']=len(invalid);changed['packedSha256']=sha(invalid)
                if invalid!=packed[:-2]:changed['rawBytes']=8<<20
                line=marker+reader.canonical(changed)+raw[len(pre_line):]
                with self.assertRaises(reader.Refusal):reader.decode_setup_v6_status_log(line)
        def test_versioned_outer_json_and_combined_wire_subbudgets(self):
            outer=reader.canonical({'schema':'bw.ring3.setup-runtime-inventory-original.v6',
                                    'largeObservedGraph':'x'*(1<<20)})
            self.assertGreater(len(outer),1<<20)
            self.assertEqual(reader.parse_setup_v6_outer(outer)['schema'],
                             'bw.ring3.setup-runtime-inventory-original.v6')
            with self.assertRaises(reader.Refusal):reader.parse(outer)
            for invalid in (b'{"a":1,"a":2}',b'{"a":1e10000}',b'"'+b'x'*(4<<20)+b'"'):
                with self.assertRaises(reader.Refusal):reader.parse_setup_v6_outer(invalid)
            oversized_roles={'runtime.setup-inventory.json':b'X'*(4<<20),
                'setup.event.json':b'E'*(512<<10),'setup.request.json':b'R'*(512<<10)}
            output=io.BytesIO()
            with self.assertRaisesRegex(reader.Refusal,'six-MiB v6 runtime component'):
                reader.emit_setup_v6_inventory(oversized_roles,output.write,output.flush)
            self.assertLessEqual(len(output.getvalue()),6<<20)
        def test_independent_packet_mutations(self):
            ops=FakeOps();p.setup_v6_sequence(ops,self.request());base=ops.snapshot
            for field,change in [('archives',lambda x:x[0].update(sha256='0'*64)),
                ('archives',lambda x:x[0].update(url='https://archive.ubuntu.com/ubuntu/'+x[0]['package']['filename'])),
                ('policy',lambda x:x.update(identity=[1,1,0o100755,0,0,1,19,100])),
                ('preflight',lambda x:x['helperAliases']['/bin/sh'].update(target='/usr/bin/bash')),
                ('preflight',lambda x:x['helperWitness']['/usr/sbin/ldconfig.real']['namedAfter'].__setitem__(1,999)),
                ('configure',lambda x:x.update(exitCode=1)),
                ('postStatus',lambda x:x.update(configurationComplete=True))]:
                bad=copy.deepcopy(base);change(bad[field])
                with self.subTest(field=field),self.assertRaises(reader.Refusal):reader.setup_v6_facts(bad,'123',101,31000000)
        def test_repaired_helper_alias_and_installer_environment_are_exact(self):
            request=self.request();raw=reader.canonical(request)
            for setup in (dict(request['setup'],installerPath='/usr/bin:/bin'),
                          dict(request['setup'],helperSha256=dict(request['setup']['helperSha256'],
                              **{'/usr/sbin/ldconfig.real':'0'*64})),
                          dict(request['setup'],helperAliases=dict(request['setup']['helperAliases'],
                              **{'/sbin':dict(request['setup']['helperAliases']['/sbin'],target='/elsewhere')}))):
                bad=dict(request,setup=setup);wire=reader.canonical(bad)
                with self.assertRaises((ValueError,reader.Refusal)):
                    p.admit_setup_v6_request(wire,sha(wire))
                with self.assertRaises(reader.Refusal):reader.setup_v6_request(wire,sha(wire))
            ops=FakeOps();p.setup_v6_sequence(ops,request);bad=copy.deepcopy(ops.snapshot)
            bad['unpack']['process']['environment']['PATH']='/usr/bin:/bin'
            with self.assertRaises(reader.Refusal):reader.setup_v6_facts(bad,'123',101,31000000)
            tool=p.SetupV6Tool(['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V6_CONFIGURE_ORDER])
            self.assertEqual(tool.environment['PATH'],'/usr/sbin:/usr/bin:/bin')
            self.assertEqual(p.ENV['PATH'],'/usr/bin:/bin')
            self.assertEqual(raw,reader.canonical(reader.setup_v6_request(raw,sha(raw))[0]))
        def test_distinct_v6_event_and_job_cannot_use_consumed_v4_marker(self):
            request=self.request();raw=reader.canonical(request);pin=sha(raw)
            wrapper=pin
            marker='BW_RING3_SETUP_RUNTIME_INVENTORY_V6'
            body='<!-- '+marker+'\n'+wrapper+'\n'+marker+' -->'
            event={'action':'labeled','label':{'name':'x86-ring3-setup-runtime-inventory-v6'},
                'repository':{'full_name':'CrispStrobe/bw-board'},'sender':{'login':'CrispStrobe'},
                'number':645,'pull_request':{'number':645,'state':'open','body':body,
                    'head':{'sha':request['head'],'repo':{'full_name':'CrispStrobe/bw-board','fork':False}},
                    'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}}
            env={'BW_RING3_SETUP_INVENTORY_V6_REQUEST_SHA256':pin,
                'BW_RING3_SETUP_INVENTORY_V6_REQUEST_B64':base64.b64encode(raw).decode('ascii'),'GITHUB_RUN_ID':'123',
                'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
                'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe',
                'GITHUB_JOB':'setup-runtime-inventory-v6','BW_EXPECTED_HEAD':request['head'],
                'BW_EXPECTED_TREE':request['tree'],'GITHUB_WORKFLOW_SHA':'c'*40,
                'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge'}
            wire=reader.canonical(event)
            with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                self.assertEqual(p.admit_setup_v6_event(wire,env)[1],request)
            reader.setup_v6_event(wire,request,pin,env)
            for bad_event,bad_env in ((dict(event,label={'name':'x86-ring3-setup-runtime-inventory-v1'}),env),
                                      (dict(event,pull_request=dict(event['pull_request'],
                                          body=body.replace('V6','V4'))),env),
                                      (event,dict(env,GITHUB_JOB='setup-runtime-inventory')),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V6_REQUEST_SHA256='0'*64)),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V6_REQUEST_B64='!')),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V6_REQUEST_B64=
                                                  base64.b64encode(b'{}').decode('ascii')))):

                with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                    with self.assertRaises((ValueError,reader.Refusal)):
                        p.admit_setup_v6_event(reader.canonical(bad_event),bad_env)
                with self.assertRaises(reader.Refusal):
                    reader.setup_v6_event(reader.canonical(bad_event),request,pin,bad_env)
        def test_new_child_profile_still_binds_role_and_terminal(self):
            class Child:
                role='setup-v6'
                environment=dict(p.SETUP_V6_INSTALLER_ENV)
                def __init__(self):self.clock=0
                def now(self):self.clock+=1000;return self.clock
                def spawn(self):return {'pid':201,'pgid':201,'parentPid':101,'startTicks':7}
                def read_available(self,timeout):return []
                def reap(self):return {'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                    'rusage':{'userSeconds':0.0,'systemSeconds':0.0,'maxRssKiB':1}}
                def close(self):pass
                def kill(self):raise AssertionError('no kill of completed child')
            argv=['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V6_CONFIGURE_ORDER]
            process,streams=p.collect_child(Child(),'setup-v6',argv,profile='setup-v6')
            self.assertIsNone(process['firstFailure']);self.assertEqual(process['environment'],p.SETUP_V6_INSTALLER_ENV)
            self.assertEqual(streams,{'stdout':b'','stderr':b''})
            with self.assertRaises(ValueError):p.collect_child(Child(),'setup-v4',argv,profile='setup-v6')
        def test_named_held_helper_readback_and_primary_close_failure(self):
            path='/usr/sbin/ldconfig.real';body=b'pure fixture only'
            named=SimpleNamespace(st_dev=1,st_ino=2,st_mode=0o100755,st_uid=0,st_gid=0,
                st_nlink=1,st_size=len(body),st_mtime_ns=3)
            changed=SimpleNamespace(**dict(vars(named),st_ino=99))
            with patch.object(p,'SETUP_V6_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V6_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                row=p.setup_v6_helper_witness(path,sha(body))
                self.assertTrue(row['closeSucceeded']);self.assertEqual(row['bytesRead'],len(body))
                self.assertEqual(row['namedBefore'],row['heldAfter']);closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V6_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V6_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',side_effect=[named,changed]),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                with self.assertRaisesRegex(ValueError,'closed selected helper identity') as caught:
                    p.setup_v6_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_partial['witness']['namedAfter'][1],99)
                closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V6_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V6_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=OSError('FIRST_HELPER_READ')),\
                 patch.object(p.os,'close',side_effect=OSError('SECOND_HELPER_CLOSE')):
                with self.assertRaisesRegex(OSError,'FIRST_HELPER_READ') as caught:
                    p.setup_v6_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_secondary[0]['message'],'SECOND_HELPER_CLOSE')
                self.assertTrue(caught.exception.ring3_partial['witness']['closeAttempted'])
    if export_sample:
        request=Tests().request();ops=FakeOps();facts=p.setup_v6_sequence(ops,request)
        assert facts['firstFailure'] is None and ops.snapshot is not None
        return copy.deepcopy(ops.snapshot),copy.deepcopy(witness)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure v6 setup controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'dpkg':False,
        'guest':False,'actualRunApproved':False,'pass':True}))


def setup_v7_controls(export_sample=False):
    """Injected v7 setup chain only; no network, dpkg, service or guest edge."""
    p,_=producer_fixture_case()
    witness=copy.deepcopy(p.SETUP_V7_PAYLOAD_PINS)
    assert witness==reader.SETUP_V7_PAYLOAD_PINS and len(witness['archives'])==15
    class FakeOps:
        def __init__(self,fault=None):self.fault=fault;self.events=[];self.snapshot=None
        def preflight(self,request):
            self.events.append('preflight');value={'imageOS':'ubuntu24','imageVersion':p.SETUP_V7_IMAGE,
                'imageFields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                    'ImageVersion':{'present':True,'value':p.SETUP_V7_IMAGE}},
                'imageFieldErrors':[],
                'statusSha256':p.SETUP_V7_STATUS_SHA,'statusBytes':1231069,'statusRecords':1211,
                'statusOriginal':{'role':'pre','bytes':1231069,'sha256':p.SETUP_V7_STATUS_SHA,
                    'packedBytes':286949,'packedSha256':'a'*64},
                'helperSha256':p.SETUP_V7_HELPERS,'helperAliases':copy.deepcopy(p.SETUP_V7_HELPER_ALIASES),
                'helperWitness':{path:{'path':path,'namedBefore':info,'heldBefore':info[:],
                    'heldAfter':info[:],'namedAfter':info[:],
                    'bytesRead':info[6],'sha256':pin,'closeAttempted':True,'closeSucceeded':True}
                    for path,pin in p.SETUP_V7_HELPERS.items()
                    for info in ([1,100+list(p.SETUP_V7_HELPERS).index(path),0o100755,0,0,1,
                        p.SETUP_V7_NEW_HELPER_BYTES.get(path,1234),100],)},
                'policyAbsent':True,'newPackagesAbsent':True,
                'resource':{'membership':'0::/system.slice/bw-ring3-setup-v7-123-1.service\n',
                    'limits':dict(p.LIMITS)},
                'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}
            if self.fault=='image':value['imageVersion']='drift'
            if self.fault=='status':value['statusSha256']='0'*64
            if self.fault=='helper':value['helperSha256']=dict(value['helperSha256'],**{'/usr/bin/dash':'0'*64})
            if self.fault=='alias':value['helperAliases']['/bin/sh']['target']='/usr/bin/bash'
            if self.fault=='preexisting-policy':value['policyAbsent']=False
            return value
        def acquire(self,package):
            self.events.append('acquire');index=self.events.count('acquire')-1
            row={'package':package,'path':'/run/bw-ring3-setup-v7-123-1/'+str(index).zfill(2)+'.deb',
                'url':'https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+package['filename'],
                'bytes':package['size'],
                'sha256':package['sha256'],'identity':[1,100+index,0o100600,0,0,1,package['size'],100],
                'closeSucceeded':True}
            if self.fault=='archive' and index==4:row['sha256']='0'*64
            return row
        def create_policy(self,data):
            self.events.append('policy');row={'path':'/usr/sbin/policy-rc.d','identity':[1,500,0o100755,0,0,1,19,100],
                'sha256':sha(data),'mode':0o755,'exclusive':True}
            if self.fault=='policy':row['exclusive']=False
            return row
        def dpkg(self,args):
            phase='unpack' if '--unpack' in args else 'configure';self.events.append(phase)
            argv=['/usr/bin/dpkg',*args];start=40000000 if phase=='unpack' else 50000000
            process={'schema':'bw.ring3.process.v1','role':'setup-v7','argv':argv,'cwdRole':'checkout',
                'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'},
                'pid':200 if phase=='unpack' else 201,'pgid':200 if phase=='unpack' else 201,
                'parentPid':101,'startTicks':7,'spawnMonoNs':start,'reapMonoNs':start+1000,
                'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0.1,'systemSeconds':0.1,'maxRssKiB':1200},
                'firstFailure':None,'secondary':[]}
            row={'argv':argv,'process':process,'stdout':None,'stderr':None,'exitCode':0,
                'timedOut':False,'firstFailure':None,'secondary':[]}
            if self.fault==phase:row['exitCode']=1
            return row
        def quiescent(self,phase):
            self.events.append('census-'+phase)
            members='101\n202\n' if self.fault=='descendant' else '101\n'
            return {'phase':phase,'cgroupProcs':members,'cgroupEvents':'populated 1\nfrozen 0\n',
                'cgroupStat':'nr_descendants '+('1' if self.fault=='nested' else '0')+'\nnr_dying_descendants 0\n',
                'onlyController':members=='101\n' and self.fault!='nested'}
        def post_status(self,request):
            self.events.append('post-status');selected={name:{'Package':name,'Version':version,'Architecture':arch,
                'Status':'install ok installed','Triggers-Pending':None,'Triggers-Awaited':None}
                for name,version,arch,*_ in p.SETUP_V7_PACKAGE_ROWS}
            row={'sha256':'e'*64,'bytes':1234000,'records':1226,'selected':selected,
                'statusOriginal':{'role':'post','bytes':1234000,'sha256':'e'*64,
                    'packedBytes':300000,'packedSha256':'b'*64},
                'pendingHostTriggers':{'libc-bin:amd64':{'status':'install ok triggers-pending',
                    'pending':'ldconfig','awaited':None}},
                'serviceObserved':{'unit':copy.deepcopy(witness['serviceUnit']),
                    'init':copy.deepcopy(witness['initScript'])},
                'allSelectedPresent':True,'allowedStates':True,'deferredHostTriggers':True,'configurationComplete':False}
            if self.fault=='deferred':row['deferredHostTriggers']=False
            if self.fault=='post-status':selected['qemu-system-x86']['Status']='install ok half-configured'
            return row
        def remove_policy(self,record):
            self.events.append('cleanup')
            if self.fault=='cleanup':raise ValueError('mock exact cleanup failure')
            return {'removedExactOwnIdentity':True,'identity':record['identity']}
        def close_archives(self,archives):self.events.append('archive-cleanup')
        def stage_drop_inventory(self,request,facts):
            self.events.append('stage');self.snapshot=copy.deepcopy(facts)
            if self.fault=='drop':return {'verifiedCopy':True,'irreversibleDrop':False},{'graphObserved':False,'actualGuestApproved':False}
            if self.fault=='graph':return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':False,'actualGuestApproved':False}
            return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':True,'actualGuestApproved':False}
    class Tests(unittest.TestCase):
        def request(self):
            env,expected,old,data=prerequisite_fixture()
            source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old['request.original.json'])['source'])))
            def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            request={'schema':'bw.ring3.inventory-request.v7','repository':'CrispStrobe/bw-board',
                'pullRequest':645,'head':'a'*40,'tree':'b'*40,'source':wrap(reader.canonical(source)),
                'selected':{'node':{'path':reader.NODE_STAGE_TARGET,'bytes':p.GENERATION_NODE_PIN[0],
                    'sha256':p.GENERATION_NODE_PIN[1]},'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}},
                'nodeStage':{'source':reader.RUNTIME_NODE,'destination':reader.NODE_STAGE_TARGET,'owner':[0,0],
                    'fileMode':0o555,'directoryMode':0o555},
                'emptyPythonSources':copy.deepcopy(reader.STAGED_EMPTY_PYTHON_SOURCES),
                'setup':p.setup_v7_policy(),'payloadWitness':copy.deepcopy(witness)}
            return request
        def test_active_v7_workflow_matches_failed_service_topology(self):
            workflow=(HERE.parent.parent/'.github/workflows/i80386-ring3-int-iret.yml').read_text()
            tail=workflow.split('  setup-runtime-inventory-v7:\n',1)[1]
            lines=[]
            for line in tail.splitlines(keepends=True):
                if line.startswith('  ') and line[2:3].isalnum() and line.endswith(':\n'):
                    break
                lines.append(line)
            route=''.join(lines)
            self.assertTrue(route and route != tail)
            self.assertIn("if: ${{ github.event.action == 'labeled' && github.event.label.name == 'x86-ring3-setup-runtime-inventory-v7' && github.actor == 'CrispStrobe' && github.run_attempt == '1' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.head.repo.fork == false }}",route)
            checkout='actions/checkout@11d5960a326750d5838078e36cf38b85af677262'
            node='actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
            self.assertEqual(route.count(checkout),1);self.assertEqual(route.count(node),1)
            self.assertLess(route.index(checkout),route.index(node))
            self.assertLess(route.index(node),route.index('--setup-v7-image-shell'))
            self.assertLess(route.index('--setup-v7-image-shell'),route.index('ring3_v7_service()'))
            self.assertIn('node-version: 22.23.3',route)
            self.assertIn('ImageOS="${ImageOS-}" ImageVersion="${ImageVersion-}"',route)
            self.assertIn('/usr/bin/python3 -I -B scripts/i80386-ring3-int-iret/run.py --setup-runtime-inventory-v7',route)
            self.assertIn('BW_RING3_SETUP_INVENTORY_V7_REQUEST_B64',route)
            self.assertIn('shell-image.original.json',route)
            self.assertIn('sudo -- /usr/bin/timeout --kill-after=5s 720s /usr/bin/systemd-run --wait --pipe',route)
            self.assertIn('/usr/bin/timeout --kill-after=5s 60s /usr/bin/python3 -I -B',route)
            self.assertNotIn('--hosted-actual',route)
        def test_explicit_disabled_guard_refuses_before_host_edges(self):
            with patch.object(p,'SETUP_V7_ENABLED',False),patch.object(p,'setup_v7_entry',side_effect=AssertionError('no host')),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v7'],{}),1)
            with patch.object(p,'SETUP_V7_ENABLED',False),\
                 patch.object(p,'setup_v7_image_shell',side_effect=AssertionError('no shell')),\
                 patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-v7-image-shell'],{}),1)
            with patch.object(p,'SETUP_V7_ENABLED',False),\
                 patch.object(p,'setup_v7_outside_cleanup',side_effect=AssertionError('no cleanup')),\
                 patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--cleanup-setup-v7-policy'],{}),1)
            with patch.object(reader,'SETUP_V7_READER_ENABLED',False),\
                 patch.object(sys,'argv',['reader.py','--inventory-setup-v7']),\
                 patch.object(reader,'setup_v7_inventory_entry',side_effect=AssertionError('no reader')):
                with self.assertRaises(reader.Refusal):reader.main()
        def test_enabled_metadata_dispatch_still_uses_admission_entry(self):
            self.assertIs(p.SETUP_V7_ENABLED,True);self.assertIs(reader.SETUP_V7_READER_ENABLED,True)
            self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            for mode,name in (('setup-runtime-inventory-v7','setup_v7_entry'),('cleanup-setup-v7-policy','setup_v7_outside_cleanup')):
                with self.subTest(mode=mode),patch.object(p,'SETUP_V7_ENABLED',True),patch.object(p,name,return_value=17) as entry:
                    self.assertEqual(p.dispatch_cli(['--'+mode],{'test':'inert'}),17)
                    entry.assert_called_once_with({'test':'inert'})
            with patch.object(reader,'SETUP_V7_READER_ENABLED',True),patch.object(sys,'argv',['reader.py','--inventory-setup-v7']),patch.object(reader,'setup_v7_inventory_entry',return_value=({},False,False)) as entry:
                with self.assertRaises(SystemExit) as stopped: reader.main()
                self.assertEqual(stopped.exception.code,1);entry.assert_called_once()
        def test_active_invalid_event_refuses_before_setup_or_network(self):
            class InvalidObserver:
                def __init__(self,environ):
                    self.facts={'eventIdentity':None,'sourceCommands':[],'source':None}
                def event(self):return b'{}'
                def source(self,request):raise AssertionError('invalid event reached source')
            output=io.BytesIO()
            with patch.object(p,'SETUP_V7_ENABLED',True),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',InvalidObserver),\
                 patch.object(p,'SetupV7Host',side_effect=AssertionError('no setup')),\
                 patch.object(p,'setup_v7_sequence',side_effect=AssertionError('no sequence')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v7'],{}),1)
            failure=reader.parse_setup_v7_outer(output.getvalue())
            self.assertEqual(failure['schema'],'bw.ring3.setup-entry-failure.v7')
            self.assertIsNone(failure['setup'])
            self.assertFalse(failure['actualGuestApproved'])
            cleanup=io.BytesIO()
            with patch.object(p,'SETUP_V7_ENABLED',True),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',side_effect=AssertionError('invalid context reached event')),\
                 patch.object(p,'setup_v7_stop_unit',side_effect=AssertionError('no unit stop')),\
                 patch.object(p.os,'unlink',side_effect=AssertionError('no policy unlink')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=cleanup)):
                self.assertEqual(p.dispatch_cli(['--cleanup-setup-v7-policy'],{}),1)
            partial=reader.parse(cleanup.getvalue())
            self.assertIsNone(partial['sourceAdmission'])
            self.assertIsNone(partial['stop'])
            self.assertIsNone(partial['policy'])
        def test_exact_distinct_request_and_mutations(self):
            request=self.request();raw=reader.canonical(request)
            self.assertEqual(p.admit_setup_v7_request(raw,sha(raw)),request)
            self.assertEqual(reader.setup_v7_request(raw,sha(raw))[0],request)
            for field,value in (('schema','bw.ring3.inventory-request.v3'),('head','f'*40),
                ('payloadWitness',dict(witness,schema='wrong')),('setup',dict(request['setup'],force=True))):
                candidate=copy.deepcopy(request);candidate[field]=value;bad=reader.canonical(candidate)
                with self.subTest(field=field),self.assertRaises((ValueError,reader.Refusal)):
                    reader.setup_v7_request(bad,sha(bad))
            with self.assertRaises((ValueError,reader.Refusal)):p.admit_setup_v7_request(raw,'0'*64)
        def test_mock_positive_full_chain_and_independent_setup_reader(self):
            request=self.request();ops=FakeOps();facts=p.setup_v7_sequence(ops,request)
            self.assertIsNone(facts['firstFailure']);self.assertEqual(facts['secondary'],[])
            self.assertEqual(ops.events,['preflight']+['acquire']*15+['policy','unpack','census-unpack',
                'configure','census-configure','post-status','census-policy-cleanup','cleanup',
                'archive-cleanup','stage'])
            self.assertTrue(facts['nodeStage']['irreversibleDrop']);self.assertTrue(facts['runtime']['graphObserved'])
            self.assertTrue(reader.setup_v7_facts(ops.snapshot,'123',101,31000000)['setupObserved'])
            self.assertFalse(reader.setup_v7_facts(ops.snapshot,'123',101,31000000)['completeHostConfiguration'])
        def test_pre_guard_image_fields_refuse_before_status_or_get(self):
            cgroup='0::/system.slice/bw-ring3-setup-v7-123-1.service\n'
            limits={name:value for name,value in p.LIMITS.items()}
            names={'cpu.max':'cpuMax','memory.max':'memoryMax','memory.swap.max':'swapMax',
                   'pids.max':'pidsMax'}
            def cgroup_text(_fd,path):
                name=str(path)
                if name=='/proc/self/cgroup':return cgroup
                return limits[names[name.rsplit('/',1)[-1]]]
            for environ in ({'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24','ImageVersion':'drift'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'','ImageVersion':'20261012.334.1'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24','ImageVersion':'X'*257}):
                host=p.SetupV7Host(environ,b'',b'',None)
                with self.subTest(environ=environ),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p.Cgroups,'text',side_effect=cgroup_text),\
                     patch.object(p,'bounded_read',side_effect=AssertionError('status before image')),\
                     patch.object(host,'acquire',side_effect=AssertionError('GET before image')):
                    with self.assertRaisesRegex(ValueError,'fresh exact hosted image labels') as caught:
                        host.preflight(self.request())
                prefix=caught.exception.ring3_partial['prefix']
                self.assertIsNone(prefix['statusOriginal'])
                self.assertIsNotNone(prefix['imageFields'])
                self.assertEqual(prefix['imageFields']['ImageVersion']['present'],
                                 'ImageVersion' in environ)
        def test_shell_original_canonical_forwarding_and_corruption(self):
            cases=({'ImageOS':'ubuntu24','ImageVersion':'20261012.334.1'},
                   {'ImageOS':'ubuntu24'},
                   {'ImageOS':'','ImageVersion':'different'},
                   {'ImageOS':'ubuntu24','ImageVersion':'X'*257})
            for fields in cases:
                with self.subTest(fields=fields):
                    output=io.BytesIO()
                    with patch.object(sys,'stdout',SimpleNamespace(buffer=output)):
                        self.assertEqual(p.setup_v7_image_shell(fields),0)
                    raw=output.getvalue();external={'shellBytes':len(raw),'shellSha256':sha(raw)}
                    shell=reader.decode_setup_v7_shell(raw,external)
                    self.assertEqual(shell['fields'],p.image_env_fields(fields)[0])
                    expected=reader.setup_v7_expected_forwarded(shell['fields'])
                    self.assertTrue(all(expected[name]['present'] for name in expected))
                    with self.assertRaises(reader.Refusal):
                        reader.decode_setup_v7_shell(raw,dict(external,shellSha256='0'*64))
            bad=reader.parse(raw);bad['fields']['ImageVersion']['value']='invented'
            changed=reader.canonical(bad)
            with self.assertRaises(reader.Refusal):
                reader.decode_setup_v7_shell(changed,{'shellBytes':len(changed),'shellSha256':sha(changed)})
        def test_coherent_setup_cuts_never_reach_stage(self):
            for fault in ('image','status','helper','alias','preexisting-policy','archive','policy','unpack','configure','deferred','cleanup','descendant','nested'):
                with self.subTest(fault=fault):
                    ops=FakeOps(fault);facts=p.setup_v7_sequence(ops,self.request())
                    self.assertIsNotNone(facts['firstFailure']);self.assertNotIn('stage',ops.events)
            for fault in ('drop','graph'):
                ops=FakeOps(fault);facts=p.setup_v7_sequence(ops,self.request())
                self.assertIsNotNone(facts['firstFailure']);self.assertIn('stage',ops.events)
        def test_partial_acquisition_primary_and_cleanup_secondary(self):
            class Partial(FakeOps):
                def acquire(self,package):
                    if self.events.count('acquire')==4:
                        error=OSError('FIRST_PARTIAL_ARCHIVE')
                        error.ring3_partial={'phase':'archive','receivedBytes':37,'writtenBytes':12,
                            'writeUncertain':True}
                        raise error
                    return super().acquire(package)
                def close_archives(self,archives):
                    self.events.append('archive-cleanup')
                    raise OSError('SECOND_ARCHIVE_CLEANUP')
            ops=Partial();facts=p.setup_v7_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_PARTIAL_ARCHIVE')
            self.assertEqual(facts['secondary'][0]['message'],'SECOND_ARCHIVE_CLEANUP')
            self.assertEqual(facts['partial']['receivedBytes'],37)
        def test_child_first_survives_census_failure(self):
            class ChildAndCensus(FakeOps):
                def dpkg(self,args):
                    item=super().dpkg(args)
                    item['firstFailure']={'phase':'setup-v7','name':'TimeoutError','message':'FIRST_CHILD_TIMEOUT'}
                    item['timedOut']=True
                    return item
                def quiescent(self,phase):
                    self.events.append('census-'+phase)
                    raise OSError('SECOND_CGROUP_READ')
            ops=ChildAndCensus();facts=p.setup_v7_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_CHILD_TIMEOUT')
            self.assertIn('SECOND_CGROUP_READ',[item['message'] for item in facts['secondary']])
            self.assertNotIn('configure',ops.events);self.assertNotIn('stage',ops.events)
            self.assertIsNone(facts['unpack']['cgroupAfter'])
        def test_real_host_oexcl_fstat_faults_close_and_refuse_unknown_unlink(self):
            host=p.SetupV7Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            root=Path('/run/bw-ring3-setup-v7-123-1');host.root=root
            closed=[];unlinked=[]
            with patch.object(host,'archive_root',return_value=root),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_ARCHIVE_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)),\
                 patch.object(p.urllib.request,'build_opener',side_effect=AssertionError('no GET')):
                with self.assertRaisesRegex(OSError,'FIRST_ARCHIVE_FSTAT') as caught:
                    host.acquire(p.setup_v7_policy()['packages'][0])
                self.assertEqual(caught.exception.ring3_partial['ownedIdentity'],None)
                with self.assertRaisesRegex(ValueError,'identity unknown'):host.close_archives([])
            self.assertEqual(closed,[77]);self.assertEqual(unlinked,[])
            closed=[]
            with patch.object(Path,'exists',return_value=False),patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(p.os,'open',return_value=78),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_POLICY_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)):
                with self.assertRaisesRegex(OSError,'FIRST_POLICY_FSTAT') as caught:
                    host.create_policy(p.SETUP_V7_POLICY_BYTES)
                self.assertIsNone(caught.exception.ring3_partial['createdIdentity'])
                self.assertIn('identity unknown',caught.exception.ring3_secondary[0]['message'])
            self.assertEqual(closed,[78]);self.assertEqual(unlinked,[])
            host=p.SetupV7Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            with patch.object(p.os,'mkdir',return_value=None),\
                 patch.object(Path,'lstat',side_effect=OSError('FIRST_DIRECTORY_STAT')),\
                 patch.object(p.os,'rmdir',side_effect=AssertionError('no unknown rmdir')):
                with self.assertRaisesRegex(OSError,'FIRST_DIRECTORY_STAT') as caught:host.archive_root()
                self.assertEqual(caught.exception.ring3_partial['phase'],'archive-directory')
                self.assertEqual(host.root,root);self.assertIsNone(host.root_identity)
                with self.assertRaisesRegex(ValueError,'identity before removal'):host.close_archives([])
        def test_stage_copy_first_and_close_secondary_then_drop_exec_progress(self):
            owner=SimpleNamespace(facts={'source':{},'sourceCommands':[],'eventIdentity':{}})
            env={key:'fixed' for key in p.SETUP_V7_ENV}
            env.update(SUDO_UID='1001',SUDO_GID='1002')
            host=p.SetupV7Host(env,b'event',b'request',owner)
            metadata=SimpleNamespace(st_uid=1001,st_gid=1002,st_mode=0o100644)
            class CopyEdge:
                def __init__(self,fail):self.fail=fail;self.facts={'created':['/run/fake']}
                def copy(self):
                    if self.fail:raise ValueError('FIRST_NODE_COPY')
                def record(self,raw):pass
                def close(self,failure):
                    if self.fail:failure.add(OSError('SECOND_PARENT_CLOSE'),'Node-stage-parent-close')
            for fail in (True,False):
                edge=CopyEdge(fail)
                with self.subTest(copyFailure=fail),\
                     patch.object(p,'NodeStageCopy',return_value=edge),\
                     patch.object(Path,'lstat',return_value=metadata),\
                     patch.object(p.os,'setgroups',return_value=None),\
                     patch.object(p.os,'setresgid',return_value=None),\
                     patch.object(p.os,'setresuid',return_value=None),\
                     patch.object(p,'entry_ids',return_value=None),\
                     patch.object(p.os,'execve',side_effect=OSError('FIRST_EXEC')):
                    with self.assertRaises(p.ObservedFailure if fail else OSError) as caught:
                        host.stage_drop_inventory({}, {})
                error=caught.exception
                self.assertEqual(error.firstFailure['message'] if fail else str(error),
                                 'FIRST_NODE_COPY' if fail else 'FIRST_EXEC')
                if fail:self.assertEqual(error.secondary[0]['message'],'SECOND_PARENT_CLOSE')
                self.assertEqual(error.ring3_partial['copy'],edge.facts)
                self.assertEqual(error.ring3_partial['dropProgress'],[] if fail else
                                 ['groups','gid','uid','ids-verified'])
        def test_outside_cleanup_bounded_exact_unit_stop_and_terminal_census(self):
            request=self.request();source=reader.parse(reader.prerequisite_original(
                reader.canonical(request['source'])))
            unit='bw-ring3-setup-v7-123-1.service'
            env={'GITHUB_RUN_ID':'123','BW_SYSTEMD_RUN_EXIT_CODE':'124',
                'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree']}
            absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
            populated={'terminal':'populated','cgroupProcs':'202\n','cgroupEvents':'populated 1\n',
                'cgroupStat':'nr_descendants 0\nnr_dying_descendants 0\n'}
            class Observer:
                def __init__(self,environ):self.facts={'source':source}
                def event(self):return b'{}'
                def source(self,selected):self.facts['source']=source
            for mode,pre,post,stop_error in (('absent',absent,absent,None),
                    ('stopped',populated,absent,None),
                    ('stop-error',populated,populated,OSError('STOP_FIRST')),
                    ('still-populated',populated,populated,None)):
                output=io.BytesIO();calls=[]
                def census(path):
                    calls.append(('census',path.name))
                    return pre if len([x for x in calls if x[0]=='census'])==1 else post
                def stop(name):
                    calls.append(('stop',name))
                    if stop_error:raise stop_error
                    return {'attempted':True,'argv':['/usr/bin/timeout','--kill-after=5s',
                        '20s','/usr/bin/systemctl','stop','--',unit],
                        'exitCode':0,'timedOut':False}
                def exists(path):return str(path)=='/usr/sbin/policy-rc.d'
                with self.subTest(mode=mode),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p,'HostedEnvelopeInstaller',Observer),\
                     patch.object(p,'admit_setup_v7_event',return_value=(b'{}',request)),\
                     patch.object(p,'setup_v7_owned_unit',return_value=mode!='absent'),\
                     patch.object(p,'setup_v7_outside_census',side_effect=census),\
                     patch.object(p,'setup_v7_stop_unit',side_effect=stop),\
                     patch.object(Path,'exists',exists),patch.object(Path,'is_symlink',return_value=False),\
                     patch.object(p.os,'unlink',side_effect=AssertionError('no policy unlink')),\
                     patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                    code=p.setup_v7_outside_cleanup(env)
                packet=reader.parse(output.getvalue())
                self.assertEqual(code,1);self.assertEqual(packet['firstFailure']['phase'],'v7-outer-client')
                self.assertEqual(packet['sourceAdmission']['unit'],unit)
                self.assertEqual([name for kind,name in calls if kind=='stop'],
                    [] if mode=='absent' else [unit])
                self.assertEqual(packet['postCensus'],post)
                self.assertNotEqual(packet['action'],'removed-exact')
                if mode=='stop-error':self.assertTrue(packet['secondary'])
            # Source admission failure forbids even an exact-unit stop.
            output=io.BytesIO()
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',Observer),\
                 patch.object(p,'admit_setup_v7_event',side_effect=ValueError('BAD_REQUEST')),\
                 patch.object(p,'setup_v7_stop_unit',side_effect=AssertionError('stop before admission')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                self.assertEqual(p.setup_v7_outside_cleanup(env),1)
            self.assertIsNone(reader.parse(output.getvalue())['sourceAdmission'])
        def test_exact_stop_command_is_finitely_bounded(self):
            completed=SimpleNamespace(returncode=124)
            with patch.object(p.subprocess,'run',return_value=completed) as run:
                fact=p.setup_v7_stop_unit('bw-ring3-setup-v7-123-1.service')
            self.assertEqual(fact['exitCode'],124);self.assertTrue(fact['timedOut'])
            argv=run.call_args.args[0]
            self.assertEqual(argv,['/usr/bin/timeout','--kill-after=5s','20s',
                '/usr/bin/systemctl','stop','--','bw-ring3-setup-v7-123-1.service'])
            self.assertEqual(run.call_args.kwargs['timeout'],30)
            with self.assertRaises(ValueError):p.setup_v7_stop_unit('unowned.service')
        def test_exact_owned_unit_identity_refuses_alias_and_wrong_name(self):
            unit=Path('/sys/fs/cgroup/system.slice/bw-ring3-setup-v7-123-1.service')
            with patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(Path,'exists',return_value=False):
                self.assertIs(p.setup_v7_owned_unit(unit),False)
            with patch.object(Path,'is_symlink',return_value=True),\
                 patch.object(Path,'exists',side_effect=AssertionError('alias must not be followed')):
                with self.assertRaises(ValueError):p.setup_v7_owned_unit(unit)
            for bad in (Path('/sys/fs/cgroup/system.slice/foreign.service'),
                        Path('/sys/fs/cgroup/foreign/bw-ring3-setup-v7-123-1.service')):
                with self.assertRaises(ValueError):p.setup_v7_owned_unit(bad)
            with patch.object(p,'setup_v7_owned_unit',return_value=True),\
                 patch.object(p.Cgroups,'text',side_effect=['1'*1025,'populated 1\n',
                                                            'nr_descendants 0\nnr_dying_descendants 0\n']):
                with self.assertRaises(ValueError):p.setup_v7_outside_census(unit)
        def test_raw_status_decoder_duplicate_tail_truncation_and_bomb(self):
            pre=b'Package: authored\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n'
            post=pre+b'\nPackage: second\nVersion: 1\nArchitecture: all\nStatus: install ok installed\n'
            output=io.BytesIO();p.emit_setup_v7_status('pre',pre,output.write,output.flush)
            pre_line=output.getvalue();p.emit_setup_v7_status('post',post,output.write,output.flush)
            raw=output.getvalue();self.assertEqual(reader.decode_setup_v7_status_log(raw)['pre']['raw'],pre)
            for malformed in (pre+b'Status:other\n',pre+b'Status:\tother\n',
                              pre+b' continued-authority\n'):
                with self.assertRaises((reader.Refusal,ValueError)):
                    reader.setup_v7_status_rows(malformed)
                with self.assertRaises(ValueError):p.setup_v7_status_rows(malformed)
            with self.assertRaises(reader.Refusal):reader.decode_setup_v7_status_log(raw+pre_line)
            for state in ('overflow','incomplete','tail'):
                class RefusingDecoder:
                    eof=state!='incomplete'
                    unused_data=b'X' if state=='tail' else b''
                    unconsumed_tail=b''
                    def decompress(self,data,limit):
                        return b'X'*(limit if state=='overflow' else 1)
                    def flush(self):raise AssertionError('flush before bounded stream validation')
                with self.subTest(decompressState=state),\
                     patch.object(reader.zlib,'decompressobj',return_value=RefusingDecoder()):
                    with self.assertRaises(reader.Refusal):reader.decode_setup_v7_status_log(raw)
            marker=p.SETUP_V7_STATUS_MARKER
            packet=reader.parse(pre_line[len(marker):]);packed=reader.base64.b64decode(packet['packed'])
            for invalid in (packed[:-2],packed+b'\0\0\0\0',p.zlib.compress(b'A'*((8<<20)+1))):
                changed=copy.deepcopy(packet);changed['packed']=reader.base64.b64encode(invalid).decode()
                changed['packedBytes']=len(invalid);changed['packedSha256']=sha(invalid)
                if invalid!=packed[:-2]:changed['rawBytes']=8<<20
                line=marker+reader.canonical(changed)+raw[len(pre_line):]
                with self.assertRaises(reader.Refusal):reader.decode_setup_v7_status_log(line)
        def test_versioned_outer_json_and_combined_wire_subbudgets(self):
            outer=reader.canonical({'schema':'bw.ring3.setup-runtime-inventory-original.v7',
                                    'largeObservedGraph':'x'*(1<<20)})
            self.assertGreater(len(outer),1<<20)
            self.assertEqual(reader.parse_setup_v7_outer(outer)['schema'],
                             'bw.ring3.setup-runtime-inventory-original.v7')
            with self.assertRaises(reader.Refusal):reader.parse(outer)
            for invalid in (b'{"a":1,"a":2}',b'{"a":1e10000}',b'"'+b'x'*(4<<20)+b'"'):
                with self.assertRaises(reader.Refusal):reader.parse_setup_v7_outer(invalid)
            oversized_roles={'runtime.setup-inventory.json':b'X'*(4<<20),
                'setup.event.json':b'E'*(512<<10),'setup.request.json':b'R'*(512<<10)}
            output=io.BytesIO()
            with self.assertRaisesRegex(reader.Refusal,'six-MiB v7 runtime component'):
                reader.emit_setup_v7_inventory(oversized_roles,output.write,output.flush)
            self.assertLessEqual(len(output.getvalue()),6<<20)
        def test_independent_packet_mutations(self):
            ops=FakeOps();p.setup_v7_sequence(ops,self.request());base=ops.snapshot
            for field,change in [('archives',lambda x:x[0].update(sha256='0'*64)),
                ('archives',lambda x:x[0].update(url='https://archive.ubuntu.com/ubuntu/'+x[0]['package']['filename'])),
                ('policy',lambda x:x.update(identity=[1,1,0o100755,0,0,1,19,100])),
                ('preflight',lambda x:x['helperAliases']['/bin/sh'].update(target='/usr/bin/bash')),
                ('preflight',lambda x:x['helperWitness']['/usr/sbin/ldconfig.real']['namedAfter'].__setitem__(1,999)),
                ('configure',lambda x:x.update(exitCode=1)),
                ('postStatus',lambda x:x.update(configurationComplete=True))]:
                bad=copy.deepcopy(base);change(bad[field])
                with self.subTest(field=field),self.assertRaises(reader.Refusal):reader.setup_v7_facts(bad,'123',101,31000000)
        def test_repaired_helper_alias_and_installer_environment_are_exact(self):
            request=self.request();raw=reader.canonical(request)
            for setup in (dict(request['setup'],installerPath='/usr/bin:/bin'),
                          dict(request['setup'],helperSha256=dict(request['setup']['helperSha256'],
                              **{'/usr/sbin/ldconfig.real':'0'*64})),
                          dict(request['setup'],helperAliases=dict(request['setup']['helperAliases'],
                              **{'/sbin':dict(request['setup']['helperAliases']['/sbin'],target='/elsewhere')}))):
                bad=dict(request,setup=setup);wire=reader.canonical(bad)
                with self.assertRaises((ValueError,reader.Refusal)):
                    p.admit_setup_v7_request(wire,sha(wire))
                with self.assertRaises(reader.Refusal):reader.setup_v7_request(wire,sha(wire))
            ops=FakeOps();p.setup_v7_sequence(ops,request);bad=copy.deepcopy(ops.snapshot)
            bad['unpack']['process']['environment']['PATH']='/usr/bin:/bin'
            with self.assertRaises(reader.Refusal):reader.setup_v7_facts(bad,'123',101,31000000)
            tool=p.SetupV7Tool(['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V7_CONFIGURE_ORDER])
            self.assertEqual(tool.environment['PATH'],'/usr/sbin:/usr/bin:/bin')
            self.assertEqual(p.ENV['PATH'],'/usr/bin:/bin')
            self.assertEqual(raw,reader.canonical(reader.setup_v7_request(raw,sha(raw))[0]))
        def test_distinct_v7_event_and_job_cannot_use_consumed_v4_marker(self):
            request=self.request();raw=reader.canonical(request);pin=sha(raw)
            wrapper=pin
            marker='BW_RING3_SETUP_RUNTIME_INVENTORY_V7'
            body='<!-- '+marker+'\n'+wrapper+'\n'+marker+' -->'
            event={'action':'labeled','label':{'name':'x86-ring3-setup-runtime-inventory-v7'},
                'repository':{'full_name':'CrispStrobe/bw-board'},'sender':{'login':'CrispStrobe'},
                'number':645,'pull_request':{'number':645,'state':'open','body':body,
                    'head':{'sha':request['head'],'repo':{'full_name':'CrispStrobe/bw-board','fork':False}},
                    'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}}
            env={'BW_RING3_SETUP_INVENTORY_V7_REQUEST_SHA256':pin,
                'BW_RING3_SETUP_INVENTORY_V7_REQUEST_B64':base64.b64encode(raw).decode('ascii'),'GITHUB_RUN_ID':'123',
                'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
                'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe',
                'GITHUB_JOB':'setup-runtime-inventory-v7','BW_EXPECTED_HEAD':request['head'],
                'BW_EXPECTED_TREE':request['tree'],'GITHUB_WORKFLOW_SHA':'c'*40,
                'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge'}
            wire=reader.canonical(event)
            with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                self.assertEqual(p.admit_setup_v7_event(wire,env)[1],request)
            reader.setup_v7_event(wire,request,pin,env)
            for bad_event,bad_env in ((dict(event,label={'name':'x86-ring3-setup-runtime-inventory-v1'}),env),
                                      (dict(event,pull_request=dict(event['pull_request'],
                                          body=body.replace('V7','V4'))),env),
                                      (event,dict(env,GITHUB_JOB='setup-runtime-inventory')),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V7_REQUEST_SHA256='0'*64)),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V7_REQUEST_B64='!')),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V7_REQUEST_B64=
                                                  base64.b64encode(b'{}').decode('ascii')))):

                with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                    with self.assertRaises((ValueError,reader.Refusal)):
                        p.admit_setup_v7_event(reader.canonical(bad_event),bad_env)
                with self.assertRaises(reader.Refusal):
                    reader.setup_v7_event(reader.canonical(bad_event),request,pin,bad_env)
        def test_new_child_profile_still_binds_role_and_terminal(self):
            class Child:
                role='setup-v7'
                environment=dict(p.SETUP_V7_INSTALLER_ENV)
                def __init__(self):self.clock=0
                def now(self):self.clock+=1000;return self.clock
                def spawn(self):return {'pid':201,'pgid':201,'parentPid':101,'startTicks':7}
                def read_available(self,timeout):return []
                def reap(self):return {'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                    'rusage':{'userSeconds':0.0,'systemSeconds':0.0,'maxRssKiB':1}}
                def close(self):pass
                def kill(self):raise AssertionError('no kill of completed child')
            argv=['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V7_CONFIGURE_ORDER]
            process,streams=p.collect_child(Child(),'setup-v7',argv,profile='setup-v7')
            self.assertIsNone(process['firstFailure']);self.assertEqual(process['environment'],p.SETUP_V7_INSTALLER_ENV)
            self.assertEqual(streams,{'stdout':b'','stderr':b''})
            with self.assertRaises(ValueError):p.collect_child(Child(),'setup-v4',argv,profile='setup-v7')
        def test_named_held_helper_readback_and_primary_close_failure(self):
            path='/usr/sbin/ldconfig.real';body=b'pure fixture only'
            named=SimpleNamespace(st_dev=1,st_ino=2,st_mode=0o100755,st_uid=0,st_gid=0,
                st_nlink=1,st_size=len(body),st_mtime_ns=3)
            changed=SimpleNamespace(**dict(vars(named),st_ino=99))
            with patch.object(p,'SETUP_V7_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V7_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                row=p.setup_v7_helper_witness(path,sha(body))
                self.assertTrue(row['closeSucceeded']);self.assertEqual(row['bytesRead'],len(body))
                self.assertEqual(row['namedBefore'],row['heldAfter']);closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V7_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V7_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',side_effect=[named,changed]),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                with self.assertRaisesRegex(ValueError,'closed selected helper identity') as caught:
                    p.setup_v7_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_partial['witness']['namedAfter'][1],99)
                closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V7_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V7_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=OSError('FIRST_HELPER_READ')),\
                 patch.object(p.os,'close',side_effect=OSError('SECOND_HELPER_CLOSE')):
                with self.assertRaisesRegex(OSError,'FIRST_HELPER_READ') as caught:
                    p.setup_v7_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_secondary[0]['message'],'SECOND_HELPER_CLOSE')
                self.assertTrue(caught.exception.ring3_partial['witness']['closeAttempted'])
        def test_five_real_listing_children_and_independent_nonroot_union(self):
            files,old_probe=runtime_fixture()
            node=files.facts.pop(reader.RUNTIME_NODE)
            files.facts[reader.NODE_STAGE_TARGET]=dict(node,mode=0o555)
            files.prefixes[reader.NODE_STAGE_TARGET]=files.prefixes.pop(reader.RUNTIME_NODE)
            files.rejected={}
            empty=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES))
            original_python_files=files.python_files
            files.python_files=lambda:sorted(original_python_files()+[empty])
            files.fact(reader.NODE_STAGE_TARGET)
            stage=files.metadata[reader.NODE_STAGE_TARGET]
            listings={
                'qemu-system-x86':[reader.RUNTIME_QEMU,reader.RUNTIME_TCG,
                                   '/usr/share/qemu/bios.bin'],
                'qemu-system-common':['/usr/share/qemu/common-keymap'],
                'qemu-system-data':['/usr/share/qemu/data-blob'],
                'seabios':['/usr/share/seabios/bios.bin'],
                'ipxe-qemu':['/usr/share/ipxe/rom.bin']}
            observed=[]
            def probe(argv):
                process,streams=old_probe(argv)
                if argv==[reader.NODE_STAGE_TARGET,'--version']:
                    streams['stdout']=b'v22.23.3\n'
                if argv[:2]==['/usr/bin/dpkg-query','-W']:
                    selected={name:(version,arch) for name,version,arch,*_ in
                              reader.SETUP_V7_PACKAGES if name in reader.PACKAGE_NAMES}
                    streams['stdout']=''.join(name+'\t'+selected[name][0]+'\t'+
                        selected[name][1]+'\n' for name in reader.PACKAGE_NAMES).encode()
                if argv[:2]==['/usr/bin/dpkg-query','-L']:
                    self.assertEqual(len(argv),3)
                    name=argv[2];observed.append(name)
                    streams['stdout']=('/.\n'+'\n'.join(listings[name])+'\n').encode()
                return process,streams
            inventory=reader.SetupV7Inventory(stage,files,probe)
            raw=inventory.discover_core()
            candidate=reader.setup_v7_runtime_expectation(raw,sha(raw))
            self.assertEqual(observed,list(reader.PACKAGE_NAMES))
            self.assertEqual(len(inventory.processes),15)
            self.assertEqual(candidate['packagePathsByPackage'],
                             {name:sorted(paths) for name,paths in listings.items()})
            self.assertEqual(candidate['packagePaths'],
                             sorted({path for rows in listings.values() for path in rows}))
            self.assertNotIn('/.',candidate['packagePaths'])
            self.assertEqual(reader.setup_v7_listed_paths(b'/.\n/usr/bin/tool\n\n'),
                             ['/usr/bin/tool'])
            self.assertEqual(reader.setup_v7_producer_listing('/.\n/usr/bin/tool\n\n'),
                             ['/usr/bin/tool'])
            qemu=next(row for row in candidate['packages'] if row['name']=='qemu-system-x86')
            original={'schema':'bw.ring3.runtime.v7',
                'observationPolicy':'prelaunch-probes-and-before-after-file-readback',
                'platform':candidate['platform'],'executables':candidate['executables'],
                'versions':candidate['versions'],'qemuPackage':{
                    'name':qemu['name'],'version':qemu['version'],
                    'architecture':qemu['architecture'],'aliases':candidate['aliases'],
                    'files':{path:{key:row[key] for key in ('bytes','sha256','kind')}
                             for path,row in candidate['files'].items()},
                    'probes':inventory.probes}}
            reader.verify_setup_v7_stable_original(original,raw,sha(raw))
            wrong_version=copy.deepcopy(candidate)
            next(item for item in wrong_version['packages']
                 if item['name']=='qemu-system-data')['version']='1:8.2.2+ds-0ubuntu1.19'
            wrong_original=copy.deepcopy(original)
            version_probe=next(item for item in wrong_original['qemuPackage']['probes']
                               if item['role']=='package-version')
            old_stdout=version_probe['stdout']
            version_probe['stdout']=version_probe['stdout'].replace(
                'qemu-system-data\t1:8.2.2+ds-0ubuntu1.18\t',
                'qemu-system-data\t1:8.2.2+ds-0ubuntu1.19\t')
            self.assertNotEqual(version_probe['stdout'],old_stdout)
            wrong_raw=reader.canonical(wrong_version)
            with self.assertRaises(reader.Refusal):
                reader.verify_setup_v7_stable_original(wrong_original,
                                                       wrong_raw,sha(wrong_raw))
            def wrong_probe(argv):
                process,streams=probe(argv)
                if argv[:2]==['/usr/bin/dpkg-query','-W']:
                    streams['stdout']=streams['stdout'].replace(
                        b'qemu-system-data\t1:8.2.2+ds-0ubuntu1.18\t',
                        b'qemu-system-data\t1:8.2.2+ds-0ubuntu1.19\t')
                return process,streams
            with self.assertRaises(reader.Refusal):
                reader.SetupV7Inventory(stage,files,wrong_probe).discover_core()
            empty_info=[1,777,0o100644,0,0,1,0,1700000000000000000]
            empty_original={'path':empty,'namedBefore':empty_info,
                'heldBefore':empty_info,'heldAfter':empty_info,
                'namedAfter':empty_info,'bytesRead':0,'readHex':'',
                'eof':True,'sha256':reader.STAGED_EMPTY_PYTHON_SOURCES[empty]['sha256'],
                'closeAttempted':True,'closeSucceeded':True,
                'firstFailure':None,'secondary':[]}
            inventory.partial['emptyPythonSources']={
                'before':copy.deepcopy(empty_original),
                'after':copy.deepcopy(empty_original)}
            snapshot={'candidate':{'bytes':len(raw),'sha256':sha(raw),
                       'base64':base64.b64encode(raw).decode()},
                      'inventory':copy.deepcopy(inventory.partial)}
            reader.verify_setup_v7_inventory_graph(snapshot)
            reordered=copy.deepcopy(snapshot)
            for key in ('probes','processes'):
                rows=reordered['inventory'][key]
                rows[6],rows[7]=rows[7],rows[6]
            for index,entry in enumerate(reordered['inventory']['processes']):
                process=entry['process']
                process['pid']=process['pgid']=201+index
                process['startTicks']=index+1
                process['spawnMonoNs']=100+index*10
                process['reapMonoNs']=101+index*10
            with self.assertRaises(reader.Refusal):
                reader.verify_setup_v7_inventory_graph(reordered)
            for mutant in (b'/usr/bin/tool\n',b'/.\n/usr/bin/tool',
                           b'/.\n/usr/bin/../tool\n',b'/.\n/usr/bin/tool\n\n\n',
                           b'/.\n/usr/bin/tool\n/./x\n',b'/.\n/usr/bin/tool\r\n'):
                with self.subTest(mutant=mutant),self.assertRaises(reader.Refusal):
                    reader.setup_v7_listed_paths(mutant)
            bad=copy.deepcopy(original)
            row=next(p for p in bad['qemuPackage']['probes'] if p['role']=='package-files-qemu-system-common')
            row['stdout']='/.\n/usr/share/qemu/other\n'
            with self.assertRaises(reader.Refusal):
                reader.verify_setup_v7_stable_original(bad,raw,sha(raw))
        def test_complete_failed_v7_inventory_packet_retains_clipped_last_child(self):
            def held(raw):
                return {'bytes':len(raw),'sha256':sha(raw),
                        'base64':base64.b64encode(raw).decode()}
            def row(name,version,arch='amd64'):
                return ('Package: '+name+'\nVersion: '+version+'\nArchitecture: '+arch+
                        '\nStatus: install ok installed').encode()
            baseline=[row('installed-'+str(i).zfill(4),'1') for i in range(1210)]
            baseline.append(row('libc-bin','2'))
            pre=b'\n\n'.join(baseline)+b'\n'
            post=b'\n\n'.join(baseline+[row(name,version,arch)
                for name,version,arch,*_ in p.SETUP_V7_PACKAGE_ROWS])+b'\n'
            log=io.BytesIO()
            pre_meta=p.emit_setup_v7_status('pre',pre,log.write,log.flush)
            post_meta=p.emit_setup_v7_status('post',post,log.write,log.flush)
            request=self.request()
            request_raw=reader.canonical(request)
            event_raw=b'{"syntheticEvent":true}\n'
            source=reader.parse(reader.prerequisite_original(reader.canonical(request['source'])))
            workflow_pin=source['files'][reader.WORKFLOW]['sha256']
            image={'ImageOS':{'present':True,'value':'ubuntu24'},
                   'ImageVersion':{'present':True,'value':'20261012.334.1'}}
            record={'request':held(request_raw),'event':held(event_raw),
                    'setup':{'preflight':{'statusOriginal':pre_meta,
                        'statusRecords':1211,'imageFields':image},
                        'postStatus':{'statusOriginal':post_meta,'records':1226}}}
            first={'phase':'inventory-stream','name':'Refusal',
                   'message':'inventory original stdout stream cap'}
            aliases={'/usr/bin/python3':{'linkText':'python3.12',
                     'target':'/usr/bin/python3.12'}}
            roles=['ldd-shell','ldd-dpkg-query','ldd-node','ldd-python',
                   'ldd-qemu','package-version','package-files-qemu-system-x86']
            env={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
            argvs=[['/usr/bin/ldd','/usr/bin/bash'],
                   ['/usr/bin/ldd','/usr/bin/dpkg-query'],
                   ['/usr/bin/ldd',reader.NODE_STAGE_TARGET],
                   ['/usr/bin/ldd','/usr/bin/python3.12'],
                   ['/usr/bin/ldd',reader.RUNTIME_QEMU],
                   ['/usr/bin/dpkg-query','-W',
                    '-f=${Package}\t${Version}\t${Architecture}\n',
                    *reader.PACKAGE_NAMES],
                   ['/usr/bin/dpkg-query','-L','qemu-system-x86']]
            processes=[];probes=[]
            for index,(role,argv) in enumerate(zip(roles,argvs)):
                stdout=b'X'*16384 if index==6 else b'prior mock output\n'
                process={'schema':'bw.ring3.inventory-process.v1','argv':argv,
                    'environment':env,'pid':201+index,'pgid':201+index,
                    'parentPid':101,'startTicks':index+1,
                    'spawnMonoNs':100+index*10,'reapMonoNs':101+index*10,
                    'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                    'rusage':{'userSeconds':0,'systemSeconds':0,'maxRssKiB':0},
                    'firstFailure':first if index==6 else None,'secondary':[]}
                processes.append({'role':role,'process':process,
                    'stdout':held(stdout),'stderr':held(b'')})
                probes.append({'role':role,'argv':argv,'environment':env,
                    'exitCode':0,'stdout':stdout.decode(),'stderr':''})
            stage={'identity':{'pid':101},'record':held(b'stage'),
                   'files':{},'directories':[],'source':source}
            value={'schema':'bw.ring3.setup-runtime-inventory-original.v7',
                'stageBefore':stage,'stageAfter':copy.deepcopy(stage),
                'parent':None,'inventory':{'aliases':aliases,'files':{},
                    'probes':probes,'processes':processes,'fileMetadata':{},
                    'pythonFiles':[],'mappedLibraries':[],'mapsOriginal':None,
                    'emptyPythonSources':{}},'candidate':None,
                'firstFailure':first,'secondary':[],'publicationSafe':True,
                'actualGuestApproved':False,'completeHostConfiguration':False}
            originals={'setup.request.json':request_raw,
                'setup.event.json':event_raw,
                'runtime.setup-inventory.json':reader.canonical(value)}
            reader.emit_setup_v7_inventory(originals,log.write,log.flush)
            raw=log.getvalue()
            class Observer:
                def __init__(self,environ):self.facts={'source':source}
                def event(self):return event_raw
                def source(self,selected):self.facts['source']=source
            outside=io.BytesIO()
            outside_env={'GITHUB_RUN_ID':'123','BW_SYSTEMD_RUN_EXIT_CODE':'1',
                'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree']}
            absent={'terminal':'absent','cgroupProcs':None,
                'cgroupEvents':None,'cgroupStat':None}
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',Observer),\
                 patch.object(p,'admit_setup_v7_event',return_value=(request_raw,request)),\
                 patch.object(p,'setup_v7_owned_unit',return_value=False),\
                 patch.object(p,'setup_v7_outside_census',return_value=absent),\
                 patch.object(Path,'exists',return_value=False),\
                 patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=outside)):
                self.assertEqual(p.setup_v7_outside_cleanup(outside_env),1)
            cleanup_raw=outside.getvalue();cleanup=reader.parse(cleanup_raw)
            self.assertEqual(cleanup['firstFailure']['phase'],'v7-outer-client')
            self.assertEqual(cleanup['action'],'not-needed')
            outer={'schema':'bw.ring3.setup-outer-terminal.v7','runId':'123',
                'unit':'/sys/fs/cgroup/system.slice/bw-ring3-setup-v7-123-1.service',
                'systemdRunExitCode':1,'outsideCleanupExitCode':1,
                'cgroupAfter':'absent'}
            outer_raw=reader.canonical(outer)
            shell={'fields':image}
            shell_raw=reader.canonical({'schema':'bw.ring3.setup-image-shell.v7',
                'fields':image,'fieldErrors':[],'setupAttempted':False,
                'guestAttempted':False,'setupApproved':False})
            external={'schema':'bw.ring3.setup-inventory-expectation.v7',
                'requestSha256':sha(request_raw),'runId':'123','attempt':1,
                'head':request['head'],'tree':request['tree'],
                'workflowSha':'e'*40,'workflowFileSha256':workflow_pin,
                'jobId':456,'jobName':'setup-runtime-inventory-v7',
                'conclusion':'failure','logBytes':len(raw),'logSha256':sha(raw),
                'outerBytes':len(outer_raw),'outerSha256':sha(outer_raw),
                'cleanupBytes':len(cleanup_raw),'cleanupSha256':sha(cleanup_raw),
                'shellBytes':len(shell_raw),'shellSha256':sha(shell_raw),
                'invoker':[1001,1002]}
            reader.setup_v7_cleanup_original(cleanup_raw,external)
            with patch.object(reader,'verify_setup_v7_stage_observation',
                              return_value=(request,source,record)):
                verdict=reader.verify_setup_v7_failure_log(
                    raw,external,outer_raw,cleanup_raw,shell_raw)
                self.assertTrue(verdict['completeFailedInventoryOriginal'])
                self.assertFalse(verdict['candidateReviewed'])
                self.assertFalse(verdict['setupObserved'])
                self.assertEqual(verdict['lastStdoutPrefixBytes'],16384)
                bad=copy.deepcopy(value)
                bad['inventory']['probes'][-1]['argv']=[
                    '/usr/bin/dpkg-query','-L','qemu-system-common']
                changed=dict(originals,**{'runtime.setup-inventory.json':reader.canonical(bad)})
                log2=io.BytesIO();log2.write(raw[:raw.index(reader.SETUP_V7_LOG_MARKER)])
                reader.emit_setup_v7_inventory(changed,log2.write,log2.flush)
                with self.assertRaises(reader.Refusal):
                    changed_raw=log2.getvalue()
                    changed_external=dict(external,logBytes=len(changed_raw),
                                          logSha256=sha(changed_raw))
                    reader.verify_setup_v7_failure_log(
                        changed_raw,changed_external,outer_raw,cleanup_raw,shell_raw)
    if export_sample:
        request=Tests().request();ops=FakeOps();facts=p.setup_v7_sequence(ops,request)
        assert facts['firstFailure'] is None and ops.snapshot is not None
        return copy.deepcopy(ops.snapshot),copy.deepcopy(witness)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure v7 setup controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'dpkg':False,
        'guest':False,'actualRunApproved':False,'pass':True}))


def setup_v8_controls(export_sample=False,export_ops=False):
    """Injected v8 setup chain only; no network, dpkg, service or guest edge."""
    p,_=producer_fixture_case()
    witness=copy.deepcopy(p.SETUP_V8_PAYLOAD_PINS)
    assert witness==reader.SETUP_V8_PAYLOAD_PINS and len(witness['archives'])==15
    assert p.SETUP_V8_SIGNED_DATA==reader.SETUP_V8_SIGNED_DATA
    assert p.SETUP_V8_DATA_ARCHIVE['archiveBytes']==reader.SETUP_V8_DATA_ARCHIVE['bytes']
    assert p.SETUP_V8_DATA_ARCHIVE['archiveSha256']==reader.SETUP_V8_DATA_ARCHIVE['sha256']
    assert all(p.SETUP_V8_DATA_ARCHIVE[key]==reader.SETUP_V8_DATA_ARCHIVE[key]
               for key in ('dataTarSha256','payloadManifestSha256'))
    class FakeOps:
        def __init__(self,fault=None):self.fault=fault;self.events=[];self.snapshot=None
        def preflight(self,request):
            self.events.append('preflight');value={'imageOS':'ubuntu24','imageVersion':p.SETUP_V8_IMAGE,
                'imageFields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                    'ImageVersion':{'present':True,'value':p.SETUP_V8_IMAGE}},
                'imageFieldErrors':[],
                'statusSha256':p.SETUP_V8_STATUS_SHA,'statusBytes':1231069,'statusRecords':1211,
                'statusOriginal':{'role':'pre','bytes':1231069,'sha256':p.SETUP_V8_STATUS_SHA,
                    'packedBytes':286949,'packedSha256':'a'*64},
                'helperSha256':p.SETUP_V8_HELPERS,'helperAliases':copy.deepcopy(p.SETUP_V8_HELPER_ALIASES),
                'helperWitness':{path:{'path':path,'namedBefore':info,'heldBefore':info[:],
                    'heldAfter':info[:],'namedAfter':info[:],
                    'bytesRead':info[6],'sha256':pin,'closeAttempted':True,'closeSucceeded':True}
                    for path,pin in p.SETUP_V8_HELPERS.items()
                    for info in ([1,100+list(p.SETUP_V8_HELPERS).index(path),0o100755,0,0,1,
                        p.SETUP_V8_NEW_HELPER_BYTES.get(path,1234),100],)},
                'policyAbsent':True,'newPackagesAbsent':True,
                'resource':{'membership':'0::/system.slice/bw-ring3-setup-v8-123-1.service\n',
                    'limits':dict(p.LIMITS)},
                'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}
            if self.fault=='image':value['imageVersion']='drift'
            if self.fault=='status':value['statusSha256']='0'*64
            if self.fault=='helper':value['helperSha256']=dict(value['helperSha256'],**{'/usr/bin/dash':'0'*64})
            if self.fault=='alias':value['helperAliases']['/bin/sh']['target']='/usr/bin/bash'
            if self.fault=='preexisting-policy':value['policyAbsent']=False
            return value
        def acquire(self,package):
            self.events.append('acquire');index=self.events.count('acquire')-1
            row={'package':package,'path':'/run/bw-ring3-setup-v8-123-1/'+str(index).zfill(2)+'.deb',
                'url':'https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+package['filename'],
                'bytes':package['size'],
                'sha256':package['sha256'],'identity':[1,100+index,0o100600,0,0,1,package['size'],100],
                'closeSucceeded':True}
            if self.fault=='archive' and index==4:row['sha256']='0'*64
            return row
        def create_policy(self,data):
            self.events.append('policy');row={'path':'/usr/sbin/policy-rc.d','identity':[1,500,0o100755,0,0,1,19,100],
                'sha256':sha(data),'mode':0o755,'exclusive':True}
            if self.fault=='policy':row['exclusive']=False
            return row
        def dpkg(self,args):
            phase='unpack' if '--unpack' in args else 'configure';self.events.append(phase)
            argv=['/usr/bin/dpkg',*args];start=40000000 if phase=='unpack' else 50000000
            process={'schema':'bw.ring3.process.v1','role':'setup-v8','argv':argv,'cwdRole':'checkout',
                'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'},
                'pid':200 if phase=='unpack' else 201,'pgid':200 if phase=='unpack' else 201,
                'parentPid':101,'startTicks':7,'spawnMonoNs':start,'reapMonoNs':start+1000,
                'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0.1,'systemSeconds':0.1,'maxRssKiB':1200},
                'firstFailure':None,'secondary':[]}
            row={'argv':argv,'process':process,'stdout':None,'stderr':None,'exitCode':0,
                'timedOut':False,'firstFailure':None,'secondary':[]}
            if self.fault==phase:row['exitCode']=1
            return row
        def quiescent(self,phase):
            self.events.append('census-'+phase)
            members='101\n202\n' if self.fault=='descendant' else '101\n'
            return {'phase':phase,'cgroupProcs':members,'cgroupEvents':'populated 1\nfrozen 0\n',
                'cgroupStat':'nr_descendants '+('1' if self.fault=='nested' else '0')+'\nnr_dying_descendants 0\n',
                'onlyController':members=='101\n' and self.fault!='nested'}
        def post_status(self,request):
            self.events.append('post-status');selected={name:{'Package':name,'Version':version,'Architecture':arch,
                'Status':'install ok installed','Triggers-Pending':None,'Triggers-Awaited':None}
                for name,version,arch,*_ in p.SETUP_V8_PACKAGE_ROWS}
            row={'sha256':'e'*64,'bytes':1234000,'records':1226,'selected':selected,
                'statusOriginal':{'role':'post','bytes':1234000,'sha256':'e'*64,
                    'packedBytes':300000,'packedSha256':'b'*64},
                'pendingHostTriggers':{'libc-bin:amd64':{'status':'install ok triggers-pending',
                    'pending':'ldconfig','awaited':None}},
                'serviceObserved':{'unit':copy.deepcopy(witness['serviceUnit']),
                    'init':copy.deepcopy(witness['initScript'])},
                'allSelectedPresent':True,'allowedStates':True,'deferredHostTriggers':True,'configurationComplete':False}
            if self.fault=='deferred':row['deferredHostTriggers']=False
            if self.fault=='post-status':selected['qemu-system-x86']['Status']='install ok half-configured'
            return row
        def remove_policy(self,record):
            self.events.append('cleanup')
            if self.fault=='cleanup':raise ValueError('mock exact cleanup failure')
            return {'removedExactOwnIdentity':True,'identity':record['identity']}
        def close_archives(self,archives):self.events.append('archive-cleanup')
        def stage_drop_inventory(self,request,facts):
            self.events.append('stage');self.snapshot=copy.deepcopy(facts)
            if self.fault=='drop':return {'verifiedCopy':True,'irreversibleDrop':False},{'graphObserved':False,'actualGuestApproved':False}
            if self.fault=='graph':return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':False,'actualGuestApproved':False}
            return {'verifiedCopy':True,'irreversibleDrop':True},{'graphObserved':True,'actualGuestApproved':False}
    if export_ops:return FakeOps,copy.deepcopy(witness)
    class Tests(unittest.TestCase):
        def request(self):
            env,expected,old,data=prerequisite_fixture()
            source=reader.parse(reader.prerequisite_original(reader.canonical(reader.parse(old['request.original.json'])['source'])))
            def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':reader.base64.b64encode(raw).decode()}
            request={'schema':'bw.ring3.inventory-request.v8','repository':'CrispStrobe/bw-board',
                'pullRequest':645,'head':'a'*40,'tree':'b'*40,'source':wrap(reader.canonical(source)),
                'selected':{'node':{'path':reader.NODE_STAGE_TARGET,'bytes':p.GENERATION_NODE_PIN[0],
                    'sha256':p.GENERATION_NODE_PIN[1]},'qemu':{'path':reader.RUNTIME_QEMU,**reader.RUNTIME_SELECTED['qemu']}},
                'nodeStage':{'source':reader.RUNTIME_NODE,'destination':reader.NODE_STAGE_TARGET,'owner':[0,0],
                    'fileMode':0o555,'directoryMode':0o555},
                'emptyPythonSources':copy.deepcopy(reader.STAGED_EMPTY_PYTHON_SOURCES),
                'setup':p.setup_v8_policy(),'payloadWitness':copy.deepcopy(witness)}
            return request
        def test_active_v8_workflow_matches_failed_service_topology(self):
            workflow=(HERE.parent.parent/'.github/workflows/i80386-ring3-int-iret.yml').read_text()
            tail=workflow.split('  setup-runtime-inventory-v8:\n',1)[1]
            lines=[]
            for line in tail.splitlines(keepends=True):
                if line.startswith('  ') and line[2:3].isalnum() and line.endswith(':\n'):
                    break
                lines.append(line)
            route=''.join(lines)
            self.assertTrue(route and route != tail)
            self.assertIn("if: ${{ github.event.action == 'labeled' && github.event.label.name == 'x86-ring3-setup-runtime-inventory-v8' && github.actor == 'CrispStrobe' && github.run_attempt == '1' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.head.repo.fork == false }}",route)
            checkout='actions/checkout@11d5960a326750d5838078e36cf38b85af677262'
            node='actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
            self.assertEqual(route.count(checkout),1);self.assertEqual(route.count(node),1)
            self.assertLess(route.index(checkout),route.index(node))
            self.assertLess(route.index(node),route.index('--setup-v8-image-shell'))
            self.assertLess(route.index('--setup-v8-image-shell'),route.index('ring3_v8_service()'))
            self.assertIn('node-version: 22.23.3',route)
            self.assertIn('ImageOS="${ImageOS-}" ImageVersion="${ImageVersion-}"',route)
            self.assertIn('/usr/bin/python3 -I -B scripts/i80386-ring3-int-iret/run.py --setup-runtime-inventory-v8',route)
            self.assertIn('BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64',route)
            self.assertIn('shell-image.original.json',route)
            self.assertIn('sudo -- /usr/bin/timeout --kill-after=5s 720s /usr/bin/systemd-run --wait --pipe',route)
            self.assertIn('/usr/bin/timeout --kill-after=5s 60s /usr/bin/python3 -I -B',route)
            self.assertNotIn('--hosted-actual',route)
        def test_explicit_disabled_guard_refuses_before_host_edges(self):
            with patch.object(p,'SETUP_V8_ENABLED',False),patch.object(p,'setup_v8_entry',side_effect=AssertionError('no host')),patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v8'],{}),1)
            with patch.object(p,'SETUP_V8_ENABLED',False),\
                 patch.object(p,'setup_v8_image_shell',side_effect=AssertionError('no shell')),\
                 patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--setup-v8-image-shell'],{}),1)
            with patch.object(p,'SETUP_V8_ENABLED',False),\
                 patch.object(p,'setup_v8_outside_cleanup',side_effect=AssertionError('no cleanup')),\
                 patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(p.dispatch_cli(['--cleanup-setup-v8-policy'],{}),1)
            with patch.object(reader,'SETUP_V8_READER_ENABLED',False),\
                 patch.object(sys,'argv',['reader.py','--inventory-setup-v8']),\
                 patch.object(reader,'setup_v8_inventory_entry',side_effect=AssertionError('no reader')):
                with self.assertRaises(reader.Refusal):reader.main()
        def test_enabled_metadata_dispatch_still_uses_admission_entry(self):
            self.assertIs(p.SETUP_V8_ENABLED,True);self.assertIs(reader.SETUP_V8_READER_ENABLED,True)
            self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            for mode,name in (('setup-runtime-inventory-v8','setup_v8_entry'),('cleanup-setup-v8-policy','setup_v8_outside_cleanup')):
                with self.subTest(mode=mode),patch.object(p,'SETUP_V8_ENABLED',True),patch.object(p,name,return_value=17) as entry:
                    self.assertEqual(p.dispatch_cli(['--'+mode],{'test':'inert'}),17)
                    entry.assert_called_once_with({'test':'inert'})
            with patch.object(reader,'SETUP_V8_READER_ENABLED',True),patch.object(sys,'argv',['reader.py','--inventory-setup-v8']),patch.object(reader,'setup_v8_inventory_entry',return_value=({},False,False)) as entry:
                with self.assertRaises(SystemExit) as stopped: reader.main()
                self.assertEqual(stopped.exception.code,1);entry.assert_called_once()
        def test_active_invalid_event_refuses_before_setup_or_network(self):
            class InvalidObserver:
                def __init__(self,environ):
                    self.facts={'eventIdentity':None,'sourceCommands':[],'source':None}
                def event(self):return b'{}'
                def source(self,request):raise AssertionError('invalid event reached source')
            output=io.BytesIO()
            with patch.object(p,'SETUP_V8_ENABLED',True),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',InvalidObserver),\
                 patch.object(p,'SetupV8Host',side_effect=AssertionError('no setup')),\
                 patch.object(p,'setup_v8_sequence',side_effect=AssertionError('no sequence')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                self.assertEqual(p.dispatch_cli(['--setup-runtime-inventory-v8'],{}),1)
            failure=reader.parse_setup_v8_outer(output.getvalue())
            self.assertEqual(failure['schema'],'bw.ring3.setup-entry-failure.v8')
            self.assertIsNone(failure['setup'])
            self.assertFalse(failure['actualGuestApproved'])
            cleanup=io.BytesIO()
            with patch.object(p,'SETUP_V8_ENABLED',True),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',side_effect=AssertionError('invalid context reached event')),\
                 patch.object(p,'setup_v8_stop_unit',side_effect=AssertionError('no unit stop')),\
                 patch.object(p.os,'unlink',side_effect=AssertionError('no policy unlink')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=cleanup)):
                self.assertEqual(p.dispatch_cli(['--cleanup-setup-v8-policy'],{}),1)
            partial=reader.parse(cleanup.getvalue())
            self.assertIsNone(partial['sourceAdmission'])
            self.assertIsNone(partial['stop'])
            self.assertIsNone(partial['policy'])
        def test_exact_distinct_request_and_mutations(self):
            request=self.request();raw=reader.canonical(request)
            self.assertEqual(p.admit_setup_v8_request(raw,sha(raw)),request)
            self.assertEqual(reader.setup_v8_request(raw,sha(raw))[0],request)
            for field,value in (('schema','bw.ring3.inventory-request.v3'),('head','f'*40),
                ('payloadWitness',dict(witness,schema='wrong')),('setup',dict(request['setup'],force=True))):
                candidate=copy.deepcopy(request);candidate[field]=value;bad=reader.canonical(candidate)
                with self.subTest(field=field),self.assertRaises((ValueError,reader.Refusal)):
                    reader.setup_v8_request(bad,sha(bad))
            with self.assertRaises((ValueError,reader.Refusal)):p.admit_setup_v8_request(raw,'0'*64)
        def test_mock_positive_full_chain_and_independent_setup_reader(self):
            request=self.request();ops=FakeOps();facts=p.setup_v8_sequence(ops,request)
            self.assertIsNone(facts['firstFailure']);self.assertEqual(facts['secondary'],[])
            self.assertEqual(ops.events,['preflight']+['acquire']*15+['policy','unpack','census-unpack',
                'configure','census-configure','post-status','census-policy-cleanup','cleanup',
                'archive-cleanup','stage'])
            self.assertTrue(facts['nodeStage']['irreversibleDrop']);self.assertTrue(facts['runtime']['graphObserved'])
            self.assertTrue(reader.setup_v8_facts(ops.snapshot,'123',101,31000000)['setupObserved'])
            self.assertFalse(reader.setup_v8_facts(ops.snapshot,'123',101,31000000)['completeHostConfiguration'])
        def test_pre_guard_image_fields_refuse_before_status_or_get(self):
            cgroup='0::/system.slice/bw-ring3-setup-v8-123-1.service\n'
            limits={name:value for name,value in p.LIMITS.items()}
            names={'cpu.max':'cpuMax','memory.max':'memoryMax','memory.swap.max':'swapMax',
                   'pids.max':'pidsMax'}
            def cgroup_text(_fd,path):
                name=str(path)
                if name=='/proc/self/cgroup':return cgroup
                return limits[names[name.rsplit('/',1)[-1]]]
            for environ in ({'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24','ImageVersion':'drift'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'','ImageVersion':'20261012.334.1'},
                            {'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24','ImageVersion':'X'*257}):
                host=p.SetupV8Host(environ,b'',b'',None)
                with self.subTest(environ=environ),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p.Cgroups,'text',side_effect=cgroup_text),\
                     patch.object(p,'bounded_read',side_effect=AssertionError('status before image')),\
                     patch.object(host,'acquire',side_effect=AssertionError('GET before image')):
                    with self.assertRaisesRegex(ValueError,'fresh exact hosted image labels') as caught:
                        host.preflight(self.request())
                prefix=caught.exception.ring3_partial['prefix']
                self.assertIsNone(prefix['statusOriginal'])
                self.assertIsNotNone(prefix['imageFields'])
                self.assertEqual(prefix['imageFields']['ImageVersion']['present'],
                                 'ImageVersion' in environ)
        def test_shell_original_canonical_forwarding_and_corruption(self):
            cases=({'ImageOS':'ubuntu24','ImageVersion':'20261012.334.1'},
                   {'ImageOS':'ubuntu24'},
                   {'ImageOS':'','ImageVersion':'different'},
                   {'ImageOS':'ubuntu24','ImageVersion':'X'*257})
            for fields in cases:
                with self.subTest(fields=fields):
                    output=io.BytesIO()
                    with patch.object(sys,'stdout',SimpleNamespace(buffer=output)):
                        self.assertEqual(p.setup_v8_image_shell(fields),0)
                    raw=output.getvalue();external={'shellBytes':len(raw),'shellSha256':sha(raw)}
                    shell=reader.decode_setup_v8_shell(raw,external)
                    self.assertEqual(shell['fields'],p.image_env_fields(fields)[0])
                    expected=reader.setup_v8_expected_forwarded(shell['fields'])
                    self.assertTrue(all(expected[name]['present'] for name in expected))
                    with self.assertRaises(reader.Refusal):
                        reader.decode_setup_v8_shell(raw,dict(external,shellSha256='0'*64))
            bad=reader.parse(raw);bad['fields']['ImageVersion']['value']='invented'
            changed=reader.canonical(bad)
            with self.assertRaises(reader.Refusal):
                reader.decode_setup_v8_shell(changed,{'shellBytes':len(changed),'shellSha256':sha(changed)})
        def test_coherent_setup_cuts_never_reach_stage(self):
            for fault in ('image','status','helper','alias','preexisting-policy','archive','policy','unpack','configure','deferred','cleanup','descendant','nested'):
                with self.subTest(fault=fault):
                    ops=FakeOps(fault);facts=p.setup_v8_sequence(ops,self.request())
                    self.assertIsNotNone(facts['firstFailure']);self.assertNotIn('stage',ops.events)
            for fault in ('drop','graph'):
                ops=FakeOps(fault);facts=p.setup_v8_sequence(ops,self.request())
                self.assertIsNotNone(facts['firstFailure']);self.assertIn('stage',ops.events)
        def test_partial_acquisition_primary_and_cleanup_secondary(self):
            class Partial(FakeOps):
                def acquire(self,package):
                    if self.events.count('acquire')==4:
                        error=OSError('FIRST_PARTIAL_ARCHIVE')
                        error.ring3_partial={'phase':'archive','receivedBytes':37,'writtenBytes':12,
                            'writeUncertain':True}
                        raise error
                    return super().acquire(package)
                def close_archives(self,archives):
                    self.events.append('archive-cleanup')
                    raise OSError('SECOND_ARCHIVE_CLEANUP')
            ops=Partial();facts=p.setup_v8_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_PARTIAL_ARCHIVE')
            self.assertEqual(facts['secondary'][0]['message'],'SECOND_ARCHIVE_CLEANUP')
            self.assertEqual(facts['partial']['receivedBytes'],37)
        def test_child_first_survives_census_failure(self):
            class ChildAndCensus(FakeOps):
                def dpkg(self,args):
                    item=super().dpkg(args)
                    item['firstFailure']={'phase':'setup-v8','name':'TimeoutError','message':'FIRST_CHILD_TIMEOUT'}
                    item['timedOut']=True
                    return item
                def quiescent(self,phase):
                    self.events.append('census-'+phase)
                    raise OSError('SECOND_CGROUP_READ')
            ops=ChildAndCensus();facts=p.setup_v8_sequence(ops,self.request())
            self.assertEqual(facts['firstFailure']['message'],'FIRST_CHILD_TIMEOUT')
            self.assertIn('SECOND_CGROUP_READ',[item['message'] for item in facts['secondary']])
            self.assertNotIn('configure',ops.events);self.assertNotIn('stage',ops.events)
            self.assertIsNone(facts['unpack']['cgroupAfter'])
        def test_real_host_oexcl_fstat_faults_close_and_refuse_unknown_unlink(self):
            host=p.SetupV8Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            root=Path('/run/bw-ring3-setup-v8-123-1');host.root=root
            closed=[];unlinked=[]
            with patch.object(host,'archive_root',return_value=root),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_ARCHIVE_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)),\
                 patch.object(p.urllib.request,'build_opener',side_effect=AssertionError('no GET')):
                with self.assertRaisesRegex(OSError,'FIRST_ARCHIVE_FSTAT') as caught:
                    host.acquire(p.setup_v8_policy()['packages'][0])
                self.assertEqual(caught.exception.ring3_partial['ownedIdentity'],None)
                with self.assertRaisesRegex(ValueError,'identity unknown'):host.close_archives([])
            self.assertEqual(closed,[77]);self.assertEqual(unlinked,[])
            closed=[]
            with patch.object(Path,'exists',return_value=False),patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(p.os,'open',return_value=78),\
                 patch.object(p.os,'fstat',side_effect=OSError('FIRST_POLICY_FSTAT')),\
                 patch.object(p.os,'close',side_effect=lambda fd:closed.append(fd)),\
                 patch.object(p.os,'unlink',side_effect=lambda path:unlinked.append(path)):
                with self.assertRaisesRegex(OSError,'FIRST_POLICY_FSTAT') as caught:
                    host.create_policy(p.SETUP_V8_POLICY_BYTES)
                self.assertIsNone(caught.exception.ring3_partial['createdIdentity'])
                self.assertIn('identity unknown',caught.exception.ring3_secondary[0]['message'])
            self.assertEqual(closed,[78]);self.assertEqual(unlinked,[])
            host=p.SetupV8Host({'GITHUB_RUN_ID':'123'},b'',b'',None)
            with patch.object(p.os,'mkdir',return_value=None),\
                 patch.object(Path,'lstat',side_effect=OSError('FIRST_DIRECTORY_STAT')),\
                 patch.object(p.os,'rmdir',side_effect=AssertionError('no unknown rmdir')):
                with self.assertRaisesRegex(OSError,'FIRST_DIRECTORY_STAT') as caught:host.archive_root()
                self.assertEqual(caught.exception.ring3_partial['phase'],'archive-directory')
                self.assertEqual(host.root,root);self.assertIsNone(host.root_identity)
                with self.assertRaisesRegex(ValueError,'identity before removal'):host.close_archives([])
        def test_stage_copy_first_and_close_secondary_then_drop_exec_progress(self):
            owner=SimpleNamespace(facts={'source':{},'sourceCommands':[],'eventIdentity':{}})
            env={key:'fixed' for key in p.SETUP_V8_ENV}
            env.update(SUDO_UID='1001',SUDO_GID='1002')
            host=p.SetupV8Host(env,b'event',b'request',owner)
            metadata=SimpleNamespace(st_uid=1001,st_gid=1002,st_mode=0o100644)
            class CopyEdge:
                def __init__(self,fail):self.fail=fail;self.facts={'created':['/run/fake']}
                def copy(self):
                    if self.fail:raise ValueError('FIRST_NODE_COPY')
                def record(self,raw):pass
                def close(self,failure):
                    if self.fail:failure.add(OSError('SECOND_PARENT_CLOSE'),'Node-stage-parent-close')
            for fail in (True,False):
                edge=CopyEdge(fail)
                with self.subTest(copyFailure=fail),\
                     patch.object(p,'NodeStageCopy',return_value=edge),\
                     patch.object(Path,'lstat',return_value=metadata),\
                     patch.object(p.os,'setgroups',return_value=None),\
                     patch.object(p.os,'setresgid',return_value=None),\
                     patch.object(p.os,'setresuid',return_value=None),\
                     patch.object(p,'entry_ids',return_value=None),\
                     patch.object(p.os,'execve',side_effect=OSError('FIRST_EXEC')):
                    with self.assertRaises(p.ObservedFailure if fail else OSError) as caught:
                        host.stage_drop_inventory({}, {})
                error=caught.exception
                self.assertEqual(error.firstFailure['message'] if fail else str(error),
                                 'FIRST_NODE_COPY' if fail else 'FIRST_EXEC')
                if fail:self.assertEqual(error.secondary[0]['message'],'SECOND_PARENT_CLOSE')
                self.assertEqual(error.ring3_partial['copy'],edge.facts)
                self.assertEqual(error.ring3_partial['dropProgress'],[] if fail else
                                 ['groups','gid','uid','ids-verified'])
        def test_outside_cleanup_bounded_exact_unit_stop_and_terminal_census(self):
            request=self.request();source=reader.parse(reader.prerequisite_original(
                reader.canonical(request['source'])))
            unit='bw-ring3-setup-v8-123-1.service'
            env={'GITHUB_RUN_ID':'123','BW_SYSTEMD_RUN_EXIT_CODE':'124',
                'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree']}
            absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
            populated={'terminal':'populated','cgroupProcs':'202\n','cgroupEvents':'populated 1\n',
                'cgroupStat':'nr_descendants 0\nnr_dying_descendants 0\n'}
            class Observer:
                def __init__(self,environ):self.facts={'source':source}
                def event(self):return b'{}'
                def source(self,selected):self.facts['source']=source
            for mode,pre,post,stop_error in (('absent',absent,absent,None),
                    ('stopped',populated,absent,None),
                    ('stop-error',populated,populated,OSError('STOP_FIRST')),
                    ('still-populated',populated,populated,None)):
                output=io.BytesIO();calls=[]
                def census(path):
                    calls.append(('census',path.name))
                    return pre if len([x for x in calls if x[0]=='census'])==1 else post
                def stop(name):
                    calls.append(('stop',name))
                    if stop_error:raise stop_error
                    return {'attempted':True,'argv':['/usr/bin/timeout','--kill-after=5s',
                        '20s','/usr/bin/systemctl','stop','--',unit],
                        'exitCode':0,'timedOut':False}
                def exists(path):return str(path)=='/usr/sbin/policy-rc.d'
                with self.subTest(mode=mode),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p,'HostedEnvelopeInstaller',Observer),\
                     patch.object(p,'admit_setup_v8_event',return_value=(b'{}',request)),\
                     patch.object(p,'setup_v8_owned_unit',return_value=mode!='absent'),\
                     patch.object(p,'setup_v8_outside_census',side_effect=census),\
                     patch.object(p,'setup_v8_stop_unit',side_effect=stop),\
                     patch.object(Path,'exists',exists),patch.object(Path,'is_symlink',return_value=False),\
                     patch.object(p.os,'unlink',side_effect=AssertionError('no policy unlink')),\
                     patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                    code=p.setup_v8_outside_cleanup(env)
                packet=reader.parse(output.getvalue())
                self.assertEqual(code,1);self.assertEqual(packet['firstFailure']['phase'],'v8-outer-client')
                self.assertEqual(packet['sourceAdmission']['unit'],unit)
                self.assertEqual([name for kind,name in calls if kind=='stop'],
                    [] if mode=='absent' else [unit])
                self.assertEqual(packet['postCensus'],post)
                self.assertNotEqual(packet['action'],'removed-exact')
                if mode=='stop-error':self.assertTrue(packet['secondary'])
            # Source admission failure forbids even an exact-unit stop.
            output=io.BytesIO()
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',Observer),\
                 patch.object(p,'admit_setup_v8_event',side_effect=ValueError('BAD_REQUEST')),\
                 patch.object(p,'setup_v8_stop_unit',side_effect=AssertionError('stop before admission')),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                self.assertEqual(p.setup_v8_outside_cleanup(env),1)
            self.assertIsNone(reader.parse(output.getvalue())['sourceAdmission'])
        def test_exact_stop_command_is_finitely_bounded(self):
            completed=SimpleNamespace(returncode=124)
            with patch.object(p.subprocess,'run',return_value=completed) as run:
                fact=p.setup_v8_stop_unit('bw-ring3-setup-v8-123-1.service')
            self.assertEqual(fact['exitCode'],124);self.assertTrue(fact['timedOut'])
            argv=run.call_args.args[0]
            self.assertEqual(argv,['/usr/bin/timeout','--kill-after=5s','20s',
                '/usr/bin/systemctl','stop','--','bw-ring3-setup-v8-123-1.service'])
            self.assertEqual(run.call_args.kwargs['timeout'],30)
            with self.assertRaises(ValueError):p.setup_v8_stop_unit('unowned.service')
        def test_exact_owned_unit_identity_refuses_alias_and_wrong_name(self):
            unit=Path('/sys/fs/cgroup/system.slice/bw-ring3-setup-v8-123-1.service')
            with patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(Path,'exists',return_value=False):
                self.assertIs(p.setup_v8_owned_unit(unit),False)
            with patch.object(Path,'is_symlink',return_value=True),\
                 patch.object(Path,'exists',side_effect=AssertionError('alias must not be followed')):
                with self.assertRaises(ValueError):p.setup_v8_owned_unit(unit)
            for bad in (Path('/sys/fs/cgroup/system.slice/foreign.service'),
                        Path('/sys/fs/cgroup/foreign/bw-ring3-setup-v8-123-1.service')):
                with self.assertRaises(ValueError):p.setup_v8_owned_unit(bad)
            with patch.object(p,'setup_v8_owned_unit',return_value=True),\
                 patch.object(p.Cgroups,'text',side_effect=['1'*1025,'populated 1\n',
                                                            'nr_descendants 0\nnr_dying_descendants 0\n']):
                with self.assertRaises(ValueError):p.setup_v8_outside_census(unit)
        def test_raw_status_decoder_duplicate_tail_truncation_and_bomb(self):
            pre=b'Package: authored\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n'
            post=pre+b'\nPackage: second\nVersion: 1\nArchitecture: all\nStatus: install ok installed\n'
            output=io.BytesIO();p.emit_setup_v8_status('pre',pre,output.write,output.flush)
            pre_line=output.getvalue();p.emit_setup_v8_status('post',post,output.write,output.flush)
            raw=output.getvalue();self.assertEqual(reader.decode_setup_v8_status_log(raw)['pre']['raw'],pre)
            for malformed in (pre+b'Status:other\n',pre+b'Status:\tother\n',
                              pre+b' continued-authority\n'):
                with self.assertRaises((reader.Refusal,ValueError)):
                    reader.setup_v8_status_rows(malformed)
                with self.assertRaises(ValueError):p.setup_v8_status_rows(malformed)
            with self.assertRaises(reader.Refusal):reader.decode_setup_v8_status_log(raw+pre_line)
            for state in ('overflow','incomplete','tail'):
                class RefusingDecoder:
                    eof=state!='incomplete'
                    unused_data=b'X' if state=='tail' else b''
                    unconsumed_tail=b''
                    def decompress(self,data,limit):
                        return b'X'*(limit if state=='overflow' else 1)
                    def flush(self):raise AssertionError('flush before bounded stream validation')
                with self.subTest(decompressState=state),\
                     patch.object(reader.zlib,'decompressobj',return_value=RefusingDecoder()):
                    with self.assertRaises(reader.Refusal):reader.decode_setup_v8_status_log(raw)
            marker=p.SETUP_V8_STATUS_MARKER
            packet=reader.parse(pre_line[len(marker):]);packed=reader.base64.b64decode(packet['packed'])
            for invalid in (packed[:-2],packed+b'\0\0\0\0',p.zlib.compress(b'A'*((8<<20)+1))):
                changed=copy.deepcopy(packet);changed['packed']=reader.base64.b64encode(invalid).decode()
                changed['packedBytes']=len(invalid);changed['packedSha256']=sha(invalid)
                if invalid!=packed[:-2]:changed['rawBytes']=8<<20
                line=marker+reader.canonical(changed)+raw[len(pre_line):]
                with self.assertRaises(reader.Refusal):reader.decode_setup_v8_status_log(line)
        def test_versioned_outer_json_and_combined_wire_subbudgets(self):
            outer=reader.canonical({'schema':'bw.ring3.setup-runtime-inventory-original.v8',
                                    'largeObservedGraph':'x'*(1<<20)})
            self.assertGreater(len(outer),1<<20)
            self.assertEqual(reader.parse_setup_v8_outer(outer)['schema'],
                             'bw.ring3.setup-runtime-inventory-original.v8')
            with self.assertRaises(reader.Refusal):reader.parse(outer)
            for invalid in (b'{"a":1,"a":2}',b'{"a":1e10000}',b'"'+b'x'*(4<<20)+b'"'):
                with self.assertRaises(reader.Refusal):reader.parse_setup_v8_outer(invalid)
            oversized_roles={'runtime.setup-inventory.json':b'X'*(4<<20),
                'setup.event.json':b'E'*(512<<10),'setup.request.json':b'R'*(512<<10)}
            output=io.BytesIO()
            with self.assertRaisesRegex(reader.Refusal,'six-MiB v8 runtime component'):
                reader.emit_setup_v8_inventory(oversized_roles,output.write,output.flush)
            self.assertLessEqual(len(output.getvalue()),6<<20)
        def test_independent_packet_mutations(self):
            ops=FakeOps();p.setup_v8_sequence(ops,self.request());base=ops.snapshot
            for field,change in [('archives',lambda x:x[0].update(sha256='0'*64)),
                ('archives',lambda x:x[0].update(url='https://archive.ubuntu.com/ubuntu/'+x[0]['package']['filename'])),
                ('policy',lambda x:x.update(identity=[1,1,0o100755,0,0,1,19,100])),
                ('preflight',lambda x:x['helperAliases']['/bin/sh'].update(target='/usr/bin/bash')),
                ('preflight',lambda x:x['helperWitness']['/usr/sbin/ldconfig.real']['namedAfter'].__setitem__(1,999)),
                ('configure',lambda x:x.update(exitCode=1)),
                ('postStatus',lambda x:x.update(configurationComplete=True))]:
                bad=copy.deepcopy(base);change(bad[field])
                with self.subTest(field=field),self.assertRaises(reader.Refusal):reader.setup_v8_facts(bad,'123',101,31000000)
        def test_repaired_helper_alias_and_installer_environment_are_exact(self):
            request=self.request();raw=reader.canonical(request)
            for setup in (dict(request['setup'],installerPath='/usr/bin:/bin'),
                          dict(request['setup'],helperSha256=dict(request['setup']['helperSha256'],
                              **{'/usr/sbin/ldconfig.real':'0'*64})),
                          dict(request['setup'],helperAliases=dict(request['setup']['helperAliases'],
                              **{'/sbin':dict(request['setup']['helperAliases']['/sbin'],target='/elsewhere')}))):
                bad=dict(request,setup=setup);wire=reader.canonical(bad)
                with self.assertRaises((ValueError,reader.Refusal)):
                    p.admit_setup_v8_request(wire,sha(wire))
                with self.assertRaises(reader.Refusal):reader.setup_v8_request(wire,sha(wire))
            ops=FakeOps();p.setup_v8_sequence(ops,request);bad=copy.deepcopy(ops.snapshot)
            bad['unpack']['process']['environment']['PATH']='/usr/bin:/bin'
            with self.assertRaises(reader.Refusal):reader.setup_v8_facts(bad,'123',101,31000000)
            tool=p.SetupV8Tool(['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V8_CONFIGURE_ORDER])
            self.assertEqual(tool.environment['PATH'],'/usr/sbin:/usr/bin:/bin')
            self.assertEqual(p.ENV['PATH'],'/usr/bin:/bin')
            self.assertEqual(raw,reader.canonical(reader.setup_v8_request(raw,sha(raw))[0]))
        def test_distinct_v8_event_and_job_cannot_use_consumed_v4_marker(self):
            request=self.request();raw=reader.canonical(request);pin=sha(raw)
            wrapper=pin
            marker='BW_RING3_SETUP_RUNTIME_INVENTORY_V8'
            body='<!-- '+marker+'\n'+wrapper+'\n'+marker+' -->'
            event={'action':'labeled','label':{'name':'x86-ring3-setup-runtime-inventory-v8'},
                'repository':{'full_name':'CrispStrobe/bw-board'},'sender':{'login':'CrispStrobe'},
                'number':645,'pull_request':{'number':645,'state':'open','body':body,
                    'head':{'sha':request['head'],'repo':{'full_name':'CrispStrobe/bw-board','fork':False}},
                    'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}}
            env={'BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256':pin,
                'BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64':base64.b64encode(raw).decode('ascii'),'GITHUB_RUN_ID':'123',
                'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
                'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe',
                'GITHUB_JOB':'setup-runtime-inventory-v8','BW_EXPECTED_HEAD':request['head'],
                'BW_EXPECTED_TREE':request['tree'],'GITHUB_WORKFLOW_SHA':'c'*40,
                'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge'}
            wire=reader.canonical(event)
            with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                self.assertEqual(p.admit_setup_v8_event(wire,env)[1],request)
            reader.setup_v8_event(wire,request,pin,env)
            for bad_event,bad_env in ((dict(event,label={'name':'x86-ring3-setup-runtime-inventory-v1'}),env),
                                      (dict(event,pull_request=dict(event['pull_request'],
                                          body=body.replace('V8','V4'))),env),
                                      (event,dict(env,GITHUB_JOB='setup-runtime-inventory')),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256='0'*64)),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64='!')),
                                      (event,dict(env,BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64=
                                                  base64.b64encode(b'{}').decode('ascii')))):

                with patch.object(p,'expected_cgroup',return_value=Path('/unused')):
                    with self.assertRaises((ValueError,reader.Refusal)):
                        p.admit_setup_v8_event(reader.canonical(bad_event),bad_env)
                with self.assertRaises(reader.Refusal):
                    reader.setup_v8_event(reader.canonical(bad_event),request,pin,bad_env)
        def test_new_child_profile_still_binds_role_and_terminal(self):
            class Child:
                role='setup-v8'
                environment=dict(p.SETUP_V8_INSTALLER_ENV)
                def __init__(self):self.clock=0
                def now(self):self.clock+=1000;return self.clock
                def spawn(self):return {'pid':201,'pgid':201,'parentPid':101,'startTicks':7}
                def read_available(self,timeout):return []
                def reap(self):return {'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                    'rusage':{'userSeconds':0.0,'systemSeconds':0.0,'maxRssKiB':1}}
                def close(self):pass
                def kill(self):raise AssertionError('no kill of completed child')
            argv=['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V8_CONFIGURE_ORDER]
            process,streams=p.collect_child(Child(),'setup-v8',argv,profile='setup-v8')
            self.assertIsNone(process['firstFailure']);self.assertEqual(process['environment'],p.SETUP_V8_INSTALLER_ENV)
            self.assertEqual(streams,{'stdout':b'','stderr':b''})
            with self.assertRaises(ValueError):p.collect_child(Child(),'setup-v4',argv,profile='setup-v8')
        def test_named_held_helper_readback_and_primary_close_failure(self):
            path='/usr/sbin/ldconfig.real';body=b'pure fixture only'
            named=SimpleNamespace(st_dev=1,st_ino=2,st_mode=0o100755,st_uid=0,st_gid=0,
                st_nlink=1,st_size=len(body),st_mtime_ns=3)
            changed=SimpleNamespace(**dict(vars(named),st_ino=99))
            with patch.object(p,'SETUP_V8_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V8_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                row=p.setup_v8_helper_witness(path,sha(body))
                self.assertTrue(row['closeSucceeded']);self.assertEqual(row['bytesRead'],len(body))
                self.assertEqual(row['namedBefore'],row['heldAfter']);closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V8_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V8_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',side_effect=[named,changed]),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=[body,b'']),\
                 patch.object(p.os,'close') as closed:
                with self.assertRaisesRegex(ValueError,'closed selected helper identity') as caught:
                    p.setup_v8_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_partial['witness']['namedAfter'][1],99)
                closed.assert_called_once_with(77)
            with patch.object(p,'SETUP_V8_HELPERS',{path:sha(body)}),\
                 patch.object(p,'SETUP_V8_NEW_HELPER_BYTES',{path:len(body)}),\
                 patch.object(Path,'lstat',return_value=named),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=named),\
                 patch.object(p.os,'read',side_effect=OSError('FIRST_HELPER_READ')),\
                 patch.object(p.os,'close',side_effect=OSError('SECOND_HELPER_CLOSE')):
                with self.assertRaisesRegex(OSError,'FIRST_HELPER_READ') as caught:
                    p.setup_v8_helper_witness(path,sha(body))
                self.assertEqual(caught.exception.ring3_secondary[0]['message'],'SECOND_HELPER_CLOSE')
                self.assertTrue(caught.exception.ring3_partial['witness']['closeAttempted'])
        def test_five_real_listing_children_and_independent_nonroot_union(self):
            files,old_probe=runtime_fixture()
            node=files.facts.pop(reader.RUNTIME_NODE)
            files.facts[reader.NODE_STAGE_TARGET]=dict(node,mode=0o555)
            files.prefixes[reader.NODE_STAGE_TARGET]=files.prefixes.pop(reader.RUNTIME_NODE)
            files.rejected={}
            empty=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES))
            original_python_files=files.python_files
            files.python_files=lambda:sorted(original_python_files()+[empty])
            files.fact(reader.NODE_STAGE_TARGET)
            stage=files.metadata[reader.NODE_STAGE_TARGET]
            listings={
                'qemu-system-x86':[reader.RUNTIME_QEMU,reader.RUNTIME_TCG,
                                   '/usr/share/qemu/bios.bin'],
                'qemu-system-common':['/usr/share/qemu/common-keymap'],
                'qemu-system-data':['/usr/share/qemu/data-blob',*reader.SETUP_V8_SIGNED_DATA],
                'seabios':['/usr/share/seabios/bios.bin'],
                'ipxe-qemu':['/usr/share/ipxe/rom.bin']}
            for signed_path,signed_pin in reader.SETUP_V8_SIGNED_DATA.items():
                files.facts[signed_path]=dict(signed_pin)
                files.prefixes[signed_path]=b'inert signed DATA mock'
            observed=[]
            def probe(argv):
                process,streams=old_probe(argv)
                if argv==[reader.NODE_STAGE_TARGET,'--version']:
                    streams['stdout']=b'v22.23.3\n'
                if argv[:2]==['/usr/bin/dpkg-query','-W']:
                    selected={name:(version,arch) for name,version,arch,*_ in
                              reader.SETUP_V8_PACKAGES if name in reader.PACKAGE_NAMES}
                    streams['stdout']=''.join(name+'\t'+selected[name][0]+'\t'+
                        selected[name][1]+'\n' for name in reader.PACKAGE_NAMES).encode()
                if argv[:2]==['/usr/bin/dpkg-query','-L']:
                    self.assertEqual(len(argv),3)
                    name=argv[2];observed.append(name)
                    streams['stdout']=('/.\n'+'\n'.join(listings[name])+'\n').encode()
                return process,streams
            inventory=reader.SetupV8Inventory(stage,files,probe)
            raw=inventory.discover_core()
            candidate=reader.setup_v8_runtime_expectation(raw,sha(raw))
            self.assertEqual(set(reader.SETUP_V8_SIGNED_DATA),
                             set(candidate['packagePathsByPackage']['qemu-system-data']) &
                             set(reader.SETUP_V8_SIGNED_DATA))
            for signed_path in reader.SETUP_V8_SIGNED_DATA:
                with self.assertRaises(reader.Refusal):reader.runtime_path(signed_path)
                with self.assertRaises(reader.Refusal):
                    reader.setup_v7_listed_paths(('/.\n'+signed_path+'\n').encode())
                with self.assertRaises(reader.Refusal):
                    reader.setup_v8_listed_paths(('/.\n'+signed_path+'\n').encode(),
                                                 'qemu-system-common')
            for bad_name in ('/usr/share/qemu/QEMU,other.bin',
                             '/usr/share/qemu/qemu,VGA.bin',
                             '/usr/share/qemu/../qemu/QEMU,VGA.bin'):
                with self.assertRaises(reader.Refusal):
                    reader.setup_v8_listed_paths(('/.\n'+bad_name+'\n').encode(),
                                                 'qemu-system-data')
            for path in reader.SETUP_V8_SIGNED_DATA:
                for field,replacement in (('bytes',1),('sha256','0'*64),('mode',0o666),
                                          ('kind','shared-library')):
                    changed=copy.deepcopy(candidate)
                    changed['files'][path][field]=replacement
                    changed_raw=reader.canonical(changed)
                    with self.subTest(path=path,field=field),self.assertRaises(reader.Refusal):
                        reader.setup_v8_runtime_expectation(changed_raw,sha(changed_raw))
                changed=copy.deepcopy(candidate)
                changed['packagePathsByPackage']['qemu-system-data'].remove(path)
                changed_raw=reader.canonical(changed)
                with self.assertRaises(reader.Refusal):
                    reader.setup_v8_runtime_expectation(changed_raw,sha(changed_raw))
            changed=copy.deepcopy(candidate)
            changed['aliases']['/usr/share/qemu/QEMU,VGA.bin']={
                'linkText':'other','target':'/usr/share/qemu/other'}
            changed_raw=reader.canonical(changed)
            with self.assertRaises(reader.Refusal):
                reader.setup_v8_runtime_expectation(changed_raw,sha(changed_raw))
            self.assertEqual(observed,list(reader.PACKAGE_NAMES))
            self.assertEqual(len(inventory.processes),15)
            self.assertEqual(candidate['packagePathsByPackage'],
                             {name:sorted(paths) for name,paths in listings.items()})
            self.assertEqual(candidate['packagePaths'],
                             sorted({path for rows in listings.values() for path in rows}))
            self.assertNotIn('/.',candidate['packagePaths'])
            self.assertEqual(reader.setup_v8_listed_paths(b'/.\n/usr/bin/tool\n\n','qemu-system-x86'),
                             ['/usr/bin/tool'])
            self.assertEqual(reader.setup_v8_producer_listing('/.\n/usr/bin/tool\n\n','qemu-system-x86'),
                             ['/usr/bin/tool'])
            qemu=next(row for row in candidate['packages'] if row['name']=='qemu-system-x86')
            original={'schema':'bw.ring3.runtime.v8',
                'observationPolicy':'prelaunch-probes-and-before-after-file-readback',
                'platform':candidate['platform'],'executables':candidate['executables'],
                'versions':candidate['versions'],'qemuPackage':{
                    'name':qemu['name'],'version':qemu['version'],
                    'architecture':qemu['architecture'],'aliases':candidate['aliases'],
                    'files':{path:{key:row[key] for key in ('bytes','sha256','kind')}
                             for path,row in candidate['files'].items()},
                    'probes':inventory.probes}}
            reader.verify_setup_v8_stable_original(original,raw,sha(raw))
            signed_path='/usr/share/qemu/QEMU,VGA.bin'
            prior_fact=files.facts[signed_path]
            files.facts[signed_path]=dict(prior_fact,sha256='0'*64)
            try:
                with self.assertRaises(reader.Refusal):
                    reader.SetupV8Inventory(stage,files,probe).discover_core()
            finally:files.facts[signed_path]=prior_fact
            files.aliases[signed_path]={'linkText':'other','target':'/usr/share/qemu/other'}
            try:
                with self.assertRaises(reader.Refusal):
                    reader.SetupV8Inventory(stage,files,probe).discover_core()
            finally:del files.aliases[signed_path]
            wrong_version=copy.deepcopy(candidate)
            next(item for item in wrong_version['packages']
                 if item['name']=='qemu-system-data')['version']='1:8.2.2+ds-0ubuntu1.19'
            wrong_original=copy.deepcopy(original)
            version_probe=next(item for item in wrong_original['qemuPackage']['probes']
                               if item['role']=='package-version')
            old_stdout=version_probe['stdout']
            version_probe['stdout']=version_probe['stdout'].replace(
                'qemu-system-data\t1:8.2.2+ds-0ubuntu1.18\t',
                'qemu-system-data\t1:8.2.2+ds-0ubuntu1.19\t')
            self.assertNotEqual(version_probe['stdout'],old_stdout)
            wrong_raw=reader.canonical(wrong_version)
            with self.assertRaises(reader.Refusal):
                reader.verify_setup_v8_stable_original(wrong_original,
                                                       wrong_raw,sha(wrong_raw))
            def wrong_probe(argv):
                process,streams=probe(argv)
                if argv[:2]==['/usr/bin/dpkg-query','-W']:
                    streams['stdout']=streams['stdout'].replace(
                        b'qemu-system-data\t1:8.2.2+ds-0ubuntu1.18\t',
                        b'qemu-system-data\t1:8.2.2+ds-0ubuntu1.19\t')
                return process,streams
            with self.assertRaises(reader.Refusal):
                reader.SetupV8Inventory(stage,files,wrong_probe).discover_core()
            empty_info=[1,777,0o100644,0,0,1,0,1700000000000000000]
            empty_original={'path':empty,'namedBefore':empty_info,
                'heldBefore':empty_info,'heldAfter':empty_info,
                'namedAfter':empty_info,'bytesRead':0,'readHex':'',
                'eof':True,'sha256':reader.STAGED_EMPTY_PYTHON_SOURCES[empty]['sha256'],
                'closeAttempted':True,'closeSucceeded':True,
                'firstFailure':None,'secondary':[]}
            inventory.partial['emptyPythonSources']={
                'before':copy.deepcopy(empty_original),
                'after':copy.deepcopy(empty_original)}
            snapshot={'candidate':{'bytes':len(raw),'sha256':sha(raw),
                       'base64':base64.b64encode(raw).decode()},
                      'inventory':copy.deepcopy(inventory.partial)}
            reader.verify_setup_v8_inventory_graph(snapshot)
            reordered=copy.deepcopy(snapshot)
            for key in ('probes','processes'):
                rows=reordered['inventory'][key]
                rows[6],rows[7]=rows[7],rows[6]
            for index,entry in enumerate(reordered['inventory']['processes']):
                process=entry['process']
                process['pid']=process['pgid']=201+index
                process['startTicks']=index+1
                process['spawnMonoNs']=100+index*10
                process['reapMonoNs']=101+index*10
            with self.assertRaises(reader.Refusal):
                reader.verify_setup_v8_inventory_graph(reordered)
            for mutant in (b'/usr/bin/tool\n',b'/.\n/usr/bin/tool',
                           b'/.\n/usr/bin/../tool\n',b'/.\n/usr/bin/tool\n\n\n',
                           b'/.\n/usr/bin/tool\n/./x\n',b'/.\n/usr/bin/tool\r\n'):
                with self.subTest(mutant=mutant),self.assertRaises(reader.Refusal):
                    reader.setup_v8_listed_paths(mutant,'qemu-system-x86')
            bad=copy.deepcopy(original)
            row=next(p for p in bad['qemuPackage']['probes'] if p['role']=='package-files-qemu-system-common')
            row['stdout']='/.\n/usr/share/qemu/other\n'
            with self.assertRaises(reader.Refusal):
                reader.verify_setup_v8_stable_original(bad,raw,sha(raw))
        def test_selected_data_exact_regular_extent_precedes_byte_read(self):
            for path,pin in reader.SETUP_V8_SIGNED_DATA.items():
                for changed in ('bytes','mode','owner'):
                    row={'st_dev':1,'st_ino':2,'st_mode':stat.S_IFREG|pin['mode'],
                        'st_uid':0,'st_gid':0,'st_nlink':1,'st_size':pin['bytes'],'st_mtime_ns':3}
                    if changed=='bytes':row['st_size']+=1
                    elif changed=='mode':row['st_mode']=stat.S_IFREG|0o600
                    else:row['st_uid']=1001
                    info=SimpleNamespace(**row)
                    with self.subTest(path=path,changed=changed),\
                         patch.object(Path,'resolve',return_value=Path(path)),\
                         patch.object(reader.os,'stat',return_value=info),\
                         patch.object(reader.os,'open',return_value=77),\
                         patch.object(reader.os,'fstat',return_value=info),\
                         patch.object(reader.os,'read',side_effect=AssertionError('no bytes before exact extent')),\
                         patch.object(reader.os,'close') as closed:
                        with self.assertRaises(reader.Refusal):reader.SetupV8Files().fact(path)
                        closed.assert_called_once_with(77)
        def test_three_selected_data_real_byte_hash_readback_and_faults(self):
            production=copy.deepcopy(reader.SETUP_V8_SIGNED_DATA)
            bodies={path:('inert authored '+str(index)+' '+path).encode()
                    for index,path in enumerate(production)}
            pins={path:{'bytes':len(body),'sha256':sha(body),'mode':0o644}
                  for path,body in bodies.items()}
            path_list=list(bodies)
            selected={'path':None,'offset':0,'reads':0,'stats':0,'closed':[],'fault':None}
            def metadata(path):
                name=str(path)
                if name in bodies:
                    index=path_list.index(name)
                    value={'st_dev':1,'st_ino':100+index,'st_mode':0o100644,'st_uid':0,
                        'st_gid':0,'st_nlink':1,'st_size':len(bodies[name]),'st_mtime_ns':3}
                    if selected['fault']=='drift' and selected['stats']>1 and name==selected['path']:
                        value['st_ino']+=1
                    return SimpleNamespace(**value)
                return SimpleNamespace(st_dev=1,st_ino=1,st_mode=0o40755,st_uid=0,
                    st_gid=0,st_nlink=1,st_size=0,st_mtime_ns=3)
            def opened(path,flags):
                self.assertIn(str(path),bodies)
                self.assertTrue(flags&reader.os.O_NOFOLLOW)
                selected.update(path=str(path),offset=0,reads=0,stats=0)
                return 77
            def fstat(fd):
                self.assertEqual(fd,77);selected['stats']+=1
                return metadata(selected['path'])
            def read(fd,cap):
                self.assertEqual(fd,77);selected['reads']+=1
                if selected['fault']=='read':raise OSError('FIRST_DATA_READ')
                body=bodies[selected['path']]
                at=selected['offset'];part=body[at:at+cap];selected['offset']+=len(part)
                return part
            def closed(fd):
                selected['closed'].append(fd)
                if selected['fault']=='close':raise OSError('FIRST_DATA_CLOSE')
            with patch.object(reader,'SETUP_V8_SIGNED_DATA',pins),\
                 patch.object(Path,'resolve',lambda path,**kw:path),\
                 patch.object(reader.os,'lstat',side_effect=metadata),\
                 patch.object(reader.os,'stat',side_effect=lambda path,**kw:metadata(path)),\
                 patch.object(reader.os,'open',side_effect=opened),\
                 patch.object(reader.os,'fstat',side_effect=fstat),\
                 patch.object(reader.os,'read',side_effect=read),\
                 patch.object(reader.os,'close',side_effect=closed):
                files=reader.SetupV8Files()
                inventory=reader.SetupV8Inventory([1,7,0o100555,0,0,1,9,3],files,lambda argv:None)
                inventory.package_listings={'qemu-system-data':list(path_list)}
                for path in path_list:
                    selected['closed']=[];self.assertEqual(inventory.add(path,'qemu-data'),path)
                    self.assertEqual(inventory.files[path]['sha256'],pins[path]['sha256'])
                    self.assertEqual(selected['closed'],[77])
                    self.assertEqual(files.metadata[path][3:7],[0,0,1,len(bodies[path])])
                for fault in ('wrong-byte','drift','read','close'):
                    path=path_list[0];selected['closed']=[];selected['fault']=fault
                    old=bodies[path]
                    if fault=='wrong-byte':bodies[path]=bytes([old[0]^1])+old[1:]
                    fresh=reader.SetupV8Inventory([1,7,0o100555,0,0,1,9,3],reader.SetupV8Files(),lambda argv:None)
                    fresh.package_listings={'qemu-system-data':list(path_list)}
                    with self.subTest(fault=fault),self.assertRaises((reader.Refusal,OSError)):
                        fresh.add(path,'qemu-data')
                    self.assertEqual(selected['closed'],[77])
                    bodies[path]=old
                    selected['fault']=None
                selected['closed']=[]
                with patch.object(files,'resolve',return_value=('/usr/share/qemu/other',
                        {'/usr/share/qemu':{'linkText':'other','target':'/usr/share/qemu/other'}})):
                    fresh=reader.SetupV8Inventory([1,7,0o100555,0,0,1,9,3],files,lambda argv:None)
                    fresh.package_listings={'qemu-system-data':list(path_list)}
                    with self.assertRaises(reader.Refusal):fresh.add(path_list[0],'qemu-data')
                self.assertEqual(selected['closed'],[])
            self.assertEqual(reader.SETUP_V8_SIGNED_DATA,production)
        def test_complete_failed_v8_inventory_packet_retains_clipped_last_child(self):
            def held(raw):
                return {'bytes':len(raw),'sha256':sha(raw),
                        'base64':base64.b64encode(raw).decode()}
            def row(name,version,arch='amd64'):
                return ('Package: '+name+'\nVersion: '+version+'\nArchitecture: '+arch+
                        '\nStatus: install ok installed').encode()
            baseline=[row('installed-'+str(i).zfill(4),'1') for i in range(1210)]
            baseline.append(row('libc-bin','2'))
            pre=b'\n\n'.join(baseline)+b'\n'
            post=b'\n\n'.join(baseline+[row(name,version,arch)
                for name,version,arch,*_ in p.SETUP_V8_PACKAGE_ROWS])+b'\n'
            log=io.BytesIO()
            pre_meta=p.emit_setup_v8_status('pre',pre,log.write,log.flush)
            post_meta=p.emit_setup_v8_status('post',post,log.write,log.flush)
            request=self.request()
            request_raw=reader.canonical(request)
            event_raw=b'{"syntheticEvent":true}\n'
            source=reader.parse(reader.prerequisite_original(reader.canonical(request['source'])))
            workflow_pin=source['files'][reader.WORKFLOW]['sha256']
            image={'ImageOS':{'present':True,'value':'ubuntu24'},
                   'ImageVersion':{'present':True,'value':'20261012.334.1'}}
            record={'request':held(request_raw),'event':held(event_raw),
                    'setup':{'preflight':{'statusOriginal':pre_meta,
                        'statusRecords':1211,'imageFields':image},
                        'postStatus':{'statusOriginal':post_meta,'records':1226}}}
            first={'phase':'inventory-stream','name':'Refusal',
                   'message':'inventory original stdout stream cap'}
            aliases={'/usr/bin/python3':{'linkText':'python3.12',
                     'target':'/usr/bin/python3.12'}}
            roles=['ldd-shell','ldd-dpkg-query','ldd-node','ldd-python',
                   'ldd-qemu','package-version','package-files-qemu-system-x86']
            env={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
            argvs=[['/usr/bin/ldd','/usr/bin/bash'],
                   ['/usr/bin/ldd','/usr/bin/dpkg-query'],
                   ['/usr/bin/ldd',reader.NODE_STAGE_TARGET],
                   ['/usr/bin/ldd','/usr/bin/python3.12'],
                   ['/usr/bin/ldd',reader.RUNTIME_QEMU],
                   ['/usr/bin/dpkg-query','-W',
                    '-f=${Package}\t${Version}\t${Architecture}\n',
                    *reader.PACKAGE_NAMES],
                   ['/usr/bin/dpkg-query','-L','qemu-system-x86']]
            processes=[];probes=[]
            for index,(role,argv) in enumerate(zip(roles,argvs)):
                stdout=b'X'*16384 if index==6 else b'prior mock output\n'
                process={'schema':'bw.ring3.inventory-process.v1','argv':argv,
                    'environment':env,'pid':201+index,'pgid':201+index,
                    'parentPid':101,'startTicks':index+1,
                    'spawnMonoNs':100+index*10,'reapMonoNs':101+index*10,
                    'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                    'rusage':{'userSeconds':0,'systemSeconds':0,'maxRssKiB':0},
                    'firstFailure':first if index==6 else None,'secondary':[]}
                processes.append({'role':role,'process':process,
                    'stdout':held(stdout),'stderr':held(b'')})
                probes.append({'role':role,'argv':argv,'environment':env,
                    'exitCode':0,'stdout':stdout.decode(),'stderr':''})
            stage={'identity':{'pid':101},'record':held(b'stage'),
                   'files':{},'directories':[],'source':source}
            value={'schema':'bw.ring3.setup-runtime-inventory-original.v8',
                'stageBefore':stage,'stageAfter':copy.deepcopy(stage),
                'parent':None,'inventory':{'aliases':aliases,'files':{},
                    'probes':probes,'processes':processes,'fileMetadata':{},
                    'pythonFiles':[],'mappedLibraries':[],'mapsOriginal':None,
                    'emptyPythonSources':{}},'candidate':None,
                'firstFailure':first,'secondary':[],'publicationSafe':True,
                'actualGuestApproved':False,'completeHostConfiguration':False}
            originals={'setup.request.json':request_raw,
                'setup.event.json':event_raw,
                'runtime.setup-inventory.json':reader.canonical(value)}
            reader.emit_setup_v8_inventory(originals,log.write,log.flush)
            raw=log.getvalue()
            class Observer:
                def __init__(self,environ):self.facts={'source':source}
                def event(self):return event_raw
                def source(self,selected):self.facts['source']=source
            outside=io.BytesIO()
            outside_env={'GITHUB_RUN_ID':'123','BW_SYSTEMD_RUN_EXIT_CODE':'1',
                'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree']}
            absent={'terminal':'absent','cgroupProcs':None,
                'cgroupEvents':None,'cgroupStat':None}
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',Observer),\
                 patch.object(p,'admit_setup_v8_event',return_value=(request_raw,request)),\
                 patch.object(p,'setup_v8_owned_unit',return_value=False),\
                 patch.object(p,'setup_v8_outside_census',return_value=absent),\
                 patch.object(Path,'exists',return_value=False),\
                 patch.object(Path,'is_symlink',return_value=False),\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=outside)):
                self.assertEqual(p.setup_v8_outside_cleanup(outside_env),1)
            cleanup_raw=outside.getvalue();cleanup=reader.parse(cleanup_raw)
            self.assertEqual(cleanup['firstFailure']['phase'],'v8-outer-client')
            self.assertEqual(cleanup['action'],'not-needed')
            outer={'schema':'bw.ring3.setup-outer-terminal.v8','runId':'123',
                'unit':'/sys/fs/cgroup/system.slice/bw-ring3-setup-v8-123-1.service',
                'systemdRunExitCode':1,'outsideCleanupExitCode':1,
                'cgroupAfter':'absent'}
            outer_raw=reader.canonical(outer)
            shell={'fields':image}
            shell_raw=reader.canonical({'schema':'bw.ring3.setup-image-shell.v8',
                'fields':image,'fieldErrors':[],'setupAttempted':False,
                'guestAttempted':False,'setupApproved':False})
            external={'schema':'bw.ring3.setup-inventory-expectation.v8',
                'requestSha256':sha(request_raw),'runId':'123','attempt':1,
                'head':request['head'],'tree':request['tree'],
                'workflowSha':'e'*40,'workflowFileSha256':workflow_pin,
                'jobId':456,'jobName':'setup-runtime-inventory-v8',
                'conclusion':'failure','logBytes':len(raw),'logSha256':sha(raw),
                'outerBytes':len(outer_raw),'outerSha256':sha(outer_raw),
                'cleanupBytes':len(cleanup_raw),'cleanupSha256':sha(cleanup_raw),
                'shellBytes':len(shell_raw),'shellSha256':sha(shell_raw),
                'invoker':[1001,1002]}
            reader.setup_v8_cleanup_original(cleanup_raw,external)
            with patch.object(reader,'verify_setup_v8_stage_observation',
                              return_value=(request,source,record)):
                verdict=reader.verify_setup_v8_failure_log(
                    raw,external,outer_raw,cleanup_raw,shell_raw)
                self.assertTrue(verdict['completeFailedInventoryOriginal'])
                self.assertFalse(verdict['candidateReviewed'])
                self.assertFalse(verdict['setupObserved'])
                self.assertEqual(verdict['lastStdoutPrefixBytes'],16384)
                bad=copy.deepcopy(value)
                bad['inventory']['probes'][-1]['argv']=[
                    '/usr/bin/dpkg-query','-L','qemu-system-common']
                changed=dict(originals,**{'runtime.setup-inventory.json':reader.canonical(bad)})
                log2=io.BytesIO();log2.write(raw[:raw.index(reader.SETUP_V8_LOG_MARKER)])
                reader.emit_setup_v8_inventory(changed,log2.write,log2.flush)
                with self.assertRaises(reader.Refusal):
                    changed_raw=log2.getvalue()
                    changed_external=dict(external,logBytes=len(changed_raw),
                                          logSha256=sha(changed_raw))
                    reader.verify_setup_v8_failure_log(
                        changed_raw,changed_external,outer_raw,cleanup_raw,shell_raw)
    if export_sample:
        request=Tests().request();ops=FakeOps();facts=p.setup_v8_sequence(ops,request)
        assert facts['firstFailure'] is None and ops.snapshot is not None
        return copy.deepcopy(ops.snapshot),copy.deepcopy(witness)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure v8 setup controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'dpkg':False,
        'guest':False,'actualRunApproved':False,'pass':True}))


def image_env_diagnostic_controls():
    """Pure event/source/wire controls; all hosted APIs are mocked."""
    p,_=producer_fixture_case()
    source={'schema':'bw.ring3.source.v1','head':'a'*40,'tree':'b'*40,
        'files':{name:{'mode':'100644','blob':'c'*40,'bytes':1,'sha256':'d'*64}
                 for name in p.SOURCE_PATHS}}
    request={'schema':'bw.ring3.image-env-request.v1','repository':'CrispStrobe/bw-board',
        'pullRequest':645,'head':'a'*40,'tree':'b'*40,'source':p.original_bytes(p.encode(source))}
    raw=p.encode(request);pin=p.sha(raw)
    event={'action':'labeled','label':{'name':p.IMAGE_ENV_DIAGNOSTIC_LABEL},
        'repository':{'full_name':'CrispStrobe/bw-board'},'sender':{'login':'CrispStrobe'},
        'number':645,'pull_request':{'number':645,'state':'open','body':
            '<!-- BW_RING3_IMAGE_ENV_DIAGNOSTIC_V1\n'+pin+'\nBW_RING3_IMAGE_ENV_DIAGNOSTIC_V1 -->',
            'head':{'sha':'a'*40,'repo':{'full_name':'CrispStrobe/bw-board','fork':False}},
            'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}}
    event_raw=p.encode(event)
    git_environment={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
                     'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'}
    git=['/usr/bin/git','-c','safe.directory=/checkout','--no-replace-objects',
         '-c','gc.auto=0','-c','maintenance.auto=false']
    git_tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],
               ['ls-tree','-r','HEAD','--',*sorted(p.SOURCE_PATHS)]]
    git_outputs=[b'a'*40+b'\n',b'b'*40+b'\n',
        ''.join(source['files'][name]['mode']+' blob '+source['files'][name]['blob']+'\t'+name+'\n'
                for name in sorted(p.SOURCE_PATHS)).encode()]
    def source_commands():
        result=[]
        for index,(tail,output) in enumerate(zip(git_tails,git_outputs)):
            argv=git+tail;pid=201+index;start=1+2*index;end=start+1
            process={'schema':'bw.ring3.process.v1','role':'discovery','argv':argv,
                'cwdRole':'checkout','environment':git_environment,'pid':pid,'pgid':pid,
                'parentPid':100,'startTicks':pid,'spawnMonoNs':start,'reapMonoNs':end,
                'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0.001,'systemSeconds':0.001,'maxRssKiB':1024},
                'firstFailure':None,'secondary':[]}
            result.append({'argv':argv,'process':process,'stdout':p.original_bytes(output),
                           'stderr':None})
        return result
    env={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
        'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe',
        'GITHUB_JOB':p.IMAGE_ENV_DIAGNOSTIC_JOB,'GITHUB_WORKFLOW_SHA':'e'*40,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge',
        'BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40,p.IMAGE_ENV_DIAGNOSTIC_PIN:pin,
        p.IMAGE_ENV_DIAGNOSTIC_B64:base64.b64encode(raw).decode('ascii'),
        'ImageOS':'ubuntu24','ImageVersion':'20261012.334.1'}
    class FakeObserver:
        def __init__(self,environ):
            self.facts={'eventIdentity':{'st_dev':1,'st_ino':2,'st_mode':stat.S_IFREG|0o600,
                'st_uid':1001,'st_gid':1001,'st_nlink':1,'st_size':len(event_raw),'st_mtime_ns':1},
                'sourceCommands':[]}
        def event(self):return event_raw
        def source(self,request):
            self.facts['source']=source
            self.facts['sourceCommands']=source_commands()
    def cgroup(_,path):
        if str(path)=='/proc/self/cgroup':return '0::/system.slice/bw-ring3-image-env-123-1.service\n'
        return {'cpu.max':'100000 100000','memory.max':'1073741824',
                'memory.swap.max':'0','pids.max':'64'}[Path(path).name]+'\n'
    external={'schema':'bw.ring3.image-env-expectation.v1','runId':'123','attempt':'1',
        'head':'a'*40,'tree':'b'*40,'requestSha256':pin,'workflowSha':'e'*40,
        'jobName':p.IMAGE_ENV_DIAGNOSTIC_JOB,'conclusion':'success'}
    outside={'schema':'bw.ring3.image-env-outside.v1','runId':'123',
        'unit':'/sys/fs/cgroup/system.slice/bw-ring3-image-env-123-1.service',
        'shellExitCode':0,'serviceExitCode':0,'cgroupAfter':'absent','cleanupAction':'none'}
    def captured(fields=None,ev=None):
        if fields is None:fields=env
        with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
             patch.object(p.os,'getresgid',return_value=(0,0,0)),\
             patch.object(p.Cgroups,'text',side_effect=cgroup),\
             patch.object(p,'setup_v5_sequence',side_effect=AssertionError('setup forbidden')),\
             patch.object(p,'setup_v5_helper_witness',side_effect=AssertionError('helper forbidden')):
            return p.image_env_service_original(fields,FakeObserver)
    class Tests(unittest.TestCase):
        def test_full_entry_and_independent_reader(self):
            shell=p.image_env_shell_original(env);service=captured()
            self.assertIsNone(service['firstFailure']);self.assertEqual(service['source'],source)
            self.assertEqual(service['fields'],shell['fields'])
            self.assertFalse(service['setupAttempted']);self.assertFalse(service['guestAttempted'])
            grade=reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(service),
                                           reader.canonical(outside),external)
            self.assertTrue(grade['reportedConsistent']);self.assertTrue(grade['serviceMatchesPinnedImage'])
            self.assertFalse(grade['officialJobAuthenticated']);self.assertFalse(grade['setupApproved'])
        def test_different_empty_missing_are_data(self):
            for change in ('different','empty','missing'):
                current=dict(env)
                if change=='different':current['ImageOS']='different'
                elif change=='empty':current['ImageOS']=''
                else:current.pop('ImageOS')
                shell=p.image_env_shell_original(current)
                forwarded=dict(current)
                if change=='missing':forwarded['ImageOS']=''
                service=captured(forwarded)
                grade=reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(service),
                                               reader.canonical(outside),external)
                self.assertFalse(grade['serviceMatchesPinnedImage'])
                self.assertTrue(grade['reportedConsistent']);self.assertTrue(grade['forwardingMatchesExpected'])
                self.assertTrue(grade['serviceFields']['ImageOS']['present'])
                if change=='missing':self.assertEqual(grade['serviceFields']['ImageOS']['value'],'')
        def test_wrong_source_event_and_context_refuse(self):
            shell=p.image_env_shell_original(env);service=captured()
            for key,value in (('source',{}),('event',p.original_bytes(p.encode(dict(event,number=646)))),
                              ('platform',dict(service['platform'],GITHUB_RUN_ID='124'))):
                bad=copy.deepcopy(service);bad[key]=value
                with self.assertRaises(Exception):
                    reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(bad),
                                             reader.canonical(outside),external)
            for change in ('argv','stdout','exit','order','eventExtent'):
                bad=copy.deepcopy(service)
                if change=='argv':bad['sourceCommands'][0]['argv'][-1]='different'
                elif change=='stdout':bad['sourceCommands'][0]['stdout']['sha256']='0'*64
                elif change=='exit':bad['sourceCommands'][0]['process']['exitCode']=1
                elif change=='order':bad['sourceCommands'][1]['process']['spawnMonoNs']=1
                else:bad['eventIdentity']['st_size']+=1
                with self.assertRaises(Exception):
                    reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(bad),
                                             reader.canonical(outside),external)
            with self.assertRaises(Exception):p.image_env_diagnostic_event(p.encode(dict(event,action='opened')),env)
            with self.assertRaises(Exception):p.image_env_diagnostic_event(event_raw,dict(env,GITHUB_RUN_ATTEMPT='2'))
            for changed in (dict(env,**{p.IMAGE_ENV_DIAGNOSTIC_B64:'AA=='}),
                            dict(env,**{p.IMAGE_ENV_DIAGNOSTIC_B64:env[p.IMAGE_ENV_DIAGNOSTIC_B64]+'='}),
                            dict(env,**{p.IMAGE_ENV_DIAGNOSTIC_PIN:'0'*64})):
                with self.assertRaises(Exception):p.image_env_diagnostic_event(event_raw,changed)
            wrong_event=copy.deepcopy(event)
            wrong_event['pull_request']['body']=wrong_event['pull_request']['body'].replace(pin,'0'*64)
            with self.assertRaises(Exception):p.image_env_diagnostic_event(p.encode(wrong_event),env)
        def test_oversize_malformed_retains_bounded_failure(self):
            bad=dict(env,ImageOS='x'*257)
            shell=p.image_env_shell_original(bad);service=captured(bad)
            self.assertIsNotNone(shell['firstFailure']);self.assertIsNotNone(service['firstFailure'])
            self.assertEqual(service['fields']['ImageOS'],{'present':True,'value':None})
            failed=dict(external,conclusion='failure');outer=dict(outside,shellExitCode=1,serviceExitCode=1)
            grade=reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(service),
                                           reader.canonical(outer),failed)
            self.assertFalse(grade['reportedConsistent']);self.assertFalse(grade['setupApproved'])
            for row in (dict(shell,fields={'ImageOS':{'present':True,'value':'x'*257},
                                                'ImageVersion':shell['fields']['ImageVersion']}),
                        dict(shell,fields={'ImageOS':{'present':1,'value':None},
                                                'ImageVersion':shell['fields']['ImageVersion']})):
                with self.assertRaises(Exception):
                    reader.verify_image_diag(p.encode(row),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(service),
                                             reader.canonical(outer),failed)
        def test_inactive_cli_guard_refuses_both_modes_before_any_host_edge(self):
            self.assertTrue(p.IMAGE_ENV_DIAGNOSTIC_ENABLED)
            for mode in ('--image-env-shell-v1','--image-env-service-v1'):
                with patch.object(p,'IMAGE_ENV_DIAGNOSTIC_ENABLED',False),\
                     patch.object(p,'image_env_shell_original') as shell,\
                     patch.object(p,'image_env_service_original') as service,\
                     patch.object(p,'HostedEnvelopeInstaller') as observer,\
                     patch.object(p,'SetupV5Host') as setup,\
                     patch.object(p.Cgroups,'text') as cgroup,\
                     patch.object(p.sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                    self.assertEqual(p.dispatch_cli([mode],env),1)
                    shell.assert_not_called();service.assert_not_called()
                    observer.assert_not_called();setup.assert_not_called();cgroup.assert_not_called()
            self.assertFalse(reader.verify_image_diag(p.encode(p.image_env_shell_original(env)),
                p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(captured()),reader.canonical(outside),external)['actualGuestApproved'])
        def test_forwarding_difference_and_resource_mutation_visible(self):
            shell=p.image_env_shell_original(env)
            current=dict(env,ImageOS='')
            service=captured(current)
            grade=reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(service),
                                           reader.canonical(outside),external)
            self.assertFalse(grade['shellEqualsService'])
            self.assertFalse(grade['forwardingMatchesExpected']);self.assertFalse(grade['reportedConsistent'])
            self.assertTrue(grade['completeDiagnosticObserved'])
            self.assertFalse(grade['serviceMatchesPinnedImage'])
            missing=copy.deepcopy(service);missing['fields']['ImageOS']={'present':False,'value':None}
            grade=reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(missing),
                                           reader.canonical(outside),external)
            self.assertFalse(grade['forwardingMatchesExpected']);self.assertFalse(grade['reportedConsistent'])
            wrong=copy.deepcopy(service);wrong['resource']['limits']['cpuMax']='max'
            with self.assertRaises(Exception):
                reader.verify_image_diag(p.encode(shell),p.IMAGE_ENV_DIAGNOSTIC_MARKER+p.encode(wrong),
                                         reader.canonical(outside),external)
        def test_workflow_activated_only_for_distinct_owner_event_and_forwards_through_env_i(self):
            workflow=(HERE.parent.parent/'.github/workflows/i80386-ring3-int-iret.yml').read_text()
            route=workflow.split('  image-env-diagnostic-v1:\n',1)[1]
            self.assertIn("if: ${{ true && github.event.action == 'labeled'",route)
            self.assertIn("github.event.label.name == 'x86-ring3-image-env-diagnostic-v1'",route)
            self.assertIn("github.run_attempt == '1'",route)
            self.assertIn("github.event.pull_request.head.repo.full_name == github.repository",route)
            self.assertIn("github.event.pull_request.head.repo.fork == false",route)
            self.assertIn('--image-env-shell-v1',route)
            self.assertIn('/usr/bin/systemd-run --wait --pipe',route)
            self.assertIn('/usr/bin/env -i LANG=C.UTF-8 HOME=/nonexistent PATH=/usr/bin:/bin',route)
            self.assertIn('ImageOS="${ImageOS-}" ImageVersion="${ImageVersion-}"',route)
            self.assertIn('BW_RING3_IMAGE_ENV_DIAGNOSTIC_REQUEST_B64="$BW_RING3_IMAGE_ENV_DIAGNOSTIC_REQUEST_B64"',route)
            self.assertIn('/usr/bin/python3 -I -B scripts/i80386-ring3-int-iret/run.py --image-env-service-v1',route)
            v5=workflow.split('  setup-runtime-inventory-v5:\n',1)[1].split('  image-env-diagnostic-v1:\n',1)[0]
            self.assertIn('/usr/bin/python3 -I -B scripts/i80386-ring3-int-iret/run.py --setup-runtime-inventory-v5',v5)
            self.assertIn('ImageOS="$ImageOS" ImageVersion="$ImageVersion"',v5)
            setup=('      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n'
                   '        with:\n          node-version: 22.23.3\n')
            checkout='      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262'
            for job in (v5,route):
                self.assertEqual(job.count(setup),1)
                self.assertLess(job.index(checkout),job.index(setup))
            self.assertLess(route.index(setup),route.index('      - name: Retain shell and bounded root service image environment only'))
            self.assertNotIn('--setup-runtime-inventory-v5',route)
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
    result=unittest.TextTestRunner(verbosity=1).run(suite)
    assert result.wasSuccessful(),'pure image diagnostic controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,
                      'installer':False,'guest':False,'pass':True}))


def consumed_v6_failure_fixture():
    """Reuse only the existing manufactured fixture, with all host edges inert.

    The producer is imported by the existing pure harness, never by the reader.
    Stop at its first positive-reader call, before that control's mutation loop.
    No official original, executable, kernel operation or guest is a fixture.
    """
    class Captured(BaseException):pass
    snapshot={}
    def capture(*args):
        snapshot.update(args=copy.deepcopy(args),node=copy.deepcopy(reader.RUNTIME_SELECTED['node']),
            status=(reader.SETUP_V6_STATUS_SHA,reader.SETUP_V6_STATUS_BYTES))
        raise Captured()
    def selected(runner,suite):
        case=next(case for case in suite if case._testMethodName=='test_v6_complete_original_shell_and_reader')
        case.test_v6_complete_original_shell_and_reader()
    with patch.object(reader,'verify_setup_v6_log',capture),patch.object(unittest.TextTestRunner,'run',selected),\
         patch.object(subprocess,'Popen',side_effect=AssertionError('no real process')),\
         patch.object(subprocess,'run',side_effect=AssertionError('no real process')),\
         patch.object(subprocess,'check_output',side_effect=AssertionError('no real process')):
        try:staged_runtime_controls()
        except Captured:pass
    assert set(snapshot)=={'args','node','status'},'manufactured v6 fixture captured'
    return snapshot


class ConsumedV6FailureControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.fixture=consumed_v6_failure_fixture()

    def setUp(self):
        self.patches=contextlib.ExitStack();self.addCleanup(self.patches.close)
        self.patches.enter_context(patch.dict(reader.RUNTIME_SELECTED,node=self.fixture['node']))
        self.patches.enter_context(patch.object(reader,'SETUP_V6_STATUS_SHA',self.fixture['status'][0]))
        self.patches.enter_context(patch.object(reader,'SETUP_V6_STATUS_BYTES',self.fixture['status'][1]))
        self.args=list(copy.deepcopy(self.fixture['args']))
        self.originals=reader.decode_setup_v6_log(self.args[0])
        self.packet=reader.parse_setup_v6_outer(self.originals['runtime.setup-inventory.json'])
        self.status_lines=b''.join(line+b'\n' for line in self.args[0].splitlines()
            if reader.SETUP_V6_STATUS_MARKER in line)
        value=self.packet;inventory=value['inventory']
        value['candidate']=None
        value['firstFailure']={'phase':'inventory-stream','name':'Refusal','message':'inventory original stdout stream cap'}
        inventory.pop('candidate');inventory['probes']=inventory['probes'][:7];inventory['processes']=inventory['processes'][:7]
        inventory.update(pythonFiles=[],mappedLibraries=[],mapsOriginal=None,
            emptyPythonSources={'before':inventory['emptyPythonSources']['before']})
        inventory['files']={path:row for path,row in inventory['files'].items() if row['kind'] not in
            ('python-stdlib','qemu-data','tcg-module')}
        inventory['fileMetadata']={path:row for path,row in inventory['fileMetadata'].items() if path in inventory['files']}
        # Root markers, blank package separators and a clipped last line remain
        # opaque bytes. They never become a successful canonical path census.
        prefix=(b'/.\n/usr\n\n/.'+b'/authored'*(16384//9+1))[:16384]
        inventory['probes'][-1]['stdout']=prefix.decode()
        inventory['processes'][-1]['stdout']=self.wrap(prefix)
        inventory['processes'][-1]['process']['firstFailure']=copy.deepcopy(value['firstFailure'])
        self.args[1].update(schema='bw.ring3.consumed-v6-failure-expectation.v1',conclusion='failure',
            clippedStdout={'bytes':len(prefix),'sha256':sha(prefix)},artifactId=789,archiveBytes=12345,archiveSha256='1'*64)
        outer=reader.parse(self.args[2]);outer.update(systemdRunExitCode=1,outsideCleanupExitCode=1);self.set_raw(2,'outer',reader.canonical(outer))
        cleanup=reader.parse(self.args[3]);cleanup.update(serviceExitCode=1,firstFailure=
            {'phase':'v6-outer-client','name':'ValueError','message':'bounded outer setup client exit 1'})
        self.set_raw(3,'cleanup',reader.canonical(cleanup))
        self.refresh()

    @staticmethod
    def wrap(raw):return {'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode()}

    def set_raw(self,index,role,raw):
        self.args[index]=raw;self.args[1].update({role+'Bytes':len(raw),role+'Sha256':sha(raw)})

    def refresh(self):
        self.originals['runtime.setup-inventory.json']=reader.canonical(self.packet)
        out=io.BytesIO();out.write(self.status_lines)
        reader.emit_setup_v6_inventory(self.originals,out.write,out.flush)
        self.set_raw(0,'log',out.getvalue())

    def record_change(self,mutate):
        record=reader.parse(reader.prerequisite_original(reader.canonical(self.packet['stageBefore']['record'])))
        mutate(record);raw=reader.canonical(record)
        for stage in (self.packet['stageBefore'],self.packet['stageAfter']):
            stage['record']=self.wrap(raw);file=stage['files']['installation.original.json']
            file.update(bytes=len(raw),sha256=sha(raw),prefix=raw[:4].hex())
            for key in ('before','after','namedAfter'):file[key][6]=len(raw)
        self.refresh()

    def grade(self):return reader.v6_consumed_failure_audit(*self.args)

    def refused(self):
        self.refresh()
        with self.assertRaises((ValueError,UnicodeError)):self.grade()

    def test_known_negative_retained_with_all_authority_false(self):
        verdict=self.grade()
        self.assertTrue(verdict['failedAttemptRetained']);self.assertTrue(verdict['failurePacketComplete'])
        self.assertEqual(verdict['partialProbeCount'],7)
        for key in ('packageListingComplete','setupObserved','setupApproved','runtimeCandidateApproved',
                    'candidateReviewed','actualGuestApproved','actualRunApproved','completeHostConfiguration',
                    'officialJobAuthenticated','ciArchiveBytesIndependentlyVerified','continuousOwnershipEstablished'):
            self.assertIs(verdict[key],False,key)
        self.assertEqual(verdict['externallySelectedArtifact']['artifactId'],789)

    def test_prefix_changed_even_coherent_internal_and_delivery_hashes_refused(self):
        row=self.packet['inventory']['processes'][-1];raw=reader.prerequisite_original(reader.canonical(row['stdout']))
        changed=b'X'+raw[1:];row['stdout']=self.wrap(changed)
        self.packet['inventory']['probes'][-1]['stdout']=changed.decode()
        self.refused()

    def test_prefix_extent_hash_and_wrapper_mutations_refused(self):
        for mutation in ('short','hash','wrapper'):
            with self.subTest(mutation=mutation):
                original=copy.deepcopy(self.packet)
                if mutation=='short':
                    row=self.packet['inventory']['processes'][-1];raw=b'prefix'
                    row['stdout']=self.wrap(raw);self.packet['inventory']['probes'][-1]['stdout']=raw.decode()
                elif mutation=='hash':self.args[1]['clippedStdout']['sha256']='0'*64
                else:self.packet['inventory']['processes'][-1]['stdout']['bytes']-=1
                self.refused();self.packet=original
                self.args[1]['clippedStdout']=copy.deepcopy(self.fixture_prefix())

    def fixture_prefix(self):
        row=self.packet['inventory']['processes'][-1]['stdout']
        return {key:row[key] for key in ('bytes','sha256')}

    def test_source_workflow_and_external_selection_mismatch(self):
        for key,value in (('head','c'*40),('tree','c'*40),('workflowSha','c'*40),
                          ('workflowFileSha256','0'*64),('requestSha256','0'*64),('jobName','other')):
            with self.subTest(key=key):
                old=self.args[1][key];self.args[1][key]=value
                with self.assertRaises(reader.Refusal):self.grade()
                self.args[1][key]=old
        name=next(iter(self.packet['stageAfter']['source']))
        self.packet['stageAfter']['source'][name]['sha256']='0'*64;self.refused()

    def test_event_body_actor_and_raw_join_refused(self):
        event=reader.parse(self.originals['setup.event.json']);event['sender']['login']='OtherOwner'
        raw=reader.canonical(event);self.originals['setup.event.json']=raw
        cleanup=reader.parse(self.args[3]);cleanup['sourceAdmission']['eventSha256']=sha(raw)
        self.set_raw(3,'cleanup',reader.canonical(cleanup))
        self.record_change(lambda record:record.update(event=self.wrap(raw),
            eventIdentity=dict(record['eventIdentity'],st_size=len(raw))))
        with self.assertRaises(reader.Refusal):self.grade()

    def test_raw_status_baseline_delta_refused_after_all_record_hashes_refreshed(self):
        statuses=reader.decode_setup_v6_status_log(self.args[0])
        changed=statuses['post']['raw'].replace(b'Package: installed-0001\nVersion: 1\n',
            b'Package: installed-0001\nVersion: 2\n')
        self.assertNotEqual(changed,statuses['post']['raw'])
        lines=[];meta=None
        for role,raw in (('pre',statuses['pre']['raw']),('post',changed)):
            packed=reader.zlib.compress(raw,9)
            row={'schema':'bw.ring3.setup-status-original.v6','role':role,'rawBytes':len(raw),
                'rawSha256':sha(raw),'packedBytes':len(packed),'packedSha256':sha(packed),
                'encoding':'zlib+base64','packed':base64.b64encode(packed).decode()}
            lines.append(reader.SETUP_V6_STATUS_MARKER+reader.canonical(row))
            if role=='post':meta={'role':role,'bytes':len(raw),'sha256':sha(raw),
                'packedBytes':len(packed),'packedSha256':sha(packed)}
        self.status_lines=b''.join(lines)
        def change(record):record['setup']['postStatus'].update(sha256=sha(changed),bytes=len(changed),statusOriginal=meta)
        self.record_change(change)
        with self.assertRaises(reader.Refusal):self.grade()

    def test_stage_readback_identity_and_partial_graph_mutations(self):
        for path in ('stage','inode','hash','later','empty-after'):
            with self.subTest(path=path):
                original=copy.deepcopy(self.packet)
                if path=='stage':self.packet['stageAfter']['stageObserved']=False
                elif path=='inode':self.packet['stageAfter']['files']['node']['before'][1]+=1
                elif path=='hash':self.packet['inventory']['files'][reader.NODE_STAGE_TARGET]['sha256']='0'*64
                elif path=='later':self.packet['inventory']['pythonFiles']=['/usr/lib/python3.12/ssl.py']
                else:
                    empty=self.packet['inventory']['emptyPythonSources'];empty['after']=copy.deepcopy(empty['before'])
                self.refused();self.packet=original

    def test_child_order_first_failure_and_terminal_mutations(self):
        for name in ('order','missing','first','secondary','child','parent','wait','window','argv','environment'):
            with self.subTest(name=name):
                old=copy.deepcopy(self.packet);inv=self.packet['inventory'];last=inv['processes'][-1]['process']
                if name=='order':inv['probes'][0],inv['probes'][1]=inv['probes'][1],inv['probes'][0]
                elif name=='missing':inv['probes'].pop();inv['processes'].pop()
                elif name=='first':self.packet['firstFailure']['phase']='inventory-timeout'
                elif name=='secondary':self.packet['secondary']=[copy.deepcopy(self.packet['firstFailure'])]
                elif name=='child':last['firstFailure']=None
                elif name=='parent':last['parentPid']+=1
                elif name=='wait':last['waitStatus']=256
                elif name=='window':last['spawnMonoNs']=0
                elif name=='argv':last['argv']=['/usr/bin/dpkg-query','-L','other']
                else:last['environment']['HOME']='/tmp'
                self.refused();self.packet=old

    def test_outer_cleanup_and_shell_mutations(self):
        for index,role,key,value in ((2,'outer','systemdRunExitCode',124),(2,'outer','outsideCleanupExitCode',0),
             (2,'outer','cgroupAfter','present'),(3,'cleanup','serviceExitCode',0),
             (3,'cleanup','setupApproved',True),(3,'cleanup','action','removed'),
             (3,'cleanup','firstFailure',None),(3,'cleanup','secondary',[{'phase':'unknown'}])):
            with self.subTest(key=key):
                old=self.args[index];row=reader.parse(old);row[key]=value;self.set_raw(index,role,reader.canonical(row))
                with self.assertRaises(reader.Refusal):self.grade()
                self.set_raw(index,role,old)
        row=reader.parse(self.args[4]);row['fields']['ImageVersion']['value']='other'
        self.set_raw(4,'shell',reader.canonical(row))
        with self.assertRaises(reader.Refusal):self.grade()

    def test_success_and_truncated_delivery_cannot_enter_negative_mode(self):
        args=list(copy.deepcopy(self.fixture['args']))
        args[1].update(schema=self.args[1]['schema'],clippedStdout=self.args[1]['clippedStdout'],
            artifactId=789,archiveBytes=12345,archiveSha256='1'*64,conclusion='failure')
        for index,role,key in ((2,'outer','systemdRunExitCode'),(3,'cleanup','serviceExitCode')):
            row=reader.parse(args[index]);row[key]=1
            if role=='outer':row['outsideCleanupExitCode']=1
            else:row['firstFailure']={'phase':'v6-outer-client','name':'ValueError','message':'bounded outer setup client exit 1'}
            args[index]=reader.canonical(row)
            args[1].update({role+'Bytes':len(args[index]),role+'Sha256':sha(args[index])})
        with self.assertRaises(reader.Refusal):reader.v6_consumed_failure_audit(*args)
        self.set_raw(0,'log',self.args[0][:-4096])
        with self.assertRaises(ValueError):self.grade()

    def test_old_failed_original_validator_keeps_refusal(self):
        old=copy.deepcopy(self.args[1]);old['schema']='bw.ring3.setup-inventory-expectation.v6'
        for key in ('clippedStdout','artifactId','archiveBytes','archiveSha256'):old.pop(key)
        with self.assertRaises(reader.Refusal):reader.verify_setup_v6_failure_log(self.args[0],old,*self.args[2:])
        with self.assertRaises(reader.Refusal):reader.v6_consumed_failure_audit(self.args[0],old,*self.args[2:])

    def test_new_cli_reads_only_supplied_bytes_and_never_calls_live_edges(self):
        paths=dict(zip(('log','external','outer','cleanup','shell'),
            (self.args[0],reader.canonical(self.args[1]),*self.args[2:])))
        argv=['reader.py','--consumed-v6-failure','log','--external-admission','external',
            '--outer-resource-original','outer','--outside-cleanup-original','cleanup','--shell-image-original','shell']
        with patch.object(reader.sys,'argv',argv),patch.object(reader.sys,'stdout',io.StringIO()) as output,\
             patch.object(reader.Path,'open',lambda path,*a,**kw:io.BytesIO(paths[str(path)])),\
             patch.object(reader,'setup_v6_inventory_entry',side_effect=AssertionError('no live inventory')),\
             patch.object(reader,'inventory_probe',side_effect=AssertionError('no metadata child')),\
             patch.object(reader.os,'open',side_effect=AssertionError('no kernel source observation')),\
             patch.object(reader.subprocess,'Popen',side_effect=AssertionError('no subprocess')):
            reader.main();self.assertTrue(json.loads(output.getvalue())['failedAttemptRetained'])


def consumed_v6_failure_controls():
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ConsumedV6FailureControls))
    assert result.wasSuccessful(),'negative-only consumed v6 controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'installer':False,
        'nativeProcess':False,'guest':False,'pass':True}))


def consumed_v7_failure_fixture():
    """Capture the existing manufactured v7 packet before its mutation loop."""
    class Captured(BaseException):pass
    snapshot={}
    def capture(*args):
        snapshot['args']=copy.deepcopy(args)
        snapshot['stage']=copy.deepcopy(reader.verify_setup_v7_stage_observation(None,None))
        raise Captured()
    def selected(runner,suite):
        case=next(case for case in suite if
            case._testMethodName=='test_complete_failed_v7_inventory_packet_retains_clipped_last_child')
        case.test_complete_failed_v7_inventory_packet_retains_clipped_last_child()
    with patch.object(reader,'verify_setup_v7_failure_log',capture),\
         patch.object(unittest.TextTestRunner,'run',selected),\
         patch.object(subprocess,'Popen',side_effect=AssertionError('no real process')),\
         patch.object(subprocess,'run',side_effect=AssertionError('no real process')):
        try:setup_v7_controls()
        except Captured:pass
    assert set(snapshot)=={'args','stage'},'inert manufactured v7 packet captured'
    return snapshot['args'],snapshot['stage']


class ConsumedV7PathFailureControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.base,cls.stage=consumed_v7_failure_fixture()

    @staticmethod
    def held(raw):return {'bytes':len(raw),'sha256':sha(raw),
                           'base64':base64.b64encode(raw).decode()}

    def setUp(self):
        self.args=list(copy.deepcopy(self.base))
        self.originals=reader.decode_setup_v7_log(self.args[0])
        self.packet=reader.parse_setup_v7_outer(self.originals['runtime.setup-inventory.json'])
        self.status_lines=b''.join(line+b'\n' for line in self.args[0].splitlines()
            if reader.SETUP_V7_STATUS_MARKER in line)
        value=self.packet;inventory=value['inventory']
        self.request,self.source,self.record=copy.deepcopy(self.stage)
        self.patches=contextlib.ExitStack();self.addCleanup(self.patches.close)
        self.patches.enter_context(patch.object(reader,'verify_setup_v7_stage_observation',
            return_value=(self.request,self.source,self.record)))
        self.patches.enter_context(patch.object(subprocess,'Popen',
            side_effect=AssertionError('no real process')))
        self.patches.enter_context(patch.object(subprocess,'run',
            side_effect=AssertionError('no real process')))
        first={'phase':'setup-v7-runtime-inventory','name':'Refusal',
               'message':'bounded canonical runtime path'}
        value['firstFailure']=first;value['secondary']=[]
        inventory['probes']=inventory['probes'][:9];inventory['processes']=inventory['processes'][:9]
        inventory['pythonFiles']=[];inventory['mappedLibraries']=[];inventory['mapsOriginal']=None
        path=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES));meta=[1,100,0o100644,0,0,1,0,100]
        inventory['emptyPythonSources']={'before':{'path':path,'namedBefore':meta,
            'heldBefore':meta,'heldAfter':meta,'namedAfter':meta,'bytesRead':0,
            'readHex':'','eof':True,'sha256':sha(b''),'closeAttempted':True,
            'closeSucceeded':True,'firstFailure':None,'secondary':[]}}
        libc='/usr/lib/x86_64-linux-gnu/libc.so.6'
        node=reader.NODE_STAGE_TARGET
        python='/usr/bin/python3'
        qemu=reader.RUNTIME_QEMU
        inventory['files']={node:{'bytes':reader.RUNTIME_SELECTED['node']['bytes'],
            'sha256':reader.RUNTIME_SELECTED['node']['sha256'],'mode':0o555,'kind':'node-binary'},
            python:{'bytes':reader.CONSUMED_V7_PYTHON['bytes'],
                'sha256':reader.CONSUMED_V7_PYTHON['sha256'],'mode':0o755,'kind':'python-binary'},
            qemu:{'bytes':reader.RUNTIME_SELECTED['qemu']['bytes'],
                'sha256':reader.RUNTIME_SELECTED['qemu']['sha256'],'mode':0o755,'kind':'qemu-binary'},
            libc:{'bytes':1234,'sha256':'a'*64,'mode':0o644,'kind':'shared-library'}}
        inventory['fileMetadata']={node:[1,200,0o100555,0,0,1,
            reader.RUNTIME_SELECTED['node']['bytes'],100],
            python:[1,202,0o100755,0,0,1,reader.CONSUMED_V7_PYTHON['bytes'],100],
            qemu:[1,203,0o100755,0,0,1,reader.RUNTIME_SELECTED['qemu']['bytes'],100],
            libc:[1,201,0o100644,0,0,1,1234,100]}
        for stage in (value['stageBefore'],value['stageAfter']):
            stage['files']['node']={'before':inventory['fileMetadata'][node],
                'bytes':reader.RUNTIME_SELECTED['node']['bytes'],
                'sha256':reader.RUNTIME_SELECTED['node']['sha256']}
        inventory['aliases']={}
        self.record['sourceCommands']=[{'process':{'reapMonoNs':0}}]
        self.record['setup']['configure']={'process':{'reapMonoNs':0}}
        statuses=reader.decode_setup_v7_status_log(self.args[0])
        after=reader.setup_v7_status_rows(statuses['post']['raw'])
        post=self.record['setup']['postStatus']
        post['selected']={name:None if (name,arch) not in after else
            {key:after[name,arch].get(key) for key in
             ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
             for name,version,arch,*_ in reader.SETUP_V7_PACKAGES}
        post['pendingHostTriggers']={}
        value['parent']={'meta':[1,300,0o40755,0,0,2,0,100],
            'controls':{'cgroup.controllers':{'meta':[],'raw':'cpu memory pids\n'},
                        'cgroup.subtree_control':{'meta':[],'raw':'cpu memory pids\n'}},
            'alreadyEnabled':True}
        env={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
        roles=list(reader.SETUP_V7_PROBE_ORDER[:9])
        def add(role,argv,stdout,pid):
            process={'schema':'bw.ring3.inventory-process.v1','argv':argv,
                'environment':env,'pid':pid,'pgid':pid,'parentPid':101,
                'startTicks':pid,'spawnMonoNs':pid*10,'reapMonoNs':pid*10+1,
                'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0,'systemSeconds':0,'maxRssKiB':0},
                'firstFailure':None,'secondary':[]}
            return {'role':role,'argv':argv,'environment':env,'exitCode':0,
                'stdout':stdout.decode(),'stderr':''},\
                {'role':role,'process':process,'stdout':self.held(stdout),
                 'stderr':self.held(b'')}
        argvs=[['/usr/bin/ldd','/usr/bin/bash'],
            ['/usr/bin/ldd','/usr/bin/dpkg-query'],
            ['/usr/bin/ldd',node],['/usr/bin/ldd','/usr/bin/python3'],
            ['/usr/bin/ldd',reader.RUNTIME_QEMU],
            ['/usr/bin/dpkg-query','-W',
             '-f=${Package}\t${Version}\t${Architecture}\n',*reader.PACKAGE_NAMES],
            ['/usr/bin/dpkg-query','-L','qemu-system-x86'],
            ['/usr/bin/dpkg-query','-L','qemu-system-common'],
            ['/usr/bin/dpkg-query','-L','qemu-system-data']]
        streams=[(libc+' (0x1234)\n').encode()]*5 + [
            b'qemu-system-x86\t1:8.2.2+ds-0ubuntu1.18\tamd64\n'
            b'qemu-system-common\t1:8.2.2+ds-0ubuntu1.18\tamd64\n'
            b'qemu-system-data\t1:8.2.2+ds-0ubuntu1.18\tall\n'
            b'seabios\t1.16.3-2\tall\n'
            b'ipxe-qemu\t1.21.1+git-20220113.fbbdc3926-0ubuntu2\tall\n',
            b'/.\n/usr/bin/qemu-system-x86\n',
            b'/.\n/usr/share/qemu/firmware.bin\n',
            b'/.\n/usr/share/qemu/QEMU,VGA.bin\n'
            b'/usr/share/qemu/QEMU,cgthree.bin\n'
            b'/usr/share/qemu/QEMU,tcx.bin\n']
        pairs=[add(role,argv,stream,201+i) for i,(role,argv,stream)
               in enumerate(zip(roles,argvs,streams))]
        inventory['probes']=[pair[0] for pair in pairs]
        inventory['processes']=[pair[1] for pair in pairs]
        self.record['setup']['postStatus']['records']=len(after)
        self.set_packet_record()

    def set_packet_record(self):
        record_raw=reader.canonical(self.record)
        for stage in (self.packet['stageBefore'],self.packet['stageAfter']):
            stage['record']=self.held(record_raw)
        self.originals['runtime.setup-inventory.json']=reader.canonical(self.packet)
        out=io.BytesIO();out.write(self.status_lines)
        reader.emit_setup_v7_inventory(self.originals,out.write,out.flush)
        self.args[0]=out.getvalue()
        self.args[1].update(logBytes=len(self.args[0]),logSha256=sha(self.args[0]))

    def rebind_event(self,raw):
        self.record['event']=self.held(raw)
        self.originals['setup.event.json']=raw
        cleanup=reader.parse(self.args[3])
        cleanup['sourceAdmission']['eventSha256']=sha(raw)
        self.args[3]=reader.canonical(cleanup)
        self.args[1].update(cleanupBytes=len(self.args[3]),cleanupSha256=sha(self.args[3]))
        self.set_packet_record()

    def grade(self):return reader.consumed_v7_path_failure_audit(*self.args)

    def refused(self):
        self.set_packet_record()
        with self.assertRaises((ValueError,UnicodeError)):self.grade()

    def test_known_ninth_return_is_negative_only(self):
        verdict=self.grade()
        self.assertEqual(len(verdict['retainedProbePrefixRoles']),9)
        self.assertEqual(verdict['returnedNinthListing']['commaPaths'],
            sorted(reader.CONSUMED_V7_COMMA_PATHS))
        for key in ('officialJobAuthenticated','setupObserved','setupApproved',
                    'runtimeCandidateApproved','actualGuestApproved','actualRunApproved',
                    'completeHostConfiguration'):
            self.assertIs(verdict[key],False,key)
        with self.assertRaises(reader.Refusal):
            reader.setup_v7_listed_paths(self.packet['inventory']['probes'][-1]['stdout'].encode())
        with self.assertRaises((ValueError,UnicodeError)):
            reader.verify_setup_v7_failure_log(*self.args)

    def test_listing_name_order_and_missing_return_refuse(self):
        for mutation in ('missing','extra','case','role','exit','stderr'):
            with self.subTest(mutation=mutation):
                self.setUp()
                probe=self.packet['inventory']['probes'][-1]
                entry=self.packet['inventory']['processes'][-1]
                if mutation in ('missing','extra','case'):
                    data=probe['stdout']
                    if mutation=='missing':data=data.replace('/usr/share/qemu/QEMU,tcx.bin\n','')
                    elif mutation=='extra':data+= '/usr/share/qemu/QEMU,other.bin\n'
                    else:data=data.replace('QEMU,tcx','qemu,tcx')
                    probe['stdout']=data;entry['stdout']=self.held(data.encode())
                elif mutation=='role':probe['argv'][-1]='seabios'
                elif mutation=='exit':probe['exitCode']=1
                else:probe['stderr']='x';entry['stderr']=self.held(b'x')
                self.refused()

    def test_status_source_outer_and_approval_cuts(self):
        for mutation in ('status','source','outer','cleanup','candidate','poststage'):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation=='status':self.record['setup']['postStatus']['records']+=1
                elif mutation=='source':self.args[1]['workflowFileSha256']='0'*64
                elif mutation=='outer':
                    row=reader.parse(self.args[2]);row['cgroupAfter']='present'
                    self.args[2]=reader.canonical(row)
                    self.args[1].update(outerBytes=len(self.args[2]),outerSha256=sha(self.args[2]))
                elif mutation=='cleanup':
                    row=reader.parse(self.args[3]);row['action']='removed-exact'
                    self.args[3]=reader.canonical(row)
                    self.args[1].update(cleanupBytes=len(self.args[3]),cleanupSha256=sha(self.args[3]))
                elif mutation=='candidate':self.packet['candidate']={}
                else:self.packet['stageAfter']['source']={}
                self.refused()

    def test_cli_consumes_only_supplied_originals(self):
        paths=dict(zip(('log','external','outer','cleanup','shell'),
            (self.args[0],reader.canonical(self.args[1]),*self.args[2:])))
        argv=['reader.py','--consumed-v7-failure','log','--external-admission','external',
            '--outer-resource-original','outer','--outside-cleanup-original','cleanup',
            '--shell-image-original','shell']
        with patch.object(reader.sys,'argv',argv),\
             patch.object(reader.sys,'stdout',io.StringIO()) as output,\
             patch.object(reader.Path,'open',lambda path,*a,**kw:io.BytesIO(paths[str(path)])),\
             patch.object(reader.os,'open',side_effect=AssertionError('no kernel observation')):\
            reader.main()
        verdict=json.loads(output.getvalue())
        self.assertTrue(verdict['failedAttemptRetained'])
        self.assertFalse(verdict['setupApproved'])

    def test_coherent_ignored_event_overflow_refuses_but_pretty_lf_accepts(self):
        self.rebind_event(b'{\n  "syntheticEvent": true\n}\n')
        self.assertTrue(self.grade()['failedAttemptRetained'])
        self.rebind_event(b'{"syntheticEvent":true,"ignored":1e999}\n')
        with self.assertRaisesRegex(reader.Refusal,'nonfinite v7 outer JSON'):
            self.grade()
        for raw,reason in ((b'{"syntheticEvent":true,"syntheticEvent":false}\n',
                            'duplicate v7 outer JSON key'),
                           (b'[]\n','raw event object')):
            with self.subTest(reason=reason):
                self.rebind_event(raw)
                with self.assertRaisesRegex(reader.Refusal,reason):self.grade()

    def test_bool_exit_and_wait_status_cuts(self):
        for mutation in ('outer-service','outer-cleanup','cleanup-service',
                         'stop-attempted','stop-timeout','process-exit','probe-exit','wait-status'):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation.startswith('outer-'):
                    row=reader.parse(self.args[2]);row['systemdRunExitCode' if
                        mutation=='outer-service' else 'outsideCleanupExitCode']=True
                    self.args[2]=reader.canonical(row)
                    self.args[1].update(outerBytes=len(self.args[2]),outerSha256=sha(self.args[2]))
                elif mutation.startswith('cleanup-') or mutation.startswith('stop-'):
                    row=reader.parse(self.args[3])
                    if mutation=='cleanup-service':row['serviceExitCode']=True
                    elif mutation=='stop-attempted':row['stop']['attempted']=0
                    else:row['stop']['timedOut']=0
                    self.args[3]=reader.canonical(row)
                    self.args[1].update(cleanupBytes=len(self.args[3]),cleanupSha256=sha(self.args[3]))
                else:
                    probe=self.packet['inventory']['probes'][-1]
                    process=self.packet['inventory']['processes'][-1]['process']
                    if mutation=='process-exit':process['exitCode']=False
                    elif mutation=='probe-exit':probe['exitCode']=False
                    else:process['waitStatus']=False
                self.refused()

    def test_all_other_package_versions_coherently_refuse(self):
        pins={name:(version,arch) for name,version,arch,*_ in reader.SETUP_V7_PACKAGES
              if name in reader.PACKAGE_NAMES}
        for name in sorted(set(reader.PACKAGE_NAMES)-{'qemu-system-x86'}):
            with self.subTest(package=name):
                self.setUp()
                old,arch=pins[name];new='0:0.0-authored'
                probe=self.packet['inventory']['probes'][5]
                probe['stdout']=probe['stdout'].replace(name+'\t'+old+'\t'+arch,
                    name+'\t'+new+'\t'+arch)
                self.packet['inventory']['processes'][5]['stdout']=self.held(probe['stdout'].encode())
                statuses=reader.decode_setup_v7_status_log(self.args[0])
                post_raw=statuses['post']['raw']
                before=('Package: '+name+'\nVersion: '+old+'\n').encode()
                after=('Package: '+name+'\nVersion: '+new+'\n').encode()
                self.assertEqual(post_raw.count(before),1)
                post_raw=post_raw.replace(before,after)
                p,_=producer_fixture_case();status=io.BytesIO()
                pre_meta=p.emit_setup_v7_status('pre',statuses['pre']['raw'],status.write,status.flush)
                post_meta=p.emit_setup_v7_status('post',post_raw,status.write,status.flush)
                self.status_lines=status.getvalue()
                self.record['setup']['preflight']['statusOriginal']=pre_meta
                self.record['setup']['postStatus']['statusOriginal']=post_meta
                self.record['setup']['postStatus']['selected'][name]['Version']=new
                self.set_packet_record()
                with self.assertRaisesRegex(reader.Refusal,'five exact installed package'):
                    self.grade()

    def test_executable_identity_coherent_cuts(self):
        for role,path in (('node',reader.NODE_STAGE_TARGET),
                          ('python','/usr/bin/python3'),('qemu',reader.RUNTIME_QEMU)):
            for mutation in ('hash','bytes','kind'):
                with self.subTest(role=role,mutation=mutation):
                    self.setUp()
                    row=self.packet['inventory']['files'][path]
                    if mutation=='hash':
                        row['sha256']='0'*64
                        if role=='node':
                            for stage in (self.packet['stageBefore'],self.packet['stageAfter']):
                                stage['files']['node']['sha256']='0'*64
                    elif mutation=='bytes':
                        row['bytes']+=1
                        self.packet['inventory']['fileMetadata'][path][6]+=1
                        if role=='node':
                            for stage in (self.packet['stageBefore'],self.packet['stageAfter']):
                                stage['files']['node']['bytes']+=1
                    else:row['kind']='shared-library'
                    self.set_packet_record()
                    with self.assertRaisesRegex(reader.Refusal,'exact consumed executable'):
                        self.grade()

    @staticmethod
    def mutant(function,old,new):
        source=inspect.getsource(function)
        assert source.count(old)==1,'mutation anchor changed'
        namespace=dict(reader.__dict__)
        exec(compile(source.replace(old,new,1),'<inert source mutation>','exec'),namespace)
        return namespace[function.__name__]

    def test_source_guard_mutants_are_detected(self):
        self.packet['firstFailure']={'phase':'other','name':'Refusal','message':'other'}
        self.refused()
        mutant=self.mutant(reader.consumed_v7_path_failure_audit,
            "value['candidate'] is None and value['firstFailure']==first and",
            "value['candidate'] is None and True and")
        self.assertTrue(mutant(*self.args)['failedAttemptRetained'])
        self.setUp()
        probe=self.packet['inventory']['probes'][-1]
        probe['stdout']=probe['stdout'].replace('/usr/share/qemu/QEMU,tcx.bin\n','')
        self.packet['inventory']['processes'][-1]['stdout']=self.held(probe['stdout'].encode())
        self.refused()
        mutant=self.mutant(reader.consumed_v7_failed_listing,
            "need(commas==CONSUMED_V7_COMMA_PATHS,'all three observed comma names retained')",
            "need(True,'all three observed comma names retained')")
        with patch.object(reader,'consumed_v7_failed_listing',mutant):
            self.assertTrue(self.grade()['failedAttemptRetained'])
        self.setUp()
        outer=reader.parse(self.args[2]);outer['systemdRunExitCode']=True
        self.args[2]=reader.canonical(outer)
        self.args[1].update(outerBytes=len(self.args[2]),outerSha256=sha(self.args[2]))
        with self.assertRaisesRegex(reader.Refusal,'exact failed outer1'):
            self.grade()
        mutant=self.mutant(reader.consumed_v7_path_failure_audit,
            "type(outer['systemdRunExitCode']) is int and",
            'True and')
        self.assertTrue(mutant(*self.args)['failedAttemptRetained'])


def consumed_v7_failure_controls():
    result=unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(ConsumedV7PathFailureControls))
    assert result.wasSuccessful(),'negative-only consumed v7 controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,
        'installer':False,'nativeProcess':False,'guest':False,'pass':True}))


def host_baseline_controls():
    """Data-only synthetic producer to independent reader; no host file is read."""
    p,_=producer_fixture_case()
    source={'schema':'bw.ring3.source.v1','head':'a'*40,'tree':'b'*40,
        'files':{name:{'mode':'100644','blob':'c'*40,'bytes':1,'sha256':'d'*64}
                 for name in p.SOURCE_PATHS}}
    request={'schema':'bw.ring3.host-baseline-request.v1','repository':'CrispStrobe/bw-board',
        'pullRequest':645,'head':'a'*40,'tree':'b'*40,'source':p.original_bytes(p.encode(source))}
    raw=p.encode(request);pin=p.sha(raw)
    event={'action':'labeled','label':{'name':p.HOST_BASELINE_LABEL},
        'repository':{'full_name':'CrispStrobe/bw-board'},'sender':{'login':'CrispStrobe'},
        'number':645,'pull_request':{'number':645,'state':'open','body':
            '<!-- BW_RING3_HOST_BASELINE_V1\n'+pin+'\nBW_RING3_HOST_BASELINE_V1 -->',
            'head':{'sha':'a'*40,'repo':{'full_name':'CrispStrobe/bw-board','fork':False}},
            'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}}
    event_raw=p.encode(event)
    git_env={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'}
    git=['/usr/bin/git','-c','safe.directory=/checkout','--no-replace-objects',
         '-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],
           ['ls-tree','-r','HEAD','--',*sorted(p.SOURCE_PATHS)]]
    outputs=[b'a'*40+b'\n',b'b'*40+b'\n',
        ''.join(source['files'][name]['mode']+' blob '+source['files'][name]['blob']+'\t'+name+'\n'
                for name in sorted(p.SOURCE_PATHS)).encode()]
    commands=[]
    for index,(tail,output) in enumerate(zip(tails,outputs)):
        argv=git+tail;pid=201+index;start=1+2*index;end=start+1
        process={'schema':'bw.ring3.process.v1','role':'discovery','argv':argv,
            'cwdRole':'checkout','environment':git_env,'pid':pid,'pgid':pid,
            'parentPid':100,'startTicks':pid,'spawnMonoNs':start,'reapMonoNs':end,
            'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
            'rusage':{'userSeconds':0.001,'systemSeconds':0.001,'maxRssKiB':1024},
            'firstFailure':None,'secondary':[]}
        commands.append({'argv':argv,'process':process,'stdout':p.original_bytes(output),
                         'stderr':None})
    env={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
        'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe',
        'GITHUB_JOB':p.HOST_BASELINE_JOB,'GITHUB_WORKFLOW_SHA':'e'*40,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge',
        'BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40,p.HOST_BASELINE_PIN:pin,
        p.HOST_BASELINE_B64:base64.b64encode(raw).decode('ascii'),
        'ImageOS':'ubuntu24','ImageVersion':'20261023.334.3'}
    identity={'dev':1,'ino':2,'mode':stat.S_IFREG|0o755,'uid':0,'gid':0,
        'nlink':1,'size':0,'mtime_ns':3}
    status=b'Package: base\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n'
    import zlib
    def file_item(path,cap):
        data=status if path==p.HOST_BASELINE_STATUS else (b'helper:'+path.encode())
        info=dict(identity,size=len(data),ino=10+len(path))
        return {'path':path,'kind':'regular','namedBefore':info,'heldBefore':info,
            'heldAfter':info,'namedAfter':info,'bytesRead':len(data),
            'prefixSha256':sha(data),'zlibBase64':base64.b64encode(zlib.compress(data,9)).decode(),
            'closeAttempted':True,'closed':True,'firstFailure':None,'secondary':[]}
    def alias_item(path):
        info=dict(identity,mode=stat.S_IFLNK|0o777,size=4)
        text={'/bin':'usr/bin','/bin/sh':'dash','/usr/bin/sh':'dash'}[path]
        target=os.path.normpath(os.path.join(os.path.dirname(path),text))
        return {'path':path,'kind':'alias','namedBefore':info,'namedAfter':info,
            'linkText':text,'target':target,'firstFailure':None,'secondary':[]}
    policy=lambda:{'path':p.HOST_BASELINE_POLICY,'kind':'absent','identity':None,
                   'linkText':None,'firstFailure':None,'secondary':[]}
    class Observer:
        def __init__(self,environ):
            self.facts={'eventIdentity':{'st_dev':1,'st_ino':2,'st_mode':stat.S_IFREG|0o600,
                'st_uid':1001,'st_gid':1001,'st_nlink':1,'st_size':len(event_raw),'st_mtime_ns':1},
                'sourceCommands':[]}
        def event(self):return event_raw
        def source(self,selected):
            self.facts['source']=source;self.facts['sourceCommands']=commands
    def cgroup(_,path):
        if str(path)=='/proc/self/cgroup':return '0::/system.slice/bw-ring3-host-baseline-123-1.service\n'
        return {'cpu.max':'100000 100000','memory.max':'1073741824',
                'memory.swap.max':'0','pids.max':'64'}[Path(path).name]+'\n'
    log=b'2026-10-24T12:43:38.9737289Z ##[group]Runner Image\n'+\
        b'2026-10-24T12:43:38.9738237Z Image: ubuntu-24.04\n'+\
        b'2026-10-24T12:43:38.9739087Z Version: 20261012.334.1\n'+\
        b'2026-10-24T12:43:38.9744422Z ##[endgroup]\n'+\
        b'2026-10-24T12:43:39.7254404Z Complete job name: host-baseline-v1\n'+\
        b'2026-10-24T12:43:39.7891376Z ##[group]Run actions/checkout@pinned\n'
    outside={'schema':'bw.ring3.host-baseline-outside.v1','runId':'123',
        'unit':'/sys/fs/cgroup/system.slice/bw-ring3-host-baseline-123-1.service',
        'shellExitCode':0,'serviceExitCode':0,'cgroupAfter':'absent','cleanupAction':'none',
        'polls':[{'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}],
        'firstFailure':None,'secondary':[],'setupApproved':False}
    shell={'schema':'bw.ring3.host-baseline-shell.v1',
        'fields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                  'ImageVersion':{'present':True,'value':'20261023.334.3'}},
        'fieldErrors':[],'setupAttempted':False,'guestAttempted':False,'setupApproved':False}
    def captured(current=env,file_reader=file_item,alias_reader=alias_item):
        with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
             patch.object(p.os,'getresgid',return_value=(0,0,0)),\
             patch.object(p.Cgroups,'text',side_effect=cgroup),\
             patch.object(p,'setup_v8_sequence',side_effect=AssertionError('setup forbidden')):
            return p.host_baseline_collect(current,Observer,file_reader,alias_reader,policy)
    def originals(packet=None,sh=shell,out=outside,official=log,conclusion='success'):
        packet=captured() if packet is None else packet
        raw=p.HOST_BASELINE_MARKER+p.encode(packet);shell_raw=p.encode(sh)
        outside_raw=reader.canonical(out)
        external={'schema':'bw.ring3.host-baseline-expectation.v1','runId':'123',
            'attempt':'1','head':'a'*40,'tree':'b'*40,'requestSha256':pin,
            'workflowSha':'e'*40,'workflowFileSha256':'d'*64,'jobId':456,
            'jobName':p.HOST_BASELINE_JOB,'conclusion':conclusion,
            'serviceBytes':len(raw),'serviceSha256':sha(raw),
            'shellBytes':len(shell_raw),'shellSha256':sha(shell_raw),
            'outsideBytes':len(outside_raw),'outsideSha256':sha(outside_raw),
            'officialLogBytes':len(official),'officialLogSha256':sha(official)}
        return raw,shell_raw,outside_raw,official,external
    class Tests(unittest.TestCase):
        def test_full_producer_packet_reader_and_discordance(self):
            packet=captured();self.assertTrue(packet['complete']);self.assertIsNone(packet['firstFailure'])
            output=io.BytesIO();result=p.host_baseline_emit(packet,output.write,output.flush)
            self.assertTrue(result['complete'])
            raw,sh,out,official,external=originals(packet)
            self.assertEqual(output.getvalue(),raw)
            archive=io.BytesIO()
            with zipfile.ZipFile(archive,'w',zipfile.ZIP_STORED) as stored:
                for name,data in (('service.original.log',output.getvalue()),
                                  ('shell.original.json',sh),('outside.original.json',out),
                                  ('controller.stderr',b''),('outside.stderr',b'')):
                    stored.writestr(name,data)
            self.assertLessEqual(len(archive.getvalue()),8<<20)
            with zipfile.ZipFile(io.BytesIO(archive.getvalue())) as held:
                self.assertEqual(set(held.namelist()),{'service.original.log',
                    'shell.original.json','outside.original.json','controller.stderr','outside.stderr'})
                self.assertEqual(held.read('service.original.log'),output.getvalue())
            workflow=Path('.github/workflows/i80386-ring3-int-iret.yml').read_text()
            self.assertIn('name: i80386-ring3-host-baseline-v1-originals',workflow)
            self.assertIn('path: build/i80386-ring3-host-baseline-v1/',workflow)
            grade=reader.verify_host_baseline(raw,sh,out,official,external)
            self.assertTrue(grade['completeObservation']);self.assertEqual(grade['statusCensus']['records'],1)
            self.assertFalse(grade['runnerImageMatchesService']);self.assertFalse(grade['setupApproved'])
            self.assertFalse(grade['guestApproved'])
        def test_source_event_and_role_mutations_refuse(self):
            packet=captured()
            for change in ('source','event','context','status','helper','alias','policy'):
                bad=copy.deepcopy(packet)
                if change=='source':bad['context']['sourceCommands'][0]['argv'][-1]='wrong'
                elif change=='event':bad['context']['event']['sha256']='0'*64
                elif change=='context':bad['context']['platform']['GITHUB_RUN_ID']='124'
                elif change=='status':bad['status']['prefixSha256']='0'*64
                elif change=='helper':bad['helpers'][p.HOST_BASELINE_HELPERS[0]]['namedAfter']=dict(
                    bad['helpers'][p.HOST_BASELINE_HELPERS[0]]['namedAfter'],ino=99)
                elif change=='alias':bad['aliases']['/bin']['linkText']='elsewhere'
                else:bad['policy']['kind']='present'
                with self.subTest(change=change),self.assertRaises(Exception):
                    reader.verify_host_baseline(*originals(bad))
        def test_event_transport_and_caps_refuse_before_file_edge(self):
            for change in ('label','pin','b64','attempt'):
                current=copy.deepcopy(env);ev=copy.deepcopy(event)
                if change=='label':ev['label']['name']='other'
                elif change=='pin':current[p.HOST_BASELINE_PIN]='0'*64
                elif change=='b64':current[p.HOST_BASELINE_B64]='AA=='
                else:current['GITHUB_RUN_ATTEMPT']='2'
                with self.subTest(change=change),self.assertRaises(Exception):
                    p.host_baseline_event(p.encode(ev),current)
            calls=[]
            def nofile(*args):calls.append(args);raise AssertionError('file edge reached')
            packet=captured(dict(env,GITHUB_RUN_ATTEMPT='2'),nofile)
            self.assertFalse(packet['complete']);self.assertEqual(calls,[])
            self.assertIsNotNone(packet['firstFailure'])
            item=file_item(p.HOST_BASELINE_STATUS,8<<20)
            item['zlibBase64']=base64.b64encode(zlib.compress(b'X'*100,9)).decode()
            with self.assertRaises(Exception):reader.host_baseline_bytes(item,p.HOST_BASELINE_STATUS,8<<20)
            with self.assertRaises(Exception):reader.host_baseline_bytes(file_item(p.HOST_BASELINE_STATUS,8<<20),p.HOST_BASELINE_STATUS,1)
        def test_absent_image_and_policy_alias_parity(self):
            current=dict(env);current.pop('ImageVersion')
            packet=captured(current)
            self.assertEqual(packet['fields']['ImageVersion'],{'present':False,'value':None})
            sh=copy.deepcopy(shell);sh['fields']['ImageVersion']={'present':False,'value':None}
            grade=reader.verify_host_baseline(*originals(packet,sh=sh))
            self.assertTrue(grade['forwardingMatchesExpected'])
            self.assertTrue(grade['completeObservation'])
            packet=captured();packet['policy']={'path':p.HOST_BASELINE_POLICY,
                'kind':'present','identity':dict(identity,mode=stat.S_IFLNK|0o777),
                'linkText':'safe','firstFailure':None,'secondary':[]}
            self.assertTrue(reader.verify_host_baseline(*originals(packet))['completeObservation'])
            for change in ('policyNul','policyNonaliasText','aliasNul'):
                bad=copy.deepcopy(packet)
                if change=='policyNul':bad['policy']['linkText']='bad\x00'
                elif change=='policyNonaliasText':bad['policy']['identity']['mode']=stat.S_IFREG|0o644
                else:bad['aliases']['/bin']['linkText']='bad\x00'
                with self.subTest(change=change),self.assertRaises(Exception):
                    reader.verify_host_baseline(*originals(bad))
        def test_official_log_and_outer_refusals(self):
            packet=captured()
            for changed in (log.replace(b'20261012.334.1\n',b'20261012.334.1\n2026-10-24T12:43:38.9739090Z Image: duplicate\n'),
                            log.replace(b'##[endgroup]',b''),
                            log.replace(b'Complete job name: host-baseline-v1',
                                        b'Complete job name: other'),log+log,
                            log[log.index(b'2026-10-24T12:43:39.7891376Z'):]+log[:log.index(b'2026-10-24T12:43:39.7891376Z')]):
                with self.assertRaises(Exception):reader.verify_host_baseline(*originals(packet,official=changed))
            with self.assertRaises(Exception):reader.verify_host_baseline(*originals(packet,out=dict(outside,cgroupAfter='populated')))
        def test_real_file_reader_mocked_fd_edges_and_partials(self):
            path=p.HOST_BASELINE_STATUS;data=b'Package: base\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\n'
            info=SimpleNamespace(**{'st_'+k:v for k,v in dict(identity,size=len(data)).items()})
            reads=[data,b'']
            with patch.object(p.os,'lstat',return_value=info),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=info),\
                 patch.object(p.os,'read',side_effect=lambda fd,n:reads.pop(0)),\
                 patch.object(p.os,'close',return_value=None):
                item=p.host_baseline_file(path,8<<20)
            self.assertEqual(item['kind'],'regular')
            self.assertEqual(reader.host_baseline_bytes(item,path,8<<20),data)
            reads=[data,b'']
            with patch.object(p.os,'lstat',return_value=info),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=info),\
                 patch.object(p.os,'read',side_effect=lambda fd,n:reads.pop(0)),\
                 patch.object(p.os,'close',side_effect=OSError('mock close failed')):
                failed=p.host_baseline_file(path,8<<20)
            self.assertEqual(failed['kind'],'error');self.assertTrue(failed['closeAttempted'])
            self.assertFalse(failed['closed']);self.assertEqual(failed['bytesRead'],len(data))
            self.assertIsNotNone(failed['firstFailure'])
            with self.assertRaises(Exception):reader.host_baseline_bytes(failed,path,8<<20)
            short=SimpleNamespace(**{'st_'+k:v for k,v in dict(identity,size=len(data)+1).items()})
            reads=[data,b'']
            with patch.object(p.os,'lstat',return_value=short),\
                 patch.object(p.os,'open',return_value=77),\
                 patch.object(p.os,'fstat',return_value=short),\
                 patch.object(p.os,'read',side_effect=lambda fd,n:reads.pop(0)),\
                 patch.object(p.os,'close',return_value=None):
                failed=p.host_baseline_file(path,8<<20)
            self.assertEqual(failed['kind'],'error');self.assertEqual(failed['bytesRead'],len(data))
            self.assertIsNotNone(failed['firstFailure'])
        def test_file_primary_and_secondary_reach_top_failed_packet(self):
            first={'phase':'mock-read','name':'OSError','message':'read failed'}
            second={'phase':'mock-close','name':'OSError','message':'close failed'}
            def failed(path,cap):
                item=file_item(path,cap)
                if path==p.HOST_BASELINE_HELPERS[1]:
                    item.update(kind='error',zlibBase64=None,closed=False,
                                firstFailure=first,secondary=[second])
                return item
            packet=captured(file_reader=failed)
            self.assertFalse(packet['complete'])
            self.assertEqual(packet['firstFailure'],first)
            self.assertEqual(packet['secondary'],[second])
            self.assertEqual(packet['helperOrder'],list(p.HOST_BASELINE_HELPERS[:2]))
            self.assertEqual(packet['status']['kind'],'regular')
            failed_outer=dict(outside,serviceExitCode=1,firstFailure={
                'phase':'baseline-service-exit','name':'ValueError','message':'client exit 1'})
            grade=reader.verify_host_baseline(*originals(packet,out=failed_outer,conclusion='failure'))
            self.assertFalse(grade['completeObservation'])
            self.assertEqual(grade['statusCensus']['records'],1)
            self.assertEqual(grade['firstFailure'],first)
            for change in ('item','top','secondary'):
                bad=copy.deepcopy(packet)
                if change=='item':bad['helpers'][p.HOST_BASELINE_HELPERS[1]]['firstFailure']={'invented':True}
                elif change=='top':bad['firstFailure']=dict(bad['firstFailure'],message='different')
                else:bad['secondary']='not-a-list'
                with self.subTest(change=change),self.assertRaises(Exception):
                    reader.verify_host_baseline(*originals(bad,out=failed_outer,conclusion='failure'))
        def test_readonly_outside_poll_and_outer_failure_retention(self):
            active={'terminal':'populated','cgroupProcs':'42\n','cgroupEvents':'populated 1\n',
                    'cgroupStat':'nr_descendants 0\nnr_dying_descendants 0\n'}
            absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
            seen=[];rows=[active,absent]
            outside_ok=p.host_baseline_outside({'GITHUB_RUN_ID':'123',
                'BW_BASELINE_SHELL_EXIT':'0','BW_BASELINE_SERVICE_EXIT':'0'},
                lambda:rows.pop(0),lambda n:seen.append(n))
            self.assertEqual(outside_ok['cgroupAfter'],'absent')
            self.assertEqual(seen,[1]);self.assertIsNone(outside_ok['firstFailure'])
            stalled=p.host_baseline_outside({'GITHUB_RUN_ID':'123',
                'BW_BASELINE_SHELL_EXIT':'0','BW_BASELINE_SERVICE_EXIT':'124'},
                lambda:active,lambda n:None)
            self.assertEqual(len(stalled['polls']),6)
            self.assertEqual(stalled['firstFailure']['phase'],'baseline-service-exit')
            self.assertEqual(stalled['secondary'][-1]['phase'],'baseline-outside-cgroup')
            self.assertEqual(stalled['cleanupAction'],'none')
            self.assertEqual(stalled['cgroupAfter'],'populated')
            timeout=p.host_baseline_outside({'GITHUB_RUN_ID':'123',
                'BW_BASELINE_SHELL_EXIT':'0','BW_BASELINE_SERVICE_EXIT':'124'},
                lambda:absent,lambda n:None)
            grade=reader.verify_host_baseline(*originals(captured(),out=timeout,conclusion='failure'))
            self.assertFalse(grade['completeObservation'])
            self.assertEqual(grade['firstFailure']['phase'],'baseline-service-exit')
            self.assertFalse(grade['guestApproved'])
            bad=copy.deepcopy(timeout);bad['polls'][0]['cgroupStat']='nr_descendants 1\n'
            with self.assertRaises(Exception):reader.verify_host_baseline(
                *originals(captured(),out=bad,conclusion='failure'))
        def test_policy_readlink_error_is_primary_and_incomplete(self):
            info=SimpleNamespace(**{'st_'+k:v for k,v in dict(identity,mode=stat.S_IFLNK|0o777).items()})
            with patch.object(p.os,'lstat',return_value=info),\
                 patch.object(p.os,'readlink',side_effect=OSError('mock policy readlink')):
                item=p.host_baseline_policy()
            self.assertEqual(item['kind'],'error')
            self.assertEqual(item['firstFailure']['phase'],'baseline-policy')
            packet=captured();packet['policy']=item;packet['complete']=False
            self.assertFalse(packet['complete'])
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p.Cgroups,'text',side_effect=cgroup):
                failed=p.host_baseline_collect(env,Observer,file_item,alias_item,lambda:item)
            self.assertFalse(failed['complete'])
            self.assertEqual(failed['firstFailure'],item['firstFailure'])
        def test_failure_fact_shape_and_oversize_retention(self):
            raw={'phase':'mock-read','name':'OSError','message':'X'*300}
            bounded=p.host_baseline_bound_fact(raw)
            self.assertEqual(bounded['phase'],'mock-read')
            self.assertEqual(bounded['messageBytes'],300)
            self.assertEqual(bounded['messageSha256'],sha(b'X'*300))
            reader.host_baseline_failure(bounded)
            bad=copy.deepcopy(bounded);bad['messageSha256']='0'*64
            # The digest records an unretained message; its syntax is checked,
            # while its raw text cannot be independently reconstructed.
            reader.host_baseline_failure(bad)
            bad=dict(bounded,messageBytes=1)
            with self.assertRaises(Exception):reader.host_baseline_failure(bad)
            packet=captured();packet['complete']=False
            packet['firstFailure']={'invented':True}
            failed=dict(outside,serviceExitCode=1,firstFailure={
                'phase':'baseline-service-exit','name':'ValueError','message':'outer fail'})
            with self.assertRaises(Exception):reader.verify_host_baseline(
                *originals(packet,out=failed,conclusion='failure'))
            packet['firstFailure']={'phase':'mock','name':'ValueError','message':'first'}
            packet['secondary']='not-a-list'
            with self.assertRaises(Exception):reader.verify_host_baseline(
                *originals(packet,out=failed,conclusion='failure'))
            shell_bad=copy.deepcopy(shell);shell_bad['fieldErrors']=[{'invented':True}]
            with self.assertRaises(Exception):reader.verify_host_baseline(
                *originals(captured(),sh=shell_bad))
        def test_malformed_image_fields_keep_negative_exit_parity(self):
            current=dict(env,ImageOS='x'*257)
            packet=captured(current)
            self.assertFalse(packet['complete'])
            self.assertIsNotNone(packet['firstFailure'])
            fields,errors=p.image_env_fields(current)
            sh={'schema':'bw.ring3.host-baseline-shell.v1','fields':fields,
                'fieldErrors':errors,'setupAttempted':False,'guestAttempted':False,
                'setupApproved':False}
            failure={'phase':'baseline-shell-exit','name':'ValueError','message':'bounded shell observer exit 1'}
            out=dict(outside,shellExitCode=1,serviceExitCode=1,firstFailure=failure)
            grade=reader.verify_host_baseline(*originals(packet,sh=sh,out=out,conclusion='failure'))
            self.assertFalse(grade['completeObservation']);self.assertFalse(grade['guestApproved'])
            with self.assertRaises(Exception):reader.verify_host_baseline(
                *originals(packet,sh=sh,out=dict(out,shellExitCode=0),conclusion='failure'))
            bad=copy.deepcopy(sh);bad['fieldErrors']=[]
            with self.assertRaises(Exception):reader.verify_host_baseline(
                *originals(packet,sh=bad,out=out,conclusion='failure'))
        def test_large_valid_outside_negative_cli_cap(self):
            packet=captured();large=copy.deepcopy(outside)
            active={'terminal':'populated','cgroupProcs':'42\n'*300,
                'cgroupEvents':'populated 1\n',
                'cgroupStat':'nr_descendants 0\nnr_dying_descendants 0\n'}
            large['polls']=[copy.deepcopy(active) for unused in range(6)]
            large['cgroupAfter']='populated'
            large['firstFailure']={'phase':'baseline-outside-cgroup',
                'name':'ValueError','message':'finite census still populated'}
            values=originals(packet,out=large,conclusion='failure')
            self.assertGreater(len(values[2]),4096)
            self.assertLessEqual(len(values[2]),16384)
            files=dict(zip(('service','shell','outside','official','external'),
                (*values[:4],reader.canonical(values[4]))))
            argv=['reader.py','--host-baseline-originals','service',
                '--shell-original','shell','--outside-original','outside',
                '--official-job-log','official','--external-admission','external']
            real_open=Path.open
            def opened(path,mode='r',*args,**kwargs):
                if str(path) in files:return io.BytesIO(files[str(path)])
                raise AssertionError('unexpected CLI read')
            stdout=io.StringIO()
            with patch.object(reader,'HOST_BASELINE_READER_ENABLED',True),\
                 patch.object(reader.sys,'argv',argv),\
                 patch.object(reader.sys,'stdout',stdout),\
                 patch.object(Path,'open',opened):
                reader.main()
            verdict=json.loads(stdout.getvalue())
            self.assertFalse(verdict['completeObservation'])
            self.assertEqual(verdict['firstFailure']['phase'],'baseline-outside-cgroup')
            self.assertFalse(verdict['guestApproved'])
        def test_status_fold_duplicate_and_wire_cap(self):
            good=(b'Package: base\nVersion: 1\nArchitecture: amd64\n'
                  b'Status: install ok installed\nDescription: text\n continuation\n')
            self.assertEqual(reader.host_baseline_status(good)['records'],1)
            empty_header=(good+b'Conffiles:\n /etc/base.conf deadbeef\n')
            self.assertEqual(reader.host_baseline_status(empty_header)['records'],1)
            self.assertEqual(reader.host_baseline_status(
                empty_header.replace(b'Conffiles:\n',b'conffiles:\n'))['records'],1)
            self.assertEqual(reader.host_baseline_status(
                good.replace(b'Package: base\n',b'pAcKaGe: base\n'))['records'],1)
            self.assertEqual(reader.host_baseline_status(
                good.replace(b' continuation\n',b' .\n'))['records'],1)
            for raw_status in (good.replace(b'Status: install ok installed\n',
                     b'Status: install ok installed\nStatus: install ok installed\n'),
                    good.replace(b'Package: base\n',b'Package: base\n folded\n'),
                    good[:-1],
                    empty_header.replace(b'Conffiles:\n',b'Conffiles:\t\n'),
                    empty_header.replace(b'Conffiles:\n',b'Conffiles:unexpected\n'),
                    good.replace(b'Package: base\n',b'Package:\n'),
                    good.replace(b'Package: base\n',b'Package: base\npackage: other\n'),
                    good.replace(b'Package: base\n',b'pAcKaGe: base\n folded\n'),
                    empty_header.replace(b'Conffiles:\n',b'Conffiles:\nconffiles:\n'),
                    good+b'Conffiles:\n',
                    empty_header.replace(b' /etc/base.conf deadbeef\n',b' \n'),
                    good.replace(b' continuation\n',b' \n'),
                    good.replace(b'Package: base\n',b'Package:    \n'),
                    good.replace(b'Package: base\n',b'Package: \t\n'),
                    good+b'Other:\n'):
                with self.assertRaises(Exception):reader.host_baseline_status(raw_status)
            packet=captured();packet['helpers'][p.HOST_BASELINE_HELPERS[0]]['zlibBase64']='X'*200000
            output=io.BytesIO()
            with patch.object(p,'HOST_BASELINE_WIRE_CAP',150000):
                failed=p.host_baseline_emit(packet,output.write,output.flush)
            self.assertFalse(failed['complete']);self.assertEqual(failed['firstFailure']['phase'],'host-baseline-wire')
            self.assertLessEqual(len(output.getvalue()),150000)
            packet=captured();packet['firstFailure']={'phase':'earlier','name':'ValueError','message':'first'}
            packet['complete']=False
            packet['helpers'][p.HOST_BASELINE_HELPERS[0]]['zlibBase64']='X'*200000
            output=io.BytesIO()
            with patch.object(p,'HOST_BASELINE_WIRE_CAP',150000):
                failed=p.host_baseline_emit(packet,output.write,output.flush)
            self.assertEqual(failed['firstFailure']['phase'],'earlier')
            self.assertEqual(failed['secondary'][-1]['phase'],'host-baseline-wire')
        def test_disabled_guard_precedes_host_edges(self):
            self.assertTrue(p.HOST_BASELINE_ENABLED)
            for mode in ('--host-baseline-shell-v1','--host-baseline-service-v1',
                         '--host-baseline-outside-v1'):
                with patch.object(p,'HOST_BASELINE_ENABLED',False),\
                     patch.object(p,'host_baseline_shell') as shell_edge,\
                     patch.object(p,'host_baseline_collect') as service_edge,\
                     patch.object(p,'host_baseline_outside') as outside_edge:
                    self.assertEqual(p.dispatch_cli([mode],env),1)
                    shell_edge.assert_not_called();service_edge.assert_not_called()
                    outside_edge.assert_not_called()
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure baseline controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'hostFiles':False,
        'installer':False,'helperExecuted':False,'node':False,'qemu':False,'guest':False,'pass':True}))


def setup_v9_controls():
    """Pure manufactured complete V9 original; no hosted tool or guest runs."""
    p,_=producer_fixture_case()
    edges=staged_runtime_controls(export_edges=True)
    class Tests(unittest.TestCase):
        def test_v9_real_collector_closed_profile_terminal_timeout_and_prefix(self):
            terminal={'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                'rusage':{'userSeconds':0.0,'systemSeconds':0.0,'maxRssKiB':1}}
            class Child:
                role='setup-v9'
                environment=dict(p.SETUP_V9_INSTALLER_ENV)
                def __init__(self,case):self.case=case;self.clock=0;self.calls=0;self.killed=False
                def now(self):
                    self.clock+=(p.CHILD_NS if self.case=='timeout' else 1000)
                    return self.clock
                def spawn(self):return {'pid':201,'pgid':201,'parentPid':101,'startTicks':7}
                def read_available(self,timeout):
                    self.calls+=1
                    if self.case=='overflow' and self.calls==1:
                        return [('stdout',b'x'*(p.STREAM_CAP+1))]
                    return []
                def reap(self):return None if self.case=='timeout' and not self.killed else terminal
                def close(self):pass
                def kill(self):self.killed=True
            argv=['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V9_CONFIGURE_ORDER]
            process,streams=p.collect_child(Child('complete'),'setup-v9',argv,profile='setup-v9')
            self.assertEqual((process['role'],process['firstFailure'],process['exitCode'],streams['stdout']),
                ('setup-v9',None,0,b''))
            with self.assertRaises(ValueError):
                p.collect_child(Child('complete'),'setup-v8',argv,profile='setup-v9')
            timed=p.collect_child(Child('timeout'),'setup-v9',argv,profile='setup-v9')[0]
            self.assertTrue(timed['timedOut']);self.assertIsNotNone(timed['firstFailure'])
            overflow,held=p.collect_child(Child('overflow'),'setup-v9',argv,profile='setup-v9')
            self.assertIsNotNone(overflow['firstFailure'])
            self.assertEqual(held['stdout'],b'x'*p.STREAM_CAP)
            self.assertEqual(overflow['exitCode'],0)

        def test_v9_complete_manufactured_six_role_envelope_and_coherent_cuts(self):
            # Only this control substitutes a small authored Node and status baseline.
            # The source candidate retains the selected production pins outside it.
            def status_row(name,version,arch='amd64',state='install ok installed',pending=None):
                lines=['Package: '+name,'Version: '+version,'Architecture: '+arch,'Status: '+state]
                if pending is not None:lines.append('Triggers-Pending: '+pending)
                return '\n'.join(lines).encode()
            base=[status_row('installed-'+str(i).zfill(4),'1',
                state='deinstall ok config-files' if i==0 else 'install ok installed')
                for i in range(1210)]
            pre=b'\n\n'.join(base+[status_row('libc-bin','2')])+b'\n'
            selected=[status_row(name,version,arch) for name,version,arch,*_ in p.SETUP_V9_PACKAGE_ROWS]
            post=b'\n\n'.join(base+[status_row('libc-bin','2',state='install ok triggers-pending',pending='ldconfig'),*selected])+b'\n'
            production=(reader.SETUP_V9_STATUS_SHA,reader.SETUP_V9_STATUS_BYTES,p.SETUP_V9_STATUS_SHA)
            self.assertEqual(production[:2],('4144e0299e81507b7a856beef9fe6e67f55bffd0c0d7e9245265b6920721d1ac',1231069))
            with edges() as (producer,env,request,raw,state),\
                 patch.object(reader,'SETUP_V9_STATUS_SHA',sha(pre)),\
                 patch.object(reader,'SETUP_V9_STATUS_BYTES',len(pre)),\
                 patch.object(producer,'SETUP_V9_STATUS_SHA',sha(pre)),\
                 patch.object(producer,'SETUP_V8_STATUS_SHA',sha(pre)):
                producer.stage_runtime_inventory_node(env)
                self.assertEqual(state['observerExit'],0)
                FakeOps,witness=setup_v8_controls(export_ops=True)
                v9_request=copy.deepcopy(request)
                v9_request.update(schema='bw.ring3.inventory-request.v9',
                    setup=producer.setup_v9_policy(),payloadWitness=witness)
                class V9Ops(FakeOps):
                    def __init__(self,image_version):
                        super().__init__();self.image_version=image_version
                    def preflight(self,selected):
                        item=super().preflight(selected)
                        item['imageVersion']=self.image_version
                        item['imageFields']['ImageVersion']['value']=item['imageVersion']
                        item['resource']['membership']='0::/system.slice/bw-ring3-setup-v9-123-1.service\n'
                        item['statusSha256']=sha(pre)
                        return item
                    def acquire(self,package):
                        item=super().acquire(package)
                        item['path']=item['path'].replace('setup-v8-','setup-v9-')
                        return item
                    def dpkg(self,args):
                        item=super().dpkg(args);item['process']['role']='setup-v9'
                        return item
                for image_version in producer.SETUP_V9_IMAGES:
                    alternate=V9Ops(image_version)
                    alternate_result=producer.setup_v8_sequence(alternate,v9_request,producer.SETUP_V9_ROUTE)
                    self.assertIsNone(alternate_result['firstFailure'],alternate_result['firstFailure'])
                    self.assertEqual(alternate.snapshot['preflight']['imageVersion'],image_version)
                ops=V9Ops('20261012.334.1')
                completed=producer.setup_v8_sequence(ops,v9_request,producer.SETUP_V9_ROUTE)
                self.assertIsNone(completed['firstFailure'],completed['firstFailure'])
                setup=ops.snapshot
                status_log=io.BytesIO()
                pre_meta=producer.emit_setup_v8_status('pre',pre,status_log.write,status_log.flush,
                    route=producer.SETUP_V9_ROUTE)
                post_meta=producer.emit_setup_v8_status('post',post,status_log.write,status_log.flush,
                    route=producer.SETUP_V9_ROUTE)
                setup['preflight'].update(statusSha256=sha(pre),statusBytes=len(pre),statusOriginal=pre_meta)
                setup['postStatus'].update(sha256=sha(post),bytes=len(post),records=1226,statusOriginal=post_meta)
                request_raw=reader.canonical(v9_request)
                with self.assertRaises((ValueError,reader.Refusal)):
                    producer.admit_setup_v8_request(request_raw,sha(request_raw))
                with self.assertRaises((ValueError,reader.Refusal)):
                    reader.setup_v8_request(request_raw,sha(request_raw))
                wrap=lambda data:{'bytes':len(data),'sha256':sha(data),'base64':base64.b64encode(data).decode()}
                event=reader.parse(state['originals']['staged.event.json'])
                event['label']['name']='x86-ring3-setup-runtime-inventory-v9'
                event['pull_request']['body']='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V9\n'+sha(request_raw)+'\nBW_RING3_SETUP_RUNTIME_INVENTORY_V9 -->'
                event_raw=reader.canonical(event)
                old_record=reader.parse(reader.prerequisite_original(reader.canonical(state['observation']['stageBefore']['record'])))
                record=copy.deepcopy(old_record)
                record.update(schema='bw.ring3.node-stage-original.v9',request=wrap(request_raw),event=wrap(event_raw),
                    setup=setup,recordBoundary='verified copy after selected setup and policy cleanup, before directory publication')
                record['platform'].pop('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256')
                record['platform'].update(BW_RING3_SETUP_INVENTORY_V9_REQUEST_SHA256=sha(request_raw),
                    BW_RING3_SETUP_INVENTORY_V9_REQUEST_B64=base64.b64encode(request_raw).decode(),
                    GITHUB_JOB='setup-runtime-inventory-v9')
                record['eventIdentity']['st_size']=len(event_raw)
                selected_source=reader.parse(reader.prerequisite_original(reader.canonical(v9_request['source'])))
                class V9Observer:
                    def __init__(self,environ):
                        self.facts={'eventIdentity':record['eventIdentity'],
                            'sourceCommands':record['sourceCommands'],'source':selected_source}
                    def event(self):return event_raw
                    def source(self,selected):
                        self.facts['source']=selected_source
                entry_ops=V9Ops('20261012.334.1');entry_output=io.BytesIO()
                with patch.object(producer.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(producer.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(producer,'expected_cgroup',return_value=None),\
                     patch.object(producer,'HostedEnvelopeInstaller',V9Observer),\
                     patch.object(producer,'SetupV8Host',return_value=entry_ops),\
                     patch.object(producer.sys,'stdout',SimpleNamespace(buffer=entry_output)):
                    self.assertEqual(producer.setup_v8_entry(record['platform'],producer.SETUP_V9_ROUTE),1)
                entry_packet=reader.parse_setup_v9_outer(entry_output.getvalue())
                self.assertEqual(entry_packet['schema'],'bw.ring3.setup-entry-failure.v9')
                self.assertEqual(entry_packet['firstFailure']['phase'],'v9-entry-return')
                self.assertEqual(entry_ops.events[-1],'stage')
                self.assertEqual(entry_ops.events.count('acquire'),15)
                self.assertFalse(entry_packet['actualGuestApproved'])
                self.assertEqual(entry_ops.snapshot['schema'],'bw.ring3.setup-original.v9')
                self.assertEqual(entry_ops.events,ops.events)
                setup=entry_ops.snapshot
                setup['preflight'].update(statusSha256=sha(pre),statusBytes=len(pre),statusOriginal=pre_meta)
                setup['postStatus'].update(sha256=sha(post),bytes=len(post),records=1226,statusOriginal=post_meta)
                record['setup']=setup
                record_raw=reader.canonical(record)
                state['rows']['/event.json'].update(raw=event_raw,st_size=len(event_raw))
                state['rows'][str(producer.NODE_STAGE_RECORD)].update(raw=record_raw,st_size=len(record_raw))
                state['rows']['/proc/self/cgroup']['raw']=b'0::/system.slice/bw-ring3-setup-v9-123-1.service\n'
                v9_env={**record['platform'],'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
                actual_stage=reader.observe_setup_v9_stage(v9_env)
                self.assertIsNone(actual_stage['firstFailure'],actual_stage['firstFailure'])
                self.assertTrue(actual_stage['stageObserved'])
                self.assertEqual(reader.CAPS['jsonBytes'],producer.JSON_CAP)
                pretty=json.dumps(event,indent=2,sort_keys=False).encode()+b'\n'
                reader.setup_v9_event(pretty,v9_request,sha(request_raw),v9_env)
                self.assertEqual(producer.admit_setup_v9_event(pretty,v9_env)[0],request_raw)
                self.assertTrue(event_raw.endswith(b'}\n'))
                append_event=lambda suffix:event_raw[:-2]+suffix+b'\n'
                finite_extra=append_event(b',"ignoredOverflow":1e3}')
                reader.setup_v9_event(finite_extra,v9_request,sha(request_raw),v9_env)
                self.assertEqual(producer.admit_setup_v9_event(finite_extra,v9_env)[0],request_raw)
                bad_event_bytes=(
                    append_event(b',"ignored":{"x":1,"x":2}}'),
                    append_event(b',"ignored":NaN}'),
                    append_event(b',"ignored":Infinity}'),
                    append_event(b',"ignored":-Infinity}'),
                    append_event(b',"ignored":1e999}'),
                    append_event(b',"ignored":-1e999}'),
                    append_event(b',"ignored":"\xff"}'),
                    event_raw+b'{}',b'[]',b' '*(reader.CAPS['jsonBytes']+1))
                self.assertEqual(reader.parse(append_event(b',"ignoredOverflow":1e999}'))['ignoredOverflow'],float('inf'))
                for bad_raw in bad_event_bytes:
                    with self.subTest(rawSuffix=bad_raw[-24:]),self.assertRaises((ValueError,UnicodeError,TypeError,AttributeError)):
                        producer.admit_setup_v9_event(bad_raw,v9_env)
                    with self.subTest(rawSuffix=bad_raw[-24:]),self.assertRaises((reader.Refusal,ValueError,UnicodeError,TypeError)):
                        reader.setup_v9_event(bad_raw,v9_request,sha(request_raw),v9_env)
                files,old_probe=runtime_fixture()
                node=files.facts.pop(reader.RUNTIME_NODE)
                files.facts[reader.NODE_STAGE_TARGET]=dict(node,mode=0o555)
                files.prefixes[reader.NODE_STAGE_TARGET]=files.prefixes.pop(reader.RUNTIME_NODE)
                files.rejected={}
                empty=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES))
                python_files=files.python_files
                files.python_files=lambda:sorted(python_files()+[empty])
                files.empty_python=lambda name:reader.StagedInventoryFiles.empty_python(files,name)
                original_fact=files.fact
                def fact(path):
                    row=original_fact(path)
                    if path==reader.NODE_STAGE_TARGET:
                        files.metadata[path]=copy.deepcopy(actual_stage['files']['node']['before'])
                    return row
                files.fact=fact
                listings={'qemu-system-x86':[reader.RUNTIME_QEMU,reader.RUNTIME_TCG,'/usr/share/qemu/bios.bin'],
                    'qemu-system-common':['/usr/share/qemu/common-keymap'],
                    'qemu-system-data':['/usr/share/qemu/data-blob',*reader.SETUP_V9_SIGNED_DATA],
                    'seabios':['/usr/share/seabios/bios.bin'],'ipxe-qemu':['/usr/share/ipxe/rom.bin']}
                for path,pin in reader.SETUP_V9_SIGNED_DATA.items():
                    files.facts[path]=dict(pin);files.prefixes[path]=b'inert signed DATA mock'
                def probe(argv):
                    process,streams=old_probe(argv)
                    index=len(observed_probes);observed_probes.append(list(argv))
                    process.update(pid=300+index,pgid=300+index,parentPid=101,
                        startTicks=index+1,spawnMonoNs=60000000+index*1000000,reapMonoNs=60001000+index*1000000)
                    if argv==[reader.NODE_STAGE_TARGET,'--version']:streams['stdout']=b'v22.23.3\n'
                    if argv[:2]==['/usr/bin/dpkg-query','-W']:
                        rows={name:(version,arch) for name,version,arch,*_ in reader.SETUP_V9_PACKAGES if name in reader.PACKAGE_NAMES}
                        streams['stdout']=''.join(name+'\t'+rows[name][0]+'\t'+rows[name][1]+'\n' for name in reader.PACKAGE_NAMES).encode()
                    if argv[:2]==['/usr/bin/dpkg-query','-L']:
                        streams['stdout']=('/.\n'+'\n'.join(listings[argv[2]])+'\n').encode()
                    return process,streams
                observed_probes=[]
                entry_originals,entry_passed,entry_safe=reader.setup_v9_inventory_entry(v9_env,files,probe)
                self.assertEqual((entry_passed,entry_safe),(True,True),
                    reader.parse(entry_originals['runtime.setup-inventory.json'])['firstFailure'])
                self.assertEqual(len(observed_probes),15)
                originals=entry_originals
                value=reader.parse(originals['runtime.setup-inventory.json'])
                candidate_raw=reader.prerequisite_original(reader.canonical(value['candidate']))
                output=io.BytesIO();output.write(status_log.getvalue())
                reader.emit_setup_v9_inventory(originals,output.write,output.flush)
                log=output.getvalue()
                unit='bw-ring3-setup-v9-123-1.service';absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
                source=reader.parse(reader.prerequisite_original(reader.canonical(v9_request['source'])))
                admission={'requestSha256':sha(request_raw),'eventSha256':sha(event_raw),
                    'head':v9_request['head'],'tree':v9_request['tree'],'source':source,'unit':unit}
                cleanup=reader.canonical({'schema':'bw.ring3.setup-outside-cleanup.v9','runId':'123',
                    'serviceExitCode':0,'sourceAdmission':admission,'preCensus':absent,
                    'stop':{'attempted':False,'argv':None,'exitCode':None,'timedOut':False},
                    'postCensus':absent,'cgroupTerminal':'absent','unitCensus':None,'policy':None,
                    'action':'not-needed','firstFailure':None,'secondary':[],'setupApproved':False})
                outer=reader.canonical({'schema':'bw.ring3.setup-outer-terminal.v9','runId':'123',
                    'unit':'/sys/fs/cgroup/system.slice/'+unit,'systemdRunExitCode':0,
                    'outsideCleanupExitCode':0,'cgroupAfter':'absent'})
                shell=reader.canonical({'schema':'bw.ring3.setup-image-shell.v9',
                    'fields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                        'ImageVersion':{'present':True,'value':'20261012.334.1'}},'fieldErrors':[],
                    'setupAttempted':False,'guestAttempted':False,'setupApproved':False})
                external={'schema':'bw.ring3.setup-inventory-expectation.v9','requestSha256':sha(request_raw),
                    'runId':'123','attempt':1,'head':request['head'],'tree':request['tree'],
                    'workflowSha':env['GITHUB_WORKFLOW_SHA'],
                    'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                    'jobId':456,'jobName':'setup-runtime-inventory-v9','conclusion':'success',
                    'logBytes':len(log),'logSha256':sha(log),'outerBytes':len(outer),'outerSha256':sha(outer),
                    'cleanupBytes':len(cleanup),'cleanupSha256':sha(cleanup),
                    'shellBytes':len(shell),'shellSha256':sha(shell),'invoker':[1001,1002]}
                verdict=reader.verify_setup_v9_log(log,external,outer,cleanup,shell)
                self.assertTrue(verdict['setupObserved']);self.assertTrue(verdict['outsideTerminalObserved'])
                self.assertFalse(verdict['actualGuestApproved']);self.assertFalse(verdict['officialJobAuthenticated'])
                official_log=(b'2026-10-24T12:00:00Z ##[group]Runner Image\n'
                    b'2026-10-24T12:00:01Z Image: ubuntu-24.04\n'
                    b'2026-10-24T12:00:02Z Version: 20261012.334.1\n'
                    b'2026-10-24T12:00:03Z ##[endgroup]\n'
                    b'2026-10-24T12:00:04Z Complete job name: setup-runtime-inventory-v9\n'
                    b'2026-10-24T12:00:05Z ##[group]Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n')
                run_metadata=reader.canonical({'id':123,'run_attempt':1,'head_sha':v9_request['head'],
                    'event':'pull_request','status':'completed','conclusion':'success',
                    'path':reader.WORKFLOW,'name':'Ring3 INT80 IRETD source controls',
                    'repository':{'full_name':'CrispStrobe/bw-board'},
                    'head_repository':{'full_name':'CrispStrobe/bw-board'},
                    'actor':{'login':'CrispStrobe'},
                    'pull_requests':[{'number':645,'head':{'sha':v9_request['head']}}]})
                step_names=['Set up job',
                    'Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
                    'Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
                    'Bounded v9 package setup and dropped runtime inventory',
                    'Retain v9 setup and runtime originals']
                jobs_metadata=reader.canonical({'total_count':1,'jobs':[{'id':456,'run_id':123,
                    'run_attempt':1,'head_sha':v9_request['head'],'status':'completed',
                    'conclusion':'success','name':'setup-runtime-inventory-v9',
                    'workflow_name':'Ring3 INT80 IRETD source controls',
                    'steps':[{'name':name,'status':'completed','conclusion':'success'} for name in step_names]}]})
                artifact_digest='a'*64
                artifacts_metadata=reader.canonical({'total_count':1,'artifacts':[{'id':789,
                    'name':'i80386-ring3-setup-runtime-inventory-v9-originals','size_in_bytes':4096,
                    'digest':'sha256:'+artifact_digest,'expired':False,
                    'workflow_run':{'id':123,'head_sha':v9_request['head']}}]})
                full_external=dict(external,officialLogBytes=len(official_log),officialLogSha256=sha(official_log),
                    runMetadataBytes=len(run_metadata),runMetadataSha256=sha(run_metadata),
                    jobsMetadataBytes=len(jobs_metadata),jobsMetadataSha256=sha(jobs_metadata),
                    artifactsMetadataBytes=len(artifacts_metadata),artifactsMetadataSha256=sha(artifacts_metadata),
                    artifactId=789,artifactName='i80386-ring3-setup-runtime-inventory-v9-originals',
                    artifactBytes=4096,artifactSha256=artifact_digest,pullRequest=645)
                with patch.object(reader,'SETUP_V9_READER_ENABLED',True):
                    official_verdict=reader.verify_setup_v9_originals(log,full_external,outer,cleanup,shell,
                        official_log,run_metadata,jobs_metadata,artifacts_metadata)
                self.assertTrue(official_verdict['setupObserved'])
                self.assertTrue(official_verdict['officialImageMatchesReported'])
                self.assertFalse(official_verdict['imageFieldsAuthenticated'])
                def official_cut(role,changed):
                    raw=reader.canonical(changed)
                    selected={'run':run_metadata,'jobs':jobs_metadata,
                        'artifacts':artifacts_metadata}
                    selected[role]=raw
                    expected=dict(full_external)
                    expected[role+'MetadataBytes']=len(raw)
                    expected[role+'MetadataSha256']=sha(raw)
                    with patch.object(reader,'SETUP_V9_READER_ENABLED',True),self.assertRaises(reader.Refusal):
                        reader.verify_setup_v9_originals(log,expected,outer,cleanup,shell,
                            official_log,selected['run'],selected['jobs'],selected['artifacts'])
                wrong_run=reader.parse(run_metadata)
                wrong_run['head_sha']='f'*40
                official_cut('run',wrong_run)
                wrong_step=reader.parse(jobs_metadata)
                wrong_step['jobs'][0]['steps'][2]['name']='Run actions/setup-node@wrong'
                official_cut('jobs',wrong_step)
                wrong_artifact=reader.parse(artifacts_metadata)
                wrong_artifact['artifacts'][0]['digest']='sha256:'+'b'*64
                official_cut('artifacts',wrong_artifact)
                for changed_image in (
                    official_log.replace(b'Version: 20261012.334.1',b'Version: 20261023.334.3'),
                    official_log.replace(b'Image: ubuntu-24.04',b'Image: ubuntu-22.04')):
                    changed_external=dict(full_external,officialLogBytes=len(changed_image),
                        officialLogSha256=sha(changed_image))
                    with patch.object(reader,'SETUP_V9_READER_ENABLED',True):
                        image_grade=reader.verify_setup_v9_originals(log,changed_external,outer,cleanup,shell,
                            changed_image,run_metadata,jobs_metadata,artifacts_metadata)
                    self.assertFalse(image_grade['officialImageMatchesReported'])
                    self.assertFalse(image_grade['imageFieldsAuthenticated'])
                self.assertEqual(set(reader.decode_setup_v9_log(log)),set(reader.SETUP_V9_LOG_ROLES))
                self.assertEqual(len(value['inventory']['processes']),15)
                self.assertEqual([row['role'] for row in value['inventory']['probes']],list(reader.SETUP_V9_PROBE_ORDER))
                self.assertEqual({path:value['inventory']['files'][path]['bytes'] for path in reader.SETUP_V9_SIGNED_DATA},
                    {path:pin['bytes'] for path,pin in reader.SETUP_V9_SIGNED_DATA.items()})
                six={'shell-image.original.json':shell,'inventory.original.log':log,
                    'controller.stderr':b'','outside-cleanup.original.json':cleanup,
                    'outside-cleanup.stderr':b'','outer.original.json':outer}
                archive=io.BytesIO()
                with zipfile.ZipFile(archive,'w',zipfile.ZIP_STORED) as output:
                    for name,raw_body in six.items():output.writestr(name,raw_body)
                with zipfile.ZipFile(io.BytesIO(archive.getvalue())) as held:
                    self.assertEqual(set(held.namelist()),set(six))
                    self.assertTrue(all(held.read(name)==raw_body for name,raw_body in six.items()))
                    self.assertLessEqual(held.getinfo('inventory.original.log').file_size,8<<20)
                    self.assertLessEqual(held.getinfo('outside-cleanup.original.json').file_size,16384)
                paths=dict(zip(('log','external','outer','cleanup','shell','official','run','jobs','artifacts'),
                    (log,reader.canonical(full_external),outer,cleanup,shell,official_log,
                     run_metadata,jobs_metadata,artifacts_metadata)))
                argv=['reader.py','--setup-v9-inventory-log','log','--external-admission','external',
                    '--outer-resource-original','outer','--outside-cleanup-original','cleanup',
                    '--shell-image-original','shell','--official-job-log','official',
                    '--official-run-metadata','run','--official-jobs-metadata','jobs',
                    '--official-artifacts-metadata','artifacts']
                with patch.object(reader.sys,'argv',argv),patch.object(reader.sys,'stdout',io.StringIO()) as output,\
                     patch.object(reader.Path,'open',lambda path,*a,**kw:io.BytesIO(paths[str(path)])),\
                     patch.object(reader,'SETUP_V9_READER_ENABLED',True),\
                     patch.object(reader,'setup_v9_inventory_entry',side_effect=AssertionError('no live inventory')),\
                     patch.object(reader,'inventory_probe',side_effect=AssertionError('no metadata child')):
                    reader.main()
                    self.assertTrue(json.loads(output.getvalue())['setupObserved'])
                def regrade(changed,changed_originals=None,changed_outer=outer,changed_cleanup=cleanup,
                            changed_shell=shell,changed_external=None,status_wire=None):
                    roles=dict(originals) if changed_originals is None else dict(changed_originals)
                    roles['runtime.setup-inventory.json']=reader.canonical(changed)
                    stream=io.BytesIO();stream.write(status_log.getvalue() if status_wire is None else status_wire)
                    reader.emit_setup_v9_inventory(roles,stream.write,stream.flush)
                    wire=stream.getvalue()
                    expected=dict(external,logBytes=len(wire),logSha256=sha(wire),
                        outerBytes=len(changed_outer),outerSha256=sha(changed_outer),
                        cleanupBytes=len(changed_cleanup),cleanupSha256=sha(changed_cleanup),
                        shellBytes=len(changed_shell),shellSha256=sha(changed_shell))
                    if changed_external is not None:expected.update(changed_external)
                    with self.assertRaises(reader.Refusal):
                        reader.verify_setup_v9_log(wire,expected,changed_outer,changed_cleanup,changed_shell)
                def replace_stage_record(changed,new_record):
                    raw_record=reader.canonical(new_record)
                    for role in ('stageBefore','stageAfter'):
                        stage=changed[role];stage['record']=wrap(raw_record)
                        file=stage['files']['installation.original.json']
                        file.update(bytes=len(raw_record),sha256=sha(raw_record),prefix=raw_record[:4].hex())
                        for key in ('before','after','namedAfter'):file[key][6]=len(raw_record)
                    return changed
                bad_request=copy.deepcopy(v9_request);bad_request['schema']='bw.ring3.inventory-request.v7'
                bad_request_raw=reader.canonical(bad_request)
                bad_event=copy.deepcopy(event)
                bad_event['pull_request']['body']=bad_event['pull_request']['body'].replace(sha(request_raw),sha(bad_request_raw))
                bad_event_raw=reader.canonical(bad_event)
                bad_record=copy.deepcopy(record);bad_record['request']=wrap(bad_request_raw)
                bad_record['event']=wrap(bad_event_raw)
                bad_record['platform']['BW_RING3_SETUP_INVENTORY_V9_REQUEST_SHA256']=sha(bad_request_raw)
                bad_record['platform']['BW_RING3_SETUP_INVENTORY_V9_REQUEST_B64']=base64.b64encode(bad_request_raw).decode()
                bad_record['eventIdentity']['st_size']=len(bad_event_raw)
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                bad_cleanup=reader.parse(cleanup)
                bad_cleanup['sourceAdmission'].update(requestSha256=sha(bad_request_raw),eventSha256=sha(bad_event_raw))
                regrade(changed,dict(originals,**{'setup.request.json':bad_request_raw,'setup.event.json':bad_event_raw}),
                    changed_cleanup=reader.canonical(bad_cleanup),changed_external={'requestSha256':sha(bad_request_raw)})
                bad_event=copy.deepcopy(event);bad_event['sender']['login']='other'
                bad_event_raw=reader.canonical(bad_event)
                bad_record=copy.deepcopy(record);bad_record['event']=wrap(bad_event_raw)
                bad_record['eventIdentity']['st_size']=len(bad_event_raw)
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                bad_cleanup=reader.parse(cleanup)
                bad_cleanup['sourceAdmission']['eventSha256']=sha(bad_event_raw)
                regrade(changed,dict(originals,**{'setup.event.json':bad_event_raw}),
                    changed_cleanup=reader.canonical(bad_cleanup))
                bad_event_raw=append_event(b',"ignoredOverflow":1e999}')
                bad_record=copy.deepcopy(record);bad_record['event']=wrap(bad_event_raw)
                bad_record['eventIdentity']['st_size']=len(bad_event_raw)
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                bad_cleanup=reader.parse(cleanup)
                bad_cleanup['sourceAdmission']['eventSha256']=sha(bad_event_raw)
                regrade(changed,dict(originals,**{'setup.event.json':bad_event_raw}),
                    changed_cleanup=reader.canonical(bad_cleanup))
                old_event_parser=reader.parse_setup_v9_outer
                changed_roles=dict(originals,**{'setup.event.json':bad_event_raw,
                    'runtime.setup-inventory.json':reader.canonical(changed)})
                changed_stream=io.BytesIO();changed_stream.write(status_log.getvalue())
                reader.emit_setup_v9_inventory(changed_roles,changed_stream.write,changed_stream.flush)
                changed_log=changed_stream.getvalue()
                changed_cleanup=reader.canonical(bad_cleanup)
                changed_external=dict(external,logBytes=len(changed_log),logSha256=sha(changed_log),
                    cleanupBytes=len(changed_cleanup),cleanupSha256=sha(changed_cleanup))
                with patch.object(reader,'parse_setup_v9_outer',side_effect=lambda raw:
                        reader.parse(raw) if raw==bad_event_raw else old_event_parser(raw)):
                    old_parser_verdict=reader.verify_setup_v9_log(changed_log,changed_external,outer,
                        changed_cleanup,shell)
                self.assertTrue(old_parser_verdict['setupObserved'])
                old_version=b'Package: qemu-system-data\nVersion: 1:8.2.2+ds-0ubuntu1.18\n'
                new_version=b'Package: qemu-system-data\nVersion: 1:8.2.2+ds-0ubuntu1.19\n'
                self.assertIn(old_version,post)
                bad_post=post.replace(old_version,new_version)
                bad_status=io.BytesIO()
                producer.emit_setup_v9_status('pre',pre,bad_status.write,bad_status.flush)
                bad_post_meta=producer.emit_setup_v9_status('post',bad_post,bad_status.write,bad_status.flush)
                bad_record=copy.deepcopy(record)
                bad_record['setup']['postStatus'].update(sha256=sha(bad_post),bytes=len(bad_post),statusOriginal=bad_post_meta)
                bad_record['setup']['postStatus']['selected']['qemu-system-data']['Version']='1:8.2.2+ds-0ubuntu1.19'
                changed=replace_stage_record(copy.deepcopy(value),bad_record)
                regrade(changed,status_wire=bad_status.getvalue())
                def coherent_data_change(path,field,replacement):
                    changed=copy.deepcopy(value);candidate=reader.parse(candidate_raw)
                    candidate['files'][path][field]=replacement
                    changed['inventory']['files'][path][field]=replacement
                    if field=='bytes':changed['inventory']['fileMetadata'][path][6]=replacement
                    if field=='mode':changed['inventory']['fileMetadata'][path][2]=stat.S_IFREG|replacement
                    changed_candidate=reader.canonical(candidate)
                    changed['candidate']=changed['inventory']['candidate']=wrap(changed_candidate)
                    return changed
                for path in reader.SETUP_V9_SIGNED_DATA:
                    for field,replacement in (('sha256','0'*64),('bytes',1),('mode',0o600)):
                        changed=coherent_data_change(path,field,replacement)
                        with self.subTest(path=path,field=field):regrade(changed)
                selected_path=next(iter(reader.SETUP_V9_SIGNED_DATA))
                changed=coherent_data_change(selected_path,'sha256','0'*64)
                selected_roles=dict(originals,**{'runtime.setup-inventory.json':reader.canonical(changed)})
                selected_stream=io.BytesIO();selected_stream.write(status_log.getvalue())
                reader.emit_setup_v9_inventory(selected_roles,selected_stream.write,selected_stream.flush)
                selected_wire=selected_stream.getvalue()
                selected_external=dict(external,logBytes=len(selected_wire),logSha256=sha(selected_wire))
                weakened=copy.deepcopy(reader.SETUP_V9_SIGNED_DATA)
                weakened[selected_path]['sha256']='0'*64
                with patch.object(reader,'SETUP_V9_SIGNED_DATA',weakened),\
                     patch.object(reader,'SETUP_V8_SIGNED_DATA',weakened):
                    weakened_verdict=reader.verify_setup_v9_log(selected_wire,selected_external,outer,cleanup,shell)
                self.assertTrue(weakened_verdict['setupObserved'])
                self.assertFalse(weakened_verdict['actualGuestApproved'])
                renamed='/usr/share/qemu/QEMU,other.bin'
                candidate=reader.parse(candidate_raw)
                candidate['files'][renamed]=candidate['files'].pop(selected_path)
                candidate['packagePaths']=sorted(renamed if path==selected_path else path
                    for path in candidate['packagePaths'])
                data_paths=candidate['packagePathsByPackage']['qemu-system-data']
                candidate['packagePathsByPackage']['qemu-system-data']=sorted(
                    renamed if path==selected_path else path for path in data_paths)
                candidate['probes']=reader.setup_v9_probe_descriptors(candidate)
                changed=copy.deepcopy(value)
                changed['inventory']['files']=copy.deepcopy(candidate['files'])
                changed['inventory']['fileMetadata'][renamed]=changed['inventory']['fileMetadata'].pop(selected_path)
                role='package-files-qemu-system-data'
                item=next(probe for probe in changed['inventory']['probes'] if probe['role']==role)
                item['stdout']=item['stdout'].replace(selected_path,renamed)
                process=next(row for row in changed['inventory']['processes'] if row['role']==role)
                process['stdout']=wrap(item['stdout'].encode())
                changed_candidate=reader.canonical(candidate)
                changed['candidate']=changed['inventory']['candidate']=wrap(changed_candidate)
                regrade(changed)
                selected_roles=dict(originals,**{'runtime.setup-inventory.json':reader.canonical(changed)})
                selected_stream=io.BytesIO();selected_stream.write(status_log.getvalue())
                reader.emit_setup_v9_inventory(selected_roles,selected_stream.write,selected_stream.flush)
                selected_wire=selected_stream.getvalue()
                selected_external=dict(external,logBytes=len(selected_wire),logSha256=sha(selected_wire))
                weakened=copy.deepcopy(reader.SETUP_V9_SIGNED_DATA)
                weakened[renamed]=weakened.pop(selected_path)
                with patch.object(reader,'SETUP_V9_SIGNED_DATA',weakened),\
                     patch.object(reader,'SETUP_V8_SIGNED_DATA',weakened):
                    weakened_verdict=reader.verify_setup_v9_log(selected_wire,selected_external,outer,cleanup,shell)
                self.assertTrue(weakened_verdict['setupObserved'])
                changed=copy.deepcopy(value);candidate=reader.parse(candidate_raw)
                alias={'linkText':'other.bin','target':'/usr/share/qemu/other.bin'}
                candidate['aliases'][selected_path]=alias
                changed['inventory']['aliases'][selected_path]=copy.deepcopy(alias)
                changed_candidate=reader.canonical(candidate)
                changed['candidate']=changed['inventory']['candidate']=wrap(changed_candidate)
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['stageAfter']['identity']['groups']=[0]
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['inventory']['probes'][8]['stdout']=changed['inventory']['probes'][8]['stdout'].replace(
                    '/usr/share/qemu/QEMU,VGA.bin','/usr/share/qemu/QEMU,other.bin')
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['stageAfter']['source'][reader.WORKFLOW]['sha256']='0'*64
                regrade(changed)
                changed=copy.deepcopy(value)
                changed['stageBefore']['record']['sha256']='0'*64
                regrade(changed)
                changed=copy.deepcopy(value)
                tampered=dict(originals)
                tampered['setup.request.json']=tampered['setup.request.json'][:-1]+b' '
                regrade(changed,tampered)
                changed_outer=reader.parse(outer);changed_outer['cgroupAfter']='present'
                regrade(copy.deepcopy(value),changed_outer=reader.canonical(changed_outer))
                changed_shell=reader.parse(shell);changed_shell['fields']['ImageVersion']['value']='different'
                regrade(copy.deepcopy(value),changed_shell=reader.canonical(changed_shell))
            self.assertEqual((reader.SETUP_V9_STATUS_SHA,reader.SETUP_V9_STATUS_BYTES,p.SETUP_V9_STATUS_SHA),production)

        def test_v9_activation_and_patched_inactive_cli_refuses_before_every_host_edge(self):
            self.assertIs(p.SETUP_V9_ENABLED,True)
            self.assertIs(reader.SETUP_V9_READER_ENABLED,True)
            self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            for mode,name in (('setup-runtime-inventory-v9','setup_v8_entry'),
                ('cleanup-setup-v9-policy','setup_v8_outside_cleanup'),
                ('setup-v9-image-shell','setup_v8_image_shell')):
                with self.subTest(mode=mode),patch.object(p,'SETUP_V9_ENABLED',False),\
                     patch.object(p,name,side_effect=AssertionError('no host edge')) as edge,\
                     patch.object(p.sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                    self.assertEqual(p.dispatch_cli(['--'+mode],{}),1)
                    edge.assert_not_called()
            with patch.object(reader,'SETUP_V9_READER_ENABLED',False),\
                 patch.object(reader.sys,'argv',['reader.py','--inventory-setup-v9']),\
                 patch.object(reader,'setup_v9_inventory_entry',side_effect=AssertionError('no reader')) as edge:
                with self.assertRaises(reader.Refusal):reader.main()
                edge.assert_not_called()

        def test_v9_active_invalid_event_refuses_before_setup_or_get(self):
            class BadObserver:
                def __init__(self,environ):self.facts={'eventIdentity':{'st_size':3},'sourceCommands':[]}
                def event(self):return b'{}\n'
                def source(self,request):raise AssertionError('invalid event reached source')
            output=io.BytesIO()
            with patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                 patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                 patch.object(p,'HostedEnvelopeInstaller',BadObserver),\
                 patch.object(p,'SetupV8Host',side_effect=AssertionError('no helper or package edge')) as host,\
                 patch.object(p.sys,'stdout',SimpleNamespace(buffer=output)):
                self.assertEqual(p.setup_v8_entry({},p.SETUP_V9_ROUTE),1)
            host.assert_not_called()
            packet=reader.parse_setup_v9_outer(output.getvalue())
            self.assertEqual(packet['schema'],'bw.ring3.setup-entry-failure.v9')
            self.assertIsNone(packet['setup'])
            self.assertFalse(packet['actualGuestApproved'])

        def test_v9_closed_image_set_before_status_or_archive(self):
            limits={'cpu.max':'cpuMax','memory.max':'memoryMax',
                'memory.swap.max':'swapMax','pids.max':'pidsMax'}
            def cgroup(_fd,path):
                path=str(path)
                if path=='/proc/self/cgroup':return '0::/system.slice/bw-ring3-setup-v9-123-1.service\n'
                return p.LIMITS[limits[path.rsplit('/',1)[-1]]]
            for image in (*p.SETUP_V9_IMAGES,'20261025.334.4'):
                host=p.SetupV8Host({'GITHUB_RUN_ID':'123','ImageOS':'ubuntu24',
                    'ImageVersion':image},b'',b'',None,p.SETUP_V9_ROUTE)
                with self.subTest(image=image),patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p.Cgroups,'text',side_effect=cgroup),\
                     patch.object(Path,'exists',return_value=False),\
                     patch.object(Path,'is_symlink',return_value=False),\
                     patch.object(p,'bounded_read',side_effect=RuntimeError('STATUS_REACHED')) as read,\
                     patch.object(host,'acquire',side_effect=AssertionError('GET before preflight')) as get:
                    with self.assertRaises((ValueError,RuntimeError)) as caught:host.preflight({})
                if image in p.SETUP_V9_IMAGES:
                    self.assertEqual(str(caught.exception),'STATUS_REACHED');read.assert_called_once()
                else:
                    self.assertIn('fresh exact hosted image labels',str(caught.exception));read.assert_not_called()
                get.assert_not_called()

        def test_v9_workflow_metadata_route_and_old_v8_adjacent(self):
            workflow=(HERE.parent.parent/'.github/workflows/i80386-ring3-int-iret.yml').read_text()
            start=workflow.index('  setup-runtime-inventory-v9:\n')
            end=workflow.index('  setup-runtime-inventory-v8:\n',start)
            route=workflow[start:end]
            self.assertIn("if: ${{ github.event.action == 'labeled' && github.event.label.name == 'x86-ring3-setup-runtime-inventory-v9'",route)
            self.assertEqual(route.count('actions/checkout@11d5960a326750d5838078e36cf38b85af677262'),1)
            self.assertEqual(route.count('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'),1)
            for term in ('node-version: 22.23.3','--setup-v9-image-shell','--setup-runtime-inventory-v9',
                '--cleanup-setup-v9-policy','--kill-after=5s 720s','RuntimeMaxSec=660','TimeoutStopSec=5',
                'bw-ring3-setup-v9-${GITHUB_RUN_ID}-1'):
                self.assertIn(term,route)
            self.assertNotIn('--hosted-actual',route)

    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure V9 setup controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'dpkg':False,
        'guest':False,'actualRunApproved':False,'pass':True}))


def same_job_official_fixture(facts,version=1):
    """Manufactured official metadata and a closed ZIP around genuine local originals."""
    packet=facts['packet'];handoff=facts['handoff'];source=facts['source']
    selected={"packet/"+name:packet[name] for name in reader.ROLES}
    selected.update({'handoff':handoff,'service':facts['service'],
        'cleanup':facts['cleanup'],'guestOuter':facts['guestOuter'],
        'controllerRuntime':facts['controllerRuntime'],
        'setupLog':facts['setupLog'],'setupOuter':facts['setupOuter'],
        'setupCleanup':facts['setupCleanup'],'setupShell':facts['setupShell']})
    paths={name:'same-job/'+name if not name.startswith('packet/') else name
        for name in selected}
    extra_names=('controller.stderr','outside-cleanup.stderr','guest.stdout',
        'guest.stderr','guest-cleanup.stdout','guest-cleanup.stderr',
        'guest-verdict.original.json')
    extra_data={name:('manufactured '+name+'\n').encode() for name in extra_names}
    extras={name:{'path':'same-job/'+name,'bytes':len(raw),'sha256':sha(raw)}
        for name,raw in extra_data.items()}
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_STORED) as output:
        for name,raw in sorted(selected.items()):output.writestr(paths[name],raw)
        for name,raw in sorted(extra_data.items()):output.writestr(extras[name]['path'],raw)
    artifact=archive.getvalue();head=source['head'];run_id=123;job_id=456;artifact_id=789
    run={'id':run_id,'run_attempt':1,'head_sha':head,'event':'pull_request',
        'status':'completed','conclusion':'success','path':reader.WORKFLOW,
        'repository':{'full_name':'CrispStrobe/bw-board'},
        'head_repository':{'full_name':'CrispStrobe/bw-board'},
        'actor':{'login':'CrispStrobe'},'pull_requests':[{'number':688,
            'head':{'sha':head}}]}
    step_names=('Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
        'Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
        'Bounded same-job setup and authored guest',
        'Bound retained same-job artifact after either outcome',
        'Retain same-job setup and guest originals')
    jobs={'total_count':1,'jobs':[{'id':job_id,'run_id':run_id,'head_sha':head,
        'name':'ring3-same-job-actual-v2' if version==2 else
            'ring3-same-job-actual-v1','status':'completed','conclusion':'success',
        'steps':[{'name':name,'status':'completed','conclusion':'success'}
            for name in step_names]}]}
    artifacts={'total_count':1,'artifacts':[{'id':artifact_id,
        'name':'i80386-ring3-same-job-actual-v2-originals' if version==2 else
            'i80386-ring3-same-job-actual-v1-originals',
        'size_in_bytes':len(artifact),'digest':'sha256:'+sha(artifact),
        'expired':False,'workflow_run':{'id':run_id,'head_sha':head}}]}
    run_raw,jobs_raw,artifacts_raw=map(reader.canonical,(run,jobs,artifacts))
    log=b'manufactured bounded official job log\n'
    external={'schema':'bw.ring3.same-job-actual-official-expectation.v2'
        if version==2 else 'bw.ring3.same-job-actual-official-expectation.v1',
        'runId':'123','jobId':job_id,'artifactId':artifact_id,'attempt':1,
        'head':head,'tree':source['tree'],'workflowSha':facts['workflowSha'],
        'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
        'requestSha256':facts['requestSha256'],'handoffSha256':sha(handoff),
        'jobName':'ring3-same-job-actual-v2' if version==2 else
            'ring3-same-job-actual-v1','conclusion':'success',
        'pullRequest':688,'artifactName':'i80386-ring3-same-job-actual-v2-originals'
            if version==2 else 'i80386-ring3-same-job-actual-v1-originals',
        'artifactBytes':len(artifact),'artifactSha256':sha(artifact),
        'artifactPaths':paths,'artifactExtras':extras,
        'runMetadataBytes':len(run_raw),'runMetadataSha256':sha(run_raw),
        'jobsMetadataBytes':len(jobs_raw),'jobsMetadataSha256':sha(jobs_raw),
        'artifactsMetadataBytes':len(artifacts_raw),
        'artifactsMetadataSha256':sha(artifacts_raw),
        'jobLogBytes':len(log),'jobLogSha256':sha(log),
        'setupExpectation':facts['setupExpectation']}
    return external,(run_raw,jobs_raw,artifacts_raw,log,artifact)


def same_job_official_grade(facts,external,raws,version=1):
    node=facts['node']
    with patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',facts['graph']),\
         patch.object(reader,'SETUP_V9_STATUS_SHA',facts['statusSha256']),\
         patch.object(reader,'SETUP_V9_STATUS_BYTES',facts['statusBytes']),\
         patch.dict(reader.RUNTIME_SELECTED,{'node':{
             'bytes':node['bytes'],'sha256':node['sha256']}}):
        return reader.verify_same_job_actual_official(facts['packet'],facts['handoff'],
            facts['service'],facts['cleanup'],facts['guestOuter'],
            facts['controllerRuntime'],facts['setupLog'],facts['setupOuter'],
            facts['setupCleanup'],facts['setupShell'],*raws,external,version=version)


def same_job_official_cuts(case,facts,external,raws):
    names=('packet-dir','handoff','service','cleanup','guest-outer',
        'controller-runtime','setup-log','setup-outer','setup-cleanup','setup-shell',
        'official-run','official-jobs','official-artifacts','job-log',
        'artifact-zip','external')
    values=('packet',*('original-'+name for name in names[1:]))
    argv=['reader.py','--same-job-actual-official-v1']
    for name,value in zip(names,values):argv.extend(('--'+name,value))
    files={'packet/'+name:raw for name,raw in facts['packet'].items()}
    files.update(zip(values[1:],(facts['handoff'],facts['service'],facts['cleanup'],
        facts['guestOuter'],facts['controllerRuntime'],facts['setupLog'],
        facts['setupOuter'],facts['setupCleanup'],facts['setupShell'],*raws,
        reader.canonical(external))))
    stdout=io.StringIO();node=facts['node']
    with patch.object(reader,'SAME_JOB_ACTUAL_READER_ENABLED',True),\
         patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',facts['graph']),\
         patch.object(reader,'SETUP_V9_STATUS_SHA',facts['statusSha256']),\
         patch.object(reader,'SETUP_V9_STATUS_BYTES',facts['statusBytes']),\
         patch.dict(reader.RUNTIME_SELECTED,{'node':{
             'bytes':node['bytes'],'sha256':node['sha256']}}),\
         patch.object(reader.sys,'argv',argv),\
         patch.object(reader.Path,'open',autospec=True,side_effect=lambda path,*a,**kw:
             io.BytesIO(files[str(path)])),contextlib.redirect_stdout(stdout):
        reader.main()
    case.assertTrue(json.loads(stdout.getvalue())['officialMetadataBound'])
    case.assertFalse(json.loads(stdout.getvalue())['actualRunApproved'])
    altered=dict(facts,setupLog=facts['setupLog'][:-1]+b'X')
    selected=copy.deepcopy(external)
    selected['setupExpectation']['logSha256']=sha(altered['setupLog'])
    with case.assertRaises((reader.Refusal,ValueError)):
        same_job_official_grade(altered,selected,raws)
    changed=list(raws);jobs=reader.parse(changed[1]);steps=jobs['jobs'][0]['steps']
    steps[0],steps[1]=steps[1],steps[0]
    changed[1]=reader.canonical(jobs)
    selected=copy.deepcopy(external)
    selected.update(jobsMetadataBytes=len(changed[1]),jobsMetadataSha256=sha(changed[1]))
    with case.assertRaises(reader.Refusal):
        same_job_official_grade(facts,selected,tuple(changed))
    changed=list(raws);archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_STORED) as output:
        with zipfile.ZipFile(io.BytesIO(changed[4])) as original:
            for entry in original.infolist():
                output.writestr(entry,original.read(entry))
        output.writestr('same-job/unreviewed.original.json',b'{}\n')
    changed[4]=archive.getvalue();metadata=reader.parse(changed[2])
    metadata['artifacts'][0]['size_in_bytes']=len(changed[4])
    metadata['artifacts'][0]['digest']='sha256:'+sha(changed[4])
    changed[2]=reader.canonical(metadata)
    selected=copy.deepcopy(external)
    selected.update(artifactBytes=len(changed[4]),artifactSha256=sha(changed[4]),
        artifactsMetadataBytes=len(changed[2]),artifactsMetadataSha256=sha(changed[2]))
    with case.assertRaises(reader.Refusal):
        same_job_official_grade(facts,selected,tuple(changed))
    changed=list(raws);run=reader.parse(changed[0]);run['head_sha']='f'*40
    changed[0]=reader.canonical(run);selected=copy.deepcopy(external)
    selected.update(runMetadataBytes=len(changed[0]),runMetadataSha256=sha(changed[0]))
    with case.assertRaises(reader.Refusal):
        same_job_official_grade(facts,selected,tuple(changed))


def same_job_actual_controls():
    """Pure first-service boundary controls; all host and guest edges mocked."""
    p,case=producer_fixture_case()
    edges=staged_runtime_controls(export_edges=True)
    def runtime_edges(stage_node):
        files,old_probe=runtime_fixture()
        node=files.facts.pop(reader.RUNTIME_NODE)
        files.facts[reader.NODE_STAGE_TARGET]=dict(node,mode=0o555)
        files.prefixes[reader.NODE_STAGE_TARGET]=files.prefixes.pop(reader.RUNTIME_NODE)
        files.rejected={}
        empty=next(iter(reader.STAGED_EMPTY_PYTHON_SOURCES))
        python_files=files.python_files
        python_extra=['/usr/lib/python3.12/mock'+str(index).zfill(3)+'.py'
            for index in range(241)]
        files.python_files=lambda:sorted(python_files()+[empty,*python_extra])
        files.empty_python=lambda name:reader.StagedInventoryFiles.empty_python(files,name)
        original_fact=files.fact
        def fact(path):
            row=original_fact(path)
            if path==reader.NODE_STAGE_TARGET:
                files.metadata[path]=copy.deepcopy(stage_node)
            return row
        files.fact=fact
        listings={'qemu-system-x86':[reader.RUNTIME_QEMU,reader.RUNTIME_TCG,'/usr/share/qemu/bios.bin'],
            'qemu-system-common':['/usr/share/qemu/common-keymap'],
            'qemu-system-data':['/usr/share/qemu/data-blob',*reader.SETUP_V9_SIGNED_DATA],
            'seabios':['/usr/share/seabios/bios.bin'],'ipxe-qemu':['/usr/share/ipxe/rom.bin']}
        for path,pin in reader.SETUP_V9_SIGNED_DATA.items():
            files.facts[path]=dict(pin);files.prefixes[path]=b'inert signed DATA mock'
        # Add short inert DATA names so the manufactured complete graph exercises
        # the exact selected cardinalities without embedding retained host bytes.
        for index in range(71):
            path='/usr/share/qemu/f'+str(index).zfill(3)
            files.facts[path]={'bytes':1,'sha256':sha(path.encode()),'mode':0o644}
            files.prefixes[path]=b'F'
            listings['qemu-system-data'].append(path)
        for path in python_extra:
            files.facts[path]={'bytes':1,'sha256':sha(path.encode()),'mode':0o644}
            files.prefixes[path]=b'#'
        for index in range(52):
            path='/usr/share/qemu/l'+str(index).zfill(3)
            files.aliases[path]={'linkText':'f000','target':'/usr/share/qemu/f000'}
            listings['qemu-system-data'].append(path)
        observed=[]
        def probe(argv):
            process,streams=old_probe(argv)
            index=len(observed);observed.append(list(argv))
            process.update(pid=300+index,pgid=300+index,parentPid=101,
                startTicks=index+1,spawnMonoNs=60000000+index*1000000,
                reapMonoNs=60001000+index*1000000)
            if argv==[reader.NODE_STAGE_TARGET,'--version']:streams['stdout']=b'v22.23.3\n'
            if argv[:2]==['/usr/bin/dpkg-query','-W']:
                rows={name:(version,arch) for name,version,arch,*_ in reader.SETUP_V9_PACKAGES
                    if name in reader.PACKAGE_NAMES}
                streams['stdout']=''.join(name+'\t'+rows[name][0]+'\t'+rows[name][1]+'\n'
                    for name in reader.PACKAGE_NAMES).encode()
            if argv[:2]==['/usr/bin/dpkg-query','-L']:
                streams['stdout']=('/.\n'+'\n'.join(listings[argv[2]])+'\n').encode()
            return process,streams
        return files,probe,observed
    class Tests(unittest.TestCase):
        def test_selected_comma_regular_runtime_readback_and_drift(self):
            path='/usr/share/qemu/QEMU,VGA.bin';data=b'bounded selected DATA mock'
            value={'qemuPackage':{'files':{path:{'kind':'qemu-data',
                'bytes':len(data),'sha256':sha(data)}},'aliases':{},'probes':[]},
                'executables':{}}
            backend=p.RuntimeFiles()
            with patch.object(backend,'read',side_effect=lambda selected,cap:data):
                observed,failure=p.runtime_facts(value,backend.read,backend.alias,
                    stage='before-guests')
            self.assertEqual(observed,value)
            self.assertIsNone(failure.first)
            with patch.object(backend,'read',side_effect=lambda selected,cap:data+b'X'):
                observed,failure=p.runtime_facts(value,backend.read,backend.alias,
                    stage='after-guests')
            self.assertIsNotNone(failure.first)
            self.assertEqual(failure.first['phase'],'runtime-after-drift')
            self.assertEqual(observed['qemuPackage']['files'][path]['sha256'],sha(data+b'X'))
        def test_connected_v2_first_service_setup_stage_inventory_original(self):
            rom,manifest=pure_fixture()
            architectural,_=manufacture(rom,manifest)
            with v8_manufactured(p,case,architectural) as (
                    old_env,old_expected,old_originals,old_packet,old_selected,
                    old_files,old_state):
                packet_template=dict(old_packet)
            def status_row(name,version,arch='amd64',state='install ok installed',pending=None):
                lines=['Package: '+name,'Version: '+version,'Architecture: '+arch,'Status: '+state]
                if pending is not None:lines.append('Triggers-Pending: '+pending)
                return '\n'.join(lines).encode()
            base=[status_row('installed-'+str(i).zfill(4),'1',
                state='deinstall ok config-files' if i==0 else 'install ok installed')
                for i in range(1210)]
            pre=b'\n\n'.join(base+[status_row('libc-bin','2')])+b'\n'
            selected=[status_row(name,version,arch) for name,version,arch,*_ in p.SETUP_V9_PACKAGE_ROWS]
            post=b'\n\n'.join(base+[status_row('libc-bin','2',state='install ok triggers-pending',pending='ldconfig'),*selected])+b'\n'
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env)
                stage_node=state['observation']['stageBefore']['files']['node']['before']
                files,probe,observed=runtime_edges(stage_node)
                candidate_raw=reader.SetupV9Inventory(stage_node,files,probe).discover()
                candidate=reader.parse(candidate_raw)
                self.assertEqual((len(candidate['files']),len(candidate['aliases'])),(327,55))
                mock_graph=dict(producer.SAME_JOB_REVIEWED_GRAPH,bytes=len(candidate_raw),
                    sha256=sha(candidate_raw))
                FakeOps,witness=setup_v8_controls(export_ops=True)
                actual=copy.deepcopy(request)
                with patch.object(producer,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(producer,'SETUP_V8_STATUS_SHA',sha(pre)):
                    setup_policy=producer.setup_v9_policy()
                actual.update(schema=producer.SAME_JOB_ACTUAL_V2_ROUTE['requestSchema'],
                    setup=setup_policy,payloadWitness=witness,comparison=mock_graph)
                request_raw=reader.canonical(actual);pin=sha(request_raw)
                event=reader.parse(state['originals']['staged.event.json'])
                event['label']['name']=producer.SAME_JOB_ACTUAL_V2_ROUTE['label']
                event['pull_request']['body']='<!-- BW_RING3_SAME_JOB_ACTUAL_V2\n'+pin+\
                    '\nBW_RING3_SAME_JOB_ACTUAL_V2 -->'
                event_raw=reader.canonical(event)
                record=copy.deepcopy(reader.parse(reader.prerequisite_original(
                    reader.canonical(state['observation']['stageBefore']['record']))))
                record.update(schema=producer.SAME_JOB_ACTUAL_V2_ROUTE['stageSchema'],
                    request={'bytes':len(request_raw),'sha256':pin,'base64':base64.b64encode(request_raw).decode()},
                    event={'bytes':len(event_raw),'sha256':sha(event_raw),'base64':base64.b64encode(event_raw).decode()},
                    recordBoundary='verified copy after selected setup and policy cleanup, before directory publication')
                record['platform'].pop('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256')
                record['platform'].update(BW_RING3_SAME_JOB_ACTUAL_V2_REQUEST_SHA256=pin,
                    BW_RING3_SAME_JOB_ACTUAL_V2_REQUEST_B64=base64.b64encode(request_raw).decode(),
                    GITHUB_JOB=producer.SAME_JOB_ACTUAL_V2_ROUTE['job'])
                record['eventIdentity']['st_size']=len(event_raw)
                source=reader.parse(reader.prerequisite_original(reader.canonical(actual['source'])))
                class ActualOps(FakeOps):
                    def preflight(self,selected):
                        item=super().preflight(selected)
                        item['imageVersion']='20261012.334.1'
                        item['imageFields']['ImageVersion']['value']=item['imageVersion']
                        item['resource']['membership']='0::/system.slice/bw-ring3-actual-setup-v2-123-1.service\n'
                        item['statusSha256']=sha(pre)
                        return item
                    def acquire(self,package):
                        item=super().acquire(package)
                        item['path']=item['path'].replace('setup-v8-','actual-setup-v2-')
                        return item
                    def dpkg(self,args):
                        item=super().dpkg(args);item['process']['role']='setup-same-job-v2'
                        return item
                    def cgroup_sample_v2(self,phase,index):
                        census=super().quiescent(phase)
                        identity=901 if self.fault=='unit-cross-phase' and phase=='configure' else 900
                        return {'unitIdentity':[1,identity,stat.S_IFDIR|0o755,0,0,2,0,100],
                            'limits':dict(producer.LIMITS),
                            'cgroupProcs':census['cgroupProcs'],
                            'cgroupEvents':census['cgroupEvents'],
                            'cgroupStat':census['cgroupStat'],
                            'onlyController':census['onlyController'],
                            'firstFailure':None,'secondary':[]}
                class Observer:
                    def __init__(self,environ):
                        self.facts={'eventIdentity':record['eventIdentity'],
                            'sourceCommands':record['sourceCommands'],'source':source}
                    def event(self):return event_raw
                    def source(self,selected):self.facts['source']=source
                real_history=producer.same_job_v2_cgroup_history
                def fixed_history(ops,phase,**kwargs):
                    base=(40_001_001 if phase=='unpack' else 50_001_001)
                    ticks=iter((base,base+1,base+2,base+3))
                    return real_history(ops,phase,clock=lambda:next(ticks),**kwargs)
                with patch.object(producer,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.object(reader,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(reader,'SETUP_V9_STATUS_BYTES',len(pre)),\
                     patch.object(producer,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(producer,'SETUP_V8_STATUS_SHA',sha(pre)),\
                     patch.object(producer,'same_job_v2_cgroup_history',side_effect=fixed_history):
                    self.assertEqual([producer.same_json(actual['setup'],producer.setup_v9_policy()),
                        producer.same_json(actual['payloadWitness'],producer.SETUP_V8_PAYLOAD_PINS),
                        producer.same_json(actual['comparison'],producer.SAME_JOB_REVIEWED_GRAPH)],
                        [True,True,True])
                    entry_ops=ActualOps();entry_output=io.BytesIO()
                    with patch.object(producer.os,'getresuid',return_value=(0,0,0)),\
                         patch.object(producer.os,'getresgid',return_value=(0,0,0)),\
                         patch.object(producer,'expected_cgroup',return_value=None),\
                         patch.object(producer,'HostedEnvelopeInstaller',Observer),\
                         patch.object(producer,'SetupV8Host',return_value=entry_ops),\
                         patch.object(producer.sys,'stdout',SimpleNamespace(buffer=entry_output)):
                        self.assertEqual(producer.setup_v8_entry(record['platform'],producer.SAME_JOB_ACTUAL_V2_ROUTE),1)
                    self.assertEqual(entry_ops.events.count('acquire'),15,
                        reader.parse_setup_v9_outer(entry_output.getvalue())['firstFailure'])
                    self.assertEqual(entry_ops.events[-1],'stage',
                        reader.parse_setup_v9_outer(entry_output.getvalue())['firstFailure'])
                    drift_ops=ActualOps('unit-cross-phase')
                    drift_result=producer.setup_v8_sequence(drift_ops,actual,
                        producer.SAME_JOB_ACTUAL_V2_ROUTE)
                    self.assertIsNotNone(drift_result['firstFailure'])
                    self.assertNotIn('stage',drift_ops.events)
                    def missed_history(ops,phase,**kwargs):
                        if phase!='unpack':return fixed_history(ops,phase,**kwargs)
                        base=40_001_001
                        ticks=iter((base,base+1,base+5_000_000_000))
                        return real_history(ops,phase,clock=lambda:next(ticks),**kwargs)
                    missed_ops=ActualOps()
                    with patch.object(producer,'same_job_v2_cgroup_history',
                            side_effect=missed_history):
                        missed_result=producer.setup_v8_sequence(missed_ops,actual,
                            producer.SAME_JOB_ACTUAL_V2_ROUTE)
                    missed_phase=missed_result['unpack']['cgroupHistory']
                    self.assertEqual((missed_phase['samples'],missed_phase['finalIndex'],
                        missed_result['unpack']['cgroupAfter']),([],None,None))
                    self.assertEqual(missed_result['firstFailure'],
                        missed_phase['firstFailure'])
                    self.assertNotIn('configure',missed_ops.events)
                    self.assertNotIn('stage',missed_ops.events)
                    class ReadErrorOps(ActualOps):
                        def cgroup_sample_v2(self,phase,index):
                            item=super().cgroup_sample_v2(phase,index)
                            item['firstFailure']={'phase':'v2-cgroup-read-close',
                                'name':'OSError','message':'held read/close failure'}
                            return item
                    read_ops=ReadErrorOps()
                    read_result=producer.setup_v8_sequence(read_ops,actual,
                        producer.SAME_JOB_ACTUAL_V2_ROUTE)
                    read_phase=read_result['unpack']['cgroupHistory']
                    self.assertEqual(read_result['firstFailure'],
                        read_phase['samples'][0]['firstFailure'])
                    self.assertEqual(read_phase['finalIndex'],0)
                    self.assertNotIn('configure',read_ops.events)
                    self.assertNotIn('stage',read_ops.events)
                    setup=entry_ops.snapshot
                    status_log=io.BytesIO()
                    pre_meta=producer.emit_setup_v8_status('pre',pre,status_log.write,status_log.flush,
                        route=producer.SAME_JOB_ACTUAL_V2_ROUTE)
                    post_meta=producer.emit_setup_v8_status('post',post,status_log.write,status_log.flush,
                        route=producer.SAME_JOB_ACTUAL_V2_ROUTE)
                    setup['preflight'].update(statusSha256=sha(pre),statusBytes=len(pre),statusOriginal=pre_meta)
                    setup['postStatus'].update(sha256=sha(post),bytes=len(post),records=1226,
                        statusOriginal=post_meta)
                    record['setup']=setup
                    record_raw=reader.canonical(record)
                    state['rows']['/event.json'].update(raw=event_raw,st_size=len(event_raw))
                    state['rows'][str(producer.NODE_STAGE_RECORD)].update(raw=record_raw,st_size=len(record_raw))
                    state['rows']['/proc/self/cgroup']['raw']=b'0::/system.slice/bw-ring3-actual-setup-v2-123-1.service\n'
                    actual_env={**record['platform'],'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
                    files,probe,observed=runtime_edges(stage_node)
                    originals,passed,safe=reader.same_job_actual_inventory_entry(actual_env,files,probe,version=2)
                    self.assertEqual((passed,safe),(True,True),
                        reader.parse(originals['runtime.setup-inventory.json'])['firstFailure'])
                    self.assertEqual(len(observed),15)
                    self.assertEqual(set(originals),set(reader.SAME_JOB_ACTUAL_LOG_ROLES))
                    # Rewrap the complete stage original after moving only a
                    # final census past the next real child spawn. Each sample
                    # remains internally ordered and inside its five-second
                    # deadline; only the cross-phase join can reject it.
                    stage_path=str(producer.NODE_STAGE_RECORD)
                    for phase,next_spawn in (('unpack',50_000_000),):
                        moved=copy.deepcopy(record)
                        last=moved['setup'][phase]['cgroupHistory']['samples'][-1]
                        last['endMonoNs']=next_spawn+1
                        moved_raw=reader.canonical(moved)
                        state['rows'][stage_path].update(raw=moved_raw,st_size=len(moved_raw))
                        observed.clear()
                        refused,accepted,_=reader.same_job_actual_inventory_entry(
                            actual_env,files,probe,version=2)
                        self.assertFalse(accepted,phase)
                        self.assertIn('chronology',reader.parse(
                            refused['runtime.setup-inventory.json'])['firstFailure']['message'])
                    state['rows'][stage_path].update(raw=record_raw,st_size=len(record_raw))
                    observed.clear()
                    wire=io.BytesIO();wire.write(status_log.getvalue())
                    reader.emit_same_job_actual_inventory(originals,wire.write,wire.flush,version=2)
                    self.assertEqual(reader.decode_same_job_actual_log(wire.getvalue(),version=2),originals)
                    unit='bw-ring3-actual-setup-v2-123-1.service'
                    absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
                    admission={'requestSha256':pin,'eventSha256':sha(event_raw),
                        'head':actual['head'],'tree':actual['tree'],'source':source,'unit':unit}
                    cleanup=reader.canonical({'schema':producer.SAME_JOB_ACTUAL_V2_ROUTE['cleanupSchema'],
                        'runId':'123','serviceExitCode':0,'sourceAdmission':admission,
                        'preCensus':absent,'stop':{'attempted':False,'argv':None,'exitCode':None,
                            'timedOut':False},'postCensus':absent,'cgroupTerminal':'absent',
                        'unitCensus':None,'policy':None,'action':'not-needed',
                        'firstFailure':None,'secondary':[],'setupApproved':False})
                    outer=reader.canonical({'schema':'bw.ring3.same-job-setup-outer-terminal.v2',
                        'runId':'123','unit':'/sys/fs/cgroup/system.slice/'+unit,
                        'systemdRunExitCode':0,'outsideCleanupExitCode':0,'cgroupAfter':'absent'})
                    shell=reader.canonical({'schema':producer.SAME_JOB_ACTUAL_V2_ROUTE['shellSchema'],
                        'fields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                            'ImageVersion':{'present':True,'value':'20261012.334.1'}},
                        'fieldErrors':[],'setupAttempted':False,'guestAttempted':False,
                        'setupApproved':False})
                    external={'schema':'bw.ring3.same-job-local-expectation.v2',
                        'requestSha256':pin,'runId':'123','attempt':1,'head':actual['head'],
                        'tree':actual['tree'],'workflowSha':env['GITHUB_WORKFLOW_SHA'],
                        'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                        'jobId':None,'jobName':producer.SAME_JOB_ACTUAL_V2_ROUTE['job'],
                        'conclusion':'observed-zero','logBytes':len(wire.getvalue()),
                        'logSha256':sha(wire.getvalue()),'outerBytes':len(outer),
                        'outerSha256':sha(outer),'cleanupBytes':len(cleanup),
                        'cleanupSha256':sha(cleanup),'shellBytes':len(shell),
                        'shellSha256':sha(shell),'invoker':[1001,1002]}
                    handoff=reader.verify_same_job_actual_setup_log(wire.getvalue(),external,
                        outer,cleanup,shell,version=2)
                    self.assertTrue(handoff['setupObserved'])
                    self.assertEqual(handoff['candidateSha256'],mock_graph['sha256'])
                    self.assertFalse(handoff['actualGuestApproved'])
                    moved_originals=dict(originals)
                    moved_value=reader.parse(originals['runtime.setup-inventory.json'])
                    for side in ('stageBefore','stageAfter'):
                        selected=moved_value[side]['record']
                        stage_record=reader.parse(reader.prerequisite_original(
                            reader.canonical(selected)))
                        stage_record['setup']['configure']['cgroupHistory']['samples'][-1][
                            'endMonoNs']=60_000_001
                        stage_raw=reader.canonical(stage_record)
                        moved_value[side]['record']={'bytes':len(stage_raw),
                            'sha256':sha(stage_raw),'base64':base64.b64encode(stage_raw).decode()}
                        installed=moved_value[side]['files']['installation.original.json']
                        installed.update(bytes=len(stage_raw),sha256=sha(stage_raw),
                            prefix=stage_raw[:4].hex())
                        for field in ('before','after','namedAfter'):
                            installed[field][6]=len(stage_raw)
                    moved_originals['runtime.setup-inventory.json']=reader.canonical(moved_value)
                    moved_wire=io.BytesIO();moved_wire.write(status_log.getvalue())
                    reader.emit_same_job_actual_inventory(moved_originals,
                        moved_wire.write,moved_wire.flush,version=2)
                    moved_external=dict(external,logBytes=len(moved_wire.getvalue()),
                        logSha256=sha(moved_wire.getvalue()))
                    with self.assertRaisesRegex(reader.Refusal,
                            'final strict configure census'):
                        reader.verify_same_job_actual_setup_log(moved_wire.getvalue(),
                            moved_external,outer,cleanup,shell,version=2)
                    held={'setup':wire.getvalue(),'outer':outer,'cleanup':cleanup,'shell':shell}
                    argv=['reader.py','--same-job-handoff-v2','--setup-log','setup',
                        '--outer','outer','--cleanup','cleanup','--shell','shell',
                        '--request-sha',pin,'--run-id','123','--head',actual['head'],
                        '--tree',actual['tree'],'--workflow-sha',env['GITHUB_WORKFLOW_SHA'],
                        '--workflow-file-sha',source['files'][reader.WORKFLOW]['sha256'],
                        '--invoker-uid','1001','--invoker-gid','1002']
                    output=io.BytesIO()
                    with patch.object(reader,'SAME_JOB_ACTUAL_V2_READER_ENABLED',True),\
                         patch.object(reader.sys,'argv',argv),\
                         patch.object(reader.sys,'stdout',SimpleNamespace(buffer=output)),\
                         patch.object(reader.Path,'open',lambda path,*a,**kw:io.BytesIO(held[str(path)])),\
                         patch.object(reader.os,'open',side_effect=AssertionError('no live reader OS edge')):
                        reader.main()
                    selected_handoff=reader.parse(output.getvalue())
                    self.assertEqual(selected_handoff['runtimeCandidate']['bytes'],len(candidate_raw))
                    self.assertEqual(selected_handoff['runId'],'123')
                    self.assertEqual(selected_handoff['requestSha256'],pin)
                    self.assertEqual(selected_handoff['comparisonInput'],mock_graph)
                    self.assertFalse(selected_handoff['actualRunApproved'])
                    selected_env=dict(actual_env,BW_EXPECTED_HEAD=actual['head'],
                        BW_EXPECTED_TREE=actual['tree'],GITHUB_WORKFLOW_SHA=env['GITHUB_WORKFLOW_SHA'],
                        BW_RING3_SAME_JOB_ACTUAL_V2_REQUEST_SHA256=pin)
                    held_raw,held_value,held_candidate,held_graph=producer.admit_same_job_handoff_bytes(
                        output.getvalue(),selected_env,producer.SAME_JOB_ACTUAL_V2_ROUTE)
                    self.assertEqual((held_raw,held_value,held_candidate,held_graph),
                        (output.getvalue(),selected_handoff,candidate_raw,candidate))
                    packet=dict(packet_template)
                    selected_runtime=producer.SameJobRuntimeGate(
                        candidate_raw,candidate).selected_runtime()
                    for phase in ('before','after'):
                        packet['source.'+phase+'.json']=reader.canonical(source)
                        packet['runtime.'+phase+'.json']=reader.canonical(selected_runtime)
                    for role in ('js','qemu'):
                        process=reader.parse(packet[role+'/process.json'])
                        process['argv']=([selected_runtime['executables']['node']['path'],
                            '--input-type=module','--eval',reader.JS_DRIVER]
                            if role=='js' else
                            reader.qemu_argv(selected_runtime['executables']['qemu']['path']))
                        packet[role+'/process.json']=reader.canonical(process)
                    audit=reader.parse(packet['audit.json'])
                    audit.update(head=source['head'],sourceTree=source['tree'],
                        workflowSha256=source['files'][reader.WORKFLOW]['sha256'])
                    audit['roles']=[{'path':name,'bytes':len(packet[name]),
                        'sha256':sha(packet[name])}
                        for name in sorted(reader.ROLES-{'audit.json'})]
                    packet['audit.json']=reader.canonical(audit)
                    observation=lambda start,end:{'files':{
                        path:{key:item[key] for key in ('bytes','sha256','mode')}
                        for path,item in candidate['files'].items()},
                        'aliases':candidate['aliases'],'platform':candidate['platform'],
                        'startMonoNs':start,'finishMonoNs':end}
                    controller_runtime=reader.canonical({
                        'schema':'bw.ring3.same-job-controller-runtime.v2',
                        'handoffSha256':sha(output.getvalue()),
                        'candidateSha256':sha(candidate_raw),
                        'observations':{
                            'before-probes':observation(1,2),
                            'after-probes':observation(3,4),
                            'after-guests':observation(5,6)},
                        'pid':reader.parse(packet['resources.json'])['controller']['pid'],
                        'firstFailure':None,'secondary':[]})
                    packet_verdict=reader.same_job_actual_packet_predicates(
                        packet,selected_handoff,controller_runtime,version=2)
                    self.assertTrue(packet_verdict['guestPredicatesObserved'])
                    handoff_raw=output.getvalue();handoff_pin=sha(handoff_raw)
                    guest_unit='bw-ring3-actual-guest-v2-123-1.service'
                    guest_service=reader.canonical({
                        'schema':'bw.ring3.same-job-guest-service.v2',
                        'requestSha256':pin,'handoffSha256':handoff_pin,
                        'guestPacketComposed':True,'firstFailure':None,'secondary':[]})
                    guest_cleanup=reader.canonical({
                        'schema':'bw.ring3.same-job-guest-outside-cleanup.v2',
                        'runId':'123','unit':guest_unit,'serviceExitCode':0,
                        'sourceAdmission':{'requestSha256':pin,
                            'eventSha256':sha(event_raw),'handoffSha256':handoff_pin,
                            'head':actual['head'],'tree':actual['tree']},
                        'preCensus':absent,'postCensus':absent,
                        'stop':{'attempted':False,'argv':None,'exitCode':None,
                            'timedOut':False},'manualCgroupAbsent':True,
                        'outsideTerminalObserved':True,'firstFailure':None,
                        'secondary':[],'actualGuestApproved':False})
                    guest_outer=reader.canonical({
                        'schema':'bw.ring3.same-job-guest-outer.v2',
                        'runId':'123',
                        'unit':'/sys/fs/cgroup/system.slice/'+guest_unit,
                        'systemdRunExitCode':0,'outsideCleanupExitCode':0,
                        'cgroupAfter':'absent'})
                    guest_verdict=reader.verify_same_job_actual_packet(
                        packet,handoff_raw,guest_service,guest_cleanup,
                        guest_outer,controller_runtime,version=2)
                    self.assertTrue(guest_verdict['guestPredicatesObserved'])
                    self.assertFalse(guest_verdict['actualRunApproved'])
                    drift_files,drift_probe,drift_observed=runtime_edges(stage_node)
                    drift_files.facts['/usr/share/qemu/f001']['sha256']='0'*64
                    drift_originals,drift_passed,drift_safe=reader.same_job_actual_inventory_entry(
                        actual_env,drift_files,drift_probe,version=2)
                    self.assertEqual(len(drift_observed),15)
                    self.assertFalse(drift_passed)
                    self.assertTrue(drift_safe)
                    self.assertIn('fresh same-job full runtime candidate',
                        reader.parse(drift_originals['runtime.setup-inventory.json'])['firstFailure']['message'])
            with v8_manufactured(p,case,architectural) as (
                    old_env,old_expected,old_originals,old_packet,old_selected,
                    old_files,old_state):
                controller_env=dict(actual_env,GITHUB_JOB=producer.SAME_JOB_ACTUAL_V2_ROUTE['job'],
                    BW_RING3_SAME_JOB_ACTUAL_V2_REQUEST_SHA256=pin,
                    BW_RING3_SAME_JOB_ACTUAL_V2_REQUEST_B64=base64.b64encode(request_raw).decode(),
                    BW_RING3_SAME_JOB_HANDOFF_SHA256=sha(handoff_raw),
                    BW_LAUNCH_PLAN_SHA256='0'*64,SUDO_UID='1001',SUDO_GID='1002')
                old_state['data']['source.before.json']=reader.canonical(source)
                for name in ('fixture.rom','fixture.json'):
                    old_state['data']['inputs/'+name]=packet_template['inputs/'+name]
                owner=reader.parse(old_state['data']['.entry.json'])
                owner['sourceSha256']=sha(old_state['data']['source.before.json'])
                old_state['data']['.entry.json']=reader.canonical(owner)
                for name in ('runtime.before.json','.controller.before.json',
                    '.controller.json','source.after.json','runtime.after.json',
                    'js/process.json','js/stdout','js/stderr','qemu/process.json',
                    'qemu/stdout','qemu/stderr','qemu/report.json'):
                    old_state['data'].pop(name,None)
                def cgroup_observe(groups,role):
                    snapshot=copy.deepcopy(owner['cgroups'][role])
                    if role=='controller':
                        snapshot['procs']=[100]
                    if role in ('enclosing','controller'):
                        snapshot['raw']['pidsCurrent']='1\n'
                        snapshot['raw']['cgroupEvents']='populated 1\nfrozen 0\n'
                    return snapshot
                observe=lambda path:{key:candidate['files'][path][key]
                    for key in ('bytes','sha256','mode')}
                fixture_write=p.write_new
                def controller_write(path,raw,cap):
                    path=Path(path)
                    if path.is_relative_to(p.PACKET):
                        self.assertLessEqual(len(raw),cap)
                        name=path.relative_to(p.PACKET).as_posix()
                        self.assertNotIn(name,old_state['data'])
                        old_state['data'][name]=raw
                    else:fixture_write(path,raw,cap)
                def child_observation(child,role,argv,**kwargs):
                    self.assertIn(role,('js','qemu'))
                    process=reader.parse(packet[role+'/process.json'])
                    self.assertEqual(process['argv'],argv)
                    process['parentPid']=100
                    return process,{'stdout':packet[role+'/stdout'],
                        'stderr':packet[role+'/stderr']}
                runtime_originals={}
                def retain_runtime(name,raw):
                    self.assertNotIn(name,runtime_originals)
                    runtime_originals[name]=raw
                    return raw
                with patch.object(p,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(p,'ROM_SHA',reader.ROM_SHA),\
                     patch.object(p,'FIXTURE_JSON_SHA',reader.FIXTURE_JSON_SHA),\
                     patch.object(p,'GENERATION_NODE_PIN',(
                         selected_handoff['stageCopy']['nodeReadback']['bytes'],
                         selected_handoff['stageCopy']['nodeReadback']['sha256'])),\
                     patch.object(p,'same_job_handoff',return_value=(
                         handoff_raw,selected_handoff,candidate_raw,candidate)),\
                     patch.object(p,'HostedEnvelopeInstaller',side_effect=lambda environ:
                         SimpleNamespace(event=lambda:event_raw)),\
                     patch.object(p,'source_facts',side_effect=lambda selected,**kw:
                         (copy.deepcopy(selected),p.FirstFailure())),\
                     patch.object(p,'runtime_facts',side_effect=lambda selected,*args,**kw:
                         (copy.deepcopy(selected),p.FirstFailure())),\
                     patch.object(p,'write_new',side_effect=controller_write),\
                     patch.object(p,'collect_child',side_effect=child_observation),\
                     patch.object(p,'runtime_delivery_original',side_effect=retain_runtime),\
                     patch.object(p,'entry_proc',side_effect=lambda path:
                         '0::/bw-ring3-123-1/controller\n' if str(path).endswith('cgroup')
                         else ''.join(k+':\t'+'0'*16+'\n' for k in
                             ('CapInh','CapPrm','CapEff','CapAmb'))),\
                     patch.object(p.SameJobRuntimeFiles,'fact',side_effect=observe),\
                     patch.object(p.SameJobRuntimeFiles,'alias',side_effect=lambda path:
                         candidate['aliases'][path]),\
                     patch.object(p.SameJobRuntimeFiles,'platform',return_value=candidate['platform']):
                    with patch.object(p.Cgroups,'observe',autospec=True,side_effect=cgroup_observe):
                        ops,controller_failure=p.controller_execute(
                            p.SameJobControllerOps(controller_env))
                self.assertIsNone(controller_failure.first,controller_failure.first)
                self.assertIn('controller.runtime.json',runtime_originals)
                self.assertEqual(set(ops.processes),{'js','qemu'})
                built_packet={name:old_state['data'].get(name,packet[name])
                    for name in reader.ROLES if name!='audit.json'}
                built_resources=reader.parse(built_packet['resources.json'])
                built_resources['controller']['pid']=100
                built_resources['controller']['before']['procs']=[100]
                built_packet['resources.json']=reader.canonical(built_resources)
                built_audit=reader.parse(packet['audit.json'])
                built_audit['roles']=[{'path':name,'bytes':len(built_packet[name]),
                    'sha256':sha(built_packet[name])} for name in sorted(built_packet)]
                built_packet['audit.json']=reader.canonical(built_audit)
                self.assertEqual((reader.parse(runtime_originals['controller.runtime.json'])['handoffSha256'],
                    reader.parse(runtime_originals['controller.runtime.json'])['pid']),
                    (sha(handoff_raw),reader.parse(built_packet['resources.json'])['controller']['pid']))
                with patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.dict(reader.RUNTIME_SELECTED,{'node':{
                        'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                        'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']} }):
                    built_verdict=reader.verify_same_job_actual_packet(built_packet,
                        handoff_raw,guest_service,guest_cleanup,guest_outer,
                        runtime_originals['controller.runtime.json'],version=2)
                self.assertTrue(built_verdict['guestPredicatesObserved'])
                final_env=dict(controller_env)
                final_env['GITHUB_EVENT_PATH']='/event.json'
                final_plan=reader.canonical({'schema':'bw.ring3.launch-plan.v1',
                    'runId':'123','attempt':1,'head':actual['head'],
                    'tree':actual['tree'],'source':actual['source']})
                final_env['BW_LAUNCH_PLAN_SHA256']=sha(final_plan)
                def git_trace(raw,phase):
                    item=reader.parse(raw);item['source']=source
                    listing=''.join(source['files'][name]['mode']+' blob '+
                        source['files'][name]['blob']+'\t'+name+'\n'
                        for name in sorted(source['files']))
                    outputs=(source['head']+'\n',source['tree']+'\n',listing)
                    for command,value in zip(item['commands'],outputs):
                        command['stdoutHex']=value.encode().hex()
                    return reader.canonical(item)
                pre_git=git_trace(old_originals['git.before.json'],'before')
                post_git=git_trace(old_originals['git.after.json'],'after')
                generation=reader.parse(old_originals['generation.phase.json'])
                node_path=p.RUNTIME_EXECUTABLES['node']
                node_fact={'path':node_path,
                    'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                    'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']}
                generation_files={'node':dict(node_fact)}
                for role,name in (('fixture','fixture.mjs'),('runner','run.py')):
                    path='scripts/i80386-ring3-int-iret/'+name
                    generation_files[role]={'path':path,
                        'bytes':source['files'][path]['bytes'],
                        'sha256':source['files'][path]['sha256']}
                for when in ('before','after'):
                    generation[when]['files']=copy.deepcopy(generation_files)
                input_refs={name:{'bytes':len(old_state['data']['inputs/'+name]),
                    'sha256':sha(old_state['data']['inputs/'+name])}
                    for name in ('fixture.rom','fixture.json')}
                generation['outputs']=input_refs
                generation_raw=reader.canonical(generation)
                phase=reader.parse(old_originals['preparation.phase.json'])
                phase['process']['argv'][-1]='--same-job-prepare-v2'
                phase['process']['environment']=dict(p.ENV,**{
                    name:final_env[name] for name in p.SAME_JOB_V2_CHILD_ENV},
                    SUDO_UID='1001',SUDO_GID='1002')
                phase['preGit']={'bytes':len(pre_git),'sha256':sha(pre_git)}
                pre_stream=p.generation_frame(generation_raw,pre_git)
                phase['stdout']={'bytes':len(pre_stream),'sha256':sha(pre_stream),
                    'base64':base64.b64encode(pre_stream).decode()}
                phase_raw=reader.canonical(phase)
                outside_record=reader.parse(old_state['data']['.outside.json'])
                outside_record['process']['argv'][-1]='--same-job-bootstrap-v2'
                outside_record['process']['pid']=100
                outside_record['process']['pgid']=100
                outside_record['process']['environment']=dict(p.ENV,**{
                    name:final_env[name] for name in p.SAME_JOB_V2_CHILD_ENV},
                    SUDO_UID='1001',SUDO_GID='1002')
                old_state['data']['.outside.json']=reader.canonical(outside_record)
                outside_facts={key:value for key,value in outside_record.items()
                    if key not in ('firstFailure','secondary','streamsHex')}
                selection={'requestRaw':request_raw,'request':actual,
                    'handoffRaw':handoff_raw,'handoff':selected_handoff,
                    'candidateRaw':candidate_raw,'candidate':candidate}
                old_state['export'].clear();old_state['directories'].clear()
                post=SimpleNamespace(capture=lambda head:(post_git,p.FirstFailure()))
                with patch.object(p,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(p,'GENERATION_NODE_PIN',(
                         node_fact['bytes'],node_fact['sha256'])),\
                     patch.object(p,'ROM_SHA',reader.ROM_SHA),\
                     patch.object(p,'FIXTURE_JSON_SHA',reader.FIXTURE_JSON_SHA):
                    context=p.SameJobFinalizerContext(selection,final_env,p.SAME_JOB_ACTUAL_V2_ROUTE)
                    finalized,final_failure=p.finalize_runtime_packet(context,
                        outside_facts,p.FirstFailure(),pre_git,final_env,
                        post_observer=post,preparation_original=phase_raw,
                        generation_original=generation_raw,
                        launch_plan_original=final_plan,
                        launch_plan_sha256=sha(final_plan),
                        emit=lambda raw:len(raw),flush=lambda:None)
                self.assertTrue(finalized['pass'],final_failure.first)
                self.assertIsNone(final_failure.first)
                self.assertEqual(set(old_state['export']),reader.ROLES)
                with patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.dict(reader.RUNTIME_SELECTED,{'node':{
                        'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                        'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']} }):
                    exported_verdict=reader.verify_same_job_actual_packet(
                        old_state['export'],handoff_raw,guest_service,guest_cleanup,
                        guest_outer,runtime_originals['controller.runtime.json'],version=2)
                self.assertTrue(exported_verdict['guestPredicatesObserved'])
                self.assertFalse(exported_verdict['actualRunApproved'])
                wrapper_calls=[];wrapper_originals={};uid_state={'uid':0,'gid':0}
                guest_env=dict(final_env)
                fake_setup=SimpleNamespace(environ=guest_env,
                    expected_plan_sha256=sha(final_plan),plan_original=final_plan,
                    invoker={'uid':1001,'gid':1002},
                    verify=lambda:wrapper_calls.append('verify'))
                def setup_prepare():
                    wrapper_calls.append('prepare')
                    return {'pass':True},p.FirstFailure()
                fake_setup.prepare=setup_prepare
                def composition_validate(composition):
                    self.assertIsInstance(composition,p.SameJobEntryComposition)
                    self.assertEqual(composition.runtime_context.selection['handoffRaw'],
                        handoff_raw)
                    composition.bootstrap.invoker={'uid':1001,'gid':1002}
                    composition.python=reader.parse(old_state['data']['.entry.json'])['python']
                def composition_prepare(composition,failure):
                    self.assertIsNone(failure.first)
                    composition._launch_plan_original=final_plan
                    composition._preparation_original=phase_raw
                    composition._generation_original=generation_raw
                    composition.pre_git=pre_git
                    composition.preparation={'process':reader.parse(phase_raw)['process'],
                        'streams':{'stdout':pre_stream,'stderr':b''}}
                    return failure
                def composition_outside(composition):
                    self.assertEqual(composition._launch_plan_original,final_plan)
                    wrapper_calls.append('compose')
                    uid_state.update(uid=1001,gid=1002)
                    p.entry_ids(1001,1002)
                    return outside_facts,p.FirstFailure()
                class MockPostGit(p.GitObservation):
                    def capture(self,head):
                        self.assert_head=head
                        return post.capture(head)
                def selected_plan(selection,environ):
                    self.assertEqual(selection['candidateRaw'],candidate_raw)
                    self.assertEqual(selection['handoffRaw'],handoff_raw)
                    wrapper_calls.append('plan')
                    return final_plan,dict(environ,BW_LAUNCH_PLAN_SHA256=sha(final_plan))
                def selected_sink(setup):
                    self.assertIs(setup,fake_setup)
                    wrapper_calls.append('sink')
                def retained_service(path,raw,cap):
                    path=Path(path)
                    if path.is_relative_to(p.EXPORT):
                        return fixture_write(path,raw,cap)
                    self.assertLessEqual(len(raw),cap)
                    self.assertNotIn(str(path),wrapper_originals)
                    wrapper_originals[str(path)]=raw
                    wrapper_calls.append('retained')
                def reject_changed_handoff(fault):
                    rejected_handoff=copy.deepcopy(selected_handoff)
                    if fault=='source':
                        rejected_handoff['source']['head']='f'*40
                    else:
                        rejected_handoff['stageCopy']['nodeReadback']['sha256']='f'*64
                    refused,refusal=p.same_job_guest_service(guest_env,route=p.SAME_JOB_ACTUAL_V2_ROUTE,
                        event_reader=lambda:event_raw,
                        handoff_reader=lambda selected,route:(handoff_raw,
                            rejected_handoff,candidate_raw,candidate))
                    self.assertFalse(refused['pass'],fault)
                    self.assertIsNotNone(refusal.first,fault)
                    self.assertEqual(wrapper_calls,[],fault)
                with patch.object(p,'SAME_JOB_ACTUAL_V2_ENABLED',True),\
                     patch.object(p,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(p,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(p,'SETUP_V8_STATUS_SHA',sha(pre)),\
                     patch.object(p,'GENERATION_NODE_PIN',(
                         node_fact['bytes'],node_fact['sha256'])),\
                     patch.object(p,'entry_proc',side_effect=lambda path:
                         ''.join(key+':\t'+'0'*16+'\n' for key in
                             ('CapInh','CapPrm','CapEff','CapAmb'))
                         if str(path).endswith('/status') else
                         '0::/system.slice/bw-ring3-actual-guest-v2-123-1.service\n'),\
                     patch.object(p.Cgroups,'text',side_effect=lambda unused,path:
                         p.SAME_JOB_GUEST_LIMITS[Path(path).name]),\
                     patch.object(p,'source_facts',side_effect=lambda selected,**kw:
                         (copy.deepcopy(selected),p.FirstFailure())),\
                     patch.object(p.SameJobRuntimeFiles,'fact',side_effect=observe),\
                     patch.object(p.SameJobRuntimeFiles,'alias',side_effect=lambda path:
                         candidate['aliases'][path]),\
                     patch.object(p.SameJobRuntimeFiles,'platform',return_value=candidate['platform']),\
                     patch.object(p,'same_job_create_launch_plan',side_effect=selected_plan),\
                     patch.object(p,'HostedSetupOps',return_value=fake_setup),\
                     patch.object(p,'same_job_create_runtime_sink',side_effect=selected_sink),\
                     patch.multiple(p.SameJobEntryComposition,
                         validate=composition_validate,prepare=composition_prepare,
                         outside=composition_outside),\
                     patch.object(p,'GitObservation',MockPostGit),\
                     patch.object(p,'write_new',side_effect=retained_service),\
                     patch.multiple(p.os,getresuid=lambda:(uid_state['uid'],)*3,
                         getresgid=lambda:(uid_state['gid'],)*3),\
                     patch.object(p.os,'getgroups',return_value=[]):
                    wrong_event=copy.deepcopy(event)
                    wrong_event['label']['name']='x86-ring3-setup-runtime-inventory-v9'
                    refused,refusal=p.same_job_guest_service(guest_env,route=p.SAME_JOB_ACTUAL_V2_ROUTE,
                        event_reader=lambda:reader.canonical(wrong_event),
                        handoff_reader=lambda selected,route:(handoff_raw,
                            selected_handoff,candidate_raw,candidate))
                    self.assertFalse(refused['pass'])
                    self.assertIsNotNone(refusal.first)
                    self.assertEqual(wrapper_calls,[])
                    reject_changed_handoff('source')
                    reject_changed_handoff('stage')
                    old_state['export'].clear();old_state['directories'].clear()
                    wrapper_result,wrapper_failure=p.same_job_guest_service(
                        guest_env,route=p.SAME_JOB_ACTUAL_V2_ROUTE,event_reader=lambda:event_raw,
                        handoff_reader=lambda selected,route:(handoff_raw,selected_handoff,
                            candidate_raw,candidate))
                self.assertTrue(wrapper_result['pass'],wrapper_failure.first)
                self.assertTrue(wrapper_result['composition']['final']['pass'])
                self.assertEqual(set(old_state['export']),reader.ROLES)
                self.assertIsNone(wrapper_failure.first)
                self.assertEqual(wrapper_calls,['plan','prepare','sink','compose','retained'])
                self.assertEqual(set(wrapper_originals),{
                    'build/i80386-ring3-same-job-actual-v2/guest.service.original.json'})
                self.assertIs(reader.parse(next(iter(wrapper_originals.values())))[
                    'guestPacketComposed'],True)
                official_facts={'packet':dict(old_state['export']),
                    'handoff':handoff_raw,'service':next(iter(wrapper_originals.values())),
                    'cleanup':guest_cleanup,'guestOuter':guest_outer,
                    'controllerRuntime':runtime_originals['controller.runtime.json'],
                    'setupLog':wire.getvalue(),'setupOuter':outer,
                    'setupCleanup':cleanup,'setupShell':shell,
                    'setupExpectation':external,'source':source,
                    'workflowSha':env['GITHUB_WORKFLOW_SHA'],'requestSha256':pin,
                    'graph':mock_graph,'node':node_fact,
                    'statusSha256':sha(pre),'statusBytes':len(pre)}
                official_external,official_raws=same_job_official_fixture(official_facts,version=2)
                official_verdict=same_job_official_grade(official_facts,
                    official_external,official_raws,version=2)
                self.assertTrue(official_verdict['officialMetadataBound'])
                self.assertTrue(official_verdict['guestPredicatesObserved'])
                self.assertFalse(official_verdict['actualRunApproved'])
                wrong_external=dict(official_external,jobName='ring3-same-job-actual-v1')
                with self.assertRaises(reader.Refusal):
                    same_job_official_grade(official_facts,wrong_external,official_raws,version=2)
                wrong_run=reader.parse(official_raws[0]);wrong_run['head_sha']='f'*40
                wrong_raw=reader.canonical(wrong_run)
                wrong_external=dict(official_external,runMetadataBytes=len(wrong_raw),
                    runMetadataSha256=sha(wrong_raw))
                with self.assertRaises(reader.Refusal):
                    same_job_official_grade(official_facts,wrong_external,
                        (wrong_raw,*official_raws[1:]),version=2)


        def test_connected_first_service_setup_stage_inventory_original(self):
            rom,manifest=pure_fixture()
            architectural,_=manufacture(rom,manifest)
            with v8_manufactured(p,case,architectural) as (
                    old_env,old_expected,old_originals,old_packet,old_selected,
                    old_files,old_state):
                packet_template=dict(old_packet)
            def status_row(name,version,arch='amd64',state='install ok installed',pending=None):
                lines=['Package: '+name,'Version: '+version,'Architecture: '+arch,'Status: '+state]
                if pending is not None:lines.append('Triggers-Pending: '+pending)
                return '\n'.join(lines).encode()
            base=[status_row('installed-'+str(i).zfill(4),'1',
                state='deinstall ok config-files' if i==0 else 'install ok installed')
                for i in range(1210)]
            pre=b'\n\n'.join(base+[status_row('libc-bin','2')])+b'\n'
            selected=[status_row(name,version,arch) for name,version,arch,*_ in p.SETUP_V9_PACKAGE_ROWS]
            post=b'\n\n'.join(base+[status_row('libc-bin','2',state='install ok triggers-pending',pending='ldconfig'),*selected])+b'\n'
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env)
                stage_node=state['observation']['stageBefore']['files']['node']['before']
                files,probe,observed=runtime_edges(stage_node)
                candidate_raw=reader.SetupV9Inventory(stage_node,files,probe).discover()
                candidate=reader.parse(candidate_raw)
                self.assertEqual((len(candidate['files']),len(candidate['aliases'])),(327,55))
                mock_graph=dict(producer.SAME_JOB_REVIEWED_GRAPH,bytes=len(candidate_raw),
                    sha256=sha(candidate_raw))
                FakeOps,witness=setup_v8_controls(export_ops=True)
                actual=copy.deepcopy(request)
                with patch.object(producer,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(producer,'SETUP_V8_STATUS_SHA',sha(pre)):
                    setup_policy=producer.setup_v9_policy()
                actual.update(schema=producer.SAME_JOB_ACTUAL_ROUTE['requestSchema'],
                    setup=setup_policy,payloadWitness=witness,comparison=mock_graph)
                request_raw=reader.canonical(actual);pin=sha(request_raw)
                event=reader.parse(state['originals']['staged.event.json'])
                event['label']['name']=producer.SAME_JOB_ACTUAL_ROUTE['label']
                event['pull_request']['body']='<!-- BW_RING3_SAME_JOB_ACTUAL_V1\n'+pin+\
                    '\nBW_RING3_SAME_JOB_ACTUAL_V1 -->'
                event_raw=reader.canonical(event)
                record=copy.deepcopy(reader.parse(reader.prerequisite_original(
                    reader.canonical(state['observation']['stageBefore']['record']))))
                record.update(schema=producer.SAME_JOB_ACTUAL_ROUTE['stageSchema'],
                    request={'bytes':len(request_raw),'sha256':pin,'base64':base64.b64encode(request_raw).decode()},
                    event={'bytes':len(event_raw),'sha256':sha(event_raw),'base64':base64.b64encode(event_raw).decode()},
                    recordBoundary='verified copy after selected setup and policy cleanup, before directory publication')
                record['platform'].pop('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256')
                record['platform'].update(BW_RING3_SAME_JOB_ACTUAL_REQUEST_SHA256=pin,
                    BW_RING3_SAME_JOB_ACTUAL_REQUEST_B64=base64.b64encode(request_raw).decode(),
                    GITHUB_JOB=producer.SAME_JOB_ACTUAL_ROUTE['job'])
                record['eventIdentity']['st_size']=len(event_raw)
                source=reader.parse(reader.prerequisite_original(reader.canonical(actual['source'])))
                class ActualOps(FakeOps):
                    def preflight(self,selected):
                        item=super().preflight(selected)
                        item['imageVersion']='20261012.334.1'
                        item['imageFields']['ImageVersion']['value']=item['imageVersion']
                        item['resource']['membership']='0::/system.slice/bw-ring3-actual-setup-v1-123-1.service\n'
                        item['statusSha256']=sha(pre)
                        return item
                    def acquire(self,package):
                        item=super().acquire(package)
                        item['path']=item['path'].replace('setup-v8-','actual-setup-v1-')
                        return item
                    def dpkg(self,args):
                        item=super().dpkg(args);item['process']['role']='setup-same-job-v1'
                        return item
                class Observer:
                    def __init__(self,environ):
                        self.facts={'eventIdentity':record['eventIdentity'],
                            'sourceCommands':record['sourceCommands'],'source':source}
                    def event(self):return event_raw
                    def source(self,selected):self.facts['source']=source
                with patch.object(producer,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.object(reader,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(reader,'SETUP_V9_STATUS_BYTES',len(pre)),\
                     patch.object(producer,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(producer,'SETUP_V8_STATUS_SHA',sha(pre)):
                    self.assertEqual([producer.same_json(actual['setup'],producer.setup_v9_policy()),
                        producer.same_json(actual['payloadWitness'],producer.SETUP_V8_PAYLOAD_PINS),
                        producer.same_json(actual['comparison'],producer.SAME_JOB_REVIEWED_GRAPH)],
                        [True,True,True])
                    entry_ops=ActualOps();entry_output=io.BytesIO()
                    with patch.object(producer.os,'getresuid',return_value=(0,0,0)),\
                         patch.object(producer.os,'getresgid',return_value=(0,0,0)),\
                         patch.object(producer,'expected_cgroup',return_value=None),\
                         patch.object(producer,'HostedEnvelopeInstaller',Observer),\
                         patch.object(producer,'SetupV8Host',return_value=entry_ops),\
                         patch.object(producer.sys,'stdout',SimpleNamespace(buffer=entry_output)):
                        self.assertEqual(producer.setup_v8_entry(record['platform'],producer.SAME_JOB_ACTUAL_ROUTE),1)
                    self.assertEqual(entry_ops.events.count('acquire'),15,
                        reader.parse_setup_v9_outer(entry_output.getvalue())['firstFailure'])
                    self.assertEqual(entry_ops.events[-1],'stage')
                    setup=entry_ops.snapshot
                    status_log=io.BytesIO()
                    pre_meta=producer.emit_setup_v8_status('pre',pre,status_log.write,status_log.flush,
                        route=producer.SAME_JOB_ACTUAL_ROUTE)
                    post_meta=producer.emit_setup_v8_status('post',post,status_log.write,status_log.flush,
                        route=producer.SAME_JOB_ACTUAL_ROUTE)
                    setup['preflight'].update(statusSha256=sha(pre),statusBytes=len(pre),statusOriginal=pre_meta)
                    setup['postStatus'].update(sha256=sha(post),bytes=len(post),records=1226,
                        statusOriginal=post_meta)
                    record['setup']=setup
                    record_raw=reader.canonical(record)
                    state['rows']['/event.json'].update(raw=event_raw,st_size=len(event_raw))
                    state['rows'][str(producer.NODE_STAGE_RECORD)].update(raw=record_raw,st_size=len(record_raw))
                    state['rows']['/proc/self/cgroup']['raw']=b'0::/system.slice/bw-ring3-actual-setup-v1-123-1.service\n'
                    actual_env={**record['platform'],'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
                    files,probe,observed=runtime_edges(stage_node)
                    originals,passed,safe=reader.same_job_actual_inventory_entry(actual_env,files,probe)
                    self.assertEqual((passed,safe),(True,True),
                        reader.parse(originals['runtime.setup-inventory.json'])['firstFailure'])
                    self.assertEqual(len(observed),15)
                    self.assertEqual(set(originals),set(reader.SAME_JOB_ACTUAL_LOG_ROLES))
                    wire=io.BytesIO();wire.write(status_log.getvalue())
                    reader.emit_same_job_actual_inventory(originals,wire.write,wire.flush)
                    self.assertEqual(reader.decode_same_job_actual_log(wire.getvalue()),originals)
                    unit='bw-ring3-actual-setup-v1-123-1.service'
                    absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
                    admission={'requestSha256':pin,'eventSha256':sha(event_raw),
                        'head':actual['head'],'tree':actual['tree'],'source':source,'unit':unit}
                    cleanup=reader.canonical({'schema':producer.SAME_JOB_ACTUAL_ROUTE['cleanupSchema'],
                        'runId':'123','serviceExitCode':0,'sourceAdmission':admission,
                        'preCensus':absent,'stop':{'attempted':False,'argv':None,'exitCode':None,
                            'timedOut':False},'postCensus':absent,'cgroupTerminal':'absent',
                        'unitCensus':None,'policy':None,'action':'not-needed',
                        'firstFailure':None,'secondary':[],'setupApproved':False})
                    outer=reader.canonical({'schema':'bw.ring3.same-job-setup-outer-terminal.v1',
                        'runId':'123','unit':'/sys/fs/cgroup/system.slice/'+unit,
                        'systemdRunExitCode':0,'outsideCleanupExitCode':0,'cgroupAfter':'absent'})
                    shell=reader.canonical({'schema':producer.SAME_JOB_ACTUAL_ROUTE['shellSchema'],
                        'fields':{'ImageOS':{'present':True,'value':'ubuntu24'},
                            'ImageVersion':{'present':True,'value':'20261012.334.1'}},
                        'fieldErrors':[],'setupAttempted':False,'guestAttempted':False,
                        'setupApproved':False})
                    external={'schema':'bw.ring3.same-job-local-expectation.v1',
                        'requestSha256':pin,'runId':'123','attempt':1,'head':actual['head'],
                        'tree':actual['tree'],'workflowSha':env['GITHUB_WORKFLOW_SHA'],
                        'workflowFileSha256':source['files'][reader.WORKFLOW]['sha256'],
                        'jobId':None,'jobName':producer.SAME_JOB_ACTUAL_ROUTE['job'],
                        'conclusion':'observed-zero','logBytes':len(wire.getvalue()),
                        'logSha256':sha(wire.getvalue()),'outerBytes':len(outer),
                        'outerSha256':sha(outer),'cleanupBytes':len(cleanup),
                        'cleanupSha256':sha(cleanup),'shellBytes':len(shell),
                        'shellSha256':sha(shell),'invoker':[1001,1002]}
                    handoff=reader.verify_same_job_actual_setup_log(wire.getvalue(),external,
                        outer,cleanup,shell)
                    self.assertTrue(handoff['setupObserved'])
                    self.assertEqual(handoff['candidateSha256'],mock_graph['sha256'])
                    self.assertFalse(handoff['actualGuestApproved'])
                    held={'setup':wire.getvalue(),'outer':outer,'cleanup':cleanup,'shell':shell}
                    argv=['reader.py','--same-job-handoff-v1','--setup-log','setup',
                        '--outer','outer','--cleanup','cleanup','--shell','shell',
                        '--request-sha',pin,'--run-id','123','--head',actual['head'],
                        '--tree',actual['tree'],'--workflow-sha',env['GITHUB_WORKFLOW_SHA'],
                        '--workflow-file-sha',source['files'][reader.WORKFLOW]['sha256'],
                        '--invoker-uid','1001','--invoker-gid','1002']
                    output=io.BytesIO()
                    with patch.object(reader,'SAME_JOB_ACTUAL_READER_ENABLED',True),\
                         patch.object(reader.sys,'argv',argv),\
                         patch.object(reader.sys,'stdout',SimpleNamespace(buffer=output)),\
                         patch.object(reader.Path,'open',lambda path,*a,**kw:io.BytesIO(held[str(path)])),\
                         patch.object(reader.os,'open',side_effect=AssertionError('no live reader OS edge')):
                        reader.main()
                    selected_handoff=reader.parse(output.getvalue())
                    self.assertEqual(selected_handoff['runtimeCandidate']['bytes'],len(candidate_raw))
                    self.assertEqual(selected_handoff['runId'],'123')
                    self.assertEqual(selected_handoff['requestSha256'],pin)
                    self.assertFalse(selected_handoff['actualRunApproved'])
                    packet=dict(packet_template)
                    selected_runtime=producer.SameJobRuntimeGate(
                        candidate_raw,candidate).selected_runtime()
                    for phase in ('before','after'):
                        packet['source.'+phase+'.json']=reader.canonical(source)
                        packet['runtime.'+phase+'.json']=reader.canonical(selected_runtime)
                    for role in ('js','qemu'):
                        process=reader.parse(packet[role+'/process.json'])
                        process['argv']=([selected_runtime['executables']['node']['path'],
                            '--input-type=module','--eval',reader.JS_DRIVER]
                            if role=='js' else
                            reader.qemu_argv(selected_runtime['executables']['qemu']['path']))
                        packet[role+'/process.json']=reader.canonical(process)
                    audit=reader.parse(packet['audit.json'])
                    audit.update(head=source['head'],sourceTree=source['tree'],
                        workflowSha256=source['files'][reader.WORKFLOW]['sha256'])
                    audit['roles']=[{'path':name,'bytes':len(packet[name]),
                        'sha256':sha(packet[name])}
                        for name in sorted(reader.ROLES-{'audit.json'})]
                    packet['audit.json']=reader.canonical(audit)
                    observation=lambda start,end:{'files':{
                        path:{key:item[key] for key in ('bytes','sha256','mode')}
                        for path,item in candidate['files'].items()},
                        'aliases':candidate['aliases'],'platform':candidate['platform'],
                        'startMonoNs':start,'finishMonoNs':end}
                    controller_runtime=reader.canonical({
                        'schema':'bw.ring3.same-job-controller-runtime.v1',
                        'handoffSha256':sha(output.getvalue()),
                        'candidateSha256':sha(candidate_raw),
                        'observations':{
                            'before-probes':observation(1,2),
                            'after-probes':observation(3,4),
                            'after-guests':observation(5,6)},
                        'pid':reader.parse(packet['resources.json'])['controller']['pid'],
                        'firstFailure':None,'secondary':[]})
                    packet_verdict=reader.same_job_actual_packet_predicates(
                        packet,selected_handoff,controller_runtime)
                    self.assertTrue(packet_verdict['guestPredicatesObserved'])
                    handoff_raw=output.getvalue();handoff_pin=sha(handoff_raw)
                    guest_unit='bw-ring3-actual-guest-v1-123-1.service'
                    guest_service=reader.canonical({
                        'schema':'bw.ring3.same-job-guest-service.v1',
                        'requestSha256':pin,'handoffSha256':handoff_pin,
                        'guestPacketComposed':True,'firstFailure':None,'secondary':[]})
                    guest_cleanup=reader.canonical({
                        'schema':'bw.ring3.same-job-guest-outside-cleanup.v1',
                        'runId':'123','unit':guest_unit,'serviceExitCode':0,
                        'sourceAdmission':{'requestSha256':pin,
                            'eventSha256':sha(event_raw),'handoffSha256':handoff_pin,
                            'head':actual['head'],'tree':actual['tree']},
                        'preCensus':absent,'postCensus':absent,
                        'stop':{'attempted':False,'argv':None,'exitCode':None,
                            'timedOut':False},'manualCgroupAbsent':True,
                        'outsideTerminalObserved':True,'firstFailure':None,
                        'secondary':[],'actualGuestApproved':False})
                    guest_outer=reader.canonical({
                        'schema':'bw.ring3.same-job-guest-outer-terminal.v1',
                        'runId':'123',
                        'unit':'/sys/fs/cgroup/system.slice/'+guest_unit,
                        'systemdRunExitCode':0,'outsideCleanupExitCode':0,
                        'cgroupAfter':'absent'})
                    guest_verdict=reader.verify_same_job_actual_packet(
                        packet,handoff_raw,guest_service,guest_cleanup,
                        guest_outer,controller_runtime)
                    self.assertTrue(guest_verdict['guestPredicatesObserved'])
                    self.assertFalse(guest_verdict['actualRunApproved'])
                    drift_files,drift_probe,drift_observed=runtime_edges(stage_node)
                    drift_files.facts['/usr/share/qemu/f001']['sha256']='0'*64
                    drift_originals,drift_passed,drift_safe=reader.same_job_actual_inventory_entry(
                        actual_env,drift_files,drift_probe)
                    self.assertEqual(len(drift_observed),15)
                    self.assertFalse(drift_passed)
                    self.assertTrue(drift_safe)
                    self.assertIn('fresh same-job full runtime candidate',
                        reader.parse(drift_originals['runtime.setup-inventory.json'])['firstFailure']['message'])
            with v8_manufactured(p,case,architectural) as (
                    old_env,old_expected,old_originals,old_packet,old_selected,
                    old_files,old_state):
                controller_env=dict(actual_env,GITHUB_JOB=producer.SAME_JOB_ACTUAL_ROUTE['job'],
                    BW_RING3_SAME_JOB_ACTUAL_REQUEST_SHA256=pin,
                    BW_RING3_SAME_JOB_ACTUAL_REQUEST_B64=base64.b64encode(request_raw).decode(),
                    BW_RING3_SAME_JOB_HANDOFF_SHA256=sha(handoff_raw),
                    BW_LAUNCH_PLAN_SHA256='0'*64,SUDO_UID='1001',SUDO_GID='1002')
                old_state['data']['source.before.json']=reader.canonical(source)
                for name in ('fixture.rom','fixture.json'):
                    old_state['data']['inputs/'+name]=packet_template['inputs/'+name]
                owner=reader.parse(old_state['data']['.entry.json'])
                owner['sourceSha256']=sha(old_state['data']['source.before.json'])
                old_state['data']['.entry.json']=reader.canonical(owner)
                for name in ('runtime.before.json','.controller.before.json',
                    '.controller.json','source.after.json','runtime.after.json',
                    'js/process.json','js/stdout','js/stderr','qemu/process.json',
                    'qemu/stdout','qemu/stderr','qemu/report.json'):
                    old_state['data'].pop(name,None)
                def cgroup_observe(groups,role):
                    snapshot=copy.deepcopy(owner['cgroups'][role])
                    if role=='controller':
                        snapshot['procs']=[100]
                    if role in ('enclosing','controller'):
                        snapshot['raw']['pidsCurrent']='1\n'
                        snapshot['raw']['cgroupEvents']='populated 1\nfrozen 0\n'
                    return snapshot
                observe=lambda path:{key:candidate['files'][path][key]
                    for key in ('bytes','sha256','mode')}
                fixture_write=p.write_new
                def controller_write(path,raw,cap):
                    path=Path(path)
                    if path.is_relative_to(p.PACKET):
                        self.assertLessEqual(len(raw),cap)
                        name=path.relative_to(p.PACKET).as_posix()
                        self.assertNotIn(name,old_state['data'])
                        old_state['data'][name]=raw
                    else:fixture_write(path,raw,cap)
                def child_observation(child,role,argv,**kwargs):
                    self.assertIn(role,('js','qemu'))
                    process=reader.parse(packet[role+'/process.json'])
                    self.assertEqual(process['argv'],argv)
                    process['parentPid']=100
                    return process,{'stdout':packet[role+'/stdout'],
                        'stderr':packet[role+'/stderr']}
                runtime_originals={}
                def retain_runtime(name,raw):
                    self.assertNotIn(name,runtime_originals)
                    runtime_originals[name]=raw
                    return raw
                with patch.object(p,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(p,'ROM_SHA',reader.ROM_SHA),\
                     patch.object(p,'FIXTURE_JSON_SHA',reader.FIXTURE_JSON_SHA),\
                     patch.object(p,'GENERATION_NODE_PIN',(
                         selected_handoff['stageCopy']['nodeReadback']['bytes'],
                         selected_handoff['stageCopy']['nodeReadback']['sha256'])),\
                     patch.object(p,'same_job_handoff',return_value=(
                         handoff_raw,selected_handoff,candidate_raw,candidate)),\
                     patch.object(p,'HostedEnvelopeInstaller',side_effect=lambda environ:
                         SimpleNamespace(event=lambda:event_raw)),\
                     patch.object(p,'source_facts',side_effect=lambda selected,**kw:
                         (copy.deepcopy(selected),p.FirstFailure())),\
                     patch.object(p,'runtime_facts',side_effect=lambda selected,*args,**kw:
                         (copy.deepcopy(selected),p.FirstFailure())),\
                     patch.object(p,'write_new',side_effect=controller_write),\
                     patch.object(p,'collect_child',side_effect=child_observation),\
                     patch.object(p,'runtime_delivery_original',side_effect=retain_runtime),\
                     patch.object(p,'entry_proc',side_effect=lambda path:
                         '0::/bw-ring3-123-1/controller\n' if str(path).endswith('cgroup')
                         else ''.join(k+':\t'+'0'*16+'\n' for k in
                             ('CapInh','CapPrm','CapEff','CapAmb'))),\
                     patch.object(p.SameJobRuntimeFiles,'fact',side_effect=observe),\
                     patch.object(p.SameJobRuntimeFiles,'alias',side_effect=lambda path:
                         candidate['aliases'][path]),\
                     patch.object(p.SameJobRuntimeFiles,'platform',return_value=candidate['platform']):
                    with patch.object(p.Cgroups,'observe',autospec=True,side_effect=cgroup_observe):
                        ops,controller_failure=p.controller_execute(
                            p.SameJobControllerOps(controller_env))
                self.assertIsNone(controller_failure.first,controller_failure.first)
                self.assertIn('controller.runtime.json',runtime_originals)
                self.assertEqual(set(ops.processes),{'js','qemu'})
                built_packet={name:old_state['data'].get(name,packet[name])
                    for name in reader.ROLES if name!='audit.json'}
                built_resources=reader.parse(built_packet['resources.json'])
                built_resources['controller']['pid']=100
                built_resources['controller']['before']['procs']=[100]
                built_packet['resources.json']=reader.canonical(built_resources)
                built_audit=reader.parse(packet['audit.json'])
                built_audit['roles']=[{'path':name,'bytes':len(built_packet[name]),
                    'sha256':sha(built_packet[name])} for name in sorted(built_packet)]
                built_packet['audit.json']=reader.canonical(built_audit)
                self.assertEqual((reader.parse(runtime_originals['controller.runtime.json'])['handoffSha256'],
                    reader.parse(runtime_originals['controller.runtime.json'])['pid']),
                    (sha(handoff_raw),reader.parse(built_packet['resources.json'])['controller']['pid']))
                with patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.dict(reader.RUNTIME_SELECTED,{'node':{
                        'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                        'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']} }):
                    built_verdict=reader.verify_same_job_actual_packet(built_packet,
                        handoff_raw,guest_service,guest_cleanup,guest_outer,
                        runtime_originals['controller.runtime.json'])
                self.assertTrue(built_verdict['guestPredicatesObserved'])
                final_env=dict(controller_env)
                final_env['GITHUB_EVENT_PATH']='/event.json'
                final_plan=reader.canonical({'schema':'bw.ring3.launch-plan.v1',
                    'runId':'123','attempt':1,'head':actual['head'],
                    'tree':actual['tree'],'source':actual['source']})
                final_env['BW_LAUNCH_PLAN_SHA256']=sha(final_plan)
                def git_trace(raw,phase):
                    item=reader.parse(raw);item['source']=source
                    listing=''.join(source['files'][name]['mode']+' blob '+
                        source['files'][name]['blob']+'\t'+name+'\n'
                        for name in sorted(source['files']))
                    outputs=(source['head']+'\n',source['tree']+'\n',listing)
                    for command,value in zip(item['commands'],outputs):
                        command['stdoutHex']=value.encode().hex()
                    return reader.canonical(item)
                pre_git=git_trace(old_originals['git.before.json'],'before')
                post_git=git_trace(old_originals['git.after.json'],'after')
                generation=reader.parse(old_originals['generation.phase.json'])
                node_path=p.RUNTIME_EXECUTABLES['node']
                node_fact={'path':node_path,
                    'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                    'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']}
                generation_files={'node':dict(node_fact)}
                for role,name in (('fixture','fixture.mjs'),('runner','run.py')):
                    path='scripts/i80386-ring3-int-iret/'+name
                    generation_files[role]={'path':path,
                        'bytes':source['files'][path]['bytes'],
                        'sha256':source['files'][path]['sha256']}
                for when in ('before','after'):
                    generation[when]['files']=copy.deepcopy(generation_files)
                input_refs={name:{'bytes':len(old_state['data']['inputs/'+name]),
                    'sha256':sha(old_state['data']['inputs/'+name])}
                    for name in ('fixture.rom','fixture.json')}
                generation['outputs']=input_refs
                generation_raw=reader.canonical(generation)
                phase=reader.parse(old_originals['preparation.phase.json'])
                phase['process']['argv'][-1]='--same-job-prepare-v1'
                phase['process']['environment']=dict(p.ENV,**{
                    name:final_env[name] for name in p.SAME_JOB_CHILD_ENV},
                    SUDO_UID='1001',SUDO_GID='1002')
                phase['preGit']={'bytes':len(pre_git),'sha256':sha(pre_git)}
                pre_stream=p.generation_frame(generation_raw,pre_git)
                phase['stdout']={'bytes':len(pre_stream),'sha256':sha(pre_stream),
                    'base64':base64.b64encode(pre_stream).decode()}
                phase_raw=reader.canonical(phase)
                outside_record=reader.parse(old_state['data']['.outside.json'])
                outside_record['process']['argv'][-1]='--same-job-bootstrap-v1'
                outside_record['process']['pid']=100
                outside_record['process']['pgid']=100
                outside_record['process']['environment']=dict(p.ENV,**{
                    name:final_env[name] for name in p.SAME_JOB_CHILD_ENV},
                    SUDO_UID='1001',SUDO_GID='1002')
                old_state['data']['.outside.json']=reader.canonical(outside_record)
                outside_facts={key:value for key,value in outside_record.items()
                    if key not in ('firstFailure','secondary','streamsHex')}
                selection={'requestRaw':request_raw,'request':actual,
                    'handoffRaw':handoff_raw,'handoff':selected_handoff,
                    'candidateRaw':candidate_raw,'candidate':candidate}
                old_state['export'].clear();old_state['directories'].clear()
                post=SimpleNamespace(capture=lambda head:(post_git,p.FirstFailure()))
                with patch.object(p,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(p,'GENERATION_NODE_PIN',(
                         node_fact['bytes'],node_fact['sha256'])),\
                     patch.object(p,'ROM_SHA',reader.ROM_SHA),\
                     patch.object(p,'FIXTURE_JSON_SHA',reader.FIXTURE_JSON_SHA):
                    context=p.SameJobFinalizerContext(selection,final_env)
                    finalized,final_failure=p.finalize_runtime_packet(context,
                        outside_facts,p.FirstFailure(),pre_git,final_env,
                        post_observer=post,preparation_original=phase_raw,
                        generation_original=generation_raw,
                        launch_plan_original=final_plan,
                        launch_plan_sha256=sha(final_plan),
                        emit=lambda raw:len(raw),flush=lambda:None)
                self.assertTrue(finalized['pass'],final_failure.first)
                self.assertIsNone(final_failure.first)
                self.assertEqual(set(old_state['export']),reader.ROLES)
                with patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.dict(reader.RUNTIME_SELECTED,{'node':{
                        'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                        'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']} }):
                    exported_verdict=reader.verify_same_job_actual_packet(
                        old_state['export'],handoff_raw,guest_service,guest_cleanup,
                        guest_outer,runtime_originals['controller.runtime.json'])
                self.assertTrue(exported_verdict['guestPredicatesObserved'])
                self.assertFalse(exported_verdict['actualRunApproved'])
                packet_dir='packet'
                role_files={str(Path(packet_dir)/name):raw
                    for name,raw in old_state['export'].items()}
                role_files.update(handoff=handoff_raw,service=guest_service,
                    cleanup=guest_cleanup,outer=guest_outer,
                    controller=runtime_originals['controller.runtime.json'])
                local_argv=['reader.py','--same-job-actual-packet-v1',
                    '--packet-dir',packet_dir,'--handoff','handoff',
                    '--service','service','--cleanup','cleanup',
                    '--guest-outer','outer','--controller-runtime','controller']
                text_output=io.StringIO()
                with patch.object(reader,'SAME_JOB_ACTUAL_READER_ENABLED',True),\
                     patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.dict(reader.RUNTIME_SELECTED,{'node':{
                         'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                         'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']} }),\
                     patch.object(reader.sys,'argv',local_argv),\
                     patch.object(reader.Path,'open',autospec=True,side_effect=lambda path,*a,**kw:
                         io.BytesIO(role_files[str(path)])),\
                     contextlib.redirect_stdout(text_output):
                    reader.main()
                local_result=json.loads(text_output.getvalue())
                self.assertTrue(local_result['guestPredicatesObserved'])
                self.assertFalse(local_result['officialMetadataBound'])
                changed_packet=dict(old_state['export'])
                changed_packet['qemu/stdout']=changed_packet['qemu/stdout'][:-1]+b'X'
                changed_report=reader.parse(changed_packet['qemu/report.json'])
                changed_report['outputSha256']=sha(changed_packet['qemu/stdout'])
                changed_packet['qemu/report.json']=reader.canonical(changed_report)
                changed_audit=reader.parse(changed_packet['audit.json'])
                changed_audit['roles']=[{'path':name,'bytes':len(changed_packet[name]),
                    'sha256':sha(changed_packet[name])}
                    for name in sorted(reader.ROLES-{'audit.json'})]
                changed_packet['audit.json']=reader.canonical(changed_audit)
                with patch.object(reader,'SAME_JOB_ACTUAL_REVIEWED_GRAPH',mock_graph),\
                     patch.dict(reader.RUNTIME_SELECTED,{'node':{
                         'bytes':selected_handoff['stageCopy']['nodeReadback']['bytes'],
                         'sha256':selected_handoff['stageCopy']['nodeReadback']['sha256']} }):
                    with self.assertRaisesRegex(reader.Refusal,'wire framing'):
                        reader.verify_same_job_actual_packet(changed_packet,
                            handoff_raw,guest_service,guest_cleanup,guest_outer,
                            runtime_originals['controller.runtime.json'])
                    changed_cleanup=reader.parse(guest_cleanup)
                    changed_cleanup['serviceExitCode']=1
                    changed_outer=reader.parse(guest_outer)
                    changed_outer['systemdRunExitCode']=1
                    with self.assertRaises(reader.Refusal):
                        reader.verify_same_job_actual_packet(old_state['export'],
                            handoff_raw,guest_service,reader.canonical(changed_cleanup),
                            reader.canonical(changed_outer),
                            runtime_originals['controller.runtime.json'])
                wrapper_calls=[];wrapper_originals={};uid_state={'uid':0,'gid':0}
                guest_env=dict(final_env)
                fake_setup=SimpleNamespace(environ=guest_env,
                    expected_plan_sha256=sha(final_plan),plan_original=final_plan,
                    invoker={'uid':1001,'gid':1002},
                    verify=lambda:wrapper_calls.append('verify'))
                def setup_prepare():
                    wrapper_calls.append('prepare')
                    return {'pass':True},p.FirstFailure()
                fake_setup.prepare=setup_prepare
                def composition_validate(composition):
                    self.assertIsInstance(composition,p.SameJobEntryComposition)
                    self.assertEqual(composition.runtime_context.selection['handoffRaw'],
                        handoff_raw)
                    composition.bootstrap.invoker={'uid':1001,'gid':1002}
                    composition.python=reader.parse(old_state['data']['.entry.json'])['python']
                def composition_prepare(composition,failure):
                    self.assertIsNone(failure.first)
                    composition._launch_plan_original=final_plan
                    composition._preparation_original=phase_raw
                    composition._generation_original=generation_raw
                    composition.pre_git=pre_git
                    composition.preparation={'process':reader.parse(phase_raw)['process'],
                        'streams':{'stdout':pre_stream,'stderr':b''}}
                    return failure
                def composition_outside(composition):
                    self.assertEqual(composition._launch_plan_original,final_plan)
                    wrapper_calls.append('compose')
                    uid_state.update(uid=1001,gid=1002)
                    p.entry_ids(1001,1002)
                    return outside_facts,p.FirstFailure()
                class MockPostGit(p.GitObservation):
                    def capture(self,head):
                        self.assert_head=head
                        return post.capture(head)
                def selected_plan(selection,environ):
                    self.assertEqual(selection['candidateRaw'],candidate_raw)
                    self.assertEqual(selection['handoffRaw'],handoff_raw)
                    wrapper_calls.append('plan')
                    return final_plan,dict(environ,BW_LAUNCH_PLAN_SHA256=sha(final_plan))
                def selected_sink(setup):
                    self.assertIs(setup,fake_setup)
                    wrapper_calls.append('sink')
                def retained_service(path,raw,cap):
                    path=Path(path)
                    if path.is_relative_to(p.EXPORT):
                        return fixture_write(path,raw,cap)
                    self.assertLessEqual(len(raw),cap)
                    self.assertNotIn(str(path),wrapper_originals)
                    wrapper_originals[str(path)]=raw
                    wrapper_calls.append('retained')
                def reject_changed_handoff(fault):
                    rejected_handoff=copy.deepcopy(selected_handoff)
                    if fault=='source':
                        rejected_handoff['source']['head']='f'*40
                    else:
                        rejected_handoff['stageCopy']['nodeReadback']['sha256']='f'*64
                    refused,refusal=p.same_job_guest_service(guest_env,
                        event_reader=lambda:event_raw,
                        handoff_reader=lambda selected:(handoff_raw,
                            rejected_handoff,candidate_raw,candidate))
                    self.assertFalse(refused['pass'],fault)
                    self.assertIsNotNone(refusal.first,fault)
                    self.assertEqual(wrapper_calls,[],fault)
                with patch.object(p,'SAME_JOB_ACTUAL_ENABLED',True),\
                     patch.object(p,'SAME_JOB_REVIEWED_GRAPH',mock_graph),\
                     patch.object(p,'SETUP_V9_STATUS_SHA',sha(pre)),\
                     patch.object(p,'SETUP_V8_STATUS_SHA',sha(pre)),\
                     patch.object(p,'GENERATION_NODE_PIN',(
                         node_fact['bytes'],node_fact['sha256'])),\
                     patch.object(p,'entry_proc',side_effect=lambda path:
                         ''.join(key+':\t'+'0'*16+'\n' for key in
                             ('CapInh','CapPrm','CapEff','CapAmb'))
                         if str(path).endswith('/status') else
                         '0::/system.slice/bw-ring3-actual-guest-v1-123-1.service\n'),\
                     patch.object(p.Cgroups,'text',side_effect=lambda unused,path:
                         p.SAME_JOB_GUEST_LIMITS[Path(path).name]),\
                     patch.object(p,'source_facts',side_effect=lambda selected,**kw:
                         (copy.deepcopy(selected),p.FirstFailure())),\
                     patch.object(p.SameJobRuntimeFiles,'fact',side_effect=observe),\
                     patch.object(p.SameJobRuntimeFiles,'alias',side_effect=lambda path:
                         candidate['aliases'][path]),\
                     patch.object(p.SameJobRuntimeFiles,'platform',return_value=candidate['platform']),\
                     patch.object(p,'same_job_create_launch_plan',side_effect=selected_plan),\
                     patch.object(p,'HostedSetupOps',return_value=fake_setup),\
                     patch.object(p,'same_job_create_runtime_sink',side_effect=selected_sink),\
                     patch.multiple(p.SameJobEntryComposition,
                         validate=composition_validate,prepare=composition_prepare,
                         outside=composition_outside),\
                     patch.object(p,'GitObservation',MockPostGit),\
                     patch.object(p,'write_new',side_effect=retained_service),\
                     patch.multiple(p.os,getresuid=lambda:(uid_state['uid'],)*3,
                         getresgid=lambda:(uid_state['gid'],)*3),\
                     patch.object(p.os,'getgroups',return_value=[]):
                    wrong_event=copy.deepcopy(event)
                    wrong_event['label']['name']='x86-ring3-setup-runtime-inventory-v9'
                    refused,refusal=p.same_job_guest_service(guest_env,
                        event_reader=lambda:reader.canonical(wrong_event),
                        handoff_reader=lambda selected:(handoff_raw,
                            selected_handoff,candidate_raw,candidate))
                    self.assertFalse(refused['pass'])
                    self.assertIsNotNone(refusal.first)
                    self.assertEqual(wrapper_calls,[])
                    reject_changed_handoff('source')
                    reject_changed_handoff('stage')
                    old_state['export'].clear();old_state['directories'].clear()
                    wrapper_result,wrapper_failure=p.same_job_guest_service(
                        guest_env,event_reader=lambda:event_raw,
                        handoff_reader=lambda selected:(handoff_raw,selected_handoff,
                            candidate_raw,candidate))
                self.assertTrue(wrapper_result['pass'],wrapper_failure.first)
                self.assertTrue(wrapper_result['composition']['final']['pass'])
                self.assertEqual(set(old_state['export']),reader.ROLES)
                self.assertIsNone(wrapper_failure.first)
                self.assertEqual(wrapper_calls,['plan','prepare','sink','compose','retained'])
                self.assertEqual(set(wrapper_originals),{
                    'build/i80386-ring3-same-job-actual-v1/guest.service.original.json'})
                self.assertIs(reader.parse(next(iter(wrapper_originals.values())))[
                    'guestPacketComposed'],True)
                official_facts={'packet':dict(old_state['export']),
                    'handoff':handoff_raw,'service':next(iter(wrapper_originals.values())),
                    'cleanup':guest_cleanup,'guestOuter':guest_outer,
                    'controllerRuntime':runtime_originals['controller.runtime.json'],
                    'setupLog':wire.getvalue(),'setupOuter':outer,
                    'setupCleanup':cleanup,'setupShell':shell,
                    'setupExpectation':external,'source':source,
                    'workflowSha':env['GITHUB_WORKFLOW_SHA'],'requestSha256':pin,
                    'graph':mock_graph,'node':node_fact,
                    'statusSha256':sha(pre),'statusBytes':len(pre)}
                official_external,official_raws=same_job_official_fixture(official_facts)
                official_verdict=same_job_official_grade(official_facts,
                    official_external,official_raws)
                self.assertTrue(official_verdict['officialMetadataBound'])
                self.assertTrue(official_verdict['guestPredicatesObserved'])
                self.assertFalse(official_verdict['actualRunApproved'])
                same_job_official_cuts(self,official_facts,official_external,official_raws)
            self.assertEqual(producer.SAME_JOB_REVIEWED_GRAPH['sha256'],
                '72407985d3ef62725137a05ea6c609ff81f7095bdeb0147a9f703628a0f9cdab')
        def test_manufactured_runtime_fixture_precedes_actual_request(self):
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env)
                stage_node=state['observation']['stageBefore']['files']['node']['before']
                files,probe,observed=runtime_edges(stage_node)
                candidate=reader.SetupV9Inventory(stage_node,files,probe).discover()
                self.assertEqual(len(observed),15)
                value=reader.parse(candidate)
                self.assertEqual(value['schema'],'bw.ring3.runtime-expectation.v4')
                self.assertEqual(len(value['packagePathsByPackage']),5)
                self.assertTrue(all(path in value['files'] for path in reader.SETUP_V9_SIGNED_DATA))
                self.assertEqual((len(value['files']),len(value['aliases'])),(327,55))
                self.assertEqual(sum(item['kind']=='qemu-data' for item in value['files'].values()),75)

        def test_root_plan_directory_becomes_traversable_before_dropped_read(self):
            plan=Path('/run/bw-ring3-123-1-admission/launch-plan.json')
            selection={'request':{'head':'a'*40,'tree':'b'*40,
                'source':{'schema':'manufactured-source'}}}
            for withheld in (False,True):
                modes={40:stat.S_IFDIR|0o700,41:stat.S_IFREG|0o600}
                events=[];held={'raw':b''}
                def info(fd):
                    return SimpleNamespace(st_mode=modes[fd],st_uid=0,st_gid=0,
                        st_dev=1,st_ino=fd)
                def named(path):
                    return info(40 if Path(path)==plan.parent else 41)
                def opened(path,flags,*args,**kwargs):
                    if Path(path)==plan.parent:events.append('open-directory');return 40
                    self.assertEqual((path,kwargs.get('dir_fd')),('launch-plan.json',40))
                    events.append('open-file');return 41
                def chmod(fd,mode):
                    events.append(('chmod',fd,mode))
                    if fd!=40 or not withheld:modes[fd]=(modes[fd]&stat.S_IFMT(modes[fd]))|mode
                def readback(environ,pin):
                    self.assertEqual(stat.S_IMODE(modes[40]),0o755)
                    self.assertEqual(stat.S_IMODE(modes[41]),0o444)
                    events.append('dropped-readback');return held['raw']
                with patch.object(p,'launch_plan_path',return_value=plan),\
                     patch.object(p.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(p.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(p.os,'mkdir',side_effect=lambda *a,**kw:events.append('mkdir')),\
                     patch.object(p.os,'open',side_effect=opened),\
                     patch.object(p.os,'fstat',side_effect=info),\
                     patch.object(p.os,'write',side_effect=lambda fd,raw:
                         held.update(raw=raw) or len(raw)),\
                     patch.object(p.os,'fchmod',side_effect=chmod),\
                     patch.object(p.os,'fsync',return_value=None),\
                     patch.object(p.os,'close',side_effect=lambda fd:events.append(('close',fd))),\
                     patch.object(Path,'lstat',autospec=True,side_effect=named),\
                     patch.object(Path,'resolve',autospec=True,side_effect=lambda path,**kw:path),\
                     patch.object(p,'read_launch_plan',side_effect=readback):
                    if withheld:
                        with self.assertRaisesRegex(ValueError,'traversable plan directory'):
                            p.same_job_create_launch_plan(selection,{'GITHUB_RUN_ID':'123'})
                        self.assertNotIn('dropped-readback',events)
                    else:
                        raw,selected=p.same_job_create_launch_plan(selection,
                            {'GITHUB_RUN_ID':'123'})
                        self.assertEqual(raw,held['raw'])
                        self.assertEqual(selected['BW_LAUNCH_PLAN_SHA256'],sha(raw))
                        self.assertLess(events.index(('chmod',40,0o755)),
                            events.index('dropped-readback'))
        def test_new_request_event_and_patched_inactive_refusal(self):
            self.assertIs(p.SAME_JOB_ACTUAL_ENABLED,False)
            self.assertIs(reader.SAME_JOB_ACTUAL_READER_ENABLED,True)
            self.assertEqual(p.SAME_JOB_REVIEWED_GRAPH,reader.SAME_JOB_ACTUAL_REVIEWED_GRAPH)
            with edges() as (producer,env,request,raw,state):
                producer.stage_runtime_inventory_node(env)
                _,witness=setup_v8_controls(export_ops=True)
                actual=copy.deepcopy(request)
                actual.update(schema='bw.ring3.same-job-actual-request.v1',
                    setup=producer.setup_v9_policy(),payloadWitness=witness,
                    comparison=producer.SAME_JOB_REVIEWED_GRAPH)
                raw=reader.canonical(actual);pin=sha(raw)
                selected,source=reader.same_job_actual_request(raw,pin)
                self.assertEqual(selected,actual)
                self.assertEqual(source['head'],actual['head'])
                producer.admit_same_job_actual_request(raw,pin)
                with self.assertRaises((ValueError,reader.Refusal)):
                    producer.admit_setup_v9_request(raw,pin)
                with self.assertRaises((ValueError,reader.Refusal)):
                    reader.setup_v9_request(raw,pin)
                event=reader.parse(state['originals']['staged.event.json'])
                event['label']['name']=producer.SAME_JOB_ACTUAL_ROUTE['label']
                event['pull_request']['body']='<!-- BW_RING3_SAME_JOB_ACTUAL_V1\n'+pin+\
                    '\nBW_RING3_SAME_JOB_ACTUAL_V1 -->'
                event_raw=reader.canonical(event)
                environment=dict(env,GITHUB_JOB=producer.SAME_JOB_ACTUAL_ROUTE['job'],
                    BW_RING3_SAME_JOB_ACTUAL_REQUEST_SHA256=pin,
                    BW_RING3_SAME_JOB_ACTUAL_REQUEST_B64=base64.b64encode(raw).decode())
                with patch.object(producer,'expected_cgroup',return_value=None):
                    self.assertEqual(producer.admit_same_job_actual_event(event_raw,environment)[0],raw)
                reader.same_job_actual_event(event_raw,actual,pin,environment)
                wrong=copy.deepcopy(event);wrong['label']['name']='x86-ring3-setup-runtime-inventory-v9'
                with self.assertRaises((ValueError,reader.Refusal)):
                    reader.same_job_actual_event(reader.canonical(wrong),actual,pin,environment)
                with patch.object(producer,'SAME_JOB_ACTUAL_ENABLED',False),\
                     patch.object(producer,'setup_v8_entry',side_effect=AssertionError('host edge')) as host:
                    self.assertEqual(producer.dispatch_cli(['--same-job-setup-v1'],environment),1)
                    host.assert_not_called()
                observed=[]
                observer=SimpleNamespace(facts={'eventIdentity':{'st_size':len(event_raw)},
                    'sourceCommands':[]},event=lambda:event_raw,
                    source=lambda selected:observed.append('source'))
                with patch.object(producer.os,'getresuid',return_value=(0,0,0)),\
                     patch.object(producer.os,'getresgid',return_value=(0,0,0)),\
                     patch.object(producer,'HostedEnvelopeInstaller',return_value=observer),\
                     patch.object(producer,'SetupV8Host',side_effect=AssertionError('host constructed')) as host,\
                     patch.object(producer.sys,'stdout',SimpleNamespace(buffer=io.BytesIO())):
                    self.assertEqual(producer.dispatch_cli(['--same-job-setup-v1'],
                        dict(environment,GITHUB_ACTOR='different-actor')),1)
                    host.assert_not_called()
                self.assertEqual(observed,[])

        def test_closed_setup_sequence_and_child_profile(self):
            FakeOps,witness=setup_v8_controls(export_ops=True)
            request={'setup':p.setup_v9_policy()}
            ops=FakeOps()
            result=p.setup_v8_sequence(ops,request,p.SAME_JOB_ACTUAL_ROUTE)
            self.assertIsNone(result['firstFailure'],result['firstFailure'])
            self.assertEqual(result['schema'],p.SAME_JOB_ACTUAL_ROUTE['setupSchema'])
            self.assertEqual(ops.events.count('acquire'),15)
            self.assertEqual(ops.events[-1],'stage')
            self.assertIs(p.ACTUAL_ENTRY_ENABLED,False)
            self.assertIs(p.SAME_JOB_ACTUAL_ENABLED,False)

        def test_v2_post_reap_history_retains_first_and_final_strict_sample(self):
            def sample(index,procs,identity=900):
                return {'unitIdentity':[1,identity,stat.S_IFDIR|0o755,0,0,2,0,100],
                    'limits':dict(p.LIMITS),'cgroupProcs':procs,
                    'cgroupEvents':'populated 1\nfrozen 0\n',
                    'cgroupStat':'nr_descendants 0\nnr_dying_descendants 0\n',
                    'onlyController':procs=='101\n','firstFailure':None,'secondary':[]}
            class Census:
                def __init__(self,rows):self.rows=rows;self.called=[]
                def cgroup_sample_v2(self,phase,index):
                    self.called.append((phase,index));return copy.deepcopy(self.rows[index])
            def clock():
                clock.value+=100_000_000;return clock.value
            clock.value=1_000_000_000
            ops=Census([sample(0,'101\n202\n'),sample(1,'101\n')])
            history=p.same_job_v2_cgroup_history(ops,'unpack',clock=clock,pause=lambda _:None)
            self.assertEqual((history['settled'],history['finalIndex'],ops.called),
                (True,1,[('unpack',0),('unpack',1)]))
            self.assertEqual(history['samples'][0]['cgroupProcs'],'101\n202\n')
            self.assertEqual(reader.same_job_v2_cgroup_history(history,'unpack',101)
                ['cgroupProcs'],'101\n')
            changed=copy.deepcopy(history)
            changed['samples'][1]['unitIdentity'][1]=901
            with self.assertRaises(reader.Refusal):
                reader.same_job_v2_cgroup_history(changed,'unpack',101)
            clock.value=1_000_000_000
            drift=p.same_job_v2_cgroup_history(Census([sample(0,'101\n202\n'),
                sample(1,'101\n',901)]),'unpack',clock=clock,pause=lambda _:None)
            self.assertFalse(drift['settled'])
            self.assertEqual(drift['samples'][0]['cgroupProcs'],'101\n202\n')
            with self.assertRaises(reader.Refusal):
                reader.same_job_v2_cgroup_history(drift,'unpack',101)
            clock.value=1_000_000_000
            persistent=p.same_job_v2_cgroup_history(Census([sample(i,'101\n202\n')
                for i in range(6)]),'configure',clock=clock,pause=lambda _:None)
            self.assertEqual((len(persistent['samples']),persistent['settled']),
                (6,False))
            self.assertIsNotNone(persistent['firstFailure'])
            with self.assertRaises(reader.Refusal):
                reader.same_job_v2_cgroup_history(persistent,'configure',101)
            times=iter((1_000_000_000,1_000_000_001,1_000_000_002,
                6_000_000_000))
            expired=p.same_job_v2_cgroup_history(Census([sample(0,'101\n')]),
                'unpack',limit=1,clock=lambda:next(times),pause=lambda _:None)
            self.assertFalse(expired['settled'])
            self.assertIn('deadline after read',expired['firstFailure']['message'])
            self.assertEqual(len(expired['samples']),1)
            before=iter((1_000_000_000,1_000_000_001,6_000_000_000))
            untouched=Census([])
            missed=p.same_job_v2_cgroup_history(untouched,'unpack',
                clock=lambda:next(before),pause=lambda _:None)
            self.assertEqual((missed['samples'],missed['finalIndex'],
                missed['settled'],untouched.called),([],None,False,[]))
            self.assertEqual(missed['firstFailure']['phase'],
                'same-job-actual-v2-cgroup-deadline')
            with self.assertRaises(reader.Refusal):
                reader.same_job_v2_cgroup_history(missed,'unpack',101)
            read_error=sample(0,'101\n')
            read_error['firstFailure']={'phase':'v2-cgroup-read-close',
                'name':'OSError','message':'held read/close failure'}
            partial=p.same_job_v2_cgroup_history(Census([read_error]),'unpack',
                limit=1,clock=lambda:1_000_000_001,pause=lambda _:None)
            self.assertEqual(partial['firstFailure'],read_error['firstFailure'])
            self.assertEqual(partial['samples'][0]['firstFailure'],read_error['firstFailure'])
            self.assertFalse(partial['settled'])
            with self.assertRaises(reader.Refusal):
                reader.same_job_v2_cgroup_history(partial,'unpack',101)

        def test_v2_real_cgroup_sampler_mocked_syscalls_and_drift(self):
            host=object.__new__(p.SetupV8Host)
            host.route=p.SAME_JOB_ACTUAL_V2_ROUTE
            host.environ={'GITHUB_RUN_ID':'123'}
            info=SimpleNamespace(st_dev=1,st_ino=900,st_mode=stat.S_IFDIR|0o755,
                st_uid=0,st_gid=0,st_nlink=2,st_size=0,st_mtime_ns=100)
            texts={'cpu.max':'100000 100000\n','memory.max':'1073741824\n',
                'memory.swap.max':'0\n','pids.max':'64\n','cgroup.procs':'101\n',
                'cgroup.events':'populated 1\nfrozen 0\n',
                'cgroup.stat':'nr_descendants 0\nnr_dying_descendants 0\n'}
            with patch.object(p.Path,'lstat',return_value=info),\
                 patch.object(p.Path,'resolve',autospec=True,
                     side_effect=lambda path,strict=False:path),\
                 patch.object(p.Cgroups,'text',side_effect=lambda unused,path:
                     texts[path.name]),\
                 patch.object(p.os,'getpid',return_value=101):
                selected=host.cgroup_sample_v2('unpack',0)
            self.assertTrue(selected['onlyController'])
            self.assertEqual(selected['unitIdentity'],[1,900,stat.S_IFDIR|0o755,
                0,0,2,0,100])
            changed=SimpleNamespace(**{**vars(info),'st_ino':901})
            with patch.object(p.Path,'lstat',side_effect=[info,changed]),\
                 patch.object(p.Path,'resolve',autospec=True,
                     side_effect=lambda path,strict=False:path),\
                 patch.object(p.Cgroups,'text',side_effect=lambda unused,path:
                     texts[path.name]),\
                 patch.object(p.os,'getpid',return_value=101):
                refused=host.cgroup_sample_v2('unpack',0)
            self.assertIsNotNone(refused['firstFailure'])
            self.assertIsNone(refused['onlyController'])
            for malformed in ({'cgroup.procs':'101\n202\n',
                               'cgroup.stat':'nr_descendants 0\n'},
                              {'cgroup.procs':'101\n202\n',
                               'cgroup.events':'populated nope\nfrozen 0\n'}):
                selected_text=dict(texts,**malformed)
                with patch.object(p.Path,'lstat',return_value=info),\
                     patch.object(p.Path,'resolve',autospec=True,
                         side_effect=lambda path,strict=False:path),\
                     patch.object(p.Cgroups,'text',side_effect=lambda unused,path:
                         selected_text[path.name]),\
                     patch.object(p.os,'getpid',return_value=101):
                    refused=host.cgroup_sample_v2('unpack',0)
                self.assertEqual(refused['cgroupProcs'],'101\n202\n')
                self.assertIsNone(refused['onlyController'])
                self.assertIsNotNone(refused['firstFailure'])
                limited=iter((1_000_000_000,1_000_000_001,1_000_000_002,
                              1_000_000_003))
                class OneSample:
                    calls=0
                    def cgroup_sample_v2(self,phase,index):
                        self.calls+=1;return refused
                source=OneSample()
                history=p.same_job_v2_cgroup_history(source,'unpack',
                    clock=lambda:next(limited),pause=lambda _:None)
                self.assertEqual((source.calls,history['finalIndex'],history['settled']),
                    (1,0,False))
                self.assertEqual(history['firstFailure'],refused['firstFailure'])

        def test_v2_inactive_source_and_workflow_before_host_edges(self):
            self.assertIs(p.SAME_JOB_ACTUAL_V2_ENABLED,False)
            self.assertIs(reader.SAME_JOB_ACTUAL_V2_READER_ENABLED,False)
            self.assertIs(p.SAME_JOB_ACTUAL_ENABLED,False)
            workflow=(HERE.parent.parent/'.github/workflows/i80386-ring3-int-iret.yml').read_text()
            v2=workflow.split('  ring3-same-job-actual-v2:\n',1)[1].split(
                '  ring3-same-job-actual-v1:\n',1)[0]
            v1=workflow.split('  ring3-same-job-actual-v1:\n',1)[1].split(
                '  host-baseline-v1:\n',1)[0]
            self.assertIn("if: ${{ false && github.event.action == 'labeled'",v2)
            self.assertIn("if: ${{ false && github.event.action == 'labeled'",v1)
            for mode in ('same-job-setup-v2','same-job-cleanup-v2',
                         'same-job-image-shell-v2','same-job-guest-service-v2'):
                with self.subTest(mode=mode),patch.object(p,'setup_v8_entry',
                    side_effect=AssertionError('no setup host edge')) as setup,\
                    patch.object(p,'same_job_guest_service',
                    side_effect=AssertionError('no guest host edge')) as guest,\
                    patch.object(p.sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                    self.assertEqual(p.dispatch_cli(['--'+mode],{}),1)
                    setup.assert_not_called();guest.assert_not_called()

        def test_actual_collector_exact_role_and_finite_terminal(self):
            class Child:
                environment=dict(p.SETUP_V9_INSTALLER_ENV)
                role='setup-same-job-v1'
                def __init__(self):self.t=0
                def now(self):self.t+=1000;return self.t
                def spawn(self):return {'pid':201,'pgid':201,'parentPid':101,'startTicks':7}
                def read_available(self,timeout):return []
                def reap(self):return {'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                    'rusage':{'userSeconds':0.0,'systemSeconds':0.0,'maxRssKiB':1}}
                def close(self):pass
                def kill(self):raise AssertionError('no signal after natural terminal')
            argv=['/usr/bin/dpkg','--no-triggers','--configure',*p.SETUP_V9_CONFIGURE_ORDER]
            packet,streams=p.collect_child(Child(),'setup-same-job-v1',argv,profile='setup-same-job-v1')
            self.assertEqual((packet['exitCode'],packet['firstFailure'],streams['stdout']),
                             (0,None,b''))
            with self.assertRaises(ValueError):
                p.collect_child(Child(),'setup-v9',argv,profile='setup-same-job-v1')

        def test_selected_same_job_workflow_first_service_is_distinct(self):
            workflow=(HERE.parent.parent/'.github/workflows/i80386-ring3-int-iret.yml').read_text()
            start=workflow.index('  ring3-same-job-actual-v1:\n')
            end=workflow.index('  host-baseline-v1:\n',start)
            route=workflow[start:end]
            self.assertIn("if: ${{ false && github.event.action == 'labeled'",route)
            self.assertIn("github.event.label.name == 'x86-ring3-same-job-actual-v1'",route)
            self.assertEqual(route.count('actions/checkout@11d5960a326750d5838078e36cf38b85af677262'),1)
            self.assertEqual(route.count('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'),1)
            for selected in ('node-version: 22.23.3','--same-job-image-shell-v1',
                '--same-job-setup-v1','--same-job-cleanup-v1',
                'bw-ring3-actual-setup-v1-${GITHUB_RUN_ID}-1',
                '--kill-after=5s 720s','RuntimeMaxSec=660','TimeoutStopSec=5',
                '--same-job-handoff-v1','handoff.original.json',
                '--same-job-guest-service-v1','--same-job-guest-cleanup-v1',
                '--same-job-actual-packet-v1','guest-verdict.original.json',
                '--guest-outer build/i80386-ring3-same-job-actual-v1/guest-outer.original.json',
                'controller.runtime.json',
                'bw-ring3-actual-guest-v1-${GITHUB_RUN_ID}-1',
                '--kill-after=5s 780s','RuntimeMaxSec=720',
                'BW_RING3_SAME_JOB_HANDOFF_SHA256',
                'i80386-ring3-same-job-actual-v1-originals',
                'build/i80386-ring3-int-iret-export/'):
                self.assertIn(selected,route)
            self.assertEqual(route.count('--kill-after=5s 55s'),2)
            # Two 55+5 cleanup envelopes keep the claimed finite total:
            # (720+5)+60+(780+5)+60+180 = 1810 < 35*60.
            self.assertEqual((720+5)+60+(780+5)+60+180,1810)
            self.assertLess(route.index('--same-job-setup-v1'),route.index('--same-job-handoff-v1'))
            self.assertLess(route.index('--same-job-handoff-v1'),route.index('--same-job-guest-service-v1'))
            self.assertLess(route.index('--same-job-guest-service-v1'),route.index('--same-job-guest-cleanup-v1'))
            self.assertLess(route.index('--same-job-guest-cleanup-v1'),route.index('--same-job-actual-packet-v1'))
            self.assertIn('find "${roots[@]}" ! -type f ! -type d -print -quit',route)
            self.assertIn("if: always() && steps.same_job_archive_bound.outputs.bounded == 'true'",route)
            for historical in ('--setup-runtime-inventory-v9','--hosted-actual'):
                self.assertNotIn(historical,route)

    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    assert result.wasSuccessful(),'pure inactive same-job actual controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,'dpkg':False,
        'guest':False,'actualRunApproved':False,'pass':True}))


if __name__=='__main__':
    if sys.argv[1:]==['--same-job-actual-only']:same_job_actual_controls()
    elif sys.argv[1:]==['--host-baseline-only']:host_baseline_controls()
    elif sys.argv[1:]==['--consumed-v7-failure-only']:consumed_v7_failure_controls()
    elif sys.argv[1:]==['--consumed-v6-failure-only']:consumed_v6_failure_controls()
    elif sys.argv[1:]==['--image-env-diagnostic-only']:image_env_diagnostic_controls()
    elif sys.argv[1:]==['--setup-v6-only']:setup_v6_controls()
    elif sys.argv[1:]==['--setup-v8-only']:setup_v8_controls()
    elif sys.argv[1:]==['--setup-v9-only']:setup_v9_controls()
    elif sys.argv[1:]==['--setup-v7-only']:setup_v7_controls()
    elif sys.argv[1:]==['--setup-v5-only']:setup_v5_controls()
    elif sys.argv[1:]==['--setup-v4-only']:setup_v4_controls()
    elif sys.argv[1:]==['--staged-runtime-only']:staged_runtime_controls()
    elif sys.argv[1:]==['--node-stage-only']:node_stage_controls()
    elif sys.argv[1:]==['--prerequisites-only']:prerequisite_controls()
    elif sys.argv[1:]==['--runtime-only']:runtime_controls()
    elif sys.argv[1:]==['--delivery-only']:delivery_controls()
    elif sys.argv[1:]==['--delivery-full']:delivery_full_control()
    else:main()
