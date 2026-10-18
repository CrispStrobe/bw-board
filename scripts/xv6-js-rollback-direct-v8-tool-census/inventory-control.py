#!/usr/bin/env python3
"""CPU-free closed report-only artifact inventory controls."""
import importlib.util
import os
from pathlib import Path
import tempfile

path = Path(__file__).with_name("inventory.py")
spec = importlib.util.spec_from_file_location("direct_v8_tool_census_inventory", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix="direct-v8-tool-census-inventory-") as temp:
    root = Path(temp)
    report = root / "tool-census.json"
    report.write_bytes(b"bounded report")
    accepted = module.inventory(root)
    assert accepted["files"][report.name]["bytes"] == len(b"bounded report")
    assert accepted["totalBytes"] == len(b"bounded report")

    foreign = root / "addon.node"
    foreign.write_bytes(b"binary")
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("binary artifact accepted")
    foreign.unlink()

    report.unlink()
    report.symlink_to(root / "source.json")
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("symlink report accepted")
    report.unlink()
    report.write_bytes(b"bounded report")

    original_open = module.os.open
    replaced = False
    def raced_fifo(target, flags, *args, **kwargs):
        global replaced
        if Path(target) == report and not replaced:
            replaced = True
            assert flags & os.O_NONBLOCK
            report.unlink()
            os.mkfifo(report)
        return original_open(target, flags, *args, **kwargs)
    module.os.open = raced_fifo
    try:
        try: module.inventory(root)
        except ValueError: pass
        else: raise AssertionError("raced FIFO artifact accepted")
        assert replaced
    finally:
        module.os.open = original_open
    report.unlink()
    report.write_bytes(b"bounded report")

    original_read = module.os.read
    replaced = False
    def raced_inode(fd, size):
        global replaced
        raw = original_read(fd, size)
        if not replaced:
            replaced = True
            report.unlink()
            report.write_bytes(b"bounded report")
        return raw
    module.os.read = raced_inode
    try:
        try: module.inventory(root)
        except ValueError: pass
        else: raise AssertionError("same-byte inode replacement accepted")
        assert replaced
    finally:
        module.os.read = original_read

print("direct V8 tool census inventory controls PASS")
