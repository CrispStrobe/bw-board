#!/usr/bin/env python3
"""Bounded QEMU-oracle controls; no emulator, compiler or guest is run."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import oracle


def refuses(call, message):
    try:
        call()
    except (ValueError, OSError):
        return
    raise AssertionError(message)


assert oracle.strict_json(b'{"nested":{"one":1}}') == {"nested": {"one": 1}}
refuses(lambda: oracle.strict_json(b'{"nested":{"one":1,"one":2}}'),
        "duplicate nested JSON key")
refuses(lambda: oracle.strict_json(b'{"value":NaN}'), "nonfinite JSON")

command = "c:\\runht.bat"
ready = ["FreeDOS", "A:\\>c:\\runht.bat", oracle.BATCH_DONE, "C:\\>"]
assert oracle.prompt_drive(["A:\\>"]) == "A"
assert oracle.prompt_drive(["C:\\>"]) == "C"
assert oracle.client_screen(ready, "A")
assert not oracle.client_screen(ready, "C")
assert not oracle.client_screen(["A:\\>c:\\runht.bat"], "A")
assert not oracle.client_screen(["A:\\>c:\\runht.bat", "C:\\>"], "A")
assert not oracle.client_screen(["A:\\>c:\\other.bat", oracle.BATCH_DONE, "C:\\>"], "A")
assert not oracle.client_screen(["C:\\>", "A:\\>c:\\runht.bat", oracle.BATCH_DONE], "A")
assert oracle.current_echo(ready, command, "A")
assert oracle.any_command_echo(ready, command)
assert not oracle.any_command_echo(["A:\\>"], command)
assert oracle.return_screen(["C:\\>c:\\verifyht.bat", "C:\\>"])
assert not oracle.return_screen(["C:\\>c:\\verifyht.bat"])
assert not oracle.return_screen(["A:\\>c:\\verifyht.bat", "C:\\>"])

candidate = ("disk-hash", "exact-file-hashes")
assert oracle.advance_pair(None, candidate) == (candidate, False)
assert oracle.advance_pair(candidate, candidate) == (candidate, True)
assert oracle.advance_pair(candidate, None) == (None, False)
assert oracle.advance_pair(oracle.advance_pair(candidate, None)[0], candidate) == (candidate, False)
assert oracle.advance_pair(candidate, ("different", "exact-file-hashes")) == (
    ("different", "exact-file-hashes"), False)

output = (b"BW_HMT_OK\r\nBW_HMT_VALUES address=1048577 requested=4096 "
          b"selector_base=1048577 selector_limit=4095 first=3 last=4 "
          b"polls=2 delta=1 checksum=4225408\r\n")
found = {"output": output, "ok": b"BW-HMT-EXIT-0\r\n",
         "fail": None, "returned": None}
diagnostics = oracle.grade(found, False)
file_receipt = oracle.files_receipt(found)
assert oracle.pre_verify_projection(found, file_receipt, diagnostics, ready, "A") == diagnostics
refuses(lambda: oracle.pre_verify_projection(found, file_receipt, diagnostics, ready, "C"),
        "wrong boot echo drive before VERIFY")
refuses(lambda: oracle.pre_verify_projection(found, file_receipt, diagnostics,
                                            ready[:-1] + ["C:\\>c:\\verifyht.bat", "C:\\>"], "A"),
        "preexisting VERIFY echo")
refuses(lambda: oracle.pre_verify_projection(dict(found, returned=b"stale"),
                                            file_receipt, diagnostics, ready, "A"),
        "preexisting RETURN")
refuses(lambda: oracle.pre_verify_projection(dict(found, output=output + b"extra"),
                                            file_receipt, diagnostics, ready, "A"),
        "altered output")
first_receipt = oracle.pair_observation("disk-hash", found, diagnostics,
                                        {"sample": 5}, time.monotonic())
assert first_receipt["screenSample"] == 5
assert first_receipt["files"] == file_receipt
assert first_receipt["diagnostics"] == diagnostics

raw = b"A" * 65536
receipt = oracle.files_receipt({"output": raw, "ok": None})
assert receipt["output"] == {
    "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
    "prefixBytes": 256, "prefixHex": (b"A" * 256).hex(),
    "prefixLatin1": "A" * 256, "truncated": True,
}
assert receipt["ok"] is None

rows = ["" for _ in range(25)]
rows[0] = "C:\\>c:\\runht.bat"
rows[1] = "private path excluded"
rows[24] = "C:\\>"
screen = oracle.screen_receipt(rows, b"\0" * 4000, 3)
assert screen["ownedOrPromptRows"] == ["C:\\>c:\\runht.bat", "C:\\>"]
assert screen["sha256"] == hashlib.sha256(b"\0" * 4000).hexdigest()
refuses(lambda: oracle.screen_receipt(rows, b"\0" * 3999, 3), "short screen")
refuses(lambda: oracle.screen_receipt(rows[:-1], b"\0" * 4000, 3), "short row set")

with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as temporary:
    folder = Path(temporary)
    source = folder / "ordinary.bin"
    source.write_bytes(b"owned")
    assert oracle.ordinary(source, 5, 5, oracle.sha(b"owned")) == b"owned"
    refuses(lambda: oracle.ordinary(source, 4), "oversize ordinary file")
    alias = folder / "alias.bin"
    alias.symlink_to(source)
    refuses(lambda: oracle.ordinary(alias, 5), "symlinked file")
    fifo = folder / "fifo.bin"
    os.mkfifo(fifo)
    refuses(lambda: oracle.ordinary(fifo, 5), "FIFO input")

    input_path = folder / "input.json"
    input_path.write_text(json.dumps({"scratch": str(folder / "missing")}) + "\n")
    failure = folder / "highmem-oracle.json"
    child = subprocess.run((sys.executable, str(Path(oracle.__file__).resolve()),
                            str(input_path), str(failure)),
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=10, check=False)
    assert child.returncode == 1 and len(child.stdout) == 0
    assert len(child.stderr) == 0
    report = json.loads(failure.read_bytes())
    assert report["schema"] == "bw.cwsdpmi-highmem-timer.qemu-oracle.v1"
    assert report["passed"] is False and "oracle scratch directory" in report["firstFailure"]

print("high-memory/timer QEMU oracle controls PASS")
