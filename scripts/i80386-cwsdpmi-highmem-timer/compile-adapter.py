#!/usr/bin/env python3
"""Bind the unchanged bounded DJGPP compiler helper to this separate owned source."""

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

BASE = "cc5b2ac7a40788f7d0100c4a1b5b5a9996bc2c66"
ORIGINAL = Path("scripts/i80386-cwsdpmi-compile-only/compile.py")
OLD_CLIENT = Path("scripts/i80386-cwsdpmi-owned/client.c")
CLIENT = Path("scripts/i80386-cwsdpmi-highmem-timer/client.c")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def original_bytes():
    expected = subprocess.check_output(("git", "--no-replace-objects", "show", f"{BASE}:{ORIGINAL}"))
    observed = ORIGINAL.read_bytes()
    if observed != expected or ORIGINAL.is_symlink():
        raise ValueError("inherited compiler helper changed")
    return observed


def run(argv):
    if len(argv) != 7 or argv[4] != str(CLIENT):
        raise ValueError("compile adapter exact client invocation")
    original = original_bytes()
    client = CLIENT.read_bytes()
    if CLIENT.is_symlink() or not 1 <= len(client) <= 3000000:
        raise ValueError("new owned source shape")
    if client != subprocess.check_output(("git", "--no-replace-objects", "show", f"HEAD:{CLIENT}")):
        raise ValueError("new owned source differs from Git")
    spec = importlib.util.spec_from_file_location("unchanged_cwsdpmi_compile_helper", ORIGINAL)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    if helper.CLIENT != OLD_CLIENT:
        raise ValueError("unreviewed compiler source metadata")
    helper.CLIENT = CLIENT  # Only its report metadata changes; argv names and compile logic remain fixed.
    paths = dict(zip(("toolchain", *helper.SOURCE, "client"), map(Path, argv[:5])))
    out, work = map(Path, argv[5:])
    report = helper.run_preserving_failure(paths, out, work)
    raw = (out / "compile-report.json").read_bytes()
    if (report["ownedSource"] != {"path": str(CLIENT), "sha256": sha(client)} or
            report["executable"]["uploaded"] is not False):
        raise ValueError("new compile report source binding")
    result = {
        "schema": "bw.cwsdpmi-highmem-timer.compile-adapter.v1",
        "status": "COMPILED_INTERNAL_ONLY",
        "testedCompilerHelper": {"path": str(ORIGINAL), "base": BASE, "sha256": sha(original)},
        "ownedSource": report["ownedSource"],
        "rawCompileReport": {"path": "compile-audit/compile-report.json", "sha256": sha(raw)},
        "executable": report["executable"], "map": report["map"],
        "limits": ["Compilation only; no executable or toolchain bytes in artifacts",
                   "Raw inherited compile receipt is retained separately and is not the new profile"],
    }
    (out.parent / "highmem-compile.json").write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 8:
        raise SystemExit("usage: compile-adapter.py tool.tar.bz2 djcrx.zip djdev.zip djlsr.zip client.c evidence-dir work-dir")
    run(sys.argv[1:])
