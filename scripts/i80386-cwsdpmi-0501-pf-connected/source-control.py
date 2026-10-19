#!/usr/bin/env python3
"""CPU-free source-admission adversaries for the distinct task-mode gate."""
import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("pf_connected_source", Path(__file__).with_name("source.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
assert source.HELD_BASE == "72d0b32e8bd7d658447745129119e2300ad6bec1"
assert source.BASE == "33d53542aa4375f9eb4c3c508ecf9bc8b1bba0d9"
assert source.NEW == "scripts/i80386-cwsdpmi-0501-pf-connected/"
assert source.WORKFLOW == ".github/workflows/i80386-cwsdpmi-0501-pf-connected.yml"
assert len(source.REQUIRED_CURRENT) == 11
assert source.CPU_SHA == "d927f4b90efaf14aeaa5bea7ed94897157203ce496e434b569aecb85e0d865c2"
assert source.PF_TEST_SHA == "1f569a851d399cee08e393d4419aff1aab4c864e9b19666c4ebd45294649fcea"
assert source.PINNED_CHANGED == {
    "src/experimental/i80386.js": source.CPU_SHA,
    "test/i80386-0501-fault-outcome.test.mjs": source.PF_TEST_SHA,
    "scripts/i80386-cwsdpmi-0501-pf-outcome/README.md":
        "5316d82b1f30883305278ab4d34096066f80e5dfa066a141ab0f6447e463e2a2",
}
assert "scripts/i80386-cwsdpmi-0501-task-excursion/" in source.INHERITED_PREFIXES
assert "scripts/i80386-cwsdpmi-0501-task-mode/README.md" in source.INHERITED_EXACT
assert "scripts/i80386-cwsdpmi-0501-pf-connected/orchestration-control.mjs" in source.WORKFLOW_ESM_ROOTS
assert "scripts/i80386-cwsdpmi-0501-pf-connected/adapter.mjs" in source.WORKFLOW_ESM_ROOTS
assert set(source.git("diff", "--name-only", source.HELD_BASE, source.BASE).decode().splitlines()) == \
    set(source.PINNED_CHANGED)

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
for changed in source.PINNED_CHANGED:
    reviewed = source.git("show", f"{source.BASE}:{changed}")
    old = (source.git("show", f"{source.HELD_BASE}:{changed}")
           if changed == "src/experimental/i80386.js" else b"")
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
    replacement.write_bytes(b"owned immutable input\n")
    original_open = os.open
    def swap_on_open(name, flags, *args, **kwargs):
        path.unlink()
        replacement.rename(path)
        return original_open(name, flags, *args, **kwargs)
    with patch.object(source.os, "open", side_effect=swap_on_open):
        try: source.live_role(str(path))
        except ValueError: pass
        else: raise AssertionError("same-byte source inode swap accepted")
    replacement2 = Path(tmp) / "replacement2.mjs"
    replacement2.write_bytes(b"owned immutable input\n")
    original_fstat = os.fstat
    def swap_after_read(fd):
        nonlocal_calls[0] += 1
        result = original_fstat(fd)
        if nonlocal_calls[0] == 2:
            path.unlink()
            replacement2.rename(path)
        return result
    nonlocal_calls = [0]
    with patch.object(source.os, "fstat", side_effect=swap_after_read):
        try: source.live_role(str(path))
        except ValueError: pass
        else: raise AssertionError("same-byte post-read source path swap accepted")
    original_open = os.open
    def fifo_on_open(name, flags, *args, **kwargs):
        path.unlink()
        os.mkfifo(path)
        return original_open(name, flags, *args, **kwargs)
    with patch.object(source.os, "open", side_effect=fifo_on_open):
        try: source.live_role(str(path))
        except ValueError: pass
        else: raise AssertionError("raced source FIFO accepted")
    path.unlink()
    path.write_bytes(b"owned immutable input\n")
    target = Path(tmp) / "target.mjs"
    target.write_bytes(path.read_bytes())
    def symlink_on_open(name, flags, *args, **kwargs):
        path.unlink()
        path.symlink_to(target)
        return original_open(name, flags, *args, **kwargs)
    with patch.object(source.os, "open", side_effect=symlink_on_open):
        try: source.live_role(str(path))
        except (ValueError, OSError): pass
        else: raise AssertionError("raced source symlink accepted")
print("CWSDPMI PF-connected source controls PASS")
