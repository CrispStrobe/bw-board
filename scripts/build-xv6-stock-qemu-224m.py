#!/usr/bin/env python3
"""Build clean pinned MIT xv6 media with its stock 224 MiB PHYSTOP for QEMU.

Builds media only; never starts a guest. The output directory must not exist.
"""
import argparse
import hashlib
import io
import json
import os
import subprocess
import tarfile
from pathlib import Path

SOURCE = Path(os.environ.get('XV6_SOURCE_DIR', '/tmp/xv6-public')).expanduser().resolve()
OUTPUT = Path(os.environ.get('XV6_224M_IMAGE_DIR', '/tmp/xv6-stock-224m-qemu')).expanduser().resolve()
REVISION = 'eeb7b415dbcb12cc362d0783e41c3d1f44066b17'
FLAGS = ('-fno-pic -static -fno-builtin -fno-strict-aliasing -O2 -Wall -MD '
         '-ggdb -m32 -march=i386 -fno-omit-frame-pointer -fno-stack-protector '
         '-fno-pie -no-pie -Wno-error=array-bounds')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'],
                                       cwd=SOURCE, text=True).strip()
    require(revision == REVISION, 'xv6 source checkout revision changed')
    require(not OUTPUT.exists(), 'refusing to reuse built xv6 output directory')
    archive = subprocess.check_output(['git', 'archive', '--format=tar', REVISION],
                                      cwd=SOURCE)
    OUTPUT.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            require(not Path(member.name).is_absolute() and '..' not in Path(member.name).parts,
                    'invalid source archive path')
        tar.extractall(OUTPUT, filter='data')
    memlayout = (OUTPUT / 'memlayout.h').read_text()
    require('#define PHYSTOP 0xE000000' in memlayout,
            'stock xv6 PHYSTOP is not 224 MiB')
    args = ['make', 'TOOLPREFIX=', 'QEMU=true', f'CFLAGS={FLAGS}', '-j1',
            'xv6.img', 'fs.img', 'kernel']
    subprocess.run(args, cwd=OUTPUT, check=True)
    source_file = subprocess.check_output(['git', 'show', f'{REVISION}:usertests.c'], cwd=SOURCE)
    manifest = {'schema': 'bw.xv6-stock-qemu-224m-build.v1',
                'xv6SourceRevision': REVISION,
                'xv6UsertestsSourceSha256': hashlib.sha256(source_file).hexdigest(),
                'phystop': '0xE000000', 'compilerFlags': FLAGS,
                'makeArgv': args,
                'gccVersion': subprocess.check_output(['gcc', '--version'],
                    text=True).splitlines()[0],
                'mediaSha256': {name: sha(OUTPUT / filename) for name, filename in
                    [('bootImage', 'xv6.img'), ('filesystemImage', 'fs.img'),
                     ('kernel', 'kernel')]}}
    (OUTPUT / 'build-manifest-private.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    argparse.ArgumentParser(description=__doc__).parse_args()
    main()
