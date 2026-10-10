#!/usr/bin/env python3
"""Same-host first build and four finite native support cases; no guest."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import types

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HELD = ROOT / "scripts/xv6-js-rollback-direct-v8"
TARGET = ROOT / "scripts/xv6-js-rollback-direct-v8-target-site"
FIRST = ROOT / "scripts/xv6-js-rollback-direct-v8-first-build-profiler-header"
AUTHORITY = ROOT / "scripts/xv6-js-rollback-direct-v8-first-build/authority.json"
CASES = ("minor-baseline", "minor-enabled", "major-baseline", "major-enabled")
PROFILE_LIMIT = 8 * 1024 * 1024
FACT_LIMIT = 65536
REPORT_LIMIT = 1 * 1024 * 1024
CHILD_LIMIT = 45
BASE = "9367cfa9a8f6ffaaee2afaa59be4735e6b494aad"
SOURCE_ROLE = "scripts/xv6-js-rollback-direct-v8-target-site-support/source.py"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(
        ["git", "--no-replace-objects", "-C", str(ROOT), *args],
        stderr=subprocess.DEVNULL,
        env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})


def bootstrap_source(source, expected_head, git_read=git):
    """Pin live source.py to the checked-out Git blob before executing it."""
    if type(source) is not dict or type(source.get("roles")) is not dict or \
            type(expected_head) is not str or not HEX40.fullmatch(expected_head) or \
            git_read("rev-parse", "HEAD").decode().strip() != expected_head or \
            git_read("merge-base", BASE, expected_head).decode().strip() != BASE or \
            git_read("status", "--porcelain=v1", "-uall"):
        raise ValueError("independent Git bootstrap refused")
    committed = git_read("show", expected_head + ":" + SOURCE_ROLE)
    if not 0 < len(committed) <= 256000 or \
            _read_bootstrap(HERE / "source.py", 256000) != committed or \
            source["roles"].get(SOURCE_ROLE) != sha(committed):
        raise ValueError("live source module differs from exact Git role")
    return committed


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def bound_module(raw, path, name):
    """Execute only the just-hashed source bytes, never a second path read."""
    result = types.ModuleType(name)
    result.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), result.__dict__)
    return result


def latch(report, error, stage):
    item = {"type": type(error).__name__, "reason": str(error)[:200],
            "stage": stage}
    if report["firstFailure"] is None:
        report["firstFailure"] = item
    elif item != report["firstFailure"] and len(report["secondaryFailures"]) < 8:
        report["secondaryFailures"].append(item)


def write_report(path, report):
    raw = json.dumps(report, sort_keys=True, separators=(",", ":")).encode()
    if not 0 < len(raw) <= REPORT_LIMIT:
        raise ValueError("target-site-support report bound")
    pending = path.with_name("target-site-support.pending.json")
    with pending.open("wb") as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    os.replace(pending, path)


def admitted_file(reader, path, expected, maximum):
    raw = reader(path, maximum)
    if sha(raw) != expected:
        raise ValueError("reviewed source role changed")
    return raw


def output_roles(reader, directory):
    allowed = {"pre.json": PROFILE_LIMIT, "post.json": PROFILE_LIMIT,
               "facts.json": FACT_LIMIT, "result.json": FACT_LIMIT}
    if not directory.exists():
        return {}
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or directory.is_symlink():
        raise ValueError("case output directory type")
    found = {}
    for path in directory.iterdir():
        if path.name not in allowed:
            raise ValueError("unexpected case output role")
        raw = reader(path, allowed[path.name])
        found[path.name] = raw
    return found


def lease(reader, path, expected_sha, expected_size, limit):
    raw = reader(path, limit)
    observed = {"bytes": len(raw), "sha256": sha(raw)}
    if observed != {"bytes": expected_size, "sha256": expected_sha}:
        raise ValueError("same-run executable/addon lease refused")
    return observed


def compile_once(helper, authority, records, work, env, report, path):
    """Retain all five post-tool facts even when the child first refuses."""
    command = [authority["tools"]["g++"]["realpath"], *helper.ARGS]
    result = helper.run_bounded(command, work, env, 90)
    build = report["build"]
    build["compile"] = helper.child_receipt(result, ["pinned-g++", *helper.ARGS])
    primary = helper.compile_or_post_failure(result, [])
    if primary is not None:
        latch(report, primary, "compile-returned")
    build["postTools"], build["postToolFailures"] = \
        helper.postcompile_observations(authority, records)
    report["stage"] = "compile-and-posttools-retained"
    write_report(path, report)
    failure = helper.compile_or_post_failure(result, build["postToolFailures"])
    if failure is not None:
        raise failure


def run_cases(helper, grade_mod, roles, authority, report, path, work, evidence,
              env, node_path, addon_path):
    support_role = "scripts/xv6-js-rollback-direct-v8-target-site/case.mjs"
    policy_role = "scripts/xv6-js-rollback-direct-v8-target-site/policy.mjs"
    for kind in CASES:
        admitted_file(helper.read_ordinary, TARGET / "case.mjs",
                      roles[support_role], 256000)
        admitted_file(helper.read_ordinary, TARGET / "policy.mjs",
                      roles[policy_role], 256000)
        node_lease = lease(helper.read_ordinary, node_path,
                           authority["nodeExecutable"]["sha256"],
                           authority["nodeExecutable"]["bytes"],
                           110 * 1024 * 1024)
        addon_lease = lease(helper.read_ordinary, addon_path,
                            report["build"]["addon"]["sha256"],
                            report["build"]["addon"]["bytes"], 2_000_000)
        case_path = evidence / kind
        args = ([str(node_path)] + (["--expose-gc"] if kind.startswith("major-") else []) +
                [str(TARGET / "case.mjs"), str(addon_path), kind,
                 str(case_path)])
        display = (["pinned-node"] + (["--expose-gc"] if kind.startswith("major-") else []) +
                   ["reviewed-target-site-case.mjs", "same-run-addon.node", kind,
                    "owned-case-dir"])
        row = {"kind": kind, "loadAttempted": True,
               "nodeLease": node_lease, "addonLease": addon_lease,
               "child": None, "raw": {}, "grade": None}
        addon_fact = report["build"]["addon"]
        addon_fact["loadAttempted"] = True
        if addon_fact["loaded"] is False:
            addon_fact["loaded"] = None  # Child may load before any refusal.
        report["cases"].append(row)
        report["stage"] = "case-" + kind
        write_report(path, report)
        result = helper.run_bounded(args, work, env, CHILD_LIMIT)
        row["child"] = helper.child_receipt(result, display)
        child_error = None
        if result["timedOut"] or result["outputBound"] or \
                not result["complete"] or result["exitCode"] != 0 or \
                result["stdout"] or result["stderr"]:
            child_error = ValueError("bounded support child refused: " + kind)
            latch(report, child_error, report["stage"])
        raw = output_roles(helper.read_ordinary, case_path)
        row["raw"] = {name: {"bytes": len(data), "sha256": sha(data)}
                      for name, data in sorted(raw.items())}
        write_report(path, report)
        if child_error is not None:
            raise child_error
        try:
            row["grade"] = grade_mod.grade_case(kind, raw)
        except BaseException as error:
            latch(report, error, report["stage"])
            write_report(path, report)
            raise
        addon_fact["loaded"] = True
        write_report(path, report)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: run.py OWNED_WORKDIR OWNED_EVIDENCE_DIR")
    work, evidence = (Path(value) for value in sys.argv[1:])
    if work.exists() or work == evidence or not evidence.is_dir() or evidence.is_symlink():
        raise ValueError("fresh owned work and existing evidence directory required")
    work.mkdir(mode=0o700, parents=False)
    path = evidence / "target-site-support.json"
    if path.exists() or (evidence / "target-site-support.pending.json").exists():
        raise ValueError("target-site-support report already exists")
    report = {
        "schema": "bw.direct-v8.target-site-support.v1", "status": "INCOMPLETE_UNQUALIFIED",
        "stage": "created", "firstFailure": None, "secondaryFailures": [],
        "sourceReceiptSha256": None, "authoritySha256": None,
        "heldBuildHelperSha256": None, "build": {
            "node": None, "headers": None, "addonSourceSha256": None,
            "tools": {}, "rosterComplete": False, "environment": None,
            "arguments": None, "compile": None, "postTools": None,
            "postToolFailures": [], "addon": None, "sourceEndRecheck": False},
        "cases": [], "support": {"supported": False, "grade": None},
        "finalLeases": None,
        "host": {"imageOS": os.environ.get("ImageOS"),
                 "imageVersion": os.environ.get("ImageVersion"),
                 "platform": sys.platform, "machine": platform.machine(),
                 "python": platform.python_version()}}
    write_report(path, report)
    try:
        source_raw = _read_bootstrap(evidence / "source.json", 32000)
        source = json.loads(source_raw)
        if (type(source) is not dict or type(source.get("roles")) is not dict or
                source.get("schema") != "bw.direct-v8.target-site-support-source.v1" or
                source.get("head") != os.environ.get("BW_EXPECTED_HEAD") or
                source.get("qualification") != "PROFILER_HEADER_TARGET_SITE_SUPPORT_SOURCE_ONLY_UNRUN"):
            raise ValueError("target-site-support source identity refused")
        source_path = HERE / "source.py"
        source_code = bootstrap_source(source, os.environ.get("BW_EXPECTED_HEAD"))
        source_mod = bound_module(source_code, source_path,
                                  "direct_v8_support_source")
        if source != source_mod.identity():
            raise ValueError("target-site-support source identity refused")
        report["sourceReceiptSha256"] = sha(source_raw)
        roles = source["roles"]
        helper_path = FIRST / "run.py"
        helper_raw = admitted_file(_read_bootstrap, helper_path,
                                   roles["scripts/xv6-js-rollback-direct-v8-first-build-profiler-header/run.py"],
                                   256000)
        # Import only after the new source profile binds the held helper bytes.
        helper = bound_module(helper_raw, helper_path,
                              "direct_v8_held_build_helper")
        report["heldBuildHelperSha256"] = sha(helper_raw)
        authority_raw = admitted_file(helper.read_ordinary, AUTHORITY,
                                      roles["scripts/xv6-js-rollback-direct-v8-first-build/authority.json"],
                                      16384)
        authority = helper.checked_authority(json.loads(authority_raw))
        report["authoritySha256"] = sha(authority_raw)
        if report["host"]["imageOS"] != "ubuntu24" or not report["host"]["imageVersion"]:
            raise ValueError("hosted image identity unavailable")
        report["stage"] = "source-and-authority"
        write_report(path, report)

        node_archive = helper.download(helper.NODE_NAME, 32 * 1024 * 1024)
        if sha(node_archive) != helper.NODE_SHA or \
                len(node_archive) != authority["nodeArchive"]["bytes"]:
            raise ValueError("Node official archive refused")
        node_bytes = helper.node_executable(node_archive)
        if (sha(node_bytes), len(node_bytes)) != (
                authority["nodeExecutable"]["sha256"],
                authority["nodeExecutable"]["bytes"]):
            raise ValueError("Node executable differs")
        node_path = work / "node"
        with node_path.open("xb") as output:
            output.write(node_bytes)
        node_path.chmod(0o700)
        del node_bytes, node_archive
        report["build"]["node"] = {
            "archiveSha256": authority["nodeArchive"]["sha256"],
            "archiveBytes": authority["nodeArchive"]["bytes"],
            "executableSha256": authority["nodeExecutable"]["sha256"],
            "executableBytes": authority["nodeExecutable"]["bytes"]}
        report["stage"] = "node-identity"
        write_report(path, report)

        headers = helper.download(helper.HEADER_NAME, 1_000_000)
        if sha(headers) != helper.HEADER_SHA or \
                len(headers) != authority["headersArchive"]["bytes"]:
            raise ValueError("Node header archive refused")
        header_fact = helper.extract_headers(headers, work)
        if header_fact != {key: authority["headersArchive"][key] for key in header_fact}:
            raise ValueError("full header map differs from audited original")
        report["build"]["headers"] = {
            "archiveSha256": sha(headers), "archiveBytes": len(headers), **header_fact}
        del headers
        report["stage"] = "header-map"
        write_report(path, report)

        addon_role = "scripts/xv6-js-rollback-direct-v8-first-build-profiler-header/addon.cc"
        corrected_addon = FIRST / "addon.cc"
        addon_raw = admitted_file(helper.read_ordinary, corrected_addon,
                                  roles[addon_role], 256000)
        with (work / "addon.cc").open("xb") as output:
            output.write(addon_raw)
        report["build"]["addonSourceSha256"] = sha(addon_raw)
        env = helper.closed_environment(work.resolve(strict=True))
        report["build"]["environment"] = {
            key: ("owned-work" if key in ("HOME", "TMPDIR") else value)
            for key, value in env.items()}
        report["build"]["arguments"] = helper.ARGS
        write_report(path, report)

        def publish(kind, item):
            row = report["build"]["tools"].get(item["role"], {})
            report["build"]["tools"][item["role"]] = {**row, kind: item}
            write_report(path, report)

        records = helper.identity_roster(authority, work, env, publish)
        helper.recheck_roster(authority, records)
        report["build"]["rosterComplete"] = True
        report["stage"] = "five-tool-roster"
        write_report(path, report)
        helper.recheck_roster(authority, records)
        compile_once(helper, authority, records, work, env, report, path)
        addon_path = work / "rollback_sampler.node"
        addon_bytes = helper.read_ordinary(addon_path, 2_000_000)
        report["build"]["addon"] = {"bytes": len(addon_bytes),
                                      "sha256": sha(addon_bytes),
                                      "loadAttempted": False, "loaded": False,
                                      "artifactUploaded": False}
        del addon_bytes
        if (helper.read_ordinary(evidence / "source.json", 32000) != source_raw or
                source_mod.identity() != source or
                helper.read_ordinary(AUTHORITY, 16384) != authority_raw or
                sha(helper.read_ordinary(corrected_addon, 256000)) != sha(addon_raw)):
            raise ValueError("reviewed source changed after build")
        helper.recheck_roster(authority, records)
        report["build"]["sourceEndRecheck"] = True
        report["stage"] = "unloaded-binary-recorded"
        write_report(path, report)

        grade_path = HERE / "grade.py"
        grade_raw = admitted_file(
            helper.read_ordinary, grade_path,
            roles["scripts/xv6-js-rollback-direct-v8-target-site-support/grade.py"],
            256000)
        grade_mod = bound_module(grade_raw, grade_path,
                                 "direct_v8_support_raw_grade")
        support_role = "scripts/xv6-js-rollback-direct-v8-target-site/case.mjs"
        policy_role = "scripts/xv6-js-rollback-direct-v8-target-site/policy.mjs"
        run_cases(helper, grade_mod, roles, authority, report, path,
                  work, evidence, env, node_path, addon_path)

        # The independent raw grader checks exactly the four observed cases.
        observations = []
        for kind in CASES:
            observations.append({"kind": kind, "files": output_roles(
                helper.read_ordinary, evidence / kind)})
        report["support"]["grade"] = grade_mod.grade_four(observations)
        for row, checked in zip(report["cases"], report["support"]["grade"]["cases"]):
            if row["kind"] != checked["kind"] or row["raw"] != checked["raw"] or \
                    row["grade"] != checked:
                raise ValueError("support case files changed between observations")
        for role, file in ((support_role, TARGET / "case.mjs"),
                           (policy_role, TARGET / "policy.mjs")):
            admitted_file(helper.read_ordinary, file, roles[role], 256000)
        report["finalLeases"] = {
            "node": lease(helper.read_ordinary, node_path,
                          authority["nodeExecutable"]["sha256"],
                          authority["nodeExecutable"]["bytes"], 110 * 1024 * 1024),
            "addon": lease(helper.read_ordinary, addon_path,
                           report["build"]["addon"]["sha256"],
                           report["build"]["addon"]["bytes"], 2_000_000)}
        if source_mod.identity() != source or \
                helper.read_ordinary(evidence / "source.json", 32000) != source_raw or \
                helper.read_ordinary(helper_path, 256000) != helper_raw:
            raise ValueError("support source changed after children")
        helper.recheck_roster(authority, records)
        report["support"]["supported"] = True
        report["status"] = "FOUR_CASE_TARGET_SITE_SUPPORT_ONLY"
        report["stage"] = "four-case-support-recorded"
        write_report(path, report)
    except BaseException as error:
        latch(report, error, report["stage"])
        write_report(path, report)
        raise


def _read_bootstrap(path, maximum):
    """Open held helper before importing it; same nofollow/size/identity rule."""
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum:
        raise ValueError("held helper role type or size")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino, opened.st_size) != \
                (before.st_dev, before.st_ino, before.st_size):
            raise ValueError("held helper replaced before read")
        chunks = bytearray()
        while len(chunks) <= maximum:
            part = os.read(fd, min(65536, maximum + 1 - len(chunks)))
            if not part:
                break
            chunks.extend(part)
        after = os.fstat(fd)
        listed = path.lstat()
        shape = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        if len(chunks) != before.st_size or len(chunks) > maximum or \
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != shape or \
                (listed.st_dev, listed.st_ino, listed.st_size, listed.st_mtime_ns) != shape:
            raise ValueError("held helper changed while reading")
        return bytes(chunks)
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
