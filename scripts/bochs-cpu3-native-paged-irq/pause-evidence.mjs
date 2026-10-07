/** Atomic last-paused original boundary, retained even if CPU3 aborts in C++. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync,renameSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {gzipSync} from 'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():ArrayBuffer.isView(x)?Array.from(x):x);
export function writePausedEvidence(output,boundary){
 assert.ok(typeof output==='string'&&isAbsolute(output)&&resolve(output)===output);
 assert.ok(lstatSync(output).isDirectory()&&realpathSync(output)===output);
 assert.equal(boundary.schema,'bw.paged-irq.last-paused-boundary.v1');
 assert.ok(boundary.phase==='before-line'||boundary.phase==='before-resume');
 const decoded=Buffer.from(json(boundary)+'\n');assert.ok(decoded.length>0&&decoded.length<=(4<<20),'bounded full paused boundary');
 const compressed=gzipSync(decoded,{level:6});assert.ok(compressed.length<=(2<<20),'bounded compressed paused boundary');
 const packet=Buffer.from(json({schema:'bw.paged-irq.atomic-paused-packet.v1',phase:boundary.phase,
  sourceRevision:boundary.source.revision,nativeTicks:boundary.progress.n,successfulQuanta:boundary.progress.q,
  decodedBytes:decoded.length,decodedSha256:sha(decoded),compressedBytes:compressed.length,compressedSha256:sha(compressed),
  compression:'gzip-single-member-json',compressedBase64:compressed.toString('base64')})+'\n');
 assert.ok(packet.length<=(3<<20),'bounded atomic packet');
 const temp=resolve(output,'last-paused-packet.json.next'),final=resolve(output,'last-paused-packet.json');
 writeFileSync(temp,packet,{flag:'wx'});renameSync(temp,final);
 return {phase:boundary.phase,decodedSha256:sha(decoded),compressedSha256:sha(compressed)};
}
