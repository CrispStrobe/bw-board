/** Bounded diagnostic direct callback execution. Requires an audited external addon. */
import {loadDirectNative} from './bochs-cpu3-native-direct-board-adapter/loader.mjs';
import {DirectBoardFacade} from './bochs-cpu3-native-direct-board/board.mjs';
import {assembleCombinedPagingRamRom} from './i80386-combined-paging-ram-oracle.mjs';
export function runDirectBoard({addon,sha256,configuration,capture=false,maxResumes=600}){
 if(!Number.isInteger(maxResumes)||maxResumes<1||maxResumes>600)throw Error('bounded resume count');
 const {rom}=assembleCombinedPagingRamRom();
 const board=new DirectBoardFacade(rom),native=loadDirectNative(addon,sha256);
 const reset=native.create(configuration,rom,board,capture);
 let last=reset,resumes=0;
 while(resumes++<maxResumes){const line=board.stageLine();if(line.changed)native.setIRQ(line.asserted);board.beginRun();try{last=native.resume(600,300,0xffffffffffffffffn);}finally{board.endRun();}
  // Terminal observation uses the actual native slice reason and activity state.
  if(last.reason===4&&last.chargedNativeTicks===0&&last.chargedQuanta===0)break;
 }
 if(resumes>maxResumes)throw Error('direct diagnostic resume bound exhausted');
 const finalBoard=board.settleTerminal();native.close();board.close();
 return {status:'UNQUALIFIED_DIRECT_DIAGNOSTIC',reset,final:last,board:finalBoard,resumes};
}
