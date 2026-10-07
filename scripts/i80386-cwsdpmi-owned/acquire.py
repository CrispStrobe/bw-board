#!/usr/bin/env python3
"""Inventory candidate archives without extracting or executing their contents."""

from __future__ import annotations

import hashlib
import io
import json
import os
import stat
import sys
import tarfile
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath


CWSDPMI_URL = ("https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/"
               "repositories/1.4/tools/cwsdpmi.zip")
CWSDPMI_CATALOG = ("https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/"
                   "repositories/1.4/html/en/tools/cwsdpmi/20250318.2/index.html")
CWSDPMI_BYTES = 163_241
CWSDPMI_SHA1 = "e1d5569817019bbde41eceeeb0a8bed78e87be28"
TOOL_REPO = "andrewwutw/build-djgpp"
TOOL_TAG = "v3.4"
TOOL_TAG_COMMIT = "0dc28365825f853c3cc6ad0d8f10f8570bed5828"
TOOL_RELEASE_ID = 108164145
TOOL_ASSET_ID = 112331481
TOOL_ASSET = "djgpp-linux64-gcc1220.tar.bz2"
TOOL_BYTES = 80_596_981
TOOL_URL = f"https://github.com/{TOOL_REPO}/releases/download/{TOOL_TAG}/{TOOL_ASSET}"
TOOL_ASSET_API = f"https://api.github.com/repos/{TOOL_REPO}/releases/assets/{TOOL_ASSET_ID}"
MAX_MEMBERS = 30_000
MAX_FILE = 256 << 20
MAX_TOTAL = 3 << 30
MAX_NOTICE = 32 << 10
MAX_NOTICES = 256 << 10


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def name_check(name: str) -> str:
    if (not name or len(name) > 240 or "\\" in name or "\x00" in name or
            name.startswith("/") or any(ord(ch) < 32 for ch in name)):
        raise ValueError("archive path shape")
    while name.startswith("./"):
        name = name[2:]
    parts = name.rstrip("/").split("/")
    if (not parts or ":" in parts[0] or
            any(part in ("", ".", "..") for part in parts)):
        raise ValueError("archive path traversal")
    return "/".join(parts)


def link_check(member: str, target: str, hard: bool) -> str:
    if (not target or target.startswith("/") or "\\" in target or "\x00" in target or
            any(ord(ch) < 32 for ch in target) or ":" in target.split("/")[0]):
        raise ValueError("archive link target")
    stack = [] if hard else member.split("/")[:-1]
    for part in target.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not stack:
                raise ValueError("archive link escape")
            stack.pop()
        else:
            stack.append(part)
    if not stack:
        raise ValueError("archive link root")
    return "/".join(stack)


def notice(name: str) -> bool:
    base = PurePosixPath(name).name.lower()
    return base.startswith(("license", "licence", "copying", "copyright", "manifest"))


def text_notice(raw: bytes | None) -> bool:
    if raw is None or b"\x00" in raw:
        return False
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return all(ch.isprintable() or ch in "\t\r\n" for ch in text)


def read_bounded(stream, size: int) -> tuple[str, bytes | None]:
    if size < 0 or size > MAX_FILE:
        raise ValueError("archive member cap")
    digest = hashlib.sha256()
    remaining = size
    saved = bytearray() if size <= MAX_NOTICE else None
    while remaining:
        chunk = stream.read(min(1 << 20, remaining))
        if not chunk:
            raise ValueError("archive truncated member")
        digest.update(chunk)
        if saved is not None:
            saved.extend(chunk)
        remaining -= len(chunk)
    if stream.read(1):
        raise ValueError("archive oversized member")
    return digest.hexdigest(), bytes(saved) if saved is not None else None


def inventory_zip(raw: bytes) -> tuple[list[dict], dict[str, bytes]]:
    members, notices, seen, total = [], {}, set(), 0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            if len(members) >= MAX_MEMBERS:
                raise ValueError("archive member count")
            name = name_check(entry.filename)
            if name in seen:
                raise ValueError("duplicate archive path")
            seen.add(name)
            mode = (entry.external_attr >> 16) & 0xffff
            if entry.flag_bits & 1 or stat.S_ISLNK(mode):
                raise ValueError("encrypted or linked ZIP member")
            if entry.is_dir():
                members.append({"path": name, "type": "directory", "bytes": 0})
                continue
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                raise ValueError("special ZIP member")
            total += entry.file_size
            if total > MAX_TOTAL or entry.compress_size == 0 and entry.file_size:
                raise ValueError("ZIP expansion cap")
            if entry.file_size > max(1, entry.compress_size) * 1000:
                raise ValueError("ZIP expansion ratio")
            with archive.open(entry) as stream:
                digest, saved = read_bounded(stream, entry.file_size)
            members.append({"path": name, "type": "file", "bytes": entry.file_size,
                            "sha256": digest})
            if notice(name) and text_notice(saved) and sum(map(len, notices.values())) + len(saved) <= MAX_NOTICES:
                notices[name] = saved
    return members, notices


def inventory_tar(raw: bytes) -> tuple[list[dict], dict[str, bytes]]:
    members, notices, seen, total = [], {}, set(), 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r|bz2") as archive:
        for entry in archive:
            if len(members) >= MAX_MEMBERS:
                raise ValueError("archive member count")
            if entry.name in (".", "./") and entry.isdir():
                if "." in seen:
                    raise ValueError("duplicate archive root")
                seen.add(".")
                members.append({"path": ".", "type": "root-directory", "bytes": 0})
                continue
            name = name_check(entry.name)
            if name in seen:
                raise ValueError("duplicate archive path")
            seen.add(name)
            if entry.isfile():
                total += entry.size
                if total > MAX_TOTAL:
                    raise ValueError("archive total cap")
                stream = archive.extractfile(entry)
                if stream is None:
                    raise ValueError("archive missing file")
                with stream:
                    digest, saved = read_bounded(stream, entry.size)
                members.append({"path": name, "type": "file", "bytes": entry.size,
                                "sha256": digest})
                if notice(name) and text_notice(saved) and sum(map(len, notices.values())) + len(saved) <= MAX_NOTICES:
                    notices[name] = saved
            elif entry.isdir():
                members.append({"path": name, "type": "directory", "bytes": 0})
            elif entry.issym() or entry.islnk():
                resolved = link_check(name, entry.linkname, entry.islnk())
                members.append({"path": name, "type": "hardlink" if entry.islnk() else "symlink",
                                "target": entry.linkname, "resolved": resolved, "bytes": 0})
            else:
                raise ValueError("special TAR member")
    by_path = {entry["path"]: entry for entry in members}
    for entry in members:
        if entry["type"] not in ("symlink", "hardlink"):
            continue
        target = entry["resolved"]
        traversed = {entry["path"]}
        for _ in range(32):
            resolved = by_path.get(target)
            if resolved is None or target in traversed:
                raise ValueError("missing or cyclic archive link")
            if resolved["type"] not in ("symlink", "hardlink"):
                if entry["type"] == "hardlink" and resolved["type"] != "file":
                    raise ValueError("hardlink to nonfile")
                break
            traversed.add(target)
            target = resolved["resolved"]
        else:
            raise ValueError("archive link chain cap")
    return members, notices


def validate_metadata(catalog: bytes, release: dict, tag: dict) -> dict:
    class Text(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.parts = []

        def handle_data(self, data: str) -> None:
            self.parts.append(data)

    parser = Text()
    parser.feed(catalog.decode("utf-8"))
    compact = "".join("".join(parser.parts).split()).lower()
    if ("gnugeneralpubliclicense,version2" not in compact or
            CWSDPMI_SHA1 not in compact or "163,241bytes" not in compact or
            "cwsdpmi.zip" not in compact):
        raise ValueError("CWSDPMI catalog mismatch")
    if (release.get("id") != TOOL_RELEASE_ID or release.get("tag_name") != TOOL_TAG or
            release.get("draft") or
            release.get("prerelease")):
        raise ValueError("cross-toolchain release")
    matches = [a for a in release.get("assets", []) if a.get("id") == TOOL_ASSET_ID]
    if (len(matches) != 1 or matches[0].get("name") != TOOL_ASSET or
            matches[0].get("size") != TOOL_BYTES or matches[0].get("state") != "uploaded" or
            matches[0].get("browser_download_url") != TOOL_URL or
            matches[0].get("url") != TOOL_ASSET_API):
        raise ValueError("cross-toolchain asset metadata")
    if (tag.get("ref") != f"refs/tags/{TOOL_TAG}" or
            tag.get("object", {}).get("sha") != TOOL_TAG_COMMIT or
            tag.get("object", {}).get("type") != "commit"):
        raise ValueError("cross-toolchain tag identity")
    return {"catalogSha256": sha(catalog), "releaseAssetId": TOOL_ASSET_ID,
            "releaseId": TOOL_RELEASE_ID, "tagCommit": TOOL_TAG_COMMIT}


def acquire(cws: bytes, tool: bytes, catalog: bytes, release: dict, tag: dict) -> tuple[dict, dict[str, bytes]]:
    metadata = validate_metadata(catalog, release, tag)
    if len(cws) != CWSDPMI_BYTES or hashlib.sha1(cws).hexdigest() != CWSDPMI_SHA1:
        raise ValueError("CWSDPMI published size/SHA1 mismatch")
    if len(tool) != TOOL_BYTES:
        raise ValueError("toolchain published size mismatch")
    cws_members, cws_notices = inventory_zip(cws)
    tool_members, tool_notices = inventory_tar(tool)
    report = {"schema": "bw.cwsdpmi-owned.acquisition-candidate.v1",
              "status": "CANDIDATE_BYTES_ONLY_UNREVIEWED_COMPONENT_LICENSES",
              "cwsdpmi": {"url": CWSDPMI_URL, "catalog": CWSDPMI_CATALOG,
                           "bytes": len(cws), "sha1": CWSDPMI_SHA1, "sha256": sha(cws),
                           "members": cws_members},
              "toolchain": {"url": TOOL_URL, "repository": TOOL_REPO, "tag": TOOL_TAG,
                            "assetId": TOOL_ASSET_ID, "bytes": len(tool), "sha256": sha(tool),
                            "members": tool_members}, "metadata": metadata,
              "notices": {"cwsdpmi": sorted(cws_notices), "toolchain": sorted(tool_notices)}}
    notice_files = {**{f"cwsdpmi/{n}": b for n, b in cws_notices.items()},
                    **{f"toolchain/{n}": b for n, b in tool_notices.items()}}
    return report, notice_files


def input_bytes(path: str, cap: int) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > cap:
            raise ValueError("input type or compressed cap")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            raw = stream.read(cap + 1)
        if len(raw) > cap or len(raw) != metadata.st_size:
            raise ValueError("input changed or cap")
        return raw
    finally:
        os.close(descriptor)


def strict_json(raw: bytes) -> dict:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate metadata key")
            result[key] = value
        return result

    value = json.loads(raw, object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite metadata")))
    if not isinstance(value, dict):
        raise ValueError("metadata object")
    return value


def main() -> None:
    if len(sys.argv) != 7:
        raise SystemExit("usage: acquire.py cws.zip tool.tar.bz2 catalog.html release.json tag.json output-dir")
    output = Path(sys.argv[6])
    try:
        cws = input_bytes(sys.argv[1], 1 << 20)
        tool = input_bytes(sys.argv[2], 100 << 20)
        catalog_raw = input_bytes(sys.argv[3], 200_000)
        release_raw = input_bytes(sys.argv[4], 200_000)
        tag_raw = input_bytes(sys.argv[5], 200_000)
        release, tag = strict_json(release_raw), strict_json(tag_raw)
        validate_metadata(catalog_raw, release, tag)
        metadata_raw = {"catalog.html": catalog_raw, "release.json": release_raw,
                        "tag.json": tag_raw}
        for name, raw in metadata_raw.items():
            with (output / name).open("xb") as stream:
                stream.write(raw)
        report, notices = acquire(cws, tool, catalog_raw, release, tag)
        report["metadata"]["originalFiles"] = {
            name: {"bytes": len(raw), "sha256": sha(raw)} for name, raw in metadata_raw.items()}
        with (output / "acquisition.json").open("x", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2, sort_keys=True)
            stream.write("\n")
        notice_root = output / "notices"
        for name, raw in notices.items():
            path = notice_root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as stream:
                stream.write(raw)
    except Exception as error:
        failure = {"schema": "bw.cwsdpmi-owned.acquisition-failure.v1",
                   "stage": "inventory", "error": type(error).__name__,
                   "message": str(error)[:240]}
        (output / "failure.json").write_text(json.dumps(failure, indent=2) + "\n")
        raise


if __name__ == "__main__":
    main()
