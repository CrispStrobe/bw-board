import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {derive,materialize,heldSha256,generatedName} from './derive.mjs';

const root=process.argv[2];assert.ok(root&&resolve(root)===root,'absolute exact source root');
const original=execFileSync('git',['--no-replace-objects','-C',root,'show',
  '22ca742ed60e1350ed96110986a09b2ce84620ac:scripts/probe-xv6-stock.mjs']);
const scratch=mkdtempSync(resolve(process.cwd(),'.xv6-sampling-derive-'));
try{
 const scripts=resolve(scratch,'scripts');mkdirSync(scripts);
 const held=resolve(scripts,'probe-xv6-stock.mjs');writeFileSync(held,original);
 const first=derive(scratch);assert.equal(first.heldSha256,heldSha256);
 const output=resolve(scripts,generatedName),receipt=materialize(scratch,output);
 assert.equal(receipt.generatedSha256,first.generatedSha256);
 assert.equal(readFileSync(output).toString(),first.bytes.toString());
 assert.ok(first.bytes.toString().includes("await profileCommand('Profiler.start')"));
 assert.ok(first.bytes.toString().includes("const {profile}=await profileCommand('Profiler.stop')"));
 assert.throws(()=>materialize(scratch,output),/EEXIST/);
 writeFileSync(held,Buffer.concat([original,Buffer.from('\n')]));
 assert.throws(()=>derive(scratch),/exact accepted xv6 probe/);
 console.log('xv6 profiler derivation controls PASS: exact source/inverse, one exclusive sibling, tamper denial');
}finally{rmSync(scratch,{recursive:true,force:true});}
