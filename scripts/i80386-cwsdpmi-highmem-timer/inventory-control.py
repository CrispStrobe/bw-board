#!/usr/bin/env python3
"""Report-only artifact controls; no toolchain, archive or guest bytes are used."""

import hashlib
import json
import os
import tempfile
from pathlib import Path

import inventory as gate


def refuses(action, fragment):
    try:
        action()
    except ValueError as error:
        assert fragment in str(error), (fragment, str(error))
    else:
        raise AssertionError("artifact admitted: " + fragment)


def folder():
    return tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR"))


assert gate.role_allowed(gate.NOTICE)
assert not gate.role_allowed("COPYING.CWS")
assert not gate.role_allowed("other/COPYING.CWS")
assert not gate.role_allowed("client.exe")
assert not gate.role_allowed("libc.a")

with folder() as temp:
    root = Path(temp)
    (root / "package").mkdir()
    notice = b"synthetic notice; not a package byte"
    (root / gate.NOTICE).write_bytes(notice)
    (root / "source-before.json").write_text("{}\n")
    pin = (len(notice), hashlib.sha256(notice).hexdigest())
    receipt = gate.inventory(root, notice_pin=pin)
    assert receipt["files"][gate.NOTICE] == {"bytes": len(notice), "sha256": pin[1]}
    assert json.loads((root / "artifact-inventory.json").read_bytes()) == receipt
    refuses(lambda: gate.inventory(root, notice_pin=pin), "stale artifact inventory")

with folder() as temp:
    root = Path(temp)
    (root / "package").mkdir()
    (root / gate.NOTICE).write_bytes(b"wrong original notice")
    refuses(lambda: gate.inventory(root), "CWSDPMI notice bytes")

with folder() as temp:
    root = Path(temp)
    (root / "client.exe").write_bytes(b"MZ")
    refuses(lambda: gate.inventory(root), "non-report artifact role")

with folder() as temp:
    root = Path(temp)
    with (root / "fake.json").open("wb") as stream:
        stream.truncate(gate.MAX_FILE + 1)
    refuses(lambda: gate.inventory(root), "oversized artifact role")

with folder() as temp:
    root = Path(temp)
    (root / "notice.txt").write_bytes(b"small")
    (root / "alias.json").symlink_to(root / "notice.txt")
    refuses(lambda: gate.inventory(root), "artifact symlink")

with folder() as temp:
    root = Path(temp)
    os.mkfifo(root / "pipe.json")
    refuses(lambda: gate.inventory(root), "nonordinary artifact role")

print("high-memory/timer report inventory controls PASS")
