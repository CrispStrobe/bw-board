#!/usr/bin/env python3
"""Bounded fresh-child xv6 forktest comparison; run only on reviewed CI source."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import resource
import signal
import stat
import subprocess
import time
from pathlib import Path

from policy import ROM_SHA, compare_reports, require, summarize_pairs, validate_report


XV6_REVISION = "eeb7b415dbcb12cc362d0783e41c3d1f44066b17"
VGA_SHA = "76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1"
MAX_REPORT = 4 * 1024 * 1024
MAX_CHILD_SECONDS = 180
MAX_CHILD_RSS = 1536 * 1024 * 1024
REQUIRED_SOURCE_ROLES = {
    "./probe-xv6-stock.mjs", "./lib/i80386-source-inventory.mjs",
    "../src/experimental/i80386.js", "../src/experimental/i80386-at-machine.js",
    "../src/experimental/i80386-native-dispatch.js",
    "../src/experimental/i80386-native-byte-block.js",
    "../src/experimental/i80386-ram-bridge.js",
    "../wasm/i80386-block-spike.wasm", "../wasm/i80386-ram-bridge.wasm",
}


def sha_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def ordinary_file(file: Path, maximum: int) -> None:
    info = file.lstat()
    require(stat.S_ISREG(info.st_mode) and not file.is_symlink() and
            0 < info.st_size <= maximum, f"invalid ordinary bounded file: {file.name}")


def git(source: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(source), *args],
                                   text=True, stderr=subprocess.DEVNULL).strip()


def load_json(file: Path, maximum: int = MAX_REPORT) -> dict:
    ordinary_file(file, maximum)

    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"duplicate JSON key: {key}")
            result[key] = value
        return result

    def no_constant(value):
        raise ValueError(f"nonfinite JSON constant: {value}")

    result = json.loads(file.read_text(), object_pairs_hook=unique,
                        parse_constant=no_constant)
    require(isinstance(result, dict), "JSON root must be object")
    return result


def write_json(file: Path, data: object) -> None:
    with file.open("x", encoding="utf8") as stream:
        json.dump(data, stream, sort_keys=True, indent=2, allow_nan=False)
        stream.write("\n")


def check_source_inventory(source: Path, inventory: dict[str, str]) -> None:
    require(REQUIRED_SOURCE_ROLES <= inventory.keys(), "source closure omits required role")
    require(len(inventory) <= 256, "source closure exceeds bound")
    root = source.resolve(strict=True)
    scripts = root / "scripts"
    for role, digest in inventory.items():
        require(isinstance(role, str) and role.startswith(("./", "../")) and
                "\\" not in role and "\x00" not in role, "invalid source role")
        lexical = scripts / role
        ordinary_file(lexical, 4 * 1024 * 1024)
        candidate = lexical.resolve(strict=True)
        require(candidate.is_relative_to(root), "source role escapes repository")
        require(sha_file(candidate) == digest, f"source role digest differs: {role}")


def check_media(source: Path, image_dir: Path) -> dict[str, str]:
    receipt = load_json(image_dir / "bw-xv6-stock-4m-receipt.json", 64 * 1024)
    require(receipt.get("sourceRevision") == XV6_REVISION and
            receipt.get("profile") == "4m" and receipt.get("phystop") == "0x400000" and
            receipt.get("stockSmp") is True and
            receipt.get("image") == "xv6.img" and
            receipt.get("filesystemImage") == "fs.img" and
            Path(receipt.get("output", "")).resolve(strict=True) == image_dir,
            "wrong xv6 build receipt")
    xv6_source = Path(receipt.get("source", "")).resolve(strict=True)
    require(git(xv6_source, "rev-parse", "HEAD") == XV6_REVISION and
            not git(xv6_source, "status", "--porcelain", "--untracked-files=all"),
            "xv6 build source is not clean pinned source")
    paths = {"image": image_dir / "xv6.img", "slaveImage": image_dir / "fs.img"}
    media = {}
    for field, file in paths.items():
        ordinary_file(file, 20 * 1024 * 1024)
        media[field] = sha_file(file)
    require(media["image"] == receipt.get("imageSha256") and
            media["slaveImage"] == receipt.get("filesystemImageSha256"),
            "xv6 image digest differs from build receipt")
    for name, digest in (("BIOS-bochs-legacy", ROM_SHA),
                         ("vgabios-lgpl.bin", VGA_SHA)):
        file = source / "roms" / "free-at-bios" / name
        ordinary_file(file, 256 * 1024)
        require(sha_file(file) == digest, f"free BIOS digest differs: {name}")
    return media


def host_metadata() -> dict:
    model = "unknown"
    cpuinfo = Path("/proc/cpuinfo")
    if cpuinfo.is_file():
        for line in cpuinfo.read_text().splitlines():
            if line.startswith("model name"):
                model = line.split(":", 1)[1].strip()
                break
    return {"platform": platform.system(), "architecture": platform.machine(),
            "cpuModel": model, "logicalCpus": os.cpu_count(),
            "node": subprocess.check_output(["node", "--version"], text=True).strip(),
            "loadAverage": os.getloadavg()}


def clean_child_env(image_dir: Path, arm: str) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("XV6_", "I80386_")) and key not in
           {"NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE", "LD_PRELOAD", "LD_AUDIT"}}
    env.update(XV6_FIRMWARE="bochs", XV6_PROFILE="4m", XV6_LEAN="1",
               XV6_RAM_HASH="1", XV6_STEPS="40000000", XV6_STOP_ON_EXPECT="1",
               XV6_COMMAND="forktest\r", XV6_EXPECT_SERIAL="fork test OK\n$ ",
               XV6_IMG=str(image_dir / "xv6.img"),
               XV6_FS_IMG=str(image_dir / "fs.img"),
               XV6_KERNEL=str(image_dir / "kernel"))
    if arm == "dispatch":
        env["XV6_NATIVE_DISPATCH"] = "1"
    return env


def run_bounded(command: list[str], cwd: Path, env: dict[str, str], output: Path,
                arm: str, seconds: int = MAX_CHILD_SECONDS) -> dict:
    """Run one child; preserve its first failure and reap its process group."""
    require(0 < seconds <= MAX_CHILD_SECONDS, "invalid child wall bound")
    stdout_path = output / "stdout.json"
    stderr_path = output / "stderr.txt"
    output.mkdir(mode=0o700)

    def limits():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (160, 165))
        resource.setrlimit(resource.RLIMIT_AS, (64 * 1024**3, 64 * 1024**3))
        resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024**2, 8 * 1024**2))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    started = time.monotonic()
    with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
        child = subprocess.Popen(
            command, cwd=cwd, env=env,
            stdout=stdout, stderr=stderr, preexec_fn=limits)
        reaped = False
        timed_out = False
        rss_exceeded = False
        observed_rss = 0
        try:
            while True:
                pid, status, usage = os.wait4(child.pid, os.WNOHANG)
                if pid:
                    reaped = True
                    child.returncode = os.waitstatus_to_exitcode(status)
                    break
                timed_out = time.monotonic() - started > seconds
                try:
                    for line in Path(f"/proc/{child.pid}/status").read_text().splitlines():
                        if line.startswith("VmRSS:"):
                            observed_rss = max(observed_rss, int(line.split()[1]) * 1024)
                            break
                except FileNotFoundError:
                    pass
                rss_exceeded = observed_rss > MAX_CHILD_RSS
                if timed_out or rss_exceeded:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    _, status, usage = os.wait4(child.pid, 0)
                    reaped = True
                    child.returncode = os.waitstatus_to_exitcode(status)
                    break
                time.sleep(0.05)
        finally:
            if not reaped:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    os.wait4(child.pid, 0)
                except ChildProcessError:
                    pass
    try:
        os.killpg(child.pid, 0)
        group_empty = False
    except ProcessLookupError:
        group_empty = True
    if not group_empty:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    metrics = {"arm": arm, "exitCode": child.returncode,
               "timedOut": timed_out, "rssExceeded": rss_exceeded,
               "processGroupEmptyAfterExit": group_empty,
               "cpuSeconds": usage.ru_utime + usage.ru_stime,
               "wallSeconds": time.monotonic() - started,
               "maxRssKilobytes": usage.ru_maxrss,
               "observedPeakRssBytes": observed_rss}
    write_json(output / "process.json", metrics)
    require(child.returncode == 0 and not timed_out and not rss_exceeded and group_empty,
            f"{arm} child did not complete cleanly")
    return metrics


def bounded_child(source: Path, image_dir: Path, arm: str, output: Path) -> dict:
    require(arm in {"ordinary", "dispatch"}, "unknown child arm")
    return run_bounded(["node", "--max-old-space-size=768", "scripts/probe-xv6-stock.mjs"],
                       source, clean_child_env(image_dir, arm), output, arm)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--image-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    image_dir = args.image_dir.resolve(strict=True)
    require(len(args.head) == 40 and all(ch in "0123456789abcdef" for ch in args.head),
            "head must be exact SHA")
    args.output.mkdir(mode=0o700)
    baseline_inventory = None
    pairs = []
    try:
        require(git(source, "rev-parse", "HEAD") == args.head and
                not git(source, "status", "--porcelain", "--untracked-files=all"),
                "source must be exact clean head")
        media = check_media(source, image_dir)
        ordinary_file(image_dir / "kernel", 20 * 1024 * 1024)
        write_json(args.output / "binding.json", {
            "schema": "bw.xv6-js-acceptance-binding.v1", "head": args.head,
            "xv6Revision": XV6_REVISION, "mediaSha256": media,
            "kernelSha256": sha_file(image_dir / "kernel"),
            "romSha256": ROM_SHA, "vgaRomSha256": VGA_SHA,
            "harnessSha256": {name: sha_file(Path(__file__).parent / name)
                              for name in ("run.py", "policy.py", "policy_control.py")},
            "hostBefore": host_metadata()})
        for index in range(9):
            order = ["ordinary", "dispatch"] if index % 2 == 0 else ["dispatch", "ordinary"]
            children = {}
            reports = {}
            for arm in order:
                child_dir = args.output / f"pair-{index:02d}-{arm}"
                metrics = bounded_child(source, image_dir, arm, child_dir)
                report = load_json(child_dir / "stdout.json")
                semantic = validate_report(report, arm, args.head, media)
                check_source_inventory(source, report["sourceSha256"])
                if baseline_inventory is None:
                    baseline_inventory = report["sourceSha256"]
                require(report["sourceSha256"] == baseline_inventory,
                        "source inventory changed across children")
                children[arm] = {**metrics, "semanticSha256":
                                 hashlib.sha256(json.dumps(semantic, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()}
                reports[arm] = report
                write_json(child_dir / "admission.json", {"semanticSha256":
                           children[arm]["semanticSha256"],
                           "sourceInventoryEntries": len(report["sourceSha256"]),
                           "rawReportSha256": sha_file(child_dir / "stdout.json")})
            comparison = compare_reports(reports["ordinary"], reports["dispatch"],
                                         args.head, media)
            require(children["ordinary"]["semanticSha256"] ==
                    children["dispatch"]["semanticSha256"], "child projection hash differs")
            pair = {"index": index, "order": order, "children": children,
                    "semanticSha256": comparison["semanticSha256"],
                    "nativeInstructions": comparison["nativeInstructions"]}
            write_json(args.output / f"pair-{index:02d}.json", pair)
            pairs.append(pair)
        require(not git(source, "status", "--porcelain", "--untracked-files=all") and
                git(source, "rev-parse", "HEAD") == args.head,
                "source changed during guest comparison")
        summary = summarize_pairs(pairs)
        summary["head"] = args.head
        summary["hostAfter"] = host_metadata()
        write_json(args.output / "result.json", summary)
        print(json.dumps({"result": "PASS" if summary["adoptionGatePass"] else "PERFORMANCE_FAIL",
                          "cpuRatio": summary["meanCpuRatioDispatchOverOrdinary"],
                          "favorablePairs": summary["favorableCpuPairs"]}, sort_keys=True))
    except BaseException as error:
        try:
            write_json(args.output / "failure.json", {"type": type(error).__name__,
                       "message": str(error), "completedPairs": len(pairs)})
        except Exception:
            pass  # Keep the original qualification failure primary.
        raise


if __name__ == "__main__":
    main()
