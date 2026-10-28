"""Hosted read16 paired-v2 capture. Refuses unless a committed request.json
admits the exact mode, arms and harness. No local benchmark route: it must run
inside the workflow's systemd service with one CPU, 1 GiB, no swap, 64 tasks.

Modes:
  capfit  one 10M child per arm (A then B); proves the 60 s deadline fits.
  paired  eighteen children: ABAB warm, then AB BA AB BA BA AB BA measured.
The verdict (goldens, gate) is computed only by the standalone reader.py.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import resource
import selectors
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
NAMESPACE = ROOT / 'scripts/i80386-read16-paired-v2'
REQUEST = NAMESPACE / 'request.json'
ORDERS = ('AB', 'BA', 'AB', 'BA', 'BA', 'AB', 'BA')
SCHEDULES = {
    'capfit': tuple([(0, 'capfit', None, 'A'), (1, 'capfit', None, 'B')]),
    'paired': tuple([(i, 'warmup', None, a) for i, a in enumerate('ABAB')]
                    + [(4 + p * 2 + i, 'measured', p, a) for p, order in enumerate(ORDERS) for i, a in enumerate(order)]),
}
LIMITS = {'cpu.max': '100000 100000', 'memory.max': '1073741824', 'memory.swap.max': '0', 'pids.max': '64'}
CHILD_SECONDS = 60
STREAM_CAPS = (262144, 8192)
CAP = 8388608


class Refusal(ValueError):
    pass


def need(value, reason):
    if not value:
        raise Refusal(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def b64(raw):
    return base64.b64encode(raw).decode()


def text(path):
    return Path(path).read_text().strip()


def store(path, value):
    raw = (json.dumps(value, sort_keys=True, indent=1) + '\n').encode()
    need(len(raw) <= CAP, 'original cap')
    with open(path, 'xb') as f:
        f.write(raw)


def git(root, *args):
    return subprocess.run(('git', '-C', str(root)) + args, check=True, capture_output=True, text=True).stdout.strip()


def admit(mode):
    need(REQUEST.is_file() and not REQUEST.is_symlink(), 'no committed request: execution disabled')
    raw = REQUEST.read_bytes()
    req = json.loads(raw)
    need(req.get('schema') == 'bw.read16-paired-v2-request.v1', 'request schema')
    need(mode in req.get('modes', []), 'mode not admitted')
    rows_raw = (NAMESPACE / 'source-rows.json').read_bytes()
    need(sha(rows_raw) == req['sourceRowsSha256'], 'source rows pin')
    rows = json.loads(rows_raw)
    arms = {}
    for arm, directory in (('A', 'source-a'), ('B', 'source-b')):
        root = ROOT / directory
        head, tree = git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'HEAD^{tree}')
        need(head == rows['arms'][arm]['head'] == req['arms'][arm]['head'], 'arm head ' + arm)
        need(tree == rows['arms'][arm]['tree'] == req['arms'][arm]['tree'], 'arm tree ' + arm)
        need(git(root, 'status', '--porcelain', '--untracked-files=all') == '', 'arm clean ' + arm)
        arms[arm] = {'head': head, 'tree': tree}
    return raw, req, arms


def cgroup_position(affinity=None):
    membership = text('/proc/self/cgroup')
    need(membership.startswith('0::/'), 'cgroup v2')
    directory = Path('/sys/fs/cgroup') / membership[4:]
    limits = {k: text(directory / k) for k in LIMITS}
    need(limits == LIMITS, 'enforced resources')
    cpus = sorted(os.sched_getaffinity(0))
    need(len(cpus) == 1 and text(directory / 'cpuset.cpus.effective') == str(cpus[0]), 'one CPU')
    need(affinity is None or cpus == affinity, 'stable CPU')
    memory = {}
    for line in text(directory / 'memory.events').splitlines():
        k, v = line.split()
        memory[k] = int(v)
    need(all(memory.get(k, 0) == 0 for k in ('max', 'oom', 'oom_kill')), 'no memory events')
    return {'cgroup': membership[4:], 'limits': limits, 'affinity': cpus,
            'pidsCurrent': int(text(directory / 'pids.current')), 'memoryEvents': memory}


def host_witness(cpu, node):
    """Bounded, source-bound host facts. No hostname, serial, boot or machine ID."""
    facts = {'selectedCpu': cpu, 'cpuinfo': None, 'uname': {'system': platform.system(), 'release': platform.release(), 'machine': platform.machine()},
             'image': {k: os.environ.get(k) for k in ('ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH')},
             'node': None, 'python': platform.python_version()}
    block = None
    for chunk in Path('/proc/cpuinfo').read_text().split('\n\n'):
        fields = dict((a.strip(), b.strip()) for a, b in (l.split(':', 1) for l in chunk.splitlines() if ':' in l))
        if fields.get('processor') == str(cpu):
            block = fields
    need(block is not None, 'selected CPU cpuinfo')
    facts['cpuinfo'] = {k: block.get(k) for k in ('vendor_id', 'cpu family', 'model', 'model name', 'stepping', 'microcode', 'cpu MHz')}
    raw = Path(node).read_bytes()
    version = subprocess.run((node, '--version'), check=True, capture_output=True, text=True, env={'PATH': '/usr/bin:/bin'}).stdout.strip()
    facts['node'] = {'path': node, 'version': version, 'bytes': len(raw), 'sha256': sha(raw)}
    return facts


def prepare_child():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))


def capture(command, environment):
    """Own process group only; wait4 usage; first failure and bounded streams kept."""
    process = None
    parts = [bytearray(), bytearray()]
    reaped, usage, code, primary, timed_out, start, end = False, None, None, None, False, None, None
    secondary = []
    selector = selectors.DefaultSelector()
    try:
        start = time.monotonic()
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=environment, close_fds=True, start_new_session=True, preexec_fn=prepare_child)
        for i, pipe in enumerate((process.stdout, process.stderr)):
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, i)
        while selector.get_map() or not reaped:
            remaining = CHILD_SECONDS - (time.monotonic() - start)
            if remaining <= 0:
                timed_out = True
                raise Refusal('child deadline')
            for key, _ in selector.select(min(remaining, 0.02)):
                available = STREAM_CAPS[key.data] - len(parts[key.data])
                block = os.read(key.fileobj.fileno(), min(65536, available + 1))
                parts[key.data].extend(block[:available])
                need(len(block) <= available, 'stream overflow')
                if not block:
                    selector.unregister(key.fileobj)
            if not reaped:
                pid, status, current = os.wait4(process.pid, os.WNOHANG)
                if pid:
                    reaped, usage, code, end = True, current, os.waitstatus_to_exitcode(status), time.monotonic()
    except BaseException as error:
        primary = {'type': type(error).__name__, 'reason': str(error)[:1024]}
    finally:
        if process is not None and not reaped:
            try:
                os.killpg(process.pid, signal.SIGKILL)
                _, status, usage = os.wait4(process.pid, 0)
                reaped, code, end = True, os.waitstatus_to_exitcode(status), time.monotonic()
            except BaseException as error:
                secondary.append({'phase': 'kill/reap', 'type': type(error).__name__, 'reason': str(error)[:256]})
        selector.close()
        for pipe in (getattr(process, 'stdout', None), getattr(process, 'stderr', None)):
            if pipe is not None:
                pipe.close()
    metrics = {'exitCode': code, 'reaped': reaped, 'timedOut': timed_out,
               'userSeconds': None if usage is None else usage.ru_utime,
               'systemSeconds': None if usage is None else usage.ru_stime,
               'cpuSeconds': None if usage is None else usage.ru_utime + usage.ru_stime,
               'wallSeconds': None if end is None else end - start,
               'maxRSSKiB': None if usage is None else usage.ru_maxrss,
               'primary': primary, 'secondary': secondary}
    return bytes(parts[0]), bytes(parts[1]), metrics


def main():
    need(len(sys.argv) == 3 and sys.argv[1] in SCHEDULES, 'usage: run.py capfit|paired OUTPUT_DIR')
    mode, output = sys.argv[1], Path(sys.argv[2])
    need(os.environ.get('GITHUB_ACTIONS') == 'true', 'hosted only')
    output.mkdir(mode=0o700)
    packet = {'schema': 'bw.read16-paired-v2-original.v1', 'mode': mode, 'request': None, 'arms': None, 'harness': None,
              'context': {k: os.environ.get(k) for k in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_WORKFLOW_SHA', 'GITHUB_WORKFLOW_REF', 'GITHUB_SHA', 'GITHUB_REF')},
              'host': None, 'children': [], 'failure': None}
    try:
        raw, req, arms = admit(mode)
        packet['request'] = {'base64': b64(raw), 'sha256': sha(raw)}
        packet['arms'] = arms
        packet['harness'] = {'head': git(ROOT, 'rev-parse', 'HEAD'), 'tree': git(ROOT, 'rev-parse', 'HEAD^{tree}'),
                             'files': {p.name: sha(p.read_bytes()) for p in sorted(NAMESPACE.iterdir()) if p.is_file()}}
        node = req['nodePath']
        first = cgroup_position()
        affinity = first['affinity']
        packet['host'] = {'witness': host_witness(affinity[0], node), 'cgroup': first}
        env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': str(output), 'BW_READ16_V2_CHILD': '1'}
        for sequence, phase, pair, arm in SCHEDULES[mode]:
            before = cgroup_position(affinity)
            stdout, stderr, usage = capture((node, '--max-old-space-size=512', str(NAMESPACE / 'fixture.mjs'), arm), env)
            record = {'sequence': sequence, 'phase': phase, 'pair': pair, 'arm': arm, 'stdoutBase64': b64(stdout),
                      'stderrBase64': b64(stderr), 'usage': usage, 'before': before, 'after': None}
            packet['children'].append(record)
            record['after'] = cgroup_position(affinity)
            if usage['primary'] or usage['exitCode'] != 0 or stderr:
                packet['failure'] = {'phase': 'child', 'sequence': sequence, 'reason': 'child exit/timeout/stderr'}
                break
    except BaseException as error:
        packet['failure'] = packet['failure'] or {'phase': 'capture', 'type': type(error).__name__, 'reason': str(error)[:2048]}
    store(output / ('paired-v2-%s.original.json' % mode), packet)
    print(json.dumps({'mode': mode, 'children': len(packet['children']), 'failure': packet['failure']}))
    need(packet['failure'] is None, 'capture failed; original retained')


if __name__ == '__main__':
    main()
