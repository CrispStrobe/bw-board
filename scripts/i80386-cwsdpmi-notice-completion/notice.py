#!/usr/bin/env python3
"""Retain exact missing DJGPP/GCC notices; no compiler or guest execution."""

import hashlib
import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGE_A = HERE.parent / "i80386-cwsdpmi-owned" / "acquire.py"
spec = importlib.util.spec_from_file_location("stage_a_archive_reader", STAGE_A)
archive_reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive_reader)

SOURCE_URL = "https://www.delorie.com/pub/djgpp/current/v2/"
SOURCE = {
    "djcrx205.zip": (895256, "22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60"),
    "djdev205.zip": (2509574, "4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda"),
    "djlsr205.zip": (2047171, "80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea"),
}
COPYING_BYTES = 26530
COPYING_SHA = "dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551"
GCC_TAG = "58051b1d9986afc5262c335a42e50b4730bc82b0"
GCC_COMMIT = "2ee5e4300186a92ad73f1a1a64cb918dc76c8d67"
GCC_REF = "refs/tags/releases/gcc-12.2.0"
GCC_GIT = "https://gcc.gnu.org/git/gcc.git"
GCC_BLOB = "https://gcc.gnu.org/git/?p=gcc.git&a=blob_plain&f={name}&hb=" + GCC_COMMIT
CAPS = {**{name: 3000000 for name in SOURCE}, "tag-ref.txt": 4096,
        "COPYING.RUNTIME": 100000, "COPYING3": 100000}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    with path.open("w", encoding="utf-8") as out:
        json.dump(value, out, indent=2, sort_keys=True, ensure_ascii=True)
        out.write("\n")


def checkpoint(out, stage):
    write_json(out / "progress.json", {"stage": stage})


def scan_inputs(paths, out):
    manifest = {}
    for role, cap in CAPS.items():
        path = paths[role]
        if role in SOURCE:
            url = SOURCE_URL + role
            expected_size, expected_sha = SOURCE[role]
        elif role == "tag-ref.txt":
            url, expected_size, expected_sha = GCC_GIT + "#" + GCC_REF, None, None
        else:
            url, expected_size, expected_sha = GCC_BLOB.format(name=role), None, None
        entry = {"url": url, "capBytes": cap, "expectedBytes": expected_size,
                 "expectedSha256": expected_sha,
                 "ordinary": path.is_file() and not path.is_symlink()}
        if entry["ordinary"]:
            entry["bytes"] = path.stat().st_size
            if entry["bytes"] <= cap:
                h = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1 << 20), b""):
                        h.update(chunk)
                entry["sha256"] = h.hexdigest()
        manifest[role] = entry
        write_json(out / "input-manifest.json", {"inputs": manifest})
    return manifest


def load(path, cap, size=None, digest=None):
    if path.is_symlink() or not path.is_file():
        raise ValueError("nonordinary input")
    length = path.stat().st_size
    if length > cap or (size is not None and length != size):
        raise ValueError("input size")
    raw = path.read_bytes()
    if digest is not None and sha(raw) != digest:
        raise ValueError("input SHA256")
    return raw


def tag_ref(raw):
    if len(raw) > 4096 or not raw or b"\x00" in raw:
        raise ValueError("tag reference size or content")
    lines = raw.decode("ascii").splitlines()
    pairs = [line.split("\t") for line in lines]
    expected = [[GCC_TAG, GCC_REF], [GCC_COMMIT, GCC_REF + "^{}"]]
    if len(pairs) != 2 or sorted(pairs) != sorted(expected):
        raise ValueError("GCC release tag/peeled commit mismatch")
    return {"tagObject": GCC_TAG, "peeledCommit": GCC_COMMIT, "ref": GCC_REF,
            "rawSha256": sha(raw)}


def copying_from_zip(raw, archive_name):
    members, _ = archive_reader.inventory_zip(raw)
    found = [m for m in members if m["type"] == "file" and
             m["path"].lower() == "copying.lib"]
    if len(found) != 1:
        raise ValueError(archive_name + " COPYING.LIB role count")
    role = found[0]
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        notice = archive.read(role["path"])
    return role, notice


def latin1_projection(raw):
    """A reversible byte display, not an assertion of the source's encoding."""
    return {"projection": "ISO-8859-1 one-codepoint-per-byte, not asserted original encoding",
            "text": raw.decode("latin-1"),
            "controlBytes": {f"0x{byte:02x}": raw.count(byte)
                             for byte in sorted(set(raw)) if byte < 32 or byte == 127},
            "roundTripsExactBytes": raw.decode("latin-1").encode("latin-1") == raw}


def audit(paths, out):
    out.mkdir(parents=True, exist_ok=False)
    checkpoint(out, "scan-inputs")
    scan_inputs(paths, out)
    notices = out / "notices"
    notices.mkdir()
    checkpoint(out, "retain-gcc-reference")
    ref = load(paths["tag-ref.txt"], CAPS["tag-ref.txt"])
    (notices / "gcc-tag-ref.txt").write_bytes(ref)
    gcc_ref = tag_ref(ref)
    gcc = {}
    for name, marker in (("COPYING.RUNTIME", "GCC Runtime Library Exception"),
                         ("COPYING3", "GNU GENERAL PUBLIC LICENSE")):
        checkpoint(out, "retain-gcc-" + name)
        raw = load(paths[name], CAPS[name])
        (notices / ("gcc-" + name)).write_bytes(raw)
        text = raw.decode("latin-1")
        if marker not in text or "<html" in text.lower():
            raise ValueError("GCC notice content")
        gcc[name] = {"url": GCC_BLOB.format(name=name), "bytes": len(raw),
                     "sha256": sha(raw), "artifactPath": "notices/gcc-" + name}
        write_json(out / "gcc-notices.json", {"tag": gcc_ref, "notices": gcc})
    source = {}
    first = None
    for name, (size, digest) in SOURCE.items():
        checkpoint(out, "retain-" + name + "-COPYING.LIB")
        raw = load(paths[name], CAPS[name], size, digest)
        role, notice = copying_from_zip(raw, name)
        path = "notices/" + name.removesuffix(".zip") + "-COPYING.LIB.raw"
        (out / path).write_bytes(notice)
        matched = (role["bytes"] == COPYING_BYTES and role["sha256"] == COPYING_SHA and
                   len(notice) == COPYING_BYTES and sha(notice) == COPYING_SHA)
        source[name] = {"url": SOURCE_URL + name, "bytes": len(raw),
                        "sha256": sha(raw), "noticeMember": role,
                        "noticeArtifactPath": path, "noticeMatchesMeasuredRole": matched,
                        "noticeMatchesFirstArchive": first is None or notice == first}
        write_json(out / "copying-lib-origins.json", source)
        if not matched or (first is not None and notice != first):
            raise ValueError(name + " COPYING.LIB byte mismatch")
        if first is None:
            first = notice
    write_json(out / "copying-lib-byte-projection.json", latin1_projection(first))
    report = {"schema": "bw.cwsdpmi-owned.notice-completion.v1",
              "status": "EXACT_NOTICES_ONLY_NO_COMPILE_OR_LICENSE_CLOSURE",
              "djgpp": source, "gccReleaseTag": gcc_ref, "gccNotices": gcc,
              "unresolved": ["GCC libgcc.a source-to-binary correspondence remains unproved",
                             "COPYING.LIB and GCC exception applicability to a future linked client needs component review",
                             "No toolchain download, compile, guest, or performance execution occurred"]}
    write_json(out / "notice-report.json", report)
    checkpoint(out, "complete")
    return report


def run_audit(paths, out):
    try:
        return audit(paths, out)
    except Exception as error:
        stage = "before-output"
        if (out / "progress.json").is_file():
            stage = json.loads((out / "progress.json").read_text())["stage"]
        if out.is_dir():
            write_json(out / "failure.json", {"stage": stage,
                       "exceptionType": type(error).__name__,
                       "message": str(error) if isinstance(error, ValueError) else "see audit.stderr"})
        raise


if __name__ == "__main__":
    if len(sys.argv) != 8:
        raise SystemExit("usage: notice.py djcrx.zip djdev.zip djlsr.zip tag-ref.txt COPYING.RUNTIME COPYING3 output-dir")
    names = (*SOURCE, "tag-ref.txt", "COPYING.RUNTIME", "COPYING3")
    run_audit(dict(zip(names, map(Path, sys.argv[1:7]))), Path(sys.argv[7]))
