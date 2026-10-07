#!/usr/bin/env python3
"""Bounded structural and negative controls for this one LE32 client."""

from __future__ import annotations

import hashlib
import struct

from build import BAD, DATA, OK, PAGE, build


def u32(raw: bytes, offset: int) -> int:
    return struct.unpack_from("<I", raw, offset)[0]


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(reason)


def verify(raw: bytes) -> dict[str, int | str]:
    """Admit precisely this one-page, no-import, no-relocation test image."""
    require(len(raw) >= DATA + 48 and raw[:4] == b"LE\x00\x00", "signature/order")
    require(raw[4:8] == b"\x00" * 4, "format level")
    require(raw[8:12] == b"\x02\x00\x00\x00", "386/OS")
    require(u32(raw, 0x10) == 0 and u32(raw, 0x14) == 1, "module/pages")
    require((u32(raw, 0x18), u32(raw, 0x1c)) == (1, 0), "entry")
    require((u32(raw, 0x20), u32(raw, 0x24)) == (2, PAGE - 16), "stack")
    require(u32(raw, 0x28) == PAGE, "page size")
    size = u32(raw, 0x2c)
    require(size == PAGE and len(raw) == DATA + PAGE, "last page")
    require(u32(raw, 0x30) == 8, "fixup page bytes")
    require((u32(raw, 0x40), u32(raw, 0x44), u32(raw, 0x48)) == (0xA8, 2, 0xD8), "object table")
    require((u32(raw, 0x68), u32(raw, 0x6c), u32(raw, 0x80)) == (0xDC, 0xE4, DATA), "loader tables")
    require(raw[0xA8:0xC0] == struct.pack("<IIIIII", PAGE, 0x10000, 0x2005, 1, 1, 0), "code object")
    require(raw[0xC0:0xD8] == struct.pack("<IIIIII", PAGE, 0x20000, 0x2003, 2, 0, 0), "stack object")
    require(raw[0xD8:0xE4] == b"\x00\x00\x01\x00" + b"\x00" * 8, "page/fixup map")
    require(raw[0xE4:DATA] == b"\x00" * (DATA - 0xE4), "unused loader bytes")
    code = raw[DATA:]
    require(code[:6] == b"\xe8\x00\x00\x00\x00\x5b", "position anchor")
    require(code[6] == 0xB8 and code[11] == 0x05 and code[16] == 0x3D, "arithmetic opcodes")
    left, addend, expected = (u32(code, at) for at in (7, 12, 17))
    require((left + addend) & 0xFFFFFFFF == expected == 0x23456789, "arithmetic result")
    require(code[21] == 0x75 and code[23:25] == b"\x8d\x93", "branch/success pointer")
    fail = 23 + struct.unpack_from("b", code, 22)[0]
    require(fail >= 40 and fail + 17 <= len(code), "branch target")
    require(code[29:40] == b"\xb4\x09\xcd\x21\xb8\x00\x4c\x00\x00\xcd\x21", "success DOS calls")
    require(code[fail:fail + 2] == b"\x8d\x93", "failure pointer")
    require(code[fail + 6:fail + 17] == b"\xb4\x09\xcd\x21\xb8\x01\x4c\x00\x00\xcd\x21", "failure DOS calls")
    ok_offset = 5 + struct.unpack_from("<i", code, 25)[0]
    bad_offset = 5 + struct.unpack_from("<i", code, fail + 2)[0]
    require(ok_offset == fail + 17 and bad_offset == ok_offset + len(OK), "message pointers")
    require(code[ok_offset:bad_offset] == OK and code[bad_offset:bad_offset + len(BAD)] == BAD, "message bytes")
    require(code[bad_offset + len(BAD):] == b"\x00" * (PAGE - bad_offset - len(BAD)), "padding")
    return {"bytes": len(raw), "clientBytes": bad_offset + len(BAD), "sha256": hashlib.sha256(raw).hexdigest()}


def denied(raw: bytes, offset: int, replacement: bytes) -> None:
    damaged = bytearray(raw)
    damaged[offset:offset + len(replacement)] = replacement
    try:
        verify(bytes(damaged))
    except ValueError:
        return
    raise AssertionError(f"accepted tamper at {offset:#x}")


def main() -> None:
    raw = build()
    receipt = verify(raw)
    assert raw == build(), "nondeterministic generator"
    for offset, value in (
        (0, b"LX"), (8, b"\x03"), (0x10, b"\x00\x20"),
        (0x14, b"\x02"), (0x18, b"\x02"), (0x20, b"\x02"),
        (0x24, b"\x00"), (0x28, b"\x00"), (0x2c, b"\x00"),
        (0x30, b"\x00"), (0x40, b"\x00"), (0x44, b"\x01"),
        (0x48, b"\x00"), (0x68, b"\x00"), (0x6c, b"\x00"),
        (0x80, b"\x00"), (0xA8, b"\x00"), (0xB0, b"\x03"),
        (0xB4, b"\x02"), (0xC0, b"\x00"), (0xC8, b"\x05"),
        (0xCC, b"\x03"), (0xDA, b"\x00"),
        (DATA + 7, b"\x00"), (DATA + 21, b"\x74"),
        (DATA + 25, b"\x00"), (DATA + 31, b"\x90"),
        (DATA + 42, b"\x00"), (DATA + 58, b"X"),
    ):
        if raw[offset:offset + len(value)] == value:
            continue
        denied(raw, offset, value)
    try:
        verify(raw + b"\x00")
    except ValueError:
        pass
    else:
        raise AssertionError("accepted trailing bytes")
    print(f"PASS structural and bounded tamper controls {receipt}")


if __name__ == "__main__":
    main()
