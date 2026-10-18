#!/usr/bin/env python3
"""Pure package admission controls; no external download or executable run."""

import io
import json
import os
import tempfile
import zipfile
from pathlib import Path

import package as gate


def zipped(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, raw in entries:
            archive.writestr(name, raw)
    return out.getvalue()


def denies(fn):
    try:
        fn()
    except ValueError:
        return
    raise AssertionError("expected package denial")


def main():
    sample = [("BIN/CWSDPMI.EXE", b"MZ-owned-candidate"),
              ("DOC/CWSDPMI/COPYING.CWS", b"sample notice"),
              ("SOURCE/CWSDPMI/SOURCES.ZIP", b"sample source")]
    raw = zipped(sample)
    pins = {name: (len(data), gate.sha(data)) for name, data in sample}
    entries, selected = gate.inspect(raw, len(raw), gate.sha(raw), pins)
    assert len(entries) == 3 and selected["BIN/CWSDPMI.EXE"] == sample[0][1]
    denies(lambda: gate.inspect(raw, len(raw), "0" * 64, pins))
    denies(lambda: gate.inspect(raw, len(raw), gate.sha(raw), {**pins,
           "BIN/CWSDPMI.EXE": (len(sample[0][1]), "0" * 64)}))
    bad_path = zipped(sample + [("../outside", b"x")])
    denies(lambda: gate.inspect(bad_path, len(bad_path), gate.sha(bad_path), pins))
    duplicate = zipped(sample + [("BIN/CWSDPMI.EXE", b"second")])
    denies(lambda: gate.inspect(duplicate, len(duplicate), gate.sha(duplicate), pins))
    with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as temp:
        root = Path(temp)
        candidate = root / "candidate.zip"
        candidate.write_bytes(b"wrong package")
        try:
            gate.run(candidate, root / "evidence", root / "private")
        except ValueError:
            pass
        else:
            raise AssertionError("expected pinned archive refusal")
        input_receipt = json.loads((root / "evidence/input.json").read_text())
        assert input_receipt["sha256"] == gate.sha(b"wrong package")
        assert not (root / "evidence/CWSDPMI.EXE").exists()
    print("CWSDPMI package controls PASS")


if __name__ == "__main__":
    main()
