#!/usr/bin/env python3
"""Recompute exact tracked source bytes before and after the hosted guests."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREFIXES = ("src/", "scripts/i80386-dos32a-owned/")
EXACT = {
    "scripts/lib/i80386-free-bios-fat16.mjs",
    ".github/workflows/i80386-dos32a-owned-le-actual.yml",
    "roms/free-at-bios/BIOS-bochs-legacy",
    "roms/free-at-bios/vgabios-lgpl.bin",
    "roms/free-at-bios/LICENSE",
    "roms/free-at-bios/README.md",
}
EXPECTED_BASE = {
    "scripts/i80386-dos32a-owned/README.md": "f8d80ceaee254ba3be08d40cc28f6c06c45e9157360c958a57e151f24142edaa",
    "scripts/i80386-dos32a-owned/build.py": "ad5d3e1b2655da5b0de41c73efff586c9eaf1770ee35956074bc48307d4ddece",
    "scripts/i80386-dos32a-owned/control.py": "5470f61a160c46867eff4d371483d5f3d437353afd54f5dddc4ed861a4aa865c",
}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "--no-replace-objects", *args], cwd=ROOT)


def inventory(expected_head: str) -> dict:
    if len(expected_head) != 40 or any(c not in "0123456789abcdef" for c in expected_head):
        raise ValueError("expected full source head")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected_head or git("status", "--porcelain"):
        raise ValueError("source head or worktree dirtied")
    names = [item.decode() for item in git("ls-files", "-z").split(b"\0") if item]
    selected = sorted(name for name in names if name.startswith(PREFIXES) or name in EXACT)
    if not EXACT.issubset(selected) or not set(EXPECTED_BASE).issubset(selected):
        raise ValueError("source roles missing")
    hashes = {}
    for name in selected:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("source role not ordinary: " + name)
        raw = path.read_bytes()
        if len(raw) > 4 << 20:
            raise ValueError("source role too large: " + name)
        current_blob = git("hash-object", "--", name).decode().strip()
        committed_blob = git("rev-parse", f"HEAD:{name}").decode().strip()
        if current_blob != committed_blob:
            raise ValueError("source role drift: " + name)
        hashes[name] = hashlib.sha256(raw).hexdigest()
    for name, expected in EXPECTED_BASE.items():
        if hashes[name] != expected:
            raise ValueError("owned LE source base changed: " + name)
    return {"schema": "bw.dos32a-owned-le.source-closure.v1", "head": head, "files": hashes}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    result = inventory(sys.argv[1])
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
