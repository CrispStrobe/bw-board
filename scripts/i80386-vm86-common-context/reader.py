#!/usr/bin/env python3
"""Independent original-only reader for the VM86 common-context originals.

It imports no producer module. It re-hashes each original against summary.json,
decodes the stream layout from its own constants and checks architectural facts
directly in the Bochs and JS streams before requiring byte equality with the
frozen expectation. Exit 0 only for a complete pass; otherwise it prints the
first preserved discrepancy.
"""
import hashlib, json, struct, sys
from pathlib import Path

GDT, TSS, H_STACK, T_STACK = 64, 0x68, 88, 36
TABLES = 4 + GDT + 2 * TSS


def offsets():
    at = 4
    o = {'P0': at}; at += TABLES
    o['H40'] = at; at += TABLES
    o['H40.stack'] = at; at += H_STACK
    o['H40.ram'] = at; at += 4
    o['T41'] = at; at += TABLES
    o['T41.stack'] = at; at += T_STACK
    o['end'] = at; at += 4
    return o, at


def access(stream, phase, selector):
    o, _ = offsets()
    return stream[o[phase] + 4 + selector + 5]


def tss(stream, phase, which, field, size=4):
    o, _ = offsets()
    base = o[phase] + 4 + GDT + (0 if which == 1 else TSS) + field
    return int.from_bytes(stream[base:base + size], 'little')


def facts(stream):
    """Architecture-level predicates, each independently named."""
    o, length = offsets()
    if len(stream) != length:
        return [('length', False, f'{len(stream)}!={length}')]
    s = stream
    words = lambda at, n: struct.unpack_from('<%dI' % n, s, at)
    h = words(o['H40.stack'], 22)
    t = words(o['T41.stack'], 9)
    return [
        ('markers', s[:4] == b'VMCC' and s[o['P0']:o['P0'] + 4] == b'P0__' and s[o['H40']:o['H40'] + 4] == b'H40_'
         and s[o['T41']:o['T41'] + 4] == b'T41_' and s[o['end']:] == b'END!', None),
        ('P0 boot CS/data accessed, TSS1 busy', (access(s, 'P0', 8), access(s, 'P0', 0x10), access(s, 'P0', 0x18)) == (0x9b, 0x93, 0x8b), None),
        ('P0 handler/task2 descriptors untouched', (access(s, 'P0', 0x28), access(s, 'P0', 0x30), access(s, 'P0', 0x38), access(s, 'P0', 0x20)) == (0x9a, 0x9a, 0x92, 0x89), None),
        ('H40 INT-gate CS.A written in GDT RAM', access(s, 'H40', 0x28) == 0x9b, hex(access(s, 'H40', 0x28))),
        ('T41 task-switch CS.A/DS.A and busy written', (access(s, 'T41', 0x30), access(s, 'T41', 0x38), access(s, 'T41', 0x20), access(s, 'T41', 0x18)) == (0x9b, 0x93, 0x8b, 0x8b), None),
        ('H40 null data selectors', h[0:4] == (0, 0, 0, 0), h[0:4]),
        ('H40 handler EFLAGS VM/IF/TF/NT/RF clear, IOPL3', h[4] == 0x3002, hex(h[4])),
        ('H40 VM86 frame CS/EFLAGS/ESP/SS/ES/DS/FS/GS', h[14:22] == (0, 0x23002, 0xfe, 0x600, 0x400, 0x300, 0x500, 0x700), h[14:22]),
        ('H40 VM86 RAM writes', s[o['H40.ram']:o['H40.ram'] + 4] == b'\xef\xbe\xfe\xca', None),
        ('T41 TSS1 saved VM86 EFLAGS', tss(s, 'T41', 1, 0x24) == 0x23002, hex(tss(s, 'T41', 1, 0x24))),
        ('T41 TSS1 saved VM86 selectors', tuple(tss(s, 'T41', 1, 0x48 + 4 * i, 2) for i in range(6)) == (0x400, 0, 0x600, 0x300, 0x500, 0x700), None),
        ('T41 TSS1 saved GPRs', tuple(tss(s, 'T41', 1, 0x28 + 4 * i) for i in range(8)) == (0x11111234, 0x33333333, 0x44444444, 0x22225678, 0xfe, 0x66666666, 0x77777777, 0x88888888), None),
        ('T41 TSS2 back-link', tss(s, 'T41', 2, 0) == 0x18, None),
        ('T41 nested EFLAGS NT', t[0] == 0x4002, hex(t[0])),
        ('T41 task2 registers from TSS2', t[1:9] == (0, 0, 0, 0xa000, 0, 0, 0, 0xa5a50000), t[1:9]),
    ]


def first_difference(a, b):
    for i in range(max(len(a), len(b))):
        if i >= len(a) or i >= len(b) or a[i] != b[i]:
            return i
    return None


def read(directory):
    d = Path(directory)
    summary = json.loads((d / 'summary.json').read_text())
    result = {'schema': 'bw.i80386-vm86-common-context.reader.v1', 'checks': [], 'pass': False}
    blobs = {}
    for name in ('guest.bin', 'expected.bin', 'js.bin', 'bochs.bin'):
        p = d / name
        if not p.is_file() or p.is_symlink():
            result['failure'] = f'missing or non-regular {name}'
            return result
        data = p.read_bytes()
        if hashlib.sha256(data).hexdigest() != summary['files'].get(name):
            result['failure'] = f'hash mismatch {name}'
            return result
        blobs[name] = data
    if hashlib.sha256(blobs['guest.bin']).hexdigest() != summary['guest']['imageSha256']:
        result['failure'] = 'guest identity mismatch'
        return result
    for engine in ('bochs.bin', 'js.bin', 'expected.bin'):
        for name, ok, detail in facts(blobs[engine]):
            result['checks'].append({'stream': engine, 'fact': name, 'pass': bool(ok), 'detail': None if ok else repr(detail)})
    for engine in ('bochs.bin', 'js.bin'):
        result[f'{engine}.firstDifferenceFromExpected'] = first_difference(blobs['expected.bin'], blobs[engine])
    result['jsVsBochsFirstDifference'] = first_difference(blobs['bochs.bin'], blobs['js.bin'])
    failed = [c for c in result['checks'] if not c['pass']]
    result['firstFailedFact'] = failed[0] if failed else None
    result['pass'] = not failed and all(result[f'{e}.firstDifferenceFromExpected'] is None for e in ('bochs.bin', 'js.bin'))
    return result


if __name__ == '__main__':
    verdict = read(sys.argv[1])
    print(json.dumps(verdict, indent=1, sort_keys=True))
    sys.exit(0 if verdict['pass'] else 1)
