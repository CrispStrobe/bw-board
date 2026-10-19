# Source-only exact derivatives. Never imports/loads addon or executes a guest.
from pathlib import Path
import json,hashlib,subprocess,re
P=Path(__file__).resolve().parent;W=Path('/tmp/bw-board-386-native-owned-clock-20261002');revision='7df84bc2c367aff1cadec7cecdde69cf0e904ace'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==revision
assert not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip()
source=json.loads(Path('/mnt/volume1/tmp-astra/native-owned-clock-source-20261002/source-freeze.json').read_text())['identity'];assert source['revision']==revision
for path,h in source['hashes'].items():assert sha((W/path).read_bytes())==h
paths={'provider.mjs':'scripts/bochs-cpu3-native-owned-clock/provider.mjs','worker.mjs':'scripts/bochs-cpu3-native-owned-clock/worker.mjs','factory.mjs':'scripts/bochs-cpu3-native-owned-clock/factory.mjs','driver.mjs':'scripts/run-i80386-native-owned-clock.mjs'}
receipts={}
for name,path in paths.items():
 original=(W/path).read_text();s=original;edits=[]
 def once(old,new,label):
  global s
  assert s.count(old)==1,(name,label,s.count(old));s=s.replace(old,new);edits.append({'old':old,'new':new,'label':label})
 # Relocate all static relative import sources; derivative peers remain local.
 for m in list(re.finditer(r"(?:from\s+|import\s*)['\"](\.[^'\"]+)['\"]",original)):
  relative=m[1];target=(W/path).parent.joinpath(relative).resolve();peer=next((n for n,p in paths.items() if W/p==target),None)
  once("'"+relative+"'","'"+('./'+peer if peer else target.as_uri())+"'",'source-bound import '+relative)
 once("import assert from 'node:assert/strict';","import assert from 'node:assert/strict';\nimport {now,add,measure,snapshot as attributionSnapshot,reset as attributionReset} from './timing.mjs';",'diagnostic clock import')
 if name=='provider.mjs':
  once('  clockTransfer(words,reason){','  clockTransfer(words,reason){\n   const attributionClockStart=now();try{','clock inclusive entry')
  once('   assert.ok(!closed&&!active,\'clock reentry\');','   const attributionPreflightStart=now();\n   assert.ok(!closed&&!active,\'clock reentry\');','preflight entry')
  once('   n=nextN;q=nextQ;mappingPending=nextMapping;active=true;try{','   add("provider.clock.preflight",attributionPreflightStart);\n   n=nextN;q=nextQ;mappingPending=nextMapping;active=true;try{','preflight exit')
  once("    for(const word of words)call(word===1?'nativeTick':'quantum',word===1?[]:[word===3?1:0]);","    const attributionReplayStart=now();\n    for(const word of words)call(word===1?'nativeTick':'quantum',word===1?[]:[word===3?1:0]);\n    add(\"provider.clock.ordered-replay\",attributionReplayStart);\n    const attributionReplyStart=now();",'ordered replay timing')
  once('    return Uint32Array.from(s);','    const attributionReply=Uint32Array.from(s);add("provider.clock.state-reply",attributionReplyStart);return attributionReply;','state reply timing')
  once('   }finally{active=false;}\n  }','   }finally{active=false;}\n   }finally{add("provider.clock.inclusive",attributionClockStart);}\n  }','clock inclusive exit')
 if name=='worker.mjs':
  once("import {createHash} from 'node:crypto';","import {createHash} from 'node:crypto';\nimport {Session} from 'node:inspector';\nimport {writeFileSync} from 'node:fs';",'optional inspector imports')
  once('const reset=native.create(input.configuration,provider.rom,provider.callbacks,input.nativeTrace);','const reset=native.create(input.configuration,provider.rom,provider.callbacks,input.nativeTrace);\nattributionReset();','exclude startup INIT timing only');
  once('let sequence=0,closed=false,active=false,terminal=false;', '''const attributionSession=process.env.BW_OWNED_ATTRIBUTION_PROFILE==='1'?new Session():null;
const attributionPost=method=>new Promise((resolve,reject)=>attributionSession.post(method,(error,result)=>error?reject(error):resolve(result)));
// Inspector setup/start are startup, before parent execution CPU window.
if(attributionSession){attributionSession.connect();await attributionPost('Profiler.enable');await attributionPost('Profiler.start');}
let sequence=0,closed=false,active=false,terminal=false;''','profile startup window')
  once("parentPort.on('message',m=>{","parentPort.on('message',async m=>{\n const attributionMessageStart=now();",'worker request entry')
  once('const {n,q,deadline}=JSON.parse(m.payload);','const {n,q,deadline}=measure("worker.resume.parse",()=>JSON.parse(m.payload));','request parse')
  once('const staged=provider.stage();if(staged.changed)native.setIRQ(staged.asserted);provider.begin();','const attributionStageStart=now();const staged=provider.stage();if(staged.changed)native.setIRQ(staged.asserted);provider.begin();add("worker.resume.stage-begin",attributionStageStart);','stage begin timing')
  once('try{result=native.resume(n,q,d);}finally{provider.end();}','try{result=measure("worker.native-resume.inclusive",()=>native.resume(n,q,d));}finally{measure("worker.resume.end",()=>provider.end());}','inclusive native and end')
  once("}else if(m.command==='checkpoint'){assert.equal(m.payload,'');result=provider.checkpoint();}","}else if(m.command==='checkpoint'){assert.equal(m.payload,'');result=measure('worker.checkpoint.board',()=>provider.checkpoint());}\n  else if(m.command==='attribution-stop'){assert.equal(m.payload,'');assert.ok(terminal);if(attributionSession){const profile=(await attributionPost('Profiler.stop')).profile;attributionSession.disconnect();writeFileSync(input.journal+'.worker.cpuprofile',JSON.stringify(profile),{flag:'wx'});}result={scope:'inclusive wall buckets overlap; profile startup/stop outside parent executionCPU, before settlement',worker:attributionSnapshot(),profile:!!attributionSession};}",'diagnostic finish outside execution')
  once('active=false;parentPort.postMessage({id:m.id,payload:serialize(result)});','active=false;const attributionPayload=measure("worker."+m.command+".serialize",()=>serialize(result));add("worker."+m.command+".processing-to-ready",attributionMessageStart);measure("worker."+m.command+".post-enqueue",()=>parentPort.postMessage({id:m.id,payload:attributionPayload}));','worker serialization enqueue')
 if name=='factory.mjs':
  once('const p=pending;pending=null;clearTimeout(p.timer);if(m.error)', 'const p=pending;pending=null;add("factory."+p.command+".roundtrip",p.attributionStart);clearTimeout(p.timer);if(m.error)','request roundtrip timing')
  once('pending={id:requestId,resolve,reject,timer};','pending={id:requestId,resolve,reject,timer,command,attributionStart:now()};','pending start')
  once("async checkpoint(){return request('checkpoint');}","async checkpoint(){return request('checkpoint');},async finishAttribution(){return request('attribution-stop');},attribution(){return attributionSnapshot();}",'diagnostic method separate from guest execution')
 if name=='driver.mjs':
  once("assert.ok(!input.profile,'no profiler protocol');","assert.ok(!input.profile,'no profiler protocol');assert.equal(input.hostJournal,false);assert.equal(input.nativeTrace,false);",'CAPOFF required')
  once('final=JSON.parse(await handle.resume(JSON.stringify({n:600,q:Math.min(300,remaining),deadline:\'18446744073709551615\'})));resumes++;', 'const attributionRequest=measure("parent.resume.request-json",()=>JSON.stringify({n:600,q:Math.min(300,remaining),deadline:\'18446744073709551615\'}));const attributionResponse=await handle.resume(attributionRequest);final=measure("parent.resume.response-json",()=>JSON.parse(attributionResponse));resumes++;','parent resume JSON timing')
  once('board:JSON.parse(await handle.checkpoint())','board:measure("parent.checkpoint.response-json",()=>JSON.parse(attributionCheckpointResponse))','checkpoint parse')
  once('checkpoints.push({kind:', 'const attributionCheckpointResponse=await handle.checkpoint();checkpoints.push({kind:','checkpoint same cut')
  once(' const settlementStart=process.hrtime.bigint()', ''' // Diagnostic finalization is after executionCPU capture and before settlement.
 const attributionFinalizeStart=process.hrtime.bigint(),attributionFinalizeCPUStart=process.cpuUsage();const attributionWorker=JSON.parse(await handle.finishAttribution());const attributionFinalizeNs=Number(process.hrtime.bigint()-attributionFinalizeStart),attributionFinalizeCPU=process.cpuUsage(attributionFinalizeCPUStart);
 const attributionIdentity=JSON.parse(readFileSync(new URL('./attribution-identity.json',import.meta.url)));const attribution={identity:attributionIdentity,worker:attributionWorker,parent:attributionSnapshot(),executionSumExclusions:['factory.attribution-stop.roundtrip','worker.attribution-stop.*','diagnosticFinalize'],diagnosticFinalize:{ns:attributionFinalizeNs,cpu:attributionFinalizeCPU},scope:'diagnostic timers/profile overhead; same whole-resume IPC and six cuts; not another speed gate'};
 const settlementStart=process.hrtime.bigint()''','profile stop separate window')
  once("const report={status:'UNQUALIFIED_ABI3_NATIVE_CANDIDATE',", "const report={attribution,status:'UNQUALIFIED_ABI3_NATIVE_CANDIDATE',",'attribution report')
 inverse=s
 for e in reversed(edits):assert inverse.count(e['new'])==1,(name,e['label']);inverse=inverse.replace(e['new'],e['old'])
 assert inverse==original,name
 (P/name).write_text(s)
 receipts[name]={'sourcePath':path,'sourceSha256':sha(original.encode()),'derivedSha256':sha(s.encode()),'exactInverse':True,'edits':edits}
for path,h in source['hashes'].items():assert sha((W/path).read_bytes())==h
result={'status':'SOURCE_ONLY_EXACT_DERIVATIVES_NO_ADDON_OR_PROFILE_EXECUTION','revision':revision,'sourceHashes':source['hashes'],'generatorSha256':sha(Path(__file__).read_bytes()),'timingSha256':sha((P/'timing.mjs').read_bytes()),'derivatives':receipts}
(P/'derivation.json').write_text(json.dumps(result,indent=2)+'\n');print('PASS',len(receipts),'inverse derivatives',len(source['hashes']),'frozen inputs')
