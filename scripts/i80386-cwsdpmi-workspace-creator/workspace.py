"""Source-created directory actions only; no deletion, handoff or compilation."""
import os
import secrets
import stat

class Refusal(ValueError):
    pass

def need(ok, code):
    if not ok:
        raise Refusal(code)

def parts(path):
    need(type(path) is str, 'parent-shape')
    need(len(path) <= 4096, 'parent-cap')
    need(path.startswith('/') and '\0' not in path, 'parent-shape')
    try:
        raw = path.encode('utf-8')
    except UnicodeError:
        raise Refusal('parent-shape') from None
    need(len(raw) <= 4096, 'parent-cap')
    result = path[1:].split('/')
    need(1 <= len(result) <= 32 and all(p not in ('', '.', '..') and len(p.encode('utf-8')) <= 255 for p in result), 'parent-components')
    return result

def ident(s):
    need(stat.S_ISDIR(s.st_mode), 'directory-type')
    need(all(type(v) is int and 0 <= v < 2**64 for v in (s.st_dev, s.st_ino)), 'identity-range')
    return {'dev': s.st_dev, 'ino': s.st_ino}

CODES = frozenset(('directory-type', 'identity-range', 'parent-open-race', 'route-changed',
                  'created-open-race', 'sibling-alias', 'creator-reentry', 'create-order',
                  'closed', 'cleanup-refusal'))

class WorkspaceCreator:
    def __init__(self, parent):
        self._parts = parts(parent)
        token = secrets.token_hex(16)
        need(type(token) is str and len(token) == 32 and all(c in '0123456789abcdef' for c in token), 'session-name')
        self._name = 'session-' + token
        self._fds = []
        self._route = []
        self._created = []
        self._attempted = []
        self._verified = {}
        self._busy = False
        self._epoch = 0
        self._first = None
        self._consumed = False
        self._closed = False
        self._complete = False
        self._close_attempted = 0
        self._close_refused = 0

    def _idle(self):
        if self._busy:
            self._epoch += 1
            self._first = self._first or 'creator-reentry'
            raise Refusal(self._first)

    def _check(self):
        if self._first:
            raise Refusal(self._first)

    def _latch(self, error):
        code = str(error) if type(error) is Refusal else 'filesystem-refusal'
        self._first = self._first or (code if code in CODES else 'filesystem-refusal')

    def _close_fd(self, fd, close):
        self._close_attempted += 1
        try:
            close(fd)
        except BaseException:
            self._close_refused += 1
            self._first = self._first or 'cleanup-refusal'

    def _call(self, fn, *args, _open_result=False, **kw):
        self._check()
        epoch = self._epoch
        close = os.close if _open_result else None
        value = fn(*args, **kw)
        if self._first or epoch != self._epoch:
            if _open_result:
                self._close_fd(value, close)
            raise Refusal(self._first or 'creator-reentry')
        return value

    def _release(self):
        fds, self._fds = self._fds, []
        close = os.close
        for fd in reversed(fds):
            self._close_fd(fd, close)

    def _recheck(self):
        for parent, name, fd, saved in self._route + self._created:
            held = ident(self._call(os.fstat, fd))
            kw = {'follow_symlinks': False}
            if parent is not None:
                kw['dir_fd'] = parent
            named = ident(self._call(os.stat, name, **kw))
            need(held == named == saved, 'route-changed')

    def _open(self, parent, name, code):
        kw = {'follow_symlinks': False}
        if parent is not None:
            kw['dir_fd'] = parent
        before = ident(self._call(os.stat, name, **kw))
        opened = self._call(os.open, name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                            _open_result=True, **({} if parent is None else {'dir_fd': parent}))
        self._fds.append(opened)
        need(ident(self._call(os.fstat, opened)) == before == ident(self._call(os.stat, name, **kw)), code)
        return (parent, name, opened, before)

    def _mkdir(self, role, parent, name):
        self._check()
        self._recheck()
        self._attempted.append(role)  # Consumed before syscall, even if its outcome is unknown.
        self._call(os.mkdir, name, 0o700, dir_fd=parent)
        row = self._open(parent, name, 'created-open-race')
        need(all(row[3] != old[3] for old in self._route + self._created), "sibling-alias")
        self._created.append(row)
        self._recheck()
        self._verified[role] = dict(row[3])
        return row[2]

    def create(self):
        self._idle()
        self._busy = True
        try:
            self._check()
            need(not self._closed, 'closed')
            need(not self._consumed, 'create-order')
            self._consumed = True
            anchor = self._open(None, '/', 'parent-open-race')
            self._route.append(anchor)
            parent = anchor[2]
            for component in self._parts:
                row = self._open(parent, component, 'parent-open-race')
                self._route.append(row)
                parent = row[2]
            self._recheck()
            session = self._mkdir('session', parent, self._name)
            self._mkdir('tool', session, 'tool')
            self._mkdir('evidence', session, 'evidence')
            self._recheck()
            self._check()
            self._complete = True
        except BaseException as error:
            self._latch(error)
            self._release()
            raise
        finally:
            self._busy = False
        return self.status()

    def status(self):
        self._idle()
        return {'attemptedRoles': list(self._attempted), 'verifiedRoles': {k: dict(v) for k, v in self._verified.items()},
                'creationComplete': self._complete, 'closed': self._closed, 'firstFailure': self._first,
                'ownedDescriptors': len(self._fds), 'closeAttempted': self._close_attempted,
                'closeRefused': self._close_refused, 'cleanupQualified': not self._fds and self._close_refused == 0,
                'parentTrustQualified': False, 'sourceOwnedQualified': False,
                'continuousIdentityQualified': False, 'compilationQualified': False}

    def close(self):
        self._idle()
        self._busy = True
        try:
            self._release()
            self._closed = True
        finally:
            self._busy = False
        return self.status()
