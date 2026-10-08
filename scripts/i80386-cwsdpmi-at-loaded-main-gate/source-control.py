#!/usr/bin/env python3
"""Bounded controls for literal source-import admission; no machine or guest."""

import importlib.util
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
for hostile in (b"import('./runtime.mjs');\n",
                b"import {x} from './unbound.mjs';\n",
                b"import {x} from 'unbound-package';\n"):
    try:
        source.imported(role, hostile, names)
    except ValueError:
        pass
    else:
        raise AssertionError("unbound/dynamic import admitted")

assert "scripts/i80386-cwsdpmi-owned/acquire.py" in source.INHERITED_EXACT
assert "roms/free-at-bios/BIOS-bochs-legacy" in source.BIOS
assert "roms/free-at-bios/vgabios-lgpl.bin" in source.BIOS
print("CWSDPMI AT loaded-main source controls PASS")
