#!/usr/bin/env python3
"""Bounded AT completion source-admission controls; no machine or guest."""

import importlib.util
import hashlib
from pathlib import Path

module_path = Path(__file__).with_name("source.py")
spec = importlib.util.spec_from_file_location("completion_source", module_path)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

role = "scripts/i80386-cwsdpmi-at-completion/probe.mjs"
names = {role, "scripts/i80386-cwsdpmi-at-completion/real.mjs"}
raw = (b"// from './fake.mjs' is only a comment\n"
       b"import {x} from './real.mjs';\n"
       b"const documentation = \"from './also-fake.mjs'\";\n")
assert source.imported(role, raw, names) == {
    "scripts/i80386-cwsdpmi-at-completion/real.mjs"}
continued = b"import {\n x,\n} from './real.mjs';\n"
assert source.imported(role, continued, names) == {
    "scripts/i80386-cwsdpmi-at-completion/real.mjs"}
reviewed_form = (b"import {controlLayout as layout,controlMachine as machine,\n"
                 b"  controlTextAddress as textAddress} from\n"
                 b"  './real.mjs';\n")
assert source.imported(role, reviewed_form, names) == {
    "scripts/i80386-cwsdpmi-at-completion/real.mjs"}
assert source.imported(role, b"// " + reviewed_form + raw, names) == {
    "scripts/i80386-cwsdpmi-at-completion/real.mjs"}
for hostile in (b"import('./runtime.mjs');\n",
                b"import {x} from './unbound.mjs';\n",
                b"import {known as x,\n another as y} from\n './unbound.mjs';\n",
                b"import {x} from 'unbound-package';\n"):
    try:
        source.imported(role, hostile, names)
    except ValueError:
        pass
    else:
        raise AssertionError("unbound/dynamic import admitted")

tree = {
    role: b"import {x} from './real.mjs';\n",
    "scripts/i80386-cwsdpmi-at-completion/real.mjs":
        b"import {y} from './deep.mjs';\nimport fs from 'fs';\n",
    "scripts/i80386-cwsdpmi-at-completion/deep.mjs": b"export const y=1;\n",
}
graph = source.walk_imports([role], set(tree), lambda name: tree[name])
assert set(graph) == set(tree)  # real.mjs was already a known role

assert "scripts/i80386-cwsdpmi-owned/acquire.py" in source.INHERITED_EXACT
assert "scripts/i80386-cwsdpmi-at-owned-code/cut-control.mjs" in source.WORKFLOW_ESM_ROOTS
assert "roms/free-at-bios/BIOS-bochs-legacy" in source.BIOS
assert "roms/free-at-bios/vgabios-lgpl.bin" in source.BIOS

cut = "scripts/i80386-cwsdpmi-at-loaded-actual/cut.mjs"
cut_control = "scripts/i80386-cwsdpmi-at-loaded-actual/cut-control.mjs"
overrides = {cut, cut_control}
inherited = overrides | {"src/experimental/i80386.js"}
assert set(source.REVIEWED_OVERRIDES) == overrides
assert source.BASE == "eebec7259b4f6bc5c1ef35982d3affc4dc8c94d4"
assert source.HELPER_HEAD == "8673b496dbfac889aa6b8058da9d4b1c97b5f07b"
source.require_overrides(inherited, inherited)
for missing in overrides:
    try:
        source.require_overrides(inherited - {missing}, inherited)
    except ValueError:
        pass
    else:
        raise AssertionError("missing reviewed override admitted")
for override in overrides:
    original = source.git("show", f"{source.BASE}:{override}")
    actual = Path(override).read_bytes()
    assert hashlib.sha256(actual).hexdigest() == source.REVIEWED_OVERRIDES[override]
    source.admit_inherited(override, actual, original, inherited)
    try:
        source.admit_inherited(override, actual + b"\n", original, inherited)
    except ValueError:
        pass
    else:
        raise AssertionError("changed reviewed override admitted")
cpu = "src/experimental/i80386.js"
cpu_original = source.git("show", f"{source.BASE}:{cpu}")
source.admit_inherited(cpu, cpu_original, cpu_original, inherited)
try:
    source.admit_inherited(cpu, cpu_original + b"\n", cpu_original, inherited)
except ValueError:
    pass
else:
    raise AssertionError("changed CPU source admitted")
source.admit_role_provenance(cpu, cpu_original, {cpu}, inherited, set(), cpu_original)
for graph_role, graph_raw, base_roles in (
    ("src/experimental/unreviewed-runtime.js", b"export const x=1;", {cpu}),
    ("scripts/lib/new-runtime.mjs", b"export const x=1;", {cpu}),
    (cpu, cpu_original + b"\n", {cpu}),
):
    try:
        source.admit_role_provenance(graph_role, graph_raw, base_roles,
                                     inherited, set(), cpu_original)
    except ValueError:
        pass
    else:
        raise AssertionError("unreviewed/changed graph role admitted")
helper = "scripts/i80386-cwsdpmi-at-owned-code/cut.mjs"
held = source.git("show", f"{source.HELPER_HEAD}:{helper}")
assert held == Path(helper).read_bytes()
source.admit_helper_namespace({helper}, {helper})
for current in (set(), {helper, source.HELPER + "forged.mjs"}):
    try:
        source.admit_helper_namespace(current, {helper})
    except ValueError:
        pass
    else:
        raise AssertionError("missing/extra reviewed helper role admitted")
source.admit_helper(helper, held, held, {helper})
for role, raw in ((helper, held + b"\n"), ("scripts/not-reviewed.mjs", held)):
    try:
        source.admit_helper(role, raw, held, {helper})
    except ValueError:
        pass
    else:
        raise AssertionError("changed/missing reviewed helper admitted")
assert source.git("show", f"{source.BASE}:{cut}") != Path(cut).read_bytes()
print("CWSDPMI AT completion source controls PASS")
