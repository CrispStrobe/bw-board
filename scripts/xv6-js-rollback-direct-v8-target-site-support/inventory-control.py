#!/usr/bin/env python3
"""CPU-free artifact role, symlink, FIFO and race controls."""
import importlib.util
import os
from pathlib import Path
import tempfile

path = Path(__file__).with_name("inventory.py")
spec = importlib.util.spec_from_file_location("direct_v8_support_inventory", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix="direct-v8-support-inventory-pure-") as name:
    root = Path(name)
    report = root / "target-site-support.json"
    report.write_bytes(b"bounded report")
    child = root / "minor-baseline"
    child.mkdir()
    (child / "pre.json").write_bytes(b"{}")
    result = module.inventory(root)
    assert result["files"]["minor-baseline/pre.json"]["bytes"] == 2
    forbidden = root / "rollback_sampler.node"
    forbidden.write_bytes(b"binary")
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("addon binary artifact admitted")
    forbidden.unlink()
    forbidden = child / "node"
    forbidden.write_bytes(b"binary")
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("nested Node binary artifact admitted")
    forbidden.unlink()
    report.unlink()
    report.symlink_to(child / "pre.json")
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("symlink report admitted")
    report.unlink()
    report.write_bytes(b"bounded report")
    original_open = module.os.open
    swapped = False
    def swap_fifo(target, flags, *args, **kwargs):
        global swapped
        if Path(target) == report and not swapped:
            swapped = True
            assert flags & os.O_NONBLOCK
            report.unlink()
            os.mkfifo(report)
        return original_open(target, flags, *args, **kwargs)
    module.os.open = swap_fifo
    try:
        try: module.inventory(root)
        except ValueError: pass
        else: raise AssertionError("raced FIFO admitted")
        assert swapped
    finally:
        module.os.open = original_open
    report.unlink()
    report.write_bytes(b"bounded report")
    original_read = module.os.read
    swapped = False
    report_inode = report.stat().st_ino
    def replace_inode(fd, size):
        global swapped
        raw = original_read(fd, size)
        if not swapped and module.os.fstat(fd).st_ino == report_inode:
            swapped = True
            report.unlink()
            report.write_bytes(b"bounded report")
        return raw
    module.os.read = replace_inode
    try:
        try: module.inventory(root)
        except ValueError: pass
        else: raise AssertionError("same-byte inode replacement admitted")
        assert swapped
    finally:
        module.os.read = original_read
print("direct V8 target-site-support inventory controls PASS")
