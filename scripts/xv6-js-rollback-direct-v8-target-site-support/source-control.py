#!/usr/bin/env python3
"""CPU-free exact source-delta refusal controls for target-site support."""
import importlib.util
import os
from pathlib import Path
import tempfile

path = Path(__file__).with_name("source.py")
spec = importlib.util.spec_from_file_location("direct_v8_support_load_source", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module.BASE == "9367cfa9a8f6ffaaee2afaa59be4735e6b494aad"
assert len(module.HELD) == 74 and len(module.NEW) == 10
assert len(module.HELD | module.NEW) == 84
assert len(module.TARGET_FIXTURE) == 4
assert len(module.PREVIOUS_SUPPORT) == 10
held = (path.parent.parent / "xv6-js-rollback-direct-v8/addon.cc").read_bytes()
corrected = (path.parent.parent /
             "xv6-js-rollback-direct-v8-first-build-profiler-header/addon.cc").read_bytes()
module.validate_derivative(held, corrected)
for bad in (held, corrected.replace(b"#include <v8-profiler.h>\n", b"", 1),
            corrected + b"// unrelated change\n"):
    try: module.validate_derivative(held, bad)
    except ValueError: pass
    else: raise AssertionError("incorrect held addon derivative admitted")
accepted = sorted(module.NEW)
module.validate_changed(accepted)
for changed in (module.NEW | {"src/experimental/i80386.js"},
                module.NEW | {"scripts/xv6-js-rollback-direct-v8/addon.node"},
                accepted + [accepted[0]]):
    try: module.validate_changed(changed)
    except ValueError: pass
    else: raise AssertionError("unreviewed target-site-support source role accepted")

with tempfile.TemporaryDirectory(prefix="direct-v8-support-source-pure-") as temp:
    root = Path(temp)
    role = "role.py"
    path = root / role
    path.write_bytes(b"owned")
    original_git = module.git
    original_open = module.os.open
    original_read = module.os.read
    try:
        module.git = lambda *_args: b"owned"
        assert module.committed_and_live(root, "synthetic", role) == b"owned"
        swapped = False
        def swap_to_fifo(target, flags, *args, **kwargs):
            global swapped
            if Path(target) == path and not swapped:
                swapped = True
                assert flags & os.O_NONBLOCK
                path.unlink()
                os.mkfifo(path)
            return original_open(target, flags, *args, **kwargs)
        module.os.open = swap_to_fifo
        try: module.committed_and_live(root, "synthetic", role)
        except ValueError: pass
        else: raise AssertionError("replacement FIFO source role accepted")
        assert swapped
        module.os.open = original_open
        path.unlink()
        path.write_bytes(b"owned")
        replaced_after_read = False
        def replace_after_read(fd, length):
            global replaced_after_read
            raw = original_read(fd, length)
            if not replaced_after_read:
                replaced_after_read = True
                path.unlink()
                path.write_bytes(b"owned")
            return raw
        module.os.read = replace_after_read
        try: module.committed_and_live(root, "synthetic", role)
        except ValueError: pass
        else: raise AssertionError("same-byte source inode replacement accepted")
        assert replaced_after_read
    finally:
        module.git = original_git
        module.os.open = original_open
        module.os.read = original_read
print("direct V8 target-site-support source controls PASS")
