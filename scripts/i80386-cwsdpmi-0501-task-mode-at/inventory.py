#!/usr/bin/env python3
"""Admit closed, bounded task-mode reports and the exact notice."""

import hashlib
import json
import os
import stat
import sys
from pathlib import Path

NOTICE = "package/COPYING.CWS"
NOTICE_PIN = (1692, "2047dc5c069fe346c9b8030edcccb49760fb8dedb5a0d78f998e522cdec547a5")
ALLOWED = frozenset((
    'task-mode-inventory-control.stdout',
    'task-mode-inventory-control.stderr',
    'binding-control.stderr',
    'binding-control.stdout',
    'compile-adapter-control.py.stderr',
    'compile-adapter-control.py.stdout',
    'compile-audit/client-executable.json',
    'compile-audit/client-object.json',
    'compile-audit/client.map',
    'compile-audit/compile-report.json',
    'compile-audit/compile.json',
    'compile-audit/compile.stderr',
    'compile-audit/compile.stdout',
    'compile-audit/compiler-environment.json',
    'compile-audit/compiler-resolved-roles.json',
    'compile-audit/extracted-tool-roles.json',
    'compile-audit/gcc-as-role.json',
    'compile-audit/gcc-as-role.stderr',
    'compile-audit/gcc-as-role.stdout',
    'compile-audit/gcc-compile-plan.json',
    'compile-audit/gcc-compile-plan.stderr',
    'compile-audit/gcc-compile-plan.stdout',
    'compile-audit/gcc-crt0-role.json',
    'compile-audit/gcc-crt0-role.stderr',
    'compile-audit/gcc-crt0-role.stdout',
    'compile-audit/gcc-ld-role.json',
    'compile-audit/gcc-ld-role.stderr',
    'compile-audit/gcc-ld-role.stdout',
    'compile-audit/gcc-libc-role.json',
    'compile-audit/gcc-libc-role.stderr',
    'compile-audit/gcc-libc-role.stdout',
    'compile-audit/gcc-libgcc-role.json',
    'compile-audit/gcc-libgcc-role.stderr',
    'compile-audit/gcc-libgcc-role.stdout',
    'compile-audit/gcc-link-plan.json',
    'compile-audit/gcc-link-plan.stderr',
    'compile-audit/gcc-link-plan.stdout',
    'compile-audit/gcc-search.json',
    'compile-audit/gcc-search.stderr',
    'compile-audit/gcc-search.stdout',
    'compile-audit/gcc-stubify-role.json',
    'compile-audit/gcc-stubify-role.stderr',
    'compile-audit/gcc-stubify-role.stdout',
    'compile-audit/gcc-version.json',
    'compile-audit/gcc-version.stderr',
    'compile-audit/gcc-version.stdout',
    'compile-audit/input-manifest.json',
    'compile-audit/link-role-observations.json',
    'compile-audit/link.json',
    'compile-audit/link.stderr',
    'compile-audit/link.stdout',
    'compile-audit/progress.json',
    'compile-audit/runtime-source-origins.json',
    'compile-audit/selected-tool-roles.json',
    'compile.stderr',
    'compile.stdout',
    'cwsdpmi-fetch.stderr',
    'cwsdpmi-fetch.stdout',
    'djcrx-fetch.stderr',
    'djcrx-fetch.stdout',
    'djdev-fetch.stderr',
    'djdev-fetch.stdout',
    'djlsr-fetch.stderr',
    'djlsr-fetch.stdout',
    'driver-control.stderr',
    'driver-control.stdout',
    'driver.stderr',
    'driver.stdout',
    'frame-policy-test.stderr',
    'frame-policy-test.stdout',
    'freedos-fetch.stderr',
    'freedos-fetch.stdout',
    'freedos-input.json',
    'freedos.stderr',
    'freedos.stdout',
    'grade-control.py.stderr',
    'grade-control.py.stdout',
    'grade-control.stderr',
    'grade-control.stdout',
    'guest-step-status.txt',
    'highmem-compile.json',
    'host-hardware.json',
    'host.txt',
    'inventory-control.py.stderr',
    'inventory-control.py.stdout',
    'media-control.stderr',
    'media-control.stdout',
    'media.json',
    'media.stderr',
    'media.stdout',
    'owned-code-cut-control.stderr',
    'owned-code-cut-control.stdout',
    'package.stderr',
    'package.stdout',
    'package/COPYING.CWS',
    'package/input.json',
    'package/members.json',
    'package/package.json',
    'passive-ram-control.stderr',
    'passive-ram-control.stdout',
    'progress.json',
    'progress.json.pending.json',
    'source-after.json',
    'source-after.stderr',
    'source-after.stdout',
    'source-before.json',
    'source-control.stderr',
    'source-control.stdout',
    'source-slot-observation.json',
    'task-mode.json',
    'task-mode-orchestration-control.stderr',
    'task-mode-orchestration-control.stdout',
    'toolchain-fetch.stderr',
    'toolchain-fetch.stdout',
))

MAX_FILE = 5 << 20
MAX_TOTAL = 16 << 20


def role_allowed(role):
    return role in ALLOWED


def bounded(path, maximum):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
        raise ValueError("nonordinary or oversized artifact role")
    identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(fd)
        if (not stat.S_ISREG(opened.st_mode) or
                (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) != identity):
            raise ValueError("artifact changed before inventory")
        raw = bytearray()
        while len(raw) <= maximum:
            part = os.read(fd, min(1 << 20, maximum + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
        after = os.fstat(fd)
        after_path = path.lstat()
        if (len(raw) != before.st_size or len(raw) > maximum or
                not stat.S_ISREG(after.st_mode) or
                not stat.S_ISREG(after_path.st_mode) or
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != identity or
                (after_path.st_dev, after_path.st_ino,
                 after_path.st_size, after_path.st_mtime_ns) != identity):
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
    if any(role.startswith("package/") for role in files) and NOTICE not in files:
        raise ValueError("CWSDPMI notice missing")
    receipt = {"schema": "bw.cwsdpmi-0501-task-mode.artifact-inventory.v1", "files": files}
    with (root / "artifact-inventory.json").open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2, sort_keys=True)
        stream.write("\n")
    return receipt


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: inventory.py evidence-directory")
    inventory(Path(sys.argv[1]))
