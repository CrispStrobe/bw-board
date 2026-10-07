#!/usr/bin/env python3
"""Small synthetic notice/receipt controls, never an upstream archive test."""

import io
import json
import tempfile
import zipfile
from pathlib import Path

import notice


def denies(fn):
    try:
        fn()
    except (ValueError, zipfile.BadZipFile):
        return
    raise AssertionError("expected denial")


def zipped(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, raw in entries:
            z.writestr(name, raw)
    return out.getvalue()


def paths(root, sources, notice_bytes):
    inputs = {}
    for name, raw in sources.items():
        path = root / name
        path.write_bytes(raw)
        inputs[name] = path
    ref = (notice.GCC_TAG + "\t" + notice.GCC_REF + "\n" +
           notice.GCC_COMMIT + "\t" + notice.GCC_REF + "^{}\n").encode()
    for name, raw in (("tag-ref.txt", ref),
                      ("COPYING.RUNTIME", b"GCC Runtime Library Exception\n"),
                      ("COPYING3", b"GNU GENERAL PUBLIC LICENSE\n")):
        path = root / name
        path.write_bytes(raw)
        inputs[name] = path
    return inputs


def run():
    raw_notice = b"GNU\fnotice\x80\n"
    archive = zipped([("copying.lib", raw_notice)])
    projection = notice.latin1_projection(raw_notice)
    assert projection["roundTripsExactBytes"]
    assert projection["controlBytes"]["0x0c"] == 1
    assert projection["text"].encode("latin-1") == raw_notice
    denies(lambda: notice.tag_ref(b"fake\trefs/tags/releases/gcc-12.2.0\n"))
    role, body = notice.copying_from_zip(archive, "synthetic")
    assert role["sha256"] == notice.sha(raw_notice) and body == raw_notice
    denies(lambda: notice.copying_from_zip(zipped([("../copying.lib", raw_notice)]), "escape"))
    original_source = dict(notice.SOURCE)
    original_size, original_sha = notice.COPYING_BYTES, notice.COPYING_SHA
    try:
        notice.COPYING_BYTES, notice.COPYING_SHA = len(raw_notice), notice.sha(raw_notice)
        notice.SOURCE.clear()
        notice.SOURCE.update({name: (len(archive), notice.sha(archive)) for name in original_source})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            inputs = paths(root, {name: archive for name in original_source}, raw_notice)
            report = notice.run_audit(inputs, root / "success")
            assert report["status"] == "EXACT_NOTICES_ONLY_NO_COMPILE_OR_LICENSE_CLOSURE"
            assert (root / "success/notices/djcrx205-COPYING.LIB.raw").read_bytes() == raw_notice
            assert json.loads((root / "success/input-manifest.json").read_text())["inputs"]["COPYING3"]["sha256"] == notice.sha(b"GNU GENERAL PUBLIC LICENSE\n")
            changed = zipped([("copying.lib", b"changed\fnotice\x80\n")])
            inputs["djlsr205.zip"].write_bytes(changed)
            notice.SOURCE["djlsr205.zip"] = (len(changed), notice.sha(changed))
            denies(lambda: notice.run_audit(inputs, root / "failure"))
            failure = json.loads((root / "failure/failure.json").read_text())
            assert failure["stage"] == "retain-djlsr205.zip-COPYING.LIB"
            observed = json.loads((root / "failure/copying-lib-origins.json").read_text())
            assert observed["djlsr205.zip"]["noticeMember"]["sha256"] == notice.sha(b"changed\fnotice\x80\n")
            assert (root / "failure/notices/djlsr205-COPYING.LIB.raw").read_bytes() == b"changed\fnotice\x80\n"
    finally:
        notice.SOURCE.clear()
        notice.SOURCE.update(original_source)
        notice.COPYING_BYTES, notice.COPYING_SHA = original_size, original_sha
    print("notice-completion controls PASS")


if __name__ == "__main__":
    run()
