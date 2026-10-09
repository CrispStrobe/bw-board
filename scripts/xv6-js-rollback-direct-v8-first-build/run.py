#!/usr/bin/env python3
"""Hosted first build only: pinned inputs, one bounded compile, no addon load."""
import base64
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request

NODE_NAME = "node-v20.20.2-linux-x64.tar.xz"
NODE_SHA = "df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d"
HEADER_NAME = "node-v20.20.2-headers.tar.xz"
HEADER_SHA = "46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836"
ORIGIN = "https://nodejs.org/dist/v20.20.2/"
TOOLS = ("g++", "cc1plus", "collect2", "as", "ld")
ARGS = ["-std=c++17", "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
        "-Werror", "-DNODE_GYP_MODULE_NAME=rollback_sampler", "-isystem",
        "include/node", "addon.cc", "-o", "rollback_sampler.node"]
MAX_HEADER_TOTAL = 67_108_864
MAX_HEADER_MEMBER = 2_000_000
MAX_MEMBERS = 4096
MAX_OUTPUT = 32768
MAX_REPORT = 1 * 1024 * 1024


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def source_identity():
    path = Path(__file__).with_name("source.py")
    spec = importlib.util.spec_from_file_location("direct_v8_first_build_source", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.identity()


def read_ordinary(path, limit, allow_empty=False):
    path = Path(path)
    listed = path.lstat()
    if not stat.S_ISREG(listed.st_mode) or listed.st_size > limit or \
            (not allow_empty and listed.st_size == 0):
        raise ValueError("bounded ordinary input required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or \
                (before.st_dev, before.st_ino, before.st_size) != \
                (listed.st_dev, listed.st_ino, listed.st_size):
            raise ValueError("input replaced before read")
        chunks = bytearray()
        while len(chunks) <= limit:
            block = os.read(fd, min(65536, limit + 1 - len(chunks)))
            if not block:
                break
            chunks.extend(block)
        after = os.fstat(fd)
        listed_after = path.lstat()
        snapshot = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        if len(chunks) != before.st_size or len(chunks) > limit or \
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != snapshot or \
                (listed_after.st_dev, listed_after.st_ino, listed_after.st_size,
                 listed_after.st_mtime_ns) != snapshot:
            raise ValueError("input changed while reading")
        return bytes(chunks)
    finally:
        os.close(fd)


def pinned_target(path, limit=100 * 1024 * 1024):
    path = Path(path).resolve(strict=True)
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
        raise ValueError("tool target type or size refused")
    raw = read_ordinary(path, limit)
    after = path.stat()
    if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != \
            (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns):
        raise ValueError("tool target changed after read")
    return {"realpath": str(path), "bytes": len(raw), "sha256": sha(raw),
            "device": before.st_dev, "inode": before.st_ino}


def authority_tool(actual, expected):
    if (actual["realpath"], actual["bytes"], actual["sha256"]) != \
            (expected["realpath"], expected["bytes"], expected["sha256"]):
        raise ValueError("tool differs from audited original authority")


def checked_authority(data):
    if type(data) is not dict or set(data) != {
            "schema", "original", "nodeArchive", "nodeExecutable",
            "headersArchive", "tools", "arguments"} or \
            data["schema"] != "bw.direct-v8.first-build-authority.v1" or \
            data["arguments"] != ARGS or set(data["tools"]) != set(TOOLS):
        raise ValueError("first-build authority schema")
    origin = data["original"]
    if (origin["runId"], origin["runAttempt"], origin["conclusion"],
            origin["head"], origin["artifactId"]) != \
            (37953289876, 1, "success",
             "174767b449b1be4b3e76f41c6e44ffd46ba2edfd", 11627515236) or \
            origin["artifactZipSha256"] != \
            "904edda464bac50ee144c2e4b087b38c86586ae53072cd259cb1e0f744f6ddfb" or \
            origin["reportSha256"] != \
            "2a077a2e5ccb3faf13e2205fe63b0d1dd603a7e832afe4a80f8b3d5faf27c033" or \
            origin["sourceSha256"] != \
            "dc156127b4ed452f03d2d0ccc87a3752fcfcfcddb95c2dd5e8aefec4465de968":
        raise ValueError("audited original authority mismatch")
    if data["nodeArchive"] != {"name": NODE_NAME, "bytes": 26_169_540,
                               "sha256": NODE_SHA} or \
            data["nodeExecutable"] != {"role": "owned-work/node",
                                       "bytes": 98_932_688,
                                       "sha256": "6295488653f0d93b0a157841746fef7e72cc4328cfb60c4bbe0ca2668a836ffd"} or \
            data["headersArchive"] != {"name": HEADER_NAME, "bytes": 512_152,
                                       "sha256": HEADER_SHA, "memberCount": 2365,
                                       "totalMemberBytes": 49_002_796,
                                       "canonicalMemberMapSha256":
                                       "56ab1a1585288725f46e29aab1987fa7a5850bdbc38216de8c5401a7dbdc4aff"}:
        raise ValueError("audited Node/header authority mismatch")
    for name in TOOLS:
        item = data["tools"][name]
        if type(item) is not dict or set(item) != {
                "selectedPath", "realpath", "bytes", "sha256",
                "locatorStdoutSha256", "locatorStdoutBase64", "versionStatus"} or \
                type(item["selectedPath"]) is not str or \
                not item["selectedPath"].startswith("/") or \
                type(item["realpath"]) is not str or \
                not item["realpath"].startswith("/") or \
                type(item["bytes"]) is not int or not 0 < item["bytes"] <= 100 * 1024 * 1024 or \
                type(item["sha256"]) is not str or len(item["sha256"]) != 64:
            raise ValueError("audited tool authority shape")
        if name == "g++" and (item["locatorStdoutSha256"] is not None or
                            item["locatorStdoutBase64"] is not None):
            raise ValueError("compiler locator invented")
        if name != "g++" and (type(item["locatorStdoutSha256"]) is not str or
                                  len(item["locatorStdoutSha256"]) != 64 or
                                  type(item["locatorStdoutBase64"]) is not str):
            raise ValueError("subtool locator digest missing")
        if name != "g++":
            try:
                locator_raw = base64.b64decode(item["locatorStdoutBase64"], validate=True)
            except Exception as error:
                raise ValueError("locator base64 refused") from error
            advertised = locator_raw.decode("utf-8", "strict").strip()
            selected = item["selectedPath"]
            if base64.b64encode(locator_raw).decode("ascii") != item["locatorStdoutBase64"] or \
                    sha(locator_raw) != item["locatorStdoutSha256"] or \
                    len(locator_raw) > 4096 or b"\0" in locator_raw or \
                    not advertised or "\n" in advertised or "\r" in advertised or \
                    (selected != advertised if os.path.isabs(advertised) else
                     "/" in advertised or Path(selected).name != advertised):
                raise ValueError("locator original bytes differ")
    if data["tools"]["cc1plus"]["versionStatus"] != "VERSION_UNAVAILABLE_EMPTY" or \
            data["tools"]["collect2"]["versionStatus"] != \
            "SPLIT_OUTPUT_DELEGATION_UNVERIFIED":
        raise ValueError("unqualified component profile changed")
    return data


def download(name, maximum):
    if name not in (NODE_NAME, HEADER_NAME):
        raise ValueError("unreviewed archive role")
    url = ORIGIN + name
    with urllib.request.urlopen(url, timeout=25) as response:
        if response.geturl() != url or response.status != 200:
            raise ValueError("archive origin changed")
        length = response.headers.get("Content-Length")
        if length is not None and (not length.isdecimal() or int(length) > maximum):
            raise ValueError("archive content length refused")
        raw = response.read(maximum + 1)
    if not raw or len(raw) > maximum:
        raise ValueError("archive bound refused")
    return raw


def node_executable(raw):
    wanted = "node-v20.20.2-linux-x64/bin/node"
    selected = None
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:xz") as archive:
        for index, member in enumerate(archive):
            if index >= 20_000:
                raise ValueError("Node archive member count refused")
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or not name.parts or \
                    name.parts[0] != "node-v20.20.2-linux-x64" or len(name.parts) > 16:
                raise ValueError("Node archive path refused")
            if member.name == wanted:
                if selected is not None or not member.isfile() or \
                        not 0 < member.size <= 110 * 1024 * 1024:
                    raise ValueError("Node executable member refused")
                selected = archive.extractfile(member).read(member.size + 1)
                if len(selected) != member.size:
                    raise ValueError("Node executable truncated")
    if selected is None:
        raise ValueError("Node executable missing")
    return selected


def extract_headers(raw, work):
    members = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:xz") as archive:
        for index, member in enumerate(archive):
            if index >= MAX_MEMBERS or not (member.isfile() or member.isdir()):
                raise ValueError("header member type/count refused")
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or not name.parts or \
                    name.parts[0] != "node-v20.20.2" or len(name.parts) > 12:
                raise ValueError("header path/depth refused")
            if member.isdir():
                continue
            if member.size < 0 or member.size > MAX_HEADER_MEMBER or \
                    member.name in members:
                raise ValueError("header size/duplicate refused")
            total += member.size
            if total > MAX_HEADER_TOTAL:
                raise ValueError("header aggregate refused")
            data = archive.extractfile(member).read(member.size + 1)
            if len(data) != member.size:
                raise ValueError("header member truncated")
            relative = Path(*name.parts[1:])
            dest = work / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("xb") as output:
                output.write(data)
            members[member.name] = {"bytes": len(data), "sha256": sha(data)}
    if not {"node-v20.20.2/include/node/node.h",
            "node-v20.20.2/include/node/v8-profiler.h"}.issubset(members):
        raise ValueError("required headers missing")
    return {"memberCount": len(members), "totalMemberBytes": total,
            "canonicalMemberMapSha256": sha(json.dumps(
                members, sort_keys=True, separators=(",", ":")).encode())}


def closed_environment(work):
    return {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C",
            "TZ": "UTC", "HOME": str(work), "TMPDIR": str(work)}


def run_bounded(argv, cwd, env, timeout):
    """Bounded child with a fixed environment and owned process group."""
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
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
                room = MAX_OUTPUT - sum(len(x) for x in collected.values())
                collected[key.data].extend(part[:max(0, room)])
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
        if timed_out or output_bound:
            for code in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, code)
                except ProcessLookupError:
                    pass
                if code == signal.SIGTERM:
                    time.sleep(0.1)
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


def output_receipt(raw):
    return {"bytes": len(raw), "sha256": sha(raw),
            "base64": base64.b64encode(raw).decode("ascii")}


def child_receipt(result, argv):
    return {"argv": argv, "exitCode": result["exitCode"],
            "timedOut": result["timedOut"], "outputBound": result["outputBound"],
            "complete": result["complete"], "stdout": output_receipt(result["stdout"]),
            "stderr": output_receipt(result["stderr"])}


def require_clean_child(result, role, maximum=4096):
    if result["timedOut"] or result["outputBound"] or not result["complete"] or \
            result["exitCode"] != 0 or result["stderr"] or \
            not 0 < len(result["stdout"]) <= maximum or b"\0" in result["stdout"]:
        raise ValueError(role + " bounded probe refused")
    try:
        return result["stdout"].decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise ValueError(role + " UTF-8 refused") from error


def require_compile(result):
    for condition, reason in ((result["timedOut"], "compiler-timeout"),
                              (result["outputBound"], "compiler-output-bound"),
                              (not result["complete"], "compiler-incomplete"),
                              (result["exitCode"] != 0, "compiler-exit"),
                              (bool(result["stdout"]), "compiler-stdout"),
                              (bool(result["stderr"]), "compiler-stderr")):
        if condition:
            raise ValueError(reason)


def identity_roster(authority, work, env, publish):
    expected = authority["tools"]
    compiler_expected = expected["g++"]
    selected = shutil.which("g++", path=env["PATH"])
    if selected is None:
        raise ValueError("closed-environment compiler path differs")
    authority_tool(pinned_target(selected), compiler_expected)
    records = {}
    compiler = compiler_expected["realpath"]
    for name in TOOLS:
        if name == "g++":
            path = compiler
            locator = None
        else:
            result = run_bounded([compiler, "-print-prog-name=" + name], work, env, 10)
            locator = child_receipt(result, ["pinned-g++", "-print-prog-name=" + name])
            publish("locator", {"role": name, "receipt": locator})
            value = require_clean_child(result, "tool locator").strip()
            selected = (value if os.path.isabs(value) else
                        shutil.which(value, path=env["PATH"]))
            if not value or "\n" in value or "\r" in value or \
                    sha(result["stdout"]) != expected[name]["locatorStdoutSha256"] or \
                    selected != expected[name]["selectedPath"]:
                raise ValueError("tool locator differs from audited original")
            path = selected
        actual = pinned_target(path)
        authority_tool(actual, expected[name])
        records[name] = actual
        publish("identity", {"role": name, "selectedPath": path,
                             "realpath": actual["realpath"],
                             "bytes": actual["bytes"], "sha256": actual["sha256"],
                             "locator": locator})
        if pinned_target(compiler) != records["g++"]:
            raise ValueError("compiler changed during locator roster")
    return records


def recheck_roster(authority, records):
    for name in TOOLS:
        expected = authority["tools"][name]
        actual = pinned_target(expected["selectedPath"])
        authority_tool(actual, expected)
        if actual != records[name]:
            raise ValueError("same-run tool identity changed")


def postcompile_observations(authority, records):
    """Attempt every target after the child, retaining later failures too."""
    observations = {}
    failures = []
    for name in TOOLS:
        item = {"selectedPath": authority["tools"][name]["selectedPath"],
                "observed": None, "matched": False, "error": None}
        try:
            actual = pinned_target(item["selectedPath"])
            item["observed"] = {key: actual[key] for key in
                                ("realpath", "bytes", "sha256", "device", "inode")}
            authority_tool(actual, authority["tools"][name])
            if actual != records[name]:
                raise ValueError("same-run tool identity changed")
            item["matched"] = True
        except Exception as error:
            item["error"] = {"type": type(error).__name__,
                             "reason": str(error)[:200]}
            failures.append({"role": name, **item["error"]})
        observations[name] = item
    return observations, failures


def compile_or_post_failure(result, failures):
    """The child's first refusal wins over later tool-observer refusals."""
    try:
        require_compile(result)
    except ValueError as error:
        return error
    if failures:
        return ValueError("postcompile-tool-" + failures[0]["role"] + "-refusal")
    return None


def latch_failure(report, error, stage):
    receipt = {"type": type(error).__name__, "reason": str(error)[:200],
               "stage": stage}
    if report["firstFailure"] is None:
        report["firstFailure"] = receipt
    elif (report["firstFailure"]["type"], report["firstFailure"]["reason"]) != \
            (receipt["type"], receipt["reason"]):
        report["secondaryFailures"].append(receipt)


def write_receipt(path, report):
    raw = json.dumps(report, sort_keys=True, separators=(",", ":")).encode()
    if not 0 < len(raw) <= MAX_REPORT:
        raise ValueError("first-build report bound")
    pending = path.with_name("first-build.pending.json")
    with pending.open("wb") as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    os.replace(pending, path)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: run.py OWNED_WORKDIR OWNED_REPORT_DIR")
    work, evidence = (Path(value) for value in sys.argv[1:])
    if work.exists() or work == evidence or not evidence.is_dir() or evidence.is_symlink():
        raise ValueError("fresh owned directories required")
    work.mkdir(mode=0o700, parents=False)
    report_path = evidence / "first-build.json"
    if report_path.exists() or (evidence / "first-build.pending.json").exists():
        raise ValueError("first-build receipt already exists")
    report = {"schema": "bw.direct-v8.first-build.v1",
              "status": "INCOMPLETE_UNQUALIFIED", "firstFailure": None,
              "stage": "created", "sourceReceiptSha256": None,
              "authoritySha256": None, "node": None, "headers": None,
              "addonSourceSha256": None, "tools": {}, "rosterComplete": False,
              "environment": None, "arguments": ARGS, "compile": None,
              "postTools": None, "postToolFailures": [],
              "secondaryFailures": [],
              "addon": None, "sourceEndRecheck": False,
              "host": {"imageOS": os.environ.get("ImageOS"),
                       "imageVersion": os.environ.get("ImageVersion"),
                       "platform": sys.platform, "machine": platform.machine(),
                       "python": platform.python_version()}}
    write_receipt(report_path, report)
    try:
        source_raw = read_ordinary(evidence / "source.json", 32_000)
        source = json.loads(source_raw)
        if source != source_identity() or \
                source.get("schema") != "bw.direct-v8.first-build-source.v1" or \
                source.get("head") != os.environ.get("BW_EXPECTED_HEAD") or \
                source.get("qualification") != "FIRST_BUILD_SOURCE_ONLY_UNRUN":
            raise ValueError("source identity refused")
        report["sourceReceiptSha256"] = sha(source_raw)
        authority_raw = read_ordinary(Path(__file__).with_name("authority.json"), 16_384)
        if sha(authority_raw) != source["roles"]["scripts/xv6-js-rollback-direct-v8-first-build/authority.json"]:
            raise ValueError("authority Git source bytes differ")
        authority = checked_authority(json.loads(authority_raw))
        report["authoritySha256"] = sha(authority_raw)
        if report["host"]["imageOS"] != "ubuntu24" or not report["host"]["imageVersion"]:
            raise ValueError("hosted image identity unavailable")
        report["stage"] = "source-and-authority"
        write_receipt(report_path, report)
        node_raw = download(NODE_NAME, 32 * 1024 * 1024)
        if sha(node_raw) != NODE_SHA or len(node_raw) != authority["nodeArchive"]["bytes"]:
            raise ValueError("Node official archive refused")
        node_bytes = node_executable(node_raw)
        if sha(node_bytes) != authority["nodeExecutable"]["sha256"] or \
                len(node_bytes) != authority["nodeExecutable"]["bytes"]:
            raise ValueError("Node executable differs")
        report["node"] = {"archiveSha256": sha(node_raw), "archiveBytes": len(node_raw),
                          "executableSha256": sha(node_bytes),
                          "executableBytes": len(node_bytes)}
        report["stage"] = "node-identity"
        write_receipt(report_path, report)
        headers_raw = download(HEADER_NAME, 1_000_000)
        if sha(headers_raw) != HEADER_SHA or \
                len(headers_raw) != authority["headersArchive"]["bytes"]:
            raise ValueError("Node headers official archive refused")
        header_fact = extract_headers(headers_raw, work)
        if header_fact != {key: authority["headersArchive"][key] for key in header_fact}:
            raise ValueError("full header map differs from audited original")
        report["headers"] = {"archiveSha256": sha(headers_raw),
                             "archiveBytes": len(headers_raw), **header_fact}
        report["stage"] = "header-map"
        write_receipt(report_path, report)
        addon_role = "scripts/xv6-js-rollback-direct-v8/addon.cc"
        addon_raw = read_ordinary(Path(__file__).resolve().parents[1] /
                                  "xv6-js-rollback-direct-v8/addon.cc", 256_000)
        if sha(addon_raw) != source["roles"][addon_role]:
            raise ValueError("addon source differs from reviewed Git bytes")
        with (work / "addon.cc").open("xb") as output:
            output.write(addon_raw)
        report["addonSourceSha256"] = sha(addon_raw)
        env = closed_environment(work.resolve(strict=True))
        report["environment"] = {key: ("owned-work" if key in ("HOME", "TMPDIR") else value)
                                 for key, value in env.items()}
        write_receipt(report_path, report)
        def publish(kind, item):
            report["tools"][item["role"]] = {
                **report["tools"].get(item["role"], {}), kind: item}
            write_receipt(report_path, report)
        records = identity_roster(authority, work, env, publish)
        recheck_roster(authority, records)
        report["rosterComplete"] = True
        report["stage"] = "five-tool-roster"
        write_receipt(report_path, report)
        compiler = authority["tools"]["g++"]["realpath"]
        recheck_roster(authority, records)
        command = [compiler, *ARGS]
        result = run_bounded(command, work, env, 90)
        report["compile"] = child_receipt(result, ["pinned-g++", *ARGS])
        compile_failure = compile_or_post_failure(result, [])
        if compile_failure is not None:
            latch_failure(report, compile_failure, "compile-returned")
        # The bounded child has returned. All five observations are attempted
        # even if its result already refused; they cannot replace that reason.
        report["postTools"], report["postToolFailures"] = \
            postcompile_observations(authority, records)
        report["stage"] = "compile-and-posttools-retained"
        write_receipt(report_path, report)
        failure = compile_or_post_failure(result, report["postToolFailures"])
        if failure is not None:
            raise failure
        binary = read_ordinary(work / "rollback_sampler.node", 2_000_000)
        report["addon"] = {"bytes": len(binary), "sha256": sha(binary),
                           "loaded": False, "artifactUploaded": False}
        if read_ordinary(evidence / "source.json", 32_000) != source_raw or \
                source_identity() != source or \
                read_ordinary(Path(__file__).with_name("authority.json"), 16_384) != authority_raw or \
                sha(read_ordinary(Path(__file__).resolve().parents[1] /
                    "xv6-js-rollback-direct-v8/addon.cc", 256_000)) != sha(addon_raw):
            raise ValueError("reviewed source changed after build")
        recheck_roster(authority, records)
        report["sourceEndRecheck"] = True
        report["stage"] = "unloaded-binary-recorded"
        report["status"] = "BUILT_UNLOADED_UNQUALIFIED"
        write_receipt(report_path, report)
    except BaseException as error:
        latch_failure(report, error, report["stage"])
        write_receipt(report_path, report)
        raise


if __name__ == "__main__":
    main()
