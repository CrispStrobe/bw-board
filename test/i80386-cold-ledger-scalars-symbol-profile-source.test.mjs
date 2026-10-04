import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WindowSession,perfImageSha256} from '../scripts/cold-native-ledger-scalars-symbol-profile/window-session.mjs';
import {validateDiagnosticMetadata} from '../scripts/cold-native-ledger-scalars-symbol-profile/admission.mjs';
const own=new URL('../scripts/cold-native-ledger-scalars-symbol-profile/',import.meta.url),read=n=>readFileSync(new URL(n,own),'utf8'),hash=x=>createHash('sha256').update(x).digest('hex');
function manufactured(change=()=>{},close=()=>{}){
 let clock=0n;const nonce='a'.repeat(64),requests=[];
 const io={async exchange(m){requests.push(m);const response={schema:m.schema,type:{hello:'ready',enable:'enabled',disable:'disabled'}[m.type],seq:m.seq,pid:process.pid,session:nonce,controllerMonotonicNs:String(++clock)};if(m.type==='hello')response.proof={disabledAck:true,effectivePerfSha256:perfImageSha256,uid:process.getuid(),gid:process.getgid(),threadIds:[process.pid]};change(response,m);return response;},close};
 return {session:new WindowSession(io,()=>String(++clock)),requests};
}
test('count-bound complete worker inverse preserves exact held timer and while',()=>{
 const d=JSON.parse(read('worker-derivation.json')),held=readFileSync(new URL('../../'+d.heldPath,own),'utf8');assert.equal(hash(held),d.heldSha256);let candidate=held;
 for(const seam of d.seams){assert.equal(seam.count,1);assert.equal(candidate.split(seam.held).length-1,1);candidate=candidate.replace(seam.held,seam.candidate);}
 assert.equal(candidate,read('worker.mjs'));assert.equal(hash(candidate),d.candidateSha256);
 const begin='  const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();',end='receipt.lastReturnedNative=native;}';
 const block=s=>s.slice(s.indexOf(begin),s.indexOf(end)+end.length);assert.ok(block(held).includes('while(progress.q<targetQ)'));assert.equal(block(candidate),block(held));
});
test('owned source metadata is pending; manufactured READY cannot change fixed pins',()=>{
 const pending=JSON.parse(read('profile-binding.json'));assert.throws(()=>validateDiagnosticMetadata(pending),/PENDING/);const ready={...pending,status:'ROOT_REVIEWED_NATIVE_SYMBOL_DIAGNOSTIC_READY'};validateDiagnosticMetadata(ready);
 for(const [key,value] of [['baseWorkerRevision','0'.repeat(40)],['output','/tmp/caller'],['addonSha256','0'.repeat(64)],['defaultEnabled',true]])assert.throws(()=>validateDiagnosticMetadata({...ready,[key]:value}));
});
test('manufactured disabled-ready ACK precedes enable and stop retains separate clocks',async()=>{
 const {session,requests}=manufactured();await session.prepare();assert.equal(session.begin,null);await session.enable();await session.stop();session.assertComplete();assert.deepEqual(requests.map(r=>[r.type,r.seq]),[['hello',0],['enable',1],['disable',2]]);assert.ok(BigInt(session.end)>=BigInt(session.begin));assert.match(session.report().clockScope,/separate/);
});
test('wrong sequence, PID, proof, nonce and extra ACK fields refuse before enable',async()=>{
 for(const change of [r=>r.seq++,r=>r.pid++,r=>r.proof.disabledAck=false,r=>r.session='bad',r=>r.extra=true]){const {session,requests}=manufactured(change);await assert.rejects(session.prepare());assert.equal(requests.length,1);await assert.rejects(session.enable());assert.equal(requests.length,1,'failed readiness cannot send enable');await session.stop();assert.equal(session.report().status,'FAIL');assert.equal(session.report().errors[0].phase,'prepare');assert.equal(session.report().errors[1].phase,'enable');}
});
test('actual mocked guest throw retains original Error through stop and disconnect failure',async()=>{
 const guest=Error('original guest'),{session}=manufactured((r,m)=>{if(m.type==='disable')throw Error('manufactured stop failure');},()=>{throw Error('manufactured disconnect failure');});await session.prepare();await session.enable();let caught;
 try{try{throw guest;}finally{await session.stop();}}catch(error){caught=error;}
 assert.equal(caught,guest);assert.deepEqual(session.report().errors.map(e=>e.phase),['disable','disconnect']);assert.throws(()=>session.assertComplete());
});
test('stop failure permits attainable terminal proof before observer completion refuses',async()=>{
 const {session}=manufactured((r,m)=>{if(m.type==='disable')throw Error('stop failed');});await session.prepare();await session.enable();let proof=false;
 try{assert.equal(1,1);}finally{await session.stop();}proof=true;assert.equal(proof,true);assert.throws(()=>session.assertComplete());assert.equal(session.report().status,'FAIL');
});
test('six Python controller methods use manufactured dependencies; raw nested tape retained',()=>{
 const result=spawnSync('python3',['-I','-B','-c',"import sys,unittest;sys.dont_write_bytecode=True;sys.path.insert(0,sys.argv[1]);import test_recorder;unittest.main(module=test_recorder,argv=['control'],exit=True)",fileURLToPath(own)],{encoding:'utf8',timeout:15000,maxBuffer:2<<20,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1',LC_ALL:'C'}});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);assert.equal(result.status,0);assert.match(result.stderr,/Ran 6 tests/);assert.match(result.stderr,/OK/);
});
