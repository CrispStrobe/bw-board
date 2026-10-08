#!/usr/bin/env python3
"""Pure source-admission controls; no toolchain, emulator or guest."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("highmem_at_source", Path(__file__).with_name("source.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
role = source.NEW + "probe.mjs"
real = source.NEW + "real.mjs"
deep = source.NEW + "deep.mjs"
names = {role, real, deep}
assert source.BASE == "6ec767b50008beb53b012dafcf55361de3ffb146"
assert source.WORKFLOW == ".github/workflows/i80386-cwsdpmi-highmem-at.yml"
assert "scripts/i80386-cwsdpmi-owned/acquire.py" in source.INHERITED_EXACT
assert "scripts/i80386-cwsdpmi-highmem-timer/" in source.INHERITED_PREFIXES
assert "roms/free-at-bios/BIOS-bochs-legacy" in source.BIOS
assert "roms/free-at-bios/vgabios-lgpl.bin" in source.BIOS
raw = b"// from './false.mjs'\nimport {\n  x,\n} from\n './real.mjs';\n"
assert source.imported(role, raw, names) == {real}
for hostile in (b"import('./evil.mjs')", b"import x from 'evil-package';",
                b"import {x} from './not-present.mjs';"):
    try:
        source.imported(role, hostile, names)
    except ValueError:
        pass
    else:
        raise AssertionError("unreviewed import admitted")
tree = {role: b"import {x} from './real.mjs';",
        real: b"import {y} from './deep.mjs';",
        deep: b"export const y=1;"}
assert set(source.walk_imports([role], names, lambda name: tree[name])) == names
cpu = "src/experimental/i80386.js"
original = source.git("show", f"{source.BASE}:{cpu}")
source.admit_role_provenance(cpu, original, {cpu}, original)
for bad_role, bad_raw, base_names in (
    (cpu, original + b"\n", {cpu}),
    ("src/experimental/extra.js", original, {cpu}),
    ("scripts/lib/extra.mjs", original, {cpu}),
):
    try:
        source.admit_role_provenance(bad_role, bad_raw, base_names, original)
    except ValueError:
        pass
    else:
        raise AssertionError("unreviewed inherited or new external role admitted")
print("CWSDPMI high-memory AT source controls PASS")
