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


def staged_runtime_controls():
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
            self.assertNotIn('--setup-runtime-inventory-v5',route)
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
    result=unittest.TextTestRunner(verbosity=1).run(suite)
    assert result.wasSuccessful(),'pure image diagnostic controls failed'
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'network':False,
                      'installer':False,'guest':False,'pass':True}))


if __name__=='__main__':
    if sys.argv[1:]==['--image-env-diagnostic-only']:image_env_diagnostic_controls()
    elif sys.argv[1:]==['--setup-v5-only']:setup_v5_controls()
    elif sys.argv[1:]==['--setup-v4-only']:setup_v4_controls()
    elif sys.argv[1:]==['--staged-runtime-only']:staged_runtime_controls()
    elif sys.argv[1:]==['--node-stage-only']:node_stage_controls()
    elif sys.argv[1:]==['--prerequisites-only']:prerequisite_controls()
    elif sys.argv[1:]==['--runtime-only']:runtime_controls()
    elif sys.argv[1:]==['--delivery-only']:delivery_controls()
    elif sys.argv[1:]==['--delivery-full']:delivery_full_control()
    else:main()
