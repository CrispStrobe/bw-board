#!/usr/bin/env python3
"""CPU-free exact 64 MiB aggregate and retained header parser adversaries."""
import io
import importlib.util
import json
import os
from pathlib import Path
import tempfile

import build
import preflight
from header_budget import (HEADER_REPORT_LIMIT, HEADER_TOTAL_LIMIT,
                           within_header_budget, within_header_report)


assert HEADER_TOTAL_LIMIT == 67_108_864
assert preflight.MAX_HEADER_TOTAL == build.MAX_UNPACKED == HEADER_TOTAL_LIMIT
assert within_header_budget(32_000_000 + 109_792)
assert within_header_budget(HEADER_TOTAL_LIMIT)
assert not within_header_budget(HEADER_TOTAL_LIMIT + 1)
assert not within_header_budget(-1)
assert not within_header_budget(True)
assert preflight.MAX_MEMBERS == 20_000 and build.MAX_MEMBERS == 4096
assert preflight.HEADER_REPORT_LIMIT == build.HEADER_REPORT_LIMIT == \
    HEADER_REPORT_LIMIT == 1_048_576
assert within_header_report(b"x" * HEADER_REPORT_LIMIT)
assert not within_header_report(b"x" * (HEADER_REPORT_LIMIT + 1))
assert not within_header_report(bytearray(b"x"))


class Member:
    def __init__(self, name, size, kind="regular"):
        self.name, self.size, self.kind = name, size, kind

    def isfile(self): return self.kind == "regular"
    def isdir(self): return self.kind == "directory"


class Archive:
    def __init__(self, members): self.members = members
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def __iter__(self): return iter(self.members)
    def extractfile(self, member):
        return io.BytesIO(PAYLOAD[:member.size])


PAYLOAD = b"x" * 2_000_000
prefix = "node-v20.20.2/include/node/"
names = [prefix + "node.h", prefix + "v8-profiler.h"] + [
    prefix + f"synthetic-{i}.h" for i in range(31)]
first = [Member(name, 2_000_000) for name in names]
assert len(first) == 33
original_open = preflight.tarfile.open
try:
    def parse(members):
        preflight.tarfile.open = lambda **_kw: Archive(members)
        raw = b"synthetic archive identity only"
        return preflight.archive_records(raw, preflight.sha(raw), "headers")

    exact = parse(first + [Member(prefix + "at-limit.h", 1_108_864)])
    assert exact["totalMemberBytes"] == HEADER_TOTAL_LIMIT
    assert exact["memberCount"] == 34

    def refuse(members):
        try: parse(members)
        except ValueError: return
        raise AssertionError("malformed or over-budget headers accepted")

    refuse(first + [Member(prefix + "over-limit.h", 1_108_865)])
    refuse([Member(prefix + "node.h", 2_000_001)])
    refuse([Member(prefix + "node.h", 0, "link")])
    refuse([Member("node-v20.20.2/../escape", 0)])
    refuse([Member(prefix + "node.h", 0), Member(prefix + "node.h", 0)])
    refuse([Member(prefix + "node.h", 0)])  # required v8-profiler.h
finally:
    preflight.tarfile.open = original_open

inventory_path = Path(__file__).with_name("preflight-64m-inventory.py")
spec = importlib.util.spec_from_file_location("preflight_64m_inventory", inventory_path)
inventory_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory_module)
assert inventory_module.MAX_FILE == HEADER_REPORT_LIMIT
assert inventory_module.MAX_TOTAL == 2 * HEADER_REPORT_LIMIT
synthetic_members = {
    f"node-v20.20.2/include/node/archs/synthetic-platform-{i:04d}/include/node.h":
        {"bytes": 100, "sha256": "0" * 64}
    for i in range(2365)}
report = {"headersArchive": {"members": synthetic_members}}
encoded = json.dumps(report, sort_keys=True, separators=(",", ":")).encode()
assert 250_000 < len(encoded) < HEADER_REPORT_LIMIT
with tempfile.TemporaryDirectory(prefix="direct-v8-header-budget-pure-") as temp:
    root = Path(temp)
    preflight.write_receipt(root / "preflight.json", report)
    assert (root / "preflight.json").read_bytes() == encoded
    assert set(inventory_module.inventory(root)["files"]) == {"preflight.json"}
    padding = {"pad": "x" * (HEADER_REPORT_LIMIT - len(b'{"pad":""}'))}
    preflight.write_receipt(root / "preflight.json", padding)
    assert (root / "preflight.json").stat().st_size == HEADER_REPORT_LIMIT
    padding["pad"] += "x"
    try: preflight.write_receipt(root / "preflight.json", padding)
    except ValueError: pass
    else: raise AssertionError("oversized serialized receipt accepted")
    assert (root / "preflight.json").stat().st_size == HEADER_REPORT_LIMIT
    (root / "preflight.json").write_bytes(b"x" * (HEADER_REPORT_LIMIT + 1))
    try: inventory_module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("oversized artifact accepted")
    (root / "preflight.json").unlink()
    (root / "addon.node").write_bytes(b"binary")
    try: inventory_module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("binary artifact accepted")
    (root / "addon.node").unlink()
    (root / "run.stdout").symlink_to(inventory_path)
    try: inventory_module.inventory(root)
    except ValueError: pass
    else: raise AssertionError("symlink artifact accepted")
    (root / "run.stdout").unlink()
    (root / "run.stdout").write_bytes(b"ordinary")
    original_os_open = inventory_module.os.open
    replaced = False
    def swap_to_fifo(path, flags, *args, **kwargs):
        global replaced
        if Path(path).name == "run.stdout" and not replaced:
            replaced = True
            Path(path).unlink()
            os.mkfifo(path)
        return original_os_open(path, flags, *args, **kwargs)
    try:
        inventory_module.os.open = swap_to_fifo
        try: inventory_module.inventory(root)
        except ValueError: pass
        else: raise AssertionError("replacement FIFO accepted")
        assert replaced
    finally:
        inventory_module.os.open = original_os_open

print("direct V8 64 MiB header budget controls PASS")
