"""Unconnected, bounded tool boundary observations; never executes tools."""
import copy
import hashlib
import json
import os
import secrets
import stat

SOURCE_BASE = "e1f44e70bd21e4f3b146d0c0e00da141eb045182"
COMPILE_SHA = '959931875f090164b2a0d34f07f6eb1b06940d0f34c1ef6c2f7e8c903f87ac51'
SELECTED = {'compiler': ('djgpp/bin/i586-pc-msdosdjgpp-gcc', 'afd20f428ccb032b21f00832587219d236efde25344c8067f820b1e677d0799f'), 'assembler': ('djgpp/i586-pc-msdosdjgpp/bin/as', '41dda143ed208ffeb62722e0963193b0a2450bdd0aa00c5bd394115e3b2eef24'), 'linker': ('djgpp/i586-pc-msdosdjgpp/bin/ld', '99f2e74294e340136f3345982f6c95f59431a75abbc01734552e63a84b9cfc65'), 'stubify': ('djgpp/i586-pc-msdosdjgpp/bin/stubify', 'e0f233de37256389434894ce38158c9e68c57c46f7cbe332021ad64577751a09'), 'dpmi.h': ('djgpp/i586-pc-msdosdjgpp/sys-include/dpmi.h', 'cf73c8314e4ae364d6160913bae31be5d9f5800c1d333af1291e4e49f61627b3'), 'farptr.h': ('djgpp/i586-pc-msdosdjgpp/sys-include/sys/farptr.h', 'b38414509d8e1e59de9402188ed003ab7e2cde3bd50786318aedb0232329547d'), 'crt0.o': ('djgpp/i586-pc-msdosdjgpp/lib/crt0.o', 'ee1b0b2cf7b2645708ce35bff4c4c18322aa7e29f89eed5769c4a138cf4acfae'), 'libc.a': ('djgpp/i586-pc-msdosdjgpp/lib/libc.a', 'f59d5106cc668a67c3334c33be2c273df7c69dce93e4e53ef8a52c07a9fbda78'), 'libgcc.a': ('djgpp/lib/gcc/i586-pc-msdosdjgpp/12.2.0/libgcc.a', 'e9d6ad2b2c679617b4d305b655039403514ba8f140805f2b75044ffcf16bc4b7')}
MAX_FILE = 16 << 20
MAX_TOTAL = 64 << 20
MAX_RECEIPT = 32 << 10
SCHEMA = "bw.tool-boundary-receipt.v1"
PHASES = ("before-probes", "after-link", "failure-final")

class Refusal(ValueError):
    pass

def require(condition, code):
    if not condition:
        raise Refusal(code)

def identity(s):
    values = (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    require(all(type(v) is int and 0 <= v < 2**64 for v in values), "identity-range")
    return dict(zip(("dev", "ino", "bytes", "mtimeNs", "ctimeNs", "links"), values))

def directory(s):
    require(stat.S_ISDIR(s.st_mode), "directory-type")
    return identity(s)

def regular(s):
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, "file-type-or-links")
    require(0 < s.st_size <= MAX_FILE, "file-size")
    return identity(s)

class ToolBoundary:
    def __init__(self, root):
        self._root = os.fspath(root)
        self._session = secrets.token_hex(32)
        self._busy = False
        self._writing = False
        self._epoch = 0
        self._writer_poison = False
        self._write_attempts = set()
        self._poison = None
        self._receipts = []
        self._root_identity = None

    def _reentry(self):
        self._epoch += 1
        if self._writing:
            self._writer_poison = True
        self._poison = self._poison or "reentry"
        raise Refusal(self._poison)

    def _idle(self):
        if self._busy:
            self._reentry()

    def status(self):
        self._idle()
        return copy.deepcopy(self._receipts)

    def _check(self):
        require(self._poison is None, self._poison or "poisoned")

    def _call(self, fn, *args, **kwargs):
        self._check()
        value = fn(*args, **kwargs)
        try:
            self._check()
        except Exception:
            if fn is os.open:
                os.close(value)
            raise
        return value

    def _observe(self, relative):
        fds = []
        try:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
            before = directory(self._call(os.stat, self._root, follow_symlinks=False))
            rootfd = self._call(os.open, self._root, flags)
            fds.append(rootfd)
            require(directory(self._call(os.fstat, rootfd)) == before, "root-open-race")
            if self._root_identity is None:
                self._root_identity = before
            require(before == self._root_identity, "root-changed")
            chain = []
            parent = rootfd
            parts = relative.split("/")
            for name in parts[:-1]:
                prior = directory(self._call(os.stat, name, dir_fd=parent, follow_symlinks=False))
                fd = self._call(os.open, name, flags, dir_fd=parent)
                fds.append(fd)
                require(directory(self._call(os.fstat, fd)) == prior, "directory-open-race")
                chain.append((parent, name, fd, prior))
                parent = fd
            name = parts[-1]
            prior = regular(self._call(os.stat, name, dir_fd=parent, follow_symlinks=False))
            fd = self._call(os.open, name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
            fds.append(fd)
            opened = regular(self._call(os.fstat, fd))
            require(prior == opened, "file-open-race")
            digest = hashlib.sha256()
            count = 0
            while True:
                block = self._call(os.read, fd, min(65536, MAX_FILE + 1 - count))
                if not block:
                    break
                count += len(block)
                require(count <= MAX_FILE, "file-size")
                digest.update(block)
            after = regular(self._call(os.fstat, fd))
            named = regular(self._call(os.stat, name, dir_fd=parent, follow_symlinks=False))
            require(prior == opened == after == named and count == opened["bytes"], "file-read-race")
            for owner, component, held, captured in reversed(chain):
                require(directory(self._call(os.fstat, held)) == captured == directory(self._call(os.stat, component, dir_fd=owner, follow_symlinks=False)), "directory-changed")
            require(directory(self._call(os.fstat, rootfd)) == before == directory(self._call(os.stat, self._root, follow_symlinks=False)), "root-changed")
            return {"before": prior, "opened": opened, "after": after, "named": named, "sha256": digest.hexdigest()}
        finally:
            for fd in reversed(fds):
                os.close(fd)

    def capture(self, phase):
        if self._busy:
            self._reentry()
        if len(self._receipts) >= 2:
            self._poison = self._poison or "phase-order"
            raise Refusal(self._poison)
        self._busy = True
        receipt = {"schema": SCHEMA, "sourceBase": SOURCE_BASE, "compileSha256": COMPILE_SHA, "session": self._session, "phase": phase if type(phase) is str and phase in PHASES else "invalid", "sequence": len(self._receipts) + 1, "complete": False, "firstFailure": None, "roles": {}}
        self._receipts.append(receipt)
        try:
            self._check()
            require(type(phase) is str and phase in PHASES, "phase")
            prior = self._receipts[:-1]
            require((not prior and phase in ("before-probes", "failure-final")) or (len(prior) == 1 and prior[0]["phase"] == "before-probes" and prior[0]["complete"] and phase in ("after-link", "failure-final")), "phase-order")
            total = 0
            for role, (relative, expected) in SELECTED.items():
                row = self._observe(relative)
                require(row["sha256"] == expected, "pin-mismatch")
                total += row["opened"]["bytes"]
                require(total <= MAX_TOTAL, "total-size")
                self._check()
                receipt["roles"][role] = row
            receipt["complete"] = True
        except Exception as error:
            code = str(error) if isinstance(error, Refusal) else "filesystem-refusal"
            self._poison = self._poison or code
            receipt["firstFailure"] = self._poison
        finally:
            self._busy = False
        return copy.deepcopy(receipt)

    def write(self, destination, receipt):
        self._idle()
        require(not self._writer_poison, "writer-reentry")
        admit_receipt(receipt)
        require(self._poison is None or receipt["complete"] is False, "historical-poison-diagnostic-only")
        require(any(receipt == r for r in self._receipts), "foreign-receipt")
        raw = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        require(len(raw) <= MAX_RECEIPT, "receipt-size")
        sequence = receipt["sequence"]
        require(sequence not in self._write_attempts and len(self._write_attempts) < 2, "writer-attempt-consumed")
        self._write_attempts.add(sequence)
        epoch = self._epoch
        def writer_call(fn, *args, **kwargs):
            require(self._epoch == epoch, "writer-reentry")
            value = fn(*args, **kwargs)
            if self._epoch != epoch:
                if fn is os.open:
                    os.close(value)
                raise Refusal("writer-reentry")
            return value
        self._busy = True
        self._writing = True
        fd = None
        try:
            fd = writer_call(os.open, destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            count = 0
            while count < len(raw):
                n = writer_call(os.write, fd, raw[count:])
                require(n > 0, "receipt-write")
                count += n
            held = regular(writer_call(os.fstat, fd))
            require(held == regular(writer_call(os.stat, destination, follow_symlinks=False)) and held["bytes"] == len(raw), "receipt-write-race")
        finally:
            try:
                if fd is not None:
                    os.close(fd)
            finally:
                self._writing = False
                self._busy = False


REFUSALS = frozenset(("identity-range", "directory-type", "file-type-or-links",
    "file-size", "root-open-race", "root-changed", "directory-open-race",
    "file-open-race", "file-read-race", "directory-changed", "pin-mismatch",
    "total-size", "filesystem-refusal", "phase", "phase-order", "reentry"))

def admit_receipt(value):
    """Closed fixed-depth admission before copying, comparison or serialization."""
    keys = {"schema", "sourceBase", "compileSha256", "session", "phase", "sequence", "complete", "firstFailure", "roles"}
    require(type(value) is dict and len(value) == len(keys), "receipt-schema")
    require(all(type(k) is str for k in value) and set(value) == keys, "receipt-schema")
    for key, expected in (("schema", SCHEMA), ("sourceBase", SOURCE_BASE), ("compileSha256", COMPILE_SHA)):
        require(type(value[key]) is str and value[key] == expected, "receipt-source")
    session = value["session"]
    require(type(session) is str and len(session) == 64 and all(c in "0123456789abcdef" for c in session), "session")
    require(type(value["phase"]) is str and value["phase"] in PHASES + ("invalid",), "receipt-phase")
    require(type(value["sequence"]) is int and 1 <= value["sequence"] <= 2, "receipt-phase")
    require(type(value["complete"]) is bool, "receipt-phase")
    failure = value["firstFailure"]
    require(failure is None or (type(failure) is str and len(failure) <= 32 and failure in REFUSALS), "receipt-refusal")
    roles = value["roles"]
    require(type(roles) is dict and len(roles) <= 9, "receipt-roles")
    require(all(type(k) is str and k in SELECTED for k in roles), "receipt-roles")
    require(set(roles) == set(list(SELECTED)[:len(roles)]), "receipt-prefix")
    for role, row in roles.items():
        require(type(row) is dict and len(row) == 5 and all(type(k) is str for k in row) and set(row) == {"before", "opened", "after", "named", "sha256"}, "row-schema")
        require(type(row["sha256"]) is str and row["sha256"] == SELECTED[role][1], "row-pin")
        for key in ("before", "opened", "after", "named"):
            item = row[key]
            require(type(item) is dict and len(item) == 6 and all(type(k) is str for k in item) and set(item) == {"dev", "ino", "bytes", "mtimeNs", "ctimeNs", "links"}, "identity-schema")
            require(all(type(v) is int and 0 <= v < 2**64 for v in item.values()) and item["links"] == 1 and 0 < item["bytes"] <= MAX_FILE, "identity-range")
        require(row["before"] == row["opened"] == row["after"] == row["named"], "row-race")
    require(sum(r["opened"]["bytes"] for r in roles.values()) <= MAX_TOTAL, "total-size")
    require((value["complete"] and len(roles) == 9 and failure is None and value["phase"] in PHASES) or (not value["complete"] and failure is not None), "receipt-completion")
    return value

def validate_pair(before, after):
    """Only locally captured copied receipts should be supplied by future hooks."""
    keys = {"schema", "sourceBase", "compileSha256", "session", "phase", "sequence", "complete", "firstFailure", "roles"}
    for value, phase, sequence in ((before, "before-probes", 1), (after, "after-link", 2)):
        admit_receipt(value)
        require(type(value) is dict and set(value) == keys, "receipt-schema")
        require(value["schema"] == SCHEMA and value["sourceBase"] == SOURCE_BASE and value["compileSha256"] == COMPILE_SHA, "receipt-source")
        require(type(value["session"]) is str and len(value["session"]) == 64 and all(c in "0123456789abcdef" for c in value["session"]), "session")
        require(value["phase"] == phase and type(value["sequence"]) is int and value["sequence"] == sequence and value["complete"] is True and value["firstFailure"] is None, "receipt-phase")
        require(type(value["roles"]) is dict and set(value["roles"]) == set(SELECTED), "receipt-roles")
        for role, row in value["roles"].items():
            require(type(row) is dict and set(row) == {"before", "opened", "after", "named", "sha256"}, "row-schema")
            require(row["sha256"] == SELECTED[role][1], "row-pin")
            for key in ("before", "opened", "after", "named"):
                item = row[key]
                require(type(item) is dict and set(item) == {"dev", "ino", "bytes", "mtimeNs", "ctimeNs", "links"}, "identity-schema")
                require(all(type(v) is int and 0 <= v < 2**64 for v in item.values()) and item["links"] == 1 and 0 < item["bytes"] <= MAX_FILE, "identity-range")
            require(row["before"] == row["opened"] == row["after"] == row["named"], "row-race")
        require(sum(r["opened"]["bytes"] for r in value["roles"].values()) <= MAX_TOTAL, "total-size")
    require(before["session"] == after["session"], "cross-session")
    require(before["roles"] == after["roles"], "boundary-changed")
    return {"boundaryConsistent": True, "continuousIdentityQualified": False, "compilationQualified": False}
