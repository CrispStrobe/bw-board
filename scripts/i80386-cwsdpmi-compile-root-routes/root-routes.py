"""Standalone bounded directory routes; no writes or source authority."""
import os
import stat

MAX_COMPONENTS = 32
MAX_PATH_BYTES = 4096
PHASES = ('before-probes', 'after-link', 'failure-final')
REFUSALS = frozenset(('directory-type', 'identity-range', 'anchor-race', 'directory-open-race',
                      'route-changed', 'evidence-inside-tool', 'phase', 'phase-order',
                      'observer-reentry', 'closed', 'cleanup-refusal'))

class Refusal(ValueError):
    pass

def require(ok, code):
    if not ok:
        raise Refusal(code)

def components(path):
    require(type(path) is str, 'path-shape')
    require(len(path) <= MAX_PATH_BYTES, 'path-cap')
    require(path.startswith('/') and '\0' not in path, 'path-shape')
    try:
        encoded = path.encode('utf-8')
    except UnicodeError:
        raise Refusal('path-shape') from None
    require(len(encoded) <= MAX_PATH_BYTES, 'path-cap')
    parts = path[1:].split('/')
    require(1 <= len(parts) <= MAX_COMPONENTS and all(p not in ('', '.', '..') and len(p.encode('utf-8')) <= 255 for p in parts), 'path-components')
    return parts

def identity(value):
    require(stat.S_ISDIR(value.st_mode), 'directory-type')
    require(all(type(x) is int and 0 <= x < 2**64 for x in (value.st_dev, value.st_ino)), 'identity-range')
    return {'dev': value.st_dev, 'ino': value.st_ino}

class RootRoutes:
    def __init__(self, toolroot, evidenceroot):
        self._parts = (components(toolroot), components(evidenceroot))
        self._chains = []
        self._partial = {}
        self._fds = []
        self._busy = False
        self._closed = False
        self._first = None
        self._epoch = 0
        self._attempts = 0
        self._close_attempted = 0
        self._close_refused = 0
        self._before = False

    def _refuse(self, code):
        self._first = self._first or code
        raise Refusal(self._first)

    def _idle(self):
        if self._busy:
            self._epoch += 1
            self._refuse('observer-reentry')

    def _close_fd(self, fd, close):
        self._close_attempted += 1
        try:
            close(fd)
        except BaseException:
            self._close_refused += 1
            self._first = self._first or 'cleanup-refusal'

    def _call(self, fn, *args, _open_result=False, **kw):
        if self._first:
            raise Refusal(self._first)
        epoch = self._epoch
        close = os.close if _open_result else None
        result = fn(*args, **kw)
        if self._epoch != epoch or self._first:
            if _open_result:
                self._close_fd(result, close)
            raise Refusal(self._first or 'observer-reentry')
        return result

    def _release(self):
        owned, self._fds = self._fds, []
        self._chains = []
        close = os.close
        for fd in reversed(owned):
            self._close_fd(fd, close)

    def _open_chain(self, role, parts):
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        before = identity(self._call(os.stat, '/', follow_symlinks=False))
        root = self._call(os.open, '/', flags, _open_result=True)
        self._fds.append(root)
        require(identity(self._call(os.fstat, root)) == before, 'anchor-race')
        chain = [(None, '/', root, before)]
        self._partial[role] = [dict(before)]
        parent = root
        for name in parts:
            prior = identity(self._call(os.stat, name, dir_fd=parent, follow_symlinks=False))
            fd = self._call(os.open, name, flags, dir_fd=parent, _open_result=True)
            self._fds.append(fd)
            require(identity(self._call(os.fstat, fd)) == prior, 'directory-open-race')
            chain.append((parent, name, fd, prior))
            self._partial[role].append(dict(prior))
            parent = fd
        return chain

    def _recheck(self):
        for chain in self._chains:
            for parent, name, fd, saved in chain:
                held = identity(self._call(os.fstat, fd))
                named = identity(self._call(os.stat, name, **({'follow_symlinks': False} if parent is None else {'dir_fd': parent, 'follow_symlinks': False})))
                require(held == named == saved, 'route-changed')
        tool = self._chains[0][-1][3]
        require(all(row[3] != tool for row in self._chains[1]), 'evidence-inside-tool')

    def capture(self, phase):
        self._idle()
        if self._closed:
            self._refuse('closed')
        if self._first:
            raise Refusal(self._first)
        if self._attempts >= 2:
            self._first = 'phase-order'
            self._release()
            raise Refusal(self._first)
        self._busy = True
        self._attempts += 1
        try:
            require(type(phase) is str and phase in PHASES, 'phase')
            require((self._attempts == 1 and phase in ('before-probes', 'failure-final')) or
                    (self._attempts == 2 and self._before and phase in ('after-link', 'failure-final')), 'phase-order')
            if not self._chains:
                for role, parts in zip(('toolroot', 'evidenceroot'), self._parts):
                    self._chains.append(self._open_chain(role, parts))
            self._recheck()
            roles = {role: [dict(row[3]) for row in chain] for role, chain in zip(('toolroot', 'evidenceroot'), self._chains)}
            self._before = phase == 'before-probes'
            result = {'phase': phase, 'attempt': self._attempts, 'complete': True, 'roles': roles,
                      'firstFailure': None, 'sourceOwnedQualified': False, 'continuousIdentityQualified': False}
            if phase != 'before-probes':
                self._release()
                self._closed = True
                if self._first:
                    raise Refusal(self._first)
            return result
        except BaseException as error:
            code = str(error) if type(error) is Refusal else 'filesystem-refusal'
            self._first = self._first or (code if code in REFUSALS else 'filesystem-refusal')
            self._release()
            raise
        finally:
            self._busy = False

    def status(self):
        self._idle()
        return {'attempts': self._attempts, 'ownedDescriptors': len(self._fds), 'closed': self._closed,
                'firstFailure': self._first, 'closeAttempted': self._close_attempted, 'closeRefused': self._close_refused, 'cleanupQualified': not self._fds and self._close_refused == 0, 'partialRoles': {k: [dict(v) for v in rows] for k, rows in self._partial.items()}, 'sourceOwnedQualified': False, 'continuousIdentityQualified': False}

    def close(self):
        self._idle()
        self._busy = True
        try:
            self._release()
            self._closed = True
        finally:
            self._busy = False
        return self.status()
