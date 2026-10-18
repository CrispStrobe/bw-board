#!/usr/bin/env python3
"""Small admission, source-origin and process-failure controls; no compiler."""

import io
import json
import os
import struct
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
        denies(lambda: gate.command("closed-pipes", [sys.executable, "-c",
                    "import os,time; os.close(1); os.close(2); time.sleep(2)"],
                    root, {"PATH": "/usr/bin:/bin"}, out, 0.05))
        assert json.loads((out / "closed-pipes.json").read_text())["timeout"] is True
        denies(lambda: gate.command("chatty", [sys.executable, "-c",
                    "import sys; sys.stdout.write('x'*5000000); sys.stdout.flush()"],
                    root, {"PATH": "/usr/bin:/bin"}, out, 5))
        chatty = json.loads((out / "chatty.json").read_text())
        assert chatty["outputCapped"] and chatty["stdoutBytes"] > gate.MAX_LOG
        assert len((out / "chatty.stdout").read_bytes()) == gate.MAX_LOG
        role = "assembler"
        extracted = root / "extracted"
        role_path = extracted / gate.SELECTED[role][0]
        role_path.parent.mkdir(parents=True)
        role_path.write_bytes(b"owned assembler")
        saved_selected = dict(gate.SELECTED)
        saved_probes = dict(gate.ROLE_PROBES)
        try:
            gate.SELECTED.clear(); gate.SELECTED[role] = (saved_selected[role][0], gate.sha(b"owned assembler"))
            gate.ROLE_PROBES.clear(); gate.ROLE_PROBES[role] = "assembler-probe"
            (out / "assembler-probe.stdout").write_text("/usr/bin/as\n")
            denies(lambda: gate.resolve_roles(extracted, out, {"PATH": "/usr/bin:/bin"}))
            assert not json.loads((out / "compiler-resolved-roles.json").read_text())[role]["admitted"]
            (out / "assembler-probe.stdout").write_text(str(role_path) + "\n")
            assert gate.resolve_roles(extracted, out, {"PATH": "/usr/bin:/bin"})[role]["admitted"]
            dotted = str(role_path.parent / ".." / "bin" / role_path.name)
            (out / "assembler-probe.stdout").write_text(dotted + "\n")
            assert gate.resolve_roles(extracted, out, {"PATH": "/usr/bin:/bin"})[role]["admitted"]
            outsider = root / "outside-as"
            os.link(role_path, outsider)
            (out / "assembler-probe.stdout").write_text(str(outsider) + "\n")
            denies(lambda: gate.resolve_roles(extracted, out, {"PATH": "/usr/bin:/bin"}))
            alias = extracted / gate.ROLE_ALIASES[role][0]
            alias.parent.mkdir(parents=True, exist_ok=True)
            os.link(role_path, alias)
            (out / "assembler-probe.stdout").write_text(str(alias) + "\n")
            assert gate.resolve_roles(extracted, out, {"PATH": "/usr/bin:/bin"})[role]["admitted"]
            alias.unlink()
            alias.write_bytes(b"owned assembler")
            denies(lambda: gate.resolve_roles(extracted, out, {"PATH": "/usr/bin:/bin"}))
        finally:
            gate.SELECTED.clear(); gate.SELECTED.update(saved_selected)
            gate.ROLE_PROBES.clear(); gate.ROLE_PROBES.update(saved_probes)
        obj = struct.pack("<HHIIIHH", 0x14c, 1, 0, 0, 0, 0, 0) + bytes(40)
        assert gate.coff_format(obj)["valid"]
        assert not gate.coff_format(b"xx" + obj[2:])["valid"]
        invalid_object = b"xx" + obj[2:]
        denies(lambda: gate.record_format(invalid_object, out, "bad-object", False))
        bad_object_receipt = json.loads((out / "bad-object.json").read_text())
        assert bad_object_receipt["bytes"] == len(invalid_object)
        assert bad_object_receipt["sha256"] == gate.sha(invalid_object)
        assert bad_object_receipt["format"]["valid"] is False
        coff = struct.pack("<HHIIIHH", 0x14c, 1, 0, 0, 0, 28, 2) + \
            struct.pack("<H", 0x010b) + bytes(26 + 40)
        stub = bytearray(512)
        stub[0:2] = b"MZ"
        struct.pack_into("<H", stub, 4, 1)
        struct.pack_into("<H", stub, 8, 2)
        assert gate.djgpp_executable_format(bytes(stub) + coff)["valid"]
        struct.pack_into("<H", stub, 8, 33)
        assert not gate.djgpp_executable_format(bytes(stub) + coff)["valid"]
        invalid_exe = bytes(stub) + coff
        denies(lambda: gate.record_format(invalid_exe, out, "bad-executable", True))
        bad_exe_receipt = json.loads((out / "bad-executable.json").read_text())
        assert bad_exe_receipt["bytes"] == len(invalid_exe)
        assert bad_exe_receipt["sha256"] == gate.sha(invalid_exe)
        assert bad_exe_receipt["format"]["valid"] is False
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
