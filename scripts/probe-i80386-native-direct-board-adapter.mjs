/** Child-only entry point: native fatal failures must never share the coordinator. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadDirectNative} from './bochs-cpu3-native-direct-board-adapter/loader.mjs';
import {DirectBoardFacade} from './bochs-cpu3-native-direct-board/board.mjs';
import {assembleCombinedPagingRamRom} from './i80386-combined-paging-ram-oracle.mjs';
const clock=()=>process.hrtime.bigint();
const stages={},elapsed=start=>Number(clock()-start);
const options=JSON.parse(readFileSync(process.argv[2],'utf8'));
const check=(ok,message)=>{if(!ok)throw Error(message);};
check(['run','bad-page-sha','callback-throw','callback-reentry','second-create'].includes(options.control),'unknown child control');
check([1,2,257,300].includes(options.quanta),'unknown quantum budget');
let started=clock();const {rom}=assembleCombinedPagingRamRom();stages.assemblyNs=elapsed(started);
started=clock();const native=loadDirectNative(options.addon,options.sha256);stages.addonLoadNs=elapsed(started);
started=clock();
const callbacks=[],board=new DirectBoardFacade(rom,{capture:options.capture?event=>callbacks.push(event):null});stages.boardConstructionNs=elapsed(started);
const callbackCounts={};const originalCall=board._call;board._call=function(operation,...args){callbackCounts[operation]=(callbackCounts[operation]??0)+1;return originalCall.call(this,operation,...args);};
check(!options.measurement||(!options.capture&&options.control==='run'),'measurement requires capture-off successful run');
if(options.control==='bad-page-sha'){const original=board.admitExecutePage.bind(board);board.admitExecutePage=raw=>({...original(raw),sha256:'0'.repeat(64)});}
if(options.control==='callback-throw')board.admitExecutePage=()=>{throw Error('intentional direct callback failure');};
if(options.control==='callback-reentry'){const original=board.admitExecutePage.bind(board);board.admitExecutePage=raw=>{native.inspect();return original(raw);};}
started=clock();const reset=native.create(options.configuration,rom,board,options.capture);stages.nativeStartupNs=elapsed(started);
if(options.control==='second-create'){let rejected=false;try{native.create(options.configuration,rom,board,false);}catch(error){rejected=/one create lifetime/.test(error.message);}check(rejected,'second create did not reject');native.close();board.close();writeFileSync(options.output,JSON.stringify({control:options.control,rejected}));}
else{
 const checkpoints=[];let final,terminal=false,resumes=0;started=clock();
 for(let i=0;i<600;i++){const line=board.stageLine();if(line.changed)native.setIRQ(line.asserted);board.beginRun();try{final=native.resume(600,options.quanta,0xffffffffffffffffn);}finally{board.endRun();}resumes++;if(!options.measurement)checkpoints.push({native:final,board:board.inspect()});if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}}
 stages.executionNs=elapsed(started);
 check(terminal,'direct child bound exhausted');check(options.control==='run','fatal control unexpectedly returned');
 started=clock();const settled=board.settleTerminal(),ramSha256=createHash('sha256').update(board.machine.mem).digest('hex');
 stages.settlementAndRamHashNs=elapsed(started);native.close();board.close();
 started=clock();writeFileSync(options.output,JSON.stringify({status:'UNQUALIFIED_DIRECT_DIAGNOSTIC',capture:options.capture,quanta:options.quanta,reset,final,checkpoints,settled,ramSha256,callbacks,callbackCounts,resumes,measurement:!!options.measurement},(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:v));stages.serializationAndWriteNs=elapsed(started);
 writeFileSync(options.output+'.timing.json',JSON.stringify({unit:'nanoseconds',stages,executionScope:'bounded guest with actual board callbacks, scheduler, Node-to-native calls and native snapshot conversion on resume; excludes startup, terminal settlement, RAM hash and serialization',warmupScope:'fresh process, never warmed native lifetime'}));
}
