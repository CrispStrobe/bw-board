"""Fixed held-source context admission; materialization/import remain unconnected."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

_COMMIT = 'c3ada315e9dfc51cd70ac6403d9e1ab18a0faf5c'
_GROUPS = ('native-cold-reset-report', 'native-combined-paging-ram-board-gate',
           'native-owned-pic-imr-profile', 'native-ram-coherence-report',
           'native-rep-pf-pit-board-gate', 'nonidentity-paging-source',
           'paged-int-iret-source', 'paged-pagefault-source', 'protected-ram-source',
           'protected-stack-source')
_ROOT = Path(__file__).resolve().parent

class Refusal(ValueError):
    pass

def need(condition, reason):
    if not condition:
        raise Refusal(reason)

def keys(value, names):
    need(type(value) is dict and set(value) == set(names), 'closed-keys')

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def integer(value, maximum=2**53-1):
    need(type(value) is int and 0 <= value <= maximum, 'integer')

def hexvalue(value, length):
    need(type(value) is str and re.fullmatch('[0-9a-f]{'+str(length)+'}', value) is not None, 'identity-hex')

def path(value):
    need(type(value) is str and 1 <= len(value) <= 240 and not value.startswith('/')
         and re.fullmatch('[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', value) is not None
         and all(part not in ('.', '..') for part in value.split('/')), 'relative-path')

def parse(raw, cap=262144):
    need(type(raw) is bytes and 0 < len(raw) <= cap, 'metadata-cap')
    def unique(rows):
        result = {}
        for key, item in rows:
            need(key not in result, 'duplicate-key')
            result[key] = item
        return result
    def bad(_):
        raise Refusal('nonfinite')
    try:
        result = json.loads(raw.decode('utf-8'), object_pairs_hook=unique, parse_float=bad, parse_constant=bad)
    except Refusal:
        raise
    except (UnicodeError, ValueError, RecursionError) as error:
        raise Refusal('metadata-json') from error
    def shape(value, depth=0, count=None):
        if count is None:
            count = [0]
        count[0] += 1
        need(depth <= 12 and count[0] <= 20000, 'metadata-budget')
        if type(value) is dict:
            for key, child in value.items():
                need(type(key) is str and len(key) <= 240, 'metadata-key')
                shape(child, depth+1, count)
        elif type(value) is list:
            for child in value:
                shape(child, depth+1, count)
        elif type(value) is str:
            need(len(value) <= 2048, 'metadata-string')
        elif type(value) is int:
            need(abs(value) <= 2**53-1, 'metadata-integer')
        else:
            need(value is None or type(value) is bool, 'metadata-primitive')
    shape(result)
    return result

def row(value):
    keys(value, ('bytes', 'sha256', 'gitBlob'))
    integer(value['bytes'], 4*1024*1024)
    need(value['bytes'] > 0, 'empty-source')
    hexvalue(value['sha256'], 64)
    hexvalue(value['gitBlob'], 40)

def regular_metadata(name):
    # Only fixed helper metadata leaves. This does not admit a source root.
    need(name in ('context-table.json', 'original-proofs.json'), 'metadata-name')
    target = _ROOT / name
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    primary = None
    raw = None
    try:
        first = os.fstat(fd)
        need(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and 0 < first.st_size <= 262144, 'metadata-file')
        parts, count = [], 0
        while True:
            body = os.read(fd, min(65536, first.st_size+1-count))
            need(type(body) is bytes, 'metadata-read')
            count += len(body)
            need(count <= first.st_size, 'metadata-extent')
            if not body:
                break
            parts.append(body)
        end, named = os.fstat(fd), os.stat(target, follow_symlinks=False)
        facts = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
        need(count == first.st_size and stat.S_ISREG(end.st_mode) and stat.S_ISREG(named.st_mode)
             and end.st_nlink == named.st_nlink == 1 and facts(first) == facts(end) == facts(named), 'metadata-changed')
        raw = b''.join(parts)
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
    return raw

class Context:
    """No caller root, commit, code, pins, factories, environment or commands."""
    def __init__(self):
        self.entered = False
        self.busy = False
        self.closed = False
        self.first = None
        self.prepared = False
        self.loaded = False
        self.cleanup_refused = 0
        self._owned = None
        self._bodies = {}
        self._selectors = {}
        self._release_owned = None
        self._prepared_owner = None
        self._load_importer = None
        self._groups = ()

    @staticmethod
    def _pins():
        return (('context-table.json', 'bc25ea1cbc780719c43cc5efc1be8ba361262b15b2b8f93ef7b1796e6c2b4e97'),
                ('original-proofs.json', 'b850c7f709bf07044b4c6b74d8b9a673f460045620ab816eab18be64ccb482cd'))

    @staticmethod
    def _admit():
        raise Refusal('materialization-unconnected')

    @staticmethod
    def _materialize(_table):
        raise Refusal('materialization-unconnected')

    @staticmethod
    def _git_row(_owner, _commit, _relative):
        raise Refusal('git-context-unconnected')

    @staticmethod
    def _read_row(_owner, _relative):
        raise Refusal('readback-unconnected')

    @staticmethod
    def _import(_owner, _group, _paths, _bodies):
        raise Refusal('held-import-unconnected')

    @staticmethod
    def _release(_owner):
        raise Refusal('context-release-unconnected')

    def _check(self):
        if self.first is not None:
            raise Refusal(self.first)

    def _call(self, function, *args):
        self._check()
        value = function(*args)
        self._check()
        return value

    def _hash(self, constructor, body, length):
        owned = self._call(constructor)
        update, hexdigest = owned.update, owned.hexdigest
        self._check()
        self._call(update, body)
        value = self._call(hexdigest)
        hexvalue(value, length)
        return value

    def _prepare(self):
        if self.busy:
            self.first = self.first or 'context-reentry'
            raise Refusal('context-reentry')
        need(not self.entered and not self.closed, 'context-once')
        self.entered, self.busy = True, True
        primary = None
        release = None
        original_owner = None
        try:
            # Capture source-owned bindings before the admission hook.
            commit, groups = _COMMIT, tuple(_GROUPS)
            pins = tuple(self._pins())
            admit, metadata, materialize, gitrow, readrow, release = (
                self._admit, regular_metadata, self._materialize, self._git_row, self._read_row, self._release)
            importer = self._import
            hash_constructor, gitblob_constructor = hashlib.sha256, hashlib.sha1
            need(self._call(admit) is True, 'source-route-unconnected')
            table_raw = self._call(metadata, pins[0][0])
            proof_raw = self._call(metadata, pins[1][0])
            need(type(table_raw) is bytes and len(table_raw) <= 262144 and self._hash(hash_constructor, table_raw, 64) == pins[0][1], 'table-seal')
            need(type(proof_raw) is bytes and len(proof_raw) <= 262144 and self._hash(hash_constructor, proof_raw, 64) == pins[1][1], 'proof-seal')
            table, proofs = parse(table_raw), parse(proof_raw)
            keys(table, ('schema', 'repository', 'contextCommit', 'rows', 'selectors', 'supportImportClosure', 'historicalTestFilesHashOnly', 'authority'))
            need(table['schema'] == 'bw.i80386-historical-context-table.v1' and table['repository'] == 'CrispStrobe/bw-board'
                 and table['contextCommit'] == commit and table['authority'] is False, 'table-context')
            need(type(table['rows']) is dict and len(table['rows']) == 186, 'source-census')
            total = 0
            for relative, item in table['rows'].items():
                path(relative)
                row(item)
                total += item['bytes']
            need(total <= 16*1024*1024, 'aggregate-cap')
            keys(table['selectors'], groups)
            allowed = table['supportImportClosure']
            need(type(allowed) is list and len(allowed) == 81 and all(type(item) is str for item in allowed) and len(set(allowed)) == 81, 'import-census')
            for relative in allowed:
                path(relative)
                need(relative in table['rows'] and not relative.startswith('test/') and relative.endswith(('.js', '.mjs')), 'module-role')
            for group, paths in table['selectors'].items():
                need(type(paths) is list and 1 <= len(paths) <= 6 and all(type(item) is str for item in paths) and len(set(paths)) == len(paths), 'selector-shape')
                need(all(type(item) is str and item in allowed for item in paths), 'selector-module')
            keys(proofs, ('schema', 'repository', 'javascript', 'PIC111', 'native', 'runtime'))
            need(proofs['schema'] == 'bw.i80386-historical-original-proofs.v1' and proofs['repository'] == table['repository'], 'proof-schema')
            keys(proofs['javascript'], ('cold', 'ram', 'rep', 'combined'))
            keys(proofs['native'], ('cold', 'ram', 'rep', 'combined'))
            for native in proofs['native'].values():
                keys(native, ('fixturePath', 'encodedRow', 'originalBoardCommit', 'declaredDecodedSha256', 'validation'))
                path(native['fixturePath'])
                hexvalue(native['originalBoardCommit'], 40)
                hexvalue(native['declaredDecodedSha256'], 64)
                row(native['encodedRow'])
                need(canonical(native['encodedRow']) == canonical(table['rows'].get(native['fixturePath'])), 'native-original-row')
            # Keep admitted metadata separate from the detached boundary copy.
            admitted_rows = parse(canonical(table['rows']))
            admitted_selectors = parse(canonical(table['selectors']))
            admitted_proofs = parse(canonical(proofs))
            # Capture returned owned capability before any post-hook fence.
            original_owner = materialize(parse(canonical(table)))
            self._owned = original_owner
            self._check()
            need(type(original_owner) is tuple and len(original_owner) == 5
                 and type(original_owner[0]) is str and type(original_owner[1]) is str
                 and type(original_owner[2]) is bool and type(original_owner[3]) is bool
                 and type(original_owner[4]) is str and 1 <= len(original_owner[4]) <= 120,
                 'owned-context-shape')
            need(original_owner[0] == commit and original_owner[1] == table['repository']
                 and original_owner[2] is True and original_owner[3] is True, 'owned-context')
            bodies = {}
            for relative, item in admitted_rows.items():
                observed = self._call(gitrow, original_owner, commit, relative)
                need(canonical(observed) == canonical(item), 'git-row-join')
                body = self._call(readrow, original_owner, relative)
                need(type(body) is bytes and len(body) == item['bytes'] and self._hash(hash_constructor, body, 64) == item['sha256'], 'live-row-join')
                need(self._hash(gitblob_constructor, b'blob '+str(len(body)).encode()+b'\0'+body, 40) == item['gitBlob'], 'git-blob-join')
                bodies[relative] = body
            for original in admitted_proofs['javascript'].values():
                need(type(original) is dict and type(original.get('sourceRows')) is dict and len(original['sourceRows']) == 41, 'original-source-census')
                for relative, item in original['sourceRows'].items():
                    row(item)
                    observed = self._call(gitrow, original_owner, original['reportedCommit'], relative)
                    need(canonical(observed) == canonical(item), 'original-commit-join')
            pic = admitted_proofs['PIC111']
            need(type(pic) is dict and type(pic.get('rows')) is dict and len(pic['rows']) == 111, 'PIC111-census')
            for relative, item in pic['rows'].items():
                row(item)
                observed = self._call(gitrow, original_owner, pic['compiledCommit'], relative)
                need(canonical(observed) == canonical(item), 'PIC111-original-join')
                if relative != 'package.json':
                    need(canonical(item) == canonical(admitted_rows.get(relative)), 'PIC111-held-join')
            self._release_owned = release
            self._prepared_owner = original_owner
            self._load_importer = importer
            self._groups = groups
            self._bodies = bodies
            self._selectors = admitted_selectors
            self.prepared = True
        except BaseException as error:
            primary = error
            if self.first is None:
                self.first = str(error) if isinstance(error, Refusal) else 'context-refused'
            if original_owner is not None:
                owner = original_owner
                original_owner = None
                self._owned = None
                try:
                    release(owner)
                except BaseException:
                    self.cleanup_refused += 1
            self._bodies.clear()
            self.closed = True
        finally:
            self.busy = False
        if primary is not None:
            raise primary
        return self.status()

    def _load(self, group):
        if self.busy:
            self.first = self.first or 'context-reentry'
            raise Refusal('context-reentry')
        self._check()
        need(type(group) is str and len(group) <= 64 and group in self._groups and self.prepared and not self.closed and not self.loaded, 'fixed-module-selector')
        self.busy = True
        self.loaded = True
        importer = self._load_importer
        owner = self._prepared_owner
        try:
            paths = tuple(self._selectors[group])
            bodies = tuple((relative, self._bodies[relative]) for relative in paths)
            result = self._call(importer, owner, group, paths, bodies)
            return result
        except BaseException as error:
            if self.first is None:
                self.first = str(error) if isinstance(error, Refusal) else 'held-import-refused'
            raise
        finally:
            self.busy = False

    def close(self):
        if self.busy:
            self.first = self.first or 'context-reentry'
            raise Refusal('context-reentry')
        if self.closed:
            return self.status()
        prior_first = self.first
        self.closed = True
        self.busy = True
        owner, self._prepared_owner = self._prepared_owner, None
        self._owned = None
        self._bodies.clear()
        primary = None
        try:
            if owner is not None:
                try:
                    self._release_owned(owner)
                except BaseException as error:
                    self.cleanup_refused += 1
                    self.first = self.first or 'context-close-refused'
                    primary = error
            if primary is None and self.first != prior_first:
                self._check()
        except BaseException as error:
            if primary is None:
                primary = error
        finally:
            self.busy = False
        if primary is not None:
            raise primary
        return self.status()

    def status(self):
        if self.busy:
            self.first = self.first or 'context-reentry'
            raise Refusal('context-reentry')
        return {'schema': 'bw.i80386-historical-context-status.v1', 'prepared': self.prepared and self.first is None,
                'closed': self.closed, 'firstFailure': self.first, 'cleanupRefused': self.cleanup_refused,
                'actualMaterializationImplemented': False, 'actualImportImplemented': False,
                'originalProofRevalidated': False, 'historicalRuntimeQualified': False,
                'currentCpuQualified': False, 'nativeQualified': False}

def actual():
    raise Refusal('historical-context-unconnected')
