#!/usr/bin/env python3
"""Compile an owned DPMI client on CI; retain reports, never its executable."""

import hashlib
import importlib.util
import io
import json
import os
import resource
import shutil
import signal
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGE_A = HERE.parent / "i80386-cwsdpmi-owned" / "acquire.py"
spec = importlib.util.spec_from_file_location("stage_a_archive_reader", STAGE_A)
archive_reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive_reader)

TOOL_URL = archive_reader.TOOL_URL
TOOL_BYTES = 80596981
TOOL_SHA = "8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00"
SOURCE_URL = "https://www.delorie.com/pub/djgpp/current/v2/"
SOURCE = {
    "djcrx205.zip": (895256, "22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60"),
    "djdev205.zip": (2509574, "4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda"),
    "djlsr205.zip": (2047171, "80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea"),
}
SELECTED = {
    "compiler": ("djgpp/bin/i586-pc-msdosdjgpp-gcc", "afd20f428ccb032b21f00832587219d236efde25344c8067f820b1e677d0799f"),
    "assembler": ("djgpp/i586-pc-msdosdjgpp/bin/as", "41dda143ed208ffeb62722e0963193b0a2450bdd0aa00c5bd394115e3b2eef24"),
    "linker": ("djgpp/i586-pc-msdosdjgpp/bin/ld", "99f2e74294e340136f3345982f6c95f59431a75abbc01734552e63a84b9cfc65"),
    "stubify": ("djgpp/i586-pc-msdosdjgpp/bin/stubify", "e0f233de37256389434894ce38158c9e68c57c46f7cbe332021ad64577751a09"),
    "dpmi.h": ("djgpp/i586-pc-msdosdjgpp/sys-include/dpmi.h", "cf73c8314e4ae364d6160913bae31be5d9f5800c1d333af1291e4e49f61627b3"),
    "farptr.h": ("djgpp/i586-pc-msdosdjgpp/sys-include/sys/farptr.h", "b38414509d8e1e59de9402188ed003ab7e2cde3bd50786318aedb0232329547d"),
    "crt0.o": ("djgpp/i586-pc-msdosdjgpp/lib/crt0.o", "ee1b0b2cf7b2645708ce35bff4c4c18322aa7e29f89eed5769c4a138cf4acfae"),
    "libc.a": ("djgpp/i586-pc-msdosdjgpp/lib/libc.a", "f59d5106cc668a67c3334c33be2c273df7c69dce93e4e53ef8a52c07a9fbda78"),
    "libgcc.a": ("djgpp/lib/gcc/i586-pc-msdosdjgpp/12.2.0/libgcc.a", "e9d6ad2b2c679617b4d305b655039403514ba8f140805f2b75044ffcf16bc4b7"),
}
CLIENT = Path("scripts/i80386-cwsdpmi-owned/client.c")
MAX_LOG = 2 << 20


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write_json(path, value):
    with path.open("w", encoding="utf-8") as out:
        json.dump(value, out, indent=2, sort_keys=True)
        out.write("\n")


def checkpoint(out, phase):
    write_json(out / "progress.json", {"phase": phase})


def observed_inputs(paths, out):
    expected = {"toolchain": (TOOL_URL, TOOL_BYTES, TOOL_SHA),
                **{name: (SOURCE_URL + name, *attrs) for name, attrs in SOURCE.items()},
                "client": (str(CLIENT), None, None)}
    receipt = {}
    for role, (url, expected_size, expected_hash) in expected.items():
        path = paths[role]
        cap = 81000000 if role == "toolchain" else 3000000
        entry = {"role": url, "expectedBytes": expected_size,
                 "expectedSha256": expected_hash, "capBytes": cap,
                 "ordinary": path.is_file() and not path.is_symlink()}
        if entry["ordinary"]:
            entry["bytes"] = path.stat().st_size
            if entry["bytes"] <= cap:
                h = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1 << 20), b""):
                        h.update(chunk)
                entry["sha256"] = h.hexdigest()
        receipt[role] = entry
        write_json(out / "input-manifest.json", {"inputs": receipt})
    return receipt


def load(path, maximum, size, digest):
    if path.is_symlink() or not path.is_file():
        raise ValueError("nonordinary input")
    length = path.stat().st_size
    if length > maximum or (size is not None and length != size):
        raise ValueError("input size")
    raw = path.read_bytes()
    if digest is not None and sha(raw) != digest:
        raise ValueError("input SHA256")
    return raw


def selected_roles(members, out):
    result = {}
    for role, (path, digest) in SELECTED.items():
        found = [m for m in members if m["path"] == path and m["type"] == "file"]
        result[role] = {"path": path, "expectedSha256": digest, "observed": found,
                        "match": len(found) == 1 and found[0]["sha256"] == digest}
    write_json(out / "selected-tool-roles.json", result)
    if not all(v["match"] for v in result.values()):
        raise ValueError("selected tool role mismatch")
    return result


def source_origins(raw, out):
    result = {}
    for name, (size, digest) in SOURCE.items():
        members, _ = archive_reader.inventory_zip(raw[name])
        result[name] = {"url": SOURCE_URL + name, "bytes": size,
                        "sha256": digest, "members": len(members)}
        if name == "djcrx205.zip":
            comparisons = {}
            for role in ("dpmi.h", "farptr.h", "crt0.o", "libc.a"):
                tool_path, tool_hash = SELECTED[role]
                suffix = ("include/sys/farptr.h" if role == "farptr.h" else
                          "include/dpmi.h" if role == "dpmi.h" else "lib/" + role)
                found = [m for m in members if m["type"] == "file" and
                         m["path"].lower() == suffix]
                comparisons[role] = {"sourcePath": suffix, "toolPath": tool_path,
                                     "observed": found, "match": len(found) == 1 and
                                     found[0]["sha256"] == tool_hash}
            result[name]["runtimeByteOrigins"] = comparisons
        write_json(out / "runtime-source-origins.json", result)
    if not all(x["match"] for x in result["djcrx205.zip"]["runtimeByteOrigins"].values()):
        raise ValueError("DJCRX runtime byte origin mismatch")
    return result


def extract_checked_tool(raw, members, work):
    target = work / "toolchain"
    target.mkdir()
    if any(m["type"] == "symlink" for m in members):
        raise ValueError("toolchain symlink outside admitted profile")
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:bz2") as archive:
        archive.extractall(target, filter="data")
    checked = {}
    for m in members:
        if m["type"] not in ("file", "hardlink"):
            continue
        path = target / m["path"]
        if path.is_symlink() or not path.is_file():
            raise ValueError("extracted tool role missing")
        digest = sha(path.read_bytes())
        if m["type"] == "file" and (path.stat().st_size != m["bytes"] or digest != m["sha256"]):
            raise ValueError("extracted tool role differs")
        checked[m["path"]] = {"bytes": path.stat().st_size, "sha256": digest,
                              "archiveType": m["type"]}
    return target, checked


def child_limits():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (90, 90))
    resource.setrlimit(resource.RLIMIT_AS, (2 << 30, 2 << 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 << 20, 32 << 20))


def command(name, argv, cwd, env, out, timeout=120):
    start = time.monotonic()
    proc = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, start_new_session=True,
                            preexec_fn=child_limits)
    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(proc.pid, signal.SIGKILL)
        stdout, stderr = proc.communicate()
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for label, raw in (("stdout", stdout), ("stderr", stderr)):
        (out / (name + "." + label)).write_bytes(raw[:MAX_LOG])
    receipt = {"argv": argv, "exit": proc.returncode, "timeout": timed_out,
               "elapsedSeconds": time.monotonic() - start,
               "stdoutBytes": len(stdout), "stdoutSha256": sha(stdout),
               "stderrBytes": len(stderr), "stderrSha256": sha(stderr),
               "outputTruncated": max(len(stdout), len(stderr)) > MAX_LOG}
    write_json(out / (name + ".json"), receipt)
    if timed_out or proc.returncode != 0 or receipt["outputTruncated"]:
        raise ValueError(name + " command failed")
    return stdout, stderr


def run(paths, out, work):
    out.mkdir(parents=True, exist_ok=False)
    work.mkdir(parents=True, exist_ok=False)
    checkpoint(out, "input-manifest")
    observed_inputs(paths, out)
    checkpoint(out, "authenticate-archives")
    tool = load(paths["toolchain"], 81000000, TOOL_BYTES, TOOL_SHA)
    sources = {name: load(paths[name], 3000000, *attrs) for name, attrs in SOURCE.items()}
    client = load(paths["client"], 3000000, None, None)
    checkpoint(out, "tool-member-inventory")
    members, _ = archive_reader.inventory_tar(tool)
    selected_roles(members, out)
    source_origins(sources, out)
    checkpoint(out, "extract-verified-toolchain")
    extracted, extracted_roles = extract_checked_tool(tool, members, work)
    write_json(out / "extracted-tool-roles.json", extracted_roles)
    prefix = extracted / "djgpp"
    compiler = prefix / "bin/i586-pc-msdosdjgpp-gcc"
    if sha(compiler.read_bytes()) != SELECTED["compiler"][1]:
        raise ValueError("compiler executable changed after extraction")
    build = work / "build"
    build.mkdir()
    (build / "client.c").write_bytes(client)
    env = {"PATH": str(prefix / "bin") + ":/usr/bin:/bin", "LC_ALL": "C",
           "HOME": str(work), "TMPDIR": str(work), "SOURCE_DATE_EPOCH": "0"}
    gcc = str(compiler)
    cflags = ["-std=gnu11", "-O2", "-march=i386", "-mtune=i386",
              "-Wall", "-Wextra", "-Werror", "-fno-lto"]
    compile_argv = [gcc, *cflags, "-c", "client.c", "-o", "client.o"]
    link_argv = [gcc, "-march=i386", "-mtune=i386", "-Wl,-Map,client.map",
                 "-o", "client.exe", "client.o"]
    checkpoint(out, "compiler-probes")
    for name, argv in (("gcc-version", [gcc, "-v"]),
                       ("gcc-search", [gcc, "-print-search-dirs"]),
                       ("gcc-crt0-role", [gcc, "-print-file-name=crt0.o"]),
                       ("gcc-libc-role", [gcc, "-print-file-name=libc.a"]),
                       ("gcc-libgcc-role", [gcc, "-print-file-name=libgcc.a"]),
                       ("gcc-as-role", [gcc, "-print-prog-name=as"]),
                       ("gcc-ld-role", [gcc, "-print-prog-name=ld"]),
                       ("gcc-stubify-role", [gcc, "-print-prog-name=stubify"]),
                       ("gcc-compile-plan", [gcc, "-###", *compile_argv[1:]]),
                       ("gcc-link-plan", [gcc, "-###", *link_argv[1:]])):
        command(name, argv, build, env, out, 30)
    checkpoint(out, "compile-owned-client")
    command("compile", compile_argv, build, env, out)
    obj = build / "client.o"
    if not obj.is_file() or obj.stat().st_size > 16 << 20:
        raise ValueError("bounded object missing")
    object_receipt = {"bytes": obj.stat().st_size, "sha256": sha(obj.read_bytes())}
    write_json(out / "client-object.json", object_receipt)
    checkpoint(out, "link-owned-client")
    command("link", link_argv, build, env, out)
    exe, map_file = build / "client.exe", build / "client.map"
    if not exe.is_file() or not map_file.is_file() or exe.stat().st_size > 16 << 20 or map_file.stat().st_size > 4 << 20:
        raise ValueError("bounded link outputs missing")
    header = exe.open("rb").read(64)
    map_raw = map_file.read_bytes()
    (out / "client.map").write_bytes(map_raw)
    link_evidence = (map_raw + (out / "gcc-link-plan.stderr").read_bytes() +
                     (out / "gcc-link-plan.stdout").read_bytes())
    observed_roles = {}
    for role, (path, digest) in SELECTED.items():
        absolute = str(extracted / path).encode()
        observed_roles[role] = {"path": path, "sha256": digest,
                                "absolutePathInMapOrLinkPlan": absolute in link_evidence,
                                "rolePathInMapOrLinkPlan": path.encode() in link_evidence}
    write_json(out / "link-role-observations.json", observed_roles)
    report = {"schema": "bw.cwsdpmi-owned.compile-only.v1", "status": "COMPILED_NO_GUEST_NO_BINARY_PUBLICATION",
              "toolchain": {"url": TOOL_URL, "bytes": TOOL_BYTES, "sha256": TOOL_SHA,
                            "members": len(members), "selected": SELECTED},
              "sourceArchives": {n: {"url": SOURCE_URL + n, "bytes": b, "sha256": h}
                                 for n, (b, h) in SOURCE.items()},
              "ownedSource": {"path": str(CLIENT), "sha256": sha(client)},
              "compileArgv": compile_argv, "linkArgv": link_argv,
              "object": object_receipt,
              "selectedLinkRoleObservations": observed_roles,
              "executable": {"bytes": exe.stat().st_size,
                             "sha256": sha(exe.read_bytes()),
                             "mzPrefix": header[:2] == b"MZ", "uploaded": False},
              "map": {"bytes": len(map_raw), "sha256": sha(map_raw)},
              "limits": ["Compiler target is i586; -march/-mtune govern owned object only, not every linked startup/runtime instruction",
                         "No link-component licence or libgcc source-to-binary closure is claimed",
                         "No client executable, object, archive, or toolchain bytes are uploaded",
                         "No QEMU, AT guest, or performance execution occurred"]}
    write_json(out / "compile-report.json", report)
    checkpoint(out, "complete")
    return report


def run_preserving_failure(paths, out, work):
    try:
        return run(paths, out, work)
    except Exception as error:
        phase = "before-output"
        if (out / "progress.json").is_file():
            phase = json.loads((out / "progress.json").read_text())["phase"]
        if out.is_dir():
            try:
                partial_map = work / "build/client.map"
                if partial_map.is_file() and not partial_map.is_symlink() and partial_map.stat().st_size <= 4 << 20:
                    raw = partial_map.read_bytes()
                    (out / "partial-client.map").write_bytes(raw)
                    write_json(out / "partial-client-map.json",
                               {"bytes": len(raw), "sha256": sha(raw), "phase": phase})
            except Exception as secondary:
                try:
                    write_json(out / "secondary-evidence-error.json",
                               {"exceptionType": type(secondary).__name__})
                except Exception:
                    pass
            try:
                write_json(out / "failure.json", {"phase": phase,
                           "exceptionType": type(error).__name__,
                           "message": str(error) if isinstance(error, ValueError) else "see audit.stderr"})
            except Exception:
                pass
        raise


if __name__ == "__main__":
    if len(sys.argv) != 8:
        raise SystemExit("usage: compile.py tool.tar.bz2 djcrx.zip djdev.zip djlsr.zip client.c evidence-dir work-dir")
    names = ("toolchain", *SOURCE, "client")
    run_preserving_failure(dict(zip(names, map(Path, sys.argv[1:6]))),
                           Path(sys.argv[6]), Path(sys.argv[7]))
