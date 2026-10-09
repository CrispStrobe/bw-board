#!/usr/bin/env python3
"""Exact source and recursive imports for one owned task-mode AT gate."""

import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

HELD_BASE = "89eadb8c2449ff769b157ee6a4b78ccb833c3610"
BASE = "44087e8f1d19b1f74c6f2742ebca31594f6e7208"
NEW = "scripts/i80386-cwsdpmi-0501-task-mode-at/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-0501-task-mode.yml"
POLICY_TEST = "test/i80386-0501-frame-policy.test.mjs"
ORCHESTRATION_TEST = "test/i80386-0501-frame-orchestration.test.mjs"
JOURNAL_TEST = "test/i80386-dpmi-frame-journal.test.mjs"
CPU_SHA = "d1c30feca2f477c5fc46e8c87b27855809eda25adff90ae2922fccc3e5e601f4"
JOURNAL_TEST_SHA = "360dd0b5d3a2fb8f8d58d043ea33454fb5122e91f12f8c48ee138066c78e8d64"
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
    "scripts/i80386-cwsdpmi-0501-task-excursion/",
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
    "scripts/i80386-cwsdpmi-0501-task-mode/README.md",
}
REQUIRED_CURRENT = frozenset(NEW + name for name in (
    "README.md", "adapter.mjs", "driver.mjs", "orchestration.mjs",
    "orchestration-control.mjs", "source.py", "source-control.py",
    "inventory.py", "inventory-control.py"))
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
    return subprocess.check_output(("git", "--no-replace-objects", *args),
                                   env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})


def live_role(role, maximum=2 << 20):
    """Read one ordinary tracked role without following a raced symlink/FIFO."""
    path = Path(role)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum:
        raise ValueError("source role type/size: " + role)
    identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(fd)
        if (not stat.S_ISREG(opened.st_mode) or
                (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) != identity):
            raise ValueError("source role changed before read: " + role)
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(maximum + 1)
        after = os.fstat(fd)
        after_path = path.lstat()
        if (len(raw) != before.st_size or len(raw) > maximum or
                not stat.S_ISREG(after.st_mode) or
                not stat.S_ISREG(after_path.st_mode) or
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != identity or
                (after_path.st_dev, after_path.st_ino,
                 after_path.st_size, after_path.st_mtime_ns) != identity):
            raise ValueError("source role changed during read: " + role)
        return raw
    finally:
        os.close(fd)


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
    if role in REQUIRED_CURRENT or role == WORKFLOW:
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
    git("merge-base", "--is-ancestor", HELD_BASE, BASE)
    mode_delta = set(git("diff", "--name-only", HELD_BASE, BASE).decode().splitlines())
    if mode_delta != set(PINNED_CHANGED) | {"scripts/i80386-cwsdpmi-0501-task-mode/README.md"}:
        raise ValueError("reviewed task-mode base differs from held PR474 source")
    names = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
    base_names = set(git("ls-tree", "-r", "--name-only", BASE).decode().splitlines())
    changed = set(git("diff", "--name-only", BASE, "HEAD").decode().splitlines())
    if changed != REQUIRED_CURRENT | {WORKFLOW}:
        raise ValueError("changed source outside reviewed frame gate namespace")
    inherited = ({name for name in base_names if name.startswith(INHERITED_PREFIXES)} |
                 INHERITED_EXACT)
    current = {name for name in names if name.startswith(NEW)}
    if not inherited <= names or WORKFLOW not in names or \
       not {POLICY_TEST, ORCHESTRATION_TEST} <= names or current != REQUIRED_CURRENT:
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
        raw = live_role(role)
        if raw != git("show", f"HEAD:{role}"):
            raise ValueError("source differs from Git: " + role)
        held_source = HELD_BASE if role != "scripts/i80386-cwsdpmi-0501-task-mode/README.md" else BASE
        admit_role_provenance(role, raw, base_names,
                              git("show", f"{held_source}:{role}") if role in base_names else None)
        digest = hashlib.sha256(raw).hexdigest()
        if role == "src/experimental/i80386.js" and digest != CPU_SHA:
            raise ValueError("journal CPU source pin changed")
        if role in BIOS and (len(raw), digest) != BIOS[role]:
            raise ValueError("free ROM pin changed")
        hashes[role] = digest
    return {"schema": "bw.cwsdpmi-0501-task-mode.at-source.v1", "head": head,
            "inheritedBase": HELD_BASE, "reviewedTaskModeBase": BASE,
            "reviewedDiagnosticRoles": PINNED_CHANGED,
            "roles": hashes,
            "recursiveImports": dict(sorted(graph.items()))}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")
