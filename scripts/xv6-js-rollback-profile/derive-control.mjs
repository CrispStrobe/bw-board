import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {derive,materialize,heldSha256,generatedName} from './derive.mjs';

const root=process.argv[2];assert.ok(root&&resolve(root)===root,'absolute source root');
const original=execFileSync('git',['--no-replace-objects','-C',root,'show',
  '22ca742ed60e1350ed96110986a09b2ce84620ac:scripts/probe-xv6-stock.mjs']);
const scratch=mkdtempSync(resolve(process.cwd(),'.rollback-derive-'));
try{
 const scripts=resolve(scratch,'scripts');mkdirSync(scripts);
 const held=resolve(scripts,'probe-xv6-stock.mjs');writeFileSync(held,original);
 const first=derive(scratch);assert.equal(first.heldSha256,heldSha256);
 const output=resolve(scripts,generatedName);
 const receipt=materialize(scratch,output);
 assert.equal(receipt.generatedSha256,first.generatedSha256);
 assert.deepEqual(readFileSync(output),first.bytes);
 const generated=first.bytes.toString();
 assert.ok(generated.includes("includeObjectsCollectedByMinorGC:true"));
 assert.ok(generated.includes("includeObjectsCollectedByMajorGC:true"));
 assert.ok(generated.includes("await heapCommand('HeapProfiler.stopSampling')"));
 assert.throws(()=>materialize(scratch,output),/EEXIST/);
 writeFileSync(held,Buffer.concat([original,Buffer.from('\n')]));
 assert.throws(()=>derive(scratch),/exact held probe bytes/);
 console.log('rollback derivative controls PASS');
}finally{rmSync(scratch,{recursive:true,force:true});}
