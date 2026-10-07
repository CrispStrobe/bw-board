/** One bounded actual native/JS paged IRQ guest. Import never loads an addon. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {sourceIdentity,authenticateBuild,authenticateConfiguration,boundedJson,regularBytes} from './build-identity.mjs';
import {createDriverPagedIrqProvider,deriveDriverProvider} from './driver-provider.mjs';
import {createPagedIrqOracle} from './reference.mjs';
import {nativePagedIrqProfile} from './provider-profile.mjs';
import {namedCuts,layout,selector,interruptEip,terminalEip} from './profile.mjs';
import {irqProgress,compareCut,validateNativeMemory,terminal,wholeNativeWords} from './parity.mjs';
import {writePausedEvidence} from './pause-evidence.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():ArrayBuffer.isView(x)?Array.from(x):x);
const canon=p=>{assert.ok(typeof p==='string'&&isAbsolute(p)&&resolve(p)===p&&!/[\0\r\n]/.test(p));return p;};
export function nextNamedCut(seen,cs,eip){assert.ok(Array.isArray(seen));return namedCuts.find(c=>c.cs===cs&&c.eip===eip&&!seen.includes(c.name))??null;}
function persist(receipt,output){
 const base={schema:'bw.paged-irq.actual-outcome.v1',status:receipt.status,error:receipt.error??null,
  sourceRevision:receipt.source?.revision??null,resumes:receipt.progress?.resumes??0,n:receipt.progress?.n??0,q:receipt.progress?.q??0,bodyComplete:false};
 writeFileSync(resolve(output,'outcome.json'),json(base)+'\n',{flag:'wx'});
 const raw=Buffer.from(json(receipt)+'\n');assert.ok(raw.length<=64<<20,'bounded lossless receipt');
 const packed=gzipSync(raw,{level:6});assert.ok(packed.length<=16<<20,'bounded compressed receipt');
 const name=receipt.status==='PASS'?'capture.json.gz':'first-divergence.json.gz';
 writeFileSync(resolve(output,name),packed,{flag:'wx'});
 writeFileSync(resolve(output,'outcome-update.json'),json({...base,bodyComplete:true,body:name,decodedBytes:raw.length,decodedSha256:sha(raw),storedBytes:packed.length,storedSha256:sha(packed)})+'\n',{flag:'wx'});
}
export async function runPagedIrqFixture(input,configuration,output){
 for(const p of [configuration,output,input.addon,input.preparedManifest,input.buildReceipt])canon(p);
 assert.ok(lstatSync(resolve(output,'..')).isDirectory());mkdirSync(output,{recursive:false});
 assert.equal(process.version,'v22.23.3');assert.deepEqual(process.execArgv,['--max-old-space-size=128']);
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(head,process.env.BW_EXPECTED_HEAD,'immutable reviewed checkout');
 assert.equal(realpathSync(fileURLToPath(import.meta.url)),fileURLToPath(import.meta.url));
 const receipt={schema:'bw.paged-irq.actual-native-js.v1',status:'FAIL',source:null,build:null,configuration:null,
  profile:nativePagedIrqProfile,providerAdapterSha256:sha(deriveDriverProvider().bytes),boundaries:[],stages:[],namedCuts:[],cleanup:{}};
 let provider,oracle,api,native,progress={n:0,q:0},resumes=0,zeroQ=0,deliveryCut=null,primary=null;
 const paused=(phase,sourceLine,jsLine)=>writePausedEvidence(output,{schema:'bw.paged-irq.last-paused-boundary.v1',phase,
  source:receipt.source,build:receipt.build,configuration:receipt.configuration,input:receipt.input,
  progress:{...progress,resumes,zeroQ},native,board:provider.checkpoint(),physical:provider.ramPages(),
  javascript:oracle.checkpoint(),sourceLine,jsLine});
 const capture=(label,kind='resume',dq=1)=>{
  const board=provider.checkpoint(),js=oracle.checkpoint(),pages=provider.ramPages();
  const comparison=compareCut(native,board,pages,js,label,kind,dq);
  const record={label,native,board,physical:pages,javascript:js,comparison};receipt.boundaries.push(record);
  const cut=nextNamedCut(receipt.namedCuts.map(p=>p.name),js.cpu.cs,js.cpu.eip);
  if(cut&&!receipt.namedCuts.some(c=>c.name===cut.name))receipt.namedCuts.push({name:cut.name,index:receipt.boundaries.length-1,q:js.q,status:comparison.status});
  return record;
 };
 try{
  receipt.source=sourceIdentity();assert.equal(receipt.source.revision,head);receipt.build=authenticateBuild(input,receipt.source);
  const manifest=boundedJson(input.preparedManifest,input.preparedManifestSha256);receipt.configuration=authenticateConfiguration(configuration,manifest);
  receipt.input={addonSha256:input.sha256,preparedManifestSha256:input.preparedManifestSha256,buildReceiptSha256:input.buildReceiptSha256,configurationSha256:receipt.configuration.sha256};
  assert.equal(sha(regularBytes(input.addon,8<<20)),input.sha256);
  provider=await createDriverPagedIrqProvider();oracle=await createPagedIrqOracle();
  assert.equal(sha(provider.rom),nativePagedIrqProfile.romSha256);
  api=createRequire(import.meta.url)(input.addon);assert.equal(api.abiVersion,4);
  for(const key of ['create','resume','setIRQ','inspect','close'])assert.equal(typeof api[key],'function');
  native=api.create(configuration,provider.rom,provider.callbacks,false);wholeNativeWords(native);
  assert.deepEqual([Number(native.nativeTicks),Number(native.successfulQuanta)],[0,0]);capture('reset','reset',0);
  while(true){
   const j=oracle.checkpoint();if(j.cpu.cs===selector&&j.cpu.eip===terminalEip)break;
   assert.ok(resumes<1024&&zeroQ<512,'finite owned IRQ guest');
   if(j.cpu.cs===selector&&j.cpu.eip===interruptEip&&!j.pulsed){assert.deepEqual([progress.n,progress.q],[39,39]);provider.pulse();oracle.pulse();}
   const sourceLine=provider.stage(),jsLine=oracle.stage();
   const awaitingNested=deliveryCut!==null&&j.deliveries.length===0;
   if(awaitingNested)assert.deepEqual([sourceLine.asserted,jsLine.asserted],[false,true],'native ACK precedes JS nested delivery');
   else if(deliveryCut)assert.equal(sourceLine.asserted,jsLine.asserted,'PIC level after both real ACKs');
   else assert.deepEqual(sourceLine,jsLine,'real PIC line before actual ACK');
   receipt.stages.push({nativeTicks:progress.n,successfulQuanta:progress.q,sourceLine,jsLine,board:provider.checkpoint(),javascript:oracle.checkpoint(),status:awaitingNested?'UNMATCHED_NATIVE_ACK_AHEAD_OF_JS':'UNMATCHED_LINE_STAGE'});
   paused('before-line',sourceLine,jsLine);
   if(sourceLine.changed){native=api.setIRQ(sourceLine.asserted);wholeNativeWords(native);receipt.stages.at(-1).native=native;}
   paused('before-resume',sourceLine,jsLine);
   provider.begin();let resumeError=null;
   try{native=api.resume(1,1,0xffffffffffffffffn);}catch(e){resumeError=e;throw e;}
   finally{try{provider.end();}catch(e){if(!resumeError)throw e;receipt.endError=String(e);}}
   resumes++;const next=irqProgress(progress,native);
   if(native.reason===6){assert.equal(deliveryCut,null,'single actual zero-Q delivery');
    deliveryCut={native,board:provider.checkpoint(),physical:provider.ramPages(),nativeTicks:next.n,successfulQuanta:next.q};
    receipt.boundaries.push({label:'native-IRQ-delivery',...deliveryCut,status:'NATIVE_ZERO_Q_UNMATCHED_UNTIL_JS_NESTED_DELIVERY'});
    assert.deepEqual([native.state[13],native.state[8]],[selector,0x700a],'actual handler entry');
    receipt.namedCuts.push({name:'entered-handler',index:receipt.boundaries.length-1,q:next.q,status:'NATIVE_ZERO_Q_PENDING_NESTED_JS_CUT'});
   }else if(next.dq){const step=oracle.step();assert.equal(step.q,next.q);capture('retired-Q'+next.q,'resume',next.dq);}
   else{zeroQ++;receipt.boundaries.push({label:'native-zero-progress',native,board:provider.checkpoint(),physical:provider.ramPages(),javascript:oracle.checkpoint(),status:'UNMATCHED_ZERO_Q'});}
   progress=next;
  }
  assert.ok(deliveryCut,'real hardware IRQ delivery required');assert.deepEqual([progress.n,progress.q],[44,44]);
  receipt.lastReturnedNative=native;const inspected=api.inspect();wholeNativeWords(inspected);
  assert.deepEqual([Number(inspected.nativeTicks),Number(inspected.successfulQuanta)],[progress.n,progress.q]);native=inspected;
  capture('paused-final-inspect','final-inspect',0);
  const settled=oracle.settle(),nativeFinal=provider.settleCheckpoint();
  assert.equal(settled.nestedCuts.length,1,'one genuine nested JS IRQ cut');
  const nested=settled.nestedCuts[0];assert.deepEqual([nested.q,nested.instructionAttempt],[39,39],'pre-handler architectural cut');
  const nestedJs={q:nested.q,cpu:nested.after,board:nested.board,pages:nested.pages};
  receipt.irqCutComparison=compareCut(deliveryCut.native,deliveryCut.board,deliveryCut.physical,nestedJs,'hardware delivery','irq-delivery',0);
  assert.equal(receipt.irqCutComparison.status,'ARCHITECTURAL_CUT_PASS');
  assert.deepEqual(receipt.namedCuts.map(c=>c.name),namedCuts.map(c=>c.name),'all named architectural cuts in order');
  receipt.terminalComparison=terminal(native,nativeFinal.state,provider.ramPages(),settled);
  assert.equal(nativeFinal.ramSha256,settled.ramSha256,'whole physical RAM digest');
  assert.deepEqual(provider.records(),[],'no PIO');
  receipt.nativeMemoryEvents=provider.memoryEvents();receipt.nativeMemoryEvidence=validateNativeMemory(receipt.nativeMemoryEvents,nativeFinal.state,provider.ramPages());
  receipt.finalNative=native;receipt.nativeFinal=nativeFinal;receipt.javascriptFinal=settled;receipt.progress={...progress,resumes,zeroQ};receipt.status='PASS';
 }catch(e){primary=e;receipt.error=String(e);receipt.progress={...progress,resumes,zeroQ};
  for(const [key,fn] of [['lastNative',()=>native],['partialProvider',()=>({state:provider.checkpoint(),physical:provider.ramPages(),memoryEvents:provider.memoryEvents()})],['partialJavascript',()=>oracle.checkpoint()]])try{receipt[key]=fn();}catch(error){receipt[key+'Error']=String(error);}
 }finally{
  for(const [key,object]of [['native',api],['provider',provider],['javascript',oracle]])if(object)try{object.close();receipt.cleanup[key]='closed';}catch(e){receipt.cleanup[key+'Error']=String(e);if(!primary)primary=e;}
  try{const after=sourceIdentity();assert.deepEqual(after,receipt.source,'source unchanged after actual guest');assert.equal(sha(regularBytes(input.addon,8<<20)),input.sha256);receipt.sourceAfter=after;}
  catch(e){receipt.finalAuthenticationError=String(e);receipt.status='FAIL';if(!primary)primary=e;}
  if(primary){receipt.status='FAIL';receipt.error??=String(primary);}try{persist(receipt,output);}catch(e){receipt.persistenceError=String(e);if(!primary)primary=e;}
 }
 if(primary)throw primary;return receipt;
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 assert.equal(process.argv.length,5);await runPagedIrqFixture(JSON.parse(regularBytes(process.argv[2],16384)),process.argv[3],process.argv[4]);
}
