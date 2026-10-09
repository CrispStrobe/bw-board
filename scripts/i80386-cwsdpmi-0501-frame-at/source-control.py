#!/usr/bin/env python3
"""Pure source-admission controls; no toolchain, emulator or guest."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("frame_at_source", Path(__file__).with_name("source.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
role = source.NEW + "probe.mjs"
real = source.NEW + "real.mjs"
deep = source.NEW + "deep.mjs"
names = {role, real, deep}
assert source.HISTORICAL_BASE == "8b82bde41f2fffff07279834a333a47bcd8f5a7f"
assert source.BASE == "0714159c9875ac17bf5ef5a8e5418f5815fa1608"
assert source.WORKFLOW == ".github/workflows/i80386-cwsdpmi-0501-frame-at.yml"
assert source.CPU_SHA == "1474e5e2f270ef63cdde815a54bb60cb0393ca0ab3b9f9578de51950dc333e42"
assert source.JOURNAL_TEST_SHA == "5032c2f3a4cd9c2d82fcf53bc83e008095a3e779502c391eab3c620b78d14a73"
assert source.POLICY_TEST_SHA == "d831c85f609b07f6679a9fc9f93fd00afcd66aa783f94ab55154f7d0b475b4c6"
assert source.ORCHESTRATION_TEST_SHA == "9c0c680932c2bfeb07ce490ab40d9283b73677e49744011f5776e2fa98affe3b"
assert source.POLICY_TEST in source.INHERITED_EXACT
assert source.ORCHESTRATION_TEST in source.PINNED_CHANGED
assert "scripts/i80386-cwsdpmi-highmem-at/" in source.INHERITED_PREFIXES
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
reviewed = source.git("show", f"HEAD:{cpu}")
source.admit_role_provenance(cpu, reviewed, {cpu}, original)
source.admit_role_provenance(source.JOURNAL_TEST,
                             source.git("show", f"HEAD:{source.JOURNAL_TEST}"),
                             {source.JOURNAL_TEST},
                             source.git("show", f"{source.BASE}:{source.JOURNAL_TEST}"))
for changed_test in (source.POLICY_TEST, source.ORCHESTRATION_TEST):
    source.admit_role_provenance(changed_test,
                                 source.git("show", f"HEAD:{changed_test}"),
                                 {changed_test},
                                 source.git("show", f"{source.BASE}:{changed_test}"))
for bad_role, bad_raw, base_names in (
    (cpu, reviewed + b"\n", {cpu}),
    (source.JOURNAL_TEST, source.git("show", f"HEAD:{source.JOURNAL_TEST}") + b"\n",
     {source.JOURNAL_TEST}),
    ("src/experimental/extra.js", original, {cpu}),
    ("scripts/lib/extra.mjs", original, {cpu}),
    (source.POLICY_TEST, source.git("show", f"HEAD:{source.POLICY_TEST}") + b"\n",
     {source.POLICY_TEST}),
):
    try:
        source.admit_role_provenance(bad_role, bad_raw, base_names, original)
    except ValueError:
        pass
    else:
        raise AssertionError("unreviewed inherited or new external role admitted")
for changed in (".github/workflows/ci.yml",
                "test/unreviewed-frame.test.mjs", "scripts/lib/unreviewed.mjs"):
    assert not (changed.startswith(source.NEW) or
                changed in (source.WORKFLOW, source.ORCHESTRATION_TEST) or
                changed in source.PINNED_CHANGED)
assert all(changed.startswith(source.NEW) or
           changed in (source.WORKFLOW, source.ORCHESTRATION_TEST) or
           changed in source.PINNED_CHANGED for changed in
           (source.NEW + "adapter.mjs", source.WORKFLOW,
            source.ORCHESTRATION_TEST, cpu, source.JOURNAL_TEST))
print("CWSDPMI owned 0501 AT frame source controls PASS")
