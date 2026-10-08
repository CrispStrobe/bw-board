"""Bounded sampling-heap reduction. Samples are diagnostic, not total allocation."""
import hashlib
import json
import math
import os
import re
import stat
from pathlib import Path

MAX_BYTES = 8 * 1024 * 1024
MAX_NODES = 100000
MAX_SAMPLES = 250000
MAX_DEPTH = 4096
MAX_SAMPLE_SIZE = 1 << 32
MAX_TOTAL_SIZE = 1 << 46
MAX_ORDINAL = 1 << 53
ROLES = ('authenticated_cpu_js', 'authenticated_dispatch_js',
         'authenticated_board_device_js', 'authenticated_other_js',
         'profiled_probe_js', 'node_runtime', 'native_wasm_or_unresolved')


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate heap profile JSON key')
            result[key] = value
        return result

    def finite_float(value):
        number = float(value)
        require(math.isfinite(number), 'nonfinite heap profile number')
        return number

    def constant(value):
        raise ValueError('nonfinite heap profile constant: ' + value)

    return json.loads(raw, object_pairs_hook=unique, parse_float=finite_float,
                      parse_constant=constant)


def bounded_frame(frame):
    require(type(frame) is dict and set(frame) ==
            {'functionName', 'scriptId', 'url', 'lineNumber', 'columnNumber'},
            'complete heap call frame')
    require(type(frame['functionName']) is str and len(frame['functionName']) <= 1024,
            'bounded function name')
    require(type(frame['url']) is str and len(frame['url']) <= 4096,
            'bounded frame URL')
    require(type(frame['scriptId']) is str and
            re.fullmatch(r'[0-9]{1,20}', frame['scriptId']) is not None,
            'numeric script ID')
    for field in ('lineNumber', 'columnNumber'):
        require(type(frame[field]) is int and -1 <= frame[field] <= 100000000,
                'bounded frame location')


def load(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_BYTES,
                'bounded ordinary heap profile')
        raw = bytearray()
        while len(raw) <= MAX_BYTES:
            part = os.read(fd, min(65536, MAX_BYTES + 1 - len(raw)))
            if not part:
                break
            raw += part
        require(len(raw) == info.st_size, 'stable bounded heap profile')
        raw = bytes(raw)
    finally:
        os.close(fd)
    profile = strict_json(raw)
    require(type(profile) is dict and set(profile) == {'head', 'samples'},
            'exact sampling heap profile fields')
    samples = profile['samples']
    require(type(samples) is list and 1 <= len(samples) <= MAX_SAMPLES,
            'bounded nonempty heap samples')
    nodes = {}
    stack = [(profile['head'], 0)]
    while stack:
        node, depth = stack.pop()
        require(depth <= MAX_DEPTH and len(nodes) < MAX_NODES, 'bounded heap tree')
        require(type(node) is dict and set(node) ==
                {'callFrame', 'selfSize', 'id', 'children'},
                'exact heap node fields')
        ident = node['id']
        require(type(ident) is int and 0 < ident <= MAX_ORDINAL and ident not in nodes,
                'unique bounded heap node ID')
        size = node['selfSize']
        require(type(size) is int and 0 <= size <= MAX_TOTAL_SIZE,
                'nonnegative bounded self size')
        bounded_frame(node['callFrame'])
        children = node['children']
        require(type(children) is list and len(children) <= MAX_NODES,
                'bounded heap children')
        nodes[ident] = node
        stack.extend((child, depth + 1) for child in reversed(children))
    total = 0
    last_ordinal = -1
    for sample in samples:
        require(type(sample) is dict and set(sample) ==
                {'size', 'nodeId', 'ordinal'}, 'exact heap sample fields')
        size, ident, ordinal = (sample['size'], sample['nodeId'], sample['ordinal'])
        require(type(size) is int and 0 < size <= MAX_SAMPLE_SIZE,
                'positive bounded sample size')
        require(type(ident) is int and ident in nodes, 'sample references heap node')
        require(type(ordinal) is int and last_ordinal < ordinal <= MAX_ORDINAL,
                'ordered bounded sample ordinal')
        last_ordinal = ordinal
        total += size
        require(total <= MAX_TOTAL_SIZE, 'bounded sampled bytes')
    return nodes, samples, total, sha(raw)


def source_roles(source_root, inventory, generated_sha):
    source = Path(source_root)
    require(source.is_dir() and source.resolve(strict=True) == source,
            'canonical exact source root')
    require(type(inventory) is dict and 1 <= len(inventory) <= 256,
            'bounded source inventory')
    mapping = {}
    for role, expected in inventory.items():
        require(type(role) is str and role.startswith(('./', '../')) and
                '\\' not in role and '..' not in role.split('/')[1:] and
                type(expected) is str and re.fullmatch('[0-9a-f]{64}', expected),
                'source role syntax')
        lexical = source / 'scripts' / role
        info = lexical.lstat()
        require(stat.S_ISREG(info.st_mode), 'ordinary source role')
        path = lexical.resolve(strict=True)
        require(path.is_relative_to(source) and path.stat().st_size <= 4 * 1024 * 1024,
                'bounded contained source role')
        require(sha(path.read_bytes()) == expected, 'authenticated source role bytes')
        mapping[path.as_uri()] = role
    generated = source / 'scripts/probe-xv6-stock-rollback-profile.mjs'
    info = generated.lstat()
    require(stat.S_ISREG(info.st_mode) and generated.resolve(strict=True) == generated and
            info.st_size <= 4 * 1024 * 1024 and
            sha(generated.read_bytes()) == generated_sha,
            'exact generated probe bytes')
    require(generated.as_uri() not in mapping, 'separate generated source role')
    mapping[generated.as_uri()] = 'generated-rollback-probe'
    return mapping


def bucket(frame, mapping):
    url = frame['url']
    role = mapping.get(url)
    if role == 'generated-rollback-probe':
        return 'profiled_probe_js'
    if role == '../src/experimental/i80386.js':
        return 'authenticated_cpu_js'
    if role == '../src/experimental/i80386-native-dispatch.js':
        return 'authenticated_dispatch_js'
    if role in ('../src/experimental/i80386-at-machine.js',
                '../src/experimental/ata16.js', '../src/at-8042-a20.js',
                '../src/at-ps2-mouse.js'):
        return 'authenticated_board_device_js'
    if role is not None and role.endswith(('.js', '.mjs')):
        return 'authenticated_other_js'
    if url.startswith('node:'):
        return 'node_runtime'
    return 'native_wasm_or_unresolved'


def summarize(path, source_root, inventory, generated_sha):
    mapping = source_roles(source_root, inventory, generated_sha)
    nodes, samples, total, raw_sha = load(path)
    buckets = {role: {'samples': 0, 'sampledBytes': 0} for role in ROLES}
    locations = {}
    for sample in samples:
        frame = nodes[sample['nodeId']]['callFrame']
        role = bucket(frame, mapping)
        size = sample['size']
        buckets[role]['samples'] += 1
        buckets[role]['sampledBytes'] += size
        key = (role, frame['functionName'], frame['url'],
               frame['lineNumber'], frame['columnNumber'])
        item = locations.setdefault(key, {'samples': 0, 'sampledBytes': 0})
        item['samples'] += 1
        item['sampledBytes'] += size
    ordered = sorted(locations.items(), key=lambda kv: (-kv[1]['sampledBytes'], kv[0]))
    return {
        'schema': 'bw.xv6-js-rollback-heap-profile.v1',
        'rawProfileSha256': raw_sha,
        'nodeCount': len(nodes), 'sampleCount': len(samples),
        'sampledBytes': total,
        'buckets': buckets,
        'locations': [
            {'bucket': key[0], 'functionName': key[1],
             'sourceRole': mapping.get(key[2]), 'lineNumber': key[3],
             'columnNumber': key[4], **value}
            for key, value in ordered[:128]
        ],
        'truncatedLocations': len(ordered) > 128,
        'scope': 'Sampled allocation observations, not total allocation or CPU cost.',
    }
