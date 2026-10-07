#!/usr/bin/env python3
"""Fail-closed cross-emulator comparison for the finite LE client outcome."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROLES = ("output", "ok", "returned")


def compare(target: dict, oracle: dict) -> dict:
    if target.get("schema") != "bw.dos32a-owned-le.target.v1" or not target.get("passed"):
        raise ValueError("target guest did not pass its protected-entry gate")
    if oracle.get("schema") != "bw.dos32a-owned-le.qemu-oracle.v1" or not oracle.get("passed"):
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
        if not isinstance(left, dict) or not isinstance(right, dict):
            raise ValueError("missing guest result " + role)
        if (left.get("bytes"), left.get("sha256"), left.get("text")) != (
                right.get("bytes"), right.get("sha256"), right.get("text")):
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
