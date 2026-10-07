"""Bounded real-PTY acceptance for the owned INT 10h/16h boot sector."""
import fcntl
import hashlib
import json
import os
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

FRAME = b'\x1b[H\x1b[2J'
CSI = re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]')
READY = b'PTY READY> '
DONE = b'PTY READY> abc PTY DONE'
MAX_OUTPUT = 16 * 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024
MAX_RSS = 1536 * 1024 * 1024


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(path):
    p = Path(path)
    require(p.is_absolute() and p.resolve() == p, 'canonical absolute path')
    return p


def visible(frame):
    """Only text inside one actual terminal redraw is a guest observation."""
    return CSI.sub(b'', frame).replace(b'\r', b'')


class Frames:
    def __init__(self):
        self.pending = b''
        self.current = None
        self.ordinal = 0

    def feed(self, data):
        self.pending += data
        while True:
            if self.current is None:
                at = self.pending.find(FRAME)
                if at < 0:
                    self.pending = self._marker_suffix(self.pending)
                    return
                self.pending = self.pending[at + len(FRAME):]
                self.current = b''
                self.ordinal += 1
            at = self.pending.find(FRAME)
            if at < 0:
                suffix = self._marker_suffix(self.pending)
                self.current += self.pending[:len(self.pending) - len(suffix)]
                self.pending = suffix
                return
            self.current += self.pending[:at]
            self.pending = self.pending[at + len(FRAME):]
            self.current = b''
            self.ordinal += 1

    @staticmethod
    def _marker_suffix(data):
        for length in range(len(FRAME) - 1, 0, -1):
            if data.endswith(FRAME[:length]):
                return data[-length:]
        return b''

    def text(self):
        return visible(self.current) if self.current is not None else b''


def flags(attrs):
    return {'iflag': attrs[0], 'oflag': attrs[1], 'cflag': attrs[2],
            'lflag': attrs[3], 'ispeed': attrs[4], 'ospeed': attrs[5],
            'cc': [bytes(x).hex() if isinstance(x, bytes) else x for x in attrs[6]]}


def group_alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False


def observed_rss(pid):
    try:
        for line in Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                return int(line.split()[1]) * 1024
    except FileNotFoundError:
        pass
    return 0


def child_environment(host, config, report_path):
    # Ambient AT_* roles can schedule synthetic keys or select a different CPU.
    env = {key: value for key, value in host.items() if not key.startswith('AT_')}
    env.update({'AT_BIOS_ROM': config['bios'], 'AT_BIOS_SHA256': config['biosSha256'],
                'VGA_BIOS_ROM': config['vga'], 'VGA_BIOS_SHA256': config['vgaSha256'],
                'AT_HDD_IMAGE': config['hdd'], 'AT_HDD_SHA256': config['hddSha256'],
                'AT_CONSOLE_REPORT': str(report_path), 'AT_NATIVE_BLOCKS': '0',
                'AT_CODE16_WASM': '0', 'AT_CODE16_LOADS': '0', 'NODE_OPTIONS': '',
                'NODE_PATH': '', 'LD_PRELOAD': '', 'LD_AUDIT': ''})
    return env


def run(config_path):
    config = json.loads(Path(config_path).read_text())
    require(set(config) == {'schema', 'sourceRoot', 'sourceHead', 'node', 'bios',
                           'biosSha256', 'vga', 'vgaSha256', 'hdd', 'hddSha256',
                           'geometry', 'output'}, 'exact input roles')
    require(config['schema'] == 'bw.i80386.cli-pty-input.v1', 'input schema')
    for role in ('sourceRoot', 'node', 'bios', 'vga', 'hdd', 'output'):
        config[role] = str(canonical(config[role]))
    require(config['geometry'] == '306,4,17', 'owned HDD geometry')
    require(config['hddSha256'] == 'a5245b3f5cb74761e87c372fd38f49cd0e21bf3e870708d1f427e994ba81cd9b',
            'exact owned HDD')
    for role in ('bios', 'vga', 'hdd'):
        require(sha(config[role]) == config[role + 'Sha256'], role + ' bytes')
    require(subprocess.check_output(['git', '-C', config['sourceRoot'], 'rev-parse', 'HEAD'],
                                    text=True, timeout=10).strip() == config['sourceHead'], 'source head')
    require(not subprocess.check_output(['git', '-C', config['sourceRoot'], 'status', '--porcelain'],
                                        text=True, timeout=10).strip(), 'clean source')
    output = Path(config['output'])
    output.mkdir(mode=0o700)
    report_path = output / 'console-report.json'
    transcript_path = output / 'transcript.bin'
    command = [config['node'], str(Path(config['sourceRoot']) / 'scripts/run-i80386-at-console.mjs'),
               '--hdd-image', config['hdd'], '--geometry', config['geometry'],
               '--steps', '20000000', '--live']
    env = child_environment(os.environ, config, report_path)
    (output / 'invocation.json').write_text(json.dumps({'argv': command, 'cwd': config['sourceRoot'],
        'sourceHead': config['sourceHead'], 'biosSha256': config['biosSha256'],
        'vgaSha256': config['vgaSha256'], 'hddSha256': config['hddSha256'],
        'wallLimitSeconds': 120, 'stepLimit': 20000000, 'outputLimitBytes': MAX_OUTPUT,
        'rssLimitBytes': MAX_RSS}, indent=2) + '\n')
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 100, 0, 0))
    before = termios.tcgetattr(slave)
    process = None
    phase = 'await-ready'
    ready_ordinal = done_ordinal = redraw_ordinal = None
    frame = Frames()
    raw = bytearray()
    error = None
    peak_rss = 0
    started = time.monotonic()
    try:
        process = subprocess.Popen(command, cwd=config['sourceRoot'], env=env,
                                   stdin=slave, stdout=slave, stderr=slave,
                                   start_new_session=True, close_fds=True)
        while True:
            require(time.monotonic() - started <= 120, 'PTY wall limit')
            require(len(raw) <= MAX_OUTPUT, 'PTY output limit')
            peak_rss = max(peak_rss, observed_rss(process.pid))
            require(peak_rss <= MAX_RSS, 'PTY RSS limit')
            readable, _, _ = select.select([master], [], [], 0.05)
            eof = False
            if readable:
                try:
                    data = os.read(master, 65536)
                except OSError as exc:
                    if exc.errno != 5:  # Linux PTY EIO after the slave closes.
                        raise
                    data = b''
                eof = not data
                raw.extend(data)
                require(len(raw) <= MAX_OUTPUT, 'PTY output limit')
                frame.feed(data)
                shown = frame.text()
                if phase == 'await-ready' and READY in shown:
                    ready_ordinal = frame.ordinal
                    os.write(master, b'abc')
                    phase = 'await-done'
                elif phase == 'await-done' and DONE in shown and frame.ordinal > ready_ordinal:
                    done_ordinal = frame.ordinal
                    os.write(master, b'\x0c')
                    phase = 'await-redraw'
                elif phase == 'await-redraw' and DONE in shown and frame.ordinal > done_ordinal:
                    redraw_ordinal = frame.ordinal
                    os.write(master, b'\x1d')
                    phase = 'await-exit'
            if process.poll() is not None:
                # Drain any terminal bytes already queued at process exit.
                if not readable or eof:
                    break
        require(process.returncode == 0, 'CLI exit status')
        require(not group_alive(process.pid), 'CLI process group closed')
        require(phase == 'await-exit', 'READY, guest echo, redraw and quit sequence')
        require(report_path.is_file() and report_path.stat().st_size <= MAX_REPORT,
                'bounded console report')
        report = json.loads(report_path.read_text())
        require(report['schema'] == 'bw.i80386-at-console.v1' and
                report['executionRevision'] == config['sourceHead'], 'console source')
        require(report['inputs']['bios'] == config['biosSha256'] and
                report['inputs']['vga'] == config['vgaSha256'] and
                report['inputs']['hdd'] == config['hddSha256'] and
                report['inputs']['geometry'] == [306, 4, 17] and
                report['inputs']['events'] == hashlib.sha256(b'[]').hexdigest() and
                report['inputs']['nativeBlocks'] is False and
                report['inputs']['code16Wasm'] is False, 'console media and empty scheduled events')
        require(report['stop'] == 'user-quit' and 0 < report['steps'] <= 20000000,
                'clean user quit')
        require(all(e.get('type') == 'live-key' and e.get('accepted') is True
                    for e in report['delivered']), 'only accepted live PTY keys')
        keys = [e['code'] for e in report['delivered']]
        require(keys == [30, 158, 48, 176, 46, 174], 'exact accepted Set-1 make/break')
        require(any(DONE.decode() in line for line in report['textRam']), 'guest final VGA text')
        after = termios.tcgetattr(slave)
        require(flags(after) == flags(before), 'terminal attributes restored')
        transcript_path.write_bytes(raw)
        result = {'schema': 'bw.i80386.cli-pty-result.v1', 'status': 'PASS',
                  'sourceHead': config['sourceHead'], 'biosSha256': config['biosSha256'],
                  'vgaSha256': config['vgaSha256'], 'hddSha256': config['hddSha256'],
                  'readyFrame': ready_ordinal, 'doneFrame': done_ordinal,
                  'redrawFrame': redraw_ordinal, 'acceptedKeys': keys,
                  'reportSha256': sha(report_path), 'transcriptSha256': hashlib.sha256(raw).hexdigest(),
                  'transcriptBytes': len(raw), 'terminalBefore': flags(before),
                  'terminalAfter': flags(after), 'peakObservedRssBytes': peak_rss,
                  'processGroupEmptyAfterExit': True, 'steps': report['steps'], 'stop': report['stop']}
        (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        return result
    except Exception as exc:
        error = exc
        raise
    finally:
        if process is not None:
            if group_alive(process.pid):
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.wait(timeout=5)
        after = termios.tcgetattr(slave)
        if not transcript_path.exists():
            transcript_path.write_bytes(raw)
        if error is not None:
            failure = {'schema': 'bw.i80386.cli-pty-failure.v1', 'phase': phase,
                       'error': str(error), 'exitCode': process.returncode if process else None,
                       'readyFrame': ready_ordinal, 'doneFrame': done_ordinal,
                       'redrawFrame': redraw_ordinal, 'transcriptBytes': len(raw),
                       'transcriptSha256': hashlib.sha256(raw).hexdigest(),
                       'peakObservedRssBytes': peak_rss,
                       'terminalBefore': flags(before), 'terminalAfter': flags(after)}
            (output / 'failure.json').write_text(json.dumps(failure, indent=2) + '\n')
        os.close(master)
        os.close(slave)


if __name__ == '__main__':
    require(len(sys.argv) == 2, 'usage: live-pty.py input.json')
    print(json.dumps(run(sys.argv[1]), sort_keys=True))
