#!/usr/bin/env python3
"""Pure DPMI output/prompt controls; no emulator or guest execution."""

import oracle as gate
import struct


def fat_fixture(length):
    image = bytearray(gate.GEOMETRY_BYTES)
    image[510:512] = b"\x55\xaa"
    struct.pack_into("<I", image, 454, 17)
    vbr = 17 * 512
    image[vbr + 510:vbr + 512] = b"\x55\xaa"
    struct.pack_into("<H", image, vbr + 11, 512)
    image[vbr + 13] = 4
    image[vbr + 16] = 2
    struct.pack_into("<H", image, vbr + 17, 512)
    struct.pack_into("<H", image, vbr + 22, 256)
    root = (18 + 512) * 512
    data = root + 32 * 512
    payload = bytes((i % 251 for i in range(length)))
    image[root:root + 11] = b"CLIENT  EXE"
    struct.pack_into("<H", image, root + 26, 2)
    struct.pack_into("<I", image, root + 28, length)
    for index, start in enumerate(range(0, length, 2048)):
        cluster = index + 2
        struct.pack_into("<H", image, 18 * 512 + 2 * cluster,
                         0xffff if start + 2048 >= length else cluster + 1)
        image[data + index * 2048:data + index * 2048 + min(2048, length - start)] = payload[start:start + 2048]
    return image, payload, root


def main():
    good = {"output": b"CWSDPMI ready\r\nBW_DPMI_OK checksum=4225408\r\n",
            "ok": b"BW-DPMI-EXIT-0\r\n", "fail": None,
            "returned": b"BW-DPMI-SHELL-RETURN\r\n"}
    assert all(gate.accepted(good).values())
    assert not gate.accepted({**good, "output": b"prefix BW_DPMI_OK checksum=4225408\r\n"})["exactSuccessLine"]
    assert not gate.accepted({**good, "output": good["output"] + b"BW_DPMI_OK checksum=4225408\n"})["exactSuccessLine"]
    assert not gate.accepted({**good, "output": good["output"] + b"BW_DPMI_FAIL 0501\n"})["exactSuccessLine"]
    assert not gate.accepted({**good, "fail": b"BW-DPMI-EXIT-FAIL"})["zeroErrorlevel"]
    assert not gate.accepted({**good, "ok": b"prefix BW-DPMI-EXIT-0\r\n"})["zeroErrorlevel"]
    assert not gate.accepted({**good, "returned": None})["separateReturn"]
    assert not gate.accepted({**good, "returned": b"prefix BW-DPMI-SHELL-RETURN\r\n"})["separateReturn"]
    assert gate.has_prompt(["FreeDOS", "C:\\>", ""])
    assert not gate.has_prompt(["C:\\>", "DPMI client still running"])
    assert gate.prior.keys(gate.FIRST) and gate.prior.keys(gate.SECOND)
    image, payload, root = fat_fixture(179581)
    assert gate.initial_file(image, b"CLIENT  EXE") == payload
    try:
        gate.root_file(image, b"CLIENT  EXE")
    except ValueError:
        pass
    else:
        raise AssertionError("guest result cap must remain 64 KiB")
    image[root:root + 11] = b"DPOUT   TXT"
    try:
        gate.guest_files(image)
    except ValueError:
        pass
    else:
        raise AssertionError("large guest output admitted")
    assert gate.child_limit_bytes() > gate.GEOMETRY_BYTES
    print("CWSDPMI QEMU oracle controls PASS")


if __name__ == "__main__":
    main()
