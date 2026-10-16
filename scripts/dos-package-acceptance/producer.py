#!/usr/bin/env python3
"""MIT. Owned hosted PTY producer. --controls uses inert mocks only."""
import errno
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import pty
import re
import resource
import selectors
import shutil
import signal
import struct
import subprocess
import sys
import termios
import time

PACKET = Path('build/dos-package-acceptance')
CASES = ('a', 'b', 'malformed', 'focus-loss')
START = b'\x1b[?1049h\x1b[?25l\x1b[?1004h'
RESET = b'\x1b[?1004l\x1b[?25h\x1b[?1049l'
FOOTER = b'Ctrl-] quits; text VGA only.'
READY = 'BW-PKG-READY'
CAPS = dict(cpuMax='100000 100000', memoryMax=1073741824, swapMax=0, pidsMax=64,
            childMs=120000, controllerMs=600000, steps=50000000, ptyBytes=33554432,
            eventCount=65536, eventBytes=16777216, reportBytes=262144, packetBytes=201326592)
ENV_POLICY = dict(NODE_OPTIONS=None, NODE_PATH=None, LD_PRELOAD=None, LD_AUDIT=None, backendFlags=[])
BIOS_SHA = '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'
VGA_SHA = '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'
SOURCE_PATHS = frozenset('''
.github/workflows/dos-package-acceptance.yml
LICENSE
package.json
roms/free-at-bios/BIOS-bochs-legacy
roms/free-at-bios/LICENSE
roms/free-at-bios/README.md
roms/free-at-bios/vgabios-lgpl.bin
scripts/dos-package-acceptance/README.md
scripts/dos-package-acceptance/probe.mjs
scripts/dos-package-acceptance/producer.py
scripts/dos-package-acceptance/reader.py
scripts/lib/dos-package-zip.mjs
scripts/lib/i80386-at-terminal.mjs
scripts/lib/i80386-source-inventory.mjs
scripts/run-dos-package.mjs
src/adc0809.js
src/at-8042-a20.js
src/at-ps2-mouse.js
src/at-system-control.js
src/audio-bus.js
src/cga-card.js
src/chip-ledger.js
src/dac0832.js
src/dos-package-policy.js
src/dosbox-config.js
src/ega-card.js
src/experimental/ata16.js
src/experimental/i80286-protected.js
src/experimental/i80386-at-machine.js
src/experimental/i80386.js
src/experimental/vga-memory.js
src/hercules-card.js
src/i8086-machine.js
src/i8086-ram-words.js
src/i8086.js
src/i8088-cycles.js
src/i8088-timing.js
src/i8237.js
src/i8251.js
src/i8254.js
src/i8255.js
src/i8259.js
src/machine-checkpoint.js
src/mc146818.js
src/mc6845.js
src/mc6850.js
src/ne2000.js
src/ns16c550.js
src/pc-speaker.js
src/sb-dsp.js
src/upd765.js
src/vga-card.js
src/ym3812.js
test/dos-package-acceptance.test.mjs
test/dos-package-cli.test.mjs
test/dos-package-policy.test.mjs
test/dos-package-zip.test.mjs
'''.split())
PRODUCER = 'scripts/dos-package-acceptance/producer.py'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, allow_nan=False) + '\n').encode()


def write_new(path, data):
    with Path(path).open('xb') as handle:
        handle.write(data)


def error_row(error, phase):
    return dict(phase=phase, name=type(error).__name__, message=str(error))


class PreservedFailure(RuntimeError):
    """Keep the original exact row even if every retention channel fails."""
    def __init__(self, primary, secondary):
        super().__init__(primary['message'])
        self.firstFailure = primary
        self.secondary = secondary


def retention_fallback(primary, secondary, error, phase):
    """Only structured diagnostics, never raw PTY/report bytes or environment."""
    row = error_row(error, phase)
    if primary is None:
        primary = row
    else:
        secondary.append(row)

    def bounded(value):
        return {key: str(value[key])[:limit] for key, limit in
                (('phase', 128), ('name', 128), ('message', 2048))}

    first = bounded(primary)
    payload = dict(schema='bw.dos-package-pty.retention-failure.v1', firstFailure=first,
        secondary=[bounded(value) for value in secondary[:8]], secondaryCount=len(secondary),
        originalPrimarySha256=digest(json_bytes(primary)),
        truncated=first != primary or len(secondary) > 8 or any(bounded(value) != value for value in secondary[:8]))
    try:
        # At most nine rows with bounded fields, under 24 KiB before escaping.
        # JSON escaping has a bounded six-byte expansion per character.
        encoded = json.dumps(payload, separators=(',', ':'), ensure_ascii=True) + '\n'
        require(len(encoded) <= 131072, 'bounded retention diagnostic extent')
        sys.stderr.write(encoded)
    except BaseException as diagnostic_error:
        secondary.append(error_row(diagnostic_error, 'stderr-retention'))
    raise PreservedFailure(primary, secondary) from error


def canonical_termios(values):
    return list(values[:6]) + [[item if isinstance(item, int) else item[0] for item in values[6]]]


def raw_termios(values):
    return values[3] & (termios.ECHO | termios.ICANON | termios.ISIG) == 0


def line_ending(values):
    return b'\r\n' if values[1] & termios.OPOST and values[1] & termios.ONLCR else b'\n'


def decode_frame(frame, newline):
    """Exact held renderer shape, UTF-8 bytes but 80 characters per VGA row."""
    require(frame.startswith(b'\x1b[H'), 'frame prefix')
    lines = frame[3:].split(newline)
    require(len(lines) == 27 and lines[25] == FOOTER and lines[26] == b'', 'frame footer/extent')
    rows = [line.decode('utf-8', errors='strict') for line in lines[:25]]
    require(all(len(row) == 80 and all(0x20 <= ord(ch) <= 0x7e or 0xa0 <= ord(ch) <= 0xff
                                     for ch in row) for row in rows), 'frame character shape')
    return [row.rstrip(' ') for row in rows]


def parse_frames(raw, offset, newline):
    """Return complete frames only; incomplete suffix is retained, never guessed."""
    frames = []
    while offset < len(raw):
        suffix = raw[offset:]
        if RESET.startswith(suffix) or suffix.startswith(RESET):
            break
        require(b'\x1b[H'.startswith(suffix) or suffix.startswith(b'\x1b[H'), 'unknown PTY stream bytes')
        marker = newline + FOOTER + newline
        end = raw.find(marker, offset)
        if end == -1:
            require(len(suffix) <= 4083, 'incomplete frame exceeds renderer bound')
            break
        finish = end + len(marker)
        rows = decode_frame(raw[offset:finish], newline)
        frames.append((finish, rows)); offset = finish
    return offset, frames


def expected_rows(case):
    return [READY, f'BW-PKG-KEY={case};XOR5A={ord(case) ^ 0x5a:02X}', 'BW-PKG-DONE'] + [''] * 22


def read_snapshot(group):
    group = Path(group)
    stat = group.stat()
    text = lambda name: (group / name).read_text(encoding='ascii')
    return dict(identity=dict(device=stat.st_dev, inode=stat.st_ino),
                limits=dict(cpuMax=text('cpu.max').strip(), memoryMax=text('memory.max').strip(),
                            swapMax=text('memory.swap.max').strip(), pidsMax=text('pids.max').strip()),
                raw=dict(memoryEvents=text('memory.events'), cpuStat=text('cpu.stat'),
                         cgroupEvents=text('cgroup.events'), memoryCurrent=text('memory.current'),
                         memoryPeak=text('memory.peak'), pidsCurrent=text('pids.current')),
                procs=[int(value) for value in text('cgroup.procs').split()])


def snapshot_limits(snapshot):
    require(snapshot['limits'] == dict(cpuMax=CAPS['cpuMax'], memoryMax=str(CAPS['memoryMax']),
                                     swapMax='0', pidsMax='64'), 'cgroup limits differ')


def snapshot_empty(snapshot):
    return snapshot['procs'] == [] and 'populated 0\n' in snapshot['raw']['cgroupEvents'] and int(snapshot['raw']['pidsCurrent']) == 0


def expected_cgroup(value):
    run, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch(r'[1-9][0-9]*', run) is not None and attempt == '1', 'official owned run identity')
    expected = Path('/sys/fs/cgroup') / f'bw-dos-package-{run}-{attempt}'
    require(Path(value) == expected and expected.resolve(strict=True) == expected, 'exact owned cgroup path')
    return expected


def admit_cgroup(value):
    root = expected_cgroup(value)
    snapshot = read_snapshot(root); snapshot_limits(snapshot); require(snapshot_empty(snapshot), 'owned cgroup not initially empty')
    node = str(Path(shutil.which('node')).resolve(strict=True))
    require(os.getuid() > 0 and os.getgid() > 0, 'cgroup admission requires the unprivileged runner')
    source = (PACKET / 'source.before.json').read_bytes()
    owner = dict(path=str(root), snapshot=snapshot, bootstrap=dict(uid=os.getuid(), gid=os.getgid(),
        environment={name: os.environ[name] for name in ('PATH', 'HOME')}, runtime=runtime(node),
        controllerIdentity=read_snapshot(root / 'controller')['identity'], sourceSha256=digest(source)))
    write_new(PACKET / '.owner.json', json_bytes(owner))


def controller_entered(root, owner):
    """No migration here: privileged bootstrap must already have dropped all IDs."""
    identity = owner['bootstrap']; uid, gid = identity['uid'], identity['gid']
    require(os.getresuid() == (uid, uid, uid) and os.getresgid() == (gid, gid, gid) and os.getgroups() == [],
            'controller privilege drop incomplete')
    require(Path('/proc/self/cgroup').read_text(encoding='ascii') == '0::/' + root.name + '/controller\n',
            'controller was not bootstrapped into its owned leaf')
    require(read_snapshot(root / 'controller')['procs'] == [os.getpid()], 'controller leaf process identity')


class BootstrapOps:
    """Hosted only. Root performs file checks and one migration, never a child launch."""
    def __init__(self):
        self.root = None; self.owner = None; self.invoker = None

    def validate(self, value):
        require(os.getresuid() == (0, 0, 0) and os.getresgid() == (0, 0, 0), 'bootstrap requires privileged entry')
        ids = {name: os.environ.get('SUDO_' + name.upper(), '') for name in ('uid', 'gid')}
        require(all(re.fullmatch(r'[1-9][0-9]*', value) and int(value) < 2**31 for value in ids.values()),
                'trusted nonroot sudo invoker IDs unavailable')
        self.invoker = {name: int(value) for name, value in ids.items()}
        self.root = expected_cgroup(value)
        file = PACKET / '.owner.json'
        require(not file.is_symlink() and file.is_file() and file.stat().st_size <= 65536, 'bootstrap owner file')
        owner = json.loads(file.read_bytes())
        require(set(owner) == {'path', 'snapshot', 'bootstrap'} and owner['path'] == str(self.root), 'closed bootstrap owner')
        b = owner['bootstrap']
        require(set(b) == {'uid', 'gid', 'environment', 'runtime', 'controllerIdentity', 'sourceSha256'} and
                all(type(b[name]) is int and 0 < b[name] < 2**31 for name in ('uid', 'gid')), 'unprivileged runner IDs')
        require({name: b[name] for name in ('uid', 'gid')} == self.invoker, 'owner/invoker IDs differ')
        require(file.stat().st_uid == b['uid'] and file.stat().st_gid == b['gid'], 'bootstrap owner UID/GID changed')
        require(set(b['environment']) == {'PATH', 'HOME'} and all(isinstance(v, str) and 0 < len(v) <= 4096
                for v in b['environment'].values()), 'closed runner environment')
        self.owner = owner  # Retention may now drop to this checked file owner, even if later checks refuse.
        snapshot = read_snapshot(self.root); snapshot_limits(snapshot)
        require(snapshot['identity'] == owner['snapshot']['identity'] and snapshot_empty(snapshot), 'bootstrap root identity/empty boundary')
        leaf = read_snapshot(self.root / 'controller'); snapshot_limits(leaf)
        require(snapshot_empty(leaf) and leaf['identity'] == b['controllerIdentity'], 'controller leaf identity/empty boundary changed')
        raw = (PACKET / 'source.before.json').read_bytes(); source = json.loads(raw)
        require(digest(raw) == b['sourceSha256'] and source['schema'] == 'bw.dos-package-pty.source.v1' and
                source['head'] == os.environ.get('BW_EXPECTED_HEAD') and set(source['files']) == SOURCE_PATHS,
                'bootstrap exact source57 envelope')
        for name, row in source['files'].items():
            path = Path(name); stat = path.lstat()
            require(path.resolve(strict=True) == Path.cwd() / name and path.is_file() and
                    0 < row['bytes'] <= 8388608 and stat.st_size == row['bytes'], 'bootstrap source regular extent')
            with path.open('rb') as handle:
                data = handle.read(row['bytes'] + 1)
            require(len(data) == row['bytes'] and digest(data) == row['sha256'], 'bootstrap source bytes changed')
        require(Path(__file__).resolve(strict=True) == Path.cwd() / PRODUCER, 'held bootstrap source path')
        observed = b['runtime']['executables']
        require(set(observed) == {'node', 'python'} and observed['python'] == executable_row(sys.executable), 'bootstrap exact Python executable')
        for row in observed.values():
            require(set(row) == {'path', 'bytes', 'sha256'} and Path(row['path']).is_absolute() and
                    executable_row(row['path']) == row and Path(row['path']).stat().st_mode & 0o6000 == 0,
                    'bootstrap executable drift or privileged executable')
        require(str(Path(shutil.which('node', path=b['environment']['PATH'])).resolve(strict=True)) == observed['node']['path'],
                'bootstrap exact admitted Node selection')
        return self.root, owner

    def enter(self, root):
        (root / 'controller' / 'cgroup.procs').write_text(str(os.getpid()), encoding='ascii')
        snapshot = read_snapshot(root / 'controller'); snapshot_limits(snapshot)
        require(snapshot['procs'] == [os.getpid()] and snapshot['identity'] == self.owner['bootstrap']['controllerIdentity'],
                'privileged controller migration identity did not complete')

    def drop(self, owner):
        b = owner['bootstrap']; os.setgroups([])
        os.setresgid(b['gid'], b['gid'], b['gid']); os.setresuid(b['uid'], b['uid'], b['uid'])
        require(os.getresuid() == (b['uid'],) * 3 and os.getresgid() == (b['gid'],) * 3 and os.getgroups() == [],
                'bootstrap saved/effective IDs were not all dropped')
        status = Path('/proc/self/status').read_text(encoding='ascii')
        require(all(re.search(r'^' + field + r':\s+0+$', status, re.M) for field in ('CapEff', 'CapPrm')),
                'bootstrap retained effective/permitted capabilities')

    def execute(self, root, owner):
        controller_entered(root, owner)
        b = owner['bootstrap']; python = b['runtime']['executables']['python']['path']
        environment = dict(b['environment'], LANG='C.UTF-8', GITHUB_RUN_ID=os.environ['GITHUB_RUN_ID'],
            GITHUB_RUN_ATTEMPT='1', BW_EXPECTED_HEAD=os.environ['BW_EXPECTED_HEAD'])
        print('DOS_PACKAGE_BOOTSTRAP ' + json.dumps(dict(schema='bw.dos-package-pty.bootstrap.v1',
            pid=os.getpid(), uid=b['uid'], gid=b['gid'], supplementaryGroups=[], privilegedGuest=False)), flush=True)
        os.execve(python, [python, '-I', '-B', PRODUCER, '--run', str(root)], environment)

    def retain(self, error):
        primary = error_row(error, 'bootstrap'); secondary = []
        try:
            require(self.invoker is not None, 'checked sudo invoker unavailable for retention')
            b = self.invoker
            if os.getresuid() != (b['uid'],) * 3 or os.getresgid() != (b['gid'],) * 3 or os.getgroups():
                self.drop(dict(bootstrap=b))
            facts = dict(schema='bw.dos-package-pty.resources.v1', caps=CAPS,
                controller=dict(pid=os.getpid(), before=None, after=None), cases={},
                enclosing=dict(before=self.owner['snapshot'] if self.owner is not None else None, after=None),
                controllerFailure=dict(firstFailure=primary, secondary=secondary))
            write_new(PACKET / '.controller.json', json_bytes(facts))
        except BaseException as capture:
            retention_fallback(primary, secondary, capture, 'bootstrap-retention')


def bootstrap(value, ops=None):
    ops = BootstrapOps() if ops is None else ops
    try:
        root, owner = ops.validate(value)
        ops.enter(root)
        ops.drop(owner)
        ops.execute(root, owner)
        raise RuntimeError('bootstrap exec unexpectedly returned')
    except BaseException as error:
        ops.retain(error)
        return 1


def external_cleanup(ops, identity):
    """Preserve PRE-kill failure; successful cleanup cannot qualify a bad run."""
    before = ops.snapshot(); primary = None; secondary = []; after = None; attempted = False
    require(before['identity'] == identity, 'owned cgroup identity changed')
    if not snapshot_empty(before):
        primary = error_row(ValueError('enclosing cgroup remains populated before cleanup'), 'enclosing-terminal')
        try:
            attempted = True; ops.kill()
            deadline = ops.now() + 4_000_000_000
            while True:
                after = ops.snapshot()
                require(after['identity'] == identity, 'owned cgroup identity changed during cleanup')
                if snapshot_empty(after):
                    break
                require(ops.now() < deadline, 'owned cgroup cleanup deadline')
                ops.pause()
        except BaseException as error:
            secondary.append(error_row(error, 'owned-cgroup-cleanup'))
    return before, dict(killAttempted=attempted, after=after, firstFailure=primary, secondary=secondary)


class CleanupOps:
    def __init__(self, root):
        self.root = root

    def snapshot(self):
        return read_snapshot(self.root)

    def kill(self):
        (self.root / 'cgroup.kill').write_text('1', encoding='ascii')

    def now(self):
        return time.monotonic_ns()

    def pause(self):
        time.sleep(0.01)  # Finite cleanup only, after an already failed run.


def executable_row(path):
    resolved = Path(path).resolve(strict=True)
    require(resolved.is_file(), 'runtime executable type')
    data = resolved.read_bytes()
    return dict(path=str(resolved), bytes=len(data), sha256=digest(data))


def argv_for(case, node):
    filename = 'malformed' if case == 'malformed' else 'authored'
    return [node, 'scripts/run-dos-package.mjs', '--package', str(PACKET / 'inputs' / (filename + '.zip')),
            '--config', 'pkg/dosbox.conf', '--bios', 'roms/free-at-bios/BIOS-bochs-legacy',
            '--bios-sha256', BIOS_SHA, '--vga', 'roms/free-at-bios/vgabios-lgpl.bin', '--vga-sha256', VGA_SHA,
            '--steps', '50000000', '--wall-ms', '120000', '--live', '--report', str(PACKET / case / 'report.json')]


class RealCase:
    """All actual PTY/process operations are confined to this hosted adapter."""
    def __init__(self, case, argv, group):
        self.case, self.argv, self.group = case, argv, Path(group)
        self.child = None; self.master = None; self.slave = None; self.selector = None
        self.identity_read = None; self.identity_write = None
        self.waited = None; self.before = None

    def now(self):
        return time.monotonic_ns()

    def start(self):
        self.master, self.slave = pty.openpty()
        self.before = canonical_termios(termios.tcgetattr(self.slave))
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', 28, 80, 0, 0))
        environment = {name: os.environ[name] for name in ('PATH', 'HOME') if name in os.environ}
        environment.update(LANG='C.UTF-8', TERM='xterm-256color')
        self.identity_read, self.identity_write = os.pipe2(os.O_CLOEXEC)

        def child_setup():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
            (self.group / 'cgroup.procs').write_text(str(os.getpid()), encoding='ascii')
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
            resource.setrlimit(resource.RLIMIT_CPU, (120, 122))
            # Own process identity is recorded before exec, not raced after a
            # quick malformed-package exit. No Node/loader instrumentation.
            stat = Path('/proc/self/stat').read_text()
            packet = json_bytes(dict(pid=os.getpid(), pgid=os.getpgrp(),
                startTimeTicks=int(stat[stat.rfind(')') + 2:].split()[19])))
            require(len(packet) <= 256 and os.write(self.identity_write, packet) == len(packet), 'child identity packet')
            os.close(self.identity_write)

        spawned = self.now()
        try:
            self.child = subprocess.Popen(self.argv, stdin=self.slave, stdout=self.slave, stderr=self.slave,
                env=environment, close_fds=True, pass_fds=(self.identity_write,), preexec_fn=child_setup)
        finally:
            os.close(self.identity_write); self.identity_write = None
        packet = os.read(self.identity_read, 257)
        require(0 < len(packet) <= 256 and packet.endswith(b'\n'), 'child identity extent')
        identity = json.loads(packet)
        require(set(identity) == {'pid', 'pgid', 'startTimeTicks'} and identity['pid'] == self.child.pid and
                identity['pid'] == identity['pgid'] and type(identity['startTimeTicks']) is int and
                identity['startTimeTicks'] > 0, 'child identity mismatch')
        os.close(self.identity_read); self.identity_read = None
        os.set_blocking(self.master, False)
        self.selector = selectors.DefaultSelector(); self.selector.register(self.master, selectors.EVENT_READ)
        return dict(**identity, spawnMonoNs=spawned)

    def read(self, timeout):
        if not self.selector.select(timeout):
            return None
        try:
            return os.read(self.master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                return None
            raise

    def write(self, data):
        return os.write(self.master, data)

    def termios(self):
        return canonical_termios(termios.tcgetattr(self.slave))

    def wait(self):
        if self.waited is None and self.child is not None:
            pid, status, usage = os.wait4(self.child.pid, os.WNOHANG)
            if pid:
                code = os.waitstatus_to_exitcode(status); self.child.returncode = code
                self.waited = dict(returncode=code, signal=-code if code < 0 else None, waitStatus=status,
                                   reapMonoNs=self.now(), rusage=dict(userSeconds=usage.ru_utime,
                                   systemSeconds=usage.ru_stime, maxRssKiB=usage.ru_maxrss))
        return self.waited

    def stop(self):
        if self.child is None or self.wait() is not None:
            return
        for sig in (signal.SIGTERM, signal.SIGKILL):
            os.killpg(self.child.pid, sig)
            deadline = self.now() + 2_000_000_000
            while self.wait() is None and self.now() < deadline:
                time.sleep(0.01)  # Bounded cleanup only; never selects a passing guest.
            if self.wait() is not None:
                return
        raise RuntimeError('owned child did not reap in cleanup grace')

    def group_empty(self):
        if self.child is None:
            return False
        try:
            os.killpg(self.child.pid, 0)
            return False
        except ProcessLookupError:
            return True

    def report(self):
        path = PACKET / self.case / 'report.json'
        if not path.exists():
            return None
        require(path.is_file() and not path.is_symlink() and path.stat().st_size <= CAPS['reportBytes'], 'report bound')
        return json.loads(path.read_bytes())

    def close(self):
        failures = []
        for action in (lambda: self.selector.close() if self.selector else None,
                       lambda: os.close(self.master) if self.master is not None else None,
                       lambda: os.close(self.slave) if self.slave is not None else None,
                       lambda: os.close(self.identity_read) if self.identity_read is not None else None,
                       lambda: os.close(self.identity_write) if self.identity_write is not None else None):
            try:
                action()
            except BaseException as error:
                failures.append(error)
        if failures:
            raise failures[0]


def run_case(case, argv, ops, outer_deadline):
    """Actual orchestration body; pure controls inject an inert adapter."""
    raw = bytearray(); events = []; primary = None; secondary = []; event_bytes = 2
    before = raw_mode = after = None; waited = None; identity = {}; sent = False
    parsed = len(START); response = False; newline = None; report = None; group_empty = False

    def fail(error, phase):
        nonlocal primary
        row = error_row(error, phase)
        if primary is None:
            primary = row
        else:
            secondary.append(row)

    def event(kind, **fields):
        nonlocal event_bytes
        require(len(events) < CAPS['eventCount'], 'event count cap')
        row = dict(seq=len(events), monoNs=ops.now(), kind=kind, **fields)
        event_bytes += len(json.dumps(row, separators=(',', ':')).encode()) + (1 if events else 0)
        require(event_bytes <= CAPS['eventBytes'], 'events byte cap')
        events.append(row)

    def send(data):
        position = 0
        while position < len(data):
            count = ops.write(data[position:])
            require(isinstance(count, int) and 0 < count <= len(data) - position, 'PTY write made invalid progress')
            written = data[position:position + count]
            event('write', hex=written.hex(), written=count); position += count

    deadline = min(outer_deadline, ops.now() + CAPS['childMs'] * 1_000_000)
    try:
        identity = ops.start(); before = ops.before
        require(identity['pid'] == identity['pgid'], 'child must own fresh process group')
        while True:
            require(ops.now() < deadline, 'child deadline exceeded')
            chunk = ops.read(0 if waited else 0.05)
            if chunk:
                require(len(raw) + len(chunk) <= CAPS['ptyBytes'], 'PTY output byte cap')
                offset = len(raw); raw.extend(chunk); event('read', offset=offset, bytes=len(chunk))
                if case != 'malformed' and len(raw) >= len(START):
                    require(raw.startswith(START), 'missing terminal start')
                    if raw_mode is None:
                        raw_mode = ops.termios(); require(raw_termios(raw_mode), 'live terminal is not raw')
                        newline = line_ending(raw_mode)
                    parsed, frames = parse_frames(raw, parsed, newline)
                    for _, rows in frames:
                        if 'BW-PKG-FAIL' in rows:
                            raise ValueError('authored guest rejected key')
                        is_ready = rows == [READY] + [''] * 24
                        if is_ready and not sent:
                            send(b'\x1b[O' if case == 'focus-loss' else b'\x1b[I' + case.encode('ascii'))
                            sent = True
                        if any('BW-PKG-KEY=' in row or 'BW-PKG-DONE' in row for row in rows):
                            require(sent and case in ('a', 'b'), 'response before key or in focus case')
                            # Partial authored output may be visible; only a complete exact result qualifies.
                            if rows == expected_rows(case):
                                response = True
                            require(not any(f'BW-PKG-KEY={other}' in row for other in ('a', 'b') if other != case
                                            for row in rows), 'opposite key response')
            current = ops.wait()
            if current is not None:
                waited = current
                if not chunk:
                    break
        after = ops.termios()
        require(after == before, 'terminal settings not restored')
        require(waited is not None, 'missing original wait status')
        event('wait', returncode=waited['returncode'], signal=waited['signal'])
        report = ops.report()
        if case == 'malformed':
            expected = b'DOS package refused: package path is not canonical' + line_ending(before)
            require(waited['returncode'] == 1 and bytes(raw) == expected and report is None,
                    'malformed refusal/status/report mismatch')
        else:
            require(raw_mode is not None and sent and bytes(raw[parsed:]) == RESET, 'live stream did not restore exactly')
            require(report is not None and report['secondaryErrors'] == [] and report['snapshotComplete'] is True,
                    'missing/incomplete runner report')
            require(report['terminal'] == dict(started=True, restorationAttempted=True, restorationComplete=True),
                    'runner terminal restoration uncertainty')
            if case in ('a', 'b'):
                codes = [row['code'] for row in report['input']['delivered']]
                steps = [row['step'] for row in report['input']['delivered']]
                require(response and report['text'] == expected_rows(case), 'missing exact visible guest response')
                require(waited['returncode'] == 0 and report['stop'] == 'budget' and report['refused'] is None,
                        'positive did not reach finite budget normally')
                require(report['input']['bytes'] == 4 and codes == ([30, 158] if case == 'a' else [48, 176]) and
                        len(steps) == 2 and all(step % 1024 == 0 for step in steps) and steps[1] - steps[0] >= 65536,
                        'accepted make/break chronology')
            else:
                require(waited['returncode'] == 1 and report['stop'] == 'refused' and
                        report['refused'] == dict(phase='terminal-input', name='Error',
                        message='terminal focus loss ends this bounded package session') and
                        report['input']['bytes'] == 3 and report['input']['delivered'] == [], 'focus refusal mismatch')
            require(report['input']['pendingScanBytes'] == 0, 'pending input at stop')
        group_empty = ops.group_empty(); require(group_empty, 'owned process group remains')
    except BaseException as error:
        fail(error, 'case')
    finally:
        for phase, operation in (('stop', ops.stop), ('final-wait', lambda: ops.wait()),
                                 ('termios-after', ops.termios), ('group-after', ops.group_empty)):
            try:
                value = operation()
                if phase == 'final-wait' and value is not None:
                    waited = value
                elif phase == 'termios-after':
                    after = value
                elif phase == 'group-after':
                    group_empty = value
            except BaseException as error:
                fail(error, phase)
        try:
            ops.close()
        except BaseException as error:
            fail(error, 'descriptor-close')
    process = dict(schema='bw.dos-package-pty.process.v1', case=case, argv=argv, cwdRole='checkout',
                   environmentPolicy=ENV_POLICY, **identity, **(waited or {}), groupEmpty=group_empty,
                   firstFailure=primary, secondary=secondary)
    return process, dict(schema='bw.dos-package-pty.events.v1', case=case, events=events,
                         termios=dict(before=before, raw=raw_mode, after=after)), bytes(raw)


def runtime(node):
    return dict(schema='bw.dos-package-pty.runtime.v1',
                platform=dict(sysname=platform.system(), release=platform.release(), machine=platform.machine()),
                executables=dict(node=executable_row(node), python=executable_row(sys.executable)),
                versions=dict(node=subprocess.check_output([node, '--version'], text=True).strip(),
                              python=subprocess.check_output([sys.executable, '--version'], text=True).strip()))


def write_capped_json(path, value, cap):
    data = json_bytes(value)
    require(len(data) <= cap, 'retained JSON byte cap')
    write_new(path, data)


def run_all(cgroup):
    root = None
    primary = None; secondary = []; facts = dict(schema='bw.dos-package-pty.resources.v1', caps=CAPS,
        controller=dict(pid=os.getpid(), before=None, after=None), cases={}, enclosing=dict(before=None, after=None))
    deadline = time.monotonic_ns() + CAPS['controllerMs'] * 1_000_000
    try:
        root = expected_cgroup(cgroup)
        node = str(Path(shutil.which('node')).resolve(strict=True))
        owner = json.loads((PACKET / '.owner.json').read_bytes())
        facts['enclosing']['before'] = read_snapshot(root); snapshot_limits(facts['enclosing']['before'])
        require(owner['path'] == str(root) and owner['snapshot']['identity'] == facts['enclosing']['before']['identity'], 'owned cgroup admission changed')
        controller_entered(root, owner)
        facts['controller']['before'] = read_snapshot(root / 'controller')
        observed_runtime = runtime(node)
        require(observed_runtime == owner['bootstrap']['runtime'], 'bootstrap/controller runtime identity changed')
        write_new(PACKET / 'runtime.json', json_bytes(observed_runtime))
        for case in CASES:
            require(time.monotonic_ns() < deadline, 'controller deadline exceeded')
            group = root / case; before = read_snapshot(group); snapshot_limits(before)
            process, events, raw = run_case(case, argv_for(case, node), RealCase(case, argv_for(case, node), group), deadline)
            # Adopt the child boundary's first row before any later observation
            # or retention can fail. Wrapper diagnostics cannot replace it.
            if process['firstFailure'] is not None:
                primary = process['firstFailure']
                secondary.extend(process['secondary'])
            elif process['secondary']:
                primary, *remaining = process['secondary']
                secondary.extend(remaining)
            write_new(PACKET / case / 'pty.raw', raw)
            write_capped_json(PACKET / case / 'process.json', process, 2 * 1024 * 1024)
            write_capped_json(PACKET / case / 'events.json', events, CAPS['eventBytes'])
            after = read_snapshot(group); facts['cases'][case] = dict(before=before, after=after)
            require(process['firstFailure'] is None and process['secondary'] == [], 'case failed: ' + case)
            require(after['procs'] == [], 'case cgroup nonempty')
        subprocess.run([node, 'scripts/dos-package-acceptance/probe.mjs', 'source', str(PACKET / 'source.after.json')], check=True)
        require((PACKET / 'source.before.json').read_bytes() == (PACKET / 'source.after.json').read_bytes(), 'source changed')
        require(json.loads((PACKET / 'runtime.json').read_bytes()) == runtime(node), 'runtime changed')
    except BaseException as error:
        if primary is None:
            primary = error_row(error, 'controller')
        else:
            secondary.append(error_row(error, 'controller'))
    finally:
        try:
            if root is not None:
                facts['controller']['after'] = read_snapshot(root / 'controller')
        except BaseException as error:
            if primary is None:
                primary = error_row(error, 'controller-snapshot')
            else:
                secondary.append(error_row(error, 'controller-snapshot'))
        facts['controllerFailure'] = dict(firstFailure=primary, secondary=secondary)
        # Temporary control file is removed by the outside finalizer, never admitted as a successful role.
        try:
            write_new(PACKET / '.controller.json', json_bytes(facts))
        except BaseException as error:
            retention_fallback(primary, secondary, error, 'controller-retention')
    return 1 if primary or secondary else 0


def finalize(cgroup):
    primary = None; secondary = []; facts = dict(schema='bw.dos-package-pty.resources.v1', caps=CAPS,
        controller=dict(pid=None, before=None, after=None), cases={}, enclosing=dict(before=None, after=None))
    try:
        facts = json.loads((PACKET / '.controller.json').read_bytes())
        control = facts.pop('controllerFailure'); primary, secondary = control['firstFailure'], control['secondary']
    except BaseException as error:
        primary = error_row(error, 'controller-evidence')
    try:
        root = expected_cgroup(cgroup); owner = json.loads((PACKET / '.owner.json').read_bytes())
        require(owner['path'] == str(root), 'owned cgroup admission path')
        before, cleanup = external_cleanup(CleanupOps(root), owner['snapshot']['identity'])
        facts['enclosing']['after'] = before
        if facts['enclosing']['before'] is None:
            facts['enclosing']['before'] = owner['snapshot']
        if cleanup['firstFailure'] is not None:
            if primary is None:
                primary = cleanup['firstFailure']
            else:
                secondary.append(cleanup['firstFailure'])
            secondary.extend(cleanup['secondary'])
            write_new(PACKET / '.cleanup.json', json_bytes(cleanup))
    except BaseException as error:
        row = error_row(error, 'external-cleanup')
        if primary is None:
            primary = row
        else:
            secondary.append(row)
    try:
        write_new(PACKET / 'resources.json', json_bytes(facts))
        rows = []
        for file in sorted(PACKET.rglob('*')):
            require(not file.is_symlink(), 'evidence symlink')
            if file.is_file() and file.name not in ('.controller.json', '.owner.json'):
                data = file.read_bytes(); rows.append(dict(path=file.relative_to(PACKET).as_posix(), bytes=len(data), sha256=digest(data)))
        rows.sort(key=lambda row: row['path'])
        try:
            source = json.loads((PACKET / 'source.before.json').read_bytes())
        except BaseException as error:
            source = dict(head=os.environ.get('BW_EXPECTED_HEAD'), tree=None)
            if primary is None:
                primary = error_row(error, 'source-retention')
            else:
                secondary.append(error_row(error, 'source-retention'))
        workflow = Path('.github/workflows/dos-package-acceptance.yml').read_bytes()
        audit = dict(schema='bw.dos-package-pty.audit.v1', head=source['head'], sourceTree=source['tree'],
                     workflowSha256=digest(workflow), roles=rows, cases=list(CASES), firstFailure=primary, secondary=secondary)
        encoded_audit = json_bytes(audit)
        require(sum(row['bytes'] for row in rows) + len(encoded_audit) <= CAPS['packetBytes'], 'packet byte cap including audit')
        write_new(PACKET / 'audit.json', encoded_audit)
        for temporary in ('.controller.json', '.owner.json'):
            (PACKET / temporary).unlink(missing_ok=True)
    except BaseException as error:
        retention_fallback(primary, secondary, error, 'finalizer-retention')
    return 1 if primary or secondary else 0


def controls():
    """Inert adapter controls: no openpty, subprocess, cgroup or machine."""
    import unittest
    from unittest.mock import patch
    from contextlib import ExitStack, contextmanager
    import io

    class Fake:
        def __init__(self, case, fault=None):
            self.case, self.fault = case, fault; self.before = [0, 0, 0, termios.ICANON | termios.ECHO | termios.ISIG, 0, 0, [0] * 32]
            self.clock = 0; self.index = 0; self.sent = False; self.closed = False

        def now(self):
            self.clock += 1000; return self.clock

        def frame(self, rows):
            return b'\x1b[H' + b'\n'.join(row.ljust(80).encode() for row in rows) + b'\n' + FOOTER + b'\n'

        def start(self):
            return dict(pid=100, pgid=100, startTimeTicks=1, spawnMonoNs=self.now())

        def read(self, timeout):
            self.index += 1
            if self.fault == 'read':
                raise ValueError('first read failure')
            if self.case == 'malformed':
                return b'DOS package refused: package path is not canonical\n' if self.index == 1 else None
            if self.index == 1:
                return START + self.frame(['BIOS still starting' if self.fault == 'no-ready' else READY] + [''] * 24)
            if self.index == 2:
                shown = 'b' if self.fault == 'wrong-response' and self.case == 'a' else self.case
                return (self.frame(expected_rows(shown)) if self.case != 'focus-loss' else b'') + RESET
            return None

        def write(self, data):
            if self.fault == 'write':
                return 0
            self.sent = True; return len(data)

        def termios(self):
            if self.index == 1 and self.case != 'malformed':
                return [0, 0, 0, 0, 0, 0, [0] * 32]
            if self.fault == 'restore':
                return [0, 0, 0, 0, 0, 0, [0] * 32]
            return self.before

        def wait(self):
            if self.index < (2 if self.case == 'malformed' else 3):
                return None
            code = 1 if self.case in ('malformed', 'focus-loss') else 0
            if self.fault == 'nonzero':
                code = 1
            return dict(returncode=code, signal=None, waitStatus=code << 8, reapMonoNs=self.now(),
                        rusage=dict(userSeconds=0.1, systemSeconds=0.1, maxRssKiB=100))

        def report(self):
            if self.case == 'malformed':
                return None
            focus = self.case == 'focus-loss'
            result = dict(secondaryErrors=[], snapshotComplete=True, terminal=dict(started=True, restorationAttempted=True,
                restorationComplete=True), text=[READY] + [''] * 24 if focus else expected_rows(self.case),
                stop='refused' if focus else 'budget', refused=dict(phase='terminal-input', name='Error',
                message='terminal focus loss ends this bounded package session') if focus else None,
                input=dict(bytes=3 if focus else 4, pendingScanBytes=0, delivered=[] if focus else
                           [dict(step=16384, code=30 if self.case == 'a' else 48), dict(step=81920, code=158 if self.case == 'a' else 176)]))
            if self.fault == 'short-gap':
                result['input']['delivered'][1]['step'] = 1024
            if self.fault == 'missing-break':
                result['input']['delivered'].pop()
            return result

        def stop(self):
            if self.fault == 'read':
                raise ValueError('secondary stop failure')

        def group_empty(self):
            return self.fault != 'group-live'

        def close(self):
            self.closed = True

    class Controls(unittest.TestCase):
        @contextmanager
        def wrapper_mocks(self, child_primary=None, owner_error=False, writer_fault=None, controller_primary=None):
            """Patch every OS/filesystem/process edge; execute real wrappers."""
            saved = {}; stderr = io.StringIO(); root = Path('/inert/cgroup')
            snapshot = dict(identity=dict(device=1, inode=2),
                limits=dict(cpuMax=CAPS['cpuMax'], memoryMax=str(CAPS['memoryMax']), swapMax='0', pidsMax='64'),
                procs=[], raw=dict(cgroupEvents='populated 0\n', pidsCurrent='0\n'))
            controller = dict(schema='bw.dos-package-pty.resources.v1', caps=CAPS,
                controller=dict(pid=100, before=snapshot, after=snapshot), cases={},
                enclosing=dict(before=snapshot, after=None),
                controllerFailure=dict(firstFailure=controller_primary, secondary=[]))

            def read(file):
                if file.name == '.owner.json':
                    if owner_error:
                        raise ValueError('FIRST owner read')
                    return json_bytes(dict(path=str(root), snapshot=snapshot, bootstrap=dict(runtime={})))
                if file.name == '.controller.json':
                    return saved.get('.controller.json', json_bytes(controller))
                if file.name in ('source.before.json', 'source.after.json'):
                    return json_bytes(dict(head='a' * 40, tree='b' * 40))
                return b'{}'

            def write(file, data):
                if file.name == writer_fault:
                    raise OSError('SECONDARY ' + file.name + ' retention')
                saved[file.name] = data

            with ExitStack() as stack:
                for name, value in (('expected_cgroup', lambda _: root), ('runtime', lambda _: {}),
                    ('read_snapshot', lambda _: snapshot), ('write_new', write), ('controller_entered', lambda *args: None),
                    ('RealCase', lambda *args: None),
                    ('run_case', lambda *args: (dict(firstFailure=child_primary, secondary=[]), {}, b'')),
                    ('external_cleanup', lambda *args: (snapshot, dict(firstFailure=None, secondary=[])))):
                    stack.enter_context(patch(__name__ + '.' + name, value))
                stack.enter_context(patch(__name__ + '.CASES', ('a',)))
                stack.enter_context(patch(__name__ + '.shutil.which', return_value='/inert/node'))
                stack.enter_context(patch.object(Path, 'resolve', return_value=Path('/inert/node')))
                stack.enter_context(patch.object(Path, 'read_bytes', read))
                stack.enter_context(patch.object(Path, 'write_text', return_value=1))
                stack.enter_context(patch.object(Path, 'unlink'))
                stack.enter_context(patch.object(Path, 'rglob', return_value=[]))
                stack.enter_context(patch(__name__ + '.subprocess.run'))
                stack.enter_context(patch(__name__ + '.sys.stderr', stderr))
                yield saved, stderr

        def test_bootstrap_sequence_faults_and_missing_drop_mutation(self):
            import inspect
            class Replaced(BaseException): pass
            class Ops:
                def __init__(self, fault=None): self.calls = []; self.fault = fault; self.entered = self.dropped = False
                def validate(self, value):
                    self.calls.append('validate'); require(self.fault != 'validate', 'source drift'); return Path('/inert/root'), {}
                def enter(self, root):
                    self.calls.append('enter'); require(self.fault != 'enter', 'migration failure'); self.entered = True
                def drop(self, owner):
                    self.calls.append('drop'); require(self.entered and self.fault != 'drop', 'privilege drop failure'); self.dropped = True
                def execute(self, root, owner):
                    require(self.entered and self.dropped, 'privileged exec refused'); self.calls.append('exec'); raise Replaced()
                def retain(self, error):
                    if isinstance(error, Replaced): raise error
                    self.calls.append('retain'); self.first = error
            positive = Ops()
            with self.assertRaises(Replaced): bootstrap('inert', positive)
            self.assertEqual(positive.calls, ['validate', 'enter', 'drop', 'exec'])
            for fault in ('validate', 'enter', 'drop'):
                ops = Ops(fault); self.assertEqual(bootstrap('inert', ops), 1); self.assertNotIn('exec', ops.calls)
            # Execute the same orchestration body with precisely its drop call removed.
            text = inspect.getsource(bootstrap).replace('        ops.drop(owner)', '        pass # mutation: missing privilege drop')
            self.assertNotEqual(text, inspect.getsource(bootstrap)); namespace = dict(globals()); exec(text, namespace)
            ops = Ops(); self.assertEqual(namespace['bootstrap']('inert', ops), 1)
            self.assertIn('privileged exec refused', str(ops.first)); self.assertNotIn('exec', ops.calls)

        def test_bootstrap_all_saved_ids_drop_before_exec_and_fail_closed(self):
            state = dict(uid=(0, 0, 0), gid=(0, 0, 0), groups=[0]); calls = []
            owner = dict(bootstrap=dict(uid=1001, gid=1002))
            def groups(value): calls.append(('groups', value)); state['groups'] = value
            def gid(*value): calls.append(('gid', value)); state['gid'] = value
            def uid(*value): calls.append(('uid', value)); state['uid'] = value
            with patch.object(os, 'setgroups', groups), patch.object(os, 'setresgid', gid), patch.object(os, 'setresuid', uid), \
                 patch.object(os, 'getresuid', lambda: state['uid']), patch.object(os, 'getresgid', lambda: state['gid']), \
                 patch.object(os, 'getgroups', lambda: state['groups']), patch.object(Path, 'read_text', return_value='CapEff:\t0000\nCapPrm:\t0000\n'):
                BootstrapOps().drop(owner)
                self.assertEqual(calls, [('groups', []), ('gid', (1002, 1002, 1002)), ('uid', (1001, 1001, 1001))])
                for field in ('uid', 'gid', 'groups'):
                    with patch.object(os, 'setresuid' if field == 'uid' else 'setresgid' if field == 'gid' else 'setgroups', side_effect=PermissionError('drop refused')):
                        with self.assertRaises(PermissionError): BootstrapOps().drop(owner)
                with patch.object(Path, 'read_text', return_value='CapEff:\t0001\nCapPrm:\t0000\n'):
                    with self.assertRaisesRegex(ValueError, 'capabilities'): BootstrapOps().drop(owner)

        def test_actual_controller_entry_and_already_entered_guard(self):
            root = Path('/inert/bw-dos-package-7-1'); writes = []
            snapshot = dict(identity=dict(device=1, inode=2), procs=[123], limits=dict(cpuMax='100000 100000', memoryMax='1073741824', swapMax='0', pidsMax='64'))
            with patch.object(os, 'getpid', return_value=123), patch.object(Path, 'write_text', lambda path, text, **kw: writes.append((str(path), text))), \
                 patch(__name__ + '.read_snapshot', return_value=snapshot):
                ops = BootstrapOps(); ops.owner = dict(bootstrap=dict(controllerIdentity=dict(device=1, inode=2)))
                ops.enter(root)
                self.assertEqual(writes, [(str(root / 'controller/cgroup.procs'), '123')])
                owner = dict(bootstrap=dict(uid=1001, gid=1002))
                with patch.object(os, 'getresuid', return_value=(1001,) * 3), patch.object(os, 'getresgid', return_value=(1002,) * 3), \
                     patch.object(os, 'getgroups', return_value=[]), patch.object(Path, 'read_text', return_value='0::/bw-dos-package-7-1/controller\n'):
                    controller_entered(root, owner)
                    with patch.object(os, 'getresuid', return_value=(0, 1001, 0)):
                        with self.assertRaisesRegex(ValueError, 'privilege drop'): controller_entered(root, owner)
                    with patch.object(Path, 'read_text', return_value='0::/outside\n'):
                        with self.assertRaisesRegex(ValueError, 'owned leaf'): controller_entered(root, owner)
                snapshot['procs'] = []
                with self.assertRaisesRegex(ValueError, 'migration'): ops.enter(root)

        def test_bootstrap_source_runtime_identity_admission_actual_body(self):
            from types import SimpleNamespace
            import copy
            root = Path('/inert/cgroup'); cwd = Path('/inert/repo')
            rows = {name: ('authored-' + name).encode() for name in SOURCE_PATHS}
            source = dict(schema='bw.dos-package-pty.source.v1', head='a' * 40, tree='b' * 40,
                          files={name: dict(bytes=len(data), sha256=digest(data)) for name, data in rows.items()})
            rows['/inert/node'] = b'node'; rows['/inert/python'] = b'python'
            exes = {name: dict(path='/inert/' + name, bytes=len(rows['/inert/' + name]), sha256=digest(rows['/inert/' + name])) for name in ('node', 'python')}
            snap = dict(identity=dict(device=1, inode=2), procs=[], limits=dict(cpuMax='100000 100000', memoryMax='1073741824', swapMax='0', pidsMax='64'), raw=dict(cgroupEvents='populated 0\n', pidsCurrent='0\n'))
            owner = dict(path=str(root), snapshot=copy.deepcopy(snap), bootstrap=dict(uid=1001, gid=1002,
                environment=dict(PATH='/inert', HOME='/inert/home'), runtime=dict(executables=exes),
                controllerIdentity=copy.deepcopy(snap['identity']), sourceSha256=digest(json_bytes(source))))
            for cut in (None, 'source', 'runtime', 'identity', 'uid', 'pathset', 'leaf'):
                current = copy.deepcopy(owner); manifest = copy.deepcopy(source); files = dict(rows); observed = copy.deepcopy(snap)
                if cut == 'source': files[next(iter(SOURCE_PATHS))] += b'!'
                if cut == 'runtime': current['bootstrap']['runtime']['executables']['node']['sha256'] = '0' * 64
                if cut == 'identity': observed['identity']['inode'] += 1
                if cut == 'leaf': current['bootstrap']['controllerIdentity']['inode'] += 1
                if cut == 'uid': current['bootstrap']['uid'] = 0
                if cut == 'pathset': manifest['files']['../foreign'] = manifest['files'].pop(next(iter(SOURCE_PATHS)))
                raw = json_bytes(manifest); current['bootstrap']['sourceSha256'] = digest(raw)
                files[str(PACKET / '.owner.json')] = json_bytes(current); files[str(PACKET / 'source.before.json')] = raw
                def stat(path): return SimpleNamespace(st_size=len(files[str(path)]), st_uid=1001, st_gid=1002, st_mode=0o100755)
                def resolve(path, **kw):
                    if str(path) == __file__: return cwd / PRODUCER
                    return path if path.is_absolute() else cwd / path
                with ExitStack() as stack:
                    for name, value in (('expected_cgroup', lambda _: root), ('read_snapshot', lambda _: observed)):
                        stack.enter_context(patch(__name__ + '.' + name, value))
                    stack.enter_context(patch.dict(os.environ, {'BW_EXPECTED_HEAD': 'a' * 40, 'SUDO_UID': '1001', 'SUDO_GID': '1002'}, clear=True))
                    stack.enter_context(patch.object(os, 'getresuid', return_value=(0, 0, 0))); stack.enter_context(patch.object(os, 'getresgid', return_value=(0, 0, 0)))
                    stack.enter_context(patch.object(Path, 'is_symlink', return_value=False)); stack.enter_context(patch.object(Path, 'is_file', return_value=True))
                    stack.enter_context(patch.object(Path, 'stat', stat)); stack.enter_context(patch.object(Path, 'lstat', stat))
                    stack.enter_context(patch.object(Path, 'resolve', resolve)); stack.enter_context(patch.object(Path, 'cwd', return_value=cwd))
                    stack.enter_context(patch.object(Path, 'read_bytes', lambda path: files[str(path)])); stack.enter_context(patch.object(Path, 'open', lambda path, mode: io.BytesIO(files[str(path)])))
                    stack.enter_context(patch.object(sys, 'executable', '/inert/python')); stack.enter_context(patch.object(shutil, 'which', return_value='/inert/node'))
                    no_child = stack.enter_context(patch.object(subprocess, 'run', side_effect=AssertionError('privileged child forbidden')))
                    no_version = stack.enter_context(patch.object(subprocess, 'check_output', side_effect=AssertionError('privileged child forbidden')))
                    if cut is None: self.assertEqual(BootstrapOps().validate('inert')[0], root)
                    else:
                        with self.assertRaises(ValueError): BootstrapOps().validate('inert')
                    no_child.assert_not_called(); no_version.assert_not_called()

        def test_bootstrap_exact_unprivileged_exec_and_environment(self):
            root = Path('/inert/root'); owner = dict(bootstrap=dict(uid=1001, gid=1002,
                runtime=dict(executables=dict(python=dict(path='/inert/python'))), environment=dict(PATH='/inert', HOME='/inert/home')))
            calls = []; stdout = io.StringIO()
            with patch(__name__ + '.controller_entered', lambda *args: calls.append('unprivileged-and-owned')), \
                 patch.dict(os.environ, dict(GITHUB_RUN_ID='7', GITHUB_RUN_ATTEMPT='1', BW_EXPECTED_HEAD='a'*40, LD_PRELOAD='forbidden'), clear=True), \
                 patch.object(os, 'getpid', return_value=123), patch.object(os, 'execve', lambda *args: calls.append(args)), patch.object(sys, 'stdout', stdout):
                BootstrapOps().execute(root, owner)
            self.assertEqual(calls[0], 'unprivileged-and-owned')
            self.assertEqual(calls[1], ('/inert/python', ['/inert/python', '-I', '-B', PRODUCER, '--run', str(root)],
                dict(PATH='/inert', HOME='/inert/home', LANG='C.UTF-8', GITHUB_RUN_ID='7', GITHUB_RUN_ATTEMPT='1', BW_EXPECTED_HEAD='a'*40)))
            self.assertFalse(json.loads(stdout.getvalue().split(' ', 1)[1])['privilegedGuest'])
            with patch(__name__ + '.controller_entered', side_effect=PermissionError('not dropped')), patch.object(os, 'execve') as execute:
                with self.assertRaises(PermissionError): BootstrapOps().execute(root, owner)
                execute.assert_not_called()

        def test_pre_owner_bootstrap_primary_survives_finalizer_and_invalid_invoker_refuses(self):
            state = dict(uid=(0, 0, 0), gid=(0, 0, 0), groups=[0])
            with self.wrapper_mocks(owner_error=True) as (saved, stderr), ExitStack() as stack:
                stack.enter_context(patch.dict(os.environ, dict(SUDO_UID='1001', SUDO_GID='1002'), clear=True))
                stack.enter_context(patch.object(os, 'getresuid', lambda: state['uid']))
                stack.enter_context(patch.object(os, 'getresgid', lambda: state['gid']))
                stack.enter_context(patch.object(os, 'getgroups', lambda: state['groups']))
                stack.enter_context(patch.object(os, 'setresuid', lambda *v: state.update(uid=v)))
                stack.enter_context(patch.object(os, 'setresgid', lambda *v: state.update(gid=v)))
                stack.enter_context(patch.object(os, 'setgroups', lambda v: state.update(groups=v)))
                stack.enter_context(patch.object(Path, 'read_text', return_value='CapEff:\t0000\nCapPrm:\t0000\n'))
                with patch(__name__ + '.expected_cgroup', side_effect=ValueError('FIRST pre-owner path refusal')):
                    self.assertEqual(bootstrap('inert'), 1)
                original = json.loads(saved['.controller.json'])['controllerFailure']['firstFailure']
                self.assertEqual(original, dict(phase='bootstrap', name='ValueError', message='FIRST pre-owner path refusal'))
                self.assertEqual(finalize('inert'), 1)
                self.assertEqual(json.loads(saved['audit.json'])['firstFailure'], original)
                self.assertEqual(json.loads(saved['audit.json'])['secondary'][0]['phase'], 'external-cleanup')
                self.assertIn('FIRST owner read', json.loads(saved['audit.json'])['secondary'][0]['message'])
            with self.wrapper_mocks() as (saved, stderr), patch.dict(os.environ, dict(SUDO_UID='0', SUDO_GID='bad'), clear=True), \
                 patch.object(os, 'getresuid', return_value=(0,) * 3), patch.object(os, 'getresgid', return_value=(0,) * 3), \
                 patch.object(os, 'setgroups') as groups, patch.object(os, 'setresgid') as gid, patch.object(os, 'setresuid') as uid, patch.object(os, 'execve') as execute:
                with self.assertRaises(PreservedFailure) as error: bootstrap('inert')
                self.assertIn('sudo invoker', error.exception.firstFailure['message'])
                self.assertNotIn('.controller.json', saved); groups.assert_not_called(); gid.assert_not_called(); uid.assert_not_called(); execute.assert_not_called()

        def test_bootstrap_primary_survives_retention_failure(self):
            ops = BootstrapOps(); ops.root = Path('/inert/root'); ops.owner = dict(snapshot={}, bootstrap=dict(uid=1001, gid=1002)); ops.invoker = dict(uid=1001, gid=1002)
            first = PermissionError(13, 'migration denied'); stderr = io.StringIO()
            with patch.object(os, 'getresuid', return_value=(1001,) * 3), patch.object(os, 'getresgid', return_value=(1002,) * 3), \
                 patch.object(os, 'getgroups', return_value=[]), patch(__name__ + '.write_new', side_effect=OSError('SECONDARY retention')), patch.object(sys, 'stderr', stderr):
                with self.assertRaises(PreservedFailure) as got: ops.retain(first)
            self.assertEqual(got.exception.firstFailure, error_row(first, 'bootstrap'))
            self.assertEqual(got.exception.secondary[0]['phase'], 'bootstrap-retention')

        def test_controller_wrapper_success_and_exact_child_primary(self):
            with self.wrapper_mocks() as (saved, _):
                self.assertEqual(run_all('inert'), 0)
                self.assertEqual(json.loads(saved['.controller.json'])['controllerFailure'],
                                 dict(firstFailure=None, secondary=[]))
            first = dict(phase='child-original', name='ValueError', message='FIRST child failure')
            with self.wrapper_mocks(child_primary=first) as (saved, _):
                self.assertEqual(run_all('inert'), 1)
                failures = json.loads(saved['.controller.json'])['controllerFailure']
                self.assertEqual(failures['firstFailure'], first)
                self.assertEqual(failures['secondary'][0]['message'], 'case failed: a')

        def test_controller_wrapper_retention_keeps_earliest_primary(self):
            first = dict(phase='child-original', name='ValueError', message='FIRST child failure')
            with self.wrapper_mocks(child_primary=first, writer_fault='process.json') as (saved, _):
                self.assertEqual(run_all('inert'), 1)
                failures = json.loads(saved['.controller.json'])['controllerFailure']
                self.assertEqual(failures['firstFailure'], first)
                self.assertIn('SECONDARY process.json retention', failures['secondary'][0]['message'])
            with self.wrapper_mocks(owner_error=True, writer_fault='.controller.json') as (_, stderr):
                with self.assertRaises(PreservedFailure) as raised:
                    run_all('inert')
                retained = json.loads(stderr.getvalue())
                self.assertEqual(retained['firstFailure'], dict(phase='controller', name='ValueError', message='FIRST owner read'))
                self.assertEqual(raised.exception.firstFailure, retained['firstFailure'])
                self.assertEqual(retained['secondary'][0]['phase'], 'controller-retention')
                self.assertLessEqual(len(stderr.getvalue()), 131072)

        def test_finalizer_resource_retention_preserves_controller_primary(self):
            first = dict(phase='child-original', name='ValueError', message='FIRST child failure')
            with self.wrapper_mocks(controller_primary=first, writer_fault='resources.json') as (_, stderr):
                with self.assertRaises(PreservedFailure) as raised:
                    finalize('inert')
                self.assertEqual(raised.exception.firstFailure, first)
                retained = json.loads(stderr.getvalue())
                self.assertEqual(retained['firstFailure'], first)
                self.assertEqual(retained['secondary'][0]['phase'], 'finalizer-retention')

        def test_four_cases(self):
            for case in CASES:
                fake = Fake(case); result = run_case(case, ['inert'], fake, 10**15)
                self.assertIsNone(result[0]['firstFailure']); self.assertEqual(result[0]['secondary'], [])
                self.assertTrue(fake.closed)

        def test_actual_body_primary_and_cleanup(self):
            fake = Fake('a', 'read'); result = run_case('a', ['inert'], fake, 10**15)
            self.assertEqual(result[0]['firstFailure']['message'], 'first read failure')
            self.assertEqual(result[0]['secondary'][0]['message'], 'secondary stop failure')
            self.assertTrue(fake.closed)

        def test_zero_write_and_deadline(self):
            for fault, end in [('write', 10**15), (None, 0)]:
                fake = Fake('a', fault); result = run_case('a', ['inert'], fake, end)
                self.assertIsNotNone(result[0]['firstFailure']); self.assertTrue(fake.closed)

        def test_semantic_negatives_use_actual_orchestration_body(self):
            for fault in ('no-ready', 'wrong-response', 'restore', 'nonzero', 'short-gap', 'missing-break', 'group-live'):
                fake = Fake('a', fault); result = run_case('a', ['inert'], fake, 10**15)
                self.assertIsNotNone(result[0]['firstFailure'], fault); self.assertTrue(fake.closed)

        def test_event_caps_are_enforced_before_append(self):
            for name, value in [('eventCount', 1), ('eventBytes', 2)]:
                original = CAPS[name]; CAPS[name] = value
                try:
                    result = run_case('a', ['inert'], Fake('a'), 10**15)
                    self.assertIsNotNone(result[0]['firstFailure'])
                    self.assertLessEqual(len(result[1]['events']), 1)
                finally:
                    CAPS[name] = original

        def test_renderer_utf8_crlf_and_truncation(self):
            rows = ['\u00ff' * 80] + [''] * 24
            frame = Fake('a').frame(rows).replace(b'\n', b'\r\n')
            self.assertEqual(decode_frame(frame, b'\r\n')[0], rows[0])
            self.assertEqual(parse_frames(frame[:-1], 0, b'\r\n'), (0, []))
            with self.assertRaises(ValueError):
                decode_frame(frame.replace(b'\xc3\xbf', b'x', 1), b'\n')
            short_row = Fake('a').frame([''] * 25).replace(b' ' * 80 + b'\n', b' ' * 79 + b'\n', 1)
            with self.assertRaises(ValueError):
                decode_frame(short_row, b'\n')

        def test_controller_timeout_cleanup_cannot_become_success(self):
            class MockCleanup:
                def __init__(self, occupied):
                    self.occupied = occupied; self.kills = 0

                def snapshot(self):
                    return dict(identity=dict(device=1, inode=2), procs=[100] if self.occupied else [],
                        raw=dict(cgroupEvents='populated 1\n' if self.occupied else 'populated 0\n',
                                 pidsCurrent='1\n' if self.occupied else '0\n'))

                def kill(self):
                    self.kills += 1; self.occupied = False

                def now(self):
                    return 0

                def pause(self):
                    raise AssertionError('no actual sleep in mock')

            clean = MockCleanup(False)
            before, result = external_cleanup(clean, dict(device=1, inode=2))
            self.assertEqual(clean.kills, 0); self.assertIsNone(result['firstFailure'])
            timeout = MockCleanup(True)
            before, result = external_cleanup(timeout, dict(device=1, inode=2))
            self.assertEqual(timeout.kills, 1); self.assertEqual(before['procs'], [100])
            self.assertIsNotNone(result['firstFailure']); self.assertEqual(result['after']['procs'], [])
            wrong = MockCleanup(True)
            with self.assertRaises(ValueError):
                external_cleanup(wrong, dict(device=1, inode=999))
            self.assertEqual(wrong.kills, 0)

        def test_retained_json_cap_is_on_actual_encoding(self):
            from unittest.mock import patch
            with patch(__name__ + '.write_new') as writer:
                with self.assertRaises(ValueError):
                    write_capped_json('inert', dict(value='x' * 20), 20)
                writer.assert_not_called()

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Controls))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    if sys.argv[1:] == ['--controls']:
        sys.exit(controls())
    if len(sys.argv) == 3 and sys.argv[1] == '--runtime' and sys.argv[2] in ('before', 'after'):
        node = str(Path(shutil.which('node')).resolve(strict=True))
        print('DOS_PACKAGE_RUNTIME_' + sys.argv[2].upper() + ' ' + json.dumps(runtime(node), sort_keys=True))
        sys.exit(0)
    if len(sys.argv) == 3 and sys.argv[1] in ('--run', '--finalize', '--admit-cgroup', '--bootstrap'):
        if sys.argv[1] == '--bootstrap':
            sys.exit(bootstrap(sys.argv[2]))
        if sys.argv[1] == '--admit-cgroup':
            admit_cgroup(sys.argv[2]); sys.exit(0)
        sys.exit(run_all(sys.argv[2]) if sys.argv[1] == '--run' else finalize(sys.argv[2]))
    raise SystemExit('usage: producer.py --controls | --admit-cgroup CGROUP | --run CGROUP | --bootstrap CGROUP | --finalize CGROUP')
