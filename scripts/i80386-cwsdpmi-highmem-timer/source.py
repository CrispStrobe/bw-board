#!/usr/bin/env python3
"""Exact-head, unchanged inherited roles and reachable literal JS import admission."""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

BASE = "cc5b2ac7a40788f7d0100c4a1b5b5a9996bc2c66"
NEW = "scripts/i80386-cwsdpmi-highmem-timer/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-highmem-timer-qemu.yml"
INHERITED_PREFIXES = (
    "scripts/i80386-cwsdpmi-compile-only/",
    "scripts/i80386-cwsdpmi-owned/",
    "scripts/i80386-cwsdpmi-qemu-owned/",
    "scripts/i80386-dos32a-owned/",
    "scripts/lib/",
)
IMPORT_FROM = re.compile(r"^\s*(?:import|export)\s+[^\n;]*?\bfrom\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_NAMED = re.compile(
    r"^\s*(?:import|export)\s*\{[A-Za-z0-9_$,\s]{0,4096}\}\s*from\s*['\"]([^'\"]+)['\"]",
    re.M)
IMPORT_SIDE = re.compile(r"^\s*import\s*['\"]([^'\"]+)['\"]", re.M)
DYNAMIC = re.compile(r"\bimport\s*\(")


def git(*args):
    return subprocess.check_output(("git", "--no-replace-objects", *args))


def admit_diff(changed):
    if any(not (name.startswith(NEW) or name == WORKFLOW) for name in changed):
        raise ValueError("change outside owned gate")


def imported(role, raw, names):
    if not role.endswith((".js", ".mjs")):
        return set()
    source = raw.decode("utf-8")
    if DYNAMIC.search(source):
        raise ValueError("unreviewed dynamic JS import: " + role)
    found = set()
    for specifier in (IMPORT_FROM.findall(source) + IMPORT_NAMED.findall(source) +
                      IMPORT_SIDE.findall(source)):
        if specifier.startswith("node:") or specifier == "fs":
            continue
        if not specifier.startswith("."):
            raise ValueError("unbound external JS import: " + role)
        resolved = os.path.normpath(os.path.join(os.path.dirname(role), specifier))
        if resolved.startswith("../") or resolved not in names or not resolved.endswith((".js", ".mjs")):
            raise ValueError("missing relative JS role: " + role)
        found.add(resolved)
    return found


def graph(roots, names, reader):
    queue, edges = list(roots), {}
    while queue:
        role = queue.pop()
        if role in edges:
            continue
        dependencies = imported(role, reader(role), names)
        edges[role] = sorted(dependencies)
        queue.extend(dependency for dependency in dependencies if dependency not in edges)
    return dict(sorted(edges.items()))


def identity(expected):
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("head or clean checkout")
    git("merge-base", "--is-ancestor", BASE, "HEAD")
    names = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
    base = set(git("ls-tree", "-r", "--name-only", BASE).decode().splitlines())
    changed = set(git("diff", "--name-only", BASE, "HEAD").decode().splitlines())
    admit_diff(changed)
    owned = {name for name in names if name.startswith(NEW)}
    inherited = {name for name in base if name.startswith(INHERITED_PREFIXES)}
    required = {NEW + name for name in ("client.c", "compile-adapter.py", "grade.py",
                                       "media.mjs", "oracle.py", "source.py")}
    if not required <= owned or WORKFLOW not in names or not inherited <= names:
        raise ValueError("new/inherited role set")
    roots = {name for name in owned if name.endswith((".js", ".mjs"))}
    edges = graph(roots, names, lambda name: git("show", f"HEAD:{name}"))
    roles = owned | inherited | {WORKFLOW} | set(edges)
    critical = {"scripts/i80386-cwsdpmi-compile-only/compile.py",
                "scripts/i80386-cwsdpmi-owned/acquire.py",
                "scripts/i80386-cwsdpmi-qemu-owned/oracle.py",
                "scripts/i80386-cwsdpmi-qemu-owned/runtime.py",
                "scripts/i80386-cwsdpmi-qemu-owned/package.py",
                "scripts/i80386-dos32a-owned/acquire.py",
                "scripts/i80386-dos32a-owned/oracle.py",
                "scripts/lib/i80386-free-bios-fat16.mjs"}
    if not critical <= roles:
        raise ValueError("dynamic source dependency absent")
    hashes = {}
    for role in sorted(roles):
        path = Path(role)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 << 20:
            raise ValueError("nonordinary source role: " + role)
        raw = path.read_bytes()
        if raw != git("show", f"HEAD:{role}"):
            raise ValueError("role differs from Git: " + role)
        if role not in owned and role != WORKFLOW:
            if role not in base or raw != git("show", f"{BASE}:{role}"):
                raise ValueError("inherited source changed: " + role)
        hashes[role] = hashlib.sha256(raw).hexdigest()
    return {"schema": "bw.cwsdpmi-highmem-timer.qemu-source.v1", "head": head,
            "inheritedBase": BASE, "roles": hashes, "recursiveJsImports": edges}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")
