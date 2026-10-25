#!/usr/bin/env python3
"""Offline, negative-only readback of the spent Bochs ELF diagnostic.

The historical reader is executable input only after its fixed source hash is
checked. Its namespace and functions remain untouched. Three separately named
pure derivatives replace only four counter-parser calls and three call targets.
The caller must independently review the new auditor Git identity and policy
hash before launching this file. Local files alone authenticate no GitHub API.
No producer, network, process, compiler, guest or workflow operation is used.
"""
import argparse
import ast
import copy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
import sys
import types
import zipfile
import zlib

OLD_HEAD = '347d4fae2c9d4319443a2e2f02ea715cac5bce88'
OLD_TREE = '4a9d7878b45e21f98331cc15c9b517c259557843'
OLD_WORKFLOW = '3fec7acba4b5099d61a5d598956cf6b4181b077e'
OLD_PULL_REQUEST = 699
OLD_READER_SHA = '01380f820b59a4a3140e6fe73a81c6b79ee949f58b27ab1a891767e8c3b35660'
OLD_SOURCE_FILES_SHA = '34b2226364ed6509470a9c0593fd6eb1c06f1a24fb8ea3e6d81a8647624e99b9'
OLD_REFUSAL = 'finite delegated cgroup stat rows'
OLD_READER_PATH = 'scripts/i80386-bochs-ring3-reference/reader.py'
AUDITOR_PATH = 'scripts/i80386-bochs-ring3-reference/read-elf-negative-v1.py'
PROFILE = 'observed-cgroup22-events2.v1'
SUBSYSTEMS = ('cpuset', 'cpu', 'io', 'memory', 'perf_event', 'hugetlb',
              'pids', 'rdma', 'misc', 'dmem')
STAT_KEYS = (('nr_descendants',) + tuple('nr_subsys_' + x for x in SUBSYSTEMS) +
             ('nr_dying_descendants',) + tuple('nr_dying_subsys_' + x for x in SUBSYSTEMS))
CAPS = {'archive': 8 << 20, 'expectation': 65536, 'run': 4 << 20,
        'jobs': 4 << 20, 'artifacts': 4 << 20, 'jobLog': 8 << 20,
        'originalFailure': 65536}
ROLE_CAPS = {'request.original.json': 32768, 'event.original.json': 1 << 20,
             'elf-attribution.original.json': 4 << 20, 'original.json': 4 << 20,
             'manifest.json': 4 << 20, 'source.before.json': 4 << 20,
             'source.after.json': 4 << 20, 'node-stage.original.json': 65536,
             'process.original.json': 65536, 'service-status.original.json': 524288,
             'outside.original.json': 16384, 'cleanup.original.json': 16384}
FALSE_FLAGS = ('officialGradeQualified', 'resourceQualified', 'toolchainInventoryApproved',
               'compilerApproved', 'guestApproved', 'buildAuthorized', 'referenceAuthorized',
               'actualRunApproved', 'wholeHostAttested', 'physicalTimingProved')


class Refusal(ValueError):
    pass


class ReadFailure(Exception):
    def __init__(self, first, secondary):
        self.first, self.secondary = first, secondary
        super().__init__(first['message'])


def need(value, message):
    if not value:
        raise Refusal(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def wire(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'),
                       ensure_ascii=False, allow_nan=False) + '\n').encode()


def fields(value, names):
    need(type(value) is dict and set(value) == set(names.split()), 'closed object fields')
    return value


def digest(value, length=64):
    need(type(value) is str and re.fullmatch('[0-9a-f]{' + str(length) + '}', value),
         'typed source digest')
    return value


def integer(value, minimum=0, maximum=2**64 - 1):
    need(type(value) is int and minimum <= value <= maximum, 'bounded exact integer')
    return value


def decode(raw, cap, *, canonical=False):
    need(type(raw) is bytes and 0 < len(raw) <= cap, 'bounded JSON bytes')
    def pairs(items):
        value = {}
        for name, item in items:
            need(name not in value, 'duplicate JSON key')
            value[name] = item
        return value
    def number(text):
        value = float(text)
        need(math.isfinite(value), 'finite JSON number')
        return value
    value = json.loads(raw, object_pairs_hook=pairs, parse_float=number,
                       parse_constant=lambda _: (_ for _ in ()).throw(Refusal('finite JSON constant')))
    if canonical:
        need(wire(value) == raw, 'canonical JSON bytes')
    return value


def error_fact(stage, error):
    message = ('OS error errno=' + str(error.errno) if isinstance(error, OSError)
               else str(error))
    return {'stage': stage, 'type': type(error).__name__,
            'errno': error.errno if isinstance(error, OSError) else None,
            'message': message[:512]}


def read_local(path, cap, role, budget):
    """Held/named regular-file read; a close failure never replaces the first."""
    path = Path(path).absolute()
    fd = None
    first = None
    secondary = []
    result = None
    identity = lambda row: (row.st_dev, row.st_ino, row.st_mode, row.st_uid,
                            row.st_gid, row.st_nlink, row.st_size,
                            row.st_mtime_ns, row.st_ctime_ns)
    try:
        need(path.resolve(strict=True) == path and not path.is_symlink(), 'canonical local file')
        before = path.lstat()
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
             0 < before.st_size <= cap, 'bounded single regular local file')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        need(identity(os.fstat(fd)) == identity(before), 'held local file identity')
        data = bytearray()
        while len(data) <= cap:
            part = os.read(fd, min(65536, cap + 1 - len(data)))
            if not part:
                break
            budget[0] += len(part)
            need(budget[0] <= 32 << 20, 'aggregate local input read cap')
            data.extend(part)
        need(len(data) == before.st_size and identity(os.fstat(fd)) == identity(before) ==
             identity(path.lstat()), 'stable complete local file read')
        result = bytes(data)
    except BaseException as error:
        first = error_fact('read-' + role, error)
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except BaseException as error:
                item = error_fact('close-' + role, error)
                if first is None:
                    first = item
                else:
                    secondary.append(item)
    if first is not None:
        raise ReadFailure(first, secondary)
    return result


def stat22(raw):
    """Exact observed schema, not an inferred kernel version or counter lease."""
    need(type(raw) is str and 0 < len(raw.encode()) <= 4096 and raw.isascii(),
         'bounded ASCII stat text')
    rows = {}
    for line in raw.splitlines(keepends=True):
        match = re.fullmatch(r'([a-z_]+) (0|[1-9][0-9]{0,19})\n', line)
        need(match is not None and match[1] not in rows, 'canonical unique stat row')
        rows[match[1]] = integer(int(match[2]))
    need(tuple(rows) == STAT_KEYS, 'exact observed 22-key stat roster')  # PROFILE_ROSTER_GUARD
    return rows


def events2(raw):
    need(type(raw) is str and 0 < len(raw.encode()) <= 4096 and raw.isascii(),
         'bounded ASCII events text')
    match = re.fullmatch(r'populated ([01])\nfrozen ([01])\n', raw)
    need(match is not None, 'separate exact populated/frozen event roster')
    return {'populated': int(match[1]), 'frozen': int(match[2])}


# Copied generic algorithm from the separately reviewed CPU negative reader,
# f5df543e8c9f60c07262b668b3c816fe76f85815 (reader SHA 82599a1d...).
# Adaptation: twelve JSON roles instead of 106 and the unchanged Bochs caps.
# This observed upload profile uses version20, flag8, raw DEFLATE, signed
# 32-bit descriptors, no extras/comments and Unix creator45.
def physical_zip_layout(raw, infos):
    need(len(raw) >= 22, 'ZIP terminal extent')
    signature, disk, central_disk, on_disk, total, central_size, central_at, comment = struct.unpack_from('<IHHHHIIH', raw, len(raw) - 22)
    need((signature, disk, central_disk, on_disk, total, comment) ==
         (0x06054b50, 0, 0, 12, 12, 0) and central_at + central_size == len(raw) - 22,
         'single exact EOCD and central extent')
    cursor = 0
    local_times = []
    spans = []
    for info in infos:
        need(info.header_offset == cursor and cursor + 30 <= central_at,
             'contiguous indexed local header')
        local = struct.unpack_from('<IHHHHHIIIHH', raw, cursor)
        sig, version, flags, method, dos_time, dos_date, crc, compressed, expanded, name_len, extra_len = local
        name = info.filename.encode('ascii')
        need((sig, version, flags, method, crc, compressed, expanded, extra_len) ==
             (0x04034b50, 20, 8, 8, 0, 0, 0, 0) and name_len == len(name) and
             raw[cursor + 30:cursor + 30 + name_len] == name,
             'observed bounded local header')
        local_times.append((dos_time, dos_date))
        data_at = cursor + 30 + name_len
        descriptor_at = data_at + info.compress_size
        need(descriptor_at + 16 <= central_at, 'bounded local member and descriptor')
        spans.append(raw[data_at:descriptor_at])
        need(struct.unpack_from('<IIII', raw, descriptor_at) ==
             (0x08074b50, info.CRC, info.compress_size, info.file_size),
             '32-bit data descriptor')
        cursor = descriptor_at + 16
    need(cursor == central_at, 'no unindexed local bytes or gaps')
    cursor = central_at
    for info, local_time in zip(infos, local_times):
        need(cursor + 46 <= len(raw) - 22, 'bounded central header')
        values = struct.unpack_from('<IHHHHHHIIIHHHHHII', raw, cursor)
        (sig, made, needed, flags, method, dos_time, dos_date, crc, compressed,
         expanded, name_len, extra_len, comment_len, disk_start, internal_attr,
         external_attr, local_at) = values
        name = info.filename.encode('ascii')
        need(sig == 0x02014b50 and made == 0x032d and needed == 20 and flags == 8 and method == 8 and
             (dos_time, dos_date) == local_time and
             extra_len == comment_len == disk_start == internal_attr == 0 and name_len == len(name) and
             raw[cursor + 46:cursor + 46 + name_len] == name and
             (crc, compressed, expanded, external_attr, local_at) ==
             (info.CRC, info.compress_size, info.file_size, info.external_attr, info.header_offset),
             'exact indexed central header')
        cursor += 46 + name_len
    need(cursor == central_at + central_size, 'no central gaps or aliases')
    return spans


def strict_raw_deflate(span, expanded_bytes, crc):
    need(type(expanded_bytes) is int and 0 <= expanded_bytes <= 4 << 20 and
         type(span) is bytes and len(span) <= 8 << 20, 'bounded compressed JSON role')
    inflater = zlib.decompressobj(-15)
    try:
        body = inflater.decompress(span, expanded_bytes + 1)
        need(len(body) == expanded_bytes and inflater.eof and
             inflater.unused_data == b'' and inflater.unconsumed_tail == b'',
             'single fully consumed raw DEFLATE stream')
        need(inflater.flush(1) == b'', 'no deferred DEFLATE output')
    except zlib.error as error:
        raise Refusal('invalid raw DEFLATE stream') from error
    need(zlib.crc32(body) & 0xffffffff == crc, 'raw DEFLATE CRC')
    return body


def physical_archive(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 8 << 20, 'bounded diagnostic ZIP')
    # Bound central-directory parsing before ZipFile allocates any ZipInfo.
    # The observed profile has precisely these twelve ASCII names and no
    # central extras/comments; its total directory byte count is therefore fixed.
    need(len(raw) >= 22, 'ZIP terminal extent before directory parsing')
    footer = struct.unpack_from('<IHHHHIIH', raw, len(raw) - 22)
    need(footer[:5] == (0x06054b50, 0, 0, 12, 12) and footer[7] == 0 and
         footer[5] == sum(46 + len(name.encode('ascii')) for name in ROLE_CAPS) and
         footer[6] + footer[5] == len(raw) - 22,
         'bounded exact twelve-role central directory before parsing')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        need(len(infos) == 12 and len({x.filename for x in infos}) == 12 and
             set(x.filename for x in infos) == set(ROLE_CAPS), 'exact twelve physical ZIP names')
        need(len({x.header_offset for x in infos}) == 12, 'unique physical ZIP offsets')
        total = 0
        for info in infos:
            mode = info.external_attr >> 16
            need(info.filename.isascii() and not info.is_dir() and info.flag_bits == 8 and
                 info.compress_type == zipfile.ZIP_DEFLATED and info.create_system == 3 and
                 mode == 0o100444 and
                 0 <= info.file_size <= ROLE_CAPS[info.filename] and
                 0 <= info.compress_size <= 8 << 20, 'bounded ordinary physical JSON role')
            total += info.file_size
            need(total <= 16 << 20, 'unchanged aggregate expanded ZIP cap')
        spans = physical_zip_layout(raw, infos)
        return {info.filename: strict_raw_deflate(span, info.file_size, info.CRC)
                for info, span in zip(infos, spans)}


def derive_negative_validators(old_raw, old):
    """Finite source-anchored new definitions, never edits to old.__dict__."""
    need(sha(old_raw) == OLD_READER_SHA, 'fixed old reader before AST derivation')
    nodes = {n.name: n for n in ast.parse(old_raw).body if isinstance(n, ast.FunctionDef)}
    namespace = dict(vars(old))
    additions = {'negative_stat22': stat22, 'negative_events2': events2}
    proof = {}
    def archive_members(raw, caps, **kwargs):
        need(caps == old.INVENTORY_CAPS and kwargs.get('allowed') == old.ELF_ROLES,
             'derived archive uses unchanged diagnostic caps/roles')
        packet = physical_archive(raw)
        decoded, budget = old.archive_members(raw, caps, **kwargs)
        need(packet == decoded, 'raw-span and old archive bytes agree')
        return packet, budget
    additions['negative_archive_members'] = archive_members
    for name in additions:
        need(name not in namespace, 'new derivative names never replace old names')
    namespace.update(additions)
    plans = (
        ('resources_v2_fact', 'negative_resources22_fact', {}),
        ('elf_attribution_packet', 'negative_packet22_fact', {'resources_v2_fact': ('negative_resources22_fact', 2)}),
        ('elf_attribution_official', 'negative_official22_fact', {
            'archive_members': ('negative_archive_members', 1),
            'elf_attribution_packet': ('negative_packet22_fact', 1)}))
    for original, new_name, replacements in plans:
        node = copy.deepcopy(nodes[original])
        node.name = new_name
        counts = {key: 0 for key in replacements}
        if original == 'resources_v2_fact':
            wanted = {'root_events': ('root', 'cgroup.events', 'negative_events2'),
                      'root_stat': ('root', 'cgroup.stat', 'negative_stat22'),
                      'control_events': ('controller', 'cgroup.events', 'negative_events2'),
                      'control_stat': ('controller', 'cgroup.stat', 'negative_stat22')}
            seen = set()
            for statement in node.body:
                if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name) and statement.targets[0].id in wanted:
                    key = statement.targets[0].id
                    owner, member, target = wanted[key]
                    expected = ast.parse("counted(" + owner + "['files'][" + repr(member) + "])", mode='eval').body
                    need(ast.dump(statement.value, include_attributes=False) == ast.dump(expected, include_attributes=False),
                         'exact four historical counter call shapes')
                    statement.value.func.id = target
                    seen.add(key)
            need(seen == set(wanted), 'all four parser calls derived exactly once')
            nested = next(x for x in node.body if isinstance(x, ast.FunctionDef) and x.name == 'counted')
            historical_nested = next(x for x in nodes[original].body if isinstance(x, ast.FunctionDef) and x.name == 'counted')
            need(ast.dump(nested, include_attributes=False) == ast.dump(historical_nested, include_attributes=False),
                 'historical nested sixteen-row definition held')
        class Targets(ast.NodeTransformer):
            def visit_Call(self, call):
                self.generic_visit(call)
                if isinstance(call.func, ast.Name) and call.func.id in replacements:
                    prior = call.func.id
                    counts[prior] += 1
                    call.func.id = replacements[prior][0]
                return call
        node = Targets().visit(node)
        need(all(counts[k] == value[1] for k, value in replacements.items()), 'finite derivative call-target counts')
        need(new_name not in namespace, 'new named validator only')
        module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
        exec(compile(module, '<source-pinned-negative-derivative>', 'exec'), namespace)
        proof[new_name] = {'original': original, 'callTargets': counts,
                           'originalAstSha256': sha(ast.dump(nodes[original], include_attributes=False).encode()),
                           'derivedAstSha256': sha(ast.dump(node, include_attributes=False).encode())}
    return namespace['negative_official22_fact'], proof


def load_old(raw):
    need(sha(raw) == OLD_READER_SHA, 'fixed reviewed old reader SHA before exec')
    module = types.ModuleType('sha_pinned_historical_bochs_reader')
    module.__file__ = OLD_READER_PATH
    exec(compile(raw, OLD_READER_PATH, 'exec'), vars(module))
    return module


def audit(paths, policy_sha, auditor_commit, auditor_tree):
    budget = [0]
    policy_raw = read_local(paths['policy'], 65536, 'policy', budget)
    digest(policy_sha)
    need(sha(policy_raw) == policy_sha, 'externally selected review policy bytes')
    policy = decode(policy_raw, 65536, canonical=True)
    fields(policy, 'schema profile negativeOnly auditor original inputs')
    need(policy['schema'] == 'bw.bochs-ring3.elf-negative-review.v1' and
         policy['profile'] == PROFILE and policy['negativeOnly'] is True, 'negative-only reviewed profile')
    auditor = fields(policy['auditor'], 'commit tree path mode gitBlob bytes sha256')
    digest(auditor_commit, 40); digest(auditor_tree, 40)
    need(auditor['commit'] == auditor_commit and auditor['tree'] == auditor_tree and
         auditor['path'] == AUDITOR_PATH and auditor['mode'] == '100644', 'external new auditor Git identity')
    self_raw = read_local(__file__, 1 << 20, 'auditor-source', budget)
    need(type(auditor['bytes']) is int and auditor['bytes'] == len(self_raw) and
         auditor['sha256'] == sha(self_raw) and
         auditor['gitBlob'] == hashlib.sha1(b'blob ' + str(len(self_raw)).encode() + b'\0' + self_raw).hexdigest(),
         'new auditor bytes match externally reviewed source row')
    original = fields(policy['original'], 'head tree workflowCommit workflowTree workflowFileSha256 sourceFilesSha256 oldReaderSha256 requestSha256 eventSha256 manifestSha256 sourceBeforeSha256 sourceAfterSha256 refusal')
    need(original['head'] == OLD_HEAD and original['tree'] == OLD_TREE and
         original['workflowCommit'] == OLD_WORKFLOW and original['workflowTree'] == OLD_TREE and
         original['sourceFilesSha256'] == OLD_SOURCE_FILES_SHA and
         original['oldReaderSha256'] == OLD_READER_SHA and original['refusal'] == OLD_REFUSAL,
         'historical source and original refusal stay separately pinned')
    for key in ('workflowFileSha256', 'requestSha256', 'eventSha256', 'manifestSha256',
                'sourceBeforeSha256', 'sourceAfterSha256'):
        digest(original[key])
    fields(policy['inputs'], 'archive expectation run jobs artifacts jobLog originalFailure')
    inputs = {}
    for role, cap in CAPS.items():
        descriptor = fields(policy['inputs'][role], 'bytes sha256')
        integer(descriptor['bytes'], 1, cap); digest(descriptor['sha256'])
        inputs[role] = read_local(paths[role], cap, role, budget)
        need(len(inputs[role]) == descriptor['bytes'] and sha(inputs[role]) == descriptor['sha256'],
             'exact externally selected ' + role + ' original bytes')
    failure_text = inputs['originalFailure'].decode('utf-8')
    failure_lines = failure_text.splitlines()
    need(failure_lines and re.fullmatch(r'[A-Za-z0-9_.]*Refusal: ' + re.escape(OLD_REFUSAL), failure_lines[-1]) is not None,
         'externally bound original refusal trace')
    old_raw = read_local(paths['oldReader'], 1 << 20, 'historical-reader-source', budget)
    need(sha(old_raw) == OLD_READER_SHA, 'fixed reviewed old reader SHA before any module execution')
    packet = physical_archive(inputs['archive'])
    for role, key in (('request.original.json', 'requestSha256'), ('event.original.json', 'eventSha256'),
                      ('manifest.json', 'manifestSha256'), ('source.before.json', 'sourceBeforeSha256'),
                      ('source.after.json', 'sourceAfterSha256')):
        need(sha(packet[role]) == original[key], 'external historical original role digest')
    request = decode(packet['request.original.json'], 32768, canonical=True)
    need(type(request['pullRequest']) is int and request['pullRequest'] == OLD_PULL_REQUEST and
         request['source']['head'] == OLD_HEAD and request['source']['tree'] == OLD_TREE and
         sha(wire(request['source']['files'])) == OLD_SOURCE_FILES_SHA and
         request['source']['files'][OLD_READER_PATH]['sha256'] == OLD_READER_SHA and
         request['source']['files'][OLD_READER_PATH]['bytes'] == len(old_raw),
         'all twelve historical source rows, never artifact-selected executable code')
    row = request['source']['files'][OLD_READER_PATH]
    need(row['mode'] == '100644' and row['gitBlob'] ==
         hashlib.sha1(b'blob ' + str(len(old_raw)).encode() + b'\0' + old_raw).hexdigest(),
         'historical request reader mode/blob before module execution')
    workflow = '.github/workflows/i80386-bochs-ring3-reference.yml'
    need(request['source']['files'][workflow]['sha256'] == original['workflowFileSha256'], 'external old workflow source SHA')
    for role in ('source.before.json', 'source.after.json'):
        source = decode(packet[role], 4 << 20, canonical=True)
        need(source['workflowCommit'] == OLD_WORKFLOW and source['workflowTree'] == OLD_TREE,
             'separately reviewed historical executing workflow')
    # No artifact-selected or unverified module is ever executed: all of the
    # external old H/W identities, source-row digest and local code hash above
    # precede this one source-pinned pure-module load.
    old = load_old(old_raw)
    old_namespace = dict(vars(old))
    official, derivation = derive_negative_validators(old_raw, old)
    inner = old.parse_json(packet['original.json'], 4 << 20, canonical_wire=True)
    resources = fields(inner['resources'], 'before after')
    for role in ('unitRoot', 'controller'):
        first = resources['before'][role]['directory']
        last = resources['after'][role]['directory']
        need(all(type(first[k]) is int and type(last[k]) is int and first[k] == last[k]
                 for k in ('dev', 'ino', 'mode', 'uid', 'gid')),
             'same root/controller directory identity at two observed positions')
    expectation = old.parse_json(inputs['expectation'], 65536, canonical_wire=True)
    need(expectation['conclusion'] == 'failure' and expectation['head'] == OLD_HEAD and
         expectation['tree'] == OLD_TREE and expectation['workflowCommit'] == OLD_WORKFLOW and
         expectation['workflowTree'] == OLD_TREE and expectation['requestSha256'] == original['requestSha256'] and
         expectation['eventSha256'] == original['eventSha256'] and
         expectation['workflowFileSha256'] == original['workflowFileSha256'], 'external negative official expectation joins')
    result = official(inputs['archive'], inputs['expectation'], decode(inputs['run'], 4 << 20),
                      decode(inputs['jobs'], 4 << 20), decode(inputs['artifacts'], 4 << 20), inputs['jobLog'])
    need(result['classification'] == 'guard-refusal-attributed' and result['officialMetadataBound'] is True,
         'only attributed strict negative readback is reportable')
    need(set(vars(old)) == set(old_namespace) and all(vars(old)[k] is v for k, v in old_namespace.items()),
         'historical namespace unchanged')
    attribution = old.parse_json(packet['elf-attribution.original.json'], 4 << 20, canonical_wire=True)
    record = attribution['records'][result['triggerIndex']]
    return {'schema': 'bw.bochs-ring3.elf-negative-readback.v1',
            'classification': 'original-refused/structural-attributed',
            'profile': PROFILE, 'originalGradeRefused': True, 'originalRefusal': OLD_REFUSAL,
            **{name: False for name in FALSE_FLAGS}, 'officialMetadataBound': True,
            'officiallyAuthenticatedByLocalFiles': False, 'auditorSource': auditor,
            'oldReaderSourceSha256': OLD_READER_SHA, 'originalSource': original,
            'requestSha256': sha(packet['request.original.json']), 'eventSha256': sha(packet['event.original.json']),
            'archiveSha256': sha(inputs['archive']), 'manifestSha256': sha(packet['manifest.json']),
            'runId': expectation['runId'], 'jobId': expectation['jobId'], 'artifactId': expectation['artifactId'],
            'triggerIndex': result['triggerIndex'], 'triggerPath': result['triggerPath'], 'tags': result['tags'],
            'reportedWholeFile': {'bytes': record['read']['bytes'], 'sha256': record['read']['sha256'],
                                  'independentlyRehashedFromSparseRanges': False},
            'structuralProof': 'exact required sparse ELF ranges and tag/string offsets independently decoded',
            'derivation': derivation, 'localInputReadBytes': budget[0],
            'scope': 'negative structural attribution only; original official/resource grade remains refused'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy-sha256', required=True)
    parser.add_argument('--auditor-commit', required=True)
    parser.add_argument('--auditor-tree', required=True)
    for name in ('policy', 'old-reader', 'archive', 'expectation', 'run', 'jobs', 'artifacts',
                 'job-log', 'original-failure'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(argv)
    paths = {'policy': args.policy, 'oldReader': args.old_reader, 'archive': args.archive,
             'expectation': args.expectation, 'run': args.run, 'jobs': args.jobs,
             'artifacts': args.artifacts, 'jobLog': args.job_log, 'originalFailure': args.original_failure}
    try:
        result = audit(paths, args.policy_sha256, args.auditor_commit, args.auditor_tree)
    except BaseException as error:
        first = error.first if isinstance(error, ReadFailure) else error_fact('negative-audit', error)
        secondary = error.secondary if isinstance(error, ReadFailure) else []
        result = {'schema': 'bw.bochs-ring3.elf-negative-readback.v1',
                  'classification': 'original-refused/structural-incomplete',
                  'originalGradeRefused': None, **{name: False for name in FALSE_FLAGS},
                  'officialMetadataBound': False, 'firstFailure': first, 'secondary': secondary}
        sys.stderr.write(wire(result).decode())
        return 1
    sys.stdout.write(wire(result).decode())
    return 0


if __name__ == '__main__':
    sys.exit(main())
