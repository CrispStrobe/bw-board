import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync,gzipSync} from 'node:zlib';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {readMoo386} from '../scripts/lib/moo386-v1.mjs';
const root=process.env.SST386_ROOT,available=!!root;
function mutated(name,edit){const bytes=gunzipSync(readFileSync(resolve(root,'v1_ex_real_mode/01.MOO.gz')));edit(bytes);const dir=mkdtempSync(join(tmpdir(),'moo386-'));const path=join(dir,name);writeFileSync(path,gzipSync(bytes));return path;}
test('MOO reader admits the exact 386E file and rejects unknown register presence bits',{skip:!available},()=>{
  assert.equal(readMoo386(resolve(root,'v1_ex_real_mode/01.MOO.gz')).tests.length,2500);
  const path=mutated('unknown.MOO.gz',bytes=>{const at=bytes.indexOf(Buffer.from('RG32'));assert.ok(at>0);bytes.writeUInt32LE(bytes.readUInt32LE(at+8)|(1<<20),at+8);});
  assert.throws(()=>readMoo386(path),/unknown presence bits/);
});
test('MOO reader rejects duplicate TEST indices and incomplete initial register sets',{skip:!available},()=>{
  const original=gunzipSync(readFileSync(resolve(root,'v1_ex_real_mode/01.MOO.gz'))),headerEnd=8+original.readUInt32LE(4),testAt=original.indexOf(Buffer.from('TEST'),headerEnd),length=original.readUInt32LE(testAt+4)+8;
  const duplicate=Buffer.concat([original,original.subarray(testAt,testAt+length)]);duplicate.writeUInt32LE(duplicate.readUInt32LE(12)+1,12);
  const dir=mkdtempSync(join(tmpdir(),'moo386-')),dup=join(dir,'duplicate.MOO.gz');writeFileSync(dup,gzipSync(duplicate));assert.throws(()=>readMoo386(dup),/duplicate TEST index/);
  const missing=mutated('missing.MOO.gz',bytes=>{const at=bytes.indexOf(Buffer.from('RG32'));bytes.writeUInt32LE(bytes.readUInt32LE(at+8)&~(1<<19),at+8);});
  assert.throws(()=>readMoo386(missing),/trailing bytes|lacks dr7/);
});
