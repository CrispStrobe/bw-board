#!/usr/bin/env python3
"""Hosted data-only census of one pinned public Node header archive.

Never extracts a member, builds an addon, loads Node, or runs a guest. The
128 MiB diagnostic ceiling is distinct from the frozen 32,000,000-byte
preflight admission rule; this tool cannot authorize a build.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tarfile
import urllib.request

BASE = "869c3c72cb40b66c135621f297eb66638166b69d"
NAME = "node-v20.20.2-headers.tar.xz"
URL = "https://nodejs.org/dist/v20.20.2/" + NAME
ARCHIVE_SHA = "46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836"
ARCHIVE_BYTES = 512_152
LEGACY_TOTAL = 32_000_000  # decimal: exact frozen preflight predicate
LEGACY_MEMBER = 2_000_000  # decimal: exact frozen preflight predicate
MAX_MEMBERS = 20_000
DATA_TOTAL = 128 * 1024 * 1024  # separate data-only observation ceiling
MAX_RESULT = 8 * 1024 * 1024
MAX_NAME = 512
REQUIRED = frozenset(("node-v20.20.2/include/node/node.h",
                      "node-v20.20.2/include/node/v8-profiler.h"))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_bounded(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
            raise ValueError("bounded ordinary source receipt required")
        raw = os.read(fd, maximum + 1)
        if len(raw) != info.st_size:
            raise ValueError("source receipt changed while reading")
        return raw
    finally:
        os.close(fd)


def source_identity():
    path = Path(__file__).with_name("header-census-source.py")
    spec = importlib.util.spec_from_file_location("direct_v8_header_census_source", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.identity()


def legacy_predicate(index, member, total_before, seen_regular):
    """Match preflight.py archive_records ordering, including raw-name duplicate."""
    if index >= MAX_MEMBERS:
        return "member-count"
    path = PurePosixPath(member.name)
    if (path.is_absolute() or ".." in path.parts or not path.parts or
            path.parts[0] != "node-v20.20.2" or len(path.parts) > 16):
        return "member-path"
    if member.isdir():
        return None
    if not member.isfile() or member.size < 0 or member.size > LEGACY_MEMBER:
        return "member-type-or-size"
    if total_before + member.size > LEGACY_TOTAL:
        return "regular-total-decimal-32000000"
    if member.name in seen_regular:
        return "duplicate-regular-raw-name"
    return None


def write_json(path, value, maximum):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    if not raw or len(raw) > maximum:
        raise ValueError("bounded census JSON refusal")
    temporary = path.with_name(path.stem + ".pending.json")
    with temporary.open("wb") as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)


def pinned_download(opener=urllib.request.urlopen):
    with opener(URL, timeout=25) as response:
        if response.geturl() != URL or response.status != 200:
            raise ValueError("official header origin/response refusal")
        size = response.headers.get("Content-Length")
        if size is not None and (not size.isdecimal() or int(size) != ARCHIVE_BYTES):
            raise ValueError("official header content-length refusal")
        raw = response.read(ARCHIVE_BYTES + 1)
    if len(raw) != ARCHIVE_BYTES or sha(raw) != ARCHIVE_SHA:
        raise ValueError("official header exact bytes/hash refusal")
    return raw


def census(raw, checkpoint=None):
    if len(raw) != ARCHIVE_BYTES or sha(raw) != ARCHIVE_SHA:
        raise ValueError("pinned header archive required")
    result = {"schema": "bw.direct-v8.header-census.v1",
              "status": "INCOMPLETE_DATA_ONLY", "firstFailure": None,
              "archiveName": NAME, "archiveSha256": ARCHIVE_SHA,
              "archiveBytes": ARCHIVE_BYTES,
              "limits": {"legacyRegularTotalDecimal": LEGACY_TOTAL,
                         "legacyMemberDecimal": LEGACY_MEMBER,
                         "memberCount": MAX_MEMBERS,
                         "dataOnlyTotalBytes": DATA_TOTAL,
                         "resultBytes": MAX_RESULT},
              "memberCount": 0, "regularBytes": 0,
              "firstLegacyRefusal": None, "duplicateCount": 0,
              "duplicatesTruncated": False, "duplicates": [], "members": []}
    regular_seen = set()
    count = 0
    total = 0
    estimated_json_bytes = 2048
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:xz") as archive:
            for index, member in enumerate(archive):
                count += 1
                prior = legacy_predicate(index, member, total, regular_seen)
                if prior and result["firstLegacyRefusal"] is None:
                    result["firstLegacyRefusal"] = {"index": index,
                                                    "rawName": member.name[:MAX_NAME],
                                                    "predicate": prior,
                                                    "regularBytesBefore": total,
                                                    "declaredBytes": member.size}
                if len(member.name) > MAX_NAME:
                    raise ValueError("data-only member name ceiling")
                record = {"index": index, "rawName": member.name,
                          "kind": "directory" if member.isdir() else
                                  "regular" if member.isfile() else "other",
                          "declaredBytes": member.size, "sha256": None,
                          "regularBytesAfter": total}
                if member.isfile():
                    if member.name in regular_seen:
                        result["duplicateCount"] += 1
                        if len(result["duplicates"]) < 128:
                            result["duplicates"].append({"index": index,
                                                         "rawName": member.name})
                            estimated_json_bytes += len(member.name) + 50
                        else:
                            result["duplicatesTruncated"] = True
                    regular_seen.add(member.name)
                    if index >= MAX_MEMBERS or member.size < 0 or \
                            member.size > LEGACY_MEMBER or total + member.size > DATA_TOTAL:
                        result["members"].append(record)
                        raise ValueError("data-only member count/size/total ceiling")
                    stream = archive.extractfile(member)
                    digest = hashlib.sha256()
                    size = 0
                    while size <= LEGACY_MEMBER:
                        block = stream.read(min(65536, LEGACY_MEMBER + 1 - size))
                        if not block:
                            break
                        digest.update(block)
                        size += len(block)
                    if size != member.size:
                        result["members"].append(record)
                        raise ValueError("truncated or overlong regular member")
                    total += size
                    record["sha256"] = digest.hexdigest()
                    record["regularBytesAfter"] = total
                elif index >= MAX_MEMBERS:
                    result["members"].append(record)
                    raise ValueError("data-only member count ceiling")
                result["members"].append(record)
                estimated_json_bytes += len(json.dumps(record, separators=(",", ":"))) + 2
                result["memberCount"] = count
                result["regularBytes"] = total
                if (checkpoint is not None and
                        (count % 100 == 0 or total // 1_000_000 !=
                         (total - (member.size if member.isfile() else 0)) // 1_000_000)):
                    checkpoint({key: result[key] for key in (
                        "schema", "status", "memberCount", "regularBytes",
                        "firstLegacyRefusal")})
                # Conservative incremental bound avoids quadratic reencoding.
                if estimated_json_bytes > MAX_RESULT - 65_536:
                    raise ValueError("data-only report byte ceiling")
        if result["firstLegacyRefusal"] is None and not REQUIRED.issubset(regular_seen):
            result["firstLegacyRefusal"] = {
                "index": count, "rawName": None,
                "predicate": "required-header-members-missing",
                "regularBytesBefore": total, "declaredBytes": None,
                "missing": sorted(REQUIRED - regular_seen)}
        result["status"] = "COMPLETE_DATA_ONLY"
    except Exception as error:
        result["status"] = "PARTIAL_DATA_ONLY"
        result["firstFailure"] = {"type": type(error).__name__,
                                  "reason": str(error)[:180]}
    result["memberCount"] = count
    result["regularBytes"] = total
    return result


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: header-census.py OWNED_EVIDENCE_DIR")
    evidence = Path(sys.argv[1])
    if not evidence.is_dir() or evidence.is_symlink() or \
            (evidence / "census.json").exists():
        raise ValueError("new ordinary evidence destination required")
    progress = evidence / "census-progress.json"
    report = {"schema": "bw.direct-v8.header-census.v1",
              "status": "INCOMPLETE_DATA_ONLY", "firstFailure": None,
              "memberCount": 0, "regularBytes": 0, "firstLegacyRefusal": None}
    write_json(progress, report, 16_384)
    try:
        source_raw = read_bounded(evidence / "source.json", 32_000)
        source = json.loads(source_raw)
        if source != source_identity() or source.get("head") != os.environ.get("BW_EXPECTED_HEAD"):
            raise ValueError("reviewed source receipt mismatch")
        raw = pinned_download()
        report = census(raw, lambda row: write_json(progress, row, 16_384))
        report["sourceReceiptSha256"] = sha(source_raw)
        if source != source_identity() or sha(read_bounded(evidence / "source.json", 32_000)) != \
                report["sourceReceiptSha256"]:
            raise ValueError("source changed during data-only census")
    except BaseException as error:
        report["status"] = "PARTIAL_DATA_ONLY"
        if report["firstFailure"] is None:
            report["firstFailure"] = {"type": type(error).__name__,
                                      "reason": str(error)[:180]}
        else:
            report["laterFailure"] = {"type": type(error).__name__,
                                      "reason": str(error)[:180]}
    write_json(evidence / "census.json", report, MAX_RESULT)
    write_json(progress, {key: report[key] for key in (
        "schema", "status", "memberCount", "regularBytes",
        "firstLegacyRefusal", "firstFailure")}, 16_384)
    if report["status"] != "COMPLETE_DATA_ONLY":
        raise RuntimeError("header census partial; original report retained")


if __name__ == "__main__":
    main()
