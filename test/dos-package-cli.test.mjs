import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {parseDosPackageArguments, prepareDosPackage, executeDosPackage,
  configureDosPackageProfile, readBoundedDosPackageFile, main} from '../scripts/run-dos-package.mjs';
import {dosPackageCrc32} from '../scripts/lib/dos-package-zip.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const config = '[autoexec]\nimgmount 2 disks/boot.img -t hdd -size 512,1,1,1\nboot -l c\n';
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(value), crc = dosPackageCrc32(bytes);
    const local = Buffer.alloc(30 + filename.length + bytes.length), central = Buffer.alloc(46 + filename.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30); bytes.copy(local, 30 + filename.length);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42); filename.copy(central, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-package-pure-'));
  const archive = path.join(dir, 'authored.zip'), bios = path.join(dir, 'bios.bin'), vga = path.join(dir, 'vga.bin');
  fs.writeFileSync(archive, zip([['pkg/dosbox.conf', config], ['pkg/disks/boot.img', new Uint8Array(512)]]));
  fs.writeFileSync(bios, Buffer.alloc(65536, 1)); fs.writeFileSync(vga, Buffer.alloc(16384, 2));
  const args = ['--package', archive, '--bios', bios, '--bios-sha256', sha(fs.readFileSync(bios)),
    '--vga', vga, '--vga-sha256', sha(fs.readFileSync(vga)), '--steps', '2'];
  return {dir, archive, bios, args, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const baseProfile = {a20: {mouse: true}, regions: [{kind: 'rom', start: 0xc0000, end: 0xc9fff}],
  chips: [{kind: 'rtc', initialCmos: [[0x14, 5], [0x2f, 3]]}]};
function mocks({failStep = null, rejectKeys = 0, failConstructor = false, failSnapshot = false} = {}) {
  let instance = null, loads = 0;
  class MockMachine {
    constructor(profile, hooks) {
      if (failConstructor) throw new Error('mock constructor refused');
      instance = this; this.profile = profile; this.hooks = hooks;
      this.cpu = {shutdown: false, cs: 0xf000, eip: 0xfff0, cr0: 0};
      this.vgaMemory = {planes: [new Uint8Array(8000)]}; this.roms = []; this.steps = 0; this.keys = [];
    }
    loadRom(...args) { this.roms.push(args); }
    reset() { this.wasReset = true; }
    step() { if (this.steps === failStep) throw new Error('mock step refused'); this.steps++; }
    keyIn(code) { this.keys.push({step: this.steps, code}); return this.keys.length > rejectKeys; }
    _read() { if (failSnapshot) throw new Error('mock snapshot refused'); return 0; }
  }
  return {loadMachine: async () => { loads++; return {Machine: MockMachine, profile: baseProfile}; },
    get instance() { return instance; }, get loads() { return loads; }};
}
class Terminal extends EventEmitter {
  constructor(flowing = false) {
    super(); this.isTTY = true; this.isRaw = false; this.readableFlowing = flowing;
    this.paused = flowing === false; this.activeRead = flowing === true;
    this.output = ''; this.rawCalls = []; this.pauseCalls = 0; this.resumeCalls = 0;
  }
  setRawMode(value) { this.rawCalls.push(value); this.isRaw = value; }
  isPaused() { return this.paused; }
  resume() { this.resumeCalls++; this.paused = false; this.readableFlowing = true; this.activeRead = true; }
  pause() { this.pauseCalls++; this.paused = true; this.readableFlowing = false; this.activeRead = false; }
  write(value) { this.output += value; }
}

test('CLI validates explicit paths/hash/budgets and rejects extra switches', () => {
  assert.deepEqual(parseDosPackageArguments(['--help']), {help: true});
  const f = fixture();
  try {
    assert.equal(parseDosPackageArguments(f.args).steps, 2);
    for (const tail of [['--steps', '2'], ['--bad'], ['--config'], ['--steps', '0'], ['--wall-ms', '600001']])
      assert.throws(() => parseDosPackageArguments([...f.args, ...tail]));
    assert.throws(() => parseDosPackageArguments(f.args.map(value => value === '2' ? '120000001' : value)));
    assert.throws(() => parseDosPackageArguments(['--package', 'a']));
  } finally { f.cleanup(); }
});

test('package and pinned ROM preflight precedes any machine loader call', async () => {
  const f = fixture(), mock = mocks(), output = new Terminal();
  try {
    fs.writeFileSync(f.archive, 'bad');
    await assert.rejects(main(f.args, {loadMachine: mock.loadMachine, output}));
    assert.equal(mock.loads, 0);
    fs.writeFileSync(f.archive, zip([['pkg/dosbox.conf', config], ['pkg/disks/boot.img', new Uint8Array(512)]]));
    fs.writeFileSync(f.bios, Buffer.alloc(65536));
    await assert.rejects(main(f.args, {loadMachine: mock.loadMachine, output}), /SHA-256/);
    assert.equal(mock.loads, 0);
    fs.writeFileSync(f.bios, Buffer.alloc(65537));
    assert.throws(() => prepareDosPackage(parseDosPackageArguments(f.args)), /bounded/);
  } finally { f.cleanup(); }
});

test('file admission opens nonblocking before type validation and preserves read error over close error', t => {
  let flags = 0, closes = 0;
  t.mock.method(fs, 'openSync', (_path, value) => { flags = value; return 123; });
  t.mock.method(fs, 'fstatSync', () => ({isFile: () => false, size: 0}));
  t.mock.method(fs, 'closeSync', () => { closes++; throw new Error('mock close refused'); });
  assert.throws(() => readBoundedDosPackageFile('mock-input', 100), /bounded regular/);
  assert.equal(closes, 1); assert.ok(flags & fs.constants.O_NONBLOCK); assert.ok(flags & fs.constants.O_NOFOLLOW);
});

test('main connects admitted in-memory bytes to actual interface calls without extraction or feature env', async () => {
  const f = fixture(), mock = mocks(), output = new Terminal();
  try {
    assert.equal(await main(f.args, {loadMachine: mock.loadMachine, output}), 0);
    const report = JSON.parse(output.output), machine = mock.instance;
    assert.equal(mock.loads, 1); assert.equal(machine.steps, 2); assert.ok(machine.wasReset);
    assert.equal(machine.roms.length, 3); assert.equal(machine.roms[0][1], 0xf0000);
    assert.equal(machine.roms[1].length, 1); assert.equal(machine.roms[2][1], 0xc0000);
    assert.equal(machine.hooks.ataImage.length, 512);
    assert.deepEqual(machine.hooks.ataGeometry, {cylinders: 1, heads: 1, sectors: 1});
    assert.equal(machine.profile.a20.mouse, false);
    assert.equal(report.schema, 'bw.dos-package-run.v1'); assert.equal(report.steps, 2);
    assert.equal(report.media.path, 'pkg/disks/boot.img');
    assert.equal(report.media.sha256, sha(new Uint8Array(512)));
    assert.equal(report.guestCompletionQualified, false); assert.equal(report.stop, 'budget');
    assert.deepEqual(fs.readdirSync(f.dir).sort(), ['authored.zip', 'bios.bin', 'vga.bin']);
  } finally { f.cleanup(); }
});

test('firmware and image accessors return independent bytes preserving admitted hashes', () => {
  const f = fixture();
  try {
    const prepared = prepareDosPackage(parseDosPackageArguments(f.args));
    for (const [read, digest] of [[prepared.readBios, prepared.biosSha256],
      [prepared.readVga, prepared.vgaSha256], [prepared.selected.readImage, prepared.hddSha256]]) {
      const first = read(), original = first[0]; first[0] ^= 255;
      const second = read();
      assert.equal(second[0], original); assert.equal(sha(second), digest);
      assert.notEqual(sha(first), digest);
    }
  } finally { f.cleanup(); }
});

test('CMOS and VGA profile copy preserves base and matches exact user CHS', () => {
  const before = structuredClone(baseProfile);
  const profile = configureDosPackageProfile(baseProfile, {cylinders: 306, heads: 4, sectors: 17}, 65536);
  assert.deepEqual(baseProfile, before); assert.equal(profile.regions[0].end, 0xcffff);
  const cmos = new Map(profile.chips[0].initialCmos);
  assert.equal(cmos.get(0x19), 47); assert.equal(cmos.get(0x1b), 50); assert.equal(cmos.get(0x1c), 1);
  assert.equal(cmos.get(0x1d), 4); assert.equal(cmos.get(0x23), 17);
  let sum = 0; for (let i = 0x10; i <= 0x2d; i++) sum = (sum + (cmos.get(i) ?? 0)) & 65535;
  assert.equal((cmos.get(0x2e) ?? 0) * 256 + (cmos.get(0x2f) ?? 0), sum);
});

test('live input yields, retries refused scans each1024 and paces accepted scans by65536', async () => {
  const f = fixture(), mock = mocks({rejectKeys: 2}), input = new Terminal(), output = new Terminal(), signals = new EventEmitter();
  try {
    const prepared = prepareDosPackage(parseDosPackageArguments(f.args)); let turns = 0;
    const report = await executeDosPackage(prepared, {steps: 80000, wallMs: 600000, live: true}, {
      loadMachine: mock.loadMachine, input, output, signals, now: () => 0,
      yieldTurn: async () => { if (++turns === 1) input.emit('data', Buffer.from('a')); },
    });
    assert.deepEqual(mock.instance.keys, [{step: 8192, code: 30}, {step: 9216, code: 30},
      {step: 10240, code: 30}, {step: 75776, code: 158}]);
    assert.deepEqual(report.input.delivered, [{step: 10240, code: 30}, {step: 75776, code: 158}]);
    assert.deepEqual(input.rawCalls, [true, false]); assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0); assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.ok(output.output.includes('\x1b[?25h\x1b[?1049l'));
  } finally { f.cleanup(); }
});

test('live failure, interrupt and queue overflow restore terminal and preserve refusal', async () => {
  const f = fixture();
  try {
    const prepared = prepareDosPackage(parseDosPackageArguments(f.args));
    for (const kind of ['step', 'interrupt', 'overflow', 'quit']) {
      const mock = mocks({failStep: kind === 'step' ? 3 : null}), input = new Terminal(), output = new Terminal(), signals = new EventEmitter();
      const report = await executeDosPackage(prepared, {steps: 100000, wallMs: 600000, live: true}, {
        loadMachine: mock.loadMachine, input, output, signals, now: () => 0,
        yieldTurn: async () => {
          if (kind === 'interrupt') signals.emit('SIGINT');
          if (kind === 'overflow') input.emit('data', Buffer.from('a'.repeat(3000)));
          if (kind === 'quit') input.emit('data', Buffer.from([29]));
        },
      });
      assert.equal(report.stop, {step: 'refused', interrupt: 'interrupted', overflow: 'refused', quit: 'user-quit'}[kind]);
      if (kind === 'step') assert.match(report.refused.message, /mock step/);
      assert.equal(input.isRaw, false); assert.equal(input.paused, true); assert.equal(input.listenerCount('data'), 0);
      assert.equal(signals.listenerCount('SIGTERM'), 0); assert.ok(output.output.endsWith('\x1b[?1049l'));
    }
  } finally { f.cleanup(); }
});

test('cleanup releases its own fresh TTY read and preserves a preexisting flowing reader', async () => {
  const f = fixture();
  try {
    const prepared = prepareDosPackage(parseDosPackageArguments(f.args));
    for (const flowing of [null, false, true]) for (const exit of ['budget', 'error', 'interrupt']) {
      const input = new Terminal(flowing), output = new Terminal(), signals = new EventEmitter();
      const mock = mocks({failStep: exit === 'error' ? 3 : null});
      let otherReads = 0; const otherReader = () => { otherReads++; };
      if (flowing === true) input.on('data', otherReader);
      // Fresh Node TTYs have no established flow, despite isPaused() being false.
      assert.equal(input.isPaused(), flowing === false);
      const report = await executeDosPackage(prepared, {steps: 16384, wallMs: 100, live: true}, {
        loadMachine: mock.loadMachine, input, output, signals, now: () => 0,
        yieldTurn: async () => { if (exit === 'interrupt') signals.emit('SIGINT'); }
      });
      assert.equal(report.stop, {budget: 'budget', error: 'refused', interrupt: 'interrupted'}[exit]);
      assert.equal(report.refused?.message ?? null, exit === 'error' ? 'mock step refused' : null);
      assert.equal(report.terminal.restorationComplete, true);
      assert.equal(input.resumeCalls, 1);
      assert.equal(input.pauseCalls, flowing === true ? 0 : 1, `${String(flowing)}/${exit}: release owned read`);
      assert.equal(input.activeRead, flowing === true, `${String(flowing)}/${exit}: active stdin read remains`);
      assert.equal(input.isPaused(), flowing !== true);
      assert.equal(input.listenerCount('data'), flowing === true ? 1 : 0);
      assert.equal(signals.listenerCount('SIGINT'), 0); assert.equal(signals.listenerCount('SIGTERM'), 0);
      assert.equal(input.isRaw, false);
      if (flowing === true) {
        input.emit('data', Buffer.from('z')); assert.equal(otherReads, 1);
        assert.equal(input.listeners('data')[0], otherReader);
      }
    }
  } finally { f.cleanup(); }
});

test('fresh input pause failure remains secondary to guest failure while other terminal cleanup completes', async () => {
  const f = fixture(), input = new Terminal(null), output = new Terminal();
  try {
    input.pause = () => { input.pauseCalls++; throw new Error('mock input pause refused'); };
    const report = await executeDosPackage(prepareDosPackage(parseDosPackageArguments(f.args)),
      {steps: 8192, wallMs: 100, live: true}, {loadMachine: mocks({failStep: 3}).loadMachine,
        input, output, signals: new EventEmitter(), now: () => 0, yieldTurn: async () => {}});
    assert.equal(report.refused.message, 'mock step refused');
    assert.deepEqual(report.secondaryErrors, [{phase: 'terminal-cleanup', name: 'Error', message: 'mock input pause refused'}]);
    assert.equal(report.terminal.restorationComplete, false); assert.equal(input.pauseCalls, 1);
    assert.equal(input.isRaw, false); assert.equal(input.listenerCount('data'), 0);
    assert.ok(output.output.endsWith('\x1b[?1004l\x1b[?25h\x1b[?1049l'));
  } finally { f.cleanup(); }
});

test('initial focus-in and uppercase remain live; ordered focus loss refuses mixed and split input', async () => {
  const f = fixture();
  try {
    const prepared = prepareDosPackage(parseDosPackageArguments(f.args));
    for (const kind of ['initial-in', 'mixed-loss', 'split-loss', 'shift-then-loss']) {
      const mock = mocks(), input = new Terminal(), output = new Terminal(); let turn = 0;
      const report = await executeDosPackage(prepared, {steps: 210000, wallMs: 600000, live: true}, {
        loadMachine: mock.loadMachine, input, output, signals: new EventEmitter(), now: () => 0,
        yieldTurn: async () => {
          turn++;
          if (kind === 'initial-in' && turn === 1) input.emit('data', Buffer.from('\x1b[IA'));
          if (kind === 'mixed-loss' && turn === 1) input.emit('data', Buffer.from('\x1b[OA\x1b[I'));
          if (kind === 'split-loss' && turn === 1) input.emit('data', Buffer.from('\x1b['));
          if (kind === 'split-loss' && turn === 2) input.emit('data', Buffer.from('OA\x1b[I'));
          if (kind === 'shift-then-loss' && turn === 1) input.emit('data', Buffer.from('A'));
          if (kind === 'shift-then-loss' && turn === 2) input.emit('data', Buffer.from('\x1b[O'));
          if (turn >= 3 && kind !== 'initial-in') input.emit('data', Buffer.from('\x1b[Ia'));
        },
      });
      if (kind === 'initial-in') {
        assert.equal(report.stop, 'budget'); assert.equal(report.refused, null);
        assert.deepEqual(report.input.delivered.map(event => event.code), [42, 30, 158, 170]);
      } else {
        assert.equal(report.stop, 'refused'); assert.match(report.refused.message, /focus loss/);
        assert.equal(report.refused.phase, 'terminal-input');
        assert.deepEqual(report.input.delivered.map(event => event.code), kind === 'shift-then-loss' ? [42] : []);
        assert.equal(report.guestCompletionQualified, false);
        assert.equal(report.terminal.restorationComplete, true);
      }
      assert.equal(input.isRaw, false); assert.equal(input.listenerCount('data'), 0);
    }
  } finally { f.cleanup(); }
});

test('constructor refusal and wall budget cannot claim completion; reports never overwrite', async () => {
  const f = fixture();
  try {
    const options = parseDosPackageArguments(f.args), prepared = prepareDosPackage(options), mock = mocks({failConstructor: true});
    const report = await executeDosPackage(prepared, options, {loadMachine: mock.loadMachine});
    assert.equal(report.stop, 'refused'); assert.equal(report.steps, 0); assert.equal(report.guestCompletionQualified, false);
    const normal = mocks(); let clock = 0;
    const wall = await executeDosPackage(prepared, options, {loadMachine: normal.loadMachine, now: () => clock++ * 600001});
    assert.equal(wall.stop, 'wall-budget'); assert.equal(wall.steps, 0);
    const output = path.join(f.dir, 'report.json'); fs.writeFileSync(output, 'retain');
    await assert.rejects(main([...f.args, '--report', output], {loadMachine: normal.loadMachine}), /EEXIST/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'retain');
  } finally { f.cleanup(); }
});

test('snapshot, cleanup and report-retention errors preserve the original execution refusal', async () => {
  const f = fixture();
  try {
    const options = parseDosPackageArguments(f.args), prepared = prepareDosPackage(options);
    const mock = mocks({failStep: 3, failSnapshot: true}), input = new Terminal(), output = new Terminal();
    const originalSetRaw = input.setRawMode.bind(input);
    input.setRawMode = value => { if (!value) throw new Error('mock restore refused'); originalSetRaw(value); };
    const report = await executeDosPackage(prepared, {...options, steps: 5, live: true}, {
      loadMachine: mock.loadMachine, input, output, signals: new EventEmitter(), now: () => 0,
    });
    assert.match(report.refused.message, /mock step/);
    assert.equal(report.refused.phase, 'execution'); assert.equal(report.snapshotComplete, false);
    assert.equal(report.terminal.restorationComplete, false);
    assert.deepEqual(report.secondaryErrors.map(error => error.phase), ['terminal-cleanup', 'final-snapshot']);
    assert.ok(output.output.endsWith('\x1b[?1049l'));

    const filename = path.join(f.dir, 'preserved.json'); fs.writeFileSync(filename, 'retain');
    const failed = mocks({failStep: 0}), fallback = new Terminal();
    assert.equal(await main([...f.args, '--report', filename], {loadMachine: failed.loadMachine, output: fallback}), 1);
    const retained = JSON.parse(fallback.output);
    assert.match(retained.refused.message, /mock step/);
    assert.equal(retained.secondaryErrors[0].phase, 'report-retention');
    assert.equal(fs.readFileSync(filename, 'utf8'), 'retain');
    const brokenOutput = {write() { throw new Error('mock report output refused'); }};
    await assert.rejects(main([...f.args, '--report', filename], {loadMachine: failed.loadMachine, output: brokenOutput}), error => {
      assert.match(error.message, /mock step/);
      assert.deepEqual(error.report.secondaryErrors.map(entry => entry.phase), ['report-retention', 'report-output']);
      return true;
    });
  } finally { f.cleanup(); }
});
