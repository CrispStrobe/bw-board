#!/usr/bin/env python3
"""Exact Git closure for the separate report-only 64 MiB authority preflight."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

BASE = "90c4de590325f59c8d164cefc37fa036740f189a"
PREFIX = "scripts/xv6-js-rollback-direct-v8/"
HELD = frozenset(PREFIX + name for name in (
    "README.md", "addon.cc", "source.py", "source-control.py",
    "support-case.mjs", "support-policy.mjs", "support-policy-control.mjs",
    "preflight-control.py", "preflight_inventory.py", "preflight-source.py",
    "preflight-source-control.py", "header-census.py",
    "header-census-control.py", "header-census-source.py",
    "header-census-source-control.py", "header-census-inventory.py")) | {
    ".github/workflows/xv6-js-rollback-direct-v8-preflight.yml",
    ".github/workflows/xv6-js-rollback-direct-v8-header-census.yml"}
CHANGED = frozenset(PREFIX + name for name in ("preflight.py", "build.py"))
NEW = frozenset(PREFIX + name for name in (
    "header_budget.py", "header-budget-control.py",
    "preflight-64m-inventory.py", "preflight-64m-source.py",
    "preflight-64m-source-control.py")) | {
    ".github/workflows/xv6-js-rollback-direct-v8-preflight-64m.yml"}
MAX_ROLE = 256_000


def git(*args):
    return subprocess.check_output(["git", "--no-replace-objects", *args],
                                   stderr=subprocess.DEVNULL,
                                   env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})


def validate_changed(paths):
    if len(paths) != len(CHANGED | NEW) or set(paths) != CHANGED | NEW:
        raise ValueError("64 MiB source delta changed")
    if any(path.endswith((".node", ".o", ".a", ".tar.xz")) for path in paths):
        raise ValueError("binary/archive source role refused")


def committed_and_live(root, head, role):
    raw = git("show", f"{head}:{role}")
    if not raw or len(raw) > MAX_ROLE:
        raise ValueError("bounded source role refused")
    fd = os.open(root / role, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        live = bytearray()
        while len(live) <= MAX_ROLE:
            part = os.read(fd, min(65536, MAX_ROLE + 1 - len(live)))
            if not part:
                break
            live.extend(part)
        if live != raw:
            raise ValueError("live source role differs")
    finally:
        os.close(fd)
    return raw


def identity():
    root = Path(__file__).resolve().parents[2]
    if git("rev-parse", "--show-toplevel").decode().strip() != str(root):
        raise ValueError("wrong checkout root")
    head = git("rev-parse", "HEAD").decode().strip()
    if git("merge-base", BASE, head).decode().strip() != BASE:
        raise ValueError("wrong frozen census base")
    validate_changed(git("diff", "--name-only", BASE, head).decode().splitlines())
    if git("status", "--porcelain=v1", "-uall"):
        raise ValueError("dirty source checkout")
    roles = {}
    for role in sorted(HELD | CHANGED | NEW):
        raw = committed_and_live(root, head, role)
        if role in HELD and raw != git("show", f"{BASE}:{role}"):
            raise ValueError("held source role changed")
        roles[role] = hashlib.sha256(raw).hexdigest()
    return {"schema": "bw.direct-v8.authority-preflight-64m-source.v1",
            "base": BASE, "head": head, "roles": roles,
            "qualification": "REPORT_ONLY_64M_NO_BUILD_OR_NATIVE_CONTROL"}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: preflight-64m-source.py OWNED_REPORT.json")
    raw = json.dumps(identity(), sort_keys=True, separators=(",", ":")).encode()
    if len(raw) > 32_000:
        raise ValueError("source receipt bound")
    with open(sys.argv[1], "xb") as out:
        out.write(raw)
