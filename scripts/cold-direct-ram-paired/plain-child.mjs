/** Fresh ordinary-JS child, with the same qualified-source and reference role. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPlain} from './plain.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const exact=p=>assert.ok(typeof p==='string'&&isAbsolute(p)&&resolve(p)===p&&!/[\0\r\n]/.test(p));
export async function runPlainChild(input){
 assert.equal(input?.schema,'bw.cold-direct-ram.paired-plain-input.v1');
 for(const p of [input.sourceRoot,input.reference,input.output])exact(p);
 assert.equal(input.qualifiedHead,'acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1');
 assert.equal(execFileSync('git',['-C',input.sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),input.qualifiedHead);
 assert.equal(execFileSync('git',['-C',input.sourceRoot,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
 const bytes=readFileSync(input.reference);assert.equal(sha(bytes),input.referenceSha256);
 const reference=JSON.parse(bytes);assert.equal(reference.schema,'bw.cold-direct-ram.paired-reference.v1');
 mkdirSync(input.output);
 try{
  const result=await runPlain(input.sourceRoot,reference,reference.target);
  const receipt={...result,qualifiedHead:input.qualifiedHead,referenceSha256:input.referenceSha256,
   status:'SEMANTIC_PASS'};
  writeFileSync(resolve(input.output,'receipt.json'),JSON.stringify(receipt)+'\n',{flag:'wx'});
  return receipt;
 }catch(error){
  writeFileSync(resolve(input.output,'failure.json'),JSON.stringify({schema:'bw.cold-direct-ram.paired-plain-failure.v1',
   error:String(error),qualifiedHead:input.qualifiedHead,referenceSha256:input.referenceSha256})+'\n',{flag:'wx'});
  throw error;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 assert.equal(process.argv.length,3);await runPlainChild(JSON.parse(readFileSync(process.argv[2],'utf8')));
}
