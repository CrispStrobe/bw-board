"""Independent, bytes-only reader for the disabled QEMU setup inventory.

``audit`` performs no filesystem, process, Git or network operation.  Its
expectation is externally selected data, not authentication of GitHub metadata.
"""

import base64
import hashlib
import json
import re
import stat
import zlib


PREFIX = 'bw.i80386-qemu-setup-inventory-'
REPOSITORY = 'CrispStrobe/bw-board'
SOURCE_PATHS = (
    'scripts/i80386-qemu-setup-inventory/run.py',
    'scripts/i80386-qemu-setup-inventory/reader.py',
    'scripts/i80386-qemu-setup-inventory/controls.py',
    'scripts/i80386-qemu-setup-inventory/README.md',
    '.github/workflows/i80386-qemu-setup-inventory.yml',
)
FILE_PATHS = (
    '/usr/lib/os-release', '/etc/os-release', '/var/lib/dpkg/status',
    '/bin', '/bin/sh', '/usr/bin/sh', '/usr/bin/dash',
    '/usr/bin/deb-systemd-helper', '/usr/bin/deb-systemd-invoke',
    '/usr/bin/dpkg-maintscript-helper', '/usr/bin/systemctl',
    '/usr/sbin/invoke-rc.d', '/usr/sbin/update-rc.d',
    '/usr/sbin/policy-rc.d',
    '/var/lib/dpkg/info/dpkg.list',
    '/var/lib/dpkg/info/init-system-helpers.list',
    '/var/lib/dpkg/info/systemd.list',
    '/var/lib/dpkg/info/dash.list',
    '/run/systemd/system',
    '/usr/lib/systemd/system/qemu-kvm.service',
    '/lib/systemd/system/qemu-kvm.service', '/etc/init.d/qemu-kvm',
)
TEXT_FILES = frozenset(('/usr/lib/os-release', '/etc/os-release',
    '/usr/bin/deb-systemd-helper', '/usr/bin/deb-systemd-invoke',
    '/usr/bin/dpkg-maintscript-helper', '/usr/sbin/invoke-rc.d',
    '/usr/sbin/update-rc.d', '/usr/sbin/policy-rc.d',
    '/var/lib/dpkg/info/dpkg.list',
    '/var/lib/dpkg/info/init-system-helpers.list',
    '/var/lib/dpkg/info/systemd.list',
    '/var/lib/dpkg/info/dash.list',
    '/usr/lib/systemd/system/qemu-kvm.service',
    '/lib/systemd/system/qemu-kvm.service', '/etc/init.d/qemu-kvm'))
DEPENDENCIES = tuple(sorted(('acl ipxe-qemu libaio1t64 libasound2t64 libbpf1 '
    'libbrlapi0.8 libc6 libcacard0 libcap-ng0 libfdt1 libfuse3-3 '
    'libglib2.0-0t64 libgmp10 libgnutls30t64 libhogweed6t64 libibverbs1 '
    'libjpeg8 libncursesw6 libnettle8t64 libnuma1 libpixman-1-0 libpmem1 '
    'libpng16-16t64 librdmacm1t64 libsasl2-2 libseccomp2 libslirp0 '
    'libtinfo6 libudev1 liburing2 libusb-1.0-0 libusbredirparser1t64 '
    'libzstd1 qemu-system-common qemu-system-data seabios zlib1g').split()))
SELECTED = tuple(sorted((*DEPENDENCIES, 'qemu-system-x86')))
CONTROL_HASHES = {
    'qemu-system-x86': '4075ae4d677d10506b036fd0a7736ad771ba13b179cd02f389ec60615f390e71',
    'qemu-system-common': '90475094295b1c50fbf48f0ff189824e34e92effc7334af5239e49eedc7fc8d5',
}
LIMITS = {'cpuSeconds': 10, 'wallSeconds': 30, 'fileBytes': 8388608,
          'hashBytes': 67108864, 'outputBytes': 2097152, 'statusRecords': 5000}
FLAGS = ('setupApproved', 'runtimeCandidate', 'actualRunApproved',
         'toolExecuted', 'guestExecuted', 'platformMutated')
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
DECIMAL = re.compile(r'[1-9][0-9]{0,19}\Z')


class Refusal(ValueError):
    pass


def need(condition, reason):
    if not condition:
        raise Refusal(reason)


def keys(value, names, reason='shape'):
    need(type(value) is dict and set(value) == set(names), reason)


def integer(value, maximum=2**63 - 1):
    return type(value) is int and 0 <= value <= maximum


def digest(value):
    return type(value) is str and HEX64.fullmatch(value) is not None


def positive_id(value):
    return type(value) is str and DECIMAL.fullmatch(value) is not None and int(value) <= 2**63 - 1


def _json(raw, maximum, reason, trailing_newline=False):
    need(type(raw) is bytes and len(raw) <= maximum, reason + '-cap')

    def pairs(items):
        result = {}
        for name, value in items:
            need(name not in result, reason + '-duplicate')
            result[name] = value
        return result

    def bad(_):
        raise Refusal(reason + '-number')

    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                           parse_float=bad, parse_constant=bad)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise Refusal(reason + '-parse') from error
    canonical = json.dumps(value, sort_keys=True, separators=(',', ':'),
                           ensure_ascii=False, allow_nan=False).encode('utf-8')
    need(len(canonical) <= maximum - int(trailing_newline), reason + '-body-cap')
    need(raw == canonical or (trailing_newline and raw == canonical + b'\n'),
         reason + '-canonical')
    return value


def _source(value):
    keys(value, ('head', 'tree', 'files'), 'source-shape')
    need(type(value['head']) is str and HEX40.fullmatch(value['head']) and
         type(value['tree']) is str and HEX40.fullmatch(value['tree']), 'source-id')
    keys(value['files'], SOURCE_PATHS, 'source-files')
    need(all(digest(v) for v in value['files'].values()), 'source-hashes')


def _context(value):
    keys(value, ('eventName', 'repository', 'job', 'runAttempt',
                 'workflowSha', 'workflowRef', 'actor'), 'context-shape')
    need(value['eventName'] == 'workflow_dispatch' and
         value['repository'] == REPOSITORY and value['job'] == 'qemu-setup-inventory',
         'context-fixed')
    need(value['runAttempt'] == '1', 'context-attempt')
    need(type(value['workflowSha']) is str and HEX40.fullmatch(value['workflowSha']),
         'context-workflow')
    need(all(type(value[n]) is str and 1 <= len(value[n]) <= 256
             for n in ('workflowRef', 'actor')), 'context-names')


def _request(value):
    keys(value, ('schema', 'repository', 'source', 'selection', 'context', 'limits'),
         'request-shape')
    need(value['schema'] == PREFIX + 'request.v1' and
         value['repository'] == REPOSITORY, 'request-version')
    _source(value['source'])
    selection = value['selection']
    keys(selection, ('packageVersion', 'architecture', 'controlSha256',
                     'directDependencyNames'), 'selection-shape')
    need(selection['packageVersion'] == '1:8.2.2+ds-0ubuntu1.18' and
         selection['architecture'] == 'amd64' and
         selection['controlSha256'] == CONTROL_HASHES and
         selection['directDependencyNames'] == list(DEPENDENCIES), 'selection-fixed')
    _context(value['context'])
    keys(value['limits'], LIMITS, 'limits-shape')
    need(all(type(value['limits'][name]) is int and value['limits'][name] == fixed
             for name, fixed in LIMITS.items()), 'limits-fixed')


def _stat(value):
    names = ('dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs')
    keys(value, names, 'stat-shape')
    need(all(integer(value[n]) for n in names), 'stat-integer')


def _file(value, path):
    need(type(value) is dict and type(value.get('kind')) is str, 'file-shape')
    kind = value['kind']
    if kind == 'regular':
        keys(value, ('kind', 'namedBefore', 'heldBefore', 'heldAfter',
                     'namedAfter', 'closed', 'sha256', 'text'), 'regular-shape')
        for name in ('namedBefore', 'heldBefore', 'heldAfter', 'namedAfter'):
            _stat(value[name])
            need(stat.S_ISREG(value[name]['mode']), 'regular-mode')
        need(value['namedBefore'] == value['heldBefore'] == value['heldAfter'] ==
             value['namedAfter'], 'regular-drift')
        need(value['closed'] is True and digest(value['sha256']) and
             value['namedBefore']['size'] <= LIMITS['fileBytes'] and
             value['namedBefore']['nlink'] == 1, 'regular-read')
        body = value['text']
        need(body is None or type(body) is str, 'regular-text')
        need(body is None or path in TEXT_FILES, 'text-path')
        if body is not None:
            encoded = body.encode('utf-8')
            need(len(encoded) <= 131072 and
                 len(encoded) == value['heldBefore']['size'] and
                 hashlib.sha256(encoded).hexdigest() == value['sha256'], 'text-hash')
        return
    if kind == 'alias':
        keys(value, ('kind', 'target', 'namedBefore', 'namedAfter'), 'alias-shape')
        _stat(value['namedBefore']); _stat(value['namedAfter'])
        need(value['namedBefore'] == value['namedAfter'] and
             stat.S_ISLNK(value['namedBefore']['mode']) and
             type(value['target']) is str and
             len(value['target'].encode('utf-8')) <= 512,
             'alias-witness')
        return
    if kind == 'directory':
        keys(value, ('kind', 'namedBefore', 'namedAfter'), 'directory-shape')
        _stat(value['namedBefore']); _stat(value['namedAfter'])
        need(value['namedBefore'] == value['namedAfter'] and
             stat.S_ISDIR(value['namedBefore']['mode']), 'directory-witness')
        return
    if kind == 'absent':
        keys(value, ('kind',), 'absent-shape')
        return
    if kind == 'error':
        keys(value, ('kind', 'code', 'partial'), 'file-error-shape')
        need(type(value['code']) is str and 1 <= len(value['code']) <= 128,
             'file-error-code')
        partial = value['partial']
        names = ('namedBefore', 'heldBefore', 'heldAfter', 'namedAfter',
                 'bytesRead', 'prefixSha256', 'closeAttempted', 'closed')
        keys(partial, names, 'partial-shape')
        for name in names[:4]:
            if partial[name] is not None:
                _stat(partial[name])
        need(integer(partial['bytesRead'], LIMITS['fileBytes']) and
             digest(partial['prefixSha256']) and
             type(partial['closeAttempted']) is bool and
             type(partial['closed']) is bool, 'partial-fields')
        need(not partial['closed'] or partial['closeAttempted'], 'partial-close')
        need(partial['heldBefore'] is None or partial['namedBefore'] is not None,
             'partial-open-order')
        need(partial['heldAfter'] is None or partial['heldBefore'] is not None,
             'partial-read-order')
        if partial['namedBefore'] is not None and stat.S_ISREG(partial['namedBefore']['mode']):
            need(partial['namedAfter'] is None or partial['heldAfter'] is not None,
                 'partial-readback-order')
        need(partial['bytesRead'] == 0 or partial['heldBefore'] is not None,
             'partial-bytes-order')
        if partial['heldBefore'] is not None:
            need(partial['bytesRead'] <= partial['heldBefore']['size'],
                 'partial-bytes-extent')
        if partial['bytesRead'] == 0:
            need(partial['prefixSha256'] == hashlib.sha256(b'').hexdigest(),
                 'partial-empty-digest')
        return
    raise Refusal('file-kind')


def _paragraphs(raw):
    need(len(raw) <= LIMITS['fileBytes'], 'status-cap')
    try:
        body = raw.decode('utf-8')
    except UnicodeError as error:
        raise Refusal('status-utf8') from error
    records = {}
    for paragraph in body.split('\n\n'):
        if not paragraph:
            continue
        fields = {}
        last = None
        for line in paragraph.splitlines():
            if line.startswith((' ', '\t')):
                need(last is not None, 'status-continuation')
                fields[last] += '\n' + line
                continue
            need(':' in line, 'status-line')
            name, text = line.split(':', 1)
            need(re.fullmatch(r'[A-Za-z][A-Za-z0-9-]*', name) and
                 name not in fields, 'status-field')
            fields[name] = text.lstrip(' ')
            last = name
        package = fields.get('Package')
        architecture = fields.get('Architecture')
        need(type(package) is str and re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', package) and
             type(architecture) is str and re.fullmatch(r'[a-z0-9][a-z0-9-]*', architecture),
             'status-identity')
        identity = (package, architecture)
        need(identity not in records, 'status-duplicate-package')
        records[identity] = fields
        need(len(records) <= LIMITS['statusRecords'], 'status-records')
    return records


def _status(value, files):
    keys(value, ('encoding', 'rawBytes', 'sha256', 'packed', 'selected'), 'status-shape')
    need(value['encoding'] == 'zlib+base64' and
         integer(value['rawBytes'], LIMITS['fileBytes']) and digest(value['sha256']) and
         type(value['packed']) is str and len(value['packed']) <= LIMITS['outputBytes'],
         'status-header')
    try:
        packed = base64.b64decode(value['packed'], validate=True)
        inflater = zlib.decompressobj()
        raw = inflater.decompress(packed, LIMITS['fileBytes'] + 1)
        need(inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail,
             'status-zlib-framing')
    except (ValueError, zlib.error) as error:
        raise Refusal('status-compression') from error
    need(len(raw) == value['rawBytes'] and
         hashlib.sha256(raw).hexdigest() == value['sha256'], 'status-digest')
    witness = files.get('/var/lib/dpkg/status')
    need(witness is not None and witness['kind'] == 'regular' and
         witness['sha256'] == value['sha256'] and
         witness['heldBefore']['size'] == len(raw), 'status-file-join')
    records = _paragraphs(raw)
    keys(value['selected'], SELECTED, 'status-selected-shape')
    for name, row in value['selected'].items():
        need(type(row) is list and len(row) <= LIMITS['statusRecords'],
             'status-selected-list')
        matches = sorted((fields for (package, _), fields in records.items()
                          if package == name), key=lambda fields: fields['Architecture'])
        expected = [{'package': fields['Package'],
                     'architecture': fields['Architecture'],
                     'version': fields.get('Version'), 'status': fields.get('Status'),
                     'depends': fields.get('Depends'),
                     'preDepends': fields.get('Pre-Depends'),
                     'recommends': fields.get('Recommends'),
                     'provides': fields.get('Provides')} for fields in matches]
        need(row == expected, 'status-projection')
    return len(records)


def _error(value):
    keys(value, ('stage', 'code'), 'error-shape')
    need(all(type(value[n]) is str and 1 <= len(value[n]) <= 128
             for n in ('stage', 'code')), 'error-fields')


def audit(request_bytes, original_bytes, expectation_bytes):
    """Grade retained bytes, with no producer import or operational authority."""
    request = _json(request_bytes, 65536, 'request')
    original = _json(original_bytes, LIMITS['outputBytes'], 'original', True)
    expectation = _json(expectation_bytes, 65536, 'expectation')
    _request(request)
    keys(original, ('schema', 'requestSha256', 'source', 'context', 'image',
                    'files', 'status', 'flags', 'failure', 'secondary'), 'original-shape')
    need(original['schema'] == PREFIX + 'original.v1' and
         original['requestSha256'] == hashlib.sha256(request_bytes).hexdigest() and
         original['source'] == request['source'], 'original-binding')
    keys(expectation, ('schema', 'requestSha256', 'source', 'official'),
         'expectation-shape')
    need(expectation['schema'] == PREFIX + 'expectation.v1' and
         expectation['requestSha256'] == original['requestSha256'] and
         expectation['source'] == request['source'], 'expectation-binding')
    context = original['context']
    keys(context, (*request['context'].keys(), 'runId', 'runnerOS', 'runnerArch'),
         'original-context-shape')
    need(all(context[n] == v for n, v in request['context'].items()),
         'original-context')
    need(positive_id(context['runId']), 'original-run-id')
    need(context['runnerOS'] == 'Linux' and context['runnerArch'] == 'X64',
         'runner-context')
    official = expectation['official']
    keys(official, ('repository', 'head', 'tree', 'workflowSha', 'workflowRef',
                    'runId', 'runAttempt', 'jobId', 'jobName', 'eventName',
                    'actor', 'conclusion'), 'official-shape')
    for key, value in (('repository', REPOSITORY), ('head', request['source']['head']),
                       ('tree', request['source']['tree']),
                       ('workflowSha', context['workflowSha']),
                       ('workflowRef', context['workflowRef']),
                       ('runId', context['runId']), ('runAttempt', context['runAttempt']),
                       ('jobName', context['job']), ('eventName', context['eventName']),
                       ('actor', context['actor'])):
        need(official[key] == value, 'official-' + key)
    need(positive_id(official['jobId']) and
         official['conclusion'] in ('success', 'failure', 'cancelled', 'timed_out'),
         'official-job')
    image = original['image']
    keys(image, ('imageOS', 'imageVersion', 'osRelease', 'etcOsRelease'), 'image-shape')
    need(all(image[n] is None or (type(image[n]) is str and
             len(image[n].encode('utf-8')) <= 256 and '\x00' not in image[n] and
             '\n' not in image[n]) for n in ('imageOS', 'imageVersion')),
         'image-field')
    need(all(image[n] is None or type(image[n]) is str
             for n in ('osRelease', 'etcOsRelease')), 'image-file-field')
    need(image['osRelease'] in (None, '/usr/lib/os-release') and
         image['etcOsRelease'] in (None, '/etc/os-release'), 'image-file-key')
    files = original['files']
    need(type(files) is dict and set(files) <= set(FILE_PATHS), 'files-paths')
    for path, row in files.items():
        _file(row, path)
    need(all(row['text'] is not None or original['failure'] is not None
             for path, row in files.items()
             if path in TEXT_FILES and row['kind'] == 'regular'),
         'unexplained-text-omission')
    for field, path in (('osRelease', '/usr/lib/os-release'),
                        ('etcOsRelease', '/etc/os-release')):
        if image[field] is not None and path in files and files[path]['kind'] == 'regular':
            need(files[path]['text'] is not None or original['failure'] is not None,
                 'image-file-observation')
    if original['status'] is not None:
        record_count = _status(original['status'], files)
    else:
        record_count = None
    keys(original['flags'], FLAGS, 'flags-shape')
    need(all(original['flags'][flag] is False for flag in FLAGS), 'authority-flags')
    failure = original['failure']
    if failure is not None:
        _error(failure)
    need(not any(row['kind'] == 'error' for row in files.values()) or failure is not None,
         'file-error-without-primary')
    need(all(row['code'] == failure['code'] for row in files.values()
             if row['kind'] == 'error'), 'file-error-primary-join')
    secondary = original['secondary']
    need(type(secondary) is list and len(secondary) <= 16, 'secondary-cap')
    for item in secondary:
        _error(item)
    need(not secondary or failure is not None, 'secondary-without-primary')
    for row in files.values():
        if row['kind'] == 'error' and row['partial']['closeAttempted'] and not row['partial']['closed']:
            need((failure is not None and failure['code'].startswith('close-')) or
                 any(item['code'].startswith('close-') for item in secondary),
                 'unreported-close-error')
    need(sum(row['heldBefore']['size'] for row in files.values()
             if row['kind'] == 'regular') <= LIMITS['hashBytes'], 'aggregate-file-cap')
    need(record_count is not None or failure is not None, 'status-unexplained-absence')
    complete = (failure is None and not secondary and record_count is not None and
                len(files) == len(FILE_PATHS) and
                image['imageOS'] is not None and image['imageVersion'] is not None and
                official['conclusion'] == 'success' and
                all(row['kind'] not in ('error',) for row in files.values()) and
                files.get('/usr/lib/os-release', {}).get('kind') == 'regular' and
                files['/usr/lib/os-release']['text'] is not None and
                files.get('/etc/os-release', {}).get('kind') in ('regular', 'alias') and
                (files['/etc/os-release']['kind'] == 'alias' or
                 files['/etc/os-release']['text'] is not None))
    return {'schema': PREFIX + 'reader-verdict.v1',
            'reportedComplete': complete, 'statusRecordCount': record_count,
            'observedFileCount': len(files), 'observedFailure': failure,
            'officialExpectationConsistent': True,
            'officialJobAuthenticated': False,
            'imageFieldsAuthenticated': False,
            'immutableImageIdentityEstablished': False,
            **{flag: False for flag in FLAGS}}
