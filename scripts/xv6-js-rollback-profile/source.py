"""Exact Git/source admission for the hosted rollback-allocation diagnostic."""
import hashlib
import json
import os
import posixpath
import re
import stat
import subprocess
from pathlib import Path

BASE = 'd268109214f0d23ff9197b0ce737c5dc233b7759'
QUALIFIED = '22ca742ed60e1350ed96110986a09b2ce84620ac'
PREFIX = 'scripts/xv6-js-rollback-profile/'
WORKFLOW = '.github/workflows/xv6-js-rollback-profile.yml'
NEW = {
    PREFIX + name for name in (
        'README.md', 'derive.mjs', 'derive-control.mjs', 'profile.py',
        'profile-control.py', 'support.mjs', 'support-control.mjs',
        'source.py', 'source-control.py', 'run.py', 'run-control.py',
        'inventory.py', 'inventory-control.py')
} | {WORKFLOW}
HELPERS = {
    'scripts/xv6-js-acceptance/run.py':
        '9286b1d3702995d02c6d5ef702f0b7c200418d1ef86d43c4d214e2af58fb2a0a',
    'scripts/xv6-js-acceptance/policy.py':
        'd0cdb22838ac7ef740def52e603046f81da112b2bf1c1b97256e41e014a4ae00',
    'scripts/build-xv6-stock-4m.mjs':
        '258149dbc13b28944669bb363894345b05e2fac6327d0c45abf5fe15758f0f3c',
    'scripts/probe-xv6-stock.mjs':
        '0f283611891e0afbee5359e51b246a2572637257c297815f7ae2c6917ddfc93a',
}


def need(ok, reason):
    if not ok:
        raise ValueError(reason)


def admit_delta(changes):
    need(type(changes) is list and len(changes) == len(NEW) and
         all(type(item) is tuple and len(item) == 2 and
             type(item[0]) is str and type(item[1]) is str for item in changes) and
         {role for kind, role in changes if kind == 'A'} == NEW,
         'exact added source/workflow path set')


IMPORT = re.compile(
    r"(?m)^import\s+(?:[^;\n]*?\s+from\s+)?['\"]([^'\"]+)['\"]\s*;?")


def relative_js_edges(role, text):
    edges = []
    for specifier in IMPORT.findall(text):
        if specifier.startswith('node:'):
            continue
        need(specifier.startswith('./'), 'unadmitted external JS import')
        target = posixpath.normpath(posixpath.join(posixpath.dirname(role), specifier))
        need(target in NEW, 'unadmitted relative JS import: ' + target)
        edges.append([role, target])
    return edges


def git(root, *args):
    env = dict(os.environ, GIT_NO_REPLACE_OBJECTS='1')
    return subprocess.check_output(['git', '-C', str(root), *args], env=env)


def blob(root, head, role):
    need(role and not role.startswith('/') and '..' not in role.split('/'),
         'canonical Git role')
    return git(root, 'show', head + ':' + role)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def ordinary(root, role, expected):
    path = root / role
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 4 * 1024 * 1024,
         'ordinary bounded source role: ' + role)
    need(path.resolve(strict=True).is_relative_to(root), 'source role escapes checkout')
    body = path.read_bytes()
    need(len(body) == info.st_size and body == expected, 'Git/live source mismatch: ' + role)
    return sha(body)


def identity(root, head, qualified=None):
    root = Path(root).resolve(strict=True)
    need(re.fullmatch('[0-9a-f]{40}', head) is not None, 'exact source head')
    need(git(root, 'rev-parse', 'HEAD').decode().strip() == head, 'wrong source HEAD')
    need(not git(root, 'status', '--porcelain', '--untracked-files=all'),
         'source checkout dirty')
    changes = [line.split('\t', 1) for line in
               git(root, 'diff', '--name-status', BASE, head).decode().splitlines()]
    admit_delta([tuple(item) for item in changes])
    result = {}
    for role in sorted(NEW):
        result[role] = ordinary(root, role, blob(root, head, role))
    edges = []
    for role in sorted(path for path in NEW if path.endswith(('.mjs', '.js'))):
        text = blob(root, head, role).decode('utf8')
        edges.extend(relative_js_edges(role, text))
    for role, expected in HELPERS.items():
        need(sha(blob(root, QUALIFIED, role)) == expected,
             'qualified helper pin: ' + role)
        if qualified is not None:
            qroot = Path(qualified).resolve(strict=True)
            need(git(qroot, 'rev-parse', 'HEAD').decode().strip() == QUALIFIED,
                 'wrong qualified checkout')
            result['qualified:' + role] = ordinary(qroot, role, blob(qroot, QUALIFIED, role))
    return {'schema': 'bw.xv6-js-rollback-source.v1', 'head': head,
            'base': BASE, 'qualified': QUALIFIED,
            'roles': result, 'roleCount': len(result), 'jsImportEdges': edges}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--qualified')
    args = parser.parse_args()
    print(json.dumps(identity(args.source, args.head, args.qualified), sort_keys=True))
