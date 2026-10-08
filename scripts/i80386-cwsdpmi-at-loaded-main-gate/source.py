#!/usr/bin/env python3
"""Exact source, recursive JS imports and free ROM admission for one AT cut."""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

BASE = "8ae6ba128b8be2e2a807a5e55530e0d83bae21fb"
NEW = "scripts/i80386-cwsdpmi-at-loaded-main-gate/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-at-loaded-main-gate.yml"
INHERITED_PREFIXES = (
    "scripts/i80386-cwsdpmi-compile-only/",
    "scripts/i80386-cwsdpmi-qemu-owned/",
    "scripts/i80386-cwsdpmi-at-owned/",
    "scripts/i80386-cwsdpmi-at-loaded/",
    "scripts/i80386-cwsdpmi-at-loaded-actual/",
    "scripts/i80386-dos32a-owned/",
    "scripts/lib/",
)
INHERITED_EXACT = {
    "scripts/i80386-cwsdpmi-owned/client.c",
    "scripts/i80386-cwsdpmi-owned/acquire.py",  # dynamic compile.py import
    "roms/free-at-bios/BIOS-bochs-legacy",
    "roms/free-at-bios/vgabios-lgpl.bin",
    "roms/free-at-bios/LICENSE",
    "roms/free-at-bios/README.md",
    "package.json",
}
BIOS = {
    "roms/free-at-bios/BIOS-bochs-legacy":
        (65536, "6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac"),
    "roms/free-at-bios/vgabios-lgpl.bin":
        (38400, "76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1"),
}
IMPORT_FROM = re.compile(r"^\s*(?:import|export)\s+[^\n;]*?\bfrom\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_CONTINUED = re.compile(r"^\s*}\s*from\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_SIDE = re.compile(r"^\s*import\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_DYNAMIC = re.compile(r"\bimport\s*\(")


def git(*args):
    return subprocess.check_output(("git", "--no-replace-objects", *args))


def imported(role, raw, all_names):
    if not role.endswith((".mjs", ".js")):
        return set()
    source = raw.decode("utf-8")
    if IMPORT_DYNAMIC.search(source):
        raise ValueError("unreviewed dynamic JS import: " + role)
    found = set()
    for specifier in (IMPORT_FROM.findall(source) + IMPORT_CONTINUED.findall(source) +
                      IMPORT_SIDE.findall(source)):
        if specifier.startswith("node:"):
            continue
        if not specifier.startswith("."):
            raise ValueError("unbound JS import: " + role)
        resolved = os.path.normpath(os.path.join(os.path.dirname(role), specifier))
        if resolved.startswith("../") or resolved not in all_names or not resolved.endswith((".mjs", ".js")):
            raise ValueError("missing/broad JS import: " + role)
        found.add(resolved)
    return found


def identity(expected):
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("not exact clean source checkout")
    git("merge-base", "--is-ancestor", BASE, "HEAD")
    names = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
    base_names = set(git("ls-tree", "-r", "--name-only", BASE).decode().splitlines())
    inherited = ({name for name in base_names if name.startswith(INHERITED_PREFIXES)} |
                 INHERITED_EXACT)
    current = {name for name in names if name.startswith(NEW)}
    if not inherited <= names or WORKFLOW not in names or not {
        NEW + "source.py", NEW + "source-control.py",
        NEW + "driver.mjs", NEW + "driver-control.mjs"
    } <= current:
        raise ValueError("inherited/new source role missing")
    roles = inherited | current | {WORKFLOW}
    # Close every relative ESM edge reachable from the new driver/control,
    # including the real VGA class and AT CPU. Inherited unused roles remain
    # byte-authenticated separately; their comment examples are not imports.
    queue = sorted(role for role in current if role.endswith((".mjs", ".js")))
    graph = {}
    while queue:
        role = queue.pop()
        if role in graph:
            continue
        raw = git("show", f"HEAD:{role}")
        deps = imported(role, raw, names)
        graph[role] = sorted(deps)
        for dependency in deps:
            if dependency not in roles:
                roles.add(dependency)
                queue.append(dependency)
    if "src/experimental/vga-memory.js" not in roles or \
       "src/experimental/i80386-at-machine.js" not in roles or \
       "scripts/i80386-cwsdpmi-owned/acquire.py" not in roles:
        raise ValueError("critical dynamic/import source absent")
    hashes = {}
    for role in sorted(roles):
        path = Path(role)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 << 20:
            raise ValueError("nonordinary source/media role: " + role)
        raw = path.read_bytes()
        if raw != git("show", f"HEAD:{role}"):
            raise ValueError("source differs from Git: " + role)
        if role in inherited or (role.startswith("src/") and role in base_names):
            if raw != git("show", f"{BASE}:{role}"):
                raise ValueError("inherited source changed: " + role)
        digest = hashlib.sha256(raw).hexdigest()
        if role in BIOS and (len(raw), digest) != BIOS[role]:
            raise ValueError("free ROM pin changed")
        hashes[role] = digest
    return {"schema": "bw.cwsdpmi-owned.at-loaded-main-source.v1", "head": head,
            "inheritedBase": BASE, "roles": hashes,
            "recursiveImports": dict(sorted(graph.items()))}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")
