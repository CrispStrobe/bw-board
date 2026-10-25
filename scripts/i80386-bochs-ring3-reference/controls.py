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
            self.assertIs(producer.TOOLCHAIN_ENABLED, False)
            with mock.patch.object(producer, 'TOOLCHAIN_ENABLED', False), \
                 mock.patch.object(producer, 'load_cli_context', edge), \
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



# Additive mock-only connected Build and Reference controls. These source-pinned
# pure output bytes are not a CPU run or an official result. No private paths.
def _connected_bochs_mocks():
    import atexit, importlib.util, itertools, signal, zlib
    from types import SimpleNamespace
    from unittest import mock
    producer = globals()['producer']
    spec = importlib.util.spec_from_file_location('bochs_connected_reader', HERE / 'reader.py')
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    controls = SimpleNamespace(InventoryEdges=InventoryEdges, SparseElfControls=SparseElfControls,
        NodeKernel=NodeKernel, synthetic_node_stage=synthetic_node_stage,
        synthetic_elf=synthetic_elf, synthetic_stat=synthetic_stat,
        synthetic_request=synthetic_request)
    class _ConnectedChildFixture:
        UNIT = "bw-bochs-build-v1-123-1.service"
        ROOT = "/sys/fs/cgroup/system.slice/" + UNIT
        PID, SERVICE, UID, GID = 101, 100, 1000, 1001
        LIMITS = {"cpu.max":"100000 100000\n", "memory.max":"2147483648\n", "memory.swap.max":"0\n", "pids.max":"64\n"}
        def stat(self, ino, mode=0o040755):
            return {'dev': 1, 'ino': ino, 'mode': mode, 'uid': 0, 'gid': 0,
                    'nlink': 2, 'size': 4096, 'mtimeNs': 1, 'ctimeNs': 1}

        def control(self):
            return {'unitPath': self.ROOT, 'unitIdentity': self.stat(1),
                    'controllerPath': self.ROOT + '/controller', 'controllerIdentity': self.stat(2),
                    'unitProcs': '', 'controllerProcs': str(self.SERVICE) + '\n',
                    'availableBefore': 'cpu io memory pids\n', 'enabledBefore': 'io\n',
                    'write': '+cpu +memory +pids\n',
                    'availableAfter': 'cpu io memory pids\n',
                    'enabledAfter': 'cpu io memory pids\n'}

        def cgroup(self, after):
            return {'path': self.ROOT + '/make', 'identity': self.stat(3), 'children': [],
                    'parentControl': self.control(),
                    'memberProcesses': {} if after else {str(self.PID): self.proc()},
                    'procsAfter': '' if after else str(self.PID) + '\n',
                    'files': {**self.LIMITS, 'cgroup.procs': '' if after else str(self.PID) + '\n',
                              'cgroup.events': 'populated 0\nfrozen 0\n' if after else
                                               'populated 1\nfrozen 0\n',
                              'cgroup.stat': 'nr_descendants 0\nnr_dying_descendants 0\n',
                              'cpu.stat': 'usage_usec 1\nuser_usec 1\nsystem_usec 0\n'}}

        def proc(self):
            tail = ['0'] * 20
            tail[0], tail[18] = str(self.SERVICE), '567'
            return {'pid': self.PID, 'procStat': f'{self.PID} (make) S ' + ' '.join(tail) + '\n',
                    'procStatus': f'Pid:\t{self.PID}\nPPid:\t{self.SERVICE}\n'
                                  f'Uid:\t{self.UID}\t{self.UID}\t{self.UID}\t{self.UID}\n'
                                  f'Gid:\t{self.GID}\t{self.GID}\t{self.GID}\t{self.GID}\nThreads:\t1\n',
                    'procCgroup': '0::/system.slice/' + self.UNIT + '/make\n',
                    'procLimits': 'Max open files            256 256 files\n',
                    'fileObservations': {name: {'before': self.stat(10 + i, 0o100400),
                                                'after': self.stat(10 + i, 0o100400),
                                                'named': self.stat(10 + i, 0o100400)}
                                         for i, name in enumerate(('stat', 'status', 'cgroup', 'limits'))}}

        def packet(self):
            pre = {'pid': self.PID, 'uid': self.UID, 'euid': self.UID, 'gid': self.GID, 'egid': self.GID,
                   'core': [0, 0], 'nofile': [256, 256], 'cpu': [900, 900],
                   'fsize': [67108864, 67108864], 'sigtermDefault': True,
                   'sigtermBlocked': False, 'rawBeforeExec': self.proc()}
            return {'pid': self.PID, 'identity': {'pid': self.PID, 'preexec': pre},
                    'resourcesBefore': {'preexec': pre, 'parentObserved': self.proc()},
                    'resourcesAfter': {'pid': self.PID, 'procPresent': False, 'errno': 2},
                    'cgroupBefore': self.cgroup(False), 'cgroupAfter': self.cgroup(True)}

    child_fixture = _ConnectedChildFixture()
    def sha(raw): return hashlib.sha256(raw).hexdigest()

    def git_blob(raw): return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()

    def j(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()

    def tar_gz(files):
        sink = io.BytesIO()
        with tarfile.open(fileobj=sink, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name, raw in sorted(files.items()):
                row = tarfile.TarInfo(name)
                row.size, row.mode, row.uid, row.gid, row.mtime = len(raw), 0o644, 0, 0, 0
                archive.addfile(row, io.BytesIO(raw))
        output = io.BytesIO()
        with gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as stream:
            stream.write(sink.getvalue())
        return output.getvalue()

    def synthetic_upstream():
        vga = b'V' * 38400
        notice = b'LGPL synthetic notice for a mock-only source graph\n'
        payload = {'bochs/bios/VGABIOS-lgpl-latest': vga,
                   'bochs/bios/VGABIOS-lgpl-README': notice}
        for index in range(762):
            payload[f'bochs/dir{index % 49:02d}/file{index:04d}.c'] = b''
        excluded = {f'bochs/bios/BIOS-bochs-{index:02d}': b'excluded' for index in range(10)}
        all_files = {**payload, **excluded}
        dirs = {'bochs', 'bochs/bios'} | {f'bochs/dir{index:02d}' for index in range(49)}
        assert len(dirs) == 51 and len(all_files) == 774 and len(payload) == 764
        root = {}
        for path, raw in all_files.items():
            at = root
            parts = path.split('/')
            for part in parts[:-1]: at = at.setdefault(part, {})
            at[parts[-1]] = ('100644', git_blob(raw))
        hashes = {}
        def tree(at, path=''):
            result = bytearray()
            for name, child in sorted(at.items(), key=lambda item: item[0].encode() +
                                      (b'/' if type(item[1]) is dict else b'')):
                if type(child) is dict:
                    child_path = path + '/' + name if path else name
                    hash_bytes = tree(child, child_path)
                    hashes[child_path] = hash_bytes.hex()
                    mode = b'40000'
                else:
                    mode, hash_bytes = child[0].encode(), bytes.fromhex(child[1])
                result.extend(mode + b' ' + name.encode() + b'\0' + hash_bytes)
            return hashlib.sha1(b'tree ' + str(len(result)).encode() + b'\0' + result).digest()
        root_sha = tree(root).hex()
        rows = []
        for path, raw in all_files.items():
            name = path.rsplit('/', 1)[-1]
            bios = path.startswith('bochs/bios/')
            is_excluded = ((bios and name.startswith(('BIOS-bochs-', 'VGABIOS-')) and
                            not name.endswith(('README', 'LICENSE')) and
                            name != 'VGABIOS-lgpl-latest') or
                           (bios and '.bin' in name) or path.endswith('.exe'))
            reason = ('unselected prebuilt firmware/tool; no payload GET' if is_excluded else
                      'selected LGPL VGA data; correspondence/notice admission still required'
                      if path == producer.VGA_PATH else
                      'selected source/notice/ordinary data; per-component notice review required')
            rows.append({'path': path, 'mode': '100644', 'gitBlob': git_blob(raw),
                         'bytes': len(raw), 'included': not is_excluded, 'reason': reason})
        selection = {'schema': 'bw.bochs-ring3.source-selection.v1',
                     'commit': producer.UPSTREAM_COMMIT, 'tree': root_sha,
                     'rows': sorted(rows, key=lambda row: row['path'])}
        entries = ([{'path': path, 'mode': '040000', 'type': 'tree', 'sha': value,
                     'size': 0} for path, value in hashes.items()] +
                   [{'path': path, 'mode': '100644', 'type': 'blob', 'sha': git_blob(raw),
                     'size': len(raw)} for path, raw in all_files.items()])
        assert len(entries) == 825
        corresponding = {'vgabios-0.8a/VGABIOS-lgpl-latest.bin': vga,
                         'vgabios-0.8a/COPYING': notice,
                         'vgabios-0.8a/README': b'Synthetic README\n',
                         'vgabios-0.8a/Makefile': b'all:\n',
                         'vgabios-0.8a/vgabios.c': b'int x;\n',
                         'vgabios-0.8a/vbe.c': b'int y;\n'}
        for index in range(25):
            corresponding[f'vgabios-0.8a/other{index:02d}.c'] = b'int z;\n'
        assert len(corresponding) == 31
        return {'tree': {'sha': root_sha, 'url': 'synthetic:data-only',
                         'tree': entries, 'truncated': False},
                'before': {'schema': 'synthetic-source-readback', 'tree': root_sha},
                'sourceArchive': tar_gz(payload),
                'correspondingSourceRaw': tar_gz(corresponding),
                'correspondingSource': {'selectedSynthetic': True},
                'vga': vga, 'notice': notice, 'selection': selection}

    def patch_pins(upstream):
        pins = {'UPSTREAM_TREE': upstream['tree']['sha'],
                'SOURCE_SELECTION_SHA256': sha(producer.canonical(upstream['selection'])),
                'VGA_BLOB': git_blob(upstream['vga']),
                'VGA_NOTICE_BLOB': git_blob(upstream['notice']),
                'VGA_SHA256': sha(upstream['vga']),
                'VGA_SOURCE_BYTES': len(upstream['correspondingSourceRaw']),
                'VGA_SOURCE_SHA256': sha(upstream['correspondingSourceRaw']),
                'VGA_LICENSE_SHA256': sha(upstream['notice'])}
        saved = []
        for key, value in pins.items():
            saved.append((producer, key, getattr(producer, key)))
            setattr(producer, key, value)
        reader_names = {**pins, 'BOCHS_TREE': pins['UPSTREAM_TREE'],
                        'VGA_SELECTED_SHA256': pins['VGA_SHA256'],
                        'VGA_SELECTED_BYTES': len(upstream['vga']),
                        'VGA_COPYING_SHA256': pins['VGA_LICENSE_SHA256']}
        for key, value in reader_names.items():
            if hasattr(reader, key):
                saved.append((reader, key, getattr(reader, key)))
                setattr(reader, key, value)
        def restore():
            for module, key, prior in reversed(saved): setattr(module, key, prior)
            assert all(getattr(module, key) == prior for module, key, prior in saved)
        atexit.register(restore)
        return restore

    def request_inputs(upstream, edges):
        request, _raw, _event, _env = controls.synthetic_request('build')
        graph = edges.toolchain()
        request['toolchain'] = {'files': producer.expected_graph(graph)['files'],
                                'aliases': producer.expected_graph(graph)['aliases'],
                                'directoryAliases': producer.expected_graph(graph)['directoryAliases'],
                                'node': producer.node_expectation(controls.synthetic_node_stage('build')),
                                'inventory': {'runId': '123', 'jobId': 124, 'artifactId': 125,
                                              'archiveBytes': 100, 'archiveSha256': 'a' * 64,
                                              'requestSha256': 'b' * 64, 'reportSha256': 'c' * 64,
                                              'sourceHead': request['source']['head'],
                                              'sourceTree': request['source']['tree'],
                                              'workflowCommit': 'd' * 40}}
        request['bochs'] = {'repository': producer.UPSTREAM, 'commit': producer.UPSTREAM_COMMIT,
                            'tree': producer.UPSTREAM_TREE,
                            'sourceSelectionSha256': producer.SOURCE_SELECTION_SHA256,
                            'vga': {'path': producer.VGA_PATH, 'gitBlob': producer.VGA_BLOB,
                                    'bytes': producer.VGA_BYTES,
                                    'noticePath': 'bochs/bios/VGABIOS-lgpl-README',
                                    'noticeGitBlob': producer.VGA_NOTICE_BLOB,
                                    'correspondingSource': {
                                        'url': producer.VGA_SOURCE_URL,
                                        'bytes': producer.VGA_SOURCE_BYTES,
                                        'sha256': producer.VGA_SOURCE_SHA256,
                                        'licensePath': 'vgabios-0.8a/COPYING',
                                        'licenseSha256': producer.VGA_LICENSE_SHA256,
                                        'version': '0.8a',
                                        'selectedResourceGitBlob': producer.VGA_BLOB}}}
        raw = producer.canonical(request)
        _job, label, prefix = producer.ROUTES['build']
        env = controls.synthetic_request('build')[3]
        env[prefix + '_SHA256'] = producer.sha256(raw)
        env[prefix + '_B64'] = base64.b64encode(raw).decode('ascii')
        event = json.loads(controls.synthetic_request('build')[2])
        event['pull_request']['body'] = '<!-- ' + prefix + '_SHA256=' + producer.sha256(raw) + ' -->\nSynthetic fixture.\n'
        return request, raw, producer.canonical(event), env

    def fake_child_capture(name, argv, stdout, *, started):
        """Run genuine bounded child_capture with only kernel/process edges fake."""
        class Stream:
            def __init__(self, number): self.number, self.closed = number, False
            def fileno(self): return self.number
            def close(self): self.closed = True
        class Selector:
            def __init__(self): self.items = {}
            def register(self, file, _events, which):
                self.items[file.number] = SimpleNamespace(fileobj=file, data=which)
            def get_map(self): return self.items
            def select(self, _timeout): return [(value, 1) for value in list(self.items.values())]
            def unregister(self, file): self.items.pop(file.number)
            def close(self): self.items.clear()
        pid = 101 if name == 'configure' else 102
        child = SimpleNamespace(pid=pid,
                                stdout=Stream(10), stderr=Stream(11), returncode=None)
        observed = child_packet(name, pid)
        chunks = {10: [stdout, b''], 11: [b'']}
        usage = SimpleNamespace(ru_utime=0.01, ru_stime=0.01, ru_maxrss=100)
        ticks = itertools.count(started, 1000000)
        with mock.patch.object(producer.subprocess, 'Popen', return_value=child) as popen, \
             mock.patch.object(producer.os, 'pidfd_open', return_value=9), \
             mock.patch.object(producer.os, 'set_blocking'), \
             mock.patch.object(producer.os, 'read', side_effect=lambda fd, _cap: chunks[fd].pop(0)), \
             mock.patch.object(producer.os, 'wait4', return_value=(child.pid, 0, usage)), \
             mock.patch.object(producer.os, 'close'), \
             mock.patch.object(producer.selectors, 'DefaultSelector', Selector), \
             mock.patch.object(producer.time, 'monotonic_ns', side_effect=lambda: next(ticks)):
            value, streams, stop = producer.child_capture(argv, cwd='/mock/build',
                environment={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, name=name,
                wall_seconds=900, stream_cap=4194304,
                clock=lambda: next(ticks),
                observe_spawn=lambda _pid: {key: observed[key] for key in
                    ('identity', 'resourcesBefore', 'cgroupBefore')},
                observe_terminal=lambda _pid, _reaped: {key: observed[key] for key in
                    ('resourcesAfter', 'cgroupAfter')})
        assert popen.call_count == 1 and value['firstFailure'] is None
        assert value['reaped'] is True and value['exitCode'] == 0 and stop is None
        return value, streams, stop

    def child_packet(name, pid):
        child_fixture.UNIT = 'bw-bochs-build-v1-123456-1.service'
        child_fixture.ROOT = '/sys/fs/cgroup/system.slice/' + child_fixture.UNIT
        child_fixture.PID, child_fixture.SERVICE = pid, 100
        child_fixture.UID, child_fixture.GID = 1001, 1000
        packet = child_fixture.packet()
        if name == 'make':
            for key in ('cgroupBefore', 'cgroupAfter'):
                packet[key]['identity']['ino'] = 4
        def replace(value):
            if type(value) is dict:
                return {(str(key).replace('/make', '/' + name) if type(key) is str else key):
                        replace(item) for key, item in value.items()}
            if type(value) is list: return [replace(item) for item in value]
            if type(value) is str: return value.replace('/make', '/' + name).replace('(make)', '(' + name + ')')
            return value
        return replace(packet)

    def resource_packet(route='build'):
        unit = f'bw-bochs-{route}-v1-123456-1.service'
        root = '/sys/fs/cgroup/system.slice/' + unit
        child_fixture.UNIT, child_fixture.ROOT = unit, root
        child_fixture.SERVICE = 100
        parent = child_fixture.control()
        limits = {'cpu.max': '100000 100000\n',
                  'memory.max': str(producer.LIMITS[route]['memoryBytes']) + '\n',
                  'memory.swap.max': '0\n',
                  'pids.max': str(producer.LIMITS[route]['tasks']) + '\n'}
        common = {'cgroup.events': 'populated 1\nfrozen 0\n',
                  'cpu.stat': 'usage_usec 1\nuser_usec 1\nsystem_usec 0\n'}
        return {'schema': 'bw.bochs-ring3.resources.v2', 'unit': unit,
                'pid': 100, 'uid': 0, 'gid': 0,
                'unitRoot': {'path': root, 'directory': child_fixture.stat(1),
                             'children': ['controller'],
                             'files': {**limits, **common, 'cgroup.procs': '',
                                       'cgroup.stat': 'nr_descendants 1\nnr_dying_descendants 0\n'}},
                'controller': {'path': root + '/controller',
                               'directory': child_fixture.stat(2), 'children': [],
                               'files': {'cpu.max': 'max 100000\n', 'memory.max': 'max\n',
                                         'memory.swap.max': 'max\n', 'pids.max': 'max\n',
                                         **common, 'cgroup.procs': '100\n',
                                         'cgroup.stat': 'nr_descendants 0\nnr_dying_descendants 0\n'}},
                'procCgroup': '0::/system.slice/' + unit + '/controller\n',
                'procStat': '100 (python3) S ' + ' '.join(['0'] * 50) + '\n',
                'procStatus': 'Pid:\t100\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\nThreads:\t1\n',
                'parentControl': parent}

    class BuildEdges(controls.InventoryEdges):
        def __init__(self, upstream, rom, fixture):
            super().__init__()
            self.upstream_value, self.rom, self.fixture = upstream, rom, fixture
            self.files[producer.TOOL_PATHS['gcc']] = synthetic_interp_elf()
            self.files['/lib64/ld-linux-x86-64.so.2'] = controls.SparseElfControls.raw()
            self.files['/usr/lib/x86_64-linux-gnu/libc.so.6'] = controls.SparseElfControls.raw()
            self.indexes = {path: index + 10 for index, path in enumerate(sorted(self.files))}
        def toolchain(self):
            graph = super().toolchain()
            for path in ('/lib64/ld-linux-x86-64.so.2',
                         '/usr/lib/x86_64-linux-gnu/libc.so.6'):
                raw, observed = self.read(path, 128 << 20, minimum=1, owner=0)
                observed['elf'] = {key: value for key, value in
                                   producer.sparse_elf(raw)['structure'].items()
                                   if key != 'soname'}
                graph['files'][path] = observed
            return graph
        def node_stage(self): return controls.synthetic_node_stage('build')
        def elf_metadata(self, graph):
            node = producer.sparse_elf(controls.synthetic_elf())
            node['fileBytes'] = producer.NODE_BYTES
            node['fileSha256'] = producer.NODE_SHA256
            rows = {producer.NODE_PATH: node}
            for path in producer.runtime_elf_candidates(graph):
                rows[path] = producer.sparse_elf(self.files[path])
            value = {'schema': 'bw.bochs-ring3.runtime-elf-metadata.v1',
                     'files': rows,
                     'rawBytes': sum(row['bytes'] for item in rows.values()
                                     for row in item['ranges'])}
            self.structural = value
            return value
        def host_runtime_stage(self, graph, structural):
            projected = producer.expected_graph(graph)
            selected = {path: projected['files'][path]
                        for path in producer.runtime_elf_candidates(graph)}
            env = {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'}
            self.host_stage = producer.HostRuntimeStage('build', env, selected, structural)
            self.host_kernel = controls.NodeKernel(self.host_stage.path, b'unused mock Node')
            for source in selected:
                parent = Path(source).parent
                chain = []
                while str(parent) != '/':
                    chain.append(str(parent))
                    parent = parent.parent
                for name in reversed(chain):
                    if name not in self.host_kernel.nodes:
                        self.host_kernel.add(name, 0o40755)
                self.host_kernel.add(source, selected[source]['mode'], self.files[source])
            with self.host_kernel.hooks():
                return self.host_stage.copy()
        def host_runtime_after(self):
            with self.host_kernel.hooks():
                return self.host_stage.verify_after()
        def resources(self, route):
            assert route == 'build'
            self.calls.append(('resources', route))
            return resource_packet()
        def node_after(self, *, full_hash):
            return controls.synthetic_node_stage('build', full_hash=full_hash, checked=True)
        def upstream(self, selected):
            self.calls.append(('upstream',))
            return self.upstream_value
        def upstream_after(self): return self.upstream_value['before']
        def generated_headers(self):
            config = b''.join(b'#define ' + name + b' ' + str(value).encode() + b'\n'
                for name, value in ((b'BX_CPU_LEVEL', 3), (b'BX_WITH_NOGUI', 1),
                                    (b'BX_PLUGINS', 0), (b'BX_DEBUGGER', 0)))
            version = (b'#define VERSION "2.7"\n#define VER_SVNFLAG 0\n'
                       b'#define REL_STRING "Built from SVN snapshot on August  1, 2021"\n'
                       b'#define REL_TIMESTAMP "Sun Aug  1 10:07:00 CEST 2021"\n')
            return config, version
        def process(self, name, argv, *, wall_seconds, stream_cap, checkpoint):
            assert name in ('configure', 'make') and wall_seconds == 900 and not checkpoint
            output = (b'configured\n' if name == 'configure' else
                      b'/usr/bin/x86_64-linux-gnu-gcc-13 -c src.c\n')
            return fake_child_capture(name, argv, output,
                                      started=1000000000 if name == 'configure' else 2000000000)
        def runtime_bundle(self, request, upstream):
            notices = {'notices/vgabios-corresponding-source.tar.gz':
                       upstream['correspondingSourceRaw'],
                       'notices/bochs-selected-corresponding-source.tar.gz':
                       upstream['sourceArchive'],
                       'notices/bochs/COPYING': b'Synthetic reviewed LGPL COPYING\n',
                       'notices/bochs/README': b'Synthetic selected source README\n',
                       'notices/bochs/config.guess': b'Synthetic config guess\n',
                       'notices/bochs/config.sub': b'Synthetic config sub\n',
                       'notices/vgabios/README': upstream['notice'],
                       'notices/vgabios/source-COPYING': upstream['notice'],
                       'notices/vgabios/source-README': b'Synthetic source README\n'}
            return producer.assemble_runtime_v2(request['source'],
                controls.SparseElfControls.raw(),
                self.rom, self.fixture, upstream['vga'],
                host_node=request['toolchain']['node'],
                selected=request['toolchain'], structural=self.structural,
                notices=notices)
        def _host_cleanup_hooks(self):
            kernel = self.host_kernel
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
            def unlink(path, *, dir_fd=None):
                name = kernel.name(path, dir_fd)
                assert name in kernel.nodes and kernel.nodes[name]['raw'] is not None
                del kernel.nodes[name]
            def rmdir(path, *, dir_fd=None):
                name = kernel.name(path, dir_fd)
                assert name in kernel.nodes and all(
                    not row.startswith(name + '/') for row in kernel.nodes)
                del kernel.nodes[name]
            stack = __import__('contextlib').ExitStack()
            stack.enter_context(kernel.hooks())
            stack.enter_context(mock.patch.object(producer.os, 'scandir', Scan))
            stack.enter_context(mock.patch.object(producer.os, 'unlink', unlink))
            stack.enter_context(mock.patch.object(producer.os, 'rmdir', rmdir))
            return stack
        def prepare_host_cleanup(self, inner, roles):
            raw = roles['host-runtime.original.json']
            value = json.loads(raw)
            assert value['cleanup'] is None and value['stage'] == self.host_stage.facts
            with self._host_cleanup_hooks():
                self.host_plan = producer.plan_host_runtime_cleanup(
                    self.host_stage.facts, 'build',
                    {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'})
            plan = self.host_plan
            return {'hostRuntimePlan': {'stageSha256': plan['stageSha256'],
                    'planSha256': sha(producer.canonical(plan)),
                    'roleReservedBytes': plan['roleReservedBytes']},
                    'hostRuntimeCleanup': {'role': 'host-runtime.original.json',
                    'bytes': plan['roleReservedBytes'], 'sha256': 'f' * 64,
                    'complete': False}}
        def host_cleanup(self):
            with self._host_cleanup_hooks():
                result = producer.cleanup_host_runtime(self.host_stage.facts,
                    self.host_plan, 'build',
                    {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'})
            return producer.canonical({'schema': 'bw.bochs-ring3.host-runtime-original.v1',
                    'stage': self.host_stage.facts, 'cleanup': result})
        def cleanup(self, inner, *, outer=None):
            kernel = SimpleNamespace(_directory=mock.Mock(
                side_effect=FileNotFoundError(2, 'synthetic absent selected unit')))
            return producer.cleanup_owned_cgroups('build', {'GITHUB_RUN_ID': '123456',
                'GITHUB_RUN_ATTEMPT': '1'}, inner, kernel, outer_base=outer,
                input_plan=producer.node_cleanup_wire_plan('build',
                    {'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1'}, inner),
                following_error_bytes=1024, clock=iter((1, 2, 3)).__next__)
        def node_cleanup(self, inner):
            return synthetic_node_cleanup('build', inner)

    class ToolEdges(controls.InventoryEdges):
        def resources(self, route):
            assert route == 'toolchain'
            self.calls.append(('resources', route))
            return resource_packet('toolchain')
        def node_cleanup(self, inner):
            return synthetic_node_cleanup('toolchain', inner)

    def synthetic_node_cleanup(route, inner):
            assert inner['complete'] is True
            stage = inner['observations']['nodeStage']
            keys = ('dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs')
            def row(raw): return dict(zip(keys, raw))
            directory = Path(stage['stagePath']).parent
            initial = row(stage['directory'])
            private = dict(initial, mode=0o040700)
            members = {'node': row(stage['file']),
                       'stage.json': row(stage['record']['metadata'])}
            absent = {'exists': False, 'errno': 2, 'identity': None}
            operations = [('chmod-private', str(directory), initial,
                           {'exists': True, 'errno': None, 'identity': private}),
                          ('unlink', str(directory / 'node'), members['node'], absent),
                          ('unlink', str(directory / 'stage.json'), members['stage.json'], absent),
                          ('rmdir', str(directory), private, absent)]
            journal = [{'operation': operation, 'path': path, 'before': before,
                        'attempted': True, 'after': after, 'firstFailure': None}
                       for operation, path, before, after in operations]
            return {'schema': 'bw.bochs-ring3.node-cleanup.v1', 'route': route,
                    'path': str(directory), 'parentBefore': row(stage['parents']['/run']['after']),
                    'parentAfter': row(stage['parents']['/run']['after']),
                    'before': {'exists': True, 'errno': None, 'identity': initial},
                    'members': members, 'journal': journal, 'after': absent,
                    'complete': True, 'firstFailure': None, 'secondary': []}

    def synthetic_interp_elf():
        raw = bytearray(220)
        raw[:16] = b'\x7fELF\x02\x01\x01' + bytes(9)
        struct.pack_into('<HHI', raw, 16, 2, 62, 1)
        struct.pack_into('<Q', raw, 32, 64)
        struct.pack_into('<HHH', raw, 52, 64, 56, 2)
        struct.pack_into('<IIQQQQQQ', raw, 64, 1, 5, 0, 0x400000, 0, len(raw), len(raw), 4096)
        interpreter = b'/lib64/ld-linux-x86-64.so.2\0'
        struct.pack_into('<IIQQQQQQ', raw, 120, 3, 4, 176, 0, 0,
                         len(interpreter), len(interpreter), 1)
        raw[176:176+len(interpreter)] = interpreter
        return bytes(raw)

    def synthetic_status(route, unit, context):
        """Data-only manager sidecar for reader staging, not source finish receipt."""
        stdout = (f'Running as unit: {unit}\nFinished with result: success\n'
                  'Main processes terminated with: code=exited/status=0\n').encode()
        def process(name, argv, raw_out, raw_err, code):
            failure = None if code == 0 else {'phase': 'child-capture',
                'name': 'Refusal', 'message': 'ordinary child completed exit0',
                'role': None, 'path': None}
            return {'name': name, 'argv': argv, 'cwd': '/mock/source',
                'environment': {'PATH': '/usr/bin'}, 'startedNs': 1, 'endedNs': 2,
                'pid': 222, 'identity': None, 'waitStatus': code << 8,
                'exitCode': code, 'signal': None, 'reaped': True, 'timedOut': False,
                'stdout': {'role': name + '.stdout', 'bytes': len(raw_out),
                           'sha256': sha(raw_out), 'complete': True},
                'stderr': {'role': name + '.stderr', 'bytes': len(raw_err),
                           'sha256': sha(raw_err), 'complete': True},
                'resourcesBefore': None, 'resourcesAfter': None,
                'cgroupBefore': None, 'cgroupAfter': None,
                'firstFailure': failure, 'secondary': [], 'usage': None}
        client_argv = producer.manager_arguments(route, context)
        post_argv = ['/usr/bin/systemctl', 'show', unit, '--no-pager',
            '--property=Id,Result,ExecMainCode,ExecMainStatus,ActiveState,ControlGroup']
        value = {'schema': 'bw.bochs-ring3.service-status.v1', 'route': route,
            'unit': unit,
            'client': {'process': process('service-client', client_argv, stdout, b'', 0),
                       'stdoutBase64': base64.b64encode(stdout).decode(),
                       'stderrBase64': ''},
            'receipt': {'schema': 'bw.bochs-ring3.service-receipt.v1', 'unit': unit,
                        'runningUnit': unit, 'result': 'success', 'mainCode': 'exited',
                        'mainStatus': 0, 'clientExitCode': 0, 'serviceExitCode': 0,
                        'firstFailure': None, 'secondary': []},
            'postShow': {'process': process('service-post-show', post_argv, b'', b'', 1),
                         'stdoutBase64': '', 'stderrBase64': ''},
            'firstFailure': None, 'secondary': []}
        return reader.canonical(value)

    build = SimpleNamespace(BuildEdges=BuildEdges, synthetic_upstream=synthetic_upstream,
        patch_pins=patch_pins, child_packet=child_packet, resource_packet=resource_packet,
        synthetic_node_cleanup=synthetic_node_cleanup, synthetic_status=synthetic_status)
    def canonical(value): return producer.canonical(value)
    def _mock_output(name, encoded, size, digest):
        raw = zlib.decompress(base64.b64decode(encoded, validate=True))
        assert len(raw) == size and sha(raw) == digest, name
        return raw
    mock_child_bytes = {
        'memory.before.bin': bytes(1 << 20),
        'fixture.canonical.json': producer.authored_inputs()[1],
        'memory.after.bin': _mock_output('memory.after.bin', 'eNrt3EFoVFcUBuDbkAcBYzOKgYAVYqIiYqBFuxQsppBFCaFYcaEQRGMQF+50p4JQByUKdlFR0BaRIgriKok1DijoIhIXLrJRxJXFko2uNDS9984kqKQqlIDG7wuc+06Gdx68t/pn7kwIAAAAwOdiaiqWM2PV9VRtfVVbn4+F3SG0hmPuEwAAfNJ6G0KYiOuO2gp8Xs6HUJrTC/S7xwAAAAAAAAAwh/oGS2FgfKAycP/PcDW1q0NTGO8bbK/+9/HA08HOdW2LhkavXzo9HKYmHl4/ur/vpxuPKlcWjBzYsn7xzeWbdv3c3x7SZ/wnY6mri2VpbntCGHODAQAA4CNQLsK+WBfWp9rckOqyxlRXllLtWJLqty2pbvgq1uNFa6oL21JtXpHqslWprlydaseaWM+eKNbG5d6hcnEoDz+Shx/Nw4/n4Sfz8F/y8F/z8LN5+Pk8/Pc8/EIefjEP/yMPv1Qdfjkud4rxWLs3f//jvcPP/vEcAQAA4N35f2OO6J05onfliP5Djug9OaJvzhF9a47o23JE780RfUeO6DtzRO/LEb0/R/Q9sR7rXBHnVqpH9eXidvWooVzcrR41lovR6lGpXNyvhvq9OdTXt4b8cwR3igex7+z+rmvwwa1rv9lHMFdeTg7/FZeR8EVTGGqMR5cnnkyOpPeEhh7PdKXYfT3TtcSuVD/dxQc21D/9WuVg7HpnuhNvdOde7zam631Z64ZfxINvKhMvXzyb9EgAAADmRNrcn/b2p639aWd/2sSfNvenvf1pa397WBraa39pb//7zv/74NvnN8T4WDt/luundP9/rr+9J4T0dYP8Wjw3fRMhvW2QdgZ4ugAAAMwXox+o7j+y8vvOc4cBAADg08n/s74nUCf/AwAAwHzL/7d9/g8AAADz3yz5HwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgI/bv090zd8=', 1048576, 'fa116f3d00947cfe7520a40bf27d5727c2d0522e499b682d4b48b0358e5a0867'),
        'frame.bin': _mock_output('frame.bin', 'eNpzCtcN8vRzN9YNM+RyMVYSPLN71UyG/+/udpSnhTJMYGC4d2Atd0WYiZCic2q7MoM0gzIUMjExYAB0/W/q0fVzMAjA9GNqZ7hyeNNCSuyPDWAAqmCAyAH1KoPc5Ofo4RfiGoSs7v9/IDH7PISeDKV/Q+nP5xnSGRgUGLoZRsEoGAUjGSRwMDC8A9JJUBoEFjAAyzBaggyGM0QCJhxl3hkaApA91DTvCBnu53KCVVqufi5cAPbDDQE=', 1730, '488a9d4adb4431184ed56e6c6807be5fafbf1d93cf3dfe985196e5cd0ef001c0'),
    }
    assert sha(mock_child_bytes['memory.before.bin']) == '30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58'
    def synthetic_architecture():
        """Construct a journal from fixed authored memory semantics, never a CPU run."""
        before = mock_child_bytes['memory.before.bin']
        after = mock_child_bytes['memory.after.bin']
        wire = mock_child_bytes['frame.bin']
        fixture = json.loads(mock_child_bytes['fixture.canonical.json'])
        assert len(before) == len(after) == 1048576 and len(wire) == 1730
        assert sha(before) == '30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58'
        assert sha(wire) == '488a9d4adb4431184ed56e6c6807be5fafbf1d93cf3dfe985196e5cd0ef001c0'
        expected = bytearray(before)
        planned = []
        for address in range(0x7fec, 0x8000):
            planned.append((20, address, 0xcc))
        for address, value in enumerate(after):
            if address in range(0x7fec, 0x8000):
                call = 100
            elif 0x7000 <= address < 0x7030:
                call = 50
            elif 0x7040 <= address < 0x7070:
                call = 150
            elif 0x70c0 <= address < 0x70d4:
                call = 160
            elif 0x7080 <= address < 0x70b0:
                call = 220
            else:
                call = 10
            if value != expected[address] or (0x7fec <= address < 0x8000) or \
               (0x7000 <= address < 0x7030) or (0x7040 <= address < 0x7070) or \
               (0x70c0 <= address < 0x70d4) or (0x7080 <= address < 0x70b0):
                planned.append((call, address, value))
        writes = []
        for call, address, value in sorted(planned):
            writes.append({'index': len(writes), 'call': call, 'address': address,
                           'before': expected[address], 'after': value})
            expected[address] = value
        assert bytes(expected) == after and len(writes) <= 4096
        initial = dict(zip(('eax','ecx','edx','ebx','esp','ebp','esi','edi'),
                           (0x11223344,0x99aabbcc,0xddeeff00,0x55667788,
                            0x9000,0x0badc0de,0x12345678,0x87654321)))
        final_frame = list(after[0x7fec:0x8000])
        rows = []
        for index, (stage, eip, cpl, flags, call) in enumerate((
                ('before-int80', fixture['symbols']['int80'],3,0x202,100),
                ('handler-entry',0x6000,0,2,101),
                ('before-iretd',fixture['symbols']['iretd'],0,2,200),
                ('returned-ring3',fixture['symbols']['returned'],3,0x202,201))):
            registers = dict(initial)
            if cpl == 0: registers['esp'] = 0x7fec
            if index >= 2: registers['eax'] = 0xa1b2c3d4
            selectors = {'es':0x23,'cs':8 if cpl==0 else 0x1b,
                         'ss':0x10 if cpl==0 else 0x23,
                         'ds':0x23,'fs':0x23,'gs':0x23}
            rows.append({'stage':stage,'beforeCall':call,'eip':eip,'linear':eip,
                'cpl':cpl,'eflags':flags,'cr0':1,'cr3':0,'registers':registers,
                'selectors':selectors,
                'cs':{'base':0,'limit':0xffffffff,'default32':True},
                'ss':{'base':0,'limit':0xffffffff,'default32':True},
                'tr':{'selector':0x28,'base':0x2000,'limit':0x67,'present':True},
                'opcode':[0xcd,0x80] if index==0 else [0xcf] if index==2 else [0x89],
                'frame':[0xcc]*20 if index==0 else final_frame})
        report = {'schema':'bw.ring3.js-probe.v1','finiteRoundTripPass':True,
                  'firstFailure':None,'calls':300,'completed':True,
                  'fixtureSha256':producer.ROM_SHA256,
                  'memoryBeforeSha256':sha(before),'memoryAfterSha256':sha(after),
                  'outputSha256':sha(wire),'observations':4,
                  'ports':[{'port':0x21,'value':255,'call':1},
                           {'port':0xa1,'value':255,'call':2}]}
        return {'js/report.json':canonical(report),
                'js/observations.json':canonical(rows),
                'js/writes.json':canonical(writes),
                'js/memory.before.bin':before,
                'js/memory.after.bin':after},wire

    def mock_child(name, argv, stdout, *, checkpoint=False):
        """Explicit process boundary mock with retained source-shaped raw facts."""
        pid = 101 if name == 'js' else 102
        raw = build.child_packet(name, pid)
        def relabel(item):
            if isinstance(item, dict): return {key:relabel(value) for key,value in item.items()}
            if isinstance(item, list): return [relabel(value) for value in item]
            if isinstance(item, str): return item.replace('bochs-build-v1-', 'bochs-reference-v1-')
            return item
        raw = relabel(raw)
        for pre in (raw['identity']['preexec'], raw['resourcesBefore']['preexec']):
            pre['cpu'] = [60,60]
            pre['fsize'] = [4194304,4194304]
        for when in ('cgroupBefore','cgroupAfter'):
            raw[when]['files']['memory.max'] = '1073741824\n'
            if name=='bochs':raw[when]['identity']['ino']=4
        started, ended = (1000000000,1001000000) if name=='js' else (2000000000,2001000000)
        stop = ({'reason':'complete-frame','signal':15,'sent':True,'pid':pid,
                 'sentNs':started+500000,'frameSha256':sha(stdout[len(producer.expected_header()):]),
                 'firstFailure':None,'secondary':[]} if checkpoint else None)
        status = 15 if checkpoint else 0
        value = {'name':name,'argv':argv,'cwd':'/mock/reference-runtime',
                 'environment':{'PATH':'/usr/bin:/bin','LANG':'C'},
                 'startedNs':started,'endedNs':ended,'pid':pid,
                 'identity':raw['identity'],'waitStatus':status,
                 'exitCode':None if checkpoint else 0,'signal':15 if checkpoint else None,
                 'reaped':True,'timedOut':False,
                 'stdout':{'role':name+'.stdout','bytes':len(stdout),'sha256':sha(stdout),'complete':True},
                 'stderr':{'role':name+'.stderr','bytes':0,'sha256':sha(b''),'complete':True},
                 'resourcesBefore':raw['resourcesBefore'],'resourcesAfter':raw['resourcesAfter'],
                 'cgroupBefore':raw['cgroupBefore'],'cgroupAfter':raw['cgroupAfter'],
                 'firstFailure':None,'secondary':[],
                 'usage':{'userSeconds':0.01,'systemSeconds':0.01,'maxRssKiB':100}}
        return value,{'stdout':stdout,'stderr':b''},stop

    class ReferenceEdges(build.BuildEdges):
        def __init__(self, selected, build_archive, arch, frame):
            super().__init__(build.synthetic_upstream(), b'', b'')
            self.built,self.build_archive,self.arch,self.frame=selected,build_archive,arch,frame
        def acquire_build(self, selected, *, pull_request):
            assert pull_request==700 and selected['bytes']==len(self.build_archive)
            assert selected['sha256']==sha(self.build_archive)
            repo={'id':987,'full_name':producer.REPOSITORY,'fork':False}
            step_names=('Checkout selected producer source','Checkout executing workflow source',
                'Admit Bochs build source and request','Prepare pinned Node input cache',
                'Build pinned Bochs CPU3 and retain originals','Retain Bochs build originals')
            steps=[{'number':index,'name':name,'status':'completed','conclusion':'success'}
                   for index,name in enumerate(step_names,1)]
            official={'schema':'bw.bochs-ring3.build-intake.v1',
                      'selected':selected,'readback':{'runId':12345,'runAttempt':1,
                      'event':'pull_request','actor':producer.OWNER,
                      'head':selected['checkoutHead'],'workflowPath':producer.WORKFLOW,
                      'repository':repo,'headRepository':repo,
                      'pullRequest':{'number':pull_request,'head':selected['checkoutHead'],
                                     'baseRef':'master','headRepositoryId':987,'baseRepositoryId':987},
                      'jobId':111,'jobName':producer.ROUTES['build'][0],
                      'steps':steps,'artifactId':222,'artifactName':selected['name'],
                      'artifactRepositoryId':987,'artifactHeadRepositoryId':987,
                      'archiveBytes':len(self.build_archive),'archiveSha256':sha(self.build_archive)},
                      'officialAuthenticatedByReader':False}
            return self.build_archive,official
        def resources(self, route):
            assert route=='reference'
            return build.resource_packet('reference')
        def node_stage(self):
            self.node_stage_value=controls.synthetic_node_stage('reference')
            return self.node_stage_value
        def node_after(self, *, full_hash):
            return controls.synthetic_node_stage('reference',full_hash=full_hash,checked=True)
        def host_runtime_stage(self, graph, structural):
            projected=producer.expected_graph(graph)
            selected={path:projected['files'][path] for path in producer.runtime_elf_candidates(graph)}
            env={'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'}
            self.host_stage=producer.HostRuntimeStage('reference',env,selected,structural)
            self.host_kernel=controls.NodeKernel(self.host_stage.path,b'unused mock Node')
            for source in selected:
                parent=Path(source).parent; chain=[]
                while str(parent)!='/':
                    chain.append(str(parent)); parent=parent.parent
                for name in reversed(chain):
                    if name not in self.host_kernel.nodes:self.host_kernel.add(name,0o40755)
                self.host_kernel.add(source,selected[source]['mode'],self.files[source])
            with self.host_kernel.hooks():return self.host_stage.copy()
        def prepare_reference(self,built):
            assert built['manifest']==self.built['manifest']
            self.reference_runtime=Path('/run/bw-bochs-reference-v1-123456-1-work/runtime')
            self.reference_files=built['runtime']
            return producer.BOCHSRC_TEMPLATE.replace(b'@ROOT@',str(self.reference_runtime).encode())
        def reference_argv(self,name):
            files=self.host_stage.facts['files']
            loader=[row['member'] for row in files.values()
                    if Path(row['member']).name=='ld-linux-x86-64.so.2']
            assert len(loader)==1
            prefix=[loader[0],'--inhibit-cache','--library-path',str(self.host_stage.library)]
            if name=='js':
                return prefix+[self.node_stage_value['stagePath'],'--max-old-space-size=512',
                               '/run/bw-bochs-reference-v1-123456-1-work/js-driver.mjs']
            return prefix+[str(self.reference_runtime/'bin/bochs'),'-q','-f',
                           '/run/bw-bochs-reference-v1-123456-1-work/bochsrc.original']
        def runtime_after(self,built):
            assert built['manifest']==self.built['manifest']
            result={}
            for index,(name,raw) in enumerate(sorted(built['runtime'].items())):
                mode=built['modes'][name]
                row=controls.synthetic_stat(index+1000,len(raw),mode)
                result[name]={'bytes':len(raw),'sha256':sha(raw),'before':row,
                              'after':copy.deepcopy(row),'named':copy.deepcopy(row),
                              'complete':True,'elf':None}
            return result
        def process(self,name,argv,*,wall_seconds,stream_cap,checkpoint):
            assert wall_seconds==60 and stream_cap==131072
            assert checkpoint==(name=='bochs')
            raw=self.frame if name=='js' else producer.expected_header()+self.frame
            return mock_child(name,argv,raw,checkpoint=checkpoint)
        def js_outputs(self):return copy.deepcopy(self.arch)
        def bochs_log(self):return b'Synthetic Bochs mock log; no guest ran.\n'
        def reference_output_census(self):
            root=self.reference_runtime/'outputs'
            directory=controls.synthetic_stat(5000,0,0o40700)
            directory['uid'],directory['gid']=1001,1000
            names={'report.json':self.arch['js/report.json'],
                   'observations.json':self.arch['js/observations.json'],
                   'writes.json':self.arch['js/writes.json'],
                   'memory.before.bin':self.arch['js/memory.before.bin'],
                   'memory.after.bin':self.arch['js/memory.after.bin'],
                   'bochs.log':self.bochs_log()}
            rows={}
            for index,(name,raw) in enumerate(sorted(names.items())):
                row=controls.synthetic_stat(index+5010,len(raw),0o100600)
                row['uid'],row['gid']=1001,1000
                rows[name]=row
            return {'path':str(root),'directory':directory,'files':rows,
                    'aggregateBytes':sum(map(len,names.values())),'quotaEnforced':False}
        def prepare_host_cleanup(self,inner,roles):
            host=json.loads(roles['host-runtime.original.json'])
            assert host['cleanup'] is None and host['stage']==self.host_stage.facts
            with self._host_cleanup_hooks():
                self.host_plan=producer.plan_host_runtime_cleanup(self.host_stage.facts,'reference',
                    {'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'})
            plan=self.host_plan
            return {'hostRuntimePlan':{'stageSha256':plan['stageSha256'],
                    'planSha256':sha(canonical(plan)),'roleReservedBytes':plan['roleReservedBytes']},
                    'hostRuntimeCleanup':{'role':'host-runtime.original.json',
                    'bytes':plan['roleReservedBytes'],'sha256':'f'*64,'complete':False}}
        def host_cleanup(self):
            with self._host_cleanup_hooks():
                result=producer.cleanup_host_runtime(self.host_stage.facts,self.host_plan,
                    'reference',{'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'})
            return canonical({'schema':'bw.bochs-ring3.host-runtime-original.v1',
                              'stage':self.host_stage.facts,'cleanup':result})
        def cleanup(self,inner,*,outer=None):
            kernel=SimpleNamespace(_directory=mock.Mock(
                side_effect=FileNotFoundError(2,'synthetic absent selected unit')))
            env={'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'}
            return producer.cleanup_owned_cgroups('reference',env,inner,kernel,
                outer_base=outer,input_plan=producer.node_cleanup_wire_plan('reference',env,inner),
                following_error_bytes=1024,clock=iter((1,2,3)).__next__)
        def node_cleanup(self,inner):return build.synthetic_node_cleanup('reference',inner)

    return SimpleNamespace(producer=producer, reader=reader, sha=sha, canonical=producer.canonical,
        synthetic_upstream=synthetic_upstream, patch_pins=patch_pins,
        request_inputs=request_inputs, BuildEdges=BuildEdges, ReferenceEdges=ReferenceEdges,
        synthetic_status=synthetic_status, synthetic_architecture=synthetic_architecture,
        mock_child_bytes=mock_child_bytes)

class ConnectedBuildReferenceControls(unittest.TestCase):
    """Genuine collectors/finalizers and independent reader, with OS/CPU transport mocked."""

    def test_connected_build31_reference32(self):
        h = _connected_bochs_mocks()
        p, reader = h.producer, h.reader
        authored_root = HERE.parent / 'i80386-ring3-int-iret'
        for name, digest in (
            ('fixture.mjs', '921eac8c27015d4d0c6ee263aa844e598fcf45c35baf120d1025dbf4910bec71'),
            ('probe.mjs', '9dbb6a44328337c197f2d0ac5010b2b2062c6430aa5daa1bafae167735ec9cc1'),
        ):
            self.assertEqual(h.sha((authored_root / name).read_bytes()), digest)
        self.assertEqual((p.UPSTREAM_COMMIT, p.UPSTREAM_TREE, p.ROM_SHA256),
            ('0e45b736ef9792eb9b752b0a35db49eaf2faea47',
             '1b5e0f45ecea9efee6654c69f6437ef5f7e6b44d',
             'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529'))
        upstream = h.synthetic_upstream()
        restore = h.patch_pins(upstream)
        try:
            rom, fixture = p.authored_inputs()
            self.assertEqual((len(rom), h.sha(rom), len(fixture), h.sha(fixture)),
                (65536, p.ROM_SHA256, 1793,
                 'd222aa19e62acc0a95f19306fe9b9a5fef70a04e2b1112293cf70ac883ce22df'))
            selection = p.selected_source_rows(upstream['tree'])
            self.assertEqual(selection, upstream['selection'])
            edges = h.BuildEdges(upstream, rom, fixture)
            request, raw, event, env = h.request_inputs(upstream, edges)
            p.admitted_request('build', raw, event, env)
            p.admit_build_inputs(request)
            value, roles = p.collect_build(raw, event, env, edges)
            self.assertTrue(value['complete'], value['firstFailure'])
            self.assertEqual(len(roles), 28)
            unit = 'bw-bochs-build-v1-123456-1.service'
            context = {'env':env,'invoker':{'uid':1001,'gid':1000},'sourceRoot':'/mock/source'}
            paths = {'unit':unit,'work':Path('/mock/work'),'output':Path('/mock/output')}
            status = h.synthetic_status('build', unit, context)
            def status_read(path, _cap, **_kw):
                self.assertEqual(path, paths['work'] / 'service-status.original.json')
                return status, {}
            with mock.patch.object(p, 'BUILD_ENABLED', True), \
                 mock.patch.object(p, 'sealed_write'), \
                 mock.patch.object(p, 'retained_output_roles', return_value=copy.deepcopy(roles)), \
                 mock.patch.object(p, 'read_regular', side_effect=status_read), \
                 mock.patch.object(p, 'write_work_roles'):
                outside, build_roles = p.finish_cli('build', context, raw, event, paths,
                    provider_factory=lambda _route,_context,_paths:edges,
                    service_status=paths['work']/'service-status.original.json')
            self.assertEqual(outside['cleanupExitCode'], 0)
            self.assertEqual(len(build_roles), 31)
            self.assertTrue(reader.build_original_v2(build_roles, raw, event)['selectedBuildBytesObserved'])
            modes = {name: 0o755 if name.endswith('/bochs') else 0o644 for name in build_roles}
            build_archive = p.pack_zip(build_roles, archive_cap=64<<20,
                expanded_cap=256<<20, member_cap=4096, modes=modes)
            ref, _, ref_event, ref_env = synthetic_request('reference')
            ref['source'] = request['source']
            ref['build'] = {'runId':'12345','jobId':111,'artifactId':222,
                'name':'i80386-bochs-ring3-build-v1-originals','bytes':len(build_archive),
                'sha256':h.sha(build_archive),'checkoutHead':ref['source']['head'],
                'checkoutTree':ref['source']['tree'],
                'workflowCommit':json.loads(build_roles['source.before.json'])['workflowCommit'],
                'workflowFileSha256':ref['source']['files'][p.WORKFLOW]['sha256'],
                'compactManifest':json.loads(build_roles['compact-manifest.json']),
                'buildLog':{'bytes':100,'sha256':'a'*64}}
            ref_raw = p.canonical(ref)
            prefix = p.ROUTES['reference'][2]
            ref_env[prefix+'_SHA256'] = h.sha(ref_raw)
            ref_env[prefix+'_B64'] = base64.b64encode(ref_raw).decode()
            event_obj = json.loads(ref_event)
            event_obj['pull_request']['body'] = f'<!-- {prefix}_SHA256={h.sha(ref_raw)} -->\nSynthetic Reference input.\n'
            ref_event = p.canonical(event_obj)
            p.admit_reference_inputs(ref)
            selected = p.selected_build_bytes(ref, build_archive)
            self.assertEqual(len(selected['files']), 31)
            architecture, wire = h.synthetic_architecture()
            self.assertEqual(len(wire), 1730)
            arch_packet = {**architecture,'inputs/fixture.rom':rom,
                'inputs/fixture.json':fixture,'js/stdout':wire,'js/stderr':b'',
                'bochs/stdout':p.expected_header()+wire,'bochs/stderr':b'',
                'bochs/frame.original':wire}
            self.assertTrue(reader.authored_architecture(arch_packet)['definedByteAgreementObserved'])
            ref_edges = h.ReferenceEdges(selected, build_archive, architecture, wire)
            ref_value, ref_roles = p.collect_reference(ref_raw, ref_event, ref_env, ref_edges)
            self.assertTrue(ref_value['complete'], ref_value['firstFailure'])
            self.assertEqual(len(ref_roles), 29)
            ref_unit = 'bw-bochs-reference-v1-123456-1.service'
            ref_context = {'env':ref_env,'invoker':{'uid':1001,'gid':1000},'sourceRoot':'/mock/source'}
            ref_paths = {'unit':ref_unit,'work':Path('/mock/reference-work'),
                         'output':Path('/mock/reference-output')}
            ref_status = h.synthetic_status('reference', ref_unit, ref_context)
            def ref_status_read(path, _cap, **_kw):
                self.assertEqual(path, ref_paths['work']/'service-status.original.json')
                return ref_status, {}
            with mock.patch.object(p, 'REFERENCE_ENABLED', True), \
                 mock.patch.object(p, 'sealed_write'), \
                 mock.patch.object(p, 'retained_output_roles', return_value=copy.deepcopy(ref_roles)), \
                 mock.patch.object(p, 'read_regular', side_effect=ref_status_read), \
                 mock.patch.object(p, 'write_work_roles'):
                ref_outside, final = p.finish_cli('reference', ref_context, ref_raw, ref_event,
                    ref_paths, provider_factory=lambda _r,_c,_p:ref_edges,
                    service_status=ref_paths['work']/'service-status.original.json')
            self.assertEqual(ref_outside['cleanupExitCode'], 0)
            self.assertEqual(len(final), 32)
            self.assertEqual(set(final), reader.REFERENCE_ROLES)
            grade = reader.reference_original_v2(final, ref_raw, ref_event)
            self.assertTrue(grade['buildOriginalJoined'])
            self.assertTrue(grade['architectureObserved'])
            self.assertFalse(grade['actualRunApproved'])
            def refused(name, mutate):
                packet = copy.deepcopy(final)
                mutate(packet)
                packet['manifest.json'] = p.canonical(p.original_manifest({
                    key:value for key,value in packet.items() if key!='manifest.json'}))
                with self.assertRaises(reader.Refusal, msg=name):
                    reader.reference_original_v2(packet, ref_raw, ref_event)
            refused('foreign Build artifact repository', lambda packet:
                _connected_edit_json(packet, 'original.json', lambda row:
                    row['observations']['build']['readback'].update(artifactRepositoryId=False)))
            refused('authored write journal', lambda packet:
                _connected_edit_json(packet, 'js/writes.json', lambda rows:
                    rows[-1].update(after=rows[-1]['after']^1)))
            refused('host input cleanup hash', lambda packet:
                _connected_edit_json(packet, 'outside.original.json', lambda row:
                    row['hostRuntimeCleanup'].update(sha256='0'*64)))
            refused('output census extent', lambda packet:
                _connected_edit_json(packet, 'original.json', lambda row: (
                    row['observations']['bochs']['outputCensus']['files']['bochs.log'].__setitem__('size',
                        row['observations']['bochs']['outputCensus']['files']['bochs.log']['size'] + 1),
                    row['observations']['bochs']['outputCensus'].__setitem__('aggregateBytes',
                        row['observations']['bochs']['outputCensus']['aggregateBytes'] + 1))))
            def missing_log(packet):
                packet['bochs/log'] = b''
                row = json.loads(packet['original.json'])
                row['observations']['bochs']['log'] = {'path':'bochs/log','bytes':0,
                    'sha256':h.sha(b'')}
                row['observations']['bochs']['outputCensus']['files']['bochs.log']['size'] = 0
                row['observations']['bochs']['outputCensus']['aggregateBytes'] -= len(final['bochs/log'])
                packet['original.json'] = p.canonical(row)
            refused('missing output original', missing_log)
            def frame_copy_drift(packet):
                frame = bytearray(packet['bochs/frame.original'])
                frame[len(reader.FRAME_MAGIC) + 0x70c0 - 0x7000 + 6] ^= 1
                frame = bytes(frame)
                packet['bochs/frame.original'] = frame
                packet['bochs/stdout'] = p.expected_header() + frame
                row = json.loads(packet['original.json'])
                row['observations']['stop']['frameSha256'] = h.sha(frame)
                row['observations']['bochs']['frame']['sha256'] = h.sha(frame)
                row['observations']['bochs']['stdout']['sha256'] = h.sha(packet['bochs/stdout'])
                row['phases'][1]['stdout']['sha256'] = h.sha(packet['bochs/stdout'])
                packet['bochs/process.json'] = p.canonical(row['phases'][1])
                packet['original.json'] = p.canonical(row)
            refused('one frame copy padding drift', frame_copy_drift)
            archive = p.pack_zip(final, archive_cap=96<<20, expanded_cap=384<<20,
                member_cap=6144, modes={name:0o644 for name in final})
            source = json.loads(final['source.before.json'])
            repo = {'id':987,'full_name':p.REPOSITORY,'fork':False}
            steps = [{'number':i,'name':name,'status':'completed','conclusion':'success'}
                     for i,name in enumerate(reader.REFERENCE_USER_STEPS,1)]
            expectation = {'schema':'bw.bochs-ring3.reference-expectation.v1',
                'repository':p.REPOSITORY,'pullRequest':700,'runId':'123456',
                'runAttempt':1,'jobId':333,'jobName':'bochs-ring3-reference-v1',
                'eventName':'pull_request','actor':'CrispStrobe',
                'head':ref['source']['head'],'tree':ref['source']['tree'],
                'workflowCommit':source['workflowCommit'],
                'workflowTree':source['workflowTree'],
                'workflowFileSha256':source['workflowFileSha256'],
                'requestSha256':h.sha(final['request.original.json']),
                'eventSha256':h.sha(final['event.original.json']),
                'artifactId':444,'archiveBytes':len(archive),
                'archiveSha256':h.sha(archive),'conclusion':'success','steps':steps}
            run = {'id':123456,'run_attempt':1,'head_sha':ref['source']['head'],
                'event':'pull_request','status':'completed','conclusion':'success',
                'repository':repo,'head_repository':copy.deepcopy(repo),
                'actor':{'login':'CrispStrobe'},'path':p.WORKFLOW,
                'pull_requests':[{'number':700,
                    'head':{'sha':ref['source']['head'],'repo':{'id':987}},
                    'base':{'ref':'master','repo':{'id':987}}}]}
            jobs = {'total_count':1,'jobs':[{'id':333,'run_id':123456,
                'head_sha':ref['source']['head'],'name':'bochs-ring3-reference-v1',
                'status':'completed','conclusion':'success','steps':steps}]}
            artifacts = {'total_count':1,'artifacts':[{'id':444,
                'name':'i80386-bochs-ring3-reference-v1-originals',
                'size_in_bytes':len(archive),'digest':'sha256:'+h.sha(archive),
                'expired':False,'workflow_run':{'id':123456,
                    'head_sha':ref['source']['head'],
                    'repository_id':987,'head_repository_id':987}}]}
            args = (archive,p.canonical(expectation),run,jobs,artifacts,
                b'synthetic bounded official job log; no API request\n')
            official = reader.reference_official_v2(*args)
            self.assertTrue(official['officialMetadataBound'])
            self.assertFalse(official['actualRunApproved'])
            cli_originals = {'archive':archive,'expectation':p.canonical(expectation),
                'run':p.canonical(run),'jobs':p.canonical(jobs),
                'artifacts':p.canonical(artifacts),'job-log':args[-1]}
            argv = ['--route','reference','--archive','archive']
            argv += [word for key in ('expectation','run','jobs','artifacts','job-log')
                     for word in ('--'+key,key)]
            captured = io.BytesIO()
            with mock.patch.object(reader, 'REFERENCE_READER_ENABLED', True), \
                 mock.patch.object(reader, 'cli_regular',
                     side_effect=lambda path,_cap:cli_originals[path]), \
                 mock.patch.object(reader.sys, 'stdout', SimpleNamespace(buffer=captured)):
                self.assertEqual(reader.main(argv), 0)
            self.assertTrue(json.loads(captured.getvalue())['officialMetadataBound'])
            self.assertFalse(json.loads(captured.getvalue())['actualRunApproved'])
            official_cuts = {
                'foreign repository':lambda a:a[2]['head_repository'].update(id=988),
                'fork':lambda a:a[2]['repository'].update(fork=True),
                'other PR':lambda a:a[2]['pull_requests'][0].update(number=701),
                'artifact owner':lambda a:a[4]['artifacts'][0]['workflow_run'].update(repository_id=988),
                'required step':lambda a:a[3]['jobs'][0]['steps'][2].update(conclusion='failure'),
                'artifact digest':lambda a:a[4]['artifacts'][0].update(digest='sha256:'+'0'*64),
            }
            for label,edit in official_cuts.items():
                changed = copy.deepcopy(args)
                edit(changed)
                with self.assertRaises(reader.Refusal, msg=label):
                    reader.reference_official_v2(*changed)
        finally:
            restore()

    def test_reader_cli_disabled_and_bounded_files(self):
        h = _connected_bochs_mocks()
        reader = h.reader
        for route,flag in (('toolchain','TOOLCHAIN_READER_ENABLED'),
                           ('build','BUILD_READER_ENABLED'),
                           ('reference','REFERENCE_READER_ENABLED')):
            self.assertIs(getattr(reader, flag), True)
            with mock.patch.object(reader, flag, False), \
                 mock.patch.object(reader.os, 'open',
                                   side_effect=AssertionError('disabled input IO')), \
                 mock.patch.object(reader.sys, 'stderr', io.StringIO()):
                self.assertEqual(reader.main(['--route',route,
                                              '--archive','unopened']), 1)
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            empty = Path(directory) / 'empty'
            empty.write_bytes(b'')
            with self.assertRaises(reader.Refusal):
                reader.cli_regular(str(empty), 1)
            ordinary = Path(directory) / 'ordinary'
            ordinary.write_bytes(b'AB')
            with self.assertRaises(reader.Refusal):
                reader.cli_regular(str(ordinary), 1)
            link = Path(directory) / 'link'
            link.symlink_to(ordinary)
            with self.assertRaises(OSError):
                reader.cli_regular(str(link), 10)


def _connected_edit_json(packet, name, edit):
    row = json.loads(packet[name])
    edit(row)
    packet[name] = producer.canonical(row)



class NodeV2Kernel(NodeKernel):
    def scandir(self,path):
        root=self.fds[path] if type(path) is int else str(path)
        names=[SimpleNamespace(name=name[len(root)+1:]) for name in self.nodes
            if name.startswith(root+'/') and '/' not in name[len(root)+1:]]
        class Scan:
            def __init__(self):self.items=iter(names)
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def __iter__(self):return self
            def __next__(self):return next(self.items)
        return Scan()
    def unlink(self,name,*,dir_fd):
        path=self.name(name,dir_fd);self.events.append(('unlink',path));del self.nodes[path]
    def rmdir(self,path):
        path=str(path)
        producer.need(not any(x.startswith(path+'/') for x in self.nodes),'fake empty directory')
        self.events.append(('rmdir',path));del self.nodes[path]
    def hooks(self):
        stack=super().hooks()
        for name in ('scandir','unlink','rmdir'):stack.enter_context(mock.patch.object(producer.os,name,getattr(self,name)))
        return stack


def bootstrap_v2(uid=1001,gid=1001):
    return {'schema':'bw.bochs-ring3.bootstrap-caller.v1','uidArgument':str(uid),'gidArgument':str(gid),
            'sudoUid':str(uid),'sudoGid':str(gid)}


class NodeStageV2Controls(unittest.TestCase):
    def exercise(self,*,bad_owner=None,fault=None,route='toolchain-v2',stage_type=None):
        raw=synthetic_elf();env={'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'}
        real=(producer.NODE_BYTES,producer.NODE_SHA256)
        with mock.patch.object(producer,'NODE_BYTES',len(raw)),mock.patch.object(producer,'NODE_SHA256',producer.sha256(raw)):
            stage=(stage_type or producer.NodeStageCopyV2)(route,env,(1001,1001),bootstrap_v2())
            kernel=NodeV2Kernel(stage.path,raw,fault=fault)
            if bad_owner is not None:kernel.nodes[producer.NODE_PATH].update(bad_owner)
            with kernel.hooks():
                try:
                    if bad_owner is not None or fault:
                        with self.assertRaises(ValueError):stage.copy()
                    else:
                        stage.copy();stage.verify_after(full_hash=route!='toolchain-v2')
                        producer.check_node_stage_v2(stage.facts,route,env,after=True)
                finally:stage.close()
            self.assertEqual(kernel.fds,{})
        self.assertEqual((producer.NODE_BYTES,producer.NODE_SHA256),real)
        return stage.facts,kernel,env
    def test_genuine_copy_distinct_cache_group_and_actual_caller(self):
        facts,kernel,_env=self.exercise()
        self.assertEqual(facts['invoker'],{'uid':1001,'gid':1001})
        self.assertEqual(facts['sourceBefore'][2:5],[0o100777,1001,1000])
        self.assertEqual(facts['file'][2:5],[0o100555,0,0])
        self.assertEqual(facts['schema'],'bw.bochs-ring3.node-stage.v2')
        self.assertFalse(facts['checkedAfter']['hashRead'])
        self.assertEqual(facts['sourceBytesRead'],facts['bytesCopied'])
        self.assertEqual(facts['bootstrapCredentials'],bootstrap_v2())
        self.assertEqual([x for x in kernel.events if x[0]=='open' and x[1]==producer.NODE_PATH], [('open',producer.NODE_PATH)])
    def test_wrong_provider_mode_or_pair_refuses_before_copy_and_publication(self):
        for change in ({'uid':1002},{'gid':1001},{'uid':0,'gid':0},{'mode':0o100755},{'mode':0o104777}):
            with self.subTest(change=change):
                facts,kernel,_env=self.exercise(bad_owner=change)
                self.assertEqual(facts['sourceBytesRead'],0);self.assertEqual(facts['bytesCopied'],0)
                self.assertFalse(facts['filePublished'] or facts['directoryPublished'])
                self.assertFalse(any(x[0]=='write' for x in kernel.events))
    def test_build_stage_reopens_and_hashes_after_use(self):
        facts,_kernel,_env=self.exercise(route='build')
        self.assertTrue(facts['checkedAfter']['hashRead'])
        self.assertEqual(facts['checkedAfter']['sha256'],facts['readbackSha256'])
    def test_v2_failures_preserve_first_secondary_and_partial_stage(self):
        for fault in ('short-copy','source-read','file-publication','record-write'):
            with self.subTest(fault=fault):
                facts,_kernel,_env=self.exercise(fault=fault)
                self.assertIsNotNone(facts['firstFailure'])
                if fault=='source-read':self.assertIn('secondary-source-close',[r['message'] for r in facts['secondary']])
    def cleanup(self,*,empty=False,unknown=False,forged_plan=False):
        facts,kernel,env=self.exercise(bad_owner={'gid':1001} if empty else None)
        root=str(Path(facts['stagePath']).parent);inner={'observations':{'nodeStage':facts}}
        if unknown:kernel.add(root+'/unknown',0o100600,b'owned but unknown')
        before=len(kernel.events)
        with kernel.hooks():
            if unknown:
                with self.assertRaises(ValueError):producer.node_cleanup_wire_plan_v2('toolchain-v2',env,inner)
                result=None;plan=None
            else:
                plan=producer.node_cleanup_wire_plan_v2('toolchain-v2',env,inner)
                self.assertFalse(any(e[0] in ('chmod','unlink','rmdir') for e in kernel.events[before:]))
                if forged_plan:plan['reservedBytes']=1
                result=producer.cleanup_node_stage_v2('toolchain-v2',env,inner,plan)
        return facts,kernel,plan,result,kernel.events[before:]
    def test_failed_cache_created_empty_stage_gets_live_owned_cleanup_only(self):
        facts,kernel,plan,value,events=self.cleanup(empty=True)
        self.assertEqual(plan['stageState'],'created-empty');self.assertTrue(value['complete'])
        self.assertIsNone(value['firstFailure']);self.assertIsNotNone(facts['firstFailure'])
        self.assertEqual(value['authority']['names'],[])
        self.assertEqual(value['authority']['directoryHeld'][:5],value['authority']['directoryNamed'][:5])
        self.assertFalse(value['after']['exists']);self.assertNotIn(plan['nodePath'],kernel.nodes)
        self.assertFalse(any(e[0]=='unlink' for e in events))
    def test_published_stage_complete_owned_cleanup_and_final_wire_bound(self):
        _facts,kernel,plan,value,events=self.cleanup()
        self.assertEqual(plan['stageState'],'published');self.assertTrue(value['complete'])
        self.assertEqual(value['authority']['names'],['node','stage.json'])
        self.assertEqual([e[0] for e in events if e[0] in ('chmod','unlink','rmdir')],['chmod','unlink','unlink','rmdir'])
        self.assertLessEqual(len(producer.canonical(value)),plan['reservedBytes'])
        self.assertLessEqual(plan['reservedBytes'],16384)
    def test_unknown_member_or_forged_reservation_has_zero_effects(self):
        for opts in ({'unknown':True},{'forged_plan':True}):
            with self.subTest(opts=opts):
                _facts,_kernel,_plan,value,events=self.cleanup(**opts)
                self.assertFalse(any(e[0] in ('chmod','unlink','rmdir') for e in events))
                if value is not None:self.assertFalse(value['complete'])
    def test_dynamic_bootstrap_is_independent_of_provider_and_refuses_disagreement(self):
        self.assertEqual(producer.bootstrap_caller_scalars(bootstrap_v2(2001,2002),{'uid':2001,'gid':2002}),bootstrap_v2(2001,2002))
        wrong=bootstrap_v2();wrong['sudoGid']='1000'
        with self.assertRaises(ValueError):producer.NodeStageCopyV2('toolchain-v2',{'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'},(1001,1001),wrong)
    def test_new_current_route_inactive_before_every_edge(self):
        self.assertIs(producer.TOOLCHAIN_V2_ENABLED,False)
        for mode in ('--admit','--work','--run-service','--capture-service-status','--finish'):
            edge=mock.Mock(side_effect=AssertionError('real edge forbidden'))
            with mock.patch.object(producer,'load_cli_context',edge),mock.patch.object(producer,'admit_cli',edge),self.assertRaisesRegex(ValueError,'inactive'):
                producer.main([mode,'--route','toolchain-v2'],environment={},provider_factory=edge)
            edge.assert_not_called()



def synthetic_node_stage_v2(route='toolchain-v2',*,checked=True,full_hash=False):
    """Manufactured OS-provider readback only; genuine copy has separate tests."""
    old='toolchain' if route=='toolchain-v2' else route
    facts=synthetic_node_stage(old,checked=checked,full_hash=full_hash)
    old_root=str(Path(facts['stagePath']).parent)
    env={'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'}
    root=str(producer.route_paths(route,env)['node'])
    def rewrite(value):
        if type(value) is str:return value.replace(old_root,root).replace('bw.bochs-ring3.node-installation.v1','bw.bochs-ring3.node-installation.v2')
        if type(value) is list:return [rewrite(x) for x in value]
        if type(value) is dict:return {k:rewrite(v) for k,v in value.items()}
        return value
    facts=rewrite(facts);facts['schema']='bw.bochs-ring3.node-stage.v2'
    facts['invoker']={'uid':1001,'gid':1001};facts['bootstrapCredentials']=bootstrap_v2()
    record=json.loads(facts['record']['text']);raw=producer.canonical(record)
    facts['record'].update(text=raw.decode(),bytes=len(raw),sha256=producer.sha256(raw))
    facts['record']['metadata'][6]=len(raw)
    return facts


def toolchain_v2_sample(*, failed=False):
    """Genuine V2 collect/finish; only OS, service and acquisition edges fake."""
    request,raw,event,env=synthetic_request('toolchain-v2')
    request['schema']='bw.bochs-ring3.toolchain-request.v2';raw=producer.canonical(request)
    event=json.loads(event);prefix=producer.ROUTES['toolchain-v2'][2]
    env.update({prefix+'_SHA256':producer.sha256(raw),prefix+'_B64':base64.b64encode(raw).decode(),
        'GITHUB_ACTIONS':'true','GITHUB_WORKSPACE':'/mock/workspace','GITHUB_EVENT_PATH':'/mock/event.json'})
    event['pull_request']['body']='<!-- '+prefix+'_SHA256='+producer.sha256(raw)+' -->\nMock metadata V2 only.\n'
    event=producer.canonical(event)
    class Edges(InventoryEdges):
        def __init__(self):
            super().__init__();self.node=synthetic_node_stage_v2()
        def node_stage(self):
            if not failed:return copy.deepcopy(self.node)
            self.stage=producer.NodeStageCopyV2('toolchain-v2',env,(1001,1001),bootstrap_v2())
            self.node_kernel=NodeV2Kernel(self.stage.path,synthetic_elf())
            self.node_kernel.nodes[producer.NODE_PATH].update(uid=1002)
            actual=self.node_kernel.info
            def info(path):
                value=actual(path)
                if path==producer.NODE_PATH:value.st_size=producer.NODE_BYTES
                return value
            self.node_kernel.info=info
            with self.node_kernel.hooks():return self.stage.copy()
        def close(self):
            if hasattr(self,'stage'):
                with self.node_kernel.hooks():self.stage.close()
        def node_after(self,*,full_hash):
            assert full_hash is False
            return copy.deepcopy(self.node)
        def resources(self,route):
            assert route=='toolchain-v2'
            unit=producer.route_paths(route,env)['unit'];root='/sys/fs/cgroup/system.slice/'+unit
            raw_limits={'cpu.max':'100000 100000\n','memory.max':'536870912\n','memory.swap.max':'0\n','pids.max':'32\n'}
            common={'cgroup.events':'populated 1\nfrozen 0\n','cpu.stat':'usage_usec 1\nuser_usec 1\nsystem_usec 0\n'}
            statrow=lambda ino:synthetic_stat(ino,4096,0o40755)
            parent={'unitPath':root,'unitIdentity':statrow(1),'controllerPath':root+'/controller','controllerIdentity':statrow(2),
                'unitProcs':'','controllerProcs':'100\n','availableBefore':'cpu io memory pids\n','enabledBefore':'io\n',
                'write':'+cpu +memory +pids\n','availableAfter':'cpu io memory pids\n','enabledAfter':'cpu io memory pids\n'}
            return {'schema':'bw.bochs-ring3.resources.v2','unit':unit,'pid':100,'uid':0,'gid':0,
                'unitRoot':{'path':root,'directory':statrow(1),'children':['controller'],
                    'files':{**raw_limits,**common,'cgroup.procs':'','cgroup.stat':'nr_descendants 1\nnr_dying_descendants 0\n'}},
                'controller':{'path':root+'/controller','directory':statrow(2),'children':[],
                    'files':{'cpu.max':'max 100000\n','memory.max':'max\n','memory.swap.max':'max\n','pids.max':'max\n',
                        **common,'cgroup.procs':'100\n','cgroup.stat':'nr_descendants 0\nnr_dying_descendants 0\n'}},
                'procCgroup':'0::/system.slice/'+unit+'/controller\n',
                'procStat':'100 (python3) S '+' '.join(['0']*50)+'\n',
                'procStatus':'Pid:\t100\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\nThreads:\t1\n',
                'parentControl':parent}
        def observer(self,value):
            return producer.observer_facts_v2(value,env,pid=100,uid=0,gid=0,started_ns=1,ended_ns=2,
                invoker=self.node['invoker'],bootstrap=self.node['bootstrapCredentials'])
        def prepare_kernel(self,inner):
            facts=producer.stage_facts_v2(inner);root=str(Path(facts['stagePath']).parent)
            kernel=NodeV2Kernel(root,b'mock DATA unused in cleanup')
            for parent,row in facts['parents'].items():
                kernel.nodes[parent].update(ino=row['after'][1],mode=row['after'][2],mtime=row['after'][7],ctime=row['after'][8])
            directory=facts.get('directory') or facts.get('directoryAfterFailure') or facts['directoryInitial'];kernel.add(root,directory[2]);kernel.nodes[root].update(ino=directory[1],mtime=directory[7],ctime=directory[8])
            members=[]
            if facts.get('file') is not None:members.append(('node',facts['file']))
            if facts.get('record') is not None:members.append(('stage.json',facts['record']['metadata']))
            for name,row in members:
                kernel.add(root+'/'+name,row[2],b'mock');kernel.nodes[root+'/'+name].update(ino=row[1],mtime=row[7],ctime=row[8],reportedSize=row[6])
            original_info=kernel.info
            def info(path):
                value=original_info(path)
                if 'reportedSize' in kernel.nodes[path]:value.st_size=kernel.nodes[path]['reportedSize']
                return value
            kernel.info=info;self.node_kernel=kernel
        def cleanup(self,inner,*,outer=None):
            self.prepare_kernel(inner)
            with self.node_kernel.hooks():self.node_plan=producer.node_cleanup_wire_plan_v2('toolchain-v2',env,inner)
            kernel=SimpleNamespace(_directory=mock.Mock(side_effect=FileNotFoundError(2,'mock absent selected unit')))
            return producer.cleanup_owned_cgroups('toolchain-v2',env,inner,kernel,outer_base=outer,
                input_plan=self.node_plan,clock=iter((1,2,3)).__next__)
        def node_cleanup(self,inner):
            with self.node_kernel.hooks():return producer.cleanup_node_stage_v2('toolchain-v2',env,inner,self.node_plan)
    edges=Edges();value,roles=producer.collect_toolchain_v2(raw,event,env,edges)
    assert value['complete'] is (not failed),value['firstFailure']
    unit=producer.route_paths('toolchain-v2',env)['unit'];paths=producer.route_paths('toolchain-v2',env)
    context={'env':env,'sourceRoot':'/mock/source','invoker':{'uid':1001,'gid':1001},'bootstrapCredentials':bootstrap_v2()}
    h=_connected_bochs_mocks();status=h.synthetic_status('toolchain-v2',unit,context)
    if failed:
        record=json.loads(status);client=record['client']
        stdout=base64.b64decode(client['stdoutBase64']).replace(b'result: success',b'result: exit-code').replace(b'code=exited/status=0',b'code=exited/status=1')
        client['stdoutBase64']=base64.b64encode(stdout).decode();process=client['process']
        process.update(exitCode=1,waitStatus=256,firstFailure=producer.failure(producer.Refusal('ordinary child completed exit0'),'child-capture'))
        process['stdout'].update(bytes=len(stdout),sha256=producer.sha256(stdout))
        record['receipt']=producer.service_receipt(stdout,b'',1,unit)
        status=producer.canonical(record)

    with mock.patch.object(producer,'TOOLCHAIN_V2_ENABLED',True),mock.patch.object(producer,'sealed_write'), \
         mock.patch.object(producer,'retained_output_roles',return_value=copy.deepcopy(roles)), \
         mock.patch.object(producer,'read_regular',return_value=(status,{})),mock.patch.object(producer,'write_work_roles'):
        outside,roles=producer.finish_cli('toolchain-v2',context,raw,event,paths,provider_factory=lambda *_:edges,
            service_status=paths['work']/'service-status.original.json',current=True)
    assert outside['cleanupExitCode']==(1 if failed else 0),outside['firstFailure']
    return request,raw,event,env,edges,value,outside,roles


class MetadataV2Controls(unittest.TestCase):
    def test_genuine_metadata_collect_and_finish_emit_closed16(self):
        _request,raw,event,_env,_edges,value,outside,roles=toolchain_v2_sample()
        self.assertEqual(len(roles),16);self.assertEqual(roles['request.original.json'],raw)
        self.assertEqual(roles['event.original.json'],event)
        self.assertTrue(value['complete']);self.assertEqual(outside['cleanupExitCode'],0)
        self.assertEqual(json.loads(roles['process.original.json'])['schema'],'bw.bochs-ring3.toolchain-observer.v2')
        self.assertEqual(json.loads(roles['node-stage.original.json'])['bootstrapCredentials'],bootstrap_v2())
        self.assertLessEqual(len(producer.canonical(outside)),16384)
        self.assertFalse(any(value['authority'][key] for key in ('compilerExecuted','guestExecuted','actualRunApproved','guestApproved')))
    def test_failed_inventory_clean_empty_stage_remains_negative(self):
        _request,raw,event,_env,_edges,value,outside,roles=toolchain_v2_sample(failed=True)
        self.assertFalse(value['complete']);self.assertIsNotNone(value['firstFailure'])
        self.assertEqual(outside['cleanupExitCode'],1);self.assertFalse(outside['innerComplete'])
        self.assertTrue(outside['manual']['complete']);self.assertTrue(outside['nodeCleanup']['complete'])
        self.assertEqual(outside['nodeCleanup']['stageState'],'created-empty')
        self.assertFalse(outside['nodeCleanup']['after']['exists'])
        self.assertEqual(value['observations']['nodeStage']['sourceBytesRead'],0)
        self.assertIsNone(value['observations']['nodeStage']['copiedSha256'])
        spec=importlib.util.spec_from_file_location('independent_V2_failed',HERE/'reader.py')
        reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
        with self.assertRaises(reader.Refusal):reader.toolchain_original_v2(roles,raw,event)

    def test_explicit_metadata_identity_rejects_boolean_or_V1_projection(self):
        expected={'schema':'bw.bochs-ring3.toolchain-inventory-reference.v2','jobName':'bochs-ring3-toolchain-inventory-v2','version':2}
        self.assertEqual(producer.metadata_v2_identity(expected),expected)
        for key,value in (('version',True),('version',1),('schema','bw.bochs-ring3.toolchain-inventory-reference.v1'),('jobName','bochs-ring3-toolchain-inventory-v1')):
            wrong={**expected,key:value}
            with self.assertRaises(ValueError):producer.metadata_v2_identity(wrong)



class V2BoundaryControls(unittest.TestCase):
    def test_live_plan_read_primary_and_member_close_secondary_retained(self):
        facts,kernel,env=NodeStageV2Controls().exercise()
        inner={'observations':{'nodeStage':facts}}
        with kernel.hooks():plan=producer.node_cleanup_wire_plan_v2('toolchain-v2',env,inner)
        original_fstat,original_close=kernel.fstat,kernel.close
        def fstat(fd):
            if kernel.fds[fd]==facts['stagePath']:raise OSError('first-live-member-read')
            return original_fstat(fd)
        def close(fd):
            name=kernel.fds[fd];original_close(fd)
            if name==facts['stagePath']:raise OSError('secondary-live-member-close')
        kernel.fstat,kernel.close=fstat,close;before=len(kernel.events)
        with kernel.hooks():value=producer.cleanup_node_stage_v2('toolchain-v2',env,inner,plan)
        self.assertFalse(value['complete']);self.assertEqual(value['firstFailure']['message'],'first-live-member-read')
        self.assertIn('secondary-live-member-close',[r['message'] for r in value['secondary']])
        self.assertFalse(any(e[0] in ('chmod','unlink','rmdir') for e in kernel.events[before:]))
        self.assertEqual(kernel.fds,{})
        # Counterfactual source helper that drops carried close facts proves
        # this control detects the first V2 retention gap, not only a verdict.
        import ast
        source=(HERE/'run.py').read_text()
        function=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='cleanup_node_stage_v2')
        segment=ast.get_source_segment(source,function)
        carried="        for extra in getattr(exc, 'bochs_secondary', []):\n            if len(value['secondary']) < SECONDARY_LIMIT:\n                value['secondary'].append(extra)\n"
        self.assertEqual(segment.count(carried),1)
        namespace=dict(vars(producer));exec(compile(segment.replace(carried,''),'V2-close-retention-counterfactual.py','exec'),namespace)
        with kernel.hooks():weak=namespace['cleanup_node_stage_v2']('toolchain-v2',env,inner,plan)
        self.assertEqual(weak['firstFailure']['message'],'first-live-member-read')
        self.assertNotIn('secondary-live-member-close',[r['message'] for r in weak['secondary']])
        self.assertEqual(kernel.fds,{})

    def test_genuine_source_mutants_expose_caller_conflation_and_arbitrary_owner(self):
        import ast
        module_source=(HERE/'run.py').read_text()
        node=next(n for n in ast.parse(module_source).body if isinstance(n,ast.ClassDef) and n.name=='NodeStageCopyV2')
        authored=ast.get_source_segment(module_source,node)
        predicate='before[2:5] == [stat.S_IFREG | 0o777, NODE_CACHE_UID_V2, NODE_CACHE_GID_V2]'
        self.assertEqual(authored.count(predicate),1)
        raw=synthetic_elf();env={'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'}
        for mode,replacement in (('caller-GID',"tuple(before[3:5]) in ((0,0),self.invoker)"),('arbitrary-owner','True')):
            with self.subTest(mode=mode),mock.patch.object(producer,'NODE_BYTES',len(raw)),mock.patch.object(producer,'NODE_SHA256',producer.sha256(raw)):
                namespace=dict(vars(producer));exec(compile(authored.replace(predicate,replacement),'authored-V2-source-mutant.py','exec'),namespace)
                stage=namespace['NodeStageCopyV2']('toolchain-v2',env,(1001,1001),bootstrap_v2())
                kernel=NodeV2Kernel(stage.path,raw)
                if mode=='arbitrary-owner':kernel.nodes[producer.NODE_PATH].update(uid=31337,gid=31338)
                with kernel.hooks():
                    try:
                        if mode=='caller-GID':
                            with self.assertRaises(ValueError):stage.copy()
                            self.assertEqual(stage.facts['sourceBytesRead'],0)
                        else:
                            stage.copy();self.assertTrue(stage.facts['filePublished'])
                            with self.assertRaises(ValueError):producer.check_node_stage_v2(stage.facts,'toolchain-v2',env)
                    finally:stage.close()
                self.assertEqual(kernel.fds,{})
        # Actual production class and source pins were never replaced.
        self.assertEqual(producer.NODE_BYTES,124827920)
        self.assertEqual(producer.NODE_CACHE_GID_V2,1000)
    def test_current_Build_Reference_and_reader_guards_refuse_before_IO(self):
        spec=importlib.util.spec_from_file_location('independent_current_v2_disabled',HERE/'reader.py')
        reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
        for route,flag in (('build','BUILD_CURRENT_V2_ENABLED'),('reference','REFERENCE_CURRENT_V2_ENABLED')):
            self.assertIs(getattr(producer,flag),False)
            for mode in ('--admit','--work','--run-service','--capture-service-status','--finish'):
                edge=mock.Mock(side_effect=AssertionError('input edge'))
                with mock.patch.object(producer,'admit_cli',edge),mock.patch.object(producer,'load_cli_context',edge),self.assertRaisesRegex(ValueError,'inactive'):
                    producer.main([mode,'--route',route],environment={},provider_factory=edge)
                edge.assert_not_called()
        for route in ('toolchain-v2','build-current-v2','reference-current-v2'):
            edge=mock.Mock(side_effect=AssertionError('reader input edge'))
            with mock.patch.object(reader,'cli_regular',edge),self.assertRaisesRegex(reader.Refusal,'inactive'):
                reader.cli_grade(route,{'archive':'unreadable'})
            edge.assert_not_called()
    def test_independent_V2_reader_positive_and_coherently_rehashed_cuts(self):
        _request,raw,event,_env,_edges,_value,_outside,roles=toolchain_v2_sample()
        spec=importlib.util.spec_from_file_location('independent_current_v2_metadata',HERE/'reader.py')
        reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
        report=reader.toolchain_original_v2(roles,raw,event)
        self.assertIs(report['actualRunApproved'],False);self.assertIs(report['guestApproved'],False)
        def rehash(packet):packet['manifest.json']=producer.canonical(producer.original_manifest({n:b for n,b in packet.items() if n!='manifest.json'}))
        for mode in ('cache-GID','caller-scalar','reserved-budget','live-directory','old-event'):
            with self.subTest(mode=mode):
                packet=copy.deepcopy(roles)
                stage=json.loads(packet['node-stage.original.json']);inner=json.loads(packet['original.json'])
                manual=json.loads(packet['cleanup.original.json']);outside=json.loads(packet['outside.original.json'])
                if mode=='cache-GID':
                    for key in ('sourceBefore','sourceAfter','sourceNamedAfter'):stage[key][4]=1001
                if mode=='caller-scalar':stage['bootstrapCredentials']['sudoGid']='1000'
                if mode in ('cache-GID','caller-scalar'):
                    packet['node-stage.original.json']=producer.canonical(stage);inner['observations']['nodeStage']=stage
                    manual['inputPlan']['stageSha256']=producer.sha256(packet['node-stage.original.json'])
                if mode=='reserved-budget':manual['inputPlan']['reservedBytes']=1
                if mode=='live-directory':outside['nodeCleanup']['authority']['directoryNamed'][1]+=1
                if mode=='old-event':
                    changed=json.loads(event);changed['label']['name']='x86-bochs-ring3-toolchain-inventory-v1'
                    packet['event.original.json']=producer.canonical(changed);inner['eventSha256']=producer.sha256(packet['event.original.json'])
                outside['manual']=manual;outside['nodeCleanup']['planSha256']=producer.sha256(producer.canonical(manual['inputPlan']))
                packet['original.json']=producer.canonical(inner);packet['cleanup.original.json']=producer.canonical(manual)
                packet['outside.original.json']=producer.canonical(outside);rehash(packet)
                with self.assertRaises(reader.Refusal):reader.toolchain_original_v2(packet,raw,packet['event.original.json'])

class ConnectedCurrentV2Controls(unittest.TestCase):
    def test_genuine_current_build31_reference32(self):
        h = _connected_bochs_mocks()
        p, r = h.producer, h.reader
        c = SimpleNamespace(bootstrap_v2=bootstrap_v2, synthetic_node_stage_v2=synthetic_node_stage_v2, NodeV2Kernel=NodeV2Kernel, synthetic_request=synthetic_request)
        META = {'schema':'bw.bochs-ring3.toolchain-inventory-reference.v2', 'jobName':'bochs-ring3-toolchain-inventory-v2','version':2}
        ENV = {'GITHUB_RUN_ID':'123456','GITHUB_RUN_ATTEMPT':'1'}
        BOOTSTRAP = bootstrap_v2(1001,1000)
        CALLER = {'uid':1001,'gid':1000}
        def node_stage(route):
            facts = c.synthetic_node_stage_v2(route, checked=True, full_hash=True)
            facts['invoker'] = dict(CALLER)
            facts['bootstrapCredentials'] = dict(BOOTSTRAP)
            return facts

        class V2Cleanup:
            def node_stage(self):
                self.v2stage = node_stage(self.v2route)
                self.node_stage_value = self.v2stage
                return copy.deepcopy(self.v2stage)
            def node_after(self, *, full_hash):
                assert full_hash
                return copy.deepcopy(self.v2stage)
            def prepare_node_kernel(self, inner):
                facts = p.stage_facts_v2(inner)
                root = str(pathlib.Path(facts['stagePath']).parent)
                kernel = c.NodeV2Kernel(root, b'mock DATA never executed')
                for parent,row in facts['parents'].items():
                    kernel.nodes[parent].update(ino=row['after'][1],mode=row['after'][2],
                        mtime=row['after'][7],ctime=row['after'][8])
                directory=facts['directory']
                kernel.add(root,directory[2])
                kernel.nodes[root].update(ino=directory[1],mtime=directory[7],ctime=directory[8])
                for name,row in (('node',facts['file']),('stage.json',facts['record']['metadata'])):
                    kernel.add(root+'/'+name,row[2],b'mock')
                    kernel.nodes[root+'/'+name].update(ino=row[1],mtime=row[7],ctime=row[8],reportedSize=row[6])
                original_info=kernel.info
                def info(path):
                    value=original_info(path)
                    if 'reportedSize' in kernel.nodes[path]:value.st_size=kernel.nodes[path]['reportedSize']
                    return value
                kernel.info=info
                self.v2kernel=kernel
            def cleanup(self, inner, *, outer=None):
                self.prepare_node_kernel(inner)
                with self.v2kernel.hooks():
                    self.node_plan = p.node_cleanup_wire_plan_v2(self.v2route, ENV, inner)
                kernel=SimpleNamespace(_directory=mock.Mock(
                    side_effect=FileNotFoundError(2,'synthetic absent selected unit')))
                return p.cleanup_owned_cgroups(self.v2route, ENV, inner, kernel,
                    outer_base=outer, input_plan=self.node_plan,
                    following_error_bytes=1024, clock=iter((1,2,3)).__next__)
            def node_cleanup(self, inner):
                with self.v2kernel.hooks():
                    return p.cleanup_node_stage_v2(self.v2route,ENV,inner,self.node_plan)

        class BuildV2(V2Cleanup, h.BuildEdges):
            v2route='build'

        class ReferenceV2(V2Cleanup, h.ReferenceEdges):
            v2route='reference'
            def acquire_build(self, selected, *, pull_request):
                archive, observed=super().acquire_build(selected,pull_request=pull_request)
                observed['readback']['runId']=int(selected['runId'])
                return archive,observed


        def rebind(request, event, env, route):
            raw=p.canonical(request)
            name=p.ROUTES[route][2]
            env[name+'_SHA256']=hashlib.sha256(raw).hexdigest()
            env[name+'_B64']=base64.b64encode(raw).decode()
            obj=json.loads(event)
            obj['pull_request']['body']=f'<!-- {name}_SHA256={hashlib.sha256(raw).hexdigest()} -->\nSynthetic current input.\n'
            return raw,p.canonical(obj),env


        def build():
            upstream=h.synthetic_upstream()
            restore=h.patch_pins(upstream)
            try:
                rom,fixture=p.authored_inputs()
                edges=BuildV2(upstream,rom,fixture)
                request, raw, event, env = h.request_inputs(upstream,edges)
                request['toolchain']['inventory'].update(META)
                raw,event,env=rebind(request,event,env,'build')
                p.admit_build_inputs_v2(request)
                value,roles=p.collect_build_v2(raw,event,env,edges)
                assert value['complete'],value['firstFailure']
                unit='bw-bochs-build-v1-123456-1.service'
                context={'env':env,'invoker':dict(CALLER),'bootstrapCredentials':dict(BOOTSTRAP),
                         'sourceRoot':'/mock/source'}
                paths={'unit':unit,'work':pathlib.Path('/mock/work'),'output':pathlib.Path('/mock/output')}
                status=h.synthetic_status('build',unit,context)
                with mock.patch.object(p,'BUILD_CURRENT_V2_ENABLED',True), \
                     mock.patch.object(p,'sealed_write'), \
                     mock.patch.object(p,'retained_output_roles',return_value=copy.deepcopy(roles)), \
                     mock.patch.object(p,'read_regular',return_value=(status,{})), \
                     mock.patch.object(p,'write_work_roles'):
                    outside,final=p.finish_cli('build',context,raw,event,paths,
                        provider_factory=lambda *_:edges,
                        service_status=paths['work']/'service-status.original.json',current=True)
                assert outside['firstFailure'] is None,outside['firstFailure']
                assert len(final)==31,len(final)
                grade=r.build_original_current_v2(final,raw,event)
                assert grade['selectedBuildBytesObserved'] and grade['actualRunApproved'] is False
                for key,replacement in (('schema','bw.bochs-ring3.toolchain-inventory-reference.v1'),
                                        ('jobName','bochs-ring3-toolchain-inventory-v1'),
                                        ('version',1)):
                    downgraded=copy.deepcopy(request)
                    downgraded['toolchain']['inventory'][key]=replacement
                    try:
                        p.admit_build_inputs_v2(downgraded)
                    except p.Refusal:
                        pass
                    else:
                        raise AssertionError('current Build admitted downgraded '+key)
                    denied_raw,denied_event,denied_env=rebind(downgraded,event,dict(env),'build')
                    try:
                        p.collect_build_v2(denied_raw,denied_event,denied_env,SimpleNamespace())
                    except p.Refusal:
                        pass
                    else:
                        raise AssertionError('current Build touched or bypassed producer admission '+key)
                missing=copy.deepcopy(request)
                del missing['toolchain']['inventory']['schema']
                try:
                    p.admit_build_inputs_v2(missing)
                except p.Refusal:
                    pass
                else:
                    raise AssertionError('current Build admitted missing metadata')
                stage_downgrade=copy.deepcopy(final)
                stage=json.loads(stage_downgrade['node-stage.original.json'])
                stage['schema']='bw.bochs-ring3.node-stage.v1'
                stage_downgrade['node-stage.original.json']=p.canonical(stage)
                row=json.loads(stage_downgrade['build.original.json'])
                row['observations']['nodeStage']=copy.deepcopy(stage)
                stage_downgrade['build.original.json']=p.canonical(row)
                stage_downgrade['manifest.json']=p.canonical(p.original_manifest({
                    name:body for name,body in stage_downgrade.items() if name!='manifest.json'}))
                try:
                    r.build_original_current_v2(stage_downgrade,raw,event)
                except r.Refusal:
                    pass
                else:
                    raise AssertionError('current Build admitted V1 stage')
                archive=p.pack_zip(final,archive_cap=64<<20,expanded_cap=256<<20,
                    member_cap=4096,modes={name:0o755 if name.endswith('/bochs') else 0o644 for name in final})
                return upstream,restore,request,raw,event,env,final,archive,rom,fixture
            except:
                restore();raise

        def reference(built):
            upstream,restore,build_request,_,_,_,build_roles,archive,rom,fixture=built
            ref, _, ref_event, ref_env = c.synthetic_request('reference')
            ref['source'] = build_request['source']
            source_before=json.loads(build_roles['source.before.json'])
            ref['build'] = {'runId':'123456','jobId':111,'artifactId':222,
                'name':'i80386-bochs-ring3-build-v1-originals','bytes':len(archive),
                'sha256':h.sha(archive),'checkoutHead':ref['source']['head'],
                'checkoutTree':ref['source']['tree'],
                'workflowCommit':source_before['workflowCommit'],
                'workflowFileSha256':ref['source']['files'][p.WORKFLOW]['sha256'],
                'compactManifest':json.loads(build_roles['compact-manifest.json']),
                'buildLog':{'bytes':100,'sha256':'a'*64},'metadata':dict(META)}
            ref_raw,ref_event,ref_env=rebind(ref,ref_event,ref_env,'reference')
            p.admit_reference_inputs_v2(ref)
            for changed in ('missing','wrong'):
                downgraded=copy.deepcopy(ref)
                if changed=='missing':del downgraded['build']['metadata']
                else:downgraded['build']['metadata']['version']=1
                try:
                    p.admit_reference_inputs_v2(downgraded)
                except p.Refusal:
                    pass
                else:
                    raise AssertionError('current Reference admitted '+changed+' metadata')
                denied_raw,denied_event,denied_env=rebind(downgraded,ref_event,dict(ref_env),'reference')
                try:
                    p.collect_reference_v2(denied_raw,denied_event,denied_env,SimpleNamespace())
                except p.Refusal:
                    pass
                else:
                    raise AssertionError('current Reference touched or bypassed producer admission '+changed)
            selected=p.selected_build_bytes_v2(ref,archive)
            assert len(selected['files'])==31
            arch,wire=h.synthetic_architecture()
            assert len(wire)==1730
            edges=ReferenceV2(selected,archive,arch,wire)
            value,roles=p.collect_reference_v2(ref_raw,ref_event,ref_env,edges)
            assert value['complete'],value['firstFailure']
            assert len(roles)==29,len(roles)
            unit='bw-bochs-reference-v1-123456-1.service'
            context={'env':ref_env,'invoker':dict(CALLER),'bootstrapCredentials':dict(BOOTSTRAP),
                     'sourceRoot':'/mock/source'}
            paths={'unit':unit,'work':pathlib.Path('/mock/reference-work'),
                   'output':pathlib.Path('/mock/reference-output')}
            status=h.synthetic_status('reference',unit,context)
            with mock.patch.object(p,'REFERENCE_CURRENT_V2_ENABLED',True), \
                 mock.patch.object(p,'sealed_write'), \
                 mock.patch.object(p,'retained_output_roles',return_value=copy.deepcopy(roles)), \
                 mock.patch.object(p,'read_regular',return_value=(status,{})), \
                 mock.patch.object(p,'write_work_roles'):
                outside,final=p.finish_cli('reference',context,ref_raw,ref_event,paths,
                    provider_factory=lambda *_:edges,
                    service_status=paths['work']/'service-status.original.json',current=True)
            assert outside['firstFailure'] is None,outside['firstFailure']
            assert len(final)==32,len(final)
            grade=r.reference_original_current_v2(final,ref_raw,ref_event)
            assert grade['buildOriginalJoined'] and grade['architectureObserved']
            assert grade['actualRunApproved'] is False
            stage_downgrade=copy.deepcopy(final)
            stage=json.loads(stage_downgrade['node-stage.original.json'])
            stage['schema']='bw.bochs-ring3.node-stage.v1'
            stage_downgrade['node-stage.original.json']=p.canonical(stage)
            row=json.loads(stage_downgrade['original.json'])
            row['observations']['nodeStage']=copy.deepcopy(stage)
            stage_downgrade['original.json']=p.canonical(row)
            stage_downgrade['manifest.json']=p.canonical(p.original_manifest({
                name:body for name,body in stage_downgrade.items() if name!='manifest.json'}))
            try:
                r.reference_original_current_v2(stage_downgrade,ref_raw,ref_event)
            except r.Refusal:
                pass
            else:
                raise AssertionError('current Reference admitted V1 stage')
            mutated=copy.deepcopy(final)
            stage=json.loads(mutated['node-stage.original.json'])
            stage['invoker']['gid']=1001
            stage['bootstrapCredentials']['gidArgument']='1001'
            stage['bootstrapCredentials']['sudoGid']='1001'
            mutated['node-stage.original.json']=p.canonical(stage)
            original=json.loads(mutated['original.json'])
            original['observations']['nodeStage']=copy.deepcopy(stage)
            mutated['original.json']=p.canonical(original)
            mutated['manifest.json']=p.canonical(p.original_manifest({
                name:raw for name,raw in mutated.items() if name!='manifest.json'}))
            try:
                r.reference_original_current_v2(mutated,ref_raw,ref_event)
            except r.Refusal:
                pass
            else:
                raise AssertionError('coherent caller-GID replacement accepted')
            return ref,ref_raw,ref_event,ref_env,final,grade

        def official_current(route, packet, request, source_before):
            archive=p.pack_zip(packet,archive_cap=(64 if route=='build' else 96)<<20,
                expanded_cap=(256 if route=='build' else 384)<<20,
                member_cap=4096 if route=='build' else 6144,
                modes={name:0o644 for name in packet})
            names=('bochs-ring3-toolchain-inventory-v1',
                   'bochs-ring3-toolchain-inventory-v2',
                   'bochs-ring3-build-v1','bochs-ring3-reference-v1')
            selected='bochs-ring3-'+route+'-v1'
            number=333 if route=='build' else 444
            artifact_id=555 if route=='build' else 666
            steps=[{'number':i,'name':name,'status':'completed','conclusion':'success'}
                   for i,name in enumerate(r.BUILD_USER_STEPS if route=='build' else r.REFERENCE_USER_STEPS,1)]
            jobs={'total_count':4,'jobs':[{'id':300+i,'run_id':123456,'run_attempt':1,
                'head_sha':request['source']['head'],'name':name,'status':'completed',
                'conclusion':'success' if name==selected else 'skipped',
                'steps':steps if name==selected else []}
                for i,name in enumerate(names)]}
            for row in jobs['jobs']:
                if row['name']==selected:row['id']=number
            expectation={'schema':'bw.bochs-ring3.'+route+'-expectation.v1',
                'repository':p.REPOSITORY,'pullRequest':request['pullRequest'],
                'runId':'123456','runAttempt':1,'jobId':number,'jobName':selected,
                'eventName':'pull_request','actor':'CrispStrobe',
                'head':request['source']['head'],'tree':request['source']['tree'],
                'workflowCommit':source_before['workflowCommit'],
                'workflowTree':source_before['workflowTree'],
                'workflowFileSha256':source_before['workflowFileSha256'],
                'requestSha256':h.sha(packet['request.original.json']),
                'eventSha256':h.sha(packet['event.original.json']),
                'artifactId':artifact_id,'archiveBytes':len(archive),
                'archiveSha256':h.sha(archive),'conclusion':'success','steps':steps}
            repo={'id':987,'full_name':p.REPOSITORY,'fork':False,
                  'name':'bw-board','node_id':'synthetic-node','owner':{'login':'CrispStrobe'}}
            run={'id':123456,'run_attempt':1,'head_sha':request['source']['head'],
                'event':'pull_request','status':'completed','conclusion':'success',
                'repository':repo,'head_repository':copy.deepcopy(repo),
                'actor':{'login':'CrispStrobe'},'path':p.WORKFLOW,
                'pull_requests':[{'number':request['pullRequest'],
                    'head':{'sha':request['source']['head'],'repo':{'id':987}},
                    'base':{'ref':'master','repo':{'id':987}}}]}
            artifacts={'total_count':1,'artifacts':[{'id':artifact_id,
                'name':'i80386-bochs-ring3-'+route+'-v1-originals',
                'size_in_bytes':len(archive),'digest':'sha256:'+h.sha(archive),
                'expired':False,'workflow_run':{'id':123456,
                    'head_sha':request['source']['head'],
                    'repository_id':987,'head_repository_id':987}}]}
            grader=(r.build_official_current_v2 if route=='build' else
                    r.reference_official_current_v2)
            raw_expected=p.canonical(expectation)
            args=(archive,raw_expected,run,jobs,artifacts,b'synthetic current official log\n')
            grade=grader(*args)
            assert grade['officialMetadataBound'] and grade['actualRunApproved'] is False
            def refused(label,mutator):
                changed=copy.deepcopy(args)
                mutator(changed[3]['jobs'])
                changed[3]['total_count']=len(changed[3]['jobs'])
                try:grader(*changed)
                except r.Refusal:pass
                else:raise AssertionError('current '+route+' accepted '+label)
            refused('missing other job',lambda rows:rows.pop(0))
            refused('extra job',lambda rows:rows.append({'id':999,'run_id':123456,
                'head_sha':request['source']['head'],'name':'unknown-extra',
                'status':'completed','conclusion':'skipped','steps':[]}))
            refused('wrong inactive name',lambda rows:rows[0].update(name='unknown-other'))
            refused('duplicate inactive name',lambda rows:rows[0].update(name=rows[1]['name']))
            refused('wrong inactive conclusion',lambda rows:rows[0].update(conclusion='success'))
            counterfactual=copy.deepcopy(args)
            counterfactual[3]['jobs'][0]['conclusion']='success'
            with mock.patch.object(r,'current_official_four_jobs',return_value=None):
                assert grader(*counterfactual)['officialMetadataBound'] is True
            refused('nonterminal inactive',lambda rows:rows[0].update(status='queued'))
            refused('wrong inactive run',lambda rows:rows[0].update(run_id=123457))
            refused('wrong inactive attempt',lambda rows:rows[0].update(run_attempt=2))
            refused('wrong inactive head',lambda rows:rows[0].update(head_sha='0'*40))
            return grade

        built=build()
        try:
            result=reference(built)
            bo=official_current('build',built[6],built[2],json.loads(built[6]['source.before.json']))
            ro=official_current('reference',result[4],result[0],json.loads(result[4]['source.before.json']))
            self.assertEqual(len(built[6]),31)
            self.assertEqual(len(result[4]),32)
            self.assertTrue(result[5]['architectureObserved'])
            self.assertTrue(bo['officialMetadataBound'])
            self.assertTrue(ro['officialMetadataBound'])
            self.assertFalse(result[5]['actualRunApproved'])
        finally:
            built[1]()



class PureDelegatedCleanupV2:
    """Finite fake two-role kernel; genuine source performs every FD/remove step."""
    def __init__(self,unit):
        self.root=Path('/sys/fs/cgroup/system.slice')/unit;self.parent=self.root.parent
        self.removed=set();self.fds={};self.events=[];self.next_fd=1000
    def _directory(self,path):
        path=Path(path)
        if str(path) in self.removed:raise FileNotFoundError(2,'mock removed cgroup')
        index={self.parent:90,self.root:1,self.root/'controller':2}.get(path)
        producer.need(index is not None,'closed fake cgroup roster')
        row=synthetic_stat(index,4096,0o40755);row['nlink']=2;return row
    def _read(self,path,cap):
        path=Path(path);self._directory(path.parent)
        if path.name=='cgroup.procs':return ''
        if path.name=='cgroup.events':return 'populated 0\nfrozen 0\n'
        if path.name=='cgroup.stat':
            count=int(path.parent==self.root and str(self.root/'controller') not in self.removed)
            return 'nr_descendants '+str(count)+'\nnr_dying_descendants 0\n'
        raise AssertionError('unexpected pseudo file')
    def open(self,path,flags,mode=0o777,*,dir_fd=None):
        path=Path(path) if dir_fd is None else self.fds[dir_fd]/path
        self._directory(path);self.next_fd+=1;self.fds[self.next_fd]=path;return self.next_fd
    def fstat(self,fd):
        row=self._directory(self.fds[fd]);return SimpleNamespace(**{'st_'+k:row[v] for k,v in
            (('dev','dev'),('ino','ino'),('mode','mode'),('uid','uid'),('gid','gid'),('nlink','nlink'),('size','size'),('mtime_ns','mtimeNs'),('ctime_ns','ctimeNs'))})
    def close(self,fd):del self.fds[fd]
    def rmdir(self,name,*,dir_fd):
        path=self.fds[dir_fd]/name
        producer.need(path in (self.root,self.root/'controller'),'only known fake removal')
        producer.need(path!=self.root or str(self.root/'controller') in self.removed,'empty root before rmdir')
        self.events.append(('rmdir',str(path)));self.removed.add(str(path))
    def scandir(self,path):
        path=Path(path);self._directory(path)
        names=['controller'] if path==self.root and str(self.root/'controller') not in self.removed else []
        entries=[SimpleNamespace(name=name,is_symlink=lambda:False,is_dir=lambda **_kw:True) for name in names]
        class Scan:
            def __init__(self):self.items=iter(entries)
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def __iter__(self):return self
            def __next__(self):return next(self.items)
        return Scan()
    def hooks(self):
        stack=contextlib.ExitStack()
        for name in ('open','fstat','close','rmdir','scandir'):stack.enter_context(mock.patch.object(producer.os,name,getattr(self,name)))
        return stack


class V2WholeCleanupBudgetControls(unittest.TestCase):
    def test_genuine_finalizer_reserves_known_errors_and_Node_before_first_rmdir(self):
        _request,raw,event,env,_edges,inner,_outside,roles=toolchain_v2_sample()
        unit=producer.route_paths('toolchain-v2',env)['unit'];plan=json.loads(roles['cleanup.original.json'])['inputPlan']
        for overflow in (False,True):
            with self.subTest(overflow=overflow):
                kernel=PureDelegatedCleanupV2(unit)
                class Edges(InventoryEdges):
                    def cleanup(edge, original, *, outer=None):
                        edge.outer=copy.deepcopy(outer)
                        with kernel.hooks():
                            return producer.cleanup_owned_cgroups('toolchain-v2',env,original,kernel,
                                outer_base=outer,input_plan=plan,clock=itertools.count(1,1000).__next__)
                    def unit(edge,name):
                        self.assertEqual(name,unit)
                        if str(kernel.root) in kernel.removed:return {'path':str(kernel.root),'exists':False,'errno':2,'identity':None,'files':{},'children':[]}
                        return {'path':str(kernel.root),'exists':True,'errno':None,'identity':kernel._directory(kernel.root),'files':{},'children':['controller']}
                edges=Edges();error=None
                if overflow:
                    error=producer.Refusal('known bounded manager failure')
                    error.bochs_secondary=[producer.failure(OSError('x'*512),'known-receipt-close') for _ in range(producer.SECONDARY_LIMIT)]
                outside,result=producer.finalize_original('toolchain-v2',raw,event,env,inner,dict(roles),0,0,edges,status_error=error,current=True)
                self.assertEqual(kernel.fds,{})
                if overflow:
                    self.assertEqual(kernel.events,[])
                    self.assertFalse(outside['manual']['complete'])
                    self.assertEqual(outside['firstFailure']['phase'],'outside-service-status')
                    self.assertEqual(len(edges.outer['secondary']),producer.SECONDARY_LIMIT)
                    self.assertIsNone(outside['after']);self.assertEqual(outside['cleanupExitCode'],1)
                else:
                    self.assertTrue(outside['manual']['complete'],outside['manual']['firstFailure'])
                    self.assertEqual([Path(path).name for _,path in kernel.events],['controller',unit])
                    future={**outside,'nodeCleanup':json.loads(roles['outside.original.json'])['nodeCleanup']}
                    self.assertLessEqual(len(producer.canonical(future)),16384)



class V2MutationChronologyControls(unittest.TestCase):
    def test_action_failure_precedes_after_observation_and_close_failures(self):
        for operation in ('chmod','unlink','rmdir'):
            with self.subTest(operation=operation):
                facts,kernel,env=NodeStageV2Controls().exercise()
                inner={'observations':{'nodeStage':facts}};root=str(Path(facts['stagePath']).parent)
                with kernel.hooks():plan=producer.node_cleanup_wire_plan_v2('toolchain-v2',env,inner)
                real_chmod,real_unlink,real_rmdir,real_lstat,real_close=kernel.chmod,kernel.unlink,kernel.rmdir,kernel.lstat,kernel.close
                state={'failed':False,'path':None};before=len(kernel.events)
                def failed(path):
                    state.update(failed=True,path=str(path));kernel.events.append(('action-failure',operation,str(path)))
                    raise OSError('first-authored-'+operation+'\x01'*512)
                def chmod(fd,mode):
                    if operation=='chmod':
                        real_chmod(fd,mode) # An applied mode change is still an uncertain failure.
                        failed(kernel.fds[fd])
                    return real_chmod(fd,mode)
                def unlink(name,*,dir_fd):
                    if operation=='unlink':failed(kernel.name(name,dir_fd))
                    return real_unlink(name,dir_fd=dir_fd)
                def rmdir(path):
                    if operation=='rmdir':failed(path)
                    return real_rmdir(path)
                def lstat(path):
                    if state['failed'] and str(path)==state['path']:
                        raise OSError('secondary-authored-after-lstat'+'\x02'*512)
                    return real_lstat(path)
                def close(fd):
                    name=kernel.fds[fd];real_close(fd)
                    if state['failed'] and name==root:raise OSError('third-authored-held-close'+'\x03'*512)
                kernel.chmod,kernel.unlink,kernel.rmdir,kernel.lstat,kernel.close=chmod,unlink,rmdir,lstat,close
                with kernel.hooks():value=producer.cleanup_node_stage_v2('toolchain-v2',env,inner,plan)
                self.assertFalse(value['complete']);self.assertTrue(state['failed'])
                self.assertTrue(value['firstFailure']['message'].startswith('first-authored-'+operation))
                self.assertEqual(len(value['secondary']),2)
                self.assertTrue(value['secondary'][0]['message'].startswith('secondary-authored-after-lstat'))
                self.assertTrue(value['secondary'][1]['message'].startswith('third-authored-held-close'))
                tail=kernel.events[before:];index=next(i for i,e in enumerate(tail) if e[0]=='action-failure')
                self.assertFalse(any(e[0] in ('chmod','unlink','rmdir','action-failure') for e in tail[index+1:]))
                self.assertEqual(kernel.fds,{})
                self.assertLessEqual(len(producer.canonical(value)),plan['reservedBytes'])
                self.assertLessEqual(plan['reservedBytes'],16384)

if __name__ == '__main__':
    unittest.main()
