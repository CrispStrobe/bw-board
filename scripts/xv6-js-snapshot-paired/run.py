#!/usr/bin/env python3
"""Exact-source before/after ordinary-JS xv6 gate; hosted use only."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

from snapshot_policy import ARMS, require, summarize


BASE_HEAD = "6e5662bec11442e373a2489f213bc506438373e8"
CPU_ROLE = "../src/experimental/i80386.js"
CPU_PATH = "src/experimental/i80386.js"
HELPERS = ("scripts/xv6-js-acceptance/run.py",
           "scripts/xv6-js-acceptance/policy.py")
OWN_ROLES = ("scripts/xv6-js-snapshot-paired/README.md",
             "scripts/xv6-js-snapshot-paired/oracle-check.mjs",
             "scripts/xv6-js-snapshot-paired/snapshot_policy.py",
             "scripts/xv6-js-snapshot-paired/policy_control.py",
             "scripts/xv6-js-snapshot-paired/run.py",
             "scripts/xv6-js-snapshot-paired/run_control.py",
             "test/i80386-instruction-snapshot-ownership.test.mjs",
             ".github/workflows/x86-xv6-js-snapshot-paired.yml")


def git(source: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(source), *args],
                                   text=True, stderr=subprocess.DEVNULL).strip()


def blob(source: Path, revision: str, name: str) -> bytes:
    return subprocess.check_output(
        ["git", "-C", str(source), "show", f"{revision}:{name}"],
        stderr=subprocess.DEVNULL)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def exact_file(source: Path, revision: str, name: str) -> str:
    body = blob(source, revision, name)
    file = source / name
    require(file.is_file() and not file.is_symlink() and
            file.stat().st_size == len(body) and file.read_bytes() == body,
            f"live source differs from Git blob: {name}")
    return sha(body)


def validate_changed_paths(changed: set[str]) -> None:
    allowed = {CPU_PATH, *OWN_ROLES}
    require(CPU_PATH in changed and changed <= allowed,
            "candidate modifies paths beyond the snapshot and dedicated gate")


def validate_inventory_delta(prior: dict[str, str], candidate: dict[str, str]) -> None:
    require(prior.keys() == candidate.keys() and CPU_ROLE in prior,
            "source inventory role set differs")
    differing = {name for name in prior if prior[name] != candidate[name]}
    require(differing == {CPU_ROLE}, "source closure differs beyond the CPU")


def admission(before: Path, after: Path, head: str):
    require(len(head) == 40 and all(char in "0123456789abcdef" for char in head),
            "candidate head must be full SHA")
    require(git(before, "rev-parse", "HEAD") == BASE_HEAD and
            git(after, "rev-parse", "HEAD") == head and
            not git(before, "status", "--porcelain", "--untracked-files=all") and
            not git(after, "status", "--porcelain", "--untracked-files=all"),
            "exact clean before/after checkout required")
    require(git(after, "merge-base", BASE_HEAD, head) == BASE_HEAD,
            "candidate does not descend from pinned baseline")
    changed = set(git(after, "diff", "--name-only", BASE_HEAD, head).splitlines())
    validate_changed_paths(changed)
    helper_hashes = {}
    for name in HELPERS:
        a = exact_file(before, BASE_HEAD, name)
        b = exact_file(after, head, name)
        require(a == b, f"qualified xv6 helper changed: {name}")
        helper_hashes[name] = a
    for name in ("scripts/probe-xv6-stock.mjs", "scripts/build-xv6-stock-4m.mjs"):
        require(exact_file(before, BASE_HEAD, name) == exact_file(after, head, name),
                f"guest probe/build source changed: {name}")
    own_hashes = {name: exact_file(after, head, name) for name in OWN_ROLES}
    require(exact_file(before, BASE_HEAD, CPU_PATH) != exact_file(after, head, CPU_PATH),
            "CPU source did not change")
    helper_dir = after / "scripts/xv6-js-acceptance"
    sys.path.insert(0, str(helper_dir))
    spec = importlib.util.spec_from_file_location("qualified_xv6_run", helper_dir / "run.py")
    require(spec is not None and spec.loader is not None, "qualified runner unavailable")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper, helper_hashes, own_hashes, sorted(changed)


def inventories(helper, before: Path, after: Path, head: str):
    prior = helper.expected_source_inventory(before, BASE_HEAD)
    candidate = helper.expected_source_inventory(after, head)
    validate_inventory_delta(prior, candidate)
    return prior, candidate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--image-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    before, after = args.before.resolve(strict=True), args.after.resolve(strict=True)
    image_dir = args.image_dir.resolve(strict=True)
    output = args.output
    output.mkdir(mode=0o700, exist_ok=True)
    require(not any(output.iterdir()), "output must be empty")
    pairs = []
    helper = None
    try:
        helper, helper_hashes, own_hashes, changed = admission(before, after, args.head)
        prior, candidate = inventories(helper, before, after, args.head)
        media = helper.check_media(after, image_dir)
        require(media == helper.check_media(before, image_dir),
                "before/after media differs")
        helper.ordinary_file(image_dir / "kernel", 20 * 1024 * 1024)
        binding = {
            "schema": "bw.xv6-js-snapshot-binding.v1",
            "beforeHead": BASE_HEAD, "afterHead": args.head,
            "changedPaths": changed,
            "helperSha256": helper_hashes, "gateSha256": own_hashes,
            "sourceInventorySha256": {
                "before": helper.sha256_json(prior),
                "after": helper.sha256_json(candidate)},
            "xv6Revision": helper.XV6_REVISION,
            "mediaSha256": media,
            "kernelSha256": helper.sha_file(image_dir / "kernel"),
            "hostBefore": helper.host_metadata(),
            "workload": {"profile": "4m", "firmware": "bochs", "lean": True,
                         "fullRamHash": True, "command": "forktest\r",
                         "stepLimit": 40_000_000, "warmupPairs": 2,
                         "measuredPairs": 7, "bothArms": "ordinary-js",
                         "metric": "wait4 whole-child CPU and wall",
                         "cpuGate": "mean after/before <=0.98 and 7/7 favorable",
                         "wallGate": "mean after/before <=1.02"}}
        helper.write_json(output / "binding.json", binding)
        for index in range(9):
            order = list(ARMS if index % 2 == 0 else reversed(ARMS))
            children = {}
            semantics = {}
            for arm in order:
                source, revision, expected = (before, BASE_HEAD, prior) if arm == "before" else (after, args.head, candidate)
                child_dir = output / f"pair-{index:02d}-{arm}"
                metrics = helper.run_bounded(
                    ["node", "--max-old-space-size=768", "scripts/probe-xv6-stock.mjs"],
                    source, helper.clean_child_env(image_dir, "ordinary"), child_dir, arm)
                report = helper.load_json(child_dir / "stdout.json")
                semantic = helper.validate_report(report, "ordinary", revision, media)
                require(report["sourceSha256"] == expected,
                        "reported source closure differs from preguest inventory")
                helper.check_source_inventory(source, report["sourceSha256"])
                digest = helper.sha256_json(semantic)
                semantics[arm] = semantic
                children[arm] = {**metrics, "semanticSha256": digest,
                                 "rawReportSha256": helper.sha_file(child_dir / "stdout.json")}
                helper.write_json(child_dir / "admission.json", {
                    "head": revision, "sourceInventorySha256": helper.sha256_json(expected),
                    "semanticSha256": digest,
                    "rawReportSha256": children[arm]["rawReportSha256"]})
            require(semantics["before"] == semantics["after"],
                    "before/after guest outcomes differ")
            require(children["before"]["semanticSha256"] ==
                    children["after"]["semanticSha256"], "semantic digest differs")
            pair = {"index": index, "order": order, "children": children,
                    "semanticSha256": children["before"]["semanticSha256"]}
            helper.write_json(output / f"pair-{index:02d}.json", pair)
            pairs.append(pair)
        admission(before, after, args.head)
        require((prior, candidate) == inventories(helper, before, after, args.head),
                "source inventory changed during series")
        require(media == helper.check_media(before, image_dir) ==
                helper.check_media(after, image_dir), "media changed during series")
        summary = summarize(pairs)
        summary.update(beforeHead=BASE_HEAD, afterHead=args.head,
                       hostAfter=helper.host_metadata())
        helper.write_json(output / "result.json", summary)
        helper.snapshot_inventory(output)
        print(json.dumps({"result": "PASS" if summary["adoptionGatePass"] else "PERFORMANCE_FAIL",
                          "cpuRatio": summary["meanCpuRatioAfterOverBefore"],
                          "wallRatio": summary["meanWallRatioAfterOverBefore"],
                          "favorablePairs": summary["favorableCpuPairs"]}, sort_keys=True))
    except BaseException as error:
        if helper is not None:
            try:
                helper.write_json(output / "failure.json", {
                    "type": type(error).__name__, "message": str(error),
                    "completedPairs": len(pairs)})
            except Exception:
                pass
            try:
                helper.snapshot_inventory(output)
            except Exception:
                pass
        raise
    if not summary["adoptionGatePass"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
