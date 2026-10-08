"""Strict byte-level result projection for the owned high-memory/timer client."""

import re

DAY = 0x1800B0
POLL_CAP = 262144
MAX_DELTA = 36
UINT32 = 0xffffffff
CHECKSUM = 4225408
SUCCESS = b"BW_HMT_OK\r\n"
EXIT_OK = b"BW-HMT-EXIT-0\r\n"
RETURN = b"BW-HMT-SHELL-RETURN\r\n"
VALUES = re.compile(
    rb"BW_HMT_VALUES address=(0|[1-9][0-9]*) requested=(0|[1-9][0-9]*) "
    rb"selector_base=(0|[1-9][0-9]*) selector_limit=(0|[1-9][0-9]*) "
    rb"first=(0|[1-9][0-9]*) last=(0|[1-9][0-9]*) "
    rb"polls=(0|[1-9][0-9]*) delta=(0|[1-9][0-9]*) "
    rb"checksum=(0|[1-9][0-9]*)\r\n\Z"
)


def project(output):
    if not isinstance(output, bytes) or len(output) > 256 or not output.startswith(SUCCESS):
        raise ValueError("fixed success marker or output bound")
    match = VALUES.fullmatch(output[len(SUCCESS):])
    if match is None:
        raise ValueError("diagnostic grammar")
    fields = dict(zip(("address", "requested", "selector_base", "selector_limit",
                       "first", "last", "polls", "delta", "checksum"),
                      (int(raw) for raw in match.groups())))
    if any(value > UINT32 for value in fields.values()):
        raise ValueError("diagnostic uint32 range")
    address, requested = fields["address"], fields["requested"]
    if address <= 0x100000 or requested != 4096 or address + requested - 1 > UINT32:
        raise ValueError("linear allocation predicate")
    if fields["selector_base"] != address or fields["selector_limit"] < requested - 1:
        raise ValueError("selector readback predicate")
    if not 0 <= fields["first"] < DAY or not 0 <= fields["last"] < DAY:
        raise ValueError("BIOS tick range")
    if not 2 <= fields["polls"] <= POLL_CAP:
        raise ValueError("poll budget")
    if not 1 <= fields["delta"] <= MAX_DELTA or fields["delta"] != (
            fields["last"] - fields["first"]) % DAY:
        raise ValueError("advancing modulo-day timer")
    if fields["checksum"] != CHECKSUM:
        raise ValueError("owned pattern checksum")
    return fields


def grade(files, require_return):
    if not isinstance(files, dict) or set(files) != {"output", "ok", "fail", "returned"}:
        raise ValueError("result role set")
    if files["fail"] is not None or files["ok"] != EXIT_OK:
        raise ValueError("guest exit marker")
    if require_return:
        if files["returned"] != RETURN:
            raise ValueError("separate shell return boundary")
    elif files["returned"] is not None:
        raise ValueError("return before separate command")
    return project(files["output"])
