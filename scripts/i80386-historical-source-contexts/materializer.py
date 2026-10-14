"""Fixed historical Git materializer. Import and hosted qualification are separate."""
import hashlib
import importlib.util
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import tempfile
import time

_PARENT_SHA = '90b44dcb15ff82b2e7048d42676d00a830b9ead54f58fdd5930eafe3d4003a04'
_GIT = '/usr/bin/git'
_CAP = 4 * 1024 * 1024
_PREFIX = ('--no-replace-objects', '-c', 'core.hooksPath=/dev/null',
           '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false',
           '-c', 'core.eol=lf', '-c', 'core.attributesFile=/dev/null',
           '-c', 'submodule.recurse=false', '-c', 'protocol.allow=never')
_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C',
        'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_TERMINAL_PROMPT': '0',
        'GIT_NO_LAZY_FETCH': '1', 'GIT_OPTIONAL_LOCKS': '0',
        'GIT_PAGER': 'cat'}


def _parent():
    # Fixed sibling only; no caller module/root route.
    target = Path(__file__).absolute().with_name('context.py')
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    primary = None
    body = None
    try:
        initial = os.fstat(fd)
        if not stat.S_ISREG(initial.st_mode) or initial.st_nlink != 1 or initial.st_size != 16797:
            raise ValueError('parent-file')
        parts, count = [], 0
        while True:
            chunk = os.read(fd, min(65536, initial.st_size + 1 - count))
            count += len(chunk)
            if count > initial.st_size:
                raise ValueError('parent-cap')
            if not chunk:
                break
            parts.append(chunk)
        end = os.fstat(fd)
        named = os.stat(target, follow_symlinks=False)
        facts = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_mode, s.st_nlink)
        body = b''.join(parts)
        if count != initial.st_size or facts(initial) != facts(end) or facts(end) != facts(named):
            raise ValueError('parent-changed')
        if hashlib.sha256(body).hexdigest() != _PARENT_SHA:
            raise ValueError('parent-seal')
    except BaseException as error:
        primary = error
    finally:
        try:
            os.close(fd)
        except BaseException as error:
            if primary is None:
                primary = error
    if primary is not None:
        raise primary
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader('_held_context', loader=None))
    module.__file__ = str(target)
    exec(compile(body, str(target), 'exec'), module.__dict__)
    return module


_held = _parent()
Refusal, need = _held.Refusal, _held.need


class Materializer(_held.Context):
    """No caller root, commit, commands, environment or import delegation."""
    def __init__(self):
        super().__init__()
        self._adapter = None
        self._adapter_released = False
        self._operations = None
        self._started = None
        self._last_clock = None
        self._startup_active = True
        self._provider = None
        self._git_prefix = None
        self._git_environment = None
        self._root_identity = None
        self._context_commit = None
        self._proof_pin = None
        self._common_path = None
        self._rows = {}
        self._objects = {}
        self._blobs = {}
        self._observations = {'materialized': False, 'readbackComplete': False,
                              'finalReadbackComplete': False, 'releaseAttempted': False,
                              'releaseComplete': False, 'cleanupUncertain': False}

    def _admit(self):
        # Capture all syscall/process/hash bindings before the first boundary.
        self._operations = (subprocess.Popen, selectors.DefaultSelector,
                            time.monotonic, os.killpg, os.open, os.read,
                            os.fstat, os.stat, os.close, hashlib.sha256,
                            hashlib.sha1, tempfile.mkdtemp, os.mkdir,
                            os.rmdir, os.unlink, os.set_blocking, os.write, os.geteuid)
        self._context_commit = _held._COMMIT
        self._proof_pin = self._pins()[1][1]
        self._git_prefix = (_GIT,) + tuple(_PREFIX)
        self._git_environment = tuple(_ENV.items())
        self._provider = Path(__file__).absolute().parents[2]
        self._started = self._clock()
        need(self._git(self._provider, ('rev-parse', '--show-toplevel')).strip() == str(self._provider).encode(), 'provider-root')
        need(self._git(self._provider, ('remote', 'get-url', 'origin')).strip() in (b'https://github.com/CrispStrobe/bw-board.git', b'https://github.com/CrispStrobe/bw-board'), 'provider-origin')
        self._conversion_guard(self._provider)
        return True

    def _clock(self):
        value = self._operations[2]()
        self._check()
        need(type(value) in (int, float) and math.isfinite(value), 'clock')
        need(self._last_clock is None or value >= self._last_clock, 'clock-backward')
        self._last_clock = value
        if self._started is not None and self._startup_active:
            need(0 <= value - self._started <= 120, 'startup-deadline')
        return value

    def _git(self, root, arguments, allowed=(0,), *, cleanup=False):
        # Only internal fixed operations invoke this private transport.
        popen, selector_type, clock, killpg = self._operations[:4]
        read, set_blocking, cap = self._operations[5], self._operations[15], _CAP
        argv = self._git_prefix + ('-C', str(root)) + tuple(arguments)
        fence = (lambda: None) if cleanup else self._check
        clock_now = clock if cleanup else self._clock
        fence()
        begin = clock_now()
        process, selector, primary = None, None, None
        outputs = [bytearray(), bytearray()]
        try:
            process = popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=dict(self._git_environment), shell=False,
                            start_new_session=True, close_fds=True)
            fence()
            selector = selector_type()
            fence()
            for index, pipe in enumerate((process.stdout, process.stderr)):
                set_blocking(pipe.fileno(), False)
                fence()
                selector.register(pipe, selectors.EVENT_READ, index)
                fence()
            while selector.get_map():
                now = clock_now()
                remaining = min(10 - (now - begin), 10 if cleanup or not self._startup_active else 120 - (now - self._started))
                need(remaining > 0, 'git-deadline')
                events = selector.select(min(remaining, 0.1))
                fence()
                for key, _ in events:
                    body = read(key.fileobj.fileno(), min(65536, cap + 1 - len(outputs[key.data])))
                    fence()
                    need(type(body) is bytes, 'git-pipe-shape')
                    available = cap - len(outputs[key.data])
                    outputs[key.data].extend(body[:available])
                    need(len(body) <= available, 'git-output-cap')
                    if not body:
                        selector.unregister(key.fileobj)
                        fence()
            now = clock_now()
            remaining = min(10 - (now - begin), 10 if cleanup or not self._startup_active else 120 - (now - self._started))
            need(remaining > 0, 'git-wait-deadline')
            code = process.wait(timeout=remaining)
            fence()
            need(type(code) is int and code in allowed, 'git-exit')
        except BaseException as error:
            primary = error
        finally:
            if primary is not None and process is not None and process.returncode is None:
                try:
                    # Only an unreaped original child retains this cleanup identity.
                    # A waited/reaped leader provides no descendant lease.
                    killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except BaseException:
                    self._observations['cleanupUncertain'] = True
                try:
                    process.wait(timeout=1)
                except BaseException:
                    self._observations['cleanupUncertain'] = True
            for owned in (selector, getattr(process, 'stdout', None), getattr(process, 'stderr', None)):
                if owned is not None:
                    try:
                        owned.close()
                    except BaseException as error:
                        self._observations['cleanupUncertain'] = True
                        if primary is None:
                            primary = error
        if primary is not None:
            raise primary
        return bytes(outputs[0])

    def _conversion_guard(self, root):
        names = self._git(root, ('config', '--no-includes', '--local', '--name-only', '--get-regexp',
                                r'^(filter\.|include\.|includeif\.|core\.(attributesfile|autocrlf|eol|fsmonitor)$|extensions\.(partialclone|worktreeconfig)$|remote\..*\.promisor$)'), (0, 1))
        need(not names, 'conversion-config')
        common = self._git(root, ('rev-parse', '--path-format=absolute', '--git-common-dir')).strip().decode('utf-8')
        need(common.startswith('/') and '\n' not in common, 'common-dir')
        if self._common_path is None:
            self._common_path = Path(common)
        need(Path(common) == self._common_path, 'common-dir-join')
        target = Path(common) / 'info' / 'attributes'
        try:
            self._operations[7](target, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise Refusal('info-attributes')
        listing = self._git(root, ('ls-tree', '-r', '--name-only', '-z', self._context_commit))
        need(all(name.rsplit(b'/', 1)[-1] != b'.gitattributes' for name in listing.split(b'\0') if name), 'tracked-attributes')

    def _tree_row(self, commit, relative):
        raw = self._git(self._provider, ('ls-tree', '-z', commit, '--', relative))
        need(raw.endswith(b'\0') and raw.count(b'\0') == 1, 'tree-entry')
        header, name = raw[:-1].split(b'\t', 1)
        mode, kind, blob = header.split(b' ')
        need(mode in (b'100644', b'100755') and kind == b'blob' and name == relative.encode(), 'tree-mode')
        identifier = blob.decode('ascii')
        _held.hexvalue(identifier, 40)
        if identifier not in self._blobs:
            body = self._git(self._provider, ('cat-file', 'blob', identifier))
            need(0 < len(body) <= _CAP, 'blob-cap')
            sha1 = self._hash(self._operations[10], b'blob ' + str(len(body)).encode() + b'\0' + body, 40)
            self._check()
            need(sha1 == identifier, 'blob-identity')
            self._blobs[identifier] = body
        body = self._blobs[identifier]
        sha = self._hash(self._operations[9], body, 64)
        self._check()
        return {'bytes': len(body), 'sha256': sha, 'gitBlob': identifier}

    def _materialize(self, table):
        rows = _held.parse(_held.canonical(table['rows']))
        proof_raw = _held.regular_metadata('original-proofs.json')
        self._check()
        need(self._hash(self._operations[9], proof_raw, 64) == self._proof_pin, 'proof-seal')
        self._check()
        proofs = _held.parse(proof_raw)
        required = [(self._context_commit, rows)]
        required += [(item['reportedCommit'], item['sourceRows']) for item in proofs['javascript'].values()]
        required += [(proofs['PIC111']['compiledCommit'], proofs['PIC111']['rows'])]
        # Native execution commits predate capture publication. Encoded files
        # are authenticated at the compatible context by the held row table.
        required += [(item['originalBoardCommit'], {})
                     for item in proofs['native'].values()]
        for commit, mapping in required:
            _held.hexvalue(commit, 40)
            need(self._git(self._provider, ('cat-file', '-t', commit)).strip() == b'commit', 'missing-commit')
            for relative, expected in mapping.items():
                observed = self._tree_row(commit, relative)
                need(observed == expected, 'original-object-join')
                self._objects[(commit, relative)] = observed
        self._rows = rows
        parent = self._operations[11](prefix='bw-held-', dir='/tmp')
        self._adapter = (Path(parent), Path(parent) / 'source', None)
        primary = None
        try:
            self._check()
            need(type(parent) is str and Path(parent).parent == Path('/tmp')
                 and Path(parent).name.startswith('bw-held-')
                 and len(Path(parent).name) > len('bw-held-')
                 and len(parent) <= 100 and '\n' not in parent, 'temporary-path')
            first = self._operations[7](parent, follow_symlinks=False)
            self._check()
            uid = self._operations[17]()
            self._check()
            need(type(uid) is int and stat.S_ISDIR(first.st_mode)
                 and stat.S_IMODE(first.st_mode) == 0o700 and first.st_uid == uid, 'temporary-owner')
            self._adapter = (Path(parent), Path(parent) / 'source', (first.st_dev, first.st_ino))
            root = self._adapter[1]
            self._operations[12](root, 0o700)
            self._check()
            root_stat = self._operations[7](root, follow_symlinks=False)
            self._check()
            need(stat.S_ISDIR(root_stat.st_mode), 'worktree-directory')
            self._root_identity = (root_stat.st_dev, root_stat.st_ino)
            self._git(self._provider, ('worktree', 'add', '--no-checkout', '--detach', str(root), self._context_commit))
            self._conversion_guard(root)
            gitdir = self._git(root, ('rev-parse', '--absolute-git-dir')).strip().decode('utf-8')
            need(self._common_path is not None and Path(gitdir).parent == self._common_path / 'worktrees', 'owned-worktree-gitdir')
            gitdir_stat = self._operations[7](gitdir, follow_symlinks=False)
            self._check()
            need(stat.S_ISDIR(gitdir_stat.st_mode), 'worktree-gitdir')
            info = Path(gitdir) / 'info'
            try:
                self._operations[12](info, 0o700)
            except FileExistsError:
                pass
            self._check()
            info_stat = self._operations[7](info, follow_symlinks=False)
            self._check()
            need(stat.S_ISDIR(info_stat.st_mode), 'worktree-info')
            sparse = info / 'sparse-checkout'
            patterns = ''.join('/' + name + '\n' for name in sorted(rows)).encode()
            fd = self._operations[4](sparse, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            error = None
            try:
                need(type(fd) is int and fd >= 0, 'sparse-fd')
                self._check()
                need(self._operations[16](fd, patterns) == len(patterns), 'sparse-write')
                self._check()
            except BaseException as caught:
                error = caught
            finally:
                if type(fd) is int and fd >= 0:
                    try:
                        self._operations[8](fd)
                    except BaseException as caught:
                        if error is None:
                            error = caught
            if error is not None:
                raise error
            self._git(root, ('-c', 'core.sparseCheckout=true', '-c', 'core.sparseCheckoutCone=false',
                             'read-tree', '-mu', self._context_commit))
            need(self._git(root, ('rev-parse', 'HEAD')).strip() == self._context_commit.encode(), 'materialized-head')
            need(not self._git(root, ('symbolic-ref', '-q', 'HEAD'), (1,)), 'detached-head')
            self._clean(root)
            self._observations['materialized'] = True
            return (self._context_commit, 'CrispStrobe/bw-board', True, True, str(root))
        except BaseException as caught:
            primary = caught
        finally:
            if primary is not None:
                try:
                    self._remove()
                except BaseException:
                    self._observations['cleanupUncertain'] = True
        if primary is not None:
            raise primary

    def _owner(self, owner):
        need(self._adapter is not None and type(owner) is tuple and len(owner) == 5
             and owner[4] == str(self._adapter[1]) and not self._adapter_released, 'adapter-owner')
        return self._adapter[1]

    def _git_row(self, owner, commit, relative):
        self._owner(owner)
        need((commit, relative) in self._objects, 'fixed-object')
        return dict(self._objects[(commit, relative)])

    def _read_row(self, owner, relative):
        root = self._owner(owner)
        need(relative in self._rows, 'fixed-read')
        opening, read, fstat, namedstat, close = self._operations[4:9]
        descriptors = []
        primary = None
        body = None
        facts = lambda value: (value.st_dev, value.st_ino, value.st_size,
                               value.st_mtime_ns, value.st_mode, value.st_nlink)
        try:
            root_fd = opening(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            if type(root_fd) is int and root_fd >= 0:
                descriptors.append(root_fd)
            self._check()
            need(type(root_fd) is int and root_fd >= 0, 'root-fd')
            root_stat = fstat(root_fd)
            self._check()
            need(stat.S_ISDIR(root_stat.st_mode)
                 and (root_stat.st_dev, root_stat.st_ino) == self._root_identity,
                 'read-root-identity')
            parent = root_fd
            held_directories = [(root_fd, root, None)]
            for component in relative.split('/')[:-1]:
                fd = opening(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=parent)
                if type(fd) is int and fd >= 0 and fd not in descriptors:
                    descriptors.append(fd)
                self._check()
                need(type(fd) is int and fd >= 0 and fd != parent, 'directory-fd')
                held = fstat(fd)
                self._check()
                named = namedstat(component, dir_fd=parent, follow_symlinks=False)
                self._check()
                need(stat.S_ISDIR(held.st_mode) and facts(held) == facts(named),
                     'source-directory-identity')
                held_directories.append((fd, component, parent))
                parent = fd
            name = relative.rsplit('/', 1)[-1]
            fd = opening(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=parent)
            if type(fd) is int and fd >= 0 and fd not in descriptors:
                descriptors.append(fd)
            self._check()
            need(type(fd) is int and fd >= 0 and fd != parent, 'source-fd')
            initial = fstat(fd)
            self._check()
            expected = self._rows[relative]['bytes']
            need(stat.S_ISREG(initial.st_mode) and initial.st_nlink == 1
                 and initial.st_size == expected, 'source-file')
            parts, count = [], 0
            while True:
                chunk = read(fd, min(65536, expected + 1 - count))
                self._check()
                need(type(chunk) is bytes, 'source-read')
                count += len(chunk)
                need(count <= expected, 'source-extent')
                if not chunk:
                    break
                parts.append(chunk)
            end = fstat(fd)
            self._check()
            named = namedstat(name, dir_fd=parent, follow_symlinks=False)
            self._check()
            need(count == expected and facts(initial) == facts(end) == facts(named),
                 'source-changed')
            for held_fd, component, parent_fd in held_directories:
                held = fstat(held_fd)
                self._check()
                kwargs = {'follow_symlinks': False}
                if parent_fd is not None:
                    kwargs['dir_fd'] = parent_fd
                named = namedstat(component, **kwargs)
                self._check()
                need(stat.S_ISDIR(held.st_mode) and facts(held) == facts(named),
                     'source-directory-changed')
            body = b''.join(parts)
        except BaseException as error:
            primary = error
        finally:
            while descriptors:
                consumed = descriptors.pop()
                try:
                    close(consumed)
                except BaseException as error:
                    self._observations['cleanupUncertain'] = True
                    if primary is None:
                        primary = error
        if primary is not None:
            raise primary
        return body

    def _clean(self, root):
        need(not self._git(root, ('diff-index', '--cached', '--raw', '-z', self._context_commit, '--')), 'index-drift')
        need(not self._git(root, ('ls-files', '--others', '-z')), 'untracked-drift')
        # Live source bytes are checked independently, without Git conversion.

    def _remove(self):
        if self._adapter is None or self._adapter_released:
            return
        self._adapter_released = True
        parent, root, identity = self._adapter
        self._observations['releaseAttempted'] = True
        need(identity is not None, 'cleanup-owner-unknown')
        current = self._operations[7](parent, follow_symlinks=False)
        need(stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino) == identity, 'cleanup-parent-changed')
        root_stat = self._operations[7](root, follow_symlinks=False)
        need(stat.S_ISDIR(root_stat.st_mode) and (root_stat.st_dev, root_stat.st_ino) == self._root_identity, 'cleanup-root-changed')
        try:
            self._git(self._provider, ('worktree', 'remove', '--force', str(root)), cleanup=True)
        except BaseException as removal_error:
            # Failed add can leave the original empty directory unregistered.
            # Only an empty owned directory may be removed without Git.
            try:
                self._operations[13](root)
                listing = self._git(self._provider, ('worktree', 'list', '--porcelain', '-z'), cleanup=True)
                need(b'worktree ' + str(root).encode() not in listing.split(b'\0'), 'registration-remains')
            except BaseException:
                raise removal_error
        final_parent = self._operations[7](parent, follow_symlinks=False)
        need(stat.S_ISDIR(final_parent.st_mode)
             and (final_parent.st_dev, final_parent.st_ino) == identity, 'cleanup-parent-changed')
        self._operations[13](parent)
        self._observations['releaseComplete'] = True

    def _release(self, owner):
        root = self._owner(owner)
        primary = None
        try:
            self._clean(root)
            for relative, expected in self._rows.items():
                body = self._read_row(owner, relative)
                need(self._hash(self._operations[9], body, 64) == expected['sha256'], 'final-source-drift')
                self._check()
            self._observations['finalReadbackComplete'] = True
        except BaseException as error:
            primary = error
        finally:
            try:
                self._remove()
            except BaseException as error:
                self._observations['cleanupUncertain'] = True
                if primary is None:
                    primary = error
        if primary is not None:
            raise primary

    def _prepare(self):
        try:
            result = super()._prepare()
        finally:
            self._startup_active = False
        self._observations['readbackComplete'] = True
        return result

    def observations(self):
        return {'schema': 'bw.historical-materializer-observations.v1',
                **dict(self._observations), 'hostedQualified': False,
                'continuousOwnershipQualified': False, 'hardDeadlineQualified': False,
                'historicalRuntimeQualified': False, 'currentCpuQualified': False}


def actual():
    raise Refusal('historical-materializer-actual-unsealed')
