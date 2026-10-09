#!/usr/bin/env python3
"""Hosted-only direct V8 addon build from the pinned public Node header archive.

No download is performed here. A caller must independently admit the matching
Node executable and retain this script's report before loading the .node file.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile

HEADER_SHA = "46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836"
HEADER_NAME = "node-v20.20.2-headers.tar.xz"
MAX_ARCHIVE = 1_000_000
MAX_UNPACKED = 32_000_000
MAX_MEMBERS = 4096
ARGS = ["-std=c++17", "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
        "-Werror", "-DNODE_GYP_MODULE_NAME=rollback_sampler", "-I", "include/node",
        "addon.cc", "-o", "rollback_sampler.node"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_bounded(path, limit):
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise ValueError("bounded input exceeded")
    return data


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: build.py PINNED_HEADERS.tar.xz OWNED_WORKDIR REPORT.json")
    archive, work, report = map(Path, sys.argv[1:])
    if archive.name != HEADER_NAME or work.exists() or report.exists():
        raise ValueError("new owned build inputs required")
    raw = read_bounded(archive, MAX_ARCHIVE)
    if sha(raw) != HEADER_SHA:
        raise ValueError("official Node header archive hash mismatch")
    work.mkdir(mode=0o700, parents=False)
    source = Path(__file__).with_name("addon.cc")
    source_bytes = read_bounded(source, 256_000)
    (work / "addon.cc").write_bytes(source_bytes)
    total = 0
    members = {}
    with tarfile.open(fileobj=__import__("io").BytesIO(raw), mode="r:xz") as tar:
        for index, member in enumerate(tar):
            if index >= MAX_MEMBERS or not (member.isfile() or member.isdir()):
                raise ValueError("header archive member refused")
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or not name.parts or \
                    name.parts[0] != "node-v20.20.2" or len(name.parts) > 12:
                raise ValueError("header archive path refused")
            if member.isdir():
                continue
            total += member.size
            if total > MAX_UNPACKED or member.size > 2_000_000 or \
                    member.name in members:
                raise ValueError("header archive bounds refused")
            data = tar.extractfile(member).read(member.size + 1)
            if len(data) != member.size:
                raise ValueError("truncated header member")
            # The archive prefix is discarded only after exact archive binding.
            relative = Path(*name.parts[1:])
            dest = work / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("xb") as out:
                out.write(data)
            members[str(relative)] = sha(data)
    if not (work / "include/node/node.h").is_file() or \
            not (work / "include/node/v8-profiler.h").is_file():
        raise ValueError("pinned header tree incomplete")
    compiler = shutil.which("g++")
    if not compiler:
        raise ValueError("host compiler missing")
    version = subprocess.run([compiler, "--version"], check=True, timeout=10,
                             capture_output=True, text=True).stdout.splitlines()[0]
    result = subprocess.run([compiler, *ARGS], cwd=work, timeout=90,
                            capture_output=True, text=True)
    if result.returncode or result.stderr:
        raise RuntimeError("compiler refused source or emitted diagnostics")
    binary = read_bounded(work / "rollback_sampler.node", 2_000_000)
    receipt = {
        "schema": "bw.direct-v8.build.v1", "nodeVersion": "20.20.2",
        "headersArchiveSha256": HEADER_SHA, "headers": members,
        "sourceSha256": sha(source_bytes), "compiler": Path(compiler).name,
        "compilerVersion": version, "arguments": ARGS,
        "addonSha256": sha(binary), "addonBytes": len(binary),
    }
    encoded = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > 200_000:
        raise ValueError("build receipt exceeded bound")
    with report.open("xb") as out:
        out.write(encoded)


if __name__ == "__main__":
    main()
