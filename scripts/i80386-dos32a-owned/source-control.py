#!/usr/bin/env python3
"""After the source checkpoint is committed, reject a wrong head and omissions."""

from __future__ import annotations

from source import EXACT, EXPECTED_BASE, PREFIXES, git, inventory

head = git("rev-parse", "HEAD").decode().strip()
closure = inventory(head)
assert closure["head"] == head
assert EXACT.issubset(closure["files"])
assert set(EXPECTED_BASE).issubset(closure["files"])
assert all(name.startswith(PREFIXES) or name in EXACT for name in closure["files"])
assert "scripts/i80386-dos32a-owned/source-control.py" in closure["files"]
for bad in ("0" * 40, head[:-1] + ("0" if head[-1] != "0" else "1")):
    try:
        inventory(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("accepted a wrong source head")
print("PASS exact committed source closure and wrong-head denial")
