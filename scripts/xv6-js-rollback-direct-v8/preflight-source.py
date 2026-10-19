#!/usr/bin/env python3
"""Exact Git source roster for the report-only authority preflight."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

BASE = "ff2b916e1899d6042f9b1a3e2701ea1ec4f708d7"
PREFIX = "scripts/xv6-js-rollback-direct-v8/"
INHERITED = frozenset(PREFIX + name for name in (
    "README.md", "addon.cc", "build.py", "source.py", "source-control.py",
    "support-case.mjs", "support-policy.mjs", "support-policy-control.mjs"))
NEW = frozenset((PREFIX + name for name in (
    "preflight.py", "preflight-control.py", "preflight_inventory.py",
    "preflight-source.py", "preflight-source-control.py"))) | {
        ".github/workflows/xv6-js-rollback-direct-v8-preflight.yml"}
MAX_ROLE = 256_000


def git(*args):
    return subprocess.check_output(["git", "--no-replace-objects", *args],
                                   stderr=subprocess.DEVNULL,
                                   env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})


def validate_changed(paths):
    if len(paths) != len(NEW) or set(paths) != NEW:
        raise ValueError("report-only preflight path roster changed")
    if any(path.endswith((".node", ".o", ".a", ".tar.xz")) for path in paths):
        raise ValueError("binary/archive source role refused")


def same_git_bytes(root, head, role):
    committed = git("show", f"{head}:{role}")
    if not committed or len(committed) > MAX_ROLE:
        raise ValueError("source role size refused")
    fd = os.open(root / role, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        live = bytearray()
        while len(live) <= MAX_ROLE:
            part = os.read(fd, min(65536, MAX_ROLE + 1 - len(live)))
            if not part:
                break
            live.extend(part)
    finally:
        os.close(fd)
    if live != committed:
        raise ValueError("live source role differs")
    return hashlib.sha256(committed).hexdigest()


def identity():
    root = Path(__file__).resolve().parents[2]
    if git("rev-parse", "--show-toplevel").decode().strip() != str(root):
        raise ValueError("wrong checkout root")
    head = git("rev-parse", "HEAD").decode().strip()
    if git("merge-base", BASE, head).decode().strip() != BASE:
        raise ValueError("wrong frozen source parent")
    validate_changed(git("diff", "--name-only", BASE, head).decode().splitlines())
    if git("status", "--porcelain=v1", "-uall"):
        raise ValueError("source checkout dirty")
    roles = {}
    for role in sorted(INHERITED | NEW):
        roles[role] = same_git_bytes(root, head, role)
        if role in INHERITED and git("show", f"{BASE}:{role}") != git("show", f"{head}:{role}"):
            raise ValueError("reviewed source-only slice changed")
    return {"schema": "bw.direct-v8.authority-preflight-source.v1",
            "head": head, "base": BASE, "roles": roles,
            "qualification": "REPORT_ONLY_NO_BUILD_OR_NATIVE_CONTROL"}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: preflight-source.py OWNED_REPORT.json")
    data = json.dumps(identity(), sort_keys=True, separators=(",", ":")).encode()
    if len(data) > 32_000:
        raise ValueError("source receipt bound")
    with open(sys.argv[1], "xb") as out:
        out.write(data)
