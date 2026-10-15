#!/usr/bin/env python3
"""Independent raw-HDD packet consistency reader; no producer imports."""
"""Independent causal byte checker; outer acceptance is separate."""
import hashlib
import json
import math
import re

RAW_CAP = 16 * 1024 * 1024
JSON_CAP = 4 * 1024 * 1024
POLICY = {'stepLimit': 120000000, 'stabilitySteps': 1500000, 'childWallSeconds': 600}
OPEN = b'\x1b[?1049h\x1b[?25l\x1b[?1003h\x1b[?1006h\x1b[?1004h'
CLOSE = b'\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?25h\x1b[?1049l'
FRAME, END = b'\x1b[H\x1b[2J', b'\x1b[0m'
COMMANDS = {'enter': b'\r', 'decline': b'n\r',
            'write': b'echo bw-hdd-persist-ok>c:\\bwkeep.txt\r',
            'read': b'type c:\\bwkeep.txt\r', 'quit': b'\x1d'}
# Independently authored US Set-1 format, not imported from the terminal producer.
KEYS = dict(zip('qwertyuiop', range(16, 26)))
KEYS.update(zip('asdfghjkl', range(30, 39)))
KEYS.update(zip('zxcvbnm', range(44, 51)))
KEYS.update({'-': 12, '.': 52, '\\': 43, ' ': 57, ';': 39, '\r': 28})
TOP = set('schema executionRevision sourceSha256 inputs steps stop refusal cpu machineCycles nativeStats code16WasmStats code16LoadExecutions delivered serial ramSha256 diskSha256 textRam vga hddOutput'.split())
INPUTS = set('bios vga hdd geometry cmosType floppy expandedGroupedAdmission registerStackAdmission nativeBlocks code16Loads code16Wasm cmosEquipment events mouseEnabled dosboxConfig'.split())
OFFER = set('offerOrdinal frameOrdinal frameStep rawBytesSeen elapsedNs bytesHex writtenBytes'.split())
UNIMPLEMENTED = ['full-nested-report', 'official-original', 'source-runtime-media',
                 'process-exit-reap-eof-cleanup', 'cross-session-output-input', 'disk-bytes-and-fresh-reload']

class Refusal(ValueError):
    pass

def need(value, code):
    if not value:
        raise Refusal(code)

def integer(value, minimum=0, maximum=2**53-1):
    return type(value) is int and minimum <= value <= maximum

def keys(value, names, code):
    need(type(value) is dict and set(value) == names, code)

def digest(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{64}', value) is not None

def sha(value):
    return hashlib.sha256(value).hexdigest()

def scan_codes(command):
    output = []
    for char in command.decode('ascii'):
        if char == '\x1d':
            continue
        shifted = char in '>:'
        code = KEYS[{'>': '.', ':': ';'}.get(char, char)]
        if shifted:
            output.append(42)
        output.extend((code, code | 128))
        if shifted:
            output.append(170)
    return output

SCANS = {name: scan_codes(command) for name, command in COMMANDS.items()}
GOLDEN_SOURCE_SHA256 = 'e9f5c1d859a01f55aef0ba2406b185316fcbdf26067f187a4a021d74c1d75bd0'
GOLDEN_HEX = {'enter': '1c9c', 'decline': '31b11c9c', 'write': '12922eae23a3189839b930b011910c8c23a320a020a00c8c1999129213931f9f17971f9f14940c8c189825a52a34b4aa2eae2a27a7aa2bab30b0119125a512921292199934b414942dad14941c9c', 'read': '149415951999129239b92eae2a27a7aa2bab30b0119125a512921292199934b414942dad14941c9c', 'quit': ''}
need({name: bytes(codes).hex() for name,codes in SCANS.items()} == GOLDEN_HEX, 'golden-pin')

def parse_json(raw):
    need(type(raw) is bytes and len(raw) <= JSON_CAP, 'json-byte-cap')
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        raise Refusal('json-utf8')
    depth = 0
    quoted = escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in '[{':
            depth += 1
            need(depth <= 32, 'json-depth')
        elif char in ']}':
            depth -= 1
            need(depth >= 0, 'json-syntax')
    def pairs(rows):
        output = {}
        for key, value in rows:
            need(key not in output, 'json-duplicate-key')
            output[key] = value
        return output
    def constant(_):
        raise Refusal('json-nonfinite')
    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, RecursionError) as error:
        if isinstance(error, Refusal):
            raise
        raise Refusal('json-syntax')
    pending, nodes = [value], 0
    while pending:
        item = pending.pop()
        nodes += 1
        need(nodes <= 200000, 'json-node-cap')
        if type(item) is dict:
            pending.extend(item.keys())
            pending.extend(item.values())
        elif type(item) is list:
            pending.extend(item)
        elif type(item) is str:
            try:
                need(len(item.encode('utf-8')) <= 1048576, 'json-string-cap')
            except UnicodeEncodeError:
                raise Refusal('json-string-unicode')
        elif type(item) in (int, float):
            need(abs(item) <= 2**53-1 and (type(item) is int or math.isfinite(item)), 'json-number')
    return value

def parse_frames(raw):
    need(type(raw) is bytes and len(raw) <= RAW_CAP, 'pty-byte-cap')
    need(raw.startswith(OPEN), 'terminal-open')
    cursor, frames, last = len(OPEN), [], -1
    while not raw.startswith(CLOSE, cursor):
        need(raw.startswith(FRAME, cursor), 'frame-start')
        end = raw.find(END, cursor + len(FRAME))
        need(end >= 0 and end-cursor <= 16384, 'frame-tail')
        body = raw[cursor+len(FRAME):end].replace(b'\r\n', b'\n')
        need(b'\r' not in body, 'frame-cr')
        try:
            text = body.decode('utf-8',errors='strict')
        except UnicodeDecodeError as error:
            raise Refusal('frame-utf8') from error
        text_lines = text.split('\n')
        need(len(text_lines) == 26 and all(len(row) == 80 for row in text_lines[1:]), 'frame-shape')
        need(all(32 <= ord(char) <= 126 or 160 <= ord(char) <= 255 for row in text_lines[1:] for char in row), 'frame-text-envelope')
        lines = body.split(b'\n')
        match = re.fullmatch(rb'386 AT  step ([0-9]{1,9})/([0-9]{1,9})  text RAM  Ctrl-\] quit  Ctrl-L redraw', lines[0])
        need(match is not None, 'frame-header')
        step, limit = map(int, match.groups())
        need(limit == POLICY['stepLimit'] and last <= step <= limit, 'frame-budget-or-step')
        last = step
        frames.append({'ordinal': len(frames)+1, 'step': step, 'start': cursor,
                       'end': end+len(END), 'rows': [row.rstrip(' ') for row in text_lines[1:]]})
        need(len(frames) <= 4096, 'frame-count')
        cursor = end + len(END)
    need(frames and cursor+len(CLOSE) == len(raw), 'terminal-close-or-trailing')
    return frames

def report_selected(report):
    keys(report, TOP, 'report-keys')
    need(report['schema'] == 'bw.i80386-at-console.v1', 'report-schema')
    need(type(report['executionRevision']) is str and re.fullmatch('[0-9a-f]{40}', report['executionRevision']), 'report-revision-shape')
    for field in ['sourceSha256', 'cpu', 'vga', 'serial']:
        need(type(report[field]) is dict, 'report-opaque-shape')
    need(type(report['textRam']) is list, 'report-opaque-shape')
    for field in ['ramSha256', 'diskSha256']:
        need(digest(report[field]), 'report-digest-shape')
    inputs = report['inputs']
    keys(inputs, INPUTS, 'input-keys')
    for field in ['expandedGroupedAdmission', 'registerStackAdmission', 'nativeBlocks', 'code16Loads', 'code16Wasm']:
        need(inputs[field] is False, 'ordinary-input-flags')
    need(inputs['events'] == sha(b'[]') and inputs['mouseEnabled'] is True and inputs['dosboxConfig'] is None, 'ordinary-input-context')
    need(report['nativeStats'] is None and report['code16WasmStats'] is None and type(report['code16LoadExecutions']) is int and report['code16LoadExecutions'] == 0, 'ordinary-backend')
    need(integer(report['steps'], 0, POLICY['stepLimit']-1) and report['stop'] == 'user-quit' and report['refusal'] is None, 'report-stop')
    need(integer(report['machineCycles']), 'report-machine-counter')
    out = report['hddOutput']
    keys(out, set('schema drive input output complete guestCompletionQualified'.split()), 'hdd-output-keys')
    need(out['schema'] == 'bw.i80386-master-hdd-output.v1' and out['drive'] == 'master' and out['complete'] is True and out['guestCompletionQualified'] is False, 'hdd-output-status')
    for role in ['input', 'output']:
        row = out[role]
        keys(row, {'sha256','byteLength','geometry'} | ({'boundary'} if role == 'output' else set()), 'hdd-role-keys')
        need(digest(row['sha256']) and type(row['byteLength']) is int and row['byteLength'] == 10653696, 'hdd-role-extent-or-digest')
        keys(row['geometry'], {'cylinders','heads','sectors'}, 'hdd-geometry')
        need(all(type(row['geometry'][key]) is int and row['geometry'][key] == value for key,value in {'cylinders':306,'heads':4,'sectors':17}.items()), 'hdd-geometry')
    boundary = out['output']['boundary']
    keys(boundary, {'cpuCycles','machineCycles'}, 'hdd-boundary')
    need(all(integer(value) for value in boundary.values()), 'hdd-boundary')
    need(inputs['hdd'] == out['input']['sha256'] and report['diskSha256'] == out['output']['sha256'], 'hdd-report-join')

def prompt_after(rows, position):
    return any(row == 'A:\\>' for row in rows[position+1:])

def response(frame, name):
    rows = frame['rows']
    if name == 'enter':
        return any('Do you want to proceed' in row for row in rows)
    if name == 'decline':
        return any(re.fullmatch(r'The installation of FreeDOS 1\.4 has been aborted\.', row, re.I) and prompt_after(rows,index) for index,row in enumerate(rows))
    command = 'A:\\>' + COMMANDS[name].decode('ascii').rstrip('\r')
    echoes = [index for index,row in enumerate(rows) if row.lower() == command.lower()]
    if not echoes:
        return False
    if name == 'write':
        return prompt_after(rows, echoes[-1])
    return any(index > echoes[-1] and row == 'bw-hdd-persist-ok' and prompt_after(rows,index) for index,row in enumerate(rows))

def _causal_audit(raw, report_raw, ledger_raw, writer, policy, expected_sha256):
    need(type(writer) is bool, 'writer-admission')
    keys(policy, set(POLICY), 'policy-keys')
    need(all(type(policy[key]) is int and policy[key] == value for key,value in POLICY.items()), 'policy-values')
    keys(expected_sha256, {'pty','report','ledger'}, 'role-hash-keys')
    for name, data, cap in [('pty',raw,RAW_CAP),('report',report_raw,JSON_CAP),('ledger',ledger_raw,JSON_CAP)]:
        need(type(data) is bytes and len(data) <= cap, name+'-byte-cap')
        need(digest(expected_sha256[name]) and sha(data) == expected_sha256[name], name+'-hash')
    frames = parse_frames(raw)
    report, ledger = parse_json(report_raw), parse_json(ledger_raw)
    report_selected(report)
    need(all(frame['step'] <= report['steps'] for frame in frames), 'frame-after-final-report-step')
    keys(ledger, {'schema','writer','offers'}, 'ledger-keys')
    need(ledger['schema'] == 'bw.hdd-session-input.v1' and type(ledger['writer']) is bool and ledger['writer'] == writer, 'ledger-writer')
    offers = ledger['offers']
    need(type(offers) is list and len(offers) in ([4,5] if writer else [3,4]), 'offer-count')
    menu = len(offers) == (5 if writer else 4)
    names = (['enter'] if menu else []) + ['decline'] + (['write'] if writer else []) + ['read','quit']
    last_elapsed, last_ordinal = -1, 0
    for index,(offer,name) in enumerate(zip(offers,names),1):
        keys(offer, OFFER, 'offer-keys')
        need(type(offer['offerOrdinal']) is int and offer['offerOrdinal'] == index, 'offer-order')
        need(integer(offer['frameOrdinal'],1,len(frames)) and offer['frameOrdinal'] > last_ordinal, 'offer-frame-order')
        frame = frames[offer['frameOrdinal']-1]
        need(integer(offer['frameStep']) and offer['frameStep'] == frame['step'], 'offer-frame-step')
        need(integer(offer['rawBytesSeen'],frame['end'],len(raw)-len(CLOSE)) and not any(f['end'] <= offer['rawBytesSeen'] for f in frames[offer['frameOrdinal']:]), 'offer-raw-boundary')
        need(integer(offer['elapsedNs'],0,POLICY['childWallSeconds']*10**9) and offer['elapsedNs'] >= last_elapsed, 'offer-elapsed')
        need(offer['bytesHex'] == COMMANDS[name].hex() and type(offer['writtenBytes']) is int and offer['writtenBytes'] == len(COMMANDS[name]), 'offer-command')
        if name in ('read','write'):
            echo = 'A:\\>'+COMMANDS[name].decode().rstrip('\r')
            need(not any(row.lower() == echo.lower() for row in frame['rows']), 'offer-stale-echo')
        if name == 'enter':
            need(any(re.search(r'press \[ENTER\]|Select from Menu',row,re.I) for row in frame['rows']), 'offer-menu')
        if name == 'decline':
            need(any('Do you want to proceed' in row for row in frame['rows']), 'offer-confirmation')
        last_elapsed, last_ordinal = offer['elapsedNs'], offer['frameOrdinal']
    delivered = report['delivered']
    expected_codes = [code for name in names for code in SCANS[name]]
    need(type(delivered) is list and len(delivered) == len(expected_codes), 'delivered-count')
    last_step = -1024
    for row,code in zip(delivered,expected_codes):
        keys(row, {'step','type','code','accepted'}, 'delivered-keys')
        need(row['type'] == 'live-key' and row['accepted'] is True and type(row['code']) is int and row['code'] == code, 'delivered-code')
        need(integer(row['step'],0,report['steps']) and row['step'] % 1024 == 0 and row['step']-last_step >= 1024, 'delivered-step')
        last_step = row['step']
    offset = 0
    for index,(offer,name) in enumerate(zip(offers,names)):
        codes = SCANS[name]
        if not codes:
            continue
        scans = delivered[offset:offset+len(codes)]
        offset += len(codes)
        need(scans[0]['step'] >= offer['frameStep'], 'delivery-before-offer')
        next_offer = offers[index+1]
        target = frames[next_offer['frameOrdinal']-1]
        need(target['start'] >= offer['rawBytesSeen'] and target['step'] > scans[-1]['step'], 'response-before-final-scan')
        need(response(target,name), 'response-content')
        if name in ('write','read'):
            candidate = None
            for frame in frames[offer['frameOrdinal']:next_offer['frameOrdinal']]:
                valid = frame['start'] >= offer['rawBytesSeen'] and frame['step'] > scans[-1]['step'] and response(frame,name)
                if not valid:
                    candidate = None
                elif candidate is None or candidate['rows'] != frame['rows']:
                    candidate = frame
            need(candidate is not None and target['rows'] == candidate['rows'] and target['step']-candidate['step'] >= POLICY['stabilitySteps'], 'response-stability')
    need(report['steps'] >= frames[offers[-1]['frameOrdinal']-1]['step'], 'quit-after-report')
    return {'schema':'bw.hdd-causal-consistency.v1','causalConsistencyPass':True,
            'fullAcceptanceQualified':False,'writer':writer,'frameCount':len(frames),
            'deliveredScans':len(delivered),'hostOutputRequired':True,'unimplementedGates':UNIMPLEMENTED}

def causal_audit(raw, report_raw, ledger_raw, writer, policy, expected_sha256):
    try:
        return _causal_audit(raw,report_raw,ledger_raw,writer,policy,expected_sha256)
    except Refusal as error:
        return {'causalConsistencyPass':False,'fullAcceptanceQualified':False,'failure':str(error)}

# Reviewed disk V2 byte proof, integrated without filesystem/CLI entrypoint.
#!/usr/bin/env python3
"""Independent disk-byte proof only; no guest/runtime/official-original admission."""
import argparse
import hashlib
import json
import os
import re
import stat
import struct

SIZE = 10653696
SECTOR = 512
FAT_BYTES = 41 * SECTOR
FAT1, FAT2, ROOT, DATA = (n * SECTOR for n in (18, 59, 100, 132))
CLUSTER_BYTES, LAST_CLUSTER = 1024, 10339
OLD_NAME = b'CMOUNTOKTXT'
OLD_DATA = b'FREE-BIOS 386 C: MOUNT OK\r\n'
NEW_NAME = b'BWKEEP  TXT'
NEW_DATA = b'bw-hdd-persist-ok\r\n'

class DiskRefusal(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def require(condition, code):
    if not condition:
        raise DiskRefusal(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def u16(data, offset):
    return struct.unpack_from('<H', data, offset)[0]

def u32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]

def admission(data, expected, role):
    require(type(data) is bytes and len(data) == SIZE, role + '-extent')
    require(type(expected) is str and re.fullmatch('[0-9a-f]{64}', expected) is not None, role + '-sha-admission')
    require(sha(data) == expected, role + '-sha-mismatch')

def headers():
    """Closed authored format, derived independently from its fixed CHS/BPB."""
    mbr = bytearray(512)
    # LBA17 is C0/H1/S1; final LBA20807 is C305/H3/S17.
    mbr[446:454] = bytes((0x80, 1, 1, 0, 6, 3, 0x51, 0x31))
    struct.pack_into('<II', mbr, 454, 17, 20791)
    mbr[510:512] = b'\x55\xaa'
    bpb = bytearray(512)
    bpb[:11] = b'\xeb\x3c\x90ASTRA386'
    struct.pack_into('<H', bpb, 11, 512)
    bpb[13] = 2
    struct.pack_into('<H', bpb, 14, 1)
    bpb[16] = 2
    struct.pack_into('<HH', bpb, 17, 512, 20791)
    bpb[21] = 0xf8
    struct.pack_into('<HHHII', bpb, 22, 41, 17, 4, 17, 0)
    bpb[36], bpb[38] = 0x80, 0x29
    struct.pack_into('<I', bpb, 39, 0x386d0019)
    bpb[43:54] = b'FREEBIOSHD '
    bpb[54:62] = b'FAT16   '
    bpb[510:512] = b'\x55\xaa'
    return bytes(mbr), bytes(bpb)

def initial_proof(data):
    mbr, bpb = headers()
    require(data[:512] == mbr, 'initial-mbr')
    require(data[17*512:18*512] == bpb, 'initial-bpb')
    fat = bytearray(FAT_BYTES)
    struct.pack_into('<HHH', fat, 0, 0xfff8, 0xffff, 0xffff)
    require(data[FAT1:FAT1+FAT_BYTES] == data[FAT2:FAT2+FAT_BYTES], 'initial-fat-mirror')
    require(data[FAT1:FAT1+FAT_BYTES] == fat, 'initial-fat-closed-chain')
    entry = bytearray(32)
    entry[:11], entry[11] = OLD_NAME, 0x20
    struct.pack_into('<HI', entry, 26, 2, len(OLD_DATA))
    require(data[ROOT:ROOT+32] == entry, 'initial-root-old-entry')
    require(not any(data[ROOT+32:DATA]), 'initial-root-census')
    require(data[DATA:DATA+len(OLD_DATA)] == OLD_DATA, 'initial-old-data')
    require(not any(data[512:17*512]), 'initial-reserved-track')
    require(not any(data[DATA+len(OLD_DATA):]), 'initial-data-slack-or-tail')
    return bytes(entry)

def verify_disks(initial, exported, initial_sha256, exported_sha256, readback=None, readback_sha256=None):
    admission(initial, initial_sha256, 'initial')
    admission(exported, exported_sha256, 'exported')
    old_entry = initial_proof(initial)
    require(exported[FAT1:FAT1+FAT_BYTES] == exported[FAT2:FAT2+FAT_BYTES], 'exported-fat-mirror')
    require(exported[ROOT:ROOT+32] == old_entry, 'exported-old-entry')
    occupied = [(o, exported[o:o+32]) for o in range(ROOT+32, DATA, 32) if any(exported[o:o+32])]
    require(len(occupied) == 1, 'exported-root-census')
    slot, entry = occupied[0]
    require(slot == ROOT+32, 'exported-entry-hidden-after-directory-end')
    require(entry[:11] == NEW_NAME and entry[11] == 0x20 and entry[12] == 0 and entry[20:22] == b'\0\0', 'exported-new-entry')
    require(u32(entry, 28) == len(NEW_DATA), 'exported-marker-size')
    cluster = u16(entry, 26)
    require(2 <= cluster <= LAST_CLUSTER and cluster != 2, 'exported-cluster-range-or-old-alias')
    require(u16(initial, FAT1+cluster*2) == 0, 'exported-cluster-not-initially-free')
    require(0xfff8 <= u16(exported, FAT1+cluster*2) <= 0xffff, 'exported-cluster-not-eoc')
    payload = DATA+(cluster-2)*CLUSTER_BYTES
    require(exported[payload:payload+len(NEW_DATA)] == NEW_DATA, 'exported-marker-bytes')
    allowed = [(slot, slot+32, 'new-root-entry'), (FAT1+cluster*2, FAT1+cluster*2+2, 'fat1-eoc'),
               (FAT2+cluster*2, FAT2+cluster*2+2, 'fat2-eoc'), (payload, payload+len(NEW_DATA), 'marker-payload')]
    changes, ranges = 0, []
    for offset, (a, b) in enumerate(zip(initial, exported)):
        if a == b:
            continue
        category = next((name for start, end, name in allowed if start <= offset < end), None)
        require(category is not None, 'exported-byte-outside-allowlist')
        changes += 1
        if ranges and ranges[-1]['endExclusive'] == offset and ranges[-1]['category'] == category:
            ranges[-1]['endExclusive'] += 1
        else:
            require(len(ranges) < 128, 'difference-range-cap')
            ranges.append({'start': offset, 'endExclusive': offset+1, 'category': category})
    if readback is not None or readback_sha256 is not None:
        admission(readback, readback_sha256, 'readback')
        require(readback_sha256 == exported_sha256 and readback == exported, 'readback-exported-identity')
    return {'schema': 'bw.i80386-hdd-disk-bytes.v1', 'diskBytesPass': True,
            'fullAcceptanceQualified': False, 'initialSha256': initial_sha256,
            'exportedSha256': exported_sha256, 'byteLength': SIZE, 'geometry': {'cylinders':306,'heads':4,'sectors':17},
            'newFile': {'shortName':'BWKEEP  TXT','byteLength':len(NEW_DATA),'sha256':sha(NEW_DATA),'cluster':cluster,
                        'rawTimestampFields': {'13to19':entry[13:20].hex(),'22to25':entry[22:26].hex()}},
            'changedBytes': changes, 'differenceRanges': ranges, 'readbackIdentityChecked': readback is not None}

# Reviewed cross-session V1 joins.
ROLES = {'readerLedger', 'writerReport', 'writerExport', 'readerPty', 'readerReport', 'readerExport', 'writerLedger', 'writerPty', 'initial'}
GEOMETRY = {'cylinders': 306, 'heads': 4, 'sectors': 17}

def cross_audit(roles, expected_sha256, policy):
 need(type(roles) is dict and set(roles)==ROLES,'role-set')
 need(type(expected_sha256) is dict and set(expected_sha256)==ROLES,'role-hash-set')
 for name in sorted(ROLES):
  cap=SIZE if name in {'initial','writerExport','readerExport'} else (16*1024*1024 if name.endswith('Pty') else 4*1024*1024)
  data=roles[name];digest=expected_sha256[name]
  need(type(data) is bytes and len(data)<=cap,'role-cap-'+name)
  need(type(digest) is str and len(digest)==64 and all(c in '0123456789abcdef' for c in digest),'role-sha-syntax-'+name)
  need(sha(data)==digest,'role-sha-'+name)
 for name in ['initial','writerExport','readerExport']:need(len(roles[name])==SIZE,'disk-extent-'+name)
 results={};reports={}
 for arm,writer in [('writer',True),('reader',False)]:
  mapping={'pty':arm+'Pty','report':arm+'Report','ledger':arm+'Ledger'}
  result=causal_audit(*(roles[mapping[k]] for k in ['pty','report','ledger']),writer,policy,
                      {k:expected_sha256[v] for k,v in mapping.items()})
  need(result['causalConsistencyPass'],arm+'-causal:'+result.get('failure','unknown'))
  results[arm]=result
  reports[arm]=parse_json(roles[arm+'Report'])
 # Reader child has no guest writer command. Its host output must be an exact fresh readback copy.
 need(roles['readerExport']==roles['writerExport'],'reader-export-byte-identity')
 w,r=reports['writer'],reports['reader']
 for arm,report,input_role,output_role in [('writer',w,'initial','writerExport'),('reader',r,'writerExport','readerExport')]:
  inp,out=report['hddOutput']['input'],report['hddOutput']['output']
  need(report['inputs']['hdd']==expected_sha256[input_role] and inp['sha256']==expected_sha256[input_role],arm+'-input-role-join')
  need(out['sha256']==expected_sha256[output_role] and report['diskSha256']==expected_sha256[output_role],arm+'-output-role-join')
  for row in [inp,out]:
   need(type(row['byteLength']) is int and row['byteLength']==SIZE,arm+'-extent-join')
   need(type(row['geometry']) is dict and set(row['geometry'])==set(GEOMETRY) and all(type(row['geometry'][k]) is int and row['geometry'][k]==v for k,v in GEOMETRY.items()),arm+'-geometry-join')
  need(report['inputs']['geometry']==[306,4,17] and all(type(n) is int for n in report['inputs']['geometry']),arm+'-input-geometry-join')
 try:
  proof=verify_disks(roles['initial'],roles['writerExport'],expected_sha256['initial'],expected_sha256['writerExport'],roles['readerExport'],expected_sha256['readerExport'])
 except DiskRefusal as e: raise Refusal('disk:'+e.code) from e
 need(proof['diskBytesPass'],'disk-proof')
 return {'schema':'bw.hdd-cross-session-consistency.v1','crossSessionConsistencyPass':True,
         'fullAcceptanceQualified':False,'roleSha256':dict(expected_sha256),'causal':results,'disk':proof,
         'unimplementedGates':['full-nested-report','official-original','complete-source-runtime-media-admission','owned-process-exit-reap-eof-cleanup']}

# V5 packet roles and selected outer-record admission. These are declarations until
# joined to independently supplied expected originals; names never grant authority.
PACKET_CAPS = dict(zip('admission.json source-before.json source-after.json runtime-before.json runtime-after.json media-before.json media-between.json media-after.json result.json initial.img first.img second.img'.split(),[65536,262144,262144,262144,262144,16384,16384,16384,65536,SIZE,SIZE,SIZE]))
for _child in (1,2):
    for _name,_cap in [('report.json',JSON_CAP),('pty.bin',RAW_CAP),('stderr.bin',65536),('offers.json',16384),('lifecycle.json',262144),('frames.json',8388608)]:
        PACKET_CAPS[f'child{_child}/{_name}']=_cap
PACKET_CAPS['index.json']=65536
FIXED_MEDIA = {'bios':(65536,'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),'vga':(38400,'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'),'floppy':(1228800,'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'),'initial':(SIZE,'2fa9c252f22cec4f8c5bdc82d1587293ffcaed791e0982384628d19a7316a851')}
COMMON_SOURCE_PATHS=set(['scripts/i80386-hdd-export/'+n for n in ['probe.mjs','probe.py','reader.py','controls.py','README.md']]+['.github/workflows/i80386-hdd-export.yml','scripts/lib/i80386-free-bios-fat16.mjs','scripts/lib/i80386-source-inventory.mjs','package.json'])
POLICY_DIGESTS={'resourcePolicySha256':'972033e74a72326a9cd62aae27c3ecfafab4177d39654644d5c57b73c3038dba','runtimeIdentityPolicySha256':'44e2e9586ba0e16010242e0fd32b031a7b04f30071cb80cfd7a62abeeedf70ce','protocolSha256':'dc805d09aaff86c28bfd407df9d28570a551a02aaa4d9ce7818ce0c58c57138e'}
ACTIONS = {'checkoutAction':'11d5960a326750d5838078e36cf38b85af677262','setupNodeAction':'49933ea5288caeca8642d1e84afbd3f7d6820020','uploadAction':'ea165f8d65b6e75b540449e92b4886f43607fa02'}

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')

def hex40(value):
    return type(value) is str and re.fullmatch('[0-9a-f]{40}',value) is not None

def source_record(value):
    keys(value,{'schema','head','tree','rows'},'source-record-keys')
    need(value['schema']=='bw.hdd-cli-source.v1' and hex40(value['head']) and hex40(value['tree']),'source-record-identity')
    rows=value['rows'];need(type(rows) is list and 79<=len(rows)<=512,'source-row-count')
    paths=[]
    for row in rows:
        keys(row,{'path','gitBlob','byteLength','sha256'},'source-row-keys')
        path=row['path'];need(type(path) is str and path and not path.startswith('/') and all(c not in ('','.','..') for c in path.split('/')),'source-path')
        need(hex40(row['gitBlob']) and digest(row['sha256']) and integer(row['byteLength'],0,4*1024*1024),'source-row-identity')
        paths.append(path)
    need(len(set(paths))==len(paths) and paths==sorted(paths),'source-row-census')

def selected_report(report, head, console_map):
    report_selected(report)
    need(report['executionRevision']==head and report['sourceSha256']==console_map and len(console_map)==79,'report-source-map')
    cpu=report['cpu'];keys(cpu,set('cs eip cr0 cr3 cr4 eflags cycles instructionSnapshot'.split()),'cpu-fields')
    need(integer(cpu['cs'],0,65535) and all(integer(cpu[k],0,0xffffffff) for k in ['eip','cr0','cr3','cr4','eflags']) and integer(cpu['cycles']) and type(cpu['instructionSnapshot']) is dict,'cpu-scalars')
    need(integer(report['machineCycles']),'machine-counter')
    need(report['hddOutput']['output']['boundary']=={'cpuCycles':cpu['cycles'],'machineCycles':report['machineCycles']},'export-report-counter-join')
    keys(report['serial'],{'bytes','text'},'serial-fields')
    need(integer(report['serial']['bytes'],0,65536) and type(report['serial']['text']) is str and len(report['serial']['text'])<=65536,'serial-values')
    need(type(report['textRam']) is list and len(report['textRam'])==25 and all(type(s) is str and len(s)<=160 for s in report['textRam']),'text-ram')
    keys(report['vga'],{'registers','planeSha256','snapshotPath'},'vga-fields')
    need(type(report['vga']['registers']) is dict and type(report['vga']['planeSha256']) is list and len(report['vga']['planeSha256'])==4 and all(digest(x) for x in report['vga']['planeSha256']) and report['vga']['snapshotPath'] is None,'vga-values')
    inp=report['inputs'];need(inp['bios']==FIXED_MEDIA['bios'][1] and inp['vga']==FIXED_MEDIA['vga'][1] and type(inp['cmosType']) is int and inp['cmosType']==47 and type(inp['cmosEquipment']) is int and inp['cmosEquipment']==5,'input-fixed-media')
    floppy=inp['floppy'];keys(floppy,{'sha256','byteLength','geometry','drive','cmosDriveType','bootOrder'},'floppy-fields')
    need(floppy['sha256']==FIXED_MEDIA['floppy'][1] and type(floppy['byteLength']) is int and floppy['byteLength']==1228800,'floppy-identity')
    keys(floppy['geometry'],{'cylinders','heads','sectors','bytesPerSector'},'floppy-geometry-fields')
    need(all(type(floppy['geometry'][k]) is int and floppy['geometry'][k]==v for k,v in {'cylinders':80,'heads':2,'sectors':15,'bytesPerSector':512}.items()),'floppy-geometry')
    need(all(type(floppy[k]) is int and floppy[k]==v for k,v in {'drive':0,'cmosDriveType':32,'bootOrder':33}.items()),'floppy-settings')

def runtime_record(value,head):
    keys(value,set('schema profile provenance rows sourceBuildAuthenticityQualified completeElfStdlibClosureQualified'.split()),'runtime-fields')
    need(value['schema']=='bw.hdd-cli-runtime.v2' and value['profile']=='hosted-observed-runtime-identity.v1' and value['sourceBuildAuthenticityQualified'] is False and value['completeElfStdlibClosureQualified'] is False,'runtime-profile')
    pro=value['provenance'];keys(pro,set('repository head workflowPath workflowBlob runId runAttempt jobId runnerName runnerImageOS runnerImageVersion checkoutAction setupNodeAction uploadAction'.split()),'runtime-provenance-fields')
    need(pro['repository']=='CrispStrobe/bw-board' and pro['head']==head and pro['workflowPath']=='.github/workflows/i80386-hdd-export.yml' and hex40(pro['workflowBlob']) and integer(pro['runId'],1) and type(pro['runAttempt']) is int and pro['runAttempt']==1 and integer(pro['jobId'],1) and pro['runnerImageOS']=='ubuntu24','runtime-provenance')
    need(all(type(pro[k]) is str and pro[k] for k in ['runnerName','runnerImageVersion']) and all(pro[k]==v for k,v in ACTIONS.items()),'runtime-actions')
    need(type(value['rows']) is list and len(value['rows'])==3,'runtime-census')
    for row,(role,path) in zip(value['rows'],[('node','runtime/bin/node'),('python','/usr/bin/python3'),('git','/usr/bin/git')]):
        keys(row,{'role','path','realpath','byteLength','sha256','version'},'runtime-row-fields')
        need(row['role']==role and row['path']==path and type(row['realpath']) is str and row['realpath'].startswith('/') and integer(row['byteLength'],1) and digest(row['sha256']) and type(row['version']) is str and row['version'],'runtime-row')
    need(value['rows'][0]['version']=='v22.23.3','node-version')

def resource_record(value):
    keys(value,set('cgroupRole cpuMax memoryMaxBytes swapMaxBytes affinityCpus memoryEvents'.split()),'resource-fields')
    need(type(value['cgroupRole']) is str and value['cgroupRole'] and value['cpuMax']=='100000 100000' and type(value['memoryMaxBytes']) is int and value['memoryMaxBytes']==1073741824 and type(value['swapMaxBytes']) is int and value['swapMaxBytes']==0,'resource-limits')
    need(type(value['affinityCpus']) is list and len(value['affinityCpus'])==1 and integer(value['affinityCpus'][0]),'resource-affinity')
    keys(value['memoryEvents'],set('low high max oom oom_kill oom_group_kill'.split()),'resource-events')
    need(all(integer(v) for v in value['memoryEvents'].values()),'resource-event-values')

def media_record(value,stage,hashes):
    keys(value,{'schema','stage','rows'},'media-fields')
    names=['bios','vga','floppy','initial']+([] if stage=='before' else ['first'])+(['second'] if stage=='after' else [])
    need(value['schema']=='bw.hdd-cli-media.v1' and value['stage']==stage and type(value['rows']) is list and len(value['rows'])==len(names),'media-stage')
    for row,name in zip(value['rows'],names):
        keys(row,{'role','byteLength','sha256','regular'},'media-row-fields')
        extent,digest_value=FIXED_MEDIA.get(name,(SIZE,hashes.get(name+'.img')))
        if name=='initial':need(hashes['initial.img']==digest_value,'initial-canonical-role-hash')
        need(row['role']==name and type(row['byteLength']) is int and row['byteLength']==extent and row['sha256']==digest_value and row['regular'] is True,'media-row-join')

def lifecycle_record(value,child,node,report,offers):
    keys(value,set('schema child argv environment pid pgid operationalWallLimitSeconds cleanupLimitSeconds exitCode primaryFailure secondaryFailures timeout reaped ptyEof stderrEof groupEmpty cleanupUncertain events wait4Usage resourceBefore resourceAfter cwdRole ownedProcessIdentity'.split()),'lifecycle-fields')
    need(value['schema']=='bw.hdd-cli-lifecycle.v1' and type(value['child']) is int and value['child']==child and integer(value['pid'],1) and type(value['pgid']) is int and value['pgid']==value['pid'],'lifecycle-identity')
    argv=['runtime/bin/node','source/scripts/run-i80386-at-console.mjs','--hdd-image','inputs/initial.img' if child==1 else 'outputs/first.img','--geometry','306,4,17','--floppy-image','inputs/floppy.img','--steps','120000000','--live','--hdd-output','outputs/first.img' if child==1 else 'outputs/second.img']
    need(value['argv']==argv and value['cwdRole']=='session-root','child-command')
    env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','TERM':'xterm','AT_BIOS_ROM':'inputs/bios.bin','AT_BIOS_SHA256':FIXED_MEDIA['bios'][1],'VGA_BIOS_ROM':'inputs/vga.bin','VGA_BIOS_SHA256':FIXED_MEDIA['vga'][1],'AT_HDD_SHA256':report['inputs']['hdd'],'AT_FLOPPY_SHA256':FIXED_MEDIA['floppy'][1],'AT_CONSOLE_REPORT':f'outputs/child{child}-report.json','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
    need(value['environment']==env,'child-environment')
    need(type(value['operationalWallLimitSeconds']) is int and value['operationalWallLimitSeconds']==600 and type(value['cleanupLimitSeconds']) is int and value['cleanupLimitSeconds']==5,'child-deadline')
    need(type(value['exitCode']) is int and value['exitCode']==0 and value['primaryFailure'] is None and value['secondaryFailures']==[],'child-failure')
    need(value['timeout'] is False and value['cleanupUncertain'] is False and all(value[k] is True for k in ['reaped','ptyEof','stderrEof','groupEmpty']),'child-terminal')
    ident=value['ownedProcessIdentity'];keys(ident,set('pid exeRealpath exeByteLength exeSha256 argv observedElapsedNs'.split()),'process-identity-fields')
    need(type(ident['pid']) is int and ident['pid']==value['pid'] and ident['argv']==argv and ident['exeRealpath']==node['realpath'] and type(ident['exeByteLength']) is int and ident['exeByteLength']==node['byteLength'] and ident['exeSha256']==node['sha256'] and integer(ident['observedElapsedNs'],0,600*10**9),'process-runtime-join')
    for phase in ['Before','After']:resource_record(value['resource'+phase])
    before,after=value['resourceBefore'],value['resourceAfter']
    need({k:v for k,v in before.items() if k!='memoryEvents'}=={k:v for k,v in after.items() if k!='memoryEvents'},'resource-configuration-drift')
    need(all(after['memoryEvents'][k]>=before['memoryEvents'][k] for k in before['memoryEvents']),'resource-counter-regression')
    need(all(after['memoryEvents'][k]==before['memoryEvents'][k] for k in ['oom','oom_kill','oom_group_kill']),'resource-oom-delta')
    keys(value['wait4Usage'],{'userSeconds','systemSeconds','maxRssKiB'},'wait4-usage-fields')
    need(all(type(value['wait4Usage'][k]) in (int,float) and value['wait4Usage'][k]>=0 for k in ['userSeconds','systemSeconds']) and integer(value['wait4Usage']['maxRssKiB']),'wait4-usage')
    events=value['events'];need(type(events) is list and 1<=len(events)<=8192,'lifecycle-events')
    kinds=[];elapsed=-1;observed=False;reaped=False;input_events=[]
    fields=set('ordinal kind phase pid pgid signal inputOrdinal status errorCode elapsedNs attemptedBytes writtenBytes bytesHex'.split())
    allowed={'spawn','input','exit-observed-wnowait','pty-eof','stderr-eof','group-signal','wait4-reap','group-empty-query','close','failure','input-write'}
    for ordinal,event in enumerate(events,1):
        keys(event,fields,'event-fields')
        need(type(event['ordinal']) is int and event['ordinal']==ordinal and type(event['kind']) is str and event['kind'] in allowed and integer(event['elapsedNs'],elapsed,605*10**9),'event-order')
        need(type(event['phase']) is str and event['phase'] in {'pre-spawn','running','exited-unreaped','reaped','closed'} and event['errorCode'] is None,'event-phase-or-error')
        need((event['pid'] is None or type(event['pid']) is int and event['pid']==value['pid']) and (event['pgid'] is None or type(event['pgid']) is int and event['pgid']==value['pgid']),'event-owner')
        for key in ['inputOrdinal','status','attemptedBytes','writtenBytes']:
            need(event[key] is None or integer(event[key]),'event-numeric-type')
        need(event['bytesHex'] is None or type(event['bytesHex']) is str and re.fullmatch('(?:[0-9a-f]{2}){0,64}',event['bytesHex']) is not None,'event-bytes-type')
        kind=event['kind'];kinds.append(kind);elapsed=event['elapsedNs']
        if kind=='failure':raise Refusal('lifecycle-failure-event')
        if kind=='exit-observed-wnowait':
            need(not observed and not reaped and event['phase']=='exited-unreaped','exit-observation-order');observed=True
        elif kind=='wait4-reap':
            need(observed and not reaped and event['phase']=='reaped' and type(event['status']) is int and event['status']==0,'reap-order');reaped=True
        elif kind=='group-signal':
            need(observed and not reaped and event['phase']=='exited-unreaped' and type(event['signal']) is int and event['signal'] in [15,9],'preexit-or-postreap-signal')
        elif kind=='group-empty-query':need(reaped and event['phase']=='reaped','group-query-order')
        elif kind in ['pty-eof','stderr-eof']:need(observed,'eof-before-exit-observation')
        elif kind=='close':need(reaped and event['phase']=='closed','close-before-reap')
        elif kind=='input-write':
            need(not observed and event['phase']=='running','input-after-exit');input_events.append(event)
        if kind!='group-signal':need(event['signal'] is None,'unexpected-signal')
    need(all(kinds.count(k)==1 for k in ['spawn','exit-observed-wnowait','wait4-reap','group-empty-query','pty-eof','stderr-eof']),'lifecycle-event-census')
    need(kinds[0]=='spawn' and observed and reaped,'lifecycle-start-terminal')
    need(len(input_events)==len(offers),'input-event-count')
    for event,offer in zip(input_events,offers):
        need(type(event['inputOrdinal']) is int and event['inputOrdinal']==offer['offerOrdinal'] and event['bytesHex']==offer['bytesHex'] and type(event['attemptedBytes']) is int and event['attemptedBytes']==offer['writtenBytes'] and type(event['writtenBytes']) is int and event['writtenBytes']==offer['writtenBytes'],'input-event-offer-join')
        need(event['elapsedNs']>=offer['elapsedNs'],'input-event-before-offer')


def verify_packet(packet, external=None):
    """Verify exact original role bytes. External joins are never self-issued."""
    try:return _verify_packet(packet,external)
    except (Refusal,DiskRefusal) as error:
        return {'reportedConsistencyPass':False,'finitePersistencePass':False,'fullAcceptanceQualified':False,'failure':str(error)}

def _verify_packet(packet,external):
    keys(packet,set(PACKET_CAPS),'packet-role-census')
    need(all(type(packet[n]) is bytes and len(packet[n])<=cap for n,cap in PACKET_CAPS.items()) and sum(map(len,packet.values()))<=96*1024*1024,'packet-byte-cap')
    hashes={n:sha(b) for n,b in packet.items()}
    records={n:parse_json(b) for n,b in packet.items() if n.endswith('.json') and not n.endswith('/frames.json')}
    index=records['index.json'];keys(index,{'schema','roles'},'index-fields')
    need(index['schema']=='bw.hdd-cli-index.v1' and type(index['roles']) is list and len(index['roles'])==24,'index-census')
    for row,name in zip(index['roles'],list(PACKET_CAPS)[:-1]):
        keys(row,{'name','state','byteLength','sha256'},'index-row-fields')
        need(row['name']==name and row['state']=='present' and type(row['byteLength']) is int and row['byteLength']==len(packet[name]) and row['sha256']==hashes[name],'index-original-join')
    src=records['source-before.json'];source_record(src);source_record(records['source-after.json'])
    need(src==records['source-after.json'],'source-before-after')
    rt=records['runtime-before.json'];runtime_record(rt,src['head']);runtime_record(records['runtime-after.json'],src['head'])
    need(rt==records['runtime-after.json'],'runtime-before-after')
    workflow_rows=[r for r in src['rows'] if r['path']==rt['provenance']['workflowPath']]
    need(len(workflow_rows)==1 and workflow_rows[0]['gitBlob']==rt['provenance']['workflowBlob'],'workflow-source-join')
    for stage in ['before','between','after']:media_record(records[f'media-{stage}.json'],stage,hashes)
    # consoleMap is externally selected; exactly 79 rows, not any self-chosen subset.
    if external is not None:
        keys(external,{'roleSha256','sourceInventory','runtimeInventory','consoleMap','official'},'external-fields')
        need(external['roleSha256']==hashes and external['sourceInventory']==src and external['runtimeInventory']==rt,'external-original-identity')
    console_map=external['consoleMap'] if external is not None else records['child1/report.json']['sourceSha256'];need(type(console_map) is dict and len(console_map)==79 and all(type(k) is str and digest(v) for k,v in console_map.items()),'external-console-map')
    admission_record(records['admission.json'],src)
    source_hashes={r['path']:r['sha256'] for r in src['rows']}
    # Probe console source keys are relative to scripts/run-i80386-at-console.mjs.
    import posixpath
    need(all(posixpath.normpath(posixpath.join('scripts',k)) in source_hashes and source_hashes[posixpath.normpath(posixpath.join('scripts',k))]==v for k,v in console_map.items()),'console-source-inventory-join')
    console_paths={posixpath.normpath(posixpath.join('scripts',k)) for k in console_map}
    need(len(console_paths)==79,'console-path-alias')
    need(set(source_hashes)==console_paths|COMMON_SOURCE_PATHS,'closed-source-union')
    common_map={k:v for k,v in source_hashes.items() if k not in console_paths}
    admission=records['admission.json']
    need(admission['consoleMapSha256']==sha(canonical(console_map)) and admission['commonMapSha256']==sha(canonical(common_map)),'admission-map-digests')
    roles={'initial':packet['initial.img'],'writerExport':packet['first.img'],'readerExport':packet['second.img']}
    for child,arm in [(1,'writer'),(2,'reader')]:
        for suffix,name in [('Pty','pty.bin'),('Report','report.json'),('Ledger','offers.json')]:roles[arm+suffix]=packet[f'child{child}/{name}']
        report=records[f'child{child}/report.json'];selected_report(report,src['head'],console_map)
        need(packet[f'child{child}/stderr.bin']==b'','child-stderr')
        lifecycle_record(records[f'child{child}/lifecycle.json'],child,rt['rows'][0],report,records[f'child{child}/offers.json']['offers'])
    expected_cgroup=f"/system.slice/bw-hdd-export-{rt['provenance']['runId']}-{rt['provenance']['runAttempt']}.service"
    need(all(records[f'child{n}/lifecycle.json']['resourceBefore']['cgroupRole']==expected_cgroup for n in (1,2)),'owned-controller-resource-role')
    first_resource=records['child1/lifecycle.json']['resourceBefore']
    second_resource=records['child2/lifecycle.json']['resourceBefore']
    need({k:v for k,v in first_resource.items() if k!='memoryEvents'}=={k:v for k,v in second_resource.items() if k!='memoryEvents'},'cross-session-resource-configuration')
    gap_before=records['child1/lifecycle.json']['resourceAfter']['memoryEvents']
    gap_after=records['child2/lifecycle.json']['resourceBefore']['memoryEvents']
    need(all(gap_after[k]>=gap_before[k] for k in gap_before),'cross-session-resource-counter-regression')
    need(all(gap_after[k]==gap_before[k] for k in ['oom','oom_kill','oom_group_kill']),'cross-session-oom-gap')
    admission=records['admission.json'];admission_record(admission,src)
    frames_and_result(records,packet)
    cross=cross_audit(roles,{n:sha(b) for n,b in roles.items()},POLICY)
    # Finite outer-admission metadata is validated separately from reported facts.
    if external is None:
        return {'schema':'bw.hdd-independent-reader.v1','reportedConsistencyPass':True,'byteProofPass':True,'session1Pass':True,'session2Pass':True,'finitePersistencePass':False,'fullAcceptanceQualified':False,'externalOriginalsJoined':False,'crossSession':cross,'remainingGates':['external-official-source-runtime-admission','media-license-provenance-admission','enclosing-controller-terminal-cleanup','final-admission-policy-review']}
    official=external['official'];keys(official,set('repository head runId runAttempt jobId workflowPath workflowBlob artifactSha256 artifactByteLength conclusion event eventAction actualLabel jobConclusion'.split()),'official-fields')
    provenance=rt['provenance']
    need(all(official[k]==provenance[k] and type(official[k])==type(provenance[k]) for k in ['repository','head','runId','runAttempt','jobId','workflowPath','workflowBlob']) and official['conclusion']=='success' and official['jobConclusion']=='success' and official['event']=='pull_request' and official['eventAction']=='labeled' and official['actualLabel']=='x86-hdd-export-actual' and digest(official['artifactSha256']) and integer(official['artifactByteLength'],1,100*1024*1024),'official-runtime-join')
    return {'schema':'bw.hdd-independent-reader.v1','reportedConsistencyPass':True,'byteProofPass':True,'session1Pass':True,'session2Pass':True,'finitePersistencePass':False,'fullAcceptanceQualified':False,'externalOriginalsJoined':True,'crossSession':cross,'remainingGates':['artifact-container-authentication','media-license-provenance-admission','enclosing-controller-terminal-cleanup','final-admission-policy-review']}

def admission_record(value,source):
    keys(value,set('schema sourceHead sourceTree consoleMapSha256 commonMapSha256 mediaReviewSha256 resourcePolicySha256 protocolSha256 inputGeometry childGuestSteps stableStepCalls childWallSeconds outerWallSeconds secondExportsReadback authority runtimeProfile runtimeIdentityPolicySha256'.split()),'admission-fields')
    need(value['schema']=='bw.hdd-cli-admission.v1' and value['sourceHead']==source['head'] and value['sourceTree']==source['tree'],'admission-source')
    need(all(digest(value[k]) for k in ['consoleMapSha256','commonMapSha256','mediaReviewSha256','resourcePolicySha256','protocolSha256','runtimeIdentityPolicySha256']),'admission-digests')
    need(all(value[k]==v for k,v in POLICY_DIGESTS.items()),'fixed-resource-runtime-protocol-policy')
    need(value['mediaReviewSha256']=='93a1119016e7e9d2a963ce4491199698e852739f9d20b3b7b0f5fdfe10c41795','finite-media-review')
    need(value['inputGeometry']==GEOMETRY and all(type(x) is int for x in value['inputGeometry'].values()),'admission-geometry')
    need(all(type(value[k]) is int and value[k]==v for k,v in {'childGuestSteps':120000000,'stableStepCalls':1500000,'childWallSeconds':600,'outerWallSeconds':1250}.items()) and value['secondExportsReadback'] is True and value['authority']=='external-reviewed-inputs-required' and value['runtimeProfile']=='hosted-observed-runtime-identity.v1','admission-policy')

def frames_and_result(records,packet):
    for child in (1,2):
        name=f'child{child}/frames.json';value=parse_json(packet[name]);keys(value,{'schema','child','stepDomain','frames'},'frame-ledger-fields')
        need(value['schema']=='bw.hdd-cli-frames.v1' and type(value['child']) is int and value['child']==child and value['stepDomain']=='console-machine-step-calls','frame-ledger-domain')
        raw=packet[f'child{child}/pty.bin'];frames=parse_frames(raw)
        need(type(value['frames']) is list and len(value['frames'])==len(frames),'frame-ledger-count')
        for row,frame in zip(value['frames'],frames):
            keys(row,set('frameOrdinal frameStep stepLimit frameStartRawOffset endRawOffset textBodySha256'.split()),'frame-ledger-row')
            body=raw[raw.index(b'\n',frame['start'])+1:frame['end']-len(END)]
            expected={'frameOrdinal':frame['ordinal'],'frameStep':frame['step'],'stepLimit':120000000,'frameStartRawOffset':frame['start'],'endRawOffset':frame['end'],'textBodySha256':sha(body)}
            need(row==expected and all(type(row[k]) is int for k in expected if k!='textBodySha256'),'frame-ledger-original')
    result=records['result.json'];keys(result,set('schema byteProofPass session1Pass session2Pass finitePersistencePass firstFailure secondaryFailures fullOsQualified crashDurabilityQualified installedGuiQualified'.split()),'result-fields')
    need(result['schema']=='bw.hdd-cli-result.v1' and result['firstFailure'] is None and result['secondaryFailures']==[],'producer-failure')
    need(all(type(result[k]) is bool for k in ['byteProofPass','session1Pass','session2Pass','finitePersistencePass']) and all(result[k] is False for k in ['fullOsQualified','crashDurabilityQualified','installedGuiQualified']),'result-claims')

def read_packet(directory):
    """Read closed regular originals with bounded nonblocking FD reads."""
    from pathlib import Path
    root=Path(directory);found=set()
    for path in root.rglob('*'):
        need(not path.is_symlink(),'packet-symlink')
        if path.is_file():found.add(path.relative_to(root).as_posix())
    need(found==set(PACKET_CAPS),'packet-file-census')
    output={}
    for name,cap in PACKET_CAPS.items():
        fd=os.open(root/name,os.O_RDONLY|os.O_NONBLOCK|getattr(os,'O_NOFOLLOW',0));primary=None
        try:
            before=os.fstat(fd);need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=cap,'packet-regular-extent')
            data=bytearray()
            while len(data)<=cap:
                part=os.read(fd,min(65536,cap+1-len(data)))
                if not part:break
                data.extend(part)
            after=os.fstat(fd);named=os.stat(root/name,follow_symlinks=False)
            need(len(data)==before.st_size and (before.st_dev,before.st_ino,before.st_size)==(after.st_dev,after.st_ino,after.st_size)==(named.st_dev,named.st_ino,named.st_size) and after.st_nlink==1 and named.st_nlink==1 and stat.S_ISREG(named.st_mode),'packet-read-identity')
            output[name]=bytes(data)
        except BaseException as error:primary=error
        finally:
            try:os.close(fd)
            except BaseException as error:
                if primary is None:primary=error
        if primary is not None:raise primary
    return output


def verify_artifact(zip_bytes, external):
    """Trusted caller supplies independently admitted official API/source identities.

    No metadata acquisition, producer approval, or inference from the file name.
    """
    import io
    import zipfile
    import zlib
    try:
        need(type(external) is dict and type(external.get('official')) is dict,'external-artifact-admission')
        official=external['official']
        need(type(zip_bytes) is bytes and len(zip_bytes)<=100*1024*1024,'artifact-raw-cap')
        need(type(official.get('artifactByteLength')) is int and len(zip_bytes)==official['artifactByteLength'] and digest(official.get('artifactSha256')) and sha(zip_bytes)==official['artifactSha256'],'artifact-original-identity')
        # Bound central-directory allocation before ZipFile parses it. No ZIP64
        # is needed for this fixed 25-member, <100MiB artifact.
        eocd=zip_bytes.rfind(b'PK\x05\x06',max(0,len(zip_bytes)-65557))
        need(eocd>=0 and eocd+22<=len(zip_bytes),'artifact-end-record')
        disk_no,central_disk,disk_count,total_count,central_size,central_offset,comment_size=struct.unpack_from('<HHHHIIH',zip_bytes,eocd+4)
        need(disk_no==central_disk==0 and disk_count==total_count==25 and central_size<=16384 and central_offset+central_size==eocd and eocd+22+comment_size==len(zip_bytes),'artifact-central-bounds')
        archive=zipfile.ZipFile(io.BytesIO(zip_bytes));primary=None;packet={} 
        try:
            infos=archive.infolist()
            need(len(infos)==25 and len({info.filename for info in infos})==25 and {info.filename for info in infos}==set(PACKET_CAPS),'artifact-role-census')
            need(sum(info.file_size for info in infos)<=96*1024*1024,'artifact-decoded-cap')
            for info in infos:
                need(info.filename==info.orig_filename and '\0' not in info.orig_filename and not info.is_dir() and not info.flag_bits&1 and info.compress_type in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED),'artifact-member-format')
                mode=info.external_attr>>16
                need(stat.S_IFMT(mode) in (0,stat.S_IFREG),'artifact-member-type')
                cap=PACKET_CAPS[info.filename]
                need(0<=info.file_size<=cap,'artifact-member-cap')
                with archive.open(info,'r') as stream:
                    body=stream.read(cap+1)
                    need(len(body)==info.file_size and len(body)<=cap and stream.read(1)==b'','artifact-member-extent')
                packet[info.filename]=body
        except BaseException as error:primary=error
        finally:
            try:archive.close()
            except BaseException as error:
                if primary is None:primary=error
        if primary is not None:raise primary
        result=verify_packet(packet,external)
        need(result['reportedConsistencyPass'],'packet:'+result.get('failure','unknown'))
        result.update(artifactOriginalJoined=True,finitePersistencePass=True,
                      fullOsQualified=False,crashDurabilityQualified=False,
                      installedGuiQualified=False,fullAcceptanceQualified=False)
        result['remainingGates']=['installed-GUI','crash-durability','whole-OS','binary-redistribution']
        return result
    except (Refusal,DiskRefusal,zipfile.BadZipFile,zlib.error,RuntimeError,OSError,EOFError) as error:
        return {'reportedConsistencyPass':False,'finitePersistencePass':False,'fullAcceptanceQualified':False,'failure':str(error)}


def read_original(path,cap):
    fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|getattr(os,'O_NOFOLLOW',0));primary=None;data=bytearray()
    try:
        before=os.fstat(fd);need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=cap,'original-file-extent-type')
        while len(data)<=cap:
            part=os.read(fd,min(65536,cap+1-len(data)))
            if not part:break
            data.extend(part)
        after=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        need(len(data)==before.st_size and (before.st_dev,before.st_ino,before.st_size)==(after.st_dev,after.st_ino,after.st_size)==(named.st_dev,named.st_ino,named.st_size) and after.st_nlink==named.st_nlink==1 and stat.S_ISREG(named.st_mode),'original-file-read-identity')
    except BaseException as error:primary=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary
    return bytes(data)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--packet');mode.add_argument('--artifact')
    parser.add_argument('--external');args=parser.parse_args()
    if bool(args.artifact)!=bool(args.external):parser.error('--artifact and --external are required together')
    try:
        if args.artifact:result=verify_artifact(read_original(args.artifact,100*1024*1024),parse_json(read_original(args.external,JSON_CAP)))
        else:result=verify_packet(read_packet(args.packet))
    except (OSError,ValueError) as error:result={'reportedConsistencyPass':False,'finitePersistencePass':False,'fullAcceptanceQualified':False,'failure':str(error)}
    print(json.dumps(result,sort_keys=True,separators=(',',':')))
    return 0 if result['reportedConsistencyPass'] else 1

if __name__=='__main__':raise SystemExit(main())
