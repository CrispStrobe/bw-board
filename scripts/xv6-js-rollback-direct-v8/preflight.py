#!/usr/bin/env python3
"""Hosted report-only authority preflight. Never builds, loads, or runs a guest."""
import hashlib
import base64
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import sys
import tarfile
import urllib.request

from build import ARGS, run_bounded
from header_budget import HEADER_TOTAL_LIMIT, within_header_budget

NODE_NAME = "node-v20.20.2-linux-x64.tar.xz"
NODE_SHA = "df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d"
HEADER_NAME = "node-v20.20.2-headers.tar.xz"
HEADER_SHA = "46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836"
ORIGIN = "https://nodejs.org/dist/v20.20.2/"
MAX_NODE_ARCHIVE = 32 * 1024 * 1024
MAX_NODE_BINARY = 110 * 1024 * 1024
MAX_HEADERS_ARCHIVE = 1_000_000
MAX_HEADER_TOTAL = HEADER_TOTAL_LIMIT
MAX_MEMBERS = 20_000
MAX_TOOL = 100 * 1024 * 1024
TOOLS = ("g++", "cc1plus", "collect2", "as", "ld")


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ProbeFailure(ValueError):
    def __init__(self, reason, receipt):
        super().__init__(reason)
        self.receipt = receipt


def source_identity():
    path = Path(__file__).with_name("preflight-source.py")
    spec = importlib.util.spec_from_file_location("direct_v8_authority_source", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.identity()


def read_bounded(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit:
            raise ValueError("bounded ordinary receipt required")
        raw = bytearray()
        while len(raw) <= limit:
            block = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not block:
                break
            raw.extend(block)
        if len(raw) != info.st_size:
            raise ValueError("receipt changed while reading")
        return bytes(raw)
    finally:
        os.close(fd)


def bounded_download(name, limit, opener=urllib.request.urlopen):
    if name not in (NODE_NAME, HEADER_NAME):
        raise ValueError("unreviewed download role")
    url = ORIGIN + name
    with opener(url, timeout=25) as response:
        if response.geturl() != url or response.status != 200:
            raise ValueError("archive origin or response changed")
        size = response.headers.get("Content-Length")
        if size is not None and (not size.isdecimal() or int(size) > limit):
            raise ValueError("archive length refused")
        raw = response.read(limit + 1)
    if not raw or len(raw) > limit:
        raise ValueError("archive bound refused")
    return raw


def archive_records(raw, expected_sha, role):
    if role not in ("node", "headers") or sha(raw) != expected_sha:
        raise ValueError("official archive digest mismatch")
    wanted = "node-v20.20.2-linux-x64/bin/node"
    prefix = "node-v20.20.2" if role == "headers" else "node-v20.20.2-linux-x64"
    selected = None
    members = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:xz") as archive:
        for index, member in enumerate(archive):
            if index >= MAX_MEMBERS:
                raise ValueError("archive member count refused")
            name = PurePosixPath(member.name)
            if (name.is_absolute() or ".." in name.parts or not name.parts or
                    name.parts[0] != prefix or len(name.parts) > 16):
                raise ValueError("archive member path refused")
            if role == "headers":
                if member.isdir():
                    continue
                if not member.isfile() or member.size < 0 or member.size > 2_000_000:
                    raise ValueError("header member type or size refused")
                total += member.size
                if not within_header_budget(total) or member.name in members:
                    raise ValueError("header closure refused")
                data = archive.extractfile(member).read(member.size + 1)
                if len(data) != member.size:
                    raise ValueError("truncated header member")
                members[member.name] = {"bytes": len(data), "sha256": sha(data)}
            elif member.name == wanted:
                if selected is not None or not member.isfile() or not 0 < member.size <= MAX_NODE_BINARY:
                    raise ValueError("node executable member refused")
                selected = archive.extractfile(member).read(member.size + 1)
                if len(selected) != member.size:
                    raise ValueError("truncated node executable")
    if role == "headers":
        if not {prefix + "/include/node/node.h", prefix + "/include/node/v8-profiler.h"}.issubset(members):
            raise ValueError("required header members missing")
        return {"archiveSha256": expected_sha, "archiveBytes": len(raw),
                "memberCount": len(members), "members": members,
                "totalMemberBytes": total}
    if selected is None:
        raise ValueError("node executable missing")
    return selected


def pinned_file(path, limit=MAX_TOOL):
    path = Path(path).resolve(strict=True)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
        raise ValueError("tool target type or size refused")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino, opened.st_size) != (before.st_dev, before.st_ino, before.st_size):
            raise ValueError("tool target changed before read")
        digest = hashlib.sha256()
        count = 0
        while True:
            block = os.read(fd, min(65536, limit + 1 - count))
            if not block:
                break
            digest.update(block)
            count += len(block)
            if count > limit:
                raise ValueError("tool target grew")
    finally:
        os.close(fd)
    after = path.stat()
    if count != before.st_size or (after.st_dev, after.st_ino, after.st_size,
            after.st_mtime_ns) != (before.st_dev, before.st_ino, before.st_size,
            before.st_mtime_ns):
        raise ValueError("tool target changed during read")
    return {"realpath": str(path), "bytes": count, "sha256": digest.hexdigest(),
            "device": before.st_dev, "inode": before.st_ino}


def probe(argv, cwd, timeout=10, display_argv=None):
    result = run_bounded(argv, cwd, timeout)
    raw = result["stdout"]
    receipt = {"argv": display_argv if display_argv is not None else argv,
               "exitCode": result["exitCode"], "timedOut": result["timedOut"],
               "outputBound": result["outputBound"], "complete": result["complete"],
               "stdout": {"bytes": len(raw), "sha256": sha(raw),
                          "base64": base64.b64encode(raw).decode("ascii")},
               "stderr": {"bytes": len(result["stderr"]),
                          "sha256": sha(result["stderr"]),
                          "base64": base64.b64encode(result["stderr"]).decode("ascii")}}
    if (result["exitCode"] != 0 or result["timedOut"] or
            result["outputBound"] or not result["complete"] or result["stderr"]):
        raise ProbeFailure("bounded tool probe refused", receipt)
    if not raw or len(raw) > 4096 or b"\0" in raw:
        raise ProbeFailure("tool probe output refused", receipt)
    try:
        receipt["stdoutText"] = raw.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise ProbeFailure("tool probe UTF-8 refused", receipt) from error
    return receipt


def resolved_tool(name, compiler, compiler_identity, work):
    if pinned_file(compiler) != compiler_identity:
        raise ValueError("compiler changed before tool locator")
    if name == "g++":
        path = compiler
        locator = None
    else:
        locator = probe([compiler, "-print-prog-name=" + name], work)
        if pinned_file(compiler) != compiler_identity:
            raise ValueError("compiler changed across tool locator")
        value = locator["stdoutText"].strip()
        if not value or "\n" in value or "\r" in value:
            raise ValueError("compiler subtool path refused")
        path = value if os.path.isabs(value) else shutil.which(value)
        if not path:
            raise ValueError("compiler subtool missing")
    before = pinned_file(path)
    if name == "g++" and before != compiler_identity:
        raise ValueError("compiler changed before version probe")
    version = probe([before["realpath"], "--version"], work)
    after = pinned_file(path)
    if before != after:
        raise ValueError("compiler tool changed across probe")
    return {"identity": before, "version": version, "locator": locator}


def recheck_tools(tools):
    for name in TOOLS:
        if name not in tools or pinned_file(tools[name]["identity"]["realpath"]) != \
                tools[name]["identity"]:
            raise ValueError("recorded tool set changed")


def write_receipt(path, data):
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > 250_000:
        raise ValueError("preflight receipt bound")
    pending = path.with_name("preflight.pending.json")
    with pending.open("wb") as out:
        out.write(encoded)
        out.flush()
        os.fsync(out.fileno())
    os.replace(pending, path)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: preflight.py OWNED_WORKDIR OWNED_REPORT_DIR")
    work, evidence = (Path(arg) for arg in sys.argv[1:])
    if work.exists() or work == evidence or not evidence.is_dir() or evidence.is_symlink():
        raise ValueError("owned preflight directories required")
    work.mkdir(mode=0o700, parents=False)
    report_path = evidence / "preflight.json"
    if report_path.exists() or (evidence / "preflight.pending.json").exists():
        raise ValueError("preflight receipt already exists")
    report = {"schema": "bw.direct-v8.authority-preflight.v1",
              "status": "INCOMPLETE_UNQUALIFIED", "firstFailure": None,
              "nodeArchive": None, "headersArchive": None, "nodeExecutable": None,
              "nodeProbes": None, "tools": {}, "sourceReceiptSha256": None,
              "failedProbe": None,
              "plannedBuildArguments": ARGS,
              "host": {"imageOS": os.environ.get("ImageOS"),
                       "imageVersion": os.environ.get("ImageVersion"),
                       "runnerOS": os.environ.get("RUNNER_OS"),
                       "runnerArch": os.environ.get("RUNNER_ARCH"),
                       "platform": sys.platform, "machine": platform.machine(),
                       "python": platform.python_version()}}
    write_receipt(report_path, report)
    try:
        source_raw = read_bounded(evidence / "source.json", 32_000)
        source = json.loads(source_raw)
        if (type(source) is not dict or
                source.get("schema") != "bw.direct-v8.authority-preflight-source.v1" or
                source.get("head") != os.environ.get("BW_EXPECTED_HEAD") or
                source.get("qualification") != "REPORT_ONLY_NO_BUILD_OR_NATIVE_CONTROL"):
            raise ValueError("source admission receipt mismatch")
        if source != source_identity():
            raise ValueError("source receipt differs from independently recomputed Git identity")
        report["sourceReceiptSha256"] = sha(source_raw)
        write_receipt(report_path, report)
        if report["host"]["imageOS"] != "ubuntu24" or not report["host"]["imageVersion"]:
            raise ValueError("GitHub runner image identity unavailable")
        node_raw = bounded_download(NODE_NAME, MAX_NODE_ARCHIVE)
        report["nodeArchive"] = {"name": NODE_NAME, "expectedSha256": NODE_SHA,
                                 "observedSha256": sha(node_raw),
                                 "bytes": len(node_raw), "url": ORIGIN + NODE_NAME}
        write_receipt(report_path, report)
        node_bytes = archive_records(node_raw, NODE_SHA, "node")
        node_path = work / "node"
        with node_path.open("xb") as out:
            out.write(node_bytes)
        node_path.chmod(0o500)
        node_identity = pinned_file(node_path, MAX_NODE_BINARY)
        report["nodeExecutable"] = {"role": "owned-work/node",
                                    "sha256": node_identity["sha256"],
                                    "bytes": node_identity["bytes"]}
        write_receipt(report_path, report)
        headers_raw = bounded_download(HEADER_NAME, MAX_HEADERS_ARCHIVE)
        report["headersArchive"] = {"name": HEADER_NAME,
                                    "expectedSha256": HEADER_SHA,
                                    "observedSha256": sha(headers_raw),
                                    "bytes": len(headers_raw),
                                    "url": ORIGIN + HEADER_NAME}
        write_receipt(report_path, report)
        report["headersArchive"] = archive_records(headers_raw, HEADER_SHA, "headers")
        report["headersArchive"]["name"] = HEADER_NAME
        report["headersArchive"]["url"] = ORIGIN + HEADER_NAME
        write_receipt(report_path, report)
        report["nodeProbes"] = []
        report["nodeProbes"].append(probe(
            [str(node_path), "--version"], work,
            display_argv=["owned-work/node", "--version"]))
        write_receipt(report_path, report)
        report["nodeProbes"].append(probe(
            [str(node_path), "-p", "process.versions.v8"], work,
            display_argv=["owned-work/node", "-p", "process.versions.v8"]))
        write_receipt(report_path, report)
        if report["nodeProbes"][0]["stdoutText"].strip() != "v20.20.2":
            raise ValueError("Node executable version mismatch")
        if not report["nodeProbes"][1]["stdoutText"].strip():
            raise ValueError("V8 version unavailable")
        if pinned_file(node_path, MAX_NODE_BINARY) != node_identity:
            raise ValueError("Node executable changed across probes")
        compiler = shutil.which("g++")
        if not compiler:
            raise ValueError("compiler unavailable")
        compiler_identity = pinned_file(compiler)
        compiler = compiler_identity["realpath"]
        for name in TOOLS:
            report["tools"][name] = resolved_tool(name, compiler,
                                                   compiler_identity, work)
            write_receipt(report_path, report)
        recheck_tools(report["tools"])
        if sha(read_bounded(evidence / "source.json", 32_000)) != report["sourceReceiptSha256"]:
            raise ValueError("source receipt changed during preflight")
        if source != source_identity():
            raise ValueError("reviewed Git source changed during preflight")
        report["status"] = "IDENTITIES_RECORDED_UNQUALIFIED"
    except BaseException as error:
        if isinstance(error, ProbeFailure):
            report["failedProbe"] = error.receipt
        report["firstFailure"] = {"type": type(error).__name__,
                                  "reason": str(error)[:200]}
        write_receipt(report_path, report)
        raise
    write_receipt(report_path, report)


if __name__ == "__main__":
    main()
