#!/usr/bin/env python3
"""Admit one measured CWSDPMI FreeDOS package without publishing executables."""

import hashlib
import io
import json
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

ARCHIVE_URL = "https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/repositories/1.4/tools/cwsdpmi.zip"
ARCHIVE_BYTES = 163241
ARCHIVE_SHA = "6ae65336f780e54dee889b5ac865992cf72738717aff5565ef84ccba3459e141"
MEMBERS = {
    "BIN/CWSDPMI.EXE": (21325, "2de899fecaa90632b8b9bdfc0305cb0375e59ae252c37e32d06c1ed3f98a8f44"),
    "DOC/CWSDPMI/COPYING.CWS": (1692, "2047dc5c069fe346c9b8030edcccb49760fb8dedb5a0d78f998e522cdec547a5"),
    "SOURCE/CWSDPMI/SOURCES.ZIP": (91059, "1a372e61b86c96fb3d35821c3c7d024f3130ef8ea7dad702761fabf50abf04d7"),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def inspect(raw, archive_bytes=ARCHIVE_BYTES, archive_sha=ARCHIVE_SHA, members=MEMBERS):
    if len(raw) != archive_bytes or sha(raw) != archive_sha:
        raise ValueError("CWSDPMI archive size/SHA")
    entries, selected, total = [], {}, 0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if len(archive.infolist()) > 64:
            raise ValueError("CWSDPMI member count")
        seen = set()
        for info in archive.infolist():
            name = info.filename
            path = PurePosixPath(name)
            mode = (info.external_attr >> 16) & 0xffff
            if (not name or len(name) > 240 or path.is_absolute() or ".." in path.parts or
                    "\\" in name or name in seen or stat.S_ISLNK(mode) or info.flag_bits & 1 or
                    info.file_size > 1 << 20):
                raise ValueError("CWSDPMI member shape")
            seen.add(name)
            total += info.file_size
            if total > 2 << 20:
                raise ValueError("CWSDPMI expanded extent")
            if info.is_dir():
                continue
            with archive.open(info) as stream:
                data = stream.read(info.file_size + 1)
            if len(data) != info.file_size:
                raise ValueError("CWSDPMI member length")
            entry = {"path": name, "bytes": len(data), "sha256": sha(data)}
            entries.append(entry)
            if name in members:
                selected[name] = data
    if set(selected) != set(members):
        raise ValueError("CWSDPMI selected member set")
    for name, (size, digest) in members.items():
        if len(selected[name]) != size or sha(selected[name]) != digest:
            raise ValueError("CWSDPMI selected member SHA: " + name)
    return entries, selected


def run(source, out, private):
    out.mkdir()
    private.mkdir()
    stat_result = source.lstat()
    observed = {"url": ARCHIVE_URL, "ordinary": source.is_file() and not source.is_symlink(),
                "bytes": stat_result.st_size, "expectedBytes": ARCHIVE_BYTES,
                "expectedSha256": ARCHIVE_SHA}
    write(out / "input.json", observed)
    if not observed["ordinary"] or observed["bytes"] > 1 << 20:
        raise ValueError("CWSDPMI input shape")
    raw = source.read_bytes()
    observed["sha256"] = sha(raw)
    write(out / "input.json", observed)
    entries, selected = inspect(raw)
    write(out / "members.json", entries)
    (private / "CWSDPMI.EXE").write_bytes(selected["BIN/CWSDPMI.EXE"])
    (out / "COPYING.CWS").write_bytes(selected["DOC/CWSDPMI/COPYING.CWS"])
    return {"archive": observed, "members": entries,
            "executable": {"bytes": len(selected["BIN/CWSDPMI.EXE"]),
                           "sha256": sha(selected["BIN/CWSDPMI.EXE"]), "uploaded": False}}


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: package.py archive.zip evidence-dir private-dir")
    out = Path(sys.argv[2])
    try:
        report = run(Path(sys.argv[1]), out, Path(sys.argv[3]))
        write(out / "package.json", report)
    except Exception as error:
        if out.is_dir():
            write(out / "failure.json", {"exceptionType": type(error).__name__,
                                         "message": str(error)[:200]})
        raise
