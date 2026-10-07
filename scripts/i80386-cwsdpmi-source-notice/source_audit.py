#!/usr/bin/env python3
"""Report candidate source/notice bytes; never execute or install a component."""

import hashlib
import importlib.util
import io
import json
import sys
import tarfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGE_A = HERE.parent / "i80386-cwsdpmi-owned" / "acquire.py"
spec = importlib.util.spec_from_file_location("stage_a_archive_reader", STAGE_A)
archive_reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive_reader)

CW_URL = archive_reader.CWSDPMI_URL
TOOL_URL = archive_reader.TOOL_URL
CW_SHA = "6ae65336f780e54dee889b5ac865992cf72738717aff5565ef84ccba3459e141"
TOOL_SHA = "8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00"
NESTED_SHA = "1a372e61b86c96fb3d35821c3c7d024f3130ef8ea7dad702761fabf50abf04d7"
SOURCE_URL = "https://www.delorie.com/pub/djgpp/current/v2/"
SOURCE_SIZES = {"djcrx205.zip": 895256, "djdev205.zip": 2509574,
                "djlsr205.zip": 2047171}
BUILDER_URL = ("https://raw.githubusercontent.com/andrewwutw/build-djgpp/"
               "0dc28365825f853c3cc6ad0d8f10f8570bed5828/script/12.2.0")
SELECTED = {
    "include/dpmi.h": ("djgpp/i586-pc-msdosdjgpp/sys-include/dpmi.h",
                       "cf73c8314e4ae364d6160913bae31be5d9f5800c1d333af1291e4e49f61627b3"),
    "lib/crt0.o": ("djgpp/i586-pc-msdosdjgpp/lib/crt0.o",
                    "ee1b0b2cf7b2645708ce35bff4c4c18322aa7e29f89eed5769c4a138cf4acfae"),
    "lib/libc.a": ("djgpp/i586-pc-msdosdjgpp/lib/libc.a",
                    "f59d5106cc668a67c3334c33be2c273df7c69dce93e4e53ef8a52c07a9fbda78"),
}
LIBGCC = ("djgpp/lib/gcc/i586-pc-msdosdjgpp/12.2.0/libgcc.a",
          "e9d6ad2b2c679617b4d305b655039403514ba8f140805f2b75044ffcf16bc4b7")
MAX_NOTICE_TOTAL = 256 << 10
INPUT_CAPS = {"cwsdpmi": 200000, "toolchain": 81000000,
              "djcrx205.zip": 3000000, "djdev205.zip": 3000000,
              "djlsr205.zip": 3000000, "builder": 65536}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    with path.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")


def checkpoint(out, stage):
    write_json(out / "progress.json", {"stage": stage})


def scan_inputs(paths, out):
    """Record observed ordinary bytes before deciding if an archive is admitted."""
    manifest = {}
    expected = {
        "cwsdpmi": (CW_URL, 163241, CW_SHA),
        "toolchain": (TOOL_URL, 80596981, TOOL_SHA),
        **{name: (SOURCE_URL + name, size, None) for name, size in SOURCE_SIZES.items()},
        "builder": (BUILDER_URL, None, None),
    }
    for role in INPUT_CAPS:
        path = paths[role]
        url, size, digest = expected[role]
        observed = {"url": url, "expectedBytes": size, "expectedSha256": digest,
                    "capBytes": INPUT_CAPS[role], "ordinary": path.is_file() and not path.is_symlink()}
        if observed["ordinary"]:
            observed["bytes"] = path.stat().st_size
            if observed["bytes"] <= INPUT_CAPS[role]:
                h = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1 << 20), b""):
                        h.update(chunk)
                observed["sha256"] = h.hexdigest()
        manifest[role] = observed
        write_json(out / "input-manifest.json", {"inputs": manifest})
    return manifest


def record_roles(out, label, members, expected):
    comparisons = {}
    for role, (path, digest) in expected.items():
        found = [m for m in members if m["path"] == path and m["type"] == "file"]
        comparisons[role] = {"path": path, "expectedSha256": digest,
                             "observed": found, "match": len(found) == 1 and found[0]["sha256"] == digest}
    write_json(out / (label + "-roles.json"), comparisons)
    if not all(item["match"] for item in comparisons.values()):
        raise ValueError(label + " selected member mismatch")


def load(path, maximum, expected_size=None, expected_sha=None):
    if path.is_symlink() or not path.is_file():
        raise ValueError("archive path not ordinary")
    size = path.stat().st_size
    if size > maximum or (expected_size is not None and size != expected_size):
        raise ValueError("archive size")
    raw = path.read_bytes()
    digest = sha(raw)
    if expected_sha is not None and digest != expected_sha:
        raise ValueError("archive SHA256")
    return raw, {"bytes": len(raw), "sha256": digest}


def member(members, path, digest):
    found = [m for m in members if m["path"] == path and m["type"] == "file"]
    if len(found) != 1 or found[0]["sha256"] != digest:
        raise ValueError("selected archive member mismatch: " + path)
    return found[0]


def safe_notice_write(out, role, notices):
    count = 0
    result = []
    for name, raw in sorted(notices.items()):
        count += len(raw)
        if count > MAX_NOTICE_TOTAL:
            raise ValueError("notice total cap")
        safe = archive_reader.name_check(name)
        dest = out / "notices" / role / safe
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("xb") as stream:
            stream.write(raw)
        result.append({"archivePath": name, "artifactPath": str(dest.relative_to(out)),
                       "bytes": len(raw), "sha256": sha(raw)})
    return result


def source_archive(raw, name, out):
    members, notices = archive_reader.inventory_zip(raw)
    return {"name": name, "bytes": len(raw), "sha256": sha(raw),
            "members": members, "notices": safe_notice_write(out, name, notices)}


def matched_origin(members):
    result = {}
    for suffix, (tool_path, tool_sha) in SELECTED.items():
        matches = [m for m in members if m["type"] == "file" and
                   (m["path"].lower() == suffix or m["path"].lower().endswith("/" + suffix))]
        result[suffix] = {"candidateMatches": matches,
                          "stageAToolPath": tool_path, "stageAToolSha256": tool_sha,
                          "exactlyOneByteMatch": len(matches) == 1 and matches[0]["sha256"] == tool_sha}
    return result


def audit(paths, out):
    out.mkdir(parents=True, exist_ok=False)
    checkpoint(out, "scan-inputs")
    scan_inputs(paths, out)
    checkpoint(out, "admit-stage-a-archives")
    cws, cws_info = load(paths["cwsdpmi"], 200000, 163241, CW_SHA)
    tool, tool_info = load(paths["toolchain"], 81000000, 80596981, TOOL_SHA)
    checkpoint(out, "inventory-cwsdpmi")
    cw_members, cw_notices = archive_reader.inventory_zip(cws)
    record_roles(out, "cwsdpmi", cw_members, {
        "nestedSource": ("SOURCE/CWSDPMI/SOURCES.ZIP", NESTED_SHA),
        "copying": ("DOC/CWSDPMI/COPYING.CWS",
                    "2047dc5c069fe346c9b8030edcccb49760fb8dedb5a0d78f998e522cdec547a5")})
    with zipfile.ZipFile(io.BytesIO(cws)) as z:
        nested = z.read("SOURCE/CWSDPMI/SOURCES.ZIP")
    if len(nested) != 91059 or sha(nested) != NESTED_SHA:
        raise ValueError("nested source ZIP changed")
    cw_source = source_archive(nested, "cwsdpmi-source", out)
    write_json(out / "cwsdpmi-source-candidate.json", cw_source)
    checkpoint(out, "inventory-toolchain")
    tool_members, _ = archive_reader.inventory_tar(tool)
    record_roles(out, "toolchain", tool_members,
                 {**SELECTED, "libgcc.a": LIBGCC})
    official = {}
    for filename, size in SOURCE_SIZES.items():
        checkpoint(out, "inventory-" + filename)
        raw, info = load(paths[filename], 3000000, size)
        data = source_archive(raw, filename.removesuffix(".zip"), out)
        data["url"] = SOURCE_URL + filename
        data["candidateSha256Unpinned"] = info["sha256"]
        if filename == "djcrx205.zip":
            data["stageAByteOriginComparison"] = matched_origin(data["members"])
        official[filename] = data
        write_json(out / "official-source-candidates.json", official)
    checkpoint(out, "validate-builder")
    builder = paths["builder"].read_bytes()
    if len(builder) > 65536 or b"\x00" in builder:
        raise ValueError("builder text cap")
    text = builder.decode("utf-8")
    with (out / "builder-source.txt").open("xb") as stream:
        stream.write(builder)
    for phrase in ("DJCRX_VERSION=205", "DJLSR_VERSION=205", "DJDEV_VERSION=205",
                   "GCC_VERSION=12.2.0", "cp -rp include/*", "cp -rp lib"):
        if phrase not in text:
            raise ValueError("builder source role changed")
    report = {
        "schema": "bw.cwsdpmi-owned.source-notice-candidate.v1",
        "status": "SOURCE_NOTICE_CANDIDATE_ONLY_NO_COMPILE_OR_LICENSE_CLOSURE",
        "stageA": {"cwsdpmi": dict(cws_info, url=CW_URL),
                   "toolchain": dict(tool_info, url=TOOL_URL),
                   "selectedToolMembers": {s: {"path": p, "sha256": h}
                                           for s, (p, h) in SELECTED.items()},
                   "libgcc": {"path": LIBGCC[0], "sha256": LIBGCC[1]},
                   "cwsdpmiNotices": safe_notice_write(out, "cwsdpmi-outer", cw_notices),
                   "nestedSource": cw_source},
        "builder": {"url": BUILDER_URL, "sha256": sha(builder),
                    "artifactPath": "builder-source.txt"},
        "officialCandidates": official,
        "unresolved": ["DJCRX/DJDEV/DJLSR source ZIP SHA256s are measured candidates, not compile pins",
                       "GCC 12.2.0 libgcc runtime-exception/source correspondence not verified",
                       "CWSDPMI nested source correspondence and redistribution obligations not adjudicated",
                       "No component was installed, executed, compiled, or guest tested"]}
    with (out / "source-notice.json").open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, sort_keys=True)
        stream.write("\n")
    checkpoint(out, "complete")
    return report


def run_audit(paths, out):
    try:
        return audit(paths, out)
    except Exception as error:
        stage = "before-output"
        progress = out / "progress.json"
        if progress.is_file():
            stage = json.loads(progress.read_text(encoding="utf-8"))["stage"]
        if out.is_dir():
            write_json(out / "failure.json", {"stage": stage,
                       "exceptionType": type(error).__name__,
                       "message": str(error) if isinstance(error, ValueError) else "see audit.stderr"})
        raise


def main():
    if len(sys.argv) != 8:
        raise SystemExit("usage: source_audit.py cws.zip tool.tar.bz2 djcrx.zip djdev.zip djlsr.zip builder.txt output-dir")
    keys = ("cwsdpmi", "toolchain", "djcrx205.zip", "djdev205.zip",
            "djlsr205.zip", "builder")
    run_audit(dict(zip(keys, map(Path, sys.argv[1:7]))), Path(sys.argv[7]))


if __name__ == "__main__":
    main()
