#!/usr/bin/env node
// MIT. Bounded STORED package -> in-memory ordinary functional 386 AT.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DOS_PACKAGE_LIMITS, selectDosPackage} from '../src/dos-package-policy.js';
import {readDosPackageZip} from './lib/dos-package-zip.mjs';
import {ansiTextFrame, decodeTerminalInput, flushTerminalEscape,
  makeTerminalInputState} from './lib/i80386-at-terminal.mjs';

export const DOS_PACKAGE_RUN_LIMITS = Object.freeze({steps: 120_000_000, wallMs: 600_000,
  chunkSteps: 8192, inputBytes: 65536, queuedScanBytes: 4096, deliveredScanBytes: 65536,
  serialBytes: 65536, liveScanStepGap: 65536, serviceStepGap: 1024});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const usage = 'usage: run-dos-package.mjs --package FILE [--config ARCHIVE/PATH] --bios FILE --bios-sha256 SHA256 --vga FILE --vga-sha256 SHA256 [--steps N] [--wall-ms N] [--live] [--report NEW_FILE]\n';

export function parseDosPackageArguments(argv) {
  const options = {steps: 50_000_000, wallMs: DOS_PACKAGE_RUN_LIMITS.wallMs, live: false};
  const names = {'--package': 'package', '--config': 'config', '--bios': 'bios',
    '--bios-sha256': 'biosSha256', '--vga': 'vga', '--vga-sha256': 'vgaSha256',
    '--steps': 'steps', '--wall-ms': 'wallMs', '--report': 'report'};
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error('duplicate CLI option');
    seen.add(arg);
    if (arg === '--help' && argv.length === 1) return {help: true};
    if (arg === '--live') { options.live = true; continue; }
    if (!names[arg] || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new Error('unknown CLI option or missing value');
    options[names[arg]] = argv[++i];
  }
  for (const key of ['package', 'bios', 'biosSha256', 'vga', 'vgaSha256'])
    if (!options[key]) throw new Error('package and pinned BIOS/VGA arguments are required');
  for (const [key, limit] of [['steps', DOS_PACKAGE_RUN_LIMITS.steps], ['wallMs', DOS_PACKAGE_RUN_LIMITS.wallMs]]) {
    if (!/^[1-9][0-9]*$/.test(String(options[key])) || Number(options[key]) > limit)
      throw new Error('CLI execution budget exceeds bounds');
    options[key] = Number(options[key]);
  }
  for (const key of ['biosSha256', 'vgaSha256']) {
    if (!/^[0-9a-f]{64}$/i.test(options[key])) throw new Error('ROM SHA-256 must be explicit');
    options[key] = options[key].toLowerCase();
  }
  return Object.freeze(options);
}

export function readBoundedDosPackageFile(path, maximum, minimum = 1) {
  let fd = null, primary = null, bytes = null;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < minimum || stat.size > maximum)
      throw new Error('input must be a bounded regular file');
    bytes = Buffer.alloc(stat.size); let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0 || count > bytes.length - offset) throw new Error('input read made invalid progress');
      offset += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) !== 0 || fs.fstatSync(fd).size !== stat.size)
      throw new Error('input extent changed during read');
  } catch (error) { primary = error; }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch (error) { primary ??= error; } }
  if (primary) throw primary;
  return bytes;
}

export function prepareDosPackage(options) {
  const zip = readBoundedDosPackageFile(options.package, DOS_PACKAGE_LIMITS.archiveBytes, 22);
  const archive = readDosPackageZip(zip), selected = selectDosPackage(archive, options.config ?? null);
  const bios = readBoundedDosPackageFile(options.bios, 65536, 65536);
  const vga = readBoundedDosPackageFile(options.vga, 65536, 16384);
  if (sha(bios) !== options.biosSha256 || sha(vga) !== options.vgaSha256)
    throw new Error('external ROM bytes do not match explicit SHA-256');
  return Object.freeze({selected, packageSha256: sha(zip), configSha256: sha(Buffer.from(selected.configText)),
    biosSha256: sha(bios), vgaSha256: sha(vga), hddSha256: sha(selected.readImage()),
    readBios: () => Buffer.from(bios), readVga: () => Buffer.from(vga)});
}

export function configureDosPackageProfile(baseProfile, geometry, vgaBytes) {
  const profile = structuredClone(baseProfile), {cylinders, heads, sectors} = geometry;
  profile.a20.mouse = false;
  profile.regions = profile.regions.map(region => region.kind === 'rom' && region.start === 0xc0000 ?
    {...region, end: 0xc0000 + Math.ceil(vgaBytes / 4096) * 4096 - 1} : region);
  const rtc = profile.chips.find(chip => chip.kind === 'rtc'), cmos = new Uint8Array(64);
  for (const [index, value] of rtc.initialCmos) cmos[index] = value;
  cmos[0x10] = 0x20; cmos[0x12] = 0xf0; cmos[0x14] = 1; cmos[0x3d] = 0x21;
  cmos[0x19] = 47; cmos[0x1b] = cylinders & 255; cmos[0x1c] = cylinders >>> 8;
  cmos[0x1d] = heads; cmos[0x1e] = 255; cmos[0x1f] = 255; cmos[0x20] = 0xc0;
  cmos[0x21] = cylinders & 255; cmos[0x22] = cylinders >>> 8; cmos[0x23] = sectors;
  let checksum = 0;
  for (let i = 0x10; i <= 0x2d; i++) checksum = (checksum + cmos[i]) & 65535;
  cmos[0x2e] = checksum >>> 8; cmos[0x2f] = checksum & 255;
  rtc.initialCmos = [...cmos.entries()].filter(([, value]) => value !== 0);
  return profile;
}

const loadDefaultMachine = async () => {
  const module = await import('../src/experimental/i80386-at-machine.js');
  return {Machine: module.default, profile: module.PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA};
};
const textRows = machine => {
  const columns = Math.max(1, Math.min(160, (machine._read(0x44a) | machine._read(0x44b) << 8) || 80));
  return Array.from({length: 25}, (_, row) => Array.from({length: columns}, (_, col) =>
    String.fromCharCode(machine.vgaMemory.planes[0][(row * columns + col) * 2] || 32)).join('').trimEnd());
};

/** Injection is for pure boundary controls. The default imports a real machine
 * only here, after package/ROM preflight. No subprocess, shell or file extraction.
 */
export async function executeDosPackage(prepared, options, dependencies = {}) {
  const input = dependencies.input ?? process.stdin, output = dependencies.output ?? process.stdout;
  const signals = dependencies.signals ?? process;
  const now = dependencies.now ?? (() => performance.now());
  const yieldTurn = dependencies.yieldTurn ?? (() => new Promise(resolve => setImmediate(resolve)));
  if (options.live && (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function'))
    throw new Error('live package console requires a raw-capable input and output terminal');
  const {Machine, profile: baseProfile} = await (dependencies.loadMachine ?? loadDefaultMachine)();
  const image = prepared.selected.readImage(), bios = prepared.readBios(), vga = prepared.readVga();
  const profile = configureDosPackageProfile(baseProfile, prepared.selected.geometry, vga.length);
  const serial = [], delivered = [], queue = [], state = makeTerminalInputState();
  let machine = null, steps = 0, nextScan = 0, inputBytes = 0, quit = false, interrupted = false;
  let primary = null, stop = 'budget', lastDraw = -Infinity, lastInput = 0, terminalStarted = false;
  let originalRaw = false, pauseInputOnCleanup = true, serialOverflow = false;
  let primaryPhase = null, restorationComplete = null;
  const secondaryErrors = [];
  const recordFailure = (error, phase) => {
    if (primary === null) { primary = error; primaryPhase = phase; }
    else secondaryErrors.push({phase, name: error.name, message: error.message});
  };
  const started = now();
  const onData = chunk => {
    if (primary || quit || interrupted) return;
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'latin1');
      inputBytes += bytes.length;
      if (inputBytes > DOS_PACKAGE_RUN_LIMITS.inputBytes) throw new Error('terminal input byte cap exceeded');
      lastInput = now();
      // Preserve event order even when blur, keys and focus-in share a chunk.
      // The held decoder retains partial CSI sequences across these bytes.
      for (const byte of bytes) {
        const decoded = decodeTerminalInput(state, String.fromCharCode(byte));
        if (decoded.focusChanged === false)
          throw new Error('terminal focus loss ends this bounded package session');
        queue.push(...decoded.scan);
        if (queue.length > DOS_PACKAGE_RUN_LIMITS.queuedScanBytes) throw new Error('terminal scan queue cap exceeded');
        if (decoded.quit) { quit = true; return; }
      }
    } catch (error) { recordFailure(error, 'terminal-input'); }
  };
  const onInterrupt = () => { interrupted = true; };
  const draw = () => {
    if (now() - lastDraw < 250) return;
    lastDraw = now();
    output.write('\x1b[H' + ansiTextFrame(textRows(machine), 80, 25) + '\nCtrl-] quits; text VGA only.\n');
  };
  try {
    machine = new Machine(profile, {ataImage: image, ataGeometry: {...prepared.selected.geometry},
      onSerial(byte) {
        if (serial.length < DOS_PACKAGE_RUN_LIMITS.serialBytes) serial.push(byte & 255);
        else serialOverflow = true;
      }});
    machine.loadRom(bios, 0xf0000); machine.loadRom(bios); machine.loadRom(vga, 0xc0000); machine.reset();
    if (options.live) {
      originalRaw = input.isRaw === true;
      // A fresh TTY has readableFlowing=null while isPaused() is false.
      // Release the read we start unless input was already flowing for its caller.
      pauseInputOnCleanup = input.isPaused() || input.readableFlowing !== true; terminalStarted = true;
      input.setRawMode(true); input.on('data', onData); input.resume();
      signals.on('SIGINT', onInterrupt); signals.on('SIGTERM', onInterrupt);
      output.write('\x1b[?1049h\x1b[?25l\x1b[?1004h');
    }
    while (steps < options.steps && !primary && !quit && !interrupted) {
      if (now() - started >= options.wallMs) { stop = 'wall-budget'; break; }
      const end = Math.min(options.steps, steps + DOS_PACKAGE_RUN_LIMITS.chunkSteps);
      while (steps < end && !primary && !quit && !interrupted) {
        if (options.live && steps % DOS_PACKAGE_RUN_LIMITS.serviceStepGap === 0) {
          if (state.pending === '\x1b' && now() - lastInput > 50) queue.push(...flushTerminalEscape(state));
          if (queue.length > DOS_PACKAGE_RUN_LIMITS.queuedScanBytes) throw new Error('terminal scan queue cap exceeded');
          if (queue.length && steps >= nextScan) {
            if (delivered.length >= DOS_PACKAGE_RUN_LIMITS.deliveredScanBytes)
              throw new Error('terminal delivered scan cap exceeded');
            let accepted = false;
            try { accepted = machine.keyIn(queue[0]); }
            catch (error) { if (!error.message?.startsWith('AT 8042 output queue full')) throw error; }
            if (accepted) {
              delivered.push({step: steps, code: queue.shift()});
              nextScan = steps + DOS_PACKAGE_RUN_LIMITS.liveScanStepGap;
            }
          }
        }
        machine.step(); steps++;
        if (machine.cpu.shutdown) { stop = 'shutdown'; break; }
      }
      if (machine.cpu.shutdown) break;
      if (options.live) draw();
      await yieldTurn();
    }
    if (quit) stop = 'user-quit';
    if (interrupted) stop = 'interrupted';
  } catch (error) { recordFailure(error, 'execution'); }
  finally {
    if (terminalStarted) {
      restorationComplete = true;
      for (const cleanup of [() => input.removeListener('data', onData),
        () => signals.removeListener('SIGINT', onInterrupt), () => signals.removeListener('SIGTERM', onInterrupt),
        () => input.setRawMode(originalRaw), () => { if (pauseInputOnCleanup) input.pause(); },
        () => output.write('\x1b[?1004l\x1b[?25h\x1b[?1049l')]) {
        try { cleanup(); } catch (error) { restorationComplete = false; recordFailure(error, 'terminal-cleanup'); }
      }
    }
  }
  let text = [], cpu = null, snapshotComplete = false;
  if (machine) {
    try {
      text = textRows(machine);
      cpu = {cs: machine.cpu.cs, eip: machine.cpu.eip, cr0: machine.cpu.cr0 >>> 0};
      snapshotComplete = true;
    } catch (error) { recordFailure(error, 'final-snapshot'); }
  }
  if (primary) stop = 'refused';
  return {schema: 'bw.dos-package-run.v1', target: 'i80386-at-functional-ordinary',
    packageSha256: prepared.packageSha256, config: {path: prepared.selected.configPath, sha256: prepared.configSha256},
    media: {path: prepared.selected.imagePath, sha256: prepared.hddSha256,
      byteLength: image.length, geometry: prepared.selected.geometry},
    firmware: {biosSha256: prepared.biosSha256, vgaSha256: prepared.vgaSha256},
    budgets: {steps: options.steps, wallMs: options.wallMs}, steps, stop,
    refused: primary ? {phase: primaryPhase, name: primary.name, message: primary.message} :
      stop === 'shutdown' ? {name: 'Shutdown', message: 'guest CPU shut down'} : null,
    input: {bytes: inputBytes, delivered, pendingScanBytes: queue.length},
    serial: {text: Buffer.from(serial).toString('latin1'), truncated: serialOverflow},
    text, cpu, snapshotComplete, secondaryErrors,
    terminal: {started: terminalStarted, restorationAttempted: terminalStarted, restorationComplete},
    guestCompletionQualified: false};
}

export async function main(argv, dependencies = {}) {
  const options = parseDosPackageArguments(argv);
  const output = dependencies.output ?? process.stdout;
  if (options.help) { output.write(usage); return 0; }
  const prepared = prepareDosPackage(options);
  const report = await executeDosPackage(prepared, options, dependencies);
  const bytes = JSON.stringify(report, null, 2) + '\n';
  const writeReportOutput = value => {
    try { output.write(value); }
    catch (error) {
      if (!report.refused) throw error;
      report.secondaryErrors.push({phase: 'report-output', name: error.name, message: error.message});
      const first = new Error(report.refused.message);
      first.name = report.refused.name; first.report = report;
      throw first;
    }
  };
  if (options.report) {
    try { fs.writeFileSync(options.report, bytes, {flag: 'wx', mode: 0o600}); }
    catch (error) {
      if (!report.refused) throw error;
      report.secondaryErrors.push({phase: 'report-retention', name: error.name, message: error.message});
      writeReportOutput(JSON.stringify(report, null, 2) + '\n');
      return 1;
    }
  } else writeReportOutput(bytes);
  return report.refused || report.stop === 'interrupted' ? 1 : 0;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`DOS package refused: ${error.message}\n`); process.exitCode = 1; }
}
