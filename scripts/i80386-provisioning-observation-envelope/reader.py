'Independent bytes-only observation reader. No producer imports or operational seals.'

import hashlib, json, re, struct, zlib

CAPS = {'envelope.json': 131072,
 'stdout.prefix': 65536,
 'stderr.prefix': 65536,
 'status.txt': 1024,
 'source-before.json': 65536,
 'source-after.json': 65536,
 'descriptor.json': 8192,
 'role-table.json': 65536,
 'resources.json': 8192}

ZIP_CAP = 524288

DECODED_CAP = 524288

MANDATORY = ('envelope.json', 'stdout.prefix', 'stderr.prefix', 'status.txt')

STAGES = {'entry': ['envelope.json', 'stdout.prefix', 'stderr.prefix', 'status.txt'],
 'source-before': ['envelope.json',
                   'stdout.prefix',
                   'stderr.prefix',
                   'status.txt',
                   'source-before.json',
                   'descriptor.json',
                   'role-table.json'],
 'resources': ['envelope.json',
               'stdout.prefix',
               'stderr.prefix',
               'status.txt',
               'source-before.json',
               'descriptor.json',
               'role-table.json',
               'resources.json'],
 'lifetime': ['envelope.json',
              'stdout.prefix',
              'stderr.prefix',
              'status.txt',
              'source-before.json',
              'descriptor.json',
              'role-table.json',
              'resources.json'],
 'source-after': ['envelope.json',
                  'stdout.prefix',
                  'stderr.prefix',
                  'status.txt',
                  'source-before.json',
                  'descriptor.json',
                  'role-table.json',
                  'resources.json',
                  'source-after.json'],
 'complete': ['envelope.json',
              'stdout.prefix',
              'stderr.prefix',
              'status.txt',
              'source-before.json',
              'descriptor.json',
              'role-table.json',
              'resources.json',
              'source-after.json']}

ENV_KEYS = ('schema',
 'stage',
 'completeReported',
 'members',
 'context',
 'failure',
 'admission',
 'lifetime',
 'inheritedProjection',
 'authority')

CONTEXT_KEYS = ('repository',
 'sourceHead',
 'declaredApprovalSha256',
 'declaredRun',
 'declaredJob',
 'declaredArtifact')

FAILURE_KEYS = ('primary', 'secondary', 'cleanupUnknown')

ERROR_KEYS = ('producer', 'code', 'exceptionType')

ERROR_CODES = {'envelope': ['unarmed', 'outer-refused', 'source-refused', 'resource-refused'],
 'entry': ['channel-close-refused',
           'component-close-refused',
           'component-read-refused',
           'entry-reentry',
           'entry-refused',
           'handle-close-refused',
           'limit-status-refused'],
 'controller': ['approval',
                'approval-seal',
                'approval-unarmed',
                'bootstrap-cap',
                'bootstrap-file',
                'bootstrap-race',
                'bootstrap-refused',
                'bootstrap-route',
                'bytes-cap',
                'checkout',
                'closed-shape',
                'component',
                'component-seal',
                'controller-once',
                'controller-reentry',
                'coordinator-close-refused',
                'coordinator-incomplete',
                'duplicate-json',
                'final-coordinator-refused',
                'fixed-component',
                'fixed-policy',
                'head',
                'json-number',
                'json-parse',
                'metadata-seal',
                'operation-refused',
                'path',
                'path-policy',
                'poisoned',
                'projection',
                'roles',
                'source-after-refused',
                'source-close-refused',
                'source-closure',
                'table-component-join',
                'transport-incomplete',
                'transport-result',
                'transport-source-entry',
                'transport-status-refused',
                'workflow-role'],
 'limits': ['eligibility-refused',
            'final-readback-refused',
            'limit-readback-refused',
            'limit-set-refused',
            'pid1-reentry',
            'policy-refused'],
 'preparation': ['cleanup-refused',
                 'lifetime-close-refused',
                 'pipe-close-refused',
                 'preparation-reentry',
                 'preparation-refused',
                 'socket-close-refused',
                 'source-close-refused',
                 'source-refused'],
 'admission': ['boundary-close-refused',
               'boundary-read-refused',
               'channel-close-refused',
               'fd-close-refused',
               'observer-reentry',
               'observer-refused'],
 'lifetime': ['admission-close-refused',
              'channel-close-refused',
              'cleanup-ownership-refused',
              'cleanup-refused',
              'cleanup-terminal-refused',
              'lifetime-reentry',
              'lifetime-refused',
              'pipe-close-refused',
              'source-close-refused',
              'source-refused']}

ERROR_TYPES = ('Refusal',
 'OSError',
 'TimeoutError',
 'PermissionError',
 'BlockingIOError',
 'ValueError',
 'TypeError',
 'MemoryError',
 'RuntimeError',
 'OtherException')

ADMISSION_KEYS = ('schema',
 'closed',
 'ackAttempted',
 'ackSent',
 'ackMayHaveEscaped',
 'historicalHandlesAdmitted',
 'currentUsableHandles',
 'firstFailure',
 'cleanupRefused',
 'resourcePacketSha256',
 'kernelLimitRows')

LIFETIME_KEYS = ('schema',
 'phase',
 'closed',
 'complete',
 'firstFailure',
 'cleanupRefused',
 'stdoutPrefixBytes',
 'stderrPrefixBytes',
 'stdoutObservedBytes',
 'stderrObservedBytes',
 'stdoutPrefixSha256',
 'stderrPrefixSha256',
 'stdoutEOF',
 'stderrEOF',
 'outputCapRefused',
 'admissionObserved',
 'historicalHandlesAdmitted',
 'ackAttempted',
 'ackSent',
 'ackMayHaveEscaped',
 'pid1Terminal',
 'launcherReaped',
 'launcherExit',
 'censusCounts',
 'signalAttempted',
 'signalReturned',
 'cleanupObservationsMissing',
 'launchUnobserved')

LIFETIME_PHASES = ('new',
 'source',
 'launch',
 'admission',
 'execution',
 'terminal',
 'census',
 'refused',
 'observed')

AUTHORITY = ('officialBindingQualified',
 'externalApprovalQualified',
 'actualTransitiveSourceClosureQualified',
 'sourceOwnedQualified',
 'continuousLeaseQualified',
 'namespaceOwnershipQualified',
 'outerHardDeadlineQualified',
 'resourceSufficiencyQualified',
 'actualAcquisitionQualified',
 'compilerQualified',
 'guestQualified',
 'performanceQualified')

HELD14 = {'scripts/i80386-djgpp-notice-extractor/README.md': {'bytes': 5233,
                                                     'sha256': '0d3aa04e84ef72d6ee99a6e69ebaa8c12cf15823486561daee9eb4366566f769',
                                                     'gitBlob': 'bf6c36ac0e6ec1a79551895e088ba6d9ad2345de'},
 'scripts/i80386-djgpp-notice-extractor/controls.py': {'bytes': 10369,
                                                       'sha256': 'c0bb4b39195b62b9befa7eb96ab90281f091c704f4d9e754e26388110d85551f',
                                                       'gitBlob': '29c76a09ac9e50bda7558dee18c3a9ea548f05a6'},
 'scripts/i80386-djgpp-notice-extractor/extractor.py': {'bytes': 8801,
                                                        'sha256': 'bde66cf5de7fc0d02508d88176e51b47a3acf208770bbd8904afa87c9eb3d501',
                                                        'gitBlob': 'a2414e18eaf2e1f6c1464f04afe6d0c103150a01'},
 'scripts/i80386-full-tree-archive-bridge/README.md': {'bytes': 5899,
                                                       'sha256': '5990fe67175c4c2a5b7abfa62485ce8bf9f1fdaa122ccc078ca088c49a6f3eb8',
                                                       'gitBlob': '6cbdde0ea93a9a8a51dfa4748a268eda306c5a2a'},
 'scripts/i80386-full-tree-archive-bridge/bridge.py': {'bytes': 9562,
                                                       'sha256': 'f9c408854dc983274787c266f1a32be50f364e313a281603117a972d292a33d0',
                                                       'gitBlob': 'b3f342cb11831b616880ccca15d8099202bf6807'},
 'scripts/i80386-full-tree-archive-bridge/controls.py': {'bytes': 12528,
                                                         'sha256': 'a65ade6ec2b7ad03bcdaafb80dc2cdcd415980b1a317d76de87fd39abdf44170',
                                                         'gitBlob': '47426d44214d4991bc96427588adc0eef4ad78ed'},
 'scripts/i80386-full-tree-notice-connection/README.md': {'bytes': 5260,
                                                          'sha256': 'efc7fe41b267eeb27d887cdfa0b98ea53a4f22df8ac99cf5b5c59e112e07fa5e',
                                                          'gitBlob': '8adb1949d663de44be1a569a5aa5c8eb68131a92'},
 'scripts/i80386-full-tree-notice-connection/controls.py': {'bytes': 10312,
                                                            'sha256': '51bfcc82d5805f3951395415cd007b32b9182088a9024b0fe884a713df29a5e8',
                                                            'gitBlob': '8ecccd485eefd70b649e73542d23085db1923a0b'},
 'scripts/i80386-full-tree-notice-connection/coordinator.py': {'bytes': 7975,
                                                               'sha256': '0db65c2067c6e9e3945b5b3ce6c73ded47052c827ae07e876bd9d545016265e7',
                                                               'gitBlob': '08c47105a5a786a5430a78d0b20b9dc684704349'},
 'scripts/i80386-full-tree-provisioner/README.md': {'bytes': 6256,
                                                    'sha256': 'ec09d6db103bfe6464c805e8c08abc94620bb3b254874a3634c29e48e2d2bae9',
                                                    'gitBlob': '3c8bcc4366d1ba0e7b407531caf1e27768ed271d'},
 'scripts/i80386-full-tree-provisioner/controls.py': {'bytes': 12294,
                                                      'sha256': '68514bbc1ef4610259d21ebb445b0e72ca0fbb1f2d1d3bf3c586660f9a004a6a',
                                                      'gitBlob': 'fb9ada9482555bc91deb3a46d30444e3173712ce'},
 'scripts/i80386-full-tree-provisioner/manifest.json': {'bytes': 289038,
                                                        'sha256': '39955b4c493fe7468d86bf7936a2b427af49fbb938fe0790e92c1881d0bb90b9',
                                                        'gitBlob': '06807fd9952c5cd518e59cef5eff6721dd301a4d'},
 'scripts/i80386-full-tree-provisioner/provenance.json': {'bytes': 1598,
                                                          'sha256': '8a7a991dbab3b981602168201d66a1e6d7e79582386f307b854cd573232ef453',
                                                          'gitBlob': 'b923493f0d06e163cbdbd67d5f57a77b2fcd0d36'},
 'scripts/i80386-full-tree-provisioner/provision.py': {'bytes': 15126,
                                                       'sha256': 'e0a844ce3445b344a02e09ebee02ce8eca4a9ef7afc5a26d741b00902db561a2',
                                                       'gitBlob': 'b11d4ee2e5f64c7d402eabf1f5151fc077d18a5a'}}

CHECKED_COMPONENTS = {'scripts/i80386-provisioning-pid1/limits.py': {'bytes': 5805,
                                                'sha256': '829872fee3f1565ec8a67c57e74a7caba8c202b027ea6260f184425e888455d4',
                                                'gitBlob': '600772c565f5c5505f076e025549c099167e51d7'},
 'scripts/i80386-full-tree-provisioning-launcher/controller.py': {'bytes': 19661,
                                                                  'sha256': '9cb7cb6411694b65a9fe18a318967e04b3e24f5d9f86d4f59e48797fd19a43dd',
                                                                  'gitBlob': '8740a45b1aba063037432b6fc0d53c1385ae8d31'},
 'scripts/i80386-provisioning-observer/observer.py': {'bytes': 14445,
                                                      'sha256': '3ad37c746bae7035d7897ce5678919b59c98b4bdb510fc48996613d6677bb9e8',
                                                      'gitBlob': 'a7367e90cc8ddc07df50018d41f522debe6d5981'},
 'scripts/i80386-provisioning-observer-lifetime/lifetime.py': {'bytes': 12941,
                                                               'sha256': 'a1fd301279a3d01728f68a90fc6315f99421365699ac4080c3a17594623ec840',
                                                               'gitBlob': '74c50280aadbc0c6452209670eb242c4b8eca34b'}}

KINDS = ('inherited',
 'runner',
 'packet',
 'admission',
 'admission-control',
 'executor',
 'executor-control',
 'workflow',
 'config',
 'control',
 'readme')

REQUIRED_KINDS = ('runner',
 'packet',
 'admission',
 'admission-control',
 'executor',
 'executor-control',
 'workflow')

POLICY = (('cpuSeconds', 0, 180, 180),
 ('addressSpaceBytes', 9, 2147483648, 2147483648),
 ('fileBytes', 1, 67108864, 67108864),
 ('fdCount', 7, 256, 256),
 ('coreBytes', 4, 0, 0))

class Refusal(ValueError):
    pass

def need(ok, code):
    if not ok:
        raise Refusal(code)

def keys(value, names):
    need(type(value) is dict and len(value) == len(names) and all((type(k) is str for k in value)) and (set(value) == set(names)), 'closed-keys')

def integer(value, low=0, high=2 ** 64 - 1):
    need(type(value) is int and low <= value <= high, 'integer')

def boolean(value):
    need(type(value) is bool, 'boolean')

def digest(value, width=64):
    need(type(value) is str and re.fullmatch('[0-9a-f]{' + str(width) + '}', value) is not None, 'digest')

def same(a, b):
    if type(a) is not type(b):
        return False
    if type(a) is dict:
        return set(a) == set(b) and all((same(a[k], b[k]) for k in a))
    if type(a) is list:
        return len(a) == len(b) and all((same(x, y) for x, y in zip(a, b)))
    return a == b

def bounded(value, depth=0, budget=None):
    if budget is None:
        budget = [8192]
    budget[0] -= 1
    need(depth <= 32 and budget[0] >= 0, 'json-complexity')
    if type(value) is dict:
        need(len(value) <= 128 and all((type(k) is str and len(k) <= 240 for k in value)), 'json-object')
        for v in value.values():
            bounded(v, depth + 1, budget)
    elif type(value) is list:
        need(len(value) <= 128, 'json-list')
        for v in value:
            bounded(v, depth + 1, budget)
    elif type(value) is str:
        need(len(value) <= 256, 'json-string')
    else:
        need(value is None or type(value) in (int, bool), 'json-primitive')

def load(raw, cap):
    need(type(raw) is bytes and 0 < len(raw) <= cap, 'json-cap')

    def pairs(rows):
        out = {}
        for k, v in rows:
            need(k not in out, 'duplicate-json')
            out[k] = v
        return out

    def bad(_):
        raise Refusal('json-number')
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_float=bad, parse_constant=bad)
    except (UnicodeError, ValueError, RecursionError) as error:
        raise Refusal('json-invalid') from error
    bounded(value)
    return value

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def unpack(fmt, raw, offset):
    need(type(offset) is int and offset >= 0 and (offset + struct.calcsize(fmt) <= len(raw)), 'zip-truncated')
    return struct.unpack_from(fmt, raw, offset)

def zip_members(raw):
    need(type(raw) is bytes and 22 <= len(raw) <= ZIP_CAP, 'zip-cap')
    end = unpack('<I4H2IH', raw, len(raw) - 22)
    sig, disk, central_disk, count_disk, count, size, offset, comment = end
    need(sig == 101010256 and disk == central_disk == comment == 0 and (count == count_disk) and (1 <= count <= len(CAPS)) and (offset + size == len(raw) - 22), 'zip-eocd')
    cursor = 0
    members = {}
    locals_ = []
    total = 0
    while cursor < offset:
        start = cursor
        row = unpack('<I5H3I2H', raw, cursor)
        signature, version, flags, method, clock, date, crc, compressed, extent, name_len, extra = row
        need(signature == 67324752 and version == 20 and (flags == method == clock == extra == 0) and (date == 33) and (compressed == extent) and (1 <= name_len <= 32), 'zip-local')
        name_end = cursor + 30 + name_len
        body_end = name_end + extent
        need(body_end <= offset, 'zip-local-extent')
        try:
            name = raw[cursor + 30:name_end].decode('ascii')
        except UnicodeError as error:
            raise Refusal('zip-name') from error
        need(name in CAPS and name not in members and (extent <= CAPS[name]), 'zip-role')
        total += extent
        need(total <= DECODED_CAP and len(locals_) < len(CAPS), 'zip-decoded-cap')
        body = raw[name_end:body_end]
        need(zlib.crc32(body) & 4294967295 == crc, 'zip-crc')
        members[name] = body
        locals_.append((name, start, extent, crc))
        cursor = body_end
    need(cursor == offset and len(locals_) == count and (list(members) == [n for n in CAPS if n in members]), 'zip-local-order')
    cursor = offset
    for name, start, extent, crc in locals_:
        row = unpack('<I6H3I5H2I', raw, cursor)
        signature, made, version, flags, method, clock, date, central_crc, compressed, uncompressed, name_len, extra, remark, disk, internal, external, local_offset = row
        need(signature == 33639248 and made == 788 and (version == 20) and (flags == method == clock == extra == remark == disk == internal == 0) and (date == 33) and (central_crc == crc) and (compressed == uncompressed == extent) and (local_offset == start), 'zip-central')
        mode = external >> 16
        need(external & 65535 == 0 and (mode & 61440 == 32768 and (not mode & 3584)), 'zip-mode')
        need(name_len == len(name) and raw[cursor + 46:cursor + 46 + name_len] == name.encode('ascii'), 'zip-central-name')
        cursor += 46 + name_len
    need(cursor == offset + size and cursor == len(raw) - 22, 'zip-hidden-data')
    return members

def path(value):
    need(type(value) is str and 1 <= len(value) <= 240 and (re.fullmatch('[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', value) is not None), 'source-path')
    parts = value.split('/')
    need(len(parts) <= 30 and all((p not in ('.', '..') for p in parts)), 'source-path')
    return parts

def ancestors(names):
    seen = set()
    dirs = set()
    for name in names:
        parts = path(name)
        need(name not in seen and name not in dirs, 'source-ancestor')
        for i in range(1, len(parts)):
            parent = '/'.join(parts[:i])
            need(parent not in seen, 'source-ancestor')
            dirs.add(parent)
        seen.add(name)

def source_group(members, context, component_required):
    present = [name in members for name in ('source-before.json', 'descriptor.json', 'role-table.json')]
    need(all(present) or not any(present), 'source-group')
    need('source-after.json' not in members or all(present), 'source-after-dependency')
    if not any(present):
        return (None, None, None)
    d = load(members['descriptor.json'], 8192)
    keys(d, ('schema', 'status', 'head', 'repository', 'origin', 'workflow', 'branch', 'pr', 'tablePath', 'tableBytes', 'tableSha256', 'tableGitBlob'))
    need(d['schema'] == 'bw.full-tree-profile-descriptor.v1' and d['status'] == 'UNARMED_SOURCE_ONLY', 'source-descriptor')
    digest(d['head'], 40)
    need(d['repository'] == 'CrispStrobe/bw-board' and d['origin'] == 'https://github.com/CrispStrobe/bw-board.git', 'source-origin')
    path(d['workflow'])
    need(d['workflow'].startswith('.github/workflows/') and d['workflow'].endswith('.yml'), 'source-workflow')
    path(d['branch'])
    need(len(d['branch']) <= 120, 'source-branch')
    integer(d['pr'], 1, 2 ** 63 - 1)
    path(d['tablePath'])
    integer(d['tableBytes'], 1, 65536)
    digest(d['tableSha256'])
    digest(d['tableGitBlob'], 40)
    raw = members['role-table.json']
    need(len(raw) == d['tableBytes'] and sha(raw) == d['tableSha256'] and (hashlib.sha1(b'blob ' + str(len(raw)).encode('ascii') + b'\x00' + raw).hexdigest() == d['tableGitBlob']), 'source-table-bytes')
    t = load(raw, 65536)
    keys(t, ('schema', 'inheritedRoleCount', 'roles'))
    need(t['schema'] == 'bw.full-tree-profile-role-table.v1', 'source-table')
    integer(t['inheritedRoleCount'], 14, 14)
    need(type(t['roles']) is dict and 21 <= len(t['roles']) <= 100, 'source-count')
    ancestors([*t['roles'], d['tablePath']])
    need(d['tablePath'] not in t['roles'], 'source-self-cycle')
    for name, row in t['roles'].items():
        path(name)
        keys(row, ('kind', 'bytes', 'sha256', 'gitBlob'))
        need(type(row['kind']) is str and row['kind'] in KINDS, 'source-kind')
        integer(row['bytes'], 1, 524288)
        digest(row['sha256'])
        digest(row['gitBlob'], 40)
    need({n for n, r in t['roles'].items() if r['kind'] == 'inherited'} == set(HELD14) and set(REQUIRED_KINDS) <= set((r['kind'] for r in t['roles'].values())), 'source-reported-kinds')
    need(d['workflow'] in t['roles'] and t['roles'][d['workflow']]['kind'] == 'workflow', 'source-workflow-join')
    for name, row in HELD14.items():
        need(same(t['roles'][name], {'kind': 'inherited', **row}), 'source-inherited-pins')
    if component_required:
        for name, row in CHECKED_COMPONENTS.items():
            need(name in t['roles'] and all((same(t['roles'][name][k], v) for k, v in row.items())), 'source-component-pins')
    need(context['sourceHead'] == d['head'], 'context-source-head')
    flags = ('profileSourceAdmissionQualified', 'gitJoinImplemented', 'continuousSourceOwnershipQualified', 'inputLeaseQualified', 'filesystemLeaseQualified', 'compilerQualified', 'guestQualified', 'performanceQualified')
    out = []
    for name, position in (('source-before.json', 'before'), ('source-after.json', 'after')):
        if name not in members:
            out.append(None)
            continue
        v = load(members[name], 65536)
        keys(v, ('schema', 'position', 'head', 'repository', 'roleCount', 'roles', 'table', 'descriptorSha256', *flags))
        need(v['schema'] == 'bw.full-tree-profile-source.v1' and v['position'] == position and (v['head'] == d['head']) and (v['repository'] == d['repository']), 'source-position')
        integer(v['roleCount'], 21, 100)
        need(v['roleCount'] == len(t['roles']) and same(v['roles'], t['roles']), 'source-role-join')
        need(same(v['table'], {'path': d['tablePath'], 'bytes': d['tableBytes'], 'sha256': d['tableSha256'], 'gitBlob': d['tableGitBlob']}) and v['descriptorSha256'] == sha(members['descriptor.json']), 'source-snapshot-table')
        need(all((v[k] is False for k in flags)), 'source-authority')
        out.append(v)
    return (t, out[0], out[1])

def resource_packet(raw):
    v = load(raw, 8192)
    keys(v, ('schema', 'components', 'limits', 'controllerBootstrapStarted', 'observerOwnershipQualified', 'actualAcquisitionQualified', 'compilerQualified', 'guestQualified'))
    need(v['schema'] == 'bw.provisioning-contained-resource.v1' and all((v[k] is False for k in ('controllerBootstrapStarted', 'observerOwnershipQualified', 'actualAcquisitionQualified', 'compilerQualified', 'guestQualified'))), 'resource-schema')
    keys(v['components'], ('limits', 'controller'))
    for label, name in (('limits', 'scripts/i80386-provisioning-pid1/limits.py'), ('controller', 'scripts/i80386-full-tree-provisioning-launcher/controller.py')):
        expected = CHECKED_COMPONENTS[name]
        keys(v['components'][label], ('bytes', 'sha256'))
        need(same(v['components'][label], {k: expected[k] for k in ('bytes', 'sha256')}), 'resource-component')
    flags = ('namespaceOwnershipQualified', 'officialHostQualified', 'aggregateResourceQuotaQualified', 'diskQuotaQualified', 'actualResourceSufficiencyQualified', 'outerTimeoutQualified', 'bootstrapConnected', 'actualAcquisitionQualified', 'compilerQualified', 'guestQualified', 'performanceQualified')
    s = v['limits']
    keys(s, ('schema', 'phase', 'closed', 'prepared', 'firstFailure', 'stoppedPhase', 'eligibility', 'policy', 'rows', 'setAttempted', 'getAttempted', 'processLimitsPrepared', *flags))
    need(s['schema'] == 'bw.provisioning-pid1-limits.v1' and s['phase'] == 'prepared' and (s['closed'] is True) and (s['prepared'] is True) and (s['processLimitsPrepared'] is True) and (s['firstFailure'] is None) and (s['stoppedPhase'] is None), 'resource-prepared')
    integer(s['setAttempted'], 5, 5)
    integer(s['getAttempted'], 10, 10)
    need(all((s[k] is False for k in flags)), 'resource-authority')
    keys(s['eligibility'], ('linuxObserved', 'pid1Observed', 'rootCredentialsObserved', 'githubContextObserved'))
    need(all((x is True for x in s['eligibility'].values())), 'resource-eligibility')
    need(type(s['policy']) is list and type(s['rows']) is list and (len(s['policy']) == len(s['rows']) == 5), 'resource-row-count')
    for policy, row, expected in zip(s['policy'], s['rows'], POLICY):
        name, kind, soft, hard = expected
        p = {'name': name, 'resource': kind, 'soft': soft, 'hard': hard}
        keys(policy, p)
        need(same(policy, p), 'resource-policy')
        keys(row, (*p, 'setReturned', 'observations'))
        need(same({k: row[k] for k in p}, p) and row['setReturned'] is True and (type(row['observations']) is list) and (len(row['observations']) == 2), 'resource-row')
        for observed, position in zip(row['observations'], ('immediate', 'final')):
            need(same(observed, {'position': position, 'shapeValid': True, 'soft': soft, 'hard': hard, 'matchesPolicy': True}), 'resource-readback')
    return v

def first(value, producer):
    if value is not None:
        need(type(value) is str and value in ERROR_CODES[producer], 'first-code')

def admission_facts(v, members):
    if v is None:
        return False
    keys(v, ADMISSION_KEYS)
    need(v['schema'] == 'bw.provisioning-envelope-admission-facts.v1', 'admission-schema')
    for k in ('closed', 'ackAttempted', 'ackSent', 'ackMayHaveEscaped', 'historicalHandlesAdmitted'):
        boolean(v[k])
    need(v['currentUsableHandles'] is False, 'no-current-handle-authority')
    first(v['firstFailure'], 'admission')
    integer(v['cleanupRefused'], 0, 256)
    digest(v['resourcePacketSha256'])
    need(v['resourcePacketSha256'] == sha(members['resources.json']), 'admission-resource-hash')
    need(not v['ackSent'] or (v['ackAttempted'] and v['ackMayHaveEscaped'] and v['historicalHandlesAdmitted']), 'admission-ack')
    need(not v['ackMayHaveEscaped'] or v['ackAttempted'], 'admission-ack-attempt')
    rows = v['kernelLimitRows']
    need(type(rows) is list and len(rows) <= 5, 'kernel-row-count')
    matches = []
    for row, expected in zip(rows, POLICY):
        keys(row, ('name', 'resource', 'observedSoft', 'observedHard', 'matchesPolicy'))
        name, kind, soft, hard = expected
        need(row['name'] == name, 'kernel-name')
        integer(row['resource'], kind, kind)
        boolean(row['matchesPolicy'])
        a, b = (row['observedSoft'], row['observedHard'])
        need((a is None) == (b is None), 'kernel-pair')
        if a is not None:
            integer(a, -1)
            integer(b, -1)
        match = a == soft and b == hard and (a is not None)
        need(row['matchesPolicy'] is match, 'kernel-match')
        matches.append(match)
    need(
        not v['ackAttempted']
        or (v['historicalHandlesAdmitted'] and len(rows) == 5 and all(matches)),
        'ack-before-kernel-joins',
    )
    need(v['ackMayHaveEscaped'] is v['ackAttempted'], 'ack-escape-source-join')
    return v['closed'] and v['ackSent'] and v['historicalHandlesAdmitted'] and (v['firstFailure'] is None) and (v['cleanupRefused'] == 0) and (len(rows) == 5) and all(matches)

def lifetime_facts(v, admission, members):
    if v is None:
        return False
    keys(v, LIFETIME_KEYS)
    need(v['schema'] == 'bw.provisioning-envelope-lifetime-facts.v1' and type(v['phase']) is str and (v['phase'] in LIFETIME_PHASES), 'lifetime-schema')
    first(v['firstFailure'], 'lifetime')
    integer(v['cleanupRefused'], 0, 256)
    for k in ('closed', 'complete', 'stdoutEOF', 'stderrEOF', 'outputCapRefused', 'admissionObserved', 'historicalHandlesAdmitted', 'ackAttempted', 'ackSent', 'ackMayHaveEscaped', 'launcherReaped', 'signalAttempted', 'signalReturned', 'cleanupObservationsMissing', 'launchUnobserved'):
        boolean(v[k])
    if v['pid1Terminal'] is not None:
        boolean(v['pid1Terminal'])
    if v['launcherExit'] is not None:
        integer(v['launcherExit'], -255, 255)
    need(not v['launcherReaped'] or v['launcherExit'] is not None, 'reap-exit')
    need(not v['signalReturned'] or v['signalAttempted'], 'signal-attempt')
    need(not v['signalAttempted'] or v['admissionObserved'] and v['historicalHandlesAdmitted'], 'signal-admission-join')
    need(type(v['censusCounts']) is list and len(v['censusCounts']) <= 2, 'census-count')
    for x in v['censusCounts']:
        integer(x, 0, 32768)
    overflow = False
    for label in ('stdout', 'stderr'):
        stored = v[label + 'PrefixBytes']
        observed = v[label + 'ObservedBytes']
        integer(stored, 0, 65536)
        integer(observed, stored, 65537)
        digest(v[label + 'PrefixSha256'])
        need(stored == len(members[label + '.prefix']) and v[label + 'PrefixSha256'] == sha(members[label + '.prefix']), 'raw-prefix-join')
        extra = observed > stored
        if extra:
            need(stored == 65536 and (not v[label + 'EOF']), 'overflow-extent')
            overflow |= extra
    need(v['outputCapRefused'] is overflow, 'overflow-flag')
    need(not v['complete'] or not overflow, 'complete-overflow')
    for lifetime_key, admission_key in (('historicalHandlesAdmitted', 'historicalHandlesAdmitted'), ('ackAttempted', 'ackAttempted'), ('ackSent', 'ackSent'), ('ackMayHaveEscaped', 'ackMayHaveEscaped')):
        need(v[lifetime_key] is admission[admission_key], 'admission-lifetime-join')
    positive = v['phase'] == 'observed' and v['closed'] and v['complete'] and (v['firstFailure'] is None) and (v['cleanupRefused'] == 0) and v['stdoutEOF'] and v['stderrEOF'] and (not overflow) and v['admissionObserved'] and v['historicalHandlesAdmitted'] and v['ackSent'] and (v['pid1Terminal'] is True) and v['launcherReaped'] and (v['launcherExit'] == 0) and (v['censusCounts'] == [0, 0]) and (not v['signalAttempted']) and (not v['cleanupObservationsMissing']) and (not v['launchUnobserved'])
    need(not v['complete'] or positive, 'historical-complete-joins')
    return positive

def audit(raw, declared_sha256=None):
    need(type(raw) is bytes and 22 <= len(raw) <= ZIP_CAP, 'zip-cap')
    if declared_sha256 is not None:
        digest(declared_sha256)
        need(sha(raw) == declared_sha256, 'declared-zip-digest')
    members = zip_members(raw)
    need(set(MANDATORY) <= set(members), 'mandatory-members')
    v = load(members['envelope.json'], CAPS['envelope.json'])
    keys(v, ENV_KEYS)
    need(v['schema'] == 'bw.provisioning-observation-envelope.v1' and type(v['stage']) is str and (v['stage'] in STAGES), 'envelope-schema')
    boolean(v['completeReported'])
    need(set(members) <= set(STAGES[v['stage']]), 'stage-roles')
    keys(v['members'], set(members) - {'envelope.json'})
    for name, row in v['members'].items():
        keys(row, ('bytes', 'sha256'))
        integer(row['bytes'], 0, CAPS[name])
        digest(row['sha256'])
        need(row['bytes'] == len(members[name]) and row['sha256'] == sha(members[name]), 'member-bytes')
    keys(v['authority'], AUTHORITY)
    need(all((x is False for x in v['authority'].values())), 'envelope-authority')
    context = v['context']
    keys(context, CONTEXT_KEYS)
    need(context['repository'] == 'CrispStrobe/bw-board', 'context-repository')
    if context['sourceHead'] is not None:
        digest(context['sourceHead'], 40)
    if context['declaredApprovalSha256'] is not None:
        digest(context['declaredApprovalSha256'])
    for k in ('declaredRun', 'declaredJob', 'declaredArtifact'):
        if context[k] is not None:
            integer(context[k], 1, 2 ** 63 - 1)
    failure = v['failure']
    keys(failure, FAILURE_KEYS)
    boolean(failure['cleanupUnknown'])
    for k in ('primary', 'secondary'):
        row = failure[k]
        if row is not None:
            keys(row, ERROR_KEYS)
            need(type(row['producer']) is str and row['producer'] in ERROR_CODES and (type(row['code']) is str) and (row['code'] in ERROR_CODES[row['producer']]) and (type(row['exceptionType']) is str) and (row['exceptionType'] in ERROR_TYPES), 'error-projection')
    status = members['status.txt']
    need(type(status) is bytes, 'status-type')
    match = re.fullmatch(b'phase=([a-z-]+)\\nexit=([0-9]{1,3})\\n', status)
    need(match is not None, 'status-projection')
    exit_code = int(match[2])
    need(match[1].decode('ascii') == v['stage'] and exit_code <= 255 and ((exit_code == 0) == (v['stage'] == 'complete')), 'status-stage')
    need(v['completeReported'] is (v['stage'] == 'complete'), 'complete-stage')
    has_facts = v['admission'] is not None or v['lifetime'] is not None
    need(not has_facts or 'resources.json' in members, 'fact-resource-dependency')
    need('resources.json' not in members or all((n in members for n in ('source-before.json', 'descriptor.json', 'role-table.json'))), 'resource-source-dependency')
    table, before, after = source_group(members, context, 'resources.json' in members)
    projection = v['inheritedProjection']
    if before is None:
        need(projection is None, 'projection-absent')
    else:
        keys(projection, ('kind', 'roleCount', 'beforeSha256', 'afterSha256'))
        need(projection['kind'] == 'INHERITED14_DERIVED_FROM_REPORTED_FULL_POSITIONS', 'projection-kind')
        integer(projection['roleCount'], 14, 14)
        for observed, position, key in ((before, 'before', 'beforeSha256'), (after, 'after', 'afterSha256')):
            expected = None if observed is None else sha(canonical({'schema': 'bw.full-tree-actual-source.v1', 'phase': position, 'head': observed['head'], 'roleCount': 14, 'roles': {n: {k: observed['roles'][n][k] for k in ('bytes', 'sha256')} for n in HELD14}}))
            need(projection[key] == expected, 'projection-hash')
    if 'resources.json' in members:
        resource_packet(members['resources.json'])
    admission_ok = admission_facts(v['admission'], members)
    need(v['lifetime'] is None or v['admission'] is not None, 'lifetime-admission-dependency')
    lifetime_ok = lifetime_facts(v['lifetime'], v['admission'], members)
    primary = failure['primary']
    if primary is not None and primary['producer'] in ('admission', 'lifetime'):
        frame = v[primary['producer']]
        if frame is not None:
            need(frame['firstFailure'] == primary['code'], 'original-first-code-join')
    consistent = set(members) == set(CAPS) and before is not None and (after is not None) and admission_ok and lifetime_ok and (primary is None) and (failure['secondary'] is None) and (not failure['cleanupUnknown'])
    need(not v['completeReported'] or consistent, 'completion-consistency')
    return {'schema': 'bw.provisioning-observation-reader-result.v1', 'boundary': 'FINITE_REPORTED_SOURCE_RESOURCE_LIFETIME_AND_RAW_PREFIX_CONSISTENCY_ONLY', 'diagnosticValid': True, 'completeReportedConsistency': v['completeReported'] and consistent, 'memberCount': len(members), 'zipSha256': sha(raw), 'declaredDigestConsistent': declared_sha256 is not None, 'reportedSourceRoleCount': 0 if table is None else len(table['roles']), 'checkedInheritedRoles': 0 if before is None else 14, 'checkedCurrentComponents': 0 if table is None or 'resources.json' not in members else len(CHECKED_COMPONENTS), 'stdoutPrefixBytes': len(members['stdout.prefix']), 'stderrPrefixBytes': len(members['stderr.prefix']), **{k: False for k in AUTHORITY}}
