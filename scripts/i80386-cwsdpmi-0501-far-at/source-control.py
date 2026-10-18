#!/usr/bin/env python3
"""CPU-free source-admission adversaries for the distinct task-mode gate."""
import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("far_at_source", Path(__file__).with_name("source.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
assert source.HELD_BASE == "f2fb33f921bf99b23d1e88ee889512d5d4ee6318"
assert source.BASE == "6191a70650142ea46552c2d417eb7eb62aa08e38"
assert source.NEW == "scripts/i80386-cwsdpmi-0501-far-at/"
assert source.WORKFLOW == ".github/workflows/i80386-cwsdpmi-0501-far-at.yml"
assert len(source.REQUIRED_CURRENT) == 7
assert source.CPU_SHA == "2ec94677c07f9135eb98a79b31a62f9fe89e50ffd85fcc617a99e74bacf1e3ff"
assert source.JOURNAL_TEST_SHA == "3b6b2bd825d431162708b693de4d9e09c358b212587e3e781a35f5f03b42d80d"
assert source.PINNED_CHANGED == {"src/experimental/i80386.js": source.CPU_SHA,
                                 source.JOURNAL_TEST: source.JOURNAL_TEST_SHA,
                                 "scripts/i80386-cwsdpmi-0501-far-attribution/README.md":
                                 "e1a674007b77ac935ff66113e86ed4ff6d2909f8ac00a74f4f3ef9475f5e7fd2"}
assert "scripts/i80386-cwsdpmi-0501-task-excursion/" in source.INHERITED_PREFIXES
assert "scripts/i80386-cwsdpmi-0501-task-mode/README.md" in source.INHERITED_EXACT
assert "scripts/i80386-cwsdpmi-0501-task-mode-at/orchestration-control.mjs" in source.WORKFLOW_ESM_ROOTS
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
           if changed != "scripts/i80386-cwsdpmi-0501-far-attribution/README.md" else b"")
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
print("CWSDPMI far-at source controls PASS")
