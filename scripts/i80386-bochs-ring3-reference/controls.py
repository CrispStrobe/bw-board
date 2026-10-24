#!/usr/bin/env python3
"""Authored pure controls. All compiler, guest, process and kernel edges mocked."""
import base64
import copy
import contextlib
import importlib.util
import itertools
import json
import os
import posixpath
from pathlib import Path
import stat
import struct
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
    def test_real_collect_finalize_pack_thirteen_role_positive(self):
        _request, _raw, _event, _env, edges, value, outside, roles = inventory_sample()
        self.assertTrue(value['complete'])
        self.assertEqual(outside['cleanupExitCode'], 0)
        self.assertEqual(len(roles), 13)
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
    def test_debian_real_fold_and_whitespace_authority(self):
        base = b'Package: fixture\nStatus: install ok installed\nVersion: 1\nArchitecture: all\n'
        self.assertEqual(len(producer.debian_status(base + b'Conffiles:\n /x a\n')), 1)
        for raw in (base + b'Conffiles:\n \n', base.replace(b'Package: fixture', b'Package:    '),
                    base + b'Version: 2\n', base.replace(b'Status:', b'status:') + b'Status: install ok installed\n'):
            with self.assertRaises(ValueError): producer.debian_status(raw)


class ProcessControls(unittest.TestCase):
    def capture(self, *, stdout=b'data', status=0, selector_error=None,
                cap=1024, checkpoint=False, post_error=None, timeout=False):
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
        ticks = iter((0, 61000000000, 61000000001)) if timeout else itertools.count(1, 1000000)
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
             mock.patch.object(producer.selectors, 'DefaultSelector', selector):
            value, streams, stop = producer.child_capture(['/authored/tool'], cwd='/authored',
                environment={'LANG': 'C'}, name='bochs' if checkpoint else 'configure',
                wall_seconds=60, stream_cap=cap, checkpoint=checkpoint,
                clock=lambda: next(ticks), observe_terminal=terminal)
        self.assertEqual(popen.call_count, 1)
        self.assertTrue(process.stdout.closed and process.stderr.closed)
        close.assert_called_once_with(9)
        return value, streams, stop, send
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
        if path not in self.nodes: raise FileNotFoundError(path)
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


if __name__ == '__main__':
    unittest.main()
