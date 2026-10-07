#!/usr/bin/env python3
"""Bounded archive/admission adversaries; no candidate archive is needed."""

import hashlib
import io
import json
import tempfile
import zipfile
from pathlib import Path

import source_audit as audit


def denies(fn):
    try:
        fn()
    except (ValueError, zipfile.BadZipFile):
        return
    raise AssertionError("expected pre-admission denial")


def zip_bytes(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, value in entries:
            z.writestr(name, value)
    return out.getvalue()


def run():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        bytes_ = zip_bytes([("include/dpmi.h", b"header"),
                            ("COPYING", b"bounded public notice\n")])
        report = audit.source_archive(bytes_, "synthetic", root)
        assert len(report["members"]) == 2
        assert report["notices"][0]["sha256"] == audit.sha(b"bounded public notice\n")
        assert (root / report["notices"][0]["artifactPath"]).read_bytes() == b"bounded public notice\n"
        origin = audit.matched_origin(report["members"])
        assert origin["include/dpmi.h"]["exactlyOneByteMatch"] is False
        denies(lambda: audit.source_archive(zip_bytes([("../escape", b"x")]), "escape", root))
        denies(lambda: audit.source_archive(zip_bytes([("same", b"1"), ("same", b"2")]), "duplicate", root))
        path = root / "candidate.zip"
        path.write_bytes(bytes_)
        denies(lambda: audit.load(path, 100000, expected_sha="0" * 64))
        denies(lambda: audit.load(path, len(bytes_) - 1))
        denies(lambda: audit.member(report["members"], "include/dpmi.h", "0" * 64))
        fake = {"path": "include/dpmi.h", "type": "file", "sha256": audit.SELECTED["include/dpmi.h"][1]}
        assert audit.matched_origin([fake])["include/dpmi.h"]["exactlyOneByteMatch"] is True
        assert audit.matched_origin([fake, fake])["include/dpmi.h"]["exactlyOneByteMatch"] is False
        assert hashlib.sha256(bytes_).hexdigest() == report["sha256"]
        inputs = {role: root / role for role in audit.INPUT_CAPS}
        inputs["cwsdpmi"].write_bytes(b"wrong stage-A archive")
        failed = root / "failed-audit"
        denies(lambda: audit.run_audit(inputs, failed))
        observed = json.loads((failed / "input-manifest.json").read_text())["inputs"]
        assert observed["cwsdpmi"]["sha256"] == audit.sha(b"wrong stage-A archive")
        assert observed["djcrx205.zip"]["ordinary"] is False
        failure = json.loads((failed / "failure.json").read_text())
        assert failure["stage"] == "admit-stage-a-archives"
        assert failure["exceptionType"] == "ValueError"
        bad_role = root / "failed-roles"
        bad_role.mkdir()
        denies(lambda: audit.record_roles(bad_role, "toolchain", [fake],
                                          {"dpmi": ("include/dpmi.h", "0" * 64)}))
        roles = json.loads((bad_role / "toolchain-roles.json").read_text())
        assert roles["dpmi"]["observed"][0]["sha256"] == fake["sha256"]
    print("source-notice controls PASS")


if __name__ == "__main__":
    run()
