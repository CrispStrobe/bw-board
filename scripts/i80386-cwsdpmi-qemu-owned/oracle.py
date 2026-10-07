#!/usr/bin/env python3
"""One bounded QEMU/FreeDOS execution of the freshly compiled owned DPMI client."""

import hashlib
import importlib.util
import json
import os
import resource
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pinned_dos32_qmp", HERE.parent / "i80386-dos32a-owned/oracle.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)

GEOMETRY_BYTES = prior.GEOMETRY_BYTES
FLOPPY_SHA = prior.FLOPPY_SHA
QMP = prior.QMP
has_prompt = prior.has_prompt
root_file = prior.root_file
FIRST = "c:\\rundp.bat\r"
SECOND = "c:\\verify.bat\r"
SUCCESS = b"BW_DPMI_OK checksum=4225408"
EXIT_OK = b"BW-DPMI-EXIT-0"
EXIT_FAIL = b"BW-DPMI-EXIT-FAIL"
RETURN = b"BW-DPMI-SHELL-RETURN"
NAMES = {"output": b"DPOUT   TXT", "ok": b"DPOK    TXT",
         "fail": b"DPFAIL  TXT", "returned": b"RETURN  TXT"}
WALL_LIMIT = 240.0
RSS_LIMIT = 1536 << 20


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def ordinary(path, maximum, size=None, digest=None):
    st = path.lstat()
    if not path.is_file() or path.is_symlink() or st.st_size > maximum or (size is not None and st.st_size != size):
        raise ValueError("nonordinary or wrong-sized oracle input")
    raw = path.read_bytes()
    if digest is not None and sha(raw) != digest:
        raise ValueError("oracle input hash")
    return raw


def file_receipt(path, maximum):
    return {"path": str(path), "bytes": len(raw := ordinary(path, maximum)), "sha256": sha(raw)}


def guest_files(disk):
    return {role: root_file(disk, name) for role, name in NAMES.items()}


def file_report(files):
    return {role: None if data is None else {"bytes": len(data), "sha256": sha(data),
            "text": data.decode("latin1")} for role, data in files.items()}


def accepted(files):
    output = files["output"]
    lines = () if output is None else output.replace(b"\r", b"").split(b"\n")
    return {"exactSuccessLine": lines.count(SUCCESS) == 1 and
            not any(b"BW_DPMI_FAIL" in line for line in lines),
            "zeroErrorlevel": files["ok"] is not None and
            files["ok"].replace(b"\r", b"").strip() == EXIT_OK and
            files["fail"] is None,
            "separateReturn": files["returned"] is not None and
            files["returned"].replace(b"\r", b"").strip() == RETURN}


def rss(pid):
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except FileNotFoundError:
        pass
    return 0


def child_limits():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_AS, (64 << 30, 64 << 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))


def run(inputs, output):
    evidence = output.parent
    scratch = Path(inputs["scratch"])
    if not scratch.is_dir() or scratch.is_symlink():
        raise ValueError("oracle scratch directory")
    disk_path = Path(inputs["disk"])
    media = json.loads(ordinary(Path(inputs["media"]), 1 << 20))
    initial = ordinary(disk_path, GEOMETRY_BYTES, GEOMETRY_BYTES, media["sha256"])
    ordinary(Path(inputs["floppy"]), 1_228_800, 1_228_800, FLOPPY_SHA)
    initial_files = {name: root_file(initial, name.encode("ascii"))
                     for name in media["files"]}
    if set(initial_files) != {"CWSDPMI EXE", "CLIENT  EXE", "RUNDP   BAT", "VERIFY  BAT"}:
        raise ValueError("initial guest file roles")
    for name, data in initial_files.items():
        receipt = media["files"][name]
        if data is None or len(data) != receipt["bytes"] or sha(data) != receipt["sha256"]:
            raise ValueError("initial guest file bytes")
    if any(value is not None for value in guest_files(initial).values()):
        raise ValueError("preexisting guest result file")
    qemu = Path(inputs["qemu"])
    qemu = qemu.resolve(strict=True)
    bios = Path(inputs["bios"])
    vga = Path(inputs["vga"])
    if bios.parent != vga.parent or bios.name != "bios-256k.bin" or vga.name != "vgabios-stdvga.bin":
        raise ValueError("explicit QEMU BIOS/VGA profile")
    components = {"qemu": file_receipt(qemu, 64 << 20),
                  "bios": file_receipt(bios, 1 << 20),
                  "vga": file_receipt(vga, 1 << 20)}
    for role in components:
        if components[role]["sha256"] != inputs[role + "Sha256"]:
            raise ValueError("QEMU component changed after runtime admission: " + role)
    oracle_disk = scratch / "oracle-disk.img"
    with oracle_disk.open("xb") as stream:
        stream.write(initial)
    qmp_path = scratch / "oracle-qmp.sock"
    command = [str(qemu), "-accel", "tcg", "-machine", "pc", "-cpu", "486", "-m", "4",
               "-display", "none", "-vga", "std", "-no-user-config", "-net", "none",
               "-no-reboot", "-boot", "order=a", "-L", str(bios.parent), "-bios", str(bios),
               "-drive", f"file={inputs['floppy']},if=floppy,index=0,format=raw,readonly=on",
               "-drive", f"file={oracle_disk},if=ide,index=0,format=raw,cache=directsync",
               "-qmp", f"unix:{qmp_path},server=on,wait=off"]
    start = time.monotonic()
    report = {"schema": "bw.cwsdpmi-owned.qemu-oracle.v1", "passed": False,
              "profile": "QEMU TCG pc/486, 4 MiB, SeaBIOS/std VGA, FreeDOS 1.4; no AT comparison",
              "components": components, "command": command,
              "qemuVersion": inputs["qemuVersion"], "qemuPackage": inputs["qemuPackage"],
              "seabiosPackage": inputs["seabiosPackage"],
              "initialDiskSha256": sha(initial), "floppySha256": FLOPPY_SHA,
              "inputCommands": [FIRST.strip(), SECOND.strip()], "events": [], "vgaEvidence": {}}
    proc = monitor = None
    reaped = False
    last_raw = None
    out_path, err_path = evidence / "qemu.stdout", evidence / "qemu.stderr"
    with out_path.open("xb") as stdout, err_path.open("xb") as stderr:
        try:
            proc = subprocess.Popen(command, stdout=stdout, stderr=stderr,
                                    start_new_session=True, preexec_fn=child_limits)
            deadline = start + WALL_LIMIT
            while not qmp_path.exists() and time.monotonic() < start + 10:
                if proc.poll() is not None:
                    raise ValueError("QEMU exited before QMP")
                time.sleep(0.1)
            if not qmp_path.exists():
                raise TimeoutError("QMP startup")
            monitor = QMP(qmp_path)
            probes = 0
            partial_fat = 0

            def ensure():
                if time.monotonic() > deadline:
                    raise TimeoutError("QEMU wall bound")
                if rss(proc.pid) > RSS_LIMIT:
                    raise MemoryError("QEMU RSS bound")
                if proc.poll() is not None:
                    raise ValueError("QEMU exited before guest completion")
                if out_path.stat().st_size > 1 << 20 or err_path.stat().st_size > 1 << 20:
                    raise ValueError("QEMU output cap")

            def screen():
                nonlocal probes, last_raw
                ensure()
                probes += 1
                if probes > 480:
                    raise ValueError("QEMU screen probe cap")
                rows, raw = monitor.screen(scratch)
                last_raw = raw
                return rows, raw

            def retain_screen(role, raw):
                name = f"oracle-vga-{role}.bin"
                with (evidence / name).open("xb") as stream:
                    stream.write(raw)
                report["vgaEvidence"][role] = {"file": name, "bytes": len(raw), "sha256": sha(raw)}

            def observe_files():
                nonlocal partial_fat
                try:
                    return guest_files(ordinary(oracle_disk, GEOMETRY_BYTES, GEOMETRY_BYTES))
                except ValueError:
                    partial_fat += 1
                    if partial_fat > 20:
                        raise ValueError("oracle FAT remained malformed")
                    return None

            def send(label, text):
                monitor.send(text)
                report["events"].append({"atSeconds": round(time.monotonic() - start, 2),
                                         "input": label, "qcodes": prior.keys(text)})

            declined, kicks, last_kick = False, 0, -20.0
            while True:
                rows, raw = screen()
                now = time.monotonic() - start
                if has_prompt(rows):
                    report["bootPrompt"] = rows
                    retain_screen("boot", raw)
                    break
                if any("Do you want to proceed" in row for row in rows) and not declined:
                    send("decline-installer", "n\r")
                    declined = True
                elif (any("press [ENTER]" in row or "Select from Menu" in row for row in rows)
                      and now - last_kick > 10 and kicks < 4):
                    send("boot-enter", "\r")
                    last_kick, kicks = now, kicks + 1
                if now > 120:
                    raise TimeoutError("FreeDOS boot prompt")
                time.sleep(0.5)
            send(FIRST.strip(), FIRST)
            while True:
                rows, raw = screen()
                files = observe_files()
                if files is None:
                    time.sleep(0.5)
                    continue
                if files["fail"] is not None:
                    raise ValueError("guest reported DPMI failure level")
                if files["ok"] is not None and has_prompt(rows):
                    report["postClientPrompt"] = rows
                    retain_screen("post-client", raw)
                    break
                if time.monotonic() > start + 170:
                    raise TimeoutError("DPMI client and shell prompt")
                time.sleep(0.5)
            send(SECOND.strip(), SECOND)
            while True:
                rows, raw = screen()
                files = observe_files()
                if files is None:
                    time.sleep(0.5)
                    continue
                if files["returned"] is not None and has_prompt(rows):
                    report["finalPrompt"] = rows
                    retain_screen("final", raw)
                    break
                if time.monotonic() > start + 210:
                    raise TimeoutError("separate shell return")
                time.sleep(0.5)
            try:
                monitor.call("quit")
            except (EOFError, BrokenPipeError, ValueError, OSError):
                pass
            while True:
                pid, status, usage = os.wait4(proc.pid, os.WNOHANG)
                if pid:
                    break
                if time.monotonic() > deadline:
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
            files = guest_files(final)
            report["finalDiskSha256"] = sha(final)
            report["guestFiles"] = file_report(files)
            report["checks"] = {**accepted(files), "currentFinalPrompt": has_prompt(report["finalPrompt"]),
                                "separateInput": len([e for e in report["events"] if e["input"] == SECOND.strip()]) == 1}
            report["passed"] = all(report["checks"].values())
            if not report["passed"]:
                report["firstFailure"] = "guest output/level/return differs"
            report["screenProbes"] = probes
            report["partialFatReads"] = partial_fat
        except Exception as error:
            report.setdefault("firstFailure", f"{type(error).__name__}: {str(error)[:240]}")
            if last_raw is not None:
                try:
                    retain_screen("failure", last_raw)
                except Exception as secondary:
                    report["vgaRetentionError"] = type(secondary).__name__
            try:
                partial = ordinary(oracle_disk, GEOMETRY_BYTES, GEOMETRY_BYTES)
                report["partialDiskSha256"] = sha(partial)
                report["partialGuestFiles"] = file_report(guest_files(partial))
            except Exception as secondary:
                report["partialDiskError"] = type(secondary).__name__
        finally:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
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
            if oracle_disk.is_file():
                try:
                    report.setdefault("finalDiskSha256", sha(ordinary(oracle_disk, GEOMETRY_BYTES, GEOMETRY_BYTES)))
                except Exception as secondary:
                    report["cleanupDiskError"] = type(secondary).__name__
    return report


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: oracle.py input.json evidence/oracle.json")
    output = Path(sys.argv[2])
    signal.signal(signal.SIGTERM, prior.interrupted)
    signal.signal(signal.SIGINT, prior.interrupted)
    try:
        report = run(json.loads(Path(sys.argv[1]).read_text()), output)
    except Exception as error:
        report = {"schema": "bw.cwsdpmi-owned.qemu-oracle.v1", "passed": False,
                  "firstFailure": f"preflight {type(error).__name__}: {str(error)[:240]}"}
    write(output, report)
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
