#!/usr/bin/env python3
"""Closed report-only inventory for a data-only header census."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROLES = frozenset(("source.json", "source.stdout", "source.stderr",
                   "control.stdout", "control.stderr", "run.stdout", "run.stderr",
                   "census.json", "census.pending.json",
                   "census-progress.json", "census-progress.pending.json"))
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024


def inventory(root):
    root = Path(root)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or root.is_symlink():
        raise ValueError("ordinary evidence directory required")
    files = {}
    total = 0
    for path in root.iterdir():
        name = path.name
        if name not in ROLES:
            raise ValueError("forbidden header-census artifact role: " + name)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 0 <= info.st_size <= MAX_FILE:
            raise ValueError("nonordinary/oversized artifact role")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            before = os.fstat(fd)
            digest = hashlib.sha256()
            count = 0
            while count <= MAX_FILE:
                block = os.read(fd, min(65536, MAX_FILE + 1 - count))
                if not block:
                    break
                digest.update(block)
                count += len(block)
            after = os.fstat(fd)
            if count > MAX_FILE or count != before.st_size or \
                    (before.st_dev, before.st_ino, before.st_size,
                     before.st_mtime_ns) != (after.st_dev, after.st_ino,
                                            after.st_size, after.st_mtime_ns):
                raise ValueError("artifact role changed during read")
        finally:
            os.close(fd)
        files[name] = {"bytes": count, "sha256": digest.hexdigest()}
        total += count
        if total > MAX_TOTAL:
            raise ValueError("artifact total bound")
    if not files:
        raise ValueError("no original report-only evidence")
    return {"schema": "bw.direct-v8.header-census-inventory.v1",
            "files": dict(sorted(files.items())), "totalBytes": total}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: header-census-inventory.py OWNED_EVIDENCE_DIR")
    root = Path(sys.argv[1])
    result = inventory(root)
    with (root / "file-inventory.json").open("xb") as out:
        out.write(json.dumps(result, sort_keys=True, separators=(",", ":")).encode())
