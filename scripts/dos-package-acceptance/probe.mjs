#!/usr/bin/env node
// MIT-authored fixture and source metadata. No emulator imports or execution.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {expandI80386SourceInventory} from '../lib/i80386-source-inventory.mjs';

export const PACKET = 'build/dos-package-acceptance';
export const CASES = Object.freeze(['a', 'b', 'malformed', 'focus-loss']);
export const BIOS = Object.freeze({path: 'roms/free-at-bios/BIOS-bochs-legacy', bytes: 65536,
  sha256: '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'});
export const VGA = Object.freeze({path: 'roms/free-at-bios/vgabios-lgpl.bin', bytes: 38400,
  sha256: '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'});
export const CONFIG = '[cpu]\ncputype=386\n[autoexec]\nimgmount c disks/boot.img -t hdd -size 512,1,1,1\nboot -l c\n';
// 131 code bytes +66 data bytes. CLI/JMP-self/NOP at5a (not HLT).
export const BOOT_HEX = 'ea057c0000fa31c08ed88ec08ed0bc007cfbfcb80300cd10be837ce8400030e4cd16a2c47c3c6174043c627527be927ce82b00a0c47ce84200be9e7ce81f00a0c47c345ae82200b90000e2febea67ce80c00eb06beb67ce80400faebfe90ac84c07405e81500ebf6c350c0e804e8010058240f04303c3976020407b40ebb0700cd10c342572d504b472d52454144590d0a0042572d504b472d4b45593d003b584f5235413d000d0a42572d504b472d444f4e450d0a0042572d504b472d4641494c0d0a0000';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function storedZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const {name, data} of entries) {
    const filename = Buffer.from(name, 'ascii'), local = Buffer.alloc(30 + filename.length + data.length),
      central = Buffer.alloc(46 + filename.length), crc = crc32(data);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26); filename.copy(local, 30); data.copy(local, 30 + filename.length);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42); filename.copy(central, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function authoredFixture(license) {
  if (license.length !== 1068 || sha256(license) !== 'e53c4e17a0971ca6cac5010a19876b77a896e3ce172b1f61d934dfd14c595d6d')
    throw new Error('owned MIT license identity changed');
  const image = Buffer.alloc(512), program = Buffer.from(BOOT_HEX, 'hex');
  if (program.length !== 197) throw new Error('bootstrap program extent');
  program.copy(image); image[510] = 0x55; image[511] = 0xaa;
  const entries = [{name: 'pkg/dosbox.conf', data: Buffer.from(CONFIG)},
    {name: 'pkg/disks/boot.img', data: image}, {name: 'pkg/LICENSE.txt', data: Buffer.from(license)}];
  const malformed = entries.map((entry, index) => ({...entry, name: index ? entry.name : 'pkg/../dosbox.conf'}));
  return {entries, malformed, good: storedZip(entries), bad: storedZip(malformed)};
}
const git = (root, args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args],
  {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
export function sourceInventory(root) {
  const seeds = ['./run-dos-package.mjs', './dos-package-acceptance/probe.mjs',
    './dos-package-acceptance/producer.py', './dos-package-acceptance/reader.py', './dos-package-acceptance/README.md',
    '../test/dos-package-policy.test.mjs', '../test/dos-package-zip.test.mjs', '../test/dos-package-cli.test.mjs',
    '../test/dos-package-acceptance.test.mjs', '../.github/workflows/dos-package-acceptance.yml',
    '../package.json', '../LICENSE', '../roms/free-at-bios/BIOS-bochs-legacy',
    '../roms/free-at-bios/vgabios-lgpl.bin', '../roms/free-at-bios/LICENSE', '../roms/free-at-bios/README.md'];
  const files = {};
  const paths = expandI80386SourceInventory(seeds, new URL('../run-dos-package.mjs', import.meta.url))
    .map(relative => path.posix.normalize('scripts/' + relative)).sort();
  const rows = git(root, ['ls-tree', '-r', 'HEAD', '--', ...paths]);
  const objects = new Map(rows.trim().split('\n').map(row => {
    const match = row.match(/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/);
    if (!match) throw new Error('source census needs regular tracked blobs');
    return [match[3], {mode: match[1], blob: match[2]}];
  }));
  for (const name of paths) {
    const stat = fs.lstatSync(path.join(root, name)), tracked = objects.get(name);
    if (!stat.isFile() || !tracked) throw new Error('source census path missing or untracked');
    const bytes = fs.readFileSync(path.join(root, name));
    files[name] = {bytes: bytes.length, sha256: sha256(bytes), ...tracked};
  }
  return {schema: 'bw.dos-package-pty.source.v1', head: git(root, ['rev-parse', 'HEAD']).trim(),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(), files};
}
const writeJson = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
export function preparePacket(root = process.cwd()) {
  const output = path.join(root, PACKET);
  fs.mkdirSync(output, {recursive: false}); fs.mkdirSync(path.join(output, 'inputs'));
  for (const name of CASES) fs.mkdirSync(path.join(output, name));
  const fixture = authoredFixture(fs.readFileSync(path.join(root, 'LICENSE')));
  fs.writeFileSync(path.join(output, 'inputs/authored.zip'), fixture.good, {flag: 'wx'});
  fs.writeFileSync(path.join(output, 'inputs/malformed.zip'), fixture.bad, {flag: 'wx'});
  for (const firmware of [BIOS, VGA]) {
    const bytes = fs.readFileSync(path.join(root, firmware.path));
    if (bytes.length !== firmware.bytes || sha256(bytes) !== firmware.sha256) throw new Error('bundled firmware identity');
  }
  const row = (filename, bytes, entries) => ({path: filename, bytes: bytes.length, sha256: sha256(bytes),
    members: entries.map(entry => ({path: entry.name, bytes: entry.data.length, sha256: sha256(entry.data),
      crc32: crc32(entry.data).toString(16).padStart(8, '0')}))});
  writeJson(path.join(output, 'inputs.json'), {schema: 'bw.dos-package-pty.inputs.v1',
    authored: row('inputs/authored.zip', fixture.good, fixture.entries),
    malformed: row('inputs/malformed.zip', fixture.bad, fixture.malformed), firmware: {bios: BIOS, vga: VGA}});
  writeJson(path.join(output, 'source.before.json'), sourceInventory(root));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length === 3 && process.argv[2] === 'prepare') preparePacket();
  else if (process.argv.length === 4 && process.argv[2] === 'source') writeJson(process.argv[3], sourceInventory(process.cwd()));
  else throw new Error('usage: probe.mjs prepare | source NEW_JSON');
}
