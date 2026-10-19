import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildFat16} from '../lib/i80386-free-bios-fat16.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const GEOMETRY = Object.freeze({cylinders: 306, heads: 4, sectors: 17});
export const LE_SHA = '7b8e9545b05d6697e934cffc69bfdf4ec0442147382948db9535a262d2a2a23a';
export const EXTENDER_SHA = 'd189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817';
export const LICENSE_SHA = '116fded3b2c68e4884dae6cdfe420d5df03807cc2e06bd888a3a74f02e5975b0';
export const ACKNOWLEDGMENT = 'This product uses DOS/32 Advanced DOS Extender technology.';
export const SUCCESS = 'BW-DOS32-LE-ARITH-OK';
export const FAILURE = 'BW-DOS32-LE-ARITH-FAIL';
export const EXIT_OK = 'BW-LE-EXIT-0';
export const EXIT_FAIL = 'BW-LE-EXIT-1';
export const RETURN = 'BW-LE-SHELL-RETURN';
export const FIRST_COMMAND = 'c:\\runle.bat';
export const SECOND_COMMAND = 'c:\\verify.bat';

const ascii = text => Buffer.from(text, 'ascii');
const runBatch = ascii('@ECHO OFF\r\n' +
  'C:\\DOS32A.EXE C:\\OWNED.EXE > C:\\LEOUT.TXT\r\n' +
  'IF ERRORLEVEL 1 GOTO FAILED\r\n' +
  `ECHO ${EXIT_OK}>C:\\LEOK.TXT\r\n` +
  'GOTO DONE\r\n' +
  ':FAILED\r\n' +
  `ECHO ${EXIT_FAIL}>C:\\LEFAIL.TXT\r\n` +
  ':DONE\r\n' +
  'ECHO BW-LE-BATCH-DONE\r\n');
const verifyBatch = ascii(`@ECHO OFF\r\nECHO ${RETURN}>C:\\RETURN.TXT\r\n`);

export function buildMedia({extender, client, license}) {
  if (extender.length !== 27504 || sha256(extender) !== EXTENDER_SHA)
    throw new Error('pinned external DOS extender bytes mismatch');
  if (client.length !== 8192 || sha256(client) !== LE_SHA)
    throw new Error('owned LE bytes mismatch');
  if (license.length !== 1821 || sha256(license) !== LICENSE_SHA ||
      !license.toString('utf8').includes(ACKNOWLEDGMENT))
    throw new Error('external DOS extender license mismatch');
  const files = [
    {name: 'DOS32A  EXE', bytes: extender},
    {name: 'OWNED   EXE', bytes: client},
    {name: 'RUNLE   BAT', bytes: runBatch},
    {name: 'VERIFY  BAT', bytes: verifyBatch},
  ];
  const {image, info} = buildFat16({geometry: GEOMETRY, files, volLabel: 'BWFREELE   '});
  const fileHashes = Object.fromEntries(files.map(file =>
    [file.name, {bytes: file.bytes.length, sha256: sha256(file.bytes)}]));
  return {image: Buffer.from(image), info, fileHashes};
}

const get16 = (b, i) => b.readUInt16LE(i);
const get32 = (b, i) => b.readUInt32LE(i);

// This parser reads only the root 8.3 files produced by the guest. It rejects
// malformed chains and ambiguous duplicate names; it is not a general FAT API.
export function readRootFile(image, name) {
  if (!Buffer.isBuffer(image) || image.length !== GEOMETRY.cylinders * GEOMETRY.heads * GEOMETRY.sectors * 512)
    throw new Error('FAT image geometry mismatch');
  if (!/^[A-Z0-9 ]{11}$/.test(name)) throw new Error('FAT 8.3 name');
  if (image[510] !== 0x55 || image[511] !== 0xaa) throw new Error('MBR signature');
  const part = get32(image, 446 + 8);
  const vbr = part * 512;
  if (part !== GEOMETRY.sectors || image[vbr + 510] !== 0x55 || image[vbr + 511] !== 0xaa ||
      get16(image, vbr + 11) !== 512 || image[vbr + 16] !== 2)
    throw new Error('FAT volume layout');
  const spc = image[vbr + 13], fatSectors = get16(image, vbr + 22);
  const rootEntries = get16(image, vbr + 17);
  if (![2, 4, 8].includes(spc) || rootEntries !== 512 || fatSectors < 1 || fatSectors > 512)
    throw new Error('FAT parameters');
  const fat = (part + 1) * 512;
  const root = (part + 1 + 2 * fatSectors) * 512;
  const rootSectors = Math.ceil(rootEntries * 32 / 512);
  const data = (part + 1 + 2 * fatSectors + rootSectors) * 512;
  let found = null;
  for (let i = 0; i < rootEntries; i++) {
    const at = root + i * 32;
    if (image[at] === 0) break;
    if (image[at] === 0xe5 || (image[at + 11] & 0x18)) continue;
    if (image.subarray(at, at + 11).toString('ascii') !== name) continue;
    if (found) throw new Error('duplicate root name');
    found = {first: get16(image, at + 26), bytes: get32(image, at + 28)};
  }
  if (!found) return null;
  if (found.bytes > 65536) throw new Error('guest output file too large');
  if (found.bytes === 0) return Buffer.alloc(0);
  const chunks = [], seen = new Set();
  let cluster = found.first, remaining = found.bytes;
  while (remaining > 0) {
    if (cluster < 2 || cluster >= 65528 || seen.has(cluster)) throw new Error('FAT chain invalid');
    seen.add(cluster);
    const at = data + (cluster - 2) * spc * 512;
    const count = Math.min(remaining, spc * 512);
    if (at + count > image.length) throw new Error('FAT chain out of image');
    chunks.push(image.subarray(at, at + count));
    remaining -= count;
    const next = get16(image, fat + cluster * 2);
    if (remaining && next >= 0xfff8) throw new Error('FAT chain truncated');
    if (!remaining && next < 0xfff8) throw new Error('FAT chain excess');
    cluster = next;
  }
  return Buffer.concat(chunks);
}

export function resultFiles(image) {
  const names = {output: 'LEOUT   TXT', ok: 'LEOK    TXT', fail: 'LEFAIL  TXT', returned: 'RETURN  TXT'};
  return Object.fromEntries(Object.entries(names).map(([role, name]) => {
    const bytes = readRootFile(image, name);
    return [role, bytes === null ? null : {bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('latin1')}];
  }));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  if (process.argv.length !== 7) throw new Error('usage: media.mjs extender.exe owned.le license disk.img manifest.json');
  const [extender, client, license, output, manifest] = process.argv.slice(2);
  const built = buildMedia({extender: fs.readFileSync(extender), client: fs.readFileSync(client), license: fs.readFileSync(license)});
  fs.writeFileSync(output, built.image, {flag: 'wx'});
  fs.writeFileSync(manifest, JSON.stringify({schema: 'bw.dos32a-owned-media.v1',
    geometry: GEOMETRY, sha256: sha256(built.image), bytes: built.image.length,
    files: built.fileHashes, info: built.info, externalLicenseSha256: LICENSE_SHA,
    acknowledgment: ACKNOWLEDGMENT}, null, 2) + '\n', {flag: 'wx'});
}
