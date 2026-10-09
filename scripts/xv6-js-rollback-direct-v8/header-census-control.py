#!/usr/bin/env python3
"""CPU-free exact legacy predicate and data-only census adversaries."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile


def load(name):
    path = Path(__file__).with_name(name)
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


census = load("header-census.py")
inventory = load("header-census-inventory.py")


class Member:
    def __init__(self, name, size=0, kind="file"):
        self.name, self.size, self.kind = name, size, kind
    def isfile(self): return self.kind == "file"
    def isdir(self): return self.kind == "dir"


name = "node-v20.20.2/include/node/example.h"
assert census.LEGACY_TOTAL == 32_000_000 and census.LEGACY_MEMBER == 2_000_000
assert census.DATA_TOTAL == 128 * 1024 * 1024
assert census.legacy_predicate(0, Member(name, 1), 31_999_999, set()) is None
assert census.legacy_predicate(0, Member(name, 2), 31_999_999, set()) == \
    "regular-total-decimal-32000000"
assert census.legacy_predicate(0, Member(name, 2_000_001), 0, set()) == \
    "member-type-or-size"
assert census.legacy_predicate(0, Member(name, 0), 0, {name}) == \
    "duplicate-regular-raw-name"
assert census.legacy_predicate(0, Member("node-v20.20.2/../bad"), 0, set()) == \
    "member-path"
assert census.legacy_predicate(20_000, Member(name, 0), 0, set()) == "member-count"
assert census.legacy_predicate(0, Member(name, 0, "link"), 0, set()) == \
    "member-type-or-size"
assert census.legacy_predicate(0, Member(name, 0, "dir"), 0, set()) is None


def tar_xz(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:xz") as archive:
        for path, data in entries:
            member = tarfile.TarInfo(path)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    return out.getvalue()


def inspect(raw):
    before_sha, before_len = census.ARCHIVE_SHA, census.ARCHIVE_BYTES
    census.ARCHIVE_SHA, census.ARCHIVE_BYTES = census.sha(raw), len(raw)
    try:
        return census.census(raw)
    finally:
        census.ARCHIVE_SHA, census.ARCHIVE_BYTES = before_sha, before_len


ordinary = inspect(tar_xz([(name, b"first")]))
assert ordinary["status"] == "COMPLETE_DATA_ONLY" and \
    ordinary["firstLegacyRefusal"]["predicate"] == \
    "required-header-members-missing" and ordinary["regularBytes"] == 5
required = inspect(tar_xz([(path, b"x") for path in sorted(census.REQUIRED)]))
assert required["status"] == "COMPLETE_DATA_ONLY" and \
    required["firstLegacyRefusal"] is None
unicode_member = inspect(tar_xz([(name.replace("example", "exämple"), b"x")]))
assert unicode_member["status"] == "COMPLETE_DATA_ONLY" and \
    unicode_member["members"][0]["rawName"].endswith("exämple.h")
duplicate = inspect(tar_xz([(name, b"first"), (name, b"second")]))
assert duplicate["status"] == "COMPLETE_DATA_ONLY" and \
    duplicate["firstLegacyRefusal"]["predicate"] == \
    "duplicate-regular-raw-name" and duplicate["duplicateCount"] == 1
oversize = inspect(tar_xz([(name, b"x" * 2_000_001)]))
assert oversize["status"] == "PARTIAL_DATA_ONLY" and \
    oversize["firstLegacyRefusal"]["predicate"] == "member-type-or-size" and \
    oversize["firstFailure"] is not None
with tempfile.TemporaryDirectory(prefix="header-census-pure-") as root:
    root = Path(root)
    (root / "census-progress.json").write_text("{}")
    assert set(inventory.inventory(root)["files"]) == {"census-progress.json"}
    (root / "headers.tar.xz").write_bytes(b"forbidden")
    try: inventory.inventory(root)
    except ValueError: pass
    else: raise AssertionError("header archive artifact accepted")
    (root / "headers.tar.xz").unlink()
    (root / "census.json").symlink_to(root / "census-progress.json")
    try: inventory.inventory(root)
    except ValueError: pass
    else: raise AssertionError("symlink artifact accepted")
print("data-only header census controls PASS")
