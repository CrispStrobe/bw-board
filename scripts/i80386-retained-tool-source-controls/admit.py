"""Exact finite control-source admission only; never imports control producers."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import time

BASE = '473b90ea27529e576775ae5864a7fd2a4f3f9237'
FIXED = {'scripts/i80386-cwsdpmi-compile-root-routes/root-routes.py': '59f1a023b08b2e199dd8d464d47224f6beaeef972e281c0fb73ec68c31f78848', 'scripts/i80386-cwsdpmi-compile-root-routes/root-routes-control.py': '556a4cbfc79ec12ab2095383b0f7ed3a310389a57ac814bf5f346ffcc8cc4406', 'scripts/i80386-cwsdpmi-compile-root-routes/README.md': '89d50151ec9b696949507814d2c2b41f6fc64f21cf452d4603cb0a4be0586655', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner.py': 'af4550c1097289d31e569ad599c56e734fea2b2d4e99650ae4f617b43537b2a6', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner-control.py': '5be8652118c7eccde0706db3bc2e2a3d87ea67fbb4807c8efcdb751b3fe9fa2d', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/README.md': '2cec6c0a04849d5bc058f4eec96f6a4646b12f7ceb906d96be4fb3ef3a82cc48', 'scripts/i80386-cwsdpmi-workspace-creator/workspace.py': '1c6ac3af4db5eb49a9dbb3dc44140d8ef74b88112ce30f8f5b6b78401950a2f7', 'scripts/i80386-cwsdpmi-workspace-creator/workspace-control.py': '4d5ab1be1381a647c02b1725a1ba08c591b6d7a44d803dc0fceac390106f34ad', 'scripts/i80386-cwsdpmi-workspace-creator/README.md': 'd3ced6e366c5659b5f1ab30453f6ad87a2ecac576f24c4c749b23c2bfca2b10a', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/README.md': '57726203614a16f94ab2a9d2dcae5586e197cb11db5773b0663be32b711154f5', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/owner-control.py': '0bfbefb24989588038e5c13e6e2971b238a14238de54bd379be63e00945400a9', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/owner.py': '103db42253d9ced7d9c7e617d83955879c9a7144bb124dcbb6520ac34de4579b', 'scripts/i80386-cwsdpmi-retained-tool-observer/README.md': '1adcc589304801cdf18382ac5fc9dc2dcab835a73de86e392c3c4a40f94c65fa', 'scripts/i80386-cwsdpmi-retained-tool-observer/observer-control.py': 'b5f8321520ba5d533a9581ff483caefc13915d2f1c79ca520339bda771c1b9ea', 'scripts/i80386-cwsdpmi-retained-tool-observer/observer.py': '53d295bca750edce8d2b3496498195c8f735528dd15bff6eba26127b55558312'}
PROFILE = ('scripts/i80386-retained-tool-source-controls/admit.py',
           'scripts/i80386-retained-tool-source-controls/README.md',
           '.github/workflows/i80386-retained-tool-source-controls.yml')
MAX_SOURCE = 65536

class Refusal(ValueError):
    pass

def need(ok):
    if not ok:
        raise Refusal('source-admission-refused')

def git(args):
    proc = subprocess.Popen(['git', '--no-replace-objects', *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    output = bytearray()
    selector = selectors.DefaultSelector()
    try:
        os.set_blocking(proc.stdout.fileno(), False)
        selector.register(proc.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + 10
        while selector.get_map():
            need(time.monotonic() <= deadline)
            for key, unused in selector.select(0.05):
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj)
                else:
                    need(len(output) + len(block) <= 1 << 20)
                    output.extend(block)
        need(proc.wait(timeout=1) == 0)
        return bytes(output)
    finally:
        selector.close()
        proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
        proc.wait(timeout=2)

def live(path):
    prior = os.lstat(path)
    need(stat.S_ISREG(prior.st_mode) and prior.st_nlink == 1 and prior.st_size <= MAX_SOURCE)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
        need(identity(prior) == identity(opened))
        raw = bytearray()
        while len(raw) <= MAX_SOURCE:
            block = os.read(fd, min(65536, MAX_SOURCE + 1 - len(raw)))
            if not block:
                break
            raw.extend(block)
        need(len(raw) <= MAX_SOURCE and len(raw) == opened.st_size)
        need(identity(opened) == identity(os.fstat(fd)) == identity(os.lstat(path)))
        return bytes(raw)
    finally:
        os.close(fd)

def admit():
    head = os.environ.get('EXPECTED_HEAD')
    need(type(head) is str and re.fullmatch('[0-9a-f]{40}', head) is not None)
    need(os.environ.get('GITHUB_RUN_ATTEMPT') == '1')
    need(os.environ.get('GITHUB_REPOSITORY') == 'CrispStrobe/bw-board')
    need(os.environ.get('PR_HEAD_REPOSITORY') == 'CrispStrobe/bw-board')
    need(os.environ.get('GITHUB_EVENT_NAME') == 'pull_request')
    need(git(['rev-parse', 'HEAD']).decode('ascii').strip() == head)
    git(['merge-base', '--is-ancestor', BASE, head])
    changed = git(['diff', '--name-only', '-z', BASE, head]).decode('utf-8').split('\0')
    need(changed[-1] == '')
    changed = changed[:-1]
    need(len(changed) == len(set(changed)) and set(changed) <= set(PROFILE) | {'LANES.md'})
    roles = {}
    for path in (*FIXED, *PROFILE):
        committed = git(['show', head + ':' + path])
        need(len(committed) <= MAX_SOURCE)
        digest = hashlib.sha256(committed).hexdigest()
        need(path not in FIXED or digest == FIXED[path])
        need(live(path) == committed)
        roles[path] = digest
    report = {'schema': 'bw.retained-tool-source-controls.v1', 'head': head, 'base': BASE,
              'fixedRoles': len(FIXED), 'roles': roles,
              'qualification': 'SOURCE_CONTROLS_ONLY_NO_COMPILER_CPU_GUEST_OR_PERFORMANCE'}
    raw = (json.dumps(report, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')
    need(len(raw) <= 32768)
    # Output directory is created exclusively by the workflow; no caller output path.
    fd = os.open('retained-tool-controls/source.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        count = 0
        while count < len(raw):
            n = os.write(fd, raw[count:])
            need(0 < n <= len(raw) - count)
            count += n
    finally:
        os.close(fd)

if __name__ == '__main__':
    try:
        admit()
    except BaseException:
        print('source-admission-refused')
        raise SystemExit(1) from None
