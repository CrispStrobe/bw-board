#!/usr/bin/env python3
"""Generate a tiny, owned, standalone LE32 client for an external DOS/32A.

The generated file contains no extender bytes and has no MZ stub.  The first
guest gate will invoke the separately acquired extender with this file as its
argument; this source-only generator does not establish that it loads there.
"""

from __future__ import annotations

import argparse
import hashlib
import struct
from pathlib import Path

PAGE = 4096
HEADER = 0xA8
OBJECT = HEADER
PAGE_MAP = OBJECT + 48
FIXUP_PAGES = PAGE_MAP + 4
FIXUP_RECORDS = FIXUP_PAGES + 8
DATA = PAGE
OK = b"BW-DOS32-LE-ARITH-OK\r\n$"
BAD = b"BW-DOS32-LE-ARITH-FAIL\r\n$"


def payload() -> bytes:
    code = bytearray()
    code += b"\xe8\x00\x00\x00\x00\x5b"  # call next; pop ebx: image-relative anchor
    anchor = 5
    code += b"\xb8\x78\x56\x34\x12"  # mov eax, 12345678h
    code += b"\x05\x11\x11\x11\x11"  # add eax, 11111111h
    code += b"\x3d\x89\x67\x45\x23"  # cmp eax, 23456789h
    branch = len(code)
    code += b"\x75\x00"  # jne fail
    code += b"\x8d\x93"  # lea edx, [ebx + success message]
    good_pointer = len(code)
    code += b"\x00" * 4
    code += b"\xb4\x09\xcd\x21"  # DOS AH=09h
    code += b"\xb8\x00\x4c\x00\x00\xcd\x21"  # DOS AX=4C00h
    fail = len(code)
    code += b"\x8d\x93"  # lea edx, [ebx + failure message]
    bad_pointer = len(code)
    code += b"\x00" * 4
    code += b"\xb4\x09\xcd\x21"  # DOS AH=09h
    code += b"\xb8\x01\x4c\x00\x00\xcd\x21"  # DOS AX=4C01h
    good = len(code)
    code += OK
    bad = len(code)
    code += BAD
    assert len(code) < 256 and -128 <= fail - branch - 2 <= 127
    struct.pack_into("b", code, branch + 1, fail - branch - 2)
    struct.pack_into("<i", code, good_pointer, good - anchor)
    struct.pack_into("<i", code, bad_pointer, bad - anchor)
    return bytes(code)


def build() -> bytes:
    body = payload()
    image = bytearray(DATA + PAGE)
    image[:2] = b"LE"
    # 386 LE, little-endian byte/word order, one file-backed code page.
    struct.pack_into("<HH", image, 0x08, 2, 0)
    struct.pack_into("<I", image, 0x14, 1)
    struct.pack_into("<IIII", image, 0x18, 1, 0, 2, PAGE - 16)
    struct.pack_into("<II", image, 0x28, PAGE, PAGE)
    struct.pack_into("<I", image, 0x30, 8)  # two zero fixup-page offsets
    struct.pack_into("<II", image, 0x40, OBJECT, 2)
    struct.pack_into("<I", image, 0x48, PAGE_MAP)
    struct.pack_into("<II", image, 0x68, FIXUP_PAGES, FIXUP_RECORDS)
    struct.pack_into("<I", image, 0x80, DATA)
    # Code and stack require distinct selector types: SS must be writable data.
    # Both 32-bit selectors have base zero in the pinned DOS/32A loader.
    struct.pack_into("<IIIIII", image, OBJECT, PAGE, 0x10000, 0x2005, 1, 1, 0)
    struct.pack_into("<IIIIII", image, OBJECT + 24, PAGE, 0x20000, 0x2003, 2, 0, 0)
    image[PAGE_MAP:PAGE_MAP + 4] = b"\x00\x00\x01\x00"
    image[DATA:DATA + len(body)] = body
    return bytes(image)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    image = build()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(image)
    print(f"{hashlib.sha256(image).hexdigest()}  {args.output}")


if __name__ == "__main__":
    main()
