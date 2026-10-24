#!/usr/bin/env python3
"""Independent, bounded Bochs Ring 3 original reader.

This module never imports the producer or runs a compiler, tool, or guest.
Official API authority is supplied separately as exact retained originals and
an externally reviewed expectation; local file contents cannot grant it.
"""

import argparse
import base64
import binascii
import hashlib
import io
import json
import math
import os
import posixpath
import re
import signal
import stat
import struct
import sys
import tarfile
import zipfile
import zlib
from pathlib import Path


REPOSITORY = 'CrispStrobe/bw-board'
BOCHS_COMMIT = '0e45b736ef9792eb9b752b0a35db49eaf2faea47'
BOCHS_TREE = '1b5e0f45ecea9efee6654c69f6437ef5f7e6b44d'
SOURCE_SELECTION_SHA256 = '02a7dce1ad1ff290278e1a12dfa0ba550b3b1df783cc93f4d624e1372d168fc6'
VGA_PATH = 'bochs/bios/VGABIOS-lgpl-latest'
VGA_BLOB = '122aba4255a09e3021f9b605fce03294530797f9'
VGA_SOURCE_BYTES = 174452
VGA_SOURCE_SHA256 = '481042240ef0f1c918780c92a6bb42ad4d3f5d989b29502fa7ee7faf13a041b9'
VGA_SELECTED_BYTES = 38400
VGA_SELECTED_SHA256 = 'de5663dccb7309409d31419948158c561bdc52f90095f42c094a793c634938aa'
VGA_COPYING_SHA256 = 'c43e067abce73ca284383f4f905316e7cad6dd9aaf69f02ee961b6dfbc4de3c2'
VGA_NOTICE_BLOB = '5240eaf7622609fc4465a7f392a11c73680c562f'
NODE_CACHE_PATH = '/opt/hostedtoolcache/node/22.23.3/x64/bin/node'
NODE_BYTES = 124827920
NODE_SHA256 = 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
NODE_METADATA_FIELDS = ('dev', 'ino', 'mode', 'uid', 'gid', 'nlink',
                        'size', 'mtime_ns', 'ctime_ns')
HEADER_SHA256 = '6018ddf9aa6a75233d423a94d427c68708a1122f4b64c5cee2412d65bef12b79'
ROM_SHA256 = 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529'
FIXTURE_JSON_SHA256 = '5784090f18b0c114e5723ea9234173c040a0d290d94c0211b99b12b1161cd670'
FRAME_MAGIC = b'BW-RING3-V1\n'
FRAME_END = b'\nBW-RING3-END\n'
BUILD_USER_STEPS = (
    'Checkout selected producer source',
    'Checkout executing workflow source',
    'Admit Bochs build source and request',
    'Prepare pinned Node input cache',
    'Build pinned Bochs CPU3 and retain originals',
    'Retain Bochs build originals',
)
INVENTORY_USER_STEPS = (
    'Checkout selected producer source',
    'Checkout executing workflow source',
    'Admit Bochs toolchain inventory source and request',
    'Prepare pinned Node input cache',
    'Read selected Bochs toolchain files without execution',
    'Retain Bochs toolchain inventory originals',
)
REFERENCE_USER_STEPS = (
    'Checkout selected producer source',
    'Checkout executing workflow source',
    'Admit Bochs reference source and request',
    'Prepare pinned Node input cache',
    'Capture fresh JavaScript and Bochs unchanged wire',
    'Retain Bochs reference originals',
)
BUILD_FIXED_ROLES = frozenset(('request.original.json event.original.json '
    'source.before.json source.after.json node-stage.original.json '
    'upstream.tree.original.json '
    'source-selection.original.json upstream.before.json upstream.after.json '
    'toolchain.before.json toolchain.after.json build.original.json '
    'build-manifest.json compact-manifest.json runtime.original.zip '
    'source-selected.original.tar.gz config.h.original bxversion.h.original '
    'configure.stdout configure.stderr configure.process.json make.stdout '
    'make.stderr make.process.json '
    'notices/vgabios-corresponding-source.tar.gz manifest.json').split())
INVENTORY_ROLES = frozenset(('request.original.json event.original.json '
    'source.before.json source.after.json inventory.before.json '
    'inventory.after.json dpkg-status.original notices.original.json '
    'node-stage.original.json process.original.json '
    'outside.original.json original.json manifest.json').split())
NOTICE_PATHS = frozenset((
    '/usr/share/doc/gcc-13-base/copyright',
    '/usr/share/doc/libstdc++6/copyright',
    '/usr/share/doc/libgcc-s1/copyright',
    '/usr/share/doc/libc6/copyright',
    '/usr/share/common-licenses/LGPL-2.1',
    '/usr/share/common-licenses/LGPL-3',
    '/usr/share/common-licenses/GPL-3'))
REQUIRED_TOOL_PATHS = (
    '/usr/bin/git', '/usr/bin/python3.12', '/bin/sh',
    '/usr/bin/x86_64-linux-gnu-gcc-13',
    '/usr/bin/x86_64-linux-gnu-g++-13',
    '/usr/lib/gcc/x86_64-linux-gnu/13/cc1',
    '/usr/lib/gcc/x86_64-linux-gnu/13/cc1plus',
    '/usr/lib/gcc/x86_64-linux-gnu/13/collect2',
    '/usr/lib/gcc/x86_64-linux-gnu/13/lto-wrapper',
    '/usr/lib/gcc/x86_64-linux-gnu/13/lto1',
    '/usr/bin/make', '/usr/bin/x86_64-linux-gnu-as',
    '/usr/bin/x86_64-linux-gnu-ar', '/usr/bin/x86_64-linux-gnu-ld',
    '/usr/bin/x86_64-linux-gnu-ranlib',
    *(f'/usr/bin/{name}' for name in
      ('awk', 'sed', 'grep', 'expr', 'tr', 'cut', 'head', 'tail',
       'sort', 'uname', 'rm', 'mkdir', 'cp', 'mv', 'ln', 'cat',
       'chmod', 'touch', 'install', 'printf', 'pwd', 'basename',
       'dirname', 'readlink', 'wc', 'date', 'find', 'test',
       'rmdir', 'diff', 'cmp')),
    *sorted(NOTICE_PATHS))
REFERENCE_ROLES = frozenset(('request.original.json event.original.json '
    'source.before.json source.after.json node-stage.original.json '
    'inputs/build.original.zip '
    'inputs/fixture.rom inputs/fixture.json asset.before.json '
    'asset.after.json bochsrc.original resources.json js/report.json '
    'js/observations.json js/writes.json js/memory.before.bin '
    'js/memory.after.bin js/stdout js/stderr js/process.json bochs/stdout '
    'bochs/stderr bochs/process.json bochs/log bochs/frame.original '
    'outside.original.json cleanup.original.json original.json manifest.json').split())
INVENTORY_CAPS = {'compressed': 8 << 20, 'expanded': 16 << 20,
                  'members': 16, 'json': 4 << 20}
BUILD_CAPS = {'compressed': 64 << 20, 'expanded': 256 << 20,
              'members': 4096, 'json': 4 << 20}
REFERENCE_CAPS = {'compressed': 96 << 20, 'expanded': 384 << 20,
                  'members': 6144, 'json': 4 << 20}
RUNTIME_CAPS = {'compressed': 32 << 20, 'expanded': 64 << 20,
                'members': 256, 'json': 4 << 20}
TOOLCHAIN_READER_ENABLED = False
BUILD_READER_ENABLED = False
REFERENCE_READER_ENABLED = False


class Refusal(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise Refusal(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value, length=64):
    require(type(value) is str and re.fullmatch('[0-9a-f]{%d}' % length, value),
            'exact lowercase digest')
    return value


def integer(value, low=0, high=2**63 - 1):
    require(type(value) is int and low <= value <= high, 'bounded exact integer')
    return value


def fields(value, names):
    require(type(value) is dict and set(value) == set(names.split()),
            'closed original fields')
    return value


def strict_equal(left, right):
    if type(left) is not type(right):
        return False
    if type(left) is dict:
        return set(left) == set(right) and all(strict_equal(left[key], right[key])
                                               for key in left)
    if type(left) is list:
        return len(left) == len(right) and all(strict_equal(a, b)
                                               for a, b in zip(left, right))
    return left == right


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'),
                       ensure_ascii=False, allow_nan=False) + '\n').encode()


def parse_json(raw, cap, *, canonical_wire=False):
    require(type(raw) is bytes and 0 < len(raw) <= cap, 'bounded JSON original')

    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate JSON field')
            result[key] = value
        return result

    def finite(token):
        value = float(token)
        require(math.isfinite(value), 'nonfinite JSON number')
        return value

    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                           parse_float=finite,
                           parse_constant=lambda _: (_ for _ in ()).throw(
                               Refusal('nonfinite JSON constant')))
    except (UnicodeError, json.JSONDecodeError, OverflowError) as error:
        raise Refusal('malformed bounded JSON original') from error
    if canonical_wire:
        require(canonical(value) == raw, 'canonical JSON original bytes')
    return value


def read_regular(path, cap, *, allow_empty=False):
    """Read one explicitly selected local original with held/named identity."""
    path = Path(path).absolute()
    before = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(before.st_mode)
            and before.st_nlink == 1 and
            (0 if allow_empty else 1) <= before.st_size <= cap,
            'selected canonical regular original extent')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)

    def identity(row):
        return (row.st_dev, row.st_ino, row.st_mode, row.st_uid, row.st_gid,
                row.st_nlink, row.st_size, row.st_mtime_ns)

    try:
        require(identity(os.fstat(fd)) == identity(before),
                'selected held/named original identity')
        chunks = bytearray()
        while len(chunks) <= cap:
            part = os.read(fd, min(65536, cap + 1 - len(chunks)))
            if not part:
                break
            chunks.extend(part)
        require(not part and len(chunks) == before.st_size and
                identity(os.fstat(fd)) == identity(before) ==
                identity(path.lstat()), 'complete selected original readback')
        return bytes(chunks)
    finally:
        os.close(fd)


def safe_member(name):
    require(type(name) is str and 0 < len(name.encode('utf-8')) <= 256 and
            name.isascii() and not name.startswith('/') and '\\' not in name and
            all(part not in ('', '.', '..') and
                re.fullmatch('[A-Za-z0-9_.+@-]+', part)
                for part in name.split('/')), 'safe selected archive member')
    return name


class ExpandedBudget:
    def __init__(self, maximum, members):
        self.maximum = maximum
        self.member_maximum = members
        self.expanded = 0
        self.members = 0

    def add(self, amount):
        self.expanded += amount
        self.members += 1
        require(self.expanded <= self.maximum and
                self.members <= self.member_maximum,
                'cumulative expanded archive/member cap')

    def charge_bytes(self, amount):
        self.expanded += amount
        require(0 <= amount and self.expanded <= self.maximum,
                'cumulative expanded archive metadata cap')


def zip_directory_count(raw, maximum):
    """Refuse an oversized central roster before ZipFile materializes it."""
    offset = raw.rfind(b'PK\x05\x06', max(0, len(raw) - 65557))
    require(offset >= 0 and len(raw) - offset >= 22,
            'bounded ZIP end directory')
    disk, start_disk, on_disk, count, directory_bytes, directory_offset, comment = (
        struct.unpack_from('<HHHHIIH', raw, offset + 4))
    require(disk == start_disk == 0 and on_disk == count and
            count <= maximum and count != 0xffff and
            directory_bytes != 0xffffffff and directory_offset != 0xffffffff and
            offset + 22 + comment == len(raw) and
            directory_offset + directory_bytes <= offset,
            'single-disk finite non-ZIP64 original roster')
    return count


def archive_members(raw, caps, *, budget=None, allowed=None,
                    per_member=None, metadata=None):
    """Decode a closed ZIP with header bounds before streamed inflation."""
    require(type(raw) is bytes and 0 < len(raw) <= caps['compressed'],
            'bounded ZIP original bytes')
    count = zip_directory_count(raw, caps['members'])
    if budget is None:
        budget = ExpandedBudget(caps['expanded'], caps['members'])
    result = {}
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except (ValueError, zipfile.BadZipFile) as error:
        raise Refusal('malformed original ZIP') from error
    with archive:
        rows = archive.infolist()
        require(len(rows) == count, 'ZIP directory roster equality')
        for row in rows:
            name = safe_member(row.filename)
            mode = row.external_attr >> 16
            require(name not in result and not row.is_dir() and
                    not row.flag_bits & 1 and row.compress_type in (0, 8) and
                    stat.S_IFMT(mode) == stat.S_IFREG and
                    stat.S_IMODE(mode) & 0o022 == 0,
                    'ordinary unique unencrypted ZIP member')
            if allowed is not None:
                require(name in allowed, 'unknown ZIP role')
            if metadata is not None:
                metadata[name] = {'mode': mode, 'bytes': row.file_size,
                                  'compressedBytes': row.compress_size,
                                  'crc32': row.CRC}
            cap = caps['expanded'] if per_member is None else per_member(name)
            require(0 <= row.file_size <= cap and
                    0 <= row.compress_size <= caps['compressed'],
                    'selected member header cap')
            budget.add(row.file_size)
            data = bytearray()
            try:
                with archive.open(row) as handle:
                    while True:
                        part = handle.read(min(65536, cap + 1 - len(data)))
                        if not part:
                            break
                        data.extend(part)
                        require(len(data) <= cap, 'streamed member byte cap')
            except (OSError, RuntimeError, EOFError, zipfile.BadZipFile) as error:
                raise Refusal('incomplete selected ZIP member') from error
            require(len(data) == row.file_size, 'ZIP member full extent')
            result[name] = bytes(data)
    if allowed is not None:
        require(set(result) == set(allowed), 'complete exact ZIP role roster')
    return result, budget


def tar_members(raw, *, compressed_cap, expanded_cap, member_cap,
                budget=None, allowed=None, metadata=None):
    """Read selected source/notice TAR only; no extraction or external hooks."""
    require(type(raw) is bytes and 0 < len(raw) <= compressed_cap,
            'bounded selected source TAR bytes')
    if budget is None:
        budget = ExpandedBudget(expanded_cap, member_cap)
    inflater = zlib.decompressobj(wbits=31)
    inflated = bytearray()
    try:
        for offset in range(0, len(raw), 65536):
            part = inflater.decompress(raw[offset:offset + 65536],
                                       expanded_cap + 1 - len(inflated))
            inflated.extend(part)
            require(len(inflated) <= expanded_cap and
                    not inflater.unconsumed_tail,
                    'bounded selected TAR inflation')
        require(inflater.eof and not inflater.unused_data,
                'complete single selected TAR gzip stream')
    except zlib.error as error:
        raise Refusal('malformed selected TAR gzip') from error
    result = {}
    try:
        archive = tarfile.open(fileobj=io.BytesIO(inflated), mode='r:')
    except (OSError, EOFError, tarfile.TarError) as error:
        raise Refusal('malformed selected source TAR') from error
    with archive:
        for row in archive:
            name = safe_member(row.name)
            require(name not in result and (row.isfile() or row.isdir()) and
                    not row.issym() and not row.islnk() and not row.isdev() and
                    row.size >= 0 and row.size <= expanded_cap,
                    'ordinary unique selected TAR member')
            if allowed is not None:
                require(name in allowed, 'unselected TAR path')
            if metadata is not None:
                metadata[name] = {'mode': row.mode, 'uid': row.uid,
                                  'gid': row.gid, 'mtime': row.mtime,
                                  'kind': 'directory' if row.isdir() else 'regular'}
            budget.add(row.size)
            if row.isdir():
                require(row.size == 0, 'empty TAR directory')
                result[name] = None
                continue
            data = bytearray()
            try:
                handle = archive.extractfile(row)
                require(handle is not None, 'selected regular TAR payload')
                with handle:
                    while True:
                        part = handle.read(min(65536, row.size + 1 - len(data)))
                        if not part:
                            break
                        data.extend(part)
                        require(len(data) <= row.size, 'TAR stream exceeds header')
            except (OSError, EOFError, tarfile.TarError) as error:
                raise Refusal('incomplete selected source TAR member') from error
            require(len(data) == row.size, 'complete selected TAR extent')
            result[name] = bytes(data)
    budget.charge_bytes(len(inflated) - sum(len(value) for value in result.values()
                                            if value is not None))
    if allowed is not None:
        require(set(result) == set(allowed), 'complete selected TAR roster')
    return result, budget


def selected_source_tar(raw, selected, *, budget=None):
    """Rehash every selected upstream payload without reading excluded blobs."""
    metadata = {}
    members, budget = tar_members(raw, compressed_cap=64 << 20,
                                  expanded_cap=256 << 20, member_cap=4096,
                                  budget=budget, metadata=metadata)
    regular = {name: data for name, data in members.items() if data is not None}
    require(set(regular) == set(selected) and
            all(data is None for name, data in members.items()
                if name not in selected), 'selected source TAR contains exact rows')
    for name, data in regular.items():
        row = selected[name]
        expected_mode = 0o755 if row['mode'] == '100755' else 0o644
        meta = metadata[name]
        git_payload = b'blob ' + str(len(data)).encode() + b'\0' + data
        require(meta['kind'] == 'regular' and
                meta['mode'] & 0o777 == expected_mode and
                meta['uid'] == meta['gid'] == 0 and
                len(data) == row['bytes'] and
                hashlib.sha1(git_payload).hexdigest() == row['gitBlob'],
                'independently rehashed selected source Git blob and mode')
    return {'selectedFiles': len(regular),
            'selectedBytes': sum(map(len, regular.values())),
            'tarSha256': sha(raw)}, budget


def vga_corresponding_source(raw, *, budget=None):
    require(type(raw) is bytes and len(raw) == VGA_SOURCE_BYTES and
            sha(raw) == VGA_SOURCE_SHA256,
            'exact independently reviewed complete LGPL VGA source archive')
    members, source_budget = tar_members(raw,
                                         compressed_cap=VGA_SOURCE_BYTES,
                                         expanded_cap=1 << 20, member_cap=31)
    if budget is not None:
        budget.charge_bytes(source_budget.expanded)
        for _ in range(source_budget.members):
            budget.add(0)
    else:
        budget = source_budget
    require(len(members) == 31 and
            members.get('vgabios-0.8a/VGABIOS-lgpl-latest.bin') is not None and
            len(members['vgabios-0.8a/VGABIOS-lgpl-latest.bin']) ==
            VGA_SELECTED_BYTES and
            sha(members['vgabios-0.8a/VGABIOS-lgpl-latest.bin']) ==
            VGA_SELECTED_SHA256 and
            all(name in members and type(members[name]) is bytes and
                len(members[name]) > 0 for name in
                ('vgabios-0.8a/README', 'vgabios-0.8a/COPYING',
                 'vgabios-0.8a/Makefile', 'vgabios-0.8a/vgabios.c',
                 'vgabios-0.8a/vbe.c')) and
            sha(members['vgabios-0.8a/COPYING']) == VGA_COPYING_SHA256,
            'complete selected VGA resource and corresponding source/notice')
    selected = members['vgabios-0.8a/VGABIOS-lgpl-latest.bin']
    git_blob = hashlib.sha1(b'blob ' + str(len(selected)).encode() +
                            b'\0' + selected).hexdigest()
    require(git_blob == VGA_BLOB,
            'reviewed Bochs selected LGPL VGA Git blob correspondence')
    return {'sourceSha256': VGA_SOURCE_SHA256,
            'selectedVgaSha256': VGA_SELECTED_SHA256,
            'selectedVgaGitBlob': git_blob,
            'signatureVerified': False,
            'licenseClearanceGranted': False}, budget


def compact_build_log(job_log, build_request, *, full_manifest=None,
                      runtime_zip=None, binary=None, config_header=None):
    """Bind one bounded build-log frame; job-log acquisition is external."""
    require(type(job_log) is bytes and 0 < len(job_log) <= 8 << 20,
            'bounded retained official Build job log')
    marker = b'BW_BOCHS_RING3_BUILD_MANIFEST_V1='
    lines = [line for line in job_log.splitlines() if marker in line]
    require(len(lines) == 1 and lines[0].count(marker) == 1,
            'one source-reviewed compact Build frame')
    encoded = lines[0].split(marker, 1)[1]
    require(0 < len(encoded) <= 32768 and
            re.fullmatch(rb'[A-Za-z0-9+/]+={0,2}', encoded),
            'bounded canonical compact manifest base64')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise Refusal('malformed compact Build base64') from error
    require(base64.b64encode(raw) == encoded and len(raw) <= 16384,
            'exact compact Build frame bytes')
    value = parse_json(raw, 16384, canonical_wire=True)
    fields(value, 'schema sourceHead sourceTree sourceFilesSha256 '
           'bochsCommit bochsTree policySha256 fullManifest runtimeZip '
           'binary configHeader runtimeMembersSha256 noticesSha256 '
           'buildCompleted guestExecuted')
    require(value['schema'] == 'bw.bochs-ring3.build-manifest-compact.v1' and
            value['sourceHead'] == build_request['source']['head'] and
            value['sourceTree'] == build_request['source']['tree'] and
            value['bochsCommit'] == BOCHS_COMMIT and
            value['bochsTree'] == BOCHS_TREE and
            value['policySha256'] == build_request['policySha256'] and
            value['buildCompleted'] is True and
            value['guestExecuted'] is False,
            'one completed selected source/static Build compact witness')
    for key in ('sourceFilesSha256', 'runtimeMembersSha256', 'noticesSha256'):
        digest(value[key])
    require(value['sourceFilesSha256'] ==
            sha(canonical(build_request['source']['files'])),
            'compact Build source-twelve digest matches selected request')
    for key, data in (('fullManifest', full_manifest),
                      ('runtimeZip', runtime_zip),
                      ('binary', binary),
                      ('configHeader', config_header)):
        row = fields(value[key], 'bytes sha256')
        integer(row['bytes'], 1, 32 << 20 if key == 'runtimeZip' else 4 << 20
                if key == 'fullManifest' else 128 << 20)
        digest(row['sha256'])
        if data is not None:
            require(type(data) is bytes and len(data) == row['bytes'] and
                    sha(data) == row['sha256'],
                    'retained Build source/full/ELF byte join')
    if full_manifest is not None:
        manifest = parse_json(full_manifest, 4 << 20, canonical_wire=True)
        require(type(manifest.get('runtimeMembers')) is list and
                type(manifest.get('notices')) in (dict, list) and
                value['runtimeMembersSha256'] ==
                sha(canonical(manifest['runtimeMembers'])) and
                value['noticesSha256'] == sha(canonical(manifest['notices'])),
                'compact Build complete runtime and notice table hashes')
        binary_rows = [row for row in manifest['runtimeMembers']
                       if type(row) is dict and row.get('path') == 'bin/bochs']
        require(len(binary_rows) == 1, 'one selected Build executable')
        fields(binary_rows[0], 'path role mode bytes sha256')
        config_row = fields(manifest['configHeader'], 'path bytes sha256')
        require(value['binary'] == {key: binary_rows[0][key]
                                    for key in ('bytes', 'sha256')} and
                value['configHeader'] == {key: config_row[key]
                                          for key in ('bytes', 'sha256')},
                'compact Build selected ELF and generated header identities')
    return value


def generated_config(config_raw, version_raw):
    require(type(config_raw) is bytes and 0 < len(config_raw) <= 1 << 20 and
            type(version_raw) is bytes and 0 < len(version_raw) <= 16384,
            'bounded actual generated config/version headers')
    try:
        config_text = config_raw.decode('ascii')
        version_text = version_raw.decode('ascii')
    except UnicodeError as error:
        raise Refusal('ASCII generated configuration source') from error
    definitions = {}
    for name, value in re.findall(
            r'^#define[ \t]+(BX_[A-Z0-9_]+)[ \t]+([0-9]+)[ \t]*$',
            config_text, re.M):
        require(name not in definitions,
                'unique generated Bochs configuration definition')
        definitions[name] = int(value)
    require(all(definitions.get(name) == wanted for name, wanted in
                (('BX_CPU_LEVEL', 3), ('BX_WITH_NOGUI', 1),
                 ('BX_PLUGINS', 0), ('BX_DEBUGGER', 0))) and
            all(definitions.get('BX_WITH_' + name, 0) == 0 for name in
                ('X11', 'SDL', 'SDL2', 'WX', 'TERM', 'RFB', 'VNCSRV')),
            'actual generated CPU3/nogui/no-plugin/no-debugger configuration')
    expected_version = {
        'VERSION': '"2.7"', 'VER_SVNFLAG': '0',
        'REL_STRING': '"Built from SVN snapshot on August  1, 2021"',
        'REL_TIMESTAMP': '"Sun Aug  1 10:07:00 CEST 2021"'}
    rows = re.findall(
        r'^#define[ \t]+(VERSION|VER_SVNFLAG|REL_STRING|REL_TIMESTAMP)'
        r'[ \t]+(.+?)[ \t]*$', version_text, re.M)
    require(len(rows) == 4 and dict(rows) == expected_version,
            'exact source-derived generated Bochs version header')
    return {'definitions': definitions, 'version': expected_version,
            'headerSha256': HEADER_SHA256}


def runtime_assets(raw, selected_rows, selected_toolchain, *, budget=None,
                   selected_source=None):
    """Rehash nested Build runtime bytes and rederive each retained ELF graph."""
    require(type(selected_rows) is list and 5 <= len(selected_rows) <= 256,
            'finite selected complete runtime role manifest')
    selected = {}
    for row in selected_rows:
        fields(row, 'path role mode bytes sha256')
        name = safe_member(row['path'])
        require(name not in selected and
                row['mode'] in (stat.S_IFREG | 0o444,
                                stat.S_IFREG | 0o555) and
                integer(row['bytes'], 0, 128 << 20) and
                digest(row['sha256']) and
                row['role'] == ('executable' if name == 'bin/bochs' else
                                'library' if name.startswith('lib/') else
                                'notice' if name.startswith('notices/') else
                                'config' if name == 'config/bochsrc.template' else
                                'rom' if name == 'inputs/fixture.rom' else
                                'fixture' if name == 'inputs/fixture.json' else
                                'vga' if name == 'resources/vgabios.bin' else
                                'manifest' if name == 'asset-manifest.json' else None),
                'unique typed selected runtime member')
        selected[name] = row
    mandatory = {'bin/bochs', 'config/bochsrc.template',
                 'inputs/fixture.rom', 'inputs/fixture.json',
                 'resources/vgabios.bin', 'asset-manifest.json'}
    require(mandatory <= set(selected) and
            all(name in mandatory or name.startswith(('lib/', 'notices/'))
                for name in selected),
            'closed selected executable, config, fixture and notice roles')
    metadata = {}
    members, runtime_budget = archive_members(raw, RUNTIME_CAPS,
                                              allowed=selected,
                                              metadata=metadata)
    if budget is not None:
        budget.charge_bytes(runtime_budget.expanded)
        for _ in range(runtime_budget.members):
            budget.add(0)
    else:
        budget = runtime_budget
    runtime_elf = {}
    for name, data in members.items():
        row = selected[name]
        mode = metadata[name]['mode']
        require(mode == row['mode'] and
                len(data) == row['bytes'] and sha(data) == row['sha256'],
                'exact nested runtime mode/extent/byte readback')
        executable = name == 'bin/bochs' or name.startswith('lib/')
        expected_mode = (0o555 if name in ('bin/bochs',
                                           'lib/ld-linux-x86-64.so.2')
                         else 0o444)
        require(row['mode'] == (stat.S_IFREG | expected_mode),
                'exact read-only staged executable versus data mode')
        if executable:
            runtime_elf[name] = elf_static(data)
            require(runtime_elf[name]['rpath'] is None and
                    runtime_elf[name]['runpath'] is None,
                    'no selected runtime ELF injected search path')
    require(len(members['inputs/fixture.rom']) == 65536 and
            sha(members['inputs/fixture.rom']) == ROM_SHA256,
            'unchanged authored fixture ROM retained in runtime ZIP')
    require(len(members['resources/vgabios.bin']) == VGA_SELECTED_BYTES and
            sha(members['resources/vgabios.bin']) == VGA_SELECTED_SHA256,
            'unchanged selected LGPL VGA resource retained in runtime ZIP')
    require('notices/vgabios-corresponding-source.tar.gz' in members and
            members['notices/vgabios-corresponding-source.tar.gz'] and
            len(members['notices/vgabios-corresponding-source.tar.gz']) ==
            VGA_SOURCE_BYTES,
            'complete LGPL VGA corresponding source retained with runtime')
    _, budget = vga_corresponding_source(
        members['notices/vgabios-corresponding-source.tar.gz'],
        budget=budget)
    authored_fixture(members)
    asset = parse_json(members['asset-manifest.json'], 4 << 20,
                       canonical_wire=True)
    fields(asset, 'schema source bochsSource hostNode loader bindings files')
    require(asset['schema'] == 'bw.bochs-ring3.runtime-assets.v1' and
            type(asset['files']) is list and
            strict_equal(asset['files'], [selected[name] for name in
                                          sorted(selected) if name !=
                                          'asset-manifest.json']),
            'inner asset table excludes itself and binds every other ZIP member')
    fields(asset['source'], 'head tree filesSha256')
    digest(asset['source']['head'], 40)
    digest(asset['source']['tree'], 40)
    digest(asset['source']['filesSha256'])
    if selected_source is not None:
        require(asset['source'] == {
                    'head': selected_source['head'],
                    'tree': selected_source['tree'],
                    'filesSha256': sha(canonical(selected_source['files']))},
                'inner asset source matches independently selected checkout')
    fields(asset['bochsSource'], 'commit tree sourceSelectionSha256')
    require(asset['bochsSource'] == {
                'commit': BOCHS_COMMIT, 'tree': BOCHS_TREE,
                'sourceSelectionSha256': SOURCE_SELECTION_SHA256},
            'inner runtime manifest fixed Bochs source selection')
    node = fields(asset['hostNode'],
                  'cachePath bytes sha256 elf stageMode stageUid stageGid')
    require(strict_equal(node, selected_toolchain['node']) and
            node['cachePath'] == NODE_CACHE_PATH and
            node['bytes'] == NODE_BYTES and node['sha256'] == NODE_SHA256 and
            not any(name.endswith('/node') for name in members),
            'selected cache DATA is copied to a separate verified Node stage, never bundled')
    loader = fields(asset['loader'], 'path member bytes sha256 elf')
    require(type(loader['path']) is str and
            loader['path'] in selected_toolchain['files'] and
            type(loader['member']) is str and
            loader['member'] in runtime_elf and
            loader['member'] == 'lib/ld-linux-x86-64.so.2' and
            loader['bytes'] == len(members[loader['member']]) and
            loader['sha256'] == sha(members[loader['member']]) and
            strict_equal(loader['elf'], runtime_elf[loader['member']]) and
            loader['bytes'] == selected_toolchain['files'][loader['path']]['bytes'] and
            loader['sha256'] == selected_toolchain['files'][loader['path']]['sha256'],
            'exact selected interpreter copied into nested runtime')
    require(type(asset['bindings']) is dict and
            1 <= len(asset['bindings']) <= 128,
            'finite source-selected runtime library binding map')
    copied = set()
    for original, row in asset['bindings'].items():
        fields(row, 'members bytes sha256 elf')
        require(type(original) is str and
                original in selected_toolchain['files'] and
                type(row['members']) is list and
                1 <= len(row['members']) <= 8 and
                all(type(name) is str and
                    re.fullmatch(r'lib/[A-Za-z0-9+_.-]+', name) and
                    name in runtime_elf for name in row['members']) and
                len(row['members']) == len(set(row['members'])) and
                row['bytes'] == selected_toolchain['files'][original]['bytes'] and
                row['sha256'] == selected_toolchain['files'][original]['sha256'] and
                strict_equal(row['elf'], selected_toolchain['files'][original]['elf']),
                'selected original runtime library identity and aliases')
        for name in row['members']:
            require(name not in copied and
                    len(members[name]) == row['bytes'] and
                    sha(members[name]) == row['sha256'] and
                    strict_equal(runtime_elf[name], row['elf']),
                    'nested library copy rederived from selected original bytes')
            copied.add(name)
    require(copied == {name for name in runtime_elf if name.startswith('lib/')},
            'every nested runtime library has an exact selected original')
    require(loader['path'] in asset['bindings'] and
            loader['member'] in asset['bindings'][loader['path']]['members'],
            'selected staged loader belongs to its original library binding')
    for name, elf in runtime_elf.items():
        for soname in elf['needed']:
            if 'lib/' + soname in runtime_elf:
                continue
            path = '/usr/lib/x86_64-linux-gnu/' + soname
            require(resolve_selected_alias(path, selected_toolchain) in
                    selected_toolchain['files'],
                    'runtime ELF dependency belongs to reviewed toolchain graph')
        if elf['interpreter']:
            require(resolve_selected_alias(elf['interpreter'],
                                           selected_toolchain) in
                    selected_toolchain['files'],
                    'runtime ELF interpreter belongs to reviewed toolchain graph')
    return members, runtime_elf, budget


def header_expected():
    """Source-derived main.cc/logio.cc 72-column header, without Bochs exec."""
    def center(text):
        require(len(text) <= 72, 'source-selected Bochs header line cap')
        return b' ' * ((72 - len(text)) // 2) + text

    header = (b'=' * 72 + b'\n' +
              center(b'Bochs x86 Emulator 2.7\n') +
              center(b'Built from SVN snapshot on August  1, 2021\n') +
              center(b'Timestamp: Sun Aug  1 10:07:00 CEST 2021') +
              b'\n' + b'=' * 72 + b'\n')
    require(len(header) == 307 and sha(header) == HEADER_SHA256,
            'exact reviewed source header')
    return header


def reporter_frame(stdout, retained_frame):
    header = header_expected()
    require(type(stdout) is bytes and type(retained_frame) is bytes and
            stdout == header + retained_frame and len(retained_frame) == 1730 and
            retained_frame.startswith(FRAME_MAGIC) and
            retained_frame.endswith(FRAME_END),
            'one full header and unchanged reporter frame, no extra bytes')
    return retained_frame


ARCH_RANGES = ((0x7000, 224), (0x1000, 48), (0x1800, 1040),
               (0x2000, 104), (0x7fc0, 96), (0x8fc0, 96), (0x9fc0, 96))
ARCH_BLOCKS = ((0x1000, 48), (0x1c00, 16), (0x2000, 104),
               (0x7fc0, 96), (0x8fc0, 96), (0x9fc0, 96),
               (0x4000, 95), (0x5000, 198), (0x6000, 167),
               (0x6200, 145))
ARCH_INITIAL = (0x11223344, 0x99aabbcc, 0xddeeff00, 0x55667788,
                0x9000, 0x0badc0de, 0x12345678, 0x87654321)
ARCH_PADDING = (6, 7, 18, 19)
ARCH_SYMBOLS = {'initialIretd': 0x405e, 'int80': 0x505b,
                'returned': 0x505d, 'int81': 0x50c2,
                'iretd': 0x60a6, 'exit': 0x628c}
ARCH_REGS = ('eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi')
ARCH_SEGS = ('es', 'cs', 'ss', 'ds', 'fs', 'gs')


def expected_memory(rom):
    """Literal architectural expectation, never derived from an observed wire."""
    require(type(rom) is bytes and len(rom) == 65536 and
            sha(rom) == ROM_SHA256, 'selected unchanged authored ROM bytes')
    memory = bytearray(1 << 20)
    for address, count in ARCH_BLOCKS:
        memory[address:address + count] = rom[address:address + count]
    for at, value in ((13, 0x9b), (21, 0x93), (29, 0xfb),
                      (37, 0xf3), (45, 0x8b)):
        memory[0x1000 + at] = value
    struct.pack_into('<I', memory, 0x2004, 0xa000)
    for address, kernel, response in ((0x7000, False, False),
                                      (0x7040, True, False),
                                      (0x7080, False, True)):
        values = list(ARCH_INITIAL)
        if kernel:
            values[4] = 0x7fec
        if response:
            values[0] = 0xa1b2c3d4
        struct.pack_into('<8I6HI', memory, address, *values, 0x23,
                         8 if kernel else 0x1b,
                         0x10 if kernel else 0x23,
                         0x23, 0x23, 0x23,
                         2 if kernel else 0x202)
    for address, eip in ((0x70c0, 0x505d), (0x7fec, 0x505d),
                         (0x9fec, 0x50c4), (0xafec, 0x5000)):
        struct.pack_into('<5I', memory, address, eip, 0x1b, 0x202,
                         0x9000, 0x23)
    for address, value in ((0x7fe8, 2), (0x8ffc, 0x202),
                           (0x70d4, 0x48414e44),
                           (0x70d8, 0x5245544e)):
        struct.pack_into('<I', memory, address, value)
    return bytes(memory)


def architectural_wire(wire, expected):
    require(type(wire) is bytes and len(wire) == 1730 and
            wire.startswith(FRAME_MAGIC) and wire.endswith(FRAME_END) and
            type(expected) is bytes and len(expected) == 1 << 20,
            'one exact authored reporter wire')
    result = bytearray(expected)
    offset = len(FRAME_MAGIC)
    for address, count in ARCH_RANGES:
        result[address:address + count] = wire[offset:offset + count]
        offset += count
    require(result[0x70c0:0x70d4] == result[0x7fec:0x8000],
            'literal copied interrupt frame')
    ignored = {frame + index for frame in (0x70c0, 0x7fec, 0x9fec)
               for index in ARCH_PADDING}
    for address, count in ARCH_RANGES:
        require(all(result[index] == expected[index]
                    for index in range(address, address + count)
                    if index not in ignored),
                'literal defined reporter registers/frame/flags/guards')
    return bytes(result)


def authored_fixture(packet):
    rom = packet['inputs/fixture.rom']
    expected = expected_memory(rom)
    fixture_raw = packet['inputs/fixture.json']
    fixture = parse_json(fixture_raw, 32768)
    require(sha(json.dumps(fixture, sort_keys=True,
                           separators=(',', ':')).encode()) ==
            FIXTURE_JSON_SHA256 and
            fixture.get('schema') == 'bw.ring3.fixture.v1' and
            fixture.get('romSha256') == ROM_SHA256 and
            fixture.get('romBytes') == 65536 and
            fixture.get('ramBytes') == 1 << 20 and
            strict_equal(fixture.get('symbols'), ARCH_SYMBOLS) and
            strict_equal(fixture.get('selectorPaddingOffsets'),
                         list(ARCH_PADDING)) and
            fixture.get('wireBytes') == 1730 and
            fixture.get('cpuProfile') == 'strict386' and
            fixture.get('deliverFaults') is False and
            fixture.get('ordinaryStepLimit') == 2000000,
            'independently fixed unchanged authored fixture')
    return expected


def authored_architecture(packet):
    expected = authored_fixture(packet)
    frame = reporter_frame(packet['bochs/stdout'],
                           packet['bochs/frame.original'])
    architectural_wire(frame, expected)
    js_wire = packet['js/stdout']
    js_memory = architectural_wire(js_wire, expected)
    before, after = (packet['js/memory.before.bin'],
                     packet['js/memory.after.bin'])
    require(before == bytes(1 << 20) and len(after) == 1 << 20,
            'complete unchanged owned JavaScript RAM images')
    ignored = {frame_base + index for frame_base in
               (0x70c0, 0x7fec, 0x9fec) for index in ARCH_PADDING}
    require(all(after[index] == expected[index]
                for index in range(len(after)) if index not in ignored),
            'whole defined owned RAM architectural projection')
    for address, count in ARCH_RANGES:
        require(after[address:address + count] ==
                js_memory[address:address + count],
                'raw JS reporter and complete RAM range join')
    authored_js_journal(packet, before, after)
    require(packet['js/stderr'] == b'' and
            packet['bochs/stderr'] == b'',
            'unexpected engine diagnostic output')
    return {'schema': 'bw.bochs-ring3.architecture-observed.v1',
            'bochsFrameSha256': sha(frame),
            'jsFrameSha256': sha(js_wire),
            'definedByteAgreementObserved': True,
            'officialMetadataBound': False,
            'actualRunApproved': False,
            'guestApproved': False}


def authored_js_journal(packet, before, after):
    rows = parse_json(packet['js/observations.json'], 1 << 20)
    require(type(rows) is list and len(rows) == 4,
            'four actual authored CPU observations')
    last_call = 0
    for index, (row, stage, eip, cpl, flags) in enumerate(zip(
            rows, ('before-int80', 'handler-entry', 'before-iretd',
                   'returned-ring3'),
            (0x505b, 0x6000, 0x60a6, 0x505d), (3, 0, 0, 3),
            (0x202, 2, 2, 0x202))):
        fields(row, 'stage beforeCall eip linear cpl eflags cr0 cr3 '
               'registers selectors cs ss tr opcode frame')
        require(row['stage'] == stage and row['eip'] == eip and
                row['linear'] == eip and row['cpl'] == cpl and
                row['eflags'] == flags and row['cr0'] == 1 and
                row['cr3'] == 0, 'literal observed instruction/CPL/IF state')
        last_call = integer(row['beforeCall'], last_call + 1, 2000000)
        fields(row['registers'], ' '.join(ARCH_REGS))
        fields(row['selectors'], ' '.join(ARCH_SEGS))
        for register, initial in zip(ARCH_REGS, ARCH_INITIAL):
            wanted = (0x7fec if register == 'esp' and cpl == 0 else
                      0xa1b2c3d4 if register == 'eax' and index >= 2 else
                      initial)
            require(row['registers'][register] == wanted and
                    type(row['registers'][register]) is int,
                    'actual authored register observation')
        selected = dict(zip(ARCH_SEGS, (0x23, 8 if cpl == 0 else 0x1b,
                                        0x10 if cpl == 0 else 0x23,
                                        0x23, 0x23, 0x23)))
        require(strict_equal(row['selectors'], selected) and
                all(strict_equal(row[key], {'base': 0, 'limit': 0xffffffff,
                                            'default32': True})
                    for key in ('cs', 'ss')) and
                strict_equal(row['tr'], {'selector': 0x28, 'base': 0x2000,
                                         'limit': 0x67, 'present': True}),
                'actual flat selectors and TSS observation')
        wanted_opcode = ([0xcd, 0x80] if index == 0 else
                         [0xcf] if index == 2 else [0x89])
        require(strict_equal(row['opcode'], wanted_opcode) and
                type(row['frame']) is list and len(row['frame']) == 20 and
                all(type(byte) is int and 0 <= byte <= 255
                    for byte in row['frame']),
                'actual authored opcode and raw frame')
        wanted = (bytes([0xcc] * 20) if index == 0 else
                  struct.pack('<5I', 0x505d, 0x1b, 0x202, 0x9000, 0x23))
        require(all(value == wanted[at] for at, value in
                    enumerate(row['frame'])
                    if index == 0 or at not in ARCH_PADDING),
                'defined observed INT80 frame bytes')
        if index >= 2:
            require(row['frame'] == rows[1]['frame'],
                    'observed frame held through IRETD')
    require(rows[1]['beforeCall'] == rows[0]['beforeCall'] + 1 and
            rows[3]['beforeCall'] == rows[2]['beforeCall'] + 1 and
            bytes(rows[1]['frame']) == after[0x7fec:0x8000],
            'immediate observed transitions and final frame join')
    report = parse_json(packet['js/report.json'], 1 << 20)
    fields(report, 'schema finiteRoundTripPass firstFailure calls completed '
           'fixtureSha256 memoryBeforeSha256 memoryAfterSha256 outputSha256 '
           'ports observations')
    calls = integer(report['calls'], last_call, 2000000)
    require(report['schema'] == 'bw.ring3.js-probe.v1' and
            report['firstFailure'] is None and report['completed'] is True and
            report['finiteRoundTripPass'] is True and
            report['fixtureSha256'] == ROM_SHA256 and
            report['memoryBeforeSha256'] == sha(before) and
            report['memoryAfterSha256'] == sha(after) and
            report['outputSha256'] == sha(packet['js/stdout']) and
            report['observations'] == 4 and
            type(report['observations']) is int,
            'bounded actual JavaScript report byte joins')
    ports = report['ports']
    require(type(ports) is list and len(ports) == 2,
            'two actual PIC masks')
    for row, port in zip(ports, (0x21, 0xa1)):
        fields(row, 'port value call')
        require(row['port'] == port and row['value'] == 255 and
                integer(row['call'], 1, rows[0]['beforeCall'] - 1),
                'actual source PIC mask writes')
    writes = parse_json(packet['js/writes.json'], 1 << 20)
    require(type(writes) is list and len(writes) <= 4096,
            'finite actual byte write journal')
    replay = bytearray(before)
    previous, observation_index = 1, 0
    last_writes = {}
    for index, row in enumerate(writes):
        fields(row, 'index call address before after')
        require(type(row['index']) is int and row['index'] == index,
                'ordered original write journal index')
        previous = integer(row['call'], previous, calls)
        while (observation_index < 4 and
               rows[observation_index]['beforeCall'] <= row['call']):
            require(bytes(rows[observation_index]['frame']) ==
                    replay[0x7fec:0x8000],
                    'observed frame before actual write call')
            observation_index += 1
        address = integer(row['address'], 0, 0xeffff)
        prior = integer(row['before'], 0, 255)
        following = integer(row['after'], 0, 255)
        require(replay[address] == prior,
                'actual original write prior byte')
        replay[address] = following
        last_writes[address] = row['call']
    while observation_index < 4:
        require(bytes(rows[observation_index]['frame']) ==
                replay[0x7fec:0x8000],
                'actual final frame/journal prefix')
        observation_index += 1
    require(bytes(replay) == after,
            'complete actual owned RAM replay')
    for address in range(0x7fec, 0x8000):
        require(last_writes.get(address) == rows[0]['beforeCall'],
                'actual INT80 frame produced by observed instruction')
    for start, count, low, high in (
            (0x7000, 48, 1, rows[0]['beforeCall'] - 1),
            (0x7040, 48, rows[1]['beforeCall'],
             rows[2]['beforeCall'] - 1),
            (0x70c0, 20, rows[1]['beforeCall'],
             rows[2]['beforeCall'] - 1),
            (0x7080, 48, rows[3]['beforeCall'], calls)):
        require(all(low <= last_writes.get(address, -1) <= high
                    for address in range(start, start + count)),
                'actual record writes within observed instruction intervals')


def elf_static(raw):
    """Independently derive selected ELF64LE/x86-64 runtime dependencies."""
    require(type(raw) is bytes and 64 <= len(raw) <= 128 << 20 and
            raw[:4] == b'\x7fELF' and raw[4:7] == b'\x02\x01\x01',
            'selected ELF64LE version')
    try:
        (_, e_type, machine, version, _, phoff, _, _, ehsize, phentsize,
         phnum, _, _, _) = struct.unpack_from('<16sHHIQQQIHHHHHH', raw)
    except struct.error as error:
        raise Refusal('complete selected ELF header') from error
    require(e_type in (2, 3) and machine == 62 and version == 1 and
            ehsize == 64 and phentsize == 56 and 0 < phnum <= 1024 and
            64 <= phoff <= len(raw) - phentsize * phnum,
            'selected x86-64 executable or shared ELF program header')
    loads = []
    dynamic = None
    interpreter = None
    for index in range(phnum):
        try:
            kind, _, offset, vaddr, _, size, memsize, _ = struct.unpack_from(
                '<IIQQQQQQ', raw, phoff + 56 * index)
        except struct.error as error:
            raise Refusal('complete selected ELF program header') from error
        require(offset <= len(raw) and size <= len(raw) - offset and
                memsize >= size, 'selected ELF segment file extent')
        if kind == 1:  # PT_LOAD
            loads.append((vaddr, vaddr + size, offset))
        elif kind == 2:  # PT_DYNAMIC
            require(dynamic is None and size <= 65536 and size % 16 == 0,
                    'one bounded selected ELF dynamic segment')
            dynamic = raw[offset:offset + size]
        elif kind == 3:  # PT_INTERP
            require(interpreter is None and 1 < size <= 256,
                    'one bounded selected ELF interpreter')
            item = raw[offset:offset + size]
            require(item.endswith(b'\0') and b'\0' not in item[:-1],
                    'complete selected ELF interpreter string')
            try:
                interpreter = item[:-1].decode('ascii')
            except UnicodeError as error:
                raise Refusal('ASCII selected ELF interpreter') from error
            require(interpreter == '/lib64/ld-linux-x86-64.so.2',
                    'fixed selected ELF interpreter')

    def vaddr_offset(address, length):
        locations = [offset + address - start for start, end, offset in loads
                     if start <= address and length <= end - address]
        require(len(locations) == 1 and
                locations[0] <= len(raw) - length,
                'one file-backed selected ELF string table')
        return locations[0]

    needed_offsets = []
    strtab = strsize = None
    rpath_offset = runpath_offset = None
    if dynamic is not None:
        terminated = False
        for offset in range(0, len(dynamic), 16):
            tag, value = struct.unpack_from('<qQ', dynamic, offset)
            if tag == 0:
                terminated = True
                break
            if tag == 1:
                needed_offsets.append(value)
            elif tag == 5:
                require(strtab is None, 'one selected ELF string table')
                strtab = value
            elif tag == 10:
                require(strsize is None, 'one selected ELF string table size')
                strsize = value
            elif tag == 15:
                require(rpath_offset is None, 'one selected ELF RPATH')
                rpath_offset = value
            elif tag == 29:
                require(runpath_offset is None, 'one selected ELF RUNPATH')
                runpath_offset = value
        require(terminated, 'terminated selected ELF dynamic segment')
    require(len(needed_offsets) <= 64 and
            (strtab is None) == (strsize is None) and
            (not needed_offsets and rpath_offset is None and
             runpath_offset is None or strtab is not None),
            'bounded selected ELF dynamic string references')
    table = b''
    if strtab is not None:
        require(0 < strsize <= 1 << 20, 'bounded selected ELF string table')
        start = vaddr_offset(strtab, strsize)
        table = raw[start:start + strsize]

    def word(offset):
        require(offset is not None and offset < len(table),
                'selected ELF string offset')
        end = table.find(b'\0', offset)
        require(end >= offset and end - offset <= 512,
                'terminated bounded selected ELF string')
        try:
            return table[offset:end].decode('ascii')
        except UnicodeError as error:
            raise Refusal('ASCII selected ELF string') from error

    needed = [word(offset) for offset in needed_offsets]
    require(len(needed) == len(set(needed)) and
            all('/' not in name and re.fullmatch('[A-Za-z0-9._+-]+', name)
                for name in needed), 'unique ordinary selected ELF SONAMEs')
    return {'class': 'ELF64', 'machine': 'x86-64',
            'type': 'EXEC' if e_type == 2 else 'DYN',
            'interpreter': interpreter, 'needed': needed,
            'rpath': None if rpath_offset is None else word(rpath_offset),
            'runpath': None if runpath_offset is None else word(runpath_offset)}


def source_selection(raw):
    """Rebuild the complete pinned Git tree from metadata, without excluded blobs."""
    require(type(raw) is bytes and sha(raw) == SOURCE_SELECTION_SHA256,
            'reviewed complete Bochs source-selection metadata')
    value = parse_json(raw, 4 << 20, canonical_wire=True)
    fields(value, 'schema commit tree rows')
    require(value['schema'] == 'bw.bochs-ring3.source-selection.v1' and
            value['commit'] == BOCHS_COMMIT and value['tree'] == BOCHS_TREE and
            type(value['rows']) is list and len(value['rows']) == 774,
            'fixed pinned Bochs source tree roster')
    root = {}
    previous = None
    included = excluded = 0
    for row in value['rows']:
        fields(row, 'bytes gitBlob included mode path reason')
        path = safe_member(row['path'])
        require(previous is None or path > previous,
                'sorted unique complete Bochs source path')
        previous = path
        integer(row['bytes'], 0, 128 << 20)
        digest(row['gitBlob'], 40)
        require(row['mode'] in ('100644', '100755') and
                type(row['included']) is bool and
                type(row['reason']) is str and
                0 < len(row['reason']) <= 256,
                'typed selected or excluded source metadata')
        included += row['included'] is True
        excluded += row['included'] is False
        parts = path.split('/')
        at = root
        for part in parts[:-1]:
            at = at.setdefault(part, {})
            require(type(at) is dict, 'noncolliding source directory')
        require(parts[-1] not in at, 'unique selected source path')
        at[parts[-1]] = (row['mode'], row['gitBlob'])
    require(included == 764 and excluded == 10,
            'exact admitted source payload exclusion count')

    def tree(entries):
        result = bytearray()
        for name, child in sorted(entries.items(), key=lambda item:
                                  item[0].encode() +
                                  (b'/' if type(item[1]) is dict else b'')):
            if type(child) is dict:
                mode, child_sha = b'40000', tree(child)
            else:
                mode, child_sha = child[0].encode(), bytes.fromhex(child[1])
            result.extend(mode + b' ' + name.encode() + b'\0' + child_sha)
        payload = bytes(result)
        return hashlib.sha1(b'tree ' + str(len(payload)).encode() +
                            b'\0' + payload).digest()

    require(tree(root).hex() == BOCHS_TREE,
            'independently reconstructed complete Bochs Git tree')
    selected = {row['path']: row for row in value['rows']
                if row['included'] is True}
    require(VGA_PATH in selected and selected[VGA_PATH]['gitBlob'] == VGA_BLOB,
            'selected LGPL VGA resource belongs to reviewed Git tree')
    require('bochs/bios/VGABIOS-lgpl-README' in selected and
            selected['bochs/bios/VGABIOS-lgpl-README']['gitBlob'] ==
            VGA_NOTICE_BLOB,
            'selected LGPL VGA notice belongs to reviewed Git tree')
    return selected, value


def debian_status(raw):
    """Independently parse authority fields, including folded empty Conffiles."""
    require(type(raw) is bytes and 0 < len(raw) <= 4 << 20 and
            b'\0' not in raw, 'bounded Debian status original')
    try:
        text = raw.decode('utf-8')
    except UnicodeError as error:
        raise Refusal('UTF-8 Debian status original') from error
    require('\r' not in text and text.endswith('\n'), 'LF Debian status original')
    result = []
    for paragraph in text.strip('\n').split('\n\n'):
        require(paragraph != '', 'complete nonempty Debian paragraph')
        seen = {}
        current = None
        needs_fold = None
        for line in paragraph.split('\n'):
            if line.startswith((' ', '\t')):
                require(current is not None and line.strip(' \t') != '',
                        'complete nonblank folded Debian value')
                if needs_fold == current:
                    needs_fold = None
                continue
            require(needs_fold is None, 'empty Debian field lacks folded content')
            match = re.fullmatch(r'([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)', line)
            require(match is not None and len(line) <= 65536,
                    'bounded Debian status field')
            name, value = match.group(1).lower(), match.group(2)
            require(name not in seen, 'case-insensitive unique Debian field')
            seen[name] = value
            current = name
            if value.strip(' \t') == '':
                require(name not in ('package', 'status', 'version', 'architecture'),
                        'nonempty Debian authority')
                needs_fold = name
        require(needs_fold is None and
                set(('package', 'status', 'version', 'architecture')) <= set(seen),
                'complete Debian package authority')
        require(re.fullmatch('[a-z0-9][a-z0-9+.-]*', seen['package']) and
                seen['status'] in ('install ok installed',
                                   'deinstall ok config-files'),
                'selected Debian package/status')
        result.append({name: seen[name] for name in
                       ('package', 'status', 'version', 'architecture')})
        require(len(result) <= 8192, 'bounded Debian package count')
    require(len({(r['package'], r['architecture']) for r in result}) == len(result),
            'unique package and architecture status')
    return result


def tool_graph(graph, *, reported_only=True):
    """Validate selected file facts without pretending tool bytes were retained."""
    fields(graph, 'files aliases directoryAliases')
    files = graph['files']
    require(type(files) is dict and 0 < len(files) <= 128 and
            NODE_CACHE_PATH not in files and
            type(graph['aliases']) is dict and len(graph['aliases']) <= 128 and
            type(graph['directoryAliases']) is dict and
            len(graph['directoryAliases']) <= 32 and
            not (set(graph['aliases']) & set(graph['directoryAliases'])),
            'finite selected tool graph')
    total = 0
    for path, row in files.items():
        require(type(path) is str and path.startswith('/') and
                len(path) <= 512 and '\0' not in path and
                all(part not in ('', '.', '..') for part in path[1:].split('/')) and
                path.startswith(('/usr/bin/', '/usr/lib/', '/bin/', '/lib/',
                                 '/lib64/', '/opt/hostedtoolcache/node/22.23.3/x64/',
                                 '/usr/share/doc/', '/usr/share/common-licenses/')),
                'closed selected tool roots')
        file_fact(row)
        require(row['before']['uid'] == row['before']['gid'] == 0 and
                row['bytes'] <= 128 << 20,
                'reported root-owned finite selected tool')
        total += row['bytes']
        if row['elf'] is not None:
            require(row['elf']['rpath'] is None and row['elf']['runpath'] is None,
                    'selected tool has no injected ELF search path')
    require(total <= 256 << 20, 'bounded reported one-pass tool inventory')
    for group in ('aliases', 'directoryAliases'):
        for path, row in graph[group].items():
            require(type(path) is str and path.startswith('/') and len(path) <= 512,
                    'selected lexical alias path')
            alias_fact(row)
            require(row['before']['uid'] == row['before']['gid'] == 0,
                    'root-owned selected lexical alias')
    for source_path in REQUIRED_TOOL_PATHS:
        require(resolve_reported_alias(source_path, graph) in files,
                'complete fixed source-selected tool/notice path roster')
    for row in files.values():
        if row['elf'] is None:
            continue
        elf = row['elf']
        required = ([elf['interpreter']] if elf['interpreter'] else []) + [
            '/usr/lib/x86_64-linux-gnu/' + name for name in elf['needed']]
        for path in required:
            require(resolve_reported_alias(path, graph) in files,
                    'reported ELF dependency and interpreter graph closure')
    return {'selectedFiles': len(files), 'selectedBytes': total,
            'reportedReadbackOnly': reported_only}


def selected_tool_projection(graph):
    """Remove only host-local inode/timestamp facts for cross-job comparison."""
    tool_graph(graph)
    result = {'files': {}, 'aliases': {}, 'directoryAliases': {}}
    for path, row in graph['files'].items():
        result['files'][path] = {'bytes': row['bytes'],
                                 'sha256': row['sha256'],
                                 'mode': row['before']['mode'],
                                 'uid': row['before']['uid'],
                                 'gid': row['before']['gid'],
                                 'elf': row['elf']}
    for group in ('aliases', 'directoryAliases'):
        for path, row in graph[group].items():
            result[group][path] = {'linkText': row['linkText'],
                                   'target': row['target']}
    return result


def notice_facts(raw, graph):
    notices = parse_json(raw, 4 << 20, canonical_wire=True)
    require(type(notices) is dict and set(notices) == NOTICE_PATHS,
            'all seven fixed selected licence notices retained')
    total = 0
    for source_path, row in notices.items():
        fields(row, 'path bytes sha256 text')
        require(type(row['text']) is str and '\0' not in row['text'],
                'bounded UTF-8 retained licence notice')
        text_bytes = row['text'].encode('utf-8')
        require(integer(row['bytes'], 1, 262144) == len(text_bytes) and
                digest(row['sha256']) == sha(text_bytes) and
                row['path'] == resolve_reported_alias(source_path, graph) and
                row['path'] in graph['files'] and
                graph['files'][row['path']]['bytes'] == row['bytes'] and
                graph['files'][row['path']]['sha256'] == row['sha256'],
                'notice text joins reported selected tool file readback')
        total += len(text_bytes)
    require(total <= 524288 and len(raw) <= 4 << 20,
            'finite aggregate retained licence notices')
    return {'noticeCount': 7, 'noticeBytes': total,
            'licenseClearanceGranted': False}


def resolve_reported_alias(path, graph):
    """Independently project captured lexical links to a canonical file key."""
    require(type(path) is str and path.startswith('/') and
            len(path) <= 512 and posixpath.normpath(path) == path,
            'canonical original notice path')
    visited = set()
    current = path
    for _ in range(16):
        require(current not in visited, 'finite acyclic selected aliases')
        visited.add(current)
        candidates = []
        for group in ('aliases', 'directoryAliases'):
            for name, row in graph[group].items():
                if current == name or current.startswith(name + '/'):
                    candidates.append((len(name), name, row))
        if not candidates:
            return current
        _, name, row = max(candidates, key=lambda item: item[0])
        alias_fact(row)
        target = posixpath.normpath(
            row['linkText'] if row['linkText'].startswith('/') else
            posixpath.join(posixpath.dirname(name), row['linkText']))
        require(target == row['target'],
                'selected alias text independently resolves to retained target')
        current = posixpath.normpath(target + current[len(name):])
    raise Refusal('selected alias depth cap')


def failure_fact(value):
    fields(value, 'phase name message role path')
    for name in ('phase', 'name', 'message'):
        require(type(value[name]) is str and 0 < len(value[name]) <=
                (512 if name == 'message' else 128) and
                '\0' not in value[name], 'bounded typed failure fact')
    for name in ('role', 'path'):
        require(value[name] is None or
                (type(value[name]) is str and
                 len(value[name].encode('utf-8')) <= 256 and
                 '\0' not in value[name]), 'bounded selected failure role/path')
    return value


def failures(first, secondary, *, complete):
    require(type(secondary) is list and len(secondary) <= 16,
            'bounded ordered secondary failures')
    if first is not None:
        failure_fact(first)
    for row in secondary:
        failure_fact(row)
    if complete:
        require(first is None and not secondary,
                'complete original has no retained failure')
    else:
        require(first is not None,
                'failed original retains first failure')


def stat_fact(value, *, kind=None):
    fields(value, 'dev ino mode uid gid nlink size mtimeNs ctimeNs')
    for name in value:
        integer(value[name], 0)
    require(value['dev'] > 0 and value['ino'] > 0 and
            value['nlink'] > 0 and value['size'] <= 1 << 30,
            'bounded selected file identity')
    if kind == 'regular':
        require(stat.S_ISREG(value['mode']), 'ordinary selected regular file')
    elif kind == 'directory':
        require(stat.S_ISDIR(value['mode']), 'ordinary selected directory')
    elif kind == 'symlink':
        require(stat.S_ISLNK(value['mode']), 'selected lexical symlink')
    return value


def file_fact(value, *, raw=None, allow_empty=False, rederive_elf=False):
    fields(value, 'bytes sha256 before after named complete elf')
    amount = integer(value['bytes'], 0 if allow_empty else 1, 128 << 20)
    digest(value['sha256'])
    for key in ('before', 'after', 'named'):
        stat_fact(value[key], kind='regular')
    require(value['complete'] is True and
            strict_equal(value['before'], value['after']) and
            strict_equal(value['after'], value['named']) and
            value['before']['size'] == amount and
            value['before']['mode'] & 0o022 == 0,
            'stable selected regular full readback')
    if raw is not None:
        require(type(raw) is bytes and len(raw) == amount and
                sha(raw) == value['sha256'],
                'independently hashed retained regular file bytes')
    if value['elf'] is not None:
        fields(value['elf'], 'class machine type interpreter needed rpath runpath')
        elf = value['elf']
        require(elf['class'] == 'ELF64' and elf['machine'] == 'x86-64' and
                elf['type'] in ('EXEC', 'DYN') and
                (elf['interpreter'] is None or
                 elf['interpreter'] == '/lib64/ld-linux-x86-64.so.2') and
                type(elf['needed']) is list and len(elf['needed']) <= 64 and
                all(type(name) is str and
                    re.fullmatch('[A-Za-z0-9._+-]+', name)
                    for name in elf['needed']) and
                len(set(elf['needed'])) == len(elf['needed']) and
                all(elf[name] is None or
                    (type(elf[name]) is str and
                     len(elf[name].encode('utf-8')) <= 512)
                    for name in ('rpath', 'runpath')),
                'bounded typed source-reported ELF facts')
        if rederive_elf:
            require(raw is not None and strict_equal(value['elf'], elf_static(raw)),
                    'independent selected retained ELF graph')
    elif rederive_elf:
        raise Refusal('required retained ELF observation missing')
    return value


def alias_fact(value):
    fields(value, 'linkText target before after')
    require(type(value['linkText']) is str and
            0 < len(value['linkText'].encode('utf-8')) <= 256 and
            type(value['target']) is str and
            0 < len(value['target'].encode('utf-8')) <= 256 and
            '\0' not in value['linkText'] and
            value['target'].startswith('/') and
            posixpath.normpath(value['target']) == value['target'] and
            any(value['target'] == root[:-1] or
                value['target'].startswith(root) for root in
                ('/usr/bin/', '/usr/lib/', '/bin/', '/lib/', '/lib64/',
                 '/opt/hostedtoolcache/node/22.23.3/x64/',
                 '/usr/share/doc/', '/usr/share/common-licenses/')),
            'bounded selected lexical alias')
    for key in ('before', 'after'):
        stat_fact(value[key], kind='symlink')
    require(strict_equal(value['before'], value['after']) and
            value['before']['size'] == len(value['linkText'].encode('utf-8')),
            'stable selected symlink identity and text extent')
    return value


def stream_fact(value, raw, role, cap):
    fields(value, 'role bytes sha256 complete')
    require(value['role'] == role and value['complete'] is True and
            type(raw) is bytes and
            integer(value['bytes'], 0, cap) == len(raw) and
            digest(value['sha256']) == sha(raw),
            'complete retained selected stream bytes')
    return value


def wait4_sigterm(process):
    """A frame is never a substitute for actual owned signal and wait4 facts."""
    fields(process, 'name argv cwd environment startedNs endedNs pid identity '
           'waitStatus exitCode signal reaped timedOut stdout stderr '
           'resourcesBefore resourcesAfter cgroupBefore cgroupAfter '
           'firstFailure secondary usage')
    require(process['name'] == 'bochs' and
            integer(process['pid'], 1, 2**31 - 1) and
            integer(process['startedNs'], 0) <=
            integer(process['endedNs'], 0) and
            process['reaped'] is True and process['timedOut'] is False and
            process['exitCode'] is None and process['signal'] == 15,
            'owned Bochs process terminal shape')
    status = integer(process['waitStatus'], 0, 0xffff)
    fields(process['usage'], 'userSeconds systemSeconds maxRssKiB')
    for key in ('userSeconds', 'systemSeconds'):
        require(type(process['usage'][key]) in (int, float) and
                math.isfinite(process['usage'][key]) and
                0 <= process['usage'][key] <= 1200,
                'bounded actual wait4 usage')
    integer(process['usage']['maxRssKiB'], 0, 4 << 20)
    require(os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGTERM,
            'actual owned wait4 SIGTERM termination')
    failures(process['firstFailure'], process['secondary'], complete=True)
    return process


def phase_fact(process, stdout, stderr, *, name, wall_seconds,
               checkpoint=False):
    fields(process, 'name argv cwd environment startedNs endedNs pid identity '
           'waitStatus exitCode signal reaped timedOut stdout stderr '
           'resourcesBefore resourcesAfter cgroupBefore cgroupAfter '
           'firstFailure secondary usage')
    require(process['name'] == name and
            type(process['argv']) is list and 1 <= len(process['argv']) <= 64 and
            all(type(arg) is str and 0 < len(arg) <= 512 and '\0' not in arg
                for arg in process['argv']) and
            type(process['cwd']) is str and 0 < len(process['cwd']) <= 512 and
            type(process['environment']) is dict and
            len(process['environment']) <= 64 and
            all(type(key) is str and type(item) is str and
                len(key) <= 128 and len(item) <= 4096 and
                '\0' not in key and '\0' not in item
                for key, item in process['environment'].items()),
            'closed bounded selected owned child descriptor')
    start = integer(process['startedNs'], 0)
    end = integer(process['endedNs'], start)
    require(end - start <= wall_seconds * 1000000000 + 6000000000 and
            integer(process['pid'], 1, 2**31 - 1) and
            process['reaped'] is True and process['timedOut'] is False and
            type(process['identity']) is dict and
            type(process['resourcesBefore']) is dict and
            type(process['resourcesAfter']) is dict and
            type(process['cgroupBefore']) is dict and
            type(process['cgroupAfter']) is dict,
            'owned bounded child identity, resource and terminal observations')
    status = integer(process['waitStatus'], 0, 0xffff)
    stream_fact(process['stdout'], stdout, name + '.stdout', 4 << 20)
    stream_fact(process['stderr'], stderr, name + '.stderr', 4 << 20)
    fields(process['usage'], 'userSeconds systemSeconds maxRssKiB')
    for key in ('userSeconds', 'systemSeconds'):
        require(type(process['usage'][key]) in (int, float) and
                math.isfinite(process['usage'][key]) and
                0 <= process['usage'][key] <= wall_seconds + 6,
                'bounded actual wait4 user/system time')
    integer(process['usage']['maxRssKiB'], 0, 4 << 20)
    failures(process['firstFailure'], process['secondary'], complete=True)
    if checkpoint:
        require(os.WIFSIGNALED(status) and
                os.WTERMSIG(status) == signal.SIGTERM and
                process['exitCode'] is None and process['signal'] == 15,
                'actual owned checkpoint SIGTERM wait4')
    else:
        require(os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0 and
                process['exitCode'] == 0 and process['signal'] is None,
                'actual ordinary owned child exit0 wait4')
    return process


def request_event(route, request_raw, event_raw, *, selected_head=None):
    """Independent local join; source/W/official API admission stays external."""
    require(route in ('toolchain', 'build', 'reference'), 'closed Bochs route')
    request = parse_json(request_raw, 32768, canonical_wire=True)
    event = parse_json(event_raw, 1048576)
    base = 'schema repository pullRequest source policySha256 limits'
    if route == 'build':
        base += ' bochs toolchain'
    elif route == 'reference':
        base += ' build'
    fields(request, base)
    require(request['schema'] == f'bw.bochs-ring3.{route}-request.v1' and
            request['repository'] == REPOSITORY and
            integer(request['pullRequest'], 1, 1000000) and
            digest(request['policySha256']), 'selected fixed request identity')
    source = fields(request['source'], 'head tree files')
    digest(source['head'], 40)
    digest(source['tree'], 40)
    if selected_head is not None:
        require(source['head'] == selected_head, 'selected checkout head')
    require(type(source['files']) is dict and len(source['files']) == 12,
            'complete twelve-source role roster')
    expected = tuple('scripts/i80386-bochs-ring3-reference/' + name for name in
                     ('run.py', 'reader.py', 'controls.py', 'README.md')) + (
        '.github/workflows/i80386-bochs-ring3-reference.yml',
        'test/i80386-bochs-ring3-reference.test.mjs',
        'src/experimental/i80386.js',
        'scripts/i80386-ring3-int-iret/fixture.mjs',
        'scripts/i80386-ring3-int-iret/probe.mjs',
        'package.json', 'package-lock.json', 'LICENSE')
    require(set(source['files']) == set(expected), 'exact source twelve paths')
    for row in source['files'].values():
        fields(row, 'mode gitBlob bytes sha256')
        require(row['mode'] in ('100644', '100755') and
                digest(row['gitBlob'], 40) and digest(row['sha256']) and
                integer(row['bytes'], 1, 1048576), 'bounded typed source role')
    label = ('x86-bochs-ring3-toolchain-inventory-v1' if route == 'toolchain'
             else f'x86-bochs-ring3-{route}-v1')
    require(type(event) is dict and
            type(event.get('label')) is dict and
            type(event.get('sender')) is dict and
            type(event.get('pull_request')) is dict,
            'typed owner-selected route event')
    require(type(event) is dict and event.get('action') == 'labeled' and
            event.get('label', {}).get('name') == label and
            event.get('sender', {}).get('login') == 'CrispStrobe',
            'owner-selected exact route event')
    pr = event.get('pull_request')
    require(type(pr.get('base')) is dict and
            type(pr.get('head')) is dict and
            type(pr['base'].get('repo')) is dict and
            type(pr['head'].get('repo')) is dict,
            'typed ready owned source PR')
    require(type(pr) is dict and
            event.get('number') == request['pullRequest'] == pr.get('number') and
            pr.get('state') == 'open' and pr.get('draft') is False and
            pr.get('base', {}).get('ref') == 'master' and
            pr.get('base', {}).get('repo', {}).get('full_name') == REPOSITORY and
            pr.get('head', {}).get('sha') == source['head'] and
            pr.get('head', {}).get('repo', {}).get('full_name') == REPOSITORY and
            pr.get('head', {}).get('repo', {}).get('fork') is False,
            'exact owned ready PR and selected source')
    prefix = f'BW_BOCHS_RING3_{route.upper()}_REQUEST'
    body = pr.get('body')
    require(type(body) is str and
            body.count('<!-- ' + prefix + '_SHA256=') == 1 and
            re.findall(r'<!-- ' + re.escape(prefix) +
                       r'_SHA256=([0-9a-f]{64}) -->', body) == [sha(request_raw)],
            'exact selected event body transport')
    if route == 'build':
        fields(request['bochs'],
               'repository commit tree sourceSelectionSha256 vga')
        require(request['bochs']['repository'] == 'bochs-emu/Bochs' and
                request['bochs']['commit'] == BOCHS_COMMIT and
                request['bochs']['tree'] == BOCHS_TREE and
                request['bochs']['sourceSelectionSha256'] ==
                SOURCE_SELECTION_SHA256, 'pinned selected upstream source')
        vga = fields(request['bochs']['vga'],
                     'path gitBlob bytes noticePath noticeGitBlob '
                     'correspondingSource')
        require(vga['path'] == VGA_PATH and vga['gitBlob'] == VGA_BLOB and
                vga['bytes'] == VGA_SELECTED_BYTES and
                vga['noticePath'] == 'bochs/bios/VGABIOS-lgpl-README' and
                vga['noticeGitBlob'] == VGA_NOTICE_BLOB,
                'fixed reviewed LGPL VGA resource and notice')
        correspondence = fields(vga['correspondingSource'],
                                'url bytes sha256 licensePath licenseSha256 '
                                'version selectedResourceGitBlob')
        require(correspondence['url'] ==
                'https://download-mirror.savannah.gnu.org/releases/vgabios/vgabios-0.8a.tgz'
                and correspondence['bytes'] == VGA_SOURCE_BYTES and
                correspondence['sha256'] == VGA_SOURCE_SHA256 and
                correspondence['licensePath'] == 'vgabios-0.8a/COPYING' and
                correspondence['licenseSha256'] == VGA_COPYING_SHA256 and
                correspondence['version'] == '0.8a' and
                correspondence['selectedResourceGitBlob'] == VGA_BLOB,
                'exact selected corresponding LGPL source and license bytes')
        selected_toolchain = fields(request['toolchain'],
                                    'files aliases directoryAliases inventory node')
        inventory = fields(selected_toolchain['inventory'],
                           'runId jobId artifactId archiveBytes archiveSha256 '
                           'requestSha256 reportSha256 sourceHead sourceTree '
                           'workflowCommit')
        require(type(inventory['runId']) is str and
                re.fullmatch('[1-9][0-9]{0,19}', inventory['runId']) and
                integer(inventory['jobId'], 1) and
                integer(inventory['artifactId'], 1) and
                integer(inventory['archiveBytes'], 1, 8 << 20) and
                all(digest(inventory[name]) for name in
                    ('archiveSha256', 'requestSha256', 'reportSha256')) and
                digest(inventory['workflowCommit'], 40) and
                inventory['sourceHead'] == source['head'] and
                inventory['sourceTree'] == source['tree'],
                'immutable independently selected pre-Build inventory reference')
        selected_tool_graph(selected_toolchain)
    return request, event


def selected_tool_graph(selected):
    fields(selected, 'files aliases directoryAliases inventory node')
    node = fields(selected['node'],
                  'cachePath bytes sha256 elf stageMode stageUid stageGid')
    require(node['cachePath'] == NODE_CACHE_PATH and
            node['bytes'] == NODE_BYTES and node['sha256'] == NODE_SHA256 and
            node['stageMode'] == (stat.S_IFREG | 0o555) and
            type(node['stageUid']) is int and node['stageUid'] == 0 and
            type(node['stageGid']) is int and node['stageGid'] == 0,
            'source-selected immutable staged Node expectation')
    elf = fields(node['elf'], 'class machine type interpreter needed '
                 'rpath runpath')
    require(elf['class'] == 'ELF64' and elf['machine'] == 'x86-64' and
            elf['type'] in ('EXEC', 'DYN') and
            elf['interpreter'] in (None,
                                   '/lib64/ld-linux-x86-64.so.2') and
            type(elf['needed']) is list and len(elf['needed']) <= 64 and
            all(type(name) is str and
                re.fullmatch(r'[A-Za-z0-9+_.-]+', name)
                for name in elf['needed']) and
            len(set(elf['needed'])) == len(elf['needed']) and
            elf['rpath'] is None and elf['runpath'] is None,
            'bounded selected staged Node ELF dependency facts')
    require(type(selected['files']) is dict and
            1 <= len(selected['files']) <= 128 and
            NODE_CACHE_PATH not in selected['files'] and
            type(selected['aliases']) is dict and
            len(selected['aliases']) <= 128 and
            type(selected['directoryAliases']) is dict and
            len(selected['directoryAliases']) <= 32 and
            not (set(selected['aliases']) &
                 set(selected['directoryAliases'])),
            'finite externally selected toolchain graph')
    aggregate = 0
    for path, row in selected['files'].items():
        fields(row, 'bytes sha256 mode uid gid elf')
        require(type(path) is str and path.startswith('/') and
                len(path) <= 512 and posixpath.normpath(path) == path and
                all(part not in ('', '.', '..') for part in path[1:].split('/')) and
                path.startswith(('/usr/bin/', '/usr/lib/', '/bin/', '/lib/',
                                 '/lib64/', '/opt/hostedtoolcache/node/22.23.3/x64/',
                                 '/usr/share/doc/', '/usr/share/common-licenses/')) and
                integer(row['bytes'], 1, 128 << 20) and
                digest(row['sha256']) and
                integer(row['mode'], 0) and
                stat.S_ISREG(row['mode']) and
                row['mode'] & 0o022 == 0 and
                integer(row['uid'], 0) == 0 and
                integer(row['gid'], 0) == 0,
                'bounded selected cross-job tool byte identity')
        aggregate += row['bytes']
        if row['elf'] is not None:
            elf = fields(row['elf'],
                         'class machine type interpreter needed rpath runpath')
            require(elf['class'] == 'ELF64' and
                    elf['machine'] == 'x86-64' and
                    elf['type'] in ('EXEC', 'DYN') and
                    (elf['interpreter'] is None or
                     elf['interpreter'] == '/lib64/ld-linux-x86-64.so.2') and
                    type(elf['needed']) is list and len(elf['needed']) <= 64 and
                    all(type(name) is str and
                        re.fullmatch('[A-Za-z0-9._+-]+', name)
                        for name in elf['needed']) and
                    len(set(elf['needed'])) == len(elf['needed']) and
                    elf['rpath'] is None and elf['runpath'] is None,
                    'closed static selected ELF dependency summary')
    require(aggregate <= 256 << 20,
            'bounded selected one-pass tool byte graph')
    for group in ('aliases', 'directoryAliases'):
        for path, row in selected[group].items():
            require(type(path) is str and path.startswith('/') and
                    len(path) <= 512 and posixpath.normpath(path) == path and
                    all(part not in ('', '.', '..') for part in path[1:].split('/')),
                    'selected lexical tool alias path')
            fields(row, 'linkText target')
            require(type(row['linkText']) is str and
                    0 < len(row['linkText']) <= 256 and
                    '\0' not in row['linkText'] and
                    type(row['target']) is str and
                    row['target'] == posixpath.normpath(
                        row['linkText'] if row['linkText'].startswith('/') else
                        posixpath.join(posixpath.dirname(path),
                                       row['linkText'])) and
                    row['target'].startswith('/') and
                    len(row['target']) <= 512,
                    'bounded selected alias target derived from text')
    for source_path in REQUIRED_TOOL_PATHS:
        require(resolve_selected_alias(source_path, selected) in
                selected['files'], 'complete externally selected fixed tool roster')
    for row in selected['files'].values():
        if row['elf'] is None:
            continue
        required = ([row['elf']['interpreter']] if
                    row['elf']['interpreter'] else []) + [
            '/usr/lib/x86_64-linux-gnu/' + name
            for name in row['elf']['needed']]
        for path in required:
            require(resolve_selected_alias(path, selected) in
                    selected['files'],
                    'externally selected ELF dependency graph closure')
    node_elf = node['elf']
    for path in ([node_elf['interpreter']] if node_elf['interpreter'] else []) + [
            '/usr/lib/x86_64-linux-gnu/' + name
            for name in node_elf['needed']]:
        require(resolve_selected_alias(path, selected) in selected['files'],
                'staged Node ELF dependencies in selected readonly tool graph')
    return selected


def resolve_selected_alias(path, selected):
    require(type(path) is str and path.startswith('/') and len(path) <= 512,
            'bounded selected tool path')
    current, seen = path, set()
    for _ in range(16):
        require(current not in seen, 'acyclic selected tool alias')
        seen.add(current)
        choices = []
        for group in ('aliases', 'directoryAliases'):
            for name, row in selected[group].items():
                if current == name or current.startswith(name + '/'):
                    choices.append((len(name), name, row))
        if not choices:
            return current
        _, name, row = max(choices, key=lambda item: item[0])
        require(type(row['linkText']) is str and
                0 < len(row['linkText']) <= 256 and
                type(row['target']) is str and
                row['target'] == posixpath.normpath(
                    row['linkText'] if row['linkText'].startswith('/') else
                    posixpath.join(posixpath.dirname(name), row['linkText'])),
                'cross-job alias text/target consistency')
        current = posixpath.normpath(row['target'] + current[len(name):])
    raise Refusal('selected alias depth cap')


def source_facts(value, selected):
    fields(value, 'head tree files workflowCommit workflowTree '
           'workflowFileSha256')
    require(value['head'] == selected['head'] and
            value['tree'] == selected['tree'] and
            type(value['files']) is dict and
            set(value['files']) == set(selected['files']) and
            digest(value['workflowCommit'], 40) and
            digest(value['workflowTree'], 40) and
            value['workflowFileSha256'] == selected['files'][
                '.github/workflows/i80386-bochs-ring3-reference.yml']['sha256'],
            'selected checkout H and executing workflow bytes')
    for name, row in value['files'].items():
        require(strict_equal(row, selected['files'][name]),
                'exact twelve-source role readback')
    return value


def node_stage_fact(raw, *, route, run_id, expected=None):
    """Grade reported cache DATA and a separate readonly staged executable."""
    require(route in ('toolchain', 'build', 'reference') and
            type(run_id) is str and re.fullmatch(r'[1-9][0-9]{0,19}', run_id),
            'closed selected Node-stage route and run')
    value = parse_json(raw, 65536, canonical_wire=True)
    fields(value, 'schema sourcePath stagePath recordPath invoker '
           'metadataFields created sourceBefore sourceAfter sourceNamedAfter '
           'sourceBytesRead bytesCopied writeUncertain copiedSha256 '
           'readbackBytes readbackSha256 elfReadBytes elf '
           'fileBeforePublication parents directoryInitial fileInitial '
           'targetAfterFailure directoryAfterFailure lastOperation file '
           'fileNamed directoryBeforePublication directory directoryNamed '
           'filePublicationAttempted directoryPublicationAttempted '
           'filePublished directoryPublished record checkedAfter '
           'firstFailure secondary')
    directory = f'/run/bw-bochs-{route}-v1-{run_id}-1-node'
    require(value['schema'] == 'bw.bochs-ring3.node-stage.v1' and
            value['sourcePath'] == NODE_CACHE_PATH and
            value['stagePath'] == directory + '/node' and
            value['recordPath'] == directory + '/stage.json' and
            value['metadataFields'] == list(NODE_METADATA_FIELDS) and
            value['created'] == [directory, directory + '/node',
                                 directory + '/stage.json'],
            'one source-derived per-run Node stage and fixed metadata fields')
    invoker = fields(value['invoker'], 'uid gid')
    integer(invoker['uid'], 1, 2**31 - 1)
    integer(invoker['gid'], 1, 2**31 - 1)

    def identity(row):
        require(type(row) is list and len(row) == 9 and
                all(type(item) is int and item >= 0 for item in row) and
                row[1] > 0, 'typed nine-field held/named Node identity')
        return row

    source = identity(value['sourceBefore'])
    require(source == identity(value['sourceAfter']) ==
            identity(value['sourceNamedAfter']) and
            stat.S_ISREG(source[2]) and source[2] & 0o6000 == 0 and
            source[5:7] == [1, NODE_BYTES] and
            tuple(source[3:5]) in ((0, 0),
                                   (invoker['uid'], invoker['gid'])),
            'fixed complete cache DATA byte extent and stable source identity')
    first_file = identity(value['fileInitial'])
    private_file = identity(value['fileBeforePublication'])
    published_file = identity(value['file'])
    require(first_file[2:7] == [stat.S_IFREG | 0o600, 0, 0, 1, 0] and
            private_file[2:7] == [stat.S_IFREG | 0o600, 0, 0, 1,
                                   NODE_BYTES] and
            published_file[2:7] == [stat.S_IFREG | 0o555, 0, 0, 1,
                                     NODE_BYTES] and
            first_file[:2] == private_file[:2] == published_file[:2] and
            published_file == identity(value['fileNamed']),
            'one fresh private Node output becomes same readonly executable')
    first_dir = identity(value['directoryInitial'])
    private_dir = identity(value['directoryBeforePublication'])
    published_dir = identity(value['directory'])
    require(first_dir[2:5] == private_dir[2:5] ==
            [stat.S_IFDIR | 0o700, 0, 0] and
            published_dir[2:5] == [stat.S_IFDIR | 0o555, 0, 0] and
            first_dir[:2] == private_dir[:2] == published_dir[:2] and
            published_dir == identity(value['directoryNamed']),
            'one root-private stage directory becomes readonly and traversable')
    require(type(value['parents']) is dict and
            set(value['parents']) == {'/', '/run'},
            'fixed root-owned stage parent roster')
    for parent in value['parents'].values():
        fields(parent, 'before namedBefore after namedAfter')
        rows = [identity(parent[key]) for key in
                ('before', 'namedBefore', 'after', 'namedAfter')]
        require(all(row[:5] == rows[0][:5] for row in rows) and
                stat.S_ISDIR(rows[0][2]) and
                rows[0][3:5] == [0, 0] and
                rows[0][2] & 0o022 == 0,
                'stable held and named root parent directory identity')
    require(value['sourceBytesRead'] == value['bytesCopied'] ==
            value['readbackBytes'] == NODE_BYTES and
            value['copiedSha256'] == value['readbackSha256'] == NODE_SHA256 and
            value['writeUncertain'] is False and
            all(value[name] is True for name in
                ('filePublicationAttempted',
                 'directoryPublicationAttempted', 'filePublished',
                 'directoryPublished')) and
            value['firstFailure'] is None and value['secondary'] == [] and
            value['targetAfterFailure'] is None and
            value['directoryAfterFailure'] is None,
            'complete one-attempt copied and independently rehashed Node')
    integer(value['elfReadBytes'], 1, 2097152)
    elf = fields(value['elf'], 'class machine type interpreter needed '
                 'rpath runpath')
    require(elf['class'] == 'ELF64' and elf['machine'] == 'x86-64' and
            elf['type'] in ('EXEC', 'DYN') and
            elf['interpreter'] in (None,
                                   '/lib64/ld-linux-x86-64.so.2') and
            type(elf['needed']) is list and len(elf['needed']) <= 64 and
            all(type(name) is str and
                re.fullmatch(r'[A-Za-z0-9+_.-]+', name)
                for name in elf['needed']) and
            len(set(elf['needed'])) == len(elf['needed']) and
            elf['rpath'] is None and elf['runpath'] is None,
            'bounded reported staged Node ELF graph without injected search')
    record = fields(value['record'], 'bytes sha256 metadata text')
    installation = canonical({
        'schema': 'bw.bochs-ring3.node-installation.v1',
        'sourcePath': NODE_CACHE_PATH, 'stagePath': directory + '/node',
        'bytes': NODE_BYTES, 'sha256': NODE_SHA256,
        'uid': 0, 'gid': 0, 'mode': stat.S_IFREG | 0o555})
    require(type(record['text']) is str and
            record['text'].encode('utf-8') == installation and
            record['bytes'] == len(installation) and
            record['sha256'] == sha(installation) and
            identity(record['metadata'])[2:7] ==
            [stat.S_IFREG | 0o444, 0, 0, 1, len(installation)],
            'exact root-readonly canonical staged Node installation record')
    checked = fields(value['checkedAfter'],
                     'hashRead bytesRead sha256 before after named elf '
                     'elfReadBytes')
    require(identity(checked['before']) ==
            identity(checked['after']) ==
            identity(checked['named']) == published_file,
            'same immutable staged Node after route work')
    if route == 'toolchain':
        require(checked['hashRead'] is False and
                checked['bytesRead'] == 0 and checked['sha256'] is None and
                checked['elf'] is None and checked['elfReadBytes'] == 0,
                'metadata route only reports after identity, without Node exec')
    else:
        require(checked['hashRead'] is True and
                checked['bytesRead'] == NODE_BYTES and
                checked['sha256'] == NODE_SHA256 and
                strict_equal(checked['elf'], elf),
                'Build/reference route fully rehashes staged Node after work')
        integer(checked['elfReadBytes'], 1, 2097152)
    projection = {'cachePath': NODE_CACHE_PATH, 'bytes': NODE_BYTES,
                  'sha256': NODE_SHA256, 'elf': elf,
                  'stageMode': stat.S_IFREG | 0o555,
                  'stageUid': 0, 'stageGid': 0}
    if expected is not None:
        require(strict_equal(expected, projection),
                'external selected Node expectation equals staged data')
    return value, projection


def common_original(route, raw, request_raw, event_raw):
    value = parse_json(raw, 4 << 20)
    fields(value, 'schema requestSha256 eventSha256 sourceBefore sourceAfter '
           'phases resources firstFailure secondary failurePartial complete '
           'authority observations')
    require(value['schema'] == f'bw.bochs-ring3.{route}-original.v1' and
            value['requestSha256'] == sha(request_raw) and
            value['eventSha256'] == sha(event_raw) and
            type(value['complete']) is bool, 'selected bounded original identity')
    failures(value['firstFailure'], value['secondary'],
             complete=value['complete'])
    if value['complete']:
        require(value['failurePartial'] is None,
                'complete original has no failed file partial')
    authority = fields(value['authority'], 'compilerExecuted guestExecuted '
                       'actualRunApproved guestApproved wholeHostAttested '
                       'physicalTimingProved')
    require(all(authority[key] is False for key in
                ('actualRunApproved', 'guestApproved', 'wholeHostAttested',
                 'physicalTimingProved')) and
            (type(authority['compilerExecuted']) is bool or
             authority['compilerExecuted'] is None) and
            (type(authority['guestExecuted']) is bool or
             authority['guestExecuted'] is None) and
            (route != 'toolchain' or
             (authority['compilerExecuted'] is False and
              authority['guestExecuted'] is False)) and
            (route != 'build' or authority['guestExecuted'] is False) and
            (route != 'reference' or authority['compilerExecuted'] is False) and
            (not value['complete'] or
             ((route != 'build' or authority['compilerExecuted'] is True) and
              (route != 'reference' or authority['guestExecuted'] is True))),
            'retained observation cannot self-approve')
    expected = {'toolchain': 'inventoryBefore inventoryAfter status '
                 'sourceSelection reportedReadbackOnly notices nodeStage',
                'build': 'upstream sourceSelection toolchainBefore toolchainAfter '
                 'configure configHeader compilerCommands binary runtimeManifest '
                 'notices compactManifest correspondingSource nodeStage',
                'reference': 'build assetsBefore assetsAfter fixture config js '
                 'bochs stop outside cleanup nodeStage'}[route]
    fields(value['observations'], expected)
    require(type(value['phases']) is list and len(value['phases']) <= 32 and
            type(value['resources']) is dict,
            'finite selected phase and resource facts')
    return value


def artifact_manifest(packet, *, required, dynamic=()):
    require(type(packet) is dict and
            set(packet) == set(required) | set(dynamic) and
            'manifest.json' in packet,
            'complete exact selected archive role roster')
    manifest = parse_json(packet['manifest.json'], 4 << 20,
                          canonical_wire=True)
    fields(manifest, 'schema files')
    require(manifest['schema'] == 'bw.bochs-ring3.artifact-manifest.v1' and
            type(manifest['files']) is dict and
            set(manifest['files']) == set(packet) - {'manifest.json'},
            'closed artifact manifest excludes only itself')
    for role, raw in packet.items():
        if role == 'manifest.json':
            continue
        row = fields(manifest['files'][role], 'bytes sha256')
        require(integer(row['bytes'], 0, 384 << 20) == len(raw) and
                digest(row['sha256']) == sha(raw),
                'independently hashed complete artifact role')
    return manifest


def toolchain_original(packet, request_raw, event_raw):
    require(set(packet) == INVENTORY_ROLES,
            'exact thirteen retained inventory roles')
    artifact_manifest(packet, required=INVENTORY_ROLES)
    request, _event = request_event('toolchain', request_raw, event_raw)
    require(packet['request.original.json'] == request_raw and
            packet['event.original.json'] == event_raw,
            'selected exact raw inventory request/event')
    value = common_original('toolchain', packet['original.json'],
                            request_raw, event_raw)
    require(value['complete'] is True and
            value['observations']['reportedReadbackOnly'] is True and
            value['observations']['sourceSelection'] ==
            SOURCE_SELECTION_SHA256,
            'read-only selected tool inventory completion')
    before = source_facts(parse_json(packet['source.before.json'], 4 << 20,
                                     canonical_wire=True), request['source'])
    after = source_facts(parse_json(packet['source.after.json'], 4 << 20,
                                    canonical_wire=True), request['source'])
    require(strict_equal(before, after) and
            strict_equal(value['sourceBefore'], before) and
            strict_equal(value['sourceAfter'], after),
            'independent source before/after original joins')
    g_before = parse_json(packet['inventory.before.json'], 4 << 20,
                          canonical_wire=True)
    g_after = parse_json(packet['inventory.after.json'], 4 << 20,
                         canonical_wire=True)
    before_fact = tool_graph(g_before)
    tool_graph(g_after)
    require(strict_equal(g_before, g_after) and
            strict_equal(value['observations']['inventoryBefore'], g_before) and
            strict_equal(value['observations']['inventoryAfter'], g_after),
            'unchanged reported finite tool identities')
    outside = parse_json(packet['outside.original.json'], 65536,
                         canonical_wire=True)
    node_stage, _node_projection = node_stage_fact(
        packet['node-stage.original.json'], route='toolchain',
        run_id=outside['runId'])
    require(strict_equal(value['observations']['nodeStage'], node_stage) and
            NODE_CACHE_PATH not in g_before['files'],
            'separate staged Node original and cache DATA boundary')
    notice_summary = notice_facts(packet['notices.original.json'], g_before)
    require(strict_equal(value['observations']['notices'],
                         parse_json(packet['notices.original.json'], 4 << 20,
                                    canonical_wire=True)) and
            notice_summary['noticeCount'] == 7,
            'exact seven source-selected retained notice observations')
    status = fields(value['observations']['status'],
                    'bytes sha256 packages observation')
    raw_status = packet['dpkg-status.original']
    require(integer(status['bytes'], 1, 4 << 20) == len(raw_status) and
            digest(status['sha256']) == sha(raw_status) and
            strict_equal(status['packages'], debian_status(raw_status)),
            'independently parsed selected raw Debian status')
    file_fact(status['observation'], raw=raw_status)
    require(status['observation']['before']['uid'] == 0 and
            status['observation']['before']['gid'] == 0,
            'root-owned bounded Debian status readback')
    require(before_fact['selectedBytes'] * 2 +
            node_stage['sourceBytesRead'] + node_stage['readbackBytes'] +
            node_stage['elfReadBytes'] +
            sum(row['bytes'] for row in
                parse_json(packet['notices.original.json'], 4 << 20,
                           canonical_wire=True).values()) <= 536870912,
            'complete selected tool, staged Node and notice read budget')
    observer = parse_json(packet['process.original.json'], 65536,
                          canonical_wire=True)
    fields(observer, 'schema pid uid gid startedNs endedNs requestSha256 '
           'sourceHead plannedExitCode firstFailure secondary')
    require(observer['schema'] == 'bw.bochs-ring3.toolchain-observer.v1' and
            integer(observer['pid'], 1, 2**31 - 1) and
            observer['uid'] == observer['gid'] == 0 and
            integer(observer['startedNs'], 0) <=
            integer(observer['endedNs'], 0) and
            observer['requestSha256'] == sha(request_raw) and
            observer['sourceHead'] == request['source']['head'] and
            observer['plannedExitCode'] == 0 and
            strict_equal(observer['firstFailure'], value['firstFailure']) and
            strict_equal(observer['secondary'], value['secondary']),
            'source-bound finite metadata observer facts')
    failures(observer['firstFailure'], observer['secondary'], complete=True)
    outside = parse_json(packet['outside.original.json'], 65536,
                         canonical_wire=True)
    fields(outside, 'schema route runId runAttempt unit serviceExitCode '
           'clientExitCode cleanupExitCode innerComplete innerFirstFailure '
           'before after manual firstFailure secondary')
    require(outside['schema'] == 'bw.bochs-ring3.outside.v1' and
            outside['route'] == 'toolchain' and
            type(outside['runId']) is str and
            re.fullmatch('[1-9][0-9]*', outside['runId']) and
            outside['runAttempt'] == 1 and
            type(outside['runAttempt']) is int and
            outside['unit'] == ('bw-bochs-toolchain-v1-' +
                                outside['runId'] + '-1.service') and
            all(outside[name] == 0 and type(outside[name]) is int
                for name in ('serviceExitCode', 'clientExitCode',
                             'cleanupExitCode')) and
            outside['innerComplete'] is True and
            outside['innerFirstFailure'] is None and
            outside['manual'] is None,
            'complete source-owned inventory service/outer status')
    unit_fact(outside['before'], outside['unit'])
    unit_fact(outside['after'], outside['unit'], absent=True)
    failures(outside['firstFailure'], outside['secondary'], complete=True)
    observed_resources = fields(value['resources'], 'before after')
    limits = {'cpu.max': '100000 100000\n',
              'memory.max': '536870912\n',
              'memory.swap.max': '0\n', 'pids.max': '32\n'}
    resources_fact(observed_resources['before'], unit=outside['unit'],
                   limits=limits)
    resources_fact(observed_resources['after'], unit=outside['unit'],
                   limits=limits)
    first_directory = observed_resources['before']['directory']
    last_directory = observed_resources['after']['directory']
    require(all(first_directory[key] == last_directory[key] for key in
                ('dev', 'ino', 'mode', 'uid', 'gid')) and
            observed_resources['before']['pid'] ==
            observed_resources['after']['pid'] == observer['pid'],
            'same owned service cgroup and observer before/after')
    require(value['authority']['compilerExecuted'] is False and
            value['authority']['guestExecuted'] is False,
            'inventory does not execute compiler or guest')
    return {'schema': 'bw.bochs-ring3.toolchain-admission.v1',
            'selectedToolchainReadbackObserved': True,
            'selectedFileCount': before_fact['selectedFiles'],
            'sourceHead': before['head'], 'sourceTree': before['tree'],
            'officialMetadataBound': False,
            'compilerExecuted': False, 'guestExecuted': False,
            'actualRunApproved': False, 'guestApproved': False}


def build_original(packet, request_raw, event_raw, *, job_log=None,
                   budget=None):
    """Read one complete Build artifact, with no local official API authority."""
    require(set(packet) == BUILD_FIXED_ROLES,
            'exact complete retained Build artifact role roster')
    artifact_manifest(packet, required=BUILD_FIXED_ROLES)
    request, _event = request_event('build', request_raw, event_raw)
    require(packet['request.original.json'] == request_raw and
            packet['event.original.json'] == event_raw,
            'exact raw Build request and selected event')
    value = common_original('build', packet['build.original.json'],
                            request_raw, event_raw)
    require(value['complete'] is True and
            value['authority']['compilerExecuted'] is True and
            value['authority']['guestExecuted'] is False and
            len(value['phases']) == 2,
            'complete real Build compiler path without guest execution')
    before = source_facts(parse_json(packet['source.before.json'], 4 << 20,
                                     canonical_wire=True), request['source'])
    after = source_facts(parse_json(packet['source.after.json'], 4 << 20,
                                    canonical_wire=True), request['source'])
    require(strict_equal(before, after) and
            strict_equal(value['sourceBefore'], before) and
            strict_equal(value['sourceAfter'], after),
            'complete selected Build checkout before/after')
    upstream_before = parse_json(packet['upstream.before.json'], 4 << 20,
                                 canonical_wire=True)
    upstream_after = parse_json(packet['upstream.after.json'], 4 << 20,
                                canonical_wire=True)
    require(strict_equal(upstream_before, upstream_after) and
            strict_equal(value['observations']['upstream'], upstream_before),
            'complete pinned upstream source before/after')
    selected, source_rows = source_selection(
        packet['source-selection.original.json'])
    require(strict_equal(value['observations']['sourceSelection'], source_rows),
            'reviewed complete selected source manifest joined to Build')
    _, budget = selected_source_tar(
        packet['source-selected.original.tar.gz'], selected, budget=budget)
    _, budget = vga_corresponding_source(
        packet['notices/vgabios-corresponding-source.tar.gz'], budget=budget)
    tool_before = parse_json(packet['toolchain.before.json'], 4 << 20,
                             canonical_wire=True)
    tool_after = parse_json(packet['toolchain.after.json'], 4 << 20,
                            canonical_wire=True)
    tool_graph(tool_before)
    tool_graph(tool_after)
    selected = {name: request['toolchain'][name] for name in
                ('files', 'aliases', 'directoryAliases')}
    require(strict_equal(tool_before, tool_after) and
            strict_equal(tool_before, value['observations']['toolchainBefore'])
            and strict_equal(tool_after,
                             value['observations']['toolchainAfter']) and
            strict_equal(selected_tool_projection(tool_before), selected),
            'reported Build toolchain before/after equals selected byte graph')
    build_outside = parse_json(packet['outside.original.json'], 65536,
                               canonical_wire=True)
    build_node, _node_projection = node_stage_fact(
        packet['node-stage.original.json'], route='build',
        run_id=build_outside['runId'], expected=request['toolchain']['node'])
    require(strict_equal(value['observations']['nodeStage'], build_node) and
            NODE_CACHE_PATH not in tool_before['files'],
            'Build rechecks one separate fully hashed staged Node original')
    config_raw = packet['config.h.original']
    version_raw = packet['bxversion.h.original']
    config = generated_config(config_raw, version_raw)
    require(strict_equal(value['observations']['configure'], config),
            'independently decoded actual generated CPU3 configuration')
    for name, argv, wall in (
            ('configure', ['/bin/sh', './configure', '--enable-cpu-level=3',
                            '--with-nogui', '--disable-plugins',
                            '--disable-debugger', '--enable-all-optimizations'],
             900),
            ('make', ['/usr/bin/make', '-j1', 'bochs'], 900)):
        process = parse_json(packet[name + '.process.json'], 65536,
                             canonical_wire=True)
        phase_fact(process, packet[name + '.stdout'],
                   packet[name + '.stderr'], name=name,
                   wall_seconds=wall)
        require(process['argv'] == argv and
                strict_equal(value['phases'][0 if name == 'configure' else 1],
                             process),
                'selected actual Configure/Make argv and ordered phase originals')
    manifest_raw = packet['build-manifest.json']
    manifest = parse_json(manifest_raw, 4 << 20, canonical_wire=True)
    fields(manifest, 'schema source bochsSource sourceInventory '
           'toolchainInventory configure configHeader compilerCommands elf '
           'runtimeMembers notices sourceAfter firstFailure secondary '
           'buildCompleted guestExecuted')
    selected_inventory = fields(manifest['toolchainInventory'],
                                'selected before after')
    configure_manifest = fields(manifest['configure'],
                                'argv makeArgv facts versionHeader')
    require(manifest['schema'] == 'bw.bochs-ring3.build-manifest.v1' and
            manifest['buildCompleted'] is True and
            manifest['guestExecuted'] is False and
            manifest['firstFailure'] is None and
            manifest['secondary'] == [] and
            strict_equal(manifest['source'], request['source']) and
            strict_equal(manifest['bochsSource'], upstream_before) and
            strict_equal(manifest['sourceAfter'], after) and
            strict_equal(selected_inventory['before'], tool_before) and
            strict_equal(selected_inventory['after'], tool_after),
            'complete source-selected Build full manifest joins')
    source_inventory = fields(manifest['sourceInventory'],
                              'selection before after archive')
    source_archive = fields(source_inventory['archive'],
                            'path bytes sha256')
    require(strict_equal(source_inventory['selection'], source_rows) and
            strict_equal(source_inventory['before'], upstream_before) and
            strict_equal(source_inventory['after'], upstream_after) and
            source_archive == {
                'path': 'source-selected.original.tar.gz',
                'bytes': len(packet['source-selected.original.tar.gz']),
                'sha256': sha(packet['source-selected.original.tar.gz'])},
            'complete selected upstream archive and before/after manifest')
    require(strict_equal(selected_inventory['selected'], request['toolchain']) and
            strict_equal(configure_manifest['facts'], config) and
            configure_manifest['argv'] ==
            ['/bin/sh', './configure', '--enable-cpu-level=3', '--with-nogui',
             '--disable-plugins', '--disable-debugger',
             '--enable-all-optimizations'] and
            configure_manifest['makeArgv'] ==
            ['/usr/bin/make', '-j1', 'bochs'] and
            configure_manifest['versionHeader'] == {
                'path': 'bxversion.h.original',
                'bytes': len(version_raw), 'sha256': sha(version_raw)} and
            manifest['configHeader'] == {
                'path': 'config.h.original',
                'bytes': len(config_raw), 'sha256': sha(config_raw)},
            'fixed Configure/Make and generated header byte joins')
    require(type(manifest['compilerCommands']) is list and
            1 <= len(manifest['compilerCommands']) <= 8192 and
            strict_equal(manifest['compilerCommands'],
                         value['observations']['compilerCommands']) and
            strict_equal(manifest['notices'],
                         value['observations']['notices']) and
            strict_equal(manifest['notices'],
                         [row for row in manifest['runtimeMembers']
                          if type(row) is dict and row.get('role') == 'notice']),
            'retained actual compiler commands and source-selected notices')
    try:
        make_text = packet['make.stdout'].decode('utf-8')
    except UnicodeError as error:
        raise Refusal('UTF-8 retained Make stdout') from error
    observed_commands = [line for line in make_text.splitlines()
                         if ('/usr/bin/x86_64-linux-gnu-gcc-13' in line or
                             '/usr/bin/x86_64-linux-gnu-g++-13' in line)]
    require(manifest['compilerCommands'] == observed_commands and
            all(type(line) is str and len(line) <= 8192
                for line in observed_commands),
            'compiler command summary rederived from retained Make stdout')
    members, runtime_elf, budget = runtime_assets(
        packet['runtime.original.zip'], manifest['runtimeMembers'],
        request['toolchain'], selected_source=request['source'], budget=budget)
    observed_binary = fields(value['observations']['binary'],
                             'path bytes sha256 elf')
    require(observed_binary['path'] == 'bin/bochs' and
            observed_binary['bytes'] == len(members['bin/bochs']) and
            observed_binary['sha256'] == sha(members['bin/bochs']) and
            strict_equal(manifest['elf'], runtime_elf['bin/bochs']) and
            strict_equal(observed_binary['elf'],
                         runtime_elf['bin/bochs']) and
            strict_equal(value['observations']['runtimeManifest'],
                         parse_json(members['asset-manifest.json'], 4 << 20,
                                    canonical_wire=True)),
            'independently parsed retained Build ELF and asset table')
    compact_raw = packet['compact-manifest.json']
    compact = parse_json(compact_raw, 16384, canonical_wire=True)
    internal_frame = (b'BW_BOCHS_RING3_BUILD_MANIFEST_V1=' +
                      base64.b64encode(compact_raw) + b'\n')
    require(strict_equal(compact_build_log(
        internal_frame, request, full_manifest=manifest_raw,
        runtime_zip=packet['runtime.original.zip'],
        binary=members['bin/bochs'], config_header=config_raw), compact),
        'complete internal compact Build fields and role byte joins')
    if job_log is not None:
        require(strict_equal(compact_build_log(
            job_log, request, full_manifest=manifest_raw,
            runtime_zip=packet['runtime.original.zip'],
            binary=members['bin/bochs'], config_header=config_raw), compact),
            'retained official Build log compact frame equals artifact role')
    require(strict_equal(value['observations']['compactManifest'], compact),
            'same completed compact Build witness in original and artifact')
    fields(build_outside, 'schema route runId runAttempt unit serviceExitCode '
           'clientExitCode cleanupExitCode innerComplete innerFirstFailure '
           'before after manual firstFailure secondary')
    require(build_outside['schema'] == 'bw.bochs-ring3.outside.v1' and
            build_outside['route'] == 'build' and
            type(build_outside['runId']) is str and
            re.fullmatch('[1-9][0-9]*', build_outside['runId']) and
            type(build_outside['runAttempt']) is int and
            build_outside['runAttempt'] == 1 and
            build_outside['unit'] ==
            'bw-bochs-build-v1-' + build_outside['runId'] + '-1.service' and
            all(type(build_outside[name]) is int and
                build_outside[name] == 0 for name in
                ('serviceExitCode', 'clientExitCode', 'cleanupExitCode')) and
            build_outside['innerComplete'] is True and
            build_outside['innerFirstFailure'] is None and
            build_outside['manual'] is None,
            'selected complete Build service and outer terminal')
    unit_fact(build_outside['before'], build_outside['unit'])
    unit_fact(build_outside['after'], build_outside['unit'], absent=True)
    failures(build_outside['firstFailure'], build_outside['secondary'],
             complete=True)
    resources = fields(value['resources'], 'before after')
    limits = {'cpu.max': '100000 100000\n',
              'memory.max': '2147483648\n',
              'memory.swap.max': '0\n', 'pids.max': '64\n'}
    resources_fact(resources['before'], unit=build_outside['unit'],
                   limits=limits)
    resources_fact(resources['after'], unit=build_outside['unit'],
                   limits=limits)
    require(all(resources['before']['directory'][name] ==
                resources['after']['directory'][name] for name in
                ('dev', 'ino', 'mode', 'uid', 'gid')) and
            resources['before']['pid'] == resources['after']['pid'],
            'same bounded Build cgroup and service before/after')
    return {'schema': 'bw.bochs-ring3.build-admission.v1',
            'selectedBuildBytesObserved': True,
            'runtimeMemberCount': len(members),
            'officialMetadataBound': False,
            'compilerExecuted': True, 'guestExecuted': False,
            'actualRunApproved': False, 'guestApproved': False}


def build_archive(raw, *, job_log=None):
    """Decode exact outer ZIP once, then account for every nested payload."""
    packet, budget = archive_members(raw, BUILD_CAPS,
                                     allowed=BUILD_FIXED_ROLES)
    return build_original(packet, packet['request.original.json'],
                          packet['event.original.json'], job_log=job_log,
                          budget=budget)


def unit_fact(value, unit, *, absent=False):
    fields(value, 'path exists errno identity files children')
    require(value['path'] == '/sys/fs/cgroup/system.slice/' + unit and
            type(value['exists']) is bool and
            type(value['children']) is list and len(value['children']) <= 64 and
            type(value['files']) is dict,
            'exact owned service cgroup path/finite census')
    if absent:
        require(value['exists'] is False and value['errno'] == 2 and
                value['identity'] is None and value['files'] == {} and
                value['children'] == [],
                'terminal owned service cgroup absent')
    elif value['exists']:
        stat_fact(value['identity'], kind='directory')
        require(value['errno'] is None and
                value['identity']['uid'] == value['identity']['gid'] == 0 and
                value['identity']['mode'] & 0o022 == 0,
                'root-owned bounded service cgroup identity')
    else:
        require(value['errno'] == 2 and value['identity'] is None and
                value['files'] == {} and value['children'] == [],
                'observed absent service before cleanup')
    return value


def resources_fact(value, *, unit, limits):
    fields(value, 'schema unit pid uid gid cgroupPath directory files '
           'procCgroup procStat procStatus')
    path = '/sys/fs/cgroup/system.slice/' + unit
    require(value['schema'] == 'bw.bochs-ring3.resources.v1' and
            value['unit'] == unit and value['cgroupPath'] == path and
            integer(value['pid'], 1, 2**31 - 1) and
            value['uid'] == value['gid'] == 0,
            'exact root-owned selected service resource identity')
    directory = stat_fact(value['directory'], kind='directory')
    require(directory['uid'] == directory['gid'] == 0 and
            directory['mode'] & 0o022 == 0,
            'safe root-owned service cgroup directory')
    expected = ('cpu.max memory.max memory.swap.max pids.max '
                'cgroup.procs cgroup.events cgroup.stat cpu.stat').split()
    files = fields(value['files'], ' '.join(expected))
    for name, content in files.items():
        require(type(content) is str and ascii_bound(content, 4096) and
                '\0' not in content and content.endswith('\n'),
                'bounded ASCII cgroup control/census original')
    require(all(files[name] == expected for name, expected in limits.items()) and
            files['cgroup.procs'] == str(value['pid']) + '\n' and
            files['cgroup.events'] == 'populated 1\nfrozen 0\n' and
            files['cgroup.stat'] ==
            'nr_descendants 0\nnr_dying_descendants 0\n',
            'exact service limits and sole observer census')
    cpu_rows = {}
    for line in files['cpu.stat'].splitlines():
        match = re.fullmatch(r'([a-z_]+) ([0-9]+)', line)
        require(match is not None and match.group(1) not in cpu_rows,
                'bounded unique CPU accounting field')
        cpu_rows[match.group(1)] = int(match.group(2))
    require({'usage_usec', 'user_usec', 'system_usec'} <= set(cpu_rows) and
            len(cpu_rows) <= 16,
            'finite service CPU accounting observation')
    require(type(value['procCgroup']) is str and
            value['procCgroup'] == '0::/system.slice/' + unit + '\n' and
            type(value['procStat']) is str and
            value['procStat'].startswith(str(value['pid']) + ' (') and
            ascii_bound(value['procStat'], 4096) and
            type(value['procStatus']) is str and
            ascii_bound(value['procStatus'], 4096) and
            re.search(r'(?m)^Uid:\s+0\s+0\s+0\s+0$', value['procStatus']) and
            re.search(r'(?m)^Gid:\s+0\s+0\s+0\s+0$', value['procStatus']) and
            re.search(r'(?m)^Threads:\s+[1-9][0-9]*$', value['procStatus']),
            'bounded actual observer process placement and root credentials')
    return value


def ascii_bound(value, cap):
    if type(value) is not str:
        return False
    try:
        return 0 < len(value.encode('ascii')) <= cap
    except UnicodeError:
        return False


def stop_fact(stop, process, frame):
    fields(stop, 'reason signal sent pid sentNs frameSha256 firstFailure secondary')
    require(stop['reason'] == 'complete-frame' and stop['sent'] is True and
            stop['signal'] == 15 and stop['pid'] == process['pid'] and
            integer(stop['sentNs'], process['startedNs'], process['endedNs']) and
            stop['frameSha256'] == sha(frame),
            'exact one owned post-frame SIGTERM observation')
    failures(stop['firstFailure'], stop['secondary'], complete=True)
    wait4_sigterm(process)
    return stop


def official_expectation(value, route, request, event, source, archive_raw,
                         run, jobs, artifacts, job_log, observed_source):
    """Join retained metadata; the caller separately authenticates API intake."""
    fields(value, 'schema repository pullRequest runId runAttempt jobId jobName '
           'eventName actor head tree workflowCommit workflowTree '
           'workflowFileSha256 requestSha256 eventSha256 artifactId '
           'archiveBytes archiveSha256 conclusion steps')
    require(value['schema'] == f'bw.bochs-ring3.{route}-expectation.v1' and
            value['repository'] == REPOSITORY and
            value['eventName'] == 'pull_request' and
            value['actor'] == 'CrispStrobe' and
            value['conclusion'] == 'success' and
            type(value['runId']) is str and
            re.fullmatch('[1-9][0-9]*', value['runId']) and
            integer(value['runAttempt'], 1, 1) and
            integer(value['pullRequest'], 1) and
            integer(value['jobId'], 1) and
            integer(value['artifactId'], 1),
            'closed reviewed official route identity')
    for key in ('head', 'tree', 'workflowCommit', 'workflowTree'):
        digest(value[key], 40)
    for key in ('workflowFileSha256', 'requestSha256', 'eventSha256',
                'archiveSha256'):
        digest(value[key])
    require(value['requestSha256'] == sha(request) and
            value['eventSha256'] == sha(event) and
            value['head'] == source['head'] and
            value['tree'] == source['tree'] and
            value['workflowFileSha256'] == source['files'][
                '.github/workflows/i80386-bochs-ring3-reference.yml']['sha256'] and
            integer(value['archiveBytes'], 1, 96 << 20) == len(archive_raw) and
            value['archiveSha256'] == sha(archive_raw),
            'selected exact source, event and archive bytes')
    source_facts(observed_source, source)
    require(value['workflowCommit'] == observed_source['workflowCommit'] and
            value['workflowTree'] == observed_source['workflowTree'],
            'exact executed workflow identity in held source observation')
    require(type(job_log) is bytes and 0 < len(job_log) <= 8 << 20,
            'bounded selected official job log')
    for obj in (run, jobs, artifacts):
        require(type(obj) is dict, 'bounded retained official API JSON')
    require(type(run.get('repository')) is dict and
            type(run.get('head_repository')) is dict and
            type(run.get('actor')) is dict,
            'typed official run repository/actor')
    require(run.get('id') == int(value['runId']) and
            run.get('run_attempt') == 1 and
            run.get('head_sha') == value['head'] and
            run.get('event') == 'pull_request' and
            run.get('status') == 'completed' and
            run.get('conclusion') == 'success' and
            run.get('repository', {}).get('full_name') == REPOSITORY and
            run.get('head_repository', {}).get('full_name') == REPOSITORY and
            run.get('actor', {}).get('login') == 'CrispStrobe' and
            run.get('path') == '.github/workflows/i80386-bochs-ring3-reference.yml',
            'selected official run identity and terminal success')
    job_rows = jobs.get('jobs')
    require(type(job_rows) is list and
            jobs.get('total_count') == len(job_rows) and
            len(job_rows) <= 128 and
            all(type(j) is dict for j in job_rows) and
            all(type(j.get('id')) is int and j['id'] > 0 for j in job_rows) and
            len({j.get('id') for j in job_rows}) == len(job_rows),
            'complete bounded unique official job roster')
    selected = [j for j in job_rows if j.get('id') == value['jobId']]
    job_name = {'toolchain': 'bochs-ring3-toolchain-inventory-v1',
                'build': 'bochs-ring3-build-v1',
                'reference': 'bochs-ring3-reference-v1'}[route]
    require(value['jobName'] == job_name and
            len(selected) == 1 and selected[0].get('run_id') == int(value['runId'])
            and selected[0].get('head_sha') == value['head']
            and selected[0].get('name') == value['jobName'] and
            selected[0].get('status') == 'completed' and
            selected[0].get('conclusion') == 'success',
            'selected official job terminal identity')
    step_rows = selected[0].get('steps')
    require(type(step_rows) is list and len(step_rows) <= 64 and
            all(type(row) is dict for row in step_rows) and
            strict_equal(step_rows, value['steps']),
            'selected official exact step roster')
    require(all(type(row) is dict and
                row.get('number') == index and
                row.get('status') == 'completed' and
                row.get('conclusion') in ('success', 'skipped')
                for index, row in enumerate(step_rows, 1)),
            'ordered terminal official steps')
    required = {'toolchain': INVENTORY_USER_STEPS,
                'build': BUILD_USER_STEPS,
                'reference': REFERENCE_USER_STEPS}[route]
    names = [row['name'] for row in step_rows]
    indexes = [names.index(name) for name in required if names.count(name) == 1]
    require(len(indexes) == len(required) and indexes == sorted(indexes) and
            all(step_rows[index]['conclusion'] == 'success' for index in indexes),
            'exact source ordered successful official steps')
    rows = artifacts.get('artifacts')
    require(type(rows) is list and
            artifacts.get('total_count') == len(rows) and len(rows) <= 128 and
            all(type(row) is dict for row in rows),
            'complete bounded official artifact roster')
    selected_artifact = [a for a in rows if a.get('id') == value['artifactId']]
    artifact_name = 'i80386-bochs-ring3-' + (
        'toolchain-inventory' if route == 'toolchain' else route) + '-v1-originals'
    require(len(selected_artifact) == 1 and
            type(selected_artifact[0].get('workflow_run')) is dict and
            selected_artifact[0].get('name') == artifact_name and
            selected_artifact[0].get('size_in_bytes') == len(archive_raw) and
            selected_artifact[0].get('digest') == 'sha256:' + sha(archive_raw) and
            selected_artifact[0].get('expired') is False and
            selected_artifact[0].get('workflow_run', {}).get('id') ==
            int(value['runId']), 'selected official artifact identity/digest')
    return {'runId': value['runId'], 'jobId': value['jobId'],
            'artifactId': value['artifactId'], 'officialMetadataJoined': True,
            'officiallyAuthenticatedByLocalFiles': False}
