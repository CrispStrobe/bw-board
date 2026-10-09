#!/usr/bin/env python3
"""CPU-free malformed archive, origin, identity and inventory adversaries."""
import io
import json
from pathlib import Path
import tarfile
import tempfile

import preflight as preflight_module
from preflight import (NODE_NAME, archive_records, bounded_download,
                       pinned_file, read_bounded, sha, write_receipt)
from preflight_inventory import inventory


def tar_xz(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:xz") as archive:
        for name, data, kind in entries:
            item = tarfile.TarInfo(name)
            item.type = kind
            item.size = len(data) if kind == tarfile.REGTYPE else 0
            archive.addfile(item, io.BytesIO(data))
    return out.getvalue()


class Response:
    def __init__(self, url, data, length=None):
        self.url, self.data, self.status = url, data, 200
        self.headers = {"Content-Length": str(len(data) if length is None else length)}

    def __enter__(self): return self
    def __exit__(self, *_): return False
    def geturl(self): return self.url
    def read(self, count): return self.data[:count]


def refuse(fn):
    try:
        fn()
    except (ValueError, FileNotFoundError, tarfile.TarError):
        return
    raise AssertionError("malformed preflight input accepted")


node_role = "node-v20.20.2-linux-x64/bin/node"
raw = tar_xz([(node_role, b"synthetic-node", tarfile.REGTYPE)])
assert archive_records(raw, sha(raw), "node") == b"synthetic-node"
refuse(lambda: archive_records(raw, "0" * 64, "node"))
refuse(lambda: archive_records(tar_xz([(node_role, b"x", tarfile.SYMTYPE)]),
                               sha(tar_xz([(node_role, b"x", tarfile.SYMTYPE)])), "node"))
dupe = tar_xz([(node_role, b"one", tarfile.REGTYPE),
               (node_role, b"two", tarfile.REGTYPE)])
refuse(lambda: archive_records(dupe, sha(dupe), "node"))
escape = tar_xz([("node-v20.20.2-linux-x64/../bin/node", b"x", tarfile.REGTYPE)])
refuse(lambda: archive_records(escape, sha(escape), "node"))
headers = tar_xz([("node-v20.20.2/include/node/node.h", b"node", tarfile.REGTYPE),
                  ("node-v20.20.2/include/node/v8-profiler.h", b"v8", tarfile.REGTYPE)])
assert archive_records(headers, sha(headers), "headers")["memberCount"] == 2
refuse(lambda: archive_records(headers, sha(headers), "node"))
refuse(lambda: archive_records(b"x", sha(b"x"), "headers"))
url = "https://nodejs.org/dist/v20.20.2/" + NODE_NAME
assert bounded_download(NODE_NAME, 50, lambda *_args, **_kw: Response(url, b"ok")) == b"ok"
refuse(lambda: bounded_download(NODE_NAME, 50,
       lambda *_args, **_kw: Response("https://unexpected.example/x", b"ok")))
refuse(lambda: bounded_download(NODE_NAME, 1,
       lambda *_args, **_kw: Response(url, b"oversize")))
refuse(lambda: bounded_download("unreviewed.tar.xz", 50,
       lambda *_args, **_kw: Response(url, b"ok")))
original_run = preflight_module.run_bounded
try:
    preflight_module.run_bounded = lambda *_args: {
        "exitCode": 7, "timedOut": False, "outputBound": False,
        "complete": True, "stdout": b"original-out\n", "stderr": b"original-err\n"}
    try:
        preflight_module.probe(["synthetic", "--version"], ".")
    except preflight_module.ProbeFailure as error:
        assert error.receipt["exitCode"] == 7
        assert error.receipt["stdout"]["sha256"] == sha(b"original-out\n")
        assert error.receipt["stderr"]["sha256"] == sha(b"original-err\n")
        assert error.receipt["stdout"]["base64"] == "b3JpZ2luYWwtb3V0Cg=="
    else:
        raise AssertionError("failed probe lost its original bounded output")
finally:
    preflight_module.run_bounded = original_run
with tempfile.TemporaryDirectory(prefix="direct-v8-preflight-pure-") as name:
    root = Path(name)
    executable = root / "ordinary"
    executable.write_bytes(b"synthetic")
    assert pinned_file(executable)["sha256"] == sha(b"synthetic")
    report = root / "preflight.json"
    write_receipt(report, {"status": "INCOMPLETE_UNQUALIFIED"})
    assert read_bounded(report, 256) == report.read_bytes()
    refuse(lambda: read_bounded(report, 1))
    assert json.loads(report.read_text())["status"] == "INCOMPLETE_UNQUALIFIED"
    executable.unlink()
    report_info = inventory(root)
    assert set(report_info["files"]) == {"preflight.json"}
    forbidden = root / "addon.node"
    forbidden.write_bytes(b"binary")
    refuse(lambda: inventory(root))
    forbidden.unlink()
    link = root / "run.stdout"
    link.symlink_to(report)
    refuse(lambda: inventory(root))
    link.unlink()
print("direct V8 report-only preflight controls PASS")
