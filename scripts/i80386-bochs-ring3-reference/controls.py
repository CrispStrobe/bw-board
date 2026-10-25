#!/usr/bin/env python3
"""Authored pure controls. All compiler, guest, process and kernel edges mocked."""
import base64
import copy
import contextlib
import importlib.util
import itertools
import hashlib
import gzip
import io
import tarfile
import zlib
import json
import os
import posixpath
from pathlib import Path
import stat
import struct
import re
import pathlib
import types
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bochs_reference_producer_controls', HERE / 'run.py')
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)


def synthetic_elf():
    # A tiny authored ELF structure, never an executed/real compiler binary.
    raw = bytearray(120)
    raw[:16] = b'\x7fELF\x02\x01\x01' + bytes(9)
    struct.pack_into('<HHI', raw, 16, 2, 62, 1)
    struct.pack_into('<Q', raw, 32, 64)
    struct.pack_into('<HHH', raw, 52, 64, 56, 1)
    struct.pack_into('<IIQQQQQQ', raw, 64, 1, 5, 0, 0x400000, 0, len(raw), len(raw), 4096)
    return bytes(raw)


def synthetic_stat(index, size, mode=0o100755):
    return {'dev': 1, 'ino': index, 'mode': mode, 'uid': 0, 'gid': 0, 'nlink': 1,
            'size': size, 'mtimeNs': 1, 'ctimeNs': 1}


def synthetic_request(route='toolchain'):
    source = {'head': '1' * 40, 'tree': '2' * 40, 'files': {
        path: {'mode': '100644', 'gitBlob': 'a' * 40, 'bytes': 20, 'sha256': 'b' * 64}
        for path in producer.SOURCE_PATHS}}
    request = {'schema': 'bw.bochs-ring3.' + route + '-request.v1',
               'repository': producer.REPOSITORY, 'pullRequest': 700,
               'source': source, 'policySha256': 'c' * 64, 'limits': copy.deepcopy(producer.LIMITS[route])}
    raw = producer.canonical(request)
    job, label, prefix = producer.ROUTES[route]
    env = {'GITHUB_REPOSITORY': producer.REPOSITORY, 'GITHUB_ACTOR': producer.OWNER,
           'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_RUN_ATTEMPT': '1',
           'GITHUB_RUN_ID': '123456', 'GITHUB_JOB': job, 'BW_EXPECTED_HEAD': source['head'],
           'GITHUB_WORKFLOW_SHA': '3' * 40,
           'GITHUB_WORKFLOW_REF': producer.REPOSITORY + '/' + producer.WORKFLOW + '@refs/pull/700/merge',
           prefix + '_SHA256': producer.sha256(raw),
           prefix + '_B64': base64.b64encode(raw).decode('ascii')}
    event = {'action': 'labeled', 'label': {'name': label},
             'sender': {'login': producer.OWNER}, 'number': 700,
             'pull_request': {'number': 700, 'state': 'open', 'draft': False,
                 'body': '<!-- ' + prefix + '_SHA256=' + producer.sha256(raw) + ' -->\nSynthetic fixture.\n',
                 'head': {'sha': source['head'], 'repo': {'full_name': producer.REPOSITORY, 'fork': False}},
                 'base': {'ref': 'master', 'repo': {'full_name': producer.REPOSITORY}}}}
    return request, raw, producer.canonical(event), env


def synthetic_node_stage(route='toolchain', *, full_hash=False, checked=False):
    env = {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'}
    value = producer.NodeStageCopy(route, env, (1001, 1000)).facts
    path = Path(value['stagePath']).parent
    def metadata(index, size, mode, uid=0, gid=0):
        return [1, index, mode, uid, gid, 1, size, 1, 1]
    source = metadata(10, producer.NODE_BYTES, 0o100777, 1001, 1000)
    value.update({'created': [str(path), str(path / 'node'), str(path / 'stage.json')],
        'sourceBefore': source, 'sourceAfter': source.copy(), 'sourceNamedAfter': source.copy(),
        'sourceBytesRead': producer.NODE_BYTES, 'bytesCopied': producer.NODE_BYTES,
        'copiedSha256': producer.NODE_SHA256, 'readbackBytes': producer.NODE_BYTES,
        'readbackSha256': producer.NODE_SHA256, 'elfReadBytes': 120,
        'elf': producer.elf_facts(synthetic_elf()),
        'fileInitial': metadata(20, 0, 0o100600),
        'fileBeforePublication': metadata(20, producer.NODE_BYTES, 0o100600),
        'file': metadata(20, producer.NODE_BYTES, 0o100555),
        'fileNamed': metadata(20, producer.NODE_BYTES, 0o100555),
        'directoryInitial': metadata(30, 0, 0o40700),
        'directoryBeforePublication': metadata(30, 0, 0o40700),
        'directory': metadata(30, 0, 0o40555), 'directoryNamed': metadata(30, 0, 0o40555),
        'filePublicationAttempted': True, 'directoryPublicationAttempted': True,
        'filePublished': True, 'directoryPublished': True})
    for index, parent in enumerate(('/', '/run')):
        item = metadata(index + 1, 0, 0o40755)
        value['parents'][parent] = {key: item.copy() for key in ('before', 'namedBefore', 'after', 'namedAfter')}
    raw = producer.canonical({'schema': 'bw.bochs-ring3.node-installation.v1',
        'sourcePath': producer.NODE_PATH, 'stagePath': str(path / 'node'),
        'bytes': producer.NODE_BYTES, 'sha256': producer.NODE_SHA256,
        'uid': 0, 'gid': 0, 'mode': 0o100555})
    value['record'] = {'bytes': len(raw), 'sha256': producer.sha256(raw),
                       'metadata': metadata(40, len(raw), 0o100444), 'text': raw.decode()}
    if checked:
        value['checkedAfter'] = {'hashRead': full_hash,
            'bytesRead': producer.NODE_BYTES if full_hash else 0,
            'sha256': producer.NODE_SHA256 if full_hash else None,
            'before': value['file'].copy(), 'after': value['file'].copy(),
            'named': value['file'].copy(), 'elf': value['elf'] if full_hash else None,
            'elfReadBytes': 120 if full_hash else 0}
    return value


class InventoryEdges:
    """Manufactured edges drive real collectors; no verdict callback exists."""
    def __init__(self):
        self.calls = []
        self.notice_bytes = {path: ('Synthetic retained notice for ' + path + '\n').encode()
                             for path in producer.NOTICE_PATHS}
        self.files = {path: synthetic_elf() for path in producer.TOOL_PATHS.values()}
        self.files.update(self.notice_bytes)
        self.indexes = {path: index + 10 for index, path in enumerate(sorted(self.files))}
    def read(self, path, cap, *, minimum=0, owner=0):
        self.calls.append(('read', path))
        raw = (b'Package: authored-fixture\nStatus: install ok installed\nVersion: 1\nArchitecture: amd64\n'
               if path == '/var/lib/dpkg/status' else self.files[path])
        info = synthetic_stat(self.indexes.get(path, 5), len(raw),
                              0o100644 if path in self.notice_bytes or path == '/var/lib/dpkg/status' else 0o100755)
        producer.need(minimum <= len(raw) <= cap and owner == 0, 'mock read uses genuine role policy')
        return raw, {'bytes': len(raw), 'sha256': producer.sha256(raw), 'before': info,
                     'after': copy.deepcopy(info), 'named': copy.deepcopy(info),
                     'complete': True, 'elf': None}
    def toolchain(self):
        self.calls.append(('toolchain',))
        return producer.observe_toolchain(read=self.read, resolve=lambda p, _a, _d: p)
    def elf_metadata(self, graph):
        raw = synthetic_elf()
        node = producer.sparse_elf_from_reader(producer.NODE_BYTES,
            lambda offset, count: raw[offset:offset + count], producer.NODE_SHA256)
        files = {producer.NODE_PATH: node}
        for path in producer.runtime_elf_candidates(graph):
            files[path] = producer.sparse_elf(self.files[path])
        return {'schema': 'bw.bochs-ring3.runtime-elf-metadata.v1', 'files': files,
            'rawBytes': sum(row['bytes'] for value in files.values() for row in value['ranges'])}
    def node_stage(self):
        self.calls.append(('node-stage',))
        return synthetic_node_stage()
    def node_after(self, *, full_hash):
        self.calls.append(('node-after', full_hash))
        return synthetic_node_stage(full_hash=full_hash, checked=True)
    def notices(self):
        return {path: (path, raw) for path, raw in self.notice_bytes.items()}
    def source(self, selected, env):
        self.calls.append(('source',))
        return {**copy.deepcopy(selected), 'workflowCommit': env['GITHUB_WORKFLOW_SHA'],
                'workflowTree': selected['tree'],
                'workflowFileSha256': selected['files'][producer.WORKFLOW]['sha256']}
    def resources(self, route):
        self.calls.append(('resources', route))
        unit = 'bw-bochs-' + route + '-v1-123456-1.service'
        path = '/sys/fs/cgroup/system.slice/' + unit
        limits = producer.LIMITS[route]
        fields = ['S'] + ['0'] * 49
        fields[1], fields[19] = '1', '1000'
        return {'schema': 'bw.bochs-ring3.resources.v1', 'unit': unit, 'pid': 100,
                'uid': 0, 'gid': 0, 'cgroupPath': path,
                'directory': synthetic_stat(2, 0, 0o40755),
                'files': {'cpu.max': '100000 100000\n', 'memory.max': str(limits['memoryBytes']) + '\n',
                          'memory.swap.max': '0\n', 'pids.max': str(limits['tasks']) + '\n',
                          'cgroup.procs': '100\n', 'cgroup.events': 'populated 1\nfrozen 0\n',
                          'cgroup.stat': 'nr_descendants 0\nnr_dying_descendants 0\n',
                          'cpu.stat': 'usage_usec 0\nuser_usec 0\nsystem_usec 0\n'},
                'procCgroup': '0::/system.slice/' + unit + '\n',
                'procStat': '100 (python3) ' + ' '.join(fields) + '\n',
                'procStatus': 'Name:\tpython3\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\nThreads:\t1\n'}
    def observer(self, value):
        return producer.observer_facts(value, {'BW_EXPECTED_HEAD': '1' * 40},
                                      pid=100, uid=0, gid=0, started_ns=1, ended_ns=2)
    def cleanup(self, inner, *, outer=None):
        kernel = SimpleNamespace(_directory=mock.Mock(side_effect=FileNotFoundError(2, 'authored absent unit')))
        return producer.cleanup_owned_cgroups('toolchain', {'GITHUB_RUN_ID': '123456',
            'GITHUB_RUN_ATTEMPT': '1'}, inner, kernel, outer_base=outer, clock=iter((1, 2, 3)).__next__)
    def unit(self, unit):
        self.calls.append(('unit', unit))
        return {'path': '/sys/fs/cgroup/system.slice/' + unit, 'exists': False,
                'errno': 2, 'identity': None, 'files': {}, 'children': []}


def inventory_sample():
    request, raw, event, env = synthetic_request()
    edges = InventoryEdges()
    value, roles = producer.collect_toolchain(raw, event, env, edges)
    outside, roles = producer.finalize_original('toolchain', raw, event, env, value,
                                               roles, 0, 0, edges)
    return request, raw, event, env, edges, value, outside, roles


class CoreControls(unittest.TestCase):
    def test_source_manager_receipt_normal_unknown_and_mixed(self):
        unit = 'bw-bochs-toolchain-v1-123456-1.service'
        receipt = ('Running as unit: ' + unit + '; invocation ID: ' + 'a' * 32 + '\n' +
                   'Finished with result: success\nMain processes terminated with: code=exited/status=0\n').encode()
        observed = producer.service_receipt(b'', receipt, 0, unit)
        self.assertEqual(observed['serviceExitCode'], 0)
        self.assertIsNone(observed['firstFailure'])
        for raw, code in ((b'', 0), (receipt, None), (receipt, 1), (receipt + receipt, 0),
                          (receipt.replace(b'success', b'exit-code'), 0),
                          (receipt.replace(unit.encode(), b'other.service'), 0)):
            result = producer.service_receipt(b'', raw, code, unit)
            self.assertIsNone(result['serviceExitCode'])
            self.assertIsNotNone(result['firstFailure'])
    def test_raw_event_accepts_pretty_reordered_lf_without_normalizing(self):
        for raw in (b'{ "b": 2, "a": 1 }\n', b'{\n "a": 1,\n "b": 2\n}\n', b'{"a":1,"b":2}'):
            self.assertEqual(producer.raw_event(raw), {'a': 1, 'b': 2})
            with self.assertRaises(ValueError): producer.request_object(raw)
    def test_raw_json_refuses_duplicate_nested_nonfinite_and_bounds(self):
        for raw in (b'{"x":1,"x":2}', b'{"a":{"x":1,"x":2}}', b'{"x":NaN}',
                    b'{"a":[1e999]}', b'{} {}', b'[]', b'{"x":"\xff"}',
                    b' ' * producer.EVENT_CAP + b'{}'):
            with self.subTest(raw=raw[:40]), self.assertRaises(ValueError): producer.raw_event(raw)
    def test_source_header_and_frame_are_unique_and_complete(self):
        header = producer.expected_header()
        self.assertEqual(len(header), 307)
        self.assertEqual(producer.sha256(header), '6018ddf9aa6a75233d423a94d427c68708a1122f4b64c5cee2412d65bef12b79')
        frame = producer.WIRE_MAGIC + bytes(1730 - len(producer.WIRE_MAGIC) - len(producer.WIRE_END)) + producer.WIRE_END
        self.assertEqual(producer.reporter_frame(header + frame), frame)
        for raw in (b'\0' + header + frame, header + frame + b'\n', header + frame[:-1],
                    header + frame + frame, header.replace(b'2.7', b'2.8') + frame):
            with self.assertRaises(ValueError): producer.reporter_frame(raw)
    def test_static_elf_never_runs_and_bounds_headers(self):
        self.assertEqual(producer.elf_facts(synthetic_elf()), {'class': 'ELF64', 'machine': 'x86-64',
            'type': 'EXEC', 'interpreter': None, 'needed': [], 'rpath': None, 'runpath': None})
        for offset, value in ((32, 2 ** 63), (54, 1), (56, 0)):
            raw = bytearray(synthetic_elf())
            struct.pack_into('<Q' if offset == 32 else '<H', raw, offset, value)
            with self.assertRaises(ValueError): producer.elf_facts(bytes(raw))
    def test_role_typed_zero_and_exclusive_write(self):
        with tempfile.TemporaryDirectory(dir=HERE) as temp:
            path = Path(temp) / 'empty'
            producer.retain_exclusive(path, b'', 1)
            raw, observed = producer.read_regular(path, 1, owner=os.getuid())
            self.assertEqual(raw, b'')
            self.assertEqual(observed['sha256'], producer.sha256(b''))
            with self.assertRaises(ValueError): producer.read_regular(path, 1, minimum=1, owner=os.getuid())
            with self.assertRaises(FileExistsError): producer.retain_exclusive(path, b'x', 1)
    def test_read_and_close_preserve_first_secondary_partial(self):
        with tempfile.TemporaryDirectory(dir=HERE) as temp:
            path = Path(temp) / 'data'
            path.write_bytes(b'abcd')
            real_close = os.close
            def close(fd):
                real_close(fd)
                raise OSError('secondary-close')
            with mock.patch.object(producer.os, 'read', side_effect=[b'ab', OSError('first-read')]), \
                 mock.patch.object(producer.os, 'close', side_effect=close):
                with self.assertRaisesRegex(OSError, 'first-read') as caught:
                    producer.read_regular(path, 8, owner=os.getuid())
            retained = caught.exception.bochs_partial
            self.assertEqual(retained['observation']['bytes'], 2)
            self.assertEqual(retained['observation']['sha256'], producer.sha256(b'ab'))
            self.assertFalse(retained['observation']['complete'])
            self.assertEqual(retained['secondary'][0]['message'], 'secondary-close')


class InventoryControls(unittest.TestCase):
    def test_inactive_guard_precedes_all_factories_even_valid_request(self):
        _request, raw, event, env = synthetic_request()
        factory = mock.Mock(side_effect=AssertionError('host factory reached'))
        with mock.patch.object(producer, 'TOOLCHAIN_ENABLED', False):
            with self.assertRaisesRegex(ValueError, 'inactive'):
                producer.dispatch('toolchain', raw, event, env, factory)
        factory.assert_not_called()
        # Counterfactual: same valid packet reaches the exact factory when only
        # the guard is enabled. No factory is actually executed in either case.
        with mock.patch.object(producer, 'TOOLCHAIN_ENABLED', True):
            with self.assertRaisesRegex(AssertionError, 'host factory reached'):
                producer.dispatch('toolchain', raw, event, env, factory)
        self.assertEqual(factory.call_count, 1)
    def test_active_invalid_event_still_precedes_factory(self):
        _request, raw, event, env = synthetic_request()
        factory = mock.Mock(side_effect=AssertionError('host factory reached'))
        with mock.patch.object(producer, 'TOOLCHAIN_ENABLED', True):
            with self.assertRaises(ValueError):
                producer.dispatch('toolchain', raw, event, {**env, 'GITHUB_ACTOR': 'other'}, factory)
        factory.assert_not_called()
    def test_real_collect_finalize_pack_fifteen_roles_with_sparse_and_manual_cleanup(self):
        _request, _raw, _event, _env, edges, value, outside, roles = inventory_sample()
        self.assertTrue(value['complete'])
        self.assertEqual(outside['cleanupExitCode'], 0)
        self.assertEqual(len(roles), 15)
        self.assertFalse(any(value['authority'].values()))
        self.assertEqual(len(value['observations']['notices']), 7)
        self.assertEqual([call[0] for call in edges.calls].count('toolchain'), 2)
        raw = producer.pack_zip(roles, archive_cap=8388608, expanded_cap=16777216, member_cap=16)
        self.assertEqual(producer.unpack_zip(raw, archive_cap=8388608,
            expanded_cap=16777216, member_cap=16), roles)
    def test_invalid_event_stops_before_observation(self):
        _request, raw, event, env = synthetic_request()
        for change in ({'GITHUB_ACTOR': 'another-user'}, {'GITHUB_RUN_ATTEMPT': '2'},
                       {'BW_EXPECTED_HEAD': '4' * 40}, {'GITHUB_JOB': 'bochs-ring3-build-v1'}):
            edges = InventoryEdges()
            with self.assertRaises(ValueError): producer.collect_toolchain(raw, event, {**env, **change}, edges)
            self.assertEqual(edges.calls, [])
    def test_missing_notice_refuses_without_promoting_partial(self):
        _request, raw, event, env = synthetic_request()
        edges = InventoryEdges()
        first = edges.notices
        edges.notices = lambda: {k: v for k, v in first().items() if k != producer.NOTICE_PATHS[0]}
        value, _roles = producer.collect_toolchain(raw, event, env, edges)
        self.assertFalse(value['complete'])
        self.assertIn('all seven', value['firstFailure']['message'])
        self.assertFalse(any(value['authority'].values()))
    def test_after_failure_does_not_replace_first_or_reexecute(self):
        _request, raw, event, env = synthetic_request()
        edges = InventoryEdges()
        def tool_failure(): raise OSError('first-tool-read')
        edges.toolchain = tool_failure
        source = edges.source
        calls = 0
        def source_after(selected, environ):
            nonlocal calls
            calls += 1
            if calls == 2: raise OSError('secondary-source-read')
            return source(selected, environ)
        edges.source = source_after
        value, _roles = producer.collect_toolchain(raw, event, env, edges)
        self.assertEqual(value['firstFailure']['message'], 'first-tool-read')
        self.assertEqual(value['secondary'][0]['message'], 'secondary-source-read')
        self.assertFalse(value['complete'])
    def test_missing_inner_finalizer_false_null_and_nonzero(self):
        _request, raw, event, env = synthetic_request()
        outside, _roles = producer.finalize_original('toolchain', raw, event, env, None, {}, 1, 1, InventoryEdges())
        self.assertFalse(outside['innerComplete'])
        self.assertIsNone(outside['innerFirstFailure'])
        self.assertEqual(outside['cleanupExitCode'], 1)
        outside, _roles = producer.finalize_original('toolchain', raw, event, env, None, {},
                                                     None, None, InventoryEdges())
        self.assertIsNone(outside['serviceExitCode'])
        self.assertIsNone(outside['clientExitCode'])
        self.assertEqual(outside['cleanupExitCode'], 1)
    def test_debian_real_fold_and_whitespace_authority(self):
        base = b'Package: fixture\nStatus: install ok installed\nVersion: 1\nArchitecture: all\n'
        self.assertEqual(len(producer.debian_status(base + b'Conffiles:\n /x a\n')), 1)
        for raw in (base + b'Conffiles:\n \n', base.replace(b'Package: fixture', b'Package:    '),
                    base + b'Version: 2\n', base.replace(b'Status:', b'status:') + b'Status: install ok installed\n'):
            with self.assertRaises(ValueError): producer.debian_status(raw)


class ProcessControls(unittest.TestCase):
    def capture(self, *, stdout=b'data', status=0, selector_error=None,
                cap=1024, checkpoint=False, post_error=None, timeout=False,
                environment=None, record_environment=None, argv=None):
        class Stream:
            def __init__(self, fd): self.fd, self.closed = fd, False
            def fileno(self): return self.fd
            def close(self): self.closed = True
        process = SimpleNamespace(pid=77, stdout=Stream(10), stderr=Stream(11),
                                  returncode=None, kill=mock.Mock())
        class Selector:
            def __init__(self): self.items = {}
            def register(self, stream, _events, which):
                self.items[stream.fd] = SimpleNamespace(fileobj=stream, data=which)
            def get_map(self): return self.items
            def select(self, _timeout): return [(x, 1) for x in list(self.items.values())]
            def unregister(self, stream): self.items.pop(stream.fd)
            def close(self): self.items.clear()
        chunks = {10: [stdout, b''], 11: [b'']}
        def read(fd, _cap): return chunks[fd].pop(0)
        usage = SimpleNamespace(ru_utime=0.01, ru_stime=0.01, ru_maxrss=100)
        waits = [(0, 0, None), (77, status, usage)] if checkpoint or timeout else [(77, status, usage)]
        ticks = itertools.chain((0, 61000000000, 61000000001), itertools.count(61000000002, 1000000)) if timeout else itertools.count(1, 1000000)
        def terminal(_pid, _reaped):
            if post_error: raise OSError(post_error)
            return {'resourcesAfter': {}, 'cgroupAfter': {}}
        selector = mock.Mock(side_effect=selector_error) if selector_error else Selector
        with mock.patch.object(producer.subprocess, 'Popen', return_value=process) as popen, \
             mock.patch.object(producer.os, 'pidfd_open', return_value=9), \
             mock.patch.object(producer.os, 'set_blocking'), \
             mock.patch.object(producer.os, 'read', side_effect=read), \
             mock.patch.object(producer.os, 'wait4', side_effect=waits), \
             mock.patch.object(producer.os, 'close') as close, \
             mock.patch.object(producer.signal, 'pidfd_send_signal') as send, \
             mock.patch.object(producer.selectors, 'DefaultSelector', selector), \
             mock.patch.object(producer.time, 'monotonic_ns', side_effect=lambda: next(ticks)):
            value, streams, stop = producer.child_capture(argv or ['/authored/tool'], cwd='/authored',
                environment=environment or {'LANG': 'C'}, record_environment=record_environment,
                name='bochs' if checkpoint else 'configure',
                wall_seconds=60, stream_cap=cap, checkpoint=checkpoint,
                clock=lambda: next(ticks), observe_terminal=terminal)
        self.assertEqual(popen.call_count, 1)
        self.assertTrue(process.stdout.closed and process.stderr.closed)
        close.assert_called_once_with(9)
        return value, streams, stop, send
    def test_sentinel_secret_name_only_and_no_retained_value(self):
        sentinel = 'SENTINEL_BW_BOCHS_SECRET_NOT_A_REAL_TOKEN'
        environment = {'LANG': 'C', 'GH_TOKEN': sentinel}
        argv = ['/usr/bin/systemd-run', '--wait', '--setenv=GH_TOKEN']
        value, _streams, _stop, _send = self.capture(environment=environment,
            record_environment={'LANG': 'C'}, argv=argv)
        self.assertNotIn(sentinel.encode(), producer.canonical(value))
        self.assertNotIn('GH_TOKEN', value['environment'])
        value, streams, _stop, _send = self.capture(stdout=sentinel.encode(),
            environment=environment, record_environment={'LANG': 'C'}, argv=argv)
        self.assertEqual(value['firstFailure']['phase'], 'secret-output')
        self.assertFalse(value['stdout']['complete'])
        self.assertNotIn(sentinel.encode(), producer.canonical(value))
        self.assertNotIn(sentinel.encode(), streams['stdout'] + streams['stderr'])
        with mock.patch.object(producer.subprocess, 'Popen') as spawn:
            for recorded, command in ((None, argv), ({'LANG': sentinel}, argv),
                                      ({'LANG': 'C'}, argv + ['--setenv=GH_TOKEN=' + sentinel])):
                with self.assertRaises(ValueError):
                    producer.child_capture(command, cwd='/authored', environment=environment,
                        record_environment=recorded, name='manager', wall_seconds=5, stream_cap=1024)
            spawn.assert_not_called()
    def test_wait4_positive_and_source_only_mocked_edges(self):
        value, streams, stop, send = self.capture()
        self.assertIsNone(value['firstFailure'])
        self.assertEqual(streams, {'stdout': b'data', 'stderr': b''})
        self.assertEqual(value['waitStatus'], 0)
        self.assertTrue(value['reaped'])
        self.assertIsNone(stop)
        send.assert_not_called()
    def test_selector_constructor_failure_kills_reaps_closes(self):
        value, _streams, _stop, send = self.capture(selector_error=OSError('selector-constructor'), status=9)
        self.assertEqual(value['firstFailure']['message'], 'selector-constructor')
        self.assertTrue(value['reaped'])
        send.assert_called_once_with(9, producer.signal.SIGKILL)

    def test_clipped_prefix_and_post_error_keep_first(self):
        value, streams, _stop, _send = self.capture(cap=2, post_error='post-observation')
        self.assertEqual(value['firstFailure']['message'], 'stdout stream cap')
        self.assertEqual(streams['stdout'], b'da')
        self.assertFalse(value['stdout']['complete'])
        self.assertIn('post-observation', [x['message'] for x in value['secondary']])

    def test_checkpoint_signal15_and_natural_exit_refusal(self):
        frame = producer.WIRE_MAGIC + bytes(1730 - len(producer.WIRE_MAGIC) - len(producer.WIRE_END)) + producer.WIRE_END
        raw = producer.expected_header() + frame
        value, _streams, stop, send = self.capture(stdout=raw, cap=4096, checkpoint=True, status=15)
        self.assertIsNone(value['firstFailure'])
        self.assertTrue(stop['sent'])
        self.assertEqual(value['signal'], 15)
        self.assertIsNone(value['exitCode'])
        send.assert_called_once_with(9, producer.signal.SIGTERM)
        value, _streams, _stop, _send = self.capture(stdout=raw, cap=4096, checkpoint=True, status=0)
        self.assertIsNotNone(value['firstFailure'])

    def test_timeout_retains_deadline_before_kill_reap(self):
        value, _streams, _stop, send = self.capture(timeout=True, status=9)
        self.assertEqual(value['firstFailure']['phase'], 'child-deadline')
        self.assertTrue(value['timedOut'] and value['reaped'])
        send.assert_called_once_with(9, producer.signal.SIGKILL)



class NodeKernel:
    """Only the seven fixed in-memory nodes used by the actual copy algorithm."""
    def __init__(self, path, raw, *, fault=None):
        self.path, self.raw, self.fault = str(path), raw, fault
        self.nodes, self.fds, self.offsets, self.events = {}, {}, {}, []
        self.next_inode, self.next_fd = 10, 100
        self.add('/', 0o40755)
        self.add('/run', 0o40755)
        self.add(producer.NODE_PATH, 0o100777, raw, uid=1001, gid=1000)
    def add(self, path, mode, raw=None, uid=0, gid=0):
        self.next_inode += 1
        self.nodes[path] = {'mode': mode, 'uid': uid, 'gid': gid, 'ino': self.next_inode,
                            'raw': None if raw is None else bytearray(raw), 'mtime': 1, 'ctime': 1}
    def name(self, path, dir_fd=None):
        path = os.fspath(path)
        if not path.startswith('/'):
            path = posixpath.join(self.fds[dir_fd], path)
        return posixpath.normpath(path)
    def info(self, path):
        if path not in self.nodes: raise FileNotFoundError(2, 'authored absent node', path)
        node = self.nodes[path]
        return SimpleNamespace(st_dev=1, st_ino=node['ino'], st_mode=node['mode'],
            st_uid=node['uid'], st_gid=node['gid'], st_nlink=2 if node['raw'] is None else 1,
            st_size=0 if node['raw'] is None else len(node['raw']),
            st_mtime_ns=node['mtime'], st_ctime_ns=node['ctime'])
    def resolve(self, path, *args, **kwargs):
        name = str(path)
        if name not in self.nodes: raise FileNotFoundError(name)
        return Path(name)
    def lstat(self, path): return self.info(self.name(path))
    def stat(self, path, *, dir_fd=None, follow_symlinks=True): return self.info(self.name(path, dir_fd))
    def fstat(self, fd): return self.info(self.fds[fd])
    def mkdir(self, path, mode=0o777, *, dir_fd=None):
        name = self.name(path, dir_fd)
        if name in self.nodes: raise FileExistsError(name)
        self.events.append(('mkdir', name))
        self.add(name, stat.S_IFDIR | mode)
    def open(self, path, flags, mode=0o777, *, dir_fd=None):
        name = self.name(path, dir_fd)
        if flags & os.O_CREAT:
            if name in self.nodes and flags & os.O_EXCL: raise FileExistsError(name)
            if name not in self.nodes: self.add(name, stat.S_IFREG | mode, b'')
        if name not in self.nodes: raise FileNotFoundError(name)
        if flags & os.O_DIRECTORY and not stat.S_ISDIR(self.nodes[name]['mode']): raise NotADirectoryError(name)
        if flags & os.O_NOFOLLOW and stat.S_ISLNK(self.nodes[name]['mode']): raise OSError('nofollow')
        self.next_fd += 1
        self.fds[self.next_fd], self.offsets[self.next_fd] = name, 0
        self.events.append(('open', name))
        return self.next_fd
    def read(self, fd, count):
        name = self.fds[fd]
        if self.fault == 'source-read' and name == producer.NODE_PATH: raise OSError('first-source-read')
        raw = self.nodes[name]['raw']
        offset = self.offsets[fd]
        result = bytes(raw[offset:offset + count])
        self.offsets[fd] += len(result)
        return result
    def pread(self, fd, count, offset): return bytes(self.nodes[self.fds[fd]]['raw'][offset:offset + count])
    def write(self, fd, raw):
        name = self.fds[fd]
        if self.fault == 'record-write' and name.endswith('/stage.json'): raise OSError('record-write')
        count = len(raw) - 1 if self.fault == 'short-copy' and name.endswith('/node') else len(raw)
        node, offset = self.nodes[name], self.offsets[fd]
        node['raw'][offset:offset + count] = raw[:count]
        self.offsets[fd] += count
        node['mtime'] += 1
        node['ctime'] += 1
        self.events.append(('write', name, count))
        return count
    def chmod(self, fd, mode):
        name = self.fds[fd]
        node = self.nodes[name]
        node['mode'] = stat.S_IFMT(node['mode']) | mode
        node['ctime'] += 1
        self.events.append(('chmod', name, mode))
        if self.fault == 'file-publication' and name.endswith('/node') and mode == 0o555:
            raise OSError('uncertain-file-publication')
    def seek(self, fd, offset, whence):
        if whence != os.SEEK_SET: raise AssertionError('fixed seek')
        self.offsets[fd] = offset
        return offset
    def close(self, fd):
        name = self.fds.pop(fd)
        self.offsets.pop(fd)
        self.events.append(('close', name))
        if self.fault == 'source-read' and name == producer.NODE_PATH: raise OSError('secondary-source-close')
    def hooks(self):
        stack = contextlib.ExitStack()
        for name, function in {'open': self.open, 'read': self.read, 'pread': self.pread,
            'write': self.write, 'fstat': self.fstat, 'lstat': self.lstat, 'stat': self.stat,
            'mkdir': self.mkdir, 'fchmod': self.chmod, 'lseek': self.seek, 'close': self.close,
            'fsync': lambda fd: None, 'getresuid': lambda: (0, 0, 0),
            'getresgid': lambda: (0, 0, 0)}.items():
            stack.enter_context(mock.patch.object(producer.os, name, function))
        stack.enter_context(mock.patch.object(Path, 'resolve', lambda path, *a, **k: self.resolve(path, *a, **k)))
        return stack


class NodeStageControls(unittest.TestCase):
    def exercise(self, fault=None, full_hash=False):
        real_pin = (producer.NODE_BYTES, producer.NODE_SHA256)
        raw = synthetic_elf()
        # Only authored DATA pin is changed for the in-memory kernel. No
        # collector, guard, grader, resource limit or crypto function is patched.
        with mock.patch.object(producer, 'NODE_BYTES', len(raw)), \
             mock.patch.object(producer, 'NODE_SHA256', producer.sha256(raw)):
            env = {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'}
            stage = producer.NodeStageCopy('build' if full_hash else 'toolchain', env, (1001, 1000))
            kernel = NodeKernel(stage.path, raw, fault=fault)
            with kernel.hooks():
                try:
                    if fault:
                        with self.assertRaises(ValueError): stage.copy()
                    else:
                        facts = stage.copy()
                        producer.check_node_stage(facts, 'build' if full_hash else 'toolchain', env)
                        stage.verify_after(full_hash=full_hash)
                        producer.check_node_stage(facts, 'build' if full_hash else 'toolchain', env, after=True)
                        count = len(kernel.events)
                        with self.assertRaisesRegex(ValueError, 'consumed'): stage.copy()
                        self.assertEqual(len(kernel.events), count)
                finally:
                    stage.close()
            self.assertEqual(kernel.fds, {})
        self.assertEqual((producer.NODE_BYTES, producer.NODE_SHA256), real_pin)
        self.assertEqual(real_pin, (124827920, 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'))
        return stage.facts, kernel
    def test_actual_algorithm_cache777_to_root555_without_real_copy(self):
        facts, kernel = self.exercise()
        self.assertEqual(facts['sourceBefore'][2:5], [0o100777, 1001, 1000])
        self.assertEqual(facts['file'][2:5], [0o100555, 0, 0])
        self.assertFalse(facts['checkedAfter']['hashRead'])
        self.assertTrue(any(row[:2] == ('open', producer.NODE_PATH) for row in kernel.events))
    def test_after_work_complete_hash_is_actually_read(self):
        facts, _kernel = self.exercise(full_hash=True)
        self.assertTrue(facts['checkedAfter']['hashRead'])
        self.assertEqual(facts['checkedAfter']['sha256'], facts['readbackSha256'])
        self.assertGreater(facts['checkedAfter']['elfReadBytes'], 0)
    def test_short_write_prevents_any_executable_publication(self):
        facts, _kernel = self.exercise('short-copy')
        self.assertFalse(facts['filePublished'] or facts['directoryPublished'])
        self.assertIsNotNone(facts['targetAfterFailure'])
    def test_source_read_first_and_close_secondary_survive(self):
        facts, _kernel = self.exercise('source-read')
        self.assertEqual(facts['firstFailure']['message'], 'first-source-read')
        self.assertIn('secondary-source-close', [row['message'] for row in facts['secondary']])
        self.assertFalse(facts['filePublished'])
    def test_publication_error_retains_actual_changed_mode(self):
        facts, _kernel = self.exercise('file-publication')
        self.assertTrue(facts['filePublicationAttempted'])
        self.assertFalse(facts['filePublished'])
        self.assertEqual(stat.S_IMODE(facts['targetAfterFailure'][2]), 0o555)


class HostStageControls(unittest.TestCase):
    def exercise(self, fault=None, *, after=False):
        raw = SparseElfControls.raw()
        source = '/usr/lib/x86_64-linux-gnu/libauthored.so'
        row = producer.sparse_elf(raw)
        selected = {source: {'bytes': len(raw), 'sha256': producer.sha256(raw), 'mode': 0o100755,
            'uid': 0, 'gid': 0, 'elf': {k: v for k, v in row['structure'].items() if k != 'soname'}}}
        structural = {'schema': 'bw.bochs-ring3.runtime-elf-metadata.v1', 'files': {source: row},
                      'rawBytes': sum(x['bytes'] for x in row['ranges'])}
        env = {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'}
        stage = producer.HostRuntimeStage('build', env, selected, structural)
        kernel = NodeKernel(stage.path, b'authored unused cache data')
        for path in ('/usr', '/usr/lib', '/usr/lib/x86_64-linux-gnu'):
            kernel.add(path, 0o40755)
        kernel.add(source, 0o100755, raw)
        real_write, real_read, real_close, real_chmod = kernel.write, kernel.read, kernel.close, kernel.chmod
        def write(fd, data):
            if fault == 'short' and kernel.fds[fd].endswith('/libauthored.so'):
                return real_write(fd, data[:-1])
            return real_write(fd, data)
        def read(fd, count):
            if fault == 'read-close' and kernel.fds[fd] == source:
                raise OSError('first-host-library-source-read')
            return real_read(fd, count)
        def close(fd):
            path = kernel.fds[fd]
            real_close(fd)
            if fault == 'read-close' and path == source:
                raise OSError('secondary-host-library-source-close')
        def chmod(fd, mode):
            path = kernel.fds[fd]
            real_chmod(fd, mode)
            if fault == 'publish' and path.endswith('/libauthored.so') and mode == 0o444:
                raise OSError('publication-applied-before-error')
        kernel.write, kernel.read, kernel.close, kernel.chmod = write, read, close, chmod
        with kernel.hooks():
            try:
                stage.copy()
                if after:
                    stage.verify_after()
            except ValueError:
                if fault is None:
                    raise
            # One-copy boundary must remain consumed after success or failure.
            events = len(kernel.events)
            with self.assertRaisesRegex(ValueError, 'consumed'):
                stage.copy()
            self.assertEqual(len(kernel.events), events)
        return stage.facts, kernel, source
    def test_genuine_transient_stage_full_reopen_and_readonly_publication(self):
        facts, kernel, source = self.exercise(after=True)
        self.assertTrue(facts['complete'])
        row = facts['files'][source]
        self.assertEqual(row['bytesCopied'], len(SparseElfControls.raw()))
        self.assertEqual(row['readback']['sha256'], row['copiedSha256'])
        self.assertEqual(row['published'][2:7], [0o100444, 0, 0, 1, len(SparseElfControls.raw())])
        self.assertEqual(facts['checkedAfter'][source]['sha256'], row['copiedSha256'])
        self.assertEqual(facts['directory'][2], 0o40555)
        self.assertNotIn(b'\xff' * 20, producer.canonical(facts))
    def test_short_copy_no_readonly_or_execution_authority(self):
        facts, _kernel, source = self.exercise('short')
        self.assertFalse(facts['complete'])
        self.assertEqual(facts['files'][source]['bytesCopied'], len(SparseElfControls.raw()) - 1)
        self.assertFalse(facts['files'][source]['publicationAttempted'])
        self.assertEqual(facts['files'][source]['targetAfterFailure'][6], len(SparseElfControls.raw()) - 1)
    def test_source_read_primary_and_close_secondary_are_retained(self):
        facts, _kernel, _source = self.exercise('read-close')
        self.assertEqual(facts['firstFailure']['message'], 'first-host-library-source-read')
        self.assertIn('secondary-host-library-source-close', [r['message'] for r in facts['secondary']])
        self.assertEqual(facts['failurePartial']['path'], '/usr/lib/x86_64-linux-gnu/libauthored.so')
    def test_applied_publication_failure_records_actual_mode(self):
        facts, _kernel, source = self.exercise('publish')
        self.assertEqual(facts['firstFailure']['message'], 'publication-applied-before-error')
        self.assertTrue(facts['files'][source]['publicationAttempted'])
        self.assertEqual(facts['files'][source]['targetAfterFailure'][2], 0o100444)
        self.assertFalse(facts['complete'])


class NodeCleanupControls(unittest.TestCase):
    def sample(self, change=None):
        facts, kernel = NodeStageControls().exercise()
        root = str(Path(facts['stagePath']).parent)
        if change is not None:
            change(kernel, root)
        edge_start = len(kernel.events)
        def unlink(name, *, dir_fd):
            path = kernel.name(name, dir_fd)
            producer.need(path in kernel.nodes and kernel.nodes[path]['raw'] is not None, 'fake known file')
            kernel.events.append(('unlink', path)); del kernel.nodes[path]
        def rmdir(path):
            path = str(path)
            producer.need(not any(x.startswith(path + '/') for x in kernel.nodes), 'fake empty dir')
            kernel.events.append(('rmdir', path)); del kernel.nodes[path]
        class Scan:
            def __init__(self, path):
                path = str(path).rstrip('/') + '/'
                self.items = iter(SimpleNamespace(name=x[len(path):]) for x in list(kernel.nodes)
                    if x.startswith(path) and '/' not in x[len(path):])
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def __iter__(self): return self
            def __next__(self): return next(self.items)
        inner = {'observations': {'nodeStage': facts}}
        env = {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'}
        with mock.patch.object(producer.os, 'lstat', kernel.lstat), \
             mock.patch.object(producer.os, 'open', kernel.open), \
             mock.patch.object(producer.os, 'fstat', kernel.fstat), \
             mock.patch.object(producer.os, 'stat', kernel.stat), \
             mock.patch.object(producer.os, 'fchmod', kernel.chmod), \
             mock.patch.object(producer.os, 'close', kernel.close), \
             mock.patch.object(producer.os, 'scandir', Scan), \
             mock.patch.object(producer.os, 'unlink', unlink), \
             mock.patch.object(producer.os, 'rmdir', rmdir):
            value = producer.cleanup_node_stage('toolchain', env, inner)
        return value, kernel.events[edge_start:], kernel
    def test_actual_cleanup_algorithm_removes_only_bound_node_stage(self):
        value, events, kernel = self.sample()
        self.assertTrue(value['complete'])
        self.assertEqual(value['after'], {'exists': False, 'errno': 2, 'identity': None})
        self.assertEqual([x['operation'] for x in value['journal']],
                         ['chmod-private', 'unlink', 'unlink', 'rmdir'])
        self.assertLessEqual(len(producer.canonical(value)), 16384)
        self.assertEqual([x[0] for x in events if x[0] in ('chmod', 'unlink', 'rmdir')],
                         ['chmod', 'unlink', 'unlink', 'rmdir'])
        self.assertIn(producer.NODE_PATH, kernel.nodes)
    def test_unknown_or_changed_member_refuses_before_mutation(self):
        for change in (lambda k, r: k.add(r + '/unknown', 0o100644, b'authored data'),
                       lambda k, r: k.nodes[r + '/node'].update(ino=999)):
            value, events, _kernel = self.sample(change)
            self.assertFalse(value['complete'])
            self.assertIsNotNone(value['firstFailure'])
            self.assertEqual([x for x in events if x[0] in ('chmod', 'unlink', 'rmdir')], [])


class SparseElfControls(unittest.TestCase):
    @staticmethod
    def raw(abi=0):
        raw = bytearray(b'\xff' * 512)
        raw[:64] = bytes(64)
        raw[:16] = b'\x7fELF\x02\x01\x01' + bytes((abi,)) + bytes(8)
        struct.pack_into('<HHI', raw, 16, 3, 62, 1)
        struct.pack_into('<Q', raw, 32, 64)
        struct.pack_into('<HHH', raw, 52, 64, 56, 3)
        struct.pack_into('<IIQQQQQQ', raw, 64, 1, 5, 0, 0x400000, 0, 512, 512, 4096)
        struct.pack_into('<IIQQQQQQ', raw, 120, 2, 6, 272, 0x400110, 0, 96, 96, 8)
        interp = b'/lib64/ld-linux-x86-64.so.2\0'
        struct.pack_into('<IIQQQQQQ', raw, 176, 3, 4, 232, 0x4000e8, 0, len(interp), len(interp), 1)
        raw[232:232 + len(interp)] = interp
        for index, pair in enumerate(((5, 0x400180), (10, 64), (1, 1), (14, 16), (0, 0))):
            struct.pack_into('<qQ', raw, 272 + index * 16, *pair)
        raw[384:448] = bytes(64)
        raw[385:395] = b'libc.so.6\0'
        raw[400:415] = b'libauthored.so\0'
        return bytes(raw)
    def test_exact_sparse_requests_exclude_padding_symbols_and_executable_body(self):
        raw = self.raw()
        observed = producer.sparse_elf(raw)
        self.assertEqual(observed['structure']['soname'], 'libauthored.so')
        self.assertEqual({k: v for k, v in observed['structure'].items() if k != 'soname'},
                         producer.elf_facts(raw))
        self.assertEqual([(r['offset'], r['bytes']) for r in observed['ranges']],
                         [(0, 260), (272, 80), (385, 10), (400, 15)])
        for row in observed['ranges']:
            payload = base64.b64decode(row['base64'], validate=True)
            self.assertEqual(payload, raw[row['offset']:row['offset'] + row['bytes']])
            self.assertEqual(producer.sha256(payload), row['sha256'])
        self.assertEqual(observed['fileSha256'], producer.sha256(raw))
        self.assertLess(sum(r['bytes'] for r in observed['ranges']), len(raw))
    def test_selected_abi_scope_and_missing_structural_byte_refuse(self):
        for abi in (0, 3): self.assertEqual(producer.sparse_elf(self.raw(abi))['structure']['class'], 'ELF64')
        with self.assertRaises(ValueError): producer.sparse_elf(self.raw(9))
        raw = self.raw()
        with self.assertRaisesRegex(ValueError, 'complete actual structural'):
            producer.sparse_elf_from_reader(len(raw),
                lambda offset, count: raw[offset:offset + count - (offset == 272)], producer.sha256(raw))
    def test_authored_inputs_are_only_unchanged_rom_and_fixture_not_cpu_results(self):
        rom, fixture = producer.authored_inputs()
        self.assertEqual(len(rom), 65536)
        self.assertEqual(producer.sha256(rom), 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529')
        self.assertEqual(producer.sha256(fixture), 'd222aa19e62acc0a95f19306fe9b9a5fef70a04e2b1112293cf70ac883ce22df')
        compressed = base64.b64decode(producer.AUTHORED_INPUT_ZLIB_B64)
        with mock.patch.object(producer, 'AUTHORED_INPUT_ZLIB_B64',
                base64.b64encode(compressed + b'unknown trailing data').decode()), self.assertRaises(ValueError):
            producer.authored_inputs()


class CliControls(unittest.TestCase):
    def context(self, route='toolchain'):
        request, raw, event, env = synthetic_request(route)
        env.update({'GITHUB_ACTIONS': 'true', 'GITHUB_WORKSPACE': '/authored/workspace',
                    'GITHUB_EVENT_PATH': '/authored/event.json'})
        context = {'env': env, 'sourceRoot': '/authored/workspace/producer-source',
            'invoker': {'uid': 1001, 'gid': 1000},
            'requestSha256': producer.sha256(raw), 'eventSha256': producer.sha256(event)}
        return context, producer.route_paths(route, env)
    def test_all_five_cli_modes_inactive_before_every_edge(self):
        for mode in ('--admit', '--work', '--run-service', '--capture-service-status', '--finish'):
            edge = mock.Mock(side_effect=AssertionError('host edge reached'))
            with mock.patch.object(producer, 'load_cli_context', edge), \
                 mock.patch.object(producer, 'admit_cli', edge), \
                 self.assertRaisesRegex(ValueError, 'inactive'):
                producer.main([mode, '--route', 'toolchain'], environment={}, provider_factory=edge)
            edge.assert_not_called()
        # Nonvacuous: activating only the source guard reaches the refused loader.
        with mock.patch.object(producer, 'TOOLCHAIN_ENABLED', True), \
             mock.patch.object(producer, 'load_cli_context', edge), self.assertRaises(AssertionError):
            producer.main(['--work', '--route', 'toolchain'], environment={}, provider_factory=edge)
        edge.assert_called_once()
    def test_manager_source_argv_is_bounded_unmixed_secret_name_only(self):
        for route in producer.ROUTES:
            context, paths = self.context(route)
            argv = producer.manager_arguments(route, context)
            self.assertEqual(argv[0], '/usr/bin/systemd-run')
            self.assertIn('--wait', argv)
            for forbidden in ('--pipe', '--quiet', '--collect', '--remain-after-exit'):
                self.assertNotIn(forbidden, argv)
            self.assertEqual('--setenv=GH_TOKEN' in argv, route == 'reference')
            self.assertTrue(all(not a.startswith('--setenv=GH_TOKEN=') for a in argv))
            self.assertEqual(argv[-3:], ['--work', '--route', route])
            self.assertIn('--unit=' + paths['unit'], argv)
    def test_reference_manager_secret_is_never_recorded_and_marker_precedes_spawn(self):
        context, paths = self.context('reference')
        events = []
        token = 'AUTHORED_SENTINEL_TOKEN_ONLY'
        def seal(path, raw, cap):
            events.append(('write', path.name, raw))
            self.assertNotIn(token.encode(), raw)
        def capture(argv, **kwargs):
            events.append(('spawn', argv))
            self.assertEqual(events[0][1], 'service-attempt.original.json')
            self.assertEqual(kwargs['environment']['GH_TOKEN'], token)
            self.assertNotIn('GH_TOKEN', kwargs['record_environment'])
            self.assertNotIn(token, '\0'.join(argv))
            return {'firstFailure': None, 'secondary': [], 'reaped': True, 'exitCode': 0}, \
                {'stdout': b'', 'stderr': b''}, None
        with mock.patch.object(producer, 'REFERENCE_ENABLED', True), \
             mock.patch.object(producer, 'sealed_write', seal):
            producer.run_service_cli('reference', context, paths, capture=capture, secret=token)
        self.assertEqual([x[0] for x in events], ['write', 'spawn', 'write', 'write', 'write'])
        # A spent marker prevents a second manager invocation, including create-unit.
        capture = mock.Mock(side_effect=AssertionError('must not spawn'))
        with mock.patch.object(producer, 'REFERENCE_ENABLED', True), \
             mock.patch.object(producer, 'sealed_write', side_effect=FileExistsError), \
             self.assertRaises(FileExistsError):
            producer.run_service_cli('reference', context, paths, capture=capture, secret=token)
        capture.assert_not_called()
    def test_public_context_rejects_missing_fields_and_never_copies_unlisted_secret(self):
        context, _paths = self.context()
        env = {**context['env'], 'GH_TOKEN': 'AUTHORED_SECRET', 'GITHUB_TOKEN': 'OTHER_SECRET'}
        value = producer.public_context_environment('toolchain', env)
        self.assertNotIn('GH_TOKEN', value)
        self.assertNotIn('GITHUB_TOKEN', value)
        for name in producer.CONTEXT_ENV:
            wrong = dict(env); wrong.pop(name)
            with self.subTest(name=name), self.assertRaises(ValueError):
                producer.public_context_environment('toolchain', wrong)
    def test_postshow_nonzero_is_retained_diagnostic_not_a_fake_zero(self):
        context, paths = self.context()
        unit = paths['unit']
        raw = ('Running as unit: ' + unit + '\nFinished with result: success\n'
               'Main processes terminated with: code=exited/status=0\n').encode()
        manager, _streams, _stop, _send = ProcessControls().capture(stdout=raw)
        manager['name'] = 'service-client'
        manager['argv'] = producer.manager_arguments('toolchain', context)
        shown, streams, _stop, _send = ProcessControls().capture(stdout=b'', status=256)
        self.assertEqual(shown['exitCode'], 1)
        self.assertIsNotNone(shown['firstFailure'])
        source = {'service-client.original.json': producer.canonical(manager),
                  'service-client.stdout': raw, 'service-client.stderr': b''}
        def read(path, _cap, **kwargs): return source[path.name], {}
        sealed = []
        with mock.patch.object(producer, 'TOOLCHAIN_ENABLED', True), \
             mock.patch.object(producer, 'read_regular', side_effect=read), \
             mock.patch.object(producer, 'sealed_write', side_effect=lambda *x: sealed.append(x)):
            value = producer.capture_service_status_cli('toolchain', context, paths,
                capture=lambda *a, **k: (shown, streams, None))
        self.assertIsNone(value['firstFailure'])
        self.assertEqual(value['receipt']['serviceExitCode'], 0)
        self.assertEqual(value['postShow']['process']['exitCode'], 1)
        self.assertIsNotNone(value['postShow']['process']['firstFailure'])
        self.assertEqual(len(sealed), 1)
        # Nonzero does not excuse clipped, signalled, unknown or close-failed data.
        for key, bad in (('timedOut', True), ('reaped', False), ('signal', 9),
                         ('secondary', [{'phase': 'close'}]), ('firstFailure', None)):
            wrong = copy.deepcopy(shown); wrong[key] = bad
            self.assertFalse(producer.normal_manager_delivery(wrong))
        wrong = copy.deepcopy(shown); wrong['stdout']['complete'] = False
        self.assertFalse(producer.normal_manager_delivery(wrong))
    def test_unknown_status_is_not_zero_and_exit_arguments_are_closed(self):
        self.assertIsNone(producer.parse_exit('unknown'))
        self.assertEqual(producer.parse_exit('0'), 0)
        for text in ('', '00', '-1', '256', 'None', 'false', ' 0'):
            with self.assertRaises(ValueError): producer.parse_exit(text)


class FakeKernel:
    prior = None
    _pids = staticmethod(producer.ChildKernel._pids)

    def __init__(self, unit, work):
        self.unit, self.work = unit, work
        self.names = []
        self.limit_drift = False
        self.pid_drift = False
        self.close_error = False
        self.closed = False
        self.snapshot = 0
        self.secondary = []
        self.delegation = None
        self.partial = None
        FakeKernel.prior = self

    def prepare_delegation(self, pid):
        assert type(pid) is int and pid > 0
        self.delegation = {'unitPath': str(self.unit), 'controllerPath': str(self.unit / 'controller')}
        return self.delegation

    def create_leaf(self, name, texts):
        self.names.append(name)
        self.texts = texts
        return self.unit / name, {'dev': 1}, {'dev': 2}

    def receipt(self, name):
        return 70, self.work / (name + '.preexec.original.json'), {'dev': 3}, {'dev': 4}

    def read_receipt(self, fd, path, row, work):
        assert fd == 70 and path.name.endswith('.preexec.original.json')
        return {'pid': 123, 'uid': 1000, 'euid': 1000, 'gid': 1000, 'egid': 1000,
                'core': [0, 0], 'nofile': [256, 256], 'cpu': [60, 60],
                'fsize': [4194304, 4194304], 'sigtermDefault': True,
                'sigtermBlocked': False, 'rawBeforeExec': self.proc(123)}

    def proc(self, pid, *, phase='postexec'):
        return {'pid': pid, 'procStat': 'raw stat', 'procStatus': 'raw status',
                'procCgroup': '0::/' +
                (self.unit / self.names[-1]).relative_to('/sys/fs/cgroup').as_posix() + '\n',
                'procLimits': 'raw limits', 'fileObservations':
                {name: {'before': {}, 'after': {}, 'named': {}}
                 for name in ('stat', 'status', 'cgroup', 'limits')}}

    def cgroup(self, leaf, unit_identity, leaf_identity, *, own_pid=None):
        self.snapshot += 1
        files = {key: value for key, value in self.texts.items()}
        if self.limit_drift:
            files['memory.max'] = '99\n'
        files.update({'cgroup.procs': '124\n' if self.pid_drift else ('123\n' if self.snapshot == 1 else ''),
                      'cgroup.events': 'populated 1\n' if self.snapshot == 1 else 'populated 0\n',
                      'cgroup.stat': 'nr_descendants 0\nnr_dying_descendants 0\n',
                      'cpu.stat': 'usage_usec 1\n'})
        return {'path': str(leaf), 'identity': {'dev': 2}, 'files': files,
                'children': [], 'parentControl': self.delegation,
                'memberProcesses': {str(own_pid): self.proc(own_pid)} if own_pid else {},
                'procsAfter': '' if own_pid is None else files['cgroup.procs']}

    def absent_proc(self, pid):
        return {'pid': pid, 'procPresent': False, 'errno': 2}

    def close_receipt(self, fd):
        self.closed = True
        if self.close_error:
            raise OSError('mock close')




def provider_capture_edge(argv, *, cwd, environment, name, wall_seconds, stream_cap, preexec,
            checkpoint, observe_spawn, observe_terminal, pass_fds):
    assert pass_fds == (70,) and environment == {'PATH': '/usr/bin'}
    assert cwd.name == ('bochs' if name in ('configure', 'make') else 'runtime')
    initial = None
    try:
        initial = observe_spawn(123)
        terminal = observe_terminal(123, True)
        value = {'firstFailure': None, 'secondary': [], **initial, **terminal}
    except BaseException as exc:
        # The real bounded child_capture retains callback errors in its packet.
        value = {'firstFailure': producer.failure(exc, 'child-capture'), 'secondary': []}
        if initial is not None:
            value.update(initial)
        if type(getattr(exc, 'bochs_partial', None)) is dict:
            value.update(exc.bochs_partial)
    return value, {'stdout': b'', 'stderr': b''}, None




def expect_refusal(callback, part):
    try:
        callback()
    except producer.Refusal as exc:
        assert part in str(exc), (part, exc)
    else:
        raise AssertionError('missing expected refusal: ' + part)


def provider_sample(route='reference'):
    return producer.ChildProcessProvider(route, {'PATH': '/usr/bin'}, 1000, 1000,
                                      '/protected/work', '/sys/fs/cgroup/owned.service')


def test_positive_and_selected_edges():
    provider = provider_sample()
    value, streams, stop = provider.process('bochs', ['/usr/bin/bochs'],
                                            wall_seconds=60, stream_cap=131072,
                                            checkpoint=True)
    assert value['firstFailure'] is None and value['identity']['pid'] == 123
    assert value['resourcesAfter'] == {'pid': 123, 'procPresent': False, 'errno': 2}
    assert value['cgroupAfter']['files']['cgroup.procs'] == ''
    assert FakeKernel.prior.names == ['bochs'] and FakeKernel.prior.closed
    assert FakeKernel.prior.texts['memory.max'] == '1073741824\n'
    assert streams == {'stdout': b'', 'stderr': b''} and stop is None
    expect_refusal(lambda: provider.process('bochs', ['x'], wall_seconds=60,
                                           stream_cap=1, checkpoint=True), 'unique')


def test_build_cwd_and_policy():
    provider = provider_sample('build')
    value, _, _ = provider.process('make', ['/usr/bin/make'], wall_seconds=900,
                                   stream_cap=4194304, checkpoint=False)
    assert value['firstFailure'] is None
    assert FakeKernel.prior.texts['memory.max'] == '2147483648\n'
    assert FakeKernel.prior.texts['pids.max'] == '64\n'


def test_wrong_limits_pid_and_token_refuse():
    expect_refusal(lambda: producer.ChildProcessProvider('reference', {'GH_TOKEN': 'secret'},
                                                       1000, 1000, '/work', '/unit'), 'token')
    for kind, expected in (('limit_drift', 'limits'), ('pid_drift', 'member PID')):
        provider = provider_sample()
        # Set the fake edge before any source-owned child phase starts.
        setattr(provider.kernel, kind, True)
        value, _, _ = provider.process('bochs', ['x'], wall_seconds=60,
                                       stream_cap=1, checkpoint=True)
        assert expected in value['firstFailure']['message']
        assert provider.kernel.closed


def test_close_error_retained():
    provider = provider_sample()
    provider.kernel.close_error = True
    value, _, _ = provider.process('bochs', ['x'], wall_seconds=60,
                                   stream_cap=1, checkpoint=True)
    assert value['firstFailure']['phase'] == 'preexec-receipt-close'


def test_leaf_mode_uses_held_nofollow_fd_after_umask():
    import os
    real_os = producer.os if hasattr(producer, 'os') else None
    calls = []
    mode = {'value': 0o700}
    fake_os = types.SimpleNamespace(
        O_RDONLY=os.O_RDONLY, O_DIRECTORY=os.O_DIRECTORY,
        O_NOFOLLOW=os.O_NOFOLLOW, O_CLOEXEC=os.O_CLOEXEC,
        mkdir=lambda path, requested: calls.append(('mkdir', str(path), requested)),
        open=lambda path, flags: (calls.append(('open', str(path), flags)) or 45),
        fchmod=lambda fd, requested: (calls.append(('fchmod', fd, requested)) or
                                       mode.update(value=requested)),
        close=lambda fd: calls.append(('close', fd)))

    class LeafKernel(producer.ChildKernel):
        def _directory(self, path):
            return {'dev': 1 if path == self.unit else 2, 'ino': 1,
                    'mode': 0o040000 | (0o755 if path == self.unit else mode['value']),
                    'uid': 0, 'gid': 0}

        def _write(self, path, text):
            calls.append(('write', path.name, text))

        def _read(self, path, cap):
            return expected[path.name]

    expected = {'cpu.max': '100000 100000\n', 'memory.max': '1073741824\n'}
    producer.os = fake_os
    try:
        kernel = LeafKernel('/sys/fs/cgroup/owned.service', '/work')
        kernel.delegation = {'enabledAfter': 'cpu memory pids\n'}
        leaf, _, row = kernel.create_leaf('bochs', expected)
    finally:
        if real_os is None:
            del producer.os
        else:
            producer.os = real_os
    assert leaf.name == 'bochs' and row['mode'] & 0o777 == 0o755
    assert calls[1][0] == 'open' and calls[1][2] & os.O_NOFOLLOW
    assert ('fchmod', 45, 0o755) in calls and ('close', 45) in calls


def test_raw_read_owner_identity_first_and_close_secondary():
    import os, stat
    previous_os = producer.os if hasattr(producer, 'os') else None
    previous_identity = producer.identity if hasattr(producer, 'identity') else None
    previous_stat = producer.stat if hasattr(producer, 'stat') else None
    state = {'uid': 1000, 'gid': 1000, 'bad_named': False, 'close_error': False,
             'read_error': False, 'group_writable': False,
             'reads': 0, 'closed': 0}

    def row(named=False):
        return {'dev': 1, 'ino': 2 if named and state['bad_named'] else 1,
                'mode': stat.S_IFREG | (0o420 if state['group_writable'] else 0o400),
                'uid': state['uid'], 'gid': state['gid']}

    def raw_read(fd, count):
        state['reads'] += 1
        if state['read_error']:
            raise OSError('mock read failure')
        return b'abc' if state['reads'] == 1 else b''

    def close(fd):
        state['closed'] += 1
        if state['close_error']:
            raise OSError('mock close failure')

    producer.os = types.SimpleNamespace(O_RDONLY=os.O_RDONLY, O_CLOEXEC=os.O_CLOEXEC,
        O_NOFOLLOW=os.O_NOFOLLOW, O_NONBLOCK=os.O_NONBLOCK,
        open=lambda path, flags: 51, fstat=lambda fd: row(),
        lstat=lambda path: row(named=True), read=raw_read, close=close)
    producer.identity = lambda info: info
    producer.stat = stat
    try:
        kernel = producer.ChildKernel('/unit', '/work')
        assert kernel._read('/proc/123/status', 20, owner=1000, group=1000) == 'abc'
        assert state['closed'] == 1
        state.update(reads=0, bad_named=True)
        expect_refusal(lambda: kernel._read('/proc/123/status', 20, owner=1000, group=1000), 'held/named')
        state.update(reads=0, bad_named=False, uid=0)
        expect_refusal(lambda: kernel._read('/proc/123/status', 20, owner=1000, group=1000), 'held/named')
        state.update(reads=0, gid=0)
        raw, observed = kernel._read('/proc/123/status', 20,
                                     owner_pairs={(0, 0), (1000, 1000)}, observe=True)
        assert raw == 'abc' and observed['before']['uid'] == observed['named']['uid'] == 0
        state.update(reads=0, uid=1000, gid=1001)
        expect_refusal(lambda: kernel._read('/proc/123/status', 20, owner=1000, group=1000), 'held/named')
        state.update(reads=0, gid=1000, group_writable=True)
        expect_refusal(lambda: kernel._read('/proc/123/status', 20, owner=1000, group=1000), 'held/named')
        state.update(reads=0, group_writable=False, read_error=True, close_error=True)
        try:
            kernel._read('/proc/123/status', 20, owner=1000, group=1000)
        except OSError as exc:
            assert str(exc) == 'mock read failure'
            assert exc.bochs_secondary[-1]['phase'] == 'child-edge-close'
        else:
            raise AssertionError('read first failure lost')
        assert kernel.secondary[-1]['phase'] == 'child-edge-close'
        assert kernel.secondary[-1]['message'] == 'mock close failure'
    finally:
        if previous_os is None:
            del producer.os
        else:
            producer.os = previous_os
        if previous_identity is None:
            del producer.identity
        else:
            producer.identity = previous_identity
        if previous_stat is None:
            del producer.stat
        else:
            producer.stat = previous_stat


def test_delegated_parent_subgroup_and_controller_enable():
    import os
    previous_os = producer.os if hasattr(producer, 'os') else None
    producer.os = os
    states = {'unitProcs': '', 'controllerProcs': '123\n',
              'enabled': 'io\n', 'available': 'cpu io memory pids\n',
              'write': [], 'controllerMode': 0o755}

    class Delegated(producer.ChildKernel):
        def _directory(self, path):
            return {'dev': 1, 'ino': 1 if path == self.unit else 2,
                    'mode': 0o040000 | (0o755 if path == self.unit else states['controllerMode']),
                    'uid': 0, 'gid': 0}

        def _read(self, path, cap, *, owner=0):
            name = str(path)
            if name == '/proc/123/cgroup':
                assert owner == 0
                return '0::/system.slice/test.service/controller\n'
            if name.endswith('/controller/cgroup.procs'):
                return states['controllerProcs']
            if name.endswith('/cgroup.procs'):
                return states['unitProcs']
            if name.endswith('/cgroup.controllers'):
                return states['available']
            if name.endswith('/cgroup.subtree_control'):
                return states['enabled']
            raise AssertionError(name)

        def _write(self, path, value):
            assert str(path).endswith('/cgroup.subtree_control')
            states['write'].append(value)
            states['enabled'] = 'cpu io memory pids\n'

    try:
        kernel = Delegated('/sys/fs/cgroup/system.slice/test.service', '/work')
        item = kernel.prepare_delegation(123)
        assert item['write'] == '+cpu +memory +pids\n'
        assert states['write'] == [item['write']]
        assert kernel.parent_control()['enabledAfter'] == 'cpu io memory pids\n'
        states['controllerProcs'] = '123\n999\n'
        expect_refusal(kernel.parent_control, 'controller readback')
        states['controllerProcs'] = '123\n'
        states['controllerMode'] = 0o700
        expect_refusal(kernel.parent_control, 'controller readback')
        states['controllerMode'] = 0o755
        missing = Delegated('/sys/fs/cgroup/system.slice/test.service', '/work')
        states['unitProcs'] = '123\n'
        expect_refusal(lambda: missing.prepare_delegation(123), 'unit empty')
    finally:
        if previous_os is None:
            del producer.os
        else:
            producer.os = previous_os


def test_two_member_child_census_and_drift():
    import os
    previous_os = producer.os
    state = {'reads': 0, 'drift': False, 'fail_member': False}

    class EmptyEntries:
        def __enter__(self):
            return iter(())

        def __exit__(self, *_args):
            return False

    producer.os = types.SimpleNamespace(fspath=os.fspath, scandir=lambda path: EmptyEntries())

    class Members(producer.ChildKernel):
        def _directory(self, path):
            return {'dev': 1, 'ino': 2, 'mode': 0o040755, 'uid': 0, 'gid': 0}

        def _read(self, path, cap, **_kwargs):
            name = path.name
            if name == 'cgroup.procs':
                state['reads'] += 1
                return ('101\n' if state['drift'] and state['reads'] == 2 else
                        '101\n102\n' if state['reads'] == 1 else '102\n101\n')
            if name == 'cgroup.events':
                return 'populated 1\nfrozen 0\n'
            if name == 'cgroup.stat':
                return 'nr_descendants 0\nnr_dying_descendants 0\n'
            if name == 'cpu.stat':
                return 'usage_usec 1\nuser_usec 1\nsystem_usec 0\n'
            return {'cpu.max': '100000 100000\n', 'memory.max': '1073741824\n',
                    'memory.swap.max': '0\n', 'pids.max': '64\n'}[name]

        def proc(self, pid, *, phase='postexec'):
            if pid == 102 and state['fail_member']:
                raise OSError('second member status read failed')
            return {'pid': pid, 'procStat': 'stat',
                    'procStatus': f'Uid:\t1000\t1000\t1000\t1000\n'
                                  f'Gid:\t1001\t1001\t1001\t1001\n',
                    'procCgroup': '0::/system.slice/test.service/make\n',
                    'procLimits': 'limits', 'fileObservations': {}}

        def parent_control(self):
            return {'unitPath': str(self.unit)}

    try:
        kernel = Members('/sys/fs/cgroup/system.slice/test.service', '/work')
        kernel.proc_owner, kernel.proc_group, kernel.member_cap = 1000, 1001, 64
        held = kernel._directory(kernel.unit)
        value = kernel.cgroup(kernel.unit / 'make', held, held, own_pid=101)
        assert set(value['memberProcesses']) == {'101', '102'}
        assert value['files']['cgroup.procs'] != value['procsAfter']
        state.update(reads=0, drift=True)
        expect_refusal(lambda: kernel.cgroup(kernel.unit / 'make', held, held, own_pid=101),
                       'two exact same-set')
        state.update(reads=0, drift=False, fail_member=True)
        try:
            kernel.cgroup(kernel.unit / 'make', held, held, own_pid=101)
        except OSError as exc:
            assert str(exc) == 'second member status read failed'
        else:
            raise AssertionError('second member failure was swallowed')
        partial = kernel.partial
        assert partial['complete'] is False and partial['attemptedPid'] == '102'
        assert partial['files']['cgroup.procs'] == '101\n102\n'
        assert set(partial['memberProcesses']) == {'101'}
        assert partial['firstFailure']['name'] == 'OSError'
    finally:
        producer.os = previous_os


def test_spawn_failure_retains_bounded_child_prefix_and_secondary():
    old_factory = producer.ChildProcessProvider.kernel_factory

    class ErrorKernel(FakeKernel):
        def cgroup(self, leaf, unit_identity, leaf_identity, *, own_pid=None):
            if own_pid is None:
                return super().cgroup(leaf, unit_identity, leaf_identity, own_pid=None)
            self.partial = {'path': str(leaf), 'identity': {'dev': 2},
                            'files': {'cgroup.procs': '123\n124\n'}, 'children': [],
                            'parentControl': self.delegation,
                            'memberProcesses': {'123': self.proc(123)},
                            'procsAfter': None, 'complete': False,
                            'lastPath': '/proc/124/status', 'attemptedPid': '124',
                            'firstFailure': producer.failure(OSError('member disappeared'),
                                                    'child-cgroup-observation',
                                                    path='/proc/124/status'),
                            'secondary': []}
            self.secondary.append(producer.failure(OSError('mock close secondary'),
                                          'child-edge-close'))
            raise OSError('member disappeared')

    producer.ChildProcessProvider.kernel_factory = ErrorKernel
    try:
        provider = provider_sample()
        value, _, _ = provider.process('bochs', ['x'], wall_seconds=60,
                                       stream_cap=1, checkpoint=True)
        assert value['firstFailure']['message'] == 'member disappeared'
        assert value['cgroupBefore']['files']['cgroup.procs'] == '123\n124\n'
        assert set(value['cgroupBefore']['memberProcesses']) == {'123'}
        assert value['cgroupBefore']['attemptedPid'] == '124'
        assert value['secondary'][0]['message'] == 'mock close secondary'
        assert provider.kernel.closed
    finally:
        producer.ChildProcessProvider.kernel_factory = old_factory


def test_terminal_read_failure_retains_partial_without_positive_census():
    old_factory = producer.ChildProcessProvider.kernel_factory

    class TerminalError(FakeKernel):
        def cgroup(self, leaf, unit_identity, leaf_identity, *, own_pid=None):
            if own_pid is not None:
                return super().cgroup(leaf, unit_identity, leaf_identity, own_pid=own_pid)
            self.partial = {'path': str(leaf), 'identity': {'dev': 2},
                'files': {'cpu.max': '100000 100000\n'}, 'children': None,
                'parentControl': None, 'memberProcesses': {}, 'procsAfter': None,
                'complete': False, 'lastPath': str(leaf / 'memory.max'),
                'attemptedPid': None,
                'firstFailure': producer.failure(OSError('terminal read failed'),
                                        'child-cgroup-observation',
                                        path=str(leaf / 'memory.max')),
                'secondary': []}
            raise OSError('terminal read failed')

    producer.ChildProcessProvider.kernel_factory = TerminalError
    try:
        provider = provider_sample()
        value, _, _ = provider.process('bochs', ['x'], wall_seconds=60,
                                       stream_cap=1, checkpoint=True)
        assert value['identity']['pid'] == 123 and value['resourcesBefore']
        assert value['firstFailure']['message'] == 'terminal read failed'
        assert value['resourcesAfter'] is None
        assert value['cgroupAfter']['complete'] is False
        assert value['cgroupAfter']['files']['cpu.max'] == '100000 100000\n'
        assert provider.kernel.closed
    finally:
        producer.ChildProcessProvider.kernel_factory = old_factory




class ChildProviderControls(unittest.TestCase):
    def setUp(self):
        for name, value in (("preexec_policy", lambda *args, **kwargs: (lambda: None)),
                            ("child_capture", provider_capture_edge)):
            patcher = mock.patch.object(producer, name, value)
            patcher.start(); self.addCleanup(patcher.stop)
        patcher = mock.patch.object(producer.ChildProcessProvider, "kernel_factory", FakeKernel)
        patcher.start(); self.addCleanup(patcher.stop)
    def test_positive_and_selected_edges(self):
        test_positive_and_selected_edges()
    def test_build_cwd_and_policy(self):
        test_build_cwd_and_policy()
    def test_wrong_limits_pid_and_token_refuse(self):
        test_wrong_limits_pid_and_token_refuse()
    def test_close_error_retained(self):
        test_close_error_retained()
    def test_leaf_mode_uses_held_nofollow_fd_after_umask(self):
        test_leaf_mode_uses_held_nofollow_fd_after_umask()
    def test_raw_read_owner_identity_first_and_close_secondary(self):
        test_raw_read_owner_identity_first_and_close_secondary()
    def test_delegated_parent_subgroup_and_controller_enable(self):
        test_delegated_parent_subgroup_and_controller_enable()
    def test_two_member_child_census_and_drift(self):
        test_two_member_child_census_and_drift()
    def test_spawn_failure_retains_bounded_child_prefix_and_secondary(self):
        test_spawn_failure_retains_bounded_child_prefix_and_secondary()
    def test_terminal_read_failure_retains_partial_without_positive_census(self):
        test_terminal_read_failure_retains_partial_without_positive_census()


def host_cleanup_exercise(*, unknown=False, unlink_close_failure=False):
    stage, kernel, _source = HostStageControls().exercise(after=True)
    root = stage['path']
    if unknown:
        kernel.add(root + '/unselected', 0o100444, b'x')
    class Scan:
        def __init__(self, path):
            parent = str(path).rstrip('/') + '/'
            self.names = sorted(name[len(parent):] for name in kernel.nodes
                if name.startswith(parent) and '/' not in name[len(parent):])
            self.index = 0
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def __iter__(self): return self
        def __next__(self):
            if self.index >= len(self.names): raise StopIteration
            name = self.names[self.index]; self.index += 1
            return SimpleNamespace(name=name,
                is_dir=lambda follow_symlinks=False: name == 'lib',
                is_symlink=lambda: False)
    def scandir(path): return Scan(path)
    def unlink(path, *, dir_fd=None):
        name = kernel.name(path, dir_fd)
        kernel.events.append(('unlink-attempt', name))
        if unlink_close_failure:
            raise OSError('first-authored-unlink')
        assert name in kernel.nodes and kernel.nodes[name]['raw'] is not None
        del kernel.nodes[name]
    def rmdir(path, *, dir_fd=None):
        name = kernel.name(path, dir_fd)
        assert name in kernel.nodes and all(
            not row.startswith(name + '/') for row in kernel.nodes)
        kernel.events.append(('rmdir', name))
        del kernel.nodes[name]
    real_close = kernel.close
    armed = {'value': False}
    def close(fd):
        name = kernel.fds[fd]
        real_close(fd)
        if armed['value'] and unlink_close_failure and name.endswith('/libauthored.so'):
            raise OSError('secondary-authored-close')
    kernel.close = close
    with kernel.hooks(), mock.patch.object(producer.os, 'scandir', scandir), \
         mock.patch.object(producer.os, 'unlink', unlink), \
         mock.patch.object(producer.os, 'rmdir', rmdir):
        count_before = len(kernel.events)
        try:
            plan = producer.plan_host_runtime_cleanup(stage, 'build', {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'})
        except ValueError as exc:
            return {'planRefusal': str(exc), 'effects':
                    [x for x in kernel.events[count_before:]
                     if x[0] in ('unlink-attempt', 'rmdir')]}
        armed['value'] = True
        value = producer.cleanup_host_runtime(stage, plan, 'build', {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'})
    return {'complete': value['complete'],
            'firstFailure': value['firstFailure'],
            'secondary': value['secondary'],
            'stage': stage, 'plan': plan, 'cleanup': value,
            'effects': [x for x in kernel.events[count_before:]
                        if x[0] in ('unlink-attempt', 'rmdir')],
            'journal': value['journal']}


class HostCleanupControls(unittest.TestCase):
    def test_genuine_plan_and_known_library_removal(self):
        result = host_cleanup_exercise()
        self.assertTrue(result['complete'])
        self.assertEqual([row[0] for row in result['effects']], ['unlink-attempt', 'rmdir', 'rmdir'])
        self.assertLessEqual(len(producer.canonical(result['cleanup'])), result['plan']['cleanupReservedBytes'])
        self.assertLessEqual(len(producer.canonical({'schema': 'bw.bochs-ring3.host-runtime-original.v1',
            'stage': result['stage'], 'cleanup': result['cleanup']})), result['plan']['roleReservedBytes'])
    def test_unknown_input_refuses_before_any_deletion(self):
        result = host_cleanup_exercise(unknown=True)
        self.assertIn('only known', result['planRefusal'])
        self.assertEqual(result['effects'], [])
    def test_unlink_first_and_close_secondary(self):
        result = host_cleanup_exercise(unlink_close_failure=True)
        self.assertFalse(result['complete'])
        self.assertEqual(result['firstFailure']['message'], 'first-authored-unlink')
        self.assertEqual([row['message'] for row in result['secondary']], ['secondary-authored-close'])
        self.assertEqual(len(result['effects']), 1)


class ReferenceInputControls(unittest.TestCase):
    @staticmethod
    def request():
        request, _raw, _event, _env = synthetic_request('reference')
        compact = {'schema': 'bw.bochs-ring3.build-manifest-compact.v1',
            'sourceHead': request['source']['head'], 'sourceTree': request['source']['tree'],
            'sourceFilesSha256': producer.sha256(producer.canonical(request['source']['files'])),
            'bochsCommit': producer.UPSTREAM_COMMIT, 'bochsTree': producer.UPSTREAM_TREE,
            'policySha256': 'a' * 64, 'runtimeMembersSha256': 'b' * 64, 'noticesSha256': 'c' * 64,
            'buildCompleted': True, 'guestExecuted': False}
        for key in ('fullManifest', 'runtimeZip', 'binary', 'configHeader'):
            compact[key] = {'bytes': 123, 'sha256': 'd' * 64}
        request['build'] = {'runId': '12345', 'jobId': 111, 'artifactId': 222,
            'name': 'i80386-bochs-ring3-build-v1-originals', 'bytes': 321, 'sha256': 'e' * 64,
            'checkoutHead': request['source']['head'], 'checkoutTree': request['source']['tree'],
            'workflowCommit': 'f' * 40,
            'workflowFileSha256': request['source']['files'][producer.WORKFLOW]['sha256'],
            'compactManifest': compact, 'buildLog': {'bytes': 100, 'sha256': 'a' * 64}}
        return request
    def test_selected_reference_source_and_closed_compact_boundary(self):
        request = self.request()
        self.assertEqual(producer.admit_reference_inputs(request), request['build'])
        for key, value in (('checkoutHead', '2' * 40), ('checkoutTree', '3' * 40),
                           ('workflowFileSha256', 'c' * 64), ('bytes', 67108865),
                           ('artifactId', True), ('name', 'old-bochs-addon')):
            bad = copy.deepcopy(request); bad['build'][key] = value
            with self.assertRaises(producer.Refusal): producer.admit_reference_inputs(bad)
        for key, value in (('guestExecuted', True), ('buildCompleted', False),
                           ('sourceFilesSha256', 'f' * 64), ('bochsCommit', 'a' * 40)):
            bad = copy.deepcopy(request); bad['build']['compactManifest'][key] = value
            with self.assertRaises(producer.Refusal): producer.admit_reference_inputs(bad)
        bad = copy.deepcopy(request); bad['build']['compactManifest']['runtimeZip']['path'] = 'extra'
        with self.assertRaises(producer.Refusal): producer.admit_reference_inputs(bad)
    def test_source_authored_driver_and_staged_loader_for_both_children(self):
        raw = producer.reference_js_driver('/source', '/run/runtime')
        self.assertIn(b'await executeFixture({fixture})', raw)
        self.assertIn(b'fresh generated authored ROM equals selected input', raw)
        self.assertIn(b"{flag: 'wx', mode: 0o600}", raw)
        self.assertNotIn(b'createCPU', raw)
        ops = object.__new__(producer.LiveOps)
        ops.route = 'reference'; ops.paths = {'work': Path('/run/work')}
        ops.host_stage = SimpleNamespace(library=Path('/run/host/lib'), facts={'files': {
            '/usr/lib/loader': {'member': '/run/host/lib/ld-linux-x86-64.so.2'}}})
        ops.stage = SimpleNamespace(facts={'stagePath': '/run/node/node'})
        ops.reference_runtime = Path('/run/work/runtime')
        js, bochs = ops.reference_argv('js'), ops.reference_argv('bochs')
        for argv in (js, bochs):
            self.assertEqual(argv[:4], ['/run/host/lib/ld-linux-x86-64.so.2', '--inhibit-cache',
                                       '--library-path', '/run/host/lib'])
            self.assertNotIn(producer.NODE_PATH, argv)
        self.assertEqual(js[4], '/run/node/node')
        self.assertEqual(bochs[4:], ['/run/work/runtime/bin/bochs', '-q', '-f', '/run/work/bochsrc.original'])
    def test_original_frame_copy_and_defined_bytes_not_masked(self):
        _rom, raw = producer.authored_inputs(); fixture = producer.raw_object(raw, 1048576)
        frame = producer.WIRE_MAGIC + bytes(producer.WIRE_BYTES - len(producer.WIRE_MAGIC) - len(producer.WIRE_END)) + producer.WIRE_END
        self.assertEqual(producer.compare_reference_frames(frame, frame, fixture), 12)
        def at(address):
            offset = len(producer.WIRE_MAGIC)
            for row in fixture['ranges']:
                if row['address'] <= address < row['address'] + row['bytes']:
                    return offset + address - row['address']
                offset += row['bytes']
            raise AssertionError('authored address absent')
        original = bytearray(frame); original[at(0x70c0) + 6] = 1
        with self.assertRaisesRegex(producer.Refusal, 'all twenty'):
            producer.compare_reference_frames(frame, bytes(original), fixture)
        original[at(0x7fec) + 6] = 1
        self.assertEqual(producer.compare_reference_frames(frame, bytes(original), fixture), 12)
        original[at(0x100d)] = 1
        with self.assertRaisesRegex(producer.Refusal, 'defined'):
            producer.compare_reference_frames(frame, bytes(original), fixture)
        with self.assertRaisesRegex(producer.Refusal, 'defined'):
            producer.compare_reference_frames(frame, frame + b'x', fixture)
    def test_genuine_metadata_before_once_zip_and_wrong_source_no_get(self):
        selected = self.request()['build']; archive = b'authored selected archive data'
        selected['bytes'], selected['sha256'] = len(archive), producer.sha256(archive)
        run = {'id': 12345, 'run_attempt': 1, 'event': 'pull_request', 'actor': {'login': producer.OWNER},
            'head_sha': selected['checkoutHead'], 'path': producer.WORKFLOW, 'status': 'completed', 'conclusion': 'success',
            'repository': {'id': 900, 'full_name': producer.REPOSITORY, 'fork': False},
            'head_repository': {'id': 900, 'full_name': producer.REPOSITORY, 'fork': False},
            'pull_requests': [{'number': 700, 'head': {'sha': selected['checkoutHead'], 'repo': {'id': 900}},
                               'base': {'ref': 'master', 'repo': {'id': 900}}}]}
        names = ['Checkout selected producer source', 'Checkout executing workflow source',
            'Admit Bochs build source and request', 'Prepare pinned Node input cache',
            'Build pinned Bochs CPU3 and retain originals', 'Retain Bochs build originals']
        job = {'id': 111, 'run_id': 12345, 'run_attempt': 1, 'head_sha': selected['checkoutHead'],
            'name': producer.ROUTES['build'][0], 'status': 'completed', 'conclusion': 'success',
            'steps': [{'number': index + 1, 'name': name, 'status': 'completed', 'conclusion': 'success'}
                      for index, name in enumerate(names)]}
        artifact = {'id': 222, 'name': selected['name'], 'expired': False,
            'size_in_bytes': len(archive), 'digest': 'sha256:' + selected['sha256'],
            'workflow_run': {'id': 12345, 'head_sha': selected['checkoutHead'],
                             'repository_id': 900, 'head_repository_id': 900}}
        base = 'https://api.github.com/repos/' + producer.REPOSITORY + '/actions/'
        def exercise(bad=None):
            rows = {'runs/12345': copy.deepcopy(run), 'jobs/111': copy.deepcopy(job),
                'artifacts/222': copy.deepcopy(artifact),
                'runs/12345/artifacts?per_page=100': {'total_count': 1, 'artifacts': [artifact]}}
            if bad: bad(rows)
            events = []
            def get(url, cap, *, token):
                self.assertTrue(url.startswith(base)); self.assertEqual(token, 'secret-sentinel')
                route = url[len(base):]; events.append(route)
                if route.endswith('/zip'):
                    self.assertIn('durable-attempt', events)
                    return archive
                return producer.canonical(rows[route])
            def save(*args): events.append('durable-attempt')
            ops = object.__new__(producer.LiveOps); ops.route = 'reference'
            ops.paths = {'work': Path('/run/work')}
            with mock.patch.object(producer, 'source_http', get), mock.patch.object(producer, 'sealed_write', save), \
                 mock.patch.dict(producer.os.environ, {'GH_TOKEN': 'secret-sentinel'}):
                result = None
                try: result = ops.acquire_build(selected, pull_request=700)
                except producer.Refusal: pass
                before = len(events)
                with self.assertRaisesRegex(producer.Refusal, 'one Reference-only'): ops.acquire_build(selected, pull_request=700)
                self.assertEqual(len(events), before)
            return result, events
        result, events = exercise()
        self.assertEqual(result[0], archive)
        self.assertEqual(events[-2:], ['durable-attempt', 'artifacts/222/zip'])
        self.assertNotIn('secret-sentinel', producer.canonical(result[1]).decode())
        for mutation in (lambda rows: rows['runs/12345'].update(head_sha='0' * 40),
                         lambda rows: rows['jobs/111']['steps'][2].update(status='in_progress'),
                         lambda rows: rows['artifacts/222'].update(digest='sha256:' + '0' * 64),
                         lambda rows: rows['runs/12345/artifacts?per_page=100'].update(total_count=2),
                         lambda rows: rows['runs/12345']['repository'].update(full_name='other/foreign'),
                         lambda rows: rows['runs/12345']['head_repository'].update(fork=True),
                         lambda rows: rows['runs/12345']['pull_requests'][0].update(number=701),
                         lambda rows: rows['artifacts/222']['workflow_run'].update(repository_id=901),
                         lambda rows: rows['artifacts/222']['workflow_run'].update(head_repository_id=901),
                         lambda rows: rows['jobs/111']['steps'].append({'number': 7, 'name': 'secret-sentinel',
                            'status': 'completed', 'conclusion': 'success'})):
            result, events = exercise(mutation)
            self.assertIsNone(result)
            self.assertNotIn('durable-attempt', events)
            self.assertFalse(any(route.endswith('/zip') for route in events))


class FinalizerKnownErrorControls(unittest.TestCase):
    def test_known_status_and_incomplete_inner_present_before_cgroup_cleanup(self):
        _request, raw, event, env = synthetic_request()
        inner, roles = producer.collect_toolchain(raw, event, env, InventoryEdges())
        class Inspect(InventoryEdges):
            def cleanup(edge, original, *, outer=None):
                edge.base = copy.deepcopy(outer)
                return super().cleanup(original, outer=outer)
        for incomplete in (False, True):
            edges = Inspect(); current = copy.deepcopy(inner)
            if incomplete: current['complete'] = False
            error = producer.Refusal('known manager receipt refused')
            error.bochs_secondary = [producer.failure(OSError('known receipt-close secondary'), 'file-close')]
            outside, _roles = producer.finalize_original('toolchain', raw, event, env, current,
                dict(roles), 0, 0, edges, status_error=error)
            before = [edges.base['firstFailure'], *edges.base['secondary']]
            self.assertIn('outside-service-status', [row['phase'] for row in before])
            self.assertIn('known receipt-close secondary', [row['message'] for row in before])
            if incomplete:
                self.assertEqual(before[0]['phase'], 'outside-inner-completion')
            else:
                self.assertEqual(before[0]['phase'], 'outside-service-status')
            self.assertEqual(outside['cleanupExitCode'], 1)
            self.assertEqual([outside['firstFailure'], *outside['secondary']], before)


if __name__ == '__main__':
    unittest.main()
