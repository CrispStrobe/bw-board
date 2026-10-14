"""Manufactured boundary controls; never materialize a Git worktree."""
import hashlib
import importlib.util
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('materializer', Path(__file__).with_name('materializer.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def state(mode=stat.S_IFREG | 0o644, inode=3, size=3):
    return SimpleNamespace(st_mode=mode, st_dev=1, st_ino=inode, st_size=size,
                           st_nlink=1, st_mtime_ns=7, st_uid=1000)


class Controls(unittest.TestCase):
    def make(self):
        q = m.Materializer()
        q._adapter = (Path('/owned'), Path('/owned/source'), (1, 1))
        q._root_identity = (1, 2)
        q._provider = Path('/fixed-provider')
        q._context_commit = m._held._COMMIT
        q._proof_pin = m.Materializer._pins()[1][1]
        q._git_prefix = ('/usr/bin/git',) + m._PREFIX
        q._git_environment = tuple(m._ENV.items())
        operations = [Mock() for _ in range(18)]
        operations[9], operations[10] = hashlib.sha256, hashlib.sha1
        q._operations = tuple(operations)
        owner = (m._held._COMMIT, 'CrispStrobe/bw-board', True, True, '/owned/source')
        return q, operations, owner

    def test_actual_unsealed_before_operations(self):
        with patch.object(m.os, 'open', side_effect=AssertionError), patch.object(m.subprocess, 'Popen', side_effect=AssertionError):
            with self.assertRaisesRegex(m.Refusal, 'unsealed'):
                m.actual()

    def test_model_default_stays_unconnected(self):
        with self.assertRaisesRegex(m.Refusal, 'unconnected'):
            m._held.Context()._prepare()

    def test_fixed_object_only(self):
        q, _, owner = self.make()
        with self.assertRaisesRegex(m.Refusal, 'fixed-object'):
            q._git_row(owner, 'f' * 40, 'foreign.py')

    def test_tree_symlink_before_blob(self):
        q, _, _ = self.make()
        q._git = Mock(return_value=b'120000 blob ' + b'a' * 40 + b'\tx.py\0')
        with self.assertRaisesRegex(m.Refusal, 'tree-mode'):
            q._tree_row(m._held._COMMIT, 'x.py')
        self.assertEqual(q._git.call_count, 1)

    def test_tree_submodule_before_blob(self):
        q, _, _ = self.make()
        q._git = Mock(return_value=b'160000 commit ' + b'a' * 40 + b'\tx.py\0')
        with self.assertRaisesRegex(m.Refusal, 'tree-mode'):
            q._tree_row(m._held._COMMIT, 'x.py')
        self.assertEqual(q._git.call_count, 1)

    def test_regular_blob_authentication(self):
        q, _, _ = self.make()
        body = b'abc'
        blob = hashlib.sha1(b'blob 3\0abc').hexdigest()
        q._git = Mock(side_effect=[b'100644 blob ' + blob.encode() + b'\tx.py\0', body])
        self.assertEqual(q._tree_row(m._held._COMMIT, 'x.py'),
                         {'bytes': 3, 'sha256': hashlib.sha256(body).hexdigest(), 'gitBlob': blob})

    def test_wrong_blob_refuses(self):
        q, _, _ = self.make()
        q._git = Mock(side_effect=[b'100644 blob ' + b'a' * 40 + b'\tx.py\0', b'abc'])
        with self.assertRaisesRegex(m.Refusal, 'blob-identity'):
            q._tree_row(m._held._COMMIT, 'x.py')

    def test_conversion_configuration_refuses_without_values(self):
        q, _, _ = self.make()
        q._git = Mock(return_value=b'filter.private.clean\n')
        with self.assertRaisesRegex(m.Refusal, 'conversion-config'):
            q._conversion_guard(q._provider)
        self.assertEqual(q._git.call_count, 1)

    def test_tracked_attributes_refuse(self):
        q, ops, _ = self.make()
        q._git = Mock(side_effect=[b'', b'/fixed-common\n', b'x/.gitattributes\0'])
        ops[7].side_effect = FileNotFoundError
        with self.assertRaisesRegex(m.Refusal, 'tracked-attributes'):
            q._conversion_guard(q._provider)

    def read_setup(self):
        q, ops, owner = self.make()
        q._rows = {'x.py': {'bytes': 3}}
        directory = state(stat.S_IFDIR | 0o700, 2, 1)
        regular = state()
        ops[4].side_effect = [10, 11]
        ops[6].side_effect = [directory, regular, regular, directory]
        ops[7].side_effect = [regular, directory]
        ops[5].side_effect = [b'abc', b'']
        return q, ops, owner

    def test_read_exact_extent_and_directory_fences(self):
        q, ops, owner = self.read_setup()
        self.assertEqual(q._read_row(owner, 'x.py'), b'abc')
        self.assertEqual([c.args[0] for c in ops[8].call_args_list], [11, 10])
        self.assertEqual(ops[4].call_args_list[1].kwargs, {'dir_fd': 10})

    def test_read_extent_refuses_but_closes(self):
        q, ops, owner = self.read_setup()
        ops[5].side_effect = [b'abcd']
        with self.assertRaisesRegex(m.Refusal, 'source-extent'):
            q._read_row(owner, 'x.py')
        self.assertEqual(ops[8].call_count, 2)

    def test_named_file_substitution_refuses(self):
        q, ops, owner = self.read_setup()
        ops[7].side_effect = [state(inode=4)]
        with self.assertRaisesRegex(m.Refusal, 'source-changed'):
            q._read_row(owner, 'x.py')
        self.assertEqual(ops[8].call_count, 2)

    def test_primary_read_error_survives_close(self):
        q, ops, owner = self.read_setup()
        original = OSError('original read')
        ops[5].side_effect = original
        ops[8].side_effect = OSError('secondary close')
        with self.assertRaises(OSError) as got:
            q._read_row(owner, 'x.py')
        self.assertIs(got.exception, original)
        self.assertTrue(q.observations()['cleanupUncertain'])

    def test_returned_fd_captured_before_poison(self):
        q, ops, owner = self.read_setup()
        def opened(*args, **kwargs):
            q.first = 'context-reentry'
            return 10
        ops[4].side_effect = opened
        with self.assertRaisesRegex(m.Refusal, 'context-reentry'):
            q._read_row(owner, 'x.py')
        ops[8].assert_called_once_with(10)
        ops[6].assert_not_called()

    def test_foreign_fd_not_closed(self):
        q, ops, owner = self.read_setup()
        ops[4].side_effect = [True]
        with self.assertRaisesRegex(m.Refusal, 'root-fd'):
            q._read_row(owner, 'x.py')
        ops[8].assert_not_called()

    def test_cleanup_only_exact_registered_identity(self):
        q, ops, _ = self.make()
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, 1), state(stat.S_IFDIR | 0o700, 2), state(stat.S_IFDIR | 0o700, 1)]
        q._git = Mock(return_value=b'')
        q._remove()
        self.assertEqual(q._git.call_args.args[1], ('worktree', 'remove', '--force', '/owned/source'))
        self.assertTrue(q._git.call_args.kwargs['cleanup'])
        self.assertTrue(q.observations()['releaseComplete'])
        q._remove()
        self.assertEqual(q._git.call_count, 1)

    def test_substituted_root_never_removed(self):
        q, ops, _ = self.make()
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, 1), state(stat.S_IFDIR | 0o700, 9)]
        q._git = Mock()
        with self.assertRaisesRegex(m.Refusal, 'cleanup-root-changed'):
            q._remove()
        q._git.assert_not_called()

    def test_final_drift_remains_original_failure_after_cleanup(self):
        q, _, owner = self.make()
        q._rows = {'x.py': {'sha256': hashlib.sha256(b'abc').hexdigest()}}
        q._clean = Mock()
        q._read_row = Mock(return_value=b'drift')
        q._remove = Mock()
        with self.assertRaisesRegex(m.Refusal, 'final-source-drift'):
            q._release(owner)
        q._remove.assert_called_once()
        self.assertFalse(q.observations()['finalReadbackComplete'])

    def test_missing_object_before_temporary_allocation(self):
        q, ops, _ = self.make()
        q._git = Mock(side_effect=m.Refusal('missing-commit'))
        table = {'rows': {}}
        proof = m._held.canonical({'javascript': {}, 'native': {}, 'PIC111': {'compiledCommit': 'a' * 40, 'rows': {}}})
        with patch.object(m._held, 'regular_metadata', return_value=proof), patch.object(q, '_proof_pin', hashlib.sha256(proof).hexdigest()):
            with self.assertRaisesRegex(m.Refusal, 'missing-commit'):
                q._materialize(table)
        ops[11].assert_not_called()

    def transport_setup(self):
        q, ops, _ = self.make()
        q._started = 1
        ops[2].return_value = 1
        pipes = [Mock(), Mock()]
        pipes[0].fileno.return_value = 10
        pipes[1].fileno.return_value = 11
        process = Mock(stdout=pipes[0], stderr=pipes[1], pid=123, returncode=None)
        process.wait.return_value = 0
        ops[0].return_value = process
        registered = {}
        selector = Mock()
        selector.register.side_effect = lambda p, event, index: registered.update({p: index})
        selector.get_map.side_effect = lambda: registered.copy()
        selector.unregister.side_effect = lambda p: registered.pop(p)
        selector.select.side_effect = lambda timeout: [(SimpleNamespace(fileobj=p, data=i), 1) for p, i in list(registered.items())]
        ops[1].return_value = selector
        ops[5].side_effect = [b'abc', b'', b'']
        return q, ops, process, selector

    def test_fixed_process_contract_and_bounded_output(self):
        q, ops, process, selector = self.transport_setup()
        self.assertEqual(q._git(q._provider, ('rev-parse', 'HEAD')), b'abc')
        argv = ops[0].call_args.args[0]
        self.assertEqual(argv, ('/usr/bin/git',) + m._PREFIX + ('-C', '/fixed-provider', 'rev-parse', 'HEAD'))
        arguments = ops[0].call_args.kwargs
        self.assertIs(arguments['shell'], False)
        self.assertIs(arguments['start_new_session'], True)
        self.assertEqual(arguments['stdin'], m.subprocess.DEVNULL)
        self.assertNotIn('HOME', arguments['env'])
        self.assertEqual(arguments['env']['GIT_NO_LAZY_FETCH'], '1')
        ops[3].assert_not_called()
        selector.close.assert_called_once()

    def test_exited_leader_still_owned_group_cleanup(self):
        q, ops, process, _ = self.transport_setup()
        original = OSError('selector construction')
        ops[1].side_effect = original
        process.poll.return_value = 0
        with self.assertRaises(OSError) as got:
            q._git(q._provider, ('rev-parse', 'HEAD'))
        self.assertIs(got.exception, original)
        ops[3].assert_called_once_with(123, m.signal.SIGKILL)
        process.stdout.close.assert_called_once()
        process.stderr.close.assert_called_once()

    def test_output_cap_cleanup_preserves_primary(self):
        q, ops, process, selector = self.transport_setup()
        ops[5].side_effect = [b'abcd']
        selector.close.side_effect = OSError('secondary selector close')
        with patch.object(m, '_CAP', 3):
            with self.assertRaisesRegex(m.Refusal, 'git-output-cap'):
                q._git(q._provider, ('rev-parse', 'HEAD'))
        ops[3].assert_called_once()
        self.assertTrue(q.observations()['cleanupUncertain'])

    def test_git_timeout_before_read(self):
        q, ops, _, _ = self.transport_setup()
        ops[2].side_effect = [1, 12]
        with self.assertRaisesRegex(m.Refusal, 'git-deadline'):
            q._git(q._provider, ('rev-parse', 'HEAD'))
        ops[5].assert_not_called()
        ops[3].assert_called_once()

    def test_clock_backwards_refuses(self):
        q, ops, _, _ = self.transport_setup()
        ops[2].side_effect = [3, 2]
        with self.assertRaisesRegex(m.Refusal, 'clock-backward'):
            q._git(q._provider, ('rev-parse', 'HEAD'))
        ops[3].assert_called_once()

    def test_reaped_failed_child_never_group_signalled(self):
        q, ops, process, _ = self.transport_setup()
        def waited(timeout):
            process.returncode = 1
            return 1
        process.wait.side_effect = waited
        with self.assertRaisesRegex(m.Refusal, 'git-exit'):
            q._git(q._provider, ('rev-parse', 'HEAD'))
        ops[3].assert_not_called()

    def test_prepared_lifetime_not_startup_deadline(self):
        q, ops, _, _ = self.transport_setup()
        q._startup_active = False
        ops[2].return_value = 500
        self.assertEqual(q._git(q._provider, ('rev-parse', 'HEAD')), b'abc')

    def test_no_source_scope_from_untracked_context(self):
        q, _, _ = self.make()
        q._git = Mock(side_effect=[b'', b'extra.py\0'])
        with self.assertRaisesRegex(m.Refusal, 'untracked-drift'):
            q._clean(Path('/owned/source'))

    def test_partial_unregistered_empty_root_cleanup(self):
        q, ops, _ = self.make()
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, 1), state(stat.S_IFDIR | 0o700, 2), state(stat.S_IFDIR | 0o700, 1)]
        original = OSError('unregistered worktree')
        q._git = Mock(side_effect=[original, b'worktree /fixed-provider\0HEAD aaaa\0\0'])
        q._remove()
        self.assertEqual([c.args[0] for c in ops[13].call_args_list],
                         [Path('/owned/source'), Path('/owned')])
        self.assertTrue(q.observations()['releaseComplete'])

    def test_partial_registration_is_not_inferred_removed(self):
        q, ops, _ = self.make()
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, 1), state(stat.S_IFDIR | 0o700, 2), state(stat.S_IFDIR | 0o700, 1)]
        original = OSError('worktree removal failed')
        q._git = Mock(side_effect=[original, b'worktree /owned/source\0HEAD aaaa\0\0'])
        with self.assertRaises(OSError) as got:
            q._remove()
        self.assertIs(got.exception, original)
        self.assertFalse(q.observations()['releaseComplete'])
        self.assertEqual(ops[13].call_count, 1)

    def test_nonempty_partial_root_keeps_primary_and_unknown(self):
        q, ops, _ = self.make()
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, 1), state(stat.S_IFDIR | 0o700, 2), state(stat.S_IFDIR | 0o700, 1)]
        original = OSError('worktree removal failed')
        q._git = Mock(side_effect=original)
        ops[13].side_effect = OSError('not empty')
        with self.assertRaises(OSError) as got:
            q._remove()
        self.assertIs(got.exception, original)
        self.assertFalse(q.observations()['releaseComplete'])

    def test_hash_constructor_reentry_stops_update(self):
        q, ops, _ = self.make()
        h = Mock()
        def constructor():
            q.first = 'context-reentry'
            return h
        ops[10] = constructor
        q._operations = tuple(ops)
        q._git = Mock(side_effect=[b'100644 blob ' + b'a' * 40 + b'\tx.py\0', b'abc'])
        with self.assertRaisesRegex(m.Refusal, 'context-reentry'):
            q._tree_row(m._held._COMMIT, 'x.py')
        h.update.assert_not_called()
        h.hexdigest.assert_not_called()

    def test_partial_add_preserves_original_and_cleans_pending_owner(self):
        q, ops, _ = self.make()
        proof = m._held.canonical({'javascript': {}, 'native': {}, 'PIC111': {'compiledCommit': 'a' * 40, 'rows': {}}})
        q._proof_pin = hashlib.sha256(proof).hexdigest()
        ops[11].return_value = '/tmp/bw-held-fixture'
        ops[17].return_value = 1000
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, 1), state(stat.S_IFDIR | 0o700, 2), state(stat.S_IFDIR | 0o700, 1)]
        original = OSError('partial add')
        q._git = Mock(side_effect=[b'commit\n', b'commit\n', original])
        q._remove = Mock()
        with patch.object(m._held, 'regular_metadata', return_value=proof):
            with self.assertRaises(OSError) as got:
                q._materialize({'rows': {}})
        self.assertIs(got.exception, original)
        self.assertEqual(q._root_identity, (1, 2))
        q._remove.assert_called_once()
        ops[12].assert_called_once_with(Path('/tmp/bw-held-fixture/source'), 0o700)

    def materialization_setup(self):
        q, ops, _ = self.make()
        proof = m._held.canonical({'javascript': {}, 'native': {},
                                  'PIC111': {'compiledCommit': 'a' * 40, 'rows': {}}})
        q._proof_pin = hashlib.sha256(proof).hexdigest()
        q._common_path = Path('/fixed-common')
        ops[11].return_value = '/tmp/bw-held-fixture'
        ops[17].return_value = 1000
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, n) for n in (1, 2, 3, 4)]
        ops[4].return_value = 20
        ops[16].side_effect = lambda fd, body: len(body)
        q._conversion_guard = Mock()
        q._clean = Mock()
        q._remove = Mock()
        def git(root, args, *rest, **kwargs):
            if args[0] == 'cat-file':
                return b'commit\n'
            if args == ('rev-parse', '--absolute-git-dir'):
                return b'/fixed-common/worktrees/source\n'
            if args == ('rev-parse', 'HEAD'):
                return q._context_commit.encode() + b'\n'
            return b''
        q._git = Mock(side_effect=git)
        return q, ops, proof

    def test_native_execution_commits_without_published_capture_paths(self):
        q, ops, proof = self.materialization_setup()
        data = m._held.parse(proof)
        data['native'] = {str(n): {'originalBoardCommit': str(n) * 40,
                                  'fixturePath': 'later-capture-' + str(n),
                                  'encodedRow': {'bytes': 3, 'sha256': 'b' * 64, 'gitBlob': 'c' * 40}}
                          for n in range(1, 5)}
        proof = m._held.canonical(data)
        q._proof_pin = hashlib.sha256(proof).hexdigest()
        q._tree_row = Mock(side_effect=AssertionError('capture absent at execution commit'))
        with patch.object(m._held, 'regular_metadata', return_value=proof):
            q._materialize({'rows': {}})
        q._tree_row.assert_not_called()
        admitted = [c.args[1][2] for c in q._git.call_args_list if c.args[1][0] == 'cat-file']
        self.assertTrue(all(str(n) * 40 in admitted for n in range(1, 5)))

    def test_sparse_open_reentry_never_writes_and_closes_once(self):
        q, ops, proof = self.materialization_setup()
        def opened(*args):
            q.first = 'context-reentry'
            return 20
        ops[4].side_effect = opened
        with patch.object(m._held, 'regular_metadata', return_value=proof):
            with self.assertRaisesRegex(m.Refusal, 'context-reentry'):
                q._materialize({'rows': {}})
        ops[16].assert_not_called()
        ops[8].assert_called_once_with(20)
        q._remove.assert_called_once()

    def test_sparse_foreign_fd_never_written_or_closed(self):
        q, ops, proof = self.materialization_setup()
        ops[4].return_value = True
        with patch.object(m._held, 'regular_metadata', return_value=proof):
            with self.assertRaisesRegex(m.Refusal, 'sparse-fd'):
                q._materialize({'rows': {}})
        ops[16].assert_not_called()
        ops[8].assert_not_called()

    def test_fixed_tmp_argument_ignores_ambient_temp_environment(self):
        q, ops, proof = self.materialization_setup()
        with patch.dict(m.os.environ, {'TMPDIR': '/foreign', 'TMP': '/foreign', 'TEMP': '/foreign'}), patch.object(m._held, 'regular_metadata', return_value=proof):
            q._materialize({'rows': {}})
        ops[11].assert_called_once_with(prefix='bw-held-', dir='/tmp')

    def test_foreign_returned_temp_path_refuses_before_worktree(self):
        q, ops, proof = self.materialization_setup()
        ops[11].return_value = '/foreign/bw-held-fixture'
        with patch.object(m._held, 'regular_metadata', return_value=proof):
            with self.assertRaisesRegex(m.Refusal, 'temporary-path'):
                q._materialize({'rows': {}})
        ops[7].assert_not_called()
        self.assertFalse(any(c.args[1][0] == 'worktree' for c in q._git.call_args_list))

    def test_parent_stat_poison_prevents_root_creation(self):
        q, ops, proof = self.materialization_setup()
        def observed(*args, **kwargs):
            q.first = 'context-reentry'
            return state(stat.S_IFDIR | 0o700, 1)
        ops[7].side_effect = observed
        with patch.object(m._held, 'regular_metadata', return_value=proof):
            with self.assertRaisesRegex(m.Refusal, 'context-reentry'):
                q._materialize({'rows': {}})
        ops[17].assert_not_called()
        ops[12].assert_not_called()
        q._remove.assert_called_once()

    def test_uid_poison_prevents_root_creation(self):
        q, ops, proof = self.materialization_setup()
        def uid():
            q.first = 'context-reentry'
            return 1000
        ops[17].side_effect = uid
        with patch.object(m._held, 'regular_metadata', return_value=proof):
            with self.assertRaisesRegex(m.Refusal, 'context-reentry'):
                q._materialize({'rows': {}})
        ops[12].assert_not_called()
        q._remove.assert_called_once()

    def test_parent_replaced_after_git_is_not_removed(self):
        q, ops, _ = self.make()
        ops[7].side_effect = [state(stat.S_IFDIR | 0o700, 1),
                             state(stat.S_IFDIR | 0o700, 2),
                             state(stat.S_IFDIR | 0o700, 9)]
        q._git = Mock(return_value=b'')
        with self.assertRaisesRegex(m.Refusal, 'cleanup-parent-changed'):
            q._remove()
        q._git.assert_called_once()
        ops[13].assert_not_called()
        self.assertFalse(q.observations()['releaseComplete'])

    def test_observations_do_not_promote_model_or_runtime(self):
        q, _, _ = self.make()
        self.assertFalse(q.status()['actualMaterializationImplemented'])
        self.assertFalse(q.observations()['hostedQualified'])
        self.assertFalse(q.observations()['historicalRuntimeQualified'])


if __name__ == '__main__':
    unittest.main()
