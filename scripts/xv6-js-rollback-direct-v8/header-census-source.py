#!/usr/bin/env python3
"""Exact Git roles for the data-only header census, based on frozen PR473."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

BASE = "869c3c72cb40b66c135621f297eb66638166b69d"
PREFIX = "scripts/xv6-js-rollback-direct-v8/"
HELD = frozenset(PREFIX + name for name in (
    "README.md", "addon.cc", "build.py", "source.py", "source-control.py",
    "support-case.mjs", "support-policy.mjs", "support-policy-control.mjs",
    "preflight.py", "preflight-control.py", "preflight_inventory.py",
    "preflight-source.py", "preflight-source-control.py")) | {
        ".github/workflows/xv6-js-rollback-direct-v8-preflight.yml"}
NEW = frozenset(PREFIX + name for name in (
    "header-census.py", "header-census-control.py", "header-census-source.py",
    "header-census-source-control.py", "header-census-inventory.py")) | {
        ".github/workflows/xv6-js-rollback-direct-v8-header-census.yml"}


def git(*args):
    return subprocess.check_output(["git", "--no-replace-objects", *args],
                                   stderr=subprocess.DEVNULL,
                                   env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})


def validate_changed(changed):
    if len(changed) != len(NEW) or set(changed) != NEW:
        raise ValueError("data-only source delta changed")


def identity():
    root = Path(__file__).resolve().parents[2]
    if git("rev-parse", "--show-toplevel").decode().strip() != str(root):
        raise ValueError("wrong source root")
    head = git("rev-parse", "HEAD").decode().strip()
    if git("merge-base", BASE, head).decode().strip() != BASE:
        raise ValueError("wrong frozen preflight parent")
    validate_changed(git("diff", "--name-only", BASE, head).decode().splitlines())
    if git("status", "--porcelain=v1", "-uall"):
        raise ValueError("dirty source checkout")
    hashes = {}
    for role in sorted(HELD | NEW):
        previous = git("show", f"{BASE}:{role}") if role in HELD else None
        committed = git("show", f"{head}:{role}")
        if not committed or len(committed) > 256_000 or \
                (previous is not None and committed != previous):
            raise ValueError("source role bytes refused")
        fd = os.open(root / role, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            live = os.read(fd, 256_001)
            if live != committed:
                raise ValueError("live source role mismatch")
        finally:
            os.close(fd)
        hashes[role] = hashlib.sha256(committed).hexdigest()
    return {"schema": "bw.direct-v8.header-census-source.v1",
            "base": BASE, "head": head, "roles": hashes,
            "qualification": "DATA_ONLY_NO_BUILD_OR_NATIVE_CONTROL"}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: header-census-source.py OWNED_REPORT.json")
    raw = json.dumps(identity(), sort_keys=True, separators=(",", ":")).encode()
    if len(raw) > 32_000:
        raise ValueError("source receipt bound")
    with open(sys.argv[1], "xb") as out:
        out.write(raw)
