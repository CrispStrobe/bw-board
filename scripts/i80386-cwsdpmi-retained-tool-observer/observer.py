"""Retained-root fixed tool observations only; no compiler or source authority."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import types

OWNER_SHA = '103db42253d9ced7d9c7e617d83955879c9a7144bb124dcbb6520ac34de4579b'
DEPENDENCIES = {
    'owner': OWNER_SHA,
    'creator': '1c6ac3af4db5eb49a9dbb3dc44140d8ef74b88112ce30f8f5b6b78401950a2f7',
    'route': '59f1a023b08b2e199dd8d464d47224f6beaeef972e281c0fb73ec68c31f78848',
    'writer': 'af4550c1097289d31e569ad599c56e734fea2b2d4e99650ae4f617b43537b2a6',
}
PROVENANCE = {'boundarySha256': '950f84462c1d75717e3704052bedae9de951122af5e7ecbda6cd99587b211934',
              'heldCompileSha256': '959931875f090164b2a0d34f07f6eb1b06940d0f34c1ef6c2f7e8c903f87ac51'}
SELECTED = {'compiler': ('djgpp/bin/i586-pc-msdosdjgpp-gcc', 'afd20f428ccb032b21f00832587219d236efde25344c8067f820b1e677d0799f'), 'assembler': ('djgpp/i586-pc-msdosdjgpp/bin/as', '41dda143ed208ffeb62722e0963193b0a2450bdd0aa00c5bd394115e3b2eef24'), 'linker': ('djgpp/i586-pc-msdosdjgpp/bin/ld', '99f2e74294e340136f3345982f6c95f59431a75abbc01734552e63a84b9cfc65'), 'stubify': ('djgpp/i586-pc-msdosdjgpp/bin/stubify', 'e0f233de37256389434894ce38158c9e68c57c46f7cbe332021ad64577751a09'), 'dpmi.h': ('djgpp/i586-pc-msdosdjgpp/sys-include/dpmi.h', 'cf73c8314e4ae364d6160913bae31be5d9f5800c1d333af1291e4e49f61627b3'), 'farptr.h': ('djgpp/i586-pc-msdosdjgpp/sys-include/sys/farptr.h', 'b38414509d8e1e59de9402188ed003ab7e2cde3bd50786318aedb0232329547d'), 'crt0.o': ('djgpp/i586-pc-msdosdjgpp/lib/crt0.o', 'ee1b0b2cf7b2645708ce35bff4c4c18322aa7e29f89eed5769c4a138cf4acfae'), 'libc.a': ('djgpp/i586-pc-msdosdjgpp/lib/libc.a', 'f59d5106cc668a67c3334c33be2c273df7c69dce93e4e53ef8a52c07a9fbda78'), 'libgcc.a': ('djgpp/lib/gcc/i586-pc-msdosdjgpp/12.2.0/libgcc.a', 'e9d6ad2b2c679617b4d305b655039403514ba8f140805f2b75044ffcf16bc4b7')}
SCHEMA = 'bw.retained-tool-observation.v1'
MAX_FILE = 16 << 20
MAX_TOTAL = 64 << 20
MAX_RECEIPT = 32 << 10
PHASES = ('before-probes', 'after-link', 'failure-final')
CODES = frozenset(('observer-reentry', 'phase-order', 'source-route-refused',
                  'filesystem-refusal', 'directory-type', 'identity-range',
                  'directory-open-race', 'directory-changed', 'file-type-or-links',
                  'file-size', 'total-size', 'file-open-race', 'file-read-race',
                  'pin-mismatch', 'cleanup-refusal', 'file-alias', 'local-fd-cap'))

class Refusal(ValueError):
    pass

def need(ok, code):
    if not ok:
        raise Refusal(code)

def _load_owner():
    path = Path(__file__).parent.parent / 'i80386-cwsdpmi-owned-workspace-evidence/owner.py'
    with path.open('rb') as stream:
        raw = stream.read(65537)
    need(len(raw) <= 65536 and hashlib.sha256(raw).hexdigest() == OWNER_SHA, 'source-route-refused')
    module = types.ModuleType('private_retained_workspace')
    module.__file__ = str(path)
    exec(compile(raw, '<fixed-workspace-owner>', 'exec'), module.__dict__)
    return module

owner_module = _load_owner()

def _u64(value):
    return type(value) is int and 0 <= value < 2**64

def _identity(value):
    values = (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_nlink)
    need(all(_u64(v) for v in values), 'identity-range')
    return dict(zip(('dev', 'ino', 'bytes', 'mtimeNs', 'ctimeNs', 'links'), values))

def _directory(value):
    need(stat.S_ISDIR(value.st_mode), 'directory-type')
    need(_u64(value.st_dev) and _u64(value.st_ino), 'identity-range')
    return {'dev': value.st_dev, 'ino': value.st_ino}

def _regular(value):
    need(stat.S_ISREG(value.st_mode) and value.st_nlink == 1, 'file-type-or-links')
    result = _identity(value)
    need(0 < result['bytes'] <= MAX_FILE, 'file-size')
    return result

class _LocalFDs:
    def __init__(self, borrowed):
        self.borrowed = borrowed
        self.fds = [None] * 8
        self.consumed = [False] * 8
        self.close = os.close
        self.attempted = 0
        self.refused = 0

    def register(self, fd):
        need(type(fd) is int and fd >= 0 and fd != self.borrowed and fd not in self.fds, 'identity-range')
        for i in range(8):
            if self.fds[i] is None:
                self.fds[i] = fd
                return
        raise Refusal('local-fd-cap')

    def returned_cleanup(self, fd):
        # Does not require registration, including interruption before assignment.
        # A refused alias to the borrowed root is never ours to close.
        if type(fd) is not int or fd < 0 or fd == self.borrowed:
            return
        if fd in self.fds:
            i = self.fds.index(fd)
            if self.consumed[i]:
                return
            self.consumed[i] = True
        self.attempted += 1
        try:
            self.close(fd)
        except BaseException:
            self.refused += 1

    def release(self):
        for i in range(7, -1, -1):
            if self.fds[i] is not None and not self.consumed[i]:
                self.returned_cleanup(self.fds[i])

class RetainedToolObserver:
    def __init__(self, parent):
        # Fixed owner validates parent before filesystem operations.
        self._owner = owner_module.OwnedWorkspaceEvidence(parent)
        session = secrets.token_hex(32)
        need(type(session) is str and len(session) == 64 and all(c in '0123456789abcdef' for c in session), 'identity-range')
        self._session = session
        self._phase = 'new'
        self._busy = False
        self._epoch = 0
        self._reentered = False
        self._first = None
        self._secondary = None
        self._reports = []
        self._attempts = 0
        self._emitted = []
        self._diagnostic_started = False
        self._terminal_diagnostic_started = False
        self._local_attempted = 0
        self._local_refused = 0

    def _enter(self):
        if self._busy:
            self._epoch += 1
            self._reentered = True
            self._first = self._first or 'observer-reentry'
            self._owner._poison()
            raise Refusal('observer-reentry')
        self._busy = True

    def _check(self):
        need(not self._reentered, 'observer-reentry')
        need(self._first is None, self._first or 'filesystem-refusal')
        need(self._owner._first is None, 'source-route-refused')

    def _latch(self, error):
        code = str(error) if type(error) is Refusal else 'filesystem-refusal'
        self._first = self._first or (code if code in CODES else 'filesystem-refusal')

    def _call(self, fn, *args, _fds=None, **kw):
        self._check()
        epoch = self._epoch
        value = fn(*args, **kw)
        try:
            self._check()
            need(self._epoch == epoch, 'observer-reentry')
            if _fds is not None:
                _fds.register(value)
        except BaseException as error:
            self._latch(error)
            if _fds is not None:
                _fds.returned_cleanup(value)
            raise
        return value

    def _route_check(self):
        self._check()
        # Private root route helper has no external observer admission API.
        routes = self._owner._writer._routes
        routes._busy = True
        try:
            routes._recheck()
        except BaseException as error:
            code = str(error) if type(error) is owner_module.route_module.Refusal else 'filesystem-refusal'
            routes._first = routes._first or (code if code in owner_module.route_module.REFUSALS else 'filesystem-refusal')
            self._first = self._first or ('observer-reentry' if self._reentered else 'source-route-refused')
            raise
        finally:
            routes._busy = False
        self._check()

    def _observe(self, relative, receipt):
        root = self._owner._writer._routes._chains[0][-1][2]
        local = _LocalFDs(root)
        chain = []
        try:
            parent = root
            parts = relative.split('/')
            need(1 <= len(parts) <= 8 and all(p and p not in ('.', '..') and '/' not in p for p in parts), 'source-route-refused')
            for component in parts[:-1]:
                prior = _directory(self._call(os.stat, component, dir_fd=parent, follow_symlinks=False))
                fd = self._call(os.open, component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent, _fds=local)
                opened = _directory(self._call(os.fstat, fd))
                named = _directory(self._call(os.stat, component, dir_fd=parent, follow_symlinks=False))
                need(prior == opened == named, 'directory-open-race')
                chain.append((parent, component, fd, prior))
                parent = fd
            name = parts[-1]
            prior = _regular(self._call(os.stat, name, dir_fd=parent, follow_symlinks=False))
            # Reserve known extent BEFORE content open or read.
            need(receipt['reservedBytes'] + prior['bytes'] <= MAX_TOTAL, 'total-size')
            receipt['reservedBytes'] += prior['bytes']
            role = tuple(SELECTED)[len(receipt['roles'])]
            receipt['reservations'][role] = prior['bytes']
            receipt['reservationOrder'].append(role)
            fd = self._call(os.open, name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent, _fds=local)
            opened = _regular(self._call(os.fstat, fd))
            need(opened == prior, 'file-open-race')
            digest = hashlib.sha256()
            count = 0
            while count <= prior['bytes']:
                block = self._call(os.read, fd, min(65536, prior['bytes'] + 1 - count))
                if not block:
                    break
                count += len(block)
                need(count <= prior['bytes'], 'file-read-race')
                digest.update(block)
            after = _regular(self._call(os.fstat, fd))
            named = _regular(self._call(os.stat, name, dir_fd=parent, follow_symlinks=False))
            need(prior == opened == after == named and count == prior['bytes'], 'file-read-race')
            for owner, component, held, saved in reversed(chain):
                need(_directory(self._call(os.fstat, held)) == saved == _directory(self._call(os.stat, component, dir_fd=owner, follow_symlinks=False)), 'directory-changed')
            return {'before': prior, 'opened': opened, 'after': after, 'named': named, 'sha256': digest.hexdigest()}
        except BaseException as error:
            self._latch(error)
            raise
        finally:
            local.release()
            self._local_attempted += local.attempted
            self._local_refused += local.refused
            if local.refused:
                self._first = self._first or 'cleanup-refusal'

    def _receipt(self, phase, kind, sequence):
        return {'schema': SCHEMA, 'protocol': 1, 'dependencies': dict(DEPENDENCIES),
                'predicateProvenance': dict(PROVENANCE), 'session': self._session,
                'sequence': sequence, 'phase': phase, 'routePhase': phase, 'kind': kind, 'complete': False,
                'firstFailure': None, 'pairStatus': 'not-evaluated', 'pairFailure': None, 'roles': {}, 'roleOrder': [], 'reservations': {}, 'reservationOrder': [], 'reservedBytes': 0}

    def _capture(self, phase):
        need(self._attempts < 2, 'phase-order')
        self._attempts += 1
        receipt = self._receipt(phase, 'tool-observation', self._attempts)
        self._reports.append(receipt)
        try:
            self._route_check()
            identities = set()
            for role, (relative, expected) in SELECTED.items():
                row = self._observe(relative, receipt)
                self._check()
                need(row['sha256'] == expected, 'pin-mismatch')
                identity = (row['opened']['dev'], row['opened']['ino'])
                need(identity not in identities, 'file-alias')
                identities.add(identity)
                receipt['roles'][role] = row
                receipt['roleOrder'].append(role)
            self._route_check()
            self._check()
            receipt['complete'] = True
        except BaseException as error:
            self._latch(error)
            receipt['firstFailure'] = self._first
            raise
        return receipt

    def _serialize(self, receipt):
        admit_receipt(receipt)
        raw = (json.dumps(receipt, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')
        need(len(raw) <= MAX_RECEIPT, 'file-size')
        return raw

    def _healthy_diagnostic(self):
        return (not self._reentered and self._owner._first is None and
                self._owner._phase in ('prepared', 'before-complete') and
                self._owner._creator._first is None and self._owner._writer._first is None and
                self._owner._writer._routes._first is None and not self._owner._writer._routes._closed)

    def _diagnose_failure(self, receipt):
        # No tool calls after historical refusal; only the healthy owner may write.
        if self._diagnostic_started or not self._healthy_diagnostic():
            return
        self._diagnostic_started = True
        try:
            self._owner.before(self._serialize(receipt))
            self._emitted.append(1)
            if not self._healthy_diagnostic():
                return
            terminal = self._receipt('failure-final', 'failure-terminal-no-observation', 2)
            terminal['firstFailure'] = self._first
            self._reports.append(terminal)
            self._owner.terminal('failure-final', self._serialize(terminal))
            self._emitted.append(2)
        except BaseException:
            self._secondary = self._secondary or 'diagnostic-refusal'

    def _record_emitted(self):
        writer = self._owner._writer
        if writer is not None:
            self._emitted = [sequence for sequence, name in ((1, 'tool-before.json'), (2, 'tool-terminal.json')) if name in writer._written]

    def _cleanup(self):
        try:
            self._owner.close()
        except BaseException:
            self._secondary = self._secondary or 'cleanup-refusal'

    def prepare(self):
        self._enter()
        try:
            self._check()
            need(self._phase == 'new', 'phase-order')
            self._phase = 'prepare-consumed'
            self._owner.prepare()
            self._check()
            self._phase = 'prepared'
        except BaseException as error:
            self._latch(error)
            self._cleanup()
            raise
        finally:
            self._record_emitted()
            self._busy = False
        return self.status()

    def before(self):
        self._enter()
        capture_started = False
        previous = len(self._reports)
        try:
            self._check()
            need(self._phase == 'prepared', 'phase-order')
            self._phase = 'before-consumed'
            capture_started = True
            receipt = self._capture('before-probes')
            self._owner.before(self._serialize(receipt))
            self._check()
            self._emitted.append(1)
            self._phase = 'before-complete'
        except BaseException as error:
            self._latch(error)
            if capture_started and previous == 0 and len(self._reports) == 1 and not self._reports[0]['complete']:
                self._diagnose_failure(self._reports[0])
            self._cleanup()
            self._phase = 'refused'
            raise
        finally:
            self._record_emitted()
            self._busy = False
        return self.status()

    def terminal(self, phase):
        self._enter()
        capture_started = False
        previous = len(self._reports)
        try:
            self._check()
            need(self._phase == 'before-complete' and type(phase) is str and phase in ('after-link', 'failure-final'), 'phase-order')
            self._phase = 'terminal-consumed'
            capture_started = True
            receipt = self._capture(phase)
            if phase == 'after-link':
                try:
                    validate_pair(self._reports[0], receipt)
                except BaseException as error:
                    self._latch(error)
                    receipt['pairStatus'] = 'refused'
                    receipt['pairFailure'] = self._first
                    raise
                receipt['pairStatus'] = 'consistent'
            self._owner.terminal(phase, self._serialize(receipt))
            self._check()
            self._emitted.append(2)
            self._phase = 'complete'
        except BaseException as error:
            self._latch(error)
            if capture_started and previous == 1 and len(self._reports) == 2 and (not self._reports[-1]['complete'] or self._reports[-1]['pairStatus'] == 'refused'):
                # Emit the actual second partial, never a third observation/receipt.
                if not self._terminal_diagnostic_started and self._healthy_diagnostic():
                    self._terminal_diagnostic_started = True
                    self._reports[-1]['routePhase'] = 'failure-final'
                    try:
                        self._owner.terminal('failure-final', self._serialize(self._reports[-1]))
                        self._emitted.append(2)
                    except BaseException:
                        self._secondary = self._secondary or 'diagnostic-refusal'
            self._cleanup()
            self._phase = 'refused'
            raise
        finally:
            self._record_emitted()
            self._busy = False
        return self.status()

    def status(self):
        if self._busy:
            self._enter()
        return {'phase': self._phase, 'firstFailure': self._first, 'secondary': self._secondary,
                'reentered': self._reentered, 'observationAttempts': self._attempts,
                'emittedSequences': list(self._emitted),
                'receiptFacts': [{'sequence': r['sequence'], 'phase': r['phase'], 'routePhase': r['routePhase'], 'kind': r['kind'],
                                  'complete': r['complete'], 'firstFailure': r['firstFailure'], 'pairStatus': r['pairStatus'], 'pairFailure': r['pairFailure'],
                                  'completedRoles': len(r['roles']), 'reservedBytes': r['reservedBytes']} for r in self._reports],
                'localCloseAttempted': self._local_attempted, 'localCloseRefused': self._local_refused,
                'localCleanupQualified': self._local_refused == 0,
                'workspace': self._owner.status(),
                'sourceOwnedQualified': False, 'parentTrustQualified': False,
                'continuousIdentityQualified': False, 'compilerQualified': False,
                'guestQualified': False, 'performanceQualified': False}

    def close(self):
        self._enter()
        try:
            self._cleanup()
            if self._phase != 'complete':
                self._phase = 'closed'
        finally:
            self._record_emitted()
            self._busy = False
        return self.status()


def _keys(value, expected):
    need(type(value) is dict and len(value) == len(expected) and all(type(k) is str for k in value) and set(value) == set(expected), 'identity-range')

def admit_receipt(value):
    keys = ('schema','protocol','dependencies','predicateProvenance','session','sequence','phase','routePhase','kind','complete','firstFailure','pairStatus','pairFailure','roles','roleOrder','reservations','reservationOrder','reservedBytes')
    _keys(value, keys)
    need(type(value['schema']) is str and value['schema'] == SCHEMA and type(value['protocol']) is int and value['protocol'] == 1, 'identity-range')
    for key, expected in (('dependencies', DEPENDENCIES), ('predicateProvenance', PROVENANCE)):
        _keys(value[key], expected)
        need(all(type(v) is str and v == expected[k] for k,v in value[key].items()), 'identity-range')
    session = value['session']
    need(type(session) is str and len(session) == 64 and all(c in '0123456789abcdef' for c in session), 'identity-range')
    need(type(value['sequence']) is int and 1 <= value['sequence'] <= 2 and type(value['phase']) is str and value['phase'] in PHASES, 'phase-order')
    need(type(value['kind']) is str and value['kind'] in ('tool-observation','failure-terminal-no-observation') and type(value['complete']) is bool, 'phase-order')
    failure = value['firstFailure']
    need(failure is None or (type(failure) is str and len(failure) <= 32 and failure in CODES), 'identity-range')
    need(type(value['routePhase']) is str and value['routePhase'] in PHASES, 'phase-order')
    need(type(value['pairStatus']) is str and value['pairStatus'] in ('not-evaluated','consistent','refused'), 'phase-order')
    pair_failure = value['pairFailure']
    need((value['pairStatus'] == 'refused' and type(pair_failure) is str and len(pair_failure) <= 32 and pair_failure in CODES) or (value['pairStatus'] != 'refused' and pair_failure is None), 'phase-order')
    if value['pairStatus'] != 'not-evaluated':
        need(value['kind'] == 'tool-observation' and value['sequence'] == 2 and value['phase'] == 'after-link' and value['complete'], 'phase-order')
    roles = value['roles']; reservations = value['reservations']
    need(type(roles) is dict and type(reservations) is dict and len(roles) <= 9 and len(reservations) <= 9, 'identity-range')
    names = list(SELECTED)
    need(all(type(k) is str for k in roles) and all(type(k) is str for k in reservations), 'identity-range')
    need(set(roles) == set(names[:len(roles)]) and set(reservations) == set(names[:len(reservations)]) and len(roles) <= len(reservations) <= min(9,len(roles)+1), 'identity-range')
    need(type(value['roleOrder']) is list and type(value['reservationOrder']) is list and
         len(value['roleOrder']) == len(roles) and len(value['reservationOrder']) == len(reservations) and
         all(type(k) is str for k in value['roleOrder'] + value['reservationOrder']) and
         value['roleOrder'] == names[:len(roles)] and value['reservationOrder'] == names[:len(reservations)], 'identity-range')
    need(all(type(k) is str and type(v) is int and 0 < v <= MAX_FILE for k,v in reservations.items()), 'file-size')
    need(type(value['reservedBytes']) is int and value['reservedBytes'] == sum(reservations.values()) and 0 <= value['reservedBytes'] <= MAX_TOTAL, 'total-size')
    identities = set()
    for role,row in roles.items():
        _keys(row, ('before','opened','after','named','sha256'))
        need(type(row['sha256']) is str and row['sha256'] == SELECTED[role][1], 'pin-mismatch')
        for label in ('before','opened','after','named'):
            identity = row[label]
            _keys(identity, ('dev','ino','bytes','mtimeNs','ctimeNs','links'))
            need(all(_u64(v) for v in identity.values()) and identity['links'] == 1 and 0 < identity['bytes'] <= MAX_FILE, 'identity-range')
        need(row['before'] == row['opened'] == row['after'] == row['named'] and reservations[role] == row['opened']['bytes'], 'file-read-race')
        identity = (row['opened']['dev'],row['opened']['ino'])
        need(identity not in identities, 'file-alias'); identities.add(identity)
    if value['kind'] == 'failure-terminal-no-observation':
        need(value['phase'] == value['routePhase'] == 'failure-final' and value['sequence'] == 2 and not value['complete'] and failure is not None and not roles and not reservations, 'phase-order')
    else:
        need((value['sequence'] == 1 and value['phase'] == 'before-probes') or (value['sequence'] == 2 and value['phase'] in ('after-link','failure-final')), 'phase-order')
        need(value['routePhase'] == value['phase'] or (value['sequence'] == 2 and value['routePhase'] == 'failure-final' and (not value['complete'] or value['pairStatus'] == 'refused')), 'phase-order')
        need((value['complete'] and len(roles) == 9 and failure is None) or (not value['complete'] and failure is not None), 'phase-order')
    return value

def validate_pair(before, after):
    admit_receipt(before); admit_receipt(after)
    need(before['kind'] == after['kind'] == 'tool-observation' and before['complete'] and after['complete'], 'phase-order')
    need(before['sequence'] == 1 and after['sequence'] == 2 and before['phase'] == 'before-probes' and after['phase'] == 'after-link', 'phase-order')
    need(after['pairStatus'] in ('not-evaluated', 'consistent') and after['pairFailure'] is None and after['routePhase'] == 'after-link', 'phase-order')
    need(before['session'] == after['session'] and before['dependencies'] == after['dependencies'] and before['predicateProvenance'] == after['predicateProvenance'], 'identity-range')
    need(before['roles'] == after['roles'] and before['reservations'] == after['reservations'], 'file-read-race')
    return {'toolBoundaryConsistent': True, 'continuousIdentityQualified': False, 'compilerQualified': False}
