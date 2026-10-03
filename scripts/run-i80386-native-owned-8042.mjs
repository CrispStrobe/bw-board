/** Direct bounded native CLI. All source/build admission precedes addon load. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,statSync,realpathSync,openSync,writeSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {isMainThread} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {createOwned8042Provider} from './bochs-cpu3-native-owned-8042/provider.mjs';
import {sourceIdentity,authenticateBuild,authenticateConfiguration} from './bochs-cpu3-native-owned-8042/identity.mjs';
import {validateReference,wholeNativeWords} from './bochs-cpu3-native-owned-8042/reference.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const serialize=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x instanceof Uint8Array?Array.from(x):x);
assert.ok(isMainThread);assert.equal(realpathSync(process.argv[1]),realpathSync(fileURLToPath(import.meta.url)));assert.deepEqual(process.execArgv,['--max-old-space-size=128']);
for(const k of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE'])assert.ok(!process.env[k],'blank '+k);
assert.equal(process.argv.length,3);const inputPath=process.argv[2];assert.ok(statSync(inputPath).isFile()&&statSync(inputPath).size<=16384);const input=JSON.parse(readFileSync(inputPath));
const names=['addon','sha256','configuration','output','preparedManifest','preparedManifestSha256','buildReceipt','buildReceiptSha256','reference','referenceSha256','nativeTrace'];assert.deepEqual(Object.keys(input).sort(),names.sort());assert.equal(typeof input.nativeTrace,'boolean');
for(const k of names.filter(k=>k!=='nativeTrace')){assert.equal(typeof input[k],'string');if(k.endsWith('Sha256')||k==='sha256')assert.match(input[k],/^[a-f0-9]{64}$/);else assert.ok(input[k].startsWith('/')&&input[k].length<=4096&&!/[\0\r\n]/.test(input[k]));}
assert.ok(statSync(input.reference).isFile()&&statSync(input.reference).size<=(8<<20));const referenceBytes=readFileSync(input.reference);assert.equal(sha(referenceBytes),input.referenceSha256);const reference=validateReference(JSON.parse(referenceBytes));
const source=sourceIdentity(),provenance=authenticateBuild(input,source);authenticateConfiguration(input.configuration);
const addon=realpathSync(input.addon);assert.ok(statSync(addon).isFile()&&statSync(addon).size<=256<<20);assert.equal(sha(readFileSync(addon)),input.sha256);
mkdirSync(input.output,{recursive:false});writeFileSync(input.output+'/admission.json',serialize({input,source,provenance}),{flag:'wx'});
let rows=0,bytes=0;const fd=openSync(input.output+'/boundaries.jsonl','wx');
const record=row=>{const s=serialize(row)+'\n';bytes+=Buffer.byteLength(s);assert.ok(bytes<=8<<20);writeSync(fd,s);rows++;return row;};
const provider=createOwned8042Provider();assert.equal(sha(provider.rom),reference.romSha256);
// Only this admitted, canonical image is ever loaded into the fresh process.
const api=createRequire(import.meta.url)(addon);assert.equal(api.abiVersion,4);for(const k of ['create','resume','setIRQ','inspect','close'])assert.equal(typeof api[k],'function');
let closed=false;
try{
 const reset={native:api.create(input.configuration,provider.rom,provider.callbacks,input.nativeTrace),board:provider.checkpoint()};wholeNativeWords(reset.native);record({kind:'reset',...reset});
 const steps=[];let terminal=null;
 for(let resumes=0;resumes<513;resumes++){
  const stage=provider.stage();assert.equal(stage.asserted,false,'fixed masked-PIC profile');assert.equal(stage.changed,false);provider.begin();let native;try{native=api.resume(1,1,0xffffffffffffffffn);}finally{provider.end();}
  wholeNativeWords(native);const board=provider.checkpoint();const row=record({kind:'resume',native,board});assert.ok(Number(native.nativeTicks)<=512&&Number(native.successfulQuanta)<=512);
  if(native.reason===4&&native.chargedNativeTicks===0&&native.chargedQuanta===0){terminal=row;break;}
  assert.equal(native.chargedNativeTicks,1);assert.equal(native.chargedQuanta,1);assert.ok(steps.length<512);steps.push({q:Number(native.successfulQuanta),native,board});
 }
 assert.ok(terminal,'zero-charge terminal HLT within fixed cap');const settled=provider.terminal();record({kind:'settled',settled});api.close();provider.close();closed=true;
 const report={schema:'bw.native-owned-8042.capture.v1',scope:'Fixed fresh-child semantic candidate only; no performance or broader AT admission',romSha256:reference.romSha256,nativeTrace:input.nativeTrace,source,provenance,addonSha256:input.sha256,reset,steps,terminal,settled,closed:{native:true,board:true,freshMainChild:true},rawBoundaryRows:rows};
 writeFileSync(input.output+'/capture.json',serialize(report),{flag:'wx'});
 assert.deepEqual(sourceIdentity(),source);assert.deepEqual(authenticateBuild(input,source),provenance);assert.equal(sha(readFileSync(input.reference)),input.referenceSha256);assert.equal(sha(readFileSync(addon)),input.sha256);
}finally{closeSync(fd);if(!closed)writeFileSync(input.output+'/incomplete.json',serialize({closed:false,rows,bytes,scope:'Failed candidate; raw boundary evidence retained. Parent kills entire process group on timeout.'}),{flag:'wx'});}
