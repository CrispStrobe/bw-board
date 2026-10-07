#!/usr/bin/env python3
"""Small archive/metadata adversaries; no remote acquisition or extraction."""

import io
import json
import hashlib
import sys
import tarfile
import tempfile
import warnings
import zipfile
from pathlib import Path

from acquire import (CWSDPMI_SHA1, TOOL_ASSET, TOOL_ASSET_API, TOOL_ASSET_ID,
                     TOOL_BYTES, TOOL_RELEASE_ID, TOOL_TAG, TOOL_TAG_COMMIT,
                     TOOL_URL, inventory_tar, inventory_zip, main, strict_json,
                     validate_metadata)


def denies(action) -> None:
    try:
        action()
    except (ValueError, zipfile.BadZipFile, tarfile.TarError):
        return
    raise AssertionError("malformed candidate admitted")


def zipped(items) -> bytes:
    result = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, body in items:
                archive.writestr(name, body)
    return result.getvalue()


def tarred(items) -> bytes:
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w:bz2") as archive:
        for name, kind, body in items:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            if kind == tarfile.REGTYPE:
                entry.size = len(body)
                archive.addfile(entry, io.BytesIO(body))
            else:
                entry.linkname = body.decode()
                archive.addfile(entry)
    return result.getvalue()


normal_zip = zipped([("doc/COPYING", b"owned notice"), ("bin/host.exe", b"tool")])
entries, notices = inventory_zip(normal_zip)
assert len(entries) == 2 and notices == {"doc/COPYING": b"owned notice"}
assert inventory_zip(zipped([("doc/LICENSE", b"\x00binary")]))[1] == {}
denies(lambda: inventory_zip(zipped([("../escape", b"x")])))
denies(lambda: inventory_zip(zipped([("x", b"a"), ("x", b"b")])))
denies(lambda: inventory_zip(zipped([("/absolute", b"x")])))

normal_tar = tarred([("tool/COPYING", tarfile.REGTYPE, b"owned notice"),
                     ("tool/gcc", tarfile.REGTYPE, b"compiler"),
                     ("tool/alias", tarfile.SYMTYPE, b"gcc")])
entries, notices = inventory_tar(normal_tar)
assert len(entries) == 3 and notices == {"tool/COPYING": b"owned notice"}
assert entries[-1]["resolved"] == "tool/gcc"
assert inventory_tar(tarred([("./", tarfile.DIRTYPE, b"")]))[0][0]["type"] == "root-directory"
denies(lambda: inventory_tar(tarred([("tool/bad", tarfile.SYMTYPE, b"../../escape")])))
denies(lambda: inventory_tar(tarred([("../bad", tarfile.REGTYPE, b"x")])))
denies(lambda: inventory_tar(tarred([("tool/x", tarfile.REGTYPE, b"a"),
                                     ("tool/x", tarfile.REGTYPE, b"b")])))
denies(lambda: inventory_tar(tarred([("tool/device", tarfile.CHRTYPE, b"")])))
denies(lambda: inventory_tar(tarred([("tool/missing", tarfile.SYMTYPE, b"none")])))
denies(lambda: inventory_tar(tarred([("tool/a", tarfile.SYMTYPE, b"b"),
                                     ("tool/b", tarfile.SYMTYPE, b"a")])))

catalog = (f"<div>GNU General Public License, Version 2</div><span>163,241 bytes</span>"
           f"<span>{CWSDPMI_SHA1}</span><a>cwsdpmi.zip</a>").encode()
asset = {"id": TOOL_ASSET_ID, "name": TOOL_ASSET, "size": TOOL_BYTES,
         "state": "uploaded", "browser_download_url": TOOL_URL, "url": TOOL_ASSET_API}
release = {"id": TOOL_RELEASE_ID, "tag_name": TOOL_TAG, "draft": False,
           "prerelease": False, "assets": [asset]}
tag = {"ref": f"refs/tags/{TOOL_TAG}",
       "object": {"sha": TOOL_TAG_COMMIT, "type": "commit"}}
assert validate_metadata(catalog, release, tag)["releaseAssetId"] == TOOL_ASSET_ID
denies(lambda: validate_metadata(catalog.replace(b"163,241", b"163,242"), release, tag))
denies(lambda: validate_metadata(catalog, {**release, "assets": []}, tag))
denies(lambda: validate_metadata(catalog, release,
                                 {**tag, "object": {"sha": "0" * 40}}))
denies(lambda: validate_metadata(catalog, {**release, "id": 0}, tag))
denies(lambda: validate_metadata(catalog, release,
                                 {**tag, "object": {**tag["object"], "type": "tag"}}))
denies(lambda: strict_json(b'{"id":1,"id":2}'))
denies(lambda: strict_json(b'{"id":NaN}'))

# A failed metadata admission must retain the original bounded public text and
# its independent hash before the parser reports the first failure.
with tempfile.TemporaryDirectory(prefix="cwsdpmi-metadata-control-") as directory:
    root = Path(directory)
    output = root / "report"
    output.mkdir()
    payloads = {"cws.zip": b"x", "tool.tar.bz2": b"y", "catalog.html": catalog,
                "release.json": b'{"id":1,"id":2}', "tag.json": json.dumps(tag).encode()}
    for name, raw in payloads.items():
        (root / name).write_bytes(raw)
    original_argv = sys.argv
    sys.argv = ["acquire.py", *(str(root / name) for name in payloads), str(output)]
    try:
        denies(main)
    finally:
        sys.argv = original_argv
    retained = json.loads((output / "metadata-inputs.json").read_text())
    assert (output / "release.json").read_bytes() == payloads["release.json"]
    assert retained["release.json"]["bytes"] == len(payloads["release.json"])
    assert retained["release.json"]["sha256"] == hashlib.sha256(payloads["release.json"]).hexdigest()
    assert (output / "failure.json").is_file()
print("PASS 22 bounded archive and metadata controls; no remote asset inspected")
