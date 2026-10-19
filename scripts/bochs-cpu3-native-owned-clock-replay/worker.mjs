/** Private actual board replay realm. No native addon is imported or CPU stepped. */
import assert from 'node:assert/strict';
import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {HotDirectBoardFacade} from '../bochs-cpu3-native-hot-direct/board.mjs';
import {assembleCombinedHotRom} from '../i80386-free-combined-hot.mjs';
import {parseCommand,preflightResume,serialize} from './protocol.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(readFileSync(new URL(import.meta.url))),workerData.workerSha256,'raw worker source binding');
const {rom,sha256}=assembleCombinedHotRom();assert.equal(sha256,'0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631','owned fixed ROM');
const digest=createHash('sha256');let journalBytes=0,lines=[],resume=0,sequence=0,closed=false,active=false;
const board=new HotDirectBoardFacade(rom,{compactSink:e=>{const line=serialize([e.ordinal,e.operation,e.args,e.result,e.nativeTicks,e.successfulQuanta,e.boardCycles,e.debt,e.mappingEpoch],(_,v)=>v instanceof Uint8Array?[...v]:v)+'\n';assert.ok(journalBytes+Buffer.byteLength(line)<=32*1024*1024,'logical journal bound');journalBytes+=Buffer.byteLength(line);digest.update(line);lines.push(line);}});
const apply=Reflect.apply,methods=Object.fromEntries(['stageLine','beginRun','endRun','nativeTick','quantum','readPhysical','writePhysical','admitExecutePage','outPort','acknowledgeIrq','inspect','settleTerminal','close'].map(k=>[k,board[k]]));
const call=(name,args=[])=>apply(methods[name],board,args);
let lastExit=null;const state=()=>({resume,ordinal:board.compactCount,n:board.nativeTicks,q:board.successfulQuanta,epoch:board.mappingEpoch,a20:Number(board.machine._a20Enabled)});
const fenceMatch=f=>{for(const [k,value] of Object.entries({n:board.nativeTicks,q:board.successfulQuanta,cycles:board.machine.cycles,debt:board.machine._chipDebt,deadline:board.machine._chipDeadline,epoch:board.mappingEpoch,a20:Number(board.machine._a20Enabled)}))assert.equal(f[k],value,'actual fence '+k);};
const snapshot=()=>serialize({state:call('inspect'),ramSha256:sha(board.machine.mem),source:{workerSha256:workerData.workerSha256,romSha256:sha256},logicalJournal:{rows:board.compactCount,bytes:journalBytes}});
parentPort.postMessage({ready:true,snapshot:snapshot()});
parentPort.on('message',message=>{
 try{
  assert.ok(!closed&&!active,'private lifecycle/reentry');assert.equal(message.id,++sequence,'request sequence');active=true;let payload;
  if(message.command==='resume'){
   assert.ok(!lastExit||lastExit.reason!==4||lastExit.chargedNativeTicks!==0||lastExit.chargedQuanta!==0,'resume after supplied terminal witness');const parsed=parseCommand(message.payload),plan=preflightResume(parsed,state());lines=[];
   call('stageLine');call('beginRun');
   fenceMatch(plan.entry);
   try{
    for(const action of plan.actions){
     const rows=action.type==='clock-batch'?action.rows:[action.row];
     for(const row of rows){const [,op,args]=row;if(op==='nativeTick')call('nativeTick');else if(op==='quantum')call('quantum',args);else if(op==='read')call('readPhysical',args.slice(0,2));else if(op==='write')call('writePhysical',[args[0],Uint8Array.from(args[2])]);else if(op==='page')call('admitExecutePage',args);else if(op==='outPort')call('outPort',args);else call('acknowledgeIrq');assert.deepEqual(JSON.parse(lines.at(-1)),row,'exact logical callback expansion');}
    }
   }finally{call('endRun');}
   resume=plan.resume;fenceMatch(plan.exit);lastExit=plan.exit;payload=serialize({journal:lines.join(''),state:call('inspect'),orderedClockGroups:plan.actions.filter(a=>a.type==='clock-batch').length,scope:'offline ordered replay, not legal native batch spans'});
  }else if(message.command==='inspect'){assert.equal(message.payload,'','inspect has no arguments');payload=snapshot();}
  else if(message.command==='close'){assert.equal(message.payload,'','close has no arguments');assert.ok(lastExit&&lastExit.reason===4&&lastExit.chargedNativeTicks===0&&lastExit.chargedQuanta===0,'close requires terminal zero-work HLT return');assert.ok(board.nativeTicks===100684&&board.successfulQuanta===100682&&Buffer.from(board.marker).toString('ascii')==='RPGH001','close requires complete fixed historical workload');call('settleTerminal');payload=serialize({state:call('inspect'),ramSha256:sha(board.machine.mem),journal:{rows:board.compactCount,bytes:journalBytes,sha256:digest.digest('hex')}});call('close');closed=true;}
  else assert.fail('unknown request');
  active=false;parentPort.postMessage({id:message.id,payload});
 }catch(error){closed=true;active=false;parentPort.postMessage({id:message.id,error:error.message});parentPort.close();}
});
