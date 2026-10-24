#!/usr/bin/env python3
"""Bounded authored Ring3 reference. Execution routes are deliberately inactive.

Toolchain inventory observes data; it never executes the observed tool. Build
and reference require separately selected expectations before their first tool.
The independent reader does not import this module.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import resource
import selectors
import signal
import stat
import struct
import subprocess
import sys
import time
import zipfile

TOOLCHAIN_ENABLED = False
BUILD_ENABLED = False
REFERENCE_ENABLED = False
REPOSITORY = 'CrispStrobe/bw-board'
OWNER = 'CrispStrobe'
UPSTREAM = 'bochs-emu/Bochs'
UPSTREAM_COMMIT = '0e45b736ef9792eb9b752b0a35db49eaf2faea47'
UPSTREAM_TREE = '1b5e0f45ecea9efee6654c69f6437ef5f7e6b44d'
UPSTREAM_ENTRY_COUNT = 825
UPSTREAM_BLOB_COUNT = 774
SOURCE_SELECTION_SHA256 = '02a7dce1ad1ff290278e1a12dfa0ba550b3b1df783cc93f4d624e1372d168fc6'
VGA_PATH = 'bochs/bios/VGABIOS-lgpl-latest'
VGA_BLOB = '122aba4255a09e3021f9b605fce03294530797f9'
VGA_BYTES = 38400
VGA_SHA256 = 'de5663dccb7309409d31419948158c561bdc52f90095f42c094a793c634938aa'
VGA_SOURCE_URL = 'https://download-mirror.savannah.gnu.org/releases/vgabios/vgabios-0.8a.tgz'
VGA_SOURCE_BYTES = 174452
VGA_SOURCE_SHA256 = '481042240ef0f1c918780c92a6bb42ad4d3f5d989b29502fa7ee7faf13a041b9'
VGA_LICENSE_SHA256 = 'c43e067abce73ca284383f4f905316e7cad6dd9aaf69f02ee961b6dfbc4de3c2'
ROM_BYTES = 65536
ROM_SHA256 = 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529'
WIRE_MAGIC = b'BW-RING3-V1\n'
WIRE_END = b'\nBW-RING3-END\n'
WIRE_BYTES = 1730
SOURCE_PATHS = tuple('scripts/i80386-bochs-ring3-reference/' + name for name in
                     ('run.py', 'reader.py', 'controls.py', 'README.md')) + (
    '.github/workflows/i80386-bochs-ring3-reference.yml',
    'test/i80386-bochs-ring3-reference.test.mjs', 'src/experimental/i80386.js',
    'scripts/i80386-ring3-int-iret/fixture.mjs',
    'scripts/i80386-ring3-int-iret/probe.mjs', 'package.json',
    'package-lock.json', 'LICENSE')
WORKFLOW = '.github/workflows/i80386-bochs-ring3-reference.yml'
ROUTES = {
    'toolchain': ('bochs-ring3-toolchain-inventory-v1', 'x86-bochs-ring3-toolchain-inventory-v1',
                  'BW_BOCHS_RING3_TOOLCHAIN_REQUEST'),
    'build': ('bochs-ring3-build-v1', 'x86-bochs-ring3-build-v1', 'BW_BOCHS_RING3_BUILD_REQUEST'),
    'reference': ('bochs-ring3-reference-v1', 'x86-bochs-ring3-reference-v1',
                  'BW_BOCHS_RING3_REFERENCE_REQUEST')}
REQUEST_CAP = 32768
EVENT_CAP = 1048576
LIMITS = {
    'toolchain': {'cpuQuota': 100000, 'cpuPeriod': 100000, 'memoryBytes': 536870912,
                  'swapBytes': 0, 'tasks': 32, 'childWallSeconds': 60, 'outerWallSeconds': 120,
                  'jobMinutes': 5, 'fileReadBytes': 134217728, 'totalReadBytes': 536870912,
                  'files': 128, 'aliases': 128, 'directoryAliases': 32,
                  'archiveBytes': 8388608, 'expandedBytes': 16777216, 'members': 16},
    'build': {'cpuQuota': 100000, 'cpuPeriod': 100000, 'memoryBytes': 2147483648,
              'swapBytes': 0, 'tasks': 64, 'childWallSeconds': 900, 'outerWallSeconds': 960,
              'jobMinutes': 20, 'streamBytes': 4194304, 'archiveBytes': 67108864,
              'expandedBytes': 268435456, 'members': 4096,
              'runtimeArchiveBytes': 33554432, 'runtimeExpandedBytes': 67108864,
              'runtimeMembers': 256, 'perFileWriteBytes': 67108864},
    'reference': {'cpuQuota': 100000, 'cpuPeriod': 100000, 'memoryBytes': 1073741824,
                  'swapBytes': 0, 'tasks': 64, 'childWallSeconds': 60, 'outerWallSeconds': 240,
                  'jobMinutes': 10, 'streamBytes': 131072, 'logBytes': 4194304,
                  'perFileWriteBytes': 4194304, 'archiveBytes': 100663296,
                  'expandedBytes': 402653184, 'members': 6144,
                  'cleanupBytes': 16384, 'cleanupSamples': 6, 'cleanupSeconds': 5}}
ERROR_LIMIT = 512
SECONDARY_LIMIT = 16
HEX = re.compile(r'[0-9a-f]{64}\Z')
GIT_HEX = re.compile(r'[0-9a-f]{40}\Z')


class Refusal(ValueError):
    """Retained bounded source refusal, distinct from a successful observation."""


def need(condition, message):
    if not condition:
        raise Refusal(message)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def closed(value, names, message):
    need(type(value) is dict and set(value) == set(names), message)


def integer(value, lower, upper, message):
    need(type(value) is int and lower <= value <= upper, message)


def pairs(items):
    value = {}
    for key, item in items:
        need(key not in value, 'duplicate JSON key')
        value[key] = item
    return value


def finite_float(text):
    value = float(text)
    need(math.isfinite(value), 'nonfinite JSON number')
    return value


def reject_constant(_text):
    raise Refusal('nonfinite JSON constant')


def raw_object(raw, cap):
    need(type(raw) is bytes and 1 <= len(raw) <= cap, 'bounded JSON bytes')
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                       parse_float=finite_float, parse_constant=reject_constant)
    need(type(value) is dict, 'JSON object')
    return value


def request_object(raw):
    value = raw_object(raw, REQUEST_CAP)
    need(raw == canonical(value), 'canonical request original')
    return value


def raw_event(raw):
    # GitHub delivers pretty JSON. Hash/retain these exact bytes, never rewrite.
    return raw_object(raw, EVENT_CAP)


def failure(exc, phase, role=None, path=None):
    return {'phase': phase, 'name': type(exc).__name__[:64],
            'message': str(exc)[:ERROR_LIMIT], 'role': role, 'path': path}


def identity(info):
    return {'dev': info.st_dev, 'ino': info.st_ino, 'mode': info.st_mode,
            'uid': info.st_uid, 'gid': info.st_gid, 'nlink': info.st_nlink,
            'size': info.st_size, 'mtimeNs': info.st_mtime_ns,
            'ctimeNs': info.st_ctime_ns}


def read_regular(path, cap, *, minimum=0, owner=0, group=None):
    """Read a role-typed ordinary file; preserve partial facts on any failure.

    Empty source/data is legal. Critical executables/config/notices pass min1.
    This helper does not read procfs/cgroup pseudo-files or follow symlinks.
    """
    path = os.fspath(path)
    record = {'bytes': 0, 'sha256': None, 'before': None, 'after': None,
              'named': None, 'complete': False, 'elf': None}
    fd = None
    raw = bytearray()
    primary = None
    secondary = []
    try:
        fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
        before = os.fstat(fd)
        record['before'] = identity(before)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
             'ordinary single-link regular file')
        need(before.st_uid == owner and before.st_gid == (owner if group is None else group) and
             before.st_mode & 0o022 == 0, 'selected immutable file owner/mode')
        need(minimum <= before.st_size <= cap, 'bounded role-typed file extent')
        while True:
            part = os.read(fd, min(65536, cap + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
            need(len(raw) <= cap, 'file stream cap')
        after = os.fstat(fd)
        named = os.lstat(path)
        record['after'], record['named'] = identity(after), identity(named)
        need(record['before'] == record['after'] == record['named'],
             'held and named complete file identity')
        need(len(raw) == before.st_size, 'complete file EOF extent')
        record['complete'] = True
    except BaseException as exc:
        primary = exc
    finally:
        record['bytes'] = len(raw)
        record['sha256'] = sha256(raw)
        if fd is not None:
            try:
                os.close(fd)
            except BaseException as exc:
                if primary is None:
                    primary = exc
                else:
                    secondary.append(failure(exc, 'file-close', path=path))
    if primary is not None:
        primary.bochs_partial = {'path': path, 'observation': record,
                                 'firstFailure': failure(primary, 'file-read', path=path),
                                 'secondary': secondary}
        raise primary
    return bytes(raw), record


def retain_exclusive(path, raw, cap):
    """Write exact bounded bytes once; failures do not overwrite a prior copy."""
    need(type(raw) is bytes and len(raw) <= cap, 'bounded retained bytes')
    fd = None
    primary = None
    try:
        fd = os.open(os.fspath(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                     os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        offset = 0
        while offset < len(raw):
            count = os.write(fd, raw[offset:])
            need(count > 0, 'retained write progress')
            offset += count
        os.fsync(fd)
    except BaseException as exc:
        primary = exc
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except BaseException as exc:
                if primary is None:
                    primary = exc
                else:
                    primary.bochs_secondary = [failure(exc, 'retained-close')]
    if primary is not None:
        raise primary


def expected_header():
    def center(line):
        return b' ' * ((72 - len(line)) // 2) + line
    return (b'=' * 72 + b'\n' + center(b'Bochs x86 Emulator 2.7\n') +
            center(b'Built from SVN snapshot on August  1, 2021\n') +
            center(b'Timestamp: Sun Aug  1 10:07:00 CEST 2021') + b'\n' +
            b'=' * 72 + b'\n')


def reporter_frame(stdout):
    header = expected_header()
    need(type(stdout) is bytes and len(stdout) == len(header) + WIRE_BYTES,
         'complete unique Bochs header and frame extent')
    need(stdout[:len(header)] == header, 'source-derived exact Bochs header')
    frame = stdout[len(header):]
    need(frame.startswith(WIRE_MAGIC) and frame.endswith(WIRE_END),
         'fixed reporter magic/end')
    need(frame.count(WIRE_MAGIC) == frame.count(WIRE_END) == 1,
         'unique reporter framing')
    return frame


def admit_source_shape(value):
    closed(value, ('head', 'tree', 'files'), 'closed source')
    need(GIT_HEX.fullmatch(value['head']) and GIT_HEX.fullmatch(value['tree']),
         'source head/tree')
    need(type(value['files']) is dict and set(value['files']) == set(SOURCE_PATHS),
         'exact source12 roles')
    for row in value['files'].values():
        closed(row, ('mode', 'gitBlob', 'bytes', 'sha256'), 'source role shape')
        need(row['mode'] in ('100644', '100755') and GIT_HEX.fullmatch(row['gitBlob']) and
             HEX.fullmatch(row['sha256']), 'source mode/blob/hash')
        integer(row['bytes'], 1, 1048576, 'bounded nonempty source role')


def admit_event(route, request, request_raw, event_raw, env):
    """No factory/tool/input edge is reachable until exact admission succeeds."""
    job, label, prefix = ROUTES[route]
    event = raw_event(event_raw)
    need(env.get('GITHUB_REPOSITORY') == REPOSITORY and
         env.get('GITHUB_ACTOR') == OWNER and env.get('GITHUB_EVENT_NAME') == 'pull_request' and
         env.get('GITHUB_RUN_ATTEMPT') == '1' and env.get('GITHUB_JOB') == job,
         'owner first-attempt route environment')
    need(event.get('action') == 'labeled' and event.get('label', {}).get('name') == label and
         event.get('sender', {}).get('login') == OWNER, 'exact owner label event')
    pr = event.get('pull_request', {})
    need(pr.get('state') == 'open' and pr.get('draft') is False and
         pr.get('base', {}).get('ref') == 'master' and
         pr.get('base', {}).get('repo', {}).get('full_name') == REPOSITORY and
         pr.get('head', {}).get('repo', {}).get('full_name') == REPOSITORY and
         pr.get('head', {}).get('repo', {}).get('fork') is False,
         'open ready nonfork owned PR/master')
    integer(request['pullRequest'], 1, 1000000, 'request PR number')
    need(type(event.get('number')) is int and type(pr.get('number')) is int and
         event.get('number') == pr.get('number') == request['pullRequest'] and
         pr.get('head', {}).get('sha') == request['source']['head'] == env.get('BW_EXPECTED_HEAD'),
         'event/request/checkout head')
    digest = sha256(request_raw)
    need(env.get(prefix + '_SHA256') == digest, 'external request SHA')
    encoded = env.get(prefix + '_B64', '')
    need(len(encoded) <= 4 * ((REQUEST_CAP + 2) // 3) and
         base64.b64decode(encoded, validate=True) == request_raw, 'external request bytes')
    body = pr.get('body')
    need(type(body) is str and len(body.encode('utf-8')) <= 65536, 'bounded event body')
    markers = re.findall(r'<!--\s*' + re.escape(prefix) + r'_SHA256\b.*?-->', body, re.S)
    need(markers == ['<!-- ' + prefix + '_SHA256=' + digest + ' -->'],
         'one exact unmixed event request marker')
    wsha = env.get('GITHUB_WORKFLOW_SHA', '')
    need(GIT_HEX.fullmatch(wsha) and env.get('GITHUB_WORKFLOW_REF') ==
         REPOSITORY + '/' + WORKFLOW + '@refs/pull/' + str(request['pullRequest']) + '/merge',
         'executing workflow merge identity')
    return event


def admitted_request(route, raw, event_raw, env):
    value = request_object(raw)
    names = {'schema', 'repository', 'pullRequest', 'source', 'policySha256', 'limits'}
    if route == 'build':
        names.update(('bochs', 'toolchain'))
    elif route == 'reference':
        names.add('build')
    closed(value, names, 'closed route request')
    need(value['schema'] == 'bw.bochs-ring3.' + route + '-request.v1' and
         value['repository'] == REPOSITORY and HEX.fullmatch(value['policySha256']),
         'route request identity')
    need(canonical(value['limits']) == canonical(LIMITS[route]), 'source-fixed typed exact route limits')
    admit_source_shape(value['source'])
    admit_event(route, value, raw, event_raw, env)
    return value


def selected_source_rows(tree):
    """Metadata only. Never read/fetch an excluded firmware or tool blob."""
    closed(tree, ('sha', 'url', 'tree', 'truncated'), 'complete upstream Git tree response')
    need(tree['sha'] == UPSTREAM_TREE and tree['truncated'] is False and
         type(tree['tree']) is list and len(tree['tree']) == UPSTREAM_ENTRY_COUNT, 'pinned full upstream tree')
    rows = []
    seen = set()
    for entry in tree['tree']:
        path = entry['path']
        need(type(path) is str and path not in seen and not path.startswith('/') and
             all(x not in ('', '.', '..') for x in path.split('/')), 'unique upstream lexical path')
        seen.add(path)
        if entry['type'] == 'tree':
            need(entry['mode'] == '040000', 'ordinary Git tree')
            continue
        need(entry['type'] == 'blob' and entry['mode'] in ('100644', '100755'),
             'no upstream links/submodules')
        name = path.rsplit('/', 1)[-1]
        bios = path.startswith('bochs/bios/')
        excluded = ((bios and name.startswith(('BIOS-bochs-', 'VGABIOS-')) and
                     not name.endswith(('README', 'LICENSE')) and name != 'VGABIOS-lgpl-latest') or
                    (bios and '.bin' in name) or path.endswith('.exe'))
        reason = ('unselected prebuilt firmware/tool; no payload GET' if excluded else
                  'selected LGPL VGA data; correspondence/notice admission still required'
                  if path == VGA_PATH else
                  'selected source/notice/ordinary data; per-component notice review required')
        integer(entry['size'], 0, 16777216, 'bounded upstream blob metadata')
        rows.append({'path': path, 'mode': entry['mode'], 'gitBlob': entry['sha'],
                     'bytes': entry['size'], 'included': not excluded, 'reason': reason})
    rows.sort(key=lambda row: row['path'])
    value = {'schema': 'bw.bochs-ring3.source-selection.v1', 'commit': UPSTREAM_COMMIT,
             'tree': UPSTREAM_TREE, 'rows': rows}
    need(len(rows) == UPSTREAM_BLOB_COUNT and sha256(canonical(value)) == SOURCE_SELECTION_SHA256,
         'exact independently selected included/excluded source census')
    return value


def elf_from_reader(size, read_at):
    """Parse bounded raw ELF structures; works without loading a125MB Node."""
    def take(offset, count):
        need(type(offset) is int and type(count) is int and 0 <= offset <= size and
             0 <= count <= 1048576 and offset + count <= size, "bounded ELF read range")
        raw = read_at(offset, count)
        need(type(raw) is bytes and len(raw) == count, "complete ELF range read")
        return raw
    raw = take(0, 64)
    need(size >= 64 and raw[:7] == b'\x7fELF\x02\x01\x01',
         'ELF64 little-endian version1')
    kind, machine, version = struct.unpack_from('<HHI', raw, 16)
    need(kind in (2, 3) and machine == 62 and version == 1, 'x86-64 EXEC/DYN ELF')
    phoff = struct.unpack_from('<Q', raw, 32)[0]
    ehsize, phsize, phnum = struct.unpack_from('<HHH', raw, 52)
    need(ehsize == 64 and phsize == 56 and 1 <= phnum <= 1024 and
         phoff >= 64 and phoff + phsize * phnum <= size, 'bounded ELF program headers')
    headers = take(phoff, phsize * phnum)
    loads, dynamic, interpreter = [], None, None
    for index in range(phnum):
        tag, flags, offset, address, _physical, extent, memory, alignment = struct.unpack_from(
            '<IIQQQQQQ', headers, index * phsize)
        need(offset + extent <= size and extent <= memory, 'bounded ELF segment')
        if tag == 1:
            loads.append((address, address + extent, offset))
        elif tag == 2:
            need(dynamic is None and extent % 16 == 0 and extent <= 65536,
                 'one bounded ELF dynamic segment')
            dynamic = (offset, extent)
        elif tag == 3:
            need(interpreter is None and 2 <= extent <= 256, 'one bounded ELF interpreter')
            text = take(offset, extent)
            need(text.endswith(b'\0') and b'\0' not in text[:-1], 'ELF interpreter terminator')
            interpreter = text[:-1].decode('ascii')
            need(interpreter == '/lib64/ld-linux-x86-64.so.2', 'selected ELF interpreter')
    need(loads, 'ELF load segments')
    entries, needed_offsets = {}, []
    if dynamic is not None:
        offset, extent = dynamic
        terminated = False
        dynamic_raw = take(offset, extent)
        for at in range(0, extent, 16):
            tag, value = struct.unpack_from('<qQ', dynamic_raw, at)
            if tag == 0:
                terminated = True
                break
            if tag == 1:
                needed_offsets.append(value)
            elif tag in (5, 10, 15, 29):
                need(tag not in entries, 'unique ELF string metadata')
                entries[tag] = value
        need(terminated, 'terminated ELF dynamic segment')
    need(len(needed_offsets) <= 64, 'bounded ELF needed list')
    strings = b''
    if entries or needed_offsets:
        need(5 in entries and 10 in entries and 1 <= entries[10] <= 1048576,
             'bounded ELF string table')
        locations = [offset + entries[5] - start for start, end, offset in loads
                     if start <= entries[5] and entries[5] + entries[10] <= end]
        need(len(locations) == 1, 'one file-backed ELF string table')
        strings = take(locations[0], entries[10])
    def string_at(offset):
        need(offset < len(strings), 'ELF string offset')
        end = strings.find(b'\0', offset)
        need(end >= 0 and end - offset <= 512, 'bounded terminated ELF string')
        return strings[offset:end].decode('ascii')
    needed = [string_at(offset) for offset in needed_offsets]
    need(len(set(needed)) == len(needed) and all(re.fullmatch(r'[A-Za-z0-9+_.-]+', name)
         for name in needed), 'unique lexical needed SONAMEs')
    return {'class': 'ELF64', 'machine': 'x86-64', 'type': 'EXEC' if kind == 2 else 'DYN',
            'interpreter': interpreter, 'needed': needed,
            'rpath': string_at(entries[15]) if 15 in entries else None,
            'runpath': string_at(entries[29]) if 29 in entries else None}


def elf_facts(raw):
    """Static bounded ELF inspection; never invoke ldd or an interpreter."""
    need(type(raw) is bytes, 'ELF original bytes')
    return elf_from_reader(len(raw), lambda offset, count: raw[offset:offset + count])


TOOL_PATHS = {
    'git': '/usr/bin/git', 'python': '/usr/bin/python3.12', 'shell': '/bin/sh',
    'gcc': '/usr/bin/x86_64-linux-gnu-gcc-13',
    'g++': '/usr/bin/x86_64-linux-gnu-g++-13',
    'cc1': '/usr/lib/gcc/x86_64-linux-gnu/13/cc1',
    'cc1plus': '/usr/lib/gcc/x86_64-linux-gnu/13/cc1plus',
    'collect2': '/usr/lib/gcc/x86_64-linux-gnu/13/collect2',
    'lto-wrapper': '/usr/lib/gcc/x86_64-linux-gnu/13/lto-wrapper',
    'lto1': '/usr/lib/gcc/x86_64-linux-gnu/13/lto1',
    'make': '/usr/bin/make', 'as': '/usr/bin/x86_64-linux-gnu-as',
    'ar': '/usr/bin/x86_64-linux-gnu-ar', 'ld': '/usr/bin/x86_64-linux-gnu-ld',
    'ranlib': '/usr/bin/x86_64-linux-gnu-ranlib',
}
NOTICE_PATHS = (
    '/usr/share/doc/gcc-13-base/copyright', '/usr/share/doc/libstdc++6/copyright',
    '/usr/share/doc/libgcc-s1/copyright', '/usr/share/doc/libc6/copyright',
    '/usr/share/common-licenses/LGPL-2.1', '/usr/share/common-licenses/LGPL-3',
    '/usr/share/common-licenses/GPL-3')
for _helper in ('awk', 'sed', 'grep', 'expr', 'tr', 'cut', 'head', 'tail', 'sort',
                'uname', 'rm', 'mkdir', 'cp', 'mv', 'ln', 'cat', 'chmod', 'touch',
                'install', 'printf', 'pwd', 'basename', 'dirname', 'readlink', 'wc',
                'date', 'find', 'test', 'rmdir', 'diff', 'cmp'):
    TOOL_PATHS[_helper] = '/usr/bin/' + _helper
TOOL_ROOTS = ('/usr/bin/', '/usr/lib/', '/usr/lib64/', '/bin/', '/lib/', '/lib64/',
              '/opt/hostedtoolcache/node/22.23.3/x64/',
              '/usr/share/doc/', '/usr/share/common-licenses/')
ALTERNATIVE_LINKS = frozenset(('/etc/alternatives/awk',))


def selected_tool_path(path):
    need(type(path) is str and path.startswith('/') and '\0' not in path and
         all(part not in ('.', '..') for part in path.split('/')) and
         (any(path.startswith(root) for root in TOOL_ROOTS) or path in ALTERNATIVE_LINKS),
         'selected tool/library roots or exact selected alternative link')


def resolve_tool(path, aliases, directory_aliases):
    """Resolve finite lexical aliases with held root-owned link readbacks."""
    import posixpath
    selected_tool_path(path)
    current = path
    visited = set()
    for _ in range(16):
        need(current not in visited, 'no tool alias cycle')
        visited.add(current)
        pieces = current.lstrip('/').split('/')
        changed = False
        for index in range(len(pieces)):
            candidate = '/' + '/'.join(pieces[:index + 1])
            before = os.lstat(candidate)
            need(before.st_uid == before.st_gid == 0, 'root-owned selected tool path')
            if stat.S_ISLNK(before.st_mode):
                text = os.readlink(candidate)
                need(type(text) is str and 1 <= len(text) <= 4096 and '\0' not in text,
                     'bounded tool link text')
                after = os.lstat(candidate)
                need(identity(before) == identity(after), 'stable selected alias identity')
                target = posixpath.normpath(text if text.startswith('/') else
                                           posixpath.join(posixpath.dirname(candidate), text))
                selected_tool_path(target + ('/' if index < len(pieces) - 1 else ''))
                record = {'linkText': text, 'target': target,
                          'before': identity(before), 'after': identity(after)}
                table = directory_aliases if index < len(pieces) - 1 else aliases
                need(candidate not in table or table[candidate] == record, 'same repeated alias')
                table[candidate] = record
                current = posixpath.join(target, *pieces[index + 1:])
                selected_tool_path(current)
                changed = True
                break
            if index < len(pieces) - 1:
                need(stat.S_ISDIR(before.st_mode) and before.st_mode & 0o022 == 0,
                     'safe root-owned selected directory')
        if not changed:
            need(current not in ALTERNATIVE_LINKS, 'selected alternative must be a link, not executable data')
            return current
    raise Refusal('selected alias depth cap')


def observe_toolchain(read=read_regular, resolve=resolve_tool, node_elf=None):
    """Read selected bytes only. Neither this routine nor its callbacks exec."""
    graph = {'files': {}, 'aliases': {}, 'directoryAliases': {}}
    queue = list(TOOL_PATHS.values()) + list(NOTICE_PATHS)
    if node_elf is not None:
        queue.extend('/usr/lib/x86_64-linux-gnu/' + name for name in node_elf['needed'])
        if node_elf['interpreter']:
            queue.append(node_elf['interpreter'])
    total = 0
    while queue:
        path = queue.pop(0)
        path = resolve(path, graph['aliases'], graph['directoryAliases'])
        if path in graph['files']:
            continue
        need(len(graph['files']) < 128 and len(graph['aliases']) <= 128 and
             len(graph['directoryAliases']) <= 32, 'finite selected tool graph')
        raw, observed = read(path, 128 * 1024 * 1024, minimum=1, owner=0)
        total += len(raw)
        need(total <= 256 * 1024 * 1024, 'one-pass tool read budget (two passes <=512MiB)')
        if raw.startswith(b'\x7fELF'):
            observed['elf'] = elf_facts(raw)
            need(observed['elf']['rpath'] is None and observed['elf']['runpath'] is None,
                 'no selected tool RPATH/RUNPATH')
            if observed['elf']['interpreter']:
                queue.append(observed['elf']['interpreter'])
            queue.extend('/usr/lib/x86_64-linux-gnu/' + name for name in observed['elf']['needed'])
        graph['files'][path] = observed
    return graph


def expected_graph(graph):
    """Cross-job comparison excludes host-local inode numbers, never file hash."""
    result = {'files': {}, 'aliases': {}, 'directoryAliases': {}}
    for path, row in graph['files'].items():
        result['files'][path] = {'bytes': row['bytes'], 'sha256': row['sha256'],
                                 'mode': row['before']['mode'], 'uid': row['before']['uid'],
                                 'gid': row['before']['gid'], 'elf': row['elf']}
    for name in ('aliases', 'directoryAliases'):
        result[name] = {path: {'linkText': row['linkText'], 'target': row['target']}
                        for path, row in graph[name].items()}
    return result


def match_expected_graph(graph, selected):
    closed(selected, ('files', 'aliases', 'directoryAliases'), 'selected finite tool graph')
    need(canonical(expected_graph(graph)) == canonical(selected),
         'current typed full tool readback equals independent selection')


def debian_status(raw):
    """Bounded Debian paragraphs, preserving legitimate folded Conffiles."""
    need(type(raw) is bytes and 1 <= len(raw) <= 4 * 1024 * 1024 and b'\0' not in raw,
         'bounded Debian status original')
    text = raw.decode('utf-8')
    need('\r' not in text and text.endswith('\n'), 'Debian status LF grammar')
    packages = []
    for paragraph in text.strip('\n').split('\n\n'):
        need(paragraph, 'nonempty Debian paragraph')
        fields, pending, current = {}, None, None
        for line in paragraph.split('\n'):
            if line.startswith((' ', '\t')):
                need(current is not None and line.strip(' \t'), 'nonempty Debian folded value')
                if pending == current:
                    pending = None
                continue
            need(pending is None, 'empty Debian header needs nonempty folded value')
            match = re.fullmatch(r'([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)', line)
            need(match is not None, 'bounded Debian status field')
            name, value = match.groups()
            current = name.lower()
            need(current not in fields and len(line) <= 65536, 'unique bounded Debian field')
            fields[current] = value
            if not value.strip(' \t'):
                need(current not in ('package', 'status', 'version', 'architecture'),
                     'nonempty Debian authority field')
                pending = current
        need(pending is None and all(name in fields for name in
             ('package', 'status', 'version', 'architecture')), 'complete Debian package authority')
        need(re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', fields['package']) and
             fields['status'] in ('install ok installed', 'deinstall ok config-files'),
             'selected Debian package/status')
        packages.append({name: fields[name] for name in ('package', 'status', 'version', 'architecture')})
    need(len(packages) <= 8192 and len({(p['package'], p['architecture']) for p in packages}) ==
         len(packages), 'bounded unique package census')
    return packages


def child_capture(argv, *, cwd, environment, name, wall_seconds, stream_cap,
                  preexec=None, checkpoint=False, clock=time.monotonic_ns,
                  observe_spawn=None, observe_terminal=None, pass_fds=()):
    """One owned child, bounded raw streams and actual wait4 status.

    No request stdin. Selector construction is inside the guarded lifetime.
    Failure never starts another child and never substitutes a clean exit.
    """
    started = clock()
    need(type(argv) is list and argv and all(type(x) is str and '\0' not in x for x in argv),
         'closed process argv')
    integer(wall_seconds, 1, 900, 'bounded process wall policy')
    integer(stream_cap, 1, 4 * 1024 * 1024, 'bounded process stream policy')
    value = {'name': name, 'argv': argv, 'cwd': os.fspath(cwd), 'environment': environment,
             'startedNs': started, 'endedNs': None, 'pid': None, 'identity': None,
             'waitStatus': None, 'exitCode': None, 'signal': None, 'reaped': False,
             'timedOut': False, 'stdout': None, 'stderr': None,
             'resourcesBefore': None, 'resourcesAfter': None, 'cgroupBefore': None,
             'cgroupAfter': None, 'firstFailure': None, 'secondary': [], 'usage': None}
    stop = {'reason': 'complete-frame', 'signal': signal.SIGTERM, 'sent': False,
            'pid': None, 'sentNs': None, 'frameSha256': None,
            'firstFailure': None, 'secondary': []}
    outputs = {'stdout': bytearray(), 'stderr': bytearray()}
    complete = {'stdout': False, 'stderr': False}
    clipped = set()
    process = None
    selector = None
    pidfd = None
    killed = False
    failure_deadline = None
    last_clock = started
    def retain_error(exc, phase):
        item = failure(exc, phase)
        if value['firstFailure'] is None:
            value['firstFailure'] = item
        elif len(value['secondary']) < SECONDARY_LIMIT:
            value['secondary'].append(item)
    try:
        process = subprocess.Popen(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   close_fds=True, start_new_session=True,
                                   restore_signals=True, preexec_fn=preexec, pass_fds=pass_fds)
        value['pid'] = process.pid
        stop['pid'] = process.pid
        pidfd = os.pidfd_open(process.pid, 0)
        if observe_spawn is not None:
            captured = observe_spawn(process.pid)
            closed(captured, ('identity', 'resourcesBefore', 'cgroupBefore'),
                   'closed child initial observations')
            value.update(captured)
        selector = selectors.DefaultSelector()
        for which in ('stdout', 'stderr'):
            stream = getattr(process, which)
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, which)
        while not value['reaped'] or selector.get_map():
            now = clock()
            need(now >= last_clock, 'monotonic child capture clock')
            last_clock = now
            if value['firstFailure'] is None and now - started >= wall_seconds * 1000000000:
                value['timedOut'] = True
                retain_error(Refusal('owned child wall deadline'), 'child-deadline')
            if value['firstFailure'] is not None and not killed and not value['reaped']:
                # pidfd names exactly the held child, never an arbitrary process.
                try:
                    signal.pidfd_send_signal(pidfd, signal.SIGKILL)
                except BaseException as exc:
                    retain_error(exc, 'owned-child-kill')
                killed = True
                failure_deadline = now + 5000000000
            if value['firstFailure'] is not None and failure_deadline is None:
                failure_deadline = now + 5000000000
            if not value['reaped']:
                pid, status, usage = os.wait4(process.pid, os.WNOHANG)
                need(pid in (0, process.pid), 'owned wait4 PID')
                if pid:
                    value['waitStatus'] = status
                    value['reaped'] = True
                    process.returncode = os.waitstatus_to_exitcode(status)
                    value['exitCode'] = os.WEXITSTATUS(status) if os.WIFEXITED(status) else None
                    value['signal'] = os.WTERMSIG(status) if os.WIFSIGNALED(status) else None
                    value['usage'] = {'userSeconds': usage.ru_utime,
                                      'systemSeconds': usage.ru_stime,
                                      'maxRssKiB': usage.ru_maxrss}
            if failure_deadline is not None and now >= failure_deadline:
                need(value['reaped'] and not selector.get_map(), 'owned terminal reap/drain deadline')
            for key, _events in selector.select(0.025):
                which = key.data
                try:
                    part = os.read(key.fileobj.fileno(), 65536)
                except BlockingIOError:
                    continue
                if not part:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    complete[which] = which not in clipped
                    continue
                room = stream_cap - len(outputs[which])
                outputs[which].extend(part[:room])
                if len(part) > room:
                    clipped.add(which)
                    retain_error(Refusal(which + ' stream cap'), 'child-stream')
                if checkpoint and which == 'stdout' and not stop['sent'] and value['firstFailure'] is None:
                    if len(outputs['stdout']) >= len(expected_header()) + WIRE_BYTES:
                        frame = reporter_frame(bytes(outputs['stdout']))
                        stop['frameSha256'] = sha256(frame)
                        try:
                            signal.pidfd_send_signal(pidfd, signal.SIGTERM)
                            stop['sent'] = True
                            stop['sentNs'] = clock()
                        except BaseException as exc:
                            stop['firstFailure'] = failure(exc, 'checkpoint-stop')
                            raise
            if value['reaped'] and checkpoint and not stop['sent'] and value['firstFailure'] is None:
                retain_error(Refusal('natural/early exit is not a checkpoint stop'), 'checkpoint-stop')
        if checkpoint:
            need(stop['sent'] and value['reaped'] and value['signal'] == signal.SIGTERM and
                 value['exitCode'] is None and value['waitStatus'] is not None and
                 os.WIFSIGNALED(value['waitStatus']) and
                 os.WTERMSIG(value['waitStatus']) == signal.SIGTERM,
                 'sent checkpoint SIGTERM and actual SIGTERM wait4')
            reporter_frame(bytes(outputs['stdout']))
        else:
            need(value['reaped'] and value['exitCode'] == 0 and value['signal'] is None,
                 'ordinary child completed exit0')
    except BaseException as exc:
        retain_error(exc, 'child-capture')
    finally:
        # Covers selector constructor/registration/read/clock exceptions too.
        if process is not None and not value['reaped']:
            if not killed:
                try:
                    if pidfd is not None:
                        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
                    else:
                        # Popen child is unreaped and cannot have a recycled PID.
                        process.kill()
                except BaseException as exc:
                    retain_error(exc, 'owned-child-kill')
            finish = time.monotonic_ns() + 5000000000
            while not value['reaped'] and time.monotonic_ns() < finish:
                try:
                    pid, status, usage = os.wait4(process.pid, os.WNOHANG)
                    if pid:
                        need(pid == process.pid, 'owned final wait4 PID')
                        value['waitStatus'], value['reaped'] = status, True
                        process.returncode = os.waitstatus_to_exitcode(status)
                        value['exitCode'] = os.WEXITSTATUS(status) if os.WIFEXITED(status) else None
                        value['signal'] = os.WTERMSIG(status) if os.WIFSIGNALED(status) else None
                        value['usage'] = {'userSeconds': usage.ru_utime,
                                          'systemSeconds': usage.ru_stime,
                                          'maxRssKiB': usage.ru_maxrss}
                    else:
                        time.sleep(0.01)
                except BaseException as exc:
                    retain_error(exc, 'owned-child-reap')
                    break
            if not value['reaped']:
                retain_error(Refusal('owned child reap remains uncertain'), 'owned-child-reap')
        for which in ('stdout', 'stderr'):
            stream = getattr(process, which, None)
            if stream is not None and not stream.closed:
                try:
                    stream.close()
                except BaseException as exc:
                    retain_error(exc, 'child-' + which + '-close')
        if selector is not None:
            try:
                selector.close()
            except BaseException as exc:
                retain_error(exc, 'child-selector-close')
        if pidfd is not None:
            try:
                os.close(pidfd)
            except BaseException as exc:
                retain_error(exc, 'child-pidfd-close')
        if observe_terminal is not None:
            try:
                captured = observe_terminal(value['pid'], value['reaped'])
                closed(captured, ('resourcesAfter', 'cgroupAfter'), 'closed terminal observations')
                value.update(captured)
            except BaseException as exc:
                retain_error(exc, 'child-post-observation')
        value['endedNs'] = time.monotonic_ns()
        for which in ('stdout', 'stderr'):
            raw = bytes(outputs[which])
            value[which] = {'role': name + '.' + which, 'bytes': len(raw),
                            'sha256': sha256(raw), 'complete': complete[which]}
    return value, {name: bytes(raw) for name, raw in outputs.items()}, stop if checkpoint else None


def preexec_policy(uid, gid, leaf, resources_fd, *, cpu_seconds, file_bytes,
                   observe_before_exec):
    """Source-owned preexec: enter selected cgroup, drop identity, fix signals."""
    integer(uid, 1, 65534, 'nonroot invoker UID')
    integer(gid, 1, 65534, 'nonroot invoker GID')
    def prepare():
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM})
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_bytes, file_bytes))
        # No address-space cap: V8 legitimately reserves a large virtual range.
        fd = os.open(os.fspath(Path(leaf) / 'cgroup.procs'), os.O_WRONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            body = str(os.getpid()).encode('ascii')
            need(os.write(fd, body) == len(body), 'single cgroup child placement')
        finally:
            os.close(fd)
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        observed = {'pid': os.getpid(), 'uid': os.getuid(), 'euid': os.geteuid(),
                    'gid': os.getgid(), 'egid': os.getegid(),
                    'core': list(resource.getrlimit(resource.RLIMIT_CORE)),
                    'nofile': list(resource.getrlimit(resource.RLIMIT_NOFILE)),
                    'cpu': list(resource.getrlimit(resource.RLIMIT_CPU)),
                    'fsize': list(resource.getrlimit(resource.RLIMIT_FSIZE)),
                    'sigtermDefault': signal.getsignal(signal.SIGTERM) == signal.SIG_DFL,
                    'sigtermBlocked': signal.SIGTERM in signal.pthread_sigmask(signal.SIG_BLOCK, set()),
                    'rawBeforeExec': observe_before_exec(os.getpid(), uid, gid)}
        need(observed['uid'] == observed['euid'] == uid and observed['gid'] == observed['egid'] == gid and
             observed['sigtermDefault'] and not observed['sigtermBlocked'],
             'actual preexec identity/signal policy')
        body = canonical(observed)
        need(len(body) <= 16384, 'bounded actual preexec original')
        # Parent created this root-owned file O_EXCL in its protected directory.
        # Child has only this held write capability; no caller-owned pathname.
        # Close it before exec so no guest/compiler inherits a writable handle.
        try:
            offset = 0
            while offset < len(body):
                count = os.write(resources_fd, body[offset:])
                need(count > 0, 'preexec original write progress')
                offset += count
            os.fsync(resources_fd)
        finally:
            os.close(resources_fd)
    return prepare


BOOTSTRAP_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C',
                 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_TERMINAL_PROMPT': '0'}


def bootstrap_git(root, *arguments):
    # Fixed trusted source-authentication tool, not the future compiler graph.
    process, streams, _stop = child_capture(['/usr/bin/git', '--no-replace-objects',
                                            '-c', 'safe.directory=' + os.path.abspath(root), '-C',
                                            os.fspath(root), *arguments],
        cwd=root, environment=BOOTSTRAP_ENV, name='source-git', wall_seconds=45,
        stream_cap=4 * 1024 * 1024)
    need(process['firstFailure'] is None, 'bounded source Git command')
    return streams['stdout']


def observe_source(root, selected, env, workflow_root, git=bootstrap_git, read=read_regular):
    """Authenticate checkoutH and executingW data before any work provider."""
    admit_source_shape(selected)
    head = git(root, 'rev-parse', '--verify', 'HEAD').decode('ascii').strip()
    tree = git(root, 'rev-parse', '--verify', 'HEAD^{tree}').decode('ascii').strip()
    need(head == selected['head'] and tree == selected['tree'], 'exact checkout head/whole tree')
    whead = git(workflow_root, 'rev-parse', '--verify', 'HEAD').decode('ascii').strip()
    need(whead == env['GITHUB_WORKFLOW_SHA'], 'actual workflow data checkout')
    parents = git(workflow_root, 'rev-list', '--parents', '-n', '1', whead).decode('ascii').strip().split()
    need(len(parents) == 3 and parents[0] == whead and parents[2] == head,
         'executing workflow merge parent2 equals producer H')
    wtree = git(workflow_root, 'rev-parse', '--verify', 'HEAD^{tree}').decode('ascii').strip()
    rows = {}
    for path in SOURCE_PATHS:
        expected = selected['files'][path]
        entry = git(root, 'ls-tree', 'HEAD', '--', path).decode('utf-8')
        need(entry == expected['mode'] + ' blob ' + expected['gitBlob'] + '\t' + path + '\n',
             'selected source Git mode/blob')
        blob = git(root, 'cat-file', 'blob', expected['gitBlob'])
        need(len(blob) == expected['bytes'] and sha256(blob) == expected['sha256'],
             'selected source Git bytes')
        named = os.lstat(Path(root) / path)
        raw, observed = read(Path(root) / path, 1048576, minimum=1,
                             owner=named.st_uid, group=named.st_gid)
        need(raw == blob and stat.S_IMODE(observed['before']['mode']) ==
             (0o755 if expected['mode'] == '100755' else 0o644), 'live source equals Git')
        rows[path] = {'mode': expected['mode'], 'gitBlob': expected['gitBlob'],
                      'bytes': len(raw), 'sha256': sha256(raw)}
    wblob = git(workflow_root, 'show', whead + ':' + WORKFLOW)
    need(sha256(wblob) == selected['files'][WORKFLOW]['sha256'],
         'executing workflow bytes equal selected H workflow')
    return {'head': head, 'tree': tree, 'files': rows,
            'workflowCommit': whead, 'workflowTree': wtree,
            'workflowFileSha256': sha256(wblob)}


def original(route, request_raw, event_raw):
    return {'schema': 'bw.bochs-ring3.' + route + '-original.v1',
            'requestSha256': sha256(request_raw), 'eventSha256': sha256(event_raw),
            'sourceBefore': None, 'sourceAfter': None, 'phases': [], 'resources': None,
            'firstFailure': None, 'secondary': [], 'failurePartial': None,
            'complete': False, 'authority': {
                'compilerExecuted': False, 'guestExecuted': False,
                'actualRunApproved': False, 'guestApproved': False,
                'wholeHostAttested': False, 'physicalTimingProved': False},
            'observations': None}


def original_error(value, exc, phase, role=None, path=None):
    item = getattr(exc, 'bochs_first', failure(exc, phase, role, path))
    if value['firstFailure'] is None:
        value['firstFailure'] = item
        value['failurePartial'] = getattr(exc, 'bochs_partial', None)
    elif len(value['secondary']) < SECONDARY_LIMIT:
        value['secondary'].append(item)
    for extra in getattr(exc, 'bochs_secondary', []):
        if len(value['secondary']) < SECONDARY_LIMIT:
            value['secondary'].append(extra)


def original_manifest(roles):
    need(type(roles) is dict and len(roles) <= 4096, 'finite original role map')
    return {'schema': 'bw.bochs-ring3.artifact-manifest.v1',
            'files': {name: {'bytes': len(raw), 'sha256': sha256(raw)}
                      for name, raw in sorted(roles.items())}}


def member_name(name):
    need(type(name) is str and 1 <= len(name) <= 4096 and not name.startswith('/') and
         '\\' not in name and '\0' not in name and ':' not in name and
         all(part not in ('', '.', '..') for part in name.split('/')), 'closed lexical archive member')


def pack_zip(files, *, archive_cap, expanded_cap, member_cap, modes=None):
    """Deterministic authored ZIP; official Actions archive identity is external."""
    need(type(files) is dict and 1 <= len(files) <= member_cap, 'bounded archive member roster')
    need(all(type(raw) is bytes for raw in files.values()) and
         sum(map(len, files.values())) <= expanded_cap, 'bounded expanded archive bytes')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(files.items()):
            member_name(name)
            mode = (modes or {}).get(name, 0o644)
            need(mode in (0o444, 0o555, 0o644, 0o755), 'ordinary selected archive mode')
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    need(len(raw) <= archive_cap, 'compressed archive cap')
    return raw


def unpack_zip(raw, *, archive_cap, expanded_cap, member_cap):
    need(type(raw) is bytes and 1 <= len(raw) <= archive_cap, 'bounded ZIP original')
    result, total = {}, 0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        need(1 <= len(infos) <= member_cap, 'bounded ZIP directory roster')
        for info in infos:
            name = info.filename
            member_name(name)
            mode = info.external_attr >> 16
            need(name not in result and not info.is_dir() and not info.flag_bits & 1 and
                 info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and
                 stat.S_ISREG(mode) and stat.S_IMODE(mode) in (0o444, 0o555, 0o644, 0o755),
                 'unique ordinary unencrypted ZIP member')
            total += info.file_size
            need(info.file_size >= 0 and total <= expanded_cap, 'expanded ZIP cap')
            with archive.open(info) as stream:
                body = stream.read(info.file_size + 1)
                need(len(body) == info.file_size and stream.read(1) == b'', 'complete ZIP member EOF')
            result[name] = body
    return result


def observer_facts(value, env, *, pid, uid, gid, started_ns, ended_ns):
    need(uid == gid == 0, 'source-fixed root metadata observer identity')
    integer(pid, 1, 2 ** 31 - 1, 'observer PID')
    need(type(started_ns) is int and type(ended_ns) is int and
         0 <= started_ns <= ended_ns, 'observer monotonic interval')
    return {'schema': 'bw.bochs-ring3.toolchain-observer.v1', 'pid': pid,
            'uid': uid, 'gid': gid, 'startedNs': started_ns, 'endedNs': ended_ns,
            'requestSha256': value['requestSha256'], 'sourceHead': env['BW_EXPECTED_HEAD'],
            'plannedExitCode': 0 if value['firstFailure'] is None and not value['secondary'] else 1,
            'firstFailure': value['firstFailure'], 'secondary': value['secondary'].copy()}


def collect_toolchain(request_raw, event_raw, env, ops):
    """Connected no-tool-execution metadata producer; ops owns OS/data edges."""
    request = admitted_request('toolchain', request_raw, event_raw, env)
    value = original('toolchain', request_raw, event_raw)
    observations = {'inventoryBefore': None, 'inventoryAfter': None, 'status': None,
                    'sourceSelection': SOURCE_SELECTION_SHA256, 'reportedReadbackOnly': True,
                    'notices': None, 'nodeStage': None}
    value['observations'] = observations
    roles = {'request.original.json': request_raw, 'event.original.json': event_raw}
    phase = 'source-before'
    try:
        value['sourceBefore'] = ops.source(request['source'], env)
        roles['source.before.json'] = canonical(value['sourceBefore'])
        phase = 'resource-before'
        value['resources'] = {'before': ops.resources('toolchain'), 'after': None}
        phase = 'node-cache-data-staging'
        observations['nodeStage'] = ops.node_stage()
        check_node_stage(observations['nodeStage'], 'toolchain', env)
        roles['node-stage.original.json'] = canonical(observations['nodeStage'])
        phase = 'toolchain-inventory-before'
        observations['inventoryBefore'] = ops.toolchain()
        roles['inventory.before.json'] = canonical(observations['inventoryBefore'])
        phase = 'selected-toolchain-notices'
        notices = ops.notices()
        need(type(notices) is dict and set(notices) == set(NOTICE_PATHS),
             'all seven selected licence notice files')
        observations['notices'] = {}
        notice_bytes = 0
        for source_path, (path, raw) in notices.items():
            need(path in observations['inventoryBefore']['files'] and
                 observations['inventoryBefore']['files'][path]['bytes'] == len(raw) and
                 observations['inventoryBefore']['files'][path]['sha256'] == sha256(raw) and
                 1 <= len(raw) <= 262144, 'notice exact selected file readback')
            notice_bytes += len(raw)
            need(notice_bytes <= 524288, 'aggregate retained licence notice text cap')
            observations['notices'][source_path] = {'path': path, 'bytes': len(raw),
                                                   'sha256': sha256(raw), 'text': raw.decode('utf-8')}
        roles['notices.original.json'] = canonical(observations['notices'])
        phase = 'debian-status'
        raw, record = ops.read('/var/lib/dpkg/status', 4 * 1024 * 1024, minimum=1, owner=0)
        roles['dpkg-status.original'] = raw
        observations['status'] = {'bytes': len(raw), 'sha256': sha256(raw),
                                  'packages': debian_status(raw), 'observation': record}
        phase = 'toolchain-inventory-after'
        observations['inventoryAfter'] = ops.toolchain()
        roles['inventory.after.json'] = canonical(observations['inventoryAfter'])
        need(observations['inventoryBefore'] == observations['inventoryAfter'],
             'held inventory before/after complete identity')
        observations['nodeStage'] = ops.node_after(full_hash=False)
        check_node_stage(observations['nodeStage'], 'toolchain', env, after=True)
        roles['node-stage.original.json'] = canonical(observations['nodeStage'])
        need(sum(row['bytes'] for row in observations['inventoryBefore']['files'].values()) * 2 +
             observations['nodeStage']['sourceBytesRead'] + observations['nodeStage']['readbackBytes'] +
             observations['nodeStage']['elfReadBytes'] + notice_bytes <= LIMITS['toolchain']['totalReadBytes'],
             'actual selected tool/Node/notice read budget')
    except BaseException as exc:
        original_error(value, exc, phase)
    finally:
        if value['sourceBefore'] is not None:
            try:
                value['sourceAfter'] = ops.source(request['source'], env)
                roles['source.after.json'] = canonical(value['sourceAfter'])
                need(value['sourceBefore'] == value['sourceAfter'], 'source before/after equality')
            except BaseException as exc:
                original_error(value, exc, 'source-after')
        if value['resources'] is not None:
            try:
                value['resources']['after'] = ops.resources('toolchain')
            except BaseException as exc:
                original_error(value, exc, 'resource-after')
        if value['sourceBefore'] is not None:
            try:
                roles['process.original.json'] = canonical(ops.observer(value))
            except BaseException as exc:
                original_error(value, exc, 'observer-process')
    value['complete'] = value['firstFailure'] is None and not value['secondary']
    roles['original.json'] = canonical(value)
    roles['manifest.json'] = canonical(original_manifest(roles))
    return value, roles


def finalize_original(route, request_raw, event_raw, env, inner, roles,
                      service_exit, client_exit, ops):
    """Outside join is honest even when an inner original was never readable."""
    request = admitted_request(route, request_raw, event_raw, env)
    integer(service_exit, 0, 255, 'actual retained service exit code')
    integer(client_exit, 0, 255, 'actual retained outer client exit code')
    outside = {'schema': 'bw.bochs-ring3.outside.v1', 'route': route,
               'runId': env['GITHUB_RUN_ID'], 'runAttempt': 1,
               'unit': 'bw-bochs-' + route + '-v1-' + env['GITHUB_RUN_ID'] + '-1.service',
               'serviceExitCode': service_exit, 'clientExitCode': client_exit,
               'cleanupExitCode': 1, 'innerComplete': False, 'innerFirstFailure': None,
               'before': None, 'after': None, 'manual': None,
               'firstFailure': None, 'secondary': []}
    def issue(exc, phase):
        item = failure(exc, phase)
        if outside['firstFailure'] is None:
            outside['firstFailure'] = item
        elif len(outside['secondary']) < SECONDARY_LIMIT:
            outside['secondary'].append(item)
    if inner is not None:
        try:
            need(type(inner) is dict and inner.get('schema') ==
                 'bw.bochs-ring3.' + route + '-original.v1' and
                 inner.get('requestSha256') == sha256(request_raw) and
                 inner.get('eventSha256') == sha256(event_raw), 'bound inner original')
            outside['innerComplete'] = inner.get('complete') is True
            outside['innerFirstFailure'] = inner.get('firstFailure')
        except BaseException as exc:
            issue(exc, 'outside-inner-original')
    if service_exit != 0 or client_exit != 0:
        issue(Refusal('retained service/client exit ' + str(service_exit) + '/' + str(client_exit)),
              'outside-service')
    try:
        ops.source(request['source'], env)
        outside['before'] = ops.unit(outside['unit'])
        if route == 'reference':
            outside['manual'] = ops.cleanup()
            roles['cleanup.original.json'] = canonical(outside['manual'])
        outside['after'] = ops.unit(outside['unit'])
        need(outside['after']['exists'] is False and outside['after']['errno'] == 2,
             'outside terminal unit cgroup absent')
        need(inner is not None and outside['innerComplete'] and
             outside['innerFirstFailure'] is None, 'complete inner observation required')
    except BaseException as exc:
        issue(exc, 'outside-cleanup')
    outside['cleanupExitCode'] = 0 if outside['firstFailure'] is None and not outside['secondary'] else 1
    roles['outside.original.json'] = canonical(outside)
    roles['manifest.json'] = canonical(original_manifest({k: v for k, v in roles.items()
                                                         if k != 'manifest.json'}))
    return outside, roles


def run_phase(ops, value, roles, name, argv, *, wall_seconds, checkpoint=False):
    process, streams, stop = ops.process(name, argv, wall_seconds=wall_seconds,
                                       stream_cap=131072 if checkpoint or name == 'js' else 4194304,
                                       checkpoint=checkpoint)
    value['phases'].append(process)
    roles[name + '.stdout'] = streams['stdout']
    roles[name + '.stderr'] = streams['stderr']
    roles[name + '.process.json'] = canonical(process)
    if process['firstFailure'] is not None:
        error = Refusal(process['firstFailure']['message'])
        error.bochs_first = process['firstFailure']
        error.bochs_secondary = process['secondary']
        error.bochs_partial = {'process': process}
        raise error
    need(process['firstFailure'] is None and not process['secondary'] and
         process['reaped'] and process['stdout']['complete'] and process['stderr']['complete'],
         'complete bounded ' + name + ' process originals')
    if checkpoint:
        need(stop is not None and stop['sent'] and stop['signal'] == 15 and
             stop['firstFailure'] is None and not stop['secondary'], 'actual owned checkpoint stop')
    return process, streams, stop


def admit_corresponding_source(value):
    closed(value, ('url', 'bytes', 'sha256', 'licensePath', 'licenseSha256',
                   'version', 'selectedResourceGitBlob'), 'closed corresponding source metadata')
    need(value['url'] == VGA_SOURCE_URL and value['bytes'] == VGA_SOURCE_BYTES and
         value['sha256'] == VGA_SOURCE_SHA256 and value['version'] == '0.8a' and
         value['selectedResourceGitBlob'] == VGA_BLOB and
         value['licensePath'] == 'vgabios-0.8a/COPYING' and value['licenseSha256'] == VGA_LICENSE_SHA256,
         'source-fixed exact reviewed VGA corresponding source')


def admit_build_inputs(request):
    source = request['bochs']
    closed(source, ('repository', 'commit', 'tree', 'sourceSelectionSha256', 'vga'),
           'closed Bochs build source')
    need(source['repository'] == UPSTREAM and source['commit'] == UPSTREAM_COMMIT and
         source['tree'] == UPSTREAM_TREE and source['sourceSelectionSha256'] == SOURCE_SELECTION_SHA256,
         'fixed upstream source selection')
    vga = source['vga']
    closed(vga, ('path', 'gitBlob', 'bytes', 'noticePath', 'noticeGitBlob', 'correspondingSource'),
           'closed selected VGA metadata')
    need(vga['path'] == VGA_PATH and vga['gitBlob'] == VGA_BLOB and vga['bytes'] == VGA_BYTES and
         vga['noticePath'] == 'bochs/bios/VGABIOS-lgpl-README' and
         vga['noticeGitBlob'] == '5240eaf7622609fc4465a7f392a11c73680c562f', 'selected LGPL VGA/notice')
    admit_corresponding_source(vga['correspondingSource'])
    toolchain = request['toolchain']
    closed(toolchain, ('files', 'aliases', 'directoryAliases', 'inventory', 'node'),
           'independently selected Build toolchain')
    closed(toolchain['node'], ('cachePath', 'bytes', 'sha256', 'elf', 'stageMode', 'stageUid', 'stageGid'),
           'selected immutable Node expectation')
    integer(toolchain['node']['bytes'], NODE_BYTES, NODE_BYTES, 'typed exact Node extent')
    integer(toolchain['node']['stageMode'], stat.S_IFREG | 0o555, stat.S_IFREG | 0o555,
            'typed exact Node executable mode')
    need(toolchain['node']['cachePath'] == NODE_PATH and toolchain['node']['bytes'] == NODE_BYTES and
         toolchain['node']['sha256'] == NODE_SHA256 and toolchain['node']['stageMode'] == stat.S_IFREG | 0o555 and
         type(toolchain['node']['stageUid']) is int and toolchain['node']['stageUid'] == 0 and
         type(toolchain['node']['stageGid']) is int and toolchain['node']['stageGid'] == 0,
         'source-fixed Node DATA pin and readonly executable expectation')
    inventory = toolchain['inventory']
    closed(inventory, ('runId', 'jobId', 'artifactId', 'archiveBytes', 'archiveSha256',
                       'requestSha256', 'reportSha256', 'sourceHead', 'sourceTree', 'workflowCommit'),
           'closed pre-Build inventory reference')
    need(re.fullmatch(r'[1-9][0-9]{0,19}', inventory['runId']) and
         inventory['sourceHead'] == request['source']['head'] and
         inventory['sourceTree'] == request['source']['tree'], 'same frozen inventory/build source')
    for name in ('jobId', 'artifactId'):
        integer(inventory[name], 1, 2 ** 63 - 1, 'positive inventory official ID')
    integer(inventory['archiveBytes'], 1, 8 * 1024 * 1024, 'bounded inventory archive')
    need(all(HEX.fullmatch(inventory[name]) for name in
             ('archiveSha256', 'requestSha256', 'reportSha256')) and
         GIT_HEX.fullmatch(inventory['workflowCommit']), 'inventory exact immutable references')


CONFIGURE_ARGS = ('--enable-cpu-level=3', '--with-nogui', '--disable-plugins',
                  '--disable-debugger', '--enable-all-optimizations')
CONFIGURE_ARGV = ['/bin/sh', './configure', *CONFIGURE_ARGS]
MAKE_ARGV = ['/usr/bin/make', '-j1', 'bochs']
NODE_PATH = '/opt/hostedtoolcache/node/22.23.3/x64/bin/node'
NODE_BYTES = 124827920
NODE_SHA256 = 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
COMPACT_MARKER = 'BW_BOCHS_RING3_BUILD_MANIFEST_V1='
BOCHSRC_TEMPLATE = b'''display_library: nogui
memory: guest=16, host=16
romimage: file=@ROOT@/inputs/fixture.rom, address=0xf0000
vgaromimage: file=@ROOT@/resources/vgabios.bin
cpu: count=1, ips=10000000
port_e9_hack: enabled=1
log: @ROOT@/outputs/bochs.log
panic: action=fatal
error: action=report
info: action=report
debug: action=ignore
mouse: enabled=0
clock: sync=none, time0=0
'''


def bytes_ref(path, raw):
    return {'path': path, 'bytes': len(raw), 'sha256': sha256(raw)}


def configure_facts(raw, version_raw):
    need(1 <= len(raw) <= 1048576 and 1 <= len(version_raw) <= 16384,
         'bounded generated configuration/version headers')
    text = raw.decode('ascii')
    values = {}
    for name, value in re.findall(r'^#define[ \t]+(BX_[A-Z0-9_]+)[ \t]+([0-9]+)[ \t]*$', text, re.M):
        need(name not in values, 'unique generated configuration definition')
        values[name] = int(value)
    need(all(values.get(name) == number for name, number in
             (('BX_CPU_LEVEL', 3), ('BX_WITH_NOGUI', 1), ('BX_PLUGINS', 0), ('BX_DEBUGGER', 0))),
         'actual generated CPU3/nogui/no-plugin/no-debugger configuration')
    for name in ('X11', 'SDL', 'SDL2', 'WX', 'TERM', 'RFB', 'VNCSRV'):
        need(values.get('BX_WITH_' + name, 0) == 0, 'no additional generated display library')
    version = version_raw.decode('ascii')
    expected = {'VERSION': '"2.7"', 'VER_SVNFLAG': '0',
                'REL_STRING': '"Built from SVN snapshot on August  1, 2021"',
                'REL_TIMESTAMP': '"Sun Aug  1 10:07:00 CEST 2021"'}
    definitions = re.findall(r'^#define[ \t]+(VERSION|VER_SVNFLAG|REL_STRING|REL_TIMESTAMP)[ \t]+(.+?)[ \t]*$',
                             version, re.M)
    need(len(definitions) == 4 and dict(definitions) == expected, 'exact source-derived generated version header')
    return {'definitions': values, 'version': expected,
            'headerSha256': sha256(expected_header())}


def compact_build_manifest(request, manifest_raw, runtime_raw, manifest):
    def compact_ref(raw):
        return {'bytes': len(raw), 'sha256': sha256(raw)}
    binary = next(row for row in manifest['runtimeMembers'] if row['path'] == 'bin/bochs')
    value = {'schema': 'bw.bochs-ring3.build-manifest-compact.v1',
             'sourceHead': request['source']['head'], 'sourceTree': request['source']['tree'],
             'sourceFilesSha256': sha256(canonical(request['source']['files'])),
             'bochsCommit': UPSTREAM_COMMIT, 'bochsTree': UPSTREAM_TREE,
             'policySha256': request['policySha256'],
             'fullManifest': compact_ref(manifest_raw),
             'runtimeZip': compact_ref(runtime_raw),
             'binary': {name: binary[name] for name in ('bytes', 'sha256')},
             'configHeader': {name: manifest['configHeader'][name] for name in ('bytes', 'sha256')},
             'runtimeMembersSha256': sha256(canonical(manifest['runtimeMembers'])),
             'noticesSha256': sha256(canonical(manifest['notices'])),
             'buildCompleted': True, 'guestExecuted': False}
    encoded = canonical(value)
    need(len(encoded) <= 16384 and len(COMPACT_MARKER) + len(base64.b64encode(encoded)) <= 32768,
         'bounded complete Build log manifest')
    return value


def runtime_rows(files, modes):
    result = []
    for path, raw in sorted(files.items()):
        if path == 'bin/bochs':
            role = 'executable'
        elif path.startswith('lib/'):
            role = 'library'
        elif path.startswith('notices/'):
            role = 'notice'
        elif path == 'config/bochsrc.template':
            role = 'config'
        elif path == 'inputs/fixture.rom':
            role = 'rom'
        elif path == 'inputs/fixture.json':
            role = 'fixture'
        elif path == 'resources/vgabios.bin':
            role = 'vga'
        elif path == 'asset-manifest.json':
            role = 'manifest'
        else:
            raise Refusal('unassigned runtime member role')
        need(path in modes and modes[path] in (0o444, 0o555), 'explicit readonly runtime member mode')
        result.append({'path': path, 'role': role, 'mode': stat.S_IFREG | modes[path],
                       'bytes': len(raw), 'sha256': sha256(raw)})
    return result


def assemble_runtime(source, binary, rom, fixture_raw, vga, *, host_node,
                     libraries, notices):
    """Pure packaging of already observed bytes. No executable is run here."""
    need(type(binary) is bytes and 1 <= len(binary) <= 33554432, 'bounded nonempty compiled binary')
    facts = elf_facts(binary)
    need(facts['rpath'] is None and facts['runpath'] is None, 'no Bochs RPATH/RUNPATH')
    need(type(rom) is bytes and len(rom) == ROM_BYTES and sha256(rom) == ROM_SHA256,
         'unchanged authored fixture ROM')
    fixture = raw_object(fixture_raw, 1048576)
    need(fixture.get('schema') == 'bw.ring3.fixture.v1' and fixture.get('romSha256') == ROM_SHA256 and
         fixture.get('romBytes') == ROM_BYTES and fixture.get('wireBytes') == WIRE_BYTES and
         fixture.get('cpuProfile') == 'strict386' and fixture.get('deliverFaults') is False,
         'unchanged fixture generation profile')
    need(len(vga) == VGA_BYTES and sha256(vga) == VGA_SHA256 and
         hashlib.sha1(b'blob ' + str(len(vga)).encode('ascii') + b'\0' + vga).hexdigest() == VGA_BLOB,
         'exact source-selected nonempty LGPL VGA resource')
    closed(host_node, ('cachePath', 'bytes', 'sha256', 'elf', 'stageMode', 'stageUid', 'stageGid'),
           'closed cache-DATA to owned executable Node observation')
    need(host_node['cachePath'] == NODE_PATH and host_node['bytes'] == NODE_BYTES and
         host_node['sha256'] == NODE_SHA256 and host_node['stageMode'] == stat.S_IFREG | 0o555 and
         host_node['stageUid'] == host_node['stageGid'] == 0,
         'source-fixed Node cache identity and immutable executable stage')
    files = {'bin/bochs': binary, 'inputs/fixture.rom': rom, 'inputs/fixture.json': fixture_raw,
             'resources/vgabios.bin': vga, 'config/bochsrc.template': BOCHSRC_TEMPLATE}
    modes = {name: 0o555 if name == 'bin/bochs' else 0o444 for name in files}
    bindings = {}
    loader = None
    need(type(libraries) is dict and 1 <= len(libraries) <= 128, 'finite retained ELF closure')
    for original_path, item in sorted(libraries.items()):
        selected_tool_path(original_path)
        closed(item, ('members', 'raw'), 'closed observed library payload')
        library = item['raw']
        observed = elf_facts(library)
        need(observed['rpath'] is None and observed['runpath'] is None and
             type(item['members']) is list and 1 <= len(item['members']) <= 8 and
             len(set(item['members'])) == len(item['members']), 'finite exact library member bindings')
        members = []
        for name in item['members']:
            need(re.fullmatch(r'lib/[A-Za-z0-9+_.-]+', name) and name not in files,
                 'unique ordinary source-selected SONAME member')
            files[name] = library
            modes[name] = 0o555 if name == 'lib/ld-linux-x86-64.so.2' else 0o444
            members.append(name)
            if name == 'lib/ld-linux-x86-64.so.2':
                need(loader is None, 'one retained staged loader')
                loader = {'path': original_path, 'member': name, 'bytes': len(library),
                          'sha256': sha256(library), 'elf': observed}
        bindings[original_path] = {'members': members, 'bytes': len(library),
                                   'sha256': sha256(library), 'elf': observed}
    need(loader is not None, 'retained selected loader')
    library_by_member = {member: item['elf'] for item in bindings.values() for member in item['members']}
    pending = ['lib/' + name for name in facts['needed'] + host_node['elf']['needed']]
    pending.append('lib/ld-linux-x86-64.so.2')
    reached = set()
    while pending:
        member = pending.pop()
        if member in reached:
            continue
        need(member in library_by_member, 'every selected DT_NEEDED has retained bytes')
        reached.add(member)
        pending.extend('lib/' + name for name in library_by_member[member]['needed'])
    need(reached == set(library_by_member), 'exact needed ELF closure, no extraneous library executable')
    notice_rows = []
    need(type(notices) is dict and notices, 'closed retained source/runtime notice graph')
    for name, raw in sorted(notices.items()):
        member_name(name)
        need(name.startswith('notices/') and name not in files and type(raw) is bytes and
             1 <= len(raw) <= 33554432, 'nonempty selected notice/source member')
        files[name], modes[name] = raw, 0o444
        notice_rows.append({'path': name, 'role': 'notice', 'mode': stat.S_IFREG | 0o444,
                            'bytes': len(raw), 'sha256': sha256(raw)})
    need('notices/vgabios-corresponding-source.tar.gz' in files and
         len(files['notices/vgabios-corresponding-source.tar.gz']) == VGA_SOURCE_BYTES and
         sha256(files['notices/vgabios-corresponding-source.tar.gz']) == VGA_SOURCE_SHA256,
         'retained exact complete VGA corresponding source TAR')
    asset = {'schema': 'bw.bochs-ring3.runtime-assets.v1',
             'source': {'head': source['head'], 'tree': source['tree'],
                        'filesSha256': sha256(canonical(source['files']))},
             'bochsSource': {'commit': UPSTREAM_COMMIT, 'tree': UPSTREAM_TREE,
                             'sourceSelectionSha256': SOURCE_SELECTION_SHA256},
             'hostNode': host_node, 'loader': loader, 'bindings': bindings,
             'files': runtime_rows(files, modes)}
    files['asset-manifest.json'] = canonical(asset)
    modes['asset-manifest.json'] = 0o444
    need(sum(map(len, files.values())) <= 67108864 and len(files) <= 256,
         'bounded complete runtime package')
    return {'files': files, 'modes': modes, 'notices': notice_rows}


NODE_METADATA_FIELDS = ('dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtime_ns', 'ctime_ns')


def node_stage_directory(route, env):
    need(route in ROUTES and re.fullmatch(r'[1-9][0-9]{0,19}', env.get('GITHUB_RUN_ID', '')) and
         env.get('GITHUB_RUN_ATTEMPT') == '1', 'source-derived first-attempt Node stage path')
    return Path('/run/bw-bochs-' + route + '-v1-' + env['GITHUB_RUN_ID'] + '-1-node')


class NodeStageCopy:
    """Adapted from the held MIT NodeStageCopy: cache DATA never executes.

    Exactly one copy, exclusive private root destination, full independent
    reopen/hash, then readonly publication. No actual copy runs in controls.
    """
    def __init__(self, route, env, invoker):
        self.path = node_stage_directory(route, env)
        self.invoker = tuple(invoker)
        need(len(self.invoker) == 2 and all(type(x) is int and 1 <= x < 2 ** 31 for x in self.invoker),
             'source-authenticated nonroot Node cache invoker identity')
        self.fds, self.bindings = {}, {}
        self.attempted = False
        self.facts = {'schema': 'bw.bochs-ring3.node-stage.v1', 'sourcePath': NODE_PATH,
            'stagePath': str(self.path / 'node'), 'recordPath': str(self.path / 'stage.json'),
            'invoker': {'uid': invoker[0], 'gid': invoker[1]},
            'metadataFields': list(NODE_METADATA_FIELDS), 'created': [],
            'sourceBefore': None, 'sourceAfter': None, 'sourceNamedAfter': None,
            'sourceBytesRead': 0, 'bytesCopied': 0, 'writeUncertain': False,
            'copiedSha256': None, 'readbackBytes': 0, 'readbackSha256': None,
            'elfReadBytes': 0, 'elf': None, 'fileBeforePublication': None,
            'parents': {}, 'directoryInitial': None, 'fileInitial': None,
            'targetAfterFailure': None, 'directoryAfterFailure': None,
            'lastOperation': None,
            'file': None, 'fileNamed': None, 'directoryBeforePublication': None,
            'directory': None, 'directoryNamed': None,
            'filePublicationAttempted': False, 'directoryPublicationAttempted': False,
            'filePublished': False, 'directoryPublished': False, 'record': None,
            'checkedAfter': None,
            'firstFailure': None, 'secondary': []}
    @staticmethod
    def metadata(info):
        return [getattr(info, 'st_' + name) for name in NODE_METADATA_FIELDS]
    def error(self, exc, phase):
        current = self.facts['lastOperation'] or {}
        item = failure(exc, phase, current.get('role'), current.get('path'))
        if self.facts['firstFailure'] is None:
            self.facts['firstFailure'] = item
        elif len(self.facts['secondary']) < SECONDARY_LIMIT:
            self.facts['secondary'].append(item)
    def directory(self, path):
        self.facts['lastOperation'] = {'role': 'node-stage-directory', 'path': str(path), 'operation': 'open/readback'}
        parent = self.fds.get(path.parent)
        fd = os.open(path if parent is None else path.name,
                     os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                     **({} if parent is None else {'dir_fd': parent}))
        self.fds[path] = fd
        held, named = self.metadata(os.fstat(fd)), self.metadata(path.lstat())
        need(path.resolve(strict=True) == path and held == named and stat.S_ISDIR(held[2]) and
             held[3:5] == [0, 0] and held[2] & 0o022 == 0, 'held root-owned Node-stage directory')
        self.bindings[path] = held
        if path == self.path:
            self.facts['directoryInitial'] = held
        else:
            self.facts['parents'][str(path)] = {'before': held, 'namedBefore': named,
                                               'after': None, 'namedAfter': None}
        return fd
    def recheck(self):
        for path, fd in self.fds.items():
            self.facts['lastOperation'] = {'role': 'node-stage-directory', 'path': str(path), 'operation': 'held/named readback'}
            held, named = self.metadata(os.fstat(fd)), self.metadata(path.lstat())
            need(held[:5] == named[:5] == self.bindings[path][:5] and
                 path.resolve(strict=True) == path, 'Node-stage parent first-five identity')
            if str(path) in self.facts['parents']:
                self.facts['parents'][str(path)]['after'] = held
                self.facts['parents'][str(path)]['namedAfter'] = named
    def close_fd(self, fd, phase, role=None, path=None):
        if fd is not None:
            self.facts['lastOperation'] = {'role': role, 'path': path, 'operation': 'close-held'}
            try:
                os.close(fd)
            except BaseException as exc:
                self.error(exc, phase)
    def copy(self):
        need(not self.attempted, 'Node stage consumed; no copy retry')
        try:
            return self._copy()
        except BaseException as exc:
            if self.facts['firstFailure'] is None:
                self.error(exc, 'node-stage')
            exc.bochs_partial = {'nodeStage': self.facts}
            exc.bochs_first = self.facts['firstFailure']
            exc.bochs_secondary = self.facts['secondary']
            raise
    def _copy(self):
        need(not self.attempted, 'Node stage consumed; no copy retry')
        self.attempted = True
        source_fd = target_fd = None
        try:
            need(os.getresuid() == (0, 0, 0) and os.getresgid() == (0, 0, 0), 'root-only Node data staging')
            self.directory(Path('/'))
            parent = self.directory(Path('/run'))
            self.recheck()
            os.mkdir(self.path.name, 0o700, dir_fd=parent)
            self.facts['created'].append(str(self.path))
            directory = self.directory(self.path)
            need(stat.S_IMODE(self.bindings[self.path][2]) == 0o700, 'private unpublished Node stage')
            source = Path(NODE_PATH)
            self.facts['lastOperation'] = {'role': 'node-cache-data', 'path': NODE_PATH, 'operation': 'open/readback'}
            need(source.resolve(strict=True) == source, 'canonical fixed Node cache DATA path')
            source_fd = os.open(NODE_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
            before = self.metadata(os.fstat(source_fd))
            self.facts['sourceBefore'] = before
            need(before == self.metadata(source.lstat()) and stat.S_ISREG(before[2]) and
                 before[5] == 1 and before[6] == NODE_BYTES and before[2] & 0o6000 == 0 and
                 tuple(before[3:5]) in ((0, 0), self.invoker),
                 'bounded single-link Node cache DATA, not executable authority')
            self.facts['lastOperation'] = {'role': 'node-staged-executable', 'path': str(self.path / 'node'), 'operation': 'exclusive create'}
            target_fd = os.open('node', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
                                os.O_NONBLOCK | os.O_CLOEXEC, 0o600, dir_fd=directory)
            self.facts['created'].append(str(self.path / 'node'))
            first = self.metadata(os.fstat(target_fd))
            self.facts['fileInitial'] = first
            need(stat.S_ISREG(first[2]) and stat.S_IMODE(first[2]) == 0o600 and
                 first[3:7] == [0, 0, 1, 0], 'fresh nonexecutable root Node output')
            digest = hashlib.sha256()
            prefix = b''
            while True:
                self.facts['lastOperation'] = {'role': 'node-cache-data', 'path': NODE_PATH, 'operation': 'bounded read'}
                chunk = os.read(source_fd, min(65536, NODE_BYTES + 1 - self.facts['sourceBytesRead']))
                if not chunk:
                    break
                self.facts['sourceBytesRead'] += len(chunk)
                need(self.facts['sourceBytesRead'] <= NODE_BYTES, 'fixed Node data copy cap')
                digest.update(chunk)
                prefix = (prefix + chunk)[:4]
                try:
                    self.facts['lastOperation'] = {'role': 'node-staged-executable', 'path': str(self.path / 'node'), 'operation': 'once-only chunk write'}
                    written = os.write(target_fd, chunk)
                except BaseException:
                    self.facts['writeUncertain'] = True
                    raise
                need(type(written) is int and 0 <= written <= len(chunk), 'bounded Node chunk write')
                self.facts['bytesCopied'] += written
                need(written == len(chunk), 'complete once-only Node chunk write')
            self.facts['copiedSha256'] = digest.hexdigest()
            self.facts['lastOperation'] = {'role': 'node-cache-data', 'path': NODE_PATH, 'operation': 'held/named after readback'}
            self.facts['sourceAfter'] = self.metadata(os.fstat(source_fd))
            self.facts['sourceNamedAfter'] = self.metadata(source.lstat())
            need(self.facts['sourceBytesRead'] == self.facts['bytesCopied'] == NODE_BYTES and
                 digest.hexdigest() == NODE_SHA256 and prefix == b'\x7fELF' and
                 before == self.facts['sourceAfter'] == self.facts['sourceNamedAfter'] and
                 source.resolve(strict=True) == source, 'fixed Node bytes and source held/named stability')
            need(self.metadata(os.fstat(target_fd))[3:7] == [0, 0, 1, NODE_BYTES], 'complete private Node output')
            self.facts['lastOperation'] = {'role': 'node-staged-executable', 'path': str(self.path / 'node'), 'operation': 'fsync'}
            os.fsync(target_fd)
        except BaseException as exc:
            self.error(exc, 'node-copy')
            for key, observe in (
                ('sourceAfter', lambda: os.fstat(source_fd) if source_fd is not None else None),
                ('sourceNamedAfter', lambda: Path(NODE_PATH).lstat() if source_fd is not None else None),
                ('targetAfterFailure', lambda: os.fstat(target_fd) if target_fd is not None else None),
                ('directoryAfterFailure', lambda: os.fstat(self.fds[self.path]) if self.path in self.fds else None)):
                try:
                    info = observe()
                    if info is not None:
                        self.facts[key] = self.metadata(info)
                except BaseException as extra:
                    self.error(extra, 'node-copy-failure-stat')
        finally:
            self.close_fd(target_fd, 'node-copy-target-close', 'node-staged-executable', str(self.path / 'node'))
            self.close_fd(source_fd, 'node-copy-source-close', 'node-cache-data', NODE_PATH)
        if self.facts['firstFailure'] is not None:
            error = Refusal(self.facts['firstFailure']['message'])
            error.bochs_partial = {'nodeStage': self.facts}
            raise error
        self.recheck()
        directory = self.fds[self.path]
        fd = None
        try:
            self.facts['lastOperation'] = {'role': 'node-staged-executable', 'path': str(self.path / 'node'), 'operation': 'independent reopen/hash'}
            fd = os.open('node', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                         dir_fd=directory)
            before = self.metadata(os.fstat(fd))
            need(before == self.metadata(os.stat('node', dir_fd=directory, follow_symlinks=False)) and
                 stat.S_ISREG(before[2]) and stat.S_IMODE(before[2]) == 0o600 and
                 before[3:7] == [0, 0, 1, NODE_BYTES], 'independent root Node reopen')
            self.facts['fileBeforePublication'] = before
            digest = hashlib.sha256()
            while True:
                chunk = os.read(fd, min(65536, NODE_BYTES + 1 - self.facts['readbackBytes']))
                if not chunk:
                    break
                self.facts['readbackBytes'] += len(chunk)
                need(self.facts['readbackBytes'] <= NODE_BYTES, 'independent Node readback cap')
                digest.update(chunk)
            self.facts['readbackSha256'] = digest.hexdigest()
            need(self.facts['readbackBytes'] == NODE_BYTES and digest.hexdigest() == NODE_SHA256 and
                 before == self.metadata(os.fstat(fd)) ==
                 self.metadata(os.stat('node', dir_fd=directory, follow_symlinks=False)),
                 'independent complete Node bytes before executable publication')
            def read_at(offset, count):
                self.facts['elfReadBytes'] += count
                need(self.facts['elfReadBytes'] <= 2097152, 'bounded staged Node ELF range reads')
                return os.pread(fd, count, offset)
            self.facts['elf'] = elf_from_reader(NODE_BYTES, read_at)
            need(self.facts['elf']['rpath'] is None and self.facts['elf']['runpath'] is None,
                 'staged Node has no RPATH/RUNPATH')
            self.facts['filePublicationAttempted'] = True
            os.fchmod(fd, 0o555)
            self.facts['file'] = self.metadata(os.fstat(fd))
            self.facts['fileNamed'] = self.metadata(os.stat('node', dir_fd=directory, follow_symlinks=False))
            need(stat.S_IMODE(self.facts['file'][2]) == 0o555 and
                 self.facts['file'][3:7] == [0, 0, 1, NODE_BYTES] and
                 self.facts['file'][:2] == before[:2] and self.facts['file'] == self.facts['fileNamed'],
                 'readonly root Node file publication')
            self.facts['filePublished'] = True
        except BaseException as exc:
            self.error(exc, 'node-readback-publication')
            if fd is not None:
                try:
                    self.facts['targetAfterFailure'] = self.metadata(os.fstat(fd))
                except BaseException as extra:
                    self.error(extra, 'node-publication-failed-stat')
        finally:
            self.close_fd(fd, 'node-readback-close', 'node-staged-executable', str(self.path / 'node'))
        if self.facts['firstFailure'] is not None:
            error = Refusal(self.facts['firstFailure']['message'])
            error.bochs_partial = {'nodeStage': self.facts}
            raise error
        self.recheck()
        record = canonical({'schema': 'bw.bochs-ring3.node-installation.v1', 'sourcePath': NODE_PATH,
                            'stagePath': self.facts['stagePath'], 'bytes': NODE_BYTES,
                            'sha256': NODE_SHA256, 'uid': 0, 'gid': 0, 'mode': stat.S_IFREG | 0o555})
        fd = None
        try:
            self.facts['lastOperation'] = {'role': 'node-stage-record', 'path': str(self.path / 'stage.json'), 'operation': 'exclusive create/readback'}
            fd = os.open('stage.json', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
                         os.O_NONBLOCK | os.O_CLOEXEC, 0o600, dir_fd=directory)
            self.facts['created'].append(str(self.path / 'stage.json'))
            need(os.write(fd, record) == len(record), 'once-only Node installation record write')
            os.fchmod(fd, 0o444)
            os.lseek(fd, 0, os.SEEK_SET)
            before = self.metadata(os.fstat(fd))
            need(stat.S_ISREG(before[2]) and stat.S_IMODE(before[2]) == 0o444 and
                 before[3:7] == [0, 0, 1, len(record)] and os.read(fd, len(record) + 1) == record and
                 before == self.metadata(os.fstat(fd)) ==
                 self.metadata(os.stat('stage.json', dir_fd=directory, follow_symlinks=False)),
                 'root readonly exact Node installation record')
            self.facts['record'] = {'bytes': len(record), 'sha256': sha256(record),
                                    'metadata': before, 'text': record.decode('utf-8')}
        except BaseException as exc:
            self.error(exc, 'node-record')
        finally:
            self.close_fd(fd, 'node-record-close', 'node-stage-record', str(self.path / 'stage.json'))
        if self.facts['firstFailure'] is None:
            try:
                self.recheck()
                self.facts['directoryBeforePublication'] = self.metadata(os.fstat(directory))
                self.facts['directoryPublicationAttempted'] = True
                self.facts['lastOperation'] = {'role': 'node-stage-directory', 'path': str(self.path), 'operation': 'readonly publication'}
                os.fchmod(directory, 0o555)
                self.facts['directory'] = self.metadata(os.fstat(directory))
                self.facts['directoryNamed'] = self.metadata(self.path.lstat())
                need(stat.S_IMODE(self.facts['directory'][2]) == 0o555 and
                     self.facts['directory'][3:5] == [0, 0] and
                     self.facts['directory'][:2] == self.bindings[self.path][:2] and
                     self.facts['directory'] == self.facts['directoryNamed'],
                     'root readonly Node directory publication')
                self.bindings[self.path] = self.facts['directory']
                self.facts['directoryPublished'] = True
                self.recheck()
            except BaseException as exc:
                self.error(exc, 'node-directory-publication')
                try:
                    self.facts['directoryAfterFailure'] = self.metadata(os.fstat(directory))
                except BaseException as extra:
                    self.error(extra, 'node-directory-failed-stat')
        if self.facts['firstFailure'] is not None:
            error = Refusal(self.facts['firstFailure']['message'])
            error.bochs_partial = {'nodeStage': self.facts}
            raise error
        return self.facts
    def verify_after(self, *, full_hash):
        """No Node invocation in inventory: immutable identity check suffices there.

        Build/reference reread the full staged executable after work. Neither
        copies nor executes the mutable original-cache pathname again.
        """
        need(self.facts['firstFailure'] is None and self.facts['filePublished'] and
             self.facts['directoryPublished'], 'successful Node publication before verification')
        self.recheck()
        fd = None
        observed = {'hashRead': full_hash, 'bytesRead': 0, 'sha256': None,
                    'before': None, 'after': None, 'named': None, 'elf': None, 'elfReadBytes': 0}
        try:
            directory = self.fds[self.path]
            fd = os.open('node', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                         dir_fd=directory)
            observed['before'] = self.metadata(os.fstat(fd))
            need(observed['before'] == self.facts['file'], 'same readonly staged Node before after-check')
            if full_hash:
                digest = hashlib.sha256()
                while True:
                    chunk = os.read(fd, min(65536, NODE_BYTES + 1 - observed['bytesRead']))
                    if not chunk:
                        break
                    observed['bytesRead'] += len(chunk)
                    need(observed['bytesRead'] <= NODE_BYTES, 'staged Node after-read cap')
                    digest.update(chunk)
                observed['sha256'] = digest.hexdigest()
                need(observed['bytesRead'] == NODE_BYTES and digest.hexdigest() == NODE_SHA256,
                     'complete staged Node after-execution byte identity')
                def read_at(offset, count):
                    observed['elfReadBytes'] += count
                    need(observed['elfReadBytes'] <= 2097152, 'bounded Node after ELF range reads')
                    return os.pread(fd, count, offset)
                observed['elf'] = elf_from_reader(NODE_BYTES, read_at)
                need(observed['elf'] == self.facts['elf'], 'staged Node after ELF identity')
            observed['after'] = self.metadata(os.fstat(fd))
            observed['named'] = self.metadata(os.stat('node', dir_fd=directory, follow_symlinks=False))
            need(observed['before'] == observed['after'] == observed['named'],
                 'staged Node complete held/named after-check')
        except BaseException as exc:
            self.error(exc, 'node-after-verification')
        finally:
            self.close_fd(fd, 'node-after-verification-close', 'node-staged-executable', str(self.path / 'node'))
            self.facts['checkedAfter'] = observed
        if self.facts['firstFailure'] is not None:
            error = Refusal(self.facts['firstFailure']['message'])
            error.bochs_partial = {'nodeStage': self.facts}
            raise error
        return self.facts
    def close(self):
        fds = list(reversed(list(self.fds.items())))
        self.fds = {}
        for path, fd in fds:
            self.close_fd(fd, 'node-stage-parent-close', 'node-stage-directory', str(path))


def node_expectation(facts):
    return {'cachePath': facts['sourcePath'], 'bytes': facts['file'][6],
            'sha256': facts['readbackSha256'], 'elf': facts['elf'],
            'stageMode': facts['file'][2], 'stageUid': facts['file'][3],
            'stageGid': facts['file'][4]}


def check_node_stage(facts, route, env, *, after=False):
    need(type(facts) is dict and facts.get('schema') == 'bw.bochs-ring3.node-stage.v1',
         'typed cache-DATA/readonly-executable Node stage')
    path = node_stage_directory(route, env)
    need(facts['sourcePath'] == NODE_PATH and facts['stagePath'] == str(path / 'node') and
         facts['recordPath'] == str(path / 'stage.json') and
         facts['metadataFields'] == list(NODE_METADATA_FIELDS), 'source-derived Node role paths')
    def meta(row):
        need(type(row) is list and len(row) == 9 and
             all(type(value) is int and value >= 0 for value in row) and row[1] > 0,
             'typed nine-field Node identity')
        return row
    invoker = facts['invoker']
    closed(invoker, ('uid', 'gid'), 'source-authenticated Node invoker')
    integer(invoker['uid'], 1, 2 ** 31 - 1, 'Node invoker UID')
    integer(invoker['gid'], 1, 2 ** 31 - 1, 'Node invoker GID')
    source = meta(facts['sourceBefore'])
    need(source == meta(facts['sourceAfter']) == meta(facts['sourceNamedAfter']) and
         stat.S_ISREG(source[2]) and source[2] & 0o6000 == 0 and source[5:7] == [1, NODE_BYTES] and
         tuple(source[3:5]) in ((0, 0), (invoker['uid'], invoker['gid'])),
         'bounded fixed Node cache DATA identity (not executable permission)')
    initial, before, final = meta(facts['fileInitial']), meta(facts['fileBeforePublication']), meta(facts['file'])
    need(initial[2:7] == [stat.S_IFREG | 0o600, 0, 0, 1, 0] and
         before[2:7] == [stat.S_IFREG | 0o600, 0, 0, 1, NODE_BYTES] and
         final[2:7] == [stat.S_IFREG | 0o555, 0, 0, 1, NODE_BYTES] and
         initial[:2] == before[:2] == final[:2] and final == meta(facts['fileNamed']),
         'fresh root0600 copy becomes same readonly0555 executable')
    first_dir = meta(facts['directoryInitial'])
    before_dir, final_dir = meta(facts['directoryBeforePublication']), meta(facts['directory'])
    need(first_dir[2:5] == before_dir[2:5] == [stat.S_IFDIR | 0o700, 0, 0] and
         final_dir[2:5] == [stat.S_IFDIR | 0o555, 0, 0] and
         first_dir[:2] == before_dir[:2] == final_dir[:2] and
         final_dir == meta(facts['directoryNamed']), 'fresh private root directory readonly publication')
    need(set(facts['parents']) == {'/', '/run'}, 'closed Node-stage parent roster')
    for row in facts['parents'].values():
        closed(row, ('before', 'namedBefore', 'after', 'namedAfter'), 'Node parent raw readbacks')
        snapshots = [meta(row[key]) for key in ('before', 'namedBefore', 'after', 'namedAfter')]
        need(all(snap[:5] == snapshots[0][:5] for snap in snapshots) and
             stat.S_ISDIR(snapshots[0][2]) and snapshots[0][3:5] == [0, 0] and
             snapshots[0][2] & 0o022 == 0, 'held/named root-parent first-five continuity')
    need(facts['created'] == [str(path), str(path / 'node'), str(path / 'stage.json')] and
         facts['sourceBytesRead'] == facts['bytesCopied'] == facts['readbackBytes'] == NODE_BYTES and
         facts['copiedSha256'] == facts['readbackSha256'] == NODE_SHA256 and
         facts['writeUncertain'] is False and facts['filePublicationAttempted'] is True and
         facts['directoryPublicationAttempted'] is True and facts['filePublished'] is True and
         facts['directoryPublished'] is True and facts['firstFailure'] is None and facts['secondary'] == [],
         'once-only complete independent Node hash/publication observations')
    integer(facts['elfReadBytes'], 1, 2097152, 'bounded staged Node ELF range reads')
    need(type(facts['elf']) is dict and facts['elf']['class'] == 'ELF64' and
         facts['elf']['machine'] == 'x86-64' and facts['elf']['rpath'] is None and
         facts['elf']['runpath'] is None, 'source-observed staged Node ELF')
    record = facts['record']
    closed(record, ('bytes', 'sha256', 'metadata', 'text'), 'closed readonly Node installation record')
    expected = canonical({'schema': 'bw.bochs-ring3.node-installation.v1', 'sourcePath': NODE_PATH,
                          'stagePath': str(path / 'node'), 'bytes': NODE_BYTES,
                          'sha256': NODE_SHA256, 'uid': 0, 'gid': 0, 'mode': stat.S_IFREG | 0o555})
    need(record['text'].encode('utf-8') == expected and record['bytes'] == len(expected) and
         record['sha256'] == sha256(expected) and
         meta(record['metadata'])[2:7] == [stat.S_IFREG | 0o444, 0, 0, 1, len(expected)],
         'exact readonly source-bound Node record bytes')
    if after:
        checked = facts['checkedAfter']
        closed(checked, ('hashRead', 'bytesRead', 'sha256', 'before', 'after', 'named', 'elf', 'elfReadBytes'),
               'Node after-use observations')
        need(meta(checked['before']) == meta(checked['after']) == meta(checked['named']) == final,
             'same immutable staged Node after work')
        if route == 'toolchain':
            need(checked['hashRead'] is False and checked['bytesRead'] == 0 and
                 checked['sha256'] is None and checked['elf'] is None and checked['elfReadBytes'] == 0,
                 'metadata route does not claim an unperformed after hash or Node execution')
        else:
            need(checked['hashRead'] is True and checked['bytesRead'] == NODE_BYTES and
                 checked['sha256'] == NODE_SHA256 and checked['elf'] == facts['elf'],
                 'actual staged Node after-execution complete hash/ELF')
            integer(checked['elfReadBytes'], 1, 2097152, 'bounded Node after ELF range-read count')
    return facts


def collect_build(request_raw, event_raw, env, ops):
    request = admitted_request('build', request_raw, event_raw, env)
    admit_build_inputs(request)
    value = original('build', request_raw, event_raw)
    observations = {name: None for name in ('upstream', 'sourceSelection', 'toolchainBefore',
        'toolchainAfter', 'configure', 'configHeader', 'compilerCommands', 'binary',
        'runtimeManifest', 'notices', 'compactManifest', 'correspondingSource', 'nodeStage')}
    value['observations'] = observations
    roles = {'request.original.json': request_raw, 'event.original.json': event_raw}
    phase = 'source-before'
    manifest = None
    runtime_raw = None
    try:
        value['sourceBefore'] = ops.source(request['source'], env)
        roles['source.before.json'] = canonical(value['sourceBefore'])
        value['resources'] = {'before': ops.resources('build'), 'after': None}
        phase = 'node-cache-data-staging'
        observations['nodeStage'] = ops.node_stage()
        check_node_stage(observations['nodeStage'], 'build', env)
        roles['node-stage.original.json'] = canonical(observations['nodeStage'])
        phase = 'build-toolchain-before'
        observations['toolchainBefore'] = ops.toolchain()
        roles['toolchain.before.json'] = canonical(observations['toolchainBefore'])
        selected = {name: request['toolchain'][name] for name in ('files', 'aliases', 'directoryAliases')}
        match_expected_graph(observations['toolchainBefore'], selected)
        need(node_expectation(observations['nodeStage']) == request['toolchain']['node'],
             'current staged Node equals independent inventory selection')
        phase = 'source-payload-acquisition'
        upstream = ops.upstream(request['bochs'])
        observations['sourceSelection'] = selected_source_rows(upstream['tree'])
        observations['upstream'] = upstream['before']
        observations['correspondingSource'] = upstream['correspondingSource']
        roles['upstream.tree.original.json'] = canonical(upstream['tree'])
        roles['source-selection.original.json'] = canonical(observations['sourceSelection'])
        roles['upstream.before.json'] = canonical(upstream['before'])
        roles['source-selected.original.tar.gz'] = upstream['sourceArchive']
        roles['notices/vgabios-corresponding-source.tar.gz'] = upstream['correspondingSourceRaw']
        need(len(upstream['correspondingSourceRaw']) == VGA_SOURCE_BYTES and
             sha256(upstream['correspondingSourceRaw']) == VGA_SOURCE_SHA256,
             'exact complete corresponding source original')
        phase = 'configure'
        value['authority']['compilerExecuted'] = None
        process, streams, _stop = run_phase(ops, value, roles, 'configure', CONFIGURE_ARGV,
                                           wall_seconds=900)
        config_raw, version_raw = ops.generated_headers()
        observations['configure'] = configure_facts(config_raw, version_raw)
        observations['configHeader'] = bytes_ref('config.h.original', config_raw)
        roles['config.h.original'], roles['bxversion.h.original'] = config_raw, version_raw
        phase = 'make'
        _process, streams, _stop = run_phase(ops, value, roles, 'make', MAKE_ARGV, wall_seconds=900)
        commands = [line for line in streams['stdout'].decode('utf-8').splitlines()
                    if TOOL_PATHS['gcc'] in line or TOOL_PATHS['g++'] in line]
        need(1 <= len(commands) <= 8192 and all(len(line) <= 8192 for line in commands),
             'bounded retained actual compiler commands')
        need(len(canonical(commands)) <= 1048576, 'compiler command summary budget within original cap')
        observations['compilerCommands'] = commands
        phase = 'static-build-assets'
        assembled = ops.runtime_bundle(request, upstream)
        runtime_files = assembled['files']
        need('asset-manifest.json' in runtime_files and 'bin/bochs' in runtime_files,
             'closed retained runtime assets')
        binary = runtime_files['bin/bochs']
        binary_facts = elf_facts(binary)
        need(binary_facts['rpath'] is None and binary_facts['runpath'] is None,
             'built Bochs has no RPATH/RUNPATH')
        observations['binary'] = {**bytes_ref('bin/bochs', binary), 'elf': binary_facts}
        value['authority']['compilerExecuted'] = True
        runtime_raw = pack_zip(runtime_files, archive_cap=33554432, expanded_cap=67108864,
                               member_cap=256, modes=assembled['modes'])
        roles['runtime.original.zip'] = runtime_raw
        observations['runtimeManifest'] = raw_object(runtime_files['asset-manifest.json'], 4194304)
        observations['notices'] = assembled['notices']
        phase = 'upstream-source-after'
        after = ops.upstream_after()
        roles['upstream.after.json'] = canonical(after)
        need(after == upstream['before'], 'selected upstream complete source before/after equality')
        phase = 'build-toolchain-after'
        observations['toolchainAfter'] = ops.toolchain()
        roles['toolchain.after.json'] = canonical(observations['toolchainAfter'])
        match_expected_graph(observations['toolchainAfter'], selected)
        need(observations['toolchainBefore'] == observations['toolchainAfter'],
             'held local tool graph before/after full identity')
        observations['nodeStage'] = ops.node_after(full_hash=True)
        check_node_stage(observations['nodeStage'], 'build', env, after=True)
        roles['node-stage.original.json'] = canonical(observations['nodeStage'])
        manifest = {'schema': 'bw.bochs-ring3.build-manifest.v1', 'source': request['source'],
            'bochsSource': upstream['before'],
            'sourceInventory': {'selection': observations['sourceSelection'],
                'before': upstream['before'], 'after': after,
                'archive': bytes_ref('source-selected.original.tar.gz', upstream['sourceArchive'])},
            'toolchainInventory': {'selected': request['toolchain'],
                'before': observations['toolchainBefore'], 'after': observations['toolchainAfter']},
            'configure': {'argv': CONFIGURE_ARGV, 'makeArgv': MAKE_ARGV,
                'facts': observations['configure'],
                'versionHeader': bytes_ref('bxversion.h.original', version_raw)},
            'configHeader': observations['configHeader'],
            'compilerCommands': commands, 'elf': binary_facts,
            'runtimeMembers': runtime_rows(runtime_files, assembled['modes']),
            'notices': assembled['notices'], 'sourceAfter': None,
            'firstFailure': None, 'secondary': [],
            'buildCompleted': True, 'guestExecuted': False}
    except BaseException as exc:
        original_error(value, exc, phase)
    finally:
        if value['sourceBefore'] is not None:
            try:
                value['sourceAfter'] = ops.source(request['source'], env)
                roles['source.after.json'] = canonical(value['sourceAfter'])
                need(value['sourceBefore'] == value['sourceAfter'], 'Build source before/after equality')
            except BaseException as exc:
                original_error(value, exc, 'source-after')
        if value['resources'] is not None:
            try:
                value['resources']['after'] = ops.resources('build')
            except BaseException as exc:
                original_error(value, exc, 'resource-after')
    value['complete'] = value['firstFailure'] is None and not value['secondary']
    if value['complete']:
        try:
            manifest['sourceAfter'] = value['sourceAfter']
            manifest_raw = canonical(manifest)
            need(len(manifest_raw) <= 4194304, 'bounded full build manifest')
            roles['build-manifest.json'] = manifest_raw
            observations['compactManifest'] = compact_build_manifest(request, manifest_raw, runtime_raw, manifest)
            roles['compact-manifest.json'] = canonical(observations['compactManifest'])
        except BaseException as exc:
            original_error(value, exc, 'build-manifest')
            value['complete'] = False
    roles['build.original.json'] = canonical(value)
    roles['manifest.json'] = canonical(original_manifest(roles))
    return value, roles


def dispatch(route, request_raw, event_raw, env, ops_factory):
    need(route in ROUTES, 'known source-owned route')
    enabled = {'toolchain': TOOLCHAIN_ENABLED, 'build': BUILD_ENABLED,
               'reference': REFERENCE_ENABLED}[route]
    need(enabled is True, 'Bochs source route inactive; no host factory or input execution')
    request = admitted_request(route, request_raw, event_raw, env)
    if route == 'build':
        admit_build_inputs(request)
    ops = ops_factory(request, env)
    if route == 'toolchain':
        return collect_toolchain(request_raw, event_raw, env, ops)
    if route == 'build':
        return collect_build(request_raw, event_raw, env, ops)
    return collect_reference(request_raw, event_raw, env, ops)
