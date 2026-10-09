#!/usr/bin/env python3
"""Hosted-only direct V8 addon build from the pinned public Node header archive.

No download is performed here. A caller must independently admit the matching
Node executable and retain this script's report before loading the .node file.
"""
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import selectors
import shutil
import signal
import subprocess
import sys
import tarfile
import time

from header_budget import HEADER_TOTAL_LIMIT, within_header_budget

HEADER_SHA = "46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836"
HEADER_NAME = "node-v20.20.2-headers.tar.xz"
MAX_ARCHIVE = 1_000_000
MAX_UNPACKED = HEADER_TOTAL_LIMIT
MAX_MEMBERS = 4096
MAX_OUTPUT = 32768
ARGS = ["-std=c++17", "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
        "-Werror", "-DNODE_GYP_MODULE_NAME=rollback_sampler", "-isystem", "include/node",
        "addon.cc", "-o", "rollback_sampler.node"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_bounded(path, limit):
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise ValueError("bounded input exceeded")
    return data


def run_bounded(argv, cwd, timeout):
    """Drain both pipes with a fixed cap; stop only the owned child group."""
    process = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    collected = {"stdout": bytearray(), "stderr": bytearray()}
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    deadline = time.monotonic() + timeout
    timed_out = False
    output_bound = False
    pipes_complete = False
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            for key, _ in selector.select(min(remaining, 0.5)):
                part = os.read(key.fd, 4096)
                if not part:
                    selector.unregister(key.fileobj)
                    continue
                output = collected[key.data]
                room = MAX_OUTPUT - sum(len(v) for v in collected.values())
                output.extend(part[:max(0, room)])
                if len(part) > room:
                    output_bound = True
                    break
            if output_bound:
                break
        pipes_complete = not selector.get_map()
        if not timed_out and not output_bound:
            try:
                process.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                timed_out = True
    finally:
        selector.close()
        # The leader may have exited while descendants still hold the pipes.
        # The process group is task-owned because Popen created a new session.
        if timed_out or output_bound:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            time.sleep(0.1)
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process.poll() is None:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
        else:
            process.wait()
        process.stdout.close()
        process.stderr.close()
    return {"exitCode": process.returncode, "timedOut": timed_out,
            "outputBound": output_bound,
            "complete": pipes_complete and not timed_out and not output_bound,
            "stdout": bytes(collected["stdout"]),
            "stderr": bytes(collected["stderr"])}


def diagnostic(raw, complete):
    return {"observedSha256": sha(raw), "observedBytes": len(raw),
            "observedBase64": base64.b64encode(raw).decode("ascii"),
            "complete": complete}


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
            if not within_header_budget(total) or member.size > 2_000_000 or \
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
    version_result = run_bounded([compiler, "--version"], work, 10)
    version_ok = (version_result["exitCode"] == 0 and
                  not version_result["timedOut"] and
                  not version_result["outputBound"] and
                  bool(version_result["stdout"]))
    version = (version_result["stdout"].decode("utf-8", "replace").splitlines()[0]
               if version_ok else None)
    result = (run_bounded([compiler, *ARGS], work, 90) if version_ok else
              {"exitCode": None, "timedOut": False, "outputBound": False,
               "complete": False, "stdout": b"", "stderr": b""})
    passed = (version_ok and result["exitCode"] == 0 and
              not result["timedOut"] and not result["outputBound"] and
              not result["stderr"])
    binary = None
    if passed:
        try:
            binary = read_bounded(work / "rollback_sampler.node", 2_000_000)
        except (FileNotFoundError, ValueError):
            passed = False
    first_failure = None
    if not version_ok:
        first_failure = "compiler-version-refusal"
    elif result["timedOut"]:
        first_failure = "compiler-timeout"
    elif result["outputBound"]:
        first_failure = "compiler-output-bound"
    elif result["exitCode"] != 0:
        first_failure = "compiler-exit"
    elif result["stderr"]:
        first_failure = "compiler-diagnostic"
    elif binary is None:
        first_failure = "addon-output-refusal"
    receipt = {
        "schema": "bw.direct-v8.build.v1", "nodeVersion": "20.20.2",
        "headersArchiveSha256": HEADER_SHA, "headers": members,
        "sourceSha256": sha(source_bytes), "compiler": Path(compiler).name,
        "compilerVersion": version, "arguments": ARGS, "passed": passed,
        "firstFailure": first_failure,
        "exitCode": result["exitCode"], "timedOut": result["timedOut"],
        "outputBound": result["outputBound"],
        "versionProbe": {"exitCode": version_result["exitCode"],
                         "timedOut": version_result["timedOut"],
                         "outputBound": version_result["outputBound"],
                         "stdout": diagnostic(version_result["stdout"],
                             version_result["complete"]),
                         "stderr": diagnostic(version_result["stderr"],
                             version_result["complete"])},
        "stdout": diagnostic(result["stdout"], result["complete"]),
        "stderr": diagnostic(result["stderr"], result["complete"]),
        "addonSha256": sha(binary) if binary is not None else None,
        "addonBytes": len(binary) if binary is not None else None,
    }
    encoded = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > 200_000:
        raise ValueError("build receipt exceeded bound")
    with report.open("xb") as out:
        out.write(encoded)
    if not passed:
        raise RuntimeError(f"{first_failure}; retained bounded build receipt")


if __name__ == "__main__":
    main()
