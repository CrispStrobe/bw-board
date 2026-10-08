#!/usr/bin/env python3
"""Bounded controls for literal source-import admission; no machine or guest."""

import importlib.util
import hashlib
from pathlib import Path

module_path = Path(__file__).with_name("source.py")
spec = importlib.util.spec_from_file_location("loaded_main_source", module_path)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

role = "scripts/i80386-cwsdpmi-at-loaded-main-gate/probe.mjs"
names = {role, "scripts/i80386-cwsdpmi-at-loaded-main-gate/real.mjs"}
raw = (b"// from './fake.mjs' is only a comment\n"
       b"import {x} from './real.mjs';\n"
       b"const documentation = \"from './also-fake.mjs'\";\n")
assert source.imported(role, raw, names) == {
    "scripts/i80386-cwsdpmi-at-loaded-main-gate/real.mjs"}
continued = b"import {\n x,\n} from './real.mjs';\n"
assert source.imported(role, continued, names) == {
    "scripts/i80386-cwsdpmi-at-loaded-main-gate/real.mjs"}
for hostile in (b"import('./runtime.mjs');\n",
                b"import {x} from './unbound.mjs';\n",
                b"import {x} from 'unbound-package';\n"):
    try:
        source.imported(role, hostile, names)
    except ValueError:
        pass
    else:
        raise AssertionError("unbound/dynamic import admitted")

tree = {
    role: b"import {x} from './real.mjs';\n",
    "scripts/i80386-cwsdpmi-at-loaded-main-gate/real.mjs":
        b"import {y} from './deep.mjs';\nimport fs from 'fs';\n",
    "scripts/i80386-cwsdpmi-at-loaded-main-gate/deep.mjs": b"export const y=1;\n",
}
graph = source.walk_imports([role], set(tree), lambda name: tree[name])
assert set(graph) == set(tree)  # real.mjs was already a known role

assert "scripts/i80386-cwsdpmi-owned/acquire.py" in source.INHERITED_EXACT
assert "roms/free-at-bios/BIOS-bochs-legacy" in source.BIOS
assert "roms/free-at-bios/vgabios-lgpl.bin" in source.BIOS

reader = "scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs"
reader_control = "scripts/i80386-cwsdpmi-at-loaded/passive-ram-control.mjs"
inherited = {reader, reader_control, "src/experimental/i80386.js"}
assert set(source.REVIEWED_OVERRIDES) == {reader, reader_control}
source.require_overrides(inherited, inherited)
for missing in (reader, reader_control):
    try:
        source.require_overrides(inherited - {missing}, inherited)
    except ValueError:
        pass
    else:
        raise AssertionError("missing reviewed override admitted")
for override in (reader, reader_control):
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
print("CWSDPMI AT loaded-main source controls PASS")
