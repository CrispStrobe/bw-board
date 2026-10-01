/** Child-only entry point: native fatal failures must never share the coordinator. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadDirectNative} from './bochs-cpu3-native-direct-board-adapter/loader.mjs';
import {DirectBoardFacade} from './bochs-cpu3-native-direct-board/board.mjs';
import {assembleCombinedPagingRamRom} from './i80386-combined-paging-ram-oracle.mjs';
const options=JSON.parse(readFileSync(process.argv[2],'utf8'));
const check=(ok,message)=>{if(!ok)throw Error(message);};
check(['run','bad-page-sha','callback-throw','callback-reentry','second-create'].includes(options.control),'unknown child control');
check([1,2,257,300].includes(options.quanta),'unknown quantum budget');
const native=loadDirectNative(options.addon,options.sha256),{rom}=assembleCombinedPagingRamRom();
const callbacks=[],board=new DirectBoardFacade(rom,{capture:options.capture?event=>callbacks.push(event):null});
if(options.control==='bad-page-sha'){const original=board.admitExecutePage.bind(board);board.admitExecutePage=raw=>({...original(raw),sha256:'0'.repeat(64)});}
if(options.control==='callback-throw')board.admitExecutePage=()=>{throw Error('intentional direct callback failure');};
if(options.control==='callback-reentry'){const original=board.admitExecutePage.bind(board);board.admitExecutePage=raw=>{native.inspect();return original(raw);};}
const reset=native.create(options.configuration,rom,board,options.capture);
if(options.control==='second-create'){let rejected=false;try{native.create(options.configuration,rom,board,false);}catch(error){rejected=/one create lifetime/.test(error.message);}check(rejected,'second create did not reject');native.close();board.close();writeFileSync(options.output,JSON.stringify({control:options.control,rejected}));}
else{
 const checkpoints=[];let final,terminal=false;
 for(let i=0;i<600;i++){const line=board.stageLine();if(line.changed)native.setIRQ(line.asserted);board.beginRun();try{final=native.resume(600,options.quanta,0xffffffffffffffffn);}finally{board.endRun();}checkpoints.push({native:final,board:board.inspect()});if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}}
 check(terminal,'direct child bound exhausted');check(options.control==='run','fatal control unexpectedly returned');
 const settled=board.settleTerminal(),ramSha256=createHash('sha256').update(board.machine.mem).digest('hex');
 native.close();board.close();
 writeFileSync(options.output,JSON.stringify({status:'UNQUALIFIED_DIRECT_DIAGNOSTIC',capture:options.capture,quanta:options.quanta,reset,final,checkpoints,settled,ramSha256,callbacks},(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:v));
}
