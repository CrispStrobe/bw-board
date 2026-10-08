#!/usr/bin/env python3
"""Admit bounded report-only evidence, including the exact CWSDPMI notice role."""

import hashlib
import json
import os
import stat
import sys
from pathlib import Path

NOTICE = "package/COPYING.CWS"
NOTICE_PIN = (1692, "2047dc5c069fe346c9b8030edcccb49760fb8dedb5a0d78f998e522cdec547a5")
REPORT_SUFFIXES = frozenset((".json", ".stdout", ".stderr", ".txt", ".map"))
MAX_FILE = 5 << 20
MAX_TOTAL = 16 << 20


def role_allowed(role):
    return role == NOTICE or Path(role).suffix.lower() in REPORT_SUFFIXES


def bounded(path, maximum):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
        raise ValueError("nonordinary or oversized artifact role")
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(fd)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_dev != before.st_dev or
                opened.st_ino != before.st_ino or opened.st_size != before.st_size):
            raise ValueError("artifact changed before inventory")
        raw = bytearray()
        while len(raw) <= maximum:
            part = os.read(fd, min(1 << 20, maximum + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
        after = os.fstat(fd)
        if (len(raw) != before.st_size or len(raw) > maximum or
                after.st_size != before.st_size):
            raise ValueError("artifact changed during inventory")
        return bytes(raw)
    finally:
        os.close(fd)


def inventory(root, notice_pin=NOTICE_PIN):
    files, total = {}, 0
    if not root.is_dir() or root.is_symlink():
        raise ValueError("artifact root shape")
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("artifact symlink")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("nonordinary artifact role")
        role = str(path.relative_to(root))
        if role == "artifact-inventory.json":
            raise ValueError("stale artifact inventory")
        if not role_allowed(role):
            raise ValueError("non-report artifact role")
        raw = bounded(path, min(MAX_FILE, MAX_TOTAL - total))
        digest = hashlib.sha256(raw).hexdigest()
        if role == NOTICE and (len(raw), digest) != notice_pin:
            raise ValueError("CWSDPMI notice bytes")
        total += len(raw)
        files[role] = {"bytes": len(raw), "sha256": digest}
    receipt = {"schema": "bw.cwsdpmi-highmem-timer.artifact-inventory.v1", "files": files}
    with (root / "artifact-inventory.json").open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2, sort_keys=True)
        stream.write("\n")
    return receipt


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: inventory.py evidence-directory")
    inventory(Path(sys.argv[1]))
