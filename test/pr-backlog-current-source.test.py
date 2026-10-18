"""Refusal controls for the consolidated diagnostic source boundary."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'source_boundary', Path(__file__).resolve().parents[1] / 'scripts/pr-backlog-current-source.py')
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class SourceBoundary(unittest.TestCase):
    def identity(self, **changes):
        head = 'a' * 40
        env = {'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_REPOSITORY': 'CrispStrobe/bw-board',
               'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_JOB': 'mock-control'}
        env.update(changes)
        event = {'action': 'synchronize', 'pull_request': {'head': {
            'sha': head, 'repo': {'full_name': 'CrispStrobe/bw-board'}}}}
        return env, event, head

    def test_current_own_mock_identity(self):
        env, event, head = self.identity()
        boundary.event_identity(env, event, 'pf-mock', head)

    def test_refuses_actual_job_and_non_pr_events(self):
        for change in ({'GITHUB_JOB': 'actual'}, {'GITHUB_EVENT_NAME': 'workflow_dispatch'},
                       {'GITHUB_REPOSITORY': 'other/repo'}, {'GITHUB_RUN_ATTEMPT': '2'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                env, event, head = self.identity(**change)
                boundary.event_identity(env, event, 'pf-mock', head)

    def test_refuses_unknown_profile_or_head(self):
        env, event, head = self.identity()
        for profile, candidate in [('unlisted', head), ('pf-mock', ''), ('pf-mock', 'b' * 40)]:
            with self.subTest(profile=profile, head=candidate), self.assertRaises(ValueError):
                boundary.event_identity(env, event, profile, candidate)

    def test_refuses_fork_and_activation_event(self):
        for fork, action in [('other/repo', 'synchronize'), ('CrispStrobe/bw-board', 'labeled')]:
            env, event, head = self.identity()
            event['action'] = action
            event['pull_request']['head']['repo']['full_name'] = fork
            with self.subTest(fork=fork, action=action), self.assertRaises(ValueError):
                boundary.event_identity(env, event, 'pf-mock', head)

    def test_live_git_blob_is_independently_known(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source'
            path.write_bytes(b'hello\n')
            self.assertEqual(boundary.live_blob(path, 6), 'ce013625030ba8dba906f756967f9e9ca394464a')
            path.write_bytes(b'Hello\n')
            self.assertNotEqual(boundary.live_blob(path, 6), 'ce013625030ba8dba906f756967f9e9ca394464a')

    def test_refuses_symlinks_hardlinks_and_wrong_sizes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source'
            link = Path(directory) / 'link'
            path.write_bytes(b'hello\n')
            with self.assertRaises(ValueError):
                boundary.live_blob(path, 5)
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                boundary.live_blob(link, 6)
            link.unlink()
            os.link(path, link)
            with self.assertRaises(ValueError):
                boundary.live_blob(path, 6)


if __name__ == '__main__':
    unittest.main()
