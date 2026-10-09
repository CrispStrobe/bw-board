#!/usr/bin/env python3
"""CPU-free source-admission adversaries for the distinct task-mode gate."""
import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("task_mode_source", Path(__file__).with_name("source.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
assert source.HELD_BASE == "89eadb8c2449ff769b157ee6a4b78ccb833c3610"
assert source.BASE == "44087e8f1d19b1f74c6f2742ebca31594f6e7208"
assert source.NEW == "scripts/i80386-cwsdpmi-0501-task-mode-at/"
assert source.WORKFLOW == ".github/workflows/i80386-cwsdpmi-0501-task-mode.yml"
assert len(source.REQUIRED_CURRENT) == 9
assert source.CPU_SHA == "d1c30feca2f477c5fc46e8c87b27855809eda25adff90ae2922fccc3e5e601f4"
assert source.JOURNAL_TEST_SHA == "360dd0b5d3a2fb8f8d58d043ea33454fb5122e91f12f8c48ee138066c78e8d64"
assert source.PINNED_CHANGED == {"src/experimental/i80386.js": source.CPU_SHA,
                                 source.JOURNAL_TEST: source.JOURNAL_TEST_SHA}
assert "scripts/i80386-cwsdpmi-0501-task-excursion/" in source.INHERITED_PREFIXES
assert "scripts/i80386-cwsdpmi-0501-task-mode/README.md" in source.INHERITED_EXACT
assert source.NEW + "orchestration-control.mjs" in source.WORKFLOW_ESM_ROOTS
assert set(source.git("diff", "--name-only", source.HELD_BASE, source.BASE).decode().splitlines()) == \
    set(source.PINNED_CHANGED) | {"scripts/i80386-cwsdpmi-0501-task-mode/README.md"}

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

for held in (source.POLICY_TEST, source.ORCHESTRATION_TEST,
             "scripts/i80386-cwsdpmi-0501-task-excursion/adapter.mjs"):
    original = source.git("show", f"{source.HELD_BASE}:{held}")
    source.admit_role_provenance(held, original, {held}, original)
    try: source.admit_role_provenance(held, original+b"\n", {held}, original)
    except ValueError: pass
    else: raise AssertionError("held role changed")
for changed in ("src/experimental/i80386.js", source.JOURNAL_TEST):
    reviewed = source.git("show", f"{source.BASE}:{changed}")
    old = source.git("show", f"{source.HELD_BASE}:{changed}")
    assert reviewed != old
    source.admit_role_provenance(changed, reviewed, {changed}, old)
    try: source.admit_role_provenance(changed, reviewed+b"\n", {changed}, old)
    except ValueError: pass
    else: raise AssertionError("reviewed override changed")
for hostile in (".github/workflows/ci.yml", "scripts/lib/extra.mjs",
                "test/unreviewed-task.test.mjs"):
    assert not (hostile in source.REQUIRED_CURRENT or hostile == source.WORKFLOW or
                hostile in source.PINNED_CHANGED)

with TemporaryDirectory(prefix="task-mode-source-control-") as tmp:
    path = Path(tmp) / "source.mjs"
    path.write_bytes(b"owned immutable input\n")
    assert source.live_role(str(path)) == b"owned immutable input\n"
    alias = Path(tmp) / "alias.mjs"
    alias.symlink_to(path)
    try: source.live_role(str(alias))
    except ValueError: pass
    else: raise AssertionError("source symlink accepted")
    replacement = Path(tmp) / "replacement.mjs"
    replacement.write_bytes(b"different immutable input\n")
    original_open = os.open
    def swap_on_open(name, flags, *args, **kwargs):
        path.unlink()
        replacement.rename(path)
        return original_open(name, flags, *args, **kwargs)
    with patch.object(source.os, "open", side_effect=swap_on_open):
        try: source.live_role(str(path))
        except ValueError: pass
        else: raise AssertionError("source role swap accepted")
print("CWSDPMI task-mode source controls PASS")
