#!/usr/bin/env python3
"""Closed report-only inventory; Node, addon, archives and headers forbidden."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = frozenset(("source.json", "source.stdout", "source.stderr",
                  "control.stdout", "control.stderr", "run.stdout",
                  "run.stderr", "target-site-support.json", "target-site-support.pending.json"))
CASE_NAMES = ("minor-baseline", "minor-enabled", "major-baseline", "major-enabled")
CASE = {"pre.json": 8 * 1024 * 1024, "post.json": 8 * 1024 * 1024,
        "facts.json": 65536, "result.json": 65536}
MAX_TOTAL = 72 * 1024 * 1024
MAX_ROOT = 1 * 1024 * 1024


def ordinary_dir(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.is_symlink():
        raise ValueError("ordinary owned evidence directory required")


def read_role(path, maximum):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
        raise ValueError("nonordinary or oversized report role")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        identity = (opened.st_dev, opened.st_ino, opened.st_size,
                    opened.st_mtime_ns)
        if not stat.S_ISREG(opened.st_mode) or identity != (
                before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns):
            raise ValueError("report role replaced before read")
        digest = hashlib.sha256()
        count = 0
        while count <= maximum:
            block = os.read(fd, min(65536, maximum + 1 - count))
            if not block:
                break
            digest.update(block)
            count += len(block)
        after = os.fstat(fd)
        listed = path.lstat()
        if count > maximum or count != opened.st_size or identity != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or \
                identity != (listed.st_dev, listed.st_ino, listed.st_size,
                             listed.st_mtime_ns):
            raise ValueError("report role changed during read")
        return {"bytes": count, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def inventory(root):
    root = Path(root)
    ordinary_dir(root)
    files = {}
    total = 0
    for item in root.iterdir():
        if item.name in ROOT:
            files[item.name] = read_role(item, MAX_ROOT)
            total += files[item.name]["bytes"]
        elif item.name in CASE_NAMES:
            ordinary_dir(item)
            for child in item.iterdir():
                if child.name not in CASE:
                    raise ValueError("forbidden support-case artifact role")
                name = item.name + "/" + child.name
                files[name] = read_role(child, CASE[child.name])
                total += files[name]["bytes"]
        else:
            raise ValueError("forbidden target-site-support artifact role")
        if total > MAX_TOTAL:
            raise ValueError("target-site-support artifact total bound")
    if not files:
        raise ValueError("empty target-site-support artifact")
    return {"schema": "bw.direct-v8.target-site-support-inventory.v1",
            "files": dict(sorted(files.items())), "totalBytes": total}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: inventory.py OWNED_EVIDENCE_DIR")
    path = Path(sys.argv[1])
    result = inventory(path)
    with (path / "file-inventory.json").open("xb") as output:
        output.write(json.dumps(result, sort_keys=True,
                                separators=(",", ":")).encode())
