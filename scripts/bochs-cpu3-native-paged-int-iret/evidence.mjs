/** Lossless receipt transport only. No architecture comparison or native execution. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWriteStream,writeFileSync,readFileSync,linkSync,unlinkSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
export const evidenceLimits=Object.freeze({decodedBytes:64<<20,storedBytes:16<<20,outcomeBytes:128<<10});
const stringify=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():ArrayBuffer.isView(x)?Array.from(x):x);
// Partition only top-level arrays. Each original record and repeated page remains intact.
export function* receiptChunks(receipt){
 yield '{';let separator='';
 for(const [key,value]of Object.entries(receipt)){
  if(value===undefined||typeof value==='function'||typeof value==='symbol')continue;
  yield separator+JSON.stringify(key)+':';separator=',';
  if(Array.isArray(value)){yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield stringify(value[i])??'null';}yield ']';}
  else yield stringify(value);
 }
 yield '}\n';
}
function diagnostic(value){
 const text=String(value),bytes=Buffer.byteLength(text),hash=createHash('sha256').update(text).digest('hex');
 // The excerpt is labelled; full diagnostic strings remain in the bulk receipt.
 const excerpt=bytes<=4096?text:Buffer.from(text).subarray(0,4093).toString('utf8');
 return {text:excerpt,utf8Bytes:bytes,sha256:hash,truncated:bytes>4096};
}
function diagnosticMap(value,keys){const out={};for(const key of keys)if(value?.[key]!==undefined)out[key]=diagnostic(value[key]);return out;}
function outcome(receipt,primary){
 // Fixed-key independent diagnostics; full boards/pages/tapes belong to the lossless body.
 const out={schema:'bw.paged-int-iret.evidence-outcome.v1',status:'FAIL',parityStatus:primary?'FAIL':receipt.status,primaryError:primary?diagnostic(primary):receipt.error===undefined?null:diagnostic(receipt.error),progress:receipt.progress??null,bodyComplete:false};
 for(const key of ['error','resumeError','endError','finalAuthenticationError'])if(receipt[key]!==undefined)out[key]=diagnostic(receipt[key]);
 out.cleanup=diagnosticMap(receipt.cleanup,['native','provider','javascript','nativeError','providerError','javascriptError']);
 out.finalReadErrors=diagnosticMap(receipt.finalReadErrors,['inputSha256After','driverAfter','nodeAfter','compiledAfter','buildAfter','configurationAfter']);
 for(const key of ['inputSha256Before','inputSha256After'])if(receipt[key]!==undefined)out[key]=receipt[key];
 const n=receipt.lastReturnedNative??receipt.lastSuccessfullyReturnedNative??receipt.lastComparison?.native;
 if(n){out.lastNative={};for(const key of ['state','extra','segments','system','debug','nativeTicks','successfulQuanta','activityState','chargedNativeTicks','chargedQuanta','reason','execution','fallback','mappingEpoch','boardA20'])if(n[key]!==undefined)out.lastNative[key]=n[key];}
 const j=receipt.lastComparison?.javascript??receipt.partialJavascript;if(j)out.lastJavascript={q:j.q,cpu:j.cpu};
 return out;
}
function smallBytes(out){const b=Buffer.from(stringify(out)+'\n');assert.ok(b.length<=evidenceLimits.outcomeBytes,'bounded independent outcome');return b;}
export async function persistEvidence(receipt,output,primary=null){
 if(primary)receipt.status='FAIL';
 const initial=outcome(receipt,primary),outcomePath=resolve(output,'outcome.json');let initialBytes,storageError=null,outcomeError=null,body=null;
 try{initialBytes=smallBytes(initial);writeFileSync(outcomePath,initialBytes,{flag:'wx'});}catch(e){receipt.status='FAIL';return {primary:primary??e,storageError:null,outcomeError:e,body:null};}
 const filename=receipt.status==='PASS'?'capture.json.gz':'first-divergence.json.gz',partial=resolve(output,filename+'.partial');
 let decodedBytes=0,storedBytes=0;const decodedHash=createHash('sha256'),storedHash=createHash('sha256');
 const measure=(decoded)=>new Transform({transform(chunk,encoding,done){try{if(decoded){decodedBytes+=chunk.length;assert.ok(decodedBytes<=evidenceLimits.decodedBytes,'decoded receipt cap');decodedHash.update(chunk);}else{storedBytes+=chunk.length;assert.ok(storedBytes<=evidenceLimits.storedBytes,'stored gzip cap');storedHash.update(chunk);}done(null,chunk);}catch(e){done(e);}}});
 try{
  await pipeline(Readable.from(receiptChunks(receipt),{objectMode:false}),measure(true),createGzip(),measure(false),createWriteStream(partial,{flags:'wx'}));
  // Exclusive final publication; never overwrite an existing completed receipt.
  linkSync(partial,resolve(output,filename));unlinkSync(partial);
  body={filename,decodedBytes,storedBytes,decodedSha256:decodedHash.digest('hex'),storedSha256:storedHash.digest('hex'),encoding:'gzip-single-member-json',decodedCap:evidenceLimits.decodedBytes,storedCap:evidenceLimits.storedBytes};
 }catch(e){storageError=e;}
 const final={...initial,status:storageError?'FAIL':receipt.status,bodyComplete:!!body,body,persistenceError:storageError?diagnostic(storageError):null};
 try{const b=smallBytes(final);assert.deepEqual(readFileSync(outcomePath),initialBytes,'owned outcome unchanged');const next=resolve(output,'outcome-update.json');writeFileSync(next,b,{flag:'wx'});renameSync(next,outcomePath);}catch(e){outcomeError=e;}
 if(storageError||outcomeError)receipt.status='FAIL';
 return {primary:primary??storageError??outcomeError,storageError,outcomeError,body};
}
