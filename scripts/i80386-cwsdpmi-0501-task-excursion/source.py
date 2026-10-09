#!/usr/bin/env python3
"""Exact source and recursive imports for one bounded task diagnostic gate."""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HISTORICAL_BASE = "8b82bde41f2fffff07279834a333a47bcd8f5a7f"
BASE = "d1ca2763ce30dc91df0c29e888590ab1d8135256"
NEW = "scripts/i80386-cwsdpmi-0501-task-excursion/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-0501-task-excursion.yml"
POLICY_TEST = "test/i80386-0501-frame-policy.test.mjs"
ORCHESTRATION_TEST = "test/i80386-0501-frame-orchestration.test.mjs"
JOURNAL_TEST = "test/i80386-dpmi-frame-journal.test.mjs"
CPU_SHA = "f51317ef7bfae8424e87a43548314d06b5cde6809f240ab1c456086a93377117"
JOURNAL_TEST_SHA = "8ab9c059df8a46ec5c0748059e0966032b1a2e4d24232db2f6dfbcf863177793"
PINNED_CHANGED = {
    "src/experimental/i80386.js": CPU_SHA,
    JOURNAL_TEST: JOURNAL_TEST_SHA,
}
WORKFLOW_ESM_ROOTS = frozenset({
    "scripts/i80386-cwsdpmi-at-loaded/passive-ram-control.mjs",
    "scripts/i80386-cwsdpmi-highmem-timer/media-control.mjs",
    "scripts/i80386-cwsdpmi-highmem-at/binding-control.mjs",
    "scripts/i80386-cwsdpmi-highmem-at/cut-control.mjs",
    "scripts/i80386-cwsdpmi-highmem-at/grade-control.mjs",
    "scripts/i80386-cwsdpmi-highmem-at/driver-control.mjs",
    POLICY_TEST, ORCHESTRATION_TEST,
    NEW + "orchestration-control.mjs",
})
INHERITED_PREFIXES = (
    "scripts/i80386-cwsdpmi-0501-frame-at/",
    "scripts/i80386-cwsdpmi-highmem-at/",
    "scripts/i80386-cwsdpmi-at-loaded-main-gate/",
    "scripts/i80386-cwsdpmi-at-completion/",
    "scripts/i80386-cwsdpmi-at-owned-code/",
    "scripts/i80386-cwsdpmi-highmem-timer/",
    "scripts/i80386-cwsdpmi-compile-only/",
    "scripts/i80386-cwsdpmi-qemu-owned/",
    "scripts/i80386-cwsdpmi-at-owned/",
    "scripts/i80386-cwsdpmi-at-loaded/",
    "scripts/i80386-cwsdpmi-at-loaded-actual/",
    "scripts/i80386-dos32a-owned/",
    "scripts/lib/",
)
INHERITED_EXACT = {
    POLICY_TEST,
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
# The reviewed helper control uses a named import with the closing brace and
# `from` on separate lines. Bound this exact literal grammar without treating
# comment examples or arbitrary source text as import declarations.
IMPORT_NAMED_MULTILINE = re.compile(
    r"^\s*(?:import|export)\s*\{[A-Za-z0-9_$,\s]{0,4096}\}\s*from\s*['\"]([^'\"]+)['\"]",
    re.M)
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
                      IMPORT_NAMED_MULTILINE.findall(source) +
                      IMPORT_SIDE.findall(source)):
        if specifier.startswith("node:") or specifier == "fs":
            continue
        if not specifier.startswith("."):
            raise ValueError("unbound JS import: " + role)
        resolved = os.path.normpath(os.path.join(os.path.dirname(role), specifier))
        if resolved.startswith("../") or resolved not in all_names or not resolved.endswith((".mjs", ".js")):
            raise ValueError("missing/broad JS import: " + role)
        found.add(resolved)
    return found


def walk_imports(roots, all_names, read):
    """Walk reachable literal ESM edges, even when a role was already listed."""
    queue = sorted(roots)
    graph = {}
    while queue:
        role = queue.pop()
        if role in graph:
            continue
        deps = imported(role, read(role), all_names)
        graph[role] = sorted(deps)
        queue.extend(dependency for dependency in deps if dependency not in graph)
    return graph


def admit_inherited(role, raw, original):
    if raw != original:
        raise ValueError("inherited source changed: " + role)


def admit_role_provenance(role, raw, base_names, base_raw):
    if role in PINNED_CHANGED:
        if hashlib.sha256(raw).hexdigest() != PINNED_CHANGED[role]:
            raise ValueError("reviewed frame diagnostic role differs: " + role)
        return
    if role.startswith(NEW) or role == WORKFLOW:
        return
    if role not in base_names:
        raise ValueError("unreviewed imported/source role: " + role)
    admit_inherited(role, raw, base_raw)


def identity(expected):
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("not exact clean source checkout")
    git("merge-base", "--is-ancestor", BASE, "HEAD")
    names = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
    base_names = set(git("ls-tree", "-r", "--name-only", BASE).decode().splitlines())
    changed = set(git("diff", "--name-only", BASE, "HEAD").decode().splitlines())
    if any(not (role.startswith(NEW) or role == WORKFLOW or
                role in PINNED_CHANGED)
           for role in changed):
        raise ValueError("changed source outside reviewed frame gate namespace")
    inherited = ({name for name in base_names if name.startswith(INHERITED_PREFIXES)} |
                 INHERITED_EXACT)
    current = {name for name in names if name.startswith(NEW)}
    if not inherited <= names or \
       WORKFLOW not in names or not {POLICY_TEST, ORCHESTRATION_TEST} <= names or not {
        NEW + "source.py", NEW + "source-control.py",
        NEW + "adapter.mjs", NEW + "driver.mjs", NEW + "orchestration.mjs",
        NEW + "orchestration-control.mjs", NEW + "inventory.py",
        NEW + "inventory-control.py"
    } <= current:
        raise ValueError("inherited/new source role missing")
    roles = inherited | current | {WORKFLOW, POLICY_TEST, ORCHESTRATION_TEST,
                                   JOURNAL_TEST}
    # Close every relative ESM edge reachable from the new driver/control,
    # including the real VGA class and AT CPU. Inherited unused roles remain
    # byte-authenticated separately; their comment examples are not imports.
    graph = walk_imports(
        {role for role in current if role.endswith((".mjs", ".js"))} |
        WORKFLOW_ESM_ROOTS,
        names, lambda role: git("show", f"HEAD:{role}"))
    roles.update(graph)
    if "src/experimental/i80386.js" not in roles or \
       "src/experimental/vga-memory.js" not in roles or \
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
        admit_role_provenance(role, raw, base_names,
                              git("show", f"{BASE}:{role}") if role in base_names else None)
        digest = hashlib.sha256(raw).hexdigest()
        if role == "src/experimental/i80386.js" and digest != CPU_SHA:
            raise ValueError("journal CPU source pin changed")
        if role in BIOS and (len(raw), digest) != BIOS[role]:
            raise ValueError("free ROM pin changed")
        hashes[role] = digest
    return {"schema": "bw.cwsdpmi-0501-task-excursion.at-source.v1", "head": head,
            "inheritedBase": BASE, "historicalJournalBase": HISTORICAL_BASE,
            "reviewedDiagnosticRoles": PINNED_CHANGED,
            "roles": hashes,
            "recursiveImports": dict(sorted(graph.items()))}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")
