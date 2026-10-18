#!/usr/bin/env python3
"""CPU-free exact source-delta refusal controls for the tool roster."""
import importlib.util
import os
from pathlib import Path
import tempfile

path = Path(__file__).with_name("source.py")
spec = importlib.util.spec_from_file_location("direct_v8_tool_roster_source", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module.BASE == "8ffca01b8ca675fcd2a3980ffd0697665b080771"
assert len(module.HELD) == 34 and len(module.NEW) == 8
assert len(module.HELD | module.NEW) == 42
accepted = sorted(module.NEW)
module.validate_changed(accepted)
for changed in (module.NEW | {"src/experimental/i80386.js"},
                module.NEW | {"scripts/xv6-js-rollback-direct-v8/addon.node"},
                accepted + [accepted[0]]):
    try: module.validate_changed(changed)
    except ValueError: pass
    else: raise AssertionError("unreviewed tool roster source role accepted")

with tempfile.TemporaryDirectory(prefix="direct-v8-tool-roster-source-pure-") as temp:
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
print("direct V8 tool roster source controls PASS")
