#!/usr/bin/env python3
"""Bounded hostile output controls; no compiler or guest is run."""

from grade import DAY, EXIT_OK, RETURN, grade, project


def result(address=0x100001, requested=4096, selector_base=None,
           selector_limit=4095, first=3, last=4, polls=2,
           delta=1, checksum=4225408):
    if selector_base is None:
        selector_base = address
    return (b"BW_HMT_OK\r\nBW_HMT_VALUES address=%d requested=%d selector_base=%d selector_limit=%d "
            b"first=%d last=%d polls=%d delta=%d checksum=%d\r\n" %
            (address, requested, selector_base, selector_limit, first, last, polls, delta, checksum))


def refuses(raw):
    try:
        project(raw)
    except ValueError:
        return
    raise AssertionError("malformed result admitted")


assert project(result())["address"] == 0x100001
assert project(result(first=DAY - 1, last=0, delta=1))["delta"] == 1
for bad in (
    result(address=0x100000), result(address=0xfffff001),
    result(requested=4095), result(requested=4097),
    result(selector_base=0x100002), result(selector_limit=4094),
    result(first=DAY), result(last=DAY), result(last=3, delta=0),
    result(last=40, delta=37), result(polls=1), result(polls=262145),
    result(checksum=1), result() + result(), result() + b"extra\r\n",
    result().replace(b"address=1048577", b"address=+1048577"),
    result().replace(b"address=1048577", b"address=01048577"),
    result().replace(b"address=1048577", b"address=4294967296"),
    result().replace(b"BW_HMT_OK", b"BW_HMT_O\xff"),
    result().replace(b"BW_HMT_OK", b"BW_HMT_OK\x00"),
    result().replace(b"\r\n", b"\n"),
):
    refuses(bad)

files = {"output": result(), "ok": EXIT_OK, "fail": None, "returned": None}
assert grade(files, False)["checksum"] == 4225408
for role, wrong in (("ok", b"BW-HMT-EXIT-0\r\n\r\n"),
                    ("fail", b"BW-HMT-EXIT-FAIL\r\n"),
                    ("returned", RETURN)):
    bad = dict(files, **{role: wrong})
    try:
        grade(bad, False)
    except ValueError:
        pass
    else:
        raise AssertionError("batch boundary admitted malformed file")
files["returned"] = RETURN
assert grade(files, True)["polls"] == 2
print("high-memory/timer result controls PASS")
