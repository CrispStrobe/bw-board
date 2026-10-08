#!/usr/bin/env python3
"""Exact source closure for the hosted parser-only AT binding admission."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

BASE = "e1864c652662667da5098b0171c6b37ffe33449f"
NEW = "scripts/i80386-cwsdpmi-at-binding-actual/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-at-binding-actual.yml"
INHERITED_PREFIXES = ("scripts/i80386-cwsdpmi-compile-only/",
                      "scripts/i80386-cwsdpmi-at-owned/")
INHERITED_EXACT = {
    "scripts/i80386-cwsdpmi-owned/client.c",
    "scripts/i80386-cwsdpmi-owned/acquire.py",  # dynamic compile.py import
    ".github/workflows/i80386-cwsdpmi-compile-only.yml",
}


def git(*args):
    return subprocess.check_output(("git", "--no-replace-objects", *args))


def authenticate_role(role, baseline):
    path = Path(role)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1 << 20:
        raise ValueError("nonordinary source role: " + role)
    raw = path.read_bytes()
    if raw != git("show", "HEAD:" + role):
        raise ValueError("source differs from HEAD: " + role)
    if baseline and raw != git("show", BASE + ":" + role):
        raise ValueError("inherited source changed: " + role)
    return hashlib.sha256(raw).hexdigest()


def identity(expected):
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("head or checkout not exact and clean")
    git("merge-base", "--is-ancestor", BASE, "HEAD")
    names = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
    base_names = set(git("ls-tree", "-r", "--name-only", BASE).decode().splitlines())
    inherited = ({n for n in base_names if n.startswith(INHERITED_PREFIXES)} |
                 INHERITED_EXACT)
    roles = sorted({n for n in names if n.startswith(NEW)} | inherited | {WORKFLOW})
    if not inherited <= names or WORKFLOW not in names or not {
        NEW + "source.py", NEW + "admit.mjs", NEW + "admit-control.mjs"
    } <= names:
        raise ValueError("missing source closure role")
    if {n for n in roles if n.startswith(INHERITED_PREFIXES) or n in INHERITED_EXACT} != inherited:
        raise ValueError("inherited source closure mismatch")
    hashes = {role: authenticate_role(role, role in inherited) for role in roles}
    return {"schema": "bw.cwsdpmi-owned.at-binding-actual-source.v1",
            "head": head, "inheritedBase": BASE, "roles": hashes}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")
