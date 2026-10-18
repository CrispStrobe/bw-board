import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildFat16} from '../lib/i80386-free-bios-fat16.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const GEOMETRY = Object.freeze({cylinders: 306, heads: 4, sectors: 17});
export const HOST = Object.freeze({bytes: 21325,
  sha256: '2de899fecaa90632b8b9bdfc0305cb0375e59ae252c37e32d06c1ed3f98a8f44'});
export const CLIENT_PATH = 'scripts/i80386-cwsdpmi-highmem-timer/client.c';
export const CLIENT_SHA = '77b41b9c9633d8fea932786230ee24facc8d05549a8912a36afb0f55b71afc07';
export const FIRST = 'c:\\runht.bat';
export const SECOND = 'c:\\verifyht.bat';
export const EXIT_OK = 'BW-HMT-EXIT-0';
export const EXIT_FAIL = 'BW-HMT-EXIT-FAIL';
export const RETURN = 'BW-HMT-SHELL-RETURN';
export const BATCH_DONE = 'BW-HMT-BATCH-DONE';

const runBatch = Buffer.from('@ECHO OFF\r\nC:\r\nCD \\\r\n' +
  'C:\\CLIENT.EXE > C:\\HTOUT.TXT\r\n' +
  'IF ERRORLEVEL 1 GOTO FAILED\r\n' +
  `ECHO ${EXIT_OK}>C:\\HTOK.TXT\r\nGOTO DONE\r\n` +
  `:FAILED\r\nECHO ${EXIT_FAIL}>C:\\HTFAIL.TXT\r\n` +
  `:DONE\r\nECHO ${BATCH_DONE}\r\n`, 'ascii');
const verifyBatch = Buffer.from(`@ECHO OFF\r\nECHO ${RETURN}>C:\\HTRET.TXT\r\n`, 'ascii');

export function buildMedia({host, client, compile, rawCompile, source, hostPin = HOST}) {
  if (!Buffer.isBuffer(host) || host.length !== hostPin.bytes || sha256(host) !== hostPin.sha256)
    throw new Error('pinned CWSDPMI member');
  if (!Buffer.isBuffer(client) || client.length < 1024 || client.length > 2 << 20)
    throw new Error('bounded owned client');
  if (!Buffer.isBuffer(source) || sha256(source) !== CLIENT_SHA)
    throw new Error('new owned source hash');
  if (compile?.schema !== 'bw.cwsdpmi-highmem-timer.compile-adapter.v1' ||
      compile.status !== 'COMPILED_INTERNAL_ONLY' ||
      compile.ownedSource?.path !== CLIENT_PATH ||
      compile.ownedSource.sha256 !== CLIENT_SHA ||
      compile.executable?.uploaded !== false ||
      compile.executable.bytes !== client.length ||
      compile.executable.sha256 !== sha256(client) ||
      compile.executable.format?.valid !== true ||
      compile.executable.format.coff?.valid !== true ||
      rawCompile?.schema !== 'bw.cwsdpmi-owned.compile-only.v1' ||
      rawCompile.status !== 'COMPILED_NO_GUEST_NO_BINARY_PUBLICATION' ||
      rawCompile?.ownedSource?.path !== CLIENT_PATH ||
      rawCompile.ownedSource.sha256 !== CLIENT_SHA ||
      rawCompile.executable?.uploaded !== false ||
      JSON.stringify(rawCompile.executable) !== JSON.stringify(compile.executable) ||
      JSON.stringify(rawCompile.map) !== JSON.stringify(compile.map))
    throw new Error('new compile profile/client mismatch');
  const coff = compile.executable.format.coffOffset;
  if (client.readUInt16LE(0) !== 0x5a4d || !Number.isInteger(coff) ||
      coff < 28 || coff + 20 > client.length || client.readUInt16LE(coff) !== 0x014c)
    throw new Error('MZ/COFF client bytes');
  const files = [
    {name: 'CWSDPMI EXE', bytes: host},
    {name: 'CLIENT  EXE', bytes: client},
    {name: 'RUNHT   BAT', bytes: runBatch},
    {name: 'VERIFYHTBAT', bytes: verifyBatch},
  ];
  const {image, info} = buildFat16({geometry: GEOMETRY, files, volLabel: 'BWHMT      '});
  const result = Buffer.from(image);
  return {image: result, manifest: {
    schema: 'bw.cwsdpmi-highmem-timer.qemu-media.v1', geometry: GEOMETRY,
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
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW |
    fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino ||
        before.size !== stat.size) throw new Error('media input changed');
    const raw = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < raw.length) {
      const count = fs.readSync(fd, raw, offset, raw.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (offset !== stat.size || after.size !== stat.size)
      throw new Error('media input changed');
    return raw.subarray(0, offset);
  } finally {
    fs.closeSync(fd);
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  if (process.argv.length !== 9)
    throw new Error('usage: media.mjs host client source outer-compile.json raw-compile.json image.img media.json');
  const [hostPath, clientPath, sourcePath, outerPath, rawPath, imagePath, manifestPath] = process.argv.slice(2);
  const outerRaw = ordinary(outerPath, 1 << 20);
  const rawRaw = ordinary(rawPath, 1 << 20);
  const outer = JSON.parse(outerRaw.toString('utf8'));
  if (outer?.rawCompileReport?.sha256 !== sha256(rawRaw) ||
      outer.rawCompileReport.path !== 'compile-audit/compile-report.json')
    throw new Error('raw compile receipt binding');
  const built = buildMedia({host: ordinary(hostPath, 1 << 20),
    client: ordinary(clientPath, 2 << 20), source: ordinary(sourcePath, 3 << 20),
    compile: outer, rawCompile: JSON.parse(rawRaw.toString('utf8'))});
  fs.writeFileSync(imagePath, built.image, {flag: 'wx'});
  fs.writeFileSync(manifestPath, JSON.stringify(built.manifest, null, 2) + '\n', {flag: 'wx'});
}
