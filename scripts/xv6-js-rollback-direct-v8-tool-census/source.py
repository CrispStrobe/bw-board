#!/usr/bin/env python3
"""Exact Git closure for the separate report-only tool census."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

BASE = "61fa4800434301843a648f9ad851067366b5525e"
PREFIX = "scripts/xv6-js-rollback-direct-v8/"
HELD = frozenset(PREFIX + name for name in (
    "README.md", "addon.cc", "source.py", "source-control.py",
    "support-case.mjs", "support-policy.mjs", "support-policy-control.mjs",
    "preflight-control.py", "preflight_inventory.py", "preflight-source.py",
    "preflight-source-control.py", "header-census.py",
    "header-census-control.py", "header-census-source.py",
    "header-census-source-control.py", "header-census-inventory.py",
    "preflight.py", "build.py", "header_budget.py", "header-budget-control.py",
    "preflight-64m-inventory.py", "preflight-64m-source.py",
    "preflight-64m-source-control.py")) | {
    ".github/workflows/xv6-js-rollback-direct-v8-preflight.yml",
    ".github/workflows/xv6-js-rollback-direct-v8-header-census.yml",
    ".github/workflows/xv6-js-rollback-direct-v8-preflight-64m.yml"}
NEW = frozenset("scripts/xv6-js-rollback-direct-v8-tool-census/" + name
                for name in ("README.md", "run.py", "control.py", "source.py",
                             "source-control.py", "inventory.py",
                             "inventory-control.py")) | {
    ".github/workflows/xv6-js-rollback-direct-v8-tool-census.yml"}
MAX_ROLE = 256_000


def git(*args):
    return subprocess.check_output(["git", "--no-replace-objects", *args],
                                   stderr=subprocess.DEVNULL,
                                   env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})


def validate_changed(paths):
    if len(paths) != len(NEW) or set(paths) != NEW:
        raise ValueError("tool census source delta changed")
    if any(path.endswith((".node", ".o", ".a", ".tar.xz")) for path in paths):
        raise ValueError("binary/archive source role refused")


def committed_and_live(root, head, role):
    raw = git("show", f"{head}:{role}")
    if not raw or len(raw) > MAX_ROLE:
        raise ValueError("bounded source role refused")
    path = root / role
    listed = path.lstat()
    if not stat.S_ISREG(listed.st_mode) or listed.st_size != len(raw):
        raise ValueError("ordinary source role required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or \
                (before.st_dev, before.st_ino, before.st_size) != \
                (listed.st_dev, listed.st_ino, listed.st_size):
            raise ValueError("source role replaced before read")
        live = bytearray()
        while len(live) <= MAX_ROLE:
            part = os.read(fd, min(65536, MAX_ROLE + 1 - len(live)))
            if not part:
                break
            live.extend(part)
        if live != raw:
            raise ValueError("live source role differs")
        after = os.fstat(fd)
        listed_after = path.lstat()
        snapshot = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != snapshot or \
                (listed_after.st_dev, listed_after.st_ino, listed_after.st_size,
                 listed_after.st_mtime_ns) != snapshot:
            raise ValueError("source role changed during read")
    finally:
        os.close(fd)
    return raw


def identity():
    root = Path(__file__).resolve().parents[2]
    if git("rev-parse", "--show-toplevel").decode().strip() != str(root):
        raise ValueError("wrong checkout root")
    head = git("rev-parse", "HEAD").decode().strip()
    if git("merge-base", BASE, head).decode().strip() != BASE:
        raise ValueError("wrong frozen 64 MiB preflight base")
    validate_changed(git("diff", "--name-only", BASE, head).decode().splitlines())
    if git("status", "--porcelain=v1", "-uall"):
        raise ValueError("dirty source checkout")
    roles = {}
    for role in sorted(HELD | NEW):
        raw = committed_and_live(root, head, role)
        if role in HELD and raw != git("show", f"{BASE}:{role}"):
            raise ValueError("held source role changed")
        roles[role] = hashlib.sha256(raw).hexdigest()
    return {"schema": "bw.direct-v8.tool-census-source.v1",
            "base": BASE, "head": head, "roles": roles,
            "qualification": "REPORT_ONLY_TOOL_CENSUS_NO_BUILD_OR_NATIVE_CONTROL"}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: source.py OWNED_REPORT.json")
    raw = json.dumps(identity(), sort_keys=True, separators=(",", ":")).encode()
    if len(raw) > 32_000:
        raise ValueError("source receipt bound")
    with open(sys.argv[1], "xb") as out:
        out.write(raw)
