#!/usr/bin/env python3
"""Observe exact hosted QEMU/SeaBIOS bytes before the one QEMU guest run."""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def observed(path, maximum):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("QEMU component shape")
    raw = path.read_bytes()
    return {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}


def bounded_command(argv):
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=5, check=True)
    if len(result.stdout) > 2048 or len(result.stderr) > 2048:
        raise ValueError("QEMU metadata output bound")
    return result.stdout.decode("utf-8", "replace").strip()


def identity():
    qemu_name = shutil.which("qemu-system-i386")
    if qemu_name is None:
        raise ValueError("QEMU executable absent")
    qemu = Path(qemu_name).resolve(strict=True)
    bios = Path("/usr/share/seabios/bios-256k.bin")
    vga = Path("/usr/share/seabios/vgabios-stdvga.bin")
    result = {"schema": "bw.cwsdpmi-owned.qemu-runtime.v1",
              "qemu": observed(qemu, 64 << 20),
              "bios": observed(bios, 1 << 20), "vga": observed(vga, 1 << 20),
              "qemuVersion": bounded_command([str(qemu), "--version"]).splitlines()[0],
              "qemuPackage": bounded_command(["dpkg-query", "-W", "-f=${Package} ${Version}", "qemu-system-x86"]),
              "seabiosPackage": bounded_command(["dpkg-query", "-W", "-f=${Package} ${Version}", "seabios"])}
    return result


if __name__ == "__main__":
    if len(sys.argv) != 7:
        raise SystemExit("usage: runtime.py floppy disk media scratch runtime.json oracle-input.json")
    observed_identity = identity()
    Path(sys.argv[5]).write_text(json.dumps(observed_identity, indent=2, sort_keys=True) + "\n")
    invocation = {"floppy": sys.argv[1], "disk": sys.argv[2], "media": sys.argv[3],
                  "scratch": sys.argv[4], "qemu": observed_identity["qemu"]["path"],
                  "bios": observed_identity["bios"]["path"],
                  "vga": observed_identity["vga"]["path"],
                  "qemuSha256": observed_identity["qemu"]["sha256"],
                  "biosSha256": observed_identity["bios"]["sha256"],
                  "vgaSha256": observed_identity["vga"]["sha256"],
                  "qemuVersion": observed_identity["qemuVersion"],
                  "qemuPackage": observed_identity["qemuPackage"],
                  "seabiosPackage": observed_identity["seabiosPackage"]}
    Path(sys.argv[6]).write_text(json.dumps(invocation, indent=2, sort_keys=True) + "\n")
