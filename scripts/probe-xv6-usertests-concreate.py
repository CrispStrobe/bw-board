#!/usr/bin/env python3
"""Predeclare and run the stock xv6 usertests concreate continuation.

--preflight checks pinned local MIT xv6 media and clean board source without
running the guest. --run is CPU-heavy and must wait for the shared VPS slot.
"""
import argparse
import hashlib
import json
import os
import platform
import socket
import subprocess
import time
from pathlib import Path

BOARD = Path(__file__).resolve().parents[1]
XV6_SOURCE = Path(os.environ.get('XV6_SOURCE_DIR', '/tmp/xv6-public')).expanduser().resolve()
XV6_IMAGE_DIR = Path(os.environ.get('XV6_IMAGE_DIR', '/tmp/xv6-stock-4m')).expanduser().resolve()
OUTPUT = Path(os.environ.get('XV6_OUTPUT_DIR',
                             '/tmp/xv6-usertests-concreate')).expanduser().resolve()
STEPS = 600_000_000
NEXT_MARKER = 'concreate ok\n'
PREFIX_MARKER = 'linkunlink ok\n'
XV6_REVISION = 'eeb7b415dbcb12cc362d0783e41c3d1f44066b17'
PINS = {
    'rom': (BOARD / 'roms/free-at-bios/BIOS-bochs-legacy',
            '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),
    'vgaRom': (BOARD / 'roms/free-at-bios/vgabios-lgpl.bin',
               '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'),
    'bootImage': (XV6_IMAGE_DIR / 'xv6.img',
                  'b98a1ff75644e630a23f359b5d07ab9d5e9dc01e9fd64cdf4c4855328fb52cf0'),
    'filesystemImage': (XV6_IMAGE_DIR / 'fs.img',
                        '24ef7cd95e2d13ad95727618088f9b4c71ae9690f8ffaf0cdd9d59dfdbc4643f'),
    'kernel': (XV6_IMAGE_DIR / 'kernel',
               '025cef15636863063e4101aa0cfc424e556f70ad43b6a80d57581c05b465202d'),
}
SOURCE_FILES = ('scripts/probe-xv6-stock.mjs', 'src/experimental/i80386.js',
                'src/experimental/i80386-at-machine.js', 'src/i8086-machine.js')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(directory, *args):
    return subprocess.check_output(['git', *args], cwd=directory, text=True).strip()


def preflight():
    revision = git(BOARD, 'rev-parse', 'HEAD')
    require(not git(BOARD, 'status', '--porcelain'), 'board worktree is dirty')
    require(git(XV6_SOURCE, 'rev-parse', 'HEAD') == XV6_REVISION,
            'stock MIT xv6 source revision differs')
    source_bytes = (XV6_SOURCE / 'usertests.c').read_bytes()
    committed_source = subprocess.check_output(
        ['git', 'show', f'{XV6_REVISION}:usertests.c'], cwd=XV6_SOURCE)
    require(source_bytes == committed_source, 'stock usertests.c differs from pinned revision')
    source = source_bytes.decode()
    require(source.index('createdelete();') < source.index('linkunlink();') < source.index('concreate();'),
            'stock test order changed')
    require('printf(1, "concreate ok\\n")' in source, 'next marker changed')
    for name, (file, expected) in PINS.items():
        require(file.is_file(), f'{name} missing')
        require(sha(file.read_bytes()) == expected, f'{name} pin changed')
    return {'boardRevision': revision, 'xv6SourceRevision': XV6_REVISION,
            'xv6UsertestsSourceSha256': sha(source_bytes),
            'mediaSha256': {name: expected for name, (_, expected) in PINS.items()},
            'sourceSha256': {name: sha((BOARD / name).read_bytes()) for name in SOURCE_FILES},
            'probeWrapperSha256': sha(Path(__file__).read_bytes()),
            'command': 'usertests\\r', 'priorStopMarker': PREFIX_MARKER,
            'nextStopMarker': NEXT_MARKER, 'stepBudget': STEPS}


def run():
    pins = preflight()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in ('raw-private.json', 'stderr-private.txt',
                 'host-private.json', 'receipt-public-candidate.json'):
        require(not (OUTPUT / name).exists(), f'refusing to reuse {name}')
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('XV6_') and key != 'NODE_OPTIONS'}
    env.update(XV6_FIRMWARE='bochs', XV6_PROFILE='4m',
               XV6_IMG=str(PINS['bootImage'][0]), XV6_FS_IMG=str(PINS['filesystemImage'][0]),
               XV6_KERNEL=str(PINS['kernel'][0]), XV6_STEPS=str(STEPS),
               XV6_COMMAND='usertests\r', XV6_EXPECT_SERIAL=NEXT_MARKER,
               XV6_STOP_ON_EXPECT='1', XV6_LEAN='1')
    start = time.monotonic()
    started_utc = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    result = subprocess.run(['node', 'scripts/probe-xv6-stock.mjs'], cwd=BOARD,
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    raw = result.stdout
    (OUTPUT / 'raw-private.json').write_bytes(raw)
    (OUTPUT / 'stderr-private.txt').write_bytes(result.stderr)
    host = {'host': socket.gethostname(), 'platform': platform.platform(),
            'startedUtc': started_utc,
            'endedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'elapsedWallSec': round(time.monotonic() - start, 3),
            'exitCode': result.returncode, 'rawSha256': sha(raw), 'pins': pins}
    (OUTPUT / 'host-private.json').write_text(json.dumps(host, indent=2) + '\n')
    require(raw, 'probe produced no report; inspect private stderr')
    report = json.loads(raw)
    require(report['firmware'] == 'bochs' and report['profile'] == '4m',
            'guest configuration differs')
    require(report['rom']['sha256'] == PINS['rom'][1], 'reported ROM differs')
    require(report['image']['sha256'] == PINS['bootImage'][1], 'reported boot image differs')
    require(report['slaveImage']['sha256'] == PINS['filesystemImage'][1],
            'reported filesystem image differs')
    serial = report['serial']
    reached_prefix = PREFIX_MARKER in serial
    reached_next = NEXT_MARKER in serial
    require(reached_prefix, 'prior linkunlink prefix did not recur')
    if reached_next:
        require(serial.index(PREFIX_MARKER) < serial.index(NEXT_MARKER),
                'next marker preceded prior marker')
    require(report['steps'] <= STEPS, 'report exceeded pinned step budget')
    if reached_next:
        require(result.returncode == 0, 'next marker reached but probe failed')
        stop = 'concreate-marker'
    else:
        require(result.returncode != 0 and report['steps'] == STEPS,
                'unexpected probe failure before next marker')
        stop = 'budget-before-concreate-marker'
    candidate = {'schema': 'bw.xv6-stock-usertests-concreate-candidate.v1',
                 'boardRevision': pins['boardRevision'],
                 'xv6SourceRevision': XV6_REVISION,
                 'sourceSha256': pins['sourceSha256'],
                 'probeWrapperSha256': pins['probeWrapperSha256'],
                 'mediaSha256': pins['mediaSha256'],
                 'privateRawReportSha256': sha(raw), 'stepBudget': STEPS,
                 'completedSteps': report['steps'], 'priorMarkerReached': reached_prefix,
                 'nextMarkerReached': reached_next, 'stop': stop,
                 'fullUsertestsPassed': False}
    (OUTPUT / 'receipt-public-candidate.json').write_text(json.dumps(candidate, indent=2) + '\n')
    print(json.dumps(candidate, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--preflight', action='store_true')
    group.add_argument('--run', action='store_true')
    args = parser.parse_args()
    print(json.dumps(preflight(), indent=2)) if args.preflight else run()
