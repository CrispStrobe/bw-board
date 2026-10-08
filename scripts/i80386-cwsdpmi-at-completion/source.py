#!/usr/bin/env python3
"""Exact source and recursive imports for one owned-client AT completion gate."""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

BASE = "eebec7259b4f6bc5c1ef35982d3affc4dc8c94d4"
HELPER_HEAD = "8673b496dbfac889aa6b8058da9d4b1c97b5f07b"
NEW = "scripts/i80386-cwsdpmi-at-completion/"
HELPER = "scripts/i80386-cwsdpmi-at-owned-code/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-at-completion.yml"
# Only the two reviewed strict-cut helper roles differ from diagnostic BASE.
# Every other inherited role, including CPU, ROM, media and compiler code,
# remains byte-exact at BASE. The separate helper's five files equal its head.
REVIEWED_OVERRIDES = {
    "scripts/i80386-cwsdpmi-at-loaded-actual/cut.mjs":
        "63e18f02f4061aa336190ef6b847d62aff654985a769b95deb1a30d3f06d0f6e",
    "scripts/i80386-cwsdpmi-at-loaded-actual/cut-control.mjs":
        "afee15212e6b58e1041df2dd32992a0d7f51f62ba248b8c4f588facfc36c371f",
}
INHERITED_PREFIXES = (
    "scripts/i80386-cwsdpmi-at-loaded-main-gate/",
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


def admit_inherited(role, raw, original, inherited):
    """Admit exact reviewed helper bytes or the unchanged inherited base."""
    if role in REVIEWED_OVERRIDES:
        if role not in inherited or hashlib.sha256(raw).hexdigest() != REVIEWED_OVERRIDES[role]:
            raise ValueError("reviewed helper override changed: " + role)
    elif raw != original:
        raise ValueError("inherited source changed: " + role)


def admit_helper(role, raw, reviewed, helper):
    if role not in helper or raw != reviewed:
        raise ValueError("reviewed owned-code helper changed: " + role)


def admit_helper_namespace(current, reviewed):
    if not reviewed or current != reviewed:
        raise ValueError("reviewed owned-code helper namespace changed")


def admit_role_provenance(role, raw, base_names, inherited, helper, base_raw):
    if role.startswith(NEW) or role == WORKFLOW or role in helper:
        return
    if role not in base_names:
        raise ValueError("unreviewed imported/source role: " + role)
    admit_inherited(role, raw, base_raw, inherited)


def require_overrides(names, inherited):
    if not set(REVIEWED_OVERRIDES) <= (names & inherited):
        raise ValueError("reviewed helper override role missing")


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
    helper = set(git("ls-tree", "-r", "--name-only", HELPER_HEAD, HELPER).decode().splitlines())
    admit_helper_namespace({name for name in names if name.startswith(HELPER)}, helper)
    require_overrides(names, inherited)
    current = {name for name in names if name.startswith(NEW)}
    if not inherited <= names or not helper or not helper <= names or \
       WORKFLOW not in names or not {
        NEW + "source.py", NEW + "source-control.py",
        NEW + "driver.mjs", NEW + "driver-control.mjs"
    } <= current:
        raise ValueError("inherited/new source role missing")
    roles = inherited | helper | current | {WORKFLOW}
    # Close every relative ESM edge reachable from the new driver/control,
    # including the real VGA class and AT CPU. Inherited unused roles remain
    # byte-authenticated separately; their comment examples are not imports.
    graph = walk_imports(
        (role for role in current if role.endswith((".mjs", ".js"))),
        names, lambda role: git("show", f"HEAD:{role}"))
    roles.update(graph)
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
        admit_role_provenance(role, raw, base_names, inherited, helper,
                              git("show", f"{BASE}:{role}") if role in base_names else None)
        if role in helper:
            admit_helper(role, raw, git("show", f"{HELPER_HEAD}:{role}"), helper)
        digest = hashlib.sha256(raw).hexdigest()
        if role in BIOS and (len(raw), digest) != BIOS[role]:
            raise ValueError("free ROM pin changed")
        hashes[role] = digest
    return {"schema": "bw.cwsdpmi-owned.at-completion-source.v1", "head": head,
            "inheritedBase": BASE, "reviewedHelperHead": HELPER_HEAD,
            "reviewedOverrides": REVIEWED_OVERRIDES,
            "roles": hashes,
            "recursiveImports": dict(sorted(graph.items()))}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")
