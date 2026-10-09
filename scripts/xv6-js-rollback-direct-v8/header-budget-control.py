#!/usr/bin/env python3
"""CPU-free exact 64 MiB aggregate and retained header parser adversaries."""
import io

import build
import preflight
from header_budget import HEADER_TOTAL_LIMIT, within_header_budget


assert HEADER_TOTAL_LIMIT == 67_108_864
assert preflight.MAX_HEADER_TOTAL == build.MAX_UNPACKED == HEADER_TOTAL_LIMIT
assert within_header_budget(32_000_000 + 109_792)
assert within_header_budget(HEADER_TOTAL_LIMIT)
assert not within_header_budget(HEADER_TOTAL_LIMIT + 1)
assert not within_header_budget(-1)
assert not within_header_budget(True)
assert preflight.MAX_MEMBERS == 20_000 and build.MAX_MEMBERS == 4096


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

print("direct V8 64 MiB header budget controls PASS")
