#!/usr/bin/env python3
"""Source-only exact Git closure for the unconnected direct-V8 first slice."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

BASE = "f2971d8ae7bd67a30f13baa45b63956790d9b975"
PREFIX = "scripts/xv6-js-rollback-direct-v8/"
ROLES = frozenset(PREFIX + name for name in (
    "README.md", "addon.cc", "build.py", "source.py", "source-control.py",
    "support-case.mjs", "support-policy.mjs", "support-policy-control.mjs",
))
HEADER_SHA = "46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836"


def git(*args):
    return subprocess.check_output(["git", "--no-replace-objects", *args],
                                   stderr=subprocess.DEVNULL,
                                   env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})


def validate_roles(changed, roles=ROLES):
    if set(changed) != set(roles) or len(changed) != len(roles):
        raise ValueError("reviewed direct-V8 path set changed")
    if any(not p.startswith(PREFIX) or p.endswith((".node", ".o", ".a"))
           for p in changed):
        raise ValueError("direct-V8 role outside closed namespace")


def identity():
    root = Path(__file__).resolve().parents[2]
    if git("rev-parse", "--show-toplevel").decode().strip() != str(root):
        raise ValueError("source root mismatch")
    head = git("rev-parse", "HEAD").decode().strip()
    if git("merge-base", BASE, head).decode().strip() != BASE:
        raise ValueError("wrong frozen base")
    changed = git("diff", "--name-only", BASE, head).decode().splitlines()
    validate_roles(changed)
    if git("status", "--porcelain=v1", "-uall"):
        raise ValueError("source checkout dirty")
    hashes = {}
    for role in sorted(ROLES):
        committed = git("show", f"{head}:{role}")
        path = root / role
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            live = b""
            while len(live) <= 256_000:
                part = os.read(fd, 256_001 - len(live))
                if not part:
                    break
                live += part
        finally:
            os.close(fd)
        if live != committed or len(live) > 256_000:
            raise ValueError("reviewed role bytes differ")
        hashes[role] = hashlib.sha256(live).hexdigest()
    if HEADER_SHA not in (root / PREFIX / "build.py").read_text():
        raise ValueError("header pin missing")
    return {"schema": "bw.direct-v8.source-first-slice.v1", "base": BASE,
            "head": head, "nodeHeadersArchiveSha256": HEADER_SHA, "roles": hashes,
            "qualification": "SOURCE_ONLY_UNCOMPILED"}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: source.py OWNED_REPORT.json")
    data = json.dumps(identity(), sort_keys=True, separators=(",", ":")).encode()
    if len(data) > 32_000:
        raise ValueError("source receipt bound")
    with open(sys.argv[1], "xb") as out:
        out.write(data)
