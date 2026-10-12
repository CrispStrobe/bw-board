"""Bounded materialization-only observations from one private fixed instance."""
import ast
import hashlib
import json
from pathlib import Path
import types

ALIAS_SHA = 'd7783001104ac7d32b35e1ad8b1da181ee3dcf6be61b06e7b70ab4aa18e6fb4d'
DISABLED_COMPILE_SHA = '2a1a3e84a4244100a8f0fe5c8d806d46721425970e4b65b516fdf58fed67b31a'
MAX_SECTION = 32768
MAX_PACKET = 147456
CODES = frozenset(('phase-order', 'runner-reentry', 'filesystem-refusal', 'cleanup-refusal',
                   'evidence-refused', 'dependency-source-refused', 'compiler-source-refused'))

class Refusal(ValueError):
    pass

def need(value, code='evidence-refused'):
    if not value:
        raise Refusal(code)

def _source(relative, digest):
    path = Path(__file__).parent.parent / relative
    with path.open('rb') as stream:
        raw = stream.read(65537)
    need(len(raw) <= 65536 and hashlib.sha256(raw).hexdigest() == digest, 'dependency-source-refused')
    return path, raw

def _load_alias():
    path, raw = _source('i80386-cwsdpmi-gnu-longname-materializer/materialize.py', ALIAS_SHA)
    module = types.ModuleType('private_materialization_runner')
    module.__file__ = str(path)
    exec(compile(raw, '<fixed-alias-materializer>', 'exec'), module.__dict__)
    return module

alias = _load_alias()

def _disabled_source():
    unused, raw = _source('i80386-cwsdpmi-compile-tool-boundary/compile.py', DISABLED_COMPILE_SHA)
    body = ast.parse(raw).body
    # Inspect only: compile.py is never loaded or run. Only literal docstring and
    # stdlib import declarations may precede its unconditional top-level raise.
    allowed = {'hashlib','importlib.util','io','json','os','resource','selectors',
               'signal','struct','stat','subprocess','sys','tarfile','time','pathlib'}
    found = False
    for statement in body:
        if isinstance(statement, ast.Raise):
            call = statement.exc
            need(isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and
                 call.func.id == 'RuntimeError' and not call.keywords and len(call.args) == 1 and
                 isinstance(call.args[0], ast.Constant) and type(call.args[0].value) is str and
                 call.args[0].value == 'compile-tool-boundary-production-disabled', 'compiler-source-refused')
            found = True
            break
        if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant) and type(statement.value.value) is str:
            continue
        if isinstance(statement, ast.Import):
            need(all(row.name in allowed for row in statement.names), 'compiler-source-refused')
        elif isinstance(statement, ast.ImportFrom):
            need(statement.level == 0 and statement.module in allowed, 'compiler-source-refused')
        else:
            raise Refusal('compiler-source-refused')
    need(found, 'compiler-source-refused')
    return {'sha256': DISABLED_COMPILE_SHA, 'unconditionalRefusalInspected': True,
            'sourceOnly': True, 'importedOrExecuted': False}

def _copy(value):
    # Only internally owned report facts enter here. No arbitrary caller records,
    # encoder hooks, integer coercion or recursive containers are admitted.
    budget = [4096]
    def visit(row, depth):
        budget[0] -= 1
        need(budget[0] >= 0 and depth <= 16)
        if row is None or type(row) is bool:
            return row
        if type(row) is int:
            need(0 <= row < 2**64)
            return row
        if type(row) is str:
            need(len(row) <= 256 and row.isascii())
            return row
        if type(row) is list:
            need(len(row) <= 64)
            return [visit(item, depth+1) for item in row]
        if type(row) is dict:
            need(len(row) <= 64)
            copied = {}
            for key, item in row.items():
                need(type(key) is str and len(key) <= 256 and key.isascii())
                copied[key] = visit(item, depth+1)
            return copied
        raise Refusal('evidence-refused')
    copied = visit(value, 0)
    raw = json.dumps(copied, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    need(len(raw) <= MAX_SECTION)
    return copied

STATUS_KEYS = frozenset(('gnuLongNameHeaders','gnuLongNameNamesApplied','gnuLongNamePending','archiveRefusalDiagnostic', 'aliasInventoryProvenance', 'authenticatedArchives', 'cleanupQualified', 'closeAttempted', 'closeRefused', 'closed', 'compilerQualified', 'firstFailure', 'fullToolchainReady', 'guestQualified', 'inputFilesystemLeaseQualified', 'licenseQualified', 'noticeBytes', 'noticeCount', 'noticeHashes', 'noticeOmitted', 'observer', 'parentTrustQualified', 'performanceQualified', 'phase', 'physicalAliasesMaterialized', 'rawArchiveCompatibilityQualified', 'reentered', 'runtimeOriginJoins', 'secondary', 'selectedNineMaterialized', 'sourceOwnedQualified', 'validatedAliasCount', 'validatedAliasTargetCount', 'writtenRoles'))
FALSE_FLAGS = ('fullToolchainReady','inputFilesystemLeaseQualified','sourceOwnedQualified',
               'parentTrustQualified','licenseQualified','compilerQualified','guestQualified',
               'performanceQualified','physicalAliasesMaterialized','rawArchiveCompatibilityQualified')

def _status_copy(value):
    need(type(value) is dict and len(value) == len(STATUS_KEYS))
    need(all(type(key) is str and len(key) <= 256 for key in value))
    need(set(value) == STATUS_KEYS)
    need(all(type(value[key]) is bool and value[key] is False for key in FALSE_FLAGS))
    return _copy(value)

class MaterializationRunner:
    def __init__(self, parent):
        self._compile = _disabled_source()
        self._materializer = alias.FixedAliasMaterializer(parent)
        self._busy = False
        self._reentered = False
        self._first = None
        self._secondary = None
        self._phase = 'new'
        self._consumed = False
        self._closed = False
        self._close_attempted = 0
        self._packet = None
        self._materialize_status = None
        self._close_status = None
        self._receipts = []
        self._capture_attempted = False
    def _enter(self):
        if self._busy:
            self._reentered = True
            self._first = self._first or 'runner-reentry'
            m = self._materializer
            m._reentered = True
            m._first = m._first or 'materializer-reentry'
            o = m._observer
            o._reentered = True
            o._epoch += 1
            o._first = o._first or 'observer-reentry'
            o._owner._poison()
            raise Refusal('runner-reentry')
        self._busy = True
    def _check(self):
        need(not self._reentered, 'runner-reentry')
    def _latch(self, error):
        args = error.args if type(error) is Refusal else None
        code = args[0] if type(args) is tuple and len(args) == 1 and type(args[0]) is str else None
        if type(code) is not str or len(code) > 32 or code not in CODES:
            code = self._materializer._first
        if type(code) is not str or len(code) > 32 or code not in alias.base.CODES | CODES:
            code = 'filesystem-refusal'
        self._first = self._first or code
    def _close_once(self):
        if self._closed:
            return
        self._closed = True
        self._close_attempted += 1
        try:
            result = self._materializer.close()
            self._check()
            self._close_status = _status_copy(result)
            self._check()
        except BaseException as error:
            self._latch(error)
            self._secondary = self._secondary or 'cleanup-refusal'
            raise
    def _capture(self):
        self._check()
        need(not self._capture_attempted, 'phase-order')
        self._capture_attempted = True
        result = self._materializer.status()
        self._check()
        self._materialize_status = _status_copy(result)
        self._check()
        reports = self._materializer._observer._reports
        need(type(reports) is list and len(reports) <= 2)
        copied = []
        for receipt in reports:
            try:
                raw = self._materializer._observer._serialize(receipt)
            except BaseException:
                self._first = self._first or 'evidence-refused'
                raise
            self._check()
            need(type(raw) is bytes and len(raw) <= MAX_SECTION)
            row = _copy(json.loads(raw))
            copied.append(row)
            self._receipts = copied
            self._check()
            need(row['session'] == self._materializer._observer._session and
                 row['sequence'] == len(copied) and
                 row['phase'] == ('before-probes' if len(copied) == 1 else 'failure-final') and
                 row['routePhase'] == row['phase'] and row['pairStatus'] == 'not-evaluated' and
                 row['pairFailure'] is None)
        self._receipts = copied
    def _make_packet(self):
        status = self._status()
        status['hasPacket'] = True
        facts = {'schema': 'bw.fixed-archive-materialization-observation.v3',
                 'boundary': 'MATERIALIZATION_ONLY_OBSERVATIONS_UNQUALIFIED',
                 'wrapper': status,
                 'sources': {'gnuLongnameMaterializerSha256': ALIAS_SHA, 'diagnosticMaterializerSha256': alias.DIAGNOSTIC_SHA, 'fixedAliasSha256': alias.ALIAS_SHA, 'selectedMaterializerSha256': alias.BASE_SHA,
                             'observerSha256': alias.base.OBSERVER_SHA, 'disabledCompile': dict(self._compile),
                             'externalSourceAdmissionRequired': True},
                 'materializeStatus': self._materialize_status,
                 'closeStatus': self._close_status, 'observerReceipts': self._receipts,
                 'receiptSerialization': 'SOURCE_RESERIALIZED_OBSERVATIONS_NOT_ORIGINAL_WRITER_BYTES',
                 'readonlyModesObserved': False, 'physicalNamespaceObserved': False,
                 'fullToolchainReady': False, 'compilerQualified': False, 'guestQualified': False,
                 'sourceOwnedQualified': False, 'inputFilesystemLeaseQualified': False,
                 'performanceQualified': False}
        # The two raw receipts and two statuses are separately <=32KiB; no input
        # bytes or paths are retained. Packet has only these fixed bounded roles.
        raw = json.dumps(facts, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')
        need(len(raw) <= MAX_PACKET)
        self._packet = raw
    def _completed(self):
        before = self._materialize_status
        closed = self._close_status
        need(type(before) is dict and type(closed) is dict and len(self._receipts) == 2)
        need(before['phase'] == 'complete' and before['closed'] is False and
             closed['phase'] == 'closed' and closed['closed'] is True)
        for status in (before, closed):
            need(status['firstFailure'] is None and status['secondary'] is None and
                 status['reentered'] is False and status['cleanupQualified'] is True and
                 status['selectedNineMaterialized'] is True and
                 status['writtenRoles'] == list(alias.base.SELECTED))
            for key, expected in (('runtimeOriginJoins',4),('validatedAliasCount',13),('validatedAliasTargetCount',11)):
                need(type(status[key]) is int and status[key] == expected)
            observer = status['observer']
            need(observer['phase'] == 'complete' and observer['firstFailure'] is None and
                 observer['secondary'] is None and observer['reentered'] is False and
                 type(observer['observationAttempts']) is int and observer['observationAttempts'] == 2 and
                 observer['emittedSequences'] == [1,2] and
                 all(type(n) is int for n in observer['emittedSequences']))
        for index, row in enumerate(self._receipts):
            need(row['kind'] == 'tool-observation' and row['complete'] is True and
                 row['firstFailure'] is None and row['pairFailure'] is None and
                 row['roleOrder'] == list(alias.base.SELECTED) and len(row['roles']) == 9 and
                 row['sequence'] == index+1)
            for role, (unused, expected) in alias.base.SELECTED.items():
                facts = row['roles'][role]
                need(facts['sha256'] == expected and
                     facts['before'] == facts['opened'] == facts['after'] == facts['named'])

    def materialize(self, toolchain_bytes, djcrx_bytes, djdev_bytes, djlsr_bytes):
        self._enter()
        try:
            need(not self._closed and not self._consumed, 'phase-order')
            self._consumed = True
            self._phase = 'materialize-consumed'
            try:
                self._materializer.materialize(toolchain_bytes, djcrx_bytes, djdev_bytes, djlsr_bytes)
                self._check()
                self._capture()
                self._close_once()
                self._check()
                self._completed()
                self._phase = 'complete'
                self._make_packet()
            except BaseException as error:
                self._latch(error)
                self._phase = 'refused'
                # Secondary observation/close/report failures cannot mask the
                # original error object. Reentry allows cleanup only.
                if not self._reentered and not self._capture_attempted:
                    try:
                        self._capture()
                    except BaseException:
                        self._secondary = self._secondary or 'evidence-refused'
                try:
                    self._close_once()
                except BaseException:
                    self._secondary = self._secondary or 'cleanup-refusal'
                try:
                    self._make_packet()
                except BaseException:
                    self._secondary = self._secondary or 'evidence-refused'
                raise
        finally:
            self._busy = False
        return self.report()
    def _status(self):
        return {'phase': self._phase, 'firstFailure': self._first, 'secondary': self._secondary,
                'reentered': self._reentered, 'consumed': self._consumed, 'closed': self._closed,
                'closeAttempted': self._close_attempted,
                'copiedObserverReceipts': len(self._receipts), 'hasPacket': self._packet is not None,
                'readonlyModesObserved': False, 'physicalNamespaceObserved': False,
                'fullToolchainReady': False, 'compilerQualified': False, 'guestQualified': False,
                'sourceOwnedQualified': False, 'inputFilesystemLeaseQualified': False,
                'performanceQualified': False}
    def status(self):
        if self._busy:
            self._enter()
        return self._status()
    def report(self):
        if self._busy:
            self._enter()
        return None if self._packet is None else json.loads(self._packet)
    def close(self):
        self._enter()
        try:
            self._close_once()
            if self._phase != 'complete':
                self._phase = 'closed'
        finally:
            self._busy = False
        return self.status()
