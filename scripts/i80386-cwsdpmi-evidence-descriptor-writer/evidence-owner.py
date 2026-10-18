"""Fixed diagnostic writes under retained routes; no compilation/source authority."""
import hashlib
import os
from pathlib import Path
import stat
import types

ROUTE_SHA = '59f1a023b08b2e199dd8d464d47224f6beaeef972e281c0fb73ec68c31f78848'
ROUTE_PATH = Path(__file__).parent.parent / 'i80386-cwsdpmi-compile-root-routes/root-routes.py'
with ROUTE_PATH.open('rb') as stream:
    route_raw = stream.read(32769)
if len(route_raw) > 32768 or hashlib.sha256(route_raw).hexdigest() != ROUTE_SHA:
    raise ValueError('route-source-binding')
routes = types.ModuleType('bound_root_routes')
exec(compile(route_raw, '<bound-root-routes>', 'exec'), routes.__dict__)
MAX_PAYLOAD = 32768

class Refusal(ValueError):
    pass

class EvidenceOwner:
    def __init__(self, toolroot, evidenceroot):
        self._routes = routes.RootRoutes(toolroot, evidenceroot)
        self._busy = False
        self._epoch = 0
        self._first = None
        self._phase = 'new'
        self._attempted = set()
        self._written = set()
        self._close_attempted = 0
        self._close_refused = 0

    def _idle(self):
        if self._busy:
            self._epoch += 1
            self._first = self._first or 'writer-reentry'
            self._routes._first = self._routes._first or 'observer-reentry'
            raise Refusal(self._first)

    def _check(self, allow_closed=False):
        if self._first or self._routes._first or (self._routes._closed and not allow_closed):
            raise Refusal(self._first or 'route-refused')

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
        result = fn(*args, **kw)
        if self._epoch != epoch or self._first or self._routes._first:
            if _open_result:
                self._close_fd(result, close)
            raise Refusal(self._first or 'route-refused')
        return result

    def _recheck(self):
        self._check()
        self._routes._busy = True
        try:
            self._routes._recheck()
        except BaseException as error:
            code = str(error) if type(error) is routes.Refusal else 'filesystem-refusal'
            self._routes._first = self._routes._first or (code if code in routes.REFUSALS else 'filesystem-refusal')
            raise
        finally:
            self._routes._busy = False
        self._check()

    def _latch(self, error):
        allowed = {'payload-bound', 'phase-order', 'write-progress', 'output-changed',
                   'output-type-or-links', 'output-identity', 'route-refused',
                   'attempt-consumed', 'output-initial-extent', 'output-readback'}
        code = str(error) if type(error) is Refusal else 'filesystem-refusal'
        self._first = self._first or (code if code in allowed else 'filesystem-refusal')

    def _write(self, name, payload):
        self._recheck()
        if name in self._attempted:
            raise Refusal("attempt-consumed")
        self._attempted.add(name)
        parent = self._routes._chains[1][-1][2]
        close = os.close
        fd = None
        try:
            fd = self._call(os.open, name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=parent, _open_result=True)
            before = self._file(self._call(os.fstat, fd))
            if before[2] != 0:
                raise Refusal("output-initial-extent")
            count = 0
            while count < len(payload):
                n = self._call(os.write, fd, payload[count:])
                if type(n) is not int or not 0 < n <= len(payload) - count:
                    raise Refusal('write-progress')
                count += n
            after = self._file(self._call(os.fstat, fd))
            offset = 0
            while offset < len(payload):
                block = self._call(os.pread, fd, min(65536, len(payload) - offset), offset)
                if type(block) is not bytes or not block or block != payload[offset:offset + len(block)]:
                    raise Refusal('output-readback')
                offset += len(block)
            if self._call(os.pread, fd, 1, len(payload)) != b'':
                raise Refusal('output-readback')
            read_after = self._file(self._call(os.fstat, fd))
            if read_after != after:
                raise Refusal('output-changed')
            named = self._file(self._call(os.stat, name, dir_fd=parent, follow_symlinks=False))
            if before[:2] != after[:2] or after != named or after[2] != len(payload):
                raise Refusal('output-changed')
            self._recheck()
        except BaseException as error:
            self._latch(error)
            raise
        finally:
            if fd is not None:
                self._close_fd(fd, close)
        self._check()
        self._written.add(name)

    @staticmethod
    def _file(s):
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
            raise Refusal('output-type-or-links')
        fields = (s.st_dev, s.st_ino, s.st_size)
        if not all(type(v) is int and 0 <= v < 2**64 for v in fields):
            raise Refusal('output-identity')
        return fields

    def _perform(self, phase, payload, initial):
        self._idle()
        if self._first:
            raise Refusal(self._first)
        self._busy = True
        try:
            if type(payload) is not bytes or len(payload) > MAX_PAYLOAD:
                raise Refusal('payload-bound')
            if initial:
                if self._phase != 'new':
                    raise Refusal('phase-order')
                self._phase = 'before-consumed'
                self._routes.capture(phase)
                self._write('tool-before.json', payload)
                self._phase = 'before-complete'
            else:
                if self._phase != 'before-complete' or type(phase) is not str or phase not in ('after-link', 'failure-final'):
                    raise Refusal('phase-order')
                self._phase = 'terminal-consumed'
                self._write('tool-terminal.json', payload)
                self._routes.capture(phase)
                self._check(allow_closed=True)
                self._phase = 'complete'
        except BaseException as error:
            self._latch(error)
            try:
                self._routes.close()
            except BaseException:
                self._first = self._first or "cleanup-refusal"
            raise
        finally:
            self._busy = False
        return self.status()

    def before(self, payload):
        return self._perform('before-probes', payload, True)

    def terminal(self, phase, payload):
        return self._perform(phase, payload, False)

    def status(self):
        self._idle()
        return {'phase': self._phase, 'firstFailure': self._first,
                'attemptedFiles': sorted(self._attempted), 'writtenFiles': sorted(self._written),
                'closeAttempted': self._close_attempted, 'closeRefused': self._close_refused,
                'outputCleanupQualified': self._close_refused == 0,
                'routes': self._routes.status(), 'sourceOwnedQualified': False,
                'inputAliasQualified': False, 'compilationQualified': False}

    def close(self):
        self._idle()
        self._busy = True
        try:
            self._routes.close()
            if self._phase != 'complete':
                self._phase = 'closed'
        finally:
            self._busy = False
        return self.status()
