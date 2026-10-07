#!/usr/bin/env python3
"""Fail-closed cross-emulator comparison for the finite LE client outcome."""

from __future__ import annotations

import json
import hashlib
import sys
from pathlib import Path

ROLES = ("output", "ok", "returned")


def checked_file(value: object, role: str) -> tuple[int, str, str]:
    if not isinstance(value, dict) or type(value.get("bytes")) is not int or not 0 <= value["bytes"] <= 65536:
        raise ValueError("invalid guest file extent " + role)
    digest, text = value.get("sha256"), value.get("text")
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("invalid guest file digest " + role)
    if not isinstance(text, str):
        raise ValueError("invalid guest file text " + role)
    try:
        raw = text.encode("latin1")
    except UnicodeEncodeError as error:
        raise ValueError("guest file text not Latin-1 " + role) from error
    if len(raw) != value["bytes"] or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError("guest file self-hash differs " + role)
    return value["bytes"], digest, text


def compare(target: dict, oracle: dict) -> dict:
    if target.get("schema") != "bw.dos32a-owned-le.target.v1" or target.get("passed") is not True:
        raise ValueError("target guest did not pass its protected-entry gate")
    if oracle.get("schema") != "bw.dos32a-owned-le.qemu-oracle.v1" or oracle.get("passed") is not True:
        raise ValueError("independent guest did not pass output/exit/return gate")
    if target.get("disk", {}).get("initialSha256") != oracle.get("initialDiskSha256"):
        raise ValueError("initial disk differs")
    if target.get("inputHashes", {}).get("floppy") != oracle.get("floppySha256"):
        raise ValueError("FreeDOS boot image differs")
    if target.get("guestFiles", {}).get("fail") is not None or oracle.get("guestFiles", {}).get("fail") is not None:
        raise ValueError("guest failure marker")
    values = {}
    for role in ROLES:
        left = target.get("guestFiles", {}).get(role)
        right = oracle.get("guestFiles", {}).get(role)
        if checked_file(left, "target " + role) != checked_file(right, "oracle " + role):
            raise ValueError("guest output mismatch " + role)
        values[role] = {"bytes": left["bytes"], "sha256": left["sha256"]}
    return {"schema": "bw.dos32a-owned-le.actual-comparison.v1", "passed": True,
            "targetProfile": target.get("scope"), "oracleProfile": oracle.get("profile"),
            "initialDiskSha256": oracle["initialDiskSha256"], "floppySha256": oracle["floppySha256"],
            "guestFiles": values,
            "limit": "Finite shared FreeDOS application output/exit/shell result; no QEMU 386-state equivalence, full RAM replay, DPMI, IRQ or performance claim."}


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: compare.py target.json oracle.json result.json")
    output = Path(sys.argv[3])
    try:
        result = compare(json.loads(Path(sys.argv[1]).read_text()),
                         json.loads(Path(sys.argv[2]).read_text()))
    except Exception as error:
        result = {"schema": "bw.dos32a-owned-le.actual-comparison.v1", "passed": False,
                  "firstFailure": f"{type(error).__name__}: {str(error)[:240]}"}
    output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
