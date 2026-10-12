"""Private retained-directory composition; no compiler or source authority."""
import hashlib
import os
from pathlib import Path
import types

PINS = {
    'creator': ('i80386-cwsdpmi-workspace-creator/workspace.py', '1c6ac3af4db5eb49a9dbb3dc44140d8ef74b88112ce30f8f5b6b78401950a2f7'),
    'route': ('i80386-cwsdpmi-compile-root-routes/root-routes.py', '59f1a023b08b2e199dd8d464d47224f6beaeef972e281c0fb73ec68c31f78848'),
    'writer': ('i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner.py', 'af4550c1097289d31e569ad599c56e734fea2b2d4e99650ae4f617b43537b2a6'),
}

def _load(role):
    relative, expected = PINS[role]
    path = Path(__file__).parent.parent / relative
    with path.open('rb') as stream:
        raw = stream.read(65537)
    if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('composition-source-binding')
    module = types.ModuleType('private_' + role)
    module.__file__ = str(path)
    exec(compile(raw, '<bound-' + role + '>', 'exec'), module.__dict__)
    return module

creator_module = _load('creator')
route_module = _load('route')
writer_module = _load('writer')
writer_module.routes = route_module

class Refusal(ValueError):
    pass

class _DirectoryLedger:
    """Only directory FDs from creator; output descriptors never enter here."""
    def __init__(self):
        self.fds = [None] * 34
        self.states = [0] * 34  # 0 unused/live registration, 1 live, 2 uncertain, 3 closed.
        self.attempts = 0
        self.refused = 0
        self.unregistered_uncertain = 0

    def register(self, fd):
        if type(fd) is not int or fd < 0 or fd in self.fds:
            raise Refusal('ledger-registration')
        for i, current in enumerate(self.fds):
            if current is None:
                self.fds[i] = fd
                self.states[i] = 1
                return
        raise Refusal('ledger-cap')

    def close_fd(self, fd, close):
        if fd not in self.fds:
            # Returned FD cleanup cannot depend on registering it successfully.
            self.attempts += 1
            try:
                close(fd)
            except BaseException:
                self.refused += 1
                self.unregistered_uncertain += 1
            return
        i = self.fds.index(fd)
        if self.states[i] in (2, 3):
            return
        self.states[i] = 2  # Consumed before syscall; never retry uncertain close.
        self.attempts += 1
        try:
            close(fd)
        except BaseException:
            self.refused += 1
        else:
            self.states[i] = 3

    def release(self):
        close = os.close
        for i in range(33, -1, -1):
            if self.fds[i] is not None and self.states[i] in (0, 1):
                self.close_fd(self.fds[i], close)

    def live(self):
        return [fd for fd, state in zip(self.fds, self.states) if fd is not None and state in (0, 1)]

    def status(self):
        return {'registeredDirectories': sum(fd is not None for fd in self.fds),
                'liveDirectories': len(self.live()), 'closeAttempted': self.attempts,
                'closeRefused': self.refused,
                'uncertainDirectories': self.unregistered_uncertain + sum(fd is not None and state == 2 for fd, state in zip(self.fds, self.states))}

class OwnedWorkspaceEvidence:
    def __init__(self, parent):
        if type(parent) is not str or len(parent) > 4046:
            raise Refusal('parent-bound')
        components = creator_module.parts(parent)
        if len(components) > 30 or len(parent.encode('utf-8')) > 4046:
            raise Refusal('parent-bound')
        self._parent = parent
        self._creator = creator_module.WorkspaceCreator(parent)
        self._writer = None
        self._ledger = _DirectoryLedger()
        self._empty = []
        self._busy = False
        self._first = None
        self._phase = 'new'
        self._joined = False
        self._epoch = 0
        self._install_creator_hooks()

    def _poison(self):
        self._epoch += 1
        self._first = self._first or 'composition-reentry'
        self._creator._epoch += 1
        self._creator._first = self._creator._first or 'creator-reentry'
        if self._writer is not None:
            self._writer._epoch += 1
            self._writer._first = self._writer._first or 'writer-reentry'
            self._writer._routes._epoch += 1
            self._writer._routes._first = self._writer._routes._first or 'observer-reentry'

    def _idle(self):
        if self._busy:
            self._poison()
            raise Refusal(self._first)

    def _check(self):
        if self._first:
            raise Refusal(self._first)

    def _sync_first(self):
        if self._first is None:
            if self._writer is not None:
                self._first = self._writer._first or self._writer._routes._first
            self._first = self._first or self._creator._first

    def _latch(self, error):
        self._sync_first()
        self._first = self._first or ('composition-refused' if isinstance(error, ValueError) else 'composition-operation-refused')

    def _cleanup_counts(self):
        # Both nested owners describe the same canonical directory ledger.
        for inner in (self._creator, None if self._writer is None else self._writer._routes):
            if inner is not None:
                inner._close_attempted = self._ledger.attempts
                inner._close_refused = self._ledger.refused

    def _directory_close(self, fd, close):
        self._sync_first()
        before = self._ledger.refused
        self._ledger.close_fd(fd, close)
        self._cleanup_counts()
        if self._ledger.refused != before:
            self._first = self._first or 'cleanup-refusal'
            self._creator._first = self._creator._first or 'cleanup-refusal'
            if self._writer is not None:
                self._writer._routes._first = self._writer._routes._first or 'cleanup-refusal'

    def _release_directories(self):
        # One canonical ledger, independent of intermediate owner/list assignments.
        self._sync_first()
        before = self._ledger.refused
        self._ledger.release()
        self._cleanup_counts()
        self._creator._fds = self._empty
        if self._writer is not None:
            self._writer._routes._fds = self._empty
            self._writer._routes._chains = self._empty
        if self._ledger.refused != before:
            self._first = self._first or 'cleanup-refusal'
            self._creator._first = self._creator._first or 'cleanup-refusal'
            if self._writer is not None:
                self._writer._routes._first = self._writer._routes._first or 'cleanup-refusal'

    def _install_creator_hooks(self):
        creator = self._creator
        original_call = creator._call
        def call(fn, *args, _open_result=False, **kw):
            close = os.close if _open_result else None
            fd = None
            try:
                value = original_call(fn, *args, _open_result=_open_result, **kw)
                if _open_result:
                    fd = value
                    self._ledger.register(fd)
                return value
            except BaseException as error:
                creator._latch(error)
                self._sync_first()
                if fd is not None:
                    self._directory_close(fd, close)
                raise
        creator._call = call
        creator._close_fd = self._directory_close
        creator._release = self._release_directories

    def _prepare_chains(self):
        c = self._creator
        if not c._complete or set(c._verified) != {'session', 'tool', 'evidence'} or len(c._created) != 3:
            raise Refusal('creation-incomplete')
        def copy_row(row):
            return (row[0], row[1], row[2], dict(row[3]))
        parent = [copy_row(row) for row in c._route]
        session, tool, evidence = [copy_row(row) for row in c._created]
        chains = [parent + [session, tool], parent + [session, evidence]]
        fds = self._ledger.live()
        if len(fds) != len(c._fds) or set(fds) != set(c._fds):
            raise Refusal('ledger-join')
        partial = {role: [dict(row[3]) for row in chain] for role, chain in zip(('toolroot', 'evidenceroot'), chains)}
        return chains, fds, partial

    def _join(self):
        if self._joined:
            raise Refusal('join-order')
        c = self._creator
        session_path = self._parent + '/' + c._name
        self._writer = writer_module.EvidenceOwner(session_path + '/tool', session_path + '/evidence')
        r = self._writer._routes
        # Install close-once ownership before seeding either FD-bearing field.
        r._close_fd = self._directory_close
        r._release = self._release_directories
        chains, fds, partial = self._prepare_chains()
        self._check()
        r._chains = chains
        r._partial = partial
        r._fds = fds
        c._fds = self._empty
        self._joined = True
        self._check()

    def prepare(self):
        self._idle()
        self._busy = True
        try:
            self._check()
            if self._phase != 'new':
                raise Refusal('prepare-order')
            self._phase = 'prepare-consumed'
            self._creator.create()
            self._check()
            self._join()
            self._phase = 'prepared'
        except BaseException as error:
            self._latch(error)
            try:
                self._release_directories()
            except BaseException:
                self._first = self._first or "cleanup-refusal"
            raise
        finally:
            self._busy = False
        return self.status()

    def _write(self, terminal, phase, payload):
        self._idle()
        self._busy = True
        try:
            self._check()
            expected = 'before-complete' if terminal else 'prepared'
            if self._phase != expected:
                raise Refusal('write-order')
            self._phase = 'terminal-consumed' if terminal else 'before-consumed'
            if terminal:
                self._writer.terminal(phase, payload)
            else:
                self._writer.before(payload)
            self._check()
            self._phase = 'complete' if terminal else 'before-complete'
        except BaseException as error:
            self._latch(error)
            try:
                self._release_directories()
            except BaseException:
                self._first = self._first or "cleanup-refusal"
            raise
        finally:
            self._busy = False
        return self.status()

    def before(self, payload):
        return self._write(False, None, payload)

    def terminal(self, phase, payload):
        return self._write(True, phase, payload)

    def status(self):
        self._idle()
        creation = self._creator.status()
        writer = None if self._writer is None else self._writer.status()
        for nested in (creation, None if writer is None else writer['routes']):
            if nested is not None:
                nested['directoryAccounting'] = 'shared-canonical-ledger'
                nested['ownedDescriptors'] = len(self._ledger.live())
                nested['cleanupQualified'] = not self._ledger.live() and self._ledger.refused == 0
                nested['closeAttempted'] = self._ledger.attempts
                nested['closeRefused'] = self._ledger.refused
        return {'phase': self._phase, 'firstFailure': self._first, 'joined': self._joined,
                'directories': self._ledger.status(), 'creation': creation,
                'writer': writer,
                'parentTrustQualified': False, 'sourceOwnedQualified': False,
                'continuousIdentityQualified': False, 'inputAliasQualified': False,
                'compilationQualified': False, 'guestQualified': False, 'performanceQualified': False}

    def close(self):
        self._idle()
        self._busy = True
        try:
            self._release_directories()
            if self._phase != 'complete':
                self._phase = 'closed'
        finally:
            self._busy = False
        return self.status()
