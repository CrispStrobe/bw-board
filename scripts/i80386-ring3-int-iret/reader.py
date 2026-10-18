#!/usr/bin/env python3
"""MIT. Original-only ring3 reader. No producer, fixture builder or emulator imports.

External admission is an independently reviewed input, not evidence created by
this reader. Manufactured controls exercise predicates; they confer no actual
run/source/runtime authority.
"""
import argparse
import base64
import hashlib
import io
import json
import math
import os
import platform
import posixpath
import re
import resource
import selectors
import signal
import struct
import stat
import sys
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path

SCHEMA = 'bw.ring3.'
ROM_SHA = 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529'
FIXTURE_JSON_SHA = '5784090f18b0c114e5723ea9234173c040a0d290d94c0211b99b12b1161cd670'
CAPS = {'packetBytes': 16 << 20, 'jsonBytes': 1 << 20, 'streamBytes': 128 << 10,
        'ramBytes': 1 << 20, 'romBytes': 65536, 'calls': 2000000,
        'childMs': 120000, 'controllerMs': 600000, 'jobMinutes': 15, 'writes': 4096}
ROLES = frozenset(('audit.json source.before.json source.after.json runtime.before.json '
    'runtime.after.json inputs/fixture.rom inputs/fixture.json resources.json '
    'js/report.json js/observations.json js/writes.json js/memory.before.bin '
    'js/memory.after.bin js/stdout js/stderr js/process.json qemu/report.json '
    'qemu/stdout qemu/stderr qemu/process.json').split())
RANGES = ((0x7000, 224), (0x1000, 48), (0x1800, 1040), (0x2000, 104),
          (0x7fc0, 96), (0x8fc0, 96), (0x9fc0, 96))
BLOCKS = ((0x1000, 48), (0x1c00, 16), (0x2000, 104), (0x7fc0, 96),
          (0x8fc0, 96), (0x9fc0, 96), (0x4000, 95), (0x5000, 198),
          (0x6000, 167), (0x6200, 145))
SYMBOLS = {'initialIretd': 0x405e, 'int80': 0x505b, 'returned': 0x505d,
           'int81': 0x50c2, 'iretd': 0x60a6, 'exit': 0x628c}
REGS = ('eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi')
SEGS = ('es', 'cs', 'ss', 'ds', 'fs', 'gs')
INITIAL = (0x11223344, 0x99aabbcc, 0xddeeff00, 0x55667788, 0x9000,
           0x0badc0de, 0x12345678, 0x87654321)
PADDING = (6, 7, 18, 19)
MAGIC, END = b'BW-RING3-V1\n', b'\nBW-RING3-END\n'
PACKET_REL = 'build/i80386-ring3-int-iret'
WORKFLOW = '.github/workflows/i80386-ring3-int-iret.yml'
LABEL = 'x86-ring3-int-iret-actual'
STEPS = ('Bounded JS and QEMU ring3 cases', 'Owned controller terminal and empty',
         'Retain original evidence')
RUNTIME_KINDS = frozenset(('qemu-binary node-binary python-binary shared-library elf-interpreter '
    'tcg-module qemu-data observation-tool tool-interpreter python-stdlib').split())
RUNTIME_ROLES = frozenset(('node-version python-version qemu-version ldd-node ldd-python ldd-qemu '
    'ldd-shell ldd-dpkg-query ldd-tcg package-version package-files').split())
RUNTIME_CAPS = {'files': 512, 'aliases': 256, 'probes': 16, 'pathBytes': 256,
                'probeStreamBytes': 16384, 'fileBytes': 268435456, 'graphFileBytes': 1073741824}
PACKAGE_NAMES = ('qemu-system-x86', 'qemu-system-common', 'qemu-system-data', 'seabios', 'ipxe-qemu')
# This fixed source is the sole child bridge; it does not inject CPU state.
JS_DRIVER = """import {writeFileSync as w} from 'node:fs';
import {executeFixture} from './scripts/i80386-ring3-int-iret/probe.mjs';
const r=await executeFixture(),p='build/i80386-ring3-int-iret/js/';
for(const [n,v] of Object.entries({'report.json':r.report,'observations.json':r.observations,'writes.json':r.writes}))w(p+n,JSON.stringify(v)+'\\n',{flag:'wx'});
w(p+'memory.before.bin',r.memoryBefore,{flag:'wx'});w(p+'memory.after.bin',r.memoryAfter,{flag:'wx'});
process.stdout.write(r.stdout);process.exitCode=r.report.firstFailure?1:0;
"""


class Refusal(ValueError):
    pass


def need(condition, message):
    if not condition:
        raise Refusal(message)


def keys(value, names, message='closed object fields'):
    need(type(value) is dict and set(value) == set(names.split()), message)


def integer(value, low=0, high=2**63-1):
    need(type(value) is int and low <= value <= high, 'bounded original integer')
    return value


def digest(value, length=64):
    need(type(value) is str and re.fullmatch('[0-9a-f]{%d}' % length, value), 'lowercase digest')
    return value


def equal(actual, expected):
    """JSON equality with exact scalar types (True is not integer one)."""
    if type(actual) is not type(expected): return False
    if type(expected) is dict:
        return set(actual) == set(expected) and all(equal(actual[k], expected[k]) for k in expected)
    if type(expected) is list:
        return len(actual) == len(expected) and all(equal(a, b) for a, b in zip(actual, expected))
    return actual == expected


def sha(value):
    return hashlib.sha256(value).hexdigest()


def parse(value):
    def unique(pairs):
        result = {}
        for key, item in pairs:
            need(key not in result, 'duplicate JSON key')
            result[key] = item
        return result
    need(len(value) <= CAPS['jsonBytes'], 'JSON byte cap')
    return json.loads(value.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(Refusal('nonfinite JSON')))


def read_archive(raw):
    need(0 < len(raw) <= CAPS['packetBytes'], 'original archive cap')
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        rows = archive.infolist()
        need(len(rows) == 20 and {row.filename for row in rows} == ROLES, 'exact twenty original roles')
        total = 0
        for row in rows:
            name = row.filename
            need(name not in result and not row.is_dir() and not row.flag_bits & 1 and
                 row.compress_type in (0, 8) and (row.external_attr >> 16) & 0xf000 in (0, 0x8000),
                 'regular unencrypted unique role')
            cap = CAPS['jsonBytes'] if name.endswith('.json') else CAPS['ramBytes'] if name.endswith('.bin') else CAPS['romBytes'] if name.endswith('.rom') else CAPS['streamBytes']
            need(0 <= row.file_size <= cap, 'per-role original cap')
            total += row.file_size
            need(total <= CAPS['packetBytes'], 'expanded packet cap')
            result[name] = archive.read(row)  # stdlib validates local header, extent and CRC.
    return result


def expected_memory(rom):
    """Independent literal architectural projection; no output-derived expectations."""
    need(len(rom) == 65536 and sha(rom) == ROM_SHA, 'reviewed ROM identity')
    memory = bytearray(1 << 20)
    for address, count in BLOCKS:
        memory[address:address+count] = rom[address:address+count]
    for at, value in ((13, 0x9b), (21, 0x93), (29, 0xfb), (37, 0xf3), (45, 0x8b)):
        memory[0x1000+at] = value
    struct.pack_into('<I', memory, 0x2004, 0xa000)
    for address, kernel, response in ((0x7000, False, False), (0x7040, True, False), (0x7080, False, True)):
        values = list(INITIAL)
        if kernel: values[4] = 0x7fec
        if response: values[0] = 0xa1b2c3d4
        struct.pack_into('<8I6HI', memory, address, *values, 0x23, 8 if kernel else 0x1b,
                         0x10 if kernel else 0x23, 0x23, 0x23, 0x23, 2 if kernel else 0x202)
    for address, eip in ((0x70c0, 0x505d), (0x7fec, 0x505d), (0x9fec, 0x50c4), (0xafec, 0x5000)):
        struct.pack_into('<5I', memory, address, eip, 0x1b, 0x202, 0x9000, 0x23)
    for address, value in ((0x7fe8, 2), (0x8ffc, 0x202), (0x70d4, 0x48414e44), (0x70d8, 0x5245544e)):
        struct.pack_into('<I', memory, address, value)
    return bytes(memory)


def wire_memory(wire, expected):
    need(len(wire) == 1730 and wire.startswith(MAGIC) and wire.endswith(END), 'complete literal wire framing')
    memory = bytearray(expected)
    offset = len(MAGIC)
    for address, count in RANGES:
        memory[address:address+count] = wire[offset:offset+count]
        offset += count
    need(memory[0x70c0:0x70d4] == memory[0x7fec:0x8000], 'twenty original frame-copy bytes')
    ignored = {frame+i for frame in (0x70c0, 0x7fec, 0x9fec) for i in PADDING}
    for address, count in RANGES:
        need(all(memory[i] == expected[i] for i in range(address, address+count) if i not in ignored),
             'defined actual reporter registers/frame/flags/guards')
    return bytes(memory)


def observations(rows):
    need(type(rows) is list and len(rows) == 4, 'four original CPU observations')
    previous = 0
    for index, (row, stage, eip, cpl, flags) in enumerate(zip(rows,
            ('before-int80', 'handler-entry', 'before-iretd', 'returned-ring3'),
            (0x505b, 0x6000, 0x60a6, 0x505d), (3, 0, 0, 3), (0x202, 2, 2, 0x202))):
        keys(row, 'stage beforeCall eip linear cpl eflags cr0 cr3 registers selectors cs ss tr opcode frame')
        need(all(type(row[k]) is int for k in ('eip', 'linear', 'cpl', 'eflags', 'cr0', 'cr3')) and
             row['stage'] == stage and row['eip'] == eip and row['linear'] == eip and
             row['cpl'] == cpl and row['eflags'] == flags and row['cr0'] == 1 and row['cr3'] == 0,
             'independent instruction/CPL/IF/control state')
        previous = integer(row['beforeCall'], previous+1, CAPS['calls'])
        keys(row['registers'], ' '.join(REGS)); keys(row['selectors'], ' '.join(SEGS))
        for reg, value in zip(REGS, INITIAL):
            wanted = 0x7fec if reg == 'esp' and cpl == 0 else 0xa1b2c3d4 if reg == 'eax' and index >= 2 else value
            need(type(row['registers'][reg]) is int and row['registers'][reg] == wanted, 'actual register '+reg)
        need(equal(row['selectors'], dict(zip(SEGS, (0x23, 8 if cpl == 0 else 0x1b, 0x10 if cpl == 0 else 0x23, 0x23, 0x23, 0x23)))), 'actual selectors')
        for name in ('cs', 'ss'):
            need(equal(row[name], {'base': 0, 'limit': 0xffffffff, 'default32': True}), 'flat code32/stack32')
        need(equal(row['tr'], {'selector': 0x28, 'base': 0x2000, 'limit': 0x67, 'present': True}), 'actual current TSS')
        need(equal(row['opcode'], ([0xcd, 0x80] if index == 0 else [0xcf] if index == 2 else [0x89])), 'actual instruction bytes')
        frame = row['frame']
        need(type(frame) is list and len(frame) == 20 and all(type(x) is int and 0 <= x <= 255 for x in frame), 'twenty raw frame bytes')
        wanted = bytes([0xcc]*20) if index == 0 else struct.pack('<5I', 0x505d, 0x1b, 0x202, 0x9000, 0x23)
        need(all(x == wanted[i] for i, x in enumerate(frame) if index == 0 or i not in PADDING), 'defined original INT80 frame')
        if index >= 2: need(frame == rows[1]['frame'], 'frame retained through IRETD')
    need(rows[1]['beforeCall'] == rows[0]['beforeCall']+1 and rows[3]['beforeCall'] == rows[2]['beforeCall']+1,
         'observed immediate INT and IRETD transitions')
    return previous


def qemu_argv(binary):
    return [binary, '-no-user-config', '-nodefaults', '-machine', 'pc', '-accel', 'tcg', '-cpu', '486',
        '-m', '16M', '-bios', PACKET_REL+'/inputs/fixture.rom', '-display', 'none', '-serial', 'none',
        '-monitor', 'none', '-nic', 'none', '-vga', 'none', '-debugcon', 'stdio', '-global',
        'isa-debugcon.iobase=0xe9', '-device', 'isa-debug-exit,iobase=0xf4,iosize=0x04', '-no-reboot', '-no-shutdown']


def runtime_path(value):
    need(type(value) is str and 0 < len(value.encode()) <= RUNTIME_CAPS['pathBytes'] and
         re.fullmatch(r'/[A-Za-z0-9_.+/-]+', value) and posixpath.normpath(value) == value and
         not value.startswith('//'), 'bounded canonical runtime path')
    return value


def resolve_alias(path, aliases):
    seen = set()
    for _ in range(16):
        need(path not in seen, 'runtime alias cycle'); seen.add(path)
        matches = [name for name in aliases if path == name or path.startswith(name+'/')]
        if not matches: return path
        name = max(matches, key=len)
        path = posixpath.normpath(posixpath.join(posixpath.dirname(name), aliases[name]['linkText'])+path[len(name):])
    raise Refusal('runtime alias depth')


def ldd_paths(output):
    result = []
    for line in output.splitlines():
        line = line.strip()
        if re.fullmatch(r'linux-vdso\.so\.\d+ \(0x[0-9a-f]+\)', line): continue  # virtual, never invented disk bytes
        match = re.fullmatch(r'(?:[^/\s]+ => )?(/[^\s]+) \(0x[0-9a-f]+\)', line)
        need(match is not None, 'closed resolved ldd line; no missing/static/unknown dependency')
        result.append(runtime_path(match[1]))
    need(result, 'actual resolved ELF dependencies')
    return result


def runtime(value, external):
    need(value == external, 'independently admitted original runtime')
    keys(value, 'schema observationPolicy platform executables versions qemuPackage')
    need(value['schema'] == SCHEMA+'runtime.v2', 'runtime schema v2 with observed auxiliary graph')
    need(value['observationPolicy'] == 'prelaunch-probes-and-before-after-file-readback', 'explicit prelaunch probe/history policy')
    keys(value['platform'], 'sysname release machine')
    need(value['platform']['sysname'] == 'Linux' and value['platform']['machine'] == 'x86_64', 'host profile')
    keys(value['executables'], 'node python qemu'); keys(value['versions'], 'node python qemu')
    for name, row in value['executables'].items():
        keys(row, 'path bytes sha256')
        need(type(row['path']) is str and row['path'].startswith('/') and '..' not in row['path'].split('/'), 'observed absolute executable')
        integer(row['bytes'], 1); digest(row['sha256'])
    need(value['versions']['node'] == 'v22.23.3' and re.fullmatch(r'Python 3\.\d+\.\d+', value['versions']['python']) and
         re.fullmatch(r'QEMU emulator version 8\.2\.2(?:[ (][^\r\n]*)?', value['versions']['qemu']), 'reviewed runtime versions')
    package = value['qemuPackage']; keys(package, 'name version architecture files aliases probes')
    need(package['name'] == 'qemu-system-x86' and package['architecture'] == 'amd64' and
         re.fullmatch(r'(?:\d+:)?8\.2\.2(?:[+~.-][^\s]*)?', package['version']), 'observed QEMU package')
    # Despite the historical key name, files includes named observation tools,
    # their interpreters and resolved libraries as well as QEMU module/data.
    files, aliases, probes = package['files'], package['aliases'], package['probes']
    need(type(files) is dict and 1 <= len(files) <= RUNTIME_CAPS['files'] and
         type(aliases) is dict and len(aliases) <= RUNTIME_CAPS['aliases'] and
         type(probes) is list and 1 <= len(probes) <= RUNTIME_CAPS['probes'], 'finite runtime graph counts')
    total = 0
    for path, row in files.items():
        runtime_path(path); keys(row, 'bytes sha256 kind')
        total += integer(row['bytes'], 1, RUNTIME_CAPS['fileBytes']); digest(row['sha256'])
        need(row['kind'] in RUNTIME_KINDS, 'closed observed runtime file kind')
    need(total <= RUNTIME_CAPS['graphFileBytes'], 'runtime file-byte census cap')
    for name, item in aliases.items():
        runtime_path(name); keys(item, 'linkText target'); runtime_path(item['target'])
        need(type(item['linkText']) is str and 0 < len(item['linkText'].encode()) <= 256 and
             re.fullmatch(r'[A-Za-z0-9_.+/-]+', item['linkText']), 'bounded original symlink text')
        need(resolve_alias(name, aliases) == item['target'] and
             any(path == item['target'] or path.startswith(item['target']+'/') for path in set(files)|set(aliases)),
             'original alias/target relation inside observed graph')
    need(all(resolve_alias(path, aliases) == path for path in files), 'file keys are resolved canonical originals')
    for name in ('node', 'python', 'qemu'):
        executable = value['executables'][name]; path = executable['path']
        need(path in files and files[path] == {**{k: executable[k] for k in ('bytes', 'sha256')}, 'kind': name+'-binary'}, 'runtime/executable raw-byte identity join')
    for path, kind in (('/usr/bin/ldd','observation-tool'),('/usr/bin/dpkg-query','observation-tool'),('/usr/bin/bash','tool-interpreter')):
        need(resolve_alias(path, aliases) in files and files[resolve_alias(path, aliases)]['kind'] == kind, 'named observation tool/interpreter identity')
    modules = {path for path, row in files.items() if row['kind'] == 'tcg-module'}
    need(1 <= len(modules) <= 2 and all(re.fullmatch(r'/usr/lib/x86_64-linux-gnu/qemu/accel-tcg-(?:i386|x86_64)\.so', path) for path in modules), 'named installed TCG module graph')
    need(any(row['kind'] == 'elf-interpreter' for row in files.values()) and any(row['kind'] == 'qemu-data' for row in files.values()), 'observed ELF interpreter and QEMU data graph')
    expected = {name+'-version': [value['executables'][name]['path'], '--version'] for name in ('node','python','qemu')}
    for name in ('node','python','qemu'):
        expected['ldd-'+name] = ['/usr/bin/ldd',value['executables'][name]['path']]
    expected.update({'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'], 'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'package-version':['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES],
        'package-files':['/usr/bin/dpkg-query','-L',*PACKAGE_NAMES]})
    seen = set(); observed_modules = set()
    for probe in probes:
        keys(probe, 'role argv environment exitCode stdout stderr')
        role = probe['role']; need(role in RUNTIME_ROLES, 'closed runtime observation role')
        need(type(probe['stdout']) is str and type(probe['stderr']) is str and
             len(probe['stdout'].encode()) <= 16384 and len(probe['stderr'].encode()) <= 16384 and
             probe['stderr'] == '' and type(probe['exitCode']) is int and probe['exitCode'] == 0 and
             probe['environment'] == {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}, 'bounded clean original runtime observation')
        if role == 'ldd-tcg':
            need(type(probe['argv']) is list and len(probe['argv']) == 2 and probe['argv'][0] == '/usr/bin/ldd' and
                 probe['argv'][1] in modules and probe['argv'][1] not in observed_modules, 'one named ldd observation per used TCG module')
            observed_modules.add(probe['argv'][1])
        else:
            need(role not in seen and probe['argv'] == expected[role], 'fixed runtime probe argv and uniqueness'); seen.add(role)
        if role.startswith('ldd-'):
            for path in ldd_paths(probe['stdout']):
                resolved = resolve_alias(path, aliases)
                need(resolved in files and files[resolved]['kind'] in ('shared-library','elf-interpreter'), 'all original resolved module/tool/runtime libraries admitted')
        elif role.endswith('-version') and role in ('node-version','python-version','qemu-version'):
            name=role[:-8]; need(probe['stdout'].splitlines() and probe['stdout'].splitlines()[0] == value['versions'][name], 'original version stdout join')
        elif role == 'package-version':
            rows = [line.split('\t') for line in probe['stdout'].splitlines()]
            need(len(rows) == len(PACKAGE_NAMES) and all(len(item) == 3 for item in rows) and
                 {item[0] for item in rows} == set(PACKAGE_NAMES) and
                 ['qemu-system-x86',package['version'],package['architecture']] in rows, 'original package/version observation')
        elif role == 'package-files':
            listed = probe['stdout'].splitlines(); need(listed and all(path.startswith('/') for path in listed), 'original package file-list observation')
            used_package_files = modules | {value['executables']['qemu']['path']} | {path for path,item in files.items() if item['kind']=='qemu-data'}
            resolved_list = {resolve_alias(item, aliases) for item in listed}
            need(used_package_files <= resolved_list, 'QEMU executable/module/data belong to observed package file list')
    need(seen == set(expected) and observed_modules == modules, 'complete named runtime observations')


def process(row, role, runtime_value):
    keys(row, 'schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
    need(row['schema'] == SCHEMA+'process.v1' and row['role'] == role and row['cwdRole'] == 'checkout', 'child launch role')
    expected_argv = [runtime_value['executables']['node']['path'], '--input-type=module', '--eval', JS_DRIVER] if role == 'js' else qemu_argv(runtime_value['executables']['qemu']['path'])
    need(row['argv'] == expected_argv, 'fixed original guest launch argv')
    need(row['environment'] == {'LANG': 'C.UTF-8', 'HOME': '/nonexistent', 'PATH': '/usr/bin:/bin'}, 'closed child environment')
    pid = integer(row['pid'], 1); integer(row['parentPid'], 1); integer(row['startTicks'], 1)
    need(row['pgid'] == pid, 'fresh child process group')
    start = integer(row['spawnMonoNs'], 1); end = integer(row['reapMonoNs'], start)
    need(end-start <= CAPS['childMs']*1000000 and row['timedOut'] is False and row['signal'] is None and
         row['firstFailure'] is None and row['secondary'] == [], 'finite child terminal and first-error facts')
    status = 0 if role == 'js' else 1
    need(type(row['exitCode']) is int and row['exitCode'] == status and
         integer(row['waitStatus'], 0, 65535) == status << 8, 'reaped engine exit status')
    keys(row['rusage'], 'userSeconds systemSeconds maxRssKiB')
    for field in ('userSeconds', 'systemSeconds'):
        need(type(row['rusage'][field]) in (int, float) and 0 <= row['rusage'][field] <= 120, 'finite child usage')
    integer(row['rusage']['maxRssKiB'], 0, 1048576)
    return start, end


def counters(raw):
    need(type(raw) is str and len(raw) <= 4096, 'bounded raw cgroup counters')
    values = {}
    for line in raw.splitlines():
        pair = line.split(); need(len(pair) == 2 and pair[0] not in values and pair[1].isdigit(), 'raw cgroup counter row')
        values[pair[0]] = int(pair[1])
    return values


def resources(value, processes):
    keys(value, 'schema enclosing controller children firstFailure secondary')
    need(value['schema'] == SCHEMA+'resources.v1' and value['firstFailure'] is None and value['secondary'] == [], 'resource first-error envelope')
    keys(value['controller'], 'pid before after'); controller = integer(value['controller']['pid'], 1)
    keys(value['children'], 'js qemu'); keys(value['enclosing'], 'before after')
    identities = set()
    for role, pair in [('enclosing', value['enclosing']), ('controller', value['controller']), *value['children'].items()]:
        if role != 'controller': keys(pair, 'before after')
        previous = None
        for when in ('before', 'after'):
            snap = pair[when]; keys(snap, 'identity limits raw procs')
            keys(snap['identity'], 'device inode'); identity = tuple(integer(snap['identity'][k], 1) for k in ('device', 'inode'))
            need(snap['limits'] == {'cpuMax': '100000 100000', 'memoryMax': '1073741824', 'swapMax': '0', 'pidsMax': '64'}, 'fixed observed envelope limits')
            keys(snap['raw'], 'memoryEvents cpuStat cgroupEvents memoryCurrent memoryPeak pidsCurrent')
            memory, cpu, events = (counters(snap['raw'][k]) for k in ('memoryEvents', 'cpuStat', 'cgroupEvents'))
            need({'low', 'high', 'max', 'oom', 'oom_kill'} <= set(memory) and {'usage_usec', 'user_usec', 'system_usec'} <= set(cpu) and
                 set(events) == {'populated', 'frozen'} and events['frozen'] == 0, 'mandatory kernel counter sets')
            for name in ('memoryCurrent', 'memoryPeak', 'pidsCurrent'):
                need(type(snap['raw'][name]) is str and snap['raw'][name].strip().isdigit(), 'raw scalar resource counter')
            need(int(snap['raw']['memoryPeak']) <= 1 << 30 and int(snap['raw']['pidsCurrent']) <= 64, 'observed envelope maxima')
            wanted_procs = [controller] if role == 'controller' and when == 'before' else []
            hierarchical_parent = role == 'enclosing' and when == 'before'
            count = int(snap['raw']['pidsCurrent'])
            need(snap['procs'] == wanted_procs and (1 <= count <= 64 if hierarchical_parent else count == (1 if wanted_procs else 0)) and
                 events['populated'] == (1 if wanted_procs or role == 'enclosing' and when == 'before' else 0), 'owned terminal census and population')
            if previous:
                old_identity, old_mem, old_cpu = previous
                need(identity == old_identity and set(memory) == set(old_mem) and set(cpu) == set(old_cpu), 'stable cgroup identity and counter fields')
                need(all(memory[k] >= old_mem[k] for k in memory) and all(cpu[k] >= old_cpu[k] for k in cpu), 'monotone original kernel counters')
                need(all(memory[k] == old_mem[k] for k in memory if k.startswith('oom')), 'no new OOM event')
            previous = identity, memory, cpu
        need(identity not in identities, 'distinct owned envelope roles'); identities.add(identity)
    need(len({device for device, _ in identities}) == 1, 'one cgroup filesystem')
    need(all(row['parentPid'] == controller and row['pid'] != controller for row in processes.values()) and
         processes['js']['pid'] != processes['qemu']['pid'], 'fresh serial guest/controller identities')


def verify_artifact(raw, external):
    keys(external, 'official source runtime', 'independent external admission')
    official = external['official']
    keys(official, 'repository workflowPath workflowSha256 runId attempt event eventAction head label jobId jobName conclusion artifactId artifactBytes artifactSha256 requiredSteps enclosingCleanupSuccess')
    need(official['repository'] == 'CrispStrobe/bw-board' and official['workflowPath'] == WORKFLOW and
         official['attempt'] == 1 and type(official['attempt']) is int and official['event'] == 'pull_request' and
         official['eventAction'] == 'labeled' and official['label'] == LABEL and official['jobName'] == 'actual' and
         official['conclusion'] == 'success' and official['enclosingCleanupSuccess'] is True and
         official['requiredSteps'] == dict.fromkeys(STEPS, 'success'), 'official one-shot workflow/event/step/terminal admission')
    for name in ('runId', 'jobId', 'artifactId'): integer(official[name], 1)
    digest(official['head'], 40); digest(official['workflowSha256'])
    need(integer(official['artifactBytes'], 1, CAPS['packetBytes']) == len(raw) and digest(official['artifactSha256']) == sha(raw), 'official original artifact extent/digest')
    packet = read_archive(raw)
    audit = parse(packet['audit.json']); keys(audit, 'schema head sourceTree workflowSha256 roles caps firstFailure secondary')
    source = external['source']; keys(source, 'head tree files'); digest(source['tree'], 40)
    need(source['head'] == official['head'] == audit['head'] and audit['sourceTree'] == source['tree'] and
         audit['workflowSha256'] == official['workflowSha256'] and audit['schema'] == SCHEMA+'audit.v1' and
         equal(audit['caps'], CAPS) and audit['firstFailure'] is None and audit['secondary'] == [], 'frozen source/caps and first-error envelope')
    need(audit['roles'] == [{'path': name, 'bytes': len(packet[name]), 'sha256': sha(packet[name])} for name in sorted(ROLES-{'audit.json'})], 'closed sorted original role hash census')
    for when in ('before', 'after'):
        observed = parse(packet['source.'+when+'.json'])
        need(observed == {'schema': SCHEMA+'source.v1', **source}, 'independently frozen source before/after')
        runtime(parse(packet['runtime.'+when+'.json']), external['runtime'])
    need(type(source['files']) is dict and len(source['files']) >= 10, 'complete admitted source graph')
    required = ['src/experimental/i80386.js', 'LICENSE', WORKFLOW] + ['scripts/i80386-ring3-int-iret/'+name for name in ('fixture.mjs', 'probe.mjs', 'reader.py', 'controls.py', 'run.py')]
    need(set(required) <= set(source['files']), 'held execution/reader/controller source graph')
    for name, row in source['files'].items():
        need(type(name) is str and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', name) and
             not any(part in ('.', '..') for part in name.split('/')), 'canonical source path')
        keys(row, 'bytes sha256 mode blob'); integer(row['bytes'], 1); digest(row['sha256']); digest(row['blob'], 40)
        need(row['mode'] == '100644', 'regular source mode')
    need(source['files'][WORKFLOW]['sha256'] == official['workflowSha256'], 'workflow/source byte join')
    rom = packet['inputs/fixture.rom']; expected = expected_memory(rom)
    fixture = parse(packet['inputs/fixture.json'])
    need(sha(json.dumps(fixture, sort_keys=True, separators=(',', ':')).encode()) == FIXTURE_JSON_SHA,
         'entire independently frozen fixture metadata')
    need(fixture.get('schema') == 'bw.ring3.fixture.v1' and fixture.get('romSha256') == ROM_SHA and
         fixture.get('romBytes') == 65536 and fixture.get('ramBytes') == 1048576 and fixture.get('symbols') == SYMBOLS and
         fixture.get('selectorPaddingOffsets') == list(PADDING) and fixture.get('wireBytes') == 1730 and
         fixture.get('cpuProfile') == 'strict386' and fixture.get('deliverFaults') is False and
         fixture.get('ordinaryStepLimit') == CAPS['calls'], 'independent literal fixture contract')
    processes = {role: parse(packet[role+'/process.json']) for role in ('js', 'qemu')}
    js_start, js_end = process(processes['js'], 'js', external['runtime'])
    q_start, q_end = process(processes['qemu'], 'qemu', external['runtime'])
    need(js_end <= q_start and q_end-js_start <= CAPS['controllerMs']*1000000, 'two fresh serial finite engines')
    resources(parse(packet['resources.json']), processes)
    need(packet['js/stderr'] == b'' and packet['qemu/stderr'] == b'', 'unexpected engine diagnostics refuse')
    js_memory = wire_memory(packet['js/stdout'], expected)
    wire_memory(packet['qemu/stdout'], expected)
    before, after = packet['js/memory.before.bin'], packet['js/memory.after.bin']
    need(before == bytes(1048576) and len(after) == 1048576, 'fixed original owned RAM images')
    # JS observes the full RAM bus, not just selected reporter ranges. Undefined
    # selector padding remains ungraded; every other owned byte must match.
    # The startup return frame at0xafec is made by authored PUSH imm32, so its
    # selector high halves ARE defined zero. Only CPU-created selector padding
    # in the first INT frame/copy and the terminal INT81 frame is ungraded.
    ignored = {frame+i for frame in (0x70c0, 0x7fec, 0x9fec) for i in PADDING}
    need(all(after[i] == expected[i] for i in range(len(after)) if i not in ignored), 'whole owned RAM architectural projection')
    for address, count in RANGES:
        need(after[address:address+count] == js_memory[address:address+count], 'raw reporter/original RAM join')
    rows = parse(packet['js/observations.json']); last_call = observations(rows)
    need(bytes(rows[1]['frame']) == after[0x7fec:0x8000], 'original observed/final copied frame join')
    report = parse(packet['js/report.json'])
    keys(report, 'schema finiteRoundTripPass firstFailure calls completed fixtureSha256 memoryBeforeSha256 memoryAfterSha256 outputSha256 ports observations')
    calls = integer(report['calls'], last_call, CAPS['calls'])
    need(report['schema'] == SCHEMA+'js-probe.v1' and report['firstFailure'] is None and report['completed'] is True and
         report['finiteRoundTripPass'] is True and report['fixtureSha256'] == ROM_SHA and report['memoryBeforeSha256'] == sha(before) and
         report['memoryAfterSha256'] == sha(after) and report['outputSha256'] == sha(packet['js/stdout']) and
         type(report['observations']) is int and report['observations'] == 4, 'raw JS report joins')
    need(type(report['ports']) is list and len(report['ports']) == 2, 'two actual PIC masks')
    previous = 0
    for row, port in zip(report['ports'], (0x21, 0xa1)):
        keys(row, 'port value call'); need(row['port'] == port and row['value'] == 255, 'original PIC output')
        previous = integer(row['call'], previous+1, rows[0]['beforeCall']-1)
    writes = parse(packet['js/writes.json']); need(type(writes) is list and len(writes) <= CAPS['writes'], 'bounded original byte-write journal')
    replay = bytearray(before); previous = 1; last_writes = {}; observation_index = 0
    for index, row in enumerate(writes):
        keys(row, 'index call address before after')
        need(type(row['index']) is int and row['index'] == index, 'original write order'); previous = integer(row['call'], previous, calls)
        # Observations precede step(call), so only writes with SMALLER call
        # numbers can have affected their twenty raw frame bytes.
        while observation_index < 4 and rows[observation_index]['beforeCall'] <= row['call']:
            need(bytes(rows[observation_index]['frame']) == replay[0x7fec:0x8000], 'observed frame/original journal prefix')
            observation_index += 1
        address = integer(row['address'], 0, 0xeffff); integer(row['before'], 0, 255); integer(row['after'], 0, 255)
        need(replay[address] == row['before'], 'original write before byte'); replay[address] = row['after']
        last_writes[address] = row['call']
    while observation_index < 4:
        need(bytes(rows[observation_index]['frame']) == replay[0x7fec:0x8000], 'observed frame/original journal prefix')
        observation_index += 1
    need(bytes(replay) == after, 'whole RAM original write replay')
    for address in range(0x7fec, 0x8000):
        need(last_writes.get(address) == rows[0]['beforeCall'], 'actual INT80 frame write at observed instruction')
    for start, count, low, high in ((0x7000,48,1,rows[0]['beforeCall']-1),
            (0x7040,48,rows[1]['beforeCall'],rows[2]['beforeCall']-1),
            (0x70c0,20,rows[1]['beforeCall'],rows[2]['beforeCall']-1),
            (0x7080,48,rows[3]['beforeCall'],calls)):
        need(all(low <= last_writes.get(address, -1) <= high for address in range(start,start+count)),
             'original record writes inside observed instruction intervals')
    qreport = parse(packet['qemu/report.json']); keys(qreport, 'schema fixtureSha256 outputSha256 firstFailure secondary')
    need(qreport == {'schema': SCHEMA+'qemu.v1', 'fixtureSha256': ROM_SHA, 'outputSha256': sha(packet['qemu/stdout']), 'firstFailure': None, 'secondary': []}, 'QEMU raw report joins')
    return {'schema': SCHEMA+'admission.v1', 'pass': True, 'head': source['head'], 'roles': 20,
            'romSha256': ROM_SHA, 'artifactSha256': sha(raw), 'ordinaryCalls': calls,
            'qualifiedBoundary': 'one software INT80 privilege-changing IRETD roundtrip',
            'hardwareIrqQualified': False, 'generalDpmiQualified': False, 'performanceQualified': False}


SETUP_ROLES=('enclosing','controller','js','qemu','preparation')
SETUP_INPUTS=('request.original.json','event.original.json','runtime-expectation.json','launch-plan.json','installation.original.json')
SETUP_LIMITS={'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','pids.max':'64'}
SETUP_READS=tuple(SETUP_LIMITS)+('cgroup.type','cgroup.procs','pids.current','cgroup.events',
    'memory.events','cpu.stat','memory.current','memory.peak')
SETUP_OBSERVATION_CAP=16384
SETUP_SOURCE_PATHS=frozenset(('LICENSE package.json src/experimental/i80386.js .github/workflows/i80386-ring3-int-iret.yml '
    'docs/I80386-RING3-INT-IRET-RESULTS.md test/i80386-ring3-int-iret.test.mjs').split())|{
    'scripts/i80386-ring3-int-iret/'+name for name in ('fixture.mjs','probe.mjs','run.py','reader.py','controls.py','README.md')}


def canonical(value):
    return (json.dumps(value,sort_keys=True,separators=(',', ':'),allow_nan=False)+'\n').encode()


def setup_environment(environ):
    run=environ.get('GITHUB_RUN_ID');attempt=environ.get('GITHUB_RUN_ATTEMPT')
    need(type(run) is str and re.fullmatch('[1-9][0-9]{0,19}',run) and attempt=='1','first official setup run')
    for name,size in (('BW_EXPECTED_HEAD',40),('BW_EXPECTED_TREE',40),('BW_RING3_APPROVED_REQUEST_SHA256',64)):
        digest(environ.get(name),size)
    ids=[]
    for name in ('SUDO_UID','SUDO_GID'):
        value=environ.get(name);need(type(value) is str and re.fullmatch('[1-9][0-9]{0,9}',value) and int(value)<2**31,'positive setup invoker')
        ids.append(int(value))
    return run,ids


def setup_metadata(info):
    return [getattr(info,'st_'+name) for name in ('dev','ino','mode','uid','gid','nlink','size','mtime_ns')]


def setup_membership(raw,run):
    need(type(raw) is str and len(raw.encode('ascii'))<=4096 and raw.startswith('0::/') and raw.endswith('\n') and raw.count('\n')==1,
         'bounded canonical unified membership')
    path=raw[3:-1];parts=path[1:].split('/') if path!='/' else []
    need(all(part not in ('','.','..') and re.fullmatch('[A-Za-z0-9_.:@+-]+',part) for part in parts),'canonical membership components')
    name='bw-ring3-'+run+'-1'
    need(all(path!='/'+group and not path.startswith('/'+group+'/') for group in (name,name+'-preparation')),'outside both resource trees')


def setup_proc_read(path):
    need(path in ('/proc/self/cgroup','/proc/self/status'),'two fixed observer proc inputs')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);first=None;raw=bytearray()
    try:
        before=os.fstat(fd);need(stat.S_ISREG(before.st_mode),'regular fixed proc input')
        while True:
            chunk=os.read(fd,min(4096,4097-len(raw)))
            if not chunk:break
            raw.extend(chunk);need(len(raw)<=4096,'fixed proc byte cap')
        need(setup_metadata(os.fstat(fd))==setup_metadata(before) and
             setup_metadata(os.stat(path,follow_symlinks=False))==setup_metadata(before),'stable fixed proc descriptor/path identity')
    except BaseException as error:first=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if first is None:first=error
            else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'proc-close','name':type(error).__name__,'message':str(error)}]
    if first is not None:raise first
    return bytes(raw).decode('ascii')


def observe_hosted_setup(environ):
    """Independent readonly implementation; never imports producer setup code.

    Each held descriptor is compared with its named path. This is one finite
    observation, not a root ownership lease or a runtime/guest approval.
    """
    result={'schema':'bw.ring3.setup-observation.v1','inputs':{},'source':{},'directories':{},'parent':{},'firstFailure':None,'secondary':[]}
    descriptors=[]
    def failed(error,phase):
        value={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if result['firstFailure'] is None:result['firstFailure']=value
        else:result['secondary'].append(value)
        result['secondary'].extend(getattr(error,'setup_secondary',[]))
    def attempt(phase,operation):
        try:return operation()
        except BaseException as error:failed(error,phase)
    def directory(path,owner):
        need(path.resolve(strict=True)==path,'canonical observer directory')
        fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK);descriptors.append(fd)
        info=os.fstat(fd)
        need(stat.S_ISDIR(info.st_mode) and (info.st_uid,info.st_gid)==tuple(owner) and info.st_mode&0o022==0 and
             setup_metadata(info)==setup_metadata(path.lstat()),'observer held directory owner/mode/path')
        return fd,setup_metadata(info)
    def held_item(opened,fd,name,target,cap,metadata_only=False,installed=False,source=False):
        before=os.fstat(opened)
        target['meta']=setup_metadata(before)
        need(stat.S_ISREG(before.st_mode) and before.st_mode&0o022==0,'observer regular nondelegated-write mode')
        need(setup_metadata(os.stat(name,dir_fd=fd,follow_symlinks=False))==target['meta'],'observer file name/held identity')
        if installed:
            need((before.st_uid,before.st_gid)==(0,0) and stat.S_IMODE(before.st_mode)==0o444 and before.st_nlink==1 and
                 0<before.st_size<=cap,'observer root readonly installed original')
        if not metadata_only:
            raw=bytearray()
            while True:
                chunk=os.read(opened,min(65536,cap+1-len(raw)))
                if not chunk:break
                raw.extend(chunk)
                target.update({'bytes':len(raw),'sha256':sha(raw)} if installed or source else {'raw':bytes(raw).decode('ascii')})
                need(len(raw)<=cap,'observer fixed read cap')
            if installed or source:need(len(raw)==before.st_size,'observer hashed input/source extent')
            else:target.setdefault('raw','')
            if source:target['blob']=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        need(setup_metadata(os.fstat(opened))==target['meta'] and
             setup_metadata(os.stat(name,dir_fd=fd,follow_symlinks=False))==target['meta'],'observer file readback identity')
        need(len(canonical(result))<=SETUP_OBSERVATION_CAP-1024,'observer original stdout cap reservation')
    def item(fd,name,target,cap,metadata_only=False,installed=False,source=False):
        flags=(os.O_PATH if metadata_only else os.O_RDONLY)|os.O_NOFOLLOW|os.O_NONBLOCK
        opened=os.open(name,flags,dir_fd=fd);first=None
        try:held_item(opened,fd,name,target,cap,metadata_only,installed,source)
        except BaseException as error:first=error
        finally:
            try:os.close(opened)
            except BaseException as error:
                if first is None:first=error
                else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'observer-file-close','name':type(error).__name__,'message':str(error)}]
        if first is not None:raise first
    try:
        need(os.getresuid()==(0,)*3 and os.getresgid()==(0,)*3,'root readonly setup observer')
        run,invoker=setup_environment(environ);name='bw-ring3-'+run+'-1'
        result.update(runId=run,attempt=1,head=environ['BW_EXPECTED_HEAD'],tree=environ['BW_EXPECTED_TREE'],
            requestSha256=environ['BW_RING3_APPROVED_REQUEST_SHA256'],invoker=invoker)
        result['membership']=setup_proc_read('/proc/self/cgroup');setup_membership(result['membership'],run)
        checkout=Path.cwd();checkoutfd,_=directory(checkout,invoker)
        for filename in sorted(SETUP_SOURCE_PATHS):
            target={};result['source'][filename]=target
            def source_item(filename=filename,target=target):
                path=checkout/filename;need(path.resolve(strict=True)==path,'canonical independent source path')
                item(checkoutfd,filename,target,4<<20,source=True)
                need(path.resolve(strict=True)==path,'independent source path readback')
            attempt('source-'+filename,source_item)
        for path in (Path('/'),Path('/run')):directory(path,(0,0))
        installed=Path('/run')/(name+'-admission');fd,meta=directory(installed,(0,0));result['installationDirectory']=meta
        for filename in SETUP_INPUTS:
            target={};result['inputs'][filename]=target
            attempt('installed-'+filename,lambda filename=filename,target=target:item(fd,filename,target,1<<20,installed=True))
        base=Path('/sys/fs/cgroup');basefd,meta=directory(base,(0,0));result['parent']={'meta':meta,'controls':{}}
        for filename in ('cgroup.controllers','cgroup.subtree_control'):
            target={};result['parent']['controls'][filename]=target
            attempt('parent-'+filename,lambda filename=filename,target=target:item(basefd,filename,target,4096))
        for role in SETUP_ROLES:
            path=base/(name+'-preparation') if role=='preparation' else base/name if role=='enclosing' else base/name/role
            target={'controls':{}};result['directories'][role]=target
            opened=attempt('directory-'+role,lambda path=path,role=role:directory(path,(0,0) if role=='preparation' else invoker))
            if opened is None:continue
            fd,meta=opened;target['meta']=meta
            filenames=SETUP_READS+(('cgroup.subtree_control',) if role=='enclosing' else ())+(('cgroup.kill',) if role in ('js','qemu') else ())
            for filename in filenames:
                control={};target['controls'][filename]=control
                attempt(role+'-'+filename,lambda filename=filename,control=control:item(fd,filename,control,4096,filename=='cgroup.kill'))
            attempt('directory-readback-'+role,lambda path=path,fd=fd,meta=meta:need(
                setup_metadata(os.fstat(fd))==meta and setup_metadata(path.lstat())==meta and path.resolve(strict=True)==path,
                'observer directory readback identity'))
    except BaseException as error:failed(error,'setup-observer')
    finally:
        for fd in reversed(descriptors):
            try:os.close(fd)
            except BaseException as error:failed(error,'setup-observer-close')
    if result['firstFailure'] is None:
        try:verify_setup_observation(result,prerequisite_expected(environ))
        except BaseException as error:failed(error,'setup-observer-policy')
    raw=canonical(result)
    if len(raw)>SETUP_OBSERVATION_CAP:
        # The child still fails. No truncated/missing snapshot is positive
        # evidence; the outside collector retains the exact bounded prefix.
        return raw[:SETUP_OBSERVATION_CAP],False
    return raw,result['firstFailure'] is None and result['secondary']==[]


def verify_setup_observation(value,expected):
    keys(value,'schema inputs source directories parent firstFailure secondary runId attempt head tree requestSha256 invoker membership installationDirectory')
    need(value['schema']=='bw.ring3.setup-observation.v1' and value['firstFailure'] is None and value['secondary']==[],
         'complete failure-free independent observer')
    for key in ('runId','attempt','head','tree','requestSha256','invoker'):
        need(equal(value[key],expected[key]),'observer external '+key+' join')
    setup_membership(value['membership'],expected['runId'])
    def metadata(row,owner,kind,device=None):
        need(type(row) is list and len(row)==8 and all(type(x) is int and x>=0 for x in row) and row[0]>0 and row[1]>0 and
             stat.S_IFMT(row[2])==kind and row[2]&0o022==0 and row[3:5]==owner and
             (device is None or row[0]==device),'independent observed metadata policy')
        return tuple(row[:2])
    metadata(value['installationDirectory'],[0,0],stat.S_IFDIR)
    need(type(value['source']) is dict and set(value['source'])==SETUP_SOURCE_PATHS,'independent twelve-file source observations')
    for row in value['source'].values():
        keys(row,'meta bytes sha256 blob');metadata(row['meta'],expected['invoker'],stat.S_IFREG)
        need(stat.S_IMODE(row['meta'][2])==0o644 and integer(row['bytes'],0,4<<20)==row['meta'][6],'observed source mode/extent')
        digest(row['sha256']);digest(row['blob'],40)
    need(type(value['inputs']) is dict and set(value['inputs'])==set(SETUP_INPUTS),'all independent installed inputs')
    for name,row in value['inputs'].items():
        keys(row,'meta bytes sha256');metadata(row['meta'],[0,0],stat.S_IFREG)
        need(stat.S_IMODE(row['meta'][2])==0o444 and row['meta'][5]==1 and
             integer(row['bytes'],1,CAPS['jsonBytes'])==row['meta'][6],'independent readonly input extent')
        digest(row['sha256'])
    need(value['inputs']['request.original.json']['sha256']==expected['requestSha256'],'independent request pin observation')
    parent=value['parent'];keys(parent,'meta controls');metadata(parent['meta'],[0,0],stat.S_IFDIR);device=parent['meta'][0]
    need(set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},'only required readonly shared-parent controls')
    for row in parent['controls'].values():
        keys(row,'meta raw');metadata(row['meta'],[0,0],stat.S_IFREG,device)
        need(type(row['raw']) is str and {'cpu','memory','pids'}<=set(row['raw'].split()),'parent controllers already enabled')
    need(type(value['directories']) is dict and set(value['directories'])==set(SETUP_ROLES),'all five independent resources')
    identities=set()
    for role,row in value['directories'].items():
        keys(row,'controls meta');owner=[0,0] if role=='preparation' else expected['invoker']
        identity=metadata(row['meta'],owner,stat.S_IFDIR,device)
        need(identity not in identities,'five distinct independently observed resources');identities.add(identity)
        files=set(SETUP_READS)|({'cgroup.subtree_control'} if role=='enclosing' else set())|({'cgroup.kill'} if role in ('js','qemu') else set())
        need(type(row['controls']) is dict and set(row['controls'])==files,'fixed resource observation controls')
        for filename,control in row['controls'].items():
            keys(control,'meta' if filename=='cgroup.kill' else 'meta raw')
            delegated=(role=='enclosing' and filename=='cgroup.procs') or (role in ('js','qemu') and filename in ('cgroup.procs','cgroup.kill'))
            metadata(control['meta'],expected['invoker'] if delegated else [0,0],stat.S_IFREG,device)
            if delegated:need(control['meta'][2]&0o200!=0,'minimum owner-write migration/kill delegation')
            if filename!='cgroup.kill':need(type(control['raw']) is str and len(control['raw'].encode('ascii'))<=4096,'bounded raw control original')
        controls=row['controls']
        need(all(controls[key]['raw'].strip()==item for key,item in SETUP_LIMITS.items()),'independently observed fixed caps')
        need(controls['cgroup.type']['raw'].strip()=='domain' and controls['cgroup.procs']['raw']=='' and
             controls['pids.current']['raw']=='0\n','independently observed empty domain resource')
        events=counters(controls['cgroup.events']['raw']);need(events.get('populated')==0 and events.get('frozen')==0,'empty unfrozen hierarchical resource')
        memory=counters(controls['memory.events']['raw']);need({'oom','oom_kill'}<=set(memory) and all(v==0 for k,v in memory.items() if k.startswith('oom')),
             'no independent setup OOM events')
        need({'usage_usec','user_usec','system_usec'}<=set(counters(controls['cpu.stat']['raw'])),'raw CPU counters retained')
        for filename in ('memory.current','memory.peak'):
            need(controls[filename]['raw'].strip().isdigit() and int(controls[filename]['raw'].strip())<=1<<30,'bounded setup memory observations')
        if role=='enclosing':need(set(controls['cgroup.subtree_control']['raw'].split())=={'cpu','memory','pids'},'root-owned manual controller enablement')
    return {'device':value['directories']['preparation']['meta'][0],'inode':value['directories']['preparation']['meta'][1]}


def prerequisite_expected(environ):
    run,invoker=setup_environment(environ)
    return {'schema':'bw.ring3.prerequisite-expectation.v1','runId':run,'attempt':1,'head':environ['BW_EXPECTED_HEAD'],
        'tree':environ['BW_EXPECTED_TREE'],'requestSha256':environ['BW_RING3_APPROVED_REQUEST_SHA256'],'invoker':invoker}


def prerequisite_original(raw):
    value=parse(raw);keys(value,'bytes sha256 base64')
    need(type(value['base64']) is str,'encoded prerequisite original')
    data=base64.b64decode(value['base64'],validate=True)
    need(base64.b64encode(data).decode()==value['base64'] and integer(value['bytes'],0,CAPS['jsonBytes'])==len(data) and
         digest(value['sha256'])==sha(data),'exact prerequisite original wrapper')
    return data


def verify_prerequisites(originals,expected):
    """New observation-only version. Never returns a guest admission verdict."""
    keys(expected,'schema runId attempt head tree requestSha256 invoker')
    need(expected['schema']=='bw.ring3.prerequisite-expectation.v1' and type(expected['attempt']) is int and expected['attempt']==1 and
         type(expected['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',expected['runId']) and
         type(expected['invoker']) is list and len(expected['invoker'])==2 and all(type(x) is int and 0<x<2**31 for x in expected['invoker']),
         'external prerequisite expectation shape')
    for key,size in (('head',40),('tree',40),('requestSha256',64)):digest(expected[key],size)
    need(type(originals) is dict and set(originals)==set(SETUP_INPUTS)|{'setup.observer.json','prerequisite.outer.json'},'closed prerequisite original set')
    need(all(type(raw) is bytes and len(raw)<=CAPS['jsonBytes'] for raw in originals.values()) and
         sum(map(len,originals.values()))<=5<<20,'unchanged prerequisite original caps')
    request_raw=originals['request.original.json'];need(sha(request_raw)==expected['requestSha256'],'external pre-label request pin')
    request=parse(request_raw);keys(request,'schema repository pullRequest head tree source runtime')
    need(request_raw==canonical(request) and request['schema']=='bw.ring3.approval-request.v1' and request['repository']=='CrispStrobe/bw-board' and
         type(request['pullRequest']) is int and request['pullRequest']>0 and request['head']==expected['head'] and request['tree']==expected['tree'],
         'approved source/repository/PR bindings')
    source_raw=prerequisite_original(canonical(request['source']));source=parse(source_raw)
    keys(source,'schema head tree files');need(source_raw==canonical(source) and source['schema']=='bw.ring3.source.v1' and
         source['head']==expected['head'] and source['tree']==expected['tree'],'approved source original')
    roster=set(('LICENSE package.json src/experimental/i80386.js .github/workflows/i80386-ring3-int-iret.yml '
        'docs/I80386-RING3-INT-IRET-RESULTS.md test/i80386-ring3-int-iret.test.mjs').split())|{
        'scripts/i80386-ring3-int-iret/'+name for name in ('fixture.mjs','probe.mjs','run.py','reader.py','controls.py','README.md')}
    need(type(source['files']) is dict and set(source['files'])==roster,'approved twelve-file roster')
    for row in source['files'].values():
        keys(row,'bytes sha256 mode blob');integer(row['bytes'],0,4<<20);digest(row['sha256']);digest(row['blob'],40);need(row['mode']=='100644','approved regular source mode')
    descriptor=request['runtime'];keys(descriptor,'commit tree path blob mode bytes sha256')
    for key,size in (('commit',40),('tree',40),('blob',40),('sha256',64)):digest(descriptor[key],size)
    runtime=originals['runtime-expectation.json']
    need(descriptor['path']=='ring3-runtime-expectation.json' and descriptor['mode']=='100644' and
         integer(descriptor['bytes'],1,256<<10)==len(runtime) and sha(runtime)==descriptor['sha256'] and
         hashlib.sha1(b'blob '+str(len(runtime)).encode()+b'\0'+runtime).hexdigest()==descriptor['blob'],'approved opaque runtime input')
    event=parse(originals['event.original.json']);pr=event.get('pull_request',{})
    need(event.get('action')=='labeled' and event.get('number')==request['pullRequest'] and type(event.get('number')) is int and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         event.get('label',{}).get('name')==LABEL and pr.get('number')==request['pullRequest'] and type(pr.get('number')) is int and
         pr.get('state')=='open' and pr.get('head',{}).get('sha')==expected['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and pr.get('head',{}).get('repo',{}).get('fork') is False and
         pr.get('base',{}).get('ref')=='master' and pr.get('base',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board','immutable event joins')
    body=pr.get('body');start='<!-- BW_RING3_ACTUAL_REQUEST_V1\n';end='\nBW_RING3_ACTUAL_REQUEST_V1 -->'
    need(type(body) is str and body.count(start)==1 and body.count(end)==1 and body.index(start)<body.index(end),'one immutable request block')
    block=body.split(start,1)[1].split(end,1)[0];wrapper=parse(block.encode())
    need(canonical(wrapper).decode().rstrip('\n')==block and prerequisite_original(canonical(wrapper))==request_raw,'event request original join')
    plan_raw=originals['launch-plan.json'];plan=parse(plan_raw);keys(plan,'schema runId attempt head tree source')
    need(plan_raw==canonical(plan) and plan=={'schema':'bw.ring3.launch-plan.v1','runId':expected['runId'],'attempt':1,
        'head':expected['head'],'tree':expected['tree'],'source':request['source']} and type(plan['attempt']) is int,'dynamic delivery plan joins approved source')
    installation=parse(originals['installation.original.json'])
    keys(installation,'schema runId attempt requestSha256 launchPlanSha256 files directory ancestors observations')
    need(installation['schema']=='bw.ring3.installation-envelope.v1' and installation['runId']==expected['runId'] and
         type(installation['attempt']) is int and installation['attempt']==1 and installation['requestSha256']==expected['requestSha256'] and
         installation['launchPlanSha256']==sha(plan_raw),'installation delivery hashes')
    need(set(installation['files'])==set(SETUP_INPUTS)-{'installation.original.json'},'installed four original identities')
    for name,row in installation['files'].items():
        keys(row,'identity bytes sha256');need(type(row['bytes']) is int and row['bytes']==len(originals[name]) and row['sha256']==sha(originals[name]),'installation exact original bytes/hash')
    observer=parse(originals['setup.observer.json']);keys(observer,'schema process stdout stderr')
    need(observer['schema']=='bw.ring3.setup-observer-original.v1','separate observer process original')
    process=observer['process'];keys(process,'schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
    expected_environment={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GITHUB_RUN_ID':expected['runId'],
        'GITHUB_RUN_ATTEMPT':'1','BW_EXPECTED_HEAD':expected['head'],'BW_EXPECTED_TREE':expected['tree'],
        'BW_RING3_APPROVED_REQUEST_SHA256':expected['requestSha256'],'SUDO_UID':str(expected['invoker'][0]),'SUDO_GID':str(expected['invoker'][1])}
    need(process['schema']=='bw.ring3.process.v1' and process['role']=='discovery' and process['cwdRole']=='checkout' and
         equal(process['environment'],expected_environment),'closed independent observer descriptor environment')
    integer(process['pid'],1);integer(process['pgid'],1);integer(process['parentPid'],1);integer(process['startTicks'],1)
    need(process['pgid']==process['pid'] and process['pid']!=process['parentPid'],'fresh independently observed process identity')
    start=integer(process['spawnMonoNs'],1);end=integer(process['reapMonoNs'],start)
    need(end-start<=10000000000,'finite observer spawn-to-reap original')
    keys(process['rusage'],'userSeconds systemSeconds maxRssKiB')
    for key in ('userSeconds','systemSeconds'):
        need(type(process['rusage'][key]) in (int,float) and 0<=process['rusage'][key]<=10,'bounded observer process usage')
    integer(process['rusage']['maxRssKiB'],0,1048576)
    need(type(process) is dict and process.get('firstFailure') is None and process.get('secondary')==[] and
         type(process.get('exitCode')) is int and process['exitCode']==0 and process.get('signal') is None and
         integer(process.get('waitStatus'),0,65535)==0 and process.get('timedOut') is False and
         process.get('argv')==['/usr/bin/python3','-I','-B','scripts/i80386-ring3-int-iret/reader.py','--observe-hosted-setup'],
         'fixed successful independent observer process')
    stdout=prerequisite_original(canonical(observer['stdout']));stderr=prerequisite_original(canonical(observer['stderr']))
    need(len(stdout)<=SETUP_OBSERVATION_CAP and stderr==b'','bounded observer original streams')
    observed=parse(stdout);prep=verify_setup_observation(observed,expected)
    for name,row in observed['source'].items():
        need(equal({'bytes':row['bytes'],'sha256':row['sha256'],'blob':row['blob'],'mode':'100644'},source['files'][name]),
             'independent live source joins approved twelve-file manifest')
    for name,row in observed['inputs'].items():
        need(row['bytes']==len(originals[name]) and row['sha256']==sha(originals[name]),'independent observed installation bytes/hash')
        if name in installation['files']:
            recorded=installation['files'][name]['identity'];keys(recorded,'dev ino mode uid gid nlink size mtime_ns')
            need(row['meta']==[recorded[key] for key in ('dev','ino','mode','uid','gid','nlink','size','mtime_ns')],'installer/observer finite file identity join')
    outer=parse(originals['prerequisite.outer.json']);keys(outer,'schema expectation installation setup partialInstallation partialSetup firstFailure secondary')
    need(outer['schema']=='bw.ring3.prerequisites-original.v1' and equal(outer['expectation'],expected) and
         outer['installation'] is True and outer['setup'] is True and outer['firstFailure'] is None and outer['secondary']==[],
         'failure-free original prerequisite stages')
    return {'schema':'bw.ring3.prerequisite-admission.v1','prerequisitesObserved':True,'guestQualified':False,
            'runtimeAdmitted':False,'preparationIdentity':prep,'requestSha256':expected['requestSha256']}


def admit_hosted_prerequisites(environ):
    expected=prerequisite_expected(environ);uid,gid=expected['invoker']
    need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],'actual dropped prerequisite reader')
    status=setup_proc_read('/proc/self/status');setup_membership(setup_proc_read('/proc/self/cgroup'),expected['runId'])
    for field in ('CapInh','CapPrm','CapEff','CapAmb'):
        found=re.search('^'+field+r':\s*([0-9a-fA-F]+)\s*$',status,re.M);need(found is not None and int(found[1],16)==0,'dropped prerequisite reader capabilities')
    path=Path.cwd()/'build'/'i80386-ring3-int-iret-prerequisites';info=path.lstat()
    need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode) and (info.st_uid,info.st_gid)==(uid,gid) and
         stat.S_IMODE(info.st_mode)==0o700,'fixed dropped prerequisite directory')
    originals={};directory=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        for name in (*SETUP_INPUTS,'setup.observer.json','prerequisite.outer.json'):
            fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
            try:
                before=os.fstat(fd);need(stat.S_ISREG(before.st_mode) and (before.st_uid,before.st_gid)==(uid,gid) and
                    stat.S_IMODE(before.st_mode)==0o400 and before.st_nlink==1 and 0<before.st_size<=1<<20,'fixed readonly dropped original')
                raw=bytearray()
                while True:
                    chunk=os.read(fd,min(65536,(1<<20)+1-len(raw)))
                    if not chunk:break
                    raw.extend(chunk);need(len(raw)<=1<<20,'dropped prerequisite read cap')
                need(len(raw)==before.st_size and setup_metadata(os.fstat(fd))==setup_metadata(before) and
                     setup_metadata(os.stat(name,dir_fd=directory,follow_symlinks=False))==setup_metadata(before),'stable dropped original bytes/identity')
                originals[name]=bytes(raw)
            finally:os.close(fd)
        need(setup_metadata(os.fstat(directory))==setup_metadata(info) and setup_metadata(path.lstat())==setup_metadata(info),'stable dropped prerequisite directory')
    finally:os.close(directory)
    return verify_prerequisites(originals,expected)


def decode_prerequisite_log(raw):
    need(type(raw) is bytes and len(raw)<=8<<20,'bounded prerequisite log original')
    names=set(SETUP_INPUTS)|{'setup.observer.json','prerequisite.outer.json','prerequisite.reader.json'}
    groups={};chunks=0
    for line in raw.splitlines():
        marker=b'RING3_PREREQUISITE ';offset=line.find(marker)
        if offset<0:continue
        prefix=line[:offset]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),'canonical official log timestamp prefix')
        value=parse(line[offset+len(marker):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.prerequisite-log.v1' and value['name'] in names,'new prerequisite-only log version/name')
        count=integer(value['count'],1,456);index=integer(value['index'],0,count-1);extent=integer(value['bytes'],0,1<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded prerequisite chunk encoding')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and index==len(group['parts']),
             'one ordered immutable prerequisite chunk sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<=2600,'finite prerequisite log chunk roster')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete prerequisite original chunks')
        encoded=''.join(group['parts']);data=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(data).decode()==encoded and len(data)==group['bytes'] and sha(data)==group['sha256'],'prerequisite original exact encoding/bytes/digest')
        originals[name]=data
    need(sum(map(len,originals.values()))<=5<<20,'unchanged aggregate prerequisite originals cap')
    return originals


def verify_prerequisite_log(raw,expected):
    originals=decode_prerequisite_log(raw);reader_raw=originals.pop('prerequisite.reader.json',None)
    verdict=verify_prerequisites(originals,expected)
    need(type(reader_raw) is bytes,'original dropped admission process required')
    retained=parse(reader_raw);keys(retained,'schema process stdout stderr')
    need(retained['schema']=='bw.ring3.prerequisite-reader-original.v1','new dropped reader original version')
    original_observer=parse(originals['setup.observer.json'])
    process=retained['process'];observer_process=original_observer['process']
    need(type(process) is dict and set(process)==set(observer_process) and process['schema']=='bw.ring3.process.v1' and
         process['role']=='discovery' and process['cwdRole']=='checkout' and equal(process['environment'],observer_process['environment']) and
         process['argv']==['/usr/bin/python3','-I','-B','scripts/i80386-ring3-int-iret/reader.py','--admit-hosted-prerequisites'] and
         type(process['exitCode']) is int and process['exitCode']==0 and integer(process['waitStatus'],0,65535)==0 and process['signal'] is None and
         process['timedOut'] is False and process['firstFailure'] is None and process['secondary']==[],
         'fixed successful dropped admission process original')
    pid=integer(process['pid'],1);need(integer(process['pgid'],1)==pid and integer(process['parentPid'],1)==observer_process['parentPid'] and
         pid!=process['parentPid'] and (pid,integer(process['startTicks'],1))!=(observer_process['pid'],observer_process['startTicks']),
         'distinct fresh dropped reader process under same outside parent')
    start=integer(process['spawnMonoNs'],integer(observer_process['reapMonoNs'],1));end=integer(process['reapMonoNs'],start)
    need(end-start<=10000000000,'finite causally later dropped reader process')
    keys(process['rusage'],'userSeconds systemSeconds maxRssKiB')
    for key in ('userSeconds','systemSeconds'):
        need(type(process['rusage'][key]) in (int,float) and 0<=process['rusage'][key]<=10,'bounded dropped reader usage')
    integer(process['rusage']['maxRssKiB'],0,1048576)
    need(prerequisite_original(canonical(retained['stdout']))==canonical(verdict) and
         prerequisite_original(canonical(retained['stderr']))==b'','retained independent admission verdict matches fresh offline validation')
    return verdict


RUNTIME_NODE='/opt/hostedtoolcache/node/22.23.3/x64/bin/node'
RUNTIME_QEMU='/usr/bin/qemu-system-i386'
RUNTIME_TCG='/usr/lib/x86_64-linux-gnu/qemu/accel-tcg-i386.so'
RUNTIME_SELECTED={'node':{'bytes':124827920,'sha256':'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'},
    'qemu':{'bytes':26359752,'sha256':'28fa14f1c45fca7422e3ec5737768b33b705de2f31014a76e658d4263464a6a5'}}
INVENTORY_ENTRY_ENABLED=True  # Reviewed metadata-only path; actual execution remains disabled.


def stable_probe_descriptors(value):
    paths={name:value['executables'][name]['path'] for name in ('node','python','qemu')}
    argv={role+'-version':[path,'--version'] for role,path in paths.items()}
    argv.update({'ldd-'+role:['/usr/bin/ldd',path] for role,path in paths.items()})
    argv.update({'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'],'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'ldd-tcg':['/usr/bin/ldd',resolve_alias(RUNTIME_TCG,value['aliases'])],
        'package-version':['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES],
        'package-files':['/usr/bin/dpkg-query','-L',*PACKAGE_NAMES]})
    result=[]
    for role,arguments in sorted(argv.items()):
        path=resolve_alias(arguments[0],value['aliases']);row=value['files'][path]
        result.append({'role':role,'argv':arguments,'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
            'executable':{'path':path,'bytes':row['bytes'],'sha256':row['sha256'],'mode':row['mode']}})
    return result


def runtime_expectation(raw,expected_sha256):
    """Standalone stable-policy admission. Raw ASLR text is never its pin."""
    need(type(raw) is bytes and 0<len(raw)<=256<<10 and digest(expected_sha256)==sha(raw),'external runtime expectation original pin')
    value=parse(raw);keys(value,'schema platform executables versions files aliases packages packagePaths probes')
    need(raw==canonical(value) and value['schema']=='bw.ring3.runtime-expectation.v1','canonical explicit runtime expectation version')
    keys(value['platform'],'sysname release machine')
    need(value['platform']['sysname']=='Linux' and value['platform']['machine']=='x86_64' and
         type(value['platform']['release']) is str and re.fullmatch('[A-Za-z0-9_.+-]{1,128}',value['platform']['release']),'selected platform release')
    files=value['files'];aliases=value['aliases']
    need(type(files) is dict and 1<=len(files)<=512 and type(aliases) is dict and len(aliases)<=256,'held stable graph counts')
    total=0
    for path,row in files.items():
        runtime_path(path);keys(row,'bytes sha256 kind mode');total+=integer(row['bytes'],1,268435456);digest(row['sha256'])
        need(row['kind'] in RUNTIME_KINDS and type(row['mode']) is int and 0<=row['mode']<=0o777 and row['mode']&0o022==0,
             'selected file kind/permission mode')
        if row['kind'].endswith('-binary') or row['kind'] in ('observation-tool','tool-interpreter'):need(row['mode']&0o111!=0,'selected executable permissions')
    need(total<=1073741824,'held selected graph total extent')
    for path,row in aliases.items():
        runtime_path(path);keys(row,'linkText target');runtime_path(row['target'])
        need(path not in files and type(row['linkText']) is str and 0<len(row['linkText'].encode())<=256 and
             re.fullmatch('[A-Za-z0-9_.+/-]+',row['linkText']) and
             resolve_alias(posixpath.normpath(posixpath.join(posixpath.dirname(path),row['linkText'])),aliases)==row['target'],
             'selected stable alias text/canonical target')
    need(all(resolve_alias(path,aliases)==path for path in files),'canonical selected file keys')
    keys(value['executables'],'node python qemu');keys(value['versions'],'node python qemu')
    for role,requested in (('node',RUNTIME_NODE),('python','/usr/bin/python3'),('qemu',RUNTIME_QEMU)):
        path=resolve_alias(requested,aliases);row=value['executables'][role];keys(row,'path bytes sha256')
        need(path in files and row=={'path':path,'bytes':files[path]['bytes'],'sha256':files[path]['sha256']} and
             type(row['bytes']) is int and files[path]['kind']==role+'-binary','fixed selected executable graph join')
        if role in RUNTIME_SELECTED:need({key:row[key] for key in ('bytes','sha256')}==RUNTIME_SELECTED[role],'independent historical '+role+' selection')
    need(value['versions']['node']=='v22.23.3' and type(value['versions']['python']) is str and re.fullmatch(r'Python 3\.\d+\.\d+',value['versions']['python']) and
         type(value['versions']['qemu']) is str and re.fullmatch(r'QEMU emulator version 8\.2\.2(?:[ (][^\r\n]*)?',value['versions']['qemu']),'selected runtime versions')
    packages=value['packages'];need(type(packages) is list and len(packages)==5 and
         [row.get('name') for row in packages if type(row) is dict]==sorted(PACKAGE_NAMES),'five sorted unique package rows')
    for row in packages:
        keys(row,'name version architecture');need(type(row['version']) is str and re.fullmatch('[A-Za-z0-9.+:~_-]{1,128}',row['version']) and
             row['architecture'] in ('amd64','all'),'stable selected package fields')
        if row['name']=='qemu-system-x86':need(row['version']=='1:8.2.2+ds-0ubuntu1.18' and row['architecture']=='amd64','historical selected QEMU package')
    paths=value['packagePaths'];need(type(paths) is list and 0<len(paths)<=2048 and paths==sorted(set(paths)),'bounded sorted stable package path union')
    for path in paths:runtime_path(path)
    module=resolve_alias(RUNTIME_TCG,aliases);need(module in files and files[module]['kind']=='tcg-module' and RUNTIME_TCG in paths,'selected i386 TCG module')
    required={value['executables']['qemu']['path'],module}|{path for path,row in files.items() if row['kind']=='qemu-data'}
    need(any(row['kind']=='qemu-data' for row in files.values()) and required<={resolve_alias(path,aliases) for path in paths},'selected QEMU package file ownership')
    need(equal(value['probes'],stable_probe_descriptors(value)),'complete fixed probe descriptor/executable roster')
    return value


def verify_runtime_stable_original(original,expectation_raw,expected_sha256):
    expected=runtime_expectation(expectation_raw,expected_sha256)
    runtime(original,original)  # Preserve every legacy internal/raw predicate.
    need(equal(original['platform'],expected['platform']) and equal(original['executables'],expected['executables']) and
         equal(original['versions'],expected['versions']),'raw runtime joins admitted stable platform/executables/versions')
    package=original['qemuPackage']
    for path,row in package['files'].items():
        need(path in expected['files'] and equal(row,{key:expected['files'][path][key] for key in ('bytes','sha256','kind')}),
             'every discovered original file joins selected superset')
    for path,row in package['aliases'].items():need(path in expected['aliases'] and equal(row,expected['aliases'][path]),'discovered original alias joins selected superset')
    required={path for path,row in expected['files'].items() if row['kind'] in
        ('qemu-data','tcg-module','qemu-binary','node-binary','python-binary','observation-tool','tool-interpreter')}
    need(required<=set(package['files']),'complete engine/tool/package graph in original')
    for probe in package['probes']:
        if probe['role']=='package-version':
            need(sorted(line.split('\t') for line in probe['stdout'].splitlines())==[[row['name'],row['version'],row['architecture']] for row in expected['packages']],
                 'raw original package version join')
        elif probe['role']=='package-files':need(sorted(set(probe['stdout'].splitlines()))==expected['packagePaths'],'raw original stable package path union')
        elif probe['role'].startswith('ldd-'):
            need(all(resolve_alias(path,expected['aliases']) in expected['files'] for path in ldd_paths(probe['stdout'])),
                 'raw ldd paths independently join selected graph without ASLR pinning')
    return expected


class InventoryFiles:
    """Independent metadata/hash reader; no producer code or mutable setup API."""
    def __init__(self):self.prefixes={};self.metadata={};self.maps_original=None;self.rejected={}

    def resolve(self,path,seen=()):
        runtime_path(path);need(path not in seen and len(seen)<16,'bounded independent inventory aliases')
        parts=Path(path).parts;aliases={}
        for index in range(1,len(parts)):
            name=str(Path(*parts[:index+1]));info=os.lstat(name)
            if not stat.S_ISLNK(info.st_mode):continue
            text=os.readlink(name);need(0<len(text.encode())<=256 and re.fullmatch('[A-Za-z0-9_.+/-]+',text),'bounded inventory alias text')
            target=posixpath.normpath(posixpath.join(posixpath.dirname(name),text));final,nested=self.resolve(target,seen+(path,))
            aliases.update(nested);aliases[name]={'linkText':text,'target':final}
            later=str(Path(final,*parts[index+1:]))
            resolved,more=self.resolve(later,seen+(path,)) if later!=final else (final,{})
            aliases.update(more);return resolved,aliases
        return path,aliases

    def fact(self,path):
        runtime_path(path)
        observation={'path':path,'canonical':False,'namedBefore':None,'heldBefore':None,'heldAfter':None,'namedAfter':None,
            'bytesRead':0,'closeAttempted':False,'closeSucceeded':False,'firstFailure':None,'secondary':[]}
        fd=None;first=None;count=0;digest=hashlib.sha256();prefix=bytearray()
        def failed(error,phase):
            nonlocal first
            if first is None:first=error
            else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':phase,'name':type(error).__name__,'message':str(error)}]
        try:
            need(str(Path(path).resolve(strict=True))==path,'canonical independent inventory file');observation['canonical']=True
            observation['namedBefore']=setup_metadata(os.stat(path,follow_symlinks=False))
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            before=os.fstat(fd);observation['heldBefore']=setup_metadata(before)
            need(stat.S_ISREG(before.st_mode) and 0<before.st_size<=268435456 and before.st_mode&0o022==0,
                'bounded inventory regular file and mode')
            while True:
                part=os.read(fd,min(65536,268435457-count))
                if not part:break
                count+=len(part);need(count<=268435456,'inventory file extent cap');digest.update(part)
                if len(prefix)<64:prefix.extend(part[:64-len(prefix)])
            observation['heldAfter']=setup_metadata(os.fstat(fd));observation['namedAfter']=setup_metadata(os.stat(path,follow_symlinks=False))
            need(count==before.st_size and observation['heldAfter']==setup_metadata(before) and
                 observation['namedAfter']==setup_metadata(before) and str(Path(path).resolve(strict=True))==path,
                 'inventory held file/mode/name identity readback')
            value={'bytes':count,'sha256':digest.hexdigest(),'mode':stat.S_IMODE(before.st_mode)}
            self.prefixes[path]=bytes(prefix);self.metadata[path]=setup_metadata(before)
        except BaseException as error:first=error
        finally:
            if first is not None:
                for name,observe in (('heldAfter',lambda:os.fstat(fd)),('namedAfter',lambda:os.stat(path,follow_symlinks=False))):
                    if name=='heldAfter' and fd is None:continue
                    try:
                        observation[name]=setup_metadata(observe())
                        reference=observation['heldBefore'] if name=='heldAfter' else observation['namedBefore']
                        need(reference is None or observation[name]==reference,'rejected inventory file identity readback drift')
                    except BaseException as error:failed(error,'inventory-rejected-'+name)
            if fd is not None:
                observation['closeAttempted']=True
                try:os.close(fd);observation['closeSucceeded']=True
                except BaseException as error:failed(error,'inventory-file-close')
        if first is not None:
            observation.update(bytesRead=count,firstFailure={'phase':'inventory-file','name':type(first).__name__,'message':str(first)},
                secondary=list(getattr(first,'setup_secondary',[])))
            self.rejected[path]=observation
            raise first
        return value

    def alias(self,path):
        before=os.lstat(path);need(stat.S_ISLNK(before.st_mode),'inventory alias remains link')
        text=os.readlink(path);target,_=self.resolve(posixpath.normpath(posixpath.join(posixpath.dirname(path),text)))
        need(setup_metadata(os.lstat(path))==setup_metadata(before),'inventory alias identity readback')
        return {'linkText':text,'target':target}

    def platform(self):
        value=platform.uname();return {'sysname':value.system,'release':value.release,'machine':value.machine}

    def is_file(self,path):return Path(path).is_file()

    def python_files(self):
        # Review this explicit union when either executable source imports new
        # runtime modules. It deliberately excludes producer and test modules.
        import resource,selectors,signal,subprocess,time,urllib.request,zipfile,io,platform
        paths=set();checkout=Path.cwd().resolve()
        for module in tuple(sys.modules.values()):
            for key in ('__file__','__cached__'):
                name=getattr(module,key,None)
                if not isinstance(name,str) or not Path(name).is_absolute():continue
                path=Path(name).resolve()
                if not path.is_relative_to(checkout) and path.is_file():paths.add(str(path))
        need(len(paths)<=256,'held Python module superset census cap');return sorted(paths)

    def mapped_libraries(self):
        fd=os.open('/proc/self/maps',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);first=None;raw=bytearray()
        try:
            while True:
                part=os.read(fd,65537-len(raw))
                if not part:break
                raw.extend(part);need(len(raw)<=65536,'held bounded Python maps inventory')
        except BaseException as error:first=error
        finally:
            try:os.close(fd)
            except BaseException as error:
                if first is None:first=error
                else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'inventory-maps-close','name':type(error).__name__,'message':str(error)}]
        prefix=bytes(raw[:65536]);self.maps_original={'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}
        if first is not None:raise first
        paths=set()
        for line in raw.decode().splitlines():
            fields=line.split(None,5)
            if len(fields)<6 or not fields[5].startswith('/'):continue
            path=fields[5];need(not path.endswith(' (deleted)'),'mapped inventory file not deleted')
            if '.so' in Path(path).name or Path(path).name.startswith('ld-'):paths.add(runtime_path(path))
        need(len(paths)<=128,'held mapped library inventory cap');return sorted(paths)


def inventory_probe(argv):
    """Fixed-caller metadata child; bounded streams and retained terminal facts.

    Spawn/preexec is not preempted by this loop. The separately reviewed job
    deadline remains required. No signal is sent after the owned leader reaps.
    """
    environment={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
    process=None;selector=None;streams={'stdout':bytearray(),'stderr':bytearray()};pipes={};terminal=None;identity=None
    started=time.monotonic_ns();deadline=started+10000000000;cleanup=None;failure=None;secondary=[];sent=False;overflowed=set()
    record={'schema':'bw.ring3.inventory-process.v1','argv':argv,'environment':environment,'pid':None,'pgid':None,
        'parentPid':os.getpid(),'startTicks':None,'spawnMonoNs':started,'reapMonoNs':None,'exitCode':None,'signal':None,
        'waitStatus':None,'timedOut':False,'rusage':None,'firstFailure':None,'secondary':secondary}
    def failed(error,phase):
        nonlocal failure
        row={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if failure is None:failure=row
        else:secondary.append(row)
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(1<<20,1<<20));resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
    def child_identity():
        fd=os.open('/proc/'+str(process.pid)+'/stat',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:raw=os.read(fd,4097);need(len(raw)<=4096,'bounded inventory child identity')
        finally:os.close(fd)
        fields=raw.decode().rsplit(')',1)[1].split()
        need(len(fields)>19 and int(fields[1])==os.getpid() and int(fields[2])==process.pid and int(fields[3])==process.pid,
             'direct fresh inventory session leader')
        return (process.pid,int(fields[19]))
    def reap():
        nonlocal terminal
        pid,status,usage=os.wait4(process.pid,os.WNOHANG)
        if pid:
            need(pid==process.pid,'owned inventory child wait result');terminal=status;process.returncode=os.waitstatus_to_exitcode(status)
            record.update(waitStatus=status,exitCode=os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
                signal=os.WTERMSIG(status) if os.WIFSIGNALED(status) else None,reapMonoNs=time.monotonic_ns(),
                rusage={'userSeconds':usage.ru_utime,'systemSeconds':usage.ru_stime,'maxRssKiB':usage.ru_maxrss})
    def stop():
        nonlocal sent
        if sent or terminal is not None or process is None:return
        need(identity is not None and child_identity()==identity and signal.getsignal(signal.SIGCHLD)==signal.SIG_DFL,
             'unreaped exact inventory leader identity before signal')
        sent=True;os.killpg(process.pid,signal.SIGKILL)
    try:
        signal.signal(signal.SIGCHLD,signal.SIG_DFL)
        process=subprocess.Popen(argv,env=environment,cwd=Path.cwd(),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            start_new_session=True,close_fds=True,preexec_fn=limits)
        record['pid']=process.pid
        pipes={'stdout':process.stdout,'stderr':process.stderr};identity=child_identity()
        record.update(pid=process.pid,pgid=process.pid,startTicks=identity[1]);selector=selectors.DefaultSelector()
        for name,stream in pipes.items():os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ,name)
        while True:
            now=time.monotonic_ns()
            if now>=deadline and failure is None:
                record['timedOut']=True;failed(Refusal('inventory metadata wall bound'),'inventory-timeout');cleanup=now+2000000000
                try:stop()
                except BaseException as error:failed(error,'inventory-kill')
            if cleanup is not None and now>=cleanup:break
            for key,unused in selector.select(0 if terminal is not None else min(.05,max(0,(deadline-now)/1e9))):
                try:part=os.read(key.fileobj.fileno(),16385)
                except BlockingIOError:continue
                if not part:selector.unregister(key.fileobj);continue
                name=key.data;remaining=16384-len(streams[name]);streams[name].extend(part[:remaining])
                if len(part)>remaining:
                    if name not in overflowed:
                        failed(Refusal('inventory original '+name+' stream cap'),'inventory-stream');overflowed.add(name)
                    if cleanup is None:cleanup=time.monotonic_ns()+2000000000
                    try:stop()
                    except BaseException as error:failed(error,'inventory-kill')
            if terminal is None:reap()
            if terminal is not None:
                if not selector.get_map():break
                if cleanup is None:cleanup=time.monotonic_ns()+2000000000
        if terminal is None:failed(Refusal('inventory owned leader not reaped'),'inventory-terminal')
        elif selector.get_map():failed(Refusal('inventory streams/descendants remain uncertain after leader reap'),'inventory-drain')
        if terminal is not None:need(record['exitCode']==0 and record['signal'] is None,'inventory metadata natural zero exit')
    except BaseException as error:
        failed(error,'inventory-probe')
        if process is not None and terminal is None:
            try:stop()
            except BaseException as extra:failed(extra,'inventory-exception-kill')
            # A failure does not claim successful cleanup or retry the command.
            try:reap()
            except BaseException as extra:failed(extra,'inventory-exception-reap')
    finally:
        if selector is not None:
            try:selector.close()
            except BaseException as error:failed(error,'inventory-selector-close')
        for stream in pipes.values():
            try:stream.close()
            except BaseException as error:failed(error,'inventory-stream-close')
    record['firstFailure']=failure
    return record,{name:bytes(raw) for name,raw in streams.items()}


class RuntimeInventory:
    NODE_PATH=RUNTIME_NODE

    def candidate(self,value):return value
    def validate_candidate(self,raw):return runtime_expectation(raw,sha(raw))

    PRIORITY={'shared-library':0,'qemu-data':1,'python-stdlib':2,'observation-tool':3,'tool-interpreter':3,
        'tcg-module':4,'elf-interpreter':4,'qemu-binary':5,'node-binary':5,'python-binary':5}
    def __init__(self,files=None,probe=None):
        self.ops=InventoryFiles() if files is None else files;self.probe=inventory_probe if probe is None else probe
        self.files={};self.aliases={};self.probes=[];self.processes=[];self.attempted=False;self.partial={};self.executables={}

    def argv(self,role):
        if role.endswith('-version') and role[:-8] in self.executables:return [self.executables[role[:-8]],'--version']
        if role.startswith('ldd-') and role[4:] in self.executables:return ['/usr/bin/ldd',self.executables[role[4:]]]
        if role=='ldd-shell':return ['/usr/bin/ldd','/usr/bin/bash']
        if role=='ldd-dpkg-query':return ['/usr/bin/ldd','/usr/bin/dpkg-query']
        if role=='ldd-tcg':return ['/usr/bin/ldd',self.ops.resolve(RUNTIME_TCG)[0]]
        if role=='package-version':return ['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]
        if role=='package-files':return ['/usr/bin/dpkg-query','-L',*PACKAGE_NAMES]
        raise Refusal('unknown fixed inventory probe role')

    def add(self,path,kind):
        path,aliases=self.ops.resolve(runtime_path(path))
        for name,item in aliases.items():
            need(name not in self.aliases or self.aliases[name]==item,'inventory alias drift during census')
            self.aliases[name]=item;need(len(self.aliases)<=256,'held inventory alias cap')
        if path not in self.files:
            need(len(self.files)<512,'held inventory file cap');fact=self.ops.fact(path)
            # Retain the actual observation even when its executable mode or
            # ELF prefix refuses admission before any metadata child.
            self.files[path]={**fact,'kind':kind}
            need(type(fact['bytes']) is int and 0<fact['bytes']<=268435456,'held inventory file extent')
            if kind.endswith('-binary') or kind in ('observation-tool','tool-interpreter'):
                need(type(fact['mode']) is int and fact['mode']&0o111!=0,'inventory fixed tool executable mode before probes')
            if kind.endswith('-binary') or kind in ('shared-library','elf-interpreter','tcg-module','tool-interpreter'):
                need(self.ops.prefixes[path].startswith(b'\x7fELF'),'selected inventory ELF identity')
            need(sum(row['bytes'] for row in self.files.values())<=1073741824,'held inventory graph extent')
        elif self.PRIORITY[kind]>self.PRIORITY[self.files[path]['kind']]:self.files[path]['kind']=kind
        return path

    def observe(self,role,argv):
        need(role in RUNTIME_ROLES and role not in {row['role'] for row in self.probes} and len(self.probes)<16,'fixed unique inventory probe roster')
        need(equal(argv,self.argv(role)),'exact fixed inventory metadata argv before process factory')
        # The caller constructs only the fixed named descriptors below, after
        # selected engine and tool identities have been read and retained.
        held_argv=canonical(argv)
        process,streams=self.probe(parse(held_argv))
        self.processes.append({'role':role,'process':process,'stdout':{'bytes':len(streams['stdout']),'sha256':sha(streams['stdout']),
            'base64':base64.b64encode(streams['stdout']).decode()},'stderr':{'bytes':len(streams['stderr']),'sha256':sha(streams['stderr']),
            'base64':base64.b64encode(streams['stderr']).decode()}})
        original={'role':role,'argv':argv,'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
            'exitCode':process['exitCode'],'stdout':streams['stdout'].decode('utf-8','surrogateescape'),'stderr':streams['stderr'].decode('utf-8','surrogateescape')}
        self.probes.append(original)
        need(equal(process['argv'],parse(held_argv)) and equal(argv,parse(held_argv)),'returned metadata process joins held fixed descriptor')
        if process['firstFailure'] is not None:
            error=Refusal(process['firstFailure']['message']);error.inventory_first=process['firstFailure'];error.inventory_secondary=process['secondary']
            raise error
        need(len(streams['stdout'])<=16384 and len(streams['stderr'])<=16384 and process['firstFailure'] is None and process['secondary']==[] and
             type(process['exitCode']) is int and process['exitCode']==0 and streams['stderr']==b'','bounded successful original inventory metadata probe')
        return original['stdout']

    def ldd(self,role,path):
        output=self.observe(role,['/usr/bin/ldd',path]);count=0
        for line in output.splitlines():
            line=line.strip()
            if re.fullmatch(r'linux-vdso\.so\.\d+ \(0x[0-9a-f]+\)',line):continue
            match=re.fullmatch(r'(?:([^/\s]+) => )?(/[^\s]+) \(0x[0-9a-f]+\)',line)
            need(match is not None,'closed resolved inventory ldd row')
            self.add(match[2],'shared-library' if match[1] else 'elf-interpreter');count+=1
        need(count>0,'original inventory ELF dependencies')

    def discover(self):
        need(not self.attempted,'independent runtime inventory consumed; no retry');self.attempted=True
        self.partial={'files':self.files,'aliases':self.aliases,'probes':self.probes,'processes':self.processes,'fileMetadata':getattr(self.ops,'metadata',{}),
            'pythonFiles':[],'mappedLibraries':[],'mapsOriginal':None}
        executables=self.executables={name:self.add(path,name+'-binary') for name,path in (('node',self.NODE_PATH),('python','/usr/bin/python3'),('qemu',RUNTIME_QEMU))}
        for role,pin in RUNTIME_SELECTED.items():
            row=self.files[executables[role]];need({key:row[key] for key in ('bytes','sha256')}==pin,'historical selected '+role+' mismatch before any metadata tool execution')
        self.add('/usr/bin/ldd','observation-tool');self.add('/usr/bin/dpkg-query','observation-tool');shell=self.add('/usr/bin/bash','tool-interpreter')
        script=self.ops.prefixes[resolve_alias('/usr/bin/ldd',self.aliases)]
        need(script.startswith((b'#!/bin/bash\n',b'#!/usr/bin/bash\n')),'selected ldd fixed shell interface')
        need(self.add(script.splitlines()[0][2:].decode(),'tool-interpreter')==shell,'inventory ldd interpreter alias')
        for path in ('/lib/ld-linux.so.2','/lib64/ld-linux-x86-64.so.2','/libx32/ld-linux-x32.so.2'):
            if self.ops.is_file(path):self.add(path,'elf-interpreter')
        self.ldd('ldd-shell','/usr/bin/bash');self.ldd('ldd-dpkg-query','/usr/bin/dpkg-query')
        for name,path in executables.items():self.ldd('ldd-'+name,path)
        rows=[line.split('\t') for line in self.observe('package-version',['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]).splitlines()]
        need(len(rows)==5 and all(len(row)==3 for row in rows) and {row[0] for row in rows}==set(PACKAGE_NAMES),'fixed original inventory packages')
        packages=[{'name':name,'version':version,'architecture':architecture} for name,version,architecture in sorted(rows)]
        qemu=next(row for row in packages if row['name']=='qemu-system-x86')
        need(qemu['version']=='1:8.2.2+ds-0ubuntu1.18' and qemu['architecture']=='amd64','historical selected inventory package')
        listed=self.observe('package-files',['/usr/bin/dpkg-query','-L',*PACKAGE_NAMES]).splitlines()
        need(listed and len(set(listed))<=2048,'bounded inventory package path union')
        for path in listed:runtime_path(path)
        need(RUNTIME_TCG in listed and self.ops.is_file(RUNTIME_TCG),'original package-owned TCG module')
        module=self.add(RUNTIME_TCG,'tcg-module');self.ldd('ldd-tcg',module)
        for path in sorted(set(listed)):
            if path.startswith(('/usr/share/qemu/','/usr/share/seabios/','/usr/share/ipxe/','/usr/share/ipxe-qemu/')) and self.ops.is_file(path):self.add(path,'qemu-data')
        self.partial['pythonFiles']=self.ops.python_files()
        for path in self.partial['pythonFiles']:self.add(path,'python-stdlib')
        try:self.partial['mappedLibraries']=self.ops.mapped_libraries()
        finally:self.partial['mapsOriginal']=getattr(self.ops,'maps_original',None)
        for path in self.partial['mappedLibraries']:self.add(path,'shared-library')
        versions={}
        for role,path in executables.items():
            output=self.observe(role+'-version',[path,'--version']);need(output.splitlines(),'original version first line');versions[role]=output.splitlines()[0]
        value={'schema':'bw.ring3.runtime-expectation.v1','platform':self.ops.platform(),
            'executables':{role:{'path':path,'bytes':self.files[path]['bytes'],'sha256':self.files[path]['sha256']} for role,path in executables.items()},
            'versions':versions,'files':self.files,'aliases':self.aliases,'packages':packages,'packagePaths':sorted(set(listed))}
        value['probes']=stable_probe_descriptors(value);value=self.candidate(value);raw=canonical(value);self.validate_candidate(raw)
        # Each actual inventory file/alias is reread before this candidate can
        # be exported. The candidate is still not approved for an actual run.
        for path,row in self.files.items():need(equal(self.ops.fact(path),{key:row[key] for key in ('bytes','sha256','mode')}),'inventory full selected file readback')
        for path,row in self.aliases.items():need(equal(self.ops.alias(path),row),'inventory full alias readback')
        self.partial['candidate']={'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode()}
        return raw


def inventory_file(path,cap):
    """Independent bounded input read; final symlinks and inode swaps refuse."""
    need(type(cap) is int and 0<cap<=4<<20,'fixed inventory input/source extent')
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);first=None;data=bytearray()
    try:
        before=os.fstat(descriptor);need(stat.S_ISREG(before.st_mode) and 0<before.st_size<=cap,'bounded regular inventory input')
        while True:
            chunk=os.read(descriptor,min(65536,cap+1-len(data)))
            if not chunk:break
            data.extend(chunk);need(len(data)<=cap,'inventory input read cap')
        need(len(data)==before.st_size and setup_metadata(os.fstat(descriptor))==setup_metadata(before) and
             setup_metadata(os.stat(path,follow_symlinks=False))==setup_metadata(before),'stable inventory input held/name identity')
    except BaseException as error:first=error
    finally:
        try:os.close(descriptor)
        except BaseException as error:
            if first is None:first=error
            else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'inventory-input-close','name':type(error).__name__,'message':str(error)}]
    if first is not None:raise first
    return bytes(data)


def admit_inventory_event(event_raw,environ):
    pin=digest(environ.get('BW_RING3_INVENTORY_REQUEST_SHA256'));event=parse(event_raw)
    need(event.get('action')=='labeled' and event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and
         event.get('label',{}).get('name')=='x86-ring3-runtime-inventory' and event.get('sender',{}).get('login')=='CrispStrobe' and
         environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board' and environ.get('GITHUB_EVENT_NAME')=='pull_request' and
         environ.get('GITHUB_ACTOR')=='CrispStrobe' and environ.get('GITHUB_JOB')=='runtime-inventory','fixed owned metadata-only event/job')
    pr=event.get('pull_request',{});body=pr.get('body');start='<!-- BW_RING3_RUNTIME_INVENTORY_V1\n';end='\nBW_RING3_RUNTIME_INVENTORY_V1 -->'
    need(type(body) is str and body.count(start)==1 and body.count(end)==1 and body.index(start)<body.index(end),'one immutable inventory request block')
    block=body.split(start,1)[1].split(end,1)[0];wrapper=parse(block.encode())
    need(canonical(wrapper).decode().rstrip('\n')==block,'canonical inventory request wrapper')
    raw=prerequisite_original(canonical(wrapper));need(sha(raw)==pin,'independently preselected inventory request SHA-256')
    request=parse(raw);keys(request,'schema repository pullRequest head tree source selected')
    need(raw==canonical(request) and request['schema']=='bw.ring3.inventory-request.v1' and request['repository']=='CrispStrobe/bw-board' and
         type(request['pullRequest']) is int and 0<request['pullRequest']<2**31 and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and
         type(pr.get('number')) is int and pr['number']==request['pullRequest'] and pr.get('state')=='open' and
         pr.get('head',{}).get('sha')==request['head'] and pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and
         pr.get('head',{}).get('repo',{}).get('fork') is False and pr.get('base',{}).get('ref')=='master' and
         pr.get('base',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board','immutable owned inventory PR/head')
    digest(request['head'],40);digest(request['tree'],40)
    need(environ.get('BW_EXPECTED_HEAD')==request['head'] and environ.get('BW_EXPECTED_TREE')==request['tree'] and
         environ.get('GITHUB_RUN_ATTEMPT')=='1' and type(environ.get('GITHUB_RUN_ID')) is str and
         re.fullmatch('[1-9][0-9]{0,19}',environ['GITHUB_RUN_ID']) and
         environ.get('GITHUB_WORKFLOW_REF')=='CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge',
         'first inventory run/platform source observations')
    digest(environ.get('GITHUB_WORKFLOW_SHA'),40)
    selected={'node':{'path':RUNTIME_NODE,**RUNTIME_SELECTED['node']},'qemu':{'path':RUNTIME_QEMU,**RUNTIME_SELECTED['qemu']}}
    need(equal(request['selected'],selected),'fixed historical selected inventory engines')
    source_raw=prerequisite_original(canonical(request['source']));source=parse(source_raw);keys(source,'schema head tree files')
    need(source_raw==canonical(source) and source['schema']=='bw.ring3.source.v1' and source['head']==request['head'] and
         source['tree']==request['tree'] and type(source['files']) is dict and set(source['files'])==SETUP_SOURCE_PATHS,'closed independently approved inventory source12')
    for row in source['files'].values():keys(row,'bytes sha256 mode blob');integer(row['bytes'],0,4<<20);digest(row['sha256']);digest(row['blob'],40);need(row['mode']=='100644','regular inventory source')
    return raw,request,source


def inventory_parent_availability():
    path=Path('/sys/fs/cgroup');fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
    first=None;result={'controls':{}}
    try:
        info=os.fstat(fd);result['meta']=setup_metadata(info)
        need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode) and (info.st_uid,info.st_gid)==(0,0) and
             info.st_mode&0o022==0 and setup_metadata(path.lstat())==setup_metadata(info),'canonical readonly cgroup parent')
        for name in ('cgroup.controllers','cgroup.subtree_control'):
            control=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd);error=None
            try:
                before=os.fstat(control);need(stat.S_ISREG(before.st_mode) and (before.st_uid,before.st_gid)==(0,0) and before.st_mode&0o022==0,
                                             'readonly parent-controller metadata')
                raw=os.read(control,4097);result['controls'][name]={'meta':setup_metadata(before),'raw':raw.decode('ascii')}
                need(len(raw)<=4096 and setup_metadata(os.fstat(control))==setup_metadata(before) and
                     setup_metadata(os.stat(name,dir_fd=fd,follow_symlinks=False))==setup_metadata(before),'bounded stable parent-controller read')
            except BaseException as caught:error=caught
            finally:
                try:os.close(control)
                except BaseException as caught:
                    if error is None:error=caught
                    else:error.setup_secondary=getattr(error,'setup_secondary',[])+[{'phase':'inventory-parent-control-close','name':type(caught).__name__,'message':str(caught)}]
            if error is not None:raise error
        need(setup_metadata(os.fstat(fd))==setup_metadata(info) and setup_metadata(path.lstat())==setup_metadata(info),'parent directory readback')
        result['alreadyEnabled']=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in result['controls'].values())
        # Missing parent enablement is an explicit future actual-run blocker;
        # this metadata-only path never writes or invents a root cgroup.type.
    except BaseException as error:first=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if first is None:first=error
            else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'inventory-parent-close','name':type(error).__name__,'message':str(error)}]
    if first is not None:raise first
    return result


def runtime_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.runtime-inventory-original.v1','source':{},'platformObservations':{},'parent':None,'membership':None,
        'inventory':None,'candidate':None,'firstFailure':None,'secondary':[]};originals={};inventory=None
    try:
        uid,gid=os.getresuid(),os.getresgid();need(len(set(uid))==1 and uid[0]>0 and len(set(gid))==1 and gid[0]>0,'unprivileged metadata inventory entry')
        pin=digest(environ.get('BW_RING3_INVENTORY_REQUEST_SHA256'))
        path=environ.get('GITHUB_EVENT_PATH');need(type(path) is str and Path(path).is_absolute(),'official inventory event path')
        event_raw=inventory_file(path,1<<20);originals['inventory.event.json']=event_raw
        request_raw,request,source=admit_inventory_event(event_raw,environ);originals['inventory.request.json']=request_raw
        value['platformObservations']={name:environ[name] for name in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_REPOSITORY','GITHUB_EVENT_NAME',
            'GITHUB_ACTOR','GITHUB_JOB','GITHUB_WORKFLOW_REF','GITHUB_WORKFLOW_SHA','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')}
        value['platformObservations'].update(requestSha256=pin,uid=uid[0],gid=gid[0])
        checkout=Path.cwd();need(checkout.resolve(strict=True)==checkout,'canonical inventory checkout')
        for name,row in sorted(source['files'].items()):
            path=checkout/name;need(path.resolve(strict=True)==path,'canonical inventory source path')
            info=path.lstat();need(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid[0],gid[0]),'owned inventory source mode')
            data=inventory_file(path,4<<20)
            fact={'bytes':len(data),'sha256':sha(data),'blob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),'mode':'100644'}
            value['source'][name]={'identity':setup_metadata(info),**fact};need(equal(fact,row),'live inventory twelve-file source mismatch')
        value['membership']=setup_proc_read('/proc/self/cgroup');setup_membership(value['membership'],environ['GITHUB_RUN_ID'])
        value['parent']=inventory_parent_availability()
        inventory=RuntimeInventory(files,probe);candidate=inventory.discover();value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:
        value['firstFailure']=getattr(error,'inventory_first',{'phase':'runtime-inventory','name':type(error).__name__,'message':str(error)})
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
        value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    if inventory is not None:
        value['inventory']=inventory.partial
        rejected=getattr(inventory.ops,'rejected',{})
        if rejected:value['inventory']['rejectedFiles']=rejected
    raw=canonical(value)
    if len(raw)>1<<20:
        error={'phase':'inventory-original-cap','name':'Refusal','message':'unchanged inventory original JSON cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        # Explicit partial-prefix failure variant; never an admitted candidate.
        # The attempted complete record's bounded original prefix is retained.
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.runtime-inventory-overflow.v1','firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[]


def emit_runtime_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<={'inventory.request.json','inventory.event.json','runtime.inventory.json'} and
         all(type(raw) is bytes and len(raw)<=1<<20 for raw in originals.values()) and sum(map(len,originals.values()))<=5<<20,'bounded distinct inventory originals')
    encoded_bytes=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072);need(count<=456,'finite inventory chunks')
        for index in range(count):
            line=b'RING3_RUNTIME_INVENTORY '+canonical({'schema':'bw.ring3.runtime-inventory-log.v1','name':name,'index':index,'count':count,
                'bytes':len(raw),'sha256':sha(raw),'data':encoded[index*3072:(index+1)*3072]})
            need(encoded_bytes+len(line)<=8<<20 and chunks<2600,'held encoded inventory log cap')
            written=emit(line);need(type(written) is int and written==len(line),'complete immutable inventory log chunk')
            encoded_bytes+=len(line);chunks+=1
    flush()


def decode_runtime_inventory_log(raw):
    need(type(raw) is bytes and len(raw)<=8<<20,'bounded runtime inventory official log original')
    groups={};chunks=0
    for line in raw.splitlines():
        marker=b'RING3_RUNTIME_INVENTORY ';offset=line.find(marker)
        if offset<0:continue
        prefix=line[:offset];need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),'canonical inventory log timestamp')
        value=parse(line[offset+len(marker):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.runtime-inventory-log.v1' and value['name'] in
            ('inventory.request.json','inventory.event.json','runtime.inventory.json'),'exact inventory log version/roles')
        count=integer(value['count'],1,456);index=integer(value['index'],0,count-1);extent=integer(value['bytes'],0,1<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded inventory original chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and index==len(group['parts']),
             'one ordered immutable inventory original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<=2600,'held finite inventory chunk count')
    need(set(groups)=={'inventory.request.json','inventory.event.json','runtime.inventory.json'},'three complete independent inventory originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete inventory original chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and sha(value)==group['sha256'],'exact inventory original encoding/bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=5<<20,'unchanged inventory raw aggregate cap')
    return originals


def verify_runtime_inventory_log(raw,external):
    """Audit a separately selected metadata event; never approves an actual."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256')
    need(external['schema']=='bw.ring3.inventory-expectation.v1' and type(external['attempt']) is int and external['attempt']==1 and
         external['jobName']=='runtime-inventory' and external['conclusion']=='success','independently admitted official inventory job')
    integer(external['jobId'],1);need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),'admitted inventory run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),('requestSha256',64),('logSha256',64)):digest(external[name],size)
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],'official inventory original log byte/hash admission')
    originals=decode_runtime_inventory_log(raw);request_raw=originals['inventory.request.json']
    need(sha(request_raw)==external['requestSha256'],'external prior inventory approval pin')
    request=parse(request_raw);value=parse(originals['runtime.inventory.json'])
    keys(value,'schema source platformObservations parent membership inventory candidate firstFailure secondary')
    need(value['schema']=='bw.ring3.runtime-inventory-original.v1' and value['firstFailure'] is None and value['secondary']==[],'complete failure-free inventory original')
    observed=value['platformObservations']
    expected={'GITHUB_RUN_ID':external['runId'],'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'runtime-inventory','GITHUB_WORKFLOW_SHA':external['workflowSha'],
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request.get('pullRequest'))+'/merge',
        'BW_EXPECTED_HEAD':external['head'],'BW_EXPECTED_TREE':external['tree']}
    need(type(observed) is dict and set(observed)==set(expected)|{'requestSha256','uid','gid'} and
         all(equal(observed[name],item) for name,item in expected.items()) and observed['requestSha256']==external['requestSha256'],
         'official inventory platform/source/request observations join')
    uid=integer(observed['uid'],1,2**31-1);gid=integer(observed['gid'],1,2**31-1)
    environ=dict(expected,BW_RING3_INVENTORY_REQUEST_SHA256=external['requestSha256'])
    admitted,request,source=admit_inventory_event(originals['inventory.event.json'],environ)
    need(admitted==request_raw and source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],'exact approved request/executing workflow file join')
    need(type(value['source']) is dict and set(value['source'])==SETUP_SOURCE_PATHS,'independent complete live inventory source census')
    for name,row in value['source'].items():
        keys(row,'identity bytes sha256 blob mode')
        metadata=row['identity'];need(type(metadata) is list and len(metadata)==8 and all(type(x) is int and x>=0 for x in metadata) and
            metadata[0]>0 and metadata[1]>0 and metadata[2]==0o100644 and metadata[3:5]==[uid,gid] and metadata[6]==row['bytes'],
            'independent inventory source identity/mode/owner')
        need(equal({key:row[key] for key in ('bytes','sha256','blob','mode')},source['files'][name]),'live source12 joins external approved source')
    setup_membership(value['membership'],external['runId']);parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and stat.S_ISDIR(parent['meta'][2]) and parent['meta'][3:5]==[0,0] and
         parent['meta'][2]&0o022==0 and set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},'readonly shared parent availability original')
    for row in parent['controls'].values():
        keys(row,'meta raw');need(type(row['meta']) is list and len(row['meta'])==8 and stat.S_ISREG(row['meta'][2]) and
            row['meta'][3:5]==[0,0] and row['meta'][2]&0o022==0 and type(row['raw']) is str and len(row['raw'].encode('ascii'))<=4096,
            'readonly bounded original parent controller')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful parent controller readiness, never enablement')
    candidate_raw=prerequisite_original(canonical(value['candidate']));candidate=runtime_expectation(candidate_raw,sha(candidate_raw))
    inventory=value['inventory'];keys(inventory,'files aliases probes processes fileMetadata pythonFiles mappedLibraries mapsOriginal candidate')
    need(equal(inventory['files'],candidate['files']) and equal(inventory['aliases'],candidate['aliases']) and
         inventory['candidate']==value['candidate'],'exact separately retained inventory candidate facts')
    need(type(inventory['fileMetadata']) is dict and set(inventory['fileMetadata'])==set(candidate['files']),'complete actual inventory file metadata')
    python_files=inventory['pythonFiles'];need(type(python_files) is list and len(python_files)<=256 and python_files==sorted(set(python_files)) and
        all(path in candidate['files'] and candidate['files'][path]['kind']=='python-stdlib' for path in python_files),'retained selected Python file superset census')
    maps_raw=prerequisite_original(canonical(inventory['mapsOriginal']));need(len(maps_raw)<=65536,'held raw Python maps original cap')
    mapped=set()
    for line in maps_raw.decode().splitlines():
        fields=line.split(None,5)
        if len(fields)<6 or not fields[5].startswith('/'):continue
        path=fields[5];need(not path.endswith(' (deleted)'),'retained map paths not deleted')
        if '.so' in Path(path).name or Path(path).name.startswith('ld-'):mapped.add(runtime_path(path))
    need(len(mapped)<=128 and inventory['mappedLibraries']==sorted(mapped) and
        all(resolve_alias(path,candidate['aliases']) in candidate['files'] for path in mapped),'independent raw mapped-library/selected graph join')
    for path,metadata in inventory['fileMetadata'].items():
        row=candidate['files'][path]
        need(type(metadata) is list and len(metadata)==8 and all(type(x) is int and x>=0 for x in metadata) and metadata[0]>0 and metadata[1]>0 and
            stat.S_ISREG(metadata[2]) and stat.S_IMODE(metadata[2])==row['mode'] and metadata[6]==row['bytes'],'inventory file original mode/extent')
    qemu=next(row for row in candidate['packages'] if row['name']=='qemu-system-x86')
    runtime_original={'schema':'bw.ring3.runtime.v2','observationPolicy':'prelaunch-probes-and-before-after-file-readback','platform':candidate['platform'],
        'executables':candidate['executables'],'versions':candidate['versions'],'qemuPackage':{'name':qemu['name'],'version':qemu['version'],'architecture':qemu['architecture'],
        'files':{path:{key:row[key] for key in ('bytes','sha256','kind')} for path,row in candidate['files'].items()},'aliases':candidate['aliases'],'probes':inventory['probes']}}
    verify_runtime_stable_original(runtime_original,candidate_raw,sha(candidate_raw))
    processes=inventory['processes'];need(type(processes) is list and len(processes)==11,'complete exact metadata probe process originals')
    probe_by_role={probe['role']:probe for probe in inventory['probes']};seen=set();last=0;parent_pid=None
    for entry in processes:
        keys(entry,'role process stdout stderr');role=entry['role'];need(role in probe_by_role and role not in seen,'unique inventory process probe role');seen.add(role)
        process=entry['process'];keys(process,'schema argv environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
        probe=probe_by_role[role]
        need(process['schema']=='bw.ring3.inventory-process.v1' and equal(process['argv'],probe['argv']) and equal(process['environment'],probe['environment']) and
            type(process['exitCode']) is int and process['exitCode']==0 and integer(process['waitStatus'],0,65535)==0 and process['signal'] is None and
            process['timedOut'] is False and process['firstFailure'] is None and process['secondary']==[],'complete fixed successful metadata probe process')
        pid=integer(process['pid'],1);need(integer(process['pgid'],1)==pid and integer(process['parentPid'],1)!=pid,'fresh metadata process session')
        integer(process['startTicks'],1)
        if parent_pid is None:parent_pid=process['parentPid']
        need(process['parentPid']==parent_pid,'one independent inventory parent')
        start=integer(process['spawnMonoNs'],last);end=integer(process['reapMonoNs'],start);need(end-start<=10000000000,'finite ordered metadata probe windows');last=end
        keys(process['rusage'],'userSeconds systemSeconds maxRssKiB')
        for name in ('userSeconds','systemSeconds'):need(type(process['rusage'][name]) in (int,float) and 0<=process['rusage'][name]<=10,'bounded original inventory process usage')
        integer(process['rusage']['maxRssKiB'],0,1048576)
        need(prerequisite_original(canonical(entry['stdout']))==probe['stdout'].encode('utf-8','surrogateescape') and
             prerequisite_original(canonical(entry['stderr']))==probe['stderr'].encode('utf-8','surrogateescape'),'exact raw metadata probe stream/process join')
    return {'schema':'bw.ring3.runtime-inventory-admission.v1','candidateSha256':sha(candidate_raw),'candidateBytes':len(candidate_raw),
        'candidateReviewed':False,'actualRunApproved':False,'parentControllersAlreadyEnabled':enabled,'selectedBoundary':'reviewed selected executable/tool/package and Python superset only'}
# Explicit V8 provenance policy; old artifact and V7 predicates stay separate.
V8_ENV={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}
V8_LIMITS={'cpuMax':'100000 100000','memoryMax':'1073741824','swapMax':'0','pidsMax':'64'}
V8_RUN_FILE='scripts/i80386-ring3-int-iret/run.py'
V8_PHASE_NAMES=frozenset(('.entry.json .controller.before.json .controller.json .outside.json git.before.json git.after.json preparation.phase.json generation.phase.json launch-plan.original.json').split())
V8_NODE_PIN={'path':RUNTIME_NODE,**RUNTIME_SELECTED['node']}

def v8_keys(value,names):
    need(type(value) is dict and set(value)==set(names),'closed V8 provenance fields')

def v8_canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)

V8_STAGING_DRIVER = "import fs from 'node:fs';\nimport path from 'node:path';\nimport {buildFixture} from './scripts/i80386-ring3-int-iret/fixture.mjs';\nconst uid=process.getuid(),gid=process.getgid(),root=process.cwd();\nconst staged=path.resolve('build/i80386-ring3-int-iret-staged');\nfunction directory(name){const s=fs.lstatSync(name);if(!s.isDirectory()||s.uid!==uid||s.gid!==gid||(s.mode&0o022)||fs.realpathSync(name)!==name)throw Error('canonical owned staging directory');}\nfunction parents(){for(const name of [root,path.join(root,'build'),staged])directory(name);}\nparents();if(uid<=0||gid<=0)throw Error('unprivileged staging only');\nconst directoryHandle=fs.opendirSync(staged);let directoryError=null;\ntry{if(directoryHandle.readSync()!==null)throw Error('empty staging only');}catch(e){directoryError=e;}\ntry{directoryHandle.closeSync();}catch(e){if(directoryError)directoryError.ring3Secondary=[String(e)];else directoryError=e;}\nif(directoryError)throw directoryError;\nconst stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);\nconst fixture=buildFixture();\nfunction write(name,data){\n  if(!['fixture.rom','fixture.json'].includes(name))throw Error('fixed staging output');\n  parents();const target=path.join(staged,name);\n  const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);let first=null;\n  try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==uid||s.gid!==gid||s.size!==0)throw Error('owned empty regular staging descriptor');\n    if(fs.writeSync(fd,data,0,data.length)!==data.length)throw Error('complete staging write');\n    if(fs.fstatSync(fd).size!==data.length)throw Error('staging descriptor extent');\n  }catch(e){first=e;}\n  try{fs.closeSync(fd);}catch(e){if(first)first.ring3Secondary=[String(e)];else first=e;}\n  if(first)throw first;\n}\nconst rom=Buffer.from(fixture.rom),metadata=Buffer.from(stable(fixture.manifest)+'\\n');\nif(rom.length!==65536||metadata.length>1048576)throw Error('bounded authored staging extent');\nwrite('fixture.rom',rom);write('fixture.json',metadata);\n"

V8_PROCESS_KEYS = set('schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary'.split())

def v8_hex_bytes(value, cap):
    need(type(value) is str and len(value) <= 2 * cap, 'bounded original hex')
    try:
        body = bytes.fromhex(value)
    except ValueError as error:
        raise Refusal('invalid original hex') from error
    need(body.hex() == value, 'canonical original hex')
    return body

def v8_process(row, role, argv, environment, milliseconds):
    v8_keys(row, V8_PROCESS_KEYS)
    need(row['schema'] == 'bw.ring3.process.v1' and row['role'] == role and equal(row['argv'], argv) and (row['cwdRole'] == 'checkout') and equal(row['environment'], environment), 'original launch descriptor')
    integer(row['pid'], 1)
    integer(row['pgid'], 1)
    integer(row['parentPid'], 1)
    integer(row['startTicks'], 1)
    need(row['pid'] == row['pgid'] and row['pid'] != row['parentPid'], 'fresh original session')
    start, end = (integer(row['spawnMonoNs'], 1), integer(row['reapMonoNs'], 1))
    need(start <= end <= start + milliseconds * 1000000, 'original lifetime bound')
    need(type(row['waitStatus']) is int and row['waitStatus'] == 0 and (type(row['exitCode']) is int) and (row['exitCode'] == 0) and (row['signal'] is None) and (row['timedOut'] is False) and (row['firstFailure'] is None) and (row['secondary'] == []), 'natural original status and errors')
    v8_keys(row['rusage'], ('userSeconds', 'systemSeconds', 'maxRssKiB'))
    for name, value in row['rusage'].items():
        need(type(value) in (int, float) and math.isfinite(value) and (value >= 0), 'finite original rusage')
    return (start, end)

def v8_phase_stream(value, cap):
    v8_keys(value, ('bytes', 'sha256', 'base64'))
    size = integer(value['bytes'], 0, cap)
    need(type(value['base64']) is str and value['base64'].isascii() and (len(value['base64']) == 4 * ((size + 2) // 3)), 'phase stream encoded extent')
    try:
        raw = base64.b64decode(value['base64'], validate=True)
    except (ValueError, TypeError) as error:
        raise Refusal('phase stream base64') from error
    need(base64.b64encode(raw).decode('ascii') == value['base64'] and len(raw) == size and (value['sha256'] == sha(raw)), 'phase stream original bytes/digest')
    return raw

def v8_kernel_rows(raw):
    need(type(raw) is str and raw.isascii() and (len(raw) <= 4096), 'bounded original kernel text')
    rows = raw.splitlines()
    need(len(rows) <= 32, 'finite kernel rows')
    values = {}
    for line in rows:
        match = re.fullmatch('([A-Za-z_][A-Za-z_0-9]*) ([0-9]+)', line)
        need(match is not None and match[1] not in values, 'unique original kernel counter')
        values[match[1]] = int(match[2])
    return values

def v8_preparation_snapshot(value, expected_identity):
    v8_keys(value, ('identity', 'owner', 'limits', 'raw', 'procs'))
    need(equal(value['identity'], expected_identity) and equal(value['owner'], {'uid': 0, 'gid': 0}) and equal(value['limits'], V8_LIMITS) and (value['procs'] == []), 'preparation snapshot identity/owner/limits/empty')
    raw = value['raw']
    v8_keys(raw, ('cpuMax', 'memoryMax', 'swapMax', 'pidsMax', 'memoryEvents', 'cpuStat', 'cgroupEvents', 'memoryCurrent', 'memoryPeak', 'pidsCurrent', 'cgroupProcs'))
    need(all((type(body) is str and body.isascii() and (len(body) <= 4096) for body in raw.values())), 'preparation raw observation cap')
    need(all((raw[name].strip() == literal for name, literal in V8_LIMITS.items())), 'preparation raw fixed caps')
    events = v8_kernel_rows(raw['cgroupEvents'])
    need(events.get('populated') == 0 and raw['pidsCurrent'] == '0\n' and (raw['cgroupProcs'] == ''), 'hierarchical and local preparation emptiness')
    for name in ('memoryCurrent', 'memoryPeak'):
        need(re.fullmatch('[0-9]+\\n', raw[name]) is not None, 'original memory scalar')
    memory = v8_kernel_rows(raw['memoryEvents'])
    need({'oom', 'oom_kill'} <= set(memory), 'original preparation OOM fields')
    cpu = v8_kernel_rows(raw['cpuStat'])
    need({'usage_usec', 'user_usec', 'system_usec'} <= set(cpu), 'original preparation CPU counters')
    return (memory, cpu)

def v8_check_preparation(values, originals, expected, entry, outer, outer_start):
    phase = values['preparation.phase.json']
    need(originals['preparation.phase.json'] == (v8_canonical(phase) + '\n').encode(), 'canonical frozen phase original bytes')
    v8_keys(phase, ('schema', 'runId', 'attempt', 'head', 'tree', 'python', 'invoker', 'captureMonoNs', 'process', 'stdout', 'stderr', 'ownership', 'preGit', 'firstFailure', 'secondary'))
    need(phase['schema'] == 'bw.ring3.preparation-original.v3' and phase['runId'] == str(expected['runId']) and (type(phase['attempt']) is int) and (phase['attempt'] == 1) and (phase['head'] == expected['source']['head']) and (phase['tree'] == expected['source']['tree']) and equal(phase['python'], expected['python']) and equal(phase['invoker'], {'uid': entry['uid'], 'gid': entry['gid']}) and (phase['firstFailure'] is None) and (phase['secondary'] == []), 'phase source/run/Python/invoker/error envelope')
    row = phase['process']
    start, end = v8_process(row, 'preparation', [expected['python']['path'], '-I', '-B', V8_RUN_FILE, '--prepare-admitted-generated'], dict(outer['environment'], BW_LAUNCH_PLAN_SHA256=expected['launchPlanSha256']), 120000)
    need(integer(row['parentPid'], 1) == integer(outer['parentPid'], 1), 'same root parent of preparation and controller')
    need(end <= integer(phase['captureMonoNs'], 1) <= outer_start, 'phase captured after preparation and before controller')
    frame = v8_phase_stream(phase['stdout'], (256 << 10) + 44)
    need(v8_phase_stream(phase['stderr'], 16384) == b'', 'successful preparation stderr empty')
    need(44 < len(frame) <= (256 << 10) + 44 and frame[:8] == b'R3GENv1\x00', 'fixed generated frame magic and header')
    size = struct.unpack('>I', frame[8:12])[0]
    need(8 < size <= 256 << 10 and len(frame) == size + 44 and (hashlib.sha256(frame[44:]).digest() == frame[12:44]), 'exact generated body length/digest/no suffix')
    gen_size, pre_size = struct.unpack('>II', frame[44:52])
    need(1 <= gen_size <= 128 << 10 and 1 <= pre_size <= 256 << 10 and (8 + gen_size + pre_size == size), 'closed generated segment lengths/shared cap')
    generation, body = (frame[52:52 + gen_size], frame[52 + gen_size:])
    need(generation == originals['generation.phase.json'] and body == originals['git.before.json'] and equal(phase['preGit'], {'bytes': len(body), 'sha256': sha(body)}), 'generation and PRE original segment/log joins')
    v8_check_generation(values, originals, expected, entry, row, start, end)
    identity = expected['preparationIdentity']
    v8_keys(identity, ('device', 'inode'))
    integer(identity['device'], 1)
    integer(identity['inode'], 1)
    owner = phase['ownership']
    v8_keys(owner, ('schema', 'path', 'identity', 'owner', 'before', 'beforeCleanup', 'afterCleanup', 'spawnAttempted', 'sessionSignalAttempted', 'killAttempted', 'cleanupTerminal', 'polls', 'closeAttempted', 'closeSucceeded', 'partial'))
    need(owner['schema'] == 'bw.ring3.preparation-ownership.v1' and owner['path'] == '/sys/fs/cgroup/bw-ring3-' + str(expected['runId']) + '-1-preparation' and equal(owner['identity'], identity) and equal(owner['owner'], {'uid': 0, 'gid': 0}), 'independently admitted preparation group')
    need(owner['spawnAttempted'] is True and owner['sessionSignalAttempted'] is False and (owner['killAttempted'] is False) and (owner['cleanupTerminal'] is None) and (owner['closeAttempted'] is True) and (owner['closeSucceeded'] is True) and (1 <= integer(owner['polls']) <= 128), 'natural preparation terminal, no forced cleanup, closed ownership')
    before = v8_preparation_snapshot(owner['before'], identity)
    for name in ('beforeCleanup', 'afterCleanup'):
        after = v8_preparation_snapshot(owner[name], identity)
        for index in (0, 1):
            need(set(before[index]) == set(after[index]) and all((after[index][k] >= before[index][k] for k in before[index])), 'monotone preparation kernel counters')
        need(all((after[0][k] == before[0][k] for k in before[0] if k in ('oom', 'oom_kill', 'oom_group_kill'))), 'no new preparation OOM')
        before = after
    need(equal(owner['partial'], owner['afterCleanup']), 'last preparation partial snapshot original join')
    return (start, end, row['pid'])

def v8_check_generation(values, originals, expected, entry, prep, prep_start, prep_end):
    raw = originals['generation.phase.json']
    need(1 <= len(raw) <= 128 << 10, 'generation original cap')
    gen = values['generation.phase.json']
    need(raw == (v8_canonical(gen) + '\n').encode(), 'canonical generation original')
    v8_keys(gen, ('schema', 'runId', 'attempt', 'head', 'tree', 'invoker', 'captureMonoNs', 'process', 'stdout', 'stderr', 'before', 'after', 'outputs', 'firstFailure', 'secondary'))
    need(gen['schema'] == 'bw.ring3.generation-original.v1' and gen['runId'] == str(expected['runId']) and (type(gen['attempt']) is int) and (gen['attempt'] == 1) and (gen['head'] == expected['source']['head']) and (gen['tree'] == expected['source']['tree']) and equal(gen['invoker'], {'uid': entry['uid'], 'gid': entry['gid']}) and (gen['firstFailure'] is None) and (gen['secondary'] == []), 'generation source/run/invoker/first-error envelope')
    node = expected['node']
    v8_keys(node, ('path', 'bytes', 'sha256'))
    need(type(node['path']) is str and node['path'].startswith('/') and ('/..' not in node['path']), 'external canonical Node path')
    integer(node['bytes'], 1)
    need(type(node['sha256']) is str and re.fullmatch('[0-9a-f]{64}', node['sha256']), 'external Node digest')
    files = {'node': node}
    for name, rel in (('fixture', 'scripts/i80386-ring3-int-iret/fixture.mjs'), ('runner', V8_RUN_FILE)):
        source_row = expected['source']['files'][rel]
        files[name] = {'path': rel, 'bytes': source_row['bytes'], 'sha256': source_row['sha256']}
    for name in ('before', 'after'):
        v8_keys(gen[name], ('monoNs', 'files'))
        v8_keys(gen[name]['files'], ('node', 'fixture', 'runner'))
        for file_row in gen[name]['files'].values():
            v8_keys(file_row, ('path', 'bytes', 'sha256'))
        need(equal(gen[name]['files'], files), 'independently admitted Node/source BEFORE and AFTER generation')
    start, end = v8_process(gen['process'], 'discovery', [node['path'], '--input-type=module', '--eval', V8_STAGING_DRIVER], V8_ENV, 10000)
    need(integer(gen['process']['parentPid'], 1) == integer(prep['pid'], 1), 'generator parent is preparation PID')
    need(gen['process']['pid'] != prep['parentPid'], 'generator differs from known-live root owner')
    need(v8_phase_stream(gen['stdout'], 16384) == b'' and v8_phase_stream(gen['stderr'], 16384) == b'', 'silent natural generation streams')
    v8_keys(gen['outputs'], ('fixture.rom', 'fixture.json'))
    for row in gen['outputs'].values():
        v8_keys(row, ('bytes', 'sha256'))
    need(equal(gen['outputs'], expected['inputs']), 'generation output references to independently admitted packet inputs')
    first_git = integer(values['git.before.json']['commands'][0]['process']['spawnMonoNs'], 1)
    need(prep_start <= integer(gen['before']['monoNs'], 1) <= start <= end <= integer(gen['after']['monoNs'], 1) <= integer(gen['captureMonoNs'], 1) <= first_git <= prep_end, 'generation observation/process/capture before PRE chronology')

def v8_check_launch_plan(raw, expected):
    """Compare retained original to separately admitted digest/source/runtime.

    The caller must independently authenticate the event-plan installation and
    digest selection. These original bytes cannot establish their own authority,
    root file properties, child read order or all12 early observations.
    """
    need(type(raw) is bytes and 0 < len(raw) <= 1 << 20, 'bounded launch plan original')
    digest = expected['launchPlanSha256']
    need(type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest), 'independent launch plan digest format')
    need(sha(raw) == digest, 'independently admitted launch plan original digest')
    plan = parse(raw)
    v8_keys(plan, ('schema', 'runId', 'attempt', 'head', 'tree', 'source'))
    need(raw == (v8_canonical(plan) + '\n').encode(), 'canonical launch plan original')
    need(plan['schema'] == 'bw.ring3.launch-plan.v1' and type(plan['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}', plan['runId']) and (plan['runId'] == str(integer(expected['runId'], 1))) and (type(plan['attempt']) is int) and (plan['attempt'] == 1) and (plan['head'] == expected['source']['head']) and (plan['tree'] == expected['source']['tree']), 'launch plan independent run/head/tree join')
    source_raw = v8_phase_stream(plan['source'], 1 << 20)
    need(len(source_raw) > 0 and sha(source_raw) == expected['sourceSha256'], 'launch plan independently admitted source original digest')
    source = parse(source_raw)
    v8_keys(source, ('schema', 'head', 'tree', 'files'))
    need(source_raw == (v8_canonical(source) + '\n').encode() and equal(source, expected['source']), 'launch plan original source and independently admitted source equality')
    need(source['schema'] == 'bw.ring3.source.v1' and all((type(source[k]) is str and re.fullmatch('[0-9a-f]{40}', source[k]) for k in ('head', 'tree'))) and (type(source['files']) is dict) and (set(source['files']) == SETUP_SOURCE_PATHS), 'launch plan exact source12 envelope')
    for row in source['files'].values():
        v8_keys(row, ('bytes', 'sha256', 'mode', 'blob'))
        integer(row['bytes'], 0, 4 << 20)
        need(row['mode'] == '100644' and type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}', row['sha256']) and (type(row['blob']) is str) and re.fullmatch('[0-9a-f]{40}', row['blob']), 'launch plan closed regular source12 identities')
    need(equal(expected['node'], V8_NODE_PIN), 'independently admitted fixed selected Node identity')
    return plan

def v8_check_internal(originals, expected):
    """Join decoded originals to independently admitted packet/source facts.

    expected is supplied by the future standalone original audit after it has
    independently admitted official/source/runtime and the frozen packet reader.
    """
    need(set(originals) == V8_PHASE_NAMES, 'failure-only or missing original cannot qualify')
    v8_keys(expected, ('runId', 'source', 'sourceSha256', 'python', 'resources', 'guestProcesses', 'runtime', 'inputs', 'jsOriginals', 'preparationIdentity', 'node', 'launchPlanSha256'))
    run_id = integer(expected['runId'], 1)
    source = expected['source']
    v8_keys(source, ('schema', 'head', 'tree', 'files'))
    need(source['schema'] == 'bw.ring3.source.v1' and len(source['files']) == 12, 'source12 envelope')
    need(all((re.fullmatch('[0-9a-f]{40}', source[key]) for key in ('head', 'tree'))), 'source head/tree')
    v8_check_launch_plan(originals['launch-plan.original.json'], expected)
    values = {name: parse(body) for name, body in originals.items()}
    entry, before, controller, outside = (values[n] for n in ('.entry.json', '.controller.before.json', '.controller.json', '.outside.json'))
    v8_keys(entry, ('schema', 'uid', 'gid', 'root', 'sourceSha256', 'python', 'cgroups'))
    need(entry['schema'] == 'bw.ring3.entry.v1' and entry['sourceSha256'] == expected['sourceSha256'] and equal(entry['python'], expected['python']) and (entry['root'] == '/sys/fs/cgroup/bw-ring3-' + str(run_id) + '-1'), 'entry source/runtime/run join')
    uid, gid = (integer(entry['uid'], 1), integer(entry['gid'], 1))
    v8_keys(before, ('pid', 'before'))
    v8_keys(controller, ('pid', 'before', 'barrier', 'inputsBefore', 'inputsAfter', 'barrierInputs', 'lastCensus', 'jsOriginals', 'processes', 'firstFailure', 'secondary'))
    v8_keys(outside, ('process', 'cleanup', 'firstFailure', 'secondary', 'streamsHex'))
    need(controller['firstFailure'] is None and outside['firstFailure'] is None and (controller['secondary'] == outside['secondary'] == []), 'internal original first errors')
    environment = dict(V8_ENV, GITHUB_RUN_ID=str(run_id), GITHUB_RUN_ATTEMPT='1', BW_EXPECTED_HEAD=source['head'], BW_EXPECTED_TREE=source['tree'], SUDO_UID=str(uid), SUDO_GID=str(gid))
    outer = outside['process']
    start, end = v8_process(outer, 'controller', [entry['python']['path'], '-I', '-B', V8_RUN_FILE, '--bootstrap'], environment, 600000)
    pid = outer['pid']
    need(integer(before['pid'], 1) == integer(controller['pid'], 1) == pid and equal(before['before'], controller['before']), 'original controller PID/BEFORE join')
    v8_keys(controller['barrier'], ('admitSource', 'source', 'runtime'))
    need(equal(controller['barrier']['admitSource'], source) and equal(controller['barrier']['source'], source) and equal(controller['barrier']['runtime'], expected['runtime']), 'original source/runtime factory barrier')
    need(all((equal(controller[key], expected['inputs']) for key in ('inputsBefore', 'inputsAfter', 'barrierInputs'))) and equal(controller['jsOriginals'], expected['jsOriginals']), 'original input/JS byte references')
    v8_keys(outside['streamsHex'], ('stdout', 'stderr'))
    for body in outside['streamsHex'].values():
        v8_hex_bytes(body, 16384)
    cleanup = outside['cleanup']
    v8_keys(cleanup, ('beforeCleanup', 'afterCleanup', 'sessionSignalAttempted', 'cgroupKillAttempted', 'cleanupTerminal', 'polls'))
    need(cleanup['sessionSignalAttempted'] is False and cleanup['cgroupKillAttempted'] is False and (cleanup['cleanupTerminal'] is None) and (1 <= integer(cleanup['polls']) <= 128), 'forced cleanup cannot qualify')
    roles = ('enclosing', 'controller', 'js', 'qemu')
    v8_keys(before['before'], roles)
    v8_keys(entry['cgroups'], roles)
    resources = expected['resources']
    v8_keys(resources, ('schema', 'enclosing', 'controller', 'children', 'firstFailure', 'secondary'))
    need(integer(resources['controller']['pid'], 1) == pid and resources['firstFailure'] is None and (resources['secondary'] == []), 'packet resource controller join')
    for name in roles:
        pair = resources[name] if name in ('enclosing', 'controller') else resources['children'][name]
        need(equal(before['before'][name], pair['before']) and equal(cleanup['beforeCleanup'][name], pair['after']), 'original BEFORE and PREcleanup-AFTER packet joins')
        for stage in ('beforeCleanup', 'afterCleanup'):
            snap = cleanup[stage][name]
            need(snap['procs'] == [] and snap['raw']['pidsCurrent'].strip() == '0' and ('populated 0' in snap['raw']['cgroupEvents'].splitlines()), 'genuine terminal empty observations')
            need(equal(snap['identity'], entry['cgroups'][name]['identity']) and equal(snap['limits'], V8_LIMITS), 'frozen original cgroup identity/limits')
    need(equal(controller['processes'], expected['guestProcesses']) and set(controller['processes']) == {'js', 'qemu'} and all((integer(row['parentPid'], 1) == pid for row in controller['processes'].values())), 'guest parents/original process joins')
    times = [start]
    for role in ('js', 'qemu'):
        child = controller['processes'][role]
        child_start, child_end = (integer(child['spawnMonoNs'], 1), integer(child['reapMonoNs'], 1))
        need(child_start <= child_end <= child_start + 120000000000, 'held original guest lifetime bound')
        times.extend((child_start, child_end))
    times.append(end)
    need(times == sorted(times), 'serial guest lifetimes inside original controller interval')
    prep_start, prep_end, prep_pid = v8_check_preparation(values, originals, expected, entry, outer, start)
    git_prefix = ['/usr/bin/git', '--no-replace-objects', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false']
    commands = [git_prefix + ['rev-parse', 'HEAD'], git_prefix + ['rev-parse', 'HEAD^{tree}'], git_prefix + ['ls-tree', '-r', 'HEAD', '--'] + sorted(source['files'])]
    for phase in ('before', 'after'):
        trace = values['git.' + phase + '.json']
        v8_keys(trace, ('schema', 'phase', 'source', 'commands', 'firstFailure', 'secondary'))
        need(trace['schema'] == 'bw.ring3.git.v1' and trace['phase'] == phase and equal(trace['source'], source) and (trace['firstFailure'] is None) and (trace['secondary'] == []) and (len(trace['commands']) == 3), 'original Git phase/source/errors')
        previous, outputs = (0, [])
        for row, argv in zip(trace['commands'], commands):
            v8_keys(row, ('process', 'stdoutHex', 'stderrHex'))
            gs, ge = v8_process(row['process'], 'discovery', argv, V8_ENV, 10000)
            need(previous <= gs and (ge <= start if phase == 'before' else gs >= end), 'PRE/POST original Git chronology')
            if phase == 'before':
                need(prep_start <= gs <= ge <= prep_end and integer(row['process']['parentPid'], 1) == prep_pid, 'PRE Git contained by original preparation child')
            previous = ge
            need(row['stderrHex'] == '', 'original Git stderr')
            outputs.append(v8_hex_bytes(row['stdoutHex'], 16384))
        need(outputs[0] == (source['head'] + '\n').encode() and outputs[1] == (source['tree'] + '\n').encode(), 'raw Git HEAD/tree stdout')
        listed = {}
        for line in outputs[2].decode('utf-8').splitlines():
            match = re.fullmatch('(100644) blob ([0-9a-f]{40})\\t([^\\t\\r\\n]+)', line)
            need(match is not None and match[3] in source['files'] and (match[3] not in listed), 'raw Git ls-tree role/mode')
            listed[match[3]] = (match[1], match[2])
        need(set(listed) == set(source['files']) and all((listed[p] == (row['mode'], row['blob']) for p, row in source['files'].items())), 'raw Git blob/mode/source join')
    return {'provenancePass': True, 'runId': run_id, 'head': source['head'], 'controllerPid': pid, 'controllerElapsedNs': end - start, 'originals': len(originals), 'preparationPid': prep_pid, 'wholeActualQualified': False, 'launchPlanSha256': expected['launchPlanSha256']}

def v8_packet_predicates(packet,source_value,runtime_value):
    need(type(packet) is dict and set(packet)==ROLES and all(type(raw) is bytes for raw in packet.values()) and
         sum(map(len,packet.values()))<=CAPS['packetBytes'],'unchanged twenty-role expanded packet cap')
    external={'source':source_value,'runtime':runtime_value}
    official={'head':source_value['head'],'workflowSha256':source_value['files'][WORKFLOW]['sha256']}
    audit = parse(packet['audit.json']); keys(audit, 'schema head sourceTree workflowSha256 roles caps firstFailure secondary')
    source = external['source']; keys(source, 'head tree files'); digest(source['tree'], 40)
    need(source['head'] == official['head'] == audit['head'] and audit['sourceTree'] == source['tree'] and
         audit['workflowSha256'] == official['workflowSha256'] and audit['schema'] == SCHEMA+'audit.v1' and
         equal(audit['caps'], CAPS) and audit['firstFailure'] is None and audit['secondary'] == [], 'frozen source/caps and first-error envelope')
    need(audit['roles'] == [{'path': name, 'bytes': len(packet[name]), 'sha256': sha(packet[name])} for name in sorted(ROLES-{'audit.json'})], 'closed sorted original role hash census')
    for when in ('before', 'after'):
        observed = parse(packet['source.'+when+'.json'])
        need(observed == {'schema': SCHEMA+'source.v1', **source}, 'independently frozen source before/after')
        runtime(parse(packet['runtime.'+when+'.json']), external['runtime'])
    need(type(source['files']) is dict and len(source['files']) >= 10, 'complete admitted source graph')
    required = ['src/experimental/i80386.js', 'LICENSE', WORKFLOW] + ['scripts/i80386-ring3-int-iret/'+name for name in ('fixture.mjs', 'probe.mjs', 'reader.py', 'controls.py', 'run.py')]
    need(set(required) <= set(source['files']), 'held execution/reader/controller source graph')
    for name, row in source['files'].items():
        need(type(name) is str and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', name) and
             not any(part in ('.', '..') for part in name.split('/')), 'canonical source path')
        keys(row, 'bytes sha256 mode blob'); integer(row['bytes'], 1); digest(row['sha256']); digest(row['blob'], 40)
        need(row['mode'] == '100644', 'regular source mode')
    need(source['files'][WORKFLOW]['sha256'] == official['workflowSha256'], 'workflow/source byte join')
    rom = packet['inputs/fixture.rom']; expected = expected_memory(rom)
    fixture = parse(packet['inputs/fixture.json'])
    need(sha(json.dumps(fixture, sort_keys=True, separators=(',', ':')).encode()) == FIXTURE_JSON_SHA,
         'entire independently frozen fixture metadata')
    need(fixture.get('schema') == 'bw.ring3.fixture.v1' and fixture.get('romSha256') == ROM_SHA and
         fixture.get('romBytes') == 65536 and fixture.get('ramBytes') == 1048576 and fixture.get('symbols') == SYMBOLS and
         fixture.get('selectorPaddingOffsets') == list(PADDING) and fixture.get('wireBytes') == 1730 and
         fixture.get('cpuProfile') == 'strict386' and fixture.get('deliverFaults') is False and
         fixture.get('ordinaryStepLimit') == CAPS['calls'], 'independent literal fixture contract')
    processes = {role: parse(packet[role+'/process.json']) for role in ('js', 'qemu')}
    js_start, js_end = process(processes['js'], 'js', external['runtime'])
    q_start, q_end = process(processes['qemu'], 'qemu', external['runtime'])
    need(js_end <= q_start and q_end-js_start <= CAPS['controllerMs']*1000000, 'two fresh serial finite engines')
    resources(parse(packet['resources.json']), processes)
    need(packet['js/stderr'] == b'' and packet['qemu/stderr'] == b'', 'unexpected engine diagnostics refuse')
    js_memory = wire_memory(packet['js/stdout'], expected)
    wire_memory(packet['qemu/stdout'], expected)
    before, after = packet['js/memory.before.bin'], packet['js/memory.after.bin']
    need(before == bytes(1048576) and len(after) == 1048576, 'fixed original owned RAM images')
    # JS observes the full RAM bus, not just selected reporter ranges. Undefined
    # selector padding remains ungraded; every other owned byte must match.
    # The startup return frame at0xafec is made by authored PUSH imm32, so its
    # selector high halves ARE defined zero. Only CPU-created selector padding
    # in the first INT frame/copy and the terminal INT81 frame is ungraded.
    ignored = {frame+i for frame in (0x70c0, 0x7fec, 0x9fec) for i in PADDING}
    need(all(after[i] == expected[i] for i in range(len(after)) if i not in ignored), 'whole owned RAM architectural projection')
    for address, count in RANGES:
        need(after[address:address+count] == js_memory[address:address+count], 'raw reporter/original RAM join')
    rows = parse(packet['js/observations.json']); last_call = observations(rows)
    need(bytes(rows[1]['frame']) == after[0x7fec:0x8000], 'original observed/final copied frame join')
    report = parse(packet['js/report.json'])
    keys(report, 'schema finiteRoundTripPass firstFailure calls completed fixtureSha256 memoryBeforeSha256 memoryAfterSha256 outputSha256 ports observations')
    calls = integer(report['calls'], last_call, CAPS['calls'])
    need(report['schema'] == SCHEMA+'js-probe.v1' and report['firstFailure'] is None and report['completed'] is True and
         report['finiteRoundTripPass'] is True and report['fixtureSha256'] == ROM_SHA and report['memoryBeforeSha256'] == sha(before) and
         report['memoryAfterSha256'] == sha(after) and report['outputSha256'] == sha(packet['js/stdout']) and
         type(report['observations']) is int and report['observations'] == 4, 'raw JS report joins')
    need(type(report['ports']) is list and len(report['ports']) == 2, 'two actual PIC masks')
    previous = 0
    for row, port in zip(report['ports'], (0x21, 0xa1)):
        keys(row, 'port value call'); need(row['port'] == port and row['value'] == 255, 'original PIC output')
        previous = integer(row['call'], previous+1, rows[0]['beforeCall']-1)
    writes = parse(packet['js/writes.json']); need(type(writes) is list and len(writes) <= CAPS['writes'], 'bounded original byte-write journal')
    replay = bytearray(before); previous = 1; last_writes = {}; observation_index = 0
    for index, row in enumerate(writes):
        keys(row, 'index call address before after')
        need(type(row['index']) is int and row['index'] == index, 'original write order'); previous = integer(row['call'], previous, calls)
        # Observations precede step(call), so only writes with SMALLER call
        # numbers can have affected their twenty raw frame bytes.
        while observation_index < 4 and rows[observation_index]['beforeCall'] <= row['call']:
            need(bytes(rows[observation_index]['frame']) == replay[0x7fec:0x8000], 'observed frame/original journal prefix')
            observation_index += 1
        address = integer(row['address'], 0, 0xeffff); integer(row['before'], 0, 255); integer(row['after'], 0, 255)
        need(replay[address] == row['before'], 'original write before byte'); replay[address] = row['after']
        last_writes[address] = row['call']
    while observation_index < 4:
        need(bytes(rows[observation_index]['frame']) == replay[0x7fec:0x8000], 'observed frame/original journal prefix')
        observation_index += 1
    need(bytes(replay) == after, 'whole RAM original write replay')
    for address in range(0x7fec, 0x8000):
        need(last_writes.get(address) == rows[0]['beforeCall'], 'actual INT80 frame write at observed instruction')
    for start, count, low, high in ((0x7000,48,1,rows[0]['beforeCall']-1),
            (0x7040,48,rows[1]['beforeCall'],rows[2]['beforeCall']-1),
            (0x70c0,20,rows[1]['beforeCall'],rows[2]['beforeCall']-1),
            (0x7080,48,rows[3]['beforeCall'],calls)):
        need(all(low <= last_writes.get(address, -1) <= high for address in range(start,start+count)),
             'original record writes inside observed instruction intervals')
    qreport = parse(packet['qemu/report.json']); keys(qreport, 'schema fixtureSha256 outputSha256 firstFailure secondary')
    need(qreport == {'schema': SCHEMA+'qemu.v1', 'fixtureSha256': ROM_SHA, 'outputSha256': sha(packet['qemu/stdout']), 'firstFailure': None, 'secondary': []}, 'QEMU raw report joins')
    return {'guestPredicatesObserved':True,'officialQualified':False,'ordinaryCalls':calls,'roles':20}


V8_BASE_NAMES=frozenset(SETUP_INPUTS)|V8_PHASE_NAMES|frozenset(('setup.observer.json','prerequisite.outer.json',
    'prerequisite.reader.json','root.runtime.json','preparation.runtime.json','controller.runtime.json','execution.outer.json'))
V8_ORIGINAL_NAMES=V8_BASE_NAMES|{'v8.reader.json'}
V8_LOG_NAMES=V8_ORIGINAL_NAMES|{'.entry-failure.json'}
V8_DIRECTORY=Path('build/i80386-ring3-int-iret-v8')


def v8_observations(value,stages,expected,low,high):
    need(type(value) is dict and set(value)==set(stages),'complete explicitly versioned runtime observation stages')
    previous=low
    for stage in stages:
        row=value[stage];keys(row,'files aliases platform startMonoNs finishMonoNs')
        need(equal(row['files'],{path:{key:item[key] for key in ('bytes','sha256','mode')} for path,item in expected['files'].items()}) and
             equal(row['aliases'],expected['aliases']) and equal(row['platform'],expected['platform']),
             'entire externally selected runtime superset observed without omissions')
        start=integer(row['startMonoNs'],previous);end=integer(row['finishMonoNs'],start,high);previous=end
    return value


def verify_v8_delivery(originals,packet,expected):
    """New version only: guest predicates plus independently retained prerequisites.

    No process-created fact authenticates an official GitHub event or artifact.
    That final authority is supplied separately to verify_v8_artifact below.
    """
    keys(expected,'schema runId attempt head tree requestSha256 invoker')
    need(expected['schema']=='bw.ring3.execution-expectation.v8' and set(originals)==V8_BASE_NAMES,
         'explicit complete V8 original and external expectation versions')
    need(all(type(raw) is bytes and len(raw)<=CAPS['jsonBytes'] for raw in originals.values()) and
         sum(map(len,originals.values()))<=5<<20,'held aggregate V8 raw original cap')
    prereq_expected=dict(expected,schema='bw.ring3.prerequisite-expectation.v1')
    prereq_names=set(SETUP_INPUTS)|{'setup.observer.json','prerequisite.outer.json'}
    verdict=verify_prerequisites({name:originals[name] for name in prereq_names},prereq_expected)
    # The old independent reader's exact process/verdict joins are reused over
    # a new bounded framing assembled from these already retained raw bytes.
    prereq_raw=bytearray()
    for name in sorted(prereq_names|{'prerequisite.reader.json'}):
        raw=originals[name];encoded=base64.b64encode(raw).decode();parts=[encoded[i:i+3072] for i in range(0,len(encoded),3072)] or ['']
        for index,part in enumerate(parts):
            prereq_raw.extend(b'RING3_PREREQUISITE '+canonical({'schema':'bw.ring3.prerequisite-log.v1','name':name,'index':index,
                'count':len(parts),'bytes':len(raw),'sha256':sha(raw),'data':part}))
    need(equal(verify_prerequisite_log(bytes(prereq_raw),prereq_expected),verdict),'held independent prerequisite reader verdict joins')
    request=parse(originals['request.original.json']);source_raw=prerequisite_original(canonical(request['source']));source=parse(source_raw)
    collection=parse(originals['execution.outer.json']);keys(collection,'schema requestSha256 platform drop firstFailure secondary')
    need(collection['schema']=='bw.ring3.execution-outer-original.v8' and collection['requestSha256']==expected['requestSha256'] and
         collection['firstFailure'] is None and collection['secondary']==[],'original failure-free outside V8 collector')
    context=collection['platform'];keys(context,'GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_REPOSITORY GITHUB_EVENT_NAME GITHUB_ACTOR GITHUB_JOB GITHUB_WORKFLOW_SHA GITHUB_WORKFLOW_REF BW_EXPECTED_HEAD BW_EXPECTED_TREE')
    need(context=={'GITHUB_RUN_ID':expected['runId'],'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
         'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'actual','GITHUB_WORKFLOW_SHA':context['GITHUB_WORKFLOW_SHA'],
         'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge',
         'BW_EXPECTED_HEAD':expected['head'],'BW_EXPECTED_TREE':expected['tree']},'raw actual platform source/event/run/job joins')
    digest(context['GITHUB_WORKFLOW_SHA'],40)
    dropped=collection['drop'];keys(dropped,'uids gids groups pid status membership');uid,gid=expected['invoker']
    need(equal(dropped['uids'],[uid]*3) and equal(dropped['gids'],[gid]*3) and dropped['groups']==[],'raw outside collector UID/GID drop')
    integer(dropped['pid'],1);setup_membership(dropped['membership'],expected['runId'])
    need(type(dropped['status']) is str and len(dropped['status'].encode())<=4096,'bounded raw collector capability status')
    for field in ('CapInh','CapPrm','CapEff','CapAmb'):
        found=re.search('^'+field+r':\s*([0-9a-fA-F]+)\s*$',dropped['status'],re.M)
        need(found is not None and int(found[1],16)==0,'raw outside collector capabilities dropped')
    runtime_raw=originals['runtime-expectation.json'];selected=runtime_expectation(runtime_raw,request['runtime']['sha256'])
    before=parse(packet['runtime.before.json']);verify_runtime_stable_original(before,runtime_raw,request['runtime']['sha256'])
    verify_runtime_stable_original(parse(packet['runtime.after.json']),runtime_raw,request['runtime']['sha256'])
    need(originals['launch-plan.original.json']==originals['launch-plan.json'],'same retained dynamic delivery plan, never external approval')
    phase=parse(originals['preparation.phase.json']);outside=parse(originals['.outside.json']);entry=parse(originals['.entry.json'])
    need(originals['preparation.phase.json']==canonical(phase) and phase['schema']=='bw.ring3.preparation-original.v4',
         'canonical explicit new preparation phase version')
    pin=expected['requestSha256'];outer=outside['process'];prep=phase['process']
    need(dropped['pid']==outer['parentPid'],'same outside drop and preparation/controller parent identity')
    for process_value,mode in ((outer,'--bootstrap-runtime-admitted'),(prep,'--prepare-runtime-admitted')):
        need(process_value['argv']==[entry['python']['path'],'-I','-B',V8_RUN_FILE,mode] and
             process_value['environment'].get('BW_RING3_APPROVED_REQUEST_SHA256')==pin,
             'new execution descriptors carry prior external request pin')
    need([entry['uid'],entry['gid']]==expected['invoker'],'V8 invoker joins independent observer/external expectation')
    # Validate the new identities before selecting the held finite provenance
    # rules. These local projections never replace the retained V4 originals.
    held={name:raw for name,raw in originals.items() if name in V8_PHASE_NAMES}
    projected_phase=parse(canonical(phase));projected_phase['schema']='bw.ring3.preparation-original.v3'
    projected_phase['process']['argv'][-1]='--prepare-admitted-generated'
    del projected_phase['process']['environment']['BW_RING3_APPROVED_REQUEST_SHA256']
    projected_outer=parse(canonical(outside));projected_outer['process']['argv'][-1]='--bootstrap'
    del projected_outer['process']['environment']['BW_RING3_APPROVED_REQUEST_SHA256']
    held['preparation.phase.json']=canonical(projected_phase);held['.outside.json']=canonical(projected_outer)
    resources_value=parse(packet['resources.json']);guest_processes={role:parse(packet[role+'/process.json']) for role in ('js','qemu')}
    refs=lambda names,prefix:{name:{'bytes':len(packet[prefix+name]),'sha256':sha(packet[prefix+name])} for name in names}
    provenance={'runId':int(expected['runId']),'source':source,'sourceSha256':sha(source_raw),'python':selected['executables']['python'],
        'resources':resources_value,'guestProcesses':guest_processes,'runtime':before,'inputs':refs(('fixture.rom','fixture.json'),'inputs/'),
        'jsOriginals':refs(('report.json','observations.json','writes.json','memory.before.bin','memory.after.bin'),'js/'),
        'preparationIdentity':verdict['preparationIdentity'],'node':V8_NODE_PIN,'launchPlanSha256':sha(originals['launch-plan.json'])}
    v8_check_internal(held,provenance)
    runtime_hash=sha(runtime_raw);generation=parse(originals['generation.phase.json'])
    for name,schema in (('preparation.runtime.json','bw.ring3.preparation-runtime-original.v1'),
                        ('controller.runtime.json','bw.ring3.runtime-admission-original.v2'),('root.runtime.json','bw.ring3.root-runtime-original.v1')):
        row=parse(originals[name]);keys(row,'schema requestSha256 runtimeSha256 pid observations firstFailure secondary'+
            (' probeProcesses' if name=='controller.runtime.json' else ''))
        need(originals[name]==canonical(row) and row['schema']==schema and row['requestSha256']==pin and row['runtimeSha256']==runtime_hash and
             row['firstFailure'] is None and row['secondary']==[],'canonical failure-free independently pinned runtime original')
        integer(row['pid'],1)
        if name=='preparation.runtime.json':
            need(row['pid']==prep['pid'],'preparation runtime observations belong to actual preparation PID')
            obs=v8_observations(row['observations'],('before-probes','after-probes'),selected,prep['spawnMonoNs'],prep['reapMonoNs'])
            need(obs['before-probes']['finishMonoNs']<=generation['before']['monoNs'] and
                 obs['after-probes']['startMonoNs']>=parse(originals['git.before.json'])['commands'][-1]['process']['reapMonoNs'],
                 'entire runtime gate precedes generation and rereads after PRE')
        elif name=='root.runtime.json':
            need(row['pid']==outer['parentPid'],'root gate and outside collector parent identity')
            observer=parse(originals['setup.observer.json'])['process']
            obs=v8_observations(row['observations'],('before-probes','after-guests'),selected,1,2**63-1)
            reader_start=parse(originals['prerequisite.reader.json'])['process']['spawnMonoNs']
            need(obs['before-probes']['finishMonoNs']<=observer['spawnMonoNs']<=observer['reapMonoNs']<=prep['spawnMonoNs'] and
                 obs['after-guests']['startMonoNs']>=outer['reapMonoNs'] and obs['after-guests']['finishMonoNs']<=reader_start,
                 'root stable gate before preparation and after controller terminal')
        else:
            need(row['pid']==outer['pid'],'runtime probe originals belong to held controller PID')
            obs=v8_observations(row['observations'],('before-probes','after-probes','after-guests'),selected,outer['spawnMonoNs'],outer['reapMonoNs'])
            records=row['probeProcesses'];need(type(records) is list and len(records)==11,'complete independently retained probe process roster')
            descriptors={row['role']:row for row in selected['probes']};seen=set();previous=obs['before-probes']['finishMonoNs']
            for record in records:
                keys(record,'role process census');role=record['role'];need(role in descriptors and role not in seen,'closed original probe process roles');seen.add(role)
                descriptor=descriptors[role];process_value=record['process']
                start,end=v8_process(process_value,'discovery',descriptor['argv'],descriptor['environment'],10000)
                for usage_name in ('userSeconds','systemSeconds'):
                    need(0<=process_value['rusage'][usage_name]<=10,'bounded V8 metadata child CPU usage')
                integer(process_value['rusage']['maxRssKiB'],0,1048576)
                need(process_value['parentPid']==outer['pid'] and start>=previous and end<=obs['after-probes']['startMonoNs'],
                     'serial discovery children after full gate and before full readback')
                previous=end;census=record['census'];keys(census,'controller js qemu')
                probe_resources=parse(canonical(resources_value))
                for role_name,snapshot in census.items():
                    keys(snapshot,'identity limits raw procs')
                    keys(snapshot['raw'],'memoryEvents cpuStat cgroupEvents memoryCurrent memoryPeak pidsCurrent')
                    need(equal(snapshot['identity'],entry['cgroups'][role_name]['identity']) and equal(snapshot['limits'],V8_LIMITS) and
                         equal(snapshot['procs'],[outer['pid']] if role_name=='controller' else []) and
                         snapshot['raw']['pidsCurrent'].strip()==('1' if role_name=='controller' else '0') and
                         'populated '+('1' if role_name=='controller' else '0') in snapshot['raw']['cgroupEvents'].splitlines(),
                         'independent raw probe terminal controller/guest census')
                    pair=probe_resources['controller'] if role_name=='controller' else probe_resources['children'][role_name]
                    pair['before']=snapshot
                # The held resource rules independently validate exact identity
                # fields, scalar text, unique counters, frozen state, caps and
                # monotonic no-OOM joins from each probe to the final census.
                resources(probe_resources,guest_processes)
            need(obs['after-probes']['finishMonoNs']<=guest_processes['js']['spawnMonoNs'] and
                 obs['after-guests']['startMonoNs']>=guest_processes['qemu']['reapMonoNs'],'full runtime readbacks bracket actual guests')
    packet_verdict=v8_packet_predicates(packet,{key:source[key] for key in ('head','tree','files')},before)
    return {'schema':'bw.ring3.execution-admission.v8','guestPredicatesObserved':packet_verdict['guestPredicatesObserved'],
        'officialQualified':False,'requestSha256':pin,'runtimeSha256':runtime_hash,'preparationIdentity':verdict['preparationIdentity']}


def v8_read_roster(relative,roster,uid,gid,packet=False):
    """Independent dropped readonly sink reader; never imports the producer."""
    result={};descriptors=[];first=None
    try:
        checkout=Path.cwd();ancestors=[]
        for path in (checkout,checkout/'build',checkout/relative):
            need(path.resolve(strict=True)==path,'canonical V8 read ancestry')
            fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK);descriptors.append(fd);info=os.fstat(fd)
            need(stat.S_ISDIR(info.st_mode) and (info.st_uid,info.st_gid)==(uid,gid) and info.st_mode&0o022==0,
                 'invoker-owned nonwritable V8 read ancestry')
            ancestors.append((path,fd,setup_metadata(info)))
        root=descriptors[-1];groups={}
        for name in roster:
            parts=name.split('/');need(len(parts)<=2,'fixed V8 role depth')
            groups.setdefault(parts[0] if len(parts)==2 else '',set()).add(parts[-1])
        need(set(os.listdir(root))==groups.get('',set())|{name for name in groups if name},'closed V8 original directory roster')
        for group,names in sorted(groups.items()):
            directory=root;group_info=None
            if group:
                directory=os.open(group,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=root);descriptors.append(directory)
                group_info=os.fstat(directory);need(stat.S_ISDIR(group_info.st_mode) and (group_info.st_uid,group_info.st_gid)==(uid,gid) and
                    group_info.st_mode&0o022==0 and set(os.listdir(directory))==names,'closed invoker-owned packet role directory')
            try:
                for name in sorted(names):
                    role=(group+'/' if group else '')+name
                    cap=(CAPS['jsonBytes'] if name.endswith('.json') else CAPS['ramBytes'] if name.endswith('.bin') else
                         CAPS['romBytes'] if name.endswith('.rom') else CAPS['streamBytes']) if packet else CAPS['jsonBytes']
                    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory);descriptors.append(fd);file_error=None
                    try:
                        info=os.fstat(fd);need(stat.S_ISREG(info.st_mode) and (info.st_uid,info.st_gid)==(uid,gid) and
                            stat.S_IMODE(info.st_mode)==(0o600 if packet else 0o400) and info.st_nlink==1 and 0<=info.st_size<=cap,
                            'fixed bounded single-link V8 original file')
                        raw=bytearray()
                        while True:
                            part=os.read(fd,min(65536,cap+1-len(raw)))
                            if not part:break
                            raw.extend(part);need(len(raw)<=cap,'V8 per-role read cap')
                        need(len(raw)==info.st_size and setup_metadata(os.fstat(fd))==setup_metadata(info) and
                             setup_metadata(os.stat(name,dir_fd=directory,follow_symlinks=False))==setup_metadata(info),'held V8 original name/descriptor readback')
                        result[role]=bytes(raw)
                        need(sum(map(len,result.values()))<=(CAPS['packetBytes'] if packet else 5<<20),'unchanged aggregate V8 read cap')
                    except BaseException as error:file_error=error
                    finally:
                        descriptors.pop()
                        try:os.close(fd)
                        except BaseException as error:
                            if file_error is None:file_error=error
                            else:file_error.setup_secondary=getattr(file_error,'setup_secondary',[])+[{'phase':'v8-file-close','name':type(error).__name__,'message':str(error)}]
                    if file_error is not None:raise file_error
                if group:
                    need(setup_metadata(os.fstat(directory))==setup_metadata(group_info) and
                         setup_metadata(os.stat(group,dir_fd=root,follow_symlinks=False))==setup_metadata(group_info),'held packet directory identity readback')
            finally:
                if group:
                    primary=sys.exc_info()[1];descriptors.pop()
                    try:os.close(directory)
                    except BaseException as error:
                        if primary is None:raise
                        primary.setup_secondary=getattr(primary,'setup_secondary',[])+[{'phase':'v8-packet-directory-close','name':type(error).__name__,'message':str(error)}]
        for path,fd,frozen in ancestors:
            need(setup_metadata(os.fstat(fd))==frozen and setup_metadata(path.lstat())==frozen,'held V8 sink ancestry readback')
    except BaseException as error:first=error
    finally:
        for fd in reversed(descriptors):
            try:os.close(fd)
            except BaseException as error:
                if first is None:first=error
                else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'v8-directory-close','name':type(error).__name__,'message':str(error)}]
    if first is not None:raise first
    return result


def admit_hosted_runtime(environ):
    expected=dict(prerequisite_expected(environ),schema='bw.ring3.execution-expectation.v8');uid,gid=expected['invoker']
    identity={'uids':list(os.getresuid()),'gids':list(os.getresgid()),'groups':os.getgroups(),'pid':os.getpid(),'parentPid':os.getppid()}
    need(identity['uids']==[uid]*3 and identity['gids']==[gid]*3 and identity['groups']==[],'actual dropped V8 reader BEFORE any original decode')
    identity['status']=setup_proc_read('/proc/self/status');identity['membership']=setup_proc_read('/proc/self/cgroup')
    setup_membership(identity['membership'],expected['runId'])
    for field in ('CapInh','CapPrm','CapEff','CapAmb'):
        row=re.search('^'+field+r':\s*([0-9a-fA-F]+)\s*$',identity['status'],re.M)
        need(row is not None and int(row[1],16)==0,'actual dropped V8 reader capabilities before JSON')
    originals=v8_read_roster(V8_DIRECTORY,V8_BASE_NAMES,uid,gid)
    packet=v8_read_roster(Path('build/i80386-ring3-int-iret-export'),ROLES,uid,gid,packet=True)
    verdict=verify_v8_delivery(originals,packet,expected)
    return {'schema':'bw.ring3.execution-reader-admission.v8','identity':identity,'verdict':verdict}


def decode_v8_log(raw):
    need(type(raw) is bytes and len(raw)<=8<<20,'unchanged aggregate V8 encoded/log cap')
    groups={};chunks=0
    for line in raw.splitlines():
        marker=b'RING3_V8 ';offset=line.find(marker)
        if offset<0:continue
        need(line[:offset]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:offset]),'canonical official V8 log timestamp')
        row=parse(line[offset+len(marker):]);keys(row,'schema name index count bytes sha256 data')
        need(row['schema']=='bw.ring3.execution-log.v8' and row['name'] in V8_LOG_NAMES,'explicit new V8 log version and original name')
        count=integer(row['count'],1,456);index=integer(row['index'],0,count-1);extent=integer(row['bytes'],0,CAPS['jsonBytes']);digest(row['sha256'])
        need(type(row['data']) is str and len(row['data'])<=3072,'held encoded V8 chunk cap')
        group=groups.setdefault(row['name'],{'count':count,'bytes':extent,'sha256':row['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,row['sha256']) and index==len(group['parts']),'one immutable ordered V8 chunk sequence')
        group['parts'].append(row['data']);chunks+=1;need(chunks<=2600,'unchanged aggregate V8 chunk cap')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete retained V8 original')
        encoded=''.join(group['parts']);data=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(data).decode()==encoded and len(data)==group['bytes'] and sha(data)==group['sha256'],'exact retained V8 bytes/hash/encoding')
        originals[name]=data;need(sum(map(len,originals.values()))<=5<<20,'unchanged aggregate V8 raw cap')
    return originals


def verify_v8_artifact(log_raw,artifact_raw,external):
    keys(external,'schema runId attempt head tree requestSha256 invoker official workflowSha logBytes logSha256')
    need(external['schema']=='bw.ring3.execution-official-expectation.v8' and
         integer(external['logBytes'],1,8<<20)==len(log_raw) and digest(external['logSha256'])==sha(log_raw),
         'independently admitted official V8 log original')
    originals=decode_v8_log(log_raw);need(set(originals)==V8_ORIGINAL_NAMES,'full V8 originals including separate dropped admission process')
    need(digest(external['workflowSha'],40)==parse(originals['execution.outer.json'])['platform']['GITHUB_WORKFLOW_SHA'],
         'separately admitted official executing workflow revision')
    reader_raw=originals.pop('v8.reader.json');packet=read_archive(artifact_raw)
    expected={key:external[key] for key in ('runId','attempt','head','tree','requestSha256','invoker')};expected['schema']='bw.ring3.execution-expectation.v8'
    verdict=verify_v8_delivery(originals,packet,expected)
    retained=parse(reader_raw);keys(retained,'schema process stdout stderr');need(retained['schema']=='bw.ring3.execution-reader-original.v8','explicit final dropped reader original')
    process_value=retained['process'];prior=parse(originals['prerequisite.reader.json'])['process'];outer=parse(originals['.outside.json'])['process']
    start,end=v8_process(process_value,'discovery',['/usr/bin/python3','-I','-B',V8_RUN_FILE.replace('run.py','reader.py'),'--admit-hosted-runtime'],prior['environment'],10000)
    need(start>=prior['reapMonoNs'] and process_value['parentPid']==outer['parentPid'] and process_value['pid']!=outer['parentPid'],
         'causally later independent V8 reader under outside dropped collector')
    output=parse(prerequisite_original(canonical(retained['stdout'])));keys(output,'schema identity verdict')
    need(output['schema']=='bw.ring3.execution-reader-admission.v8' and equal(output['verdict'],verdict) and
         prerequisite_original(canonical(retained['stderr']))==b'','retained V8 verdict matches fresh standalone original validation')
    identity=output['identity'];keys(identity,'uids gids groups pid parentPid status membership');uid,gid=expected['invoker']
    need(equal(identity['uids'],[uid]*3) and equal(identity['gids'],[gid]*3) and identity['groups']==[] and
         integer(identity['pid'],1)==process_value['pid'] and integer(identity['parentPid'],1)==process_value['parentPid'],
         'retained actual dropped V8 reader identity')
    setup_membership(identity['membership'],expected['runId'])
    need(type(identity['status']) is str and len(identity['status'].encode())<=4096,'bounded original V8 reader status')
    for field in ('CapInh','CapPrm','CapEff','CapAmb'):
        found=re.search('^'+field+r':\s*([0-9a-fA-F]+)\s*$',identity['status'],re.M)
        need(found is not None and int(found[1],16)==0,'original V8 reader capability drop')
    request=parse(originals['request.original.json']);source=parse(prerequisite_original(canonical(request['source'])))
    official=external['official'];need(official['runId']==int(expected['runId']) and official['head']==expected['head'],'external official run/source joins V8 request')
    result=verify_artifact(artifact_raw,{'official':official,'source':{key:source[key] for key in ('head','tree','files')},
        'runtime':parse(packet['runtime.before.json'])})
    return dict(result,schema='bw.ring3.official-admission.v8',requestSha256=expected['requestSha256'],runtimeSha256=verdict['runtimeSha256'],
        versionedExecutionProvenance=True)


NODE_STAGE_OBSERVER_ENABLED=False
NODE_STAGE_ROOT=Path('/run/bw-ring3-node-22.23.3')
NODE_STAGE_TARGET=str(NODE_STAGE_ROOT/'node')
NODE_STAGE_BOUNDARY={'phase':'Node-stage-boundary','name':'Refusal','message':'full staged runtime inventory and actual mapping remain unconnected'}
NODE_STAGE_PLATFORM=('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_ACTOR','GITHUB_JOB',
    'GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF','BW_EXPECTED_HEAD','BW_EXPECTED_TREE','BW_RING3_NODE_STAGE_REQUEST_SHA256','SUDO_UID','SUDO_GID')


def node_stage_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=1<<20 and digest(pin)==sha(raw),'externally selected Node-stage request v2')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v2' and value['repository']=='CrispStrobe/bw-board' and
         type(value['pullRequest']) is int and 0<value['pullRequest']<2**31,'canonical fixed Node-stage request')
    digest(value['head'],40);digest(value['tree'],40)
    source_raw=prerequisite_original(canonical(value['source']));source=parse(source_raw);keys(source,'schema head tree files')
    need(source_raw==canonical(source) and source['schema']=='bw.ring3.source.v1' and source['head']==value['head'] and
         source['tree']==value['tree'] and type(source['files']) is dict and set(source['files'])==SETUP_SOURCE_PATHS,'closed stage source12')
    for row in source['files'].values():
        keys(row,'mode blob bytes sha256');need(row['mode']=='100644','stage regular Git mode');integer(row['bytes'],1,4<<20);digest(row['sha256']);digest(row['blob'],40)
    selected={'node':{'path':RUNTIME_NODE,**RUNTIME_SELECTED['node']},'qemu':{'path':RUNTIME_QEMU,**RUNTIME_SELECTED['qemu']}}
    stage={'source':RUNTIME_NODE,'destination':NODE_STAGE_TARGET,'owner':[0,0],'fileMode':0o555,'directoryMode':0o555}
    need(equal(value['selected'],selected) and equal(value['nodeStage'],stage),'fixed typed stage source/destination/owner/mode and pins')
    return value,source


def node_stage_event(raw,request,pin,environment):
    event=parse(raw);pr=event.get('pull_request',{});body=pr.get('body');start='<!-- BW_RING3_NODE_STAGE_V2\n';end='\nBW_RING3_NODE_STAGE_V2 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one immutable stage request block')
    block=body.split(start,1)[1].split(end,1)[0];wrapper=parse(block.encode())
    need(canonical(wrapper).decode().rstrip('\n')==block and prerequisite_original(canonical(wrapper))==canonical(request) and
         wrapper['sha256']==pin,'exact stage event request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-node-stage-inventory' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and pr['number']==event['number'] and
         pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and
         pr['head']['repo'].get('fork') is False and pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'fixed owned stage event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
        'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'node-stage-inventory','BW_EXPECTED_HEAD':request['head'],
        'BW_EXPECTED_TREE':request['tree'],'BW_RING3_NODE_STAGE_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),'closed stage platform joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),'first Node-stage run')
    digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def node_stage_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v1' and record['firstFailure'] is None and record['secondary']==[] and
        record['recordBoundary']=='verified copy before directory publication and ancestor close','closed Node installation record boundary')
    request_raw=prerequisite_original(canonical(record['request']));request,source=node_stage_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(NODE_STAGE_PLATFORM),'closed stage recorded platform')
    node_stage_event(event_raw,request,pin,environment);need(equal(record['source'],source),'root Git/live source joins request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and copy['directoryPublicationAttempted'] is False and
        copy['filePublished'] is True and copy['directoryPublished'] is False and
        type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
        type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
        copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],'verified fixed copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info),'raw stage metadata shape')
        need(all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw stage metadata scalar bounds')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and stat.S_ISREG(before[2]) and before[2]&0o6000==0 and
        before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],'untrusted cache source held identity and extent')
    file=copy['file'];directory=copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
        stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],'fixed published Node and prepublication directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original stage Git observations')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false'];safe=None
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n' for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv'];need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
            type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped stage source Git checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed Node-stage Git descriptor')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'causal sequential source Git processes under one installer');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,'exact original stage Git output')
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and all(0<=event_meta[key]<2**64 for key in event_meta if key!='st_mtime_ns') and
        -2**63<=event_meta['st_mtime_ns']<2**63 and event_meta['st_size']==len(event_raw) and stat.S_ISREG(event_meta['st_mode']),'held official event extent')
    return request,source


class NodeStageReadonly:
    """Separate held readonly implementation; no producer imports or mutations."""
    def __init__(self):self.fds=[];self.directories=[];self.facts={}

    def open(self):
        parent=None
        for path in (Path('/'),Path('/run'),NODE_STAGE_ROOT):
            fd=os.open(path if parent is None else path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK,
                **({} if parent is None else {'dir_fd':parent}));self.fds.append(fd);parent=fd
            before=setup_metadata(os.fstat(fd));need(path.resolve(strict=True)==path and before==setup_metadata(path.lstat()) and
                stat.S_ISDIR(before[2]) and before[3:5]==[0,0] and before[2]&0o022==0 and
                (path!=NODE_STAGE_ROOT or stat.S_IMODE(before[2])==0o555),'root-owned staged Node ancestors')
            self.directories.append((path,fd,before))

    def read(self,name,retain=False):
        need(name in ('node','installation.original.json'),'fixed stage readonly input')
        directory=self.fds[-1];fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
        first=None;count=0;digest_=hashlib.sha256();prefix=b'';data=bytearray()
        row={'before':None,'after':None,'namedAfter':None,'closeSucceeded':False};self.facts[name]=row
        try:
            before=setup_metadata(os.fstat(fd));row['before']=before
            cap=RUNTIME_SELECTED['node']['bytes'] if name=='node' else 1<<20;mode=0o555 if name=='node' else 0o444
            need(before==setup_metadata(os.stat(name,dir_fd=directory,follow_symlinks=False)) and stat.S_ISREG(before[2]) and
                stat.S_IMODE(before[2])==mode and before[3:6]==[0,0,1] and 0<before[6]<=cap and
                (name!='node' or before[6]==cap),'readonly root staged input owner/mode/extent')
            while True:
                chunk=os.read(fd,min(65536,cap+1-count))
                if not chunk:break
                count+=len(chunk);need(count<=cap,'bounded staged input read');digest_.update(chunk);prefix=(prefix+chunk)[:4]
                if retain:data.extend(chunk)
            row.update(bytes=count,sha256=digest_.hexdigest(),prefix=prefix.hex(),after=setup_metadata(os.fstat(fd)),
                namedAfter=setup_metadata(os.stat(name,dir_fd=directory,follow_symlinks=False)))
            need(before==row['after']==row['namedAfter'] and count==before[6],'independent staged input held readback')
            if name=='node':need(digest_.hexdigest()==RUNTIME_SELECTED['node']['sha256'] and prefix==b'\x7fELF','independent historical staged Node bytes')
        except BaseException as error:first=error
        finally:
            try:os.close(fd);row['closeSucceeded']=True
            except BaseException as error:
                if first is None:first=error
                else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'stage-read-close','name':type(error).__name__,'message':str(error)}]
        if first is not None:raise first
        return bytes(data) if retain else row

    def close(self):
        first=None
        try:
            for path,fd,before in self.directories:
                held=setup_metadata(os.fstat(fd));named=setup_metadata(path.lstat());length=8 if path==NODE_STAGE_ROOT else 5
                need(held[:length]==named[:length]==before[:length] and path.resolve(strict=True)==path,'staged ancestor held readback')
        except BaseException as error:first=error
        for fd in reversed(self.fds):
            try:os.close(fd)
            except BaseException as error:
                if first is None:first=error
                else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'stage-parent-close','name':type(error).__name__,'message':str(error)}]
        self.fds=[]
        if first is not None:raise first


def node_stage_identity(identity,uid,gid):
    keys(identity,'uid gid groups status membership pid')
    need(all(type(identity[key]) is int for key in ('uid','gid')) and [identity['uid'],identity['gid']]==[uid,gid] and
        identity['groups']==[],'observed dropped stage IDs/groups')
    pid=integer(identity['pid'],1);status=identity['status']
    need(type(status) is str and len(status.encode())<=4096,'bounded original stage process status')
    required={'Pid','Uid','Gid','Groups','CapInh','CapPrm','CapEff','CapAmb'};rows={}
    for line in status.splitlines():
        name,separator,text=line.partition(':')
        if name not in required:continue
        need(separator==':' and name not in rows,'unique required stage process status row');rows[name]=text.strip()
    need(set(rows)==required and rows['Pid']==str(pid) and rows['Uid'].split()==[str(uid)]*4 and
        rows['Gid'].split()==[str(gid)]*4 and rows['Groups']=='','raw stage PID/UID/GID/groups join actual dropped identity')
    for name in ('CapInh','CapPrm','CapEff','CapAmb'):
        need(re.fullmatch('[0-9a-fA-F]+',rows[name]) is not None and int(rows[name],16)==0,'raw zero stage capability '+name)


def observe_staged_node(environ):
    value={'schema':'bw.ring3.node-stage-observation.v1','stageObserved':False,'runtimeCandidate':False,'qualified':False,
        'record':None,'files':{},'directories':[],'source':{},'identity':None,'firstFailure':None,'secondary':[]};backend=None
    def failed(error,phase):
        row={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=row
        else:value['secondary'].append(row)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),'known stage invoker')
        uid,gid=map(int,ids);need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],'actual dropped stage observer IDs/groups')
        status=setup_proc_read('/proc/self/status')
        membership=setup_proc_read('/proc/self/cgroup');setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid)  # Before any acquired JSON is decoded.
        pin=digest(environ.get('BW_RING3_NODE_STAGE_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True);value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=node_stage_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],'exec preserves installer/observer PID')
        event_raw=prerequisite_original(canonical(record['event']));node_stage_event(event_raw,request,pin,environ)
        need(set(environ)==set(NODE_STAGE_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in NODE_STAGE_PLATFORM}),'Node-stage original actual closed platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat();need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),'live stage source regular owner/mode')
            raw=inventory_file(target,4<<20);fact={'bytes':len(raw),'sha256':sha(raw),'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent stage source12 bytes')
        backend.read('node');need(backend.facts['node']['before']==record['copy']['file'],'finite installer/observer Node file identity join');value['stageObserved']=True
    except BaseException as error:failed(error,'stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts;value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'stage-observer-close')
    if value['firstFailure'] is None:value['firstFailure']=dict(NODE_STAGE_BOUNDARY)
    return value  # Explicit terminal refusal, including after a genuine staged observation.


def verify_node_stage_observation(raw,expected):
    keys(expected,'schema requestSha256 head tree runId workflowSha invoker observation')
    need(expected['schema']=='bw.ring3.node-stage-expectation.v1','explicit metadata-only stage expectation')
    digest(expected['requestSha256']);digest(expected['head'],40);digest(expected['tree'],40);digest(expected['workflowSha'],40);integer(expected['runId'],1)
    need(type(expected['invoker']) is list and len(expected['invoker'])==2 and all(type(x) is int and 0<x<2**31 for x in expected['invoker']),'externally observed stage invoker')
    keys(expected['observation'],'bytes sha256');need(type(raw) is bytes and integer(expected['observation']['bytes'],1,1<<20)==len(raw) and
        digest(expected['observation']['sha256'])==sha(raw),'independently selected staged observation bytes')
    value=parse(raw);keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary')
    need(raw==canonical(value) and value['schema']=='bw.ring3.node-stage-observation.v1' and value['stageObserved'] is True and
        value['runtimeCandidate'] is False and value['qualified'] is False and equal(value['firstFailure'],NODE_STAGE_BOUNDARY) and value['secondary']==[],
        'genuine staged metadata observation followed by explicit unimplemented boundary refusal')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw);request,source=node_stage_record(record,expected['requestSha256'])
    env=record['platform'];need(request['head']==expected['head'] and request['tree']==expected['tree'] and env['GITHUB_RUN_ID']==str(expected['runId']) and
        env['GITHUB_WORKFLOW_SHA']==expected['workflowSha'] and [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,expected['invoker'])),'external stage source/platform/invoker joins')
    need(equal(value['source'],source['files']),'independent live stage source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*expected['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],'original exec preserves installer/observer PID')
    setup_membership(identity['membership'],str(expected['runId']))
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},'two independent stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix');need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and equal(row['before'],row['namedAfter']),
            'closed stable stage readonly file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and all(type(x) is int for x in metadata) and all(0<=x<2**64 for x in metadata[:7]) and
            -2**63<=metadata[7]<2**63 and stat.S_ISREG(metadata[2]) and
            metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'] and type(row['bytes']) is int,'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444;need(stat.S_IMODE(metadata[2])==mode,'strict independent stage file mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent staged file content identity')
        if name=='node':need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],'staged ELF/install finite file identity')
        else:need(row['prefix']==record_raw[:4].hex(),'observed original record prefix joins retained bytes')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==['/','/run',str(NODE_STAGE_ROOT)],'fixed readonly stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before'];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63 and
            stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and (index!=2 or stat.S_IMODE(info[2])==0o555),'root nonwritable stage ancestor original')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite staged directory inode join')
    return {'schema':'bw.ring3.node-stage-admission.v1','stagedNodeObserved':True,'runtimeCandidate':False,'qualified':False,'boundary':dict(NODE_STAGE_BOUNDARY)}


STAGED_RUNTIME_INVENTORY_ENABLED=True
STAGED_EMPTY_PYTHON_SOURCES={'/usr/lib/python3.12/urllib/__init__.py':{'kind':'python-source-empty','bytes':0,'sha256':'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','mode':0o644,'owner':[0,0],'links':1}}
STAGED_RUNTIME_PLATFORM=tuple('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256' if key=='BW_RING3_NODE_STAGE_REQUEST_SHA256' else key for key in NODE_STAGE_PLATFORM)


def staged_runtime_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=1<<20 and digest(pin)==sha(raw),'externally selected Node-stage request v3')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage emptyPythonSources')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v3' and value['repository']=='CrispStrobe/bw-board' and
         type(value['pullRequest']) is int and 0<value['pullRequest']<2**31,'canonical fixed Node-stage request')
    digest(value['head'],40);digest(value['tree'],40)
    source_raw=prerequisite_original(canonical(value['source']));source=parse(source_raw);keys(source,'schema head tree files')
    need(source_raw==canonical(source) and source['schema']=='bw.ring3.source.v1' and source['head']==value['head'] and
         source['tree']==value['tree'] and type(source['files']) is dict and set(source['files'])==SETUP_SOURCE_PATHS,'closed stage source12')
    for row in source['files'].values():
        keys(row,'mode blob bytes sha256');need(row['mode']=='100644','stage regular Git mode');integer(row['bytes'],1,4<<20);digest(row['sha256']);digest(row['blob'],40)
    selected={'node':{'path':NODE_STAGE_TARGET,**RUNTIME_SELECTED['node']},'qemu':{'path':RUNTIME_QEMU,**RUNTIME_SELECTED['qemu']}}
    stage={'source':RUNTIME_NODE,'destination':NODE_STAGE_TARGET,'owner':[0,0],'fileMode':0o555,'directoryMode':0o555}
    need(equal(value['selected'],selected) and equal(value['nodeStage'],stage) and equal(value['emptyPythonSources'],STAGED_EMPTY_PYTHON_SOURCES),'fixed typed stage source/destination/owner/mode and pins')
    return value,source


def staged_runtime_event(raw,request,pin,environment):
    event=parse(raw);pr=event.get('pull_request',{});body=pr.get('body');start='<!-- BW_RING3_STAGED_RUNTIME_INVENTORY_V3\n';end='\nBW_RING3_STAGED_RUNTIME_INVENTORY_V3 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one immutable stage request block')
    block=body.split(start,1)[1].split(end,1)[0];wrapper=parse(block.encode())
    need(canonical(wrapper).decode().rstrip('\n')==block and prerequisite_original(canonical(wrapper))==canonical(request) and
         wrapper['sha256']==pin,'exact stage event request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-staged-runtime-inventory' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and pr['number']==event['number'] and
         pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and
         pr['head']['repo'].get('fork') is False and pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'fixed owned stage event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board',
        'GITHUB_EVENT_NAME':'pull_request','GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'staged-runtime-inventory','BW_EXPECTED_HEAD':request['head'],
        'BW_EXPECTED_TREE':request['tree'],'BW_RING3_STAGED_INVENTORY_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),'closed stage platform joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),'first Node-stage run')
    digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def staged_runtime_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v2' and record['firstFailure'] is None and record['secondary']==[] and
        record['recordBoundary']=='verified copy before directory publication and ancestor close','closed Node installation record boundary')
    request_raw=prerequisite_original(canonical(record['request']));request,source=staged_runtime_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(STAGED_RUNTIME_PLATFORM),'closed stage recorded platform')
    staged_runtime_event(event_raw,request,pin,environment);need(equal(record['source'],source),'root Git/live source joins request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and copy['directoryPublicationAttempted'] is False and
        copy['filePublished'] is True and copy['directoryPublished'] is False and
        type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
        type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
        copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],'verified fixed copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info),'raw stage metadata shape')
        need(all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw stage metadata scalar bounds')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and stat.S_ISREG(before[2]) and before[2]&0o6000==0 and
        before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],'untrusted cache source held identity and extent')
    file=copy['file'];directory=copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
        stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],'fixed published Node and prepublication directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original stage Git observations')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false'];safe=None
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n' for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv'];need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
            type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped stage source Git checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed Node-stage Git descriptor')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'causal sequential source Git processes under one installer');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,'exact original stage Git output')
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and all(0<=event_meta[key]<2**64 for key in event_meta if key!='st_mtime_ns') and
        -2**63<=event_meta['st_mtime_ns']<2**63 and event_meta['st_size']==len(event_raw) and stat.S_ISREG(event_meta['st_mode']),'held official event extent')
    return request,source


def staged_runtime_expectation(raw,expected_sha256):
    """Standalone stable-policy admission. Raw ASLR text is never its pin."""
    need(type(raw) is bytes and 0<len(raw)<=256<<10 and digest(expected_sha256)==sha(raw),'external runtime expectation original pin')
    value=parse(raw);keys(value,'schema platform executables versions files aliases packages packagePaths probes emptyPythonSources')
    need(raw==canonical(value) and value['schema']=='bw.ring3.runtime-expectation.v2','canonical explicit runtime expectation version')
    keys(value['platform'],'sysname release machine')
    need(value['platform']['sysname']=='Linux' and value['platform']['machine']=='x86_64' and
         type(value['platform']['release']) is str and re.fullmatch('[A-Za-z0-9_.+-]{1,128}',value['platform']['release']),'selected platform release')
    files=value['files'];aliases=value['aliases']
    need(type(files) is dict and 1<=len(files)<=512 and type(aliases) is dict and len(aliases)<=256,'held stable graph counts')
    need(equal(value['emptyPythonSources'],STAGED_EMPTY_PYTHON_SOURCES) and len(files)+len(value['emptyPythonSources'])<=512 and
        not ((set(files)|set(aliases))&set(value['emptyPythonSources'])) and
        all(resolve_alias(path,aliases)==path for path in value['emptyPythonSources']) and RUNTIME_NODE not in files and RUNTIME_NODE not in aliases,'explicit disjoint typed-empty/staged selection under shared cap')
    total=0
    for path,row in files.items():
        runtime_path(path);keys(row,'bytes sha256 kind mode');total+=integer(row['bytes'],1,268435456);digest(row['sha256'])
        need(row['kind'] in RUNTIME_KINDS and type(row['mode']) is int and 0<=row['mode']<=0o777 and row['mode']&0o022==0,
             'selected file kind/permission mode')
        if row['kind'].endswith('-binary') or row['kind'] in ('observation-tool','tool-interpreter'):need(row['mode']&0o111!=0,'selected executable permissions')
    need(total<=1073741824,'held selected graph total extent')
    for path,row in aliases.items():
        runtime_path(path);keys(row,'linkText target');runtime_path(row['target'])
        need(path not in files and type(row['linkText']) is str and 0<len(row['linkText'].encode())<=256 and
             re.fullmatch('[A-Za-z0-9_.+/-]+',row['linkText']) and
             resolve_alias(posixpath.normpath(posixpath.join(posixpath.dirname(path),row['linkText'])),aliases)==row['target'],
             'selected stable alias text/canonical target')
    need(all(resolve_alias(path,aliases)==path for path in files),'canonical selected file keys')
    keys(value['executables'],'node python qemu');keys(value['versions'],'node python qemu')
    for role,requested in (('node',NODE_STAGE_TARGET),('python','/usr/bin/python3'),('qemu',RUNTIME_QEMU)):
        path=resolve_alias(requested,aliases);row=value['executables'][role];keys(row,'path bytes sha256')
        need(path in files and row=={'path':path,'bytes':files[path]['bytes'],'sha256':files[path]['sha256']} and
             type(row['bytes']) is int and files[path]['kind']==role+'-binary','fixed selected executable graph join')
        if role in RUNTIME_SELECTED:need({key:row[key] for key in ('bytes','sha256')}==RUNTIME_SELECTED[role],'independent historical '+role+' selection')
    need(value['versions']['node']=='v22.23.3' and type(value['versions']['python']) is str and re.fullmatch(r'Python 3\.\d+\.\d+',value['versions']['python']) and
         type(value['versions']['qemu']) is str and re.fullmatch(r'QEMU emulator version 8\.2\.2(?:[ (][^\r\n]*)?',value['versions']['qemu']),'selected runtime versions')
    packages=value['packages'];need(type(packages) is list and len(packages)==5 and
         [row.get('name') for row in packages if type(row) is dict]==sorted(PACKAGE_NAMES),'five sorted unique package rows')
    for row in packages:
        keys(row,'name version architecture');need(type(row['version']) is str and re.fullmatch('[A-Za-z0-9.+:~_-]{1,128}',row['version']) and
             row['architecture'] in ('amd64','all'),'stable selected package fields')
        if row['name']=='qemu-system-x86':need(row['version']=='1:8.2.2+ds-0ubuntu1.18' and row['architecture']=='amd64','historical selected QEMU package')
    paths=value['packagePaths'];need(type(paths) is list and 0<len(paths)<=2048 and paths==sorted(set(paths)),'bounded sorted stable package path union')
    for path in paths:runtime_path(path)
    module=resolve_alias(RUNTIME_TCG,aliases);need(module in files and files[module]['kind']=='tcg-module' and RUNTIME_TCG in paths,'selected i386 TCG module')
    required={value['executables']['qemu']['path'],module}|{path for path,row in files.items() if row['kind']=='qemu-data'}
    need(any(row['kind']=='qemu-data' for row in files.values()) and required<={resolve_alias(path,aliases) for path in paths},'selected QEMU package file ownership')
    need(equal(value['probes'],stable_probe_descriptors(value)),'complete fixed probe descriptor/executable roster')
    return value


def verify_staged_runtime_stable_original(original,expectation_raw,expected_sha256):
    expected=staged_runtime_expectation(expectation_raw,expected_sha256)
    runtime(original,original)  # Preserve every legacy internal/raw predicate.
    need(equal(original['platform'],expected['platform']) and equal(original['executables'],expected['executables']) and
         equal(original['versions'],expected['versions']),'raw runtime joins admitted stable platform/executables/versions')
    package=original['qemuPackage']
    for path,row in package['files'].items():
        need(path in expected['files'] and equal(row,{key:expected['files'][path][key] for key in ('bytes','sha256','kind')}),
             'every discovered original file joins selected superset')
    for path,row in package['aliases'].items():need(path in expected['aliases'] and equal(row,expected['aliases'][path]),'discovered original alias joins selected superset')
    required={path for path,row in expected['files'].items() if row['kind'] in
        ('qemu-data','tcg-module','qemu-binary','node-binary','python-binary','observation-tool','tool-interpreter')}
    need(required<=set(package['files']),'complete engine/tool/package graph in original')
    for probe in package['probes']:
        if probe['role']=='package-version':
            need(sorted(line.split('\t') for line in probe['stdout'].splitlines())==[[row['name'],row['version'],row['architecture']] for row in expected['packages']],
                 'raw original package version join')
        elif probe['role']=='package-files':need(sorted(set(probe['stdout'].splitlines()))==expected['packagePaths'],'raw original stable package path union')
        elif probe['role'].startswith('ldd-'):
            need(all(resolve_alias(path,expected['aliases']) in expected['files'] for path in ldd_paths(probe['stdout'])),
                 'raw ldd paths independently join selected graph without ASLR pinning')
    return expected


def observe_staged_inventory_stage(environ):
    value={'schema':'bw.ring3.staged-node-observation.v2','stageObserved':False,'runtimeCandidate':False,'qualified':False,
        'record':None,'files':{},'directories':[],'source':{},'identity':None,'firstFailure':None,'secondary':[],'publicationSafe':False};backend=None
    def failed(error,phase):
        row={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=row
        else:value['secondary'].append(row)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),'known stage invoker')
        uid,gid=map(int,ids);need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],'actual dropped stage observer IDs/groups')
        status=setup_proc_read('/proc/self/status')
        membership=setup_proc_read('/proc/self/cgroup');setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid);value['publicationSafe']=True  # Before any acquired JSON.
        pin=digest(environ.get('BW_RING3_STAGED_INVENTORY_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True);value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=staged_runtime_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],'exec preserves installer/observer PID')
        event_raw=prerequisite_original(canonical(record['event']));staged_runtime_event(event_raw,request,pin,environ)
        need(set(environ)==set(STAGED_RUNTIME_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in STAGED_RUNTIME_PLATFORM}),'Node-stage original actual closed platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat();need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),'live stage source regular owner/mode')
            raw=inventory_file(target,4<<20);fact={'bytes':len(raw),'sha256':sha(raw),'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent stage source12 bytes')
        backend.read('node');need(backend.facts['node']['before']==record['copy']['file'],'finite installer/observer Node file identity join');value['stageObserved']=True
    except BaseException as error:failed(error,'stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts;value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'stage-observer-close')
    return value


def verify_staged_inventory_stage(raw,expected):
    keys(expected,'schema requestSha256 head tree runId workflowSha invoker observation')
    need(expected['schema']=='bw.ring3.staged-node-expectation.v2','explicit metadata-only stage expectation')
    digest(expected['requestSha256']);digest(expected['head'],40);digest(expected['tree'],40);digest(expected['workflowSha'],40);integer(expected['runId'],1)
    need(type(expected['invoker']) is list and len(expected['invoker'])==2 and all(type(x) is int and 0<x<2**31 for x in expected['invoker']),'externally observed stage invoker')
    keys(expected['observation'],'bytes sha256');need(type(raw) is bytes and integer(expected['observation']['bytes'],1,1<<20)==len(raw) and
        digest(expected['observation']['sha256'])==sha(raw),'independently selected staged observation bytes')
    value=parse(raw);keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary publicationSafe')
    need(raw==canonical(value) and value['schema']=='bw.ring3.staged-node-observation.v2' and value['stageObserved'] is True and
        value['runtimeCandidate'] is False and value['qualified'] is False and value['firstFailure'] is None and value['secondary']==[] and value['publicationSafe'] is True,
        'genuine staged metadata observation followed by explicit unimplemented boundary refusal')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw);request,source=staged_runtime_record(record,expected['requestSha256'])
    env=record['platform'];need(request['head']==expected['head'] and request['tree']==expected['tree'] and env['GITHUB_RUN_ID']==str(expected['runId']) and
        env['GITHUB_WORKFLOW_SHA']==expected['workflowSha'] and [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,expected['invoker'])),'external stage source/platform/invoker joins')
    need(equal(value['source'],source['files']),'independent live stage source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*expected['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],'original exec preserves installer/observer PID')
    setup_membership(identity['membership'],str(expected['runId']))
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},'two independent stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix');need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and equal(row['before'],row['namedAfter']),
            'closed stable stage readonly file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and all(type(x) is int for x in metadata) and all(0<=x<2**64 for x in metadata[:7]) and
            -2**63<=metadata[7]<2**63 and stat.S_ISREG(metadata[2]) and
            metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'] and type(row['bytes']) is int,'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444;need(stat.S_IMODE(metadata[2])==mode,'strict independent stage file mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent staged file content identity')
        if name=='node':need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],'staged ELF/install finite file identity')
        else:need(row['prefix']==record_raw[:4].hex(),'observed original record prefix joins retained bytes')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==['/','/run',str(NODE_STAGE_ROOT)],'fixed readonly stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before'];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63 and
            stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and (index!=2 or stat.S_IMODE(info[2])==0o555),'root nonwritable stage ancestor original')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite staged directory inode join')
    return {'schema':'bw.ring3.staged-node-admission.v2','stagedNodeObserved':True,'runtimeCandidate':False,'qualified':False,'sourceHead':request['head']}


class StagedInventoryFiles(InventoryFiles):
    """Only the explicitly selected empty Python source has a zero-extent role."""
    def empty_python(self,path):
        need(path in STAGED_EMPTY_PYTHON_SOURCES,'fixed typed empty Python-source role/path')
        fd=None;first=None;row={'path':path,'namedBefore':None,'heldBefore':None,'heldAfter':None,'namedAfter':None,
            'bytesRead':0,'readHex':None,'eof':None,'sha256':None,'closeAttempted':False,'closeSucceeded':False,'firstFailure':None,'secondary':[]}
        try:
            need(str(Path(path).resolve(strict=True))==path,'canonical typed empty Python source')
            row['namedBefore']=setup_metadata(os.stat(path,follow_symlinks=False))
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);row['heldBefore']=setup_metadata(os.fstat(fd));info=row['heldBefore']
            need(info==row['namedBefore'] and stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o644 and info[3:5]==[0,0] and
                info[5]==1 and info[6]==0,'root0644 zero-extent typed Python source')
            raw=os.read(fd,1);row.update(bytesRead=len(raw),readHex=raw.hex(),eof=raw==b'',sha256=sha(raw))
            need(raw==b'','typed empty Python-source held EOF')
            row['heldAfter']=setup_metadata(os.fstat(fd));row['namedAfter']=setup_metadata(os.stat(path,follow_symlinks=False))
            need(info==row['heldAfter']==row['namedAfter'] and str(Path(path).resolve(strict=True))==path,'typed empty source held/named readback')
        except BaseException as error:first=error
        finally:
            if first is not None:
                for name,observe in (('heldAfter',lambda:os.fstat(fd)),('namedAfter',lambda:os.stat(path,follow_symlinks=False))):
                    if name=='heldAfter' and fd is None:continue
                    try:row[name]=setup_metadata(observe())
                    except BaseException as error:
                        first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'typed-empty-readback','name':type(error).__name__,'message':str(error)}]
            if fd is not None:
                row['closeAttempted']=True
                try:os.close(fd);row['closeSucceeded']=True
                except BaseException as error:
                    if first is None:first=error
                    else:first.setup_secondary=getattr(first,'setup_secondary',[])+[{'phase':'typed-empty-close','name':type(error).__name__,'message':str(error)}]
        if first is not None:
            row['firstFailure']={'phase':'typed-empty-python','name':type(first).__name__,'message':str(first)}
            row['secondary']=list(getattr(first,'setup_secondary',[]));first.empty_python_original=row;raise first
        return row


def verify_staged_empty_python(rows):
    keys(rows,'before after')
    expected_path=next(iter(STAGED_EMPTY_PYTHON_SOURCES));previous=None
    for row in rows.values():
        keys(row,'path namedBefore heldBefore heldAfter namedAfter bytesRead readHex eof sha256 closeAttempted closeSucceeded firstFailure secondary')
        need(row['path']==expected_path and type(row['bytesRead']) is int and row['bytesRead']==0 and row['readHex']=='' and row['eof'] is True and
            row['sha256']==STAGED_EMPTY_PYTHON_SOURCES[expected_path]['sha256'] and row['closeAttempted'] is True and row['closeSucceeded'] is True and
            row['firstFailure'] is None and row['secondary']==[],'complete typed empty source EOF/hash/close observations')
        info=row['heldBefore'];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
            all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63 and info[2]==0o100644 and info[3:5]==[0,0] and
            info[5]==1 and info[6]==0 and all(equal(row[key],info) for key in ('namedBefore','heldAfter','namedAfter')),'strict typed empty source four raw stat joins')
        need(previous is None or equal(previous,info),'same typed empty source before/after inventory');previous=info


class StagedRuntimeInventory(RuntimeInventory):
    NODE_PATH=NODE_STAGE_TARGET

    def __init__(self,stage_node,files=None,probe=None):
        super().__init__(StagedInventoryFiles() if files is None else files,probe)
        self.stage_node=tuple(parse(canonical(stage_node)));self.empty_originals={};self.staged_attempted=False

    def add(self,path,kind):
        resolved,_=self.ops.resolve(runtime_path(path))
        if resolved in STAGED_EMPTY_PYTHON_SOURCES:
            need(kind=='python-stdlib' and resolved==path,'typed empty source only in fixed Python role, without alias substitution')
            return resolved
        need(len(self.files)+len(STAGED_EMPTY_PYTHON_SOURCES)+(0 if resolved in self.files else 1)<=512,'shared positive and typed-empty inventory file cap')
        result=super().add(path,kind)
        mode=self.files[result]['mode'];need(type(mode) is int and 0<=mode<=0o777 and mode&0o022==0,
            'staged inventory executable/file permission guard before metadata tools')
        if kind=='node-binary':
            need(result==NODE_STAGE_TARGET and equal(self.ops.metadata[result],list(self.stage_node)) and self.files[result]['mode']==0o555 and
                self.ops.metadata[result][3:5]==[0,0],'independent staged Node owner/mode/identity before tools')
        return result

    def candidate(self,value):
        need(set(STAGED_EMPTY_PYTHON_SOURCES)<=set(self.partial['pythonFiles']),'typed empty source remains in actual Python census')
        return dict(value,schema='bw.ring3.runtime-expectation.v2',emptyPythonSources=parse(canonical(STAGED_EMPTY_PYTHON_SOURCES)))

    def validate_candidate(self,raw):return staged_runtime_expectation(raw,sha(raw))

    def empty_read(self,when):
        try:self.empty_originals[when]=self.ops.empty_python(next(iter(STAGED_EMPTY_PYTHON_SOURCES)))
        except BaseException as error:
            self.empty_originals[when]=getattr(error,'empty_python_original',None);raise

    def discover(self):
        need(not self.staged_attempted,'staged inventory consumed; no retry');self.staged_attempted=True
        self.partial={'emptyPythonSources':self.empty_originals}
        try:
            self.empty_read('before')  # Mandatory known source is admitted before every metadata tool.
            raw=super().discover();self.empty_read('after');verify_staged_empty_python(self.empty_originals);return raw
        finally:self.partial['emptyPythonSources']=self.empty_originals


def staged_runtime_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.staged-runtime-inventory-original.v1','stageBefore':None,'stageAfter':None,'parent':None,
        'inventory':None,'candidate':None,'firstFailure':None,'secondary':[],'publicationSafe':False};originals={};inventory=None
    def failed(error,phase):
        error_row=getattr(error,'inventory_first',{'phase':phase,'name':type(error).__name__,'message':str(error)})
        if value['firstFailure'] is None:value['firstFailure']=error_row
        else:value['secondary'].append(error_row)
        value['secondary'].extend(getattr(error,'setup_secondary',[]));value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    try:
        before=observe_staged_inventory_stage(environ);value['stageBefore']=before;value['publicationSafe']=before['publicationSafe']
        if before['firstFailure'] is not None:
            error=Refusal(before['firstFailure']['message']);error.inventory_first=before['firstFailure'];error.inventory_secondary=before['secondary'];raise error
        need(before['stageObserved'] is True,'complete independent staged Node observation before metadata tools')
        record=parse(prerequisite_original(canonical(before['record'])))
        originals['staged.request.json']=prerequisite_original(canonical(record['request']))
        originals['staged.event.json']=prerequisite_original(canonical(record['event']))
        value['parent']=inventory_parent_availability()
        inventory=StagedRuntimeInventory(before['files']['node']['before'],files,probe)
        candidate=inventory.discover();value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:failed(error,'staged-runtime-inventory')
    finally:
        if inventory is not None:
            value['inventory']=inventory.partial
            rejected=getattr(inventory.ops,'rejected',{})
            if rejected:value['inventory']['rejectedFiles']=rejected
        if value['stageBefore'] is not None and value['stageBefore']['stageObserved']:
            after=observe_staged_inventory_stage(environ);value['stageAfter']=after
            if after['firstFailure'] is not None:
                error=Refusal(after['firstFailure']['message']);error.inventory_first=after['firstFailure'];error.inventory_secondary=after['secondary'];failed(error,'staged-after')
            elif not all(equal(after[key],value['stageBefore'][key]) for key in ('record','files','directories','source')):
                failed(Refusal('staged source/input/file changed across complete inventory'),'staged-after')
    raw=canonical(value)
    if len(raw)>1<<20:
        error={'phase':'staged-inventory-original-cap','name':'Refusal','message':'unchanged staged inventory original JSON cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.staged-runtime-inventory-overflow.v1','firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.staged-inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[],value['publicationSafe']


def verify_staged_runtime_inventory_log(raw,external):
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 invoker')
    need(external['schema']=='bw.ring3.staged-inventory-expectation.v1' and type(external['attempt']) is int and external['attempt']==1 and
        external['jobName']=='staged-runtime-inventory' and external['conclusion']=='success','independently admitted official staged inventory job')
    integer(external['jobId'],1);need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),'official staged inventory run')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),('requestSha256',64),('logSha256',64)):digest(external[name],size)
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],'independently selected staged inventory log original')
    originals=decode_staged_inventory_log(raw);value=parse(originals['runtime.staged-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe')
    need(value['schema']=='bw.ring3.staged-runtime-inventory-original.v1' and value['firstFailure'] is None and value['secondary']==[] and
        value['publicationSafe'] is True,'complete failure-free staged runtime inventory original')
    for stage in (value['stageBefore'],value['stageAfter']):
        stage_raw=canonical(stage);expected={'schema':'bw.ring3.staged-node-expectation.v2','requestSha256':external['requestSha256'],
            'head':external['head'],'tree':external['tree'],'runId':int(external['runId']),'workflowSha':external['workflowSha'],
            'invoker':external['invoker'],'observation':{'bytes':len(stage_raw),'sha256':sha(stage_raw)}}
        verify_staged_inventory_stage(stage_raw,expected)
    before,after=value['stageBefore'],value['stageAfter']
    need(all(equal(before[key],after[key]) for key in ('record','files','directories','source')),'same staged source/files before and after every metadata tool')
    record=parse(prerequisite_original(canonical(before['record'])))
    request_raw=prerequisite_original(canonical(record['request']));request,source=staged_runtime_request(request_raw,external['requestSha256'])
    need(request_raw==originals['staged.request.json'] and prerequisite_original(canonical(record['event']))==originals['staged.event.json'] and
        source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],'exact raw request/event/source/workflow joins, without projected originals')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and all(type(x) is int for x in parent['meta']) and
        all(0<=x<2**64 for x in parent['meta'][:7]) and -2**63<=parent['meta'][7]<2**63 and stat.S_ISDIR(parent['meta'][2]) and parent['meta'][3:5]==[0,0] and
        parent['meta'][2]&0o022==0 and set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},'readonly original shared parent availability')
    for row in parent['controls'].values():
        keys(row,'meta raw');need(type(row['meta']) is list and len(row['meta'])==8 and all(type(x) is int for x in row['meta']) and
            all(0<=x<2**64 for x in row['meta'][:7]) and -2**63<=row['meta'][7]<2**63 and stat.S_ISREG(row['meta'][2]) and row['meta'][3:5]==[0,0] and
            row['meta'][2]&0o022==0 and type(row['raw']) is str and len(row['raw'].encode('ascii'))<=4096,'bounded root-owned parent control observation')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful parent availability, never parent mutation')
    result=verify_staged_inventory_graph(value)
    need(equal(value['inventory']['fileMetadata'][NODE_STAGE_TARGET],after['files']['node']['before']),'inventory Node observation joins independent staged inode/owner/mode/hash')
    need(all(entry['process']['parentPid']==before['identity']['pid'] for entry in value['inventory']['processes']),
        'all eleven actual metadata child processes descend from the dropped staged observer')
    need(all(entry['process']['spawnMonoNs']>=record['sourceCommands'][-1]['process']['reapMonoNs'] for entry in value['inventory']['processes']),
        'metadata probe windows follow root source admission on the same monotonic clock')
    return dict(result,schema='bw.ring3.staged-runtime-inventory-admission.v1',candidateReviewed=False,actualRunApproved=False,
        parentControllersAlreadyEnabled=enabled,selectedBoundary='staged executable/tool/package and selected Python superset, including typed empty source')



def verify_staged_inventory_graph(value):
    candidate_raw=prerequisite_original(canonical(value['candidate']));candidate=staged_runtime_expectation(candidate_raw,sha(candidate_raw))
    inventory=value['inventory'];keys(inventory,'files aliases probes processes fileMetadata pythonFiles mappedLibraries mapsOriginal candidate emptyPythonSources')
    need(equal(inventory['files'],candidate['files']) and equal(inventory['aliases'],candidate['aliases']) and
         equal(inventory['candidate'],value['candidate']),'exact separately retained inventory candidate facts')
    need(type(inventory['fileMetadata']) is dict and set(inventory['fileMetadata'])==set(candidate['files']),'complete actual inventory file metadata')
    python_files=inventory['pythonFiles'];need(type(python_files) is list and len(python_files)<=256 and python_files==sorted(set(python_files)) and
        all((path in candidate['files'] and candidate['files'][path]['kind']=='python-stdlib') or path in candidate['emptyPythonSources'] for path in python_files) and set(candidate['emptyPythonSources'])<=set(python_files),'retained selected Python file superset census')
    maps_raw=prerequisite_original(canonical(inventory['mapsOriginal']));need(len(maps_raw)<=65536,'held raw Python maps original cap')
    mapped=set()
    for line in maps_raw.decode().splitlines():
        fields=line.split(None,5)
        if len(fields)<6 or not fields[5].startswith('/'):continue
        path=fields[5];need(not path.endswith(' (deleted)'),'retained map paths not deleted')
        if '.so' in Path(path).name or Path(path).name.startswith('ld-'):mapped.add(runtime_path(path))
    need(len(mapped)<=128 and inventory['mappedLibraries']==sorted(mapped) and
        all(resolve_alias(path,candidate['aliases']) in candidate['files'] for path in mapped),'independent raw mapped-library/selected graph join')
    for path,metadata in inventory['fileMetadata'].items():
        row=candidate['files'][path]
        need(type(metadata) is list and len(metadata)==8 and all(type(x) is int for x in metadata) and all(0<=x<2**64 for x in metadata[:7]) and -2**63<=metadata[7]<2**63 and metadata[0]>0 and metadata[1]>0 and
            stat.S_ISREG(metadata[2]) and stat.S_IMODE(metadata[2])==row['mode'] and metadata[6]==row['bytes'],'inventory file original mode/extent')
    qemu=next(row for row in candidate['packages'] if row['name']=='qemu-system-x86')
    runtime_original={'schema':'bw.ring3.runtime.v2','observationPolicy':'prelaunch-probes-and-before-after-file-readback','platform':candidate['platform'],
        'executables':candidate['executables'],'versions':candidate['versions'],'qemuPackage':{'name':qemu['name'],'version':qemu['version'],'architecture':qemu['architecture'],
        'files':{path:{key:row[key] for key in ('bytes','sha256','kind')} for path,row in candidate['files'].items()},'aliases':candidate['aliases'],'probes':inventory['probes']}}
    verify_staged_runtime_stable_original(runtime_original,candidate_raw,sha(candidate_raw))
    processes=inventory['processes'];need(type(processes) is list and len(processes)==11,'complete exact metadata probe process originals')
    probe_by_role={probe['role']:probe for probe in inventory['probes']};seen=set();last=0;parent_pid=None
    for entry in processes:
        keys(entry,'role process stdout stderr');role=entry['role'];need(role in probe_by_role and role not in seen,'unique inventory process probe role');seen.add(role)
        process=entry['process'];keys(process,'schema argv environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
        probe=probe_by_role[role]
        need(process['schema']=='bw.ring3.inventory-process.v1' and equal(process['argv'],probe['argv']) and equal(process['environment'],probe['environment']) and
            type(process['exitCode']) is int and process['exitCode']==0 and integer(process['waitStatus'],0,65535)==0 and process['signal'] is None and
            process['timedOut'] is False and process['firstFailure'] is None and process['secondary']==[],'complete fixed successful metadata probe process')
        pid=integer(process['pid'],1);need(integer(process['pgid'],1)==pid and integer(process['parentPid'],1)!=pid,'fresh metadata process session')
        integer(process['startTicks'],1)
        if parent_pid is None:parent_pid=process['parentPid']
        need(process['parentPid']==parent_pid,'one independent inventory parent')
        start=integer(process['spawnMonoNs'],last);end=integer(process['reapMonoNs'],start);need(end-start<=10000000000,'finite ordered metadata probe windows');last=end
        keys(process['rusage'],'userSeconds systemSeconds maxRssKiB')
        for name in ('userSeconds','systemSeconds'):need(type(process['rusage'][name]) in (int,float) and 0<=process['rusage'][name]<=10,'bounded original inventory process usage')
        integer(process['rusage']['maxRssKiB'],0,1048576)
        need(prerequisite_original(canonical(entry['stdout']))==probe['stdout'].encode('utf-8','surrogateescape') and
             prerequisite_original(canonical(entry['stderr']))==probe['stderr'].encode('utf-8','surrogateescape'),'exact raw metadata probe stream/process join')
    verify_staged_empty_python(inventory['emptyPythonSources'])
    return {'candidateSha256':sha(candidate_raw),'candidateBytes':len(candidate_raw)}



def emit_staged_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<={'staged.request.json','staged.event.json','runtime.staged-inventory.json'} and
         all(type(raw) is bytes and len(raw)<=1<<20 for raw in originals.values()) and sum(map(len,originals.values()))<=5<<20,'bounded distinct inventory originals')
    encoded_bytes=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072);need(count<=456,'finite inventory chunks')
        for index in range(count):
            line=b'RING3_STAGED_RUNTIME_INVENTORY '+canonical({'schema':'bw.ring3.staged-runtime-inventory-log.v1','name':name,'index':index,'count':count,
                'bytes':len(raw),'sha256':sha(raw),'data':encoded[index*3072:(index+1)*3072]})
            need(encoded_bytes+len(line)<=8<<20 and chunks<2600,'held encoded inventory log cap')
            written=emit(line);need(type(written) is int and written==len(line),'complete immutable inventory log chunk')
            encoded_bytes+=len(line);chunks+=1
    flush()


def decode_staged_inventory_log(raw):
    need(type(raw) is bytes and len(raw)<=8<<20,'bounded runtime inventory official log original')
    groups={};chunks=0
    for line in raw.splitlines():
        marker=b'RING3_STAGED_RUNTIME_INVENTORY ';offset=line.find(marker)
        if offset<0:continue
        prefix=line[:offset];need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),'canonical inventory log timestamp')
        value=parse(line[offset+len(marker):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.staged-runtime-inventory-log.v1' and value['name'] in
            ('staged.request.json','staged.event.json','runtime.staged-inventory.json'),'exact inventory log version/roles')
        count=integer(value['count'],1,456);index=integer(value['index'],0,count-1);extent=integer(value['bytes'],0,1<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded inventory original chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and index==len(group['parts']),
             'one ordered immutable inventory original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<=2600,'held finite inventory chunk count')
    need(set(groups)=={'staged.request.json','staged.event.json','runtime.staged-inventory.json'},'three complete independent inventory originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete inventory original chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and sha(value)==group['sha256'],'exact inventory original encoding/bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=5<<20,'unchanged inventory raw aggregate cap')
    return originals


def main():
    if '--inventory-staged-runtime' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-staged-runtime'],'exact single staged inventory mode')
        need(STAGED_RUNTIME_INVENTORY_ENABLED is True,'staged runtime inventory disabled pending separate source/event review')
        originals,passed,safe=staged_runtime_inventory_entry(dict(os.environ))
        if safe:emit_staged_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush)
        raise SystemExit(0 if passed and safe else 1)
    if sys.argv[1:2]==['--staged-runtime-inventory-log']:
        parser=argparse.ArgumentParser(description='Independent original-only staged runtime inventory admission',allow_abbrev=False)
        parser.add_argument('--staged-runtime-inventory-log',required=True);parser.add_argument('--external-admission',required=True)
        need(len(sys.argv)==5 and sys.argv.count('--staged-runtime-inventory-log')==sys.argv.count('--external-admission')==1,'exact staged inventory audit inputs')
        args=parser.parse_args()
        with Path(args.staged_runtime_inventory_log).open('rb') as stream:raw=stream.read((8<<20)+1)
        with Path(args.external_admission).open('rb') as stream:external=parse(stream.read((1<<20)+1))
        print(json.dumps(verify_staged_runtime_inventory_log(raw,external),sort_keys=True));return
    if sys.argv[1:2]==['--node-stage-observation']:
        parser=argparse.ArgumentParser(description='Independent retained Node-stage observation audit',allow_abbrev=False)
        parser.add_argument('--node-stage-observation',required=True);parser.add_argument('--stage-expected',required=True)
        need(len(sys.argv)==5 and sys.argv.count('--node-stage-observation')==sys.argv.count('--stage-expected')==1,'exact stage audit inputs')
        args=parser.parse_args()
        with Path(args.node_stage_observation).open('rb') as stream:raw=stream.read((1<<20)+1)
        with Path(args.stage_expected).open('rb') as stream:expected=parse(stream.read((1<<20)+1))
        print(json.dumps(verify_node_stage_observation(raw,expected),sort_keys=True));return
    if '--observe-staged-node' in sys.argv[1:]:
        need(sys.argv[1:]==['--observe-staged-node'],'exact single stage observer mode')
        need(NODE_STAGE_OBSERVER_ENABLED is True,'Node-stage observer disabled pending separate source/event review')
        value=observe_staged_node(dict(os.environ));raw=canonical(value)
        need(len(raw)<=1<<20 and sys.stdout.buffer.write(raw)==len(raw),'bounded dropped staged observation original');sys.stdout.buffer.flush()
        raise SystemExit(1)
    internal={'--observe-hosted-setup','--admit-hosted-prerequisites','--admit-hosted-runtime'}
    if any(flag in internal for flag in sys.argv[1:]) and (len(sys.argv)!=2 or sys.argv[1] not in internal):
        raise Refusal('exactly one fixed internal prerequisite mode required')
    if '--inventory-runtime' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-runtime'],'exact single metadata inventory mode')
        need(INVENTORY_ENTRY_ENABLED is True,'metadata inventory disabled pending separate source/event review')
        originals,passed=runtime_inventory_entry(dict(os.environ))
        emit_runtime_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush);raise SystemExit(0 if passed else 1)
    if sys.argv[1:2]==['--runtime-inventory-log']:
        parser=argparse.ArgumentParser(description='Original-only independent runtime inventory audit',allow_abbrev=False)
        parser.add_argument('--runtime-inventory-log',required=True);parser.add_argument('--external-admission',required=True);args=parser.parse_args()
        with Path(args.runtime_inventory_log).open('rb') as stream:raw=stream.read((8<<20)+1)
        with Path(args.external_admission).open('rb') as stream:external=parse(stream.read((1<<20)+1))
        print(json.dumps(verify_runtime_inventory_log(raw,external),sort_keys=True));return
    if sys.argv[1:]==['--observe-hosted-setup']:
        raw,passed=observe_hosted_setup(dict(os.environ))
        need(sys.stdout.buffer.write(raw)==len(raw),'complete observer original stdout');sys.stdout.buffer.flush()
        raise SystemExit(0 if passed else 1)
    if sys.argv[1:]==['--admit-hosted-prerequisites']:
        result=admit_hosted_prerequisites(dict(os.environ));raw=canonical(result)
        need(sys.stdout.buffer.write(raw)==len(raw),'complete prerequisite reader verdict');sys.stdout.buffer.flush();return
    if sys.argv[1:]==['--admit-hosted-runtime']:
        result=admit_hosted_runtime(dict(os.environ));raw=canonical(result)
        need(len(raw)<=16384 and sys.stdout.buffer.write(raw)==len(raw),'bounded complete independent V8 reader verdict');sys.stdout.buffer.flush();return
    if sys.argv[1:2]==['--execution-log']:
        parser=argparse.ArgumentParser(description='Independent official V8 original admission',allow_abbrev=False)
        parser.add_argument('--execution-log',required=True);parser.add_argument('--artifact',required=True);parser.add_argument('--external-admission',required=True);args=parser.parse_args()
        with Path(args.execution_log).open('rb') as stream:log=stream.read((8<<20)+1)
        with Path(args.artifact).open('rb') as stream:artifact=stream.read(CAPS['packetBytes']+1)
        with Path(args.external_admission).open('rb') as stream:external=parse(stream.read(CAPS['jsonBytes']+1))
        print(json.dumps(verify_v8_artifact(log,artifact,external),sort_keys=True));return
    if sys.argv[1:2]==['--prerequisite-log']:
        parser=argparse.ArgumentParser(description='Original-only prerequisite observation admission',allow_abbrev=False)
        parser.add_argument('--prerequisite-log',required=True);parser.add_argument('--external-admission',required=True)
        args=parser.parse_args()
        with Path(args.prerequisite_log).open('rb') as stream:raw=stream.read((8<<20)+1)
        with Path(args.external_admission).open('rb') as stream:expected=parse(stream.read((1<<20)+1))
        print(json.dumps(verify_prerequisite_log(raw,expected),sort_keys=True));return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--external-admission', required=True)
    args = parser.parse_args()
    # Read at most the admitted cap plus one; refuse instead of allocating an
    # arbitrarily large original. Inputs are retained originals, never replayed.
    with Path(args.artifact).open('rb') as stream: raw = stream.read(CAPS['packetBytes']+1)
    with Path(args.external_admission).open('rb') as stream: external = parse(stream.read(CAPS['jsonBytes']+1))
    print(json.dumps(verify_artifact(raw, external), sort_keys=True))


if __name__ == '__main__':
    main()
