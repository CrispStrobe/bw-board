#!/usr/bin/env python3
"""One bounded QEMU control for the separate owned high-memory/timer client."""

import hashlib
import importlib.util
import json
import os
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path

from grade import grade

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parent / "i80386-cwsdpmi-qemu-owned/oracle.py"
spec = importlib.util.spec_from_file_location("unchanged_cwsdpmi_oracle_primitives", LEGACY)
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)

GEOMETRY_BYTES = legacy.GEOMETRY_BYTES
FLOPPY_SHA = legacy.FLOPPY_SHA
FIRST = "c:\\runht.bat\r"
SECOND = "c:\\verifyht.bat\r"
BATCH_DONE = "BW-HMT-BATCH-DONE"
NAMES = {"output": b"HTOUT   TXT", "ok": b"HTOK    TXT",
         "fail": b"HTFAIL  TXT", "returned": b"HTRET   TXT"}
WALL_LIMIT = 240.0
RSS_LIMIT = 1536 << 20
PREVIEW_BYTES = 256


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))


def ordinary(path, maximum, size=None, digest=None):
    shape = path.lstat()
    if not stat.S_ISREG(shape.st_mode) or shape.st_size > maximum or (
            size is not None and shape.st_size != size):
        raise ValueError("nonordinary or wrong-sized input")
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_dev != shape.st_dev or (
                before.st_ino != shape.st_ino or before.st_size != shape.st_size):
            raise ValueError("input changed before read")
        chunks, total = [], 0
        while True:
            part = os.read(fd, min(1 << 20, maximum + 1 - total))
            if not part:
                break
            total += len(part)
            if total > maximum:
                raise ValueError("input grew beyond bound")
            chunks.append(part)
        after = os.fstat(fd)
        if after.st_size != before.st_size or total != before.st_size:
            raise ValueError("input changed during read")
    finally:
        os.close(fd)
    raw = b"".join(chunks)
    if digest is not None and sha(raw) != digest:
        raise ValueError("input hash")
    return raw


def files(image):
    return {role: legacy.root_file(image, name) for role, name in NAMES.items()}


def files_receipt(values):
    result = {}
    for role, raw in values.items():
        if raw is None:
            result[role] = None
            continue
        prefix = raw[:PREVIEW_BYTES]
        result[role] = {"bytes": len(raw), "sha256": sha(raw),
                        "prefixBytes": len(prefix), "prefixHex": prefix.hex(),
                        "prefixLatin1": prefix.decode("latin1"),
                        "truncated": len(raw) > len(prefix)}
    return result


def current_echo(rows, command):
    if not legacy.has_prompt(rows):
        return False
    nonempty = [row.strip() for row in rows if row.strip()]
    return len(nonempty) >= 2 and nonempty[-1].upper() == "C:\\>" and any(
        row.lower() == "c:\\>" + command.lower() for row in nonempty[:-1])


def client_screen(rows):
    return legacy.has_prompt(rows) and BATCH_DONE in rows and current_echo(rows, FIRST.strip())


def return_screen(rows):
    return current_echo(rows, SECOND.strip())


def screen_receipt(rows, raw, step):
    if len(raw) != 4000 or len(rows) != 25 or any(len(row) > 80 for row in rows):
        raise ValueError("screen receipt extent")
    admitted = {"A:\\>", "C:\\>", "A:\\>c:\\runht.bat", "C:\\>c:\\runht.bat",
                "C:\\>c:\\verifyht.bat", BATCH_DONE}
    return {"sample": step, "bytes": len(raw), "sha256": sha(raw),
            "ownedOrPromptRows": [row.strip() for row in rows if row.strip().lower() in
                                  {name.lower() for name in admitted}]}


def run(inputs, output):
    evidence = output.parent
    scratch = Path(inputs["scratch"])
    if not scratch.is_dir() or scratch.is_symlink():
        raise ValueError("oracle scratch directory")
    media_raw = ordinary(Path(inputs["media"]), 1 << 20)
    media = strict_json(media_raw)
    if media.get("schema") != "bw.cwsdpmi-highmem-timer.qemu-media.v1":
        raise ValueError("new media profile")
    initial = ordinary(Path(inputs["disk"]), GEOMETRY_BYTES, GEOMETRY_BYTES, media["sha256"])
    ordinary(Path(inputs["floppy"]), 1_228_800, 1_228_800, FLOPPY_SHA)
    expected = {"CWSDPMI EXE", "CLIENT  EXE", "RUNHT   BAT", "VERIFYHTBAT"}
    if set(media["files"]) != expected:
        raise ValueError("initial guest role set")
    if (media.get("compileClientSha256") != media["files"]["CLIENT  EXE"]["sha256"] or
            media.get("cwsdpmiSha256") != media["files"]["CWSDPMI EXE"]["sha256"]):
        raise ValueError("media compiled-client/CWSDPMI role binding")
    for name, receipt in media["files"].items():
        raw = legacy.initial_file(initial, name.encode("ascii"))
        if raw is None or len(raw) != receipt["bytes"] or sha(raw) != receipt["sha256"]:
            raise ValueError("initial guest file binding")
    if any(value is not None for value in files(initial).values()):
        raise ValueError("preexisting result file")
    qemu = Path(inputs["qemu"]).resolve(strict=True)
    bios, vga = Path(inputs["bios"]), Path(inputs["vga"])
    if bios.parent != vga.parent or bios.name != "bios-256k.bin" or vga.name != "vgabios-stdvga.bin":
        raise ValueError("QEMU firmware profile")
    components = {}
    for role, path, cap in (("qemu", qemu, 64 << 20), ("bios", bios, 1 << 20),
                            ("vga", vga, 1 << 20)):
        raw = ordinary(path, cap)
        if sha(raw) != inputs[role + "Sha256"]:
            raise ValueError("QEMU component hash: " + role)
        components[role] = {"bytes": len(raw), "sha256": sha(raw)}
    oracle_disk = scratch / "oracle-disk.img"
    with oracle_disk.open("xb") as stream:
        stream.write(initial)
    qmp_path = scratch / "oracle-qmp.sock"
    if qmp_path.exists() or qmp_path.is_symlink():
        raise ValueError("stale QMP socket path")
    command = [str(qemu), "-accel", "tcg", "-machine", "pc", "-cpu", "486", "-m", "4",
               "-display", "none", "-vga", "std", "-no-user-config", "-net", "none",
               "-no-reboot", "-boot", "order=a", "-L", str(bios.parent), "-bios", str(bios),
               "-drive", f"file={inputs['floppy']},if=floppy,index=0,format=raw,readonly=on",
               "-drive", f"file={oracle_disk},if=ide,index=0,format=raw,cache=directsync",
               "-qmp", f"unix:{qmp_path},server=on,wait=off"]
    report = {"schema": "bw.cwsdpmi-highmem-timer.qemu-oracle.v1", "passed": False,
              "profile": "QEMU TCG pc/486, 4 MiB, SeaBIOS/std VGA, FreeDOS 1.4",
              "qemuVersion": inputs["qemuVersion"], "qemuPackage": inputs["qemuPackage"],
              "seabiosPackage": inputs["seabiosPackage"], "initialDiskSha256": sha(initial),
              "mediaSha256": sha(media_raw), "mediaClientSha256": media["compileClientSha256"],
              "mediaCwsdpmiSha256": media["cwsdpmiSha256"],
              "components": components, "floppySha256": FLOPPY_SHA,
              "stage": "launch", "screenMilestones": {},
              "events": [], "limits": {"wallSeconds": WALL_LIMIT, "rssBytes": RSS_LIMIT,
              "screenProbes": 480, "partialFatReads": 20}}
    start = time.monotonic()
    proc = monitor = None
    reaped = False
    last_screen = None
    probes = partial_fat = 0
    out_path, err_path = evidence / "qemu.stdout", evidence / "qemu.stderr"
    with out_path.open("xb") as stdout, err_path.open("xb") as stderr:
        try:
            proc = subprocess.Popen(command, stdout=stdout, stderr=stderr,
                                    start_new_session=True, preexec_fn=legacy.child_limits)
            while not qmp_path.exists() and time.monotonic() < start + 10:
                if proc.poll() is not None:
                    raise ValueError("QEMU exited before QMP")
                time.sleep(0.1)
            if not qmp_path.exists():
                raise TimeoutError("QMP startup")
            monitor = legacy.QMP(qmp_path)

            def ensure():
                if time.monotonic() - start > WALL_LIMIT:
                    raise TimeoutError("QEMU wall bound")
                if proc.poll() is not None:
                    raise ValueError("QEMU exited before completion")
                if legacy.rss(proc.pid) > RSS_LIMIT:
                    raise MemoryError("QEMU RSS bound")
                if out_path.stat().st_size > 1 << 20 or err_path.stat().st_size > 1 << 20:
                    raise ValueError("QEMU output cap")

            def screen():
                nonlocal probes, last_screen
                ensure()
                probes += 1
                if probes > 480:
                    raise ValueError("QEMU screen probe cap")
                rows, raw = monitor.screen(scratch)
                last_screen = screen_receipt(rows, raw, probes)
                return rows, last_screen

            def observe():
                nonlocal partial_fat
                ensure()
                disk = ordinary(oracle_disk, GEOMETRY_BYTES, GEOMETRY_BYTES)
                disk_hash = sha(disk)
                try:
                    found = files(disk)
                    report["lastObservedDisk"] = {"sha256": disk_hash,
                                                  "files": files_receipt(found)}
                    return disk_hash, found
                except ValueError as error:
                    partial_fat += 1
                    report["lastUnparseableDiskSha256"] = disk_hash
                    report.setdefault("partialFat", {"first": type(error).__name__, "observations": 0})
                    report["partialFat"]["observations"] = partial_fat
                    if partial_fat > 20:
                        raise ValueError("QEMU FAT remained malformed") from error
                    return None

            def send(label, command_text):
                monitor.send(command_text)
                report["events"].append({"command": label, "atSeconds": round(time.monotonic() - start, 3),
                                         "qmpKeyOffers": len(legacy.prior.keys(command_text))})

            report["stage"] = "boot"
            declined, kicks, last_kick = False, 0, -20.0
            while True:
                rows, view = screen()
                now = time.monotonic() - start
                if legacy.has_prompt(rows):
                    report["screenMilestones"]["boot"] = view
                    break
                if any("Do you want to proceed" in row for row in rows) and not declined:
                    send("decline-installer", "n\r")
                    declined = True
                elif any("press [ENTER]" in row or "Select from Menu" in row for row in rows) and (
                        now - last_kick > 10 and kicks < 4):
                    send("boot-enter", "\r")
                    last_kick, kicks = now, kicks + 1
                if now > 120:
                    raise TimeoutError("FreeDOS boot prompt")
                time.sleep(0.5)

            send(FIRST.strip(), FIRST)
            report["stage"] = "client-batch"
            first = None
            while True:
                rows, view = screen()
                seen = observe()
                if seen is None:
                    time.sleep(0.5)
                    continue
                disk_hash, found = seen
                if found["fail"] is not None:
                    raise ValueError("guest failure marker")
                if found["ok"] is not None:
                    parsed = grade(found, False)
                    if client_screen(rows):
                        if first is None:
                            first = (disk_hash, files_receipt(found), parsed)
                            report["screenMilestones"]["postClientFirst"] = view
                        elif first == (disk_hash, files_receipt(found), parsed):
                            report["screenMilestones"]["postClientSecond"] = view
                            report["clientFiles"] = files_receipt(found)
                            report["clientDiagnostics"] = parsed
                            break
                    else:
                        first = None
                if time.monotonic() - start > 200:
                    raise TimeoutError("QEMU client and current prompt")
                time.sleep(0.5)

            pre_verify = observe()
            if pre_verify is None or pre_verify[1]["returned"] is not None:
                raise ValueError("return existed before separate command")
            rows, view = screen()
            if any(row.strip().lower() == "c:\\>" + SECOND.strip() for row in rows):
                raise ValueError("stale VERIFY echo before offer")
            report["preVerify"] = {"diskSha256": pre_verify[0],
                                   "files": files_receipt(pre_verify[1]), "screen": view}
            send(SECOND.strip(), SECOND)
            report["stage"] = "shell-return"
            first = None
            while True:
                rows, view = screen()
                seen = observe()
                if seen is None:
                    time.sleep(0.5)
                    continue
                disk_hash, found = seen
                if found["fail"] is not None:
                    raise ValueError("guest failure marker after VERIFY")
                if found["returned"] is not None:
                    parsed = grade(found, True)
                    if return_screen(rows):
                        if first is None:
                            first = (disk_hash, files_receipt(found), parsed)
                            report["screenMilestones"]["returnFirst"] = view
                        elif first == (disk_hash, files_receipt(found), parsed):
                            report["screenMilestones"]["returnSecond"] = view
                            report["returnFiles"] = files_receipt(found)
                            break
                    else:
                        first = None
                if time.monotonic() - start > 230:
                    raise TimeoutError("separate return and current prompt")
                time.sleep(0.5)

            try:
                monitor.call("quit")
            except (EOFError, BrokenPipeError, ValueError, OSError):
                pass
            while True:
                pid, status, usage = os.wait4(proc.pid, os.WNOHANG)
                if pid:
                    break
                if time.monotonic() - start > WALL_LIMIT:
                    raise TimeoutError("QEMU exit after quit")
                time.sleep(0.1)
            reaped = True
            report["qemuExitStatus"] = os.waitstatus_to_exitcode(status)
            report["maxRssBytes"] = usage.ru_maxrss * 1024
            if report["qemuExitStatus"] != 0 or report["maxRssBytes"] > RSS_LIMIT:
                raise ValueError("QEMU exit/RSS")
            try:
                os.killpg(proc.pid, 0)
            except ProcessLookupError:
                report["processGroupEmpty"] = True
            else:
                os.killpg(proc.pid, signal.SIGKILL)
                raise ValueError("QEMU descendant survived")
            final = ordinary(oracle_disk, GEOMETRY_BYTES, GEOMETRY_BYTES)
            exact = files(final)
            parsed = grade(exact, True)
            if parsed != report["clientDiagnostics"]:
                raise ValueError("terminal diagnostic differs from observed client")
            report["finalDiskSha256"] = sha(final)
            report["finalFiles"] = files_receipt(exact)
            report["screenProbes"] = probes
            report["partialFatReads"] = partial_fat
            report["passed"] = True
            report["stage"] = "done"
        except Exception as error:
            report.setdefault("firstFailure", f"{type(error).__name__}: {str(error)[:200]}")
            if last_screen is not None:
                report["lastScreen"] = last_screen
            try:
                partial = ordinary(oracle_disk, GEOMETRY_BYTES, GEOMETRY_BYTES)
                report["partialDiskSha256"] = sha(partial)
                report["partialGuestFiles"] = files_receipt(files(partial))
            except Exception as secondary:
                report["partialDiskError"] = type(secondary).__name__
        finally:
            previous_term = signal.signal(signal.SIGTERM, signal.SIG_IGN)
            previous_int = signal.signal(signal.SIGINT, signal.SIG_IGN)
            if monitor is not None:
                try:
                    monitor.close()
                except Exception as secondary:
                    report["cleanupMonitorError"] = type(secondary).__name__
            if proc is not None and not reaped:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except Exception as secondary:
                    report["cleanupKillError"] = type(secondary).__name__
                end = time.monotonic() + 5
                while time.monotonic() < end:
                    try:
                        pid, status, usage = os.wait4(proc.pid, os.WNOHANG)
                    except ChildProcessError:
                        reaped = True
                        break
                    except Exception as secondary:
                        report["cleanupWaitError"] = type(secondary).__name__
                        break
                    if pid:
                        reaped = True
                        report["cleanupExitStatus"] = os.waitstatus_to_exitcode(status)
                        report["maxRssBytes"] = usage.ru_maxrss * 1024
                        break
                    time.sleep(0.05)
                if not reaped:
                    report["cleanupIncomplete"] = True
            report["elapsedWallSeconds"] = round(time.monotonic() - start, 3)
            signal.signal(signal.SIGTERM, previous_term)
            signal.signal(signal.SIGINT, previous_int)
    return report


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: oracle.py input.json evidence/highmem-oracle.json")
    output = Path(sys.argv[2])
    if output.name != "highmem-oracle.json":
        raise SystemExit("oracle result name")
    signal.signal(signal.SIGTERM, legacy.prior.interrupted)
    signal.signal(signal.SIGINT, legacy.prior.interrupted)
    try:
        report = run(strict_json(ordinary(Path(sys.argv[1]), 1 << 20)), output)
    except Exception as error:
        report = {"schema": "bw.cwsdpmi-highmem-timer.qemu-oracle.v1", "passed": False,
                  "firstFailure": f"preflight {type(error).__name__}: {str(error)[:200]}"}
    with output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, sort_keys=True)
        stream.write("\n")
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
