#!/usr/bin/env python3
"""Independent FAT reader and QMP key controls; no QEMU execution."""

from __future__ import annotations

import sys
from pathlib import Path

from oracle import FIRST, SECOND, decode_vga_text, files, has_prompt, keys, root_file


if len(sys.argv) != 2:
    raise SystemExit("usage: oracle-control.py deterministic-initial-hdd.img")
disk = Path(sys.argv[1]).read_bytes()
assert root_file(disk, b"DOS32A  EXE") is not None
assert root_file(disk, b"OWNED   EXE") is not None
assert root_file(disk, b"RUNLE   BAT") is not None
assert root_file(disk, b"VERIFY  BAT") is not None
assert all(value is None for value in files(disk).values())
assert keys(FIRST)[:3] == [["c"], ["shift", "semicolon"], ["backslash"]]
assert keys(SECOND)[-1] == ["ret"]
vga = bytearray(b" \x07" * (80 * 25))
for index, char in enumerate(b"C:\\>"):
    vga[(24 * 80 + index) * 2] = char
rows = decode_vga_text(bytes(vga))
assert has_prompt(rows)
assert not has_prompt(rows + ["BW-LE-BATCH-RUNNING"])
vga[(24 * 80 + 3) * 2] = ord("X")
assert not has_prompt(decode_vga_text(bytes(vga)))
try:
    decode_vga_text(bytes(vga[:-2]))
except ValueError:
    pass
else:
    raise AssertionError("accepted partial VGA snapshot")
for bad in ("C", "?", "/"):
    try:
        keys(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("unadmitted QMP key")
corrupt = bytearray(disk)
corrupt[510] = 0
try:
    root_file(bytes(corrupt), b"OWNED   EXE")
except ValueError:
    pass
else:
    raise AssertionError("accepted MBR corruption")
print("PASS independent FAT input roles, absent result files, bounded QMP key map and corruption")
