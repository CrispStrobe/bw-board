#!/usr/bin/env python3
"""Authenticate a clean notice-only branch and its unchanged tested ancestors."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

BASE = "eeb95c49ab8dde2a0572f35e90bc41948480c809"
OLD = ("scripts/i80386-cwsdpmi-owned/", "scripts/i80386-cwsdpmi-source-notice/")
NEW = "scripts/i80386-cwsdpmi-notice-completion/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-notice-completion.yml"
OLD_WORKFLOWS = (".github/workflows/i80386-cwsdpmi-owned-acquisition.yml",
                 ".github/workflows/i80386-cwsdpmi-source-notice.yml")


def git(*args):
    return subprocess.check_output(("git", "--no-replace-objects", *args))


def identity(expected):
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("head or clean checkout")
    git("merge-base", "--is-ancestor", BASE, "HEAD")
    head_roles = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
    base_roles = set(git("ls-tree", "-r", "--name-only", BASE).decode().splitlines())
    inherited = {n for n in base_roles if n.startswith(OLD) or n in OLD_WORKFLOWS}
    roles = sorted(n for n in head_roles if n.startswith((*OLD, NEW)) or
                   n in (*OLD_WORKFLOWS, WORKFLOW))
    if set(n for n in roles if n in inherited or n.startswith(OLD)) != inherited:
        raise ValueError("inherited source role set changed")
    if WORKFLOW not in roles or not {NEW + "source.py", NEW + "notice.py",
                                     NEW + "notice-control.py"}.issubset(roles):
        raise ValueError("new source role set incomplete")
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
    return {"schema": "bw.cwsdpmi-notice-completion.source.v1", "head": head,
            "stageBResultHead": BASE, "roles": hashes}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as out:
        json.dump(identity(sys.argv[1]), out, indent=2, sort_keys=True)
        out.write("\n")
