"""Source-only terminal frame boundary controls; no guest or PTY child."""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name('live-pty.py')
spec = importlib.util.spec_from_file_location('live_pty', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

frames = module.Frames()
frames.feed(b'noise\x1b[H\x1b[')
assert frames.ordinal == 0 and frames.text() == b''
frames.feed(b'2J386 AT\nPTY \x1b[32mREADY> \x1b[0m')
assert frames.ordinal == 1 and module.READY in frames.text()
frames.feed(b'\x1b[H\x1b[2JPTY READY> abc')
assert frames.ordinal == 2 and module.DONE not in frames.text()
frames.feed(b' PTY DONE')
assert module.DONE in frames.text()
frames.feed(b'\x1b[H\x1b[')
assert frames.ordinal == 2 and module.DONE in frames.text()
frames.feed(b'2JPTY READY> abc PTY DONE')
assert frames.ordinal == 3 and module.DONE in frames.text()

# A marker split across redraws is not a guest-visible single-frame response.
other = module.Frames()
other.feed(b'\x1b[H\x1b[2JPTY READY> abc\x1b[H\x1b[2J PTY DONE')
assert other.ordinal == 2 and module.DONE not in other.text()
assert module.READY not in other.text()
env = module.child_environment({'PATH': '/bin', 'AT_CONSOLE_EVENTS': '/invented',
    'AT_NATIVE_BLOCKS': '1', 'AT_HDD_CMOS_TYPE': '2', 'NODE_OPTIONS': '--require=something'},
    {'bios': '/bios', 'biosSha256': 'b', 'vga': '/vga', 'vgaSha256': 'v',
     'hdd': '/hdd', 'hddSha256': 'h'}, '/report')
assert set(key for key in env if key.startswith('AT_')) == {
    'AT_BIOS_ROM', 'AT_BIOS_SHA256', 'AT_HDD_IMAGE', 'AT_HDD_SHA256',
    'AT_CONSOLE_REPORT', 'AT_NATIVE_BLOCKS', 'AT_CODE16_WASM', 'AT_CODE16_LOADS'}
assert env['AT_NATIVE_BLOCKS'] == '0' and env['NODE_OPTIONS'] == ''
raw = module.ENTER_TERMINAL + module.FRAME + b'PTY READY> abc PTY DONE' + module.LEAVE_TERMINAL
assert module.terminal_lifecycle(raw) == {'setupOffset': 0,
    'cleanupOffset': len(module.ENTER_TERMINAL + module.FRAME + b'PTY READY> abc PTY DONE')}
for invalid in (raw.replace(module.LEAVE_TERMINAL, b''),
                raw + module.LEAVE_TERMINAL,
                module.LEAVE_TERMINAL + module.FRAME + module.ENTER_TERMINAL):
    try:
        module.terminal_lifecycle(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError('terminal cleanup adversary was accepted')
print('live PTY source controls PASS: split frames, redraw isolation, ambient AT role rejection and terminal lifecycle')
