#!/usr/bin/env python3
"""Closed, report-only preflight artifact inventory; no executable/archive role."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROLES = frozenset(("preflight.json", "preflight.pending.json", "source.json",
                   "source.stdout", "source.stderr", "control.stdout",
                   "control.stderr", "run.stdout", "run.stderr"))
MAX_FILE = 256_000
MAX_TOTAL = 800_000


def inventory(root):
    root = Path(root)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or root.is_symlink():
        raise ValueError("ordinary owned evidence directory required")
    files = {}
    total = 0
    for path in root.iterdir():
        name = path.name
        if name not in ROLES:
            raise ValueError("forbidden evidence role: " + name)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 0 <= info.st_size <= MAX_FILE:
            raise ValueError("nonordinary or oversized evidence role")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            before = os.fstat(fd)
            raw = bytearray()
            while len(raw) <= MAX_FILE:
                block = os.read(fd, min(65536, MAX_FILE + 1 - len(raw)))
                if not block:
                    break
                raw.extend(block)
            after = os.fstat(fd)
            if len(raw) > MAX_FILE or len(raw) != before.st_size or \
                    (before.st_dev, before.st_ino, before.st_size,
                     before.st_mtime_ns) != (after.st_dev, after.st_ino,
                                            after.st_size, after.st_mtime_ns):
                raise ValueError("evidence role changed during read")
        finally:
            os.close(fd)
        files[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        total += len(raw)
        if total > MAX_TOTAL:
            raise ValueError("evidence total bound")
    if not files:
        raise ValueError("no bounded original evidence")
    return {"schema": "bw.direct-v8.authority-preflight-inventory.v1",
            "files": dict(sorted(files.items())), "totalBytes": total}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: preflight-inventory.py OWNED_EVIDENCE_DIR")
    root = Path(sys.argv[1])
    result = inventory(root)
    out = root / "file-inventory.json"
    with out.open("xb") as stream:
        stream.write(json.dumps(result, sort_keys=True, separators=(",", ":")).encode())
