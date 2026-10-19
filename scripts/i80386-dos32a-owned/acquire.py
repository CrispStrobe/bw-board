#!/usr/bin/env python3
"""Authenticate the official FreeDOS archive and extract one pinned boot image."""

from __future__ import annotations

import hashlib
import io
import json
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

ZIP_SHA = "45b1fa7c52dd996c3bfa5e352ffcd410781b952a6ad629f15a4c9ec4bbaefc5a"
FLOPPY_SHA = "03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77"
FLOPPY_BYTES = 1_228_800
SOURCE = "https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.4/FD14-FloppyEdition.zip"
VERIFY = "https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.4/verify.txt"


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def extract(raw: bytes, zip_sha: str = ZIP_SHA, image_sha: str = FLOPPY_SHA,
            image_bytes: int = FLOPPY_BYTES) -> tuple[bytes, str]:
    if len(raw) > 32 << 20 or digest(raw) != zip_sha:
        raise ValueError("FreeDOS official archive digest or cap")
    matches = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            mode = (entry.external_attr >> 16) & 0xffff
            if (path.is_absolute() or ".." in path.parts or len(entry.filename) > 240 or
                    stat.S_ISLNK(mode)):
                raise ValueError("FreeDOS archive path")
            if path.name.lower() in ("x86boot.img", "x86boot-1200.img") and entry.file_size == image_bytes:
                if entry.is_dir() or entry.flag_bits & 1:
                    raise ValueError("FreeDOS boot image member shape")
                matches.append(entry)
        if len(matches) != 1:
            raise ValueError("FreeDOS boot image member uniqueness")
        with archive.open(matches[0]) as stream:
            image = stream.read(image_bytes + 1)
    if len(image) != image_bytes or digest(image) != image_sha:
        raise ValueError("FreeDOS boot image digest")
    return image, matches[0].filename


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: acquire.py official.zip floppy.img receipt.json")
    raw = Path(sys.argv[1]).read_bytes()
    image, member = extract(raw)
    with Path(sys.argv[2]).open("xb") as output:
        output.write(image)
    receipt = {"schema": "bw.dos32a-owned-le.freedos-input.v1", "source": SOURCE,
               "verification": VERIFY, "zipBytes": len(raw), "zipSha256": digest(raw),
               "member": member, "floppyBytes": len(image), "floppySha256": digest(image)}
    with Path(sys.argv[3]).open("x") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
