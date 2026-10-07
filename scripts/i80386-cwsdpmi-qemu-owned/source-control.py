#!/usr/bin/env python3
"""Prove the dynamically imported archive reader is in the admitted source closure."""

import hashlib
from pathlib import Path
from unittest.mock import patch

import source


ROLE = "scripts/i80386-cwsdpmi-owned/acquire.py"


def main():
    head = source.git("rev-parse", "HEAD").decode().strip()
    receipt = source.identity(head)
    assert receipt["roles"][ROLE] == hashlib.sha256(Path(ROLE).read_bytes()).hexdigest()
    original = Path.read_bytes

    def altered(path):
        raw = original(path)
        return raw + b"\n# changed archive admission\n" if str(path) == ROLE else raw

    with patch.object(Path, "read_bytes", altered):
        try:
            source.identity(head)
        except ValueError:
            pass
        else:
            raise AssertionError("changed imported archive reader admitted")
    print("CWSDPMI QEMU source closure control PASS")


if __name__ == "__main__":
    main()
