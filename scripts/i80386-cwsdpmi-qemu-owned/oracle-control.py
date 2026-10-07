#!/usr/bin/env python3
"""Pure DPMI output/prompt controls; no emulator or guest execution."""

import oracle as gate


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
    print("CWSDPMI QEMU oracle controls PASS")


if __name__ == "__main__":
    main()
