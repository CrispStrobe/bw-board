#!/usr/bin/env python3
"""Prepare or run an independent, bounded QEMU stock xv6 serial oracle.

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
IMAGES = Path(os.environ.get('XV6_IMAGE_DIR', '/tmp/xv6-stock-4m')).expanduser().resolve()
OUTPUT = Path(os.environ.get('XV6_ORACLE_OUTPUT_DIR', '/tmp/xv6-qemu-oracle-client-20260928')).expanduser().resolve()
QEMU = Path(os.environ.get('XV6_QEMU_BIN', '/usr/bin/qemu-system-i386')).expanduser().resolve()
SOURCE_REVISION = 'eeb7b415dbcb12cc362d0783e41c3d1f44066b17'
TIMEOUT_SECONDS = 900
BOOT_TIMEOUT_SECONDS = 30
TARGET = b'concreate ok\n'
MARKERS = (b'createdelete ok\n', b'linkunlink ok\n', TARGET)
PINS = {
    'bios': (BOARD / 'roms/free-at-bios/BIOS-bochs-legacy',
             '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),
    'vgaRom': (BOARD / 'roms/free-at-bios/vgabios-lgpl.bin',
               '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'),
    'bootImage': (IMAGES / 'xv6.img',
                  'b98a1ff75644e630a23f359b5d07ab9d5e9dc01e9fd64cdf4c4855328fb52cf0'),
    'filesystemImage': (IMAGES / 'fs.img',
                        '24ef7cd95e2d13ad95727618088f9b4c71ae9690f8ffaf0cdd9d59dfdbc4643f'),
    'kernel': (IMAGES / 'kernel',
               '025cef15636863063e4101aa0cfc424e556f70ad43b6a80d57581c05b465202d'),
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
    for name, (path, expected) in PINS.items():
        require(path.is_file() and sha(path) == expected, f'{name} media pin changed')
    require(QEMU.is_file(), 'QEMU binary missing')
    version = subprocess.check_output([str(QEMU), '--version'], text=True).splitlines()[0]
    require('QEMU emulator version 8.2.' in version, 'expected QEMU 8.2 series')
    return {'schema': 'bw.xv6-stock-qemu-oracle-preflight.v1',
            'boardRevision': git(BOARD, 'rev-parse', 'HEAD'),
            'xv6SourceRevision': SOURCE_REVISION,
            'xv6UsertestsSourceSha256': hashlib.sha256(committed).hexdigest(),
            'mediaSha256': {name: expected for name, (_, expected) in PINS.items()},
            'qemuVersion': version, 'qemuBinarySha256': sha(QEMU),
            'runnerSha256': sha(Path(__file__)),
            'machine': 'pc-i440fx-8.2', 'cpu': 'qemu32', 'accel': 'tcg,thread=single',
            'memoryMiB': 4, 'smp': 1, 'timeoutSeconds': TIMEOUT_SECONDS,
            'bootTimeoutSeconds': BOOT_TIMEOUT_SECONDS,
            'command': 'usertests\r', 'targetMarker': TARGET.decode()}


def command():
    return [str(QEMU), '-machine', 'pc-i440fx-8.2', '-cpu', 'qemu32',
            '-accel', 'tcg,thread=single', '-m', '4M', '-smp', '1',
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
    receipt = {'schema': 'bw.xv6-stock-qemu-oracle-private.v1', 'pins': pins,
               'serialSha256': sha(OUTPUT / 'serial-private.bin'),
               'writableBootSha256After': sha(OUTPUT / 'xv6-writable.img'),
               'writableFilesystemSha256After': sha(OUTPUT / 'fs-writable.img'),
               'commandSent': sent, 'markerPositions': positions,
               'markersInSourceOrder': ordered, 'stop': stop,
               'qemuExitCode': exit_code, 'elapsedWallSeconds': round(time.monotonic() - started, 3),
               'fullUsertestsPassed': b'ALL TESTS PASSED' in serial}
    (OUTPUT / 'receipt-private.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    require(stop == 'target-marker' and ordered, 'QEMU oracle did not reach ordered target')


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
