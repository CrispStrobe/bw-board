#!/usr/bin/env python3
"""Small admission, source-origin and process-failure controls; no compiler."""

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import compile as gate


def denies(fn):
    try:
        fn()
    except ValueError:
        return
    raise AssertionError("expected denial")


def zipped(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, raw in entries:
            z.writestr(name, raw)
    return out.getvalue()


def run():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        candidate = root / "candidate.bin"
        candidate.write_bytes(b"selected input")
        denies(lambda: gate.load(candidate, 100, len(b"selected input"), "0" * 64))
        denies(lambda: gate.load(candidate, 2, None, None))
        members = [{"type": "file", "path": gate.SELECTED["compiler"][0],
                    "bytes": 9, "sha256": "0" * 64}]
        denies(lambda: gate.selected_roles(members, root))
        observed = json.loads((root / "selected-tool-roles.json").read_text())
        assert observed["compiler"]["observed"][0]["sha256"] == "0" * 64
        source = zipped([("include/dpmi.h", b"dpmi"),
                         ("include/sys/farptr.h", b"farptr"),
                         ("lib/crt0.o", b"startup"),
                         ("lib/libc.a", b"libc")])
        saved_source = dict(gate.SOURCE)
        saved_selected = dict(gate.SELECTED)
        try:
            for role, raw in (("dpmi.h", b"dpmi"), ("farptr.h", b"farptr"),
                              ("crt0.o", b"startup"), ("libc.a", b"libc")):
                path, _ = gate.SELECTED[role]
                gate.SELECTED[role] = (path, gate.sha(raw))
            gate.SOURCE.clear()
            gate.SOURCE.update({name: (len(source), gate.sha(source)) for name in saved_source})
            reports = gate.source_origins({name: source for name in saved_source}, root)
            assert all(r["match"] for r in reports["djcrx205.zip"]["runtimeByteOrigins"].values())
            changed = zipped([("include/dpmi.h", b"dpmi"),
                              ("include/sys/farptr.h", b"altered"),
                              ("lib/crt0.o", b"startup"), ("lib/libc.a", b"libc")])
            denies(lambda: gate.source_origins({**{name: source for name in saved_source},
                                               "djcrx205.zip": changed}, root))
            divergence = json.loads((root / "runtime-source-origins.json").read_text())
            assert divergence["djcrx205.zip"]["runtimeByteOrigins"]["farptr.h"]["match"] is False
        finally:
            gate.SOURCE.clear(); gate.SOURCE.update(saved_source)
            gate.SELECTED.clear(); gate.SELECTED.update(saved_selected)
        out = root / "logs"
        out.mkdir()
        denies(lambda: gate.command("exit-nine", [sys.executable, "-c", "raise SystemExit(9)"],
                                   root, {"PATH": "/usr/bin:/bin"}, out, 5))
        receipt = json.loads((out / "exit-nine.json").read_text())
        assert receipt["exit"] == 9 and receipt["timeout"] is False
        denies(lambda: gate.command("timeout", [sys.executable, "-c", "import time; time.sleep(2)"],
                                   root, {"PATH": "/usr/bin:/bin"}, out, 0.05))
        assert json.loads((out / "timeout.json").read_text())["timeout"] is True
        inputs = {name: root / name for name in ("toolchain", *gate.SOURCE, "client")}
        inputs["toolchain"].write_bytes(b"wrong pinned toolchain")
        inputs["client"].write_bytes(b"int main(void){return 0;}\n")
        denies(lambda: gate.run_preserving_failure(inputs, root / "failed-gate", root / "work"))
        failure = json.loads((root / "failed-gate/failure.json").read_text())
        assert failure["phase"] == "authenticate-archives"
        receipt = json.loads((root / "failed-gate/input-manifest.json").read_text())
        assert receipt["inputs"]["toolchain"]["sha256"] == gate.sha(b"wrong pinned toolchain")
    print("compile-only controls PASS")


if __name__ == "__main__":
    run()
