"""Current-source admission for consolidated, CPU-free diagnostic unit controls.

This is not admission of any historical experiment or its original PR scope.
It never launches a producer, compiler, native addon, CPU or guest.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

PROFILES = {
    'workspace': ('i80386-workspace-source-controls.yml', 'workspace-source-controls'),
    'owned-workspace': ('i80386-owned-workspace-source-controls.yml', 'owned-workspace-source-controls'),
    'retained-tool': ('i80386-retained-tool-source-controls.yml', 'retained-tool-source-controls'),
    'retained-materializer': ('i80386-retained-materializer-source-controls.yml', 'retained-materializer-source-controls'),
    'fixed-alias': ('i80386-fixed-alias-source-controls.yml', 'fixed-alias-source-controls'),
    'materialization-runner': ('i80386-materialization-runner-source-controls.yml', 'materialization-runner-source-controls'),
    'fixed-archive': ('i80386-fixed-archive-materialization.yml', 'fixed-archive-controls'),
    'pf-mock': ('i80386-cwsdpmi-0501-pf-mock-control.yml', 'mock-control'),
    'post-pf': ('i80386-cwsdpmi-0501-post-pf-connected.yml', 'mock-controls'),
    'nursery-mock': ('xv6-js-rollback-direct-v8-nursery-control.yml', 'mock-control'),
    'nursery-support': ('xv6-js-rollback-direct-v8-nursery-support.yml', 'mock-controls'),
    'cohort': ('xv6-guest-snapshot-cohort-source.yml', 'source-controls'),
    'tool-boundary': ('i80386-tool-boundary-source.yml', 'source-controls'),
}
ROOTS = ('scripts', 'test', 'src', '.github/workflows', 'package.json', 'package-lock.json')


def need(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(
        ['git', '--no-replace-objects', '-c', 'core.fsmonitor=false', *args],
        timeout=30, env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1'})


def event_identity(env, event, profile, head):
    need(profile in PROFILES, 'closed mock profile roster')
    need(re.fullmatch('[0-9a-f]{40}', head or '') is not None, 'exact source head')
    need(env.get('GITHUB_EVENT_NAME') == 'pull_request', 'PR source controls only')
    need(env.get('GITHUB_REPOSITORY') == 'CrispStrobe/bw-board', 'own repository')
    need(env.get('GITHUB_RUN_ATTEMPT') == '1', 'initial source-control attempt')
    need(env.get('GITHUB_JOB') == PROFILES[profile][1], 'mock job only')
    need(event.get('action') in ('opened', 'synchronize', 'reopened'), 'source event only')
    pr = event['pull_request']
    need(pr['head']['sha'] == head, 'event/head identity')
    need(pr['head']['repo']['full_name'] == 'CrispStrobe/bw-board', 'own source')


def live_blob(path, size):
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'ordinary source file')
    need(before.st_size == size and size <= 32 << 20, 'bounded source file')
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        need(identity(os.fstat(fd)) == identity(before), 'source changed before read')
        digest = hashlib.sha1(('blob ' + str(size) + '\0').encode('ascii'))
        remaining = size
        while remaining:
            block = os.read(fd, min(65536, remaining))
            need(bool(block), 'truncated source')
            digest.update(block)
            remaining -= len(block)
        need(os.read(fd, 1) == b'', 'source grew')
        need(identity(os.fstat(fd)) == identity(before) == identity(path.lstat()),
             'source changed during read')
        return digest.hexdigest()
    finally:
        os.close(fd)


def admit(profile):
    env = os.environ
    head = env.get('EXPECTED_HEAD') or env.get('BW_EXPECTED_HEAD')
    event_path = Path(env['GITHUB_EVENT_PATH'])
    need(event_path.stat().st_size <= 1 << 20, 'bounded event')
    event_identity(env, json.loads(event_path.read_bytes()), profile, head)
    root = Path.cwd().resolve()
    need(git('rev-parse', '--show-toplevel').decode().strip() == str(root), 'repository root')
    need(git('rev-parse', 'HEAD').decode().strip() == head, 'checked-out event source')
    need(git('rev-parse', '--show-object-format').strip() == b'sha1', 'Git object format')
    git('diff', '--quiet', '--no-ext-diff', 'HEAD', '--')
    git('diff', '--cached', '--quiet', '--no-ext-diff', '--')
    # Untracked executable/import inputs must not enter a clean hosted checkout.
    # Existing workflow-owned report directories are outside the admitted roots.
    need(git('ls-files', '--others', '--exclude-standard', '-z', '--', *ROOTS) == b'',
         'untracked source input')
    rows = git('ls-tree', '-r', '-l', '-z', head, '--', *ROOTS).split(b'\0')
    need(rows[-1] == b'' and 0 < len(rows) - 1 <= 5000, 'finite source inventory')
    inventory = hashlib.sha256()
    total = 0
    paths = set()
    for row in rows[:-1]:
        metadata, encoded_path = row.split(b'\t', 1)
        mode, kind, blob, encoded_size = metadata.split()
        name = encoded_path.decode('utf-8')
        path = root / name
        need(name not in paths and path.parent.resolve() == path.parent, 'ordinary source path')
        paths.add(name)
        need(mode in (b'100644', b'100755') and kind == b'blob', 'ordinary Git role')
        size = int(encoded_size)
        total += size
        need(total <= 128 << 20, 'source aggregate cap')
        need(live_blob(path, size) == blob.decode('ascii'), 'source differs from event commit')
        inventory.update(row + b'\0')
    need('.github/workflows/' + PROFILES[profile][0] in paths, 'executing workflow role')
    return {'schema': 'bw.integrated-diagnostic-controls.source.v1', 'head': head,
            'profile': profile, 'sourceRoles': len(paths), 'sourceBytes': total,
            'inventorySHA256': inventory.hexdigest(),
            'qualification': 'CURRENT_UNIT_CONTROLS_ONLY_NOT_HISTORICAL_EVENT_OR_ACTUAL_QUALIFICATION'}


if __name__ == '__main__':
    try:
        need(len(sys.argv) == 2, 'one fixed profile')
        print(json.dumps(admit(sys.argv[1]), sort_keys=True))
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print('integrated-source-refused: ' + str(error), file=sys.stderr)
        raise SystemExit(1) from None
