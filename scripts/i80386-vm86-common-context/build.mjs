/** Assemble the authored guest with the runner's GNU binutils. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

export const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
export const guestSource = join(here, 'guest.S');
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const LOAD_ADDRESS = 0x7c00;
const SYMBOLS = ['gdt', 'task2', 'vm86_after40', 'vm86_after41'];

export function toolVersions() {
  const first = cmd => execFileSync(cmd, ['--version'], {encoding: 'utf8'}).split('\n')[0];
  return {as: first('as'), ld: first('ld'), objcopy: first('objcopy'), nm: first('nm')};
}

export function buildGuest() {
  const dir = mkdtempSync(join(tmpdir(), 'bw-vm86cc-'));
  try {
    const object = join(dir, 'guest.o'), elf = join(dir, 'guest.elf'), bin = join(dir, 'guest.bin');
    execFileSync('as', ['--32', '-o', object, guestSource]);
    execFileSync('ld', ['-m', 'elf_i386', '-Ttext', `0x${LOAD_ADDRESS.toString(16)}`, '-e', '_start', '-o', elf, object]);
    execFileSync('objcopy', ['-O', 'binary', '-j', '.text', elf, bin]);
    const image = readFileSync(bin);
    if (image.length !== 1536) throw new Error(`guest image must be three 512-byte sectors, got ${image.length}`);
    if (image[510] !== 0x55 || image[511] !== 0xaa) throw new Error('missing boot signature');
    const symbols = {};
    for (const line of execFileSync('nm', [elf], {encoding: 'utf8'}).split('\n')) {
      const [value, , name] = line.trim().split(/\s+/);
      if (SYMBOLS.includes(name)) symbols[name] = parseInt(value, 16);
    }
    for (const name of SYMBOLS) if (!Number.isInteger(symbols[name])) throw new Error(`missing symbol ${name}`);
    return {image, symbols, sourceSha256: sha256(readFileSync(guestSource)), imageSha256: sha256(image)};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
