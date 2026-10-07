import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildFat16} from '../lib/i80386-free-bios-fat16.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const GEOMETRY = Object.freeze({cylinders: 306, heads: 4, sectors: 17});
export const CWSDPMI = Object.freeze({bytes: 21325,
  sha256: '2de899fecaa90632b8b9bdfc0305cb0375e59ae252c37e32d06c1ed3f98a8f44'});
export const SUCCESS = 'BW_DPMI_OK checksum=4225408';
export const EXIT_OK = 'BW-DPMI-EXIT-0';
export const EXIT_FAIL = 'BW-DPMI-EXIT-FAIL';
export const RETURN = 'BW-DPMI-SHELL-RETURN';
export const FIRST = 'c:\\rundp.bat';
export const SECOND = 'c:\\verify.bat';
const sourceSha = 'c8c654326633b244c64baac144fe9300ce5a1800c330e52615470c62d8c3bb1d';

const runBatch = Buffer.from('@ECHO OFF\r\n' +
  'C:\\CLIENT.EXE > C:\\DPOUT.TXT\r\n' +
  'IF ERRORLEVEL 1 GOTO FAILED\r\n' +
  `ECHO ${EXIT_OK}>C:\\DPOK.TXT\r\n` +
  'GOTO DONE\r\n' +
  ':FAILED\r\n' +
  `ECHO ${EXIT_FAIL}>C:\\DPFAIL.TXT\r\n` +
  ':DONE\r\n' +
  'ECHO BW-DPMI-BATCH-DONE\r\n', 'ascii');
const verifyBatch = Buffer.from(`@ECHO OFF\r\nECHO ${RETURN}>C:\\RETURN.TXT\r\n`, 'ascii');

export function buildMedia({host, client, compileReport, hostPin = CWSDPMI}) {
  if (!Buffer.isBuffer(host) || host.length !== hostPin.bytes || sha256(host) !== hostPin.sha256)
    throw new Error('pinned CWSDPMI member mismatch');
  if (!Buffer.isBuffer(client) || client.length < 1024 || client.length > 2 << 20)
    throw new Error('bounded owned client');
  if (compileReport?.schema !== 'bw.cwsdpmi-owned.compile-only.v1' ||
      compileReport.status !== 'COMPILED_NO_GUEST_NO_BINARY_PUBLICATION' ||
      compileReport.ownedSource?.path !== 'scripts/i80386-cwsdpmi-owned/client.c' ||
      compileReport.ownedSource.sha256 !== sourceSha ||
      compileReport.executable?.sha256 !== sha256(client) ||
      compileReport.executable.bytes !== client.length ||
      compileReport.executable.uploaded !== false ||
      compileReport.executable.format?.valid !== true ||
      compileReport.executable.format.coff?.valid !== true)
    throw new Error('fresh compile receipt/client mismatch');
  const offset = compileReport.executable.format.coffOffset;
  if (client.readUInt16LE(0) !== 0x5a4d || !Number.isInteger(offset) ||
      offset < 28 || offset + 20 > client.length || client.readUInt16LE(offset) !== 0x014c)
    throw new Error('fresh client MZ/COFF bytes mismatch');
  const files = [
    {name: 'CWSDPMI EXE', bytes: host},
    {name: 'CLIENT  EXE', bytes: client},
    {name: 'RUNDP   BAT', bytes: runBatch},
    {name: 'VERIFY  BAT', bytes: verifyBatch},
  ];
  const {image, info} = buildFat16({geometry: GEOMETRY, files, volLabel: 'BWDPMI     '});
  const result = Buffer.from(image);
  return {image: result, manifest: {
    schema: 'bw.cwsdpmi-owned.qemu-media.v1', geometry: GEOMETRY,
    bytes: result.length, sha256: sha256(result), info,
    files: Object.fromEntries(files.map(f => [f.name,
      {bytes: f.bytes.length, sha256: sha256(f.bytes)}])),
    compileClientSha256: sha256(client), cwsdpmiSha256: sha256(host),
  }};
}

function ordinary(path, maximum) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
    throw new Error('media input shape');
  return fs.readFileSync(path);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  if (process.argv.length !== 7)
    throw new Error('usage: media.mjs cwsdpmi.exe client.exe compile-report.json image.img media.json');
  const [hostPath, clientPath, reportPath, imagePath, manifestPath] = process.argv.slice(2);
  const report = JSON.parse(ordinary(reportPath, 1 << 20).toString('utf8'));
  const built = buildMedia({host: ordinary(hostPath, 1 << 20),
    client: ordinary(clientPath, 2 << 20), compileReport: report});
  fs.writeFileSync(imagePath, built.image, {flag: 'wx'});
  fs.writeFileSync(manifestPath, JSON.stringify(built.manifest, null, 2) + '\n', {flag: 'wx'});
}
