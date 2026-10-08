import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {formatObservation} from './admit.mjs';

if(!process.env.TMPDIR)throw new Error('set an owned TMPDIR');
const root=mkdtempSync(join(process.env.TMPDIR,'cwsdpmi-at-binding-control-'));
const code=resolve('scripts/i80386-cwsdpmi-at-binding-actual/admit.mjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const exe=Buffer.alloc(4096);
exe.write('MZ');exe.writeUInt16LE(1,4);exe.writeUInt16LE(4,8);
exe.writeUInt16LE(0x14c,512);exe.writeUInt16LE(1,514);
exe.writeUInt16LE(28,528);exe.writeUInt16LE(0x010b,532);
exe.write('.text',560);
const format=formatObservation(exe);
assert.equal(format.coffOffset,512);
assert.equal(format.coffHeaderHex.length,40);
assert.equal(format.optionalHeaderHex.length,56);
assert.equal(format.sectionTableHex.length,80);
const paths={exe:join(root,'client.exe'),map:join(root,'client.map'),
  auditMap:join(root,'retained.map'),report:join(root,'compile-report.json')};
writeFileSync(paths.exe,exe);
writeFileSync(paths.map,'.text 0x1000 0x100\n');
writeFileSync(paths.auditMap,'.text 0x1001 0x100\n');
writeFileSync(paths.report,'{}\n');
function invoke(output,changed={}) {
  const args=[paths.exe,paths.map,paths.auditMap,paths.report,join(root,output)];
  for(const [key,path] of Object.entries(changed))args[{exe:0,map:1,auditMap:2,report:3}[key]]=path;
  const child=spawnSync(process.execPath,[code,...args],{timeout:5000,maxBuffer:65536});
  assert.equal(child.status,1,child.stderr?.toString());
  return join(root,output);
}
const first=invoke('mismatch');
assert.equal(JSON.parse(readFileSync(join(first,'failure.json'))).message,
  'private map differs from retained audit map');
assert.equal(JSON.parse(readFileSync(join(first,'inputs.json'))).roles.executable.sha256,hash(exe));
assert.equal(JSON.parse(readFileSync(join(first,'format.json'))).coffHeaderHex,format.coffHeaderHex);
assert(!readdirSync(first).some(name=>/\.(?:exe|o|zip|img|bz2)$/.test(name)));
const link=join(root,'symlink.exe');symlinkSync(paths.exe,link);
const second=invoke('symlink',{exe:link});
assert.equal(JSON.parse(readFileSync(join(second,'failure.json'))).message,
  'nonordinary or unbounded executable');
assert(!readdirSync(second).includes('admission.json'));
const third=invoke('missing',{report:join(root,'absent.json')});
assert(JSON.parse(readFileSync(join(third,'failure.json'))).errorType);
assert.equal(JSON.parse(readFileSync(join(third,'observed-executable.json'))).sha256,hash(exe));
console.log('CWSDPMI hosted binding input/format/failure controls PASS');
