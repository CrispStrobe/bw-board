#!/usr/bin/env python3
"""Synthetic archive controls; no actual FreeDOS download is needed."""

from __future__ import annotations

import hashlib
import io
import zipfile

from acquire import extract


def archive(members: list[tuple[str, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as writer:
        for name, raw in members:
            writer.writestr(name, raw)
    return buffer.getvalue()


image = b"owned-test-image"
source = archive([("FD14/120m/x86BOOT-1200.img", image)])
sha = lambda raw: hashlib.sha256(raw).hexdigest()
assert extract(source, sha(source), sha(image), len(image)) == (image, "FD14/120m/x86BOOT-1200.img")
for raw, archive_sha, image_sha, size in (
    (source, "0" * 64, sha(image), len(image)),
    (source, sha(source), "0" * 64, len(image)),
    (source, sha(source), sha(image), len(image) + 1),
    (archive([("../x86BOOT-1200.img", image)]), None, sha(image), len(image)),
    (archive([("a/x86BOOT-1200.img", image), ("b/x86BOOT-1200.img", image)]), None, sha(image), len(image)),
):
    try:
        extract(raw, archive_sha or sha(raw), image_sha, size)
    except ValueError:
        pass
    else:
        raise AssertionError("accepted malformed archive")
print("PASS pinned archive/member digest, path and uniqueness adversaries")
