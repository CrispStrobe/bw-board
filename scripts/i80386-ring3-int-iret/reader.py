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
import zlib
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


def parse_setup_v4_outer(value):
    """Only the new combined setup/runtime or failed-entry packet has a 4 MiB cap."""
    need(type(value) is bytes and 0<len(value)<=4<<20,'versioned v4 outer JSON byte cap')
    def unique(pairs):
        result={}
        for key,item in pairs:
            need(key not in result,'duplicate v4 outer JSON key')
            result[key]=item
        return result
    def finite(token):
        value=float(token)
        need(math.isfinite(value),'nonfinite v4 outer JSON number')
        return value
    return json.loads(value.decode('utf-8'),object_pairs_hook=unique,parse_float=finite,
                      parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite v4 outer JSON')))


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

# Independent selected setup constants. These archive rows are signed index
# selections, not a claim that their payload, scripts, or setup are admitted.
SETUP_V4_READER_ENABLED=True  # V4 metadata only; no guest approval.
SETUP_V4_PACKAGES=(
    ('ipxe-qemu','1.21.1+git-20220113.fbbdc3926-0ubuntu2','all','pool/main/i/ipxe/ipxe-qemu_1.21.1+git-20220113.fbbdc3926-0ubuntu2_all.deb',1564600,'1f1612934b6ddaf4dd633760dfe5ef2a79ea2507341fd5efe394ff589a044707'),
    ('libbrlapi0.8','6.6-4ubuntu5','amd64','pool/main/b/brltty/libbrlapi0.8_6.6-4ubuntu5_amd64.deb',31388,'82272b3090c912e45d92ff7ed200de289c47e504513559377a6f6c5a372cbcf5'),
    ('libcacard0','1:2.8.0-3build4','amd64','pool/main/libc/libcacard/libcacard0_2.8.0-3build4_amd64.deb',36546,'7a75de14b0fdff2828a3d218a49e7fe4da2df533185ba9ccbabd0647db05e33c'),
    ('libdaxctl1','77-2ubuntu2','amd64','pool/main/n/ndctl/libdaxctl1_77-2ubuntu2_amd64.deb',21404,'c6629b49c79343fb11ae404aeaa3156f051168da6c6d3d9d8d516acd94705061'),
    ('libfdt1','1.7.0-2build1','amd64','pool/main/d/device-tree-compiler/libfdt1_1.7.0-2build1_amd64.deb',20128,'274d20dfab9d6b216b5de85446a93f6ce5b2cd82c847b8dfdc508577f76eb96a'),
    ('libndctl6','77-2ubuntu2','amd64','pool/main/n/ndctl/libndctl6_77-2ubuntu2_amd64.deb',62750,'4eab53588a8fa9e3192635e118c2d91bc069cde46a4a3785c77a0bb1ae001d02'),
    ('libpcsclite1','2.0.3-1build1','amd64','pool/main/p/pcsc-lite/libpcsclite1_2.0.3-1build1_amd64.deb',21432,'703bacc9204a7ecc24486ac8c96d15d0b9e2c91c385388e132ad4fd8f56f035a'),
    ('libpmem1','1.13.1-1.1ubuntu2','amd64','pool/main/p/pmdk/libpmem1_1.13.1-1.1ubuntu2_amd64.deb',84760,'8f1be1cc834a98f0cf5c0950153f7f939a0c2c92095e98cd7bb40c752c545c1b'),
    ('librdmacm1t64','50.0-2ubuntu0.2','amd64','pool/main/r/rdma-core/librdmacm1t64_50.0-2ubuntu0.2_amd64.deb',70698,'7b7cc2fa16564bf301751b43d05d16f0846288b080d9a25a92a691d0df33fc68'),
    ('liburing2','2.5-1build1','amd64','pool/main/libu/liburing/liburing2_2.5-1build1_amd64.deb',21092,'c2aef62accee92a06263c3ad4ef46132c13e409b54296c44792a20491830a7b0'),
    ('libusbredirparser1t64','0.13.0-2.1build1','amd64','pool/main/u/usbredir/libusbredirparser1t64_0.13.0-2.1build1_amd64.deb',16508,'78be9176f05512bcac369fcada499686b1dd34320965d27e3405c7aacbc4e461'),
    ('qemu-system-common','1:8.2.2+ds-0ubuntu1.18','amd64','pool/main/q/qemu/qemu-system-common_8.2.2+ds-0ubuntu1.18_amd64.deb',1255316,'0a0b744f31e87d72dd0465436b8dfbb1ef9f574ecd0d5a2e9dd8c5cb7d0fef1f'),
    ('qemu-system-data','1:8.2.2+ds-0ubuntu1.18','all','pool/main/q/qemu/qemu-system-data_8.2.2+ds-0ubuntu1.18_all.deb',1796342,'a14b88d864859bd61c8a3274971da4ecb7da6cec15be6c265d0d411f783d5f2e'),
    ('qemu-system-x86','1:8.2.2+ds-0ubuntu1.18','amd64','pool/main/q/qemu/qemu-system-x86_8.2.2+ds-0ubuntu1.18_amd64.deb',11222476,'14602e262627adac030329d2cecfee5f6c0938b34566ff2ea2d4c9a9eb02430d'),
    ('seabios','1.16.3-2','all','pool/main/s/seabios/seabios_1.16.3-2_all.deb',174648,'cac4e59a66c834d19cae751c22ab3a0391c22f78010fd11aa2e3fe630e6bc0e0'),
)
SETUP_V4_ORDER=('ipxe-qemu','libbrlapi0.8','libdaxctl1','libfdt1','libndctl6','libpcsclite1',
    'libcacard0','libpmem1','librdmacm1t64','liburing2','libusbredirparser1t64','qemu-system-common',
    'qemu-system-data','seabios','qemu-system-x86')
SETUP_V4_STATUS_SHA='4144e0299e81507b7a856beef9fe6e67f55bffd0c0d7e9245265b6920721d1ac'
SETUP_V4_STATUS_BYTES=1231069
SETUP_V4_HELPERS={
    '/usr/bin/dash':'86d31f6fb799e91fa21bad341484564510ca287703a16e9e46c53338776f4f42',
    '/usr/bin/deb-systemd-helper':'a895d5f077651960b6ca4ed9c53f8b36eae422ae170f61c972d0c6579e9f8732',
    '/usr/bin/deb-systemd-invoke':'92eadae89f4df4cd6088f6316f5390b685faf8d0e312a4e5af3a507caaf81bdb',
    '/usr/bin/dpkg-maintscript-helper':'c1ebe2d1281240872a38dd16dcaea57d48a66978f500eeeca58689ae006ca342',
    '/usr/bin/systemctl':'e0d3d0e9444da1b2b58c792c3f5028b69f049b77d5ca17b3ec0d09f89117225b',
    '/usr/sbin/invoke-rc.d':'1d389fa6f6297e77b2ba1d2df4a6ec60f4d4d37815b727889f38ba602e713f77',
    '/usr/sbin/update-rc.d':'9a85792c1ee2714d34ad2f0dac9becd987cbaedbfe25519dede7378e6c9ebbf1',
}
SETUP_V4_HELPER_ALIASES={
    '/bin':{'linkText':'usr/bin','target':'/usr/bin','uid':0,'gid':0,'nlink':1,'size':7},
    '/bin/sh':{'linkText':'dash','target':'/usr/bin/dash','uid':0,'gid':0,'nlink':1,'size':4},
    '/usr/bin/sh':{'linkText':'dash','target':'/usr/bin/dash','uid':0,'gid':0,'nlink':1,'size':4},
}
SETUP_V4_PAYLOAD_PINS={
    "schema": "bw.ring3.payload-witness.v4",
    "archives": [
        {
            "archiveBytes": 1564600,
            "archiveSha256": "1f1612934b6ddaf4dd633760dfe5ef2a79ea2507341fd5efe394ff589a044707",
            "controlTarSha256": "dab36b7d2d625339a111a2a32163faa626a96dbce1c4efac2b1ad0b18e4683e5",
            "dataTarSha256": "78d92626f8446145eec7a7f81a1d33448f86a6a1e51992458cb4757f3b56ad78",
            "package": "ipxe-qemu",
            "payloadManifestSha256": "655a1a4df62bc5265e2c7b29748d81d6d8aebad784e7a5d13ea2d309653db0c8",
        },
        {
            "archiveBytes": 31388,
            "archiveSha256": "82272b3090c912e45d92ff7ed200de289c47e504513559377a6f6c5a372cbcf5",
            "controlTarSha256": "64b072d12f5c89d9d9d975dca14997403dce5c5be4d6c1ca57030e4a22be128d",
            "dataTarSha256": "787d1c1b6e0fbf10f550662aa826c83835347edd172ee966cd4989e881abf964",
            "package": "libbrlapi0.8",
            "payloadManifestSha256": "4708788e9020dbc95447b4944267f1e8fe74f0a5650679c3d135e0d133c5f570",
        },
        {
            "archiveBytes": 36546,
            "archiveSha256": "7a75de14b0fdff2828a3d218a49e7fe4da2df533185ba9ccbabd0647db05e33c",
            "controlTarSha256": "c28f041eb4f9e07e54a0ccd60253051a3aa7505c27189fb8da7414ba73c0b980",
            "dataTarSha256": "7bbc7221f79a7dcddfc13b5dbc52aaa0a7852713b6ada4eb244f3d3aa98a59ad",
            "package": "libcacard0",
            "payloadManifestSha256": "4fed6f8f8f0d09f108b1a7f1e4c6b3b6480c285b6653ef8ab426541ba6bf8c8e",
        },
        {
            "archiveBytes": 21404,
            "archiveSha256": "c6629b49c79343fb11ae404aeaa3156f051168da6c6d3d9d8d516acd94705061",
            "controlTarSha256": "84787ea776d2ede6c0aad1c0d5d01f532bbfe60eccd9005a2db888db214c1c88",
            "dataTarSha256": "eec937d78d1fd00ff35cf9ec29b9db0930028add643815744fcc7871ea85afa3",
            "package": "libdaxctl1",
            "payloadManifestSha256": "388317ba7a8850b63f970a0e3a36222f7e94947b0c981f202b1df7bf0d38245f",
        },
        {
            "archiveBytes": 20128,
            "archiveSha256": "274d20dfab9d6b216b5de85446a93f6ce5b2cd82c847b8dfdc508577f76eb96a",
            "controlTarSha256": "c469ca21115054841124298fb0f94371462b860cfef20fb8c3c4cc7fa9186c93",
            "dataTarSha256": "647fcd0c67ae844c87ff136b809e9926477415a7ca86360ebbd9db4949275d8b",
            "package": "libfdt1",
            "payloadManifestSha256": "a34628593b28b485cdf465c36102c3a286b3cd16c9cc4679109b6aab2ab75655",
        },
        {
            "archiveBytes": 62750,
            "archiveSha256": "4eab53588a8fa9e3192635e118c2d91bc069cde46a4a3785c77a0bb1ae001d02",
            "controlTarSha256": "64a0e99c561dbb79ea7d617bf1c2e21be4fafd21e00048b64182180d3ba2e458",
            "dataTarSha256": "9fac446798a263f0d5ee6d5bf8f0294b936cb723ad9c2d972ec60fee79ed4add",
            "package": "libndctl6",
            "payloadManifestSha256": "10af631245af973cbdef5b476d2cccd9353367d27d13c1c81bfece16d87fbc28",
        },
        {
            "archiveBytes": 21432,
            "archiveSha256": "703bacc9204a7ecc24486ac8c96d15d0b9e2c91c385388e132ad4fd8f56f035a",
            "controlTarSha256": "5dde8516bdbdb54cfa41fe1039bb8a87140b0a0f3c0d9f5a09371bca977ad437",
            "dataTarSha256": "aeab3c20b84b03db9288cb9b2ffc3931cbdb1cb350b841c89e3c8c98ac8c94cc",
            "package": "libpcsclite1",
            "payloadManifestSha256": "61b9dd7129c1a921b5322460dbb3ba83bf1e60c473fa3f799914273dd7532199",
        },
        {
            "archiveBytes": 84760,
            "archiveSha256": "8f1be1cc834a98f0cf5c0950153f7f939a0c2c92095e98cd7bb40c752c545c1b",
            "controlTarSha256": "61b96efd1923cc39339722d9ac5b9a0227cc0038fdd5fb9686e7dd7ac73e8d98",
            "dataTarSha256": "61fa9b8be78d6f283d0f0b094a5f3ba9076f7c38bd9220245e50c7aa940620a3",
            "package": "libpmem1",
            "payloadManifestSha256": "0867081cb0591d5283f9364abde6e672027232c8152422535a06322a86329d09",
        },
        {
            "archiveBytes": 70698,
            "archiveSha256": "7b7cc2fa16564bf301751b43d05d16f0846288b080d9a25a92a691d0df33fc68",
            "controlTarSha256": "c49b004ba5b87f66043a1a8249d4af9e75281b2266891047b26ab54c58d258d5",
            "dataTarSha256": "65f02da724af8303ced3d962307b660e209583822214a802d8a4060033cff638",
            "package": "librdmacm1t64",
            "payloadManifestSha256": "ea04c2c9a17257eda758fcb2929d13235fa10da80d8e2fb2cc4f20de842dd1f6",
        },
        {
            "archiveBytes": 21092,
            "archiveSha256": "c2aef62accee92a06263c3ad4ef46132c13e409b54296c44792a20491830a7b0",
            "controlTarSha256": "46693ff5877f7840538c422e49d904edd92fbec18c4eb8b426dbc2bcb3f17e79",
            "dataTarSha256": "f8f3760a5330d780c98b7fce9cc8f9b51e810e151ba987a33b994da8b94d3da9",
            "package": "liburing2",
            "payloadManifestSha256": "aca3b66c9e31e14b28a8f1c73aae407f66be2932923023c315c303c2645db2ae",
        },
        {
            "archiveBytes": 16508,
            "archiveSha256": "78be9176f05512bcac369fcada499686b1dd34320965d27e3405c7aacbc4e461",
            "controlTarSha256": "46b146b7e59e97af0e1ccd8cc3ca11a63a8123112c12d07f1e53c65814972832",
            "dataTarSha256": "7e895619747aa440b362e1b0152a5ccc557b30f8b7424a432ce22221e12ce9d4",
            "package": "libusbredirparser1t64",
            "payloadManifestSha256": "6bdec945c45fba7ed980907dac24d03641544336324981c35b8dfa404abf1eaa",
        },
        {
            "archiveBytes": 1255316,
            "archiveSha256": "0a0b744f31e87d72dd0465436b8dfbb1ef9f574ecd0d5a2e9dd8c5cb7d0fef1f",
            "controlTarSha256": "bbb8ed1b6d2e6923cfbcecd020bb72486cfaf05163466cc6736bf13942aa3dd9",
            "dataTarSha256": "08ee4d757a7cfa36502d8d54431b6856acc6c30c3b862f764eb33a27ea3e0043",
            "package": "qemu-system-common",
            "payloadManifestSha256": "b39abb5ed35ca9ce2e856d134952099f465ebc54e835d33d7b61258f3170ecaf",
        },
        {
            "archiveBytes": 1796342,
            "archiveSha256": "a14b88d864859bd61c8a3274971da4ecb7da6cec15be6c265d0d411f783d5f2e",
            "controlTarSha256": "26fc72e009aca88278c225e4449d101a2dc6602915060b7d4e5b30c03c7f1ec0",
            "dataTarSha256": "366faf3142552bf087d80de2eacf711da319e6431f6deb0096472465beb5ac0f",
            "package": "qemu-system-data",
            "payloadManifestSha256": "4941b090a1a1c23ac46be87b095e4dac9d24cc62409c849969a3a33041c9ce3f",
        },
        {
            "archiveBytes": 11222476,
            "archiveSha256": "14602e262627adac030329d2cecfee5f6c0938b34566ff2ea2d4c9a9eb02430d",
            "controlTarSha256": "bf95314245f15035a67b6cf4458d06007614dba2435852624645232824dfa5a5",
            "dataTarSha256": "1d46e5a7343237012ee6c552e268b5622f20b2c2571f598f5935c7ae046be7d9",
            "package": "qemu-system-x86",
            "payloadManifestSha256": "04bcd243a8df3fd5b68ce587c182fe5f060f4400b2668cbcfe5773f725b509c8",
        },
        {
            "archiveBytes": 174648,
            "archiveSha256": "cac4e59a66c834d19cae751c22ab3a0391c22f78010fd11aa2e3fe630e6bc0e0",
            "controlTarSha256": "0215112ef5bd086cfaa1377d70e28921ab15dce20403d3bac81744b4e5e81e54",
            "dataTarSha256": "894464ef264f9872ebd90546f47d7e882929cbfdac2062f99ffe70fcf60776ea",
            "package": "seabios",
            "payloadManifestSha256": "3df2204ba4cd9df355a6e6fce1b006a6be386a471eb2f2fc43cc96e5f906f575",
        },
    ],
    "serviceUnit": {
        "bytes": 367,
        "path": "/usr/lib/systemd/system/qemu-kvm.service",
        "sha256": "da0544deed8c3e9f9f8221c99f5e1ca67135f15f1f3f070767cb8966f705304a",
    },
    "initScript": {
        "bytes": 2496,
        "path": "/usr/share/qemu/init/qemu-kvm-init",
        "sha256": "c769a6a149897575767c5a4377cc7cb15dcbb586a9a1eec1d6248dba098b08f2",
    },
}
SETUP_V4_PLATFORM=tuple('BW_RING3_SETUP_INVENTORY_REQUEST_SHA256' if key=='BW_RING3_NODE_STAGE_REQUEST_SHA256' else key for key in NODE_STAGE_PLATFORM)


def setup_v4_policy():
    return {'imageOS':'ubuntu24','imageVersion':'20261012.334.1',
        'statusSha256':SETUP_V4_STATUS_SHA,
        'helperSha256':SETUP_V4_HELPERS,'helperAliases':SETUP_V4_HELPER_ALIASES,
        'packages':[{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':digest}
            for name,version,arch,filename,size,digest in SETUP_V4_PACKAGES],
        'configureOrder':list(SETUP_V4_ORDER),'unpackOptions':['--no-triggers','--unpack'],
        'configureOptions':['--no-triggers','--configure'],'policyPath':'/usr/sbin/policy-rc.d',
        'policyExit':101,'deferredTriggers':True,'apt':False,'recommends':False,'force':False,
        'upgrade':False,'configurationComplete':False}


def setup_v4_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=1<<20 and digest(pin)==sha(raw),'externally selected v4 request')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage emptyPythonSources setup payloadWitness')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v4','canonical v4 request')
    base={key:value[key] for key in ('repository','pullRequest','head','tree','source','selected','nodeStage','emptyPythonSources')}
    base['schema']='bw.ring3.inventory-request.v3'
    old,source=staged_runtime_request(canonical(base),sha(canonical(base)))
    need(equal(value['setup'],setup_v4_policy()),'exact selected v4 setup policy')
    need(type(SETUP_V4_PAYLOAD_PINS) is dict and len(SETUP_V4_PAYLOAD_PINS['archives'])==15 and
         all((item['package'],item['archiveBytes'],item['archiveSha256'])==(name,size,digest)
             for item,(name,version,arch,filename,size,digest) in
             zip(SETUP_V4_PAYLOAD_PINS['archives'],SETUP_V4_PACKAGES)),
         'independent payload/archive selection join')
    need(SETUP_V4_PAYLOAD_PINS is not None and equal(value['payloadWitness'],SETUP_V4_PAYLOAD_PINS),
         'separately reviewed payload/control witness required')
    return value,source


def setup_v4_event(raw,request,pin,environment):
    event=parse(raw);pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V4\n';end='\nBW_RING3_SETUP_RUNTIME_INVENTORY_V4 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one v4 request block')
    block=body.split(start,1)[1].split(end,1)[0];wrapper=parse(block.encode())
    need(canonical(wrapper).decode().rstrip('\n')==block and prerequisite_original(canonical(wrapper))==canonical(request) and
         wrapper['sha256']==pin,'exact immutable v4 request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-setup-runtime-inventory-v1' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==event['number'] and pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and pr['head']['repo'].get('fork') is False and
         pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'exact owned v4 event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {
        'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'setup-runtime-inventory',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        'BW_RING3_SETUP_INVENTORY_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),
        'exact v4 platform/source joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first v4 run identity');digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


SETUP_V4_STATUS_MARKER=b'RING3_SETUP_STATUS_V4 '


def setup_v4_status_rows(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and b'\r' not in raw and b'\0' not in raw,
         'bounded raw dpkg status')
    result={}
    for paragraph in raw.split(b'\n\n'):
        if not paragraph.strip():continue
        fields={}
        authority=(b'Package',b'Version',b'Architecture',b'Status',b'Triggers-Pending',b'Triggers-Awaited')
        previous_authority=False
        for line in paragraph.splitlines():
            if line.startswith((b' ',b'\t')):
                need(not previous_authority,'folded dpkg authority field refused')
                continue
            key,colon,value=line.partition(b':')
            previous_authority=key in authority
            if previous_authority:
                name=key.decode()
                need(colon==b':' and (not value or value[:1]==b' ') and
                     not value.startswith(b'  ') and name not in fields,
                     'duplicate or malformed dpkg status authority field')
                text=value[1:] if value.startswith(b' ') else value
                need(0<len(text)<=4096,'nonempty bounded dpkg status authority value')
                fields[name]=text.decode('utf-8','strict')
        name,arch=fields.get('Package'),fields.get('Architecture')
        need(all(fields.get(key) for key in ('Package','Version','Architecture','Status')) and
             re.fullmatch('[A-Za-z0-9.+-]+',name) and arch in ('amd64','all') and
             (name,arch) not in result,
             'unique architecture-qualified raw status row')
        result[(name,arch)]=fields
    need(len(result)<=5000,'finite raw status row count')
    return result


def setup_v4_status_delta(before,after):
    selected={(name,arch) for name,version,arch,*_ in SETUP_V4_PACKAGES}
    need(set(after)==set(before)|selected and not(set(before)&selected),
         'only exact fifteen new architecture-qualified packages')
    for key,old in before.items():
        new=after[key]
        need(new['Version']==old['Version'] and
             (new['Status']==old['Status'] if old['Status']!='install ok installed' else
              new['Status'] in ('install ok installed','install ok triggers-pending','install ok triggers-awaited')),
             'no pre-existing package upgrade, removal or deconfiguration')


def setup_v4_cgroup_quiet(procs,events,stat_text,controller=None):
    need(all(type(value) is str and len(value)<=4096 for value in (procs,events,stat_text)),
         'bounded raw owned cgroup census')
    def fields(raw):
        found={}
        for line in raw.splitlines():
            parts=line.split(' ')
            need(len(parts)==2 and re.fullmatch('[a-z_]+',parts[0]) and
                 re.fullmatch('[0-9]+',parts[1]) and parts[0] not in found,
                 'canonical cgroup counter original')
            found[parts[0]]=int(parts[1])
        return found
    stat_rows=fields(stat_text);event_rows=fields(events)
    need({'nr_descendants','nr_dying_descendants'}<=set(stat_rows) and 'populated' in event_rows,
         'explicit nested cgroup and populated originals')
    no_nested=stat_rows['nr_descendants']==0 and stat_rows['nr_dying_descendants']==0
    if controller is None:return procs=='' and no_nested and event_rows['populated']==0
    return procs==str(controller)+'\n' and no_nested and event_rows['populated']==1


def decode_setup_v4_status_log(raw,required_roles=frozenset(('pre','post'))):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded official v4 log for status originals')
    result={}
    for line in raw.splitlines():
        at=line.find(SETUP_V4_STATUS_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical status original log timestamp')
        need(len(line[at:])+1<=1<<20,'one-MiB complete status log frame including LF')
        packet=parse(line[at+len(SETUP_V4_STATUS_MARKER):])
        keys(packet,'schema role rawBytes rawSha256 packedBytes packedSha256 encoding packed')
        role=packet['role'];need(packet['schema']=='bw.ring3.setup-status-original.v4' and
             role in ('pre','post') and role not in result and packet['encoding']=='zlib+base64',
             'one fixed raw pre/post status original')
        size=integer(packet['rawBytes'],1,8<<20);packed_size=integer(packet['packedBytes'],1,700<<10)
        digest(packet['rawSha256']);digest(packet['packedSha256'])
        need(type(packet['packed']) is str and len(packet['packed'])==4*((packed_size+2)//3),
             'exact bounded compressed status encoding')
        packed=base64.b64decode(packet['packed'],validate=True)
        need(base64.b64encode(packed).decode()==packet['packed'] and len(packed)==packed_size and
             sha(packed)==packet['packedSha256'],'exact compressed original bytes')
        decoder=zlib.decompressobj()
        decoded=decoder.decompress(packed,(8<<20)+1)
        need(len(decoded)<=8<<20 and decoder.eof and decoder.unused_data==b'' and
             decoder.unconsumed_tail==b'' and len(decoded)==size and
             sha(decoded)==packet['rawSha256'],
             'complete bounded single zlib stream and raw status SHA')
        result[role]={'raw':decoded,'meta':{'role':role,'bytes':size,'sha256':sha(decoded),
            'packedBytes':packed_size,'packedSha256':sha(packed)}}
    if required_roles is not None:
        need(set(result)==set(required_roles),'exact retained raw dpkg status original roles')
    return result


def setup_v4_facts(value,run_id,controller_pid,source_last_reap):
    keys(value,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    integer(controller_pid,1);integer(source_last_reap,1)
    need(value['schema']=='bw.ring3.setup-original.v4' and value['firstFailure'] is None and value['secondary']==[] and
         value['deferredHostTriggers'] is True and value['configurationComplete'] is False and
         value['nodeStage'] is None and value['runtime'] is None and value['partial'] is None,
         'complete setup facts before Node copy')
    pre=value['preflight'];keys(pre,'imageOS imageVersion statusSha256 statusBytes statusRecords statusOriginal helperSha256 helperAliases resource policyAbsent newPackagesAbsent imageFieldsAuthenticated immutableImageIdentityEstablished')
    need(pre['imageOS']=='ubuntu24' and pre['imageVersion']=='20261012.334.1' and
         pre['statusSha256']==SETUP_V4_STATUS_SHA and
         integer(pre['statusBytes'],1,8<<20)==SETUP_V4_STATUS_BYTES and integer(pre['statusRecords'],1,5000)==1211 and
         equal(pre['helperSha256'],SETUP_V4_HELPERS) and
         equal(pre['helperAliases'],SETUP_V4_HELPER_ALIASES) and
         pre['policyAbsent'] is True and
         pre['newPackagesAbsent'] is True and pre['imageFieldsAuthenticated'] is False and
         pre['immutableImageIdentityEstablished'] is False,'fresh observed selected pre-state, no image-auth claim')
    pre_original=pre['statusOriginal'];keys(pre_original,'role bytes sha256 packedBytes packedSha256')
    need(pre_original['role']=='pre' and pre_original['bytes']==pre['statusBytes'] and
         pre_original['sha256']==pre['statusSha256'] and
         integer(pre_original['packedBytes'],1,700<<10)>0 and
         digest(pre_original['packedSha256']),'held pre-status original summary')
    resource_row=pre['resource'];keys(resource_row,'membership limits')
    need(resource_row['membership']=='0::/system.slice/bw-ring3-setup-v4-'+run_id+'-1.service\n' and
         equal(resource_row['limits'],{'cpuMax':'100000 100000','memoryMax':'1073741824',
             'swapMax':'0','pidsMax':'64'}),'observed fixed outer setup cgroup limits')
    archives=value['archives'];need(type(archives) is list and len(archives)==15,'exact fifteen acquired archives')
    need(sum(row[4] for row in SETUP_V4_PACKAGES)==16400088 and all(row[4]<=12<<20 for row in SETUP_V4_PACKAGES),
         'fixed aggregate/per-archive bytes')
    archive_root='/run/bw-ring3-setup-v4-'+run_id+'-1/'
    for index,(item,(name,version,arch,filename,size,pin)) in enumerate(zip(archives,SETUP_V4_PACKAGES)):
        keys(item,'package path url bytes sha256 identity closeSucceeded')
        need(equal(item['package'],{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':pin}) and
             item['path']==archive_root+str(index).zfill(2)+'.deb' and
             item['url']=='https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+filename and
             type(item['bytes']) is int and item['bytes']==size and item['sha256']==pin and item['closeSucceeded'] is True,
             'ordered exact archive selected bytes/URL and closed observation')
        info=item['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o600 and info[3:7]==[0,0,1,size],
             'held root-owned regular archive fact')
    policy=value['policy'];keys(policy,'path identity sha256 mode exclusive')
    need(policy['path']=='/usr/sbin/policy-rc.d' and policy['sha256']==sha(b'#!/bin/sh\nexit 101\n') and
         policy['mode']==0o755 and policy['exclusive'] is True,'exact owned policy101 bytes/mode')
    info=policy['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
         stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o755 and info[3:7]==[0,0,1,19],
         'held owned policy identity')
    need(equal(value['cleanup'],{'removedExactOwnIdentity':True,'identity':info}),
         'same exact policy identity removed before Node stage')
    last=source_last_reap
    for phase,args in (('unpack',['--no-triggers','--unpack']+[item['path'] for item in archives]),
                       ('configure',['--no-triggers','--configure',*SETUP_V4_ORDER])):
        row=value[phase];keys(row,'argv process stdout stderr exitCode timedOut firstFailure secondary cgroupAfter')
        argv=['/usr/bin/dpkg',*args];need(equal(row['argv'],argv) and row['exitCode']==0 and row['timedOut'] is False and
             row['firstFailure'] is None and row['secondary']==[],'fixed no-triggers dpkg phase')
        start,end=v8_process(row['process'],'setup-v4',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},120000)
        need(row['process']['parentPid']==controller_pid and last<=start,
             'same root controller and Git/unpack/configure chronology')
        last=end
        census=row['cgroupAfter'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
        need(census['phase']==phase and
             setup_v4_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                                   census['cgroupStat'],controller_pid) and
             census['onlyController'] is True,'finite no-descendant setup phase census')
        for stream in ('stdout','stderr'):
            encoded=row[stream]
            if encoded is not None:need(len(prerequisite_original(canonical(encoded)))<=128<<10,'bounded dpkg original stream')
    need(value['unpack']['process']['reapMonoNs']<=value['configure']['process']['spawnMonoNs'],
         'unpack completed before configure')
    census=value['policyCleanupCgroup'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
    need(census['phase']=='policy-cleanup' and
         setup_v4_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                               census['cgroupStat'],controller_pid) and
         census['onlyController'] is True,
         'only root controller remained before global policy removal')
    post=value['postStatus'];keys(post,'sha256 bytes records selected pendingHostTriggers serviceObserved statusOriginal allSelectedPresent allowedStates deferredHostTriggers configurationComplete')
    digest(post['sha256']);integer(post['bytes'],1,8<<20);integer(post['records'],1,5000)
    post_original=post['statusOriginal'];keys(post_original,'role bytes sha256 packedBytes packedSha256')
    need(post_original['role']=='post' and post_original['bytes']==post['bytes'] and
         post_original['sha256']==post['sha256'] and
         integer(post_original['packedBytes'],1,700<<10)>0 and
         digest(post_original['packedSha256']),'held post-status original summary')
    need(post['allSelectedPresent'] is True and post['allowedStates'] is True and
         post['deferredHostTriggers'] is True and post['configurationComplete'] is False and
         type(post['selected']) is dict and set(post['selected'])=={row[0] for row in SETUP_V4_PACKAGES},
         'all selected post-status rows and deferred configuration')
    for name,version,arch,*_ in SETUP_V4_PACKAGES:
        row=post['selected'][name];keys(row,'Package Version Architecture Status Triggers-Pending Triggers-Awaited')
        need((row['Package'],row['Version'],row['Architecture'])==(name,version,arch) and
             row['Status'] in ('install ok installed','install ok triggers-pending','install ok triggers-awaited') and
             all(type(row[key]) in (str,type(None)) for key in ('Triggers-Pending','Triggers-Awaited')),
             'versioned selected package status, including pending trigger facts')
    pending=post['pendingHostTriggers']
    need(type(pending) is dict and len(pending)<=5000,'bounded actual host trigger rows')
    for name,row in pending.items():
        need(type(name) is str and re.fullmatch('[A-Za-z0-9.+-]+:(?:amd64|all)',name),
             'architecture-qualified host trigger package')
        keys(row,'status pending awaited')
        need(type(row['status']) is str and len(row['status'])<=128 and
             all(type(row[key]) in (str,type(None)) and (row[key] is None or len(row[key])<=4096)
                 for key in ('pending','awaited')) and
             (row['status'] in ('install ok triggers-pending','install ok triggers-awaited') or
              row['pending'] is not None or row['awaited'] is not None),'honest bounded pending host trigger fact')
    need(equal(post['serviceObserved'],{'unit':SETUP_V4_PAYLOAD_PINS['serviceUnit'],
        'init':SETUP_V4_PAYLOAD_PINS['initScript']}),
        'exact reviewed service unit and init script payload bytes; no service execution')
    return {'setupObserved':True,'deferredHostTriggers':True,'completeHostConfiguration':False,
        'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}


def setup_v4_stage_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity setup copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v4' and record['firstFailure'] is None and
         record['secondary']==[] and record['recordBoundary']==
         'verified copy after selected setup and policy cleanup, before directory publication',
         'closed v4 stage record')
    request_raw=prerequisite_original(canonical(record['request']));request,source=setup_v4_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(SETUP_V4_PLATFORM),'closed v4 stage platform')
    setup_v4_event(event_raw,request,pin,environment)
    need(equal(record['source'],source),'root Git/live source12 joins selected request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and
         copy['directoryPublicationAttempted'] is False and copy['filePublished'] is True and copy['directoryPublished'] is False and
         type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
         type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and
         copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
         copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],
         'fixed verified Node copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw v4 stage metadata')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and
         stat.S_ISREG(before[2]) and before[2]&0o6000==0 and before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],
         'held Node cache source extent/identity')
    file,directory=copy['file'],copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
         stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],
         'fixed staged Node file/directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original v4 source Git commands')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
            for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped v4 Git source checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed v4 Git command')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'sequential source Git children');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,
             'exact original source Git output')
    setup_v4_facts(record['setup'],environment['GITHUB_RUN_ID'],parent,previous)
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and event_meta['st_size']==len(event_raw) and
         stat.S_ISREG(event_meta['st_mode']),'held official event snapshot extent')
    return request,source


def observe_setup_v4_stage(environ):
    value={'schema':'bw.ring3.setup-node-observation.v4','stageObserved':False,'runtimeCandidate':False,
        'qualified':False,'record':None,'files':{},'directories':[],'source':{},'identity':None,
        'firstFailure':None,'secondary':[],'publicationSafe':False};backend=None
    def failed(error,phase):
        item={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),
             'known v4 dropped observer invoker')
        uid,gid=map(int,ids)
        need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],
             'actual irreversible dropped v4 IDs/groups')
        status=setup_proc_read('/proc/self/status');membership=setup_proc_read('/proc/self/cgroup')
        setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,
            'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid);value['publicationSafe']=True
        pin=digest(environ.get('BW_RING3_SETUP_INVENTORY_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True)
        value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=setup_v4_stage_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],
             'same installer/dropped observer PID across exec')
        event_raw=prerequisite_original(canonical(record['event']));setup_v4_event(event_raw,request,pin,environ)
        need(set(environ)==set(SETUP_V4_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in SETUP_V4_PLATFORM}),
            'closed actual dropped platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat()
            need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                 stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),
                 'live dropped v4 source regular owner/mode')
            raw=inventory_file(target,4<<20)
            fact={'bytes':len(raw),'sha256':sha(raw),
                'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent dropped source12 bytes')
        backend.read('node')
        need(backend.facts['node']['before']==record['copy']['file'],'finite staged Node inode join')
        value['stageObserved']=True
    except BaseException as error:failed(error,'setup-v4-stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts
            value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'setup-v4-stage-close')
    return value


def setup_v4_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.setup-runtime-inventory-original.v4','stageBefore':None,'stageAfter':None,
        'parent':None,'inventory':None,'candidate':None,'firstFailure':None,'secondary':[],
        'publicationSafe':False,'actualGuestApproved':False,'completeHostConfiguration':False}
    originals={};inventory=None
    def failed(error,phase):
        item=getattr(error,'inventory_first',{'phase':phase,'name':type(error).__name__,'message':str(error)})
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
        value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    try:
        before=observe_setup_v4_stage(environ);value['stageBefore']=before
        value['publicationSafe']=before['publicationSafe']
        if before['firstFailure'] is not None:
            error=Refusal(before['firstFailure']['message']);error.inventory_first=before['firstFailure']
            error.inventory_secondary=before['secondary'];raise error
        need(before['stageObserved'] is True,'complete dropped v4 stage before metadata tools')
        record=parse(prerequisite_original(canonical(before['record'])))
        originals['setup.request.json']=prerequisite_original(canonical(record['request']))
        originals['setup.event.json']=prerequisite_original(canonical(record['event']))
        value['parent']=inventory_parent_availability()
        inventory=StagedRuntimeInventory(before['files']['node']['before'],files,probe)
        candidate=inventory.discover()
        value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:failed(error,'setup-v4-runtime-inventory')
    finally:
        if inventory is not None:
            value['inventory']=inventory.partial
            rejected=getattr(inventory.ops,'rejected',{})
            if rejected:value['inventory']['rejectedFiles']=rejected
        if value['stageBefore'] is not None and value['stageBefore']['stageObserved']:
            after=observe_setup_v4_stage(environ);value['stageAfter']=after
            if after['firstFailure'] is not None:
                error=Refusal(after['firstFailure']['message']);error.inventory_first=after['firstFailure']
                error.inventory_secondary=after['secondary'];failed(error,'setup-v4-stage-after')
            elif not all(equal(after[key],value['stageBefore'][key]) for key in ('record','files','directories','source')):
                failed(Refusal('v4 source/stage changed across metadata tools'),'setup-v4-stage-after')
    raw=canonical(value)
    if len(raw)>4<<20:
        error={'phase':'setup-v4-original-cap','name':'Refusal','message':'versioned v4 original cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.setup-runtime-inventory-overflow.v4',
            'firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),
            'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.setup-inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[],value['publicationSafe']


SETUP_V4_LOG_MARKER=b'RING3_SETUP_RUNTIME_INVENTORY_V4 '
SETUP_V4_LOG_ROLES=('setup.request.json','setup.event.json','runtime.setup-inventory.json')


def emit_setup_v4_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<=set(SETUP_V4_LOG_ROLES) and
         all(type(raw) is bytes and 0<len(raw)<=4<<20 for raw in originals.values()) and
         sum(map(len,originals.values()))<=6<<20,'bounded v4 original roles')
    emitted=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072)
        raw_sha=sha(raw)
        need(count<=1821,'bounded v4 original chunk count')
        for index in range(count):
            line=SETUP_V4_LOG_MARKER+canonical({'schema':'bw.ring3.setup-runtime-inventory-log.v4',
                'name':name,'index':index,'count':count,'bytes':len(raw),'sha256':raw_sha,
                'data':encoded[index*3072:(index+1)*3072]})
            need(emitted+len(line)<=6<<20 and chunks<3000,'bounded six-MiB v4 runtime component')
            need(emit(line)==len(line),'complete v4 original log write')
            emitted+=len(line);chunks+=1
    flush()


def decode_setup_v4_log(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded v4 official log original')
    groups={};chunks=0;wire_bytes=0
    for line in raw.splitlines():
        at=line.find(SETUP_V4_LOG_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical v4 official log timestamp')
        wire_bytes+=len(line[at:])+1
        need(wire_bytes<=6<<20,'bounded six-MiB v4 runtime component wire')
        value=parse(line[at+len(SETUP_V4_LOG_MARKER):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.setup-runtime-inventory-log.v4' and value['name'] in SETUP_V4_LOG_ROLES,
             'closed v4 original log role')
        count=integer(value['count'],1,1821);index=integer(value['index'],0,count-1)
        extent=integer(value['bytes'],1,4<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded v4 base64 chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and
             index==len(group['parts']),'one ordered v4 original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<3000,'finite v4 log chunk count')
    need(set(groups)==set(SETUP_V4_LOG_ROLES),'three complete v4 originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete v4 chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and
             sha(value)==group['sha256'],'exact v4 original bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=6<<20,'bounded raw v4 aggregate')
    return originals


def verify_setup_v4_stage_observation(value,external):
    keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary publicationSafe')
    need(value['schema']=='bw.ring3.setup-node-observation.v4' and value['stageObserved'] is True and
         value['runtimeCandidate'] is False and value['qualified'] is False and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True,'complete actual v4 dropped stage observation')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw)
    request,source=setup_v4_stage_record(record,external['requestSha256'])
    env=record['platform'];need(request['head']==external['head'] and request['tree']==external['tree'] and
         env['GITHUB_RUN_ID']==external['runId'] and env['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,external['invoker'])),
         'external v4 source/platform/invoker joins')
    need(equal(value['source'],source['files']),'actual dropped source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*external['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],
         'installer/observer original PID continuity')
    setup_membership(identity['membership'],external['runId'])
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},
         'two independent v4 stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix')
        need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and
             equal(row['before'],row['namedAfter']),'closed stable v4 stage file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and
             all(type(x) is int for x in metadata) and stat.S_ISREG(metadata[2]) and
             metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'],'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444
        need(stat.S_IMODE(metadata[2])==mode,'fixed v4 stage mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent v4 staged bytes')
        if name=='node':
            need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],
                 'staged Node ELF/install join')
        else:need(row['prefix']==record_raw[:4].hex(),'held v4 record prefix')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==
         ['/','/run',str(NODE_STAGE_ROOT)],'fixed stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before']
        need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and
             (index!=2 or stat.S_IMODE(info[2])==0o555),'nonwritable root stage ancestor')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite stage directory inode join')
    return request,source,record


def verify_setup_v4_log(raw,external,outer_raw,cleanup_raw):
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 invoker')
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v4' and type(external['attempt']) is int and
         external['attempt']==1 and external['jobName']=='setup-runtime-inventory' and
         external['conclusion']=='success','externally selected official v4 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive official v4 run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),'selected actual invoker')
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'externally selected exact official v4 log bytes')
    need(type(outer_raw) is bytes and integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'externally selected exact outside-owner terminal bytes')
    need(type(cleanup_raw) is bytes and integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'externally selected outside cleanup original')
    cleanup=parse(cleanup_raw)
    keys(cleanup,'schema runId serviceExitCode cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(cleanup_raw==canonical(cleanup) and cleanup['schema']=='bw.ring3.setup-outside-cleanup.v4' and
         cleanup['runId']==external['runId'] and cleanup['serviceExitCode']==0 and
         cleanup['cgroupTerminal'] in ('empty','absent') and cleanup['policy'] is None and
         cleanup['action']=='not-needed' and cleanup['firstFailure'] is None and
         cleanup['secondary']==[] and cleanup['setupApproved'] is False,
         'finite outside owner needed no policy cleanup after successful setup')
    need((cleanup['cgroupTerminal']=='absent' and cleanup['unitCensus'] is None) or
         (cleanup['cgroupTerminal']=='empty' and type(cleanup['unitCensus']) is dict and
          set(cleanup['unitCensus'])=={'cgroupProcs','cgroupEvents','cgroupStat'} and
          setup_v4_cgroup_quiet(cleanup['unitCensus']['cgroupProcs'],
              cleanup['unitCensus']['cgroupEvents'],cleanup['unitCensus']['cgroupStat'])),
         'independently checked outside nested cgroup emptiness')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v4' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v4-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and outer['systemdRunExitCode']==0 and
         type(outer['outsideCleanupExitCode']) is int and outer['outsideCleanupExitCode']==0 and
         outer['cgroupAfter']=='absent','finite outside-owner successful service terminal and absent cgroup')
    originals=decode_setup_v4_log(raw);value=parse_setup_v4_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v4' and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True and value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,'failure-free metadata-only v4 original')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v4_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and equal(observed,record),
                  'same v4 staged source/request/record before and after graph')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
        ('record','files','directories','source')),'finite stage readback across metadata graph')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'exact source/head/workflow/request/event original join')
    statuses=decode_setup_v4_status_log(raw)
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']),
         'exact separately retained raw status originals join setup packet')
    before=setup_v4_status_rows(statuses['pre']['raw'])
    need(len(before)==pre['statusRecords']==1211 and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V4_PACKAGES),
         'independent raw pre-status census and selected absence')
    after=setup_v4_status_rows(statuses['post']['raw'])
    need(len(after)==post['records'],'independent raw post-status census')
    setup_v4_status_delta(before,after)
    selected={};pending={}
    for name,version,arch,*_ in SETUP_V4_PACKAGES:
        row=after.get((name,arch))
        selected[name]=None if row is None else {key:row.get(key) for key in
            ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
    for (name,arch),row in after.items():
        if (row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
            row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None):
            pending[name+':'+arch]={'status':row.get('Status'),'pending':row.get('Triggers-Pending'),
                'awaited':row.get('Triggers-Awaited')}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']),
         'independent raw post-status selected/pending projection')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and stat.S_ISDIR(parent['meta'][2]) and
         parent['meta'][3:5]==[0,0] and parent['meta'][2]&0o022==0 and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},
         'finite root-owned parent availability')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful cgroup parent availability')
    result=verify_staged_inventory_graph(value)
    need(equal(value['inventory']['fileMetadata'][NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'graph Node file joins staged inode/mode/hash')
    need(all(entry['process']['parentPid']==value['stageBefore']['identity']['pid'] for entry in
        value['inventory']['processes']),'eleven metadata children descend from dropped observer')
    need(all(entry['process']['spawnMonoNs']>=record['sourceCommands'][-1]['process']['reapMonoNs'] for entry in
        value['inventory']['processes']),'runtime probes follow root source admission')
    need(record['setup']['configure']['process']['reapMonoNs']<=
         value['inventory']['processes'][0]['process']['spawnMonoNs'],
         'all runtime probes follow completed no-trigger configure')
    return dict(result,schema='bw.ring3.setup-runtime-inventory-admission.v4',setupObserved=True,
        deferredHostTriggers=True,completeHostConfiguration=False,actualGuestApproved=False,
        outsideTerminalObserved=True,cgroupAfterAbsent=True,continuousOwnershipEstablished=False,
        officialJobAuthenticated=False,imageFieldsAuthenticated=False,
        immutableImageIdentityEstablished=False,candidateReviewed=False,actualRunApproved=False,
        rawStatusBytesIndependentlyVerified=True,ciArchiveBytesIndependentlyVerified=False)


def verify_setup_v4_failure_log(raw,external,outer_raw,cleanup_raw):
    """Retain a bound failed attempt; never promote its partial facts to admission."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 invoker')
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v4' and
         external['conclusion']=='failure' and external['attempt']==1 and
         external['jobName']=='setup-runtime-inventory','externally selected failed v4 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive failed run identity')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),
         'selected failed-job invoker')
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and
         integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'exact externally selected failed log bytes')
    need(type(outer_raw) is bytes and 0<len(outer_raw)<=4096 and
         integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'exact failed outside terminal original')
    need(type(cleanup_raw) is bytes and 0<len(cleanup_raw)<=16384 and
         integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'exact failed outside cleanup original')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v4' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v4-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and 0<outer['systemdRunExitCode']<=255 and
         type(outer['outsideCleanupExitCode']) is int and 0<=outer['outsideCleanupExitCode']<=255 and
         outer['cgroupAfter'] in ('present','absent'),'finite failed outside terminal facts')
    cleanup=parse(cleanup_raw);keys(cleanup,'schema runId serviceExitCode cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(cleanup_raw==canonical(cleanup) and cleanup['schema']=='bw.ring3.setup-outside-cleanup.v4' and
         cleanup['runId']==external['runId'] and cleanup['serviceExitCode']==outer['systemdRunExitCode'] and
         cleanup['setupApproved'] is False and type(cleanup['secondary']) is list and
         len(cleanup['secondary'])<=64,'finite failed outside cleanup facts')
    if cleanup['cgroupTerminal']=='empty':
        census=cleanup['unitCensus']
        need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
             setup_v4_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
             'independent empty nested outside census')
    elif cleanup['cgroupTerminal']=='absent':
        need(cleanup['unitCensus'] is None,'absent outside unit has no census')
    else:
        need(cleanup['firstFailure'] is not None,'uncertain outside cgroup remains failure')
        census=cleanup['unitCensus']
        if census is not None:
            need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
                 not setup_v4_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
                 'retained active nested outside census, never cleanup permission')
    packets=[]
    for line in raw.splitlines():
        at=line.find(b'{"actualGuestApproved":false,')
        if at<0:continue
        need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
             'canonical failed packet log prefix')
        need(len(line)-at<=4<<20,'bounded failed packet')
        packet=parse_setup_v4_outer(line[at:]);need(line[at:]==canonical(packet).rstrip(b'\n'),'canonical failed packet')
        if packet.get('schema')=='bw.ring3.setup-entry-failure.v4':packets.append(packet)
    need(len(packets)==1,'one complete failed setup packet')
    packet=packets[0];keys(packet,'schema context setup firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(packet['schema']=='bw.ring3.setup-entry-failure.v4' and packet['publicationSafe'] is False and
         packet['actualGuestApproved'] is False and packet['completeHostConfiguration'] is False and
         type(packet['firstFailure']) is dict and type(packet['secondary']) is list and
         len(packet['secondary'])<=64,'failed packet with retained first and secondary')
    keys(packet['firstFailure'],'phase name message')
    context=packet['context'];keys(context,'request event platform source sourceCommands eventIdentity')
    request_raw=prerequisite_original(canonical(context['request']))
    request,source=setup_v4_request(request_raw,external['requestSha256'])
    event_raw=prerequisite_original(canonical(context['event']))
    need(type(context['platform']) is dict and set(context['platform'])==set(SETUP_V4_PLATFORM),
         'closed failed platform')
    environment=context['platform'];setup_v4_event(event_raw,request,external['requestSha256'],environment)
    need(environment['GITHUB_RUN_ID']==external['runId'] and
         environment['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         request['head']==external['head'] and request['tree']==external['tree'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(context['source'],source),'failed source/request/event/official context join')
    need(type(context['sourceCommands']) is list and len(context['sourceCommands'])==3 and
         all(type(item) is dict and set(item)=={'argv','process','stdout','stderr'} for item in context['sourceCommands']),
         'three retained failed source command originals')
    commands=context['sourceCommands'];git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
                for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),
             'fixed failed source Git descriptor')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'exact failed source Git command')
        start,end=v8_process(command['process'],'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=command['process']['parentPid']
        need(start>=previous and command['process']['parentPid']==parent and
             prerequisite_original(canonical(command['stdout']))==outputs[index] and
             command['stderr'] is None,'causal failed source Git original')
        previous=end
    need(type(context['eventIdentity']) is dict and
         set(context['eventIdentity'])==set('st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns'.split()) and
         all(type(x) is int for x in context['eventIdentity'].values()) and
         context['eventIdentity']['st_size']==len(event_raw) and
         stat.S_ISREG(context['eventIdentity']['st_mode']),
         'failed held event extent')
    setup=packet['setup'];need(type(setup) is dict and setup.get('schema')=='bw.ring3.setup-original.v4' and
         setup.get('firstFailure') is not None and setup.get('nodeStage') is None and setup.get('runtime') is None,
         'only partial setup before Node stage')
    keys(setup,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    need(setup['configurationComplete'] is False and type(setup['secondary']) is list and
         len(setup['secondary'])<=64,'closed partial setup and secondary')
    partial=setup['partial']
    if type(partial) is dict and partial.get('phase')=='node-stage':
        keys(partial,'phase copy record dropProgress invoker')
        need(type(partial['copy']) is dict and
             set(partial['copy'])==set('created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory'.split()) and
             type(partial['dropProgress']) is list and
             partial['dropProgress']==['groups','gid','uid','ids-verified'][:len(partial['dropProgress'])] and
             equal(partial['invoker'],external['invoker']),
             'retained bounded failed Node copy/drop progress')
        if partial['record'] is not None:
            keys(partial['record'],'bytes sha256')
            integer(partial['record']['bytes'],1,1<<20);digest(partial['record']['sha256'])
    required_roles=set()
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        fact=setup[key]
        if type(fact) is dict and fact.get('statusOriginal') is not None:
            required_roles.add(role)
    statuses=decode_setup_v4_status_log(raw,None)
    roles=set(statuses)
    need(required_roles<=roles,'all reported failed status originals retained')
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        if role in roles:
            fact=setup[key]
            if role in required_roles:
                need(type(fact) is dict and equal(statuses[role]['meta'],fact['statusOriginal']) and
                    statuses[role]['meta']['sha256']==fact[hash_key] and
                    statuses[role]['meta']['bytes']==fact[size_key],
                    'independent retained failed raw status original join')
            rows=setup_v4_status_rows(statuses[role]['raw'])
            if role in required_roles:
                need(len(rows)==fact['statusRecords' if role=='pre' else 'records'],
                     'retained failed raw status census')
            if role=='pre' and role in required_roles:
                need(fact['statusSha256']==SETUP_V4_STATUS_SHA and
                     fact['statusBytes']==SETUP_V4_STATUS_BYTES,
                     'failed pre-state remains fixed selected baseline')
    need(setup['firstFailure']==packet['firstFailure'] or
         packet['firstFailure']['phase']=='v4-entry','retained setup/entry first failure relationship')
    return {'schema':'bw.ring3.setup-failure-retention.v4','failedAttemptRetained':True,
        'partialMutationPossible':True,'firstFailure':packet['firstFailure'],
        'secondary':packet['secondary'],'outsideCleanup':cleanup['action'],
        'outsideCgroupAfter':outer['cgroupAfter'],'setupObserved':False,
        'stageAttemptObserved':type(partial) is dict and partial.get('phase')=='node-stage',
        'retainedStatusRoles':sorted(roles),'statusRolesJoinedToSetup':sorted(required_roles),
        'rawStatusBytesIndependentlyVerified':bool(roles),
        'ciArchiveBytesIndependentlyVerified':False,
        'officialJobAuthenticated':False,'actualGuestApproved':False,
        'candidateReviewed':False,'actualRunApproved':False}


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




# Separate original-only v5 metadata reader. The prior v4 decoder remains held.
SETUP_V5_READER_ENABLED=True  # Original-only metadata; no guest approval.
SETUP_V5_PACKAGES=SETUP_V4_PACKAGES
SETUP_V5_ORDER=SETUP_V4_ORDER
SETUP_V5_STATUS_SHA=SETUP_V4_STATUS_SHA
SETUP_V5_STATUS_BYTES=SETUP_V4_STATUS_BYTES
SETUP_V5_PAYLOAD_PINS=SETUP_V4_PAYLOAD_PINS
SETUP_V5_HELPERS=dict(SETUP_V4_HELPERS,**{
    '/usr/sbin/start-stop-daemon':'81faf821fdfdf1dc2991b71dfbd6a21116085f931bfeb0fd7b2623911a4831b4',
    '/usr/sbin/ldconfig':'bfd5df90c7f070feab584435f106f254ffffaa268a04de5b5c3bd61d59c092f3',
    '/usr/sbin/ldconfig.real':'d879c9a8a41240aeb7fd0f3221116fc4cf41cc6c64c24e10541d1bafbe537ab1',
})
SETUP_V5_HELPER_ALIASES=dict(SETUP_V4_HELPER_ALIASES,**{
    '/sbin':{'linkText':'usr/sbin','target':'/usr/sbin','uid':0,'gid':0,'nlink':1,'size':8},
})
SETUP_V5_NEW_HELPER_BYTES={'/usr/sbin/start-stop-daemon':48632,
    '/usr/sbin/ldconfig':387,'/usr/sbin/ldconfig.real':1051280}
SETUP_V5_INSTALLER_ENV={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'}
SETUP_V5_PLATFORM=tuple('BW_RING3_SETUP_INVENTORY_V5_REQUEST_SHA256' if key=='BW_RING3_NODE_STAGE_REQUEST_SHA256' else key
    for key in NODE_STAGE_PLATFORM)
SETUP_V5_STATUS_MARKER=b'RING3_SETUP_STATUS_V5 '
SETUP_V5_LOG_MARKER=b'RING3_SETUP_RUNTIME_INVENTORY_V5 '
SETUP_V5_LOG_ROLES=SETUP_V4_LOG_ROLES
setup_v5_status_rows=setup_v4_status_rows
setup_v5_status_delta=setup_v4_status_delta
setup_v5_cgroup_quiet=setup_v4_cgroup_quiet
def parse_setup_v5_outer(value):
    """Only the new combined setup/runtime or failed-entry packet has a 4 MiB cap."""
    need(type(value) is bytes and 0<len(value)<=4<<20,'versioned v5 outer JSON byte cap')
    def unique(pairs):
        result={}
        for key,item in pairs:
            need(key not in result,'duplicate v5 outer JSON key')
            result[key]=item
        return result
    def finite(token):
        value=float(token)
        need(math.isfinite(value),'nonfinite v5 outer JSON number')
        return value
    return json.loads(value.decode('utf-8'),object_pairs_hook=unique,parse_float=finite,
                      parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite v5 outer JSON')))


def setup_v5_policy():
    return {'imageOS':'ubuntu24','imageVersion':'20261012.334.1',
        'statusSha256':SETUP_V5_STATUS_SHA,
        'helperSha256':SETUP_V5_HELPERS,'helperAliases':SETUP_V5_HELPER_ALIASES,
        'packages':[{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':digest}
            for name,version,arch,filename,size,digest in SETUP_V5_PACKAGES],
        'configureOrder':list(SETUP_V5_ORDER),'unpackOptions':['--no-triggers','--unpack'],
        'configureOptions':['--no-triggers','--configure'],'policyPath':'/usr/sbin/policy-rc.d',
        'policyExit':101,'installerPath':'/usr/sbin:/usr/bin:/bin','deferredTriggers':True,'apt':False,'recommends':False,'force':False,
        'upgrade':False,'configurationComplete':False}


def setup_v5_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=1<<20 and digest(pin)==sha(raw),'externally selected v5 request')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage emptyPythonSources setup payloadWitness')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v5','canonical v5 request')
    base={key:value[key] for key in ('repository','pullRequest','head','tree','source','selected','nodeStage','emptyPythonSources')}
    base['schema']='bw.ring3.inventory-request.v3'
    old,source=staged_runtime_request(canonical(base),sha(canonical(base)))
    need(equal(value['setup'],setup_v5_policy()),'exact selected v5 setup policy')
    need(type(SETUP_V5_PAYLOAD_PINS) is dict and len(SETUP_V5_PAYLOAD_PINS['archives'])==15 and
         all((item['package'],item['archiveBytes'],item['archiveSha256'])==(name,size,digest)
             for item,(name,version,arch,filename,size,digest) in
             zip(SETUP_V5_PAYLOAD_PINS['archives'],SETUP_V5_PACKAGES)),
         'independent payload/archive selection join')
    need(SETUP_V5_PAYLOAD_PINS is not None and equal(value['payloadWitness'],SETUP_V5_PAYLOAD_PINS),
         'separately reviewed payload/control witness required')
    return value,source


def setup_v5_event(raw,request,pin,environment):
    event=parse(raw);pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V5\n';end='\nBW_RING3_SETUP_RUNTIME_INVENTORY_V5 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one v5 request block')
    block=body.split(start,1)[1].split(end,1)[0];wrapper=parse(block.encode())
    need(canonical(wrapper).decode().rstrip('\n')==block and prerequisite_original(canonical(wrapper))==canonical(request) and
         wrapper['sha256']==pin,'exact immutable v5 request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-setup-runtime-inventory-v5' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==event['number'] and pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and pr['head']['repo'].get('fork') is False and
         pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'exact owned v5 event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {
        'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'setup-runtime-inventory-v5',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        'BW_RING3_SETUP_INVENTORY_V5_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),
        'exact v5 platform/source joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first v5 run identity');digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def decode_setup_v5_status_log(raw,required_roles=frozenset(('pre','post'))):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded official v5 log for status originals')
    result={}
    for line in raw.splitlines():
        at=line.find(SETUP_V5_STATUS_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical status original log timestamp')
        need(len(line[at:])+1<=1<<20,'one-MiB complete status log frame including LF')
        packet=parse(line[at+len(SETUP_V5_STATUS_MARKER):])
        keys(packet,'schema role rawBytes rawSha256 packedBytes packedSha256 encoding packed')
        role=packet['role'];need(packet['schema']=='bw.ring3.setup-status-original.v5' and
             role in ('pre','post') and role not in result and packet['encoding']=='zlib+base64',
             'one fixed raw pre/post status original')
        size=integer(packet['rawBytes'],1,8<<20);packed_size=integer(packet['packedBytes'],1,700<<10)
        digest(packet['rawSha256']);digest(packet['packedSha256'])
        need(type(packet['packed']) is str and len(packet['packed'])==4*((packed_size+2)//3),
             'exact bounded compressed status encoding')
        packed=base64.b64decode(packet['packed'],validate=True)
        need(base64.b64encode(packed).decode()==packet['packed'] and len(packed)==packed_size and
             sha(packed)==packet['packedSha256'],'exact compressed original bytes')
        decoder=zlib.decompressobj()
        decoded=decoder.decompress(packed,(8<<20)+1)
        need(len(decoded)<=8<<20 and decoder.eof and decoder.unused_data==b'' and
             decoder.unconsumed_tail==b'' and len(decoded)==size and
             sha(decoded)==packet['rawSha256'],
             'complete bounded single zlib stream and raw status SHA')
        result[role]={'raw':decoded,'meta':{'role':role,'bytes':size,'sha256':sha(decoded),
            'packedBytes':packed_size,'packedSha256':sha(packed)}}
    if required_roles is not None:
        need(set(result)==set(required_roles),'exact retained raw dpkg status original roles')
    return result


def setup_v5_facts(value,run_id,controller_pid,source_last_reap):
    keys(value,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    integer(controller_pid,1);integer(source_last_reap,1)
    need(value['schema']=='bw.ring3.setup-original.v5' and value['firstFailure'] is None and value['secondary']==[] and
         value['deferredHostTriggers'] is True and value['configurationComplete'] is False and
         value['nodeStage'] is None and value['runtime'] is None and value['partial'] is None,
         'complete setup facts before Node copy')
    pre=value['preflight'];keys(pre,'imageOS imageVersion statusSha256 statusBytes statusRecords statusOriginal helperSha256 helperWitness helperAliases resource policyAbsent newPackagesAbsent imageFieldsAuthenticated immutableImageIdentityEstablished')
    need(pre['imageOS']=='ubuntu24' and pre['imageVersion']=='20261012.334.1' and
         pre['statusSha256']==SETUP_V5_STATUS_SHA and
         integer(pre['statusBytes'],1,8<<20)==SETUP_V5_STATUS_BYTES and integer(pre['statusRecords'],1,5000)==1211 and
         equal(pre['helperSha256'],SETUP_V5_HELPERS) and
         equal(pre['helperAliases'],SETUP_V5_HELPER_ALIASES) and
         pre['policyAbsent'] is True and
         pre['newPackagesAbsent'] is True and pre['imageFieldsAuthenticated'] is False and
         pre['immutableImageIdentityEstablished'] is False,'fresh observed selected pre-state, no image-auth claim')
    witnesses=pre['helperWitness']
    need(type(witnesses) is dict and set(witnesses)==set(SETUP_V5_HELPERS),
         'ten named/held v5 helper witnesses')
    for path,pin in SETUP_V5_HELPERS.items():
        item=witnesses[path]
        keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
        need(item['path']==path and item['sha256']==pin and item['closeAttempted'] is True and
             item['closeSucceeded'] is True and item['namedBefore']==item['heldBefore']==
             item['heldAfter']==item['namedAfter'],'closed stable reported helper identity')
        info=item['heldBefore']
        need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
             type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
             item['bytesRead']==SETUP_V5_NEW_HELPER_BYTES.get(path,item['bytesRead']),
             'reported root-owned helper mode and signed new-helper extent')
    pre_original=pre['statusOriginal'];keys(pre_original,'role bytes sha256 packedBytes packedSha256')
    need(pre_original['role']=='pre' and pre_original['bytes']==pre['statusBytes'] and
         pre_original['sha256']==pre['statusSha256'] and
         integer(pre_original['packedBytes'],1,700<<10)>0 and
         digest(pre_original['packedSha256']),'held pre-status original summary')
    resource_row=pre['resource'];keys(resource_row,'membership limits')
    need(resource_row['membership']=='0::/system.slice/bw-ring3-setup-v5-'+run_id+'-1.service\n' and
         equal(resource_row['limits'],{'cpuMax':'100000 100000','memoryMax':'1073741824',
             'swapMax':'0','pidsMax':'64'}),'observed fixed outer setup cgroup limits')
    archives=value['archives'];need(type(archives) is list and len(archives)==15,'exact fifteen acquired archives')
    need(sum(row[4] for row in SETUP_V5_PACKAGES)==16400088 and all(row[4]<=12<<20 for row in SETUP_V5_PACKAGES),
         'fixed aggregate/per-archive bytes')
    archive_root='/run/bw-ring3-setup-v5-'+run_id+'-1/'
    for index,(item,(name,version,arch,filename,size,pin)) in enumerate(zip(archives,SETUP_V5_PACKAGES)):
        keys(item,'package path url bytes sha256 identity closeSucceeded')
        need(equal(item['package'],{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':pin}) and
             item['path']==archive_root+str(index).zfill(2)+'.deb' and
             item['url']=='https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+filename and
             type(item['bytes']) is int and item['bytes']==size and item['sha256']==pin and item['closeSucceeded'] is True,
             'ordered exact archive selected bytes/URL and closed observation')
        info=item['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o600 and info[3:7]==[0,0,1,size],
             'held root-owned regular archive fact')
    policy=value['policy'];keys(policy,'path identity sha256 mode exclusive')
    need(policy['path']=='/usr/sbin/policy-rc.d' and policy['sha256']==sha(b'#!/bin/sh\nexit 101\n') and
         policy['mode']==0o755 and policy['exclusive'] is True,'exact owned policy101 bytes/mode')
    info=policy['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
         stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o755 and info[3:7]==[0,0,1,19],
         'held owned policy identity')
    need(equal(value['cleanup'],{'removedExactOwnIdentity':True,'identity':info}),
         'same exact policy identity removed before Node stage')
    last=source_last_reap
    for phase,args in (('unpack',['--no-triggers','--unpack']+[item['path'] for item in archives]),
                       ('configure',['--no-triggers','--configure',*SETUP_V5_ORDER])):
        row=value[phase];keys(row,'argv process stdout stderr exitCode timedOut firstFailure secondary cgroupAfter')
        argv=['/usr/bin/dpkg',*args];need(equal(row['argv'],argv) and row['exitCode']==0 and row['timedOut'] is False and
             row['firstFailure'] is None and row['secondary']==[],'fixed no-triggers dpkg phase')
        start,end=v8_process(row['process'],'setup-v5',argv,
            SETUP_V5_INSTALLER_ENV,120000)
        need(row['process']['parentPid']==controller_pid and last<=start,
             'same root controller and Git/unpack/configure chronology')
        last=end
        census=row['cgroupAfter'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
        need(census['phase']==phase and
             setup_v5_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                                   census['cgroupStat'],controller_pid) and
             census['onlyController'] is True,'finite no-descendant setup phase census')
        for stream in ('stdout','stderr'):
            encoded=row[stream]
            if encoded is not None:need(len(prerequisite_original(canonical(encoded)))<=128<<10,'bounded dpkg original stream')
    need(value['unpack']['process']['reapMonoNs']<=value['configure']['process']['spawnMonoNs'],
         'unpack completed before configure')
    census=value['policyCleanupCgroup'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
    need(census['phase']=='policy-cleanup' and
         setup_v5_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                               census['cgroupStat'],controller_pid) and
         census['onlyController'] is True,
         'only root controller remained before global policy removal')
    post=value['postStatus'];keys(post,'sha256 bytes records selected pendingHostTriggers serviceObserved statusOriginal allSelectedPresent allowedStates deferredHostTriggers configurationComplete')
    digest(post['sha256']);integer(post['bytes'],1,8<<20);integer(post['records'],1,5000)
    post_original=post['statusOriginal'];keys(post_original,'role bytes sha256 packedBytes packedSha256')
    need(post_original['role']=='post' and post_original['bytes']==post['bytes'] and
         post_original['sha256']==post['sha256'] and
         integer(post_original['packedBytes'],1,700<<10)>0 and
         digest(post_original['packedSha256']),'held post-status original summary')
    need(post['allSelectedPresent'] is True and post['allowedStates'] is True and
         post['deferredHostTriggers'] is True and post['configurationComplete'] is False and
         type(post['selected']) is dict and set(post['selected'])=={row[0] for row in SETUP_V5_PACKAGES},
         'all selected post-status rows and deferred configuration')
    for name,version,arch,*_ in SETUP_V5_PACKAGES:
        row=post['selected'][name];keys(row,'Package Version Architecture Status Triggers-Pending Triggers-Awaited')
        need((row['Package'],row['Version'],row['Architecture'])==(name,version,arch) and
             row['Status'] in ('install ok installed','install ok triggers-pending','install ok triggers-awaited') and
             all(type(row[key]) in (str,type(None)) for key in ('Triggers-Pending','Triggers-Awaited')),
             'versioned selected package status, including pending trigger facts')
    pending=post['pendingHostTriggers']
    need(type(pending) is dict and len(pending)<=5000,'bounded actual host trigger rows')
    for name,row in pending.items():
        need(type(name) is str and re.fullmatch('[A-Za-z0-9.+-]+:(?:amd64|all)',name),
             'architecture-qualified host trigger package')
        keys(row,'status pending awaited')
        need(type(row['status']) is str and len(row['status'])<=128 and
             all(type(row[key]) in (str,type(None)) and (row[key] is None or len(row[key])<=4096)
                 for key in ('pending','awaited')) and
             (row['status'] in ('install ok triggers-pending','install ok triggers-awaited') or
              row['pending'] is not None or row['awaited'] is not None),'honest bounded pending host trigger fact')
    need(equal(post['serviceObserved'],{'unit':SETUP_V5_PAYLOAD_PINS['serviceUnit'],
        'init':SETUP_V5_PAYLOAD_PINS['initScript']}),
        'exact reviewed service unit and init script payload bytes; no service execution')
    return {'setupObserved':True,'deferredHostTriggers':True,'completeHostConfiguration':False,
        'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}


def setup_v5_stage_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity setup copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v5' and record['firstFailure'] is None and
         record['secondary']==[] and record['recordBoundary']==
         'verified copy after selected setup and policy cleanup, before directory publication',
         'closed v5 stage record')
    request_raw=prerequisite_original(canonical(record['request']));request,source=setup_v5_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(SETUP_V5_PLATFORM),'closed v5 stage platform')
    setup_v5_event(event_raw,request,pin,environment)
    need(equal(record['source'],source),'root Git/live source12 joins selected request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and
         copy['directoryPublicationAttempted'] is False and copy['filePublished'] is True and copy['directoryPublished'] is False and
         type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
         type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and
         copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
         copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],
         'fixed verified Node copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw v5 stage metadata')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and
         stat.S_ISREG(before[2]) and before[2]&0o6000==0 and before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],
         'held Node cache source extent/identity')
    file,directory=copy['file'],copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
         stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],
         'fixed staged Node file/directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original v5 source Git commands')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
            for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped v5 Git source checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed v5 Git command')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'sequential source Git children');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,
             'exact original source Git output')
    setup_v5_facts(record['setup'],environment['GITHUB_RUN_ID'],parent,previous)
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and event_meta['st_size']==len(event_raw) and
         stat.S_ISREG(event_meta['st_mode']),'held official event snapshot extent')
    return request,source


def observe_setup_v5_stage(environ):
    value={'schema':'bw.ring3.setup-node-observation.v5','stageObserved':False,'runtimeCandidate':False,
        'qualified':False,'record':None,'files':{},'directories':[],'source':{},'identity':None,
        'firstFailure':None,'secondary':[],'publicationSafe':False};backend=None
    def failed(error,phase):
        item={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),
             'known v5 dropped observer invoker')
        uid,gid=map(int,ids)
        need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],
             'actual irreversible dropped v5 IDs/groups')
        status=setup_proc_read('/proc/self/status');membership=setup_proc_read('/proc/self/cgroup')
        setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,
            'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid);value['publicationSafe']=True
        pin=digest(environ.get('BW_RING3_SETUP_INVENTORY_V5_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True)
        value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=setup_v5_stage_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],
             'same installer/dropped observer PID across exec')
        event_raw=prerequisite_original(canonical(record['event']));setup_v5_event(event_raw,request,pin,environ)
        need(set(environ)==set(SETUP_V5_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in SETUP_V5_PLATFORM}),
            'closed actual dropped platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat()
            need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                 stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),
                 'live dropped v5 source regular owner/mode')
            raw=inventory_file(target,4<<20)
            fact={'bytes':len(raw),'sha256':sha(raw),
                'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent dropped source12 bytes')
        backend.read('node')
        need(backend.facts['node']['before']==record['copy']['file'],'finite staged Node inode join')
        value['stageObserved']=True
    except BaseException as error:failed(error,'setup-v5-stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts
            value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'setup-v5-stage-close')
    return value


def setup_v5_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.setup-runtime-inventory-original.v5','stageBefore':None,'stageAfter':None,
        'parent':None,'inventory':None,'candidate':None,'firstFailure':None,'secondary':[],
        'publicationSafe':False,'actualGuestApproved':False,'completeHostConfiguration':False}
    originals={};inventory=None
    def failed(error,phase):
        item=getattr(error,'inventory_first',{'phase':phase,'name':type(error).__name__,'message':str(error)})
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
        value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    try:
        before=observe_setup_v5_stage(environ);value['stageBefore']=before
        value['publicationSafe']=before['publicationSafe']
        if before['firstFailure'] is not None:
            error=Refusal(before['firstFailure']['message']);error.inventory_first=before['firstFailure']
            error.inventory_secondary=before['secondary'];raise error
        need(before['stageObserved'] is True,'complete dropped v5 stage before metadata tools')
        record=parse(prerequisite_original(canonical(before['record'])))
        originals['setup.request.json']=prerequisite_original(canonical(record['request']))
        originals['setup.event.json']=prerequisite_original(canonical(record['event']))
        value['parent']=inventory_parent_availability()
        inventory=StagedRuntimeInventory(before['files']['node']['before'],files,probe)
        candidate=inventory.discover()
        value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:failed(error,'setup-v5-runtime-inventory')
    finally:
        if inventory is not None:
            value['inventory']=inventory.partial
            rejected=getattr(inventory.ops,'rejected',{})
            if rejected:value['inventory']['rejectedFiles']=rejected
        if value['stageBefore'] is not None and value['stageBefore']['stageObserved']:
            after=observe_setup_v5_stage(environ);value['stageAfter']=after
            if after['firstFailure'] is not None:
                error=Refusal(after['firstFailure']['message']);error.inventory_first=after['firstFailure']
                error.inventory_secondary=after['secondary'];failed(error,'setup-v5-stage-after')
            elif not all(equal(after[key],value['stageBefore'][key]) for key in ('record','files','directories','source')):
                failed(Refusal('v5 source/stage changed across metadata tools'),'setup-v5-stage-after')
    raw=canonical(value)
    if len(raw)>4<<20:
        error={'phase':'setup-v5-original-cap','name':'Refusal','message':'versioned v5 original cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.setup-runtime-inventory-overflow.v5',
            'firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),
            'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.setup-inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[],value['publicationSafe']


def emit_setup_v5_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<=set(SETUP_V5_LOG_ROLES) and
         all(type(raw) is bytes and 0<len(raw)<=4<<20 for raw in originals.values()) and
         sum(map(len,originals.values()))<=6<<20,'bounded v5 original roles')
    emitted=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072)
        raw_sha=sha(raw)
        need(count<=1821,'bounded v5 original chunk count')
        for index in range(count):
            line=SETUP_V5_LOG_MARKER+canonical({'schema':'bw.ring3.setup-runtime-inventory-log.v5',
                'name':name,'index':index,'count':count,'bytes':len(raw),'sha256':raw_sha,
                'data':encoded[index*3072:(index+1)*3072]})
            need(emitted+len(line)<=6<<20 and chunks<3000,'bounded six-MiB v5 runtime component')
            need(emit(line)==len(line),'complete v5 original log write')
            emitted+=len(line);chunks+=1
    flush()


def decode_setup_v5_log(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded v5 official log original')
    groups={};chunks=0;wire_bytes=0
    for line in raw.splitlines():
        at=line.find(SETUP_V5_LOG_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical v5 official log timestamp')
        wire_bytes+=len(line[at:])+1
        need(wire_bytes<=6<<20,'bounded six-MiB v5 runtime component wire')
        value=parse(line[at+len(SETUP_V5_LOG_MARKER):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.setup-runtime-inventory-log.v5' and value['name'] in SETUP_V5_LOG_ROLES,
             'closed v5 original log role')
        count=integer(value['count'],1,1821);index=integer(value['index'],0,count-1)
        extent=integer(value['bytes'],1,4<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded v5 base64 chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and
             index==len(group['parts']),'one ordered v5 original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<3000,'finite v5 log chunk count')
    need(set(groups)==set(SETUP_V5_LOG_ROLES),'three complete v5 originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete v5 chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and
             sha(value)==group['sha256'],'exact v5 original bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=6<<20,'bounded raw v5 aggregate')
    return originals


def verify_setup_v5_stage_observation(value,external):
    keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary publicationSafe')
    need(value['schema']=='bw.ring3.setup-node-observation.v5' and value['stageObserved'] is True and
         value['runtimeCandidate'] is False and value['qualified'] is False and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True,'complete actual v5 dropped stage observation')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw)
    request,source=setup_v5_stage_record(record,external['requestSha256'])
    env=record['platform'];need(request['head']==external['head'] and request['tree']==external['tree'] and
         env['GITHUB_RUN_ID']==external['runId'] and env['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,external['invoker'])),
         'external v5 source/platform/invoker joins')
    need(equal(value['source'],source['files']),'actual dropped source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*external['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],
         'installer/observer original PID continuity')
    setup_membership(identity['membership'],external['runId'])
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},
         'two independent v5 stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix')
        need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and
             equal(row['before'],row['namedAfter']),'closed stable v5 stage file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and
             all(type(x) is int for x in metadata) and stat.S_ISREG(metadata[2]) and
             metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'],'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444
        need(stat.S_IMODE(metadata[2])==mode,'fixed v5 stage mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent v5 staged bytes')
        if name=='node':
            need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],
                 'staged Node ELF/install join')
        else:need(row['prefix']==record_raw[:4].hex(),'held v5 record prefix')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==
         ['/','/run',str(NODE_STAGE_ROOT)],'fixed stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before']
        need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and
             (index!=2 or stat.S_IMODE(info[2])==0o555),'nonwritable root stage ancestor')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite stage directory inode join')
    return request,source,record


def verify_setup_v5_log(raw,external,outer_raw,cleanup_raw):
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 invoker')
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v5' and type(external['attempt']) is int and
         external['attempt']==1 and external['jobName']=='setup-runtime-inventory-v5' and
         external['conclusion']=='success','externally selected official v5 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive official v5 run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),'selected actual invoker')
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'externally selected exact official v5 log bytes')
    need(type(outer_raw) is bytes and integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'externally selected exact outside-owner terminal bytes')
    need(type(cleanup_raw) is bytes and integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'externally selected outside cleanup original')
    cleanup=parse(cleanup_raw)
    keys(cleanup,'schema runId serviceExitCode cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(cleanup_raw==canonical(cleanup) and cleanup['schema']=='bw.ring3.setup-outside-cleanup.v5' and
         cleanup['runId']==external['runId'] and cleanup['serviceExitCode']==0 and
         cleanup['cgroupTerminal'] in ('empty','absent') and cleanup['policy'] is None and
         cleanup['action']=='not-needed' and cleanup['firstFailure'] is None and
         cleanup['secondary']==[] and cleanup['setupApproved'] is False,
         'finite outside owner needed no policy cleanup after successful setup')
    need((cleanup['cgroupTerminal']=='absent' and cleanup['unitCensus'] is None) or
         (cleanup['cgroupTerminal']=='empty' and type(cleanup['unitCensus']) is dict and
          set(cleanup['unitCensus'])=={'cgroupProcs','cgroupEvents','cgroupStat'} and
          setup_v5_cgroup_quiet(cleanup['unitCensus']['cgroupProcs'],
              cleanup['unitCensus']['cgroupEvents'],cleanup['unitCensus']['cgroupStat'])),
         'independently checked outside nested cgroup emptiness')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v5' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v5-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and outer['systemdRunExitCode']==0 and
         type(outer['outsideCleanupExitCode']) is int and outer['outsideCleanupExitCode']==0 and
         outer['cgroupAfter']=='absent','finite outside-owner successful service terminal and absent cgroup')
    originals=decode_setup_v5_log(raw);value=parse_setup_v5_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v5' and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True and value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,'failure-free metadata-only v5 original')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v5_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and equal(observed,record),
                  'same v5 staged source/request/record before and after graph')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
        ('record','files','directories','source')),'finite stage readback across metadata graph')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'exact source/head/workflow/request/event original join')
    statuses=decode_setup_v5_status_log(raw)
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']),
         'exact separately retained raw status originals join setup packet')
    before=setup_v5_status_rows(statuses['pre']['raw'])
    need(len(before)==pre['statusRecords']==1211 and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V5_PACKAGES),
         'independent raw pre-status census and selected absence')
    after=setup_v5_status_rows(statuses['post']['raw'])
    need(len(after)==post['records'],'independent raw post-status census')
    setup_v5_status_delta(before,after)
    selected={};pending={}
    for name,version,arch,*_ in SETUP_V5_PACKAGES:
        row=after.get((name,arch))
        selected[name]=None if row is None else {key:row.get(key) for key in
            ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
    for (name,arch),row in after.items():
        if (row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
            row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None):
            pending[name+':'+arch]={'status':row.get('Status'),'pending':row.get('Triggers-Pending'),
                'awaited':row.get('Triggers-Awaited')}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']),
         'independent raw post-status selected/pending projection')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and stat.S_ISDIR(parent['meta'][2]) and
         parent['meta'][3:5]==[0,0] and parent['meta'][2]&0o022==0 and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},
         'finite root-owned parent availability')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful cgroup parent availability')
    result=verify_staged_inventory_graph(value)
    need(equal(value['inventory']['fileMetadata'][NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'graph Node file joins staged inode/mode/hash')
    need(all(entry['process']['parentPid']==value['stageBefore']['identity']['pid'] for entry in
        value['inventory']['processes']),'eleven metadata children descend from dropped observer')
    need(all(entry['process']['spawnMonoNs']>=record['sourceCommands'][-1]['process']['reapMonoNs'] for entry in
        value['inventory']['processes']),'runtime probes follow root source admission')
    need(record['setup']['configure']['process']['reapMonoNs']<=
         value['inventory']['processes'][0]['process']['spawnMonoNs'],
         'all runtime probes follow completed no-trigger configure')
    return dict(result,schema='bw.ring3.setup-runtime-inventory-admission.v5',setupObserved=True,
        deferredHostTriggers=True,completeHostConfiguration=False,actualGuestApproved=False,
        outsideTerminalObserved=True,cgroupAfterAbsent=True,continuousOwnershipEstablished=False,
        officialJobAuthenticated=False,imageFieldsAuthenticated=False,
        immutableImageIdentityEstablished=False,candidateReviewed=False,actualRunApproved=False,
        rawStatusBytesIndependentlyVerified=True,ciArchiveBytesIndependentlyVerified=False)


def verify_setup_v5_failure_log(raw,external,outer_raw,cleanup_raw):
    """Retain a bound failed attempt; never promote its partial facts to admission."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 invoker')
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v5' and
         external['conclusion']=='failure' and external['attempt']==1 and
         external['jobName']=='setup-runtime-inventory-v5','externally selected failed v5 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive failed run identity')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),
         'selected failed-job invoker')
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and
         integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'exact externally selected failed log bytes')
    need(type(outer_raw) is bytes and 0<len(outer_raw)<=4096 and
         integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'exact failed outside terminal original')
    need(type(cleanup_raw) is bytes and 0<len(cleanup_raw)<=16384 and
         integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'exact failed outside cleanup original')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v5' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v5-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and 0<outer['systemdRunExitCode']<=255 and
         type(outer['outsideCleanupExitCode']) is int and 0<=outer['outsideCleanupExitCode']<=255 and
         outer['cgroupAfter'] in ('present','absent'),'finite failed outside terminal facts')
    cleanup=parse(cleanup_raw);keys(cleanup,'schema runId serviceExitCode cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(cleanup_raw==canonical(cleanup) and cleanup['schema']=='bw.ring3.setup-outside-cleanup.v5' and
         cleanup['runId']==external['runId'] and cleanup['serviceExitCode']==outer['systemdRunExitCode'] and
         cleanup['setupApproved'] is False and type(cleanup['secondary']) is list and
         len(cleanup['secondary'])<=64,'finite failed outside cleanup facts')
    if cleanup['cgroupTerminal']=='empty':
        census=cleanup['unitCensus']
        need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
             setup_v5_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
             'independent empty nested outside census')
    elif cleanup['cgroupTerminal']=='absent':
        need(cleanup['unitCensus'] is None,'absent outside unit has no census')
    else:
        need(cleanup['firstFailure'] is not None,'uncertain outside cgroup remains failure')
        census=cleanup['unitCensus']
        if census is not None:
            need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
                 not setup_v5_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
                 'retained active nested outside census, never cleanup permission')
    packets=[]
    for line in raw.splitlines():
        at=line.find(b'{"actualGuestApproved":false,')
        if at<0:continue
        need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
             'canonical failed packet log prefix')
        need(len(line)-at<=4<<20,'bounded failed packet')
        packet=parse_setup_v5_outer(line[at:]);need(line[at:]==canonical(packet).rstrip(b'\n'),'canonical failed packet')
        if packet.get('schema')=='bw.ring3.setup-entry-failure.v5':packets.append(packet)
    need(len(packets)==1,'one complete failed setup packet')
    packet=packets[0];keys(packet,'schema context setup firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(packet['schema']=='bw.ring3.setup-entry-failure.v5' and packet['publicationSafe'] is False and
         packet['actualGuestApproved'] is False and packet['completeHostConfiguration'] is False and
         type(packet['firstFailure']) is dict and type(packet['secondary']) is list and
         len(packet['secondary'])<=64,'failed packet with retained first and secondary')
    keys(packet['firstFailure'],'phase name message')
    context=packet['context'];keys(context,'request event platform source sourceCommands eventIdentity')
    request_raw=prerequisite_original(canonical(context['request']))
    request,source=setup_v5_request(request_raw,external['requestSha256'])
    event_raw=prerequisite_original(canonical(context['event']))
    need(type(context['platform']) is dict and set(context['platform'])==set(SETUP_V5_PLATFORM),
         'closed failed platform')
    environment=context['platform'];setup_v5_event(event_raw,request,external['requestSha256'],environment)
    need(environment['GITHUB_RUN_ID']==external['runId'] and
         environment['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         request['head']==external['head'] and request['tree']==external['tree'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(context['source'],source),'failed source/request/event/official context join')
    need(type(context['sourceCommands']) is list and len(context['sourceCommands'])==3 and
         all(type(item) is dict and set(item)=={'argv','process','stdout','stderr'} for item in context['sourceCommands']),
         'three retained failed source command originals')
    commands=context['sourceCommands'];git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
                for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),
             'fixed failed source Git descriptor')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'exact failed source Git command')
        start,end=v8_process(command['process'],'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=command['process']['parentPid']
        need(start>=previous and command['process']['parentPid']==parent and
             prerequisite_original(canonical(command['stdout']))==outputs[index] and
             command['stderr'] is None,'causal failed source Git original')
        previous=end
    need(type(context['eventIdentity']) is dict and
         set(context['eventIdentity'])==set('st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns'.split()) and
         all(type(x) is int for x in context['eventIdentity'].values()) and
         context['eventIdentity']['st_size']==len(event_raw) and
         stat.S_ISREG(context['eventIdentity']['st_mode']),
         'failed held event extent')
    setup=packet['setup'];need(type(setup) is dict and setup.get('schema')=='bw.ring3.setup-original.v5' and
         setup.get('firstFailure') is not None and setup.get('nodeStage') is None and setup.get('runtime') is None,
         'only partial setup before Node stage')
    keys(setup,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    need(setup['configurationComplete'] is False and type(setup['secondary']) is list and
         len(setup['secondary'])<=64,'closed partial setup and secondary')
    partial=setup['partial']
    preflight_prefix=None
    if setup['preflight'] is None:
        need(type(partial) is dict and partial.get('phase')=='preflight',
             'failed preflight has a typed retained prefix')
        keys(partial,'phase prefix failedHelper')
        preflight_prefix=partial['prefix']
        keys(preflight_prefix,'statusOriginal statusSha256 statusBytes statusRecords completedHelpers helperWitness')
        completed=preflight_prefix['completedHelpers'];witnesses=preflight_prefix['helperWitness']
        need(type(completed) is list and type(witnesses) is dict and
             completed==list(SETUP_V5_HELPERS)[:len(completed)] and
             set(witnesses)==set(completed),'ordered bounded successful helper prefix')
        status_meta=preflight_prefix['statusOriginal']
        if status_meta is None:
            need(preflight_prefix['statusSha256'] is None and preflight_prefix['statusBytes'] is None and
                 preflight_prefix['statusRecords'] is None and completed==[],
                 'no fabricated pre-status or helper facts before observation')
        else:
            keys(status_meta,'role bytes sha256 packedBytes packedSha256')
            need(status_meta['role']=='pre' and status_meta['sha256']==preflight_prefix['statusSha256'] and
                 status_meta['bytes']==preflight_prefix['statusBytes'] and
                 integer(status_meta['bytes'],1,8<<20)>0 and
                 integer(status_meta['packedBytes'],1,700<<10)>0 and
                 digest(status_meta['packedSha256'])==status_meta['packedSha256'],
                 'bounded retained preflight status summary')
            if preflight_prefix['statusRecords'] is not None:
                integer(preflight_prefix['statusRecords'],1,5000)
            need(not completed or preflight_prefix['statusRecords']==1211,
                 'helper prefix follows full selected pre-status census')
        for path in completed:
            item=witnesses[path];keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(item['path']==path and item['sha256']==SETUP_V5_HELPERS[path] and
                 item['closeAttempted'] is True and item['closeSucceeded'] is True and
                 item['namedBefore']==item['heldBefore']==item['heldAfter']==item['namedAfter'],
                 'completed helper prefix has stable reported identity')
            info=item['heldBefore']
            need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
                 stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
                 type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
                 item['bytesRead']==SETUP_V5_NEW_HELPER_BYTES.get(path,item['bytesRead']),
                 'bounded known successful helper witness')
        failed=partial['failedHelper']
        helper_attempt=bool(completed) or failed is not None
        if helper_attempt:
            need(status_meta is not None and preflight_prefix['statusSha256']==SETUP_V5_STATUS_SHA and
                 preflight_prefix['statusBytes']==SETUP_V5_STATUS_BYTES and
                 preflight_prefix['statusRecords']==1211,
                 'helper attempt follows exact selected pre-status baseline')
        if failed is not None:
            keys(failed,'phase witness')
            item=failed['witness']
            keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(failed['phase']=='helper' and len(completed)<len(SETUP_V5_HELPERS) and
                 item['path']==list(SETUP_V5_HELPERS)[len(completed)] and
                 integer(item['bytesRead'],0,2<<20)>=0 and
                 type(item['closeAttempted']) is bool and type(item['closeSucceeded']) is bool and
                 (item['sha256'] is None or digest(item['sha256'])==item['sha256']),
                 'bounded failing helper position and partial byte count')
            for key in ('namedBefore','heldBefore','heldAfter','namedAfter'):
                info=item[key]
                need(info is None or (type(info) is list and len(info)==8 and
                     all(type(n) is int for n in info)),
                     'bounded partial helper metadata')
    if type(partial) is dict and partial.get('phase')=='node-stage':
        keys(partial,'phase copy record dropProgress invoker')
        need(type(partial['copy']) is dict and
             set(partial['copy'])==set('created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory'.split()) and
             type(partial['dropProgress']) is list and
             partial['dropProgress']==['groups','gid','uid','ids-verified'][:len(partial['dropProgress'])] and
             equal(partial['invoker'],external['invoker']),
             'retained bounded failed Node copy/drop progress')
        if partial['record'] is not None:
            keys(partial['record'],'bytes sha256')
            integer(partial['record']['bytes'],1,1<<20);digest(partial['record']['sha256'])
    required_roles=set()
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        fact=setup[key]
        if type(fact) is dict and fact.get('statusOriginal') is not None:
            required_roles.add(role)
    statuses=decode_setup_v5_status_log(raw,None)
    roles=set(statuses)
    if preflight_prefix is not None and preflight_prefix['statusOriginal'] is not None:
        required_roles.add('pre')
        need('pre' in roles and equal(statuses['pre']['meta'],preflight_prefix['statusOriginal']) and
             sha(statuses['pre']['raw'])==preflight_prefix['statusSha256'] and
             len(statuses['pre']['raw'])==preflight_prefix['statusBytes'],
             'raw failed preflight status joins retained prefix')
        if preflight_prefix['statusRecords'] is not None:
            pre_rows=setup_v5_status_rows(statuses['pre']['raw'])
            need(len(pre_rows)==preflight_prefix['statusRecords'],
                 'raw failed preflight census joins retained prefix')
            if helper_attempt:
                need(not any(name in {key[0] for key in pre_rows} for name,*_ in SETUP_V5_PACKAGES),
                     'selected fifteen absent before any helper attempt')
    need(required_roles<=roles,'all reported failed status originals retained')
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        if role in roles:
            fact=setup[key]
            if role in required_roles and type(fact) is dict:
                need(type(fact) is dict and equal(statuses[role]['meta'],fact['statusOriginal']) and
                    statuses[role]['meta']['sha256']==fact[hash_key] and
                    statuses[role]['meta']['bytes']==fact[size_key],
                    'independent retained failed raw status original join')
            rows=setup_v5_status_rows(statuses[role]['raw'])
            if role in required_roles and type(fact) is dict:
                need(len(rows)==fact['statusRecords' if role=='pre' else 'records'],
                     'retained failed raw status census')
            if role=='pre' and role in required_roles and type(fact) is dict:
                need(fact['statusSha256']==SETUP_V5_STATUS_SHA and
                     fact['statusBytes']==SETUP_V5_STATUS_BYTES,
                     'failed pre-state remains fixed selected baseline')
    need(setup['firstFailure']==packet['firstFailure'] or
         packet['firstFailure']['phase']=='v5-entry','retained setup/entry first failure relationship')
    return {'schema':'bw.ring3.setup-failure-retention.v5','failedAttemptRetained':True,
        'partialMutationPossible':True,'firstFailure':packet['firstFailure'],
        'secondary':packet['secondary'],'outsideCleanup':cleanup['action'],
        'outsideCgroupAfter':outer['cgroupAfter'],'setupObserved':False,
        'stageAttemptObserved':type(partial) is dict and partial.get('phase')=='node-stage',
        'retainedStatusRoles':sorted(roles),'statusRolesJoinedToSetup':sorted(required_roles),
        'rawStatusBytesIndependentlyVerified':bool(roles),
        'ciArchiveBytesIndependentlyVerified':False,
        'officialJobAuthenticated':False,'actualGuestApproved':False,
        'candidateReviewed':False,'actualRunApproved':False}


# Distinct v6 metadata family. Historical v5 source and packet semantics stay intact.
def setup_v6_image_observation(fields,errors):
    image_diag_fields(fields,True)
    need(type(errors) is list and len(errors)<=2 and len(errors)==len(set(errors)) and
         all(type(e) is str and re.fullmatch(r'Image(?:OS|Version):(type|encoding|unsafe-or-oversize)',e)
             for e in errors),'bounded v6 image field refusal')
    for name,row in fields.items():
        need((row['present'] and row['value'] is None)==any(e.startswith(name+':') for e in errors),
             'image refusal code matches retained field')
    return fields


def decode_setup_v6_shell(raw,external):
    need(type(raw) is bytes and 0<len(raw)<=4096 and
         integer(external['shellBytes'],1,4096)==len(raw) and
         digest(external['shellSha256'])==sha(raw),
         'externally selected exact v6 shell image original')
    value=parse(raw);keys(value,'schema fields fieldErrors setupAttempted guestAttempted setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-image-shell.v6' and
         value['setupAttempted'] is False and value['guestAttempted'] is False and
         value['setupApproved'] is False,'canonical no-setup v6 shell observation')
    setup_v6_image_observation(value['fields'],value['fieldErrors'])
    return value


def setup_v6_expected_forwarded(fields):
    return {name:{'present':True,'value':row['value'] if row['present'] else ''}
        for name,row in fields.items()}


SETUP_V6_READER_ENABLED=True  # Original and official event admission remain external.
SETUP_V6_PACKAGES=SETUP_V4_PACKAGES
SETUP_V6_ORDER=SETUP_V4_ORDER
SETUP_V6_STATUS_SHA=SETUP_V4_STATUS_SHA
SETUP_V6_STATUS_BYTES=SETUP_V4_STATUS_BYTES
SETUP_V6_PAYLOAD_PINS=SETUP_V4_PAYLOAD_PINS
SETUP_V6_HELPERS=dict(SETUP_V4_HELPERS,**{
    '/usr/sbin/start-stop-daemon':'81faf821fdfdf1dc2991b71dfbd6a21116085f931bfeb0fd7b2623911a4831b4',
    '/usr/sbin/ldconfig':'bfd5df90c7f070feab584435f106f254ffffaa268a04de5b5c3bd61d59c092f3',
    '/usr/sbin/ldconfig.real':'d879c9a8a41240aeb7fd0f3221116fc4cf41cc6c64c24e10541d1bafbe537ab1',
})
SETUP_V6_HELPER_ALIASES=dict(SETUP_V4_HELPER_ALIASES,**{
    '/sbin':{'linkText':'usr/sbin','target':'/usr/sbin','uid':0,'gid':0,'nlink':1,'size':8},
})
SETUP_V6_NEW_HELPER_BYTES={'/usr/sbin/start-stop-daemon':48632,
    '/usr/sbin/ldconfig':387,'/usr/sbin/ldconfig.real':1051280}
SETUP_V6_INSTALLER_ENV={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'}
SETUP_V6_PLATFORM=tuple('BW_RING3_SETUP_INVENTORY_V6_REQUEST_SHA256' if key=='BW_RING3_NODE_STAGE_REQUEST_SHA256' else key
    for key in NODE_STAGE_PLATFORM)+('BW_RING3_SETUP_INVENTORY_V6_REQUEST_B64',)
SETUP_V6_STATUS_MARKER=b'RING3_SETUP_STATUS_V6 '
SETUP_V6_LOG_MARKER=b'RING3_SETUP_RUNTIME_INVENTORY_V6 '
SETUP_V6_LOG_ROLES=SETUP_V4_LOG_ROLES
setup_v6_status_rows=setup_v4_status_rows
setup_v6_status_delta=setup_v4_status_delta
setup_v6_cgroup_quiet=setup_v4_cgroup_quiet
def parse_setup_v6_outer(value):
    """Only the new combined setup/runtime or failed-entry packet has a 4 MiB cap."""
    need(type(value) is bytes and 0<len(value)<=4<<20,'versioned v6 outer JSON byte cap')
    def unique(pairs):
        result={}
        for key,item in pairs:
            need(key not in result,'duplicate v6 outer JSON key')
            result[key]=item
        return result
    def finite(token):
        value=float(token)
        need(math.isfinite(value),'nonfinite v6 outer JSON number')
        return value
    return json.loads(value.decode('utf-8'),object_pairs_hook=unique,parse_float=finite,
                      parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite v6 outer JSON')))


def setup_v6_policy():
    return {'imageOS':'ubuntu24','imageVersion':'20261012.334.1',
        'statusSha256':SETUP_V6_STATUS_SHA,
        'helperSha256':SETUP_V6_HELPERS,'helperAliases':SETUP_V6_HELPER_ALIASES,
        'packages':[{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':digest}
            for name,version,arch,filename,size,digest in SETUP_V6_PACKAGES],
        'configureOrder':list(SETUP_V6_ORDER),'unpackOptions':['--no-triggers','--unpack'],
        'configureOptions':['--no-triggers','--configure'],'policyPath':'/usr/sbin/policy-rc.d',
        'policyExit':101,'installerPath':'/usr/sbin:/usr/bin:/bin','deferredTriggers':True,'apt':False,'recommends':False,'force':False,
        'upgrade':False,'configurationComplete':False}


def setup_v6_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=32768 and digest(pin)==sha(raw),'externally selected v6 request')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage emptyPythonSources setup payloadWitness')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v6','canonical v6 request')
    base={key:value[key] for key in ('repository','pullRequest','head','tree','source','selected','nodeStage','emptyPythonSources')}
    base['schema']='bw.ring3.inventory-request.v3'
    old,source=staged_runtime_request(canonical(base),sha(canonical(base)))
    need(equal(value['setup'],setup_v6_policy()),'exact selected v6 setup policy')
    need(type(SETUP_V6_PAYLOAD_PINS) is dict and len(SETUP_V6_PAYLOAD_PINS['archives'])==15 and
         all((item['package'],item['archiveBytes'],item['archiveSha256'])==(name,size,digest)
             for item,(name,version,arch,filename,size,digest) in
             zip(SETUP_V6_PAYLOAD_PINS['archives'],SETUP_V6_PACKAGES)),
         'independent payload/archive selection join')
    need(SETUP_V6_PAYLOAD_PINS is not None and equal(value['payloadWitness'],SETUP_V6_PAYLOAD_PINS),
         'separately reviewed payload/control witness required')
    return value,source


def setup_v6_event(raw,request,pin,environment):
    event=parse(raw);pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V6\n';end='\nBW_RING3_SETUP_RUNTIME_INVENTORY_V6 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one v6 request block')
    block=body.split(start,1)[1].split(end,1)[0]
    encoded=environment.get('BW_RING3_SETUP_INVENTORY_V6_REQUEST_B64')
    need(block==pin and type(encoded) is str and 0<len(encoded)<=43692,
         'exact v6 SHA-only body and repository request')
    try:raw=base64.b64decode(encoded,validate=True)
    except (ValueError,TypeError) as error:raise Refusal('invalid v6 request base64') from error
    need(0<len(raw)<=32768 and base64.b64encode(raw).decode('ascii')==encoded and
         raw==canonical(request) and sha(raw)==pin,'exact immutable v6 request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-setup-runtime-inventory-v6' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==event['number'] and pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and pr['head']['repo'].get('fork') is False and
         pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'exact owned v6 event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {
        'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'setup-runtime-inventory-v6',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        'BW_RING3_SETUP_INVENTORY_V6_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),
        'exact v6 platform/source joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first v6 run identity');digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def decode_setup_v6_status_log(raw,required_roles=frozenset(('pre','post'))):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded official v6 log for status originals')
    result={}
    for line in raw.splitlines():
        at=line.find(SETUP_V6_STATUS_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical status original log timestamp')
        need(len(line[at:])+1<=1<<20,'one-MiB complete status log frame including LF')
        packet=parse(line[at+len(SETUP_V6_STATUS_MARKER):])
        keys(packet,'schema role rawBytes rawSha256 packedBytes packedSha256 encoding packed')
        role=packet['role'];need(packet['schema']=='bw.ring3.setup-status-original.v6' and
             role in ('pre','post') and role not in result and packet['encoding']=='zlib+base64',
             'one fixed raw pre/post status original')
        size=integer(packet['rawBytes'],1,8<<20);packed_size=integer(packet['packedBytes'],1,700<<10)
        digest(packet['rawSha256']);digest(packet['packedSha256'])
        need(type(packet['packed']) is str and len(packet['packed'])==4*((packed_size+2)//3),
             'exact bounded compressed status encoding')
        packed=base64.b64decode(packet['packed'],validate=True)
        need(base64.b64encode(packed).decode()==packet['packed'] and len(packed)==packed_size and
             sha(packed)==packet['packedSha256'],'exact compressed original bytes')
        decoder=zlib.decompressobj()
        decoded=decoder.decompress(packed,(8<<20)+1)
        need(len(decoded)<=8<<20 and decoder.eof and decoder.unused_data==b'' and
             decoder.unconsumed_tail==b'' and len(decoded)==size and
             sha(decoded)==packet['rawSha256'],
             'complete bounded single zlib stream and raw status SHA')
        result[role]={'raw':decoded,'meta':{'role':role,'bytes':size,'sha256':sha(decoded),
            'packedBytes':packed_size,'packedSha256':sha(packed)}}
    if required_roles is not None:
        need(set(result)==set(required_roles),'exact retained raw dpkg status original roles')
    return result


def setup_v6_facts(value,run_id,controller_pid,source_last_reap):
    keys(value,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    integer(controller_pid,1);integer(source_last_reap,1)
    need(value['schema']=='bw.ring3.setup-original.v6' and value['firstFailure'] is None and value['secondary']==[] and
         value['deferredHostTriggers'] is True and value['configurationComplete'] is False and
         value['nodeStage'] is None and value['runtime'] is None and value['partial'] is None,
         'complete setup facts before Node copy')
    pre=value['preflight'];keys(pre,'imageOS imageVersion imageFields imageFieldErrors statusSha256 statusBytes statusRecords statusOriginal helperSha256 helperWitness helperAliases resource policyAbsent newPackagesAbsent imageFieldsAuthenticated immutableImageIdentityEstablished')
    need(pre['imageOS']=='ubuntu24' and pre['imageVersion']=='20261012.334.1' and
         pre['imageFieldErrors']==[] and pre['imageFields']=={
             'ImageOS':{'present':True,'value':'ubuntu24'},
             'ImageVersion':{'present':True,'value':'20261012.334.1'}} and
         pre['statusSha256']==SETUP_V6_STATUS_SHA and
         integer(pre['statusBytes'],1,8<<20)==SETUP_V6_STATUS_BYTES and integer(pre['statusRecords'],1,5000)==1211 and
         equal(pre['helperSha256'],SETUP_V6_HELPERS) and
         equal(pre['helperAliases'],SETUP_V6_HELPER_ALIASES) and
         pre['policyAbsent'] is True and
         pre['newPackagesAbsent'] is True and pre['imageFieldsAuthenticated'] is False and
         pre['immutableImageIdentityEstablished'] is False,'fresh observed selected pre-state, no image-auth claim')
    witnesses=pre['helperWitness']
    need(type(witnesses) is dict and set(witnesses)==set(SETUP_V6_HELPERS),
         'ten named/held v6 helper witnesses')
    for path,pin in SETUP_V6_HELPERS.items():
        item=witnesses[path]
        keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
        need(item['path']==path and item['sha256']==pin and item['closeAttempted'] is True and
             item['closeSucceeded'] is True and item['namedBefore']==item['heldBefore']==
             item['heldAfter']==item['namedAfter'],'closed stable reported helper identity')
        info=item['heldBefore']
        need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
             type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
             item['bytesRead']==SETUP_V6_NEW_HELPER_BYTES.get(path,item['bytesRead']),
             'reported root-owned helper mode and signed new-helper extent')
    pre_original=pre['statusOriginal'];keys(pre_original,'role bytes sha256 packedBytes packedSha256')
    need(pre_original['role']=='pre' and pre_original['bytes']==pre['statusBytes'] and
         pre_original['sha256']==pre['statusSha256'] and
         integer(pre_original['packedBytes'],1,700<<10)>0 and
         digest(pre_original['packedSha256']),'held pre-status original summary')
    resource_row=pre['resource'];keys(resource_row,'membership limits')
    need(resource_row['membership']=='0::/system.slice/bw-ring3-setup-v6-'+run_id+'-1.service\n' and
         equal(resource_row['limits'],{'cpuMax':'100000 100000','memoryMax':'1073741824',
             'swapMax':'0','pidsMax':'64'}),'observed fixed outer setup cgroup limits')
    archives=value['archives'];need(type(archives) is list and len(archives)==15,'exact fifteen acquired archives')
    need(sum(row[4] for row in SETUP_V6_PACKAGES)==16400088 and all(row[4]<=12<<20 for row in SETUP_V6_PACKAGES),
         'fixed aggregate/per-archive bytes')
    archive_root='/run/bw-ring3-setup-v6-'+run_id+'-1/'
    for index,(item,(name,version,arch,filename,size,pin)) in enumerate(zip(archives,SETUP_V6_PACKAGES)):
        keys(item,'package path url bytes sha256 identity closeSucceeded')
        need(equal(item['package'],{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':pin}) and
             item['path']==archive_root+str(index).zfill(2)+'.deb' and
             item['url']=='https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+filename and
             type(item['bytes']) is int and item['bytes']==size and item['sha256']==pin and item['closeSucceeded'] is True,
             'ordered exact archive selected bytes/URL and closed observation')
        info=item['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o600 and info[3:7]==[0,0,1,size],
             'held root-owned regular archive fact')
    policy=value['policy'];keys(policy,'path identity sha256 mode exclusive')
    need(policy['path']=='/usr/sbin/policy-rc.d' and policy['sha256']==sha(b'#!/bin/sh\nexit 101\n') and
         policy['mode']==0o755 and policy['exclusive'] is True,'exact owned policy101 bytes/mode')
    info=policy['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
         stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o755 and info[3:7]==[0,0,1,19],
         'held owned policy identity')
    need(equal(value['cleanup'],{'removedExactOwnIdentity':True,'identity':info}),
         'same exact policy identity removed before Node stage')
    last=source_last_reap
    for phase,args in (('unpack',['--no-triggers','--unpack']+[item['path'] for item in archives]),
                       ('configure',['--no-triggers','--configure',*SETUP_V6_ORDER])):
        row=value[phase];keys(row,'argv process stdout stderr exitCode timedOut firstFailure secondary cgroupAfter')
        argv=['/usr/bin/dpkg',*args];need(equal(row['argv'],argv) and row['exitCode']==0 and row['timedOut'] is False and
             row['firstFailure'] is None and row['secondary']==[],'fixed no-triggers dpkg phase')
        start,end=v8_process(row['process'],'setup-v6',argv,
            SETUP_V6_INSTALLER_ENV,120000)
        need(row['process']['parentPid']==controller_pid and last<=start,
             'same root controller and Git/unpack/configure chronology')
        last=end
        census=row['cgroupAfter'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
        need(census['phase']==phase and
             setup_v6_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                                   census['cgroupStat'],controller_pid) and
             census['onlyController'] is True,'finite no-descendant setup phase census')
        for stream in ('stdout','stderr'):
            encoded=row[stream]
            if encoded is not None:need(len(prerequisite_original(canonical(encoded)))<=128<<10,'bounded dpkg original stream')
    need(value['unpack']['process']['reapMonoNs']<=value['configure']['process']['spawnMonoNs'],
         'unpack completed before configure')
    census=value['policyCleanupCgroup'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
    need(census['phase']=='policy-cleanup' and
         setup_v6_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                               census['cgroupStat'],controller_pid) and
         census['onlyController'] is True,
         'only root controller remained before global policy removal')
    post=value['postStatus'];keys(post,'sha256 bytes records selected pendingHostTriggers serviceObserved statusOriginal allSelectedPresent allowedStates deferredHostTriggers configurationComplete')
    digest(post['sha256']);integer(post['bytes'],1,8<<20);integer(post['records'],1,5000)
    post_original=post['statusOriginal'];keys(post_original,'role bytes sha256 packedBytes packedSha256')
    need(post_original['role']=='post' and post_original['bytes']==post['bytes'] and
         post_original['sha256']==post['sha256'] and
         integer(post_original['packedBytes'],1,700<<10)>0 and
         digest(post_original['packedSha256']),'held post-status original summary')
    need(post['allSelectedPresent'] is True and post['allowedStates'] is True and
         post['deferredHostTriggers'] is True and post['configurationComplete'] is False and
         type(post['selected']) is dict and set(post['selected'])=={row[0] for row in SETUP_V6_PACKAGES},
         'all selected post-status rows and deferred configuration')
    for name,version,arch,*_ in SETUP_V6_PACKAGES:
        row=post['selected'][name];keys(row,'Package Version Architecture Status Triggers-Pending Triggers-Awaited')
        need((row['Package'],row['Version'],row['Architecture'])==(name,version,arch) and
             row['Status'] in ('install ok installed','install ok triggers-pending','install ok triggers-awaited') and
             all(type(row[key]) in (str,type(None)) for key in ('Triggers-Pending','Triggers-Awaited')),
             'versioned selected package status, including pending trigger facts')
    pending=post['pendingHostTriggers']
    need(type(pending) is dict and len(pending)<=5000,'bounded actual host trigger rows')
    for name,row in pending.items():
        need(type(name) is str and re.fullmatch('[A-Za-z0-9.+-]+:(?:amd64|all)',name),
             'architecture-qualified host trigger package')
        keys(row,'status pending awaited')
        need(type(row['status']) is str and len(row['status'])<=128 and
             all(type(row[key]) in (str,type(None)) and (row[key] is None or len(row[key])<=4096)
                 for key in ('pending','awaited')) and
             (row['status'] in ('install ok triggers-pending','install ok triggers-awaited') or
              row['pending'] is not None or row['awaited'] is not None),'honest bounded pending host trigger fact')
    need(equal(post['serviceObserved'],{'unit':SETUP_V6_PAYLOAD_PINS['serviceUnit'],
        'init':SETUP_V6_PAYLOAD_PINS['initScript']}),
        'exact reviewed service unit and init script payload bytes; no service execution')
    return {'setupObserved':True,'deferredHostTriggers':True,'completeHostConfiguration':False,
        'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}


def setup_v6_stage_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity setup copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v6' and record['firstFailure'] is None and
         record['secondary']==[] and record['recordBoundary']==
         'verified copy after selected setup and policy cleanup, before directory publication',
         'closed v6 stage record')
    request_raw=prerequisite_original(canonical(record['request']));request,source=setup_v6_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(SETUP_V6_PLATFORM),'closed v6 stage platform')
    setup_v6_event(event_raw,request,pin,environment)
    need(equal(record['source'],source),'root Git/live source12 joins selected request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and
         copy['directoryPublicationAttempted'] is False and copy['filePublished'] is True and copy['directoryPublished'] is False and
         type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
         type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and
         copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
         copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],
         'fixed verified Node copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw v6 stage metadata')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and
         stat.S_ISREG(before[2]) and before[2]&0o6000==0 and before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],
         'held Node cache source extent/identity')
    file,directory=copy['file'],copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
         stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],
         'fixed staged Node file/directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original v6 source Git commands')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
            for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped v6 Git source checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed v6 Git command')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'sequential source Git children');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,
             'exact original source Git output')
    setup_v6_facts(record['setup'],environment['GITHUB_RUN_ID'],parent,previous)
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and event_meta['st_size']==len(event_raw) and
         stat.S_ISREG(event_meta['st_mode']),'held official event snapshot extent')
    return request,source


def observe_setup_v6_stage(environ):
    value={'schema':'bw.ring3.setup-node-observation.v6','stageObserved':False,'runtimeCandidate':False,
        'qualified':False,'record':None,'files':{},'directories':[],'source':{},'identity':None,
        'firstFailure':None,'secondary':[],'publicationSafe':False};backend=None
    def failed(error,phase):
        item={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),
             'known v6 dropped observer invoker')
        uid,gid=map(int,ids)
        need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],
             'actual irreversible dropped v6 IDs/groups')
        status=setup_proc_read('/proc/self/status');membership=setup_proc_read('/proc/self/cgroup')
        setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,
            'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid);value['publicationSafe']=True
        pin=digest(environ.get('BW_RING3_SETUP_INVENTORY_V6_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True)
        value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=setup_v6_stage_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],
             'same installer/dropped observer PID across exec')
        event_raw=prerequisite_original(canonical(record['event']));setup_v6_event(event_raw,request,pin,environ)
        need(set(environ)==set(SETUP_V6_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in SETUP_V6_PLATFORM}),
            'closed actual dropped platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat()
            need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                 stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),
                 'live dropped v6 source regular owner/mode')
            raw=inventory_file(target,4<<20)
            fact={'bytes':len(raw),'sha256':sha(raw),
                'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent dropped source12 bytes')
        backend.read('node')
        need(backend.facts['node']['before']==record['copy']['file'],'finite staged Node inode join')
        value['stageObserved']=True
    except BaseException as error:failed(error,'setup-v6-stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts
            value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'setup-v6-stage-close')
    return value


def setup_v6_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.setup-runtime-inventory-original.v6','stageBefore':None,'stageAfter':None,
        'parent':None,'inventory':None,'candidate':None,'firstFailure':None,'secondary':[],
        'publicationSafe':False,'actualGuestApproved':False,'completeHostConfiguration':False}
    originals={};inventory=None
    def failed(error,phase):
        item=getattr(error,'inventory_first',{'phase':phase,'name':type(error).__name__,'message':str(error)})
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
        value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    try:
        before=observe_setup_v6_stage(environ);value['stageBefore']=before
        value['publicationSafe']=before['publicationSafe']
        if before['firstFailure'] is not None:
            error=Refusal(before['firstFailure']['message']);error.inventory_first=before['firstFailure']
            error.inventory_secondary=before['secondary'];raise error
        need(before['stageObserved'] is True,'complete dropped v6 stage before metadata tools')
        record=parse(prerequisite_original(canonical(before['record'])))
        originals['setup.request.json']=prerequisite_original(canonical(record['request']))
        originals['setup.event.json']=prerequisite_original(canonical(record['event']))
        value['parent']=inventory_parent_availability()
        inventory=StagedRuntimeInventory(before['files']['node']['before'],files,probe)
        candidate=inventory.discover()
        value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:failed(error,'setup-v6-runtime-inventory')
    finally:
        if inventory is not None:
            value['inventory']=inventory.partial
            rejected=getattr(inventory.ops,'rejected',{})
            if rejected:value['inventory']['rejectedFiles']=rejected
        if value['stageBefore'] is not None and value['stageBefore']['stageObserved']:
            after=observe_setup_v6_stage(environ);value['stageAfter']=after
            if after['firstFailure'] is not None:
                error=Refusal(after['firstFailure']['message']);error.inventory_first=after['firstFailure']
                error.inventory_secondary=after['secondary'];failed(error,'setup-v6-stage-after')
            elif not all(equal(after[key],value['stageBefore'][key]) for key in ('record','files','directories','source')):
                failed(Refusal('v6 source/stage changed across metadata tools'),'setup-v6-stage-after')
    raw=canonical(value)
    if len(raw)>4<<20:
        error={'phase':'setup-v6-original-cap','name':'Refusal','message':'versioned v6 original cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.setup-runtime-inventory-overflow.v6',
            'firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),
            'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.setup-inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[],value['publicationSafe']


def emit_setup_v6_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<=set(SETUP_V6_LOG_ROLES) and
         all(type(raw) is bytes and 0<len(raw)<=4<<20 for raw in originals.values()) and
         sum(map(len,originals.values()))<=6<<20,'bounded v6 original roles')
    emitted=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072)
        raw_sha=sha(raw)
        need(count<=1821,'bounded v6 original chunk count')
        for index in range(count):
            line=SETUP_V6_LOG_MARKER+canonical({'schema':'bw.ring3.setup-runtime-inventory-log.v6',
                'name':name,'index':index,'count':count,'bytes':len(raw),'sha256':raw_sha,
                'data':encoded[index*3072:(index+1)*3072]})
            need(emitted+len(line)<=6<<20 and chunks<3000,'bounded six-MiB v6 runtime component')
            need(emit(line)==len(line),'complete v6 original log write')
            emitted+=len(line);chunks+=1
    flush()


def decode_setup_v6_log(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded v6 official log original')
    groups={};chunks=0;wire_bytes=0
    for line in raw.splitlines():
        at=line.find(SETUP_V6_LOG_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical v6 official log timestamp')
        wire_bytes+=len(line[at:])+1
        need(wire_bytes<=6<<20,'bounded six-MiB v6 runtime component wire')
        value=parse(line[at+len(SETUP_V6_LOG_MARKER):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.setup-runtime-inventory-log.v6' and value['name'] in SETUP_V6_LOG_ROLES,
             'closed v6 original log role')
        count=integer(value['count'],1,1821);index=integer(value['index'],0,count-1)
        extent=integer(value['bytes'],1,4<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded v6 base64 chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and
             index==len(group['parts']),'one ordered v6 original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<3000,'finite v6 log chunk count')
    need(set(groups)==set(SETUP_V6_LOG_ROLES),'three complete v6 originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete v6 chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and
             sha(value)==group['sha256'],'exact v6 original bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=6<<20,'bounded raw v6 aggregate')
    return originals


def verify_setup_v6_stage_observation(value,external):
    keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary publicationSafe')
    need(value['schema']=='bw.ring3.setup-node-observation.v6' and value['stageObserved'] is True and
         value['runtimeCandidate'] is False and value['qualified'] is False and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True,'complete actual v6 dropped stage observation')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw)
    request,source=setup_v6_stage_record(record,external['requestSha256'])
    env=record['platform'];need(request['head']==external['head'] and request['tree']==external['tree'] and
         env['GITHUB_RUN_ID']==external['runId'] and env['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,external['invoker'])),
         'external v6 source/platform/invoker joins')
    need(equal(value['source'],source['files']),'actual dropped source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*external['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],
         'installer/observer original PID continuity')
    setup_membership(identity['membership'],external['runId'])
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},
         'two independent v6 stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix')
        need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and
             equal(row['before'],row['namedAfter']),'closed stable v6 stage file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and
             all(type(x) is int for x in metadata) and stat.S_ISREG(metadata[2]) and
             metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'],'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444
        need(stat.S_IMODE(metadata[2])==mode,'fixed v6 stage mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent v6 staged bytes')
        if name=='node':
            need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],
                 'staged Node ELF/install join')
        else:need(row['prefix']==record_raw[:4].hex(),'held v6 record prefix')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==
         ['/','/run',str(NODE_STAGE_ROOT)],'fixed stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before']
        need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and
             (index!=2 or stat.S_IMODE(info[2])==0o555),'nonwritable root stage ancestor')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite stage directory inode join')
    return request,source,record


def setup_v6_cleanup_original(raw,external):
    value=parse(raw)
    keys(value,'schema runId serviceExitCode sourceAdmission preCensus stop postCensus cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-outside-cleanup.v6' and
         value['runId']==external['runId'] and value['setupApproved'] is False and
         type(value['secondary']) is list and len(value['secondary'])<=64 and
         (value['firstFailure'] is None or type(value['firstFailure']) is dict),
         'closed bounded v6 outside cleanup original')
    unit='bw-ring3-setup-v6-'+external['runId']+'-1.service'
    selected=value['sourceAdmission']
    if selected is None:
        need(value['preCensus'] is None and value['postCensus'] is None and value['stop'] is None and
             value['policy'] is None and value['action'] is None and value['firstFailure'] is not None,
             'no unit stop or policy mutation without source admission')
    else:
        keys(selected,'requestSha256 eventSha256 head tree source unit')
        need(selected['requestSha256']==external['requestSha256'] and
             selected['head']==external['head'] and selected['tree']==external['tree'] and
             selected['unit']==unit,'exact outside request/source/unit selection')
        digest(selected['eventSha256'])
        source=selected['source'];keys(source,'schema head tree files')
        need(source['schema']=='bw.ring3.source.v1' and source['head']==external['head'] and
             source['tree']==external['tree'] and type(source['files']) is dict and
             set(source['files'])==SETUP_SOURCE_PATHS and
             source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
             'outside selected source twelve and workflow')
    def census(row):
        if row is None:return None
        keys(row,'terminal cgroupProcs cgroupEvents cgroupStat')
        need(row['terminal'] in ('absent','empty','populated'),'closed v6 unit terminal state')
        if row['terminal']=='absent':
            need(all(row[key] is None for key in ('cgroupProcs','cgroupEvents','cgroupStat')),
                 'absent unit has no invented census')
        else:
            need(all(type(row[key]) is str and len(row[key].encode())<=1024 for key in
                     ('cgroupProcs','cgroupEvents','cgroupStat')) and
                 (setup_v6_cgroup_quiet(row['cgroupProcs'],row['cgroupEvents'],row['cgroupStat']) is
                  (row['terminal']=='empty')),
                 'independent exact nested unit census')
        return row
    pre=census(value['preCensus']);post=census(value['postCensus'])
    stop=value['stop']
    if selected is not None:
        if stop is None:
            need(pre is None and post is None and value['cgroupTerminal'] is None and
                 value['unitCensus'] is None and value['policy'] is None and
                 value['action'] is None and value['firstFailure'] is not None,
                 'admitted unit identity refusal retains no invented stop or census')
        else:
            keys(stop,'attempted argv exitCode timedOut')
        if stop is not None and stop['attempted'] is True:
            need(stop['argv']==['/usr/bin/timeout','--kill-after=5s','20s',
                 '/usr/bin/systemctl','stop','--',unit] and
                 (stop['exitCode'] is None or integer(stop['exitCode'],-255,255)>=-255) and
                 (stop['timedOut'] is None if stop['exitCode'] is None else
                  stop['timedOut']==(stop['exitCode'] in (124,137))),
                 'one bounded exact owned-unit stop')
        elif stop is not None:
            need(stop=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
                 (pre is None and value['firstFailure'] is not None or
                  pre is not None and pre['terminal'] in ('absent','empty') and
                  (value['serviceExitCode']==0 or pre['terminal']=='absent')),
                 'no stop needed only for terminal or absent unit')
        if post is not None:
            need(value['cgroupTerminal']==post['terminal'] and
                 (value['unitCensus'] is None if post['terminal']=='absent' else
                  value['unitCensus']=={key:post[key] for key in
                      ('cgroupProcs','cgroupEvents','cgroupStat')}),
                 'outside final census and terminal projection')
        else:need(value['cgroupTerminal'] is None and value['unitCensus'] is None,
                  'unknown outside terminal cannot claim census')
    return value


def setup_v6_inner_original(raw,external,shell):
    originals=decode_setup_v6_log(raw);value=parse_setup_v6_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v6' and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True and value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,'failure-free metadata-only v6 original')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v6_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and equal(observed,record),
                  'same v6 staged source/request/record before and after graph')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
        ('record','files','directories','source')),'finite stage readback across metadata graph')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'exact source/head/workflow/request/event original join')
    statuses=decode_setup_v6_status_log(raw)
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']),
         'exact separately retained raw status originals join setup packet')
    before=setup_v6_status_rows(statuses['pre']['raw'])
    need(len(before)==pre['statusRecords']==1211 and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V6_PACKAGES),
         'independent raw pre-status census and selected absence')
    after=setup_v6_status_rows(statuses['post']['raw'])
    need(len(after)==post['records'],'independent raw post-status census')
    setup_v6_status_delta(before,after)
    selected={};pending={}
    for name,version,arch,*_ in SETUP_V6_PACKAGES:
        row=after.get((name,arch))
        selected[name]=None if row is None else {key:row.get(key) for key in
            ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
    for (name,arch),row in after.items():
        if (row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
            row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None):
            pending[name+':'+arch]={'status':row.get('Status'),'pending':row.get('Triggers-Pending'),
                'awaited':row.get('Triggers-Awaited')}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']),
         'independent raw post-status selected/pending projection')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and stat.S_ISDIR(parent['meta'][2]) and
         parent['meta'][3:5]==[0,0] and parent['meta'][2]&0o022==0 and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},
         'finite root-owned parent availability')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful cgroup parent availability')
    result=verify_staged_inventory_graph(value)
    need(equal(value['inventory']['fileMetadata'][NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'graph Node file joins staged inode/mode/hash')
    need(all(entry['process']['parentPid']==value['stageBefore']['identity']['pid'] for entry in
        value['inventory']['processes']),'eleven metadata children descend from dropped observer')
    need(all(entry['process']['spawnMonoNs']>=record['sourceCommands'][-1]['process']['reapMonoNs'] for entry in
        value['inventory']['processes']),'runtime probes follow root source admission')
    need(record['setup']['configure']['process']['reapMonoNs']<=
         value['inventory']['processes'][0]['process']['spawnMonoNs'],
         'all runtime probes follow completed no-trigger configure')
    need(record['setup']['preflight']['imageFields']==setup_v6_expected_forwarded(shell['fields']),
         'successful service image labels join shell forwarding')
    return result,record,source,event_raw,request_raw


def verify_setup_v6_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v6_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v6' and type(external['attempt']) is int and
         external['attempt']==1 and external['jobName']=='setup-runtime-inventory-v6' and
         external['conclusion']=='success','externally selected official v6 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive official v6 run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),'selected actual invoker')
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'externally selected exact official v6 log bytes')
    need(type(outer_raw) is bytes and integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'externally selected exact outside-owner terminal bytes')
    need(type(cleanup_raw) is bytes and integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'externally selected outside cleanup original')
    cleanup=setup_v6_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==0 and cleanup['sourceAdmission'] is not None and
         cleanup['stop']=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
         cleanup['preCensus'] is not None and cleanup['postCensus'] is not None and
         cleanup['cgroupTerminal'] in ('empty','absent') and cleanup['policy'] is None and
         cleanup['action']=='not-needed' and cleanup['firstFailure'] is None and
         cleanup['secondary']==[] and cleanup['setupApproved'] is False,
         'finite outside owner needed no policy cleanup after successful setup')
    need((cleanup['cgroupTerminal']=='absent' and cleanup['unitCensus'] is None) or
         (cleanup['cgroupTerminal']=='empty' and type(cleanup['unitCensus']) is dict and
          set(cleanup['unitCensus'])=={'cgroupProcs','cgroupEvents','cgroupStat'} and
          setup_v6_cgroup_quiet(cleanup['unitCensus']['cgroupProcs'],
              cleanup['unitCensus']['cgroupEvents'],cleanup['unitCensus']['cgroupStat'])),
         'independently checked outside nested cgroup emptiness')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v6' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v6-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and outer['systemdRunExitCode']==0 and
         type(outer['outsideCleanupExitCode']) is int and outer['outsideCleanupExitCode']==0 and
         outer['cgroupAfter']=='absent','finite outside-owner successful service terminal and absent cgroup')
    result,record,source,event_raw,request_raw=setup_v6_inner_original(raw,external,shell)
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins complete inner original')
    return dict(result,schema='bw.ring3.setup-runtime-inventory-admission.v6',setupObserved=True,
        shellImageFields=shell['fields'],serviceImageFields=record['setup']['preflight']['imageFields'],
        forwardingMatchesExpected=True,
        deferredHostTriggers=True,completeHostConfiguration=False,actualGuestApproved=False,
        outsideTerminalObserved=True,cgroupAfterAbsent=True,continuousOwnershipEstablished=False,
        officialJobAuthenticated=False,imageFieldsAuthenticated=False,
        immutableImageIdentityEstablished=False,candidateReviewed=False,actualRunApproved=False,
        rawStatusBytesIndependentlyVerified=True,ciArchiveBytesIndependentlyVerified=False)


def verify_setup_v6_failure_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    """Retain a bound failed attempt; never promote its partial facts to admission."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v6_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v6' and
         external['conclusion']=='failure' and external['attempt']==1 and
         external['jobName']=='setup-runtime-inventory-v6','externally selected failed v6 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive failed run identity')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),
         'selected failed-job invoker')
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and
         integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'exact externally selected failed log bytes')
    need(type(outer_raw) is bytes and 0<len(outer_raw)<=4096 and
         integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'exact failed outside terminal original')
    need(type(cleanup_raw) is bytes and 0<len(cleanup_raw)<=16384 and
         integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'exact failed outside cleanup original')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v6' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v6-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and 0<=outer['systemdRunExitCode']<=255 and
         type(outer['outsideCleanupExitCode']) is int and 0<=outer['outsideCleanupExitCode']<=255 and
         outer['cgroupAfter'] in ('present','absent') and
         (outer['systemdRunExitCode']!=0 or outer['outsideCleanupExitCode']!=0 or
          outer['cgroupAfter']!='absent'),'finite failed outside terminal facts')
    cleanup=setup_v6_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==outer['systemdRunExitCode'] and
         cleanup['setupApproved'] is False and type(cleanup['secondary']) is list and
         len(cleanup['secondary'])<=64,'finite failed outside cleanup facts')
    if cleanup['cgroupTerminal']=='empty':
        census=cleanup['unitCensus']
        need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
             setup_v6_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
             'independent empty nested outside census')
    elif cleanup['cgroupTerminal']=='absent':
        need(cleanup['unitCensus'] is None,'absent outside unit has no census')
    else:
        need(cleanup['firstFailure'] is not None,'uncertain outside cgroup remains failure')
        census=cleanup['unitCensus']
        if census is not None:
            need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
                 not setup_v6_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
                 'retained active nested outside census, never cleanup permission')
    packets=[]
    for line in raw.splitlines():
        at=line.find(b'{"actualGuestApproved":false,')
        if at<0:continue
        need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
             'canonical failed packet log prefix')
        need(len(line)-at<=4<<20,'bounded failed packet')
        packet=parse_setup_v6_outer(line[at:]);need(line[at:]==canonical(packet).rstrip(b'\n'),'canonical failed packet')
        if packet.get('schema')=='bw.ring3.setup-entry-failure.v6':packets.append(packet)
    if not packets:
        # A complete inner metadata packet is still a failed attempt when the
        # bounded outer client exits nonzero or outside cleanup is uncertain.
        try:
            _,record,source,event_raw,_=setup_v6_inner_original(raw,external,shell)
        except (ValueError,UnicodeError) as decode_error:
            # A killed outer client can leave only a bounded prefix. Keep its
            # exact official bytes as opaque evidence; no inner fact is graded.
            need(outer['systemdRunExitCode'] in (124,137) and
                 cleanup['sourceAdmission'] is not None and
                 type(cleanup['firstFailure']) is dict and
                 cleanup['firstFailure'].get('phase')=='v6-outer-client',
                 'only source-admitted timed client permits opaque inner prefix')
            return {'schema':'bw.ring3.setup-failure-retention.v6',
                'failedAttemptRetained':True,'innerOriginalIncomplete':True,
                'innerMetadataCompleteReported':False,'innerDecodeError':type(decode_error).__name__,
                'retainedLogBytes':len(raw),'retainedLogSha256':sha(raw),
                'partialMutationPossible':True,'firstFailure':cleanup['firstFailure'],
                'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
                'outsideCgroupAfter':outer['cgroupAfter'],
                'outerClientExitCode':outer['systemdRunExitCode'],
                'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
                'shellImageFields':shell['fields'],'serviceImageFields':None,
                'forwardingMatchesExpected':None,'officialJobAuthenticated':False,
                'actualGuestApproved':False,'actualRunApproved':False,
                'candidateReviewed':False,'completeHostConfiguration':False}
        if cleanup['sourceAdmission'] is not None:
            need(equal(cleanup['sourceAdmission']['source'],source) and
                 cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
                 'outside source/event joins complete failed-job inner original')
        first=cleanup['firstFailure'] or {'phase':'v6-outside-terminal','name':'ValueError',
            'message':'bounded outside terminal or cleanup refusal'}
        return {'schema':'bw.ring3.setup-failure-retention.v6',
            'failedAttemptRetained':True,'innerMetadataCompleteReported':True,
            'partialMutationPossible':True,'firstFailure':first,
            'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
            'outsideCgroupAfter':outer['cgroupAfter'],
            'outerClientExitCode':outer['systemdRunExitCode'],
            'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
            'shellImageFields':shell['fields'],
            'serviceImageFields':record['setup']['preflight']['imageFields'],
            'forwardingMatchesExpected':True,'officialJobAuthenticated':False,
            'actualGuestApproved':False,'actualRunApproved':False,
            'candidateReviewed':False,'completeHostConfiguration':False}
    need(len(packets)==1,'one complete failed setup packet')
    packet=packets[0];keys(packet,'schema context setup firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(packet['schema']=='bw.ring3.setup-entry-failure.v6' and packet['publicationSafe'] is False and
         packet['actualGuestApproved'] is False and packet['completeHostConfiguration'] is False and
         type(packet['firstFailure']) is dict and type(packet['secondary']) is list and
         len(packet['secondary'])<=64,'failed packet with retained first and secondary')
    keys(packet['firstFailure'],'phase name message')
    context=packet['context'];keys(context,'request event platform source sourceCommands eventIdentity imageFields imageFieldErrors')
    setup_v6_image_observation(context['imageFields'],context['imageFieldErrors'])
    forwarding_matches=context['imageFields']==setup_v6_expected_forwarded(shell['fields'])
    request_raw=prerequisite_original(canonical(context['request']))
    request,source=setup_v6_request(request_raw,external['requestSha256'])
    event_raw=prerequisite_original(canonical(context['event']))
    need(type(context['platform']) is dict and set(context['platform'])==set(SETUP_V6_PLATFORM),
         'closed failed platform')
    environment=context['platform'];setup_v6_event(event_raw,request,external['requestSha256'],environment)
    need(environment['GITHUB_RUN_ID']==external['runId'] and
         environment['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         request['head']==external['head'] and request['tree']==external['tree'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(context['source'],source),'failed source/request/event/official context join')
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins failed inner original')
    need(type(context['sourceCommands']) is list and len(context['sourceCommands'])==3 and
         all(type(item) is dict and set(item)=={'argv','process','stdout','stderr'} for item in context['sourceCommands']),
         'three retained failed source command originals')
    commands=context['sourceCommands'];git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
                for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),
             'fixed failed source Git descriptor')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'exact failed source Git command')
        start,end=v8_process(command['process'],'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=command['process']['parentPid']
        need(start>=previous and command['process']['parentPid']==parent and
             prerequisite_original(canonical(command['stdout']))==outputs[index] and
             command['stderr'] is None,'causal failed source Git original')
        previous=end
    need(type(context['eventIdentity']) is dict and
         set(context['eventIdentity'])==set('st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns'.split()) and
         all(type(x) is int for x in context['eventIdentity'].values()) and
         context['eventIdentity']['st_size']==len(event_raw) and
         stat.S_ISREG(context['eventIdentity']['st_mode']),
         'failed held event extent')
    setup=packet['setup'];need(type(setup) is dict and setup.get('schema')=='bw.ring3.setup-original.v6' and
         setup.get('firstFailure') is not None and setup.get('nodeStage') is None and setup.get('runtime') is None,
         'only partial setup before Node stage')
    keys(setup,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    need(setup['configurationComplete'] is False and type(setup['secondary']) is list and
         len(setup['secondary'])<=64,'closed partial setup and secondary')
    partial=setup['partial']
    preflight_prefix=None
    if setup['preflight'] is None:
        need(type(partial) is dict and partial.get('phase')=='preflight',
             'failed preflight has a typed retained prefix')
        keys(partial,'phase prefix failedHelper')
        preflight_prefix=partial['prefix']
        keys(preflight_prefix,'statusOriginal statusSha256 statusBytes statusRecords completedHelpers helperWitness imageFields imageFieldErrors')
        setup_v6_image_observation(preflight_prefix['imageFields'],preflight_prefix['imageFieldErrors'])
        need(preflight_prefix['imageFields']==context['imageFields'] and
             preflight_prefix['imageFieldErrors']==context['imageFieldErrors'],
             'failed preflight retains exact entry image observation')
        completed=preflight_prefix['completedHelpers'];witnesses=preflight_prefix['helperWitness']
        need(type(completed) is list and type(witnesses) is dict and
             completed==list(SETUP_V6_HELPERS)[:len(completed)] and
             set(witnesses)==set(completed),'ordered bounded successful helper prefix')
        status_meta=preflight_prefix['statusOriginal']
        if status_meta is None:
            need(preflight_prefix['statusSha256'] is None and preflight_prefix['statusBytes'] is None and
                 preflight_prefix['statusRecords'] is None and completed==[],
                 'no fabricated pre-status or helper facts before observation')
        else:
            keys(status_meta,'role bytes sha256 packedBytes packedSha256')
            need(status_meta['role']=='pre' and status_meta['sha256']==preflight_prefix['statusSha256'] and
                 status_meta['bytes']==preflight_prefix['statusBytes'] and
                 integer(status_meta['bytes'],1,8<<20)>0 and
                 integer(status_meta['packedBytes'],1,700<<10)>0 and
                 digest(status_meta['packedSha256'])==status_meta['packedSha256'],
                 'bounded retained preflight status summary')
            if preflight_prefix['statusRecords'] is not None:
                integer(preflight_prefix['statusRecords'],1,5000)
            need(not completed or preflight_prefix['statusRecords']==1211,
                 'helper prefix follows full selected pre-status census')
        for path in completed:
            item=witnesses[path];keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(item['path']==path and item['sha256']==SETUP_V6_HELPERS[path] and
                 item['closeAttempted'] is True and item['closeSucceeded'] is True and
                 item['namedBefore']==item['heldBefore']==item['heldAfter']==item['namedAfter'],
                 'completed helper prefix has stable reported identity')
            info=item['heldBefore']
            need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
                 stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
                 type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
                 item['bytesRead']==SETUP_V6_NEW_HELPER_BYTES.get(path,item['bytesRead']),
                 'bounded known successful helper witness')
        failed=partial['failedHelper']
        helper_attempt=bool(completed) or failed is not None
        if helper_attempt:
            need(status_meta is not None and preflight_prefix['statusSha256']==SETUP_V6_STATUS_SHA and
                 preflight_prefix['statusBytes']==SETUP_V6_STATUS_BYTES and
                 preflight_prefix['statusRecords']==1211,
                 'helper attempt follows exact selected pre-status baseline')
        if failed is not None:
            keys(failed,'phase witness')
            item=failed['witness']
            keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(failed['phase']=='helper' and len(completed)<len(SETUP_V6_HELPERS) and
                 item['path']==list(SETUP_V6_HELPERS)[len(completed)] and
                 integer(item['bytesRead'],0,2<<20)>=0 and
                 type(item['closeAttempted']) is bool and type(item['closeSucceeded']) is bool and
                 (item['sha256'] is None or digest(item['sha256'])==item['sha256']),
                 'bounded failing helper position and partial byte count')
            for key in ('namedBefore','heldBefore','heldAfter','namedAfter'):
                info=item[key]
                need(info is None or (type(info) is list and len(info)==8 and
                     all(type(n) is int for n in info)),
                     'bounded partial helper metadata')
    if type(partial) is dict and partial.get('phase')=='node-stage':
        keys(partial,'phase copy record dropProgress invoker')
        need(type(partial['copy']) is dict and
             set(partial['copy'])==set('created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory'.split()) and
             type(partial['dropProgress']) is list and
             partial['dropProgress']==['groups','gid','uid','ids-verified'][:len(partial['dropProgress'])] and
             equal(partial['invoker'],external['invoker']),
             'retained bounded failed Node copy/drop progress')
        if partial['record'] is not None:
            keys(partial['record'],'bytes sha256')
            integer(partial['record']['bytes'],1,1<<20);digest(partial['record']['sha256'])
    required_roles=set()
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        fact=setup[key]
        if type(fact) is dict and fact.get('statusOriginal') is not None:
            required_roles.add(role)
    statuses=decode_setup_v6_status_log(raw,None)
    roles=set(statuses)
    if preflight_prefix is not None and preflight_prefix['statusOriginal'] is not None:
        required_roles.add('pre')
        need('pre' in roles and equal(statuses['pre']['meta'],preflight_prefix['statusOriginal']) and
             sha(statuses['pre']['raw'])==preflight_prefix['statusSha256'] and
             len(statuses['pre']['raw'])==preflight_prefix['statusBytes'],
             'raw failed preflight status joins retained prefix')
        if preflight_prefix['statusRecords'] is not None:
            pre_rows=setup_v6_status_rows(statuses['pre']['raw'])
            need(len(pre_rows)==preflight_prefix['statusRecords'],
                 'raw failed preflight census joins retained prefix')
            if helper_attempt:
                need(not any(name in {key[0] for key in pre_rows} for name,*_ in SETUP_V6_PACKAGES),
                     'selected fifteen absent before any helper attempt')
    need(required_roles<=roles,'all reported failed status originals retained')
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        if role in roles:
            fact=setup[key]
            if role in required_roles and type(fact) is dict:
                need(type(fact) is dict and equal(statuses[role]['meta'],fact['statusOriginal']) and
                    statuses[role]['meta']['sha256']==fact[hash_key] and
                    statuses[role]['meta']['bytes']==fact[size_key],
                    'independent retained failed raw status original join')
            rows=setup_v6_status_rows(statuses[role]['raw'])
            if role in required_roles and type(fact) is dict:
                need(len(rows)==fact['statusRecords' if role=='pre' else 'records'],
                     'retained failed raw status census')
            if role=='pre' and role in required_roles and type(fact) is dict:
                need(fact['statusSha256']==SETUP_V6_STATUS_SHA and
                     fact['statusBytes']==SETUP_V6_STATUS_BYTES,
                     'failed pre-state remains fixed selected baseline')
    need(setup['firstFailure']==packet['firstFailure'] or
         packet['firstFailure']['phase']=='v6-entry','retained setup/entry first failure relationship')
    return {'schema':'bw.ring3.setup-failure-retention.v6','failedAttemptRetained':True,
        'partialMutationPossible':True,'firstFailure':packet['firstFailure'],
        'secondary':packet['secondary'],'outsideCleanup':cleanup['action'],
        'outsideCgroupAfter':outer['cgroupAfter'],
        'outerClientExitCode':outer['systemdRunExitCode'],
        'outsideFirstFailure':cleanup['firstFailure'],
        'outsideSecondary':cleanup['secondary'],'setupObserved':False,
        'shellImageFields':shell['fields'],'serviceImageFields':context['imageFields'],
        'forwardingMatchesExpected':forwarding_matches,
        'stageAttemptObserved':type(partial) is dict and partial.get('phase')=='node-stage',
        'retainedStatusRoles':sorted(roles),'statusRolesJoinedToSetup':sorted(required_roles),
        'rawStatusBytesIndependentlyVerified':bool(roles),
        'ciArchiveBytesIndependentlyVerified':False,
        'officialJobAuthenticated':False,'actualGuestApproved':False,
        'candidateReviewed':False,'actualRunApproved':False}



def setup_v7_image_observation(fields,errors):
    image_diag_fields(fields,True)
    need(type(errors) is list and len(errors)<=2 and len(errors)==len(set(errors)) and
         all(type(e) is str and re.fullmatch(r'Image(?:OS|Version):(type|encoding|unsafe-or-oversize)',e)
             for e in errors),'bounded v7 image field refusal')
    for name,row in fields.items():
        need((row['present'] and row['value'] is None)==any(e.startswith(name+':') for e in errors),
             'image refusal code matches retained field')
    return fields


def decode_setup_v7_shell(raw,external):
    need(type(raw) is bytes and 0<len(raw)<=4096 and
         integer(external['shellBytes'],1,4096)==len(raw) and
         digest(external['shellSha256'])==sha(raw),
         'externally selected exact v7 shell image original')
    value=parse(raw);keys(value,'schema fields fieldErrors setupAttempted guestAttempted setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-image-shell.v7' and
         value['setupAttempted'] is False and value['guestAttempted'] is False and
         value['setupApproved'] is False,'canonical no-setup v7 shell observation')
    setup_v7_image_observation(value['fields'],value['fieldErrors'])
    return value


def setup_v7_expected_forwarded(fields):
    return {name:{'present':True,'value':row['value'] if row['present'] else ''}
        for name,row in fields.items()}


def setup_v7_runtime_expectation(raw,expected_sha256):
    """Standalone stable-policy admission. Raw ASLR text is never its pin."""
    need(type(raw) is bytes and 0<len(raw)<=256<<10 and digest(expected_sha256)==sha(raw),'external runtime expectation original pin')
    value=parse(raw);keys(value,'schema platform executables versions files aliases packages packagePaths probes emptyPythonSources packagePathsByPackage')
    need(raw==canonical(value) and value['schema']=='bw.ring3.runtime-expectation.v3','canonical explicit runtime expectation version')
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
    setup_pairs={name:(version,arch) for name,version,arch,*_ in SETUP_V7_PACKAGES
                 if name in PACKAGE_NAMES}
    need(set(setup_pairs)==set(PACKAGE_NAMES) and
         all((row['version'],row['architecture'])==setup_pairs[row['name']]
             for row in packages),
         'independent five package-version rows match exact setup selection')
    paths=value['packagePaths'];need(type(paths) is list and 0<len(paths)<=2048 and paths==sorted(set(paths)),'bounded sorted stable package path union')
    for path in paths:runtime_path(path)
    by_package=value['packagePathsByPackage']
    need(type(by_package) is dict and set(by_package)==set(PACKAGE_NAMES),
         'five named original package-list projections')
    for name,listed in by_package.items():
        need(type(listed) is list and listed and len(listed)<=2048 and
             listed==sorted(set(listed)),'sorted unique single-package listing')
        for path in listed:runtime_path(path)
    need(paths==sorted(set(path for listed in by_package.values() for path in listed)),
         'independent sorted non-root union of five package listings')
    module=resolve_alias(RUNTIME_TCG,aliases);need(module in files and files[module]['kind']=='tcg-module' and RUNTIME_TCG in paths,'selected i386 TCG module')
    required={value['executables']['qemu']['path'],module}|{path for path,row in files.items() if row['kind']=='qemu-data'}
    need(any(row['kind']=='qemu-data' for row in files.values()) and required<={resolve_alias(path,aliases) for path in paths},'selected QEMU package file ownership')
    need(equal(value['probes'],setup_v7_probe_descriptors(value)),'complete fixed probe descriptor/executable roster')
    return value


def verify_setup_v7_stable_original(original,candidate_raw,pin):
    selected=setup_v7_runtime_expectation(candidate_raw,pin)
    keys(original,'schema observationPolicy platform executables versions qemuPackage')
    need(original['schema']=='bw.ring3.runtime.v7' and
         original['observationPolicy']=='prelaunch-probes-and-before-after-file-readback' and
         equal(original['platform'],selected['platform']) and
         equal(original['executables'],selected['executables']) and
         equal(original['versions'],selected['versions']),
         'selected v7 runtime identity and observation policy')
    package=original['qemuPackage'];keys(package,'name version architecture files aliases probes')
    qemu=next(row for row in selected['packages'] if row['name']=='qemu-system-x86')
    need(all(package[key]==qemu[key] for key in ('name','version','architecture')) and
         equal(package['aliases'],selected['aliases']) and
         equal(package['files'],{path:{key:row[key] for key in ('bytes','sha256','kind')}
             for path,row in selected['files'].items()}),
         'exact selected runtime graph in v7 original')
    descriptors={item['role']:item for item in selected['probes']}
    probes=package['probes'];need(type(probes) is list and len(probes)==15,
        'fifteen real runtime metadata observations')
    setup_v7_observed_order(probes)
    seen=set();module=resolve_alias(RUNTIME_TCG,selected['aliases'])
    for probe in probes:
        keys(probe,'role argv environment exitCode stdout stderr')
        role=probe['role'];need(role in descriptors and role not in seen,
            'one original per fixed v7 descriptor');seen.add(role)
        expected=descriptors[role]
        need(equal(probe['argv'],expected['argv']) and
             equal(probe['environment'],expected['environment']) and
             type(probe['exitCode']) is int and probe['exitCode']==0 and
             type(probe['stdout']) is str and
             len(probe['stdout'].encode('utf-8','surrogateescape'))<=16384 and
             probe['stderr']=='','bounded clean v7 probe original')
        if role in SETUP_V7_PACKAGE_ROLES.values():
            name=next(name for name,named in SETUP_V7_PACKAGE_ROLES.items() if named==role)
            paths=setup_v7_listed_paths(probe['stdout'].encode('utf-8','surrogateescape'))
            need(paths==selected['packagePathsByPackage'][name],
                 'raw named package listing joins selected projection')
        elif role=='package-version':
            rows=[line.split('\t') for line in probe['stdout'].splitlines()]
            need(sorted(rows)==[[row['name'],row['version'],row['architecture']]
                for row in selected['packages']],'raw selected package versions')
        elif role.endswith('-version'):
            name=role[:-8]
            need(probe['stdout'].splitlines() and
                 probe['stdout'].splitlines()[0]==selected['versions'][name],
                 'selected version original')
        elif role.startswith('ldd-'):
            for path in ldd_paths(probe['stdout']):
                need(resolve_alias(path,selected['aliases']) in selected['files'],
                     'raw ldd library joins selected graph')
    need(seen==set(descriptors) and len(descriptors)==15,
         'complete fifteen-role v7 original roster')
    used={selected['executables']['qemu']['path'],module}|{
        path for path,row in selected['files'].items() if row['kind']=='qemu-data'}
    need(used<={resolve_alias(path,selected['aliases']) for path in selected['packagePaths']},
         'raw package owned selected engine/module/data')
    return selected


def verify_setup_v7_inventory_graph(value):
    candidate_raw=prerequisite_original(canonical(value['candidate']));candidate=setup_v7_runtime_expectation(candidate_raw,sha(candidate_raw))
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
    runtime_original={'schema':'bw.ring3.runtime.v7','observationPolicy':'prelaunch-probes-and-before-after-file-readback','platform':candidate['platform'],
        'executables':candidate['executables'],'versions':candidate['versions'],'qemuPackage':{'name':qemu['name'],'version':qemu['version'],'architecture':qemu['architecture'],
        'files':{path:{key:row[key] for key in ('bytes','sha256','kind')} for path,row in candidate['files'].items()},'aliases':candidate['aliases'],'probes':inventory['probes']}}
    verify_setup_v7_stable_original(runtime_original,candidate_raw,sha(candidate_raw))
    processes=inventory['processes'];need(type(processes) is list and len(processes)==15,'complete exact metadata probe process originals')
    setup_v7_observed_order(inventory['probes'],processes)
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



SETUP_V7_READER_ENABLED=True  # Original and official event admission remain external.
SETUP_V7_PACKAGES=SETUP_V4_PACKAGES
SETUP_V7_ORDER=SETUP_V4_ORDER
SETUP_V7_STATUS_SHA=SETUP_V4_STATUS_SHA
SETUP_V7_STATUS_BYTES=SETUP_V4_STATUS_BYTES
SETUP_V7_PAYLOAD_PINS=SETUP_V4_PAYLOAD_PINS
SETUP_V7_HELPERS=dict(SETUP_V4_HELPERS,**{
    '/usr/sbin/start-stop-daemon':'81faf821fdfdf1dc2991b71dfbd6a21116085f931bfeb0fd7b2623911a4831b4',
    '/usr/sbin/ldconfig':'bfd5df90c7f070feab584435f106f254ffffaa268a04de5b5c3bd61d59c092f3',
    '/usr/sbin/ldconfig.real':'d879c9a8a41240aeb7fd0f3221116fc4cf41cc6c64c24e10541d1bafbe537ab1',
})
SETUP_V7_HELPER_ALIASES=dict(SETUP_V4_HELPER_ALIASES,**{
    '/sbin':{'linkText':'usr/sbin','target':'/usr/sbin','uid':0,'gid':0,'nlink':1,'size':8},
})
SETUP_V7_NEW_HELPER_BYTES={'/usr/sbin/start-stop-daemon':48632,
    '/usr/sbin/ldconfig':387,'/usr/sbin/ldconfig.real':1051280}
SETUP_V7_INSTALLER_ENV={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'}
SETUP_V7_PLATFORM=tuple('BW_RING3_SETUP_INVENTORY_V7_REQUEST_SHA256' if key=='BW_RING3_NODE_STAGE_REQUEST_SHA256' else key
    for key in NODE_STAGE_PLATFORM)+('BW_RING3_SETUP_INVENTORY_V7_REQUEST_B64',)
SETUP_V7_STATUS_MARKER=b'RING3_SETUP_STATUS_V7 '
SETUP_V7_LOG_MARKER=b'RING3_SETUP_RUNTIME_INVENTORY_V7 '
SETUP_V7_LOG_ROLES=SETUP_V4_LOG_ROLES
SETUP_V7_PACKAGE_ROLES={name:'package-files-'+name for name in PACKAGE_NAMES}
SETUP_V7_PROBE_ROLES=(RUNTIME_ROLES-{'package-files'})|set(SETUP_V7_PACKAGE_ROLES.values())
SETUP_V7_PROBE_ORDER=('ldd-shell','ldd-dpkg-query','ldd-node','ldd-python',
    'ldd-qemu','package-version',*(SETUP_V7_PACKAGE_ROLES[name] for name in PACKAGE_NAMES),
    'ldd-tcg','node-version','python-version','qemu-version')
assert len(SETUP_V7_PROBE_ORDER)==15 and set(SETUP_V7_PROBE_ORDER)==SETUP_V7_PROBE_ROLES


def setup_v7_observed_order(probes,processes=None,partial=False):
    need(type(probes) is list and (1<=len(probes)<=15 if partial else len(probes)==15) and
         [item['role'] for item in probes]==list(SETUP_V7_PROBE_ORDER[:len(probes)]),
         'exact serial fifteen-role v7 probe order')
    if processes is not None:
        need(type(processes) is list and len(processes)==len(probes) and
             [item['role'] for item in processes]==list(SETUP_V7_PROBE_ORDER[:len(probes)]),
             'each real child retains the same fixed v7 role order')


def setup_v7_producer_listing(text):
    need(type(text) is str and 0<len(text.encode('utf-8','surrogateescape'))<=16384 and
         text.endswith('\n') and '\r' not in text and '\0' not in text,
         'one complete bounded package listing')
    lines=text.split('\n')[:-1]
    need(lines and lines[0]=='/.','one real package root marker')
    if lines and lines[-1]=='':lines.pop()
    need(lines and all(line!='' for line in lines),'no interior package separator')
    paths=[]
    for line in lines[1:]:
        need(line!='/.','no repeated package root')
        paths.append(runtime_path(line))
    need(paths and len(paths)<=2048 and len(paths)==len(set(paths)),
         'bounded unique package file paths')
    return sorted(paths)


class SetupV7Inventory(StagedRuntimeInventory):
    """Five real package children, each with its own bounded original."""
    def argv(self,role):
        for name,named_role in SETUP_V7_PACKAGE_ROLES.items():
            if role==named_role:return ['/usr/bin/dpkg-query','-L',name]
        return super().argv(role)

    def candidate(self,value):
        need(set(STAGED_EMPTY_PYTHON_SOURCES)<=set(self.partial['pythonFiles']),
             'v7 typed empty Python source census')
        return dict(value,schema='bw.ring3.runtime-expectation.v3',
                    emptyPythonSources=parse(canonical(STAGED_EMPTY_PYTHON_SOURCES)),
                    packagePathsByPackage=self.package_listings)

    def validate_candidate(self,raw):return setup_v7_runtime_expectation(raw,sha(raw))

    def discover(self):
        need(not self.staged_attempted,'v7 stage inventory consumed; no retry')
        self.staged_attempted=True;self.partial={'emptyPythonSources':self.empty_originals}
        try:
            self.empty_read('before');raw=self.discover_core();self.empty_read('after')
            verify_staged_empty_python(self.empty_originals);return raw
        finally:self.partial['emptyPythonSources']=self.empty_originals

    def observe(self,role,argv):
        need(role in SETUP_V7_PROBE_ROLES and len(self.probes)<15 and
             role==SETUP_V7_PROBE_ORDER[len(self.probes)],
             'next fixed v7 serial metadata child before process factory')
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

    def discover_core(self):
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
        setup_pairs={name:(version,arch) for name,version,arch,*_ in SETUP_V7_PACKAGES
                     if name in PACKAGE_NAMES}
        need(set(setup_pairs)==set(PACKAGE_NAMES) and
             all((row['version'],row['architecture'])==setup_pairs[row['name']]
                 for row in packages),
             'actual five package-version rows match selected exact setup packages')
        qemu=next(row for row in packages if row['name']=='qemu-system-x86')
        need(qemu['version']=='1:8.2.2+ds-0ubuntu1.18' and qemu['architecture']=='amd64','historical selected inventory package')
        self.package_listings={}
        listed=[]
        for name in PACKAGE_NAMES:
            text=self.observe(SETUP_V7_PACKAGE_ROLES[name],['/usr/bin/dpkg-query','-L',name])
            paths=setup_v7_producer_listing(text)
            self.package_listings[name]=paths
            listed.extend(paths)
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
        value['probes']=setup_v7_probe_descriptors(value);value=self.candidate(value);raw=canonical(value);self.validate_candidate(raw)
        # Each actual inventory file/alias is reread before this candidate can
        # be exported. The candidate is still not approved for an actual run.
        for path,row in self.files.items():need(equal(self.ops.fact(path),{key:row[key] for key in ('bytes','sha256','mode')}),'inventory full selected file readback')
        for path,row in self.aliases.items():need(equal(self.ops.alias(path),row),'inventory full alias readback')
        self.partial['candidate']={'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode()}
        return raw


def setup_v7_listed_paths(raw):
    """Independent raw single-package dpkg-query -L grammar, without old union fiction."""
    need(type(raw) is bytes and 0<len(raw)<=16384 and raw.endswith(b'\n') and
         b'\r' not in raw and b'\0' not in raw,'bounded complete v7 package listing')
    try:lines=raw.decode('utf-8','strict').split('\n')[:-1]
    except UnicodeError as error:raise Refusal('v7 listing encoding') from error
    need(lines and lines[0]=='/.','one actual dpkg package root marker')
    # dpkg-query can append one empty section separator. It is formatting,
    # never an owned file path. Interior separators and repeated roots refuse.
    if lines and lines[-1]=='':lines.pop()
    need(lines and all(line!='' for line in lines),'no interior empty v7 listing row')
    paths=[]
    for line in lines[1:]:
        need(line!='/.','one package root marker')
        paths.append(runtime_path(line))
    need(paths and len(paths)<=2048 and len(paths)==len(set(paths)),
         'finite unique non-root package rows')
    return sorted(paths)


def setup_v7_probe_descriptors(value):
    paths={name:value['executables'][name]['path'] for name in ('node','python','qemu')}
    argv={role+'-version':[path,'--version'] for role,path in paths.items()}
    argv.update({'ldd-'+role:['/usr/bin/ldd',path] for role,path in paths.items()})
    argv.update({'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'],
        'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'ldd-tcg':['/usr/bin/ldd',resolve_alias(RUNTIME_TCG,value['aliases'])],
        'package-version':['/usr/bin/dpkg-query','-W',
            '-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]})
    argv.update({role:['/usr/bin/dpkg-query','-L',name]
                 for name,role in SETUP_V7_PACKAGE_ROLES.items()})
    result=[]
    for role,arguments in sorted(argv.items()):
        path=resolve_alias(arguments[0],value['aliases']);row=value['files'][path]
        result.append({'role':role,'argv':arguments,
            'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
            'executable':{'path':path,'bytes':row['bytes'],'sha256':row['sha256'],'mode':row['mode']}})
    need(len(result)==15,'exact fifteen v7 metadata descriptors')
    return result
setup_v7_status_rows=setup_v4_status_rows
setup_v7_status_delta=setup_v4_status_delta
setup_v7_cgroup_quiet=setup_v4_cgroup_quiet
def parse_setup_v7_outer(value):
    """Only the new combined setup/runtime or failed-entry packet has a 4 MiB cap."""
    need(type(value) is bytes and 0<len(value)<=4<<20,'versioned v7 outer JSON byte cap')
    def unique(pairs):
        result={}
        for key,item in pairs:
            need(key not in result,'duplicate v7 outer JSON key')
            result[key]=item
        return result
    def finite(token):
        value=float(token)
        need(math.isfinite(value),'nonfinite v7 outer JSON number')
        return value
    return json.loads(value.decode('utf-8'),object_pairs_hook=unique,parse_float=finite,
                      parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite v7 outer JSON')))


def setup_v7_policy():
    return {'imageOS':'ubuntu24','imageVersion':'20261012.334.1',
        'statusSha256':SETUP_V7_STATUS_SHA,
        'helperSha256':SETUP_V7_HELPERS,'helperAliases':SETUP_V7_HELPER_ALIASES,
        'packages':[{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':digest}
            for name,version,arch,filename,size,digest in SETUP_V7_PACKAGES],
        'configureOrder':list(SETUP_V7_ORDER),'unpackOptions':['--no-triggers','--unpack'],
        'configureOptions':['--no-triggers','--configure'],'policyPath':'/usr/sbin/policy-rc.d',
        'policyExit':101,'installerPath':'/usr/sbin:/usr/bin:/bin','deferredTriggers':True,'apt':False,'recommends':False,'force':False,
        'upgrade':False,'configurationComplete':False}


def setup_v7_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=32768 and digest(pin)==sha(raw),'externally selected v7 request')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage emptyPythonSources setup payloadWitness')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v7','canonical v7 request')
    base={key:value[key] for key in ('repository','pullRequest','head','tree','source','selected','nodeStage','emptyPythonSources')}
    base['schema']='bw.ring3.inventory-request.v3'
    old,source=staged_runtime_request(canonical(base),sha(canonical(base)))
    need(equal(value['setup'],setup_v7_policy()),'exact selected v7 setup policy')
    need(type(SETUP_V7_PAYLOAD_PINS) is dict and len(SETUP_V7_PAYLOAD_PINS['archives'])==15 and
         all((item['package'],item['archiveBytes'],item['archiveSha256'])==(name,size,digest)
             for item,(name,version,arch,filename,size,digest) in
             zip(SETUP_V7_PAYLOAD_PINS['archives'],SETUP_V7_PACKAGES)),
         'independent payload/archive selection join')
    need(SETUP_V7_PAYLOAD_PINS is not None and equal(value['payloadWitness'],SETUP_V7_PAYLOAD_PINS),
         'separately reviewed payload/control witness required')
    return value,source


def setup_v7_event(raw,request,pin,environment):
    event=parse(raw);pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V7\n';end='\nBW_RING3_SETUP_RUNTIME_INVENTORY_V7 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one v7 request block')
    block=body.split(start,1)[1].split(end,1)[0]
    encoded=environment.get('BW_RING3_SETUP_INVENTORY_V7_REQUEST_B64')
    need(block==pin and type(encoded) is str and 0<len(encoded)<=43692,
         'exact v7 SHA-only body and repository request')
    try:raw=base64.b64decode(encoded,validate=True)
    except (ValueError,TypeError) as error:raise Refusal('invalid v7 request base64') from error
    need(0<len(raw)<=32768 and base64.b64encode(raw).decode('ascii')==encoded and
         raw==canonical(request) and sha(raw)==pin,'exact immutable v7 request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-setup-runtime-inventory-v7' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==event['number'] and pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and pr['head']['repo'].get('fork') is False and
         pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'exact owned v7 event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {
        'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'setup-runtime-inventory-v7',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        'BW_RING3_SETUP_INVENTORY_V7_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),
        'exact v7 platform/source joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first v7 run identity');digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def decode_setup_v7_status_log(raw,required_roles=frozenset(('pre','post'))):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded official v7 log for status originals')
    result={}
    for line in raw.splitlines():
        at=line.find(SETUP_V7_STATUS_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical status original log timestamp')
        need(len(line[at:])+1<=1<<20,'one-MiB complete status log frame including LF')
        packet=parse(line[at+len(SETUP_V7_STATUS_MARKER):])
        keys(packet,'schema role rawBytes rawSha256 packedBytes packedSha256 encoding packed')
        role=packet['role'];need(packet['schema']=='bw.ring3.setup-status-original.v7' and
             role in ('pre','post') and role not in result and packet['encoding']=='zlib+base64',
             'one fixed raw pre/post status original')
        size=integer(packet['rawBytes'],1,8<<20);packed_size=integer(packet['packedBytes'],1,700<<10)
        digest(packet['rawSha256']);digest(packet['packedSha256'])
        need(type(packet['packed']) is str and len(packet['packed'])==4*((packed_size+2)//3),
             'exact bounded compressed status encoding')
        packed=base64.b64decode(packet['packed'],validate=True)
        need(base64.b64encode(packed).decode()==packet['packed'] and len(packed)==packed_size and
             sha(packed)==packet['packedSha256'],'exact compressed original bytes')
        decoder=zlib.decompressobj()
        decoded=decoder.decompress(packed,(8<<20)+1)
        need(len(decoded)<=8<<20 and decoder.eof and decoder.unused_data==b'' and
             decoder.unconsumed_tail==b'' and len(decoded)==size and
             sha(decoded)==packet['rawSha256'],
             'complete bounded single zlib stream and raw status SHA')
        result[role]={'raw':decoded,'meta':{'role':role,'bytes':size,'sha256':sha(decoded),
            'packedBytes':packed_size,'packedSha256':sha(packed)}}
    if required_roles is not None:
        need(set(result)==set(required_roles),'exact retained raw dpkg status original roles')
    return result


def setup_v7_facts(value,run_id,controller_pid,source_last_reap):
    keys(value,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    integer(controller_pid,1);integer(source_last_reap,1)
    need(value['schema']=='bw.ring3.setup-original.v7' and value['firstFailure'] is None and value['secondary']==[] and
         value['deferredHostTriggers'] is True and value['configurationComplete'] is False and
         value['nodeStage'] is None and value['runtime'] is None and value['partial'] is None,
         'complete setup facts before Node copy')
    pre=value['preflight'];keys(pre,'imageOS imageVersion imageFields imageFieldErrors statusSha256 statusBytes statusRecords statusOriginal helperSha256 helperWitness helperAliases resource policyAbsent newPackagesAbsent imageFieldsAuthenticated immutableImageIdentityEstablished')
    need(pre['imageOS']=='ubuntu24' and pre['imageVersion']=='20261012.334.1' and
         pre['imageFieldErrors']==[] and pre['imageFields']=={
             'ImageOS':{'present':True,'value':'ubuntu24'},
             'ImageVersion':{'present':True,'value':'20261012.334.1'}} and
         pre['statusSha256']==SETUP_V7_STATUS_SHA and
         integer(pre['statusBytes'],1,8<<20)==SETUP_V7_STATUS_BYTES and integer(pre['statusRecords'],1,5000)==1211 and
         equal(pre['helperSha256'],SETUP_V7_HELPERS) and
         equal(pre['helperAliases'],SETUP_V7_HELPER_ALIASES) and
         pre['policyAbsent'] is True and
         pre['newPackagesAbsent'] is True and pre['imageFieldsAuthenticated'] is False and
         pre['immutableImageIdentityEstablished'] is False,'fresh observed selected pre-state, no image-auth claim')
    witnesses=pre['helperWitness']
    need(type(witnesses) is dict and set(witnesses)==set(SETUP_V7_HELPERS),
         'ten named/held v7 helper witnesses')
    for path,pin in SETUP_V7_HELPERS.items():
        item=witnesses[path]
        keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
        need(item['path']==path and item['sha256']==pin and item['closeAttempted'] is True and
             item['closeSucceeded'] is True and item['namedBefore']==item['heldBefore']==
             item['heldAfter']==item['namedAfter'],'closed stable reported helper identity')
        info=item['heldBefore']
        need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
             type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
             item['bytesRead']==SETUP_V7_NEW_HELPER_BYTES.get(path,item['bytesRead']),
             'reported root-owned helper mode and signed new-helper extent')
    pre_original=pre['statusOriginal'];keys(pre_original,'role bytes sha256 packedBytes packedSha256')
    need(pre_original['role']=='pre' and pre_original['bytes']==pre['statusBytes'] and
         pre_original['sha256']==pre['statusSha256'] and
         integer(pre_original['packedBytes'],1,700<<10)>0 and
         digest(pre_original['packedSha256']),'held pre-status original summary')
    resource_row=pre['resource'];keys(resource_row,'membership limits')
    need(resource_row['membership']=='0::/system.slice/bw-ring3-setup-v7-'+run_id+'-1.service\n' and
         equal(resource_row['limits'],{'cpuMax':'100000 100000','memoryMax':'1073741824',
             'swapMax':'0','pidsMax':'64'}),'observed fixed outer setup cgroup limits')
    archives=value['archives'];need(type(archives) is list and len(archives)==15,'exact fifteen acquired archives')
    need(sum(row[4] for row in SETUP_V7_PACKAGES)==16400088 and all(row[4]<=12<<20 for row in SETUP_V7_PACKAGES),
         'fixed aggregate/per-archive bytes')
    archive_root='/run/bw-ring3-setup-v7-'+run_id+'-1/'
    for index,(item,(name,version,arch,filename,size,pin)) in enumerate(zip(archives,SETUP_V7_PACKAGES)):
        keys(item,'package path url bytes sha256 identity closeSucceeded')
        need(equal(item['package'],{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':pin}) and
             item['path']==archive_root+str(index).zfill(2)+'.deb' and
             item['url']=='https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+filename and
             type(item['bytes']) is int and item['bytes']==size and item['sha256']==pin and item['closeSucceeded'] is True,
             'ordered exact archive selected bytes/URL and closed observation')
        info=item['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o600 and info[3:7]==[0,0,1,size],
             'held root-owned regular archive fact')
    policy=value['policy'];keys(policy,'path identity sha256 mode exclusive')
    need(policy['path']=='/usr/sbin/policy-rc.d' and policy['sha256']==sha(b'#!/bin/sh\nexit 101\n') and
         policy['mode']==0o755 and policy['exclusive'] is True,'exact owned policy101 bytes/mode')
    info=policy['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
         stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o755 and info[3:7]==[0,0,1,19],
         'held owned policy identity')
    need(equal(value['cleanup'],{'removedExactOwnIdentity':True,'identity':info}),
         'same exact policy identity removed before Node stage')
    last=source_last_reap
    for phase,args in (('unpack',['--no-triggers','--unpack']+[item['path'] for item in archives]),
                       ('configure',['--no-triggers','--configure',*SETUP_V7_ORDER])):
        row=value[phase];keys(row,'argv process stdout stderr exitCode timedOut firstFailure secondary cgroupAfter')
        argv=['/usr/bin/dpkg',*args];need(equal(row['argv'],argv) and row['exitCode']==0 and row['timedOut'] is False and
             row['firstFailure'] is None and row['secondary']==[],'fixed no-triggers dpkg phase')
        start,end=v8_process(row['process'],'setup-v7',argv,
            SETUP_V7_INSTALLER_ENV,120000)
        need(row['process']['parentPid']==controller_pid and last<=start,
             'same root controller and Git/unpack/configure chronology')
        last=end
        census=row['cgroupAfter'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
        need(census['phase']==phase and
             setup_v7_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                                   census['cgroupStat'],controller_pid) and
             census['onlyController'] is True,'finite no-descendant setup phase census')
        for stream in ('stdout','stderr'):
            encoded=row[stream]
            if encoded is not None:need(len(prerequisite_original(canonical(encoded)))<=128<<10,'bounded dpkg original stream')
    need(value['unpack']['process']['reapMonoNs']<=value['configure']['process']['spawnMonoNs'],
         'unpack completed before configure')
    census=value['policyCleanupCgroup'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
    need(census['phase']=='policy-cleanup' and
         setup_v7_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                               census['cgroupStat'],controller_pid) and
         census['onlyController'] is True,
         'only root controller remained before global policy removal')
    post=value['postStatus'];keys(post,'sha256 bytes records selected pendingHostTriggers serviceObserved statusOriginal allSelectedPresent allowedStates deferredHostTriggers configurationComplete')
    digest(post['sha256']);integer(post['bytes'],1,8<<20);integer(post['records'],1,5000)
    post_original=post['statusOriginal'];keys(post_original,'role bytes sha256 packedBytes packedSha256')
    need(post_original['role']=='post' and post_original['bytes']==post['bytes'] and
         post_original['sha256']==post['sha256'] and
         integer(post_original['packedBytes'],1,700<<10)>0 and
         digest(post_original['packedSha256']),'held post-status original summary')
    need(post['allSelectedPresent'] is True and post['allowedStates'] is True and
         post['deferredHostTriggers'] is True and post['configurationComplete'] is False and
         type(post['selected']) is dict and set(post['selected'])=={row[0] for row in SETUP_V7_PACKAGES},
         'all selected post-status rows and deferred configuration')
    for name,version,arch,*_ in SETUP_V7_PACKAGES:
        row=post['selected'][name];keys(row,'Package Version Architecture Status Triggers-Pending Triggers-Awaited')
        need((row['Package'],row['Version'],row['Architecture'])==(name,version,arch) and
             row['Status'] in ('install ok installed','install ok triggers-pending','install ok triggers-awaited') and
             all(type(row[key]) in (str,type(None)) for key in ('Triggers-Pending','Triggers-Awaited')),
             'versioned selected package status, including pending trigger facts')
    pending=post['pendingHostTriggers']
    need(type(pending) is dict and len(pending)<=5000,'bounded actual host trigger rows')
    for name,row in pending.items():
        need(type(name) is str and re.fullmatch('[A-Za-z0-9.+-]+:(?:amd64|all)',name),
             'architecture-qualified host trigger package')
        keys(row,'status pending awaited')
        need(type(row['status']) is str and len(row['status'])<=128 and
             all(type(row[key]) in (str,type(None)) and (row[key] is None or len(row[key])<=4096)
                 for key in ('pending','awaited')) and
             (row['status'] in ('install ok triggers-pending','install ok triggers-awaited') or
              row['pending'] is not None or row['awaited'] is not None),'honest bounded pending host trigger fact')
    need(equal(post['serviceObserved'],{'unit':SETUP_V7_PAYLOAD_PINS['serviceUnit'],
        'init':SETUP_V7_PAYLOAD_PINS['initScript']}),
        'exact reviewed service unit and init script payload bytes; no service execution')
    return {'setupObserved':True,'deferredHostTriggers':True,'completeHostConfiguration':False,
        'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}


def setup_v7_stage_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity setup copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v7' and record['firstFailure'] is None and
         record['secondary']==[] and record['recordBoundary']==
         'verified copy after selected setup and policy cleanup, before directory publication',
         'closed v7 stage record')
    request_raw=prerequisite_original(canonical(record['request']));request,source=setup_v7_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(SETUP_V7_PLATFORM),'closed v7 stage platform')
    setup_v7_event(event_raw,request,pin,environment)
    need(equal(record['source'],source),'root Git/live source12 joins selected request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and
         copy['directoryPublicationAttempted'] is False and copy['filePublished'] is True and copy['directoryPublished'] is False and
         type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
         type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and
         copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
         copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],
         'fixed verified Node copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw v7 stage metadata')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and
         stat.S_ISREG(before[2]) and before[2]&0o6000==0 and before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],
         'held Node cache source extent/identity')
    file,directory=copy['file'],copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
         stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],
         'fixed staged Node file/directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original v7 source Git commands')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
            for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped v7 Git source checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed v7 Git command')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'sequential source Git children');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,
             'exact original source Git output')
    setup_v7_facts(record['setup'],environment['GITHUB_RUN_ID'],parent,previous)
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and event_meta['st_size']==len(event_raw) and
         stat.S_ISREG(event_meta['st_mode']),'held official event snapshot extent')
    return request,source


def observe_setup_v7_stage(environ):
    value={'schema':'bw.ring3.setup-node-observation.v7','stageObserved':False,'runtimeCandidate':False,
        'qualified':False,'record':None,'files':{},'directories':[],'source':{},'identity':None,
        'firstFailure':None,'secondary':[],'publicationSafe':False};backend=None
    def failed(error,phase):
        item={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),
             'known v7 dropped observer invoker')
        uid,gid=map(int,ids)
        need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],
             'actual irreversible dropped v7 IDs/groups')
        status=setup_proc_read('/proc/self/status');membership=setup_proc_read('/proc/self/cgroup')
        setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,
            'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid);value['publicationSafe']=True
        pin=digest(environ.get('BW_RING3_SETUP_INVENTORY_V7_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True)
        value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=setup_v7_stage_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],
             'same installer/dropped observer PID across exec')
        event_raw=prerequisite_original(canonical(record['event']));setup_v7_event(event_raw,request,pin,environ)
        need(set(environ)==set(SETUP_V7_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in SETUP_V7_PLATFORM}),
            'closed actual dropped platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat()
            need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                 stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),
                 'live dropped v7 source regular owner/mode')
            raw=inventory_file(target,4<<20)
            fact={'bytes':len(raw),'sha256':sha(raw),
                'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent dropped source12 bytes')
        backend.read('node')
        need(backend.facts['node']['before']==record['copy']['file'],'finite staged Node inode join')
        value['stageObserved']=True
    except BaseException as error:failed(error,'setup-v7-stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts
            value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'setup-v7-stage-close')
    return value


def setup_v7_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.setup-runtime-inventory-original.v7','stageBefore':None,'stageAfter':None,
        'parent':None,'inventory':None,'candidate':None,'firstFailure':None,'secondary':[],
        'publicationSafe':False,'actualGuestApproved':False,'completeHostConfiguration':False}
    originals={};inventory=None
    def failed(error,phase):
        item=getattr(error,'inventory_first',{'phase':phase,'name':type(error).__name__,'message':str(error)})
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
        value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    try:
        before=observe_setup_v7_stage(environ);value['stageBefore']=before
        value['publicationSafe']=before['publicationSafe']
        if before['firstFailure'] is not None:
            error=Refusal(before['firstFailure']['message']);error.inventory_first=before['firstFailure']
            error.inventory_secondary=before['secondary'];raise error
        need(before['stageObserved'] is True,'complete dropped v7 stage before metadata tools')
        record=parse(prerequisite_original(canonical(before['record'])))
        originals['setup.request.json']=prerequisite_original(canonical(record['request']))
        originals['setup.event.json']=prerequisite_original(canonical(record['event']))
        value['parent']=inventory_parent_availability()
        inventory=SetupV7Inventory(before['files']['node']['before'],files,probe)
        candidate=inventory.discover()
        value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:failed(error,'setup-v7-runtime-inventory')
    finally:
        if inventory is not None:
            value['inventory']=inventory.partial
            rejected=getattr(inventory.ops,'rejected',{})
            if rejected:value['inventory']['rejectedFiles']=rejected
        if value['stageBefore'] is not None and value['stageBefore']['stageObserved']:
            after=observe_setup_v7_stage(environ);value['stageAfter']=after
            if after['firstFailure'] is not None:
                error=Refusal(after['firstFailure']['message']);error.inventory_first=after['firstFailure']
                error.inventory_secondary=after['secondary'];failed(error,'setup-v7-stage-after')
            elif not all(equal(after[key],value['stageBefore'][key]) for key in ('record','files','directories','source')):
                failed(Refusal('v7 source/stage changed across metadata tools'),'setup-v7-stage-after')
    raw=canonical(value)
    if len(raw)>4<<20:
        error={'phase':'setup-v7-original-cap','name':'Refusal','message':'versioned v7 original cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.setup-runtime-inventory-overflow.v7',
            'firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),
            'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.setup-inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[],value['publicationSafe']


def emit_setup_v7_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<=set(SETUP_V7_LOG_ROLES) and
         all(type(raw) is bytes and 0<len(raw)<=4<<20 for raw in originals.values()) and
         sum(map(len,originals.values()))<=6<<20,'bounded v7 original roles')
    emitted=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072)
        raw_sha=sha(raw)
        need(count<=1821,'bounded v7 original chunk count')
        for index in range(count):
            line=SETUP_V7_LOG_MARKER+canonical({'schema':'bw.ring3.setup-runtime-inventory-log.v7',
                'name':name,'index':index,'count':count,'bytes':len(raw),'sha256':raw_sha,
                'data':encoded[index*3072:(index+1)*3072]})
            need(emitted+len(line)<=6<<20 and chunks<3000,'bounded six-MiB v7 runtime component')
            need(emit(line)==len(line),'complete v7 original log write')
            emitted+=len(line);chunks+=1
    flush()


def decode_setup_v7_log(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded v7 official log original')
    groups={};chunks=0;wire_bytes=0
    for line in raw.splitlines():
        at=line.find(SETUP_V7_LOG_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical v7 official log timestamp')
        wire_bytes+=len(line[at:])+1
        need(wire_bytes<=6<<20,'bounded six-MiB v7 runtime component wire')
        value=parse(line[at+len(SETUP_V7_LOG_MARKER):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.setup-runtime-inventory-log.v7' and value['name'] in SETUP_V7_LOG_ROLES,
             'closed v7 original log role')
        count=integer(value['count'],1,1821);index=integer(value['index'],0,count-1)
        extent=integer(value['bytes'],1,4<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded v7 base64 chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and
             index==len(group['parts']),'one ordered v7 original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<3000,'finite v7 log chunk count')
    need(set(groups)==set(SETUP_V7_LOG_ROLES),'three complete v7 originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete v7 chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and
             sha(value)==group['sha256'],'exact v7 original bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=6<<20,'bounded raw v7 aggregate')
    return originals


def verify_setup_v7_stage_observation(value,external):
    keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary publicationSafe')
    need(value['schema']=='bw.ring3.setup-node-observation.v7' and value['stageObserved'] is True and
         value['runtimeCandidate'] is False and value['qualified'] is False and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True,'complete actual v7 dropped stage observation')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw)
    request,source=setup_v7_stage_record(record,external['requestSha256'])
    env=record['platform'];need(request['head']==external['head'] and request['tree']==external['tree'] and
         env['GITHUB_RUN_ID']==external['runId'] and env['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,external['invoker'])),
         'external v7 source/platform/invoker joins')
    need(equal(value['source'],source['files']),'actual dropped source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*external['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],
         'installer/observer original PID continuity')
    setup_membership(identity['membership'],external['runId'])
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},
         'two independent v7 stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix')
        need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and
             equal(row['before'],row['namedAfter']),'closed stable v7 stage file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and
             all(type(x) is int for x in metadata) and stat.S_ISREG(metadata[2]) and
             metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'],'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444
        need(stat.S_IMODE(metadata[2])==mode,'fixed v7 stage mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent v7 staged bytes')
        if name=='node':
            need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],
                 'staged Node ELF/install join')
        else:need(row['prefix']==record_raw[:4].hex(),'held v7 record prefix')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==
         ['/','/run',str(NODE_STAGE_ROOT)],'fixed stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before']
        need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and
             (index!=2 or stat.S_IMODE(info[2])==0o555),'nonwritable root stage ancestor')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite stage directory inode join')
    return request,source,record


def setup_v7_cleanup_original(raw,external):
    value=parse(raw)
    keys(value,'schema runId serviceExitCode sourceAdmission preCensus stop postCensus cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-outside-cleanup.v7' and
         value['runId']==external['runId'] and value['setupApproved'] is False and
         type(value['secondary']) is list and len(value['secondary'])<=64 and
         (value['firstFailure'] is None or type(value['firstFailure']) is dict),
         'closed bounded v7 outside cleanup original')
    unit='bw-ring3-setup-v7-'+external['runId']+'-1.service'
    selected=value['sourceAdmission']
    if selected is None:
        need(value['preCensus'] is None and value['postCensus'] is None and value['stop'] is None and
             value['policy'] is None and value['action'] is None and value['firstFailure'] is not None,
             'no unit stop or policy mutation without source admission')
    else:
        keys(selected,'requestSha256 eventSha256 head tree source unit')
        need(selected['requestSha256']==external['requestSha256'] and
             selected['head']==external['head'] and selected['tree']==external['tree'] and
             selected['unit']==unit,'exact outside request/source/unit selection')
        digest(selected['eventSha256'])
        source=selected['source'];keys(source,'schema head tree files')
        need(source['schema']=='bw.ring3.source.v1' and source['head']==external['head'] and
             source['tree']==external['tree'] and type(source['files']) is dict and
             set(source['files'])==SETUP_SOURCE_PATHS and
             source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
             'outside selected source twelve and workflow')
    def census(row):
        if row is None:return None
        keys(row,'terminal cgroupProcs cgroupEvents cgroupStat')
        need(row['terminal'] in ('absent','empty','populated'),'closed v7 unit terminal state')
        if row['terminal']=='absent':
            need(all(row[key] is None for key in ('cgroupProcs','cgroupEvents','cgroupStat')),
                 'absent unit has no invented census')
        else:
            need(all(type(row[key]) is str and len(row[key].encode())<=1024 for key in
                     ('cgroupProcs','cgroupEvents','cgroupStat')) and
                 (setup_v7_cgroup_quiet(row['cgroupProcs'],row['cgroupEvents'],row['cgroupStat']) is
                  (row['terminal']=='empty')),
                 'independent exact nested unit census')
        return row
    pre=census(value['preCensus']);post=census(value['postCensus'])
    stop=value['stop']
    if selected is not None:
        if stop is None:
            need(pre is None and post is None and value['cgroupTerminal'] is None and
                 value['unitCensus'] is None and value['policy'] is None and
                 value['action'] is None and value['firstFailure'] is not None,
                 'admitted unit identity refusal retains no invented stop or census')
        else:
            keys(stop,'attempted argv exitCode timedOut')
        if stop is not None and stop['attempted'] is True:
            need(stop['argv']==['/usr/bin/timeout','--kill-after=5s','20s',
                 '/usr/bin/systemctl','stop','--',unit] and
                 (stop['exitCode'] is None or integer(stop['exitCode'],-255,255)>=-255) and
                 (stop['timedOut'] is None if stop['exitCode'] is None else
                  stop['timedOut']==(stop['exitCode'] in (124,137))),
                 'one bounded exact owned-unit stop')
        elif stop is not None:
            need(stop=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
                 (pre is None and value['firstFailure'] is not None or
                  pre is not None and pre['terminal'] in ('absent','empty') and
                  (value['serviceExitCode']==0 or pre['terminal']=='absent')),
                 'no stop needed only for terminal or absent unit')
        if post is not None:
            need(value['cgroupTerminal']==post['terminal'] and
                 (value['unitCensus'] is None if post['terminal']=='absent' else
                  value['unitCensus']=={key:post[key] for key in
                      ('cgroupProcs','cgroupEvents','cgroupStat')}),
                 'outside final census and terminal projection')
        else:need(value['cgroupTerminal'] is None and value['unitCensus'] is None,
                  'unknown outside terminal cannot claim census')
    return value


def setup_v7_inner_original(raw,external,shell):
    originals=decode_setup_v7_log(raw);value=parse_setup_v7_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v7' and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True and value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,'failure-free metadata-only v7 original')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v7_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and equal(observed,record),
                  'same v7 staged source/request/record before and after graph')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
        ('record','files','directories','source')),'finite stage readback across metadata graph')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'exact source/head/workflow/request/event original join')
    statuses=decode_setup_v7_status_log(raw)
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']),
         'exact separately retained raw status originals join setup packet')
    before=setup_v7_status_rows(statuses['pre']['raw'])
    need(len(before)==pre['statusRecords']==1211 and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V7_PACKAGES),
         'independent raw pre-status census and selected absence')
    after=setup_v7_status_rows(statuses['post']['raw'])
    need(len(after)==post['records'],'independent raw post-status census')
    setup_v7_status_delta(before,after)
    selected={};pending={}
    for name,version,arch,*_ in SETUP_V7_PACKAGES:
        row=after.get((name,arch))
        selected[name]=None if row is None else {key:row.get(key) for key in
            ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
    for (name,arch),row in after.items():
        if (row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
            row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None):
            pending[name+':'+arch]={'status':row.get('Status'),'pending':row.get('Triggers-Pending'),
                'awaited':row.get('Triggers-Awaited')}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']),
         'independent raw post-status selected/pending projection')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and stat.S_ISDIR(parent['meta'][2]) and
         parent['meta'][3:5]==[0,0] and parent['meta'][2]&0o022==0 and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},
         'finite root-owned parent availability')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful cgroup parent availability')
    result=verify_setup_v7_inventory_graph(value)
    candidate_raw=prerequisite_original(canonical(value['candidate']))
    candidate=setup_v7_runtime_expectation(candidate_raw,sha(candidate_raw))
    for package in candidate['packages']:
        row=post['selected'][package['name']]
        need(row['Version']==package['version'] and
             row['Architecture']==package['architecture'],
             'five named runtime versions independently join raw installed post-status')
    need(equal(value['inventory']['fileMetadata'][NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'graph Node file joins staged inode/mode/hash')
    need(all(entry['process']['parentPid']==value['stageBefore']['identity']['pid'] for entry in
        value['inventory']['processes']),'fifteen metadata children descend from dropped observer')
    need(all(entry['process']['spawnMonoNs']>=record['sourceCommands'][-1]['process']['reapMonoNs'] for entry in
        value['inventory']['processes']),'runtime probes follow root source admission')
    need(record['setup']['configure']['process']['reapMonoNs']<=
         value['inventory']['processes'][0]['process']['spawnMonoNs'],
         'all runtime probes follow completed no-trigger configure')
    need(record['setup']['preflight']['imageFields']==setup_v7_expected_forwarded(shell['fields']),
         'successful service image labels join shell forwarding')
    return result,record,source,event_raw,request_raw


def verify_setup_v7_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v7_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v7' and type(external['attempt']) is int and
         external['attempt']==1 and external['jobName']=='setup-runtime-inventory-v7' and
         external['conclusion']=='success','externally selected official v7 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive official v7 run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),'selected actual invoker')
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'externally selected exact official v7 log bytes')
    need(type(outer_raw) is bytes and integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'externally selected exact outside-owner terminal bytes')
    need(type(cleanup_raw) is bytes and integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'externally selected outside cleanup original')
    cleanup=setup_v7_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==0 and cleanup['sourceAdmission'] is not None and
         cleanup['stop']=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
         cleanup['preCensus'] is not None and cleanup['postCensus'] is not None and
         cleanup['cgroupTerminal'] in ('empty','absent') and cleanup['policy'] is None and
         cleanup['action']=='not-needed' and cleanup['firstFailure'] is None and
         cleanup['secondary']==[] and cleanup['setupApproved'] is False,
         'finite outside owner needed no policy cleanup after successful setup')
    need((cleanup['cgroupTerminal']=='absent' and cleanup['unitCensus'] is None) or
         (cleanup['cgroupTerminal']=='empty' and type(cleanup['unitCensus']) is dict and
          set(cleanup['unitCensus'])=={'cgroupProcs','cgroupEvents','cgroupStat'} and
          setup_v7_cgroup_quiet(cleanup['unitCensus']['cgroupProcs'],
              cleanup['unitCensus']['cgroupEvents'],cleanup['unitCensus']['cgroupStat'])),
         'independently checked outside nested cgroup emptiness')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v7' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v7-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and outer['systemdRunExitCode']==0 and
         type(outer['outsideCleanupExitCode']) is int and outer['outsideCleanupExitCode']==0 and
         outer['cgroupAfter']=='absent','finite outside-owner successful service terminal and absent cgroup')
    result,record,source,event_raw,request_raw=setup_v7_inner_original(raw,external,shell)
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins complete inner original')
    return dict(result,schema='bw.ring3.setup-runtime-inventory-admission.v7',setupObserved=True,
        shellImageFields=shell['fields'],serviceImageFields=record['setup']['preflight']['imageFields'],
        forwardingMatchesExpected=True,
        deferredHostTriggers=True,completeHostConfiguration=False,actualGuestApproved=False,
        outsideTerminalObserved=True,cgroupAfterAbsent=True,continuousOwnershipEstablished=False,
        officialJobAuthenticated=False,imageFieldsAuthenticated=False,
        immutableImageIdentityEstablished=False,candidateReviewed=False,actualRunApproved=False,
        rawStatusBytesIndependentlyVerified=True,ciArchiveBytesIndependentlyVerified=False)


def verify_setup_v7_failed_stream_inventory(raw,external,cleanup,shell,outer):
    """Retain a complete failed v7 metadata packet with one clipped child prefix."""
    originals=decode_setup_v7_log(raw)
    value=parse_setup_v7_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    first=value['firstFailure']
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v7' and
         value['candidate'] is None and value['publicationSafe'] is True and
         value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False and
         type(first) is dict and first=={'phase':'inventory-stream','name':'Refusal',
             'message':'inventory original stdout stream cap'} and
         type(value['secondary']) is list and len(value['secondary'])<=64,
         'complete failed v7 stream-cap original with no candidate')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v7_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and
                  equal(observed,record),'same failed v7 stage source before/after')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
             ('record','files','directories','source')),
         'failed v7 stage file and source readback')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and
         event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'failed v7 exact source/request/event originals')
    need(cleanup['sourceAdmission'] is not None and
         equal(cleanup['sourceAdmission']['source'],source) and
         cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
         'outside failed source/event admission joins inner originals')
    statuses=decode_setup_v7_status_log(raw)
    before=setup_v7_status_rows(statuses['pre']['raw'])
    after=setup_v7_status_rows(statuses['post']['raw'])
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']) and
         len(before)==pre['statusRecords']==1211 and
         len(after)==post['records'] and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V7_PACKAGES),
         'failed v7 separately retained raw status and baseline')
    setup_v7_status_delta(before,after)
    need(pre['imageFields']==setup_v7_expected_forwarded(shell['fields']),
         'failed metadata service/shell image forwarding')
    inventory=value['inventory']
    keys(inventory,'files aliases probes processes fileMetadata pythonFiles mappedLibraries mapsOriginal emptyPythonSources')
    need(type(inventory['files']) is dict and
         len(inventory['files'])<=512 and type(inventory['aliases']) is dict and
         len(inventory['aliases'])<=256 and
         type(inventory['probes']) is list and type(inventory['processes']) is list,
         'bounded partial graph reports no selected candidate')
    roles=SETUP_V7_PROBE_ORDER
    aliases=inventory['aliases']
    need(type(aliases) is dict and len(aliases)<=256,
         'bounded failed alias census for fixed argv')
    executables={'node':NODE_STAGE_TARGET,
        'python':resolve_alias('/usr/bin/python3',aliases),
        'qemu':resolve_alias(RUNTIME_QEMU,aliases)}
    fixed={'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'],
        'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'ldd-tcg':['/usr/bin/ldd',resolve_alias(RUNTIME_TCG,aliases)],
        'package-version':['/usr/bin/dpkg-query','-W',
            '-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]}
    fixed.update({'ldd-'+name:['/usr/bin/ldd',path]
                  for name,path in executables.items()})
    fixed.update({name+'-version':[path,'--version']
                  for name,path in executables.items()})
    fixed.update({role:['/usr/bin/dpkg-query','-L',name]
                  for name,role in SETUP_V7_PACKAGE_ROLES.items()})
    entries=inventory['processes'];probes=inventory['probes']
    setup_v7_observed_order(probes,entries,partial=True)
    last_end=0;parent=None
    for index,(entry,probe) in enumerate(zip(entries,probes)):
        keys(entry,'role process stdout stderr')
        keys(probe,'role argv environment exitCode stdout stderr')
        process=entry['process']
        keys(process,'schema argv environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
        need(process['schema']=='bw.ring3.inventory-process.v1' and
             equal(process['argv'],probe['argv']) and
             equal(probe['argv'],fixed[entry['role']]) and
             equal(process['environment'],probe['environment']) and
             probe['environment']=={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'} and
             type(probe['stdout']) is str and type(probe['stderr']) is str and
             len(probe['stdout'].encode('utf-8','surrogateescape'))<=16384 and
             len(probe['stderr'].encode('utf-8','surrogateescape'))<=16384 and
             prerequisite_original(canonical(entry['stdout']))==probe['stdout'].encode('utf-8','surrogateescape') and
             prerequisite_original(canonical(entry['stderr']))==probe['stderr'].encode('utf-8','surrogateescape'),
             'exact retained child process/stream prefix')
        if parent is None:parent=integer(process['parentPid'],1)
        start=integer(process['spawnMonoNs'],last_end)
        last_end=integer(process['reapMonoNs'],start)
        need(last_end-start<=10_000_000_000 and
             process['parentPid']==parent==value['stageBefore']['identity']['pid'] and
             integer(process['pid'],1)==process['pgid'] and
             process['timedOut'] is False,
             'finite serial owned metadata child prefix')
        if index<len(entries)-1:
            need(process['firstFailure'] is None and process['secondary']==[] and
                 process['exitCode']==probe['exitCode']==0 and probe['stderr']=='' and
                 process['waitStatus']==0 and process['signal'] is None,
                 'successful earlier v7 metadata children')
            if entry['role'] in SETUP_V7_PACKAGE_ROLES.values():
                setup_v7_listed_paths(probe['stdout'].encode('utf-8','surrogateescape'))
        else:
            need(process['firstFailure']==first and process['secondary']==value['secondary'] and
                 entry['stdout']['bytes']==16384,
                 'first stream cap and ordered secondary remain last child facts')
    # The last stream is only an explicit bounded prefix. Its final line and
    # complete per-package listing are unknown, even when bytes look valid.
    return {'schema':'bw.ring3.setup-failure-retention.v7',
        'failedAttemptRetained':True,'completeFailedInventoryOriginal':True,
        'firstFailure':first,'secondary':value['secondary'],
        'retainedProbePrefixRoles':list(roles[:len(entries)]),
        'lastStdoutPrefixBytes':entries[-1]['stdout']['bytes'],
        'lastPackageListingComplete':False,'candidateReviewed':False,
        'setupObserved':False,'actualGuestApproved':False,'actualRunApproved':False,
        'completeHostConfiguration':False,'officialJobAuthenticated':False,
        'outsideCleanup':cleanup['action'],'outsideCgroupAfter':outer['cgroupAfter'],
        'outerClientExitCode':outer['systemdRunExitCode'],
        'rawStatusBytesIndependentlyVerified':True,
        'ciArchiveBytesIndependentlyVerified':False}


def verify_setup_v7_failure_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    """Retain a bound failed attempt; never promote its partial facts to admission."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v7_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v7' and
         external['conclusion']=='failure' and external['attempt']==1 and
         external['jobName']=='setup-runtime-inventory-v7','externally selected failed v7 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive failed run identity')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),
         'selected failed-job invoker')
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and
         integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'exact externally selected failed log bytes')
    need(type(outer_raw) is bytes and 0<len(outer_raw)<=4096 and
         integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'exact failed outside terminal original')
    need(type(cleanup_raw) is bytes and 0<len(cleanup_raw)<=16384 and
         integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'exact failed outside cleanup original')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v7' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v7-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and 0<=outer['systemdRunExitCode']<=255 and
         type(outer['outsideCleanupExitCode']) is int and 0<=outer['outsideCleanupExitCode']<=255 and
         outer['cgroupAfter'] in ('present','absent') and
         (outer['systemdRunExitCode']!=0 or outer['outsideCleanupExitCode']!=0 or
          outer['cgroupAfter']!='absent'),'finite failed outside terminal facts')
    cleanup=setup_v7_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==outer['systemdRunExitCode'] and
         cleanup['setupApproved'] is False and type(cleanup['secondary']) is list and
         len(cleanup['secondary'])<=64,'finite failed outside cleanup facts')
    if cleanup['cgroupTerminal']=='empty':
        census=cleanup['unitCensus']
        need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
             setup_v7_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
             'independent empty nested outside census')
    elif cleanup['cgroupTerminal']=='absent':
        need(cleanup['unitCensus'] is None,'absent outside unit has no census')
    else:
        need(cleanup['firstFailure'] is not None,'uncertain outside cgroup remains failure')
        census=cleanup['unitCensus']
        if census is not None:
            need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
                 not setup_v7_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
                 'retained active nested outside census, never cleanup permission')
    packets=[]
    for line in raw.splitlines():
        at=line.find(b'{"actualGuestApproved":false,')
        if at<0:continue
        need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
             'canonical failed packet log prefix')
        need(len(line)-at<=4<<20,'bounded failed packet')
        packet=parse_setup_v7_outer(line[at:]);need(line[at:]==canonical(packet).rstrip(b'\n'),'canonical failed packet')
        if packet.get('schema')=='bw.ring3.setup-entry-failure.v7':packets.append(packet)
    if not packets:
        if b'RING3_SETUP_RUNTIME_INVENTORY_V7 ' in raw and outer['systemdRunExitCode']!=0:
            try:
                return verify_setup_v7_failed_stream_inventory(raw,external,cleanup,shell,outer)
            except (ValueError,UnicodeError):
                # Other complete failures remain refused until separately
                # reviewed. A timed truncated wire may still use the opaque
                # path below; it never acquires positive authority.
                if outer['systemdRunExitCode'] not in (124,137):raise
        # A complete inner metadata packet is still a failed attempt when the
        # bounded outer client exits nonzero or outside cleanup is uncertain.
        try:
            _,record,source,event_raw,_=setup_v7_inner_original(raw,external,shell)
        except (ValueError,UnicodeError) as decode_error:
            # A killed outer client can leave only a bounded prefix. Keep its
            # exact official bytes as opaque evidence; no inner fact is graded.
            need(outer['systemdRunExitCode'] in (124,137) and
                 cleanup['sourceAdmission'] is not None and
                 type(cleanup['firstFailure']) is dict and
                 cleanup['firstFailure'].get('phase')=='v7-outer-client',
                 'only source-admitted timed client permits opaque inner prefix')
            return {'schema':'bw.ring3.setup-failure-retention.v7',
                'failedAttemptRetained':True,'innerOriginalIncomplete':True,
                'innerMetadataCompleteReported':False,'innerDecodeError':type(decode_error).__name__,
                'retainedLogBytes':len(raw),'retainedLogSha256':sha(raw),
                'partialMutationPossible':True,'firstFailure':cleanup['firstFailure'],
                'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
                'outsideCgroupAfter':outer['cgroupAfter'],
                'outerClientExitCode':outer['systemdRunExitCode'],
                'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
                'shellImageFields':shell['fields'],'serviceImageFields':None,
                'forwardingMatchesExpected':None,'officialJobAuthenticated':False,
                'actualGuestApproved':False,'actualRunApproved':False,
                'candidateReviewed':False,'completeHostConfiguration':False}
        if cleanup['sourceAdmission'] is not None:
            need(equal(cleanup['sourceAdmission']['source'],source) and
                 cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
                 'outside source/event joins complete failed-job inner original')
        first=cleanup['firstFailure'] or {'phase':'v7-outside-terminal','name':'ValueError',
            'message':'bounded outside terminal or cleanup refusal'}
        return {'schema':'bw.ring3.setup-failure-retention.v7',
            'failedAttemptRetained':True,'innerMetadataCompleteReported':True,
            'partialMutationPossible':True,'firstFailure':first,
            'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
            'outsideCgroupAfter':outer['cgroupAfter'],
            'outerClientExitCode':outer['systemdRunExitCode'],
            'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
            'shellImageFields':shell['fields'],
            'serviceImageFields':record['setup']['preflight']['imageFields'],
            'forwardingMatchesExpected':True,'officialJobAuthenticated':False,
            'actualGuestApproved':False,'actualRunApproved':False,
            'candidateReviewed':False,'completeHostConfiguration':False}
    need(len(packets)==1,'one complete failed setup packet')
    packet=packets[0];keys(packet,'schema context setup firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(packet['schema']=='bw.ring3.setup-entry-failure.v7' and packet['publicationSafe'] is False and
         packet['actualGuestApproved'] is False and packet['completeHostConfiguration'] is False and
         type(packet['firstFailure']) is dict and type(packet['secondary']) is list and
         len(packet['secondary'])<=64,'failed packet with retained first and secondary')
    keys(packet['firstFailure'],'phase name message')
    context=packet['context'];keys(context,'request event platform source sourceCommands eventIdentity imageFields imageFieldErrors')
    setup_v7_image_observation(context['imageFields'],context['imageFieldErrors'])
    forwarding_matches=context['imageFields']==setup_v7_expected_forwarded(shell['fields'])
    request_raw=prerequisite_original(canonical(context['request']))
    request,source=setup_v7_request(request_raw,external['requestSha256'])
    event_raw=prerequisite_original(canonical(context['event']))
    need(type(context['platform']) is dict and set(context['platform'])==set(SETUP_V7_PLATFORM),
         'closed failed platform')
    environment=context['platform'];setup_v7_event(event_raw,request,external['requestSha256'],environment)
    need(environment['GITHUB_RUN_ID']==external['runId'] and
         environment['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         request['head']==external['head'] and request['tree']==external['tree'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(context['source'],source),'failed source/request/event/official context join')
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins failed inner original')
    need(type(context['sourceCommands']) is list and len(context['sourceCommands'])==3 and
         all(type(item) is dict and set(item)=={'argv','process','stdout','stderr'} for item in context['sourceCommands']),
         'three retained failed source command originals')
    commands=context['sourceCommands'];git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
                for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),
             'fixed failed source Git descriptor')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'exact failed source Git command')
        start,end=v8_process(command['process'],'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=command['process']['parentPid']
        need(start>=previous and command['process']['parentPid']==parent and
             prerequisite_original(canonical(command['stdout']))==outputs[index] and
             command['stderr'] is None,'causal failed source Git original')
        previous=end
    need(type(context['eventIdentity']) is dict and
         set(context['eventIdentity'])==set('st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns'.split()) and
         all(type(x) is int for x in context['eventIdentity'].values()) and
         context['eventIdentity']['st_size']==len(event_raw) and
         stat.S_ISREG(context['eventIdentity']['st_mode']),
         'failed held event extent')
    setup=packet['setup'];need(type(setup) is dict and setup.get('schema')=='bw.ring3.setup-original.v7' and
         setup.get('firstFailure') is not None and setup.get('nodeStage') is None and setup.get('runtime') is None,
         'only partial setup before Node stage')
    keys(setup,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    need(setup['configurationComplete'] is False and type(setup['secondary']) is list and
         len(setup['secondary'])<=64,'closed partial setup and secondary')
    partial=setup['partial']
    preflight_prefix=None
    if setup['preflight'] is None:
        need(type(partial) is dict and partial.get('phase')=='preflight',
             'failed preflight has a typed retained prefix')
        keys(partial,'phase prefix failedHelper')
        preflight_prefix=partial['prefix']
        keys(preflight_prefix,'statusOriginal statusSha256 statusBytes statusRecords completedHelpers helperWitness imageFields imageFieldErrors')
        setup_v7_image_observation(preflight_prefix['imageFields'],preflight_prefix['imageFieldErrors'])
        need(preflight_prefix['imageFields']==context['imageFields'] and
             preflight_prefix['imageFieldErrors']==context['imageFieldErrors'],
             'failed preflight retains exact entry image observation')
        completed=preflight_prefix['completedHelpers'];witnesses=preflight_prefix['helperWitness']
        need(type(completed) is list and type(witnesses) is dict and
             completed==list(SETUP_V7_HELPERS)[:len(completed)] and
             set(witnesses)==set(completed),'ordered bounded successful helper prefix')
        status_meta=preflight_prefix['statusOriginal']
        if status_meta is None:
            need(preflight_prefix['statusSha256'] is None and preflight_prefix['statusBytes'] is None and
                 preflight_prefix['statusRecords'] is None and completed==[],
                 'no fabricated pre-status or helper facts before observation')
        else:
            keys(status_meta,'role bytes sha256 packedBytes packedSha256')
            need(status_meta['role']=='pre' and status_meta['sha256']==preflight_prefix['statusSha256'] and
                 status_meta['bytes']==preflight_prefix['statusBytes'] and
                 integer(status_meta['bytes'],1,8<<20)>0 and
                 integer(status_meta['packedBytes'],1,700<<10)>0 and
                 digest(status_meta['packedSha256'])==status_meta['packedSha256'],
                 'bounded retained preflight status summary')
            if preflight_prefix['statusRecords'] is not None:
                integer(preflight_prefix['statusRecords'],1,5000)
            need(not completed or preflight_prefix['statusRecords']==1211,
                 'helper prefix follows full selected pre-status census')
        for path in completed:
            item=witnesses[path];keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(item['path']==path and item['sha256']==SETUP_V7_HELPERS[path] and
                 item['closeAttempted'] is True and item['closeSucceeded'] is True and
                 item['namedBefore']==item['heldBefore']==item['heldAfter']==item['namedAfter'],
                 'completed helper prefix has stable reported identity')
            info=item['heldBefore']
            need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
                 stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
                 type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
                 item['bytesRead']==SETUP_V7_NEW_HELPER_BYTES.get(path,item['bytesRead']),
                 'bounded known successful helper witness')
        failed=partial['failedHelper']
        helper_attempt=bool(completed) or failed is not None
        if helper_attempt:
            need(status_meta is not None and preflight_prefix['statusSha256']==SETUP_V7_STATUS_SHA and
                 preflight_prefix['statusBytes']==SETUP_V7_STATUS_BYTES and
                 preflight_prefix['statusRecords']==1211,
                 'helper attempt follows exact selected pre-status baseline')
        if failed is not None:
            keys(failed,'phase witness')
            item=failed['witness']
            keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(failed['phase']=='helper' and len(completed)<len(SETUP_V7_HELPERS) and
                 item['path']==list(SETUP_V7_HELPERS)[len(completed)] and
                 integer(item['bytesRead'],0,2<<20)>=0 and
                 type(item['closeAttempted']) is bool and type(item['closeSucceeded']) is bool and
                 (item['sha256'] is None or digest(item['sha256'])==item['sha256']),
                 'bounded failing helper position and partial byte count')
            for key in ('namedBefore','heldBefore','heldAfter','namedAfter'):
                info=item[key]
                need(info is None or (type(info) is list and len(info)==8 and
                     all(type(n) is int for n in info)),
                     'bounded partial helper metadata')
    if type(partial) is dict and partial.get('phase')=='node-stage':
        keys(partial,'phase copy record dropProgress invoker')
        need(type(partial['copy']) is dict and
             set(partial['copy'])==set('created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory'.split()) and
             type(partial['dropProgress']) is list and
             partial['dropProgress']==['groups','gid','uid','ids-verified'][:len(partial['dropProgress'])] and
             equal(partial['invoker'],external['invoker']),
             'retained bounded failed Node copy/drop progress')
        if partial['record'] is not None:
            keys(partial['record'],'bytes sha256')
            integer(partial['record']['bytes'],1,1<<20);digest(partial['record']['sha256'])
    required_roles=set()
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        fact=setup[key]
        if type(fact) is dict and fact.get('statusOriginal') is not None:
            required_roles.add(role)
    statuses=decode_setup_v7_status_log(raw,None)
    roles=set(statuses)
    if preflight_prefix is not None and preflight_prefix['statusOriginal'] is not None:
        required_roles.add('pre')
        need('pre' in roles and equal(statuses['pre']['meta'],preflight_prefix['statusOriginal']) and
             sha(statuses['pre']['raw'])==preflight_prefix['statusSha256'] and
             len(statuses['pre']['raw'])==preflight_prefix['statusBytes'],
             'raw failed preflight status joins retained prefix')
        if preflight_prefix['statusRecords'] is not None:
            pre_rows=setup_v7_status_rows(statuses['pre']['raw'])
            need(len(pre_rows)==preflight_prefix['statusRecords'],
                 'raw failed preflight census joins retained prefix')
            if helper_attempt:
                need(not any(name in {key[0] for key in pre_rows} for name,*_ in SETUP_V7_PACKAGES),
                     'selected fifteen absent before any helper attempt')
    need(required_roles<=roles,'all reported failed status originals retained')
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        if role in roles:
            fact=setup[key]
            if role in required_roles and type(fact) is dict:
                need(type(fact) is dict and equal(statuses[role]['meta'],fact['statusOriginal']) and
                    statuses[role]['meta']['sha256']==fact[hash_key] and
                    statuses[role]['meta']['bytes']==fact[size_key],
                    'independent retained failed raw status original join')
            rows=setup_v7_status_rows(statuses[role]['raw'])
            if role in required_roles and type(fact) is dict:
                need(len(rows)==fact['statusRecords' if role=='pre' else 'records'],
                     'retained failed raw status census')
            if role=='pre' and role in required_roles and type(fact) is dict:
                need(fact['statusSha256']==SETUP_V7_STATUS_SHA and
                     fact['statusBytes']==SETUP_V7_STATUS_BYTES,
                     'failed pre-state remains fixed selected baseline')
    need(setup['firstFailure']==packet['firstFailure'] or
         packet['firstFailure']['phase']=='v7-entry','retained setup/entry first failure relationship')
    return {'schema':'bw.ring3.setup-failure-retention.v7','failedAttemptRetained':True,
        'partialMutationPossible':True,'firstFailure':packet['firstFailure'],
        'secondary':packet['secondary'],'outsideCleanup':cleanup['action'],
        'outsideCgroupAfter':outer['cgroupAfter'],
        'outerClientExitCode':outer['systemdRunExitCode'],
        'outsideFirstFailure':cleanup['firstFailure'],
        'outsideSecondary':cleanup['secondary'],'setupObserved':False,
        'shellImageFields':shell['fields'],'serviceImageFields':context['imageFields'],
        'forwardingMatchesExpected':forwarding_matches,
        'stageAttemptObserved':type(partial) is dict and partial.get('phase')=='node-stage',
        'retainedStatusRoles':sorted(roles),'statusRolesJoinedToSetup':sorted(required_roles),
        'rawStatusBytesIndependentlyVerified':bool(roles),
        'ciArchiveBytesIndependentlyVerified':False,
        'officialJobAuthenticated':False,'actualGuestApproved':False,
        'candidateReviewed':False,'actualRunApproved':False}



IMAGE_DIAG_LABEL='x86-ring3-image-env-diagnostic-v1'
IMAGE_DIAG_JOB='image-env-diagnostic-v1'
IMAGE_DIAG_PIN='BW_RING3_IMAGE_ENV_DIAGNOSTIC_REQUEST_SHA256'
IMAGE_DIAG_B64='BW_RING3_IMAGE_ENV_DIAGNOSTIC_REQUEST_B64'
IMAGE_DIAG_MARKER=b'RING3_IMAGE_ENV_DIAGNOSTIC_V1 '


def image_diag_fields(fields,allow_refused=False):
    keys(fields,'ImageOS ImageVersion')
    for name in ('ImageOS','ImageVersion'):
        row=fields[name];keys(row,'present value')
        need(type(row['present']) is bool,'image field presence type')
        value=row['value']
        if not row['present']:
            need(value is None,'absent image field remains null')
        else:
            if allow_refused and value is None:continue
            need(type(value) is str and len(value.encode('utf-8'))<=256 and
                 all(32<=ord(ch)<127 for ch in value),'bounded observed image field')
    return fields


def image_diag_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=65536 and digest(pin)==sha(raw),
         'externally selected image diagnostic request')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source')
    need(raw==canonical(value) and value['schema']=='bw.ring3.image-env-request.v1' and
         value['repository']=='CrispStrobe/bw-board' and type(value['pullRequest']) is int and
         0<value['pullRequest']<2**31,'canonical own image diagnostic request')
    digest(value['head'],40);digest(value['tree'],40)
    source_raw=prerequisite_original(canonical(value['source']))
    source=parse(source_raw);keys(source,'schema head tree files')
    need(source_raw==canonical(source) and source['schema']=='bw.ring3.source.v1' and
         source['head']==value['head'] and source['tree']==value['tree'] and
         type(source['files']) is dict and set(source['files'])==SETUP_SOURCE_PATHS,
         'closed exact image diagnostic source twelve')
    for row in source['files'].values():
        keys(row,'mode blob bytes sha256')
        need(row['mode']=='100644','regular source role');integer(row['bytes'],0,4<<20)
        digest(row['sha256']);digest(row['blob'],40)
    return value,source


def image_diag_event(raw,request,pin,environment):
    event=parse(raw);pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_IMAGE_ENV_DIAGNOSTIC_V1\n';end='\nBW_RING3_IMAGE_ENV_DIAGNOSTIC_V1 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),
         'one distinct image diagnostic block')
    block=body.split(start,1)[1].split(end,1)[0]
    need(block==pin and type(environment.get(IMAGE_DIAG_B64)) is str and
         environment[IMAGE_DIAG_B64]==base64.b64encode(canonical(request)).decode('ascii'),
         'exact SHA-only body marker and external canonical request base64')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')==IMAGE_DIAG_LABEL and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and
         event.get('sender',{}).get('login')=='CrispStrobe' and type(event.get('number')) is int and
         event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==request['pullRequest'] and pr.get('state')=='open' and
         pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and
         pr['head']['repo'].get('fork') is False and pr.get('base',{}).get('ref')=='master' and
         pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'one own image diagnostic event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {
        'GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':IMAGE_DIAG_JOB,'GITHUB_RUN_ATTEMPT':'1',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        IMAGE_DIAG_PIN:pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge',
    }.items()),'exact image diagnostic environment')
    need(type(environment.get('GITHUB_RUN_ID')) is str and
         re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first image diagnostic run');digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def image_diag_source_witness(commands,event_meta,event_raw,request,source):
    need(type(commands) is list and len(commands)==3,'three held source Git observations')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],
           ['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
                for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),
             'scoped image diagnostic Git checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed source Git command')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'sequential source Git children')
        previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and
             command['stderr'] is None,'exact held source Git bytes')
    keys(event_meta,'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    need(all(type(x) is int for x in event_meta.values()) and
         event_meta['st_size']==len(event_raw) and stat.S_ISREG(event_meta['st_mode']),
         'held official event snapshot extent')
    return parent,previous


def verify_image_diag(shell_raw,service_log,outside_raw,external):
    keys(external,'schema runId attempt head tree requestSha256 workflowSha jobName conclusion')
    need(external['schema']=='bw.ring3.image-env-expectation.v1' and
         external['jobName']==IMAGE_DIAG_JOB and external['attempt']=='1' and
         external['conclusion'] in ('success','failure'),'external selected image diagnostic job')
    digest(external['head'],40);digest(external['tree'],40);digest(external['requestSha256'])
    digest(external['workflowSha'],40)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'external exact run')
    need(type(shell_raw) is bytes and 0<len(shell_raw)<=4096 and
         shell_raw==canonical(parse(shell_raw)),'canonical bounded shell original')
    shell=parse(shell_raw);keys(shell,'schema fields firstFailure secondary setupAttempted guestAttempted')
    need(shell['schema']=='bw.ring3.image-env-shell.v1' and shell['setupAttempted'] is False and
         shell['guestAttempted'] is False,'read-only shell original')
    image_diag_fields(shell['fields'],shell['firstFailure'] is not None)
    shell_refused={name for name in ('ImageOS','ImageVersion')
        if shell['fields'][name]=={'present':True,'value':None}}
    shell_codes=[] if shell['firstFailure'] is None else [shell['firstFailure'],*shell['secondary']]
    need(type(shell['secondary']) is list and len(shell_codes)<=2 and
         all(type(item) is dict and set(item)=={'phase','code'} and
             item['phase']=='shell-image-fields' and type(item['code']) is str and
             item['code'] in {name+':'+reason for name in ('ImageOS','ImageVersion')
                 for reason in ('type','encoding','unsafe-or-oversize')} for item in shell_codes) and
         {item['code'].split(':')[0] for item in shell_codes}==shell_refused and
         len(shell_codes)==len(shell_refused),'shell malformed field refusal joins null values')
    need(type(service_log) is bytes and 0<len(service_log)<=1<<20,'bounded service original log')
    lines=[]
    for line in service_log.splitlines():
        at=line.find(IMAGE_DIAG_MARKER)
        if at>=0:
            need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
                 'bounded service log timestamp prefix')
            lines.append(line[at+len(IMAGE_DIAG_MARKER):])
    need(len(lines)==1,'one complete image diagnostic service original')
    service=parse(lines[0]);need(lines[0]+b'\n'==canonical(service),'canonical service original')
    keys(service,'schema fields fieldErrors expected request event source sourceCommands eventIdentity resource platform firstFailure secondary setupAttempted guestAttempted imageFieldsAuthenticated')
    need(service['schema']=='bw.ring3.image-env-service.v1' and
         service['expected']=={'ImageOS':'ubuntu24','ImageVersion':'20261012.334.1'} and
         service['setupAttempted'] is False and service['guestAttempted'] is False and
         service['imageFieldsAuthenticated'] is False,'no setup or guest authority')
    image_diag_fields(service['fields'],service['firstFailure'] is not None)
    need(type(service['fieldErrors']) is list and len(service['fieldErrors'])<=2 and
         all(type(item) is str and item in {name+':'+reason for name in ('ImageOS','ImageVersion')
             for reason in ('type','encoding','unsafe-or-oversize')} for item in service['fieldErrors']),
         'bounded malformed image field classes')
    service_refused={name for name in ('ImageOS','ImageVersion')
        if service['fields'][name]=={'present':True,'value':None}}
    need({item.split(':')[0] for item in service['fieldErrors']}==service_refused and
         len(service['fieldErrors'])==len(service_refused) and
         (not service_refused or service['firstFailure'] is not None),
         'malformed fields retained without raw unsafe text')
    need(type(outside_raw) is bytes and 0<len(outside_raw)<=4096 and
         outside_raw==canonical(parse(outside_raw)),'canonical bounded outside original')
    outside=parse(outside_raw);keys(outside,'schema runId unit shellExitCode serviceExitCode cgroupAfter cleanupAction')
    need(outside['schema']=='bw.ring3.image-env-outside.v1' and outside['runId']==external['runId'] and
         outside['unit']=='/sys/fs/cgroup/system.slice/bw-ring3-image-env-'+external['runId']+'-1.service' and
         outside['cgroupAfter'] in ('absent','present') and outside['cleanupAction']=='none' and
         type(outside['shellExitCode']) is int and type(outside['serviceExitCode']) is int and
         0<=outside['shellExitCode']<=255 and 0<=outside['serviceExitCode']<=255,
         'outside finite terminal observation without mutation')
    complete=service['firstFailure'] is None and shell['firstFailure'] is None
    if complete:
        need(service['secondary']==[] and shell['secondary']==[] and outside['shellExitCode']==0 and
             outside['serviceExitCode']==0 and
             outside['cgroupAfter']=='absent' and external['conclusion']=='success',
             'complete diagnostic and absent owned cgroup')
        request_raw=prerequisite_original(canonical(service['request']))
        request,source=image_diag_request(request_raw,external['requestSha256'])
        need(request['head']==external['head'] and request['tree']==external['tree'] and
             service['source']==source,'reported exact source twelve')
        event_raw=prerequisite_original(canonical(service['event']))
        image_diag_source_witness(service['sourceCommands'],service['eventIdentity'],event_raw,
                                  request,source)
        environment={'GITHUB_RUN_ID':external['runId'],'GITHUB_RUN_ATTEMPT':'1',
            'GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
            'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':IMAGE_DIAG_JOB,
            'GITHUB_WORKFLOW_SHA':external['workflowSha'],
            'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge',
            'BW_EXPECTED_HEAD':external['head'],'BW_EXPECTED_TREE':external['tree'],
            IMAGE_DIAG_PIN:external['requestSha256'],
            IMAGE_DIAG_B64:base64.b64encode(request_raw).decode('ascii')}
        need(service['platform']==environment,'reported service context joins external selection')
        image_diag_event(event_raw,request,external['requestSha256'],environment)
        need(service['resource']=={'membership':'0::/system.slice/bw-ring3-image-env-'+external['runId']+'-1.service\n',
            'limits':{'cpuMax':'100000 100000','memoryMax':'1073741824','swapMax':'0','pidsMax':'64'}},
            'same owned bounded service resource report')
    else:
        need(external['conclusion']=='failure' and type(service['secondary']) is list and
             type(shell['secondary']) is list and
             (outside['shellExitCode']!=0 or outside['serviceExitCode']!=0 or
              outside['cgroupAfter']!='absent'),'bounded failed image diagnostic original')
    expected_forwarded={name:{'present':True,
        'value':shell['fields'][name]['value'] if shell['fields'][name]['present'] else ''}
        for name in ('ImageOS','ImageVersion')}
    forwarding_matches=service['fields']==expected_forwarded
    return {'schema':'bw.ring3.image-env-reader.v1',
            'reportedConsistent':complete and forwarding_matches,
            'completeDiagnosticObserved':complete,
            'shellFields':shell['fields'],'serviceFields':service['fields'],
            'shellEqualsService':shell['fields']==service['fields'],
            'expectedForwardedFields':expected_forwarded,
            'forwardingMatchesExpected':forwarding_matches,
            'serviceMatchesPinnedImage':service['fields']=={
                'ImageOS':{'present':True,'value':'ubuntu24'},
                'ImageVersion':{'present':True,'value':'20261012.334.1'}},
            'firstFailure':service['firstFailure'] or shell['firstFailure'],
            'outsideCgroupAfter':outside['cgroupAfter'],
            'officialJobAuthenticated':False,'setupApproved':False,'actualGuestApproved':False,
            'runtimeCandidateApproved':False}


# Distinct v8 independent metadata reader; old v7 original decoder is unchanged.
SETUP_V8_SIGNED_DATA={
    '/usr/share/qemu/QEMU,VGA.bin':{'bytes':1112,'sha256':'0598d03abae4525c40e48e8d638a2342cc44056ab034ae91a737843a891e050a','mode':0o644},
    '/usr/share/qemu/QEMU,cgthree.bin':{'bytes':850,'sha256':'a99f3a06fdac5cf5d72bd0fd24647d897302c3ff8e918add65168185f8cbdf4d','mode':0o644},
    '/usr/share/qemu/QEMU,tcx.bin':{'bytes':1402,'sha256':'92da99a770ab24f96c33c78382940cac8b25e88cb110634c1b32aa2d8cb852e7','mode':0o644},
}
SETUP_V8_DATA_ARCHIVE={'bytes':1796342,'sha256':'a14b88d864859bd61c8a3274971da4ecb7da6cec15be6c265d0d411f783d5f2e',
    'dataTarSha256':'366faf3142552bf087d80de2eacf711da319e6431f6deb0096472465beb5ac0f',
    'payloadManifestSha256':'4941b090a1a1c23ac46be87b095e4dac9d24cc62409c849969a3a33041c9ce3f'}

def setup_v8_path(path,package=None,kind=None):
    if path in SETUP_V8_SIGNED_DATA:
        need(package=='qemu-system-data' and kind=='qemu-data',
             'three signed DATA names only in selected package data role')
        need(type(path) is str and len(path.encode('ascii'))<=256 and
             posixpath.normpath(path)==path and not path.startswith('//'),
             'exact canonical selected DATA name')
        return path
    return runtime_path(path)

def setup_v8_file_path(path):
    return setup_v8_path(path,package='qemu-system-data',kind='qemu-data') if path in SETUP_V8_SIGNED_DATA else runtime_path(path)

class SetupV8Files(StagedInventoryFiles):
    """Independent metadata/hash reader; no producer code or mutable setup API."""
    def __init__(self):self.prefixes={};self.metadata={};self.maps_original=None;self.rejected={}

    def resolve(self,path,seen=()):
        setup_v8_file_path(path);need(path not in seen and len(seen)<16,'bounded independent inventory aliases')
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
        setup_v8_file_path(path)
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
            if path in SETUP_V8_SIGNED_DATA:
                signed=SETUP_V8_SIGNED_DATA[path]
                need(before.st_size==signed['bytes'] and stat.S_IMODE(before.st_mode)==signed['mode'] and
                     (before.st_uid,before.st_gid,before.st_nlink)==(0,0,1),
                     'selected DATA exact regular extent and owner before byte read')
            while True:
                cap=SETUP_V8_SIGNED_DATA[path]['bytes'] if path in SETUP_V8_SIGNED_DATA else 268435456
                part=os.read(fd,min(65536,cap+1-count))
                if not part:break
                count+=len(part);need(count<=cap,'inventory file extent cap');digest.update(part)
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
            if '.so' in Path(path).name or Path(path).name.startswith('ld-'):paths.add(setup_v8_file_path(path))
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



def setup_v8_image_observation(fields,errors):
    image_diag_fields(fields,True)
    need(type(errors) is list and len(errors)<=2 and len(errors)==len(set(errors)) and
         all(type(e) is str and re.fullmatch(r'Image(?:OS|Version):(type|encoding|unsafe-or-oversize)',e)
             for e in errors),'bounded v8 image field refusal')
    for name,row in fields.items():
        need((row['present'] and row['value'] is None)==any(e.startswith(name+':') for e in errors),
             'image refusal code matches retained field')
    return fields


def decode_setup_v8_shell(raw,external):
    need(type(raw) is bytes and 0<len(raw)<=4096 and
         integer(external['shellBytes'],1,4096)==len(raw) and
         digest(external['shellSha256'])==sha(raw),
         'externally selected exact v8 shell image original')
    value=parse(raw);keys(value,'schema fields fieldErrors setupAttempted guestAttempted setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-image-shell.v8' and
         value['setupAttempted'] is False and value['guestAttempted'] is False and
         value['setupApproved'] is False,'canonical no-setup v8 shell observation')
    setup_v8_image_observation(value['fields'],value['fieldErrors'])
    return value


def setup_v8_expected_forwarded(fields):
    return {name:{'present':True,'value':row['value'] if row['present'] else ''}
        for name,row in fields.items()}


def setup_v8_runtime_expectation(raw,expected_sha256):
    """Standalone stable-policy admission. Raw ASLR text is never its pin."""
    need(type(raw) is bytes and 0<len(raw)<=256<<10 and digest(expected_sha256)==sha(raw),'external runtime expectation original pin')
    value=parse(raw);keys(value,'schema platform executables versions files aliases packages packagePaths probes emptyPythonSources packagePathsByPackage')
    need(raw==canonical(value) and value['schema']=='bw.ring3.runtime-expectation.v4','canonical explicit runtime expectation version')
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
        setup_v8_path(path,'qemu-system-data',row.get('kind')) if path in SETUP_V8_SIGNED_DATA else runtime_path(path);keys(row,'bytes sha256 kind mode');total+=integer(row['bytes'],1,268435456);digest(row['sha256'])
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
    setup_pairs={name:(version,arch) for name,version,arch,*_ in SETUP_V8_PACKAGES
                 if name in PACKAGE_NAMES}
    need(set(setup_pairs)==set(PACKAGE_NAMES) and
         all((row['version'],row['architecture'])==setup_pairs[row['name']]
             for row in packages),
         'independent five package-version rows match exact setup selection')
    paths=value['packagePaths'];need(type(paths) is list and 0<len(paths)<=2048 and paths==sorted(set(paths)),'bounded sorted stable package path union')
    for path in paths:setup_v8_file_path(path)
    by_package=value['packagePathsByPackage']
    need(type(by_package) is dict and set(by_package)==set(PACKAGE_NAMES),
         'five named original package-list projections')
    for name,listed in by_package.items():
        need(type(listed) is list and listed and len(listed)<=2048 and
             listed==sorted(set(listed)),'sorted unique single-package listing')
        for path in listed:setup_v8_path(path,name,'qemu-data')
    need(set(SETUP_V8_SIGNED_DATA)<=set(by_package['qemu-system-data']) and
         all(not (set(listed)&set(SETUP_V8_SIGNED_DATA)) for name,listed in by_package.items()
             if name!='qemu-system-data'),
         'all three exact signed DATA names belong only to qemu-system-data')
    for path,signed in SETUP_V8_SIGNED_DATA.items():
        need(path in files and path not in aliases and
             files[path]['kind']=='qemu-data' and
             {key:files[path][key] for key in ('bytes','sha256','mode')}==signed and
             resolve_alias(path,aliases)==path,
             'three selected installed DATA regular bytes, hash, mode and no alias')
    need(paths==sorted(set(path for listed in by_package.values() for path in listed)),
         'independent sorted non-root union of five package listings')
    module=resolve_alias(RUNTIME_TCG,aliases);need(module in files and files[module]['kind']=='tcg-module' and RUNTIME_TCG in paths,'selected i386 TCG module')
    required={value['executables']['qemu']['path'],module}|{path for path,row in files.items() if row['kind']=='qemu-data'}
    need(any(row['kind']=='qemu-data' for row in files.values()) and required<={resolve_alias(path,aliases) for path in paths},'selected QEMU package file ownership')
    need(equal(value['probes'],setup_v8_probe_descriptors(value)),'complete fixed probe descriptor/executable roster')
    return value


def verify_setup_v8_stable_original(original,candidate_raw,pin):
    selected=setup_v8_runtime_expectation(candidate_raw,pin)
    keys(original,'schema observationPolicy platform executables versions qemuPackage')
    need(original['schema']=='bw.ring3.runtime.v8' and
         original['observationPolicy']=='prelaunch-probes-and-before-after-file-readback' and
         equal(original['platform'],selected['platform']) and
         equal(original['executables'],selected['executables']) and
         equal(original['versions'],selected['versions']),
         'selected v8 runtime identity and observation policy')
    package=original['qemuPackage'];keys(package,'name version architecture files aliases probes')
    qemu=next(row for row in selected['packages'] if row['name']=='qemu-system-x86')
    need(all(package[key]==qemu[key] for key in ('name','version','architecture')) and
         equal(package['aliases'],selected['aliases']) and
         equal(package['files'],{path:{key:row[key] for key in ('bytes','sha256','kind')}
             for path,row in selected['files'].items()}),
         'exact selected runtime graph in v8 original')
    descriptors={item['role']:item for item in selected['probes']}
    probes=package['probes'];need(type(probes) is list and len(probes)==15,
        'fifteen real runtime metadata observations')
    setup_v8_observed_order(probes)
    seen=set();module=resolve_alias(RUNTIME_TCG,selected['aliases'])
    for probe in probes:
        keys(probe,'role argv environment exitCode stdout stderr')
        role=probe['role'];need(role in descriptors and role not in seen,
            'one original per fixed v8 descriptor');seen.add(role)
        expected=descriptors[role]
        need(equal(probe['argv'],expected['argv']) and
             equal(probe['environment'],expected['environment']) and
             type(probe['exitCode']) is int and probe['exitCode']==0 and
             type(probe['stdout']) is str and
             len(probe['stdout'].encode('utf-8','surrogateescape'))<=16384 and
             probe['stderr']=='','bounded clean v8 probe original')
        if role in SETUP_V8_PACKAGE_ROLES.values():
            name=next(name for name,named in SETUP_V8_PACKAGE_ROLES.items() if named==role)
            paths=setup_v8_listed_paths(probe['stdout'].encode('utf-8','surrogateescape'),name)
            need(paths==selected['packagePathsByPackage'][name],
                 'raw named package listing joins selected projection')
        elif role=='package-version':
            rows=[line.split('\t') for line in probe['stdout'].splitlines()]
            need(sorted(rows)==[[row['name'],row['version'],row['architecture']]
                for row in selected['packages']],'raw selected package versions')
        elif role.endswith('-version'):
            name=role[:-8]
            need(probe['stdout'].splitlines() and
                 probe['stdout'].splitlines()[0]==selected['versions'][name],
                 'selected version original')
        elif role.startswith('ldd-'):
            for path in ldd_paths(probe['stdout']):
                need(resolve_alias(path,selected['aliases']) in selected['files'],
                     'raw ldd library joins selected graph')
    need(seen==set(descriptors) and len(descriptors)==15,
         'complete fifteen-role v8 original roster')
    used={selected['executables']['qemu']['path'],module}|{
        path for path,row in selected['files'].items() if row['kind']=='qemu-data'}
    need(used<={resolve_alias(path,selected['aliases']) for path in selected['packagePaths']},
         'raw package owned selected engine/module/data')
    return selected


def verify_setup_v8_inventory_graph(value):
    candidate_raw=prerequisite_original(canonical(value['candidate']));candidate=setup_v8_runtime_expectation(candidate_raw,sha(candidate_raw))
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
        if path in SETUP_V8_SIGNED_DATA:
            need(metadata[3:6]==[0,0,1] and row['kind']=='qemu-data' and
                 {key:row[key] for key in ('bytes','sha256','mode')}==SETUP_V8_SIGNED_DATA[path],
                 'independent selected DATA regular root identity, bytes and mode')
    qemu=next(row for row in candidate['packages'] if row['name']=='qemu-system-x86')
    runtime_original={'schema':'bw.ring3.runtime.v8','observationPolicy':'prelaunch-probes-and-before-after-file-readback','platform':candidate['platform'],
        'executables':candidate['executables'],'versions':candidate['versions'],'qemuPackage':{'name':qemu['name'],'version':qemu['version'],'architecture':qemu['architecture'],
        'files':{path:{key:row[key] for key in ('bytes','sha256','kind')} for path,row in candidate['files'].items()},'aliases':candidate['aliases'],'probes':inventory['probes']}}
    verify_setup_v8_stable_original(runtime_original,candidate_raw,sha(candidate_raw))
    processes=inventory['processes'];need(type(processes) is list and len(processes)==15,'complete exact metadata probe process originals')
    setup_v8_observed_order(inventory['probes'],processes)
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



SETUP_V8_READER_ENABLED=True  # Metadata only; independent official-original admission remains required.
SETUP_V8_PACKAGES=SETUP_V4_PACKAGES
SETUP_V8_ORDER=SETUP_V4_ORDER
SETUP_V8_STATUS_SHA=SETUP_V4_STATUS_SHA
SETUP_V8_STATUS_BYTES=SETUP_V4_STATUS_BYTES
SETUP_V8_PAYLOAD_PINS=SETUP_V4_PAYLOAD_PINS
SETUP_V8_HELPERS=dict(SETUP_V4_HELPERS,**{
    '/usr/sbin/start-stop-daemon':'81faf821fdfdf1dc2991b71dfbd6a21116085f931bfeb0fd7b2623911a4831b4',
    '/usr/sbin/ldconfig':'bfd5df90c7f070feab584435f106f254ffffaa268a04de5b5c3bd61d59c092f3',
    '/usr/sbin/ldconfig.real':'d879c9a8a41240aeb7fd0f3221116fc4cf41cc6c64c24e10541d1bafbe537ab1',
})
SETUP_V8_HELPER_ALIASES=dict(SETUP_V4_HELPER_ALIASES,**{
    '/sbin':{'linkText':'usr/sbin','target':'/usr/sbin','uid':0,'gid':0,'nlink':1,'size':8},
})
SETUP_V8_NEW_HELPER_BYTES={'/usr/sbin/start-stop-daemon':48632,
    '/usr/sbin/ldconfig':387,'/usr/sbin/ldconfig.real':1051280}
SETUP_V8_INSTALLER_ENV={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/sbin:/usr/bin:/bin'}
SETUP_V8_PLATFORM=tuple('BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256' if key=='BW_RING3_NODE_STAGE_REQUEST_SHA256' else key
    for key in NODE_STAGE_PLATFORM)+('BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64',)
SETUP_V8_STATUS_MARKER=b'RING3_SETUP_STATUS_V8 '
SETUP_V8_LOG_MARKER=b'RING3_SETUP_RUNTIME_INVENTORY_V8 '
SETUP_V8_LOG_ROLES=SETUP_V4_LOG_ROLES
SETUP_V8_PACKAGE_ROLES={name:'package-files-'+name for name in PACKAGE_NAMES}
SETUP_V8_PROBE_ROLES=(RUNTIME_ROLES-{'package-files'})|set(SETUP_V8_PACKAGE_ROLES.values())
SETUP_V8_PROBE_ORDER=('ldd-shell','ldd-dpkg-query','ldd-node','ldd-python',
    'ldd-qemu','package-version',*(SETUP_V8_PACKAGE_ROLES[name] for name in PACKAGE_NAMES),
    'ldd-tcg','node-version','python-version','qemu-version')
assert len(SETUP_V8_PROBE_ORDER)==15 and set(SETUP_V8_PROBE_ORDER)==SETUP_V8_PROBE_ROLES


def setup_v8_observed_order(probes,processes=None,partial=False):
    need(type(probes) is list and (1<=len(probes)<=15 if partial else len(probes)==15) and
         [item['role'] for item in probes]==list(SETUP_V8_PROBE_ORDER[:len(probes)]),
         'exact serial fifteen-role v8 probe order')
    if processes is not None:
        need(type(processes) is list and len(processes)==len(probes) and
             [item['role'] for item in processes]==list(SETUP_V8_PROBE_ORDER[:len(probes)]),
             'each real child retains the same fixed v8 role order')


def setup_v8_producer_listing(text,name):
    need(type(text) is str and 0<len(text.encode('utf-8','surrogateescape'))<=16384 and
         text.endswith('\n') and '\r' not in text and '\0' not in text,
         'one complete bounded package listing')
    lines=text.split('\n')[:-1]
    need(lines and lines[0]=='/.','one real package root marker')
    if lines and lines[-1]=='':lines.pop()
    need(lines and all(line!='' for line in lines),'no interior package separator')
    paths=[]
    for line in lines[1:]:
        need(line!='/.','no repeated package root')
        paths.append(setup_v8_path(line,name,'qemu-data'))
    need(paths and len(paths)<=2048 and len(paths)==len(set(paths)),
         'bounded unique package file paths')
    return sorted(paths)


class SetupV8Inventory(StagedRuntimeInventory):
    """Scoped DATA path policy after all five complete named package listings."""
    def __init__(self,stage_node,files=None,probe=None):
        super().__init__(stage_node,SetupV8Files() if files is None else files,probe)
        self.package_listings={}

    def add(self,path,kind):
        if path in SETUP_V8_SIGNED_DATA:
            need(kind=='qemu-data' and
                 path in self.package_listings.get('qemu-system-data',[]) and
                 sum(path in rows for rows in self.package_listings.values())==1,
                 'signed DATA name only after selected complete package listing')
            selected=SETUP_V8_SIGNED_DATA[path]
            resolved,aliases=self.ops.resolve(setup_v8_path(path,'qemu-system-data',kind))
            need(resolved==path and aliases=={},'signed DATA regular name has no alias or prefix redirect')
            need(path not in self.aliases,'signed DATA name cannot be an alias')
            if path not in self.files:
                need(len(self.files)+len(STAGED_EMPTY_PYTHON_SOURCES)<512,
                     'shared positive and typed-empty inventory file cap')
                fact=self.ops.fact(path)
                need({key:fact[key] for key in ('bytes','sha256','mode')}==selected,
                     'actual complete selected DATA bytes, hash and mode')
                info=self.ops.metadata[path]
                need(type(info) is list and len(info)==8 and
                     stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o644 and
                     info[3:6]==[0,0,1] and info[6]==selected['bytes'],
                     'selected DATA root-owned regular stat, extent and link count')
                self.files[path]={**fact,'kind':kind}
                need(sum(row['bytes'] for row in self.files.values())<=1073741824,
                     'held inventory graph extent')
            else:
                need(self.files[path]['kind']==kind and
                     {key:self.files[path][key] for key in ('bytes','sha256','mode')}==selected,
                     'selected DATA repeated readback remains exact')
            return path
        return super().add(runtime_path(path),kind)

    def argv(self,role):
        for name,named_role in SETUP_V8_PACKAGE_ROLES.items():
            if role==named_role:return ['/usr/bin/dpkg-query','-L',name]
        return super().argv(role)

    def candidate(self,value):
        need(set(STAGED_EMPTY_PYTHON_SOURCES)<=set(self.partial['pythonFiles']),
             'v8 typed empty Python source census')
        return dict(value,schema='bw.ring3.runtime-expectation.v4',
                    emptyPythonSources=parse(canonical(STAGED_EMPTY_PYTHON_SOURCES)),
                    packagePathsByPackage=self.package_listings)

    def validate_candidate(self,raw):return setup_v8_runtime_expectation(raw,sha(raw))

    def discover(self):
        need(not self.staged_attempted,'v8 stage inventory consumed; no retry')
        self.staged_attempted=True;self.partial={'emptyPythonSources':self.empty_originals}
        try:
            self.empty_read('before');raw=self.discover_core();self.empty_read('after')
            verify_staged_empty_python(self.empty_originals);return raw
        finally:self.partial['emptyPythonSources']=self.empty_originals

    def observe(self,role,argv):
        need(role in SETUP_V8_PROBE_ROLES and len(self.probes)<15 and
             role==SETUP_V8_PROBE_ORDER[len(self.probes)],
             'next fixed v8 serial metadata child before process factory')
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

    def discover_core(self):
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
        setup_pairs={name:(version,arch) for name,version,arch,*_ in SETUP_V8_PACKAGES
                     if name in PACKAGE_NAMES}
        need(set(setup_pairs)==set(PACKAGE_NAMES) and
             all((row['version'],row['architecture'])==setup_pairs[row['name']]
                 for row in packages),
             'actual five package-version rows match selected exact setup packages')
        qemu=next(row for row in packages if row['name']=='qemu-system-x86')
        need(qemu['version']=='1:8.2.2+ds-0ubuntu1.18' and qemu['architecture']=='amd64','historical selected inventory package')
        self.package_listings={}
        listed=[]
        for name in PACKAGE_NAMES:
            text=self.observe(SETUP_V8_PACKAGE_ROLES[name],['/usr/bin/dpkg-query','-L',name])
            paths=setup_v8_producer_listing(text,name)
            self.package_listings[name]=paths
            listed.extend(paths)
        need(listed and len(set(listed))<=2048,'bounded inventory package path union')
        for path in listed:setup_v8_file_path(path)
        need(set(SETUP_V8_SIGNED_DATA)<=set(self.package_listings['qemu-system-data']) and
             all(not (set(paths)&set(SETUP_V8_SIGNED_DATA)) for name,paths in self.package_listings.items()
                 if name!='qemu-system-data'),
             'three signed DATA names in only the complete selected package listing')
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
        value['probes']=setup_v8_probe_descriptors(value);value=self.candidate(value);raw=canonical(value);self.validate_candidate(raw)
        # Each actual inventory file/alias is reread before this candidate can
        # be exported. The candidate is still not approved for an actual run.
        for path,row in self.files.items():need(equal(self.ops.fact(path),{key:row[key] for key in ('bytes','sha256','mode')}),'inventory full selected file readback')
        for path,row in self.aliases.items():need(equal(self.ops.alias(path),row),'inventory full alias readback')
        self.partial['candidate']={'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode()}
        return raw


def setup_v8_listed_paths(raw,name):
    """Independent raw single-package dpkg-query -L grammar, without old union fiction."""
    need(type(raw) is bytes and 0<len(raw)<=16384 and raw.endswith(b'\n') and
         b'\r' not in raw and b'\0' not in raw,'bounded complete v8 package listing')
    try:lines=raw.decode('utf-8','strict').split('\n')[:-1]
    except UnicodeError as error:raise Refusal('v8 listing encoding') from error
    need(lines and lines[0]=='/.','one actual dpkg package root marker')
    # dpkg-query can append one empty section separator. It is formatting,
    # never an owned file path. Interior separators and repeated roots refuse.
    if lines and lines[-1]=='':lines.pop()
    need(lines and all(line!='' for line in lines),'no interior empty v8 listing row')
    paths=[]
    for line in lines[1:]:
        need(line!='/.','one package root marker')
        paths.append(setup_v8_path(line,name,'qemu-data'))
    need(paths and len(paths)<=2048 and len(paths)==len(set(paths)),
         'finite unique non-root package rows')
    return sorted(paths)


def setup_v8_probe_descriptors(value):
    paths={name:value['executables'][name]['path'] for name in ('node','python','qemu')}
    argv={role+'-version':[path,'--version'] for role,path in paths.items()}
    argv.update({'ldd-'+role:['/usr/bin/ldd',path] for role,path in paths.items()})
    argv.update({'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'],
        'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'ldd-tcg':['/usr/bin/ldd',resolve_alias(RUNTIME_TCG,value['aliases'])],
        'package-version':['/usr/bin/dpkg-query','-W',
            '-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]})
    argv.update({role:['/usr/bin/dpkg-query','-L',name]
                 for name,role in SETUP_V8_PACKAGE_ROLES.items()})
    result=[]
    for role,arguments in sorted(argv.items()):
        path=resolve_alias(arguments[0],value['aliases']);row=value['files'][path]
        result.append({'role':role,'argv':arguments,
            'environment':{'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
            'executable':{'path':path,'bytes':row['bytes'],'sha256':row['sha256'],'mode':row['mode']}})
    need(len(result)==15,'exact fifteen v8 metadata descriptors')
    return result
setup_v8_status_rows=setup_v4_status_rows
setup_v8_status_delta=setup_v4_status_delta
setup_v8_cgroup_quiet=setup_v4_cgroup_quiet
def parse_setup_v8_outer(value):
    """Only the new combined setup/runtime or failed-entry packet has a 4 MiB cap."""
    need(type(value) is bytes and 0<len(value)<=4<<20,'versioned v8 outer JSON byte cap')
    def unique(pairs):
        result={}
        for key,item in pairs:
            need(key not in result,'duplicate v8 outer JSON key')
            result[key]=item
        return result
    def finite(token):
        value=float(token)
        need(math.isfinite(value),'nonfinite v8 outer JSON number')
        return value
    return json.loads(value.decode('utf-8'),object_pairs_hook=unique,parse_float=finite,
                      parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite v8 outer JSON')))


def setup_v8_policy():
    return {'imageOS':'ubuntu24','imageVersion':'20261012.334.1',
        'statusSha256':SETUP_V8_STATUS_SHA,
        'helperSha256':SETUP_V8_HELPERS,'helperAliases':SETUP_V8_HELPER_ALIASES,
        'packages':[{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':digest}
            for name,version,arch,filename,size,digest in SETUP_V8_PACKAGES],
        'configureOrder':list(SETUP_V8_ORDER),'unpackOptions':['--no-triggers','--unpack'],
        'configureOptions':['--no-triggers','--configure'],'policyPath':'/usr/sbin/policy-rc.d',
        'policyExit':101,'installerPath':'/usr/sbin:/usr/bin:/bin','deferredTriggers':True,'apt':False,'recommends':False,'force':False,
        'upgrade':False,'configurationComplete':False}


def setup_v8_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=32768 and digest(pin)==sha(raw),'externally selected v8 request')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage emptyPythonSources setup payloadWitness')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v8','canonical v8 request')
    base={key:value[key] for key in ('repository','pullRequest','head','tree','source','selected','nodeStage','emptyPythonSources')}
    base['schema']='bw.ring3.inventory-request.v3'
    old,source=staged_runtime_request(canonical(base),sha(canonical(base)))
    need(equal(value['setup'],setup_v8_policy()),'exact selected v8 setup policy')
    need(type(SETUP_V8_PAYLOAD_PINS) is dict and len(SETUP_V8_PAYLOAD_PINS['archives'])==15 and
         all((item['package'],item['archiveBytes'],item['archiveSha256'])==(name,size,digest)
             for item,(name,version,arch,filename,size,digest) in
             zip(SETUP_V8_PAYLOAD_PINS['archives'],SETUP_V8_PACKAGES)),
         'independent payload/archive selection join')
    need(SETUP_V8_PAYLOAD_PINS is not None and equal(value['payloadWitness'],SETUP_V8_PAYLOAD_PINS),
         'separately reviewed payload/control witness required')
    selected_archive=next(item for item in value['payloadWitness']['archives']
                          if item['package']=='qemu-system-data')
    need(selected_archive['archiveBytes']==SETUP_V8_DATA_ARCHIVE['bytes'] and
         selected_archive['archiveSha256']==SETUP_V8_DATA_ARCHIVE['sha256'] and
         selected_archive['dataTarSha256']==SETUP_V8_DATA_ARCHIVE['dataTarSha256'] and
         selected_archive['payloadManifestSha256']==SETUP_V8_DATA_ARCHIVE['payloadManifestSha256'],
         'independent signed DATA archive/tar/manifest selection')
    return value,source


def setup_v8_event(raw,request,pin,environment):
    need(type(raw) is bytes and 0<len(raw)<=CAPS['jsonBytes'],'bounded raw v8 event')
    try:event=parse_setup_v8_outer(raw)
    except (ValueError,UnicodeError,OverflowError) as error:
        raise Refusal('finite duplicate-free v8 event JSON') from error
    need(type(event) is dict,'object v8 event')
    pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V8\n';end='\nBW_RING3_SETUP_RUNTIME_INVENTORY_V8 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one v8 request block')
    block=body.split(start,1)[1].split(end,1)[0]
    encoded=environment.get('BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64')
    need(block==pin and type(encoded) is str and 0<len(encoded)<=43692,
         'exact v8 SHA-only body and repository request')
    try:raw=base64.b64decode(encoded,validate=True)
    except (ValueError,TypeError) as error:raise Refusal('invalid v8 request base64') from error
    need(0<len(raw)<=32768 and base64.b64encode(raw).decode('ascii')==encoded and
         raw==canonical(request) and sha(raw)==pin,'exact immutable v8 request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-setup-runtime-inventory-v8' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==event['number'] and pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and pr['head']['repo'].get('fork') is False and
         pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'exact owned v8 event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {
        'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'setup-runtime-inventory-v8',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        'BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),
        'exact v8 platform/source joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first v8 run identity');digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def decode_setup_v8_status_log(raw,required_roles=frozenset(('pre','post'))):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded official v8 log for status originals')
    result={}
    for line in raw.splitlines():
        at=line.find(SETUP_V8_STATUS_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical status original log timestamp')
        need(len(line[at:])+1<=1<<20,'one-MiB complete status log frame including LF')
        packet=parse(line[at+len(SETUP_V8_STATUS_MARKER):])
        keys(packet,'schema role rawBytes rawSha256 packedBytes packedSha256 encoding packed')
        role=packet['role'];need(packet['schema']=='bw.ring3.setup-status-original.v8' and
             role in ('pre','post') and role not in result and packet['encoding']=='zlib+base64',
             'one fixed raw pre/post status original')
        size=integer(packet['rawBytes'],1,8<<20);packed_size=integer(packet['packedBytes'],1,700<<10)
        digest(packet['rawSha256']);digest(packet['packedSha256'])
        need(type(packet['packed']) is str and len(packet['packed'])==4*((packed_size+2)//3),
             'exact bounded compressed status encoding')
        packed=base64.b64decode(packet['packed'],validate=True)
        need(base64.b64encode(packed).decode()==packet['packed'] and len(packed)==packed_size and
             sha(packed)==packet['packedSha256'],'exact compressed original bytes')
        decoder=zlib.decompressobj()
        decoded=decoder.decompress(packed,(8<<20)+1)
        need(len(decoded)<=8<<20 and decoder.eof and decoder.unused_data==b'' and
             decoder.unconsumed_tail==b'' and len(decoded)==size and
             sha(decoded)==packet['rawSha256'],
             'complete bounded single zlib stream and raw status SHA')
        result[role]={'raw':decoded,'meta':{'role':role,'bytes':size,'sha256':sha(decoded),
            'packedBytes':packed_size,'packedSha256':sha(packed)}}
    if required_roles is not None:
        need(set(result)==set(required_roles),'exact retained raw dpkg status original roles')
    return result


def setup_v8_facts(value,run_id,controller_pid,source_last_reap):
    keys(value,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    integer(controller_pid,1);integer(source_last_reap,1)
    need(value['schema']=='bw.ring3.setup-original.v8' and value['firstFailure'] is None and value['secondary']==[] and
         value['deferredHostTriggers'] is True and value['configurationComplete'] is False and
         value['nodeStage'] is None and value['runtime'] is None and value['partial'] is None,
         'complete setup facts before Node copy')
    pre=value['preflight'];keys(pre,'imageOS imageVersion imageFields imageFieldErrors statusSha256 statusBytes statusRecords statusOriginal helperSha256 helperWitness helperAliases resource policyAbsent newPackagesAbsent imageFieldsAuthenticated immutableImageIdentityEstablished')
    need(pre['imageOS']=='ubuntu24' and pre['imageVersion']=='20261012.334.1' and
         pre['imageFieldErrors']==[] and pre['imageFields']=={
             'ImageOS':{'present':True,'value':'ubuntu24'},
             'ImageVersion':{'present':True,'value':'20261012.334.1'}} and
         pre['statusSha256']==SETUP_V8_STATUS_SHA and
         integer(pre['statusBytes'],1,8<<20)==SETUP_V8_STATUS_BYTES and integer(pre['statusRecords'],1,5000)==1211 and
         equal(pre['helperSha256'],SETUP_V8_HELPERS) and
         equal(pre['helperAliases'],SETUP_V8_HELPER_ALIASES) and
         pre['policyAbsent'] is True and
         pre['newPackagesAbsent'] is True and pre['imageFieldsAuthenticated'] is False and
         pre['immutableImageIdentityEstablished'] is False,'fresh observed selected pre-state, no image-auth claim')
    witnesses=pre['helperWitness']
    need(type(witnesses) is dict and set(witnesses)==set(SETUP_V8_HELPERS),
         'ten named/held v8 helper witnesses')
    for path,pin in SETUP_V8_HELPERS.items():
        item=witnesses[path]
        keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
        need(item['path']==path and item['sha256']==pin and item['closeAttempted'] is True and
             item['closeSucceeded'] is True and item['namedBefore']==item['heldBefore']==
             item['heldAfter']==item['namedAfter'],'closed stable reported helper identity')
        info=item['heldBefore']
        need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
             type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
             item['bytesRead']==SETUP_V8_NEW_HELPER_BYTES.get(path,item['bytesRead']),
             'reported root-owned helper mode and signed new-helper extent')
    pre_original=pre['statusOriginal'];keys(pre_original,'role bytes sha256 packedBytes packedSha256')
    need(pre_original['role']=='pre' and pre_original['bytes']==pre['statusBytes'] and
         pre_original['sha256']==pre['statusSha256'] and
         integer(pre_original['packedBytes'],1,700<<10)>0 and
         digest(pre_original['packedSha256']),'held pre-status original summary')
    resource_row=pre['resource'];keys(resource_row,'membership limits')
    need(resource_row['membership']=='0::/system.slice/bw-ring3-setup-v8-'+run_id+'-1.service\n' and
         equal(resource_row['limits'],{'cpuMax':'100000 100000','memoryMax':'1073741824',
             'swapMax':'0','pidsMax':'64'}),'observed fixed outer setup cgroup limits')
    archives=value['archives'];need(type(archives) is list and len(archives)==15,'exact fifteen acquired archives')
    need(sum(row[4] for row in SETUP_V8_PACKAGES)==16400088 and all(row[4]<=12<<20 for row in SETUP_V8_PACKAGES),
         'fixed aggregate/per-archive bytes')
    archive_root='/run/bw-ring3-setup-v8-'+run_id+'-1/'
    for index,(item,(name,version,arch,filename,size,pin)) in enumerate(zip(archives,SETUP_V8_PACKAGES)):
        keys(item,'package path url bytes sha256 identity closeSucceeded')
        need(equal(item['package'],{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':pin}) and
             item['path']==archive_root+str(index).zfill(2)+'.deb' and
             item['url']=='https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+filename and
             type(item['bytes']) is int and item['bytes']==size and item['sha256']==pin and item['closeSucceeded'] is True,
             'ordered exact archive selected bytes/URL and closed observation')
        info=item['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o600 and info[3:7]==[0,0,1,size],
             'held root-owned regular archive fact')
    policy=value['policy'];keys(policy,'path identity sha256 mode exclusive')
    need(policy['path']=='/usr/sbin/policy-rc.d' and policy['sha256']==sha(b'#!/bin/sh\nexit 101\n') and
         policy['mode']==0o755 and policy['exclusive'] is True,'exact owned policy101 bytes/mode')
    info=policy['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
         stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o755 and info[3:7]==[0,0,1,19],
         'held owned policy identity')
    need(equal(value['cleanup'],{'removedExactOwnIdentity':True,'identity':info}),
         'same exact policy identity removed before Node stage')
    last=source_last_reap
    for phase,args in (('unpack',['--no-triggers','--unpack']+[item['path'] for item in archives]),
                       ('configure',['--no-triggers','--configure',*SETUP_V8_ORDER])):
        row=value[phase];keys(row,'argv process stdout stderr exitCode timedOut firstFailure secondary cgroupAfter')
        argv=['/usr/bin/dpkg',*args];need(equal(row['argv'],argv) and row['exitCode']==0 and row['timedOut'] is False and
             row['firstFailure'] is None and row['secondary']==[],'fixed no-triggers dpkg phase')
        start,end=v8_process(row['process'],'setup-v8',argv,
            SETUP_V8_INSTALLER_ENV,120000)
        need(row['process']['parentPid']==controller_pid and last<=start,
             'same root controller and Git/unpack/configure chronology')
        last=end
        census=row['cgroupAfter'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
        need(census['phase']==phase and
             setup_v8_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                                   census['cgroupStat'],controller_pid) and
             census['onlyController'] is True,'finite no-descendant setup phase census')
        for stream in ('stdout','stderr'):
            encoded=row[stream]
            if encoded is not None:need(len(prerequisite_original(canonical(encoded)))<=128<<10,'bounded dpkg original stream')
    need(value['unpack']['process']['reapMonoNs']<=value['configure']['process']['spawnMonoNs'],
         'unpack completed before configure')
    census=value['policyCleanupCgroup'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
    need(census['phase']=='policy-cleanup' and
         setup_v8_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                               census['cgroupStat'],controller_pid) and
         census['onlyController'] is True,
         'only root controller remained before global policy removal')
    post=value['postStatus'];keys(post,'sha256 bytes records selected pendingHostTriggers serviceObserved statusOriginal allSelectedPresent allowedStates deferredHostTriggers configurationComplete')
    digest(post['sha256']);integer(post['bytes'],1,8<<20);integer(post['records'],1,5000)
    post_original=post['statusOriginal'];keys(post_original,'role bytes sha256 packedBytes packedSha256')
    need(post_original['role']=='post' and post_original['bytes']==post['bytes'] and
         post_original['sha256']==post['sha256'] and
         integer(post_original['packedBytes'],1,700<<10)>0 and
         digest(post_original['packedSha256']),'held post-status original summary')
    need(post['allSelectedPresent'] is True and post['allowedStates'] is True and
         post['deferredHostTriggers'] is True and post['configurationComplete'] is False and
         type(post['selected']) is dict and set(post['selected'])=={row[0] for row in SETUP_V8_PACKAGES},
         'all selected post-status rows and deferred configuration')
    for name,version,arch,*_ in SETUP_V8_PACKAGES:
        row=post['selected'][name];keys(row,'Package Version Architecture Status Triggers-Pending Triggers-Awaited')
        need((row['Package'],row['Version'],row['Architecture'])==(name,version,arch) and
             row['Status'] in ('install ok installed','install ok triggers-pending','install ok triggers-awaited') and
             all(type(row[key]) in (str,type(None)) for key in ('Triggers-Pending','Triggers-Awaited')),
             'versioned selected package status, including pending trigger facts')
    pending=post['pendingHostTriggers']
    need(type(pending) is dict and len(pending)<=5000,'bounded actual host trigger rows')
    for name,row in pending.items():
        need(type(name) is str and re.fullmatch('[A-Za-z0-9.+-]+:(?:amd64|all)',name),
             'architecture-qualified host trigger package')
        keys(row,'status pending awaited')
        need(type(row['status']) is str and len(row['status'])<=128 and
             all(type(row[key]) in (str,type(None)) and (row[key] is None or len(row[key])<=4096)
                 for key in ('pending','awaited')) and
             (row['status'] in ('install ok triggers-pending','install ok triggers-awaited') or
              row['pending'] is not None or row['awaited'] is not None),'honest bounded pending host trigger fact')
    need(equal(post['serviceObserved'],{'unit':SETUP_V8_PAYLOAD_PINS['serviceUnit'],
        'init':SETUP_V8_PAYLOAD_PINS['initScript']}),
        'exact reviewed service unit and init script payload bytes; no service execution')
    return {'setupObserved':True,'deferredHostTriggers':True,'completeHostConfiguration':False,
        'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}


def setup_v8_stage_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity setup copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v8' and record['firstFailure'] is None and
         record['secondary']==[] and record['recordBoundary']==
         'verified copy after selected setup and policy cleanup, before directory publication',
         'closed v8 stage record')
    request_raw=prerequisite_original(canonical(record['request']));request,source=setup_v8_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(SETUP_V8_PLATFORM),'closed v8 stage platform')
    setup_v8_event(event_raw,request,pin,environment)
    need(equal(record['source'],source),'root Git/live source12 joins selected request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and
         copy['directoryPublicationAttempted'] is False and copy['filePublished'] is True and copy['directoryPublished'] is False and
         type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
         type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and
         copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
         copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],
         'fixed verified Node copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw v8 stage metadata')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and
         stat.S_ISREG(before[2]) and before[2]&0o6000==0 and before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],
         'held Node cache source extent/identity')
    file,directory=copy['file'],copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
         stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],
         'fixed staged Node file/directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original v8 source Git commands')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
            for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped v8 Git source checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed v8 Git command')
        process=command['process'];start,end=v8_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'sequential source Git children');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,
             'exact original source Git output')
    setup_v8_facts(record['setup'],environment['GITHUB_RUN_ID'],parent,previous)
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and event_meta['st_size']==len(event_raw) and
         stat.S_ISREG(event_meta['st_mode']),'held official event snapshot extent')
    return request,source


def observe_setup_v8_stage(environ):
    value={'schema':'bw.ring3.setup-node-observation.v8','stageObserved':False,'runtimeCandidate':False,
        'qualified':False,'record':None,'files':{},'directories':[],'source':{},'identity':None,
        'firstFailure':None,'secondary':[],'publicationSafe':False};backend=None
    def failed(error,phase):
        item={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),
             'known v8 dropped observer invoker')
        uid,gid=map(int,ids)
        need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],
             'actual irreversible dropped v8 IDs/groups')
        status=setup_proc_read('/proc/self/status');membership=setup_proc_read('/proc/self/cgroup')
        setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,
            'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid);value['publicationSafe']=True
        pin=digest(environ.get('BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True)
        value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=setup_v8_stage_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],
             'same installer/dropped observer PID across exec')
        event_raw=prerequisite_original(canonical(record['event']));setup_v8_event(event_raw,request,pin,environ)
        need(set(environ)==set(SETUP_V8_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in SETUP_V8_PLATFORM}),
            'closed actual dropped platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat()
            need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                 stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),
                 'live dropped v8 source regular owner/mode')
            raw=inventory_file(target,4<<20)
            fact={'bytes':len(raw),'sha256':sha(raw),
                'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent dropped source12 bytes')
        backend.read('node')
        need(backend.facts['node']['before']==record['copy']['file'],'finite staged Node inode join')
        value['stageObserved']=True
    except BaseException as error:failed(error,'setup-v8-stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts
            value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'setup-v8-stage-close')
    return value


def setup_v8_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.setup-runtime-inventory-original.v8','stageBefore':None,'stageAfter':None,
        'parent':None,'inventory':None,'candidate':None,'firstFailure':None,'secondary':[],
        'publicationSafe':False,'actualGuestApproved':False,'completeHostConfiguration':False}
    originals={};inventory=None
    def failed(error,phase):
        item=getattr(error,'inventory_first',{'phase':phase,'name':type(error).__name__,'message':str(error)})
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
        value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    try:
        before=observe_setup_v8_stage(environ);value['stageBefore']=before
        value['publicationSafe']=before['publicationSafe']
        if before['firstFailure'] is not None:
            error=Refusal(before['firstFailure']['message']);error.inventory_first=before['firstFailure']
            error.inventory_secondary=before['secondary'];raise error
        need(before['stageObserved'] is True,'complete dropped v8 stage before metadata tools')
        record=parse(prerequisite_original(canonical(before['record'])))
        originals['setup.request.json']=prerequisite_original(canonical(record['request']))
        originals['setup.event.json']=prerequisite_original(canonical(record['event']))
        value['parent']=inventory_parent_availability()
        inventory=SetupV8Inventory(before['files']['node']['before'],files,probe)
        candidate=inventory.discover()
        value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:failed(error,'setup-v8-runtime-inventory')
    finally:
        if inventory is not None:
            value['inventory']=inventory.partial
            rejected=getattr(inventory.ops,'rejected',{})
            if rejected:value['inventory']['rejectedFiles']=rejected
        if value['stageBefore'] is not None and value['stageBefore']['stageObserved']:
            after=observe_setup_v8_stage(environ);value['stageAfter']=after
            if after['firstFailure'] is not None:
                error=Refusal(after['firstFailure']['message']);error.inventory_first=after['firstFailure']
                error.inventory_secondary=after['secondary'];failed(error,'setup-v8-stage-after')
            elif not all(equal(after[key],value['stageBefore'][key]) for key in ('record','files','directories','source')):
                failed(Refusal('v8 source/stage changed across metadata tools'),'setup-v8-stage-after')
    raw=canonical(value)
    if len(raw)>4<<20:
        error={'phase':'setup-v8-original-cap','name':'Refusal','message':'versioned v8 original cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.setup-runtime-inventory-overflow.v8',
            'firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),
            'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.setup-inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[],value['publicationSafe']


def emit_setup_v8_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<=set(SETUP_V8_LOG_ROLES) and
         all(type(raw) is bytes and 0<len(raw)<=4<<20 for raw in originals.values()) and
         sum(map(len,originals.values()))<=6<<20,'bounded v8 original roles')
    emitted=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072)
        raw_sha=sha(raw)
        need(count<=1821,'bounded v8 original chunk count')
        for index in range(count):
            line=SETUP_V8_LOG_MARKER+canonical({'schema':'bw.ring3.setup-runtime-inventory-log.v8',
                'name':name,'index':index,'count':count,'bytes':len(raw),'sha256':raw_sha,
                'data':encoded[index*3072:(index+1)*3072]})
            need(emitted+len(line)<=6<<20 and chunks<3000,'bounded six-MiB v8 runtime component')
            need(emit(line)==len(line),'complete v8 original log write')
            emitted+=len(line);chunks+=1
    flush()


def decode_setup_v8_log(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded v8 official log original')
    groups={};chunks=0;wire_bytes=0
    for line in raw.splitlines():
        at=line.find(SETUP_V8_LOG_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical v8 official log timestamp')
        wire_bytes+=len(line[at:])+1
        need(wire_bytes<=6<<20,'bounded six-MiB v8 runtime component wire')
        value=parse(line[at+len(SETUP_V8_LOG_MARKER):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.setup-runtime-inventory-log.v8' and value['name'] in SETUP_V8_LOG_ROLES,
             'closed v8 original log role')
        count=integer(value['count'],1,1821);index=integer(value['index'],0,count-1)
        extent=integer(value['bytes'],1,4<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded v8 base64 chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and
             index==len(group['parts']),'one ordered v8 original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<3000,'finite v8 log chunk count')
    need(set(groups)==set(SETUP_V8_LOG_ROLES),'three complete v8 originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete v8 chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and
             sha(value)==group['sha256'],'exact v8 original bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=6<<20,'bounded raw v8 aggregate')
    return originals


def verify_setup_v8_stage_observation(value,external):
    keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary publicationSafe')
    need(value['schema']=='bw.ring3.setup-node-observation.v8' and value['stageObserved'] is True and
         value['runtimeCandidate'] is False and value['qualified'] is False and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True,'complete actual v8 dropped stage observation')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw)
    request,source=setup_v8_stage_record(record,external['requestSha256'])
    env=record['platform'];need(request['head']==external['head'] and request['tree']==external['tree'] and
         env['GITHUB_RUN_ID']==external['runId'] and env['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,external['invoker'])),
         'external v8 source/platform/invoker joins')
    need(equal(value['source'],source['files']),'actual dropped source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*external['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],
         'installer/observer original PID continuity')
    setup_membership(identity['membership'],external['runId'])
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},
         'two independent v8 stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix')
        need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and
             equal(row['before'],row['namedAfter']),'closed stable v8 stage file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and
             all(type(x) is int for x in metadata) and stat.S_ISREG(metadata[2]) and
             metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'],'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444
        need(stat.S_IMODE(metadata[2])==mode,'fixed v8 stage mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent v8 staged bytes')
        if name=='node':
            need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],
                 'staged Node ELF/install join')
        else:need(row['prefix']==record_raw[:4].hex(),'held v8 record prefix')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==
         ['/','/run',str(NODE_STAGE_ROOT)],'fixed stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before']
        need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and
             (index!=2 or stat.S_IMODE(info[2])==0o555),'nonwritable root stage ancestor')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite stage directory inode join')
    return request,source,record


def setup_v8_cleanup_original(raw,external):
    value=parse(raw)
    keys(value,'schema runId serviceExitCode sourceAdmission preCensus stop postCensus cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-outside-cleanup.v8' and
         value['runId']==external['runId'] and value['setupApproved'] is False and
         type(value['secondary']) is list and len(value['secondary'])<=64 and
         (value['firstFailure'] is None or type(value['firstFailure']) is dict),
         'closed bounded v8 outside cleanup original')
    unit='bw-ring3-setup-v8-'+external['runId']+'-1.service'
    selected=value['sourceAdmission']
    if selected is None:
        need(value['preCensus'] is None and value['postCensus'] is None and value['stop'] is None and
             value['policy'] is None and value['action'] is None and value['firstFailure'] is not None,
             'no unit stop or policy mutation without source admission')
    else:
        keys(selected,'requestSha256 eventSha256 head tree source unit')
        need(selected['requestSha256']==external['requestSha256'] and
             selected['head']==external['head'] and selected['tree']==external['tree'] and
             selected['unit']==unit,'exact outside request/source/unit selection')
        digest(selected['eventSha256'])
        source=selected['source'];keys(source,'schema head tree files')
        need(source['schema']=='bw.ring3.source.v1' and source['head']==external['head'] and
             source['tree']==external['tree'] and type(source['files']) is dict and
             set(source['files'])==SETUP_SOURCE_PATHS and
             source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
             'outside selected source twelve and workflow')
    def census(row):
        if row is None:return None
        keys(row,'terminal cgroupProcs cgroupEvents cgroupStat')
        need(row['terminal'] in ('absent','empty','populated'),'closed v8 unit terminal state')
        if row['terminal']=='absent':
            need(all(row[key] is None for key in ('cgroupProcs','cgroupEvents','cgroupStat')),
                 'absent unit has no invented census')
        else:
            need(all(type(row[key]) is str and len(row[key].encode())<=1024 for key in
                     ('cgroupProcs','cgroupEvents','cgroupStat')) and
                 (setup_v8_cgroup_quiet(row['cgroupProcs'],row['cgroupEvents'],row['cgroupStat']) is
                  (row['terminal']=='empty')),
                 'independent exact nested unit census')
        return row
    pre=census(value['preCensus']);post=census(value['postCensus'])
    stop=value['stop']
    if selected is not None:
        if stop is None:
            need(pre is None and post is None and value['cgroupTerminal'] is None and
                 value['unitCensus'] is None and value['policy'] is None and
                 value['action'] is None and value['firstFailure'] is not None,
                 'admitted unit identity refusal retains no invented stop or census')
        else:
            keys(stop,'attempted argv exitCode timedOut')
        if stop is not None and stop['attempted'] is True:
            need(stop['argv']==['/usr/bin/timeout','--kill-after=5s','20s',
                 '/usr/bin/systemctl','stop','--',unit] and
                 (stop['exitCode'] is None or integer(stop['exitCode'],-255,255)>=-255) and
                 (stop['timedOut'] is None if stop['exitCode'] is None else
                  stop['timedOut']==(stop['exitCode'] in (124,137))),
                 'one bounded exact owned-unit stop')
        elif stop is not None:
            need(stop=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
                 (pre is None and value['firstFailure'] is not None or
                  pre is not None and pre['terminal'] in ('absent','empty') and
                  (value['serviceExitCode']==0 or pre['terminal']=='absent')),
                 'no stop needed only for terminal or absent unit')
        if post is not None:
            need(value['cgroupTerminal']==post['terminal'] and
                 (value['unitCensus'] is None if post['terminal']=='absent' else
                  value['unitCensus']=={key:post[key] for key in
                      ('cgroupProcs','cgroupEvents','cgroupStat')}),
                 'outside final census and terminal projection')
        else:need(value['cgroupTerminal'] is None and value['unitCensus'] is None,
                  'unknown outside terminal cannot claim census')
    return value


def setup_v8_inner_original(raw,external,shell):
    originals=decode_setup_v8_log(raw);value=parse_setup_v8_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v8' and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True and value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,'failure-free metadata-only v8 original')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v8_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and equal(observed,record),
                  'same v8 staged source/request/record before and after graph')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
        ('record','files','directories','source')),'finite stage readback across metadata graph')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'exact source/head/workflow/request/event original join')
    statuses=decode_setup_v8_status_log(raw)
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']),
         'exact separately retained raw status originals join setup packet')
    before=setup_v8_status_rows(statuses['pre']['raw'])
    need(len(before)==pre['statusRecords']==1211 and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V8_PACKAGES),
         'independent raw pre-status census and selected absence')
    after=setup_v8_status_rows(statuses['post']['raw'])
    need(len(after)==post['records'],'independent raw post-status census')
    setup_v8_status_delta(before,after)
    selected={};pending={}
    for name,version,arch,*_ in SETUP_V8_PACKAGES:
        row=after.get((name,arch))
        selected[name]=None if row is None else {key:row.get(key) for key in
            ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
    for (name,arch),row in after.items():
        if (row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
            row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None):
            pending[name+':'+arch]={'status':row.get('Status'),'pending':row.get('Triggers-Pending'),
                'awaited':row.get('Triggers-Awaited')}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']),
         'independent raw post-status selected/pending projection')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and stat.S_ISDIR(parent['meta'][2]) and
         parent['meta'][3:5]==[0,0] and parent['meta'][2]&0o022==0 and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},
         'finite root-owned parent availability')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful cgroup parent availability')
    result=verify_setup_v8_inventory_graph(value)
    candidate_raw=prerequisite_original(canonical(value['candidate']))
    candidate=setup_v8_runtime_expectation(candidate_raw,sha(candidate_raw))
    for package in candidate['packages']:
        row=post['selected'][package['name']]
        need(row['Version']==package['version'] and
             row['Architecture']==package['architecture'],
             'five named runtime versions independently join raw installed post-status')
    need(equal(value['inventory']['fileMetadata'][NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'graph Node file joins staged inode/mode/hash')
    need(all(entry['process']['parentPid']==value['stageBefore']['identity']['pid'] for entry in
        value['inventory']['processes']),'fifteen metadata children descend from dropped observer')
    need(all(entry['process']['spawnMonoNs']>=record['sourceCommands'][-1]['process']['reapMonoNs'] for entry in
        value['inventory']['processes']),'runtime probes follow root source admission')
    need(record['setup']['configure']['process']['reapMonoNs']<=
         value['inventory']['processes'][0]['process']['spawnMonoNs'],
         'all runtime probes follow completed no-trigger configure')
    need(record['setup']['preflight']['imageFields']==setup_v8_expected_forwarded(shell['fields']),
         'successful service image labels join shell forwarding')
    return result,record,source,event_raw,request_raw


def verify_setup_v8_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v8_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v8' and type(external['attempt']) is int and
         external['attempt']==1 and external['jobName']=='setup-runtime-inventory-v8' and
         external['conclusion']=='success','externally selected official v8 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive official v8 run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),'selected actual invoker')
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'externally selected exact official v8 log bytes')
    need(type(outer_raw) is bytes and integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'externally selected exact outside-owner terminal bytes')
    need(type(cleanup_raw) is bytes and integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'externally selected outside cleanup original')
    cleanup=setup_v8_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==0 and cleanup['sourceAdmission'] is not None and
         cleanup['stop']=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
         cleanup['preCensus'] is not None and cleanup['postCensus'] is not None and
         cleanup['cgroupTerminal'] in ('empty','absent') and cleanup['policy'] is None and
         cleanup['action']=='not-needed' and cleanup['firstFailure'] is None and
         cleanup['secondary']==[] and cleanup['setupApproved'] is False,
         'finite outside owner needed no policy cleanup after successful setup')
    need((cleanup['cgroupTerminal']=='absent' and cleanup['unitCensus'] is None) or
         (cleanup['cgroupTerminal']=='empty' and type(cleanup['unitCensus']) is dict and
          set(cleanup['unitCensus'])=={'cgroupProcs','cgroupEvents','cgroupStat'} and
          setup_v8_cgroup_quiet(cleanup['unitCensus']['cgroupProcs'],
              cleanup['unitCensus']['cgroupEvents'],cleanup['unitCensus']['cgroupStat'])),
         'independently checked outside nested cgroup emptiness')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v8' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v8-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and outer['systemdRunExitCode']==0 and
         type(outer['outsideCleanupExitCode']) is int and outer['outsideCleanupExitCode']==0 and
         outer['cgroupAfter']=='absent','finite outside-owner successful service terminal and absent cgroup')
    result,record,source,event_raw,request_raw=setup_v8_inner_original(raw,external,shell)
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins complete inner original')
    return dict(result,schema='bw.ring3.setup-runtime-inventory-admission.v8',setupObserved=True,
        shellImageFields=shell['fields'],serviceImageFields=record['setup']['preflight']['imageFields'],
        forwardingMatchesExpected=True,
        deferredHostTriggers=True,completeHostConfiguration=False,actualGuestApproved=False,
        outsideTerminalObserved=True,cgroupAfterAbsent=True,continuousOwnershipEstablished=False,
        officialJobAuthenticated=False,imageFieldsAuthenticated=False,
        immutableImageIdentityEstablished=False,candidateReviewed=False,actualRunApproved=False,
        rawStatusBytesIndependentlyVerified=True,ciArchiveBytesIndependentlyVerified=False)


def verify_setup_v8_failed_stream_inventory(raw,external,cleanup,shell,outer):
    """Retain a complete failed v8 metadata packet with one clipped child prefix."""
    originals=decode_setup_v8_log(raw)
    value=parse_setup_v8_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    first=value['firstFailure']
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v8' and
         value['candidate'] is None and value['publicationSafe'] is True and
         value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False and
         type(first) is dict and first=={'phase':'inventory-stream','name':'Refusal',
             'message':'inventory original stdout stream cap'} and
         type(value['secondary']) is list and len(value['secondary'])<=64,
         'complete failed v8 stream-cap original with no candidate')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v8_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and
                  equal(observed,record),'same failed v8 stage source before/after')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
             ('record','files','directories','source')),
         'failed v8 stage file and source readback')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and
         event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'failed v8 exact source/request/event originals')
    need(cleanup['sourceAdmission'] is not None and
         equal(cleanup['sourceAdmission']['source'],source) and
         cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
         'outside failed source/event admission joins inner originals')
    statuses=decode_setup_v8_status_log(raw)
    before=setup_v8_status_rows(statuses['pre']['raw'])
    after=setup_v8_status_rows(statuses['post']['raw'])
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']) and
         len(before)==pre['statusRecords']==1211 and
         len(after)==post['records'] and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V8_PACKAGES),
         'failed v8 separately retained raw status and baseline')
    setup_v8_status_delta(before,after)
    need(pre['imageFields']==setup_v8_expected_forwarded(shell['fields']),
         'failed metadata service/shell image forwarding')
    inventory=value['inventory']
    keys(inventory,'files aliases probes processes fileMetadata pythonFiles mappedLibraries mapsOriginal emptyPythonSources')
    need(type(inventory['files']) is dict and
         len(inventory['files'])<=512 and type(inventory['aliases']) is dict and
         len(inventory['aliases'])<=256 and
         type(inventory['probes']) is list and type(inventory['processes']) is list,
         'bounded partial graph reports no selected candidate')
    roles=SETUP_V8_PROBE_ORDER
    aliases=inventory['aliases']
    need(type(aliases) is dict and len(aliases)<=256,
         'bounded failed alias census for fixed argv')
    executables={'node':NODE_STAGE_TARGET,
        'python':resolve_alias('/usr/bin/python3',aliases),
        'qemu':resolve_alias(RUNTIME_QEMU,aliases)}
    fixed={'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'],
        'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'ldd-tcg':['/usr/bin/ldd',resolve_alias(RUNTIME_TCG,aliases)],
        'package-version':['/usr/bin/dpkg-query','-W',
            '-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]}
    fixed.update({'ldd-'+name:['/usr/bin/ldd',path]
                  for name,path in executables.items()})
    fixed.update({name+'-version':[path,'--version']
                  for name,path in executables.items()})
    fixed.update({role:['/usr/bin/dpkg-query','-L',name]
                  for name,role in SETUP_V8_PACKAGE_ROLES.items()})
    entries=inventory['processes'];probes=inventory['probes']
    setup_v8_observed_order(probes,entries,partial=True)
    last_end=0;parent=None
    for index,(entry,probe) in enumerate(zip(entries,probes)):
        keys(entry,'role process stdout stderr')
        keys(probe,'role argv environment exitCode stdout stderr')
        process=entry['process']
        keys(process,'schema argv environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
        need(process['schema']=='bw.ring3.inventory-process.v1' and
             equal(process['argv'],probe['argv']) and
             equal(probe['argv'],fixed[entry['role']]) and
             equal(process['environment'],probe['environment']) and
             probe['environment']=={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'} and
             type(probe['stdout']) is str and type(probe['stderr']) is str and
             len(probe['stdout'].encode('utf-8','surrogateescape'))<=16384 and
             len(probe['stderr'].encode('utf-8','surrogateescape'))<=16384 and
             prerequisite_original(canonical(entry['stdout']))==probe['stdout'].encode('utf-8','surrogateescape') and
             prerequisite_original(canonical(entry['stderr']))==probe['stderr'].encode('utf-8','surrogateescape'),
             'exact retained child process/stream prefix')
        if parent is None:parent=integer(process['parentPid'],1)
        start=integer(process['spawnMonoNs'],last_end)
        last_end=integer(process['reapMonoNs'],start)
        need(last_end-start<=10_000_000_000 and
             process['parentPid']==parent==value['stageBefore']['identity']['pid'] and
             integer(process['pid'],1)==process['pgid'] and
             process['timedOut'] is False,
             'finite serial owned metadata child prefix')
        if index<len(entries)-1:
            need(process['firstFailure'] is None and process['secondary']==[] and
                 process['exitCode']==probe['exitCode']==0 and probe['stderr']=='' and
                 process['waitStatus']==0 and process['signal'] is None,
                 'successful earlier v8 metadata children')
            if entry['role'] in SETUP_V8_PACKAGE_ROLES.values():
                package_name=next(name for name,role in SETUP_V8_PACKAGE_ROLES.items()
                                  if role==entry['role'])
                setup_v8_listed_paths(probe['stdout'].encode('utf-8','surrogateescape'),package_name)
        else:
            need(process['firstFailure']==first and process['secondary']==value['secondary'] and
                 entry['stdout']['bytes']==16384,
                 'first stream cap and ordered secondary remain last child facts')
    # The last stream is only an explicit bounded prefix. Its final line and
    # complete per-package listing are unknown, even when bytes look valid.
    return {'schema':'bw.ring3.setup-failure-retention.v8',
        'failedAttemptRetained':True,'completeFailedInventoryOriginal':True,
        'firstFailure':first,'secondary':value['secondary'],
        'retainedProbePrefixRoles':list(roles[:len(entries)]),
        'lastStdoutPrefixBytes':entries[-1]['stdout']['bytes'],
        'lastPackageListingComplete':False,'candidateReviewed':False,
        'setupObserved':False,'actualGuestApproved':False,'actualRunApproved':False,
        'completeHostConfiguration':False,'officialJobAuthenticated':False,
        'outsideCleanup':cleanup['action'],'outsideCgroupAfter':outer['cgroupAfter'],
        'outerClientExitCode':outer['systemdRunExitCode'],
        'rawStatusBytesIndependentlyVerified':True,
        'ciArchiveBytesIndependentlyVerified':False}


def verify_setup_v8_failure_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    """Retain a bound failed attempt; never promote its partial facts to admission."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v8_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v8' and
         external['conclusion']=='failure' and external['attempt']==1 and
         external['jobName']=='setup-runtime-inventory-v8','externally selected failed v8 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive failed run identity')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),
         'selected failed-job invoker')
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and
         integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'exact externally selected failed log bytes')
    need(type(outer_raw) is bytes and 0<len(outer_raw)<=4096 and
         integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'exact failed outside terminal original')
    need(type(cleanup_raw) is bytes and 0<len(cleanup_raw)<=16384 and
         integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'exact failed outside cleanup original')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v8' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v8-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and 0<=outer['systemdRunExitCode']<=255 and
         type(outer['outsideCleanupExitCode']) is int and 0<=outer['outsideCleanupExitCode']<=255 and
         outer['cgroupAfter'] in ('present','absent') and
         (outer['systemdRunExitCode']!=0 or outer['outsideCleanupExitCode']!=0 or
          outer['cgroupAfter']!='absent'),'finite failed outside terminal facts')
    cleanup=setup_v8_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==outer['systemdRunExitCode'] and
         cleanup['setupApproved'] is False and type(cleanup['secondary']) is list and
         len(cleanup['secondary'])<=64,'finite failed outside cleanup facts')
    if cleanup['cgroupTerminal']=='empty':
        census=cleanup['unitCensus']
        need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
             setup_v8_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
             'independent empty nested outside census')
    elif cleanup['cgroupTerminal']=='absent':
        need(cleanup['unitCensus'] is None,'absent outside unit has no census')
    else:
        need(cleanup['firstFailure'] is not None,'uncertain outside cgroup remains failure')
        census=cleanup['unitCensus']
        if census is not None:
            need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
                 not setup_v8_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
                 'retained active nested outside census, never cleanup permission')
    packets=[]
    for line in raw.splitlines():
        at=line.find(b'{"actualGuestApproved":false,')
        if at<0:continue
        need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
             'canonical failed packet log prefix')
        need(len(line)-at<=4<<20,'bounded failed packet')
        packet=parse_setup_v8_outer(line[at:]);need(line[at:]==canonical(packet).rstrip(b'\n'),'canonical failed packet')
        if packet.get('schema')=='bw.ring3.setup-entry-failure.v8':packets.append(packet)
    if not packets:
        if b'RING3_SETUP_RUNTIME_INVENTORY_V8 ' in raw and outer['systemdRunExitCode']!=0:
            try:
                return verify_setup_v8_failed_stream_inventory(raw,external,cleanup,shell,outer)
            except (ValueError,UnicodeError):
                # Other complete failures remain refused until separately
                # reviewed. A timed truncated wire may still use the opaque
                # path below; it never acquires positive authority.
                if outer['systemdRunExitCode'] not in (124,137):raise
        # A complete inner metadata packet is still a failed attempt when the
        # bounded outer client exits nonzero or outside cleanup is uncertain.
        try:
            _,record,source,event_raw,_=setup_v8_inner_original(raw,external,shell)
        except (ValueError,UnicodeError) as decode_error:
            # A killed outer client can leave only a bounded prefix. Keep its
            # exact official bytes as opaque evidence; no inner fact is graded.
            need(outer['systemdRunExitCode'] in (124,137) and
                 cleanup['sourceAdmission'] is not None and
                 type(cleanup['firstFailure']) is dict and
                 cleanup['firstFailure'].get('phase')=='v8-outer-client',
                 'only source-admitted timed client permits opaque inner prefix')
            return {'schema':'bw.ring3.setup-failure-retention.v8',
                'failedAttemptRetained':True,'innerOriginalIncomplete':True,
                'innerMetadataCompleteReported':False,'innerDecodeError':type(decode_error).__name__,
                'retainedLogBytes':len(raw),'retainedLogSha256':sha(raw),
                'partialMutationPossible':True,'firstFailure':cleanup['firstFailure'],
                'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
                'outsideCgroupAfter':outer['cgroupAfter'],
                'outerClientExitCode':outer['systemdRunExitCode'],
                'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
                'shellImageFields':shell['fields'],'serviceImageFields':None,
                'forwardingMatchesExpected':None,'officialJobAuthenticated':False,
                'actualGuestApproved':False,'actualRunApproved':False,
                'candidateReviewed':False,'completeHostConfiguration':False}
        if cleanup['sourceAdmission'] is not None:
            need(equal(cleanup['sourceAdmission']['source'],source) and
                 cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
                 'outside source/event joins complete failed-job inner original')
        first=cleanup['firstFailure'] or {'phase':'v8-outside-terminal','name':'ValueError',
            'message':'bounded outside terminal or cleanup refusal'}
        return {'schema':'bw.ring3.setup-failure-retention.v8',
            'failedAttemptRetained':True,'innerMetadataCompleteReported':True,
            'partialMutationPossible':True,'firstFailure':first,
            'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
            'outsideCgroupAfter':outer['cgroupAfter'],
            'outerClientExitCode':outer['systemdRunExitCode'],
            'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
            'shellImageFields':shell['fields'],
            'serviceImageFields':record['setup']['preflight']['imageFields'],
            'forwardingMatchesExpected':True,'officialJobAuthenticated':False,
            'actualGuestApproved':False,'actualRunApproved':False,
            'candidateReviewed':False,'completeHostConfiguration':False}
    need(len(packets)==1,'one complete failed setup packet')
    packet=packets[0];keys(packet,'schema context setup firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(packet['schema']=='bw.ring3.setup-entry-failure.v8' and packet['publicationSafe'] is False and
         packet['actualGuestApproved'] is False and packet['completeHostConfiguration'] is False and
         type(packet['firstFailure']) is dict and type(packet['secondary']) is list and
         len(packet['secondary'])<=64,'failed packet with retained first and secondary')
    keys(packet['firstFailure'],'phase name message')
    context=packet['context'];keys(context,'request event platform source sourceCommands eventIdentity imageFields imageFieldErrors')
    setup_v8_image_observation(context['imageFields'],context['imageFieldErrors'])
    forwarding_matches=context['imageFields']==setup_v8_expected_forwarded(shell['fields'])
    request_raw=prerequisite_original(canonical(context['request']))
    request,source=setup_v8_request(request_raw,external['requestSha256'])
    event_raw=prerequisite_original(canonical(context['event']))
    need(type(context['platform']) is dict and set(context['platform'])==set(SETUP_V8_PLATFORM),
         'closed failed platform')
    environment=context['platform'];setup_v8_event(event_raw,request,external['requestSha256'],environment)
    need(environment['GITHUB_RUN_ID']==external['runId'] and
         environment['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         request['head']==external['head'] and request['tree']==external['tree'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(context['source'],source),'failed source/request/event/official context join')
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins failed inner original')
    need(type(context['sourceCommands']) is list and len(context['sourceCommands'])==3 and
         all(type(item) is dict and set(item)=={'argv','process','stdout','stderr'} for item in context['sourceCommands']),
         'three retained failed source command originals')
    commands=context['sourceCommands'];git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
                for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),
             'fixed failed source Git descriptor')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'exact failed source Git command')
        start,end=v8_process(command['process'],'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=command['process']['parentPid']
        need(start>=previous and command['process']['parentPid']==parent and
             prerequisite_original(canonical(command['stdout']))==outputs[index] and
             command['stderr'] is None,'causal failed source Git original')
        previous=end
    need(type(context['eventIdentity']) is dict and
         set(context['eventIdentity'])==set('st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns'.split()) and
         all(type(x) is int for x in context['eventIdentity'].values()) and
         context['eventIdentity']['st_size']==len(event_raw) and
         stat.S_ISREG(context['eventIdentity']['st_mode']),
         'failed held event extent')
    setup=packet['setup'];need(type(setup) is dict and setup.get('schema')=='bw.ring3.setup-original.v8' and
         setup.get('firstFailure') is not None and setup.get('nodeStage') is None and setup.get('runtime') is None,
         'only partial setup before Node stage')
    keys(setup,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    need(setup['configurationComplete'] is False and type(setup['secondary']) is list and
         len(setup['secondary'])<=64,'closed partial setup and secondary')
    partial=setup['partial']
    preflight_prefix=None
    if setup['preflight'] is None:
        need(type(partial) is dict and partial.get('phase')=='preflight',
             'failed preflight has a typed retained prefix')
        keys(partial,'phase prefix failedHelper')
        preflight_prefix=partial['prefix']
        keys(preflight_prefix,'statusOriginal statusSha256 statusBytes statusRecords completedHelpers helperWitness imageFields imageFieldErrors')
        setup_v8_image_observation(preflight_prefix['imageFields'],preflight_prefix['imageFieldErrors'])
        need(preflight_prefix['imageFields']==context['imageFields'] and
             preflight_prefix['imageFieldErrors']==context['imageFieldErrors'],
             'failed preflight retains exact entry image observation')
        completed=preflight_prefix['completedHelpers'];witnesses=preflight_prefix['helperWitness']
        need(type(completed) is list and type(witnesses) is dict and
             completed==list(SETUP_V8_HELPERS)[:len(completed)] and
             set(witnesses)==set(completed),'ordered bounded successful helper prefix')
        status_meta=preflight_prefix['statusOriginal']
        if status_meta is None:
            need(preflight_prefix['statusSha256'] is None and preflight_prefix['statusBytes'] is None and
                 preflight_prefix['statusRecords'] is None and completed==[],
                 'no fabricated pre-status or helper facts before observation')
        else:
            keys(status_meta,'role bytes sha256 packedBytes packedSha256')
            need(status_meta['role']=='pre' and status_meta['sha256']==preflight_prefix['statusSha256'] and
                 status_meta['bytes']==preflight_prefix['statusBytes'] and
                 integer(status_meta['bytes'],1,8<<20)>0 and
                 integer(status_meta['packedBytes'],1,700<<10)>0 and
                 digest(status_meta['packedSha256'])==status_meta['packedSha256'],
                 'bounded retained preflight status summary')
            if preflight_prefix['statusRecords'] is not None:
                integer(preflight_prefix['statusRecords'],1,5000)
            need(not completed or preflight_prefix['statusRecords']==1211,
                 'helper prefix follows full selected pre-status census')
        for path in completed:
            item=witnesses[path];keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(item['path']==path and item['sha256']==SETUP_V8_HELPERS[path] and
                 item['closeAttempted'] is True and item['closeSucceeded'] is True and
                 item['namedBefore']==item['heldBefore']==item['heldAfter']==item['namedAfter'],
                 'completed helper prefix has stable reported identity')
            info=item['heldBefore']
            need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
                 stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
                 type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
                 item['bytesRead']==SETUP_V8_NEW_HELPER_BYTES.get(path,item['bytesRead']),
                 'bounded known successful helper witness')
        failed=partial['failedHelper']
        helper_attempt=bool(completed) or failed is not None
        if helper_attempt:
            need(status_meta is not None and preflight_prefix['statusSha256']==SETUP_V8_STATUS_SHA and
                 preflight_prefix['statusBytes']==SETUP_V8_STATUS_BYTES and
                 preflight_prefix['statusRecords']==1211,
                 'helper attempt follows exact selected pre-status baseline')
        if failed is not None:
            keys(failed,'phase witness')
            item=failed['witness']
            keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(failed['phase']=='helper' and len(completed)<len(SETUP_V8_HELPERS) and
                 item['path']==list(SETUP_V8_HELPERS)[len(completed)] and
                 integer(item['bytesRead'],0,2<<20)>=0 and
                 type(item['closeAttempted']) is bool and type(item['closeSucceeded']) is bool and
                 (item['sha256'] is None or digest(item['sha256'])==item['sha256']),
                 'bounded failing helper position and partial byte count')
            for key in ('namedBefore','heldBefore','heldAfter','namedAfter'):
                info=item[key]
                need(info is None or (type(info) is list and len(info)==8 and
                     all(type(n) is int for n in info)),
                     'bounded partial helper metadata')
    if type(partial) is dict and partial.get('phase')=='node-stage':
        keys(partial,'phase copy record dropProgress invoker')
        need(type(partial['copy']) is dict and
             set(partial['copy'])==set('created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory'.split()) and
             type(partial['dropProgress']) is list and
             partial['dropProgress']==['groups','gid','uid','ids-verified'][:len(partial['dropProgress'])] and
             equal(partial['invoker'],external['invoker']),
             'retained bounded failed Node copy/drop progress')
        if partial['record'] is not None:
            keys(partial['record'],'bytes sha256')
            integer(partial['record']['bytes'],1,1<<20);digest(partial['record']['sha256'])
    required_roles=set()
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        fact=setup[key]
        if type(fact) is dict and fact.get('statusOriginal') is not None:
            required_roles.add(role)
    statuses=decode_setup_v8_status_log(raw,None)
    roles=set(statuses)
    if preflight_prefix is not None and preflight_prefix['statusOriginal'] is not None:
        required_roles.add('pre')
        need('pre' in roles and equal(statuses['pre']['meta'],preflight_prefix['statusOriginal']) and
             sha(statuses['pre']['raw'])==preflight_prefix['statusSha256'] and
             len(statuses['pre']['raw'])==preflight_prefix['statusBytes'],
             'raw failed preflight status joins retained prefix')
        if preflight_prefix['statusRecords'] is not None:
            pre_rows=setup_v8_status_rows(statuses['pre']['raw'])
            need(len(pre_rows)==preflight_prefix['statusRecords'],
                 'raw failed preflight census joins retained prefix')
            if helper_attempt:
                need(not any(name in {key[0] for key in pre_rows} for name,*_ in SETUP_V8_PACKAGES),
                     'selected fifteen absent before any helper attempt')
    need(required_roles<=roles,'all reported failed status originals retained')
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        if role in roles:
            fact=setup[key]
            if role in required_roles and type(fact) is dict:
                need(type(fact) is dict and equal(statuses[role]['meta'],fact['statusOriginal']) and
                    statuses[role]['meta']['sha256']==fact[hash_key] and
                    statuses[role]['meta']['bytes']==fact[size_key],
                    'independent retained failed raw status original join')
            rows=setup_v8_status_rows(statuses[role]['raw'])
            if role in required_roles and type(fact) is dict:
                need(len(rows)==fact['statusRecords' if role=='pre' else 'records'],
                     'retained failed raw status census')
            if role=='pre' and role in required_roles and type(fact) is dict:
                need(fact['statusSha256']==SETUP_V8_STATUS_SHA and
                     fact['statusBytes']==SETUP_V8_STATUS_BYTES,
                     'failed pre-state remains fixed selected baseline')
    need(setup['firstFailure']==packet['firstFailure'] or
         packet['firstFailure']['phase']=='v8-entry','retained setup/entry first failure relationship')
    return {'schema':'bw.ring3.setup-failure-retention.v8','failedAttemptRetained':True,
        'partialMutationPossible':True,'firstFailure':packet['firstFailure'],
        'secondary':packet['secondary'],'outsideCleanup':cleanup['action'],
        'outsideCgroupAfter':outer['cgroupAfter'],
        'outerClientExitCode':outer['systemdRunExitCode'],
        'outsideFirstFailure':cleanup['firstFailure'],
        'outsideSecondary':cleanup['secondary'],'setupObserved':False,
        'shellImageFields':shell['fields'],'serviceImageFields':context['imageFields'],
        'forwardingMatchesExpected':forwarding_matches,
        'stageAttemptObserved':type(partial) is dict and partial.get('phase')=='node-stage',
        'retainedStatusRoles':sorted(roles),'statusRolesJoinedToSetup':sorted(required_roles),
        'rawStatusBytesIndependentlyVerified':bool(roles),
        'ciArchiveBytesIndependentlyVerified':False,
        'officialJobAuthenticated':False,'actualGuestApproved':False,
        'candidateReviewed':False,'actualRunApproved':False}


def v6_consumed_failure_partial(value,record,external):
    """Check only the seven retained probes; a clipped listing is never parsed."""
    inventory=value['inventory']
    keys(inventory,'files aliases probes processes fileMetadata pythonFiles mappedLibraries mapsOriginal emptyPythonSources')
    need(inventory['pythonFiles']==[] and inventory['mappedLibraries']==[] and inventory['mapsOriginal'] is None,
         'no later Python/map census or runtime candidate in consumed failure')
    empty=inventory['emptyPythonSources'];keys(empty,'before')
    row=empty['before'];keys(row,'path namedBefore heldBefore heldAfter namedAfter bytesRead readHex eof sha256 closeAttempted closeSucceeded firstFailure secondary')
    path=next(iter(STAGED_EMPTY_PYTHON_SOURCES));info=row['heldBefore']
    need(row['path']==path and type(row['bytesRead']) is int and row['bytesRead']==0 and
         row['readHex']=='' and row['eof'] is True and row['sha256']==STAGED_EMPTY_PYTHON_SOURCES[path]['sha256'] and
         row['closeAttempted'] is True and row['closeSucceeded'] is True and
         row['firstFailure'] is None and row['secondary']==[] and
         type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
         all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63 and
         info[2]==0o100644 and info[3:6]==[0,0,1] and info[6]==0 and
         all(equal(row[key],info) for key in ('namedBefore','heldAfter','namedAfter')),
         'only observed pre-inventory typed empty source EOF/stat/close')
    files=inventory['files'];aliases=inventory['aliases'];metadata=inventory['fileMetadata']
    need(type(files) is dict and 1<=len(files)<=512 and type(aliases) is dict and len(aliases)<=256 and
         type(metadata) is dict and set(metadata)==set(files),'finite partial file/alias observations')
    total=0
    for path,row in files.items():
        runtime_path(path);keys(row,'bytes sha256 mode kind');digest(row['sha256'])
        total+=integer(row['bytes'],1,268435456)
        need(row['kind'] in ('node-binary','python-binary','qemu-binary','observation-tool',
             'tool-interpreter','elf-interpreter','shared-library') and type(row['mode']) is int and
             0<=row['mode']<=0o7777 and row['mode']&0o022==0,'partial pre-listing file kind/mode')
        info=metadata[path]
        need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63 and
             info[0]>0 and info[1]>0 and stat.S_ISREG(info[2]) and
             stat.S_IMODE(info[2])==row['mode'] and info[6]==row['bytes'],
             'partial file original metadata/extent')
    need(total<=1073741824,'partial graph aggregate extent')
    for path,row in aliases.items():
        runtime_path(path);keys(row,'linkText target');runtime_path(row['target'])
        need(type(row['linkText']) is str and 0<len(row['linkText'].encode())<=256 and
             re.fullmatch('[A-Za-z0-9_.+/-]+',row['linkText']) and
             resolve_alias(path,aliases)==row['target'] and
             any(name==row['target'] or name.startswith(row['target']+'/') for name in set(files)|set(aliases)),
             'finite partial alias joins observed graph')
    need(all(resolve_alias(path,aliases)==path for path in files),'partial file paths resolved')
    executables={role:resolve_alias(path,aliases) for role,path in
        (('node',NODE_STAGE_TARGET),('python','/usr/bin/python3'),('qemu',RUNTIME_QEMU))}
    for role,path in executables.items():
        need(path in files and files[path]['kind']==role+'-binary' and
             (role not in RUNTIME_SELECTED or {key:files[path][key] for key in ('bytes','sha256')}==RUNTIME_SELECTED[role]) and
             files[path]['mode']&0o111!=0,'selected pre-probe executable identity')
    for path,kind in (('/usr/bin/ldd','observation-tool'),('/usr/bin/dpkg-query','observation-tool'),
                      ('/usr/bin/bash','tool-interpreter')):
        resolved=resolve_alias(path,aliases)
        need(resolved in files and files[resolved]['kind']==kind and files[resolved]['mode']&0o111!=0,
             'retained named pre-probe tool')
    roles=['ldd-shell','ldd-dpkg-query','ldd-node','ldd-python','ldd-qemu','package-version','package-files']
    probes=inventory['probes'];processes=inventory['processes']
    need(type(probes) is list and type(processes) is list and
         [row['role'] for row in probes]==[row['role'] for row in processes]==roles,
         'exact seven ordered partial probes, no missing or later child')
    expected_argv=[['/usr/bin/ldd','/usr/bin/bash'],['/usr/bin/ldd','/usr/bin/dpkg-query'],
        *[['/usr/bin/ldd',executables[role]] for role in ('node','python','qemu')],
        ['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES],
        ['/usr/bin/dpkg-query','-L',*PACKAGE_NAMES]]
    last=record['sourceCommands'][-1]['process']['reapMonoNs'];pids=set();prefix=None
    for index,(probe,entry,argv) in enumerate(zip(probes,processes,expected_argv)):
        keys(probe,'role argv environment exitCode stdout stderr');keys(entry,'role process stdout stderr')
        process=entry['process'];keys(process,'schema argv environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
        need(probe['argv']==argv and process['argv']==argv and
             probe['environment']==process['environment']=={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'},
             'fixed partial probe descriptor/environment')
        need(process['schema']=='bw.ring3.inventory-process.v1' and type(process['exitCode']) is int and
             process['exitCode']==probe['exitCode']==0 and integer(process['waitStatus'],0,65535)==0 and
             process['signal'] is None and process['timedOut'] is False and process['secondary']==[],
             'retained natural zero/reaped metadata child')
        need(process['firstFailure']==(value['firstFailure'] if index==6 else None),
             'first stream-cap failure belongs only to final metadata child')
        pid=integer(process['pid'],1)
        need(pid not in pids and integer(process['pgid'],1)==pid and
             process['parentPid']==value['stageBefore']['identity']['pid'] and process['parentPid']!=pid,
             'fresh distinct child of dropped observer');pids.add(pid);integer(process['startTicks'],1)
        start=integer(process['spawnMonoNs'],last);end=integer(process['reapMonoNs'],start)
        need(end-start<=10000000000 and start>=record['setup']['configure']['process']['reapMonoNs'],
             'ordered bounded probes after setup');last=end
        keys(process['rusage'],'userSeconds systemSeconds maxRssKiB')
        for name in ('userSeconds','systemSeconds'):
            need(type(process['rusage'][name]) in (int,float) and 0<=process['rusage'][name]<=10,
                 'finite partial child CPU usage')
        integer(process['rusage']['maxRssKiB'],0,1048576)
        stdout=prerequisite_original(canonical(entry['stdout']));stderr=prerequisite_original(canonical(entry['stderr']))
        need(type(probe['stdout']) is str and type(probe['stderr']) is str and
             stdout==probe['stdout'].encode('utf-8','surrogateescape') and
             stderr==probe['stderr'].encode('utf-8','surrogateescape') and stderr==b'' and
             0<len(stdout)<=16384,'exact bounded raw partial process streams')
        if index<5:
            need(all(resolve_alias(path,aliases) in files for path in ldd_paths(probe['stdout'])),
                 'complete earlier ldd rows join partial files')
        elif index==5:
            rows=[line.split('\t') for line in probe['stdout'].splitlines()]
            need(len(rows)==5 and all(len(row)==3 for row in rows) and
                 {row[0] for row in rows}==set(PACKAGE_NAMES) and
                 ['qemu-system-x86','1:8.2.2+ds-0ubuntu1.18','amd64'] in rows,
                 'earlier package version census')
        else:
            prefix=stdout;selected=external['clippedStdout'];keys(selected,'bytes sha256')
            need(integer(selected['bytes'],16384,16384)==len(prefix) and digest(selected['sha256'])==sha(prefix),
                 'independently selected exact cap-clipped stdout prefix')
    need(equal(metadata[NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'partial Node metadata joins finite staged readback')
    return {'bytes':len(prefix),'sha256':sha(prefix)}


def v6_consumed_failure_audit(raw,external,outer_raw,cleanup_raw,shell_raw):
    """Negative-only original audit; external metadata is a separate trust input."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker clippedStdout artifactId archiveBytes archiveSha256')
    need(external['schema']=='bw.ring3.consumed-v6-failure-expectation.v1' and
         external['conclusion']=='failure' and type(external['attempt']) is int and external['attempt']==1 and
         external['jobName']=='setup-runtime-inventory-v6','dedicated consumed failed v6 selection')
    integer(external['jobId'],1);integer(external['artifactId'],1);integer(external['archiveBytes'],1,8<<20)
    digest(external['archiveSha256'])
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'selected official failed run identity')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),('requestSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),'selected failed invoker')
    for name,body,cap in (('log',raw,8<<20),('outer',outer_raw,4096),('cleanup',cleanup_raw,16384),('shell',shell_raw,4096)):
        need(type(body) is bytes and integer(external[name+'Bytes'],1,cap)==len(body) and
             digest(external[name+'Sha256'])==sha(body),'exact externally selected '+name+' original')
    shell=decode_setup_v6_shell(shell_raw,external)
    outer=parse_setup_v6_outer(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v6' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v6-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and outer['systemdRunExitCode']==1 and
         type(outer['outsideCleanupExitCode']) is int and outer['outsideCleanupExitCode']==1 and
         outer['cgroupAfter']=='absent','exact failed outer1/cleanup1 and absent-cgroup observations')
    cleanup=setup_v6_cleanup_original(cleanup_raw,external)
    absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
    need(cleanup['serviceExitCode']==1 and cleanup['sourceAdmission'] is not None and
         cleanup['preCensus']==cleanup['postCensus']==absent and cleanup['cgroupTerminal']=='absent' and
         cleanup['unitCensus'] is None and cleanup['stop']=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
         cleanup['policy'] is None and cleanup['action']=='not-needed' and cleanup['firstFailure']==
             {'phase':'v6-outer-client','name':'ValueError','message':'bounded outer setup client exit 1'} and
         cleanup['secondary']==[] and cleanup['setupApproved'] is False,'known failed-service absent outside census and retained outer-client failure')
    originals=decode_setup_v6_log(raw);packet_raw=originals['runtime.setup-inventory.json']
    value=parse_setup_v6_outer(packet_raw)
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(packet_raw==canonical(value) and value['schema']=='bw.ring3.setup-runtime-inventory-original.v6' and
         value['candidate'] is None and value['firstFailure']=={'phase':'inventory-stream','name':'Refusal',
             'message':'inventory original stdout stream cap'} and value['secondary']==[] and
         value['publicationSafe'] is True and value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,'complete known stream-cap failure, no runtime candidate')
    request=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v6_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and equal(observed,record),
                  'same finite source12/request/record before and after failure')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
         ('record','files','directories','source')),'finite stage readback across failed inventory')
    request_raw=prerequisite_original(canonical(record['request']));event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(cleanup['sourceAdmission']['source'],source) and cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
         'exact raw request/event/source12/executing-workflow and outside joins')
    statuses=decode_setup_v6_status_log(raw);pre=record['setup']['preflight'];post=record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and equal(statuses['post']['meta'],post['statusOriginal']),
         'separately retained raw status joins complete setup observations')
    before=setup_v6_status_rows(statuses['pre']['raw']);after=setup_v6_status_rows(statuses['post']['raw'])
    need(len(before)==pre['statusRecords']==1211 and len(after)==post['records'] and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V6_PACKAGES),
         'independent raw status census and selected pre-absence')
    setup_v6_status_delta(before,after)
    selected={name:None if (name,arch) not in after else {key:after[name,arch].get(key) for key in
        ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
        for name,version,arch,*_ in SETUP_V6_PACKAGES}
    pending={name+':'+arch:{'status':row.get('Status'),'pending':row.get('Triggers-Pending'),
        'awaited':row.get('Triggers-Awaited')} for (name,arch),row in after.items() if
        row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
        row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']),
         'independent raw selected/pending status projection')
    need(record['setup']['preflight']['imageFields']==setup_v6_expected_forwarded(shell['fields']),
         'retained service image fields join shell forwarding')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    def finite_meta(info,directory):
        return (type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
            all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63 and
            (stat.S_ISDIR(info[2]) if directory else stat.S_ISREG(info[2])) and
            info[3:5]==[0,0] and info[2]&0o022==0)
    need(finite_meta(parent['meta'],True) and type(parent['controls']) is dict and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},'finite readonly parent availability')
    for row in parent['controls'].values():
        keys(row,'meta raw');need(finite_meta(row['meta'],False) and type(row['raw']) is str and
             len(row['raw'].encode('ascii'))<=4096,'bounded readonly control availability')
    need(parent['alreadyEnabled'] is all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in
         parent['controls'].values()),'truthful parent availability, no permission inference')
    clipped=v6_consumed_failure_partial(value,record,external)
    return {'schema':'bw.ring3.consumed-v6-failure-audit.v1','failedAttemptRetained':True,
        'failurePacketComplete':True,'partialProbeCount':7,'firstFailure':value['firstFailure'],'secondary':[],
        'clippedStdout':clipped,'packageListingComplete':False,'rawStatusBytesIndependentlyVerified':True,
        'finiteStageReadbackObserved':True,'sourceHead':request['head'],'sourceTree':request['tree'],
        'runId':external['runId'],'jobId':external['jobId'],'workflowSha':external['workflowSha'],
        'externallySelectedArtifact':{key:external[key] for key in ('artifactId','archiveBytes','archiveSha256')},
        'retainedLogBytes':len(raw),'retainedLogSha256':sha(raw),'outerClientExitCode':1,
        'outsideCgroupAfter':'absent','outsideCleanupExitCode':1,'outsideFirstFailure':cleanup['firstFailure'],
        'officialJobAuthenticated':False,'ciArchiveBytesIndependentlyVerified':False,
        'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False,
        'setupObserved':False,'setupApproved':False,'runtimeCandidateApproved':False,'candidateReviewed':False,
        'actualGuestApproved':False,'actualRunApproved':False,'completeHostConfiguration':False,
        'continuousOwnershipEstablished':False}


CONSUMED_V7_COMMA_PATHS=frozenset((
    '/usr/share/qemu/QEMU,VGA.bin',
    '/usr/share/qemu/QEMU,cgthree.bin',
    '/usr/share/qemu/QEMU,tcx.bin',
))


CONSUMED_V7_PYTHON={'bytes':8020928,
    'sha256':'e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f'}


def consumed_v7_failed_listing(raw):
    """Grade the returned ninth listing as data; never admit it as a runtime graph."""
    need(type(raw) is bytes and 0<len(raw)<=16384 and raw.endswith(b'\n') and
         b'\r' not in raw and b'\0' not in raw,'complete bounded failed v7 listing bytes')
    try:lines=raw.decode('utf-8','strict').split('\n')[:-1]
    except UnicodeError as error:raise Refusal('failed v7 listing encoding') from error
    need(lines and lines[0]=='/.','failed v7 listing root marker')
    if lines and lines[-1]=='':lines.pop()
    need(lines and all(line for line in lines),'no interior failed v7 listing separator')
    paths=lines[1:]
    need(0<len(paths)<=2048 and len(paths)==len(set(paths)) and '/.' not in paths,
         'finite unique failed v7 listing rows')
    commas=set()
    for path in paths:
        if ',' in path:
            need(path in CONSUMED_V7_COMMA_PATHS,'only three observed failed package names')
            commas.add(path)
        else:runtime_path(path)
    need(commas==CONSUMED_V7_COMMA_PATHS,'all three observed comma names retained')
    return {'bytes':len(raw),'sha256':sha(raw),'rows':len(paths),
            'commaPaths':sorted(commas)}


def consumed_v7_path_failure_audit(raw,external,outer_raw,cleanup_raw,shell_raw):
    """Negative-only audit of the consumed, complete ninth-probe path refusal."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v7' and
         external['conclusion']=='failure' and type(external['attempt']) is int and
         external['attempt']==1 and external['jobName']=='setup-runtime-inventory-v7',
         'selected failed v7 metadata job only')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'selected failed v7 run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),
                      ('workflowFileSha256',64),('requestSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),
         'selected failed v7 invoker')
    for name,body,cap in (('log',raw,8<<20),('outer',outer_raw,4096),
                          ('cleanup',cleanup_raw,16384),('shell',shell_raw,4096)):
        need(type(body) is bytes and integer(external[name+'Bytes'],1,cap)==len(body) and
             digest(external[name+'Sha256'])==sha(body),
             'exact externally selected failed '+name+' original')
    shell=decode_setup_v7_shell(shell_raw,external)
    outer=parse_setup_v7_outer(outer_raw)
    keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v7' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v7-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and
         type(outer['outsideCleanupExitCode']) is int and
         outer['systemdRunExitCode']==outer['outsideCleanupExitCode']==1 and
         outer['cgroupAfter']=='absent','exact failed outer1/cleanup1 and absent unit')
    cleanup=setup_v7_cleanup_original(cleanup_raw,external)
    absent={'terminal':'absent','cgroupProcs':None,'cgroupEvents':None,'cgroupStat':None}
    need(type(cleanup['serviceExitCode']) is int and cleanup['serviceExitCode']==1 and
         cleanup['sourceAdmission'] is not None and
         cleanup['preCensus']==cleanup['postCensus']==absent and
         cleanup['cgroupTerminal']=='absent' and cleanup['unitCensus'] is None and
         type(cleanup['stop']) is dict and
         type(cleanup['stop'].get('attempted')) is bool and
         type(cleanup['stop'].get('timedOut')) is bool and
         cleanup['stop']=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
         cleanup['policy'] is None and cleanup['action']=='not-needed' and
         cleanup['firstFailure']=={'phase':'v7-outer-client','name':'ValueError',
             'message':'bounded outer setup client exit 1'} and cleanup['secondary']==[] and
         cleanup['setupApproved'] is False,
         'failed service has exact source admission and absent outside cleanup')
    originals=decode_setup_v7_log(raw)
    event_original=originals['setup.event.json']
    need(type(event_original) is bytes and 0<len(event_original)<=1<<20,
         'bounded consumed v7 raw event snapshot')
    event_value=parse_setup_v7_outer(event_original)
    need(type(event_value) is dict,'finite duplicate-safe consumed v7 raw event object')
    packet_raw=originals['runtime.setup-inventory.json']
    value=parse_setup_v7_outer(packet_raw)
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    first={'phase':'setup-v7-runtime-inventory','name':'Refusal',
           'message':'bounded canonical runtime path'}
    need(packet_raw==canonical(value) and
         value['schema']=='bw.ring3.setup-runtime-inventory-original.v7' and
         value['candidate'] is None and value['firstFailure']==first and
         value['secondary']==[] and value['publicationSafe'] is True and
         value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,
         'complete failed path-validation packet, no candidate')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v7_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and
                  equal(observed,record),'same source12/request/stage record on both sides')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
             ('record','files','directories','source')),
         'finite stage file and source readback')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and
         event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(cleanup['sourceAdmission']['source'],source) and
         cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
         'raw request/event/source12/workflow/outside admission joins')
    statuses=decode_setup_v7_status_log(raw)
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']),
         'separately retained pre/post raw status originals')
    before=setup_v7_status_rows(statuses['pre']['raw'])
    after=setup_v7_status_rows(statuses['post']['raw'])
    need(len(before)==pre['statusRecords']==1211 and len(after)==post['records'] and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V7_PACKAGES),
         'independent selected pre-absence and post-status rows')
    setup_v7_status_delta(before,after)
    selected={name:None if (name,arch) not in after else
        {key:after[name,arch].get(key) for key in
         ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
        for name,version,arch,*_ in SETUP_V7_PACKAGES}
    pending={name+':'+arch:{'status':row.get('Status'),
        'pending':row.get('Triggers-Pending'),'awaited':row.get('Triggers-Awaited')}
        for (name,arch),row in after.items() if
        row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
        row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']) and
         pre['imageFields']==setup_v7_expected_forwarded(shell['fields']),
         'raw selected/pending status and shell image forwarding')
    package_pins={name:(version,arch) for name,version,arch,*_ in SETUP_V7_PACKAGES
                  if name in PACKAGE_NAMES}
    need(set(package_pins)==set(PACKAGE_NAMES) and
         all((selected[name]['Version'],selected[name]['Architecture'])==package_pins[name]
             for name in PACKAGE_NAMES),
         'five exact installed package version/architecture pairs')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    info=parent['meta']
    need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
         stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and
         type(parent['controls']) is dict and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},
         'finite root-owned parent controls')
    for row in parent['controls'].values():
        keys(row,'meta raw');need(type(row['raw']) is str and
             len(row['raw'].encode('ascii'))<=4096,'bounded parent control row')
    need(parent['alreadyEnabled'] is all({'cpu','memory','pids'}<=set(row['raw'].split())
         for row in parent['controls'].values()),'truthful readonly parent controls')
    inventory=value['inventory']
    keys(inventory,'files aliases probes processes fileMetadata pythonFiles mappedLibraries mapsOriginal emptyPythonSources')
    files,aliases,metadata=inventory['files'],inventory['aliases'],inventory['fileMetadata']
    need(type(files) is dict and 1<=len(files)<=512 and type(aliases) is dict and
         len(aliases)<=256 and type(metadata) is dict and set(metadata)==set(files) and
         inventory['pythonFiles']==[] and inventory['mappedLibraries']==[] and
         inventory['mapsOriginal'] is None,
         'finite partial graph with no later Python/map census')
    empty=inventory['emptyPythonSources'];keys(empty,'before')
    row=empty['before'];keys(row,'path namedBefore heldBefore heldAfter namedAfter bytesRead readHex eof sha256 closeAttempted closeSucceeded firstFailure secondary')
    info=row['heldBefore']
    need(row['path']==next(iter(STAGED_EMPTY_PYTHON_SOURCES)) and
         row['bytesRead']==0 and row['readHex']=='' and row['eof'] is True and
         row['sha256']==STAGED_EMPTY_PYTHON_SOURCES[row['path']]['sha256'] and
         row['closeAttempted'] is True and row['closeSucceeded'] is True and
         row['firstFailure'] is None and row['secondary']==[] and
         type(info) is list and len(info)==8 and info[2]==0o100644 and
         info[3:7]==[0,0,1,0] and
         all(equal(row[key],info) for key in ('namedBefore','heldAfter','namedAfter')),
         'typed pre-inventory empty Python source readback')
    total=0
    for path,entry in files.items():
        runtime_path(path);keys(entry,'bytes sha256 mode kind');digest(entry['sha256'])
        fact=metadata[path]
        need(type(fact) is list and len(fact)==8 and all(type(x) is int for x in fact) and
             all(0<=x<2**64 for x in fact[:7]) and -2**63<=fact[7]<2**63 and
             fact[0]>0 and fact[1]>0 and stat.S_ISREG(fact[2]) and
             type(entry['mode']) is int and 0<=entry['mode']<=0o7777 and
             entry['mode']&0o022==0 and stat.S_IMODE(fact[2])==entry['mode'] and
             integer(entry['bytes'],1,268435456)==fact[6] and entry['kind'] in
             ('node-binary','python-binary','qemu-binary','observation-tool',
              'tool-interpreter','elf-interpreter','shared-library'),
             'bounded pre-failure file and held metadata')
        total+=entry['bytes']
    need(total<=1073741824,'partial file aggregate extent')
    for path,entry in aliases.items():
        runtime_path(path);keys(entry,'linkText target');runtime_path(entry['target'])
        need(type(entry['linkText']) is str and
             0<len(entry['linkText'].encode())<=256 and
             re.fullmatch('[A-Za-z0-9_.+/-]+',entry['linkText']) and
             resolve_alias(path,aliases)==entry['target'] and
             any(name==entry['target'] or name.startswith(entry['target']+'/')
                 for name in set(files)|set(aliases)),
             'finite pre-failure alias target')
    need(all(resolve_alias(path,aliases)==path for path in files) and
         equal(metadata[NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'selected Node and partial graph source readback')
    for role,named in (('node',NODE_STAGE_TARGET),('python','/usr/bin/python3'),
                       ('qemu',RUNTIME_QEMU)):
        path=resolve_alias(named,aliases)
        expected=CONSUMED_V7_PYTHON if role=='python' else RUNTIME_SELECTED[role]
        need(path in files and files[path]['kind']==role+'-binary' and
             {key:files[path][key] for key in ('bytes','sha256')}==expected and
             files[path]['mode']&0o111!=0,
             'exact consumed executable bytes/hash/kind/mode')
    need(files[NODE_STAGE_TARGET]['bytes']==value['stageAfter']['files']['node']['bytes'] and
         files[NODE_STAGE_TARGET]['sha256']==value['stageAfter']['files']['node']['sha256'],
         'staged Node file hash and extent join')
    probes,processes=inventory['probes'],inventory['processes']
    setup_v7_observed_order(probes,processes,partial=True)
    need(len(probes)==9,'exact nine-child failed prefix')
    executables={'node':NODE_STAGE_TARGET,
        'python':resolve_alias('/usr/bin/python3',aliases),
        'qemu':resolve_alias(RUNTIME_QEMU,aliases)}
    fixed={'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'],
        'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'ldd-tcg':['/usr/bin/ldd',resolve_alias(RUNTIME_TCG,aliases)],
        'package-version':['/usr/bin/dpkg-query','-W',
            '-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]}
    fixed.update({'ldd-'+name:['/usr/bin/ldd',path] for name,path in executables.items()})
    fixed.update({role:['/usr/bin/dpkg-query','-L',name]
                  for name,role in SETUP_V7_PACKAGE_ROLES.items()})
    last=record['sourceCommands'][-1]['process']['reapMonoNs'];pids=set();listed={}
    for probe,entry in zip(probes,processes):
        keys(probe,'role argv environment exitCode stdout stderr')
        keys(entry,'role process stdout stderr')
        process=entry['process']
        keys(process,'schema argv environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
        role=probe['role'];argv=fixed[role]
        need(entry['role']==role and probe['argv']==process['argv']==argv and
             probe['environment']==process['environment']==
             {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'} and
             process['schema']=='bw.ring3.inventory-process.v1' and
             type(process['exitCode']) is int and type(probe['exitCode']) is int and
             type(process['waitStatus']) is int and
             process['exitCode']==probe['exitCode']==0 and process['waitStatus']==0 and
             process['signal'] is None and process['timedOut'] is False and
             process['firstFailure'] is None and process['secondary']==[] and
             probe['stderr']=='' and
             prerequisite_original(canonical(entry['stdout']))==
               probe['stdout'].encode('utf-8','surrogateescape') and
             prerequisite_original(canonical(entry['stderr']))==b'',
             'exact complete zero-exit metadata child and raw streams')
        pid=integer(process['pid'],1)
        need(pid not in pids and integer(process['pgid'],1)==pid and
             process['parentPid']==value['stageBefore']['identity']['pid'],
             'distinct child of dropped observer');pids.add(pid)
        integer(process['startTicks'],1)
        start=integer(process['spawnMonoNs'],last)
        end=integer(process['reapMonoNs'],start)
        need(end-start<=10_000_000_000 and
             start>=record['setup']['configure']['process']['reapMonoNs'],
             'bounded ordered metadata children after setup');last=end
        keys(process['rusage'],'userSeconds systemSeconds maxRssKiB')
        for name in ('userSeconds','systemSeconds'):
            need(type(process['rusage'][name]) in (int,float) and
                 0<=process['rusage'][name]<=10,'bounded child CPU usage')
        integer(process['rusage']['maxRssKiB'],0,1048576)
        stdout=probe['stdout'].encode('utf-8','surrogateescape')
        need(0<len(stdout)<=16384,'bounded returned child stream')
        if role.startswith('ldd-'):
            need(all(resolve_alias(path,aliases) in files for path in ldd_paths(probe['stdout'])),
                 'complete early ldd paths join partial files')
        elif role=='package-version':
            rows=[line.split('\t') for line in probe['stdout'].splitlines()]
            expected={(name,version,arch) for name,version,arch,*_ in SETUP_V7_PACKAGES
                      if name in PACKAGE_NAMES}
            need(len(rows)==5 and all(len(row)==3 for row in rows) and
                 {tuple(row) for row in rows}==expected and
                 all(tuple(row[1:])==package_pins[row[0]] and
                     selected[row[0]]['Version']==row[1] and
                     selected[row[0]]['Architecture']==row[2] for row in rows),
                 'exact five returned package rows join selected post-status')
        elif role=='package-files-qemu-system-data':
            listed[role]=consumed_v7_failed_listing(stdout)
        else:
            listed[role]={'bytes':len(stdout),'sha256':sha(stdout),
                          'rows':len(setup_v7_listed_paths(stdout))}
    return {'schema':'bw.ring3.consumed-v7-path-failure-audit.v1',
        'failedAttemptRetained':True,'failurePacketComplete':True,
        'retainedProbePrefixRoles':list(SETUP_V7_PROBE_ORDER[:9]),
        'returnedNinthListing':listed['package-files-qemu-system-data'],
        'firstFailure':first,'secondary':[],'rawStatusBytesIndependentlyVerified':True,
        'finiteStageReadbackObserved':True,'sourceHead':request['head'],
        'sourceTree':request['tree'],'runId':external['runId'],'jobId':external['jobId'],
        'workflowSha':external['workflowSha'],'retainedLogBytes':len(raw),
        'retainedLogSha256':sha(raw),'outerClientExitCode':1,
        'outsideCleanupExitCode':1,'outsideCgroupAfter':'absent',
        'outsideFirstFailure':cleanup['firstFailure'],
        'officialJobAuthenticated':False,'setupObserved':False,
        'setupApproved':False,'runtimeCandidateApproved':False,
        'actualGuestApproved':False,'actualRunApproved':False,
        'completeHostConfiguration':False,'partialMutationPossible':True}


# Independent, read-only baseline original audit. No producer imports.
HOST_BASELINE_READER_ENABLED=True
HOST_BASELINE_MARKER=b'RING3_HOST_BASELINE_V1 '
HOST_BASELINE_JOB='host-baseline-v1'
HOST_BASELINE_LABEL='x86-ring3-host-baseline-v1'
HOST_BASELINE_PIN='BW_RING3_HOST_BASELINE_V1_REQUEST_SHA256'
HOST_BASELINE_B64='BW_RING3_HOST_BASELINE_V1_REQUEST_B64'
HOST_BASELINE_HELPERS=(
    '/usr/bin/dash','/usr/bin/deb-systemd-helper','/usr/bin/deb-systemd-invoke',
    '/usr/bin/dpkg-maintscript-helper','/usr/bin/systemctl','/usr/sbin/invoke-rc.d',
    '/usr/sbin/update-rc.d','/usr/sbin/start-stop-daemon','/usr/sbin/ldconfig',
    '/usr/sbin/ldconfig.real')
HOST_BASELINE_ALIASES=('/bin','/bin/sh','/usr/bin/sh')


def host_baseline_field_errors(fields,errors):
    image_diag_fields(fields,bool(errors))
    need(type(errors) is list and len(errors)<=2 and
         all(type(code) is str and code in {name+':'+reason
             for name in ('ImageOS','ImageVersion')
             for reason in ('type','encoding','unsafe-or-oversize')}
             for code in errors),'bounded image field refusal codes')
    refused={name for name in ('ImageOS','ImageVersion')
             if fields[name]=={'present':True,'value':None}}
    need({code.split(':')[0] for code in errors}==refused and
         len(errors)==len(refused),'image field errors join refused values')


def host_baseline_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=65536 and digest(pin)==sha(raw),
         'externally selected baseline request')
    value=parse_setup_v8_outer(raw);keys(value,'schema repository pullRequest head tree source')
    need(raw==canonical(value) and value['schema']=='bw.ring3.host-baseline-request.v1' and
         value['repository']=='CrispStrobe/bw-board' and
         type(value['pullRequest']) is int and 0<value['pullRequest']<2**31,
         'canonical own baseline request')
    digest(value['head'],40);digest(value['tree'],40)
    source_raw=prerequisite_original(canonical(value['source']))
    source=parse_setup_v8_outer(source_raw);keys(source,'schema head tree files')
    need(source_raw==canonical(source) and source['schema']=='bw.ring3.source.v1' and
         source['head']==value['head'] and source['tree']==value['tree'] and
         type(source['files']) is dict and set(source['files'])==SETUP_SOURCE_PATHS,
         'exact baseline source twelve')
    for item in source['files'].values():
        keys(item,'mode blob bytes sha256')
        need(item['mode']=='100644','regular source role')
        integer(item['bytes'],0,4<<20);digest(item['sha256']);digest(item['blob'],40)
    return value,source


def host_baseline_event(raw,request,pin,environment):
    event=parse_setup_v8_outer(raw);pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_HOST_BASELINE_V1\n';end='\nBW_RING3_HOST_BASELINE_V1 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and
         body.index(start)<body.index(end) and
         body.split(start,1)[1].split(end,1)[0]==pin,
         'one separate baseline body SHA marker')
    need(type(environment.get(HOST_BASELINE_B64)) is str and
         environment[HOST_BASELINE_B64]==base64.b64encode(canonical(request)).decode('ascii'),
         'exact external baseline request transport')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')==HOST_BASELINE_LABEL and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and
         event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and
         type(pr.get('number')) is int and pr['number']==request['pullRequest'] and
         pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and
         pr['head']['repo'].get('fork') is False and pr.get('base',{}).get('ref')=='master' and
         pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'bound first own baseline event')
    need(all(environment.get(k)==v for k,v in {
        'GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':HOST_BASELINE_JOB,'GITHUB_RUN_ATTEMPT':'1',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        HOST_BASELINE_PIN:pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge',
    }.items()),'reported baseline service context')
    need(type(environment.get('GITHUB_RUN_ID')) is str and
         re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first baseline run')
    digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def host_baseline_identity(row):
    keys(row,'dev ino mode uid gid nlink size mtime_ns')
    for key in row:integer(row[key],0,2**64-1)
    return row


def host_baseline_bytes(item,path,cap):
    keys(item,'path kind namedBefore heldBefore heldAfter namedAfter bytesRead prefixSha256 zlibBase64 closeAttempted closed firstFailure secondary')
    need(item['path']==path and item['kind']=='regular' and item['firstFailure'] is None and
         item['secondary']==[] and item['closeAttempted'] is True and item['closed'] is True,
         'complete baseline regular role')
    for name in ('namedBefore','heldBefore','heldAfter','namedAfter'):
        host_baseline_identity(item[name])
    need(item['namedBefore']==item['heldBefore']==item['heldAfter']==item['namedAfter'] and
         item['namedBefore']['uid']==item['namedBefore']['gid']==0 and
         item['namedBefore']['nlink']==1 and stat.S_ISREG(item['namedBefore']['mode']),
         'root regular stable identity and readback')
    integer(item['bytesRead'],0,cap)
    need(item['bytesRead']==item['namedBefore']['size'],'complete original bytes')
    digest(item['prefixSha256'])
    encoded=item['zlibBase64']
    need(type(encoded) is str and 0<len(encoded)<=4*(4<<20)//3+4,'bounded encoded role')
    zipped=base64.b64decode(encoded,validate=True)
    need(base64.b64encode(zipped).decode('ascii')==encoded,'canonical role base64')
    decoder=zlib.decompressobj()
    raw=decoder.decompress(zipped,cap+1)
    need(len(raw)<=cap and decoder.eof and not decoder.unused_data and
         not decoder.unconsumed_tail,'complete bounded zlib role')
    need(len(raw)==item['bytesRead'] and sha(raw)==item['prefixSha256'],
         'independent raw role extent and SHA')
    return raw


def host_baseline_status(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and raw.endswith(b'\n'),
         'complete bounded status bytes')
    text=raw.decode('utf-8','strict');rows={};counts={}
    for paragraph in text.strip('\n').split('\n\n'):
        need(paragraph and len(rows)<5000,'finite status paragraph roster')
        fields={};last=None;seen=set();conffiles_fold_pending=False
        for line in paragraph.split('\n'):
            if line.startswith((' ', '\t')):
                need(last is not None,'status fold has parent')
                if last in ('package','version','architecture','status'):
                    raise Refusal('folded status authority field')
                need(line.strip(' \t')!='','nonempty folded status line')
                conffiles_fold_pending=False
                continue
            need(not conffiles_fold_pending,'empty Conffiles requires folded value')
            need(':' in line,'status field delimiter')
            name,value=line.split(':',1)
            lower=name.lower()
            need(re.fullmatch('[A-Za-z][A-Za-z0-9-]*',name) is not None and
                 (value.startswith(' ') or (lower=='conffiles' and value=='')),
                 'bounded Debian status field')
            need(lower not in seen,'unique case-insensitive Debian field')
            seen.add(lower)
            conffiles_fold_pending=(lower=='conffiles' and value=='')
            value=value[1:] if value else '';last=lower
            authority={'package':'Package','version':'Version',
                       'architecture':'Architecture','status':'Status'}.get(lower)
            if authority is not None:
                need(value.strip(' \t')!='','nonempty status authority')
                fields[authority]=value
        need(not conffiles_fold_pending,'empty Conffiles requires folded value')
        need(set(fields)=={'Package','Version','Architecture','Status'},
             'complete status authority quartet')
        key=(fields['Package'],fields['Architecture'])
        need(key not in rows,'duplicate package architecture')
        rows[key]=fields
        counts[fields['Status']]=counts.get(fields['Status'],0)+1
    return {'records':len(rows),'statusCounts':counts,
            'architectures':sorted({row['Architecture'] for row in rows.values()})}


def host_baseline_official_image(raw,job_name):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded official job log bytes')
    lines=raw.decode('utf-8','strict').splitlines();groups=[];inside=False;row={}
    first_run_seen=False;job_name_seen=False;setup_region_seen=False
    for line in lines:
        need(len(line.encode('utf-8'))<=131072,'bounded official log line')
        match=re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z (.*)',line)
        if not match:continue
        value=match.group(1)
        if value.startswith('Complete job name: '):
            need(not first_run_seen and not job_name_seen and len(groups)==1 and
                 value=='Complete job name: '+job_name,'official pre-step job identity')
            job_name_seen=True
        if value.startswith('##[group]Run '):
            if not first_run_seen:
                need(job_name_seen and value.startswith('##[group]Run actions/checkout@'),
                     'checkout is first hosted step')
            first_run_seen=True
        if value=='##[group]Runner Image':
            need(not inside and not first_run_seen and not job_name_seen,
                 'Runner Image only in platform setup prefix')
            inside=True;row={};setup_region_seen=True;continue
        if not inside:continue
        if value=='##[endgroup]':
            need(set(row)=={'Image','Version'},'complete Runner Image group')
            groups.append(row);inside=False;continue
        for field in ('Image','Version'):
            if value.startswith(field+': '):
                need(field not in row,'duplicate official image field')
                found=value[len(field)+2:]
                need(0<len(found.encode('utf-8'))<=256 and
                     all(32<=ord(ch)<127 for ch in found),
                     'bounded official image field')
                row[field]=found
    need(not inside and len(groups)==1 and setup_region_seen and job_name_seen and first_run_seen,
         'one complete pre-checkout official Runner Image block')
    return groups[0]


def host_baseline_context(context,external):
    request_raw=prerequisite_original(canonical(context['request']))
    request,source=host_baseline_request(request_raw,external['requestSha256'])
    need(request['head']==external['head'] and request['tree']==external['tree'] and
         context['source']==source and
         source['files']['.github/workflows/i80386-ring3-int-iret.yml']['sha256']==external['workflowFileSha256'],
         'exact baseline source and workflow bytes')
    event_raw=prerequisite_original(canonical(context['event']))
    image_diag_source_witness(context['sourceCommands'],context['eventIdentity'],
                              event_raw,request,source)
    environment={'GITHUB_RUN_ID':external['runId'],'GITHUB_RUN_ATTEMPT':'1',
        'GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':HOST_BASELINE_JOB,
        'GITHUB_WORKFLOW_SHA':external['workflowSha'],
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge',
        'BW_EXPECTED_HEAD':external['head'],'BW_EXPECTED_TREE':external['tree'],
        HOST_BASELINE_PIN:external['requestSha256']}
    need(context['platform']==environment,'exact reported baseline platform')
    host_baseline_event(event_raw,request,external['requestSha256'],
        dict(environment,**{HOST_BASELINE_B64:base64.b64encode(request_raw).decode('ascii')}))
    need(context['resource']=={'membership':'0::/system.slice/bw-ring3-host-baseline-'+external['runId']+'-1.service\n',
        'limits':{'cpuMax':'100000 100000','memoryMax':'1073741824','swapMax':'0','pidsMax':'64'}},
        'bounded owned baseline service')
    return request


def host_baseline_failure(value):
    need(type(value) is dict and set(value) in (
        {'phase','name','message'},
        {'phase','name','message','messageBytes','messageSha256'}),
        'closed retained failure fact')
    need(all(type(value[k]) is str and 0<len(value[k].encode('utf-8'))<=256
             for k in ('phase','name','message')),'bounded retained failure fields')
    if 'messageBytes' in value:
        need(value['message']=='[message omitted: over 256 UTF-8 bytes]' and
             type(value['messageBytes']) is int and 256<value['messageBytes']<=1<<24,
             'explicit omitted long failure text extent')
        digest(value['messageSha256'])


def host_baseline_failed_file(item,path,cap):
    keys(item,'path kind namedBefore heldBefore heldAfter namedAfter bytesRead prefixSha256 zlibBase64 closeAttempted closed firstFailure secondary')
    need(item['path']==path and item['kind']=='error' and item['zlibBase64'] is None and
         type(item['closeAttempted']) is bool and type(item['closed']) is bool and
         (not item['closed'] or item['closeAttempted']) and
         type(item['secondary']) is list and len(item['secondary'])<=8,
         'typed failed regular role')
    integer(item['bytesRead'],0,cap);digest(item['prefixSha256'])
    host_baseline_failure(item['firstFailure'])
    for fact in item['secondary']:host_baseline_failure(fact)
    for key in ('namedBefore','heldBefore','heldAfter','namedAfter'):
        if item[key] is not None:host_baseline_identity(item[key])


def host_baseline_failed_alias(item,path):
    keys(item,'path kind namedBefore namedAfter linkText target firstFailure secondary')
    need(item['path']==path and item['kind']=='error' and
         type(item['secondary']) is list and len(item['secondary'])<=8,
         'typed failed alias role')
    host_baseline_failure(item['firstFailure'])
    for fact in item['secondary']:host_baseline_failure(fact)
    for key in ('namedBefore','namedAfter'):
        if item[key] is not None:host_baseline_identity(item[key])
    if item['linkText'] is not None:
        need(type(item['linkText']) is str and 0<len(item['linkText'].encode())<=256 and
             '\x00' not in item['linkText'],'bounded partial alias text')
    if item['target'] is not None:
        need(type(item['target']) is str and item['linkText'] is not None and
             item['target']==posixpath.normpath(posixpath.join(
                 posixpath.dirname(path),item['linkText'])),'partial lexical target')


def verify_host_baseline(service_log,shell_raw,outside_raw,official_log,external):
    keys(external,'schema runId attempt head tree requestSha256 workflowSha workflowFileSha256 jobId jobName conclusion serviceBytes serviceSha256 shellBytes shellSha256 outsideBytes outsideSha256 officialLogBytes officialLogSha256')
    need(external['schema']=='bw.ring3.host-baseline-expectation.v1' and
         external['jobName']==HOST_BASELINE_JOB and external['attempt']=='1' and
         type(external['jobId']) is int and 0<external['jobId']<2**63 and
         external['conclusion'] in ('success','failure'),'externally selected baseline job')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),('requestSha256',64),
                      ('serviceSha256',64),('shellSha256',64),('outsideSha256',64),
                      ('officialLogSha256',64)):
        digest(external[name],size)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'exact baseline run')
    for raw,prefix,cap in ((service_log,'service',4<<20),(shell_raw,'shell',4096),
                           (outside_raw,'outside',16384),(official_log,'officialLog',8<<20)):
        need(type(raw) is bytes and 0<len(raw)<=cap and
             integer(external[prefix+'Bytes'],1,cap)==len(raw) and
             sha(raw)==external[prefix+'Sha256'],'external original SHA/extent '+prefix)
    image=host_baseline_official_image(official_log,external['jobName'])
    need(shell_raw==canonical(parse_setup_v8_outer(shell_raw)),'canonical baseline shell')
    shell=parse_setup_v8_outer(shell_raw)
    keys(shell,'schema fields fieldErrors setupAttempted guestAttempted setupApproved')
    need(shell['schema']=='bw.ring3.host-baseline-shell.v1' and
         all(shell[k] is False for k in ('setupAttempted','guestAttempted','setupApproved')),
         'read-only baseline shell')
    host_baseline_field_errors(shell['fields'],shell['fieldErrors'])
    lines=[]
    for line in service_log.splitlines():
        at=line.find(HOST_BASELINE_MARKER)
        if at>=0:
            need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
                 'service log timestamp prefix')
            lines.append(line[at+len(HOST_BASELINE_MARKER):])
    need(len(lines)==1,'one retained baseline packet')
    packet=parse_setup_v8_outer(lines[0])
    need(lines[0]+b'\n'==canonical(packet),'canonical baseline service original')
    keys(packet,'schema fields fieldErrors context status helpers helperOrder aliases aliasOrder policy firstFailure secondary complete setupApproved runtimeApproved guestApproved imageAuthenticated hostConfigurationApproved')
    need(packet['schema']=='bw.ring3.host-baseline-original.v1' and
         all(packet[k] is False for k in ('setupApproved','runtimeApproved','guestApproved',
                                          'imageAuthenticated','hostConfigurationApproved')),
         'all baseline authority false')
    host_baseline_field_errors(packet['fields'],packet['fieldErrors'])
    need(outside_raw==canonical(parse_setup_v8_outer(outside_raw)),'canonical outside')
    outside=parse_setup_v8_outer(outside_raw)
    keys(outside,'schema runId unit shellExitCode serviceExitCode cgroupAfter cleanupAction polls firstFailure secondary setupApproved')
    need(outside['schema']=='bw.ring3.host-baseline-outside.v1' and
         outside['runId']==external['runId'] and
         outside['unit']=='/sys/fs/cgroup/system.slice/bw-ring3-host-baseline-'+external['runId']+'-1.service' and
         outside['cgroupAfter'] in ('absent','empty','populated','unknown') and
         type(outside['shellExitCode']) is int and type(outside['serviceExitCode']) is int and
         0<=outside['shellExitCode']<=255 and 0<=outside['serviceExitCode']<=255 and
         outside['cleanupAction']=='none' and outside['setupApproved'] is False and
         type(outside['secondary']) is list and len(outside['secondary'])<=8 and
         type(outside['polls']) is list and len(outside['polls'])<=6,
         'bounded read-only outside terminal identity')
    if outside['firstFailure'] is not None:host_baseline_failure(outside['firstFailure'])
    for fact in outside['secondary']:host_baseline_failure(fact)
    for index,item in enumerate(outside['polls']):
        keys(item,'terminal cgroupProcs cgroupEvents cgroupStat')
        need(item['terminal'] in ('absent','empty','populated'),'typed finite census')
        if item['terminal']=='absent':
            need(all(item[k] is None for k in ('cgroupProcs','cgroupEvents','cgroupStat')),
                 'absent unit has no cgroup texts')
        else:
            procs,events,stats=(item[k] for k in ('cgroupProcs','cgroupEvents','cgroupStat'))
            need(all(type(x) is str and len(x.encode())<=1024 for x in (procs,events,stats)) and
                 (item['terminal']=='empty')==setup_v8_cgroup_quiet(procs,events,stats),
                 'independent bounded nested cgroup census')
        if index<len(outside['polls'])-1:
            need(item['terminal']=='populated','only populated unit is repolled')
    if outside['polls']:
        need(outside['cgroupAfter']==outside['polls'][-1]['terminal'],
             'last outside census is terminal report')
    else:need(outside['cgroupAfter']=='unknown' and outside['firstFailure'] is not None,
              'missing outside census remains failure')
    need(outside['shellExitCode']==(1 if shell['fieldErrors'] else 0),
         'shell field refusal and process exit agree')
    context=packet['context']
    keys(context,'request event platform source sourceCommands eventIdentity resource')
    need(type(packet['complete']) is bool and type(packet['secondary']) is list and
         len(packet['secondary'])<=32,'bounded baseline packet failures')
    if packet['firstFailure'] is not None:host_baseline_failure(packet['firstFailure'])
    for fact in packet['secondary']:host_baseline_failure(fact)
    complete=(packet['complete'] is True and packet['firstFailure'] is None and
             packet['secondary']==[] and not packet['fieldErrors'] and
             not shell['fieldErrors'])
    if complete:
        host_baseline_context(context,external)
        need(type(packet['helpers']) is dict and set(packet['helpers'])==set(HOST_BASELINE_HELPERS) and
             packet['helperOrder']==list(HOST_BASELINE_HELPERS) and
             type(packet['aliases']) is dict and set(packet['aliases'])==set(HOST_BASELINE_ALIASES) and
             packet['aliasOrder']==list(HOST_BASELINE_ALIASES),
             'closed helper/alias roles')
        raw_status=host_baseline_bytes(packet['status'],'/var/lib/dpkg/status',8<<20)
        census=host_baseline_status(raw_status)
        total=0
        for path in HOST_BASELINE_HELPERS:
            raw=host_baseline_bytes(packet['helpers'][path],path,2<<20)
            total+=len(raw);need(total<=8<<20,'helper aggregate decoded cap')
        for path in HOST_BASELINE_ALIASES:
            item=packet['aliases'][path]
            keys(item,'path kind namedBefore namedAfter linkText target firstFailure secondary')
            need(item['path']==path and item['kind']=='alias' and item['firstFailure'] is None and
                 item['secondary']==[] and item['namedBefore']==item['namedAfter'],
                 'complete stable alias')
            before=host_baseline_identity(item['namedBefore'])
            need(stat.S_ISLNK(before['mode']) and type(item['linkText']) is str and
                 0<len(item['linkText'].encode('utf-8'))<=256 and '\x00' not in item['linkText'] and
                 item['target']==posixpath.normpath(posixpath.join(posixpath.dirname(path),item['linkText'])),
                 'bounded alias target')
        policy=packet['policy'];keys(policy,'path kind identity linkText firstFailure secondary')
        need(policy['path']=='/usr/sbin/policy-rc.d' and policy['kind'] in ('absent','present') and
             policy['firstFailure'] is None and policy['secondary']==[],
             'typed baseline policy observation')
        if policy['kind']=='absent':need(policy['identity'] is None and policy['linkText'] is None,'absent policy')
        else:
            info=host_baseline_identity(policy['identity'])
            if stat.S_ISLNK(info['mode']):
                need(type(policy['linkText']) is str and
                     0<len(policy['linkText'].encode('utf-8'))<=256 and
                     '\x00' not in policy['linkText'],'bounded present policy link')
            else:need(policy['linkText'] is None,'nonalias policy has no link text')
    else:
        need(type(packet['firstFailure']) is dict and packet['complete'] is False,
             'bounded failed baseline inner attempt')
        need(type(packet['helpers']) is dict and type(packet['aliases']) is dict and
             type(packet['helperOrder']) is list and type(packet['aliasOrder']) is list and
             packet['helperOrder']==list(HOST_BASELINE_HELPERS[:len(packet['helperOrder'])]) and
             packet['aliasOrder']==list(HOST_BASELINE_ALIASES[:len(packet['aliasOrder'])]) and
             set(packet['helpers'])==set(packet['helperOrder']) and
             set(packet['aliases'])==set(packet['aliasOrder']),
             'failed baseline ordered file prefix')
        if packet['status'] is not None or packet['helpers'] or packet['aliases'] or packet['policy'] is not None:
            host_baseline_context(context,external)
        elif context['source'] is not None:
            host_baseline_context(context,external)
        census=None;item_failure=None;item_secondary=[]
        if packet['status'] is not None:
            status=packet['status']
            if status['kind']=='regular':
                census=host_baseline_status(host_baseline_bytes(status,'/var/lib/dpkg/status',8<<20))
            else:
                host_baseline_failed_file(status,'/var/lib/dpkg/status',8<<20)
                item_failure=status['firstFailure'];item_secondary=status['secondary']
        total=0
        for path in packet['helperOrder']:
            item=packet['helpers'][path]
            if item['kind']=='regular':
                total+=len(host_baseline_bytes(item,path,2<<20))
                need(total<=8<<20,'failed helper prefix aggregate cap')
            else:
                need(path==packet['helperOrder'][-1],'only final helper may be partial')
                host_baseline_failed_file(item,path,2<<20)
                item_failure=item['firstFailure'];item_secondary=item['secondary']
        for path in packet['aliasOrder']:
            item=packet['aliases'][path]
            if item['kind']=='error':
                need(path==packet['aliasOrder'][-1],'only final alias may be partial')
                host_baseline_failed_alias(item,path)
                item_failure=item['firstFailure'];item_secondary=item['secondary']
            else:
                keys(item,'path kind namedBefore namedAfter linkText target firstFailure secondary')
                need(item['path']==path and item['kind']=='alias' and item['firstFailure'] is None and
                     item['secondary']==[] and item['namedBefore']==item['namedAfter'],
                     'complete failed-prefix alias')
                before=host_baseline_identity(item['namedBefore'])
                need(stat.S_ISLNK(before['mode']) and type(item['linkText']) is str and
                     0<len(item['linkText'].encode())<=256 and '\x00' not in item['linkText'] and
                     item['target']==posixpath.normpath(posixpath.join(
                         posixpath.dirname(path),item['linkText'])),
                     'bounded failed-prefix alias target')
        if packet['policy'] is not None:
            policy=packet['policy']
            keys(policy,'path kind identity linkText firstFailure secondary')
            need(policy['path']=='/usr/sbin/policy-rc.d' and
                 policy['kind'] in ('absent','present','error'),
                 'fixed failed policy role')
            if policy['kind']=='error':
                host_baseline_failure(policy['firstFailure'])
                need(type(policy['secondary']) is list and len(policy['secondary'])<=8,
                     'bounded policy secondary')
                for fact in policy['secondary']:host_baseline_failure(fact)
                item_failure=policy['firstFailure'];item_secondary=policy['secondary']
            else:
                need(policy['firstFailure'] is None and policy['secondary']==[],
                     'complete failed-prefix policy role')
                if policy['kind']=='absent':
                    need(policy['identity'] is None and policy['linkText'] is None,
                         'absent failed-prefix policy')
                else:
                    info=host_baseline_identity(policy['identity'])
                    if stat.S_ISLNK(info['mode']):
                        need(type(policy['linkText']) is str and
                             0<len(policy['linkText'].encode())<=256 and
                             '\x00' not in policy['linkText'],
                             'bounded failed-prefix policy link')
                    else:need(policy['linkText'] is None,'nonalias failed-prefix policy')
        if item_failure is not None:
            need(packet['firstFailure']==item_failure and
                 packet['secondary'][:len(item_secondary)]==item_secondary,
                 'top first and secondary preserve failing data role')
    terminal=(outside['shellExitCode']==0 and outside['serviceExitCode']==0 and
              outside['cgroupAfter'] in ('absent','empty') and
              outside['firstFailure'] is None and outside['secondary']==[])
    reported_complete=complete and terminal and external['conclusion']=='success'
    if not reported_complete:
        need(external['conclusion']=='failure' and (not complete or not terminal),
             'failed selected job retains inner or outer refusal')
    forwarded=shell['fields']
    return {'schema':'bw.ring3.host-baseline-reader.v1',
        'completeObservation':reported_complete,'statusCensus':census,
        'shellFields':shell['fields'],'serviceFields':packet['fields'],
        'forwardingMatchesExpected':packet['fields']==forwarded,
        'officialRunnerImage':image,
        'runnerImageMatchesService':image['Version']==packet['fields']['ImageVersion']['value'] and
            image['Image']=='ubuntu-24.04' and packet['fields']['ImageOS']['value']=='ubuntu24',
        'firstFailure':packet['firstFailure'] or outside['firstFailure'],
        'outsideCgroupAfter':outside['cgroupAfter'],
        'officialJobAuthenticatedByInnerReader':False,'setupApproved':False,
        'runtimeApproved':False,'guestApproved':False,'imageAuthenticated':False}



# Distinct V9 metadata reader. The selected fifteen-role graph remains the same
# immutable data-only component; all request, event, stage and outside admission
# below is V9-specific. Historical V8 functions above remain unmodified.
SETUP_V9_READER_ENABLED=True
SETUP_V9_IMAGES=('20261012.334.1','20261023.334.3')
SETUP_V9_PACKAGES=SETUP_V8_PACKAGES
SETUP_V9_ORDER=SETUP_V8_ORDER
SETUP_V9_STATUS_SHA=SETUP_V8_STATUS_SHA
SETUP_V9_STATUS_BYTES=SETUP_V8_STATUS_BYTES
SETUP_V9_PAYLOAD_PINS=SETUP_V8_PAYLOAD_PINS
SETUP_V9_HELPERS=SETUP_V8_HELPERS
SETUP_V9_HELPER_ALIASES=SETUP_V8_HELPER_ALIASES
SETUP_V9_NEW_HELPER_BYTES=SETUP_V8_NEW_HELPER_BYTES
SETUP_V9_INSTALLER_ENV=SETUP_V8_INSTALLER_ENV
SETUP_V9_PLATFORM=tuple('BW_RING3_SETUP_INVENTORY_V9_REQUEST_SHA256' if key=='BW_RING3_SETUP_INVENTORY_V8_REQUEST_SHA256' else
    'BW_RING3_SETUP_INVENTORY_V9_REQUEST_B64' if key=='BW_RING3_SETUP_INVENTORY_V8_REQUEST_B64' else key
    for key in SETUP_V8_PLATFORM)
SETUP_V9_STATUS_MARKER=b'RING3_SETUP_STATUS_V9 '
SETUP_V9_LOG_MARKER=b'RING3_SETUP_RUNTIME_INVENTORY_V9 '
SETUP_V9_LOG_ROLES=SETUP_V8_LOG_ROLES
SETUP_V9_PACKAGE_ROLES=SETUP_V8_PACKAGE_ROLES
SETUP_V9_PROBE_ROLES=SETUP_V8_PROBE_ROLES
SETUP_V9_PROBE_ORDER=SETUP_V8_PROBE_ORDER
SETUP_V9_SIGNED_DATA=SETUP_V8_SIGNED_DATA
SETUP_V9_DATA_ARCHIVE=SETUP_V8_DATA_ARCHIVE
SetupV9Inventory=SetupV8Inventory
setup_v9_runtime_expectation=setup_v8_runtime_expectation
verify_setup_v9_inventory_graph=verify_setup_v8_inventory_graph
setup_v9_observed_order=setup_v8_observed_order
setup_v9_status_rows=setup_v8_status_rows
setup_v9_status_delta=setup_v8_status_delta
setup_v9_cgroup_quiet=setup_v8_cgroup_quiet
setup_v9_expected_forwarded=setup_v8_expected_forwarded
setup_v9_image_observation=setup_v8_image_observation
setup_v9_listed_paths=setup_v8_listed_paths
setup_v9_probe_descriptors=setup_v8_probe_descriptors
v9_process=v8_process


def parse_setup_v9_outer(value):
    """Only the new combined setup/runtime or failed-entry packet has a 4 MiB cap."""
    need(type(value) is bytes and 0<len(value)<=4<<20,'versioned v9 outer JSON byte cap')
    def unique(pairs):
        result={}
        for key,item in pairs:
            need(key not in result,'duplicate v9 outer JSON key')
            result[key]=item
        return result
    def finite(token):
        value=float(token)
        need(math.isfinite(value),'nonfinite v9 outer JSON number')
        return value
    return json.loads(value.decode('utf-8'),object_pairs_hook=unique,parse_float=finite,
                      parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite v9 outer JSON')))


def decode_setup_v9_shell(raw,external):
    need(type(raw) is bytes and 0<len(raw)<=4096 and
         integer(external['shellBytes'],1,4096)==len(raw) and
         digest(external['shellSha256'])==sha(raw),
         'externally selected exact v9 shell image original')
    value=parse(raw);keys(value,'schema fields fieldErrors setupAttempted guestAttempted setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-image-shell.v9' and
         value['setupAttempted'] is False and value['guestAttempted'] is False and
         value['setupApproved'] is False,'canonical no-setup v9 shell observation')
    setup_v9_image_observation(value['fields'],value['fieldErrors'])
    return value


def setup_v9_policy():
    return {'imageOS':'ubuntu24','imageVersions':list(SETUP_V9_IMAGES),
        'statusSha256':SETUP_V9_STATUS_SHA,
        'helperSha256':SETUP_V9_HELPERS,'helperAliases':SETUP_V9_HELPER_ALIASES,
        'packages':[{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':digest}
            for name,version,arch,filename,size,digest in SETUP_V9_PACKAGES],
        'configureOrder':list(SETUP_V9_ORDER),'unpackOptions':['--no-triggers','--unpack'],
        'configureOptions':['--no-triggers','--configure'],'policyPath':'/usr/sbin/policy-rc.d',
        'policyExit':101,'installerPath':'/usr/sbin:/usr/bin:/bin','deferredTriggers':True,'apt':False,'recommends':False,'force':False,
        'upgrade':False,'configurationComplete':False}


def setup_v9_request(raw,pin):
    need(type(raw) is bytes and 0<len(raw)<=32768 and digest(pin)==sha(raw),'externally selected v9 request')
    value=parse(raw);keys(value,'schema repository pullRequest head tree source selected nodeStage emptyPythonSources setup payloadWitness')
    need(raw==canonical(value) and value['schema']=='bw.ring3.inventory-request.v9','canonical v9 request')
    base={key:value[key] for key in ('repository','pullRequest','head','tree','source','selected','nodeStage','emptyPythonSources')}
    base['schema']='bw.ring3.inventory-request.v3'
    old,source=staged_runtime_request(canonical(base),sha(canonical(base)))
    need(equal(value['setup'],setup_v9_policy()),'exact selected v9 setup policy')
    need(type(SETUP_V9_PAYLOAD_PINS) is dict and len(SETUP_V9_PAYLOAD_PINS['archives'])==15 and
         all((item['package'],item['archiveBytes'],item['archiveSha256'])==(name,size,digest)
             for item,(name,version,arch,filename,size,digest) in
             zip(SETUP_V9_PAYLOAD_PINS['archives'],SETUP_V9_PACKAGES)),
         'independent payload/archive selection join')
    need(SETUP_V9_PAYLOAD_PINS is not None and equal(value['payloadWitness'],SETUP_V9_PAYLOAD_PINS),
         'separately reviewed payload/control witness required')
    selected_archive=next(item for item in value['payloadWitness']['archives']
                          if item['package']=='qemu-system-data')
    need(selected_archive['archiveBytes']==SETUP_V9_DATA_ARCHIVE['bytes'] and
         selected_archive['archiveSha256']==SETUP_V9_DATA_ARCHIVE['sha256'] and
         selected_archive['dataTarSha256']==SETUP_V9_DATA_ARCHIVE['dataTarSha256'] and
         selected_archive['payloadManifestSha256']==SETUP_V9_DATA_ARCHIVE['payloadManifestSha256'],
         'independent signed DATA archive/tar/manifest selection')
    return value,source


def setup_v9_event(raw,request,pin,environment):
    need(type(raw) is bytes and 0<len(raw)<=CAPS['jsonBytes'],'bounded raw v9 event')
    try:event=parse_setup_v9_outer(raw)
    except (ValueError,UnicodeError,OverflowError) as error:
        raise Refusal('finite duplicate-free v9 event JSON') from error
    need(type(event) is dict,'object v9 event')
    pr=event.get('pull_request',{});body=pr.get('body')
    start='<!-- BW_RING3_SETUP_RUNTIME_INVENTORY_V9\n';end='\nBW_RING3_SETUP_RUNTIME_INVENTORY_V9 -->'
    need(type(body) is str and body.count(start)==body.count(end)==1 and body.index(start)<body.index(end),'one v9 request block')
    block=body.split(start,1)[1].split(end,1)[0]
    encoded=environment.get('BW_RING3_SETUP_INVENTORY_V9_REQUEST_B64')
    need(block==pin and type(encoded) is str and 0<len(encoded)<=43692,
         'exact v9 SHA-only body and repository request')
    try:raw=base64.b64decode(encoded,validate=True)
    except (ValueError,TypeError) as error:raise Refusal('invalid v9 request base64') from error
    need(0<len(raw)<=32768 and base64.b64encode(raw).decode('ascii')==encoded and
         raw==canonical(request) and sha(raw)==pin,'exact immutable v9 request bytes')
    need(event.get('action')=='labeled' and event.get('label',{}).get('name')=='x86-ring3-setup-runtime-inventory-v9' and
         event.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and event.get('sender',{}).get('login')=='CrispStrobe' and
         type(event.get('number')) is int and event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==event['number'] and pr.get('state')=='open' and pr.get('head',{}).get('sha')==request['head'] and
         pr.get('head',{}).get('repo',{}).get('full_name')=='CrispStrobe/bw-board' and pr['head']['repo'].get('fork') is False and
         pr.get('base',{}).get('ref')=='master' and pr['base'].get('repo',{}).get('full_name')=='CrispStrobe/bw-board',
         'exact owned v9 event')
    need(type(environment) is dict and all(environment.get(k)==v for k,v in {
        'GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request',
        'GITHUB_ACTOR':'CrispStrobe','GITHUB_JOB':'setup-runtime-inventory-v9',
        'BW_EXPECTED_HEAD':request['head'],'BW_EXPECTED_TREE':request['tree'],
        'BW_RING3_SETUP_INVENTORY_V9_REQUEST_SHA256':pin,
        'GITHUB_WORKFLOW_REF':'CrispStrobe/bw-board/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+str(request['pullRequest'])+'/merge'}.items()),
        'exact v9 platform/source joins')
    need(type(environment.get('GITHUB_RUN_ID')) is str and re.fullmatch('[1-9][0-9]{0,19}',environment['GITHUB_RUN_ID']),
         'first v9 run identity');digest(environment.get('GITHUB_WORKFLOW_SHA'),40)


def decode_setup_v9_status_log(raw,required_roles=frozenset(('pre','post'))):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded official v9 log for status originals')
    result={}
    for line in raw.splitlines():
        at=line.find(SETUP_V9_STATUS_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical status original log timestamp')
        need(len(line[at:])+1<=1<<20,'one-MiB complete status log frame including LF')
        packet=parse(line[at+len(SETUP_V9_STATUS_MARKER):])
        keys(packet,'schema role rawBytes rawSha256 packedBytes packedSha256 encoding packed')
        role=packet['role'];need(packet['schema']=='bw.ring3.setup-status-original.v9' and
             role in ('pre','post') and role not in result and packet['encoding']=='zlib+base64',
             'one fixed raw pre/post status original')
        size=integer(packet['rawBytes'],1,8<<20);packed_size=integer(packet['packedBytes'],1,700<<10)
        digest(packet['rawSha256']);digest(packet['packedSha256'])
        need(type(packet['packed']) is str and len(packet['packed'])==4*((packed_size+2)//3),
             'exact bounded compressed status encoding')
        packed=base64.b64decode(packet['packed'],validate=True)
        need(base64.b64encode(packed).decode()==packet['packed'] and len(packed)==packed_size and
             sha(packed)==packet['packedSha256'],'exact compressed original bytes')
        decoder=zlib.decompressobj()
        decoded=decoder.decompress(packed,(8<<20)+1)
        need(len(decoded)<=8<<20 and decoder.eof and decoder.unused_data==b'' and
             decoder.unconsumed_tail==b'' and len(decoded)==size and
             sha(decoded)==packet['rawSha256'],
             'complete bounded single zlib stream and raw status SHA')
        result[role]={'raw':decoded,'meta':{'role':role,'bytes':size,'sha256':sha(decoded),
            'packedBytes':packed_size,'packedSha256':sha(packed)}}
    if required_roles is not None:
        need(set(result)==set(required_roles),'exact retained raw dpkg status original roles')
    return result


def setup_v9_facts(value,run_id,controller_pid,source_last_reap):
    keys(value,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    integer(controller_pid,1);integer(source_last_reap,1)
    need(value['schema']=='bw.ring3.setup-original.v9' and value['firstFailure'] is None and value['secondary']==[] and
         value['deferredHostTriggers'] is True and value['configurationComplete'] is False and
         value['nodeStage'] is None and value['runtime'] is None and value['partial'] is None,
         'complete setup facts before Node copy')
    pre=value['preflight'];keys(pre,'imageOS imageVersion imageFields imageFieldErrors statusSha256 statusBytes statusRecords statusOriginal helperSha256 helperWitness helperAliases resource policyAbsent newPackagesAbsent imageFieldsAuthenticated immutableImageIdentityEstablished')
    need(pre['imageOS']=='ubuntu24' and pre['imageVersion'] in SETUP_V9_IMAGES and
         pre['imageFieldErrors']==[] and pre['imageFields']=={
             'ImageOS':{'present':True,'value':'ubuntu24'},
             'ImageVersion':{'present':True,'value':pre['imageVersion']}} and
         pre['statusSha256']==SETUP_V9_STATUS_SHA and
         integer(pre['statusBytes'],1,8<<20)==SETUP_V9_STATUS_BYTES and integer(pre['statusRecords'],1,5000)==1211 and
         equal(pre['helperSha256'],SETUP_V9_HELPERS) and
         equal(pre['helperAliases'],SETUP_V9_HELPER_ALIASES) and
         pre['policyAbsent'] is True and
         pre['newPackagesAbsent'] is True and pre['imageFieldsAuthenticated'] is False and
         pre['immutableImageIdentityEstablished'] is False,'fresh observed selected pre-state, no image-auth claim')
    witnesses=pre['helperWitness']
    need(type(witnesses) is dict and set(witnesses)==set(SETUP_V9_HELPERS),
         'ten named/held v9 helper witnesses')
    for path,pin in SETUP_V9_HELPERS.items():
        item=witnesses[path]
        keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
        need(item['path']==path and item['sha256']==pin and item['closeAttempted'] is True and
             item['closeSucceeded'] is True and item['namedBefore']==item['heldBefore']==
             item['heldAfter']==item['namedAfter'],'closed stable reported helper identity')
        info=item['heldBefore']
        need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
             type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
             item['bytesRead']==SETUP_V9_NEW_HELPER_BYTES.get(path,item['bytesRead']),
             'reported root-owned helper mode and signed new-helper extent')
    pre_original=pre['statusOriginal'];keys(pre_original,'role bytes sha256 packedBytes packedSha256')
    need(pre_original['role']=='pre' and pre_original['bytes']==pre['statusBytes'] and
         pre_original['sha256']==pre['statusSha256'] and
         integer(pre_original['packedBytes'],1,700<<10)>0 and
         digest(pre_original['packedSha256']),'held pre-status original summary')
    resource_row=pre['resource'];keys(resource_row,'membership limits')
    need(resource_row['membership']=='0::/system.slice/bw-ring3-setup-v9-'+run_id+'-1.service\n' and
         equal(resource_row['limits'],{'cpuMax':'100000 100000','memoryMax':'1073741824',
             'swapMax':'0','pidsMax':'64'}),'observed fixed outer setup cgroup limits')
    archives=value['archives'];need(type(archives) is list and len(archives)==15,'exact fifteen acquired archives')
    need(sum(row[4] for row in SETUP_V9_PACKAGES)==16400088 and all(row[4]<=12<<20 for row in SETUP_V9_PACKAGES),
         'fixed aggregate/per-archive bytes')
    archive_root='/run/bw-ring3-setup-v9-'+run_id+'-1/'
    for index,(item,(name,version,arch,filename,size,pin)) in enumerate(zip(archives,SETUP_V9_PACKAGES)):
        keys(item,'package path url bytes sha256 identity closeSucceeded')
        need(equal(item['package'],{'package':name,'version':version,'architecture':arch,'filename':filename,'size':size,'sha256':pin}) and
             item['path']==archive_root+str(index).zfill(2)+'.deb' and
             item['url']=='https://snapshot.ubuntu.com/ubuntu/20261019T000000Z/'+filename and
             type(item['bytes']) is int and item['bytes']==size and item['sha256']==pin and item['closeSucceeded'] is True,
             'ordered exact archive selected bytes/URL and closed observation')
        info=item['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
             stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o600 and info[3:7]==[0,0,1,size],
             'held root-owned regular archive fact')
    policy=value['policy'];keys(policy,'path identity sha256 mode exclusive')
    need(policy['path']=='/usr/sbin/policy-rc.d' and policy['sha256']==sha(b'#!/bin/sh\nexit 101\n') and
         policy['mode']==0o755 and policy['exclusive'] is True,'exact owned policy101 bytes/mode')
    info=policy['identity'];need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
         stat.S_ISREG(info[2]) and stat.S_IMODE(info[2])==0o755 and info[3:7]==[0,0,1,19],
         'held owned policy identity')
    need(equal(value['cleanup'],{'removedExactOwnIdentity':True,'identity':info}),
         'same exact policy identity removed before Node stage')
    last=source_last_reap
    for phase,args in (('unpack',['--no-triggers','--unpack']+[item['path'] for item in archives]),
                       ('configure',['--no-triggers','--configure',*SETUP_V9_ORDER])):
        row=value[phase];keys(row,'argv process stdout stderr exitCode timedOut firstFailure secondary cgroupAfter')
        argv=['/usr/bin/dpkg',*args];need(equal(row['argv'],argv) and row['exitCode']==0 and row['timedOut'] is False and
             row['firstFailure'] is None and row['secondary']==[],'fixed no-triggers dpkg phase')
        start,end=v9_process(row['process'],'setup-v9',argv,
            SETUP_V9_INSTALLER_ENV,120000)
        need(row['process']['parentPid']==controller_pid and last<=start,
             'same root controller and Git/unpack/configure chronology')
        last=end
        census=row['cgroupAfter'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
        need(census['phase']==phase and
             setup_v9_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                                   census['cgroupStat'],controller_pid) and
             census['onlyController'] is True,'finite no-descendant setup phase census')
        for stream in ('stdout','stderr'):
            encoded=row[stream]
            if encoded is not None:need(len(prerequisite_original(canonical(encoded)))<=128<<10,'bounded dpkg original stream')
    need(value['unpack']['process']['reapMonoNs']<=value['configure']['process']['spawnMonoNs'],
         'unpack completed before configure')
    census=value['policyCleanupCgroup'];keys(census,'phase cgroupProcs cgroupEvents cgroupStat onlyController')
    need(census['phase']=='policy-cleanup' and
         setup_v9_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],
                               census['cgroupStat'],controller_pid) and
         census['onlyController'] is True,
         'only root controller remained before global policy removal')
    post=value['postStatus'];keys(post,'sha256 bytes records selected pendingHostTriggers serviceObserved statusOriginal allSelectedPresent allowedStates deferredHostTriggers configurationComplete')
    digest(post['sha256']);integer(post['bytes'],1,8<<20);integer(post['records'],1,5000)
    post_original=post['statusOriginal'];keys(post_original,'role bytes sha256 packedBytes packedSha256')
    need(post_original['role']=='post' and post_original['bytes']==post['bytes'] and
         post_original['sha256']==post['sha256'] and
         integer(post_original['packedBytes'],1,700<<10)>0 and
         digest(post_original['packedSha256']),'held post-status original summary')
    need(post['allSelectedPresent'] is True and post['allowedStates'] is True and
         post['deferredHostTriggers'] is True and post['configurationComplete'] is False and
         type(post['selected']) is dict and set(post['selected'])=={row[0] for row in SETUP_V9_PACKAGES},
         'all selected post-status rows and deferred configuration')
    for name,version,arch,*_ in SETUP_V9_PACKAGES:
        row=post['selected'][name];keys(row,'Package Version Architecture Status Triggers-Pending Triggers-Awaited')
        need((row['Package'],row['Version'],row['Architecture'])==(name,version,arch) and
             row['Status'] in ('install ok installed','install ok triggers-pending','install ok triggers-awaited') and
             all(type(row[key]) in (str,type(None)) for key in ('Triggers-Pending','Triggers-Awaited')),
             'versioned selected package status, including pending trigger facts')
    pending=post['pendingHostTriggers']
    need(type(pending) is dict and len(pending)<=5000,'bounded actual host trigger rows')
    for name,row in pending.items():
        need(type(name) is str and re.fullmatch('[A-Za-z0-9.+-]+:(?:amd64|all)',name),
             'architecture-qualified host trigger package')
        keys(row,'status pending awaited')
        need(type(row['status']) is str and len(row['status'])<=128 and
             all(type(row[key]) in (str,type(None)) and (row[key] is None or len(row[key])<=4096)
                 for key in ('pending','awaited')) and
             (row['status'] in ('install ok triggers-pending','install ok triggers-awaited') or
              row['pending'] is not None or row['awaited'] is not None),'honest bounded pending host trigger fact')
    need(equal(post['serviceObserved'],{'unit':SETUP_V9_PAYLOAD_PINS['serviceUnit'],
        'init':SETUP_V9_PAYLOAD_PINS['initScript']}),
        'exact reviewed service unit and init script payload bytes; no service execution')
    return {'setupObserved':True,'deferredHostTriggers':True,'completeHostConfiguration':False,
        'imageFieldsAuthenticated':False,'immutableImageIdentityEstablished':False}


def setup_v9_stage_record(record,pin):
    keys(record,'schema request event platform source sourceCommands eventIdentity setup copy recordBoundary firstFailure secondary')
    need(record['schema']=='bw.ring3.node-stage-original.v9' and record['firstFailure'] is None and
         record['secondary']==[] and record['recordBoundary']==
         'verified copy after selected setup and policy cleanup, before directory publication',
         'closed v9 stage record')
    request_raw=prerequisite_original(canonical(record['request']));request,source=setup_v9_request(request_raw,pin)
    event_raw=prerequisite_original(canonical(record['event']));environment=record['platform']
    need(type(environment) is dict and set(environment)==set(SETUP_V9_PLATFORM),'closed v9 stage platform')
    setup_v9_event(event_raw,request,pin,environment)
    need(equal(record['source'],source),'root Git/live source12 joins selected request')
    copy=record['copy'];keys(copy,'created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory')
    need(copy['created']==[str(NODE_STAGE_ROOT),NODE_STAGE_TARGET] and copy['filePublicationAttempted'] is True and
         copy['directoryPublicationAttempted'] is False and copy['filePublished'] is True and copy['directoryPublished'] is False and
         type(copy['bytesCopied']) is int and copy['bytesCopied']==RUNTIME_SELECTED['node']['bytes'] and
         type(copy['sourceBytesRead']) is int and copy['sourceBytesRead']==copy['bytesCopied'] and
         copy['writeUncertain'] is False and copy['targetAfterFailure'] is None and copy['directoryAfterFailure'] is None and
         copy['copiedSha256']==copy['readbackSha256']==RUNTIME_SELECTED['node']['sha256'],
         'fixed verified Node copy before directory publication')
    for name in ('sourceBefore','sourceAfter','sourceNamedAfter','file','directory'):
        info=copy[name];need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             all(0<=x<2**64 for x in info[:7]) and -2**63<=info[7]<2**63,'raw v9 stage metadata')
    before=copy['sourceBefore'];need(before==copy['sourceAfter']==copy['sourceNamedAfter'] and
         stat.S_ISREG(before[2]) and before[2]&0o6000==0 and before[5:7]==[1,RUNTIME_SELECTED['node']['bytes']],
         'held Node cache source extent/identity')
    file,directory=copy['file'],copy['directory']
    need(stat.S_ISREG(file[2]) and stat.S_IMODE(file[2])==0o555 and file[3:7]==[0,0,1,RUNTIME_SELECTED['node']['bytes']] and
         stat.S_ISDIR(directory[2]) and stat.S_IMODE(directory[2])==0o700 and directory[3:5]==[0,0],
         'fixed staged Node file/directory')
    commands=record['sourceCommands'];need(type(commands) is list and len(commands)==3,'three original v9 source Git commands')
    git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
            for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        keys(command,'argv process stdout stderr');argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),'scoped v9 Git source checkout')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'fixed v9 Git command')
        process=command['process'];start,end=v9_process(process,'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=process['parentPid']
        need(start>=previous and process['parentPid']==parent,'sequential source Git children');previous=end
        need(prerequisite_original(canonical(command['stdout']))==outputs[index] and command['stderr'] is None,
             'exact original source Git output')
    setup_v9_facts(record['setup'],environment['GITHUB_RUN_ID'],parent,previous)
    keys(record['eventIdentity'],'st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns')
    event_meta=record['eventIdentity']
    need(all(type(x) is int for x in event_meta.values()) and event_meta['st_size']==len(event_raw) and
         stat.S_ISREG(event_meta['st_mode']),'held official event snapshot extent')
    return request,source


def observe_setup_v9_stage(environ):
    value={'schema':'bw.ring3.setup-node-observation.v9','stageObserved':False,'runtimeCandidate':False,
        'qualified':False,'record':None,'files':{},'directories':[],'source':{},'identity':None,
        'firstFailure':None,'secondary':[],'publicationSafe':False};backend=None
    def failed(error,phase):
        item={'phase':phase,'name':type(error).__name__,'message':str(error)}
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
    try:
        ids=[environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(type(x) is str and re.fullmatch('[1-9][0-9]{0,9}',x) and int(x)<2**31 for x in ids),
             'known v9 dropped observer invoker')
        uid,gid=map(int,ids)
        need(os.getresuid()==(uid,)*3 and os.getresgid()==(gid,)*3 and os.getgroups()==[],
             'actual irreversible dropped v9 IDs/groups')
        status=setup_proc_read('/proc/self/status');membership=setup_proc_read('/proc/self/cgroup')
        setup_membership(membership,environ['GITHUB_RUN_ID'])
        value['identity']={'uid':uid,'gid':gid,'groups':os.getgroups(),'status':status,
            'membership':membership,'pid':os.getpid()}
        node_stage_identity(value['identity'],uid,gid);value['publicationSafe']=True
        pin=digest(environ.get('BW_RING3_SETUP_INVENTORY_V9_REQUEST_SHA256'))
        backend=NodeStageReadonly();backend.open();record_raw=backend.read('installation.original.json',True)
        value['record']={'bytes':len(record_raw),'sha256':sha(record_raw),'base64':base64.b64encode(record_raw).decode()}
        record=parse(record_raw);request,source=setup_v9_stage_record(record,pin)
        need(value['identity']['pid']==record['sourceCommands'][0]['process']['parentPid'],
             'same installer/dropped observer PID across exec')
        event_raw=prerequisite_original(canonical(record['event']));setup_v9_event(event_raw,request,pin,environ)
        need(set(environ)==set(SETUP_V9_PLATFORM)|{'LANG','HOME','PATH'} and all(environ[key]==expected for key,expected in
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'}.items()) and
            equal(record['platform'],{key:environ[key] for key in SETUP_V9_PLATFORM}),
            'closed actual dropped platform join')
        for path,row in sorted(source['files'].items()):
            target=Path.cwd()/path;info=target.lstat()
            need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                 stat.S_IMODE(info.st_mode)==0o644 and (info.st_uid,info.st_gid)==(uid,gid),
                 'live dropped v9 source regular owner/mode')
            raw=inventory_file(target,4<<20)
            fact={'bytes':len(raw),'sha256':sha(raw),
                'blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'mode':'100644'}
            value['source'][path]=fact;need(equal(fact,row),'independent dropped source12 bytes')
        backend.read('node')
        need(backend.facts['node']['before']==record['copy']['file'],'finite staged Node inode join')
        value['stageObserved']=True
    except BaseException as error:failed(error,'setup-v9-stage-observer')
    finally:
        if backend is not None:
            value['files']=backend.facts
            value['directories']=[{'path':str(path),'before':metadata} for path,fd,metadata in backend.directories]
            try:backend.close()
            except BaseException as error:failed(error,'setup-v9-stage-close')
    return value


def setup_v9_inventory_entry(environ,files=None,probe=None):
    value={'schema':'bw.ring3.setup-runtime-inventory-original.v9','stageBefore':None,'stageAfter':None,
        'parent':None,'inventory':None,'candidate':None,'firstFailure':None,'secondary':[],
        'publicationSafe':False,'actualGuestApproved':False,'completeHostConfiguration':False}
    originals={};inventory=None
    def failed(error,phase):
        item=getattr(error,'inventory_first',{'phase':phase,'name':type(error).__name__,'message':str(error)})
        if value['firstFailure'] is None:value['firstFailure']=item
        else:value['secondary'].append(item)
        value['secondary'].extend(getattr(error,'setup_secondary',[]))
        value['secondary'].extend(getattr(error,'inventory_secondary',[]))
    try:
        before=observe_setup_v9_stage(environ);value['stageBefore']=before
        value['publicationSafe']=before['publicationSafe']
        if before['firstFailure'] is not None:
            error=Refusal(before['firstFailure']['message']);error.inventory_first=before['firstFailure']
            error.inventory_secondary=before['secondary'];raise error
        need(before['stageObserved'] is True,'complete dropped v9 stage before metadata tools')
        record=parse(prerequisite_original(canonical(before['record'])))
        originals['setup.request.json']=prerequisite_original(canonical(record['request']))
        originals['setup.event.json']=prerequisite_original(canonical(record['event']))
        value['parent']=inventory_parent_availability()
        inventory=SetupV9Inventory(before['files']['node']['before'],files,probe)
        candidate=inventory.discover()
        value['candidate']={'bytes':len(candidate),'sha256':sha(candidate),'base64':base64.b64encode(candidate).decode()}
    except BaseException as error:failed(error,'setup-v9-runtime-inventory')
    finally:
        if inventory is not None:
            value['inventory']=inventory.partial
            rejected=getattr(inventory.ops,'rejected',{})
            if rejected:value['inventory']['rejectedFiles']=rejected
        if value['stageBefore'] is not None and value['stageBefore']['stageObserved']:
            after=observe_setup_v9_stage(environ);value['stageAfter']=after
            if after['firstFailure'] is not None:
                error=Refusal(after['firstFailure']['message']);error.inventory_first=after['firstFailure']
                error.inventory_secondary=after['secondary'];failed(error,'setup-v9-stage-after')
            elif not all(equal(after[key],value['stageBefore'][key]) for key in ('record','files','directories','source')):
                failed(Refusal('v9 source/stage changed across metadata tools'),'setup-v9-stage-after')
    raw=canonical(value)
    if len(raw)>4<<20:
        error={'phase':'setup-v9-original-cap','name':'Refusal','message':'versioned v9 original cap'}
        if value['firstFailure'] is None:value['firstFailure']=error
        else:value['secondary'].append(error)
        prefix=raw[:128<<10]
        raw=canonical({'schema':'bw.ring3.setup-runtime-inventory-overflow.v9',
            'firstFailure':value['firstFailure'],'secondary':value['secondary'],
            'attemptedBytes':len(raw),'attemptedSha256':sha(raw),
            'prefix':{'bytes':len(prefix),'sha256':sha(prefix),'base64':base64.b64encode(prefix).decode()}})
    originals['runtime.setup-inventory.json']=raw
    return originals,value['firstFailure'] is None and value['secondary']==[],value['publicationSafe']


def emit_setup_v9_inventory(originals,emit,flush):
    need(type(originals) is dict and set(originals)<=set(SETUP_V9_LOG_ROLES) and
         all(type(raw) is bytes and 0<len(raw)<=4<<20 for raw in originals.values()) and
         sum(map(len,originals.values()))<=6<<20,'bounded v9 original roles')
    emitted=0;chunks=0
    for name,raw in sorted(originals.items()):
        encoded=base64.b64encode(raw).decode();count=max(1,(len(encoded)+3071)//3072)
        raw_sha=sha(raw)
        need(count<=1821,'bounded v9 original chunk count')
        for index in range(count):
            line=SETUP_V9_LOG_MARKER+canonical({'schema':'bw.ring3.setup-runtime-inventory-log.v9',
                'name':name,'index':index,'count':count,'bytes':len(raw),'sha256':raw_sha,
                'data':encoded[index*3072:(index+1)*3072]})
            need(emitted+len(line)<=6<<20 and chunks<3000,'bounded six-MiB v9 runtime component')
            need(emit(line)==len(line),'complete v9 original log write')
            emitted+=len(line);chunks+=1
    flush()


def decode_setup_v9_log(raw):
    need(type(raw) is bytes and 0<len(raw)<=8<<20,'bounded v9 official log original')
    groups={};chunks=0;wire_bytes=0
    for line in raw.splitlines():
        at=line.find(SETUP_V9_LOG_MARKER)
        if at<0:continue
        prefix=line[:at]
        need(prefix==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',prefix),
             'canonical v9 official log timestamp')
        wire_bytes+=len(line[at:])+1
        need(wire_bytes<=6<<20,'bounded six-MiB v9 runtime component wire')
        value=parse(line[at+len(SETUP_V9_LOG_MARKER):]);keys(value,'schema name index count bytes sha256 data')
        need(value['schema']=='bw.ring3.setup-runtime-inventory-log.v9' and value['name'] in SETUP_V9_LOG_ROLES,
             'closed v9 original log role')
        count=integer(value['count'],1,1821);index=integer(value['index'],0,count-1)
        extent=integer(value['bytes'],1,4<<20);digest(value['sha256'])
        need(type(value['data']) is str and len(value['data'])<=3072,'bounded v9 base64 chunk')
        group=groups.setdefault(value['name'],{'count':count,'bytes':extent,'sha256':value['sha256'],'parts':[]})
        need((group['count'],group['bytes'],group['sha256'])==(count,extent,value['sha256']) and
             index==len(group['parts']),'one ordered v9 original sequence')
        group['parts'].append(value['data']);chunks+=1;need(chunks<3000,'finite v9 log chunk count')
    need(set(groups)==set(SETUP_V9_LOG_ROLES),'three complete v9 originals')
    originals={}
    for name,group in groups.items():
        need(len(group['parts'])==group['count'],'complete v9 chunk sequence')
        encoded=''.join(group['parts']);value=base64.b64decode(encoded,validate=True)
        need(base64.b64encode(value).decode()==encoded and len(value)==group['bytes'] and
             sha(value)==group['sha256'],'exact v9 original bytes/hash')
        originals[name]=value
    need(sum(map(len,originals.values()))<=6<<20,'bounded raw v9 aggregate')
    return originals


def verify_setup_v9_stage_observation(value,external):
    keys(value,'schema stageObserved runtimeCandidate qualified record files directories source identity firstFailure secondary publicationSafe')
    need(value['schema']=='bw.ring3.setup-node-observation.v9' and value['stageObserved'] is True and
         value['runtimeCandidate'] is False and value['qualified'] is False and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True,'complete actual v9 dropped stage observation')
    record_raw=prerequisite_original(canonical(value['record']));record=parse(record_raw)
    request,source=setup_v9_stage_record(record,external['requestSha256'])
    env=record['platform'];need(request['head']==external['head'] and request['tree']==external['tree'] and
         env['GITHUB_RUN_ID']==external['runId'] and env['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         [env['SUDO_UID'],env['SUDO_GID']]==list(map(str,external['invoker'])),
         'external v9 source/platform/invoker joins')
    need(equal(value['source'],source['files']),'actual dropped source12 joins request')
    identity=value['identity'];node_stage_identity(identity,*external['invoker'])
    need(identity['pid']==record['sourceCommands'][0]['process']['parentPid'],
         'installer/observer original PID continuity')
    setup_membership(identity['membership'],external['runId'])
    files=value['files'];need(type(files) is dict and set(files)=={'node','installation.original.json'},
         'two independent v9 stage file observations')
    for name,row in files.items():
        keys(row,'before after namedAfter closeSucceeded bytes sha256 prefix')
        need(row['closeSucceeded'] is True and equal(row['before'],row['after']) and
             equal(row['before'],row['namedAfter']),'closed stable v9 stage file')
        metadata=row['before'];need(type(metadata) is list and len(metadata)==8 and
             all(type(x) is int for x in metadata) and stat.S_ISREG(metadata[2]) and
             metadata[3:6]==[0,0,1] and metadata[6]==row['bytes'],'root regular stage metadata')
        mode=0o555 if name=='node' else 0o444
        need(stat.S_IMODE(metadata[2])==mode,'fixed v9 stage mode')
        data=value['record'] if name!='node' else RUNTIME_SELECTED['node']
        need(row['bytes']==data['bytes'] and row['sha256']==data['sha256'],'independent v9 staged bytes')
        if name=='node':
            need(row['prefix']=='7f454c46' and row['before']==record['copy']['file'],
                 'staged Node ELF/install join')
        else:need(row['prefix']==record_raw[:4].hex(),'held v9 record prefix')
    dirs=value['directories'];need(type(dirs) is list and [row['path'] for row in dirs]==
         ['/','/run',str(NODE_STAGE_ROOT)],'fixed stage ancestors')
    for index,row in enumerate(dirs):
        keys(row,'path before');info=row['before']
        need(type(info) is list and len(info)==8 and all(type(x) is int for x in info) and
             stat.S_ISDIR(info[2]) and info[3:5]==[0,0] and info[2]&0o022==0 and
             (index!=2 or stat.S_IMODE(info[2])==0o555),'nonwritable root stage ancestor')
    need(dirs[-1]['before'][:2]==record['copy']['directory'][:2],'finite stage directory inode join')
    return request,source,record


def setup_v9_cleanup_original(raw,external):
    value=parse(raw)
    keys(value,'schema runId serviceExitCode sourceAdmission preCensus stop postCensus cgroupTerminal unitCensus policy action firstFailure secondary setupApproved')
    need(raw==canonical(value) and value['schema']=='bw.ring3.setup-outside-cleanup.v9' and
         value['runId']==external['runId'] and value['setupApproved'] is False and
         type(value['secondary']) is list and len(value['secondary'])<=64 and
         (value['firstFailure'] is None or type(value['firstFailure']) is dict),
         'closed bounded v9 outside cleanup original')
    unit='bw-ring3-setup-v9-'+external['runId']+'-1.service'
    selected=value['sourceAdmission']
    if selected is None:
        need(value['preCensus'] is None and value['postCensus'] is None and value['stop'] is None and
             value['policy'] is None and value['action'] is None and value['firstFailure'] is not None,
             'no unit stop or policy mutation without source admission')
    else:
        keys(selected,'requestSha256 eventSha256 head tree source unit')
        need(selected['requestSha256']==external['requestSha256'] and
             selected['head']==external['head'] and selected['tree']==external['tree'] and
             selected['unit']==unit,'exact outside request/source/unit selection')
        digest(selected['eventSha256'])
        source=selected['source'];keys(source,'schema head tree files')
        need(source['schema']=='bw.ring3.source.v1' and source['head']==external['head'] and
             source['tree']==external['tree'] and type(source['files']) is dict and
             set(source['files'])==SETUP_SOURCE_PATHS and
             source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
             'outside selected source twelve and workflow')
    def census(row):
        if row is None:return None
        keys(row,'terminal cgroupProcs cgroupEvents cgroupStat')
        need(row['terminal'] in ('absent','empty','populated'),'closed v9 unit terminal state')
        if row['terminal']=='absent':
            need(all(row[key] is None for key in ('cgroupProcs','cgroupEvents','cgroupStat')),
                 'absent unit has no invented census')
        else:
            need(all(type(row[key]) is str and len(row[key].encode())<=1024 for key in
                     ('cgroupProcs','cgroupEvents','cgroupStat')) and
                 (setup_v9_cgroup_quiet(row['cgroupProcs'],row['cgroupEvents'],row['cgroupStat']) is
                  (row['terminal']=='empty')),
                 'independent exact nested unit census')
        return row
    pre=census(value['preCensus']);post=census(value['postCensus'])
    stop=value['stop']
    if selected is not None:
        if stop is None:
            need(pre is None and post is None and value['cgroupTerminal'] is None and
                 value['unitCensus'] is None and value['policy'] is None and
                 value['action'] is None and value['firstFailure'] is not None,
                 'admitted unit identity refusal retains no invented stop or census')
        else:
            keys(stop,'attempted argv exitCode timedOut')
        if stop is not None and stop['attempted'] is True:
            need(stop['argv']==['/usr/bin/timeout','--kill-after=5s','20s',
                 '/usr/bin/systemctl','stop','--',unit] and
                 (stop['exitCode'] is None or integer(stop['exitCode'],-255,255)>=-255) and
                 (stop['timedOut'] is None if stop['exitCode'] is None else
                  stop['timedOut']==(stop['exitCode'] in (124,137))),
                 'one bounded exact owned-unit stop')
        elif stop is not None:
            need(stop=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
                 (pre is None and value['firstFailure'] is not None or
                  pre is not None and pre['terminal'] in ('absent','empty') and
                  (value['serviceExitCode']==0 or pre['terminal']=='absent')),
                 'no stop needed only for terminal or absent unit')
        if post is not None:
            need(value['cgroupTerminal']==post['terminal'] and
                 (value['unitCensus'] is None if post['terminal']=='absent' else
                  value['unitCensus']=={key:post[key] for key in
                      ('cgroupProcs','cgroupEvents','cgroupStat')}),
                 'outside final census and terminal projection')
        else:need(value['cgroupTerminal'] is None and value['unitCensus'] is None,
                  'unknown outside terminal cannot claim census')
    return value


def setup_v9_inner_original(raw,external,shell):
    originals=decode_setup_v9_log(raw);value=parse_setup_v9_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v9' and value['firstFailure'] is None and
         value['secondary']==[] and value['publicationSafe'] is True and value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False,'failure-free metadata-only v9 original')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v9_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and equal(observed,record),
                  'same v9 staged source/request/record before and after graph')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
        ('record','files','directories','source')),'finite stage readback across metadata graph')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'exact source/head/workflow/request/event original join')
    statuses=decode_setup_v9_status_log(raw)
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']),
         'exact separately retained raw status originals join setup packet')
    before=setup_v9_status_rows(statuses['pre']['raw'])
    need(len(before)==pre['statusRecords']==1211 and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V9_PACKAGES),
         'independent raw pre-status census and selected absence')
    after=setup_v9_status_rows(statuses['post']['raw'])
    need(len(after)==post['records'],'independent raw post-status census')
    setup_v9_status_delta(before,after)
    selected={};pending={}
    for name,version,arch,*_ in SETUP_V9_PACKAGES:
        row=after.get((name,arch))
        selected[name]=None if row is None else {key:row.get(key) for key in
            ('Package','Version','Architecture','Status','Triggers-Pending','Triggers-Awaited')}
    for (name,arch),row in after.items():
        if (row.get('Status') in ('install ok triggers-pending','install ok triggers-awaited') or
            row.get('Triggers-Pending') is not None or row.get('Triggers-Awaited') is not None):
            pending[name+':'+arch]={'status':row.get('Status'),'pending':row.get('Triggers-Pending'),
                'awaited':row.get('Triggers-Awaited')}
    need(equal(selected,post['selected']) and equal(pending,post['pendingHostTriggers']),
         'independent raw post-status selected/pending projection')
    parent=value['parent'];keys(parent,'meta controls alreadyEnabled')
    need(type(parent['meta']) is list and len(parent['meta'])==8 and stat.S_ISDIR(parent['meta'][2]) and
         parent['meta'][3:5]==[0,0] and parent['meta'][2]&0o022==0 and
         set(parent['controls'])=={'cgroup.controllers','cgroup.subtree_control'},
         'finite root-owned parent availability')
    enabled=all({'cpu','memory','pids'}<=set(row['raw'].split()) for row in parent['controls'].values())
    need(parent['alreadyEnabled'] is enabled,'truthful cgroup parent availability')
    result=verify_setup_v9_inventory_graph(value)
    candidate_raw=prerequisite_original(canonical(value['candidate']))
    candidate=setup_v9_runtime_expectation(candidate_raw,sha(candidate_raw))
    for package in candidate['packages']:
        row=post['selected'][package['name']]
        need(row['Version']==package['version'] and
             row['Architecture']==package['architecture'],
             'five named runtime versions independently join raw installed post-status')
    need(equal(value['inventory']['fileMetadata'][NODE_STAGE_TARGET],value['stageAfter']['files']['node']['before']),
         'graph Node file joins staged inode/mode/hash')
    need(all(entry['process']['parentPid']==value['stageBefore']['identity']['pid'] for entry in
        value['inventory']['processes']),'fifteen metadata children descend from dropped observer')
    need(all(entry['process']['spawnMonoNs']>=record['sourceCommands'][-1]['process']['reapMonoNs'] for entry in
        value['inventory']['processes']),'runtime probes follow root source admission')
    need(record['setup']['configure']['process']['reapMonoNs']<=
         value['inventory']['processes'][0]['process']['spawnMonoNs'],
         'all runtime probes follow completed no-trigger configure')
    need(record['setup']['preflight']['imageFields']==setup_v9_expected_forwarded(shell['fields']),
         'successful service image labels join shell forwarding')
    return result,record,source,event_raw,request_raw


def verify_setup_v9_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v9_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v9' and type(external['attempt']) is int and
         external['attempt']==1 and external['jobName']=='setup-runtime-inventory-v9' and
         external['conclusion']=='success','externally selected official v9 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive official v9 run ID')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),'selected actual invoker')
    need(integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'externally selected exact official v9 log bytes')
    need(type(outer_raw) is bytes and integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'externally selected exact outside-owner terminal bytes')
    need(type(cleanup_raw) is bytes and integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'externally selected outside cleanup original')
    cleanup=setup_v9_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==0 and cleanup['sourceAdmission'] is not None and
         cleanup['stop']=={'attempted':False,'argv':None,'exitCode':None,'timedOut':False} and
         cleanup['preCensus'] is not None and cleanup['postCensus'] is not None and
         cleanup['cgroupTerminal'] in ('empty','absent') and cleanup['policy'] is None and
         cleanup['action']=='not-needed' and cleanup['firstFailure'] is None and
         cleanup['secondary']==[] and cleanup['setupApproved'] is False,
         'finite outside owner needed no policy cleanup after successful setup')
    need((cleanup['cgroupTerminal']=='absent' and cleanup['unitCensus'] is None) or
         (cleanup['cgroupTerminal']=='empty' and type(cleanup['unitCensus']) is dict and
          set(cleanup['unitCensus'])=={'cgroupProcs','cgroupEvents','cgroupStat'} and
          setup_v9_cgroup_quiet(cleanup['unitCensus']['cgroupProcs'],
              cleanup['unitCensus']['cgroupEvents'],cleanup['unitCensus']['cgroupStat'])),
         'independently checked outside nested cgroup emptiness')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v9' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v9-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and outer['systemdRunExitCode']==0 and
         type(outer['outsideCleanupExitCode']) is int and outer['outsideCleanupExitCode']==0 and
         outer['cgroupAfter']=='absent','finite outside-owner successful service terminal and absent cgroup')
    result,record,source,event_raw,request_raw=setup_v9_inner_original(raw,external,shell)
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins complete inner original')
    return dict(result,schema='bw.ring3.setup-runtime-inventory-admission.v9',setupObserved=True,
        shellImageFields=shell['fields'],serviceImageFields=record['setup']['preflight']['imageFields'],
        forwardingMatchesExpected=True,
        deferredHostTriggers=True,completeHostConfiguration=False,actualGuestApproved=False,
        outsideTerminalObserved=True,cgroupAfterAbsent=True,continuousOwnershipEstablished=False,
        officialJobAuthenticated=False,imageFieldsAuthenticated=False,
        immutableImageIdentityEstablished=False,candidateReviewed=False,actualRunApproved=False,
        rawStatusBytesIndependentlyVerified=True,ciArchiveBytesIndependentlyVerified=False)


def verify_setup_v9_failed_stream_inventory(raw,external,cleanup,shell,outer):
    """Retain a complete failed v9 metadata packet with one clipped child prefix."""
    originals=decode_setup_v9_log(raw)
    value=parse_setup_v9_outer(originals['runtime.setup-inventory.json'])
    keys(value,'schema stageBefore stageAfter parent inventory candidate firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    first=value['firstFailure']
    need(value['schema']=='bw.ring3.setup-runtime-inventory-original.v9' and
         value['candidate'] is None and value['publicationSafe'] is True and
         value['actualGuestApproved'] is False and
         value['completeHostConfiguration'] is False and
         type(first) is dict and first=={'phase':'inventory-stream','name':'Refusal',
             'message':'inventory original stdout stream cap'} and
         type(value['secondary']) is list and len(value['secondary'])<=64,
         'complete failed v9 stream-cap original with no candidate')
    request=None;source=None;record=None
    for stage in (value['stageBefore'],value['stageAfter']):
        current,selected,observed=verify_setup_v9_stage_observation(stage,external)
        if request is None:request,source,record=current,selected,observed
        else:need(equal(current,request) and equal(selected,source) and
                  equal(observed,record),'same failed v9 stage source before/after')
    need(all(equal(value['stageBefore'][key],value['stageAfter'][key]) for key in
             ('record','files','directories','source')),
         'failed v9 stage file and source readback')
    request_raw=prerequisite_original(canonical(record['request']))
    event_raw=prerequisite_original(canonical(record['event']))
    need(request_raw==originals['setup.request.json'] and
         event_raw==originals['setup.event.json'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'],
         'failed v9 exact source/request/event originals')
    need(cleanup['sourceAdmission'] is not None and
         equal(cleanup['sourceAdmission']['source'],source) and
         cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
         'outside failed source/event admission joins inner originals')
    statuses=decode_setup_v9_status_log(raw)
    before=setup_v9_status_rows(statuses['pre']['raw'])
    after=setup_v9_status_rows(statuses['post']['raw'])
    pre,post=record['setup']['preflight'],record['setup']['postStatus']
    need(equal(statuses['pre']['meta'],pre['statusOriginal']) and
         equal(statuses['post']['meta'],post['statusOriginal']) and
         len(before)==pre['statusRecords']==1211 and
         len(after)==post['records'] and
         not any(name in {key[0] for key in before} for name,*_ in SETUP_V9_PACKAGES),
         'failed v9 separately retained raw status and baseline')
    setup_v9_status_delta(before,after)
    need(pre['imageFields']==setup_v9_expected_forwarded(shell['fields']),
         'failed metadata service/shell image forwarding')
    inventory=value['inventory']
    keys(inventory,'files aliases probes processes fileMetadata pythonFiles mappedLibraries mapsOriginal emptyPythonSources')
    need(type(inventory['files']) is dict and
         len(inventory['files'])<=512 and type(inventory['aliases']) is dict and
         len(inventory['aliases'])<=256 and
         type(inventory['probes']) is list and type(inventory['processes']) is list,
         'bounded partial graph reports no selected candidate')
    roles=SETUP_V9_PROBE_ORDER
    aliases=inventory['aliases']
    need(type(aliases) is dict and len(aliases)<=256,
         'bounded failed alias census for fixed argv')
    executables={'node':NODE_STAGE_TARGET,
        'python':resolve_alias('/usr/bin/python3',aliases),
        'qemu':resolve_alias(RUNTIME_QEMU,aliases)}
    fixed={'ldd-shell':['/usr/bin/ldd','/usr/bin/bash'],
        'ldd-dpkg-query':['/usr/bin/ldd','/usr/bin/dpkg-query'],
        'ldd-tcg':['/usr/bin/ldd',resolve_alias(RUNTIME_TCG,aliases)],
        'package-version':['/usr/bin/dpkg-query','-W',
            '-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]}
    fixed.update({'ldd-'+name:['/usr/bin/ldd',path]
                  for name,path in executables.items()})
    fixed.update({name+'-version':[path,'--version']
                  for name,path in executables.items()})
    fixed.update({role:['/usr/bin/dpkg-query','-L',name]
                  for name,role in SETUP_V9_PACKAGE_ROLES.items()})
    entries=inventory['processes'];probes=inventory['probes']
    setup_v9_observed_order(probes,entries,partial=True)
    last_end=0;parent=None
    for index,(entry,probe) in enumerate(zip(entries,probes)):
        keys(entry,'role process stdout stderr')
        keys(probe,'role argv environment exitCode stdout stderr')
        process=entry['process']
        keys(process,'schema argv environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary')
        need(process['schema']=='bw.ring3.inventory-process.v1' and
             equal(process['argv'],probe['argv']) and
             equal(probe['argv'],fixed[entry['role']]) and
             equal(process['environment'],probe['environment']) and
             probe['environment']=={'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin'} and
             type(probe['stdout']) is str and type(probe['stderr']) is str and
             len(probe['stdout'].encode('utf-8','surrogateescape'))<=16384 and
             len(probe['stderr'].encode('utf-8','surrogateescape'))<=16384 and
             prerequisite_original(canonical(entry['stdout']))==probe['stdout'].encode('utf-8','surrogateescape') and
             prerequisite_original(canonical(entry['stderr']))==probe['stderr'].encode('utf-8','surrogateescape'),
             'exact retained child process/stream prefix')
        if parent is None:parent=integer(process['parentPid'],1)
        start=integer(process['spawnMonoNs'],last_end)
        last_end=integer(process['reapMonoNs'],start)
        need(last_end-start<=10_000_000_000 and
             process['parentPid']==parent==value['stageBefore']['identity']['pid'] and
             integer(process['pid'],1)==process['pgid'] and
             process['timedOut'] is False,
             'finite serial owned metadata child prefix')
        if index<len(entries)-1:
            need(process['firstFailure'] is None and process['secondary']==[] and
                 process['exitCode']==probe['exitCode']==0 and probe['stderr']=='' and
                 process['waitStatus']==0 and process['signal'] is None,
                 'successful earlier v9 metadata children')
            if entry['role'] in SETUP_V9_PACKAGE_ROLES.values():
                package_name=next(name for name,role in SETUP_V9_PACKAGE_ROLES.items()
                                  if role==entry['role'])
                setup_v9_listed_paths(probe['stdout'].encode('utf-8','surrogateescape'),package_name)
        else:
            need(process['firstFailure']==first and process['secondary']==value['secondary'] and
                 entry['stdout']['bytes']==16384,
                 'first stream cap and ordered secondary remain last child facts')
    # The last stream is only an explicit bounded prefix. Its final line and
    # complete per-package listing are unknown, even when bytes look valid.
    return {'schema':'bw.ring3.setup-failure-retention.v9',
        'failedAttemptRetained':True,'completeFailedInventoryOriginal':True,
        'firstFailure':first,'secondary':value['secondary'],
        'retainedProbePrefixRoles':list(roles[:len(entries)]),
        'lastStdoutPrefixBytes':entries[-1]['stdout']['bytes'],
        'lastPackageListingComplete':False,'candidateReviewed':False,
        'setupObserved':False,'actualGuestApproved':False,'actualRunApproved':False,
        'completeHostConfiguration':False,'officialJobAuthenticated':False,
        'outsideCleanup':cleanup['action'],'outsideCgroupAfter':outer['cgroupAfter'],
        'outerClientExitCode':outer['systemdRunExitCode'],
        'rawStatusBytesIndependentlyVerified':True,
        'ciArchiveBytesIndependentlyVerified':False}


def verify_setup_v9_failure_log(raw,external,outer_raw,cleanup_raw,shell_raw):
    """Retain a bound failed attempt; never promote its partial facts to admission."""
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker')
    shell=decode_setup_v9_shell(shell_raw,external)
    need(external['schema']=='bw.ring3.setup-inventory-expectation.v9' and
         external['conclusion']=='failure' and external['attempt']==1 and
         external['jobName']=='setup-runtime-inventory-v9','externally selected failed v9 job')
    integer(external['jobId'],1)
    need(type(external['runId']) is str and re.fullmatch('[1-9][0-9]{0,19}',external['runId']),
         'positive failed run identity')
    for name,size in (('head',40),('tree',40),('workflowSha',40),('workflowFileSha256',64),
                      ('requestSha256',64),('logSha256',64),('outerSha256',64),('cleanupSha256',64)):
        digest(external[name],size)
    need(type(external['invoker']) is list and len(external['invoker'])==2 and
         all(type(x) is int and 0<x<2**31 for x in external['invoker']),
         'selected failed-job invoker')
    need(type(raw) is bytes and 0<len(raw)<=8<<20 and
         integer(external['logBytes'],1,8<<20)==len(raw) and sha(raw)==external['logSha256'],
         'exact externally selected failed log bytes')
    need(type(outer_raw) is bytes and 0<len(outer_raw)<=4096 and
         integer(external['outerBytes'],1,4096)==len(outer_raw) and
         sha(outer_raw)==external['outerSha256'],'exact failed outside terminal original')
    need(type(cleanup_raw) is bytes and 0<len(cleanup_raw)<=16384 and
         integer(external['cleanupBytes'],1,16384)==len(cleanup_raw) and
         sha(cleanup_raw)==external['cleanupSha256'],'exact failed outside cleanup original')
    outer=parse(outer_raw);keys(outer,'schema runId unit systemdRunExitCode outsideCleanupExitCode cgroupAfter')
    need(outer_raw==canonical(outer) and outer['schema']=='bw.ring3.setup-outer-terminal.v9' and
         outer['runId']==external['runId'] and outer['unit']==
         '/sys/fs/cgroup/system.slice/bw-ring3-setup-v9-'+external['runId']+'-1.service' and
         type(outer['systemdRunExitCode']) is int and 0<=outer['systemdRunExitCode']<=255 and
         type(outer['outsideCleanupExitCode']) is int and 0<=outer['outsideCleanupExitCode']<=255 and
         outer['cgroupAfter'] in ('present','absent') and
         (outer['systemdRunExitCode']!=0 or outer['outsideCleanupExitCode']!=0 or
          outer['cgroupAfter']!='absent'),'finite failed outside terminal facts')
    cleanup=setup_v9_cleanup_original(cleanup_raw,external)
    need(cleanup['serviceExitCode']==outer['systemdRunExitCode'] and
         cleanup['setupApproved'] is False and type(cleanup['secondary']) is list and
         len(cleanup['secondary'])<=64,'finite failed outside cleanup facts')
    if cleanup['cgroupTerminal']=='empty':
        census=cleanup['unitCensus']
        need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
             setup_v9_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
             'independent empty nested outside census')
    elif cleanup['cgroupTerminal']=='absent':
        need(cleanup['unitCensus'] is None,'absent outside unit has no census')
    else:
        need(cleanup['firstFailure'] is not None,'uncertain outside cgroup remains failure')
        census=cleanup['unitCensus']
        if census is not None:
            need(type(census) is dict and set(census)=={'cgroupProcs','cgroupEvents','cgroupStat'} and
                 not setup_v9_cgroup_quiet(census['cgroupProcs'],census['cgroupEvents'],census['cgroupStat']),
                 'retained active nested outside census, never cleanup permission')
    packets=[]
    for line in raw.splitlines():
        at=line.find(b'{"actualGuestApproved":false,')
        if at<0:continue
        need(line[:at]==b'' or re.fullmatch(rb'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ',line[:at]),
             'canonical failed packet log prefix')
        need(len(line)-at<=4<<20,'bounded failed packet')
        packet=parse_setup_v9_outer(line[at:]);need(line[at:]==canonical(packet).rstrip(b'\n'),'canonical failed packet')
        if packet.get('schema')=='bw.ring3.setup-entry-failure.v9':packets.append(packet)
    if not packets:
        if b'RING3_SETUP_RUNTIME_INVENTORY_V9 ' in raw and outer['systemdRunExitCode']!=0:
            try:
                return verify_setup_v9_failed_stream_inventory(raw,external,cleanup,shell,outer)
            except (ValueError,UnicodeError):
                # Other complete failures remain refused until separately
                # reviewed. A timed truncated wire may still use the opaque
                # path below; it never acquires positive authority.
                if outer['systemdRunExitCode'] not in (124,137):raise
        # A complete inner metadata packet is still a failed attempt when the
        # bounded outer client exits nonzero or outside cleanup is uncertain.
        try:
            _,record,source,event_raw,_=setup_v9_inner_original(raw,external,shell)
        except (ValueError,UnicodeError) as decode_error:
            # A killed outer client can leave only a bounded prefix. Keep its
            # exact official bytes as opaque evidence; no inner fact is graded.
            need(outer['systemdRunExitCode'] in (124,137) and
                 cleanup['sourceAdmission'] is not None and
                 type(cleanup['firstFailure']) is dict and
                 cleanup['firstFailure'].get('phase')=='v9-outer-client',
                 'only source-admitted timed client permits opaque inner prefix')
            return {'schema':'bw.ring3.setup-failure-retention.v9',
                'failedAttemptRetained':True,'innerOriginalIncomplete':True,
                'innerMetadataCompleteReported':False,'innerDecodeError':type(decode_error).__name__,
                'retainedLogBytes':len(raw),'retainedLogSha256':sha(raw),
                'partialMutationPossible':True,'firstFailure':cleanup['firstFailure'],
                'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
                'outsideCgroupAfter':outer['cgroupAfter'],
                'outerClientExitCode':outer['systemdRunExitCode'],
                'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
                'shellImageFields':shell['fields'],'serviceImageFields':None,
                'forwardingMatchesExpected':None,'officialJobAuthenticated':False,
                'actualGuestApproved':False,'actualRunApproved':False,
                'candidateReviewed':False,'completeHostConfiguration':False}

        if cleanup['sourceAdmission'] is not None:
            need(equal(cleanup['sourceAdmission']['source'],source) and
                 cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
                 'outside source/event joins complete failed-job inner original')
        first=cleanup['firstFailure'] or {'phase':'v9-outside-terminal','name':'ValueError',
            'message':'bounded outside terminal or cleanup refusal'}
        return {'schema':'bw.ring3.setup-failure-retention.v9',
            'failedAttemptRetained':True,'innerMetadataCompleteReported':True,
            'partialMutationPossible':True,'firstFailure':first,
            'secondary':cleanup['secondary'],'outsideCleanup':cleanup['action'],
            'outsideCgroupAfter':outer['cgroupAfter'],
            'outerClientExitCode':outer['systemdRunExitCode'],
            'outsideFirstFailure':cleanup['firstFailure'],'setupObserved':False,
            'shellImageFields':shell['fields'],
            'serviceImageFields':record['setup']['preflight']['imageFields'],
            'forwardingMatchesExpected':True,'officialJobAuthenticated':False,
            'actualGuestApproved':False,'actualRunApproved':False,
            'candidateReviewed':False,'completeHostConfiguration':False}
    need(len(packets)==1,'one complete failed setup packet')
    packet=packets[0];keys(packet,'schema context setup firstFailure secondary publicationSafe actualGuestApproved completeHostConfiguration')
    need(packet['schema']=='bw.ring3.setup-entry-failure.v9' and packet['publicationSafe'] is False and
         packet['actualGuestApproved'] is False and packet['completeHostConfiguration'] is False and
         type(packet['firstFailure']) is dict and type(packet['secondary']) is list and
         len(packet['secondary'])<=64,'failed packet with retained first and secondary')
    keys(packet['firstFailure'],'phase name message')
    context=packet['context'];keys(context,'request event platform source sourceCommands eventIdentity imageFields imageFieldErrors')
    setup_v9_image_observation(context['imageFields'],context['imageFieldErrors'])
    forwarding_matches=context['imageFields']==setup_v9_expected_forwarded(shell['fields'])
    request_raw=prerequisite_original(canonical(context['request']))
    request,source=setup_v9_request(request_raw,external['requestSha256'])
    event_raw=prerequisite_original(canonical(context['event']))
    need(type(context['platform']) is dict and set(context['platform'])==set(SETUP_V9_PLATFORM),
         'closed failed platform')
    environment=context['platform'];setup_v9_event(event_raw,request,external['requestSha256'],environment)
    need(environment['GITHUB_RUN_ID']==external['runId'] and
         environment['GITHUB_WORKFLOW_SHA']==external['workflowSha'] and
         request['head']==external['head'] and request['tree']==external['tree'] and
         source['files'][WORKFLOW]['sha256']==external['workflowFileSha256'] and
         equal(context['source'],source),'failed source/request/event/official context join')
    if cleanup['sourceAdmission'] is not None:
        need(equal(cleanup['sourceAdmission']['source'],source) and
             cleanup['sourceAdmission']['eventSha256']==sha(event_raw),
             'outside source/event admission joins failed inner original')
    need(type(context['sourceCommands']) is list and len(context['sourceCommands'])==3 and
         all(type(item) is dict and set(item)=={'argv','process','stdout','stderr'} for item in context['sourceCommands']),
         'three retained failed source command originals')
    commands=context['sourceCommands'];git=['--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
    tails=[['rev-parse','HEAD'],['rev-parse','HEAD^{tree}'],['ls-tree','-r','HEAD','--',*sorted(SETUP_SOURCE_PATHS)]]
    outputs=[(request['head']+'\n').encode(),(request['tree']+'\n').encode(),
        ''.join(source['files'][path]['mode']+' blob '+source['files'][path]['blob']+'\t'+path+'\n'
                for path in sorted(SETUP_SOURCE_PATHS)).encode()]
    previous=0;parent=None;safe=None
    for index,command in enumerate(commands):
        argv=command['argv']
        need(type(argv) is list and len(argv)>3 and argv[:2]==['/usr/bin/git','-c'] and
             type(argv[2]) is str and argv[2].startswith('safe.directory=/'),
             'fixed failed source Git descriptor')
        if safe is None:safe=argv[2]
        need(argv==['/usr/bin/git','-c',safe,*git,*tails[index]],'exact failed source Git command')
        start,end=v9_process(command['process'],'discovery',argv,
            {'LANG':'C.UTF-8','HOME':'/nonexistent','PATH':'/usr/bin:/bin',
             'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1'},10000)
        if parent is None:parent=command['process']['parentPid']
        need(start>=previous and command['process']['parentPid']==parent and
             prerequisite_original(canonical(command['stdout']))==outputs[index] and
             command['stderr'] is None,'causal failed source Git original')
        previous=end
    need(type(context['eventIdentity']) is dict and
         set(context['eventIdentity'])==set('st_dev st_ino st_mode st_uid st_gid st_nlink st_size st_mtime_ns'.split()) and
         all(type(x) is int for x in context['eventIdentity'].values()) and
         context['eventIdentity']['st_size']==len(event_raw) and
         stat.S_ISREG(context['eventIdentity']['st_mode']),
         'failed held event extent')
    setup=packet['setup'];need(type(setup) is dict and setup.get('schema')=='bw.ring3.setup-original.v9' and
         setup.get('firstFailure') is not None and setup.get('nodeStage') is None and setup.get('runtime') is None,
         'only partial setup before Node stage')
    keys(setup,'schema preflight archives policy unpack configure postStatus cleanup policyCleanupCgroup nodeStage runtime partial deferredHostTriggers configurationComplete firstFailure secondary')
    need(setup['configurationComplete'] is False and type(setup['secondary']) is list and
         len(setup['secondary'])<=64,'closed partial setup and secondary')
    partial=setup['partial']
    preflight_prefix=None
    if setup['preflight'] is None:
        need(type(partial) is dict and partial.get('phase')=='preflight',
             'failed preflight has a typed retained prefix')
        keys(partial,'phase prefix failedHelper')
        preflight_prefix=partial['prefix']
        keys(preflight_prefix,'statusOriginal statusSha256 statusBytes statusRecords completedHelpers helperWitness imageFields imageFieldErrors')
        setup_v9_image_observation(preflight_prefix['imageFields'],preflight_prefix['imageFieldErrors'])
        need(preflight_prefix['imageFields']==context['imageFields'] and
             preflight_prefix['imageFieldErrors']==context['imageFieldErrors'],
             'failed preflight retains exact entry image observation')
        completed=preflight_prefix['completedHelpers'];witnesses=preflight_prefix['helperWitness']
        need(type(completed) is list and type(witnesses) is dict and
             completed==list(SETUP_V9_HELPERS)[:len(completed)] and
             set(witnesses)==set(completed),'ordered bounded successful helper prefix')
        status_meta=preflight_prefix['statusOriginal']
        if status_meta is None:
            need(preflight_prefix['statusSha256'] is None and preflight_prefix['statusBytes'] is None and
                 preflight_prefix['statusRecords'] is None and completed==[],
                 'no fabricated pre-status or helper facts before observation')
        else:
            keys(status_meta,'role bytes sha256 packedBytes packedSha256')
            need(status_meta['role']=='pre' and status_meta['sha256']==preflight_prefix['statusSha256'] and
                 status_meta['bytes']==preflight_prefix['statusBytes'] and
                 integer(status_meta['bytes'],1,8<<20)>0 and
                 integer(status_meta['packedBytes'],1,700<<10)>0 and
                 digest(status_meta['packedSha256'])==status_meta['packedSha256'],
                 'bounded retained preflight status summary')
            if preflight_prefix['statusRecords'] is not None:
                integer(preflight_prefix['statusRecords'],1,5000)
            need(not completed or preflight_prefix['statusRecords']==1211,
                 'helper prefix follows full selected pre-status census')
        for path in completed:
            item=witnesses[path];keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(item['path']==path and item['sha256']==SETUP_V9_HELPERS[path] and
                 item['closeAttempted'] is True and item['closeSucceeded'] is True and
                 item['namedBefore']==item['heldBefore']==item['heldAfter']==item['namedAfter'],
                 'completed helper prefix has stable reported identity')
            info=item['heldBefore']
            need(type(info) is list and len(info)==8 and all(type(n) is int for n in info) and
                 stat.S_ISREG(info[2]) and info[3:6]==[0,0,1] and info[2]&0o022==0 and
                 type(item['bytesRead']) is int and 0<item['bytesRead']==info[6]<=2<<20 and
                 item['bytesRead']==SETUP_V9_NEW_HELPER_BYTES.get(path,item['bytesRead']),
                 'bounded known successful helper witness')
        failed=partial['failedHelper']
        helper_attempt=bool(completed) or failed is not None
        if helper_attempt:
            need(status_meta is not None and preflight_prefix['statusSha256']==SETUP_V9_STATUS_SHA and
                 preflight_prefix['statusBytes']==SETUP_V9_STATUS_BYTES and
                 preflight_prefix['statusRecords']==1211,
                 'helper attempt follows exact selected pre-status baseline')
        if failed is not None:
            keys(failed,'phase witness')
            item=failed['witness']
            keys(item,'path namedBefore heldBefore heldAfter namedAfter bytesRead sha256 closeAttempted closeSucceeded')
            need(failed['phase']=='helper' and len(completed)<len(SETUP_V9_HELPERS) and
                 item['path']==list(SETUP_V9_HELPERS)[len(completed)] and
                 integer(item['bytesRead'],0,2<<20)>=0 and
                 type(item['closeAttempted']) is bool and type(item['closeSucceeded']) is bool and
                 (item['sha256'] is None or digest(item['sha256'])==item['sha256']),
                 'bounded failing helper position and partial byte count')
            for key in ('namedBefore','heldBefore','heldAfter','namedAfter'):
                info=item[key]
                need(info is None or (type(info) is list and len(info)==8 and
                     all(type(n) is int for n in info)),
                     'bounded partial helper metadata')
    if type(partial) is dict and partial.get('phase')=='node-stage':
        keys(partial,'phase copy record dropProgress invoker')
        need(type(partial['copy']) is dict and
             set(partial['copy'])==set('created sourceBefore sourceAfter sourceNamedAfter bytesCopied sourceBytesRead writeUncertain targetAfterFailure directoryAfterFailure copiedSha256 readbackSha256 filePublicationAttempted directoryPublicationAttempted filePublished directoryPublished file directory'.split()) and
             type(partial['dropProgress']) is list and
             partial['dropProgress']==['groups','gid','uid','ids-verified'][:len(partial['dropProgress'])] and
             equal(partial['invoker'],external['invoker']),
             'retained bounded failed Node copy/drop progress')
        if partial['record'] is not None:
            keys(partial['record'],'bytes sha256')
            integer(partial['record']['bytes'],1,1<<20);digest(partial['record']['sha256'])
    required_roles=set()
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        fact=setup[key]
        if type(fact) is dict and fact.get('statusOriginal') is not None:
            required_roles.add(role)
    statuses=decode_setup_v9_status_log(raw,None)
    roles=set(statuses)
    if preflight_prefix is not None and preflight_prefix['statusOriginal'] is not None:
        required_roles.add('pre')
        need('pre' in roles and equal(statuses['pre']['meta'],preflight_prefix['statusOriginal']) and
             sha(statuses['pre']['raw'])==preflight_prefix['statusSha256'] and
             len(statuses['pre']['raw'])==preflight_prefix['statusBytes'],
             'raw failed preflight status joins retained prefix')
        if preflight_prefix['statusRecords'] is not None:
            pre_rows=setup_v9_status_rows(statuses['pre']['raw'])
            need(len(pre_rows)==preflight_prefix['statusRecords'],
                 'raw failed preflight census joins retained prefix')
            if helper_attempt:
                need(not any(name in {key[0] for key in pre_rows} for name,*_ in SETUP_V9_PACKAGES),
                     'selected fifteen absent before any helper attempt')
    need(required_roles<=roles,'all reported failed status originals retained')
    for key,role,hash_key,size_key in (('preflight','pre','statusSha256','statusBytes'),
                                       ('postStatus','post','sha256','bytes')):
        if role in roles:
            fact=setup[key]
            if role in required_roles and type(fact) is dict:
                need(type(fact) is dict and equal(statuses[role]['meta'],fact['statusOriginal']) and
                    statuses[role]['meta']['sha256']==fact[hash_key] and
                    statuses[role]['meta']['bytes']==fact[size_key],
                    'independent retained failed raw status original join')
            rows=setup_v9_status_rows(statuses[role]['raw'])
            if role in required_roles and type(fact) is dict:
                need(len(rows)==fact['statusRecords' if role=='pre' else 'records'],
                     'retained failed raw status census')
            if role=='pre' and role in required_roles and type(fact) is dict:
                need(fact['statusSha256']==SETUP_V9_STATUS_SHA and
                     fact['statusBytes']==SETUP_V9_STATUS_BYTES,
                     'failed pre-state remains fixed selected baseline')
    need(setup['firstFailure']==packet['firstFailure'] or
         packet['firstFailure']['phase']=='v9-entry','retained setup/entry first failure relationship')
    return {'schema':'bw.ring3.setup-failure-retention.v9','failedAttemptRetained':True,
        'partialMutationPossible':True,'firstFailure':packet['firstFailure'],
        'secondary':packet['secondary'],'outsideCleanup':cleanup['action'],
        'outsideCgroupAfter':outer['cgroupAfter'],
        'outerClientExitCode':outer['systemdRunExitCode'],
        'outsideFirstFailure':cleanup['firstFailure'],
        'outsideSecondary':cleanup['secondary'],'setupObserved':False,
        'shellImageFields':shell['fields'],'serviceImageFields':context['imageFields'],
        'forwardingMatchesExpected':forwarding_matches,
        'stageAttemptObserved':type(partial) is dict and partial.get('phase')=='node-stage',
        'retainedStatusRoles':sorted(roles),'statusRolesJoinedToSetup':sorted(required_roles),
        'rawStatusBytesIndependentlyVerified':bool(roles),
        'ciArchiveBytesIndependentlyVerified':False,
        'officialJobAuthenticated':False,'actualGuestApproved':False,
        'candidateReviewed':False,'actualRunApproved':False}


def setup_v9_official_metadata(run_raw,jobs_raw,artifacts_raw,external):
    """Bounded original API facts; authentication of their acquisition is external."""
    digest(external['artifactSha256'])
    originals=(('run',run_raw),('jobs',jobs_raw),('artifacts',artifacts_raw))
    for role,raw in originals:
        need(type(raw) is bytes and integer(external[role+'MetadataBytes'],1,1<<20)==len(raw) and
             digest(external[role+'MetadataSha256'])==sha(raw),
             'externally selected exact official '+role+' metadata original')
    run,jobs,artifacts=(parse_setup_v9_outer(raw) for _,raw in originals)
    need(type(run) is dict and type(jobs) is dict and type(artifacts) is dict,
         'official metadata JSON object originals')
    need(all(type(run.get(key)) is dict for key in ('repository','head_repository','actor')) and
         type(run.get('pull_requests')) is list and
         all(type(item) is dict and type(item.get('head')) is dict for item in run['pull_requests']),
         'typed official run owner and pull-request rows')
    run_id=integer(run.get('id'),1)
    need(str(run_id)==external['runId'] and integer(run.get('run_attempt'),1,1)==1 and
         run.get('head_sha')==external['head'] and run.get('event')=='pull_request' and
         run.get('status')=='completed' and run.get('conclusion')==external['conclusion'] and
         run.get('path')==WORKFLOW and run.get('name')=='Ring3 INT80 IRETD source controls' and
         run.get('repository',{}).get('full_name')=='CrispStrobe/bw-board' and
         run.get('head_repository',{}).get('full_name')=='CrispStrobe/bw-board' and
         run.get('actor',{}).get('login')=='CrispStrobe' and
         type(run.get('pull_requests')) is list and len(run['pull_requests'])==1 and
         integer(run['pull_requests'][0].get('number'),1)==external['pullRequest'] and
         run['pull_requests'][0].get('head',{}).get('sha')==external['head'],
         'one owned official run/head/attempt/pull-request original')
    rows=jobs.get('jobs')
    need(type(rows) is list and integer(jobs.get('total_count'),1,64)==len(rows) and
         all(type(item) is dict and integer(item.get('id'),1)>0 for item in rows) and
         len({item.get('id') for item in rows})==len(rows),
         'complete unique bounded official job collection')
    selected=[item for item in rows if item.get('name')==external['jobName']]
    need(len(selected)==1,'one selected V9 producing job')
    job=selected[0]
    need(integer(job.get('id'),1)==external['jobId'] and integer(job.get('run_id'),1)==run_id and
         integer(job.get('run_attempt'),1,1)==1 and job.get('head_sha')==external['head'] and
         job.get('workflow_name')=='Ring3 INT80 IRETD source controls' and
         job.get('status')=='completed' and job.get('conclusion')==external['conclusion'],
         'selected official V9 job/run/head/status')
    steps=job.get('steps')
    need(type(steps) is list and 5<=len(steps)<=16 and
         all(type(row) is dict and type(row.get('name')) is str and
             row.get('status')=='completed' and
             row.get('conclusion') in ('success','failure','skipped') for row in steps) and
         len({row['name'] for row in steps})==len(steps),
         'bounded unique official step originals')
    required=['Set up job',
        'Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
        'Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
        'Bounded v9 package setup and dropped runtime inventory',
        'Retain v9 setup and runtime originals']
    need([item['name'] for item in steps[:5]]==required and
         all(item['conclusion']=='success' for item in steps[:3]) and
         steps[3]['conclusion']==external['conclusion'] and
         steps[4]['conclusion']=='success',
         'exact checkout, selected Node setup, producing and upload steps')
    rows=artifacts.get('artifacts')
    need(type(rows) is list and integer(artifacts.get('total_count'),1,1)==len(rows)==1,
         'sole bounded official run artifact')
    artifact=rows[0]
    need(type(artifact) is dict and type(artifact.get('workflow_run')) is dict,
         'typed selected official artifact and run relation')
    need(integer(artifact.get('id'),1)==external['artifactId'] and
         artifact.get('name')=='i80386-ring3-setup-runtime-inventory-v9-originals' and
         artifact.get('name')==external['artifactName'] and
         integer(artifact.get('size_in_bytes'),1,8<<20)==external['artifactBytes'] and
         artifact.get('digest')=='sha256:'+external['artifactSha256'] and
         artifact.get('expired') is False and
         integer(artifact['workflow_run'].get('id'),1)==run_id and
         artifact['workflow_run'].get('head_sha')==external['head'],
         'one exact selected official artifact ID, extent, digest and run')
    return {'runId':run_id,'jobId':job['id'],'artifactId':artifact['id'],
        'artifactBytes':artifact['size_in_bytes'],'artifactSha256':external['artifactSha256'],
        'producingStepConclusion':steps[3]['conclusion'],'uploadStepConclusion':steps[4]['conclusion']}


def verify_setup_v9_originals(raw,external,outer_raw,cleanup_raw,shell_raw,official_job_log,
                              run_metadata,jobs_metadata,artifacts_metadata):
    """Join the externally retained official job log without granting image authority."""
    need(SETUP_V9_READER_ENABLED is True,'v9 independent reader inactive')
    keys(external,'schema requestSha256 runId attempt head tree workflowSha workflowFileSha256 jobId jobName conclusion logBytes logSha256 outerBytes outerSha256 cleanupBytes cleanupSha256 shellBytes shellSha256 invoker officialLogBytes officialLogSha256 runMetadataBytes runMetadataSha256 jobsMetadataBytes jobsMetadataSha256 artifactsMetadataBytes artifactsMetadataSha256 artifactId artifactName artifactBytes artifactSha256 pullRequest')
    need(type(official_job_log) is bytes and
         integer(external['officialLogBytes'],1,8<<20)==len(official_job_log) and
         digest(external['officialLogSha256'])==sha(official_job_log),
         'one exact externally selected official job-log original')
    official=host_baseline_official_image(official_job_log,external['jobName'])
    metadata=setup_v9_official_metadata(run_metadata,jobs_metadata,artifacts_metadata,external)
    inner={key:value for key,value in external.items() if key not in (
        'officialLogBytes','officialLogSha256','runMetadataBytes','runMetadataSha256',
        'jobsMetadataBytes','jobsMetadataSha256','artifactsMetadataBytes','artifactsMetadataSha256',
        'artifactId','artifactName','artifactBytes','artifactSha256','pullRequest')}
    need(inner['conclusion'] in ('success','failure'),'closed V9 official job conclusion')
    grade=verify_setup_v9_log if inner['conclusion']=='success' else verify_setup_v9_failure_log
    result=grade(raw,inner,outer_raw,cleanup_raw,shell_raw)
    if inner['conclusion']=='success':
        selected_request=decode_setup_v9_log(raw)['setup.request.json']
        request,_=setup_v9_request(selected_request,external['requestSha256'])
        need(request['pullRequest']==external['pullRequest'],
             'official run pull request joins selected V9 request')
    service=result.get('serviceImageFields')
    reported=(service is not None and official['Image']=='ubuntu-24.04' and
              service.get('ImageOS')=={'present':True,'value':'ubuntu24'} and
              service.get('ImageVersion')=={'present':True,'value':official['Version']})
    return dict(result,officialRunnerImage=official,officialImageMatchesReported=reported,
        officialMetadata=metadata,
        imageFieldsAuthenticated=False,immutableImageIdentityEstablished=False,
        officialJobAuthenticated=False,actualGuestApproved=False,actualRunApproved=False)


def main():
    if '--inventory-setup-v9' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-setup-v9'],'exact single V9 inventory mode')
        need(SETUP_V9_READER_ENABLED is True,'V9 reader inactive pending reviewed source/event')
        originals,passed,safe=setup_v9_inventory_entry(dict(os.environ))
        if safe:emit_setup_v9_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush)
        raise SystemExit(0 if passed and safe else 1)
    if sys.argv[1:2]==['--setup-v9-inventory-log']:
        need(SETUP_V9_READER_ENABLED is True,'V9 independent reader inactive')
        parser=argparse.ArgumentParser(description='Independent original-only V9 setup/runtime audit',allow_abbrev=False)
        for name in ('setup-v9-inventory-log','external-admission','outer-resource-original',
                     'outside-cleanup-original','shell-image-original','official-job-log',
                     'official-run-metadata','official-jobs-metadata','official-artifacts-metadata'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==19,'exact V9 original and official metadata inputs')
        args=parser.parse_args()
        def read(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        external=parse_setup_v9_outer(read(args.external_admission,1<<20))
        result=verify_setup_v9_originals(read(args.setup_v9_inventory_log,8<<20),external,
            read(args.outer_resource_original,4096),read(args.outside_cleanup_original,16384),
            read(args.shell_image_original,4096),read(args.official_job_log,8<<20),
            read(args.official_run_metadata,1<<20),read(args.official_jobs_metadata,1<<20),
            read(args.official_artifacts_metadata,1<<20))
        print(json.dumps(result,sort_keys=True));return
    if sys.argv[1:2]==['--host-baseline-originals']:
        need(HOST_BASELINE_READER_ENABLED is True,'baseline reader inactive pending reviewed event')
        parser=argparse.ArgumentParser(description='Independent read-only hosted baseline',allow_abbrev=False)
        for name in ('host-baseline-originals','shell-original','outside-original',
                     'official-job-log','external-admission'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==11,'exact baseline originals CLI')
        args=parser.parse_args()
        def bounded(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        external=parse_setup_v8_outer(bounded(args.external_admission,1<<20))
        result=verify_host_baseline(bounded(args.host_baseline_originals,4<<20),
            bounded(args.shell_original,4096),bounded(args.outside_original,16384),
            bounded(args.official_job_log,8<<20),external)
        print(json.dumps(result,sort_keys=True));return
    if sys.argv[1:2]==['--consumed-v7-failure']:
        parser=argparse.ArgumentParser(description='Negative-only consumed v7 path failure audit',allow_abbrev=False)
        for name in ('consumed-v7-failure','external-admission','outer-resource-original',
                     'outside-cleanup-original','shell-image-original'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==11,'exact consumed v7 failure original CLI')
        args=parser.parse_args()
        def read(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        result=consumed_v7_path_failure_audit(read(args.consumed_v7_failure,8<<20),
            parse_setup_v7_outer(read(args.external_admission,1<<20)),
            read(args.outer_resource_original,4096),
            read(args.outside_cleanup_original,16384),read(args.shell_image_original,4096))
        print(json.dumps(result,sort_keys=True));return
    if '--inventory-setup-v8' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-setup-v8'],'exact single v8 inventory mode')
        need(SETUP_V8_READER_ENABLED is True,'v8 reader inactive pending reviewed source/event')
        originals,passed,safe=setup_v8_inventory_entry(dict(os.environ))
        if safe:emit_setup_v8_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush)
        raise SystemExit(0 if passed and safe else 1)
    if sys.argv[1:2]==['--setup-v8-inventory-log']:
        parser=argparse.ArgumentParser(description='Independent original-only v8 setup/runtime audit',allow_abbrev=False)
        for name in ('setup-v8-inventory-log','external-admission','outer-resource-original',
                     'outside-cleanup-original','shell-image-original'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==11,'exact v8 original inputs')
        args=parser.parse_args()
        def read(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        raw=read(args.setup_v8_inventory_log,8<<20)
        outer=read(args.outer_resource_original,4096)
        cleanup=read(args.outside_cleanup_original,16384)
        shell=read(args.shell_image_original,4096)
        external=parse(read(args.external_admission,1<<20))
        need(type(external) is dict and external.get('conclusion') in ('success','failure'),
             'externally selected v8 job conclusion')
        grade=verify_setup_v8_log if external['conclusion']=='success' else verify_setup_v8_failure_log
        print(json.dumps(grade(raw,external,outer,cleanup,shell),sort_keys=True));return
    if sys.argv[1:2]==['--consumed-v6-failure']:
        parser=argparse.ArgumentParser(description='Negative-only consumed v6 original audit',allow_abbrev=False)
        for name in ('consumed-v6-failure','external-admission','outer-resource-original',
                     'outside-cleanup-original','shell-image-original'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==11,'exact consumed v6 failure original CLI')
        args=parser.parse_args()
        def read(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        result=v6_consumed_failure_audit(read(args.consumed_v6_failure,8<<20),
            parse_setup_v6_outer(read(args.external_admission,1<<20)),read(args.outer_resource_original,4096),
            read(args.outside_cleanup_original,16384),read(args.shell_image_original,4096))
        print(json.dumps(result,sort_keys=True));return
    if sys.argv[1:2]==['--image-env-diagnostic-log']:
        parser=argparse.ArgumentParser(description='Independent image environment original-only reader',allow_abbrev=False)
        for name in ('image-env-diagnostic-log','shell-original','outside-original','external-admission'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==9,'exact image diagnostic original CLI')
        args=parser.parse_args()
        def read(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        result=verify_image_diag(read(args.shell_original,4096),
             read(args.image_env_diagnostic_log,1<<20),read(args.outside_original,4096),
             parse(read(args.external_admission,65536)))
        print(json.dumps(result,sort_keys=True));return
    if '--inventory-setup-v7' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-setup-v7'],'exact single v7 inventory mode')
        need(SETUP_V7_READER_ENABLED is True,'v7 setup reader disabled pending reviewed source/event')
        originals,passed,safe=setup_v7_inventory_entry(dict(os.environ))
        if safe:emit_setup_v7_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush)
        raise SystemExit(0 if passed and safe else 1)
    if sys.argv[1:2]==['--setup-v7-inventory-log']:
        parser=argparse.ArgumentParser(description='Independent original-only v7 setup/runtime audit',allow_abbrev=False)
        for name in ('setup-v7-inventory-log','external-admission','outer-resource-original',
                     'outside-cleanup-original','shell-image-original'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==11,'exact v7 official original CLI')
        args=parser.parse_args()
        def read(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        raw=read(args.setup_v7_inventory_log,8<<20)
        outer=read(args.outer_resource_original,4096)
        cleanup=read(args.outside_cleanup_original,16384)
        shell=read(args.shell_image_original,4096)
        external=parse(read(args.external_admission,1<<20))
        need(type(external) is dict and external.get('conclusion') in ('success','failure'),
             'externally selected v7 job conclusion')
        grade=verify_setup_v7_log if external['conclusion']=='success' else verify_setup_v7_failure_log
        print(json.dumps(grade(raw,external,outer,cleanup,shell),sort_keys=True));return
    if '--inventory-setup-v6' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-setup-v6'],'exact single v6 inventory mode')
        need(SETUP_V6_READER_ENABLED is True,'v6 setup reader disabled pending reviewed source/event')
        originals,passed,safe=setup_v6_inventory_entry(dict(os.environ))
        if safe:emit_setup_v6_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush)
        raise SystemExit(0 if passed and safe else 1)
    if sys.argv[1:2]==['--setup-v6-inventory-log']:
        parser=argparse.ArgumentParser(description='Independent original-only v6 setup/runtime audit',allow_abbrev=False)
        for name in ('setup-v6-inventory-log','external-admission','outer-resource-original',
                     'outside-cleanup-original','shell-image-original'):
            parser.add_argument('--'+name,required=True)
        need(len(sys.argv)==11,'exact v6 official original CLI')
        args=parser.parse_args()
        def read(path,cap):
            with Path(path).open('rb') as stream:return stream.read(cap+1)
        raw=read(args.setup_v6_inventory_log,8<<20)
        outer=read(args.outer_resource_original,4096)
        cleanup=read(args.outside_cleanup_original,16384)
        shell=read(args.shell_image_original,4096)
        external=parse(read(args.external_admission,1<<20))
        need(type(external) is dict and external.get('conclusion') in ('success','failure'),
             'externally selected v6 job conclusion')
        grade=verify_setup_v6_log if external['conclusion']=='success' else verify_setup_v6_failure_log
        print(json.dumps(grade(raw,external,outer,cleanup,shell),sort_keys=True));return
    if '--inventory-setup-v5' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-setup-v5'],'exact single v5 inventory mode')
        need(SETUP_V5_READER_ENABLED is True,'v5 setup reader disabled pending reviewed source/event')
        originals,passed,safe=setup_v5_inventory_entry(dict(os.environ))
        if safe:emit_setup_v5_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush)
        raise SystemExit(0 if passed and safe else 1)
    if sys.argv[1:2]==['--setup-v5-inventory-log']:
        parser=argparse.ArgumentParser(description='Independent original-only v5 setup/runtime audit',allow_abbrev=False)
        parser.add_argument('--setup-v5-inventory-log',required=True);parser.add_argument('--external-admission',required=True)
        parser.add_argument('--outer-resource-original',required=True)
        parser.add_argument('--outside-cleanup-original',required=True)
        need(len(sys.argv)==9 and sys.argv.count('--setup-v5-inventory-log')==
             sys.argv.count('--external-admission')==sys.argv.count('--outer-resource-original')==
             sys.argv.count('--outside-cleanup-original')==1,
             'exact v5 official original and external expectation')
        args=parser.parse_args()
        with Path(args.setup_v5_inventory_log).open('rb') as stream:raw=stream.read((8<<20)+1)
        with Path(args.outer_resource_original).open('rb') as stream:outer=stream.read(4097)
        with Path(args.outside_cleanup_original).open('rb') as stream:cleanup=stream.read(16385)
        with Path(args.external_admission).open('rb') as stream:external=parse(stream.read((1<<20)+1))
        need(type(external) is dict and external.get('conclusion') in ('success','failure'),
             'externally selected v5 job conclusion')
        grade=verify_setup_v5_log if external['conclusion']=='success' else verify_setup_v5_failure_log
        print(json.dumps(grade(raw,external,outer,cleanup),sort_keys=True));return
    if '--inventory-setup-v4' in sys.argv[1:]:
        need(sys.argv[1:]==['--inventory-setup-v4'],'exact single v4 inventory mode')
        need(SETUP_V4_READER_ENABLED is True,'v4 setup reader disabled pending reviewed source/event')
        originals,passed,safe=setup_v4_inventory_entry(dict(os.environ))
        if safe:emit_setup_v4_inventory(originals,sys.stdout.buffer.write,sys.stdout.buffer.flush)
        raise SystemExit(0 if passed and safe else 1)
    if sys.argv[1:2]==['--setup-v4-inventory-log']:
        parser=argparse.ArgumentParser(description='Independent original-only v4 setup/runtime audit',allow_abbrev=False)
        parser.add_argument('--setup-v4-inventory-log',required=True);parser.add_argument('--external-admission',required=True)
        parser.add_argument('--outer-resource-original',required=True)
        parser.add_argument('--outside-cleanup-original',required=True)
        need(len(sys.argv)==9 and sys.argv.count('--setup-v4-inventory-log')==
             sys.argv.count('--external-admission')==sys.argv.count('--outer-resource-original')==
             sys.argv.count('--outside-cleanup-original')==1,
             'exact v4 official original and external expectation')
        args=parser.parse_args()
        with Path(args.setup_v4_inventory_log).open('rb') as stream:raw=stream.read((8<<20)+1)
        with Path(args.outer_resource_original).open('rb') as stream:outer=stream.read(4097)
        with Path(args.outside_cleanup_original).open('rb') as stream:cleanup=stream.read(16385)
        with Path(args.external_admission).open('rb') as stream:external=parse(stream.read((1<<20)+1))
        need(type(external) is dict and external.get('conclusion') in ('success','failure'),
             'externally selected v4 job conclusion')
        grade=verify_setup_v4_log if external['conclusion']=='success' else verify_setup_v4_failure_log
        print(json.dumps(grade(raw,external,outer,cleanup),sort_keys=True));return
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
