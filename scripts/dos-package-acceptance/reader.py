#!/usr/bin/env python3
"""MIT. Independent original-byte reader; no producer imports or execution."""
import argparse
import hashlib
import io
import json
import math
import re
import struct
import zipfile
import zlib
from pathlib import Path

CASES = ('a', 'b', 'malformed', 'focus-loss')
PREFIX = 'build/dos-package-acceptance'
CAPS = {'cpuMax': '100000 100000', 'memoryMax': 1073741824, 'swapMax': 0,
        'pidsMax': 64, 'childMs': 120000, 'controllerMs': 600000,
        'steps': 50000000, 'ptyBytes': 33554432, 'eventCount': 65536,
        'eventBytes': 16777216, 'reportBytes': 262144, 'packetBytes': 201326592}
BIOS = {'path': 'roms/free-at-bios/BIOS-bochs-legacy', 'bytes': 65536,
        'sha256': '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'}
VGA = {'path': 'roms/free-at-bios/vgabios-lgpl.bin', 'bytes': 38400,
       'sha256': '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'}
CONFIG = b'[cpu]\ncputype=386\n[autoexec]\nimgmount c disks/boot.img -t hdd -size 512,1,1,1\nboot -l c\n'
# Reviewed raw instructions/data, not producer labels or generated metadata.
BOOT_CODE = bytes.fromhex(
    'ea057c0000fa31c08ed88ec08ed0bc007cfbfcb80300cd10be837ce8400030e4cd16'
    'a2c47c3c6174043c627527be927ce82b00a0c47ce84200be9e7ce81f00a0c47c345a'
    'e82200b90000e2febea67ce80c00eb06beb67ce80400faebfe90ac84c07405e81500'
    'ebf6c350c0e804e8010058240f04303c3976020407b40ebb0700cd10c342572d504b'
    '472d52454144590d0a0042572d504b472d4b45593d003b584f5235413d000d0a4257'
    '2d504b472d444f4e450d0a0042572d504b472d4641494c0d0a0000')
BOOT = BOOT_CODE + bytes(510 - len(BOOT_CODE)) + b'\x55\xaa'
LICENSE_SHA = 'e53c4e17a0971ca6cac5010a19876b77a896e3ce172b1f61d934dfd14c595d6d'
INPUT_GOLDENS = {'authored': (2014, 'a3511f8daae0e5803ae050974e4a62ff75bf852ccff2681855f5bf1bfd7bdcc4'),
                 'malformed': (2020, 'e783114b8d4874041e28db5603d309b53c2066a6961a1c0b1af86aa5869d7182')}
START = b'\x1b[?1049h\x1b[?25l\x1b[?1004h'
END = b'\x1b[?1004l\x1b[?25h\x1b[?1049l'
FOOTER = b'Ctrl-] quits; text VGA only.'
READY = ['BW-PKG-READY'] + [''] * 24
RESPONSES = {key: ['BW-PKG-READY', 'BW-PKG-KEY=' + key + ';XOR5A=' + f'{ord(key) ^ 0x5a:02X}',
                   'BW-PKG-DONE'] + [''] * 22 for key in ('a', 'b')}
ERROR = 'DOS package refused: package path is not canonical'
FOCUS_ERROR = {'phase': 'terminal-input', 'name': 'Error',
               'message': 'terminal focus loss ends this bounded package session'}
ROLE_PATHS = {'audit.json', 'source.before.json', 'source.after.json', 'runtime.json',
              'resources.json', 'inputs.json', 'inputs/authored.zip', 'inputs/malformed.zip'}
for _case in CASES:
    ROLE_PATHS.update(_case + '/' + name for name in ('process.json', 'pty.raw', 'events.json'))
    if _case != 'malformed':
        ROLE_PATHS.add(_case + '/report.json')
ENVIRONMENT = {'NODE_OPTIONS': None, 'NODE_PATH': None, 'LD_PRELOAD': None,
               'LD_AUDIT': None, 'backendFlags': []}
REQUIRED_SOURCE = {'src/dos-package-policy.js', 'src/dosbox-config.js',
                   'scripts/lib/dos-package-zip.mjs', 'scripts/lib/i80386-at-terminal.mjs',
                   'scripts/run-dos-package.mjs', 'src/experimental/i80386-at-machine.js',
                   'src/experimental/i80386.js', 'package.json', 'LICENSE',
                   'scripts/dos-package-acceptance/probe.mjs',
                   'scripts/dos-package-acceptance/producer.py',
                   'scripts/dos-package-acceptance/reader.py',
                   'scripts/dos-package-acceptance/README.md',
                   'test/dos-package-acceptance.test.mjs',
                   '.github/workflows/dos-package-acceptance.yml',
                   BIOS['path'], VGA['path'], 'roms/free-at-bios/LICENSE',
                   'roms/free-at-bios/README.md'}


class Refusal(ValueError):
    """First failed independent admission condition."""


def need(condition, message):
    if not condition:
        raise Refusal(message)


def keys(value, names, label):
    need(isinstance(value, dict) and set(value) == set(names.split() if isinstance(names, str) else names),
         label + ': closed fields')
    return value


def integer(value, low=0, high=(1 << 63) - 1, label='integer'):
    need(type(value) is int and low <= value <= high, label + ': integer extent')
    return value


def text(value, low=1, high=4096, label='text'):
    need(isinstance(value, str) and low <= len(value) <= high and '\x00' not in value,
         label + ': string extent')
    return value


def digest(value, size=64):
    need(isinstance(value, str) and re.fullmatch('[0-9a-f]{' + str(size) + '}', value), 'digest encoding')
    return value


def equal(left, right):
    return json.dumps(left, sort_keys=True, separators=(',', ':')) == json.dumps(right, sort_keys=True, separators=(',', ':'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def path(value):
    text(value, 1, 256, 'path')
    need(re.fullmatch(r'[A-Za-z0-9_./-]+', value) and not value.startswith('/') and
         all(part not in ('', '.', '..') for part in value.split('/')), 'canonical relative path')
    return value


def no_duplicates(pairs):
    obj = {}
    for key, value in pairs:
        need(key not in obj, 'duplicate JSON field')
        obj[key] = value
    return obj


def json_bytes(data):
    try:
        return json.loads(data.decode('utf-8'), object_pairs_hook=no_duplicates,
                          parse_constant=lambda _value: (_ for _ in ()).throw(Refusal('nonfinite JSON')))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise Refusal('invalid original JSON') from error


def schema(value, suffix, fields):
    keys(value, fields, suffix)
    need(value['schema'] == 'bw.dos-package-pty.' + suffix + '.v1', suffix + ': schema')


def number(value, label):
    need(type(value) in (int, float) and math.isfinite(value) and value >= 0, label + ': finite nonnegative')
    return value


def stored_input(data, malformed=False):
    """Read original local/central records independently, before any asset map."""
    label = 'malformed' if malformed else 'authored'
    count_bytes, expected_sha = INPUT_GOLDENS[label]
    need(len(data) == count_bytes and sha(data) == expected_sha, label + ': immutable original ZIP')
    need(len(data) >= 22, 'input EOCD extent')
    eocd = struct.unpack_from('<IHHHHIIH', data, len(data) - 22)
    need(eocd[:5] == (0x06054b50, 0, 0, 3, 3) and eocd[7] == 0 and
         eocd[5] + eocd[6] == len(data) - 22, 'input exact EOCD')
    central = eocd[6]
    position, local_position = central, 0
    names = ['pkg/../dosbox.conf' if malformed else 'pkg/dosbox.conf',
             'pkg/disks/boot.img', 'pkg/LICENSE.txt']
    result = []
    for name in names:
        need(position + 46 <= len(data) - 22, 'input central extent')
        row = struct.unpack_from('<IHHHHHHIIIHHHHHII', data, position)
        sig, made, version, flags, method, time, date, crc, compressed, size, nl, extra, comment, disk, internal, external, offset = row
        need((sig, made, version, flags, method, time, date, extra, comment, disk, internal, external) ==
             (0x02014b50, 20, 20, 0, 0, 0, 33, 0, 0, 0, 0, 0), 'input central profile')
        need(nl == len(name) and data[position + 46:position + 46 + nl] == name.encode() and
             compressed == size and offset == local_position, 'input original names/topology')
        need(offset + 30 + nl + size <= central, 'input local extent')
        local = struct.unpack_from('<IHHHHHIIIHH', data, offset)
        need(local == (0x04034b50, 20, 0, 0, 0, 33, crc, size, size, nl, 0) and
             data[offset + 30:offset + 30 + nl] == name.encode(), 'input original local/central agreement')
        payload = data[offset + 30 + nl:offset + 30 + nl + size]
        need(zlib.crc32(payload) == crc, 'input independent CRC')
        result.append({'path': name, 'bytes': size, 'sha256': sha(payload), 'crc32': f'{crc:08x}'})
        if len(result) == 1:
            need(payload == CONFIG, 'independent exact config grammar/geometry')
        elif len(result) == 2:
            need(payload == BOOT, 'independent full authored boot instructions/data')
        else:
            need(size == 1068 and sha(payload) == LICENSE_SHA, 'authored MIT notice')
        position += 46 + nl
        local_position = offset + 30 + nl + size
    need(position == len(data) - 22 and local_position == central, 'input exact original coverage')
    if malformed:
        need('..' in result[0]['path'].split('/'), 'malformed traversal cause')
    else:
        for row in result:
            path(row['path'])
    return result


def role_limit(name):
    if name.endswith('/pty.raw'):
        return CAPS['ptyBytes']
    if name.endswith('/events.json'):
        return CAPS['eventBytes']
    if name.endswith('/report.json'):
        return CAPS['reportBytes']
    if name.startswith('inputs/'):
        return 16384
    return 2097152


def read_archive(data):
    need(isinstance(data, bytes) and 0 < len(data) <= CAPS['packetBytes'], 'official ZIP byte cap')
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        infos = archive.infolist()
        need(len(infos) == len(ROLE_PATHS), 'closed original role count')
        need({info.orig_filename for info in infos} == ROLE_PATHS and
             len({info.filename.lower() for info in infos}) == len(infos), 'closed original role names')
        total = 0
        result = {}
        for info in infos:
            need(info.orig_filename == info.filename and path(info.filename) == info.filename and
                 not info.is_dir() and not (info.flag_bits & 1) and
                 info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'original evidence ZIP profile')
            kind = (info.external_attr >> 16) & 0xf000
            need(kind in (0, 0x8000) and (info.external_attr & 0x10) == 0, 'original evidence role type')
            need(0 < info.file_size <= role_limit(info.filename) and
                 info.compress_size <= CAPS['packetBytes'], 'original role extent')
            total += info.file_size
            need(total <= CAPS['packetBytes'], 'expanded original packet cap')
            with archive.open(info) as member:
                content = member.read(role_limit(info.filename) + 1)
                need(member.read(1) == b'' and len(content) == info.file_size, 'bounded original read')
            result[info.filename] = content
        return result
    except (zipfile.BadZipFile, RuntimeError, OSError, EOFError, NotImplementedError) as error:
        raise Refusal('original evidence ZIP read failed') from error


def source(value, expected):
    schema(value, 'source', 'schema head tree files')
    need(value['head'] == expected['head'] and value['tree'] == expected['tree'] and
         equal(value['files'], expected['files']), 'source Git/live/expected join')
    digest(value['head'], 40)
    digest(value['tree'], 40)
    need(isinstance(value['files'], dict) and REQUIRED_SOURCE <= set(value['files']) and
         1 <= len(value['files']) <= 4096, 'independent expected source census')
    for name, row in value['files'].items():
        path(name)
        keys(row, 'bytes sha256 mode blob', 'source row')
        integer(row['bytes'], 0, 33554432, 'source bytes')
        digest(row['sha256'])
        digest(row['blob'], 40)
        need(row['mode'] in ('100644', '100755'), 'source regular Git mode')
    for firmware in (BIOS, VGA):
        row = value['files'][firmware['path']]
        need(row['bytes'] == firmware['bytes'] and row['sha256'] == firmware['sha256'], 'immutable firmware Git row')
    need(value['files']['LICENSE']['bytes'] == 1068 and value['files']['LICENSE']['sha256'] == LICENSE_SHA,
         'immutable MIT source notice')


def runtime(value, expected):
    schema(value, 'runtime', 'schema platform executables versions')
    need(equal(value, expected), 'independently admitted observed runtime')
    keys(value['platform'], 'sysname release machine', 'runtime platform')
    need(value['platform']['sysname'] == 'Linux' and value['platform']['machine'] == 'x86_64', 'Linux runtime profile')
    text(value['platform']['release'], 1, 256)
    keys(value['executables'], 'node python', 'runtime executable roles')
    keys(value['versions'], 'node python', 'runtime version roles')
    for name, row in value['executables'].items():
        keys(row, 'path bytes sha256', 'runtime executable')
        need(text(row['path'], 2, 1024).startswith('/') and '\n' not in row['path'], 'runtime executable path')
        integer(row['bytes'], 1, 268435456)
        digest(row['sha256'])
        text(value['versions'][name], 1, 256)
    need(value['versions']['node'] == 'v22.23.3' and
         value['versions']['python'].startswith('Python 3.'), 'observed runtime versions')


def inputs(value, packet):
    schema(value, 'inputs', 'schema authored malformed firmware')
    for name in ('authored', 'malformed'):
        keys(value[name], 'path bytes sha256 members', 'input manifest row')
        raw = packet['inputs/' + name + '.zip']
        need(equal(value[name], {'path': 'inputs/' + name + '.zip', 'bytes': len(raw),
                             'sha256': sha(raw), 'members': stored_input(raw, name == 'malformed')}),
             'independent original input manifest')
    keys(value['firmware'], 'bios vga', 'firmware roles')
    need(equal(value['firmware'], {'bios': BIOS, 'vga': VGA}), 'firmware identity profile')


def termios(value, label):
    need(isinstance(value, list) and len(value) == 7, label + ': termios shape')
    for field in value[:6]:
        integer(field, 0, 0xffffffff, label)
    need(isinstance(value[6], list) and 16 <= len(value[6]) <= 64, label + ': termios cc')
    for byte in value[6]:
        integer(byte, 0, 255, label)
    # Only predeclared Linux LF/CRLF output processing, not retrospective repair.
    need(value[1] & ~5 == 0, label + ': unsupported output processing')
    return b'\r\n' if value[1] & 1 and value[1] & 4 else b'\n'


def frames(raw, newline):
    need(raw.startswith(START) and raw.endswith(END), 'actual live terminal start/restoration bytes')
    position, finish = len(START), len(raw) - len(END)
    output = []
    while position < finish:
        start = position
        need(raw[position:position + 3] == b'\x1b[H', 'source-bound frame prefix')
        position += 3
        rows = []
        for _ in range(25):
            end = raw.find(newline, position, finish)
            need(end >= position, 'completed VGA row')
            try:
                row = raw[position:end].decode('utf-8')
            except UnicodeError as error:
                raise Refusal('original VGA UTF8') from error
            need(len(row) == 80 and all(0x20 <= ord(ch) <= 0x7e or 0xa0 <= ord(ch) <= 0xff for ch in row),
                 'sanitized padded eighty-character row')
            rows.append(row.rstrip(' '))
            position = end + len(newline)
        need(raw[position:position + len(FOOTER) + len(newline)] == FOOTER + newline,
             'completed source-bound frame footer')
        position += len(FOOTER) + len(newline)
        output.append({'start': start, 'end': position, 'rows': rows})
    need(position == finish and 1 <= len(output) <= 6104, 'bounded original frame coverage')
    return output


def report(value, case, source_inputs):
    keys(value, 'schema target packageSha256 config media firmware budgets steps stop refused input serial text cpu snapshotComplete secondaryErrors terminal guestCompletionQualified', 'runner report')
    need(value['schema'] == 'bw.dos-package-run.v1' and value['target'] == 'i80386-at-functional-ordinary', 'real runner report schema/target')
    need(value['packageSha256'] == source_inputs['authored']['sha256'], 'report package identity')
    need(value['config'] == {'path': 'pkg/dosbox.conf', 'sha256': sha(CONFIG)}, 'report selected exact config')
    need(json.dumps(value['media'], sort_keys=True) == json.dumps({'path': 'pkg/disks/boot.img', 'sha256': sha(BOOT), 'byteLength': 512,
                            'geometry': {'cylinders': 1, 'heads': 1, 'sectors': 1}}, sort_keys=True), 'report selected boot image/geometry')
    need(value['firmware'] == {'biosSha256': BIOS['sha256'], 'vgaSha256': VGA['sha256']}, 'report firmware')
    need(equal(value['budgets'], {'steps': 50000000, 'wallMs': 120000}), 'frozen runner budget')
    integer(value['steps'], 0, CAPS['steps'], 'ordinary calls')
    need(value['snapshotComplete'] is True and value['secondaryErrors'] == [] and
         value['guestCompletionQualified'] is False, 'snapshot/error/claim boundary')
    need(value['terminal'] == {'started': True, 'restorationAttempted': True, 'restorationComplete': True},
         'runner owned terminal cleanup claim')
    keys(value['cpu'], 'cs eip cr0', 'observed final CPU only')
    integer(value['cpu']['cs'], 0, 65535)
    integer(value['cpu']['eip'], 0, 0xffffffff)
    integer(value['cpu']['cr0'], 0, 0xffffffff)
    keys(value['serial'], 'text truncated', 'serial final report')
    text(value['serial']['text'], 0, 65536)
    need(value['serial']['truncated'] is False, 'serial cap uncertainty')
    keys(value['input'], 'bytes delivered pendingScanBytes', 'runner input')
    integer(value['input']['bytes'], 0, 65536)
    integer(value['input']['pendingScanBytes'], 0, 4096)
    need(isinstance(value['input']['delivered'], list) and value['input']['pendingScanBytes'] == 0,
         'no pending scan bytes')
    if case in ('a', 'b'):
        need(value['steps'] == 50000000 and value['stop'] == 'budget' and value['refused'] is None,
             'finite positive budget stop')
        need(value['input']['bytes'] == 4, 'exact actual initial-IN/key bytes')
        expected = [30, 158] if case == 'a' else [48, 176]
        need(len(value['input']['delivered']) == 2, 'accepted make and break')
        steps = []
        for row, code in zip(value['input']['delivered'], expected):
            keys(row, 'step code', 'accepted scan row')
            integer(row['step'], 0, value['steps'] - 1)
            integer(row['code'], 0, 255)
            need(row['code'] == code and row['step'] % 1024 == 0, 'exact accepted scan/service step')
            steps.append(row['step'])
        need(steps[1] - steps[0] >= 65536, 'accepted make/break ordinary-call spacing')
        need(value['text'] == RESPONSES[case], 'final key-dependent authored VGA')
    else:
        need(case == 'focus-loss' and value['stop'] == 'refused' and value['refused'] == FOCUS_ERROR and
             value['input'] == {'bytes': 3, 'delivered': [], 'pendingScanBytes': 0} and value['text'] == READY,
             'exact focus-loss refusal/no scan/no response')
    return value


def expected_argv(case, node):
    input_name = 'malformed' if case == 'malformed' else 'authored'
    return [node, 'scripts/run-dos-package.mjs', '--package', PREFIX + '/inputs/' + input_name + '.zip',
            '--config', 'pkg/dosbox.conf', '--bios', BIOS['path'], '--bios-sha256', BIOS['sha256'],
            '--vga', VGA['path'], '--vga-sha256', VGA['sha256'], '--steps', '50000000',
            '--wall-ms', '120000', '--live', '--report', PREFIX + '/' + case + '/report.json']


def process(value, case, node):
    schema(value, 'process', 'schema case argv cwdRole environmentPolicy pid pgid startTimeTicks spawnMonoNs reapMonoNs returncode signal rusage groupEmpty firstFailure secondary waitStatus')
    need(value['case'] == case and value['argv'] == expected_argv(case, node) and
         value['cwdRole'] == 'checkout' and value['environmentPolicy'] == ENVIRONMENT,
         'exact real CLI argv/environment')
    pid = integer(value['pid'], 2, 0x7fffffff, 'observed PID')
    need(integer(value['pgid'], 2, 0x7fffffff) == pid, 'fresh process session/group')
    integer(value['startTimeTicks'], 1)
    start = integer(value['spawnMonoNs'], 1)
    finish = integer(value['reapMonoNs'], start)
    need(finish - start <= 124000000000, 'child120s plus bounded4s reaping grace')
    expected = 0 if case in ('a', 'b') else 1
    need(integer(value['returncode'], 0, 255) == expected and value['signal'] is None and
         integer(value['waitStatus'], 0, 65535) == expected << 8, 'original wait4 terminal status')
    need(value['groupEmpty'] is True and value['firstFailure'] is None and value['secondary'] == [],
         'original reap/group/first-error closure')
    keys(value['rusage'], 'userSeconds systemSeconds maxRssKiB', 'original wait4 rusage')
    number(value['rusage']['userSeconds'], 'rusage user')
    number(value['rusage']['systemSeconds'], 'rusage system')
    integer(value['rusage']['maxRssKiB'], 1)
    return value


def events(value, case, raw, proc):
    schema(value, 'events', 'schema case events termios')
    need(value['case'] == case, 'event case join')
    keys(value['termios'], 'before raw after', 'external terminal modes')
    before = value['termios']['before']
    newline_before = termios(before, 'original terminal')
    termios(value['termios']['after'], 'restored terminal')
    need(value['termios']['after'] == before, 'external exact termios restoration')
    need(before[3] & (2 | 8 | 1) == (2 | 8 | 1), 'original cooked terminal flags')
    if case == 'malformed':
        need(value['termios']['raw'] is None, 'malformed did not enter live terminal mode')
        frame_list = []
        need(raw == ERROR.encode() + newline_before, 'original visible malformed refusal')
    else:
        live = value['termios']['raw']
        newline = termios(live, 'observed raw terminal')
        need(live[3] & (2 | 8 | 1) == 0, 'actual raw ICANON/ECHO/ISIG clear')
        frame_list = frames(raw, newline)
    items = value['events']
    need(isinstance(items, list) and 1 <= len(items) <= CAPS['eventCount'], 'event count bound')
    position, last_time, reads, writes, wait = 0, proc['spawnMonoNs'], [], [], None
    for seq, item in enumerate(items):
        need(isinstance(item, dict) and item.get('seq') == seq, 'event sequence')
        integer(item['seq'], 0, CAPS['eventCount'] - 1)
        timestamp = integer(item.get('monoNs'), last_time, proc['spawnMonoNs'] + CAPS['controllerMs'] * 1000000, 'monotonic event time')
        last_time = timestamp
        kind = item.get('kind')
        need(wait is None, 'terminal wait is last event')
        if kind == 'read':
            keys(item, 'seq monoNs kind offset bytes', 'original read event')
            need(integer(item['offset'], 0, len(raw)) == position, 'contiguous original PTY offsets')
            position += integer(item['bytes'], 1, len(raw), 'original PTY read size')
            need(position <= len(raw), 'PTY original extent')
            reads.append(item)
        elif kind == 'write':
            keys(item, 'seq monoNs kind hex written', 'actual write event')
            need(isinstance(item['hex'], str) and re.fullmatch(r'(?:[0-9a-f]{2})+', item['hex']), 'actual input hex')
            written = integer(item['written'], 1, 4)
            need(len(item['hex']) == written * 2, 'actual successful write prefix only')
            writes.append(item)
        elif kind == 'wait':
            keys(item, 'seq monoNs kind returncode signal', 'original wait event')
            integer(item['returncode'], 0, 255)
            need(item['returncode'] == proc['returncode'] and item['signal'] == proc['signal'] and
                 item['monoNs'] >= proc['reapMonoNs'], 'wait4/event process join')
            wait = item
        else:
            raise Refusal('unknown original event kind')
    need(position == len(raw) and reads and wait is not None, 'all original bytes and terminal wait retained')
    expected = bytes.fromhex('1b5b49' + ('61' if case == 'a' else '62')) if case in ('a', 'b') else \
        (bytes.fromhex('1b5b4f') if case == 'focus-loss' else b'')
    need(b''.join(bytes.fromhex(item['hex']) for item in writes) == expected, 'exact real PTY input/no quit')
    if case == 'malformed':
        need(not writes, 'malformed has no input')
        return {'frames': 0, 'termiosRestored': True}

    def read_at(end):
        for item in reads:
            if item['offset'] + item['bytes'] >= end:
                return item
        raise Refusal('missing completed-frame read')

    ready = next((frame for frame in frame_list if frame['rows'] == READY), None)
    need(ready is not None and writes, 'actual fresh completed READY before input')
    ready_index = frame_list.index(ready)
    for frame in frame_list[:ready_index]:
        partial_ready = READY[0].startswith(frame['rows'][0]) and all(not row for row in frame['rows'][1:])
        need(partial_ready or not any('BW-PKG-' in row for row in frame['rows']),
             'no stale authored result before completed READY')
    need(read_at(ready['end'])['seq'] < writes[0]['seq'], 'completed fresh READY precedes first input write')
    need(read_at(ready['end'])['monoNs'] <= writes[0]['monoNs'], 'READY/input monotonic causality')
    if case in ('a', 'b'):
        response = next((frame for frame in frame_list[ready_index + 1:] if frame['rows'] == RESPONSES[case]), None)
        need(response is not None and read_at(response['end'])['seq'] > writes[-1]['seq'],
             'later completed key-dependent actual response')
        need(read_at(response['end'])['monoNs'] >= writes[-1]['monoNs'], 'key/response monotonic causality')
        # Partial guest printing is observable between READY and completed DONE.
        # It must be a prefix of the one actual authored response, never opposite/failure text.
        expected_rows = RESPONSES[case]
        previous_lengths = [0, 0]
        for frame in frame_list[ready_index:]:
            need(frame['rows'][0] == expected_rows[0] and all(not row for row in frame['rows'][3:]),
                 'authored mode3 frame extents')
            if read_at(frame['end'])['seq'] < writes[-1]['seq']:
                need(frame['rows'] == READY, 'no partial guest response before complete real input')
            for index, (observed, target) in enumerate(zip(frame['rows'][1:3], expected_rows[1:3])):
                need(target.startswith(observed) and len(observed) >= previous_lengths[index],
                     'only monotone correct actual response prefix')
                previous_lengths[index] = len(observed)
            if frame['rows'][2]:
                need(frame['rows'][1] == expected_rows[1], 'DONE follows complete key-dependent row')
        need(frame_list[-1]['rows'] == expected_rows, 'last original VGA frame is completed result')
    else:
        need(all(frame['rows'] == READY for frame in frame_list[ready_index:]),
             'focus loss did not admit a guest response')
    return {'frames': len(frame_list), 'readyEnd': ready['end'], 'readyIndex': ready_index,
            'minimumReadyCalls': min((ready_index + 1) * 8192, CAPS['steps']), 'termiosRestored': True,
            **({'responseEnd': response['end']} if case in ('a', 'b') else {})}


def kernel_fields(raw, mandatory, label):
    text(raw, 1, 16384, label)
    need(raw.endswith('\n') and all(ord(ch) < 128 for ch in raw), label + ': original ASCII kernel lines')
    result = {}
    for line in raw.splitlines():
        parts = line.split()
        need(len(parts) == 2 and re.fullmatch('[a-z][a-z0-9_.]*', parts[0]) and parts[0] not in result and
             re.fullmatch('[0-9]+', parts[1]), label + ': kernel key/value')
        result[parts[0]] = integer(int(parts[1]), 0, (1 << 64) - 1)
    need(set(mandatory) <= set(result), label + ': required kernel fields')
    return result


def kernel_scalar(raw, label):
    need(isinstance(raw, str) and re.fullmatch(r'[0-9]+\n', raw), label + ': original kernel scalar')
    return integer(int(raw), 0, (1 << 64) - 1)


def resource_snapshot(value, label):
    keys(value, 'identity limits raw procs', label)
    keys(value['identity'], 'device inode', label + ' identity')
    integer(value['identity']['device'], 1)
    integer(value['identity']['inode'], 1)
    keys(value['limits'], 'cpuMax memoryMax swapMax pidsMax', label + ' limits')
    need(value['limits'] == {'cpuMax': CAPS['cpuMax'], 'memoryMax': str(CAPS['memoryMax']),
                            'swapMax': '0', 'pidsMax': '64'}, label + ': exact declared kernel limits')
    keys(value['raw'], 'memoryEvents cpuStat cgroupEvents memoryCurrent memoryPeak pidsCurrent', label + ' raw files')
    memory = kernel_fields(value['raw']['memoryEvents'], ('low', 'high', 'max', 'oom', 'oom_kill'), label + ' memory.events')
    cpu = kernel_fields(value['raw']['cpuStat'], ('usage_usec', 'user_usec', 'system_usec'), label + ' cpu.stat')
    cgroup = kernel_fields(value['raw']['cgroupEvents'], ('populated', 'frozen'), label + ' cgroup.events')
    need(cgroup['populated'] in (0, 1) and cgroup['frozen'] == 0, label + ': cgroup state')
    current = kernel_scalar(value['raw']['memoryCurrent'], label + ' memory.current')
    peak = kernel_scalar(value['raw']['memoryPeak'], label + ' memory.peak')
    pids = kernel_scalar(value['raw']['pidsCurrent'], label + ' pids.current')
    need(peak >= current, label + ': observed memory extents')
    need(isinstance(value['procs'], list) and len(value['procs']) <= CAPS['pidsMax'] and
         len(set(value['procs'])) == len(value['procs']), label + ': original process list')
    for pid in value['procs']:
        integer(pid, 2, 0x7fffffff)
    return {'memory': memory, 'cpu': cpu, 'cgroup': cgroup, 'current': current, 'peak': peak, 'pids': pids}


def resource_pair(value, label, terminal=False, controller_pid=None):
    keys(value, 'before after', label + ' snapshots')
    before = resource_snapshot(value['before'], label + ' before')
    after = resource_snapshot(value['after'], label + ' after')
    need(value['before']['identity'] == value['after']['identity'], label + ': retained cgroup identity')
    for kind in ('memory', 'cpu'):
        need(set(before[kind]) == set(after[kind]) and
             all(after[kind][key] >= old for key, old in before[kind].items()), label + ': monotone kernel counters')
    need(all(after['memory'][key] == old for key, old in before['memory'].items() if key.startswith('oom')),
         label + ': no new OOM')
    need(after['peak'] >= before['peak'], label + ': monotone memory peak')
    if terminal:
        need(value['after']['procs'] == [] and after['cgroup']['populated'] == 0 and after['pids'] == 0,
             label + ': externally observed terminal/empty cgroup')
    if label.startswith('case '):
        need(value['before']['procs'] == [] and before['cgroup']['populated'] == 0 and before['pids'] == 0,
             label + ': fresh empty case cgroup')
    if controller_pid is not None:
        need(value['before']['procs'] == [controller_pid] and value['after']['procs'] == [controller_pid] and
             before['cgroup']['populated'] == 1 and after['cgroup']['populated'] == 1 and
             before['pids'] >= 1 and after['pids'] >= 1, 'retained live controller identity')
    return (value['before']['identity']['device'], value['before']['identity']['inode'])


def resources(value):
    schema(value, 'resources', 'schema caps controller cases enclosing')
    need(json.dumps(value['caps'], sort_keys=True) == json.dumps(CAPS, sort_keys=True), 'frozen resource profile')
    keys(value['controller'], 'pid before after', 'controller snapshots')
    pid = integer(value['controller']['pid'], 2, 0x7fffffff)
    identities = [resource_pair({key: value['controller'][key] for key in ('before', 'after')}, 'controller', controller_pid=pid)]
    keys(value['cases'], CASES, 'resource case roles')
    for case in CASES:
        identities.append(resource_pair(value['cases'][case], 'case ' + case, terminal=True))
    identities.append(resource_pair(value['enclosing'], 'enclosing', terminal=True))
    need(len(set(identities)) == 6 and len({row[0] for row in identities}) == 1,
         'distinct source-bound cgroup roles on one kernel filesystem')
    return pid


def official(value, artifact):
    keys(value, 'repository workflowPath workflowSha256 runId attempt event eventAction head label jobId jobName conclusion artifactId artifactBytes artifactSha256 requiredSteps enclosingCleanupSuccess', 'external official fields')
    integer(value['attempt'], 1, 1, 'official attempt')
    need(value['repository'] == 'CrispStrobe/bw-board' and
         value['workflowPath'] == '.github/workflows/dos-package-acceptance.yml' and
         value['attempt'] == 1 and value['event'] == 'pull_request' and value['eventAction'] == 'labeled' and
         value['jobName'] == 'actual' and value['conclusion'] == 'success' and
         value['enclosingCleanupSuccess'] is True, 'official single-run exact workflow/event/job success')
    # Label and exact three step literals are frozen with workflow before launch.
    need(value['label'] == 'x86-dos-package-actual', 'official actual label')
    need(value['requiredSteps'] == {'Bounded four fresh package cases': 'success',
                                    'Owned controller terminal and empty': 'success',
                                    'Retain original evidence': 'success'}, 'official required steps')
    for key in ('runId', 'jobId', 'artifactId'):
        integer(value[key], 1)
    digest(value['head'], 40)
    digest(value['workflowSha256'])
    need(integer(value['artifactBytes'], 1, CAPS['packetBytes']) == len(artifact) and
         digest(value['artifactSha256']) == sha(artifact), 'sole original artifact official digest/extent')


def verify_artifact(artifact, external):
    """Verify retained original bytes against independently admitted external facts."""
    keys(external, 'official source runtime', 'independent external admission')
    official(external['official'], artifact)
    keys(external['source'], 'head tree files', 'external expected source')
    need(external['source']['head'] == external['official']['head'], 'official/source exact head')
    packet = read_archive(artifact)
    audit = json_bytes(packet['audit.json'])
    schema(audit, 'audit', 'schema head sourceTree workflowSha256 roles cases firstFailure secondary')
    need(audit['head'] == external['source']['head'] and audit['sourceTree'] == external['source']['tree'] and
         audit['workflowSha256'] == external['official']['workflowSha256'] and
         audit['cases'] == list(CASES) and audit['firstFailure'] is None and audit['secondary'] == [],
         'original audit source/case/first-error envelope')
    role_rows = [{'path': name, 'bytes': len(packet[name]), 'sha256': sha(packet[name])}
                 for name in sorted(ROLE_PATHS - {'audit.json'})]
    need(equal(audit['roles'], role_rows), 'closed original role bytes and hashes')
    before = json_bytes(packet['source.before.json'])
    after = json_bytes(packet['source.after.json'])
    source(before, external['source'])
    source(after, external['source'])
    need(before == after, 'source before/after identity')
    workflow = before['files']['.github/workflows/dos-package-acceptance.yml']
    need(workflow['sha256'] == external['official']['workflowSha256'], 'source/workflow byte identity')
    runtime_value = json_bytes(packet['runtime.json'])
    runtime(runtime_value, external['runtime'])
    input_value = json_bytes(packet['inputs.json'])
    inputs(input_value, packet)
    controller_pid = resources(json_bytes(packet['resources.json']))
    cases = {}
    previous_terminal = None
    first_spawn = None
    for case in CASES:
        proc = process(json_bytes(packet[case + '/process.json']), case, runtime_value['executables']['node']['path'])
        if first_spawn is None:
            first_spawn = proc['spawnMonoNs']
        if previous_terminal is not None:
            need(proc['spawnMonoNs'] >= previous_terminal, 'four fresh cases observed serially')
        need(proc['pid'] != controller_pid, 'controller and child are different observed processes')
        event_value = json_bytes(packet[case + '/events.json'])
        observed = events(event_value, case, packet[case + '/pty.raw'], proc)
        previous_terminal = event_value['events'][-1]['monoNs']
        need(previous_terminal - first_spawn <= CAPS['controllerMs'] * 1000000, 'observed case window within controller cap')
        if case != 'malformed':
            result = report(json_bytes(packet[case + '/report.json']), case, input_value)
            need(result['steps'] >= observed['minimumReadyCalls'] and
                 observed['frames'] <= math.ceil(result['steps'] / 8192), 'report calls cover original source-bound draws')
            if case in ('a', 'b'):
                need(result['input']['delivered'][0]['step'] >= observed['minimumReadyCalls'],
                     'accepted scan cannot precede completed READY ordinary-call boundary')
            observed.update({'ordinaryCalls': result['steps'], 'acceptedScans': result['input']['delivered']})
        cases[case] = observed
    return {'schema': 'bw.dos-package-pty.independent-result.v1', 'pass': True,
            'head': external['official']['head'], 'artifactSha256': sha(artifact),
            'sourceRows': len(before['files']), 'roles': len(packet), 'cases': cases,
            'limits': {'directConsumedAlOrPcWitness': False, 'runtimeImportAbsenceWitness': False,
                       'externalListenerEnumeration': False, 'guestCompletionQualifiedByRunner': False,
                       'installedGuiQualified': False, 'performanceQualified': False}}


def run_controls(license_bytes=None):
    """Inert independent full-packet controls. Never entered by artifact verification."""
    import copy
    from types import SimpleNamespace
    r = SimpleNamespace(**globals())
    if license_bytes is None:
        notice = Path(__file__).resolve().parents[2] / 'LICENSE'
        need(not notice.is_symlink() and notice.is_file() and notice.stat().st_size == 1068,
             'control MIT source notice')
        license_bytes = notice.read_bytes()
    need(len(license_bytes) == 1068 and sha(license_bytes) == LICENSE_SHA, 'control MIT bytes')

    def authored_zip(bad=False):
        # Separate original-record serializer, not the production ZIP adapter.
        locals_, centrals, offset = [], [], 0
        for name, data in [('pkg/../dosbox.conf' if bad else 'pkg/dosbox.conf', CONFIG),
                           ('pkg/disks/boot.img', BOOT), ('pkg/LICENSE.txt', license_bytes)]:
            name = name.encode('ascii')
            crc = zlib.crc32(data)
            local = struct.pack('<IHHHHHIIIHH', 0x04034b50,20,0,0,0,33,crc,len(data),len(data),len(name),0) + name + data
            central = struct.pack('<IHHHHHHIIIHHHHHII',0x02014b50,20,20,0,0,0,33,crc,len(data),len(data),len(name),0,0,0,0,0,offset) + name
            locals_.append(local)
            centrals.append(central)
            offset += len(local)
        directory = b''.join(centrals)
        return b''.join(locals_) + directory + struct.pack('<IHHHHIIH',0x06054b50,0,0,3,3,len(directory),offset,0)

    def encode(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
    def frame(rows):return b'\x1b[H'+b'\r\n'.join(s.ljust(80).encode('utf-8') for s in rows)+b'\r\n'+r.FOOTER+b'\r\n'
    def snap(inode,pid=None,populated=None,after=False):
     pids=[] if pid is None else [pid]
     return {'identity':{'device':1,'inode':inode},'limits':{'cpuMax':'100000 100000','memoryMax':'1073741824','swapMax':'0','pidsMax':'64'},'raw':{'memoryEvents':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n','cpuStat':f'usage_usec {100 if after else 0}\nuser_usec {50 if after else 0}\nsystem_usec {50 if after else 0}\n','cgroupEvents':f'populated {int(bool(pids)) if populated is None else populated}\nfrozen 0\n','memoryCurrent':'0\n','memoryPeak':'1\n','pidsCurrent':f'{int(bool(pids)) if populated is None else populated}\n'},'procs':pids}
    def fixture():
     files={p:{'bytes':123,'sha256':'1'*64,'mode':'100644','blob':'2'*40} for p in r.REQUIRED_SOURCE}
     for fw in (r.BIOS,r.VGA):files[fw['path']].update(bytes=fw['bytes'],sha256=fw['sha256'])
     files['LICENSE'].update(bytes=1068,sha256=r.LICENSE_SHA)
     source={'schema':'bw.dos-package-pty.source.v1','head':'a'*40,'tree':'b'*40,'files':files}
     runtime={'schema':'bw.dos-package-pty.runtime.v1','platform':{'sysname':'Linux','release':'manufactured-not-runtime','machine':'x86_64'},'executables':{'node':{'path':'/fixture/node','bytes':123,'sha256':'3'*64},'python':{'path':'/fixture/python','bytes':123,'sha256':'4'*64}},'versions':{'node':'v22.23.3','python':'Python 3.12.3'}}
     inputbytes={k:authored_zip(k == 'malformed') for k in ('authored','malformed')}
     inputs={'schema':'bw.dos-package-pty.inputs.v1','firmware':{'bios':r.BIOS,'vga':r.VGA},**{k:{'path':'inputs/'+k+'.zip','bytes':len(v),'sha256':r.sha(v),'members':r.stored_input(v,k=='malformed')} for k,v in inputbytes.items()}}
     resources={'schema':'bw.dos-package-pty.resources.v1','caps':copy.deepcopy(r.CAPS),'controller':{'pid':900,'before':snap(20,900),'after':snap(20,900,after=True)},'cases':{},'enclosing':{'before':snap(10,populated=1),'after':snap(10,populated=0,after=True)}}
     packet={'source.before.json':encode(source),'source.after.json':encode(source),'runtime.json':encode(runtime),'inputs.json':encode(inputs),**{'inputs/'+k+'.zip':v for k,v in inputbytes.items()}}
     for i,case in enumerate(r.CASES):
      resources['cases'][case]={'before':snap(30+i),'after':snap(30+i,after=True)}
      start=1000000000*(i+1);pid=1001+i
      proc={'schema':'bw.dos-package-pty.process.v1','case':case,'argv':r.expected_argv(case,'/fixture/node'),'cwdRole':'checkout','environmentPolicy':r.ENVIRONMENT,'pid':pid,'pgid':pid,'startTimeTicks':100+i,'spawnMonoNs':start,'reapMonoNs':start+100,'returncode':0 if case in ('a','b') else 1,'signal':None,'rusage':{'userSeconds':0.1,'systemSeconds':0.01,'maxRssKiB':100},'groupEmpty':True,'firstFailure':None,'secondary':[],'waitStatus':0 if case in ('a','b') else 256}
      before=[0,5,0,11,15,15,[0]*32];rawmode=[0,5,0,0,15,15,[0]*32]
      ev={'schema':'bw.dos-package-pty.events.v1','case':case,'events':[],'termios':{'before':before,'raw':None if case=='malformed' else rawmode,'after':copy.deepcopy(before)}}
      if case=='malformed':
       raw=r.ERROR.encode()+b'\r\n';ev['events']=[{'seq':0,'monoNs':start+101,'kind':'read','offset':0,'bytes':len(raw)}]
      else:
       pre=['\u00a3']+['']*24
       prefix=r.START+frame(pre)+frame(['BW-PKG-R']+['']*24)+frame(r.READY)
       data=bytes.fromhex('1b5b4961' if case=='a' else '1b5b4962' if case=='b' else '1b5b4f')
       tail=(frame(r.RESPONSES[case]) if case in ('a','b') else frame(r.READY))+r.END
       raw=prefix+tail
       ev['events']=[{'seq':0,'monoNs':start+10,'kind':'read','offset':0,'bytes':len(prefix)}, {'seq':1,'monoNs':start+20,'kind':'write','hex':data.hex(),'written':len(data)}, {'seq':2,'monoNs':start+101,'kind':'read','offset':len(prefix),'bytes':len(tail)}]
       report={'schema':'bw.dos-package-run.v1','target':'i80386-at-functional-ordinary','packageSha256':inputs['authored']['sha256'],'config':{'path':'pkg/dosbox.conf','sha256':r.sha(r.CONFIG)},'media':{'path':'pkg/disks/boot.img','sha256':r.sha(r.BOOT),'byteLength':512,'geometry':{'cylinders':1,'heads':1,'sectors':1}},'firmware':{'biosSha256':r.BIOS['sha256'],'vgaSha256':r.VGA['sha256']},'budgets':{'steps':50000000,'wallMs':120000},'steps':50000000 if case in ('a','b') else 1000000,'stop':'budget' if case in ('a','b') else 'refused','refused':None if case in ('a','b') else r.FOCUS_ERROR,'input':{'bytes':4,'delivered':[{'step':100000//1024*1024,'code':30 if case=='a' else 48},{'step':(100000//1024+64)*1024,'code':158 if case=='a' else 176}],'pendingScanBytes':0} if case in ('a','b') else {'bytes':3,'delivered':[],'pendingScanBytes':0},'serial':{'text':'','truncated':False},'text':r.RESPONSES[case] if case in ('a','b') else r.READY,'cpu':{'cs':0,'eip':0x7c5b,'cr0':0},'snapshotComplete':True,'secondaryErrors':[],'terminal':{'started':True,'restorationAttempted':True,'restorationComplete':True},'guestCompletionQualified':False}
       packet[case+'/report.json']=encode(report)
      ev['events'].append({'seq':len(ev['events']),'monoNs':start+102,'kind':'wait','returncode':proc['returncode'],'signal':None})
      packet[case+'/process.json']=encode(proc);packet[case+'/events.json']=encode(ev);packet[case+'/pty.raw']=raw
     packet['resources.json']=encode(resources)
     audit={'schema':'bw.dos-package-pty.audit.v1','head':source['head'],'sourceTree':source['tree'],'workflowSha256':files['.github/workflows/dos-package-acceptance.yml']['sha256'],'roles':[],'cases':list(r.CASES),'firstFailure':None,'secondary':[]};packet['audit.json']=encode(audit)
     external={'official':{'repository':'CrispStrobe/bw-board','workflowPath':'.github/workflows/dos-package-acceptance.yml','workflowSha256':audit['workflowSha256'],'runId':1,'attempt':1,'event':'pull_request','eventAction':'labeled','head':source['head'],'label':'x86-dos-package-actual','jobId':2,'jobName':'actual','conclusion':'success','artifactId':3,'artifactBytes':0,'artifactSha256':'0'*64,'requiredSteps':{'Bounded four fresh package cases':'success','Owned controller terminal and empty':'success','Retain original evidence':'success'},'enclosingCleanupSuccess':True},'source':{k:source[k] for k in ('head','tree','files')},'runtime':runtime}
     return packet,external
    def pack(packet,external):
     audit=json.loads(packet['audit.json']);audit['roles']=[{'path':p,'bytes':len(v),'sha256':r.sha(v)} for p,v in sorted(packet.items()) if p!='audit.json'];packet['audit.json']=encode(audit)
     bio=io.BytesIO()
     with zipfile.ZipFile(bio,'w',compression=zipfile.ZIP_DEFLATED) as z:
      for p,v in sorted(packet.items()):z.writestr(p,v)
     b=bio.getvalue();external['official']['artifactBytes']=len(b);external['official']['artifactSha256']=r.sha(b);return b
    def change(p,name,fn):
     obj=json.loads(p[name]);fn(obj);p[name]=encode(obj)
    p,e=fixture();b=pack(p,e);need(verify_artifact(b,e)['pass'] is True,'full manufactured packet positive')
    checks=[]
    def reject(name,fn):
     p,e=fixture();fn(p,e);b=pack(p,e)
     try:r.verify_artifact(b,e)
     except (r.Refusal,ValueError) as error:checks.append({'name':name,'result':'REFUSED','first':str(error)});return
     raise AssertionError('false acceptance: '+name)
    reject('wrong-real-input',lambda p,e:change(p,'a/events.json',lambda x:x['events'][1].update(hex='1b5b4962')))
    reject('wrong-response',lambda p,e:p.__setitem__('a/pty.raw',p['a/pty.raw'].replace(b'a;XOR5A=3B',b'b;XOR5A=38')))
    reject('no-complete-ready',lambda p,e:p.__setitem__('a/pty.raw',p['a/pty.raw'].replace(b'BW-PKG-READY',b'BW-PKG-STALE')))
    reject('missing-break',lambda p,e:change(p,'a/report.json',lambda x:x['input']['delivered'].pop()))
    reject('short-step-gap',lambda p,e:change(p,'a/report.json',lambda x:x['input']['delivered'][1].update(step=x['input']['delivered'][0]['step']+1024)))
    reject('pending-scan',lambda p,e:change(p,'a/report.json',lambda x:x['input'].update(pendingScanBytes=1)))
    reject('wall-stop',lambda p,e:change(p,'a/report.json',lambda x:x.update(stop='wall-budget')))
    reject('incomplete-budget',lambda p,e:change(p,'a/report.json',lambda x:x.update(steps=49999999)))
    reject('wrong-boolean-geometry',lambda p,e:change(p,'a/report.json',lambda x:x['media']['geometry'].update(heads=True)))
    reject('wrong-float-budget',lambda p,e:change(p,'a/report.json',lambda x:x['budgets'].update(steps=50000000.0)))
    reject('focus-admitted-scan',lambda p,e:change(p,'focus-loss/report.json',lambda x:x['input'].update(delivered=[{'step':0,'code':42}])))
    reject('focus-instead-key',lambda p,e:change(p,'focus-loss/events.json',lambda x:x['events'][1].update(hex='1b5b49')))
    reject('malformed-other-first-error',lambda p,e:p.__setitem__('malformed/pty.raw',b'DOS package refused: ZIP CRC mismatch\r\n'))
    reject('malformed-extra-report',lambda p,e:p.__setitem__('malformed/report.json',b'{}'))
    reject('case-not-empty',lambda p,e:change(p,'resources.json',lambda x:x['cases']['a']['after'].update(procs=[1001])))
    reject('enclosing-populated',lambda p,e:change(p,'resources.json',lambda x:x['enclosing']['after']['raw'].update(cgroupEvents='populated 1\nfrozen 0\n')))
    reject('new-OOM',lambda p,e:change(p,'resources.json',lambda x:x['enclosing']['after']['raw'].update(memoryEvents='low 0\nhigh 0\nmax 0\noom 1\noom_kill 0\noom_group_kill 0\n')))
    reject('cgroup-role-alias',lambda p,e:change(p,'resources.json',lambda x:[x['cases']['b'][k].update(identity=copy.deepcopy(x['cases']['a'][k]['identity'])) for k in ('before','after')]))
    reject('wrong-cpu-source',lambda p,e:change(p,'source.after.json',lambda x:x['files']['src/experimental/i80386.js'].update(sha256='9'*64)))
    reject('alternate-node-rehashed-external',lambda p,e:(change(p,'runtime.json',lambda x:x['versions'].update(node='v20.20.2')),e['runtime']['versions'].update(node='v20.20.2')))
    reject('nonattempt1',lambda p,e:e['official'].update(attempt=2))
    reject('restoration-uncertain',lambda p,e:change(p,'a/report.json',lambda x:x['terminal'].update(restorationComplete=False)))
    reject('external-termios-unrestored',lambda p,e:change(p,'a/events.json',lambda x:x['termios']['after'].__setitem__(3,0)))
    reject('wrong-wait4-status',lambda p,e:change(p,'a/process.json',lambda x:x.update(waitStatus=256)))
    reject('wrong-pgid',lambda p,e:change(p,'a/process.json',lambda x:x.update(pgid=1025)))
    reject('secondary-masked',lambda p,e:change(p,'a/report.json',lambda x:x['secondaryErrors'].append({'phase':'capture','name':'Error','message':'first'})))
    reject('wrong-input-byte-image',lambda p,e:p.__setitem__('inputs/authored.zip',p['inputs/authored.zip'][:181]+bytes([p['inputs/authored.zip'][181]^1])+p['inputs/authored.zip'][182:]))
    reject('unexpected-audit-field',lambda p,e:change(p,'audit.json',lambda x:x.update(ready=True)))
    # Cause/response ordering mutants keep every file and outer digest current.
    def pre_ready(p,e):
     def f(x):
      x['events'][0],x['events'][1]=x['events'][1],x['events'][0]
      for i,row in enumerate(x['events']):row['seq']=i;row['monoNs']=1000000010+i*20
     change(p,'a/events.json',f)
    reject('input-before-ready',pre_ready)
    def pre_input_response(p,e):
     def f(x):
      x['events'][0]['bytes']=len(p['a/pty.raw']);x['events'].pop(2)
      for i,row in enumerate(x['events']):row['seq']=i
     change(p,'a/events.json',f)
    reject('response-observed-before-input',pre_input_response)

    reject('accepted-before-ready',lambda p,e:change(p,'a/report.json',lambda x:[x['input']['delivered'][i].update(step=i*65536) for i in range(2)]))
    reject('focus-zero-ordinary-calls',lambda p,e:change(p,'focus-loss/report.json',lambda x:x.update(steps=0)))
    def response_regresses(p,e):
     extra=frame(r.READY)+frame(r.RESPONSES['a']);raw=p['a/pty.raw'];p['a/pty.raw']=raw[:-len(r.END)]+extra+r.END
     change(p,'a/events.json',lambda x:x['events'][2].update(bytes=x['events'][2]['bytes']+len(extra)))
    reject('authored-response-regresses',response_regresses)
    need(len(checks)==33,'public control count')
    return {'schema':'bw.dos-package-pty.reader-controls.v1','testOnly':True,'guestOrPtyExecuted':False,'fullPacketPositive':True,'fullyRehashedSemanticRefusals':checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact')
    parser.add_argument('--external-admission')
    parser.add_argument('--controls', action='store_true')
    args = parser.parse_args()
    if args.controls:
        need(args.artifact is None and args.external_admission is None, 'controls and original modes are separate')
        print(json.dumps(run_controls(), sort_keys=True, separators=(',', ':')))
        return
    need(args.artifact is not None and args.external_admission is not None, 'original artifact and external admission required')
    artifact_path = Path(args.artifact)
    need(artifact_path.is_file() and not artifact_path.is_symlink() and
         0 < artifact_path.stat().st_size <= CAPS['packetBytes'], 'retained artifact regular/extent')
    admission_path = Path(args.external_admission)
    need(admission_path.is_file() and not admission_path.is_symlink() and
         0 < admission_path.stat().st_size <= 4194304, 'external admission regular/extent')
    result = verify_artifact(artifact_path.read_bytes(), json_bytes(admission_path.read_bytes()))
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))


if __name__ == '__main__':
    main()
