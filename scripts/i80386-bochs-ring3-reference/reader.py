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
    'make.stderr make.process.json service-status.original.json '
    'outside.original.json cleanup.original.json '
    'notices/vgabios-corresponding-source.tar.gz manifest.json '
    'runtime-elf-ranges.original.json host-runtime.original.json').split())
INVENTORY_ROLES = frozenset(('request.original.json event.original.json '
    'source.before.json source.after.json inventory.before.json '
    'inventory.after.json dpkg-status.original notices.original.json '
    'node-stage.original.json process.original.json '
    'service-status.original.json outside.original.json cleanup.original.json '
    'original.json manifest.json runtime-elf-ranges.original.json').split())
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
    'service-status.original.json outside.original.json cleanup.original.json '
    'original.json manifest.json runtime-elf-ranges.original.json '
    'host-runtime.original.json').split())
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


def runtime_zip_v2(raw, selected_rows, selected_toolchain, *, source_tar,
                   structural_raw, selected_source=None, budget=None):
    """Grade the no-system-library runtime ZIP under asset schema v2."""
    require(type(selected_rows) is list and 8 <= len(selected_rows) <= 256,
            'finite complete Alternative A runtime member table')
    selected = {}
    for row in selected_rows:
        fields(row, 'path role mode bytes sha256')
        name = safe_member(row['path'])
        role = ('executable' if name == 'bin/bochs' else
                'notice' if name.startswith('notices/') else
                'config' if name == 'config/bochsrc.template' else
                'rom' if name == 'inputs/fixture.rom' else
                'fixture' if name == 'inputs/fixture.json' else
                'vga' if name == 'resources/vgabios.bin' else
                'manifest' if name == 'asset-manifest.json' else None)
        require(name not in selected and not name.startswith('lib/') and
                role is not None and row['role'] == role and
                row['mode'] == (stat.S_IFREG | (0o555 if name == 'bin/bochs'
                                               else 0o444)) and
                integer(row['bytes'], 1, 128 << 20) and digest(row['sha256']),
                'unique closed runtime member without any system-library body')
        selected[name] = row
    mandatory = {'bin/bochs', 'inputs/fixture.rom', 'inputs/fixture.json',
                 'resources/vgabios.bin', 'config/bochsrc.template',
                 'asset-manifest.json',
                 'notices/bochs-selected-corresponding-source.tar.gz',
                 'notices/vgabios-corresponding-source.tar.gz'}
    require(mandatory <= set(selected) and
            all(name in mandatory or name.startswith('notices/')
                for name in selected),
            'all exact runtime inputs and complete source notices, no lib prefix')
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
    for name, data in members.items():
        row = selected[name]
        require(metadata[name]['mode'] == row['mode'] and
                len(data) == row['bytes'] and sha(data) == row['sha256'],
                'exact nested Alternative A member mode, extent and hash')
    binary = elf_static(members['bin/bochs'])
    require(binary['rpath'] is None and binary['runpath'] is None,
            'no built Bochs ELF search-path injection')
    require(len(members['inputs/fixture.rom']) == 65536 and
            sha(members['inputs/fixture.rom']) == ROM_SHA256,
            'unchanged authored ROM retained')
    require(len(members['resources/vgabios.bin']) == VGA_SELECTED_BYTES and
            sha(members['resources/vgabios.bin']) == VGA_SELECTED_SHA256,
            'exact selected LGPL VGA bytes retained')
    require(len(members['notices/vgabios-corresponding-source.tar.gz']) ==
            VGA_SOURCE_BYTES and
            sha(members['notices/vgabios-corresponding-source.tar.gz']) ==
            VGA_SOURCE_SHA256,
            'exact selected complete VGA corresponding source')
    _, budget = vga_corresponding_source(
        members['notices/vgabios-corresponding-source.tar.gz'], budget=budget)
    require(type(source_tar) is bytes and
            members['notices/bochs-selected-corresponding-source.tar.gz'] ==
            source_tar,
            'nested Bochs selected corresponding-source bytes equal outer reviewed TAR')
    authored_fixture(members)
    asset = parse_json(members['asset-manifest.json'], 4 << 20,
                       canonical_wire=True)
    fields(asset, 'schema source bochsSource hostNode hostRuntime files')
    require(asset['schema'] == 'bw.bochs-ring3.runtime-assets.v2' and
            type(asset['files']) is list and
            strict_equal(asset['files'], [selected[name] for name in
                                          sorted(selected) if name !=
                                          'asset-manifest.json']),
            'versioned inner runtime table excludes only its own manifest')
    fields(asset['source'], 'head tree filesSha256')
    if selected_source is not None:
        require(asset['source'] == {
                    'head': selected_source['head'],
                    'tree': selected_source['tree'],
                    'filesSha256': sha(canonical(selected_source['files']))},
                'Alternative A runtime asset source joins selected checkout')
    require(asset['bochsSource'] == {
                'commit': BOCHS_COMMIT, 'tree': BOCHS_TREE,
                'sourceSelectionSha256': SOURCE_SELECTION_SHA256},
            'unchanged pinned Bochs source selection in runtime asset')
    node = fields(asset['hostNode'],
                  'cachePath bytes sha256 elf stageMode stageUid stageGid')
    require(strict_equal(node, selected_toolchain['node']) and
            node['cachePath'] == NODE_CACHE_PATH and
            node['bytes'] == NODE_BYTES and node['sha256'] == NODE_SHA256 and
            not any(name.endswith('/node') for name in members),
            'Node cache DATA is independently staged, never bundled')
    host = fields(asset['hostRuntime'],
                  'loaderPath files aliases directoryAliases elfMetadata')
    observed_sparse = sparse_elf_role(structural_raw)
    require(set(host['elfMetadata']['files']) <= set(observed_sparse['files']) and
            all(strict_equal(row, observed_sparse['files'][path]) for path, row
                in host['elfMetadata']['files'].items()),
            'asset structural projection joins exact retained outer sparse role')
    require(set(observed_sparse['files']) <=
            set(selected_toolchain['files']) | {NODE_CACHE_PATH},
            'outer structural candidates all belong to selected tool graph')
    for path, row in observed_sparse['files'].items():
        selected = (selected_toolchain['node'] if path == NODE_CACHE_PATH
                    else selected_toolchain['files'][path])
        require(row['fileBytes'] == selected['bytes'] and
                row['fileSha256'] == selected['sha256'] and
                {key: value for key, value in row['structure'].items()
                 if key != 'soname'} == selected['elf'],
                'every retained sparse candidate joins selected reported bytes')
    host_runtime_v2(host, selected_toolchain, binary)
    return members, asset, binary, budget


def host_runtime_v2(host, selected_toolchain, built_binary):
    """Close the selected transient host library graph, with sparse proof only."""
    fields(host, 'loaderPath files aliases directoryAliases elfMetadata')
    require(type(selected_toolchain) is dict and
            set(selected_toolchain) in (
                {'files', 'aliases', 'directoryAliases', 'node'},
                {'files', 'aliases', 'directoryAliases', 'node', 'inventory'}),
            'closed selected graph with optional separately admitted inventory')
    selected_files = selected_toolchain['files']
    selected_aliases = selected_toolchain['aliases']
    selected_directories = selected_toolchain['directoryAliases']
    require(type(host['files']) is dict and type(host['aliases']) is dict and
            type(host['directoryAliases']) is dict and
            1 <= len(host['files']) <= 128,
            'finite exact current-job host library closure')
    used_aliases = {'aliases': {}, 'directoryAliases': {}}

    def resolve(path):
        require(type(path) is str and path.startswith('/') and len(path) <= 512,
                'bounded source-derived runtime dependency path')
        current, seen = path, set()
        for _ in range(16):
            require(current not in seen, 'acyclic selected host runtime alias')
            seen.add(current)
            choices = []
            for group, rows in (('aliases', selected_aliases),
                                ('directoryAliases', selected_directories)):
                for name, row in rows.items():
                    if current == name or current.startswith(name + '/'):
                        choices.append((len(name), group, name, row))
            if not choices:
                return current
            _, group, name, row = max(choices, key=lambda item: item[0])
            require(type(row['linkText']) is str and
                    0 < len(row['linkText']) <= 256 and
                    type(row['target']) is str and
                    row['target'] == posixpath.normpath(
                        row['linkText'] if row['linkText'].startswith('/') else
                        posixpath.join(posixpath.dirname(name), row['linkText'])),
                    'selected host runtime alias target from raw link text')
            used_aliases[group][name] = row
            current = posixpath.normpath(row['target'] + current[len(name):])
        raise Refusal('selected host runtime alias depth cap')

    dependencies = (list(built_binary['needed']) +
                    list(selected_toolchain['node']['elf']['needed']))
    pending = ['/usr/lib/x86_64-linux-gnu/' + name for name in dependencies]
    for elf in (built_binary, selected_toolchain['node']['elf']):
        if elf['interpreter'] is not None:
            pending.append(elf['interpreter'])
    loader = resolve('/lib64/ld-linux-x86-64.so.2')
    pending.append('/lib64/ld-linux-x86-64.so.2')
    required = set()
    while pending:
        current = resolve(pending.pop())
        require(current in selected_files and
                type(selected_files[current]['elf']) is dict,
                'every current-job DT_NEEDED/interpreter has selected file')
        if current in required:
            continue
        required.add(current)
        require(len(required) <= 128,
                'bounded exact transitive host runtime closure')
        elf = selected_files[current]['elf']
        require(elf['rpath'] is None and elf['runpath'] is None,
                'no selected host runtime search-path injection')
        pending.extend('/usr/lib/x86_64-linux-gnu/' + name
                       for name in elf['needed'])
        if elf['interpreter'] is not None:
            pending.append(elf['interpreter'])
    require(host['loaderPath'] == loader and
            set(host['files']) == required and
            strict_equal(host['aliases'], used_aliases['aliases']) and
            strict_equal(host['directoryAliases'],
                         used_aliases['directoryAliases']),
            'no extra host files or aliases beyond the selected dependency graph')
    for path in required:
        require(strict_equal(host['files'][path], selected_files[path]),
                'exact selected canonical host file projection')
    metadata = host['elfMetadata']
    sparse_elf_role(canonical(metadata))
    require(set(metadata['files']) == required | {NODE_CACHE_PATH},
            'sparse structural role contains exactly host closure plus Node')
    for path in required:
        row = metadata['files'][path]
        selected = selected_files[path]
        require(row['fileBytes'] == selected['bytes'] and
                row['fileSha256'] == selected['sha256'] and
                {key: value for key, value in row['structure'].items()
                 if key != 'soname'} == selected['elf'],
                'independently decoded sparse structure joins reported host file')
    node = selected_toolchain['node']
    node_row = metadata['files'][NODE_CACHE_PATH]
    require(node_row['fileBytes'] == node['bytes'] and
            node_row['fileSha256'] == node['sha256'] and
            {key: value for key, value in node_row['structure'].items()
             if key != 'soname'} == node['elf'],
            'independently decoded sparse Node structure joins cache DATA')
    return {'selectedCanonicalFiles': len(required),
            'reportedWholeFileHashesIndependentlyRecomputed': False,
            'sparseStructureIndependentlyDecoded': True}


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


def sparse_elf_structure(row):
    """Decode only exact retained ELF structural ranges, never a system body."""
    fields(row, 'fileBytes fileSha256 structure ranges')
    extent = integer(row['fileBytes'], 64, 128 << 20)
    digest(row['fileSha256'])  # Reported whole-file readback, not sparse-rehashed.
    require(type(row['ranges']) is list and 1 <= len(row['ranges']) <= 1024,
            'finite reported structural ELF range roster')
    intervals = []
    total = 0
    previous = -1
    for item in row['ranges']:
        fields(item, 'offset bytes sha256 base64')
        start = integer(item['offset'], 0, extent - 1)
        amount = integer(item['bytes'], 1, 2 << 20)
        digest(item['sha256'])
        require(start > previous and amount <= extent - start,
                'sorted nonoverlapping and nonadjacent structural ranges')
        encoded = item['base64']
        require(type(encoded) is str and len(encoded) <= (8 << 20),
                'bounded canonical structural range transport')
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, base64.binascii.Error) as error:
            raise Refusal('bounded Base64 structural ELF range') from error
        require(len(data) == amount and base64.b64encode(data).decode() == encoded and
                sha(data) == item['sha256'],
                'exact retained structural ELF range extent and digest')
        intervals.append((start, start + amount, data))
        previous = start + amount
        total += amount
        require(total <= 2 << 20, 'per-file structural ELF range cap')
    accessed = []

    def read_at(offset, amount):
        require(type(offset) is int and type(amount) is int and
                0 <= offset <= extent and 0 < amount <= extent - offset,
                'file-backed selected structural ELF read')
        for start, end, data in intervals:
            if start <= offset and offset + amount <= end:
                accessed.append((offset, offset + amount))
                return data[offset - start:offset - start + amount]
        raise Refusal('missing exact selected structural ELF byte')

    header = read_at(0, 64)
    require(header[:4] == b'\x7fELF' and header[4:7] == b'\x02\x01\x01' and
            header[7] in (0, 3) and header[8] == 0 and
            header[9:16] == bytes(7),
            'selected sparse ELF64LE System V/GNU ABI and zero reserved bytes')
    try:
        (_, e_type, machine, version, _, phoff, _, _, ehsize, phentsize,
         phnum, _, _, _) = struct.unpack('<16sHHIQQQIHHHHHH', header)
    except struct.error as error:
        raise Refusal('complete selected sparse ELF header') from error
    require(e_type in (2, 3) and machine == 62 and version == 1 and
            ehsize == 64 and phentsize == 56 and 0 < phnum <= 1024 and
            64 <= phoff <= extent - phentsize * phnum,
            'selected x86-64 sparse program-header bounds')
    table = read_at(phoff, phentsize * phnum)
    loads = []
    dynamic = None
    interpreter = None
    for index in range(phnum):
        kind, _, offset, vaddr, _, size, memsize, _ = struct.unpack_from(
            '<IIQQQQQQ', table, 56 * index)
        require(offset <= extent and size <= extent - offset and
                memsize >= size, 'file-backed sparse ELF segment extent')
        if kind == 1:
            loads.append((vaddr, vaddr + size, offset))
        elif kind == 2:
            require(dynamic is None and size <= 65536 and size % 16 == 0,
                    'one bounded sparse PT_DYNAMIC')
            dynamic = (offset, size)
        elif kind == 3:
            require(interpreter is None and 1 < size <= 256,
                    'one bounded sparse PT_INTERP')
            item = read_at(offset, size)
            require(item.endswith(b'\0') and b'\0' not in item[:-1],
                    'complete sparse ELF interpreter string')
            try:
                interpreter = item[:-1].decode('ascii')
            except UnicodeError as error:
                raise Refusal('ASCII sparse ELF interpreter') from error
            require(interpreter == '/lib64/ld-linux-x86-64.so.2',
                    'fixed selected sparse ELF interpreter')

    def vaddr_offset(address, length):
        locations = [offset + address - start for start, end, offset in loads
                     if start <= address and length <= end - address]
        require(len(locations) == 1 and locations[0] <= extent - length,
                'one file-backed sparse ELF string-table mapping')
        return locations[0]

    needed_offsets = []
    strtab = strsize = soname_offset = None
    rpath_offset = runpath_offset = None
    if dynamic is not None:
        terminated = False
        dynamic_offset, dynamic_size = dynamic
        for offset in range(0, dynamic_size, 16):
            # Retain the used entry array through DT_NULL, never trailing
            # declared padding or executable bytes after that terminator.
            tag, value = struct.unpack('<qQ', read_at(dynamic_offset + offset, 16))
            if tag == 0:
                terminated = True
                break
            if tag == 1:
                needed_offsets.append(value)
            elif tag == 5:
                require(strtab is None, 'one sparse ELF string table')
                strtab = value
            elif tag == 10:
                require(strsize is None, 'one sparse ELF string table size')
                strsize = value
            elif tag == 14:
                require(soname_offset is None, 'one sparse ELF SONAME')
                soname_offset = value
            elif tag == 15:
                require(rpath_offset is None, 'one sparse ELF RPATH')
                rpath_offset = value
            elif tag == 29:
                require(runpath_offset is None, 'one sparse ELF RUNPATH')
                runpath_offset = value
        require(terminated, 'terminated sparse ELF dynamic segment')
    require(len(needed_offsets) <= 64 and
            (strtab is None) == (strsize is None) and
            (not needed_offsets and soname_offset is None and
             rpath_offset is None and runpath_offset is None or strtab is not None),
            'bounded sparse ELF string references')
    string_start = None
    if strtab is not None:
        # DT_STRSZ declares mapped extent. Only named strings are retained;
        # large compiler/Node tables need not be copied into this sparse role.
        require(0 < strsize <= extent, 'file-backed sparse ELF string table')
        string_start = vaddr_offset(strtab, strsize)

    def word(offset):
        require(string_start is not None and type(offset) is int and
                0 <= offset < strsize, 'selected sparse ELF string offset')
        raw = bytearray()
        for position in range(offset, min(strsize, offset + 513)):
            item = read_at(string_start + position, 1)
            if item == b'\0':
                try:
                    return raw.decode('ascii')
                except UnicodeError as error:
                    raise Refusal('ASCII sparse ELF string') from error
            raw.extend(item)
        raise Refusal('terminated bounded sparse ELF string')

    needed = [word(offset) for offset in needed_offsets]
    require(len(needed) == len(set(needed)) and
            all(re.fullmatch('[A-Za-z0-9._+-]+', name) for name in needed),
            'unique ordinary selected sparse ELF dependencies')
    soname = None if soname_offset is None else word(soname_offset)
    require(soname is None or re.fullmatch('[A-Za-z0-9._+-]+', soname),
            'ordinary selected sparse ELF SONAME')
    result = {'class': 'ELF64', 'machine': 'x86-64',
              'type': 'EXEC' if e_type == 2 else 'DYN',
              'interpreter': interpreter, 'needed': needed, 'soname': soname,
              'rpath': None if rpath_offset is None else word(rpath_offset),
              'runpath': None if runpath_offset is None else word(runpath_offset)}
    fields(row['structure'], 'class machine type interpreter needed soname rpath runpath')
    require(strict_equal(row['structure'], result),
            'independently decoded exact sparse ELF structural claims')
    merged = []
    for start, end in sorted(accessed):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    require([(start, end) for start, end, _ in intervals] == merged,
            'exact normalized requested structural bytes, no surplus or gap')
    return result


def sparse_elf_role(raw):
    value = parse_json(raw, 4 << 20, canonical_wire=True)
    fields(value, 'schema files rawBytes')
    require(value['schema'] == 'bw.bochs-ring3.runtime-elf-metadata.v1' and
            type(value['files']) is dict and 1 <= len(value['files']) <= 128,
            'closed finite structural ELF role')
    total = 0
    for path, row in value['files'].items():
        require(type(path) is str and path.startswith('/') and
                '\0' not in path and '..' not in path.split('/'),
                'absolute selected sparse structural source path')
        sparse_elf_structure(row)
        total += sum(item['bytes'] for item in row['ranges'])
        require(total <= 2 << 20, 'whole structural ELF role raw-byte cap')
    require(integer(value['rawBytes'], 1, 2 << 20) == total,
            'exact aggregate structural ELF range extent')
    return value


def selected_sparse_elf_fact(raw, graph, node):
    """Require every and only source-selected library candidate plus fixed Node."""
    role = sparse_elf_role(raw)
    fields(graph, 'files aliases directoryAliases')
    expected = {path for path, row in graph['files'].items()
                if row['elf'] is not None and
                ('/lib/' in path or '/lib64/' in path) and
                '.so' in posixpath.basename(path)} | {NODE_CACHE_PATH}
    require(set(role['files']) == expected,
            'exact current candidate sparse graph and fixed Node roster')
    for path, row in role['files'].items():
        source = node if path == NODE_CACHE_PATH else graph['files'][path]
        require(row['fileBytes'] == source['bytes'] and
                row['fileSha256'] == source['sha256'] and
                {name: item for name, item in row['structure'].items()
                 if name != 'soname'} == source['elf'],
                'independently decoded sparse structure equals selected whole-file observation')
    return role


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


def proc_text_fact(value, *, pid, ppid, uid, gid, cgroup, starttime=None):
    """Decode the independent proc text, not a producer-reported PID Boolean."""
    fields(value, 'pid procStat procStatus procCgroup procLimits fileObservations')
    require(value['pid'] == pid and value['procCgroup'] == cgroup and
            all(type(value[key]) is str and ascii_bound(value[key], 16384)
                for key in ('procStat', 'procStatus', 'procCgroup', 'procLimits')),
            'exact bounded proc raw roles and cgroup membership')
    raw_stat = value['procStat']
    match = re.fullmatch(r'([1-9][0-9]*) \((.*)\) ([A-Z]) (.*)\n?', raw_stat,
                         flags=re.DOTALL)
    require(match is not None and int(match.group(1)) == pid,
            'exact child /proc stat PID')
    tail = match.group(4).split()
    require(len(tail) >= 20 and
            re.fullmatch(r'[0-9]+', tail[0]) is not None and
            (ppid is None or tail[0] == str(ppid)) and
            re.fullmatch(r'[0-9]+', tail[18]) is not None,
            'exact child parent and starttime stat fields')
    started = int(tail[18])
    if starttime is not None:
        require(started == starttime, 'held child proc starttime across preexec/parent')
    status = value['procStatus']
    for key, expected in (('Pid', pid), ('PPid', ppid)):
        rows = re.findall(r'(?m)^' + key + r':\s+([0-9]+)$', status)
        require(rows == ([str(expected)] if expected is not None else [tail[0]]),
                'exact child status ' + key)
    for key, expected in (('Uid', uid), ('Gid', gid)):
        rows = re.findall(r'(?m)^' + key + r':\s+([0-9]+)\s+([0-9]+)\s+'
                          r'([0-9]+)\s+([0-9]+)$', status)
        require(rows == [(str(expected),) * 4], 'exact child status ' + key)
    require(len(re.findall(r'(?m)^Threads:\s+([1-9][0-9]*)$', status)) == 1,
            'bounded child thread status')
    observations = fields(value['fileObservations'], 'stat status cgroup limits')
    for name, metadata in observations.items():
        rows = fields(metadata, 'before after named')
        before = stat_fact(rows['before'], kind='regular')
        for key in ('after', 'named'):
            stat_fact(rows[key], kind='regular')
        require((before['uid'], before['gid']) in ((0, 0), (uid, gid)) and
                before['mode'] & 0o022 == 0 and
                all(all(before[field] == rows[key][field] for field in
                        ('dev', 'ino', 'mode', 'uid', 'gid'))
                    for key in ('after', 'named')),
                'stable held/named bounded proc inode owner and mode')
    return started


def parent_control_fact(value, *, unit, service_pid):
    fields(value, 'unitPath unitIdentity controllerPath controllerIdentity '
           'unitProcs controllerProcs availableBefore enabledBefore write '
           'availableAfter enabledAfter')
    path = '/sys/fs/cgroup/system.slice/' + unit
    require(value['unitPath'] == path and
            value['controllerPath'] == path + '/controller' and
            value['unitProcs'] == '' and
            value['controllerProcs'] == str(service_pid) + '\n',
            'fixed empty unit and sole root service controller subgroup')
    for name in ('unitIdentity', 'controllerIdentity'):
        row = stat_fact(value[name], kind='directory')
        require(row['uid'] == row['gid'] == 0 and row['mode'] & 0o022 == 0,
                'owned nonwritable delegated cgroup directory')
    def names(raw):
        require(type(raw) is str and len(raw) <= 4096 and '\0' not in raw,
                'bounded raw controller roster')
        rows = raw.split()
        require(len(rows) == len(set(rows)) and
                all(re.fullmatch(r'[a-z]+', row) for row in rows),
                'unique lower-case controller names')
        return set(rows)
    available = names(value['availableBefore'])
    enabled = names(value['enabledBefore'])
    require({'cpu', 'memory', 'pids'} <= available and enabled <= available and
            value['availableAfter'] == value['availableBefore'],
            'selected available delegated controllers')
    missing = sorted({'cpu', 'memory', 'pids'} - enabled)
    expected_write = ' '.join('+' + name for name in missing)
    if expected_write:
        expected_write += '\n'
    require(value['write'] == expected_write and
            names(value['enabledAfter']) == enabled | {'cpu', 'memory', 'pids'},
            'exact missing-only domain-controller enable and readback')
    return value


def child_cgroup_fact(value, *, unit, name, child_pid, service_pid, uid, gid,
                      after=False):
    fields(value, 'path identity files children parentControl memberProcesses procsAfter')
    path = '/sys/fs/cgroup/system.slice/' + unit + '/' + name
    require(value['path'] == path and value['children'] == [],
            'fixed leaf path and no nested child cgroup')
    row = stat_fact(value['identity'], kind='directory')
    require(row['uid'] == row['gid'] == 0 and row['mode'] & 0o777 == 0o755,
            'selected root-owned leaf mode')
    files = fields(value['files'], 'cpu.max memory.max memory.swap.max pids.max '
                   'cgroup.procs cgroup.events cgroup.stat cpu.stat')
    require(files['cpu.max'] == '100000 100000\n' and
            files['memory.max'] == ('2147483648\n' if name in ('configure', 'make')
                                    else '1073741824\n') and
            files['memory.swap.max'] == '0\n' and files['pids.max'] == '64\n',
            'actual selected child resource limits')
    for key in ('cgroup.events', 'cgroup.stat', 'cpu.stat'):
        require(type(files[key]) is str and ascii_bound(files[key], 4096),
                'bounded raw child resource text')
    def numeric_rows(raw, cap):
        rows = raw.splitlines()
        require(1 <= len(rows) <= cap, 'finite cgroup key rows')
        out = {}
        for line in rows:
            match = re.fullmatch(r'([a-z_]+) ([0-9]+)', line)
            require(match is not None and match.group(1) not in out,
                    'unique numeric cgroup row')
            out[match.group(1)] = int(match.group(2))
        return out
    events = numeric_rows(files['cgroup.events'], 8)
    stat_rows = numeric_rows(files['cgroup.stat'], 8)
    cpu = numeric_rows(files['cpu.stat'], 16)
    require(events.get('populated') == (0 if after else 1) and
            events.get('frozen') == 0 and
            stat_rows.get('nr_descendants') == 0 and
            stat_rows.get('nr_dying_descendants') == 0 and
            {'usage_usec', 'user_usec', 'system_usec'} <= set(cpu),
            'actual nonnested child cgroup census/accounting')
    def pids(raw):
        require(type(raw) is str and ascii_bound(raw, 4096),
                'bounded raw child PID census')
        lines = raw.splitlines()
        require(1 <= len(lines) <= 64 and
                all(re.fullmatch(r'[1-9][0-9]*', line) and
                    1 <= int(line) <= 2**31 - 1 for line in lines) and
                len(set(lines)) == len(lines), 'unique canonical bounded child PIDs')
        return set(lines)
    if after:
        require(files['cgroup.procs'] == value['procsAfter'] == '' and
                value['memberProcesses'] == {},
                'terminal child leaf empty twice after actual reap')
    else:
        first, second = pids(files['cgroup.procs']), pids(value['procsAfter'])
        members = value['memberProcesses']
        require(str(child_pid) in first and first == second and
                type(members) is dict and set(members) == first,
                'same two source-owned finite child-member PID sets')
        raw_total = 0
        membership = '0::/system.slice/' + unit + '/' + name + '\n'
        for key, member in members.items():
            proc_text_fact(member, pid=int(key), ppid=None, uid=uid, gid=gid,
                           cgroup=membership)
            raw_total += sum(len(member[field].encode('ascii')) for field in
                             ('procStat', 'procStatus', 'procCgroup', 'procLimits'))
        require(raw_total <= 131072,
                'aggregate raw child-member observation budget')
    parent_control_fact(value['parentControl'], unit=unit, service_pid=service_pid)
    return value


def child_process_fact(process, *, unit, service_pid, uid, gid, name, wall_seconds):
    require(len(canonical(process)) <= 262144,
            'bounded complete child process original')
    pid = process['pid']
    fields(process['identity'], 'pid preexec')
    pre = fields(process['identity']['preexec'],
                 'pid uid euid gid egid core nofile cpu fsize '
                 'sigtermDefault sigtermBlocked rawBeforeExec')
    require(process['identity']['pid'] == pre['pid'] == pid and
            pre['uid'] == pre['euid'] == uid and pre['gid'] == pre['egid'] == gid and
            pre['core'] == [0, 0] and pre['nofile'] == [256, 256] and
            pre['cpu'] == [wall_seconds, wall_seconds] and
            pre['fsize'] == ([67108864, 67108864] if name in ('configure', 'make')
                             else [4194304, 4194304]) and
            pre['sigtermDefault'] is True and pre['sigtermBlocked'] is False,
            'actual selected preexec identity/resource/signal receipt')
    before = fields(process['resourcesBefore'], 'preexec parentObserved')
    require(strict_equal(before['preexec'], pre), 'held preexec receipt before parent observation')
    path = '0::/system.slice/' + unit + '/' + name + '\n'
    started = proc_text_fact(pre['rawBeforeExec'], pid=pid, ppid=service_pid,
                             uid=uid, gid=gid, cgroup=path)
    proc_text_fact(before['parentObserved'], pid=pid, ppid=service_pid,
                   uid=uid, gid=gid, cgroup=path, starttime=started)
    fields(process['resourcesAfter'], 'pid procPresent errno')
    require(process['resourcesAfter'] == {'pid': pid, 'procPresent': False, 'errno': 2},
            'actual post-reap proc absence')
    prior = child_cgroup_fact(process['cgroupBefore'], unit=unit, name=name,
                              child_pid=pid, service_pid=service_pid, uid=uid, gid=gid)
    require(strict_equal(before['parentObserved'],
                         prior['memberProcesses'][str(pid)]),
            'own child parent observation equals retained first member census')
    after = child_cgroup_fact(process['cgroupAfter'], unit=unit, name=name,
                              child_pid=pid, service_pid=service_pid, uid=uid, gid=gid,
                              after=True)
    for key in ('dev', 'ino', 'mode', 'uid', 'gid'):
        require(prior['identity'][key] == after['identity'][key] and
                prior['parentControl']['unitIdentity'][key] ==
                after['parentControl']['unitIdentity'][key] and
                prior['parentControl']['controllerIdentity'][key] ==
                after['parentControl']['controllerIdentity'][key],
                'stable child/unit/controller cgroup authority')
    return process


def service_status_fact(raw, *, route, unit, outer_seconds):
    """Independently join bounded v255 manager receipt to raw client bytes."""
    value = parse_json(raw, 524288, canonical_wire=True)
    fields(value, 'schema route unit client receipt postShow firstFailure secondary')
    require(value['schema'] == 'bw.bochs-ring3.service-status.v1' and
            value['route'] == route and value['unit'] == unit,
            'selected retained service-status identity')
    failures(value['firstFailure'], value['secondary'], complete=True)
    client = fields(value['client'], 'process stdoutBase64 stderrBase64')
    def decoded(holder, key, cap):
        value = holder[key]
        require(type(value) is str and len(value) <= cap * 2,
                'bounded base64 manager stream')
        try:
            raw_bytes = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise Refusal('canonical manager stream base64') from exc
        require(base64.b64encode(raw_bytes).decode('ascii') == value and
                len(raw_bytes) <= cap, 'exact manager stream base64')
        return raw_bytes
    stdout = decoded(client, 'stdoutBase64', 65536)
    stderr = decoded(client, 'stderrBase64', 65536)
    process = client['process']
    fields(process, 'name argv cwd environment startedNs endedNs pid identity '
           'waitStatus exitCode signal reaped timedOut stdout stderr '
           'resourcesBefore resourcesAfter cgroupBefore cgroupAfter '
           'firstFailure secondary usage')
    require(process['name'] == 'service-client' and process['reaped'] is True and
            process['timedOut'] is False and process['signal'] is None and
            type(process['exitCode']) is int and process['exitCode'] == 0 and
            integer(process['startedNs'], 0) <= integer(process['endedNs'], 0) and
            process['endedNs'] - process['startedNs'] <=
            outer_seconds * 1000000000 + 6000000000 and
            type(process['argv']) is list and
            '/usr/bin/systemd-run' == process['argv'][0] and
            '--wait' in process['argv'] and '--unit=' + unit in process['argv'] and
            '--property=Delegate=yes' in process['argv'] and
            '--property=DelegateSubgroup=controller' in process['argv'] and
            not any(arg in process['argv'] for arg in ('--pipe', '--quiet', '--collect')) and
            not any(arg.startswith('--setenv=GH_TOKEN=') for arg in process['argv']) and
            (('--setenv=GH_TOKEN' in process['argv']) == (route == 'reference')) and
            type(process['environment']) is dict and
            not {'GH_TOKEN', 'GITHUB_TOKEN'} & set(process['environment']),
            'actual selected manager command, bound and secret boundary')
    require(os.WIFEXITED(integer(process['waitStatus'], 0, 0xffff)) and
            os.WEXITSTATUS(process['waitStatus']) == 0,
            'actual manager client normal wait4 exit0')
    failures(process['firstFailure'], process['secondary'], complete=True)
    stream_fact(process['stdout'], stdout, 'service-client.stdout', 65536)
    stream_fact(process['stderr'], stderr, 'service-client.stderr', 65536)
    receipt = fields(value['receipt'], 'schema unit runningUnit result mainCode '
                     'mainStatus clientExitCode serviceExitCode firstFailure secondary')
    failures(receipt['firstFailure'], receipt['secondary'], complete=True)
    text = (stdout + b'\n' + stderr).decode('utf-8')
    require('\0' not in text and '\x1b' not in text,
            'unmixed uncoloured raw manager receipt')
    lines = text.splitlines()
    def one(prefix):
        rows = [line for line in lines if line.startswith(prefix)]
        require(len(rows) == 1, 'single raw manager ' + prefix)
        return rows[0]
    first = re.fullmatch(r'Running as unit: ([A-Za-z0-9_.@-]+)'
                         r'(?:; invocation ID: [0-9a-f]{32})?',
                         one('Running as unit:'))
    result = re.fullmatch(r'Finished with result: ([a-z][a-z-]{0,63})',
                          one('Finished with result:'))
    ended = re.fullmatch(r'Main processes terminated with: code=([a-z-]+)'
                         r'/status=(0|[1-9][0-9]{0,2})',
                         one('Main processes terminated with:'))
    require(first is not None and first.group(1) == unit and
            result is not None and result.group(1) == 'success' and
            ended is not None and ended.group(1) == 'exited' and ended.group(2) == '0' and
            receipt['schema'] == 'bw.bochs-ring3.service-receipt.v1' and
            receipt['unit'] == receipt['runningUnit'] == unit and
            receipt['result'] == 'success' and receipt['mainCode'] == 'exited' and
            all(type(receipt[key]) is int and receipt[key] == 0 for key in
                ('mainStatus', 'clientExitCode', 'serviceExitCode')),
            'actual successful v255 manager completion receipt')
    post = fields(value['postShow'], 'process stdoutBase64 stderrBase64')
    post_out = decoded(post, 'stdoutBase64', 16384)
    post_err = decoded(post, 'stderrBase64', 4096)
    post_process = post['process']
    fields(post_process, 'name argv cwd environment startedNs endedNs pid identity '
           'waitStatus exitCode signal reaped timedOut stdout stderr '
           'resourcesBefore resourcesAfter cgroupBefore cgroupAfter '
           'firstFailure secondary usage')
    require(post_process['name'] == 'service-post-show' and
            post_process['argv'] == ['/usr/bin/systemctl', 'show', unit,
                '--no-pager', '--property=Id,Result,ExecMainCode,ExecMainStatus,ActiveState,ControlGroup'] and
            post_process['reaped'] is True and post_process['timedOut'] is False and
            post_process['signal'] is None and
            type(post_process['exitCode']) is int and
            0 <= post_process['exitCode'] <= 255 and
            os.WIFEXITED(integer(post_process['waitStatus'], 0, 0xffff)) and
            os.WEXITSTATUS(post_process['waitStatus']) == post_process['exitCode'] and
            integer(post_process['startedNs'], 0) <=
            integer(post_process['endedNs'], 0) and
            post_process['endedNs'] - post_process['startedNs'] <= 11000000000,
            'bounded diagnostic post-wait show')
    require(post_process['secondary'] == [], 'no hidden diagnostic show secondary errors')
    if post_process['exitCode'] == 0:
        require(post_process['firstFailure'] is None,
                'normal diagnostic show exit has no child failure')
    else:
        item = fields(post_process['firstFailure'],
                      'phase name message role path')
        require(item['phase'] == 'child-capture' and item['name'] == 'Refusal' and
                item['message'] == 'ordinary child completed exit0' and
                item['role'] is None and item['path'] is None,
                'only retained nonzero normal show exit is diagnostic')
    stream_fact(post_process['stdout'], post_out, 'service-post-show.stdout', 16384)
    stream_fact(post_process['stderr'], post_err, 'service-post-show.stderr', 16384)
    return value


def node_cleanup_fact(value, *, route, run_id, stage):
    """Grade the one reviewed staged-copy removal journal, not its complete flag."""
    fields(value, 'schema route path parentBefore parentAfter before members journal '
           'after complete firstFailure secondary')
    path = f'/run/bw-bochs-{route}-v1-{run_id}-1-node'
    require(value['schema'] == 'bw.bochs-ring3.node-cleanup.v1' and
            value['route'] == route and value['path'] == path and
            stage['stagePath'] == path + '/node' and
            stage['recordPath'] == path + '/stage.json' and
            value['complete'] is True and len(canonical(value)) <= 16384,
            'closed bounded source-created Node cleanup original')
    failures(value['firstFailure'], value['secondary'], complete=True)
    for name in ('parentBefore', 'parentAfter'):
        row = stat_fact(value[name], kind='directory')
        require(row['uid'] == row['gid'] == 0 and row['mode'] & 0o022 == 0,
                'owned fixed /run stage parent')
    for key in ('dev', 'ino', 'mode', 'uid', 'gid'):
        require(value['parentBefore'][key] == value['parentAfter'][key],
                'stable /run parent through selected Node cleanup')
    before = fields(value['before'], 'exists errno identity')
    require(before['exists'] is True and before['errno'] is None,
            'selected staged root exists before owned removal')
    initial = stat_fact(before['identity'], kind='directory')
    require(initial['mode'] == stat.S_IFDIR | 0o555 and
            all(initial[key] == stage['directory'][index] for index, key in
                enumerate(('dev', 'ino', 'mode', 'uid', 'gid'))),
            'held published Node stage directory before removal')
    members = fields(value['members'], 'node stage.json')
    selected_members = {'node': stage['file'],
                        'stage.json': stage['record']['metadata']}
    for name, row in members.items():
        stat_fact(row, kind='regular')
        require(row['uid'] == row['gid'] == 0 and row['nlink'] == 1 and
                all(row[key] == selected_members[name][index] for index, key in
                    enumerate(('dev', 'ino', 'mode', 'uid', 'gid'))),
                'exact held staged member identity before unlink')
    journal = value['journal']
    require(type(journal) is list and len(journal) == 4,
            'four exact selected Node cleanup mutations')
    operations = [('chmod-private', path), ('unlink', path + '/node'),
                  ('unlink', path + '/stage.json'), ('rmdir', path)]
    private = dict(initial, mode=stat.S_IFDIR | 0o700)
    expected_before = [initial, members['node'], members['stage.json'], private]
    for index, (operation, target) in enumerate(operations):
        row = fields(journal[index],
                     'operation path before attempted after firstFailure')
        require(row['operation'] == operation and row['path'] == target and
                row['attempted'] is True and row['firstFailure'] is None and
                all(row['before'][key] == expected_before[index][key] for key in
                    ('dev', 'ino', 'mode', 'uid', 'gid')),
                'source-selected ordered held Node cleanup operation')
        after = fields(row['after'], 'exists errno identity')
        if index == 0:
            require(after['exists'] is True and after['errno'] is None and
                    all(after['identity'][key] == private[key] for key in
                        ('dev', 'ino', 'mode', 'uid', 'gid')),
                    'same root became private before any unlink')
        else:
            require(after == {'exists': False, 'errno': 2, 'identity': None},
                    'actual selected member/root ENOENT after mutation')
    require(value['after'] == {'exists': False, 'errno': 2, 'identity': None},
            'terminal selected staged Node root absent')
    return value


def manual_cleanup_fact(raw, *, route, unit, outside, inner):
    """Independently grade finite, source-owned cgroup removal observations."""
    value = parse_json(raw, 16384, canonical_wire=True)
    fields(value, 'schema route unit rootPath limits startedNs endedNs known '
           'before parentIdentity parentIdentityAfter samples journal after '
           'lastPath firstFailure secondary complete')
    require(value['schema'] == 'bw.bochs-ring3.manual-cleanup.v1' and
            value['route'] == route and value['unit'] == unit and
            value['rootPath'] == '/sys/fs/cgroup/system.slice/' + unit and
            value['limits'] == {'samples': 6, 'seconds': 5, 'bytes': 16384} and
            value['complete'] is True,
            'selected exact finite manual cleanup identity')
    started = integer(value['startedNs'], 0)
    ended = integer(value['endedNs'], started)
    require(ended - started < 5000000000 and
            type(value['lastPath']) is str and
            value['lastPath'].startswith(value['rootPath']),
            'bounded cleanup time and source-owned final read path')
    failures(value['firstFailure'], value['secondary'], complete=True)
    expected = {'unit': inner['resources']['before']['unitRoot']['directory'],
                'controller': inner['resources']['before']['controller']['directory']}
    phases = {'toolchain': (), 'build': ('configure', 'make'),
              'reference': ('js', 'bochs')}[route]
    require(len(inner['phases']) == len(phases),
            'complete known phase roster for manual cleanup')
    for name, process in zip(phases, inner['phases']):
        require(process['name'] == name,
                'source-owned child cleanup phase identity')
        expected[name] = process['cgroupBefore']['identity']
    known = fields(value['known'], ' '.join(expected))
    identities = []
    for name, stat_row in expected.items():
        row = fields(known[name], 'path identity')
        selected_path = value['rootPath'] + ('' if name == 'unit' else '/' + name)
        require(row['path'] == selected_path and
                strict_equal(row['identity'], stat_row),
                'source-bound known selected cleanup group')
        stat_fact(row['identity'], kind='directory')
        identities.append((row['identity']['dev'], row['identity']['ino']))
    require(len(identities) == len(set(identities)),
            'distinct held unit/controller/child group identities')
    def first_five(row):
        return tuple(row[key] for key in ('dev', 'ino', 'mode', 'uid', 'gid'))
    def counter(text, key):
        require(type(text) is str and len(text.encode('utf-8')) <= 4096,
                'bounded raw cleanup counter source')
        values = [line.split(' ', 1)[1] for line in text.splitlines()
                  if line.startswith(key + ' ')]
        require(len(values) == 1 and
                re.fullmatch(r'0|[1-9][0-9]{0,18}', values[0]) is not None,
                'single canonical raw cleanup counter')
        return int(values[0])
    def snapshot(row, role, *, absent=False, children=None, dying=False):
        fields(row, 'path exists errno identity files children')
        selected = value['rootPath'] + ('' if role == 'unit' else '/' + role)
        require(row['path'] == selected and len(canonical(row)) <= 768,
                'bounded fixed cleanup snapshot path')
        if absent:
            require(row['exists'] is False and row['errno'] == 2 and
                    row['identity'] is None and row['files'] == {} and
                    row['children'] == [], 'selected group absent at readback')
            return
        require(row['exists'] is True and row['errno'] is None and
                first_five(stat_fact(row['identity'], kind='directory')) ==
                first_five(expected[role]) and
                row['identity']['uid'] == row['identity']['gid'] == 0 and
                row['identity']['mode'] & 0o022 == 0 and
                type(row['children']) is list and
                row['children'] == ([] if children is None else children),
                'stable source-selected held cleanup group')
        files = fields(row['files'], 'cgroup.procs cgroup.events cgroup.stat')
        require(files['cgroup.procs'] == '' and
                counter(files['cgroup.events'], 'populated') == 0 and
                counter(files['cgroup.stat'], 'nr_descendants') ==
                len(row['children']), 'empty group and exact selected descendants')
        if dying:
            require(counter(files['cgroup.stat'], 'nr_dying_descendants') == 0,
                    'no dying descendant before selected rmdir')
    require(type(value['before']) is dict and 'unit' in value['before'],
            'one retained initial selected unit snapshot')
    before = value['before']
    top = before['unit']
    if top['exists'] is False:
        require(value['parentIdentity'] is None and
                value['parentIdentityAfter'] is None and
                value['samples'] == [] and value['journal'] == [] and
                set(before) == {'unit'},
                'already-absent branch never mutates or invents a sample')
        snapshot(top, 'unit', absent=True)
        snapshot(value['after'], 'unit', absent=True)
        require(strict_equal(value['after'], top),
                'same exact initial and terminal absent unit observation')
    else:
        require(type(value['journal']) is list and
                type(value['samples']) is list and
                1 <= len(value['samples']) <= 6,
                'finite held-parent selected removal branch')
        parent = stat_fact(value['parentIdentity'], kind='directory')
        parent_after = stat_fact(value['parentIdentityAfter'],
                                 kind='directory')
        require(parent['uid'] == parent['gid'] == 0 and
                parent['mode'] & 0o022 == 0 and
                first_five(parent_after) == first_five(parent) and
                first_five(parent) != first_five(expected['unit']),
                'separate stable held parent directory before and after cleanup')
        names = top['children']
        require(type(names) is list and names == sorted(set(names)) and
                set(names) <= (set(phases) | {'controller'}) and
                set(before) == {'unit', *names},
                'only selected known child groups were present')
        snapshot(top, 'unit', children=names)
        for name in names:
            snapshot(before[name], name, dying=True)
        order = names + ['unit']
        require(len(value['journal']) == len(order),
                'one ordered removal for every observed child and unit')
        previous = started
        for sample in value['samples']:
            fields(sample, 'ns root')
            moment = integer(sample['ns'], previous, ended)
            snapshot(sample['root'], 'unit')
            previous = moment
        require(counter(value['samples'][-1]['root']['files']['cgroup.stat'],
                        'nr_dying_descendants') == 0,
                'final root census has no dying descendants')
        for index, role in enumerate(order):
            row = fields(value['journal'][index],
                         'role path before parentHeld childHeld parentNamed '
                         'childNamed attempted after firstFailure childClosed')
            selected = value['rootPath'] + ('' if role == 'unit' else '/' + role)
            require(row['role'] == role and row['path'] == selected and
                    row['attempted'] is True and
                    row['firstFailure'] is None and row['childClosed'] is True,
                    'one source-selected successful held-FD removal')
            snapshot(row['before'], role, dying=True)
            snapshot(row['after'], role, absent=True)
            selected_parent = parent if role == 'unit' else expected['unit']
            for key, selected_row in (('parentHeld', selected_parent),
                                      ('parentNamed', selected_parent),
                                      ('childHeld', expected[role]),
                                      ('childNamed', expected[role])):
                raw_stat = row[key]
                require(type(raw_stat) is list and len(raw_stat) == 9,
                        'complete held and named directory stat')
                stat_row = dict(zip(('dev', 'ino', 'mode', 'uid', 'gid', 'nlink',
                                     'size', 'mtimeNs', 'ctimeNs'), raw_stat))
                stat_fact(stat_row, kind='directory')
                require(first_five(stat_row) == first_five(selected_row),
                        'pre-removal held/named first-five authority')
            require(len(canonical(row)) <= 1536,
                    'bounded complete selected removal row')
        snapshot(value['after'], 'unit', absent=True)
        require(strict_equal(value['after'], value['journal'][-1]['after']),
                'unit removal readback agrees with terminal selected absence')
    unit_fact(value['after'], unit, absent=True)
    require(strict_equal(outside['after'], value['after']),
            'outside terminal unit census joins selected cleanup')
    if outside['before']['exists']:
        first = stat_fact(outside['before']['identity'], kind='directory')
        held = expected['unit']
        require(all(first[key] == held[key] for key in
                    ('dev', 'ino', 'mode', 'uid', 'gid')),
                'earlier present unit matches selected held identity')
    else:
        require(strict_equal(outside['before'], value['after']),
                'earlier absent unit agrees with cleanup sample')
    return value


MANUAL_V2_STAT_FIELDS = ('dev', 'ino', 'mode', 'uid', 'gid', 'nlink',
                         'size', 'mtimeNs', 'ctimeNs')


def node_cleanup_plan_v1(stage, *, route, unit):
    """Independently reconstruct the finite, read-only future Node wire plan."""
    require(type(stage) is dict and type(unit) is str and
            re.fullmatch('bw-bochs-' + route + r'-v1-([1-9][0-9]*)-1\.service',
                         unit) is not None,
            'selected service identity for staged Node cleanup plan')
    run_id = re.fullmatch('bw-bochs-' + route + r'-v1-([1-9][0-9]*)-1\.service',
                          unit).group(1)
    root = f'/run/bw-bochs-{route}-v1-{run_id}-1-node'
    require(stage.get('stagePath') == root + '/node' and
            stage.get('recordPath') == root + '/stage.json',
            'protected complete Node stage path for future cleanup')

    def row(value):
        require(type(value) is list and len(value) == 9 and
                all(type(item) is int and 0 <= item <=
                    (2**96 - 1 if key in ('mtimeNs', 'ctimeNs') else 2**64 - 1)
                    for key, item in zip(MANUAL_V2_STAT_FIELDS, value)),
                'nine exact selected Node stage stat integers')
        return dict(zip(MANUAL_V2_STAT_FIELDS, value))

    def future(value):
        return {**value, 'nlink': max(value['nlink'], 2**64 - 1),
                'size': max(value['size'], 2**64 - 1),
                'mtimeNs': max(value['mtimeNs'], 2**96 - 1),
                'ctimeNs': max(value['ctimeNs'], 2**96 - 1)}

    fields(stage['parents'], '/ /run')
    parent = future(row(stage['parents']['/run']['after']))
    directory = row(stage['directory'])
    private = future({**directory, 'mode': stat.S_IFDIR | 0o700})
    node = row(stage['file'])
    record = row(stage['record']['metadata'])
    gone = {'exists': False, 'errno': 2, 'identity': None}
    prototype = {
        'schema': 'bw.bochs-ring3.node-cleanup.v1', 'route': route,
        'path': root, 'parentBefore': parent, 'parentAfter': parent,
        'before': {'exists': True, 'errno': None, 'identity': directory},
        'heldBefore': directory, 'heldBeforeRmdir': private,
        'namedBeforeRmdir': private,
        'members': {'node': node, 'stage.json': record}, 'after': gone,
        'firstFailure': None, 'secondary': [], 'complete': True,
        'journal': [
            {'operation': 'chmod-private', 'path': root, 'before': directory,
             'attempted': True,
             'after': {'exists': True, 'errno': None, 'identity': private},
             'firstFailure': None},
            {'operation': 'unlink', 'path': root + '/node', 'before': node,
             'attempted': True, 'after': gone, 'firstFailure': None},
            {'operation': 'unlink', 'path': root + '/stage.json',
             'before': record, 'attempted': True, 'after': gone,
             'firstFailure': None},
            {'operation': 'rmdir', 'path': root, 'before': private,
             'attempted': True, 'after': gone, 'firstFailure': None}]}
    success = len(canonical(prototype))
    failure = success + 3 * 1024 + 512
    return {'schema': 'bw.bochs-ring3.node-cleanup-plan.v1',
            'nodePath': root, 'stageSha256': sha(canonical(stage)),
            'projectionSha256': sha(canonical(prototype)),
            'successBytes': success, 'failureBytes': failure,
            'reservedBytes': max(success + 1024, failure)}


def manual_cleanup_v2_fact(raw, *, route, unit, outside, inner):
    """Grade compact nine-integer V2 wire and its pre-effect Node reservation."""
    value = parse_json(raw, 16384, canonical_wire=True)
    fields(value, 'schema identityFields route unit rootPath limits startedNs '
           'endedNs known before parentIdentity parentIdentityAfter inputPlan '
           'samples journal after lastPath firstFailure secondary complete')
    require(value['schema'] == 'bw.bochs-ring3.manual-cleanup.v2' and
            value['identityFields'] == list(MANUAL_V2_STAT_FIELDS) and
            value['complete'] is True,
            'closed complete compact V2 selected cleanup wire')
    stage = inner['observations']['nodeStage']
    expected_plan = node_cleanup_plan_v1(stage, route=route, unit=unit)
    require(strict_equal(value['inputPlan'], expected_plan) and
            expected_plan['reservedBytes'] <= 16384,
            'independent exact protected-stage future cleanup reservation')
    require(type(outside.get('nodeCleanup')) is dict and
            len(canonical(outside['nodeCleanup'])) <=
            expected_plan['reservedBytes'],
            'actual retained Node cleanup fits the pre-effect all-outcome plan')

    def expand(item, key=None):
        if key in ('identity', 'parentIdentity', 'parentIdentityAfter'):
            if item is None:
                return None
            require(type(item) is list and len(item) == 9 and
                    all(type(x) is int for x in item),
                    'manual V2 stat uses complete fixed nine-integer array')
            return dict(zip(MANUAL_V2_STAT_FIELDS, item))
        if type(item) is dict:
            return {name: expand(child, name) for name, child in item.items()}
        if type(item) is list:
            return [expand(child) for child in item]
        return item

    historical = expand(value)
    historical.pop('identityFields')
    historical.pop('inputPlan')
    historical['schema'] = 'bw.bochs-ring3.manual-cleanup.v1'
    manual_cleanup_fact(canonical(historical), route=route, unit=unit,
                        outside=outside, inner=inner)
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
               unit, service_pid, uid, gid, checkpoint=False):
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
            not ({'GH_TOKEN', 'GITHUB_TOKEN'} &
                 set(process['environment'])) and
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
            type(process['identity']) is dict and process['identity'] and
            type(process['resourcesBefore']) is dict and
            process['resourcesBefore'] and
            type(process['resourcesAfter']) is dict and
            process['resourcesAfter'] and
            type(process['cgroupBefore']) is dict and
            process['cgroupBefore'] and
            type(process['cgroupAfter']) is dict and
            process['cgroupAfter'],
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
    child_process_fact(process, unit=unit, service_pid=service_pid,
                       uid=uid, gid=gid, name=name, wall_seconds=wall_seconds)
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
                 'sourceSelection reportedReadbackOnly notices nodeStage runtimeElfMetadata',
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
            'exact sixteen retained inventory roles')
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
    require(len(packet['outside.original.json']) <= 16384,
            'source-bounded complete outside inventory envelope')
    outside = parse_json(packet['outside.original.json'], 65536,
                         canonical_wire=True)
    node_stage, node_projection = node_stage_fact(
        packet['node-stage.original.json'], route='toolchain',
        run_id=outside['runId'])
    require(strict_equal(value['observations']['nodeStage'], node_stage) and
            NODE_CACHE_PATH not in g_before['files'],
            'separate staged Node original and cache DATA boundary')
    sparse_raw = packet['runtime-elf-ranges.original.json']
    selected_sparse_elf_fact(sparse_raw, g_before, node_projection)
    require(value['observations']['runtimeElfMetadata'] == {
                'path': 'runtime-elf-ranges.original.json',
                'bytes': len(sparse_raw), 'sha256': sha(sparse_raw)},
            'toolchain sparse role byte/SHA reference joins the original')
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
           'before after manual nodeCleanup firstFailure secondary')
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
            outside['innerFirstFailure'] is None,
            'complete source-owned inventory service/outer status')
    unit_fact(outside['before'], outside['unit'])
    unit_fact(outside['after'], outside['unit'], absent=True)
    failures(outside['firstFailure'], outside['secondary'], complete=True)
    require(strict_equal(outside['manual'],
                         manual_cleanup_fact(
                             packet['cleanup.original.json'], route='toolchain',
                             unit=outside['unit'], outside=outside,
                             inner=value)),
            'exact retained owned inventory cleanup original')
    node_cleanup_fact(outside['nodeCleanup'], route='toolchain',
                      run_id=outside['runId'], stage=node_stage)
    service_status_fact(packet['service-status.original.json'], route='toolchain',
                        unit=outside['unit'], outer_seconds=120)
    observed_resources = fields(value['resources'], 'before after')
    limits = {'cpu.max': '100000 100000\n',
              'memory.max': '536870912\n',
              'memory.swap.max': '0\n', 'pids.max': '32\n'}
    resources_v2_fact(observed_resources['before'], unit=outside['unit'],
                      limits=limits)
    resources_v2_fact(observed_resources['after'], unit=outside['unit'],
                      limits=limits)
    first_directory = observed_resources['before']['unitRoot']['directory']
    last_directory = observed_resources['after']['unitRoot']['directory']
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
    require(len(packet['outside.original.json']) <= 16384,
            'source-bounded complete outside Build envelope')
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
                   wall_seconds=wall, unit=build_outside['unit'],
                   service_pid=value['resources']['before']['pid'],
                   uid=build_node['invoker']['uid'],
                   gid=build_node['invoker']['gid'])
        require(process['argv'] == argv and
                strict_equal(value['phases'][0 if name == 'configure' else 1],
                             process),
                'selected actual Configure/Make argv and ordered phase originals')
    require(value['phases'][0]['endedNs'] <=
            value['phases'][1]['startedNs'],
            'Make spawn follows retained Configure terminal reap')
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
           'before after manual nodeCleanup firstFailure secondary')
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
            build_outside['innerFirstFailure'] is None,
            'selected complete Build service and outer terminal')
    unit_fact(build_outside['before'], build_outside['unit'])
    unit_fact(build_outside['after'], build_outside['unit'], absent=True)
    failures(build_outside['firstFailure'], build_outside['secondary'],
             complete=True)
    node_cleanup_fact(build_outside['nodeCleanup'], route='build',
                      run_id=build_outside['runId'], stage=build_node)
    require(strict_equal(build_outside['manual'],
                         manual_cleanup_fact(
                             packet['cleanup.original.json'], route='build',
                             unit=build_outside['unit'], outside=build_outside,
                             inner=value)),
            'exact retained owned Build cleanup original')
    service_status_fact(packet['service-status.original.json'], route='build',
                        unit=build_outside['unit'], outer_seconds=960)
    resources = fields(value['resources'], 'before after')
    limits = {'cpu.max': '100000 100000\n',
              'memory.max': '2147483648\n',
              'memory.swap.max': '0\n', 'pids.max': '64\n'}
    resources_v2_fact(resources['before'], unit=build_outside['unit'],
                      limits=limits)
    resources_v2_fact(resources['after'], unit=build_outside['unit'],
                      limits=limits)
    require(all(resources['before']['unitRoot']['directory'][name] ==
                resources['after']['unitRoot']['directory'][name] for name in
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


def resources_v2_fact(value, *, unit, limits):
    """Independent delegated inner-node/controller observation."""
    fields(value, 'schema unit pid uid gid unitRoot controller procCgroup '
           'procStat procStatus parentControl')
    pid = integer(value['pid'], 1, 2**31 - 1)
    require(value['schema'] == 'bw.bochs-ring3.resources.v2' and
            value['unit'] == unit and value['uid'] == value['gid'] == 0 and
            value['procCgroup'] ==
            '0::/system.slice/' + unit + '/controller\n',
            'root service placed in fixed delegated controller subgroup')
    parent_control_fact(value['parentControl'], unit=unit, service_pid=pid)
    root = fields(value['unitRoot'], 'path directory files children')
    controller = fields(value['controller'], 'path directory files children')
    path = '/sys/fs/cgroup/system.slice/' + unit
    require(root['path'] == path and controller['path'] == path + '/controller' and
            type(root['children']) is list and
            1 <= len(root['children']) <= 5 and
            len(root['children']) == len(set(root['children'])) and
            set(root['children']) <= {'controller', 'configure', 'make', 'js', 'bochs'} and
            'controller' in root['children'] and controller['children'] == [],
            'bounded exact delegated root/controller cgroup tree')
    for observed, label in ((root, 'unitRoot'), (controller, 'controller')):
        row = stat_fact(observed['directory'], kind='directory')
        require(row['uid'] == row['gid'] == 0 and row['mode'] & 0o022 == 0,
                'owned delegated ' + label + ' directory')
        selected = fields(observed['files'], 'cpu.max memory.max memory.swap.max '
                          'pids.max cgroup.procs cgroup.events cgroup.stat cpu.stat')
        for name, raw in selected.items():
            require(type(raw) is str and '\0' not in raw and
                    ((name == 'cgroup.procs' and observed is root and raw == '') or
                     ascii_bound(raw, 4096)),
                    'bounded delegated cgroup raw text')
    require(all(root['files'][name] == text for name, text in limits.items()) and
            root['files']['cgroup.procs'] == '' and
            controller['files']['cgroup.procs'] == str(pid) + '\n' and
            value['parentControl']['unitProcs'] == root['files']['cgroup.procs'] and
            value['parentControl']['controllerProcs'] == controller['files']['cgroup.procs'],
            'actual selected root limits and controller sole process')
    for row, held in ((root['directory'], value['parentControl']['unitIdentity']),
                      (controller['directory'], value['parentControl']['controllerIdentity'])):
        require(all(row[key] == held[key] for key in
                    ('dev', 'ino', 'mode', 'uid', 'gid')),
                'held parent-control/root resource directory authority')
    def counted(raw):
        rows = {}
        for line in raw.splitlines():
            match = re.fullmatch(r'([a-z_]+) ([0-9]+)', line)
            require(match is not None and match.group(1) not in rows,
                    'unique delegated cgroup stat row')
            rows[match.group(1)] = int(match.group(2))
        require(1 <= len(rows) <= 16, 'finite delegated cgroup stat rows')
        return rows
    root_events = counted(root['files']['cgroup.events'])
    root_stat = counted(root['files']['cgroup.stat'])
    control_events = counted(controller['files']['cgroup.events'])
    control_stat = counted(controller['files']['cgroup.stat'])
    require(root_events.get('populated') == control_events.get('populated') == 1 and
            root_stat.get('nr_descendants') == len(root['children']) and
            root_stat.get('nr_dying_descendants') == 0 and
            control_stat.get('nr_descendants') ==
            control_stat.get('nr_dying_descendants') == 0,
            'exact finite delegated cgroup descendants and live root observer')
    require(type(value['procStat']) is str and
            value['procStat'].startswith(str(pid) + ' (') and
            ascii_bound(value['procStat'], 16384) and
            type(value['procStatus']) is str and
            ascii_bound(value['procStatus'], 16384) and
            re.search(r'(?m)^Pid:\s+' + str(pid) + r'$', value['procStatus']) and
            re.search(r'(?m)^Uid:\s+0\s+0\s+0\s+0$', value['procStatus']) and
            re.search(r'(?m)^Gid:\s+0\s+0\s+0\s+0$', value['procStatus']) and
            re.search(r'(?m)^Threads:\s+[1-9][0-9]*$', value['procStatus']),
            'raw root service process PID/credentials/thread identity')
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
