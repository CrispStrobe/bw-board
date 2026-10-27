/** Engine adapters: ordinary JS strict386 core and pinned upstream Bochs CPU level 3. */
import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {LOAD_ADDRESS, here, sha256} from './build.mjs';

export const repo = resolve(here, '..', '..');
export const CORE = 'src/experimental/i80386.js';
export const BOCHS_REVISION = '0e45b736ef9792eb9b752b0a35db49eaf2faea47'; // REL_2_7_FINAL
export const END = [0x45, 0x4e, 0x44, 0x21];
export const STEP_LIMIT = 200000;

const endsWithEnd = bytes => bytes.length >= 4 && END.every((b, i) => bytes[bytes.length - 4 + i] === b);

/** Run the image on the JS core loaded from `corePath` (default: repository source). */
export async function runJs(image, {corePath = resolve(repo, CORE)} = {}) {
  const {default: I80386} = await import(pathToFileURL(corePath).href);
  const memory = new Uint8Array(0x100000);
  memory.set(image, LOAD_ADDRESS);
  const out = [];
  let fault = null;
  const cpu = new I80386({
    read: a => memory[a & 0xfffff], fetch: a => memory[a & 0xfffff],
    write: (a, v) => { memory[a & 0xfffff] = v & 255; },
    inPort: () => 0xff,
    outPort: (port, value) => { if (port === 0xe9) out.push(value & 255); },
  }, {cpuProfile: 'strict386'});
  cpu.eip = LOAD_ADDRESS;
  let steps = 0;
  try {
    for (; steps < STEP_LIMIT && !endsWithEnd(out) && !cpu.halted && !cpu.shutdown; steps++) cpu.step();
  } catch (error) { fault = String(error?.message ?? error); }
  return {engine: 'js-strict386', coreSha256: sha256(readFileSync(corePath)), steps,
    halted: !!cpu.halted, shutdown: !!cpu.shutdown, fault, stream: Uint8Array.from(out)};
}

/** Verify the pinned clean Bochs checkout and return its executable identity. */
export function bochsProfile(root) {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  if (revision !== BOCHS_REVISION) throw new Error(`unexpected Bochs revision ${revision}`);
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root, encoding: 'utf8'}).trim())
    throw new Error('Bochs tracked source must be clean');
  const config = readFileSync(resolve(root, 'bochs/config.h'), 'utf8');
  for (const [name, value] of [['BX_CPU_LEVEL', 3], ['BX_SUPPORT_SMP', 0], ['BX_DEBUGGER', 0]])
    if (!new RegExp(`^#define\\s+${name}\\s+${value}\\s*$`, 'm').test(config)) throw new Error(`Bochs config ${name}!=${value}`);
  const executable = resolve(root, 'bochs/bochs');
  return {revision, executable, executableSha256: sha256(readFileSync(executable)), configSha256: sha256(config)};
}

/** Boot the image from a 1.44M floppy through the repository's free BIOS; capture port E9. */
export async function runBochs(image, profile, {timeoutMs = 20000} = {}) {
  const bios = resolve(repo, 'roms/free-at-bios/BIOS-bochs-legacy');
  const vga = resolve(repo, 'roms/free-at-bios/vgabios-lgpl.bin');
  const dir = mkdtempSync(join(tmpdir(), 'bw-vm86cc-bochs-'));
  try {
    const floppy = Buffer.alloc(1474560); Buffer.from(image).copy(floppy);
    writeFileSync(join(dir, 'floppy.img'), floppy);
    const rc = join(dir, 'bochsrc');
    writeFileSync(rc, ['display_library: nogui', 'memory: guest=16, host=16',
      `romimage: file=${bios}`, `vgaromimage: file=${vga}`, 'cpu: count=1, ips=10000000',
      `floppya: 1_44=${join(dir, 'floppy.img')}, status=inserted`, 'boot: floppy',
      'port_e9_hack: enabled=1', `log: ${join(dir, 'bochs.log')}`, 'panic: action=fatal',
      'error: action=report', 'info: action=report', 'debug: action=ignore', 'mouse: enabled=0'].join('\n') + '\n');
    const run = await new Promise((done, fail) => {
      const child = spawn('stdbuf', ['-o0', '-e0', profile.executable, '-q', '-f', rc], {stdio: ['ignore', 'pipe', 'pipe']});
      const chunks = []; let stderr = ''; let sawEnd = false;
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.stdout.on('data', c => {
        chunks.push(c);
        if (!sawEnd && endsWithEnd(Buffer.concat(chunks))) { sawEnd = true; child.kill('SIGTERM'); }
      });
      child.stderr.on('data', c => { stderr += c.toString('latin1'); });
      child.once('error', e => { clearTimeout(timer); fail(e); });
      child.once('close', (code, signal) => { clearTimeout(timer); done({raw: Buffer.concat(chunks), stderr, code, signal, sawEnd}); });
    });
    const start = run.raw.indexOf('VMCC');
    const stream = start < 0 ? new Uint8Array() : Uint8Array.from(run.raw.subarray(start));
    let log = '';
    try { log = readFileSync(join(dir, 'bochs.log'), 'latin1'); } catch {}
    return {engine: 'bochs-cpu3', revision: profile.revision, executableSha256: profile.executableSha256,
      code: run.code, signal: run.signal, sawEnd: run.sawEnd, prefixBytes: start < 0 ? null : start,
      rawSha256: sha256(run.raw), stream, stderrTail: run.stderr.slice(-4000), logTail: log.slice(-8000)};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
