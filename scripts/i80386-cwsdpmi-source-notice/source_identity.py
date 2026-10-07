#!/usr/bin/env python3
"""Admit the exact stage-A ancestor and this report-only source closure."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

BASE = "512501ccdf96ca3f3b05c13d8efdf5fab9cc4aea"
OLD = "scripts/i80386-cwsdpmi-owned/"
NEW = "scripts/i80386-cwsdpmi-source-notice/"
WORKFLOWS = (".github/workflows/i80386-cwsdpmi-owned-acquisition.yml",
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
    names = git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines()
    roles = sorted(n for n in names if n.startswith((OLD, NEW)) or n in WORKFLOWS)
    if not all(n in roles for n in WORKFLOWS):
        raise ValueError("workflow role closure")
    base_names = git("ls-tree", "-r", "--name-only", BASE).decode().splitlines()
    inherited = sorted(n for n in base_names if n.startswith(OLD) or n == WORKFLOWS[0])
    if sorted(n for n in roles if n.startswith(OLD) or n == WORKFLOWS[0]) != inherited:
        raise ValueError("inherited role set changed")
    hashes = {}
    for role in roles:
        path = Path(role)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1 << 20:
            raise ValueError("nonordinary source role")
        raw = path.read_bytes()
        if raw != git("show", f"HEAD:{role}"):
            raise ValueError("source differs from Git")
        if role in inherited and raw != git("show", f"{BASE}:{role}"):
            raise ValueError("stage-A source changed")
        hashes[role] = hashlib.sha256(raw).hexdigest()
    return {"schema": "bw.cwsdpmi-source-notice.source.v1", "head": head,
            "stageAHead": BASE, "roles": hashes}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source_identity.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as out:
        json.dump(identity(sys.argv[1]), out, indent=2, sort_keys=True)
        out.write("\n")
