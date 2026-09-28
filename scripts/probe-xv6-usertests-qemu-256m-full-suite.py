#!/usr/bin/env python3
"""Prepare or run an independent, bounded QEMU stock xv6 full-suite oracle.

--preflight reads pins only; --prepare makes isolated disk copies; --run uses
those copies once. The QEMU guest starts only with --run.
"""
import argparse
import hashlib
import json
import os
import select
import shutil
import socket
import subprocess
import time
from pathlib import Path

BOARD = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get('XV6_SOURCE_DIR', '/tmp/xv6-public')).expanduser().resolve()
IMAGES = Path(os.environ.get('XV6_IMAGE_DIR', '/tmp/xv6-stock-224m-qemu')).expanduser().resolve()
OUTPUT = Path(os.environ.get('XV6_ORACLE_OUTPUT_DIR', '/tmp/xv6-qemu-oracle-256m-full-suite-20260928')).expanduser().resolve()
QEMU = Path(os.environ.get('XV6_QEMU_BIN', '/usr/bin/qemu-system-i386')).expanduser().resolve()
SOURCE_REVISION = 'eeb7b415dbcb12cc362d0783e41c3d1f44066b17'
QEMU_SHA256 = '28fa14f1c45fca7422e3ec5737768b33b705de2f31014a76e658d4263464a6a5'
BUILD_SCHEMA = 'bw.xv6-stock-qemu-224m-build.v1'
BUILD_PHYSTOP = '0xE000000'
BUILD_FLAGS = ('-fno-pic -static -fno-builtin -fno-strict-aliasing -O2 -Wall -MD '
               '-ggdb -m32 -march=i386 -fno-omit-frame-pointer -fno-stack-protector '
               '-fno-pie -no-pie -Wno-error=array-bounds')
TIMEOUT_SECONDS = 300
BOOT_TIMEOUT_SECONDS = 30
SHELL_TIMEOUT_SECONDS = 60
TARGET = b'ALL TESTS PASSED\n$ '
FAILURE_MARKERS = (b'sbrk test failed to grow big address space; enough phys mem?',
                   b'panic:')
MARKERS = (b'createdelete ok\n', b'linkunlink ok\n', b'concreate ok\n')
PINS = {
    'bios': (Path(os.environ.get('XV6_QEMU_BIOS', '/usr/share/seabios/bios-256k.bin')).expanduser().resolve(),
             '1a9ea4f17bcfb27bda5728e2c21d9fa074cf7947b9b4910bb28213a735c96735'),
    'vgaRom': (Path(os.environ.get('XV6_QEMU_VGA_ROM', '/usr/share/seabios/vgabios-stdvga.bin')).expanduser().resolve(),
               '4eecd8e752efc02c6c0fe87eb92bf66934cb9ea67b0e1bc41e86f8430c8bf8a0'),
    'bootImage': (IMAGES / 'xv6.img',
                  'de7f0e4aab39c0fc6d21aa283943e8dfe6420ef0806df87efb21bf336e1a353a'),
    'filesystemImage': (IMAGES / 'fs.img',
                        '0b86e83c68d45d34fd0cecddd627b2d71893ab9df7d77d5372941c701d4eae22'),
    'kernel': (IMAGES / 'kernel',
               '10bf65351fe69951a42673bc314049c15a1432cd5cdab004df5e7268cff8eafb'),
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def git(directory, *args):
    return subprocess.check_output(['git', *args], cwd=directory, text=True).strip()


def preflight():
    require(not git(BOARD, 'status', '--porcelain'), 'board worktree is dirty')
    require(git(SOURCE, 'rev-parse', 'HEAD') == SOURCE_REVISION,
            'xv6 source revision differs')
    source = SOURCE / 'usertests.c'
    committed = subprocess.check_output(['git', 'show', f'{SOURCE_REVISION}:usertests.c'], cwd=SOURCE)
    require(source.read_bytes() == committed, 'usertests.c differs from pinned source')
    text = committed.decode()
    require(text.index('createdelete();') < text.index('linkunlink();') < text.index('concreate();'),
            'stock test order changed')
    for marker in MARKERS:
        require(f'printf(1, "{marker.decode().replace(chr(10), chr(92) + "n")}")' in text,
                f'stock marker {marker!r} changed')
    require(text.index('  concreate();') < text.index('  exectest();'),
            'final test order changed')
    require('char *echoargv[] = { "echo", "ALL", "TESTS", "PASSED", 0 };' in text,
            'final echo arguments changed')
    require('if(exec("echo", echoargv) < 0)' in text, 'final exec changed')
    echo_source = (SOURCE / 'echo.c').read_bytes()
    require(echo_source == subprocess.check_output(
        ['git', 'show', f'{SOURCE_REVISION}:echo.c'], cwd=SOURCE),
            'stock echo.c differs from pinned revision')
    require('i+1 < argc ? " " : "\\n"' in echo_source.decode(),
            'final echo formatting changed')
    shell_source = (SOURCE / 'sh.c').read_bytes()
    require(shell_source == subprocess.check_output(
        ['git', 'show', f'{SOURCE_REVISION}:sh.c'], cwd=SOURCE),
            'stock sh.c differs from pinned revision')
    require('printf(2, "$ ");' in shell_source.decode(),
            'shell prompt formatting changed')
    for name, (path, expected) in PINS.items():
        require(path.is_file() and sha(path) == expected, f'{name} media pin changed')
    build = json.loads((IMAGES / 'build-manifest-private.json').read_text())
    require(build['schema'] == BUILD_SCHEMA and build['xv6SourceRevision'] == SOURCE_REVISION
            and build['xv6UsertestsSourceSha256'] == hashlib.sha256(committed).hexdigest()
            and build['phystop'] == BUILD_PHYSTOP and build['compilerFlags'] == BUILD_FLAGS,
            'stock 224 MiB build provenance changed')
    require(build['mediaSha256'] == {name: PINS[name][1] for name in
            ('bootImage', 'filesystemImage', 'kernel')}, 'build media hashes changed')
    require(QEMU.is_file(), 'QEMU binary missing')
    require(sha(QEMU) == QEMU_SHA256, 'QEMU binary pin changed')
    version = subprocess.check_output([str(QEMU), '--version'], text=True).splitlines()[0]
    require('QEMU emulator version 8.2.' in version, 'expected QEMU 8.2 series')
    return {'schema': 'bw.xv6-stock-qemu-256m-full-suite-preflight.v1',
            'boardRevision': git(BOARD, 'rev-parse', 'HEAD'),
            'xv6SourceRevision': SOURCE_REVISION,
            'xv6UsertestsSourceSha256': hashlib.sha256(committed).hexdigest(),
            'mediaSha256': {name: expected for name, (_, expected) in PINS.items()},
            'qemuVersion': version, 'qemuBinarySha256': QEMU_SHA256,
            'runnerSha256': sha(Path(__file__)),
            'machine': 'pc-i440fx-8.2', 'cpu': 'qemu32', 'accel': 'tcg,thread=single',
            'memoryMiB': 256, 'xv6Phystop': BUILD_PHYSTOP,
            'buildManifestSha256': sha(IMAGES / 'build-manifest-private.json'),
            'smp': 1, 'timeoutSeconds': TIMEOUT_SECONDS,
            'bootTimeoutSeconds': BOOT_TIMEOUT_SECONDS,
            'shellTimeoutSeconds': SHELL_TIMEOUT_SECONDS,
            'firmwarePair': 'SeaBIOS 256K and standard VGA ROM',
            'command': 'usertests\r', 'targetMarker': TARGET.decode(),
            'xv6EchoSourceSha256': hashlib.sha256(echo_source).hexdigest(),
            'xv6ShellSourceSha256': hashlib.sha256(shell_source).hexdigest()}


def command():
    return [str(QEMU), '-machine', 'pc-i440fx-8.2', '-cpu', 'qemu32',
            '-accel', 'tcg,thread=single', '-m', '256M', '-smp', '1',
            '-bios', str(PINS['bios'][0]), '-vga', 'none',
            '-device', f'VGA,romfile={PINS["vgaRom"][0]}',
            '-drive', f'file={OUTPUT / "xv6-writable.img"},if=ide,index=0,media=disk,format=raw',
            '-drive', f'file={OUTPUT / "fs-writable.img"},if=ide,index=1,media=disk,format=raw',
            '-boot', 'order=c', '-display', 'none', '-monitor', 'none',
            '-chardev', f'socket,id=oracle,path={OUTPUT / "serial.sock"},server=off',
            '-serial', 'chardev:oracle', '-no-reboot']


def prepare():
    pins = preflight()
    require(not OUTPUT.exists(), 'output directory already exists')
    require(len(os.fsencode(OUTPUT / 'serial.sock')) < 100, 'serial socket path too long')
    OUTPUT.mkdir(parents=True)
    for name, target in (('bootImage', 'xv6-writable.img'),
                         ('filesystemImage', 'fs-writable.img')):
        shutil.copyfile(PINS[name][0], OUTPUT / target)
        require(sha(OUTPUT / target) == PINS[name][1], f'{name} copy mismatch')
    manifest = {'pins': pins, 'qemuArgv': command(), 'preparedUtc':
                time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    (OUTPUT / 'manifest-private.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def run():
    pins = preflight()
    require(OUTPUT.is_dir(), 'run --prepare first')
    manifest = json.loads((OUTPUT / 'manifest-private.json').read_text())
    require(manifest['pins'] == pins and manifest['qemuArgv'] == command(),
            'prepared configuration differs')
    for name, target in (('bootImage', 'xv6-writable.img'),
                         ('filesystemImage', 'fs-writable.img')):
        require(sha(OUTPUT / target) == PINS[name][1], f'{name} writable copy is not pristine')
    for filename in ('serial-private.bin', 'qemu-stderr-private.txt', 'receipt-private.json'):
        require(not (OUTPUT / filename).exists(), f'refusing to reuse {filename}')
    started = time.monotonic()
    serial = bytearray()
    sent = False
    stop = 'timeout'
    with (OUTPUT / 'serial-private.bin').open('xb') as serial_file, \
            (OUTPUT / 'qemu-stderr-private.txt').open('xb') as stderr_file:
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(str(OUTPUT / 'serial.sock'))
        listener.listen(1)
        listener.settimeout(0.2)
        proc = subprocess.Popen(command(), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=stderr_file)
        try:
            sock = None
            while time.monotonic() - started < TIMEOUT_SECONDS:
                if b'xv6...' not in serial and time.monotonic() - started >= BOOT_TIMEOUT_SECONDS:
                    stop = 'boot-timeout'
                    break
                if not sent and time.monotonic() - started >= SHELL_TIMEOUT_SECONDS:
                    stop = 'shell-timeout'
                    break
                if sock is None:
                    try:
                        sock, _ = listener.accept()
                    except socket.timeout:
                        if proc.poll() is not None:
                            stop = 'qemu-exit'
                            break
                        continue
                readable, _, _ = select.select([sock], [], [], 0.2)
                if readable:
                    chunk = sock.recv(4096)
                    if not chunk:
                        stop = 'serial-closed'
                        break
                    serial.extend(chunk)
                    serial_file.write(chunk)
                    serial_file.flush()
                    if not sent and b'\n$ ' in serial:
                        sock.sendall(b'usertests\r')
                        sent = True
                    if TARGET in serial:
                        stop = 'target-marker'
                        break
                    if any(marker in serial for marker in FAILURE_MARKERS):
                        stop = 'guest-failure'
                        break
                if proc.poll() is not None:
                    stop = 'qemu-exit'
                    break
        finally:
            if sock is not None:
                sock.close()
            listener.close()
            if proc.poll() is None:
                proc.terminate()
            try:
                exit_code = proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                exit_code = proc.wait()
    positions = {marker.decode(): serial.find(marker) for marker in MARKERS}
    ordered = all(positions[marker.decode()] >= 0 for marker in MARKERS) and \
        all(positions[MARKERS[i].decode()] < positions[MARKERS[i + 1].decode()]
            for i in range(len(MARKERS) - 1))
    final_after_prefix = TARGET in serial and ordered and \
        positions[MARKERS[-1].decode()] < serial.find(TARGET)
    receipt = {'schema': 'bw.xv6-stock-qemu-256m-full-suite-private.v1', 'pins': pins,
               'serialSha256': sha(OUTPUT / 'serial-private.bin'),
               'writableBootSha256After': sha(OUTPUT / 'xv6-writable.img'),
               'writableFilesystemSha256After': sha(OUTPUT / 'fs-writable.img'),
               'commandSent': sent, 'markerPositions': positions,
               'markersInSourceOrder': ordered,
               'finalMarkerSerialPosition': serial.find(TARGET),
               'finalMarkerAfterPrefix': final_after_prefix, 'stop': stop,
               'failureMarkersSeen': [marker.decode() for marker in FAILURE_MARKERS
                                      if marker in serial],
               'qemuExitCode': exit_code, 'elapsedWallSeconds': round(time.monotonic() - started, 3),
               'fullUsertestsPassed': stop == 'target-marker' and final_after_prefix}
    (OUTPUT / 'receipt-private.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    require(stop == 'target-marker' and final_after_prefix,
            'QEMU oracle did not reach ordered full-suite target')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--preflight', action='store_true')
    group.add_argument('--prepare', action='store_true')
    group.add_argument('--run', action='store_true')
    args = parser.parse_args()
    if args.preflight:
        print(json.dumps(preflight(), indent=2))
    elif args.prepare:
        print(json.dumps(prepare(), indent=2))
    else:
        run()
