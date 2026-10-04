/** Closed first RAM/SMC correctness driver. No execution on import. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createRamOracle,cutName,resetSource} from './reference.mjs';
import {createDriverRamProvider,builtProviderSha256,deriveDriverProvider} from './driver-provider.mjs';
import {ramRomSha256,namedCuts} from './profile.mjs';
import {compareBoundary,ramProgress,validateMilestones,ramParityPolicy,wholeNativeWords} from './parity.mjs';
import {compiledRevision,addonSha256,driverSourceIdentity,authenticateRamCompiled,regularBytes,sha,buildRun} from './driver-auth.mjs';
const serialize=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():ArrayBuffer.isView(x)?Array.from(x):x);
export function validateInput(v){
 const names=['compiledRoot','compiledRevision','driverRevision','driverSourceSha256','addon','sha256','configuration','preparedManifest','preparedManifestSha256','buildReceipt','buildReceiptSha256','output','nativeTrace'];assert.deepEqual(Object.keys(v).sort(),names.sort());
 assert.equal(v.compiledRevision,compiledRevision);assert.equal(v.sha256,addonSha256);assert.equal(v.nativeTrace,false,'first fixed trace-OFF correctness child');assert.match(v.driverRevision,/^[a-f0-9]{40}$/);
 for(const key of names.filter(k=>!['compiledRevision','driverRevision','nativeTrace'].includes(k))){assert.equal(typeof v[key],'string');if(key.endsWith('Sha256')||key==='sha256')assert.match(v[key],/^[a-f0-9]{64}$/);else assert.ok(isAbsolute(v[key])&&resolve(v[key])===v[key]&&v[key].length<=4096&&!/[\0\r\n]/.test(v[key]));}return v;
}
export function finalizeAuthentication(receipt,primary,before,after,readFailure=null){
 try{if(readFailure)throw readFailure;const keys=['input','driver','compiled','build','configuration','node'];assert.deepEqual(Object.keys(before).sort(),keys.sort());assert.deepEqual(Object.keys(after).sort(),keys.sort());for(const key of keys){assert.notEqual(before[key],undefined,'available initial '+key);assert.notEqual(after[key],undefined,'available final '+key);assert.deepEqual(after[key],before[key],'final '+key);}}
 catch(e){receipt.finalAuthenticationError=String(e);receipt.status='FAIL';return primary??e;}return primary;
}
async function run(input,inputPath){
 validateInput(input);assert.equal(realpathSync(process.argv[1]),realpathSync(fileURLToPath(import.meta.url)));assert.equal(process.version,'v22.23.3');assert.deepEqual(process.execArgv,['--max-old-space-size=128']);for(const key of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE'])assert.ok(!process.env[key]);
 const parent=resolve(input.output,'..');assert.ok(lstatSync(parent).isDirectory());assert.equal(realpathSync(parent),parent);mkdirSync(input.output,{recursive:false});
 const receipt={schema:'bw.ram-bootstrap.native-js-correctness.v1',status:'FAIL',input,buildRun,policy:ramParityPolicy,resetSource,providerAdapter:{parentSha256:builtProviderSha256,sha256:sha(deriveDriverProvider().bytes)},boundaries:[],cuts:[],cleanup:{}};receipt.inputSha256Before=sha(regularBytes(inputPath,16384));assert.deepEqual(JSON.parse(regularBytes(inputPath,16384)),input);
 const write=()=>{const bytes=serialize(receipt)+'\n';assert.ok(Buffer.byteLength(bytes)<=16<<20);writeFileSync(resolve(input.output,receipt.status==='PASS'?'capture.json':'first-divergence.json'),bytes,{flag:'wx'});};
 let provider,oracle,api,identity,compiled,primary=null,native,progress={n:0,q:0},resumes=0,zeroQ=0;
 const compare=(kind)=>{const board=provider.checkpoint(),js=oracle.checkpoint(),page=provider.ramPage();receipt.lastComparison={kind,native,board,javascript:js,nativeRamPage:page};compareBoundary(native,board,js,page);receipt.boundaries.push(receipt.lastComparison);const name=cutName(js.cpu);if(name&&!receipt.cuts.some(c=>c.name===name)){assert.equal(name,namedCuts[receipt.cuts.length]?.name,'ordered actual cuts');receipt.cuts.push({name,q:js.q,native,board,javascript:js});}};
 try{
  receipt.driverBefore=driverSourceIdentity();assert.equal(receipt.driverBefore.revision,input.driverRevision);assert.equal(sha(Buffer.from(JSON.stringify(receipt.driverBefore))),input.driverSourceSha256);receipt.node=realpathSync(process.execPath);receipt.nodeBefore=sha(regularBytes(receipt.node,128<<20));
  const b=regularBytes(input.preparedManifest,1<<20);assert.equal(sha(b),input.preparedManifestSha256);const manifest=JSON.parse(b);receipt.compiledBefore=authenticateRamCompiled(input.compiledRoot,manifest);
  identity=await import(pathToFileURL(resolve(input.compiledRoot,'scripts/bochs-cpu3-native-ram-bootstrap/build-identity.mjs')).href);compiled=identity.sourceIdentity();assert.deepEqual(compiled,receipt.compiledBefore);
  receipt.build=identity.authenticateBuild(input,compiled);receipt.configuration=identity.authenticateConfiguration(input.configuration,manifest);assert.equal(sha(regularBytes(input.addon)),addonSha256);assert.equal(sha(regularBytes(resolve(manifest.preparedTree,resetSource.path))),resetSource.sha256);
  assert.equal(manifest.actualPreparedHashes['bochs/owned-ram-provider.mjs'],builtProviderSha256);assert.equal(manifest.actualPreparedHashes['bochs/owned-ram-ROM.bin'],ramRomSha256);
  provider=await createDriverRamProvider();oracle=createRamOracle();assert.equal(sha(provider.rom),ramRomSha256);api=createRequire(import.meta.url)(input.addon);assert.equal(api.abiVersion,4);for(const name of ['create','resume','setIRQ','inspect','close'])assert.equal(typeof api[name],'function');
  native=api.create(input.configuration,provider.rom,provider.callbacks,false);assert.equal(Number(native.nativeTicks),0);assert.equal(Number(native.successfulQuanta),0);wholeNativeWords(native);compare('reset');
  while(cutName(oracle.checkpoint().cpu)!=='before-HLT'){
   assert.ok(resumes<1024&&zeroQ<512,'bounded actual resume protocol');const stage=provider.stage();assert.deepEqual(stage,oracle.stage(),'actual PIC line');assert.equal(stage.asserted,false,'fixture IRQ outside scope');if(stage.changed){native=api.setIRQ(stage.asserted);compare('line');}
   // Full actual staged board, not only timing scalars.
   assert.deepEqual(provider.checkpoint().board,oracle.checkpoint().board,'whole staged board');provider.begin();let resumeError=null;
   try{native=api.resume(1,1,0xffffffffffffffffn);}catch(e){resumeError=e;receipt.resumeError=String(e);throw e;}finally{try{provider.end();}catch(e){receipt.endError=String(e);if(!resumeError)throw e;}}
   resumes++;const next=ramProgress(progress,native);if(next.dq)assert.equal(oracle.step().q,next.q);else zeroQ++;progress=next;compare('resume');
  }
  receipt.lastReturnedNative=native;assert.equal(native.activityState,0);native=api.inspect();assert.deepEqual(wholeNativeWords(native),wholeNativeWords(receipt.lastReturnedNative),'paused inspect unchanged166');assert.equal(Number(native.nativeTicks),progress.n);assert.equal(Number(native.successfulQuanta),progress.q);receipt.finalNative=native;compare('final-inspect');receipt.milestones=validateMilestones(receipt.cuts);receipt.progress={...progress,resumes,zeroQ};
  receipt.nativeFinal=provider.settleCheckpoint();receipt.javascriptFinal=oracle.settle();receipt.nativeFinal.ramPage=provider.ramPage();assert.deepEqual(receipt.nativeFinal.state.board,receipt.javascriptFinal.board,'full settled board');assert.deepEqual(receipt.nativeFinal.ramPage,receipt.javascriptFinal.ramPage,'whole direct final RAM page');assert.equal(receipt.nativeFinal.ramSha256,receipt.javascriptFinal.ramSha256,'whole raw physical RAM hash');assert.deepEqual(provider.records(),[],'no PIO');receipt.status='PASS';
 }catch(e){primary=e;receipt.error=String(e);receipt.progress={...progress,resumes,zeroQ};if(native)receipt.lastSuccessfullyReturnedNative=native;for(const [key,fn]of [['partialProvider',()=>({state:provider.checkpoint(),ramPage:provider.ramPage(),ports:provider.records()})],['partialJavascript',()=>oracle.checkpoint()]])try{receipt[key]=fn();}catch(partial){receipt[key+'Unavailable']=String(partial);}}
 finally{
  // Cleanup and post-authentication never replace the first divergence.
  for(const [key,object]of [['native',api],['provider',provider],['javascript',oracle]])if(object)try{object.close();receipt.cleanup[key]='closed';}catch(e){receipt.cleanup[key+'Error']=String(e);if(!primary)primary=e;}
  let readFailure=null;receipt.finalReadErrors={};const probe=(key,fn)=>{try{receipt[key]=fn();}catch(e){receipt.finalReadErrors[key]=String(e);readFailure??=e;}};
  probe('inputSha256After',()=>sha(regularBytes(inputPath,16384)));probe('driverAfter',driverSourceIdentity);probe('nodeAfter',()=>sha(regularBytes(receipt.node,128<<20)));
  if(identity){probe('compiledAfter',()=>identity.sourceIdentity());probe('buildAfter',()=>identity.authenticateBuild(input,compiled??receipt.compiledAfter));probe('configurationAfter',()=>identity.authenticateConfiguration(input.configuration,identity.boundedJson(input.preparedManifest,input.preparedManifestSha256)));}
  primary=finalizeAuthentication(receipt,primary,{input:receipt.inputSha256Before,driver:receipt.driverBefore,compiled:receipt.compiledBefore,build:receipt.build,configuration:receipt.configuration,node:receipt.nodeBefore},{input:receipt.inputSha256After,driver:receipt.driverAfter,compiled:receipt.compiledAfter,build:receipt.buildAfter,configuration:receipt.configurationAfter,node:receipt.nodeAfter},readFailure);
  if(primary)receipt.status='FAIL';write();
 }
 if(primary)throw primary;return receipt;
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){assert.equal(process.argv.length,3);await run(JSON.parse(regularBytes(process.argv[2],16384)),process.argv[2]);}
