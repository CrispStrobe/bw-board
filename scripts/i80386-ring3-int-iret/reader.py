#!/usr/bin/env python3
"""MIT. Original-only ring3 reader. No producer, fixture builder or emulator imports.

External admission is an independently reviewed input, not evidence created by
this reader. Manufactured controls exercise predicates; they confer no actual
run/source/runtime authority.
"""
import argparse
import hashlib
import io
import json
import posixpath
import re
import struct
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


def main():
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
