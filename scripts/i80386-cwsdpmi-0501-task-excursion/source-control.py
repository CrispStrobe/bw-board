#!/usr/bin/env python3
"""CPU-free source-admission adversaries for the separate task gate."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("task_source", Path(__file__).with_name("source.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
assert source.BASE == "d1ca2763ce30dc91df0c29e888590ab1d8135256"
assert source.NEW == "scripts/i80386-cwsdpmi-0501-task-excursion/"
assert source.WORKFLOW == ".github/workflows/i80386-cwsdpmi-0501-task-excursion.yml"
assert source.CPU_SHA == "9c7ca346a56d838d49d3cf67ace58cce286cf6bb87ea611f13a7db0130817e37"
assert source.JOURNAL_TEST_SHA == "757315c13ee5bbf1ff2443671a67ae874d2598c24dae61b92ab51f085a3c442d"
assert source.PINNED_CHANGED == {"src/experimental/i80386.js":source.CPU_SHA,
                                 source.JOURNAL_TEST: source.JOURNAL_TEST_SHA}
assert "scripts/i80386-cwsdpmi-0501-frame-at/" in source.INHERITED_PREFIXES
assert "scripts/i80386-cwsdpmi-owned/acquire.py" in source.INHERITED_EXACT
assert source.NEW + "orchestration-control.mjs" in source.WORKFLOW_ESM_ROOTS

role = source.NEW + "probe.mjs"
real = source.NEW + "real.mjs"
deep = source.NEW + "deep.mjs"
names = {role, real, deep}
raw = b"// from './false.mjs'\nimport {\n  x,\n} from\n './real.mjs';\n"
assert source.imported(role, raw, names) == {real}
for hostile in (b"import('./evil.mjs')", b"import x from 'evil-package';",
                b"import {x} from './not-present.mjs';"):
    try: source.imported(role, hostile, names)
    except ValueError: pass
    else: raise AssertionError("unreviewed import admitted")
tree = {role: b"import {x} from './real.mjs';",
        real: b"import {y} from './deep.mjs';",
        deep: b"export const y=1;"}
assert set(source.walk_imports([role], names, lambda name: tree[name])) == names

cpu = "src/experimental/i80386.js"
for held in (source.POLICY_TEST, source.ORCHESTRATION_TEST):
    original = source.git("show", f"{source.BASE}:{held}")
    source.admit_role_provenance(held, original, {held}, original)
    try: source.admit_role_provenance(held, original+b"\n", {held}, original)
    except ValueError: pass
    else: raise AssertionError("inherited role changed")
for changed in (cpu,source.JOURNAL_TEST):
    reviewed = Path(changed).read_bytes()
    original = source.git("show", f"{source.BASE}:{changed}")
    source.admit_role_provenance(changed, reviewed, {changed}, original)
    try: source.admit_role_provenance(changed, reviewed+b"\n", {changed}, original)
    except ValueError: pass
    else: raise AssertionError("reviewed role changed")
for hostile in (".github/workflows/ci.yml", "scripts/lib/extra.mjs",
                "test/unreviewed-task.test.mjs"):
    assert not (hostile.startswith(source.NEW) or hostile == source.WORKFLOW or
                hostile in source.PINNED_CHANGED)
print("CWSDPMI bounded task source controls PASS")
