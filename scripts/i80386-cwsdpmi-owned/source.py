#!/usr/bin/env python3
"""Authenticate this acquisition-only checkout against one exact Git head."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path


OWNED = "scripts/i80386-cwsdpmi-owned/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-owned-acquisition.yml"


def git(*args: str) -> bytes:
    return subprocess.check_output(("git", "--no-replace-objects", *args))


def identity(expected: str) -> dict:
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("head or clean checkout")
    names = git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines()
    roles = sorted(n for n in names if n.startswith(OWNED) or n == WORKFLOW)
    if WORKFLOW not in roles or not {OWNED + "acquire.py", OWNED + "source.py",
                                     OWNED + "acquire-control.py"}.issubset(roles):
        raise ValueError("source role closure")
    hashes = {}
    for role in roles:
        path = Path(role)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1 << 20:
            raise ValueError("nonordinary source role")
        raw = path.read_bytes()
        if raw != git("show", f"HEAD:{role}"):
            raise ValueError("source differs from Git")
        hashes[role] = hashlib.sha256(raw).hexdigest()
    return {"schema": "bw.cwsdpmi-owned.acquisition-source.v1", "head": head,
            "roles": hashes}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py exact-head output.json")
    report = identity(sys.argv[1])
    output = Path(sys.argv[2])
    with output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, sort_keys=True)
        stream.write("\n")


if __name__ == "__main__":
    main()
