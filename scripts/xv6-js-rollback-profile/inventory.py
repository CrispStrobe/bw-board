"""Bounded report-only failure-artifact inventory; never upload guest images."""
import hashlib
import json
import os
import stat
from pathlib import Path

MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 72 * 1024 * 1024
MAX_FILES = 48
ROOT_NAMES = {
    'parent.stdout',
    'parent.stderr', 'build.stdout', 'build.stderr', 'xv6-build.json',
    'gc-support.json', 'gc-support.json.failure.json', 'source.json',
    'gc-minor-baseline.heap.json', 'gc-minor-enabled.heap.json',
    'gc-major-baseline.heap.json', 'gc-major-enabled.heap.json',
}
RESULT_NAMES = {'binding.json', 'failure.json', 'result.json', 'file-inventory.json'}
CHILD_NAMES = {
    'stdout.json', 'stderr.txt', 'process.json', 'admission.json',
    'heap-profile.json', 'profile-summary.json',
    'heap-profile.json.failure.json',
}
CHILD_DIRS = {'reference', 'sample-1', 'sample-2'}


def allowed(name):
    parts = name.split('/')
    return (len(parts) == 1 and parts[0] in ROOT_NAMES) or (
        len(parts) == 2 and parts[0] == 'results' and parts[1] in RESULT_NAMES) or (
        len(parts) == 3 and parts[0] == 'results' and
        parts[1] in CHILD_DIRS and parts[2] in CHILD_NAMES)


def inventory(root):
    root = Path(root)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or root.is_symlink():
        raise ValueError('ordinary evidence directory required')
    files = {}
    total = 0
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode):
            if (name != 'results' and name not in {
                    'results/' + child for child in CHILD_DIRS}) or path.is_symlink():
                raise ValueError('unexpected evidence directory')
            continue
        if not allowed(name) or not stat.S_ISREG(info.st_mode):
            raise ValueError('forbidden evidence role: ' + name)
        if info.st_size < 0 or info.st_size > MAX_FILE:
            raise ValueError('unbounded evidence file: ' + name)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            check = os.fstat(fd)
            if not stat.S_ISREG(check.st_mode) or check.st_size != info.st_size:
                raise ValueError('evidence role changed: ' + name)
            data = bytearray()
            while len(data) <= MAX_FILE:
                chunk = os.read(fd, min(65536, MAX_FILE + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            if len(data) != check.st_size:
                raise ValueError('evidence role changed while reading: ' + name)
        finally:
            os.close(fd)
        files[name] = {'bytes': len(data),
                       'sha256': hashlib.sha256(data).hexdigest()}
        total += len(data)
        if len(files) > MAX_FILES or total > MAX_TOTAL:
            raise ValueError('bounded artifact inventory')
    if not files:
        raise ValueError('no safe evidence files')
    return {'schema': 'bw.xv6-js-rollback-inventory.v1',
            'files': files, 'totalBytes': total}


def main():
    import sys
    if len(sys.argv) != 2:
        raise SystemExit('one evidence directory required')
    root = Path(sys.argv[1])
    result = inventory(root)
    out = root / 'file-inventory.json'
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(result, stream, sort_keys=True)
        stream.write('\n')


if __name__ == '__main__':
    main()
