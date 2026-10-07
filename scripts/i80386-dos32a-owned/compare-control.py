#!/usr/bin/env python3
"""Model distinct guest outcomes and reject false cross-emulator matches."""

from __future__ import annotations

import copy
import hashlib

from compare import compare

files = {role: {"bytes": len(role), "sha256": hashlib.sha256(role.encode("latin1")).hexdigest(),
                "text": role} for role in ("output", "ok", "returned")}
files["fail"] = None
target = {"schema": "bw.dos32a-owned-le.target.v1", "passed": True,
          "disk": {"initialSha256": "disk"}, "inputHashes": {"floppy": "floppy"},
          "scope": "target compatibility 386-class", "guestFiles": files}
oracle = {"schema": "bw.dos32a-owned-le.qemu-oracle.v1", "passed": True,
          "initialDiskSha256": "disk", "floppySha256": "floppy", "profile": "QEMU 486",
          "guestFiles": copy.deepcopy(files)}
assert compare(target, oracle)["passed"]
for side, path, value in (
    ("target", ("passed",), False), ("oracle", ("passed",), False),
    ("target", ("passed",), "yes"), ("oracle", ("passed",), 1),
    ("target", ("disk", "initialSha256"), "other"),
    ("oracle", ("floppySha256",), "other"),
    ("oracle", ("guestFiles", "output", "sha256"), "other"),
    ("target", ("guestFiles", "ok"), None),
    ("target", ("guestFiles", "ok", "bytes"), True),
    ("target", ("guestFiles", "ok", "sha256"), "0" * 64),
    ("target", ("guestFiles", "ok", "text"), "\u0100"),
    ("oracle", ("guestFiles", "returned", "text"), "other"),
    ("target", ("guestFiles", "fail"), {"text": "fail"}),
):
    left, right = copy.deepcopy(target), copy.deepcopy(oracle)
    cursor = left if side == "target" else right
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value
    try:
        compare(left, right)
    except ValueError:
        pass
    else:
        raise AssertionError(f"accepted malformed {side} {path}")
print("PASS source/guest bindings and distinct target/QEMU outcome adversaries")
