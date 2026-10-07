#!/usr/bin/env python3
"""Independent QEMU/FreeDOS output-and-exit oracle for the same owned client.

QEMU has its own 486-class CPU/BIOS/device profile. Its result is an external
application oracle, not a state-by-state original-386 comparison.
"""

from __future__ import annotations

import hashlib
import json
import os
import resource
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
import re

GEOMETRY_BYTES = 306 * 4 * 17 * 512
FLOPPY_SHA = "03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77"
SUCCESS = b"BW-DOS32-LE-ARITH-OK"
FAILURE = b"BW-DOS32-LE-ARITH-FAIL"
EXIT_OK = b"BW-LE-EXIT-0"
RETURN = b"BW-LE-SHELL-RETURN"
FIRST = "c:\\runle.bat\r"
SECOND = "c:\\verify.bat\r"
RSS_LIMIT = 1536 * 1024 * 1024
WALL_LIMIT = 240.0
PROMPT = re.compile(r"^[A-Z]:\\>\s*$")


def interrupted(signum: int, _frame: object) -> None:
    raise TimeoutError(f"oracle driver interrupted by signal {signum}")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def ordinary(path: Path, size: int | None = None, digest: str | None = None) -> bytes:
    stat = path.lstat()
    if not path.is_file() or path.is_symlink() or (size is not None and stat.st_size != size):
        raise ValueError("input shape")
    raw = path.read_bytes()
    if digest is not None and sha(raw) != digest:
        raise ValueError("input digest")
    return raw


def u16(raw: bytes, at: int) -> int:
    return int.from_bytes(raw[at:at + 2], "little")


def u32(raw: bytes, at: int) -> int:
    return int.from_bytes(raw[at:at + 4], "little")


def root_file(image: bytes, name: bytes) -> bytes | None:
    """Independently decode a bounded 8.3 FAT16 root file."""
    if len(image) != GEOMETRY_BYTES or len(name) != 11 or image[510:512] != b"\x55\xaa":
        raise ValueError("disk geometry/root name")
    part = u32(image, 454)
    vbr = part * 512
    if part != 17 or image[vbr + 510:vbr + 512] != b"\x55\xaa":
        raise ValueError("partition")
    if u16(image, vbr + 11) != 512 or image[vbr + 16] != 2 or u16(image, vbr + 17) != 512:
        raise ValueError("FAT BPB")
    spc, fat_sectors = image[vbr + 13], u16(image, vbr + 22)
    if spc not in (2, 4, 8) or not 1 <= fat_sectors <= 512:
        raise ValueError("FAT geometry")
    fat = (part + 1) * 512
    root = (part + 1 + 2 * fat_sectors) * 512
    data = root + 32 * 512
    found = None
    for index in range(512):
        at = root + index * 32
        if image[at] == 0:
            break
        if image[at] == 0xe5 or image[at + 11] & 0x18:
            continue
        if image[at:at + 11] == name:
            if found is not None:
                raise ValueError("duplicate root name")
            found = (u16(image, at + 26), u32(image, at + 28))
    if found is None:
        return None
    cluster, remaining = found
    if remaining > 65536:
        raise ValueError("guest output cap")
    if remaining == 0:
        return b""
    chunks, visited = [], set()
    while remaining:
        if cluster < 2 or cluster >= 65528 or cluster in visited:
            raise ValueError("FAT chain")
        visited.add(cluster)
        at = data + (cluster - 2) * spc * 512
        count = min(remaining, spc * 512)
        if at + count > len(image):
            raise ValueError("FAT extent")
        chunks.append(image[at:at + count])
        remaining -= count
        next_cluster = u16(image, fat + cluster * 2)
        if remaining and next_cluster >= 0xfff8:
            raise ValueError("short FAT chain")
        if not remaining and next_cluster < 0xfff8:
            raise ValueError("long FAT chain")
        cluster = next_cluster
    return b"".join(chunks)


def files(image: bytes) -> dict[str, bytes | None]:
    return {role: root_file(image, name) for role, name in {
        "output": b"LEOUT   TXT", "ok": b"LEOK    TXT",
        "fail": b"LEFAIL  TXT", "returned": b"RETURN  TXT",
    }.items()}


def keys(text: str) -> list[list[str]]:
    result = []
    for char in text:
        if "a" <= char <= "z" or "0" <= char <= "9":
            result.append([char])
        elif char == ":":
            result.append(["shift", "semicolon"])
        elif char == "\\":
            result.append(["backslash"])
        elif char == ".":
            result.append(["dot"])
        elif char == "\r":
            result.append(["ret"])
        else:
            raise ValueError("unadmitted oracle key")
    return result


def decode_vga_text(raw: bytes) -> list[str]:
    if len(raw) != 80 * 25 * 2:
        raise ValueError("VGA text extent")
    rows = []
    for y in range(25):
        chars = raw[y * 160:(y + 1) * 160:2]
        rows.append("".join(chr(c) if 32 <= c <= 126 else " " for c in chars).rstrip())
    return rows


def has_prompt(rows: list[str]) -> bool:
    last = next((row.strip() for row in reversed(rows) if row.strip()), "")
    return bool(PROMPT.fullmatch(last))


class QMP:
    def __init__(self, path: Path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect(str(path))
        self.file = self.sock.makefile("rwb", buffering=0)
        greeting = self.read()
        if "QMP" not in greeting:
            raise ValueError("missing QMP greeting")
        self.serial = 0
        self.call("qmp_capabilities")

    def read(self) -> dict:
        line = self.file.readline(1 << 20)
        if not line or len(line) >= (1 << 20):
            raise ValueError("QMP reply extent")
        return json.loads(line)

    def call(self, command: str, arguments: dict | None = None) -> dict:
        self.serial += 1
        request = {"execute": command, "id": self.serial}
        if arguments is not None:
            request["arguments"] = arguments
        self.file.write((json.dumps(request, separators=(",", ":")) + "\n").encode())
        for _ in range(32):
            response = self.read()
            if response.get("id") != self.serial:
                if "event" in response:
                    continue
                raise ValueError("QMP response id")
            if "error" in response:
                raise ValueError("QMP command error: " + str(response["error"])[:240])
            if "return" not in response:
                raise ValueError("QMP missing return")
            return response["return"]
        raise ValueError("QMP event cap")

    def send(self, text: str) -> None:
        for codes in keys(text):
            self.call("send-key", {"keys": [{"type": "qcode", "data": code} for code in codes],
                                   "hold-time": 60})
            time.sleep(0.07)

    def screen(self, scratch: Path) -> tuple[list[str], bytes]:
        path = scratch / "vga-text.bin"
        if path.exists() or path.is_symlink():
            raise ValueError("VGA snapshot path already exists")
        self.call("pmemsave", {"val": 0xb8000, "size": 4000, "filename": str(path)})
        try:
            raw = ordinary(path, 4000)
            return decode_vga_text(raw), raw
        finally:
            path.unlink(missing_ok=True)

    def close(self) -> None:
        self.file.close()
        self.sock.close()


def rss(pid: int) -> int:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except FileNotFoundError:
        return 0
    return 0


def child_limit() -> None:
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_AS, (64 << 30, 64 << 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 << 20, 32 << 20))


def run(inp: dict, output: Path) -> dict:
    disk = Path(inp["disk"])
    initial = ordinary(disk, GEOMETRY_BYTES, inp["diskSha256"])
    ordinary(Path(inp["floppy"]), 1228800, FLOPPY_SHA)
    qemu = Path(inp["qemu"])
    if not qemu.is_file() or qemu.is_symlink():
        raise ValueError("QEMU executable shape")
    scratch = Path(inp["scratch"])
    if not scratch.is_dir() or scratch.is_symlink():
        raise ValueError("oracle scratch directory")
    oracle_disk = scratch / "oracle-disk.img"
    if oracle_disk.exists():
        raise ValueError("oracle disk already exists")
    oracle_disk.write_bytes(initial)
    qmp_path = scratch / "oracle-qmp.sock"
    command = [str(qemu), "-accel", "tcg", "-machine", "pc", "-cpu", "486", "-m", "4",
               "-display", "none", "-no-reboot", "-boot", "order=a",
               "-drive", f"file={inp['floppy']},if=floppy,index=0,format=raw,readonly=on",
               "-drive", f"file={oracle_disk},if=ide,index=0,format=raw,cache=directsync",
               "-qmp", f"unix:{qmp_path},server=on,wait=off"]
    out = output.parent / "qemu.stdout"
    err = output.parent / "qemu.stderr"
    start = time.monotonic()
    events: list[dict] = []
    report: dict = {"schema": "bw.dos32a-owned-le.qemu-oracle.v1", "passed": False,
                    "profile": "QEMU TCG pc/486, 4 MiB, independent SeaBIOS/VGA; same FreeDOS floppy and FAT16 guest files",
                    "qemuVersion": subprocess.check_output([str(qemu), "--version"], text=True, timeout=5).splitlines()[0][:160],
                    "initialDiskSha256": sha(initial), "floppySha256": FLOPPY_SHA,
                    "inputCommands": [FIRST.strip(), SECOND.strip()], "events": events,
                    "vgaEvidence": {}}
    proc = None
    monitor = None
    reaped = False
    last_raw = None
    with out.open("wb") as stdout, err.open("wb") as stderr:
        try:
            proc = subprocess.Popen(command, stdout=stdout, stderr=stderr,
                                    start_new_session=True, preexec_fn=child_limit)
            deadline = start + WALL_LIMIT
            while not qmp_path.exists() and time.monotonic() < start + 10:
                if proc.poll() is not None:
                    raise ValueError("QEMU exited before QMP")
                time.sleep(0.1)
            if not qmp_path.exists():
                raise TimeoutError("QMP startup")
            monitor = QMP(qmp_path)
            def ensure() -> None:
                if time.monotonic() > deadline:
                    raise TimeoutError("QEMU wall bound")
                if rss(proc.pid) > RSS_LIMIT:
                    raise MemoryError("QEMU RSS bound")
                if proc.poll() is not None:
                    raise ValueError("QEMU exited before guest completion")
                if out.stat().st_size > (1 << 20) or err.stat().st_size > (1 << 20):
                    raise ValueError("QEMU output cap")
            partial_fat_reads = 0
            screen_probes = 0
            def screen() -> tuple[list[str], bytes]:
                nonlocal screen_probes, last_raw
                ensure()
                screen_probes += 1
                if screen_probes > 480:
                    raise ValueError("QEMU VGA probe cap")
                rows, raw = monitor.screen(scratch)
                last_raw = raw
                return rows, raw
            def save_vga(role: str, raw: bytes) -> None:
                name = f"oracle-vga-{role}.bin"
                with (output.parent / name).open("xb") as file:
                    file.write(raw)
                report["vgaEvidence"][role] = {"file": name, "bytes": len(raw), "sha256": sha(raw)}
            def observe_files() -> dict[str, bytes | None] | None:
                nonlocal partial_fat_reads
                try:
                    return files(ordinary(oracle_disk, GEOMETRY_BYTES))
                except ValueError:
                    partial_fat_reads += 1
                    if partial_fat_reads > 20:
                        raise ValueError("oracle FAT remained malformed")
                    return None
            def record_input(label: str, text: str) -> None:
                monitor.send(text)
                events.append({"atSeconds": round(time.monotonic()-start,2),
                               "input": label, "qcodes": keys(text)})
            declined = False
            menu_kicks = 0
            last_kick = -20.0
            while True:
                rows, raw = screen()
                now = time.monotonic() - start
                if has_prompt(rows):
                    report["bootPrompt"] = rows
                    save_vga("boot", raw)
                    break
                if any("Do you want to proceed" in row for row in rows) and not declined:
                    record_input("decline-installer", "n\r")
                    declined = True
                elif (any("press [ENTER]" in row or "Select from Menu" in row for row in rows)
                      and now - last_kick > 10 and menu_kicks < 4):
                    record_input("boot-enter", "\r")
                    last_kick = now
                    menu_kicks += 1
                if now > 120:
                    raise TimeoutError("oracle FreeDOS prompt")
                time.sleep(0.5)
            report["declinedInstaller"] = declined
            record_input(FIRST.strip(), FIRST)
            while True:
                rows, raw = screen()
                observed = observe_files()
                if observed is None:
                    time.sleep(0.5)
                    continue
                if observed["fail"] is not None:
                    raise ValueError("oracle guest wrote LEFAIL.TXT")
                if observed["ok"] is not None and has_prompt(rows):
                    report["postClientPrompt"] = rows
                    save_vga("post-client", raw)
                    break
                if time.monotonic() > start + 150:
                    raise TimeoutError("oracle application result and shell prompt")
                time.sleep(0.5)
            record_input(SECOND.strip(), SECOND)
            while True:
                rows, raw = screen()
                observed = observe_files()
                if observed is None:
                    time.sleep(0.5)
                    continue
                if observed["returned"] is not None and has_prompt(rows):
                    report["finalPrompt"] = rows
                    save_vga("final", raw)
                    break
                if time.monotonic() > start + 190:
                    raise TimeoutError("oracle shell return and prompt")
                time.sleep(0.5)
            report["partialFatReads"] = partial_fat_reads
            report["vgaProbes"] = screen_probes
            try:
                monitor.call("quit")
            except (EOFError, BrokenPipeError, ValueError, OSError):
                # QMP permits EOF before the quit reply; wait4 still proves
                # that the owned emulator exited successfully.
                pass
            while True:
                pid, status, usage = os.wait4(proc.pid, os.WNOHANG)
                if pid:
                    break
                if time.monotonic() > deadline:
                    raise TimeoutError("QEMU did not exit after quit")
                time.sleep(0.1)
            reaped = True
            report["qemuExitStatus"] = os.waitstatus_to_exitcode(status)
            report["maxRssBytes"] = usage.ru_maxrss * 1024
            if report["qemuExitStatus"] != 0 or report["maxRssBytes"] > RSS_LIMIT:
                raise ValueError("QEMU child exit/RSS")
            try:
                os.killpg(proc.pid, 0)
            except ProcessLookupError:
                report["processGroupEmpty"] = True
            else:
                os.killpg(proc.pid, signal.SIGKILL)
                raise ValueError("QEMU descendant remained after exit")
            final = ordinary(oracle_disk, GEOMETRY_BYTES)
            observed = files(final)
            report["finalDiskSha256"] = sha(final)
            report["guestFiles"] = {role: None if data is None else
                                    {"bytes": len(data), "sha256": sha(data), "text": data.decode("latin1")}
                                    for role, data in observed.items()}
            report["checks"] = {
                "output": observed["output"] is not None and SUCCESS in observed["output"] and FAILURE not in observed["output"],
                "exit": observed["ok"] is not None and EXIT_OK in observed["ok"] and observed["fail"] is None,
                "shellReturn": observed["returned"] is not None and RETURN in observed["returned"]
                               and has_prompt(report["finalPrompt"]),
            }
            report["passed"] = all(report["checks"].values())
            if not report["passed"]:
                report["firstFailure"] = "oracle guest markers differ"
        except Exception as error:
            report["firstFailure"] = f"{type(error).__name__}: {str(error)[:300]}"
            if last_raw is not None:
                try:
                    save_vga("failure", last_raw)
                except Exception as secondary:
                    report["vgaFailureRetentionError"] = f"{type(secondary).__name__}: {str(secondary)[:160]}"
        finally:
            # A second timeout signal must not replace the first guest error
            # while the owned QEMU group is being killed and reaped.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            if monitor is not None:
                try:
                    monitor.close()
                except Exception as secondary:
                    report["cleanupMonitorError"] = f"{type(secondary).__name__}: {str(secondary)[:160]}"
            if proc is not None and not reaped:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except Exception as secondary:
                    report["cleanupKillError"] = f"{type(secondary).__name__}: {str(secondary)[:160]}"
                    try:
                        proc.kill()
                    except Exception as fallback:
                        report["cleanupFallbackError"] = f"{type(fallback).__name__}: {str(fallback)[:160]}"
                cleanup_deadline = time.monotonic() + 5
                while time.monotonic() < cleanup_deadline:
                    try:
                        pid, status, usage = os.wait4(proc.pid, os.WNOHANG)
                    except ChildProcessError:
                        reaped = True
                        break
                    except Exception as secondary:
                        report["cleanupWaitError"] = f"{type(secondary).__name__}: {str(secondary)[:160]}"
                        break
                    if pid:
                        reaped = True
                        report["cleanupExitStatus"] = os.waitstatus_to_exitcode(status)
                        report["maxRssBytes"] = usage.ru_maxrss * 1024
                        break
                    time.sleep(0.05)
                if not reaped:
                    report["cleanupIncomplete"] = True
            report["elapsedWallSeconds"] = round(time.monotonic()-start,3)
            try:
                if oracle_disk.is_file():
                    report["finalDiskSha256"] = sha(oracle_disk.read_bytes())
            except Exception as secondary:
                report["cleanupDiskError"] = f"{type(secondary).__name__}: {str(secondary)[:160]}"
    return report


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: oracle.py input.json output.json")
    output = Path(sys.argv[2])
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        result = run(json.loads(Path(sys.argv[1]).read_text()), output)
    except Exception as error:
        result = {"schema": "bw.dos32a-owned-le.qemu-oracle.v1", "passed": False,
                  "firstFailure": f"preflight {type(error).__name__}: {str(error)[:300]}"}
    output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
