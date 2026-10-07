#!/usr/bin/env python3
"""Exact PR-head and inherited-source admission for the QEMU-only DPMI gate."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

BASE = "36124d9231ccc6b750c57c86552fda4f7675dffe"
NEW = "scripts/i80386-cwsdpmi-qemu-owned/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-qemu-owned-actual.yml"
INHERITED_PREFIX = "scripts/i80386-cwsdpmi-compile-only/"
INHERITED = {
    "scripts/i80386-cwsdpmi-owned/client.c",
    "scripts/i80386-dos32a-owned/acquire.py",
    "scripts/i80386-dos32a-owned/media.mjs",
    "scripts/i80386-dos32a-owned/oracle.py",
    "scripts/lib/i80386-free-bios-fat16.mjs",
    ".github/workflows/i80386-cwsdpmi-compile-only.yml",
}


def git(*args):
    return subprocess.check_output(("git", "--no-replace-objects", *args))


def identity(expected):
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("head or clean checkout")
    git("merge-base", "--is-ancestor", BASE, "HEAD")
    names = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
    base_names = set(git("ls-tree", "-r", "--name-only", BASE).decode().splitlines())
    inherited = {name for name in base_names if name.startswith(INHERITED_PREFIX)} | INHERITED
    roles = sorted({name for name in names if name.startswith((NEW, INHERITED_PREFIX))} |
                   INHERITED | {WORKFLOW})
    if not inherited <= names or WORKFLOW not in names or not {NEW + "source.py",
            NEW + "package.py", NEW + "media.mjs", NEW + "oracle.py"} <= names:
        raise ValueError("source role set")
    if {name for name in roles if name.startswith(INHERITED_PREFIX) or name in INHERITED} != inherited:
        raise ValueError("inherited source closure")
    hashes = {}
    for role in roles:
        path = Path(role)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1 << 20:
            raise ValueError("nonordinary source role")
        raw = path.read_bytes()
        if raw != git("show", f"HEAD:{role}"):
            raise ValueError("source differs from Git")
        if role in inherited and raw != git("show", f"{BASE}:{role}"):
            raise ValueError("inherited source changed")
        hashes[role] = hashlib.sha256(raw).hexdigest()
    return {"schema": "bw.cwsdpmi-owned.qemu-source.v1", "head": head,
            "compileAndDocsBase": BASE, "roles": hashes}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")
