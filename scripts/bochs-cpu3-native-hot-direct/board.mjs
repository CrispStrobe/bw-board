import {DirectBoardFacade} from '../bochs-cpu3-native-direct-board/board.mjs';
import {hotNativeProfile as p} from './profile.mjs';
const check=(ok,message)=>{if(!ok)throw Error('hot direct board: '+message);};
export class HotDirectBoardFacade extends DirectBoardFacade {
 constructor(rom,{compactSink=null}={}){super(rom,{capture:null});check(compactSink===null||typeof compactSink==='function','compact sink');this.compactSink=compactSink;this.compactCount=0;}
 _call(operation,args,fn){check(this.running&&!this.active&&!this.closed,'callback lifecycle before effect');if(this.compactSink)check(this.compactCount<500000,'compact event bound before effect');this.active=true;try{const result=fn();if(this.compactSink){this.compactSink({ordinal:++this.compactCount,operation,args:args??this.compactArgs,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,boardCycles:this.machine.cycles,debt:this.machine._chipDebt,mappingEpoch:this.mappingEpoch,result});}return result;}finally{this.active=false;}}
 readPhysical(raw,width){check(this.running&&!this.active&&!this.closed,'read lifecycle before argument mutation');this.compactArgs=[raw,width,null];try{return super.readPhysical(raw,width);}finally{this.compactArgs=null;}}
 writePhysical(raw,bytes){check(this.running&&!this.active&&!this.closed,'write lifecycle before argument mutation');this.compactArgs=[raw,bytes?.length,bytes instanceof Uint8Array?Uint8Array.from(bytes):null];try{return super.writePhysical(raw,bytes);}finally{this.compactArgs=null;}}
 quantum(kind){return this._call('quantum',[kind],()=>{check(kind===0||kind===1,'work kind before effect');check(this.successfulQuanta<p.totalQuanta,'total Q before effect');this.successfulQuanta++;this.machine.cycles+=6;this.machine._chipDebt+=6;return Number(this.machine._chipDebt>=this.machine._chipDeadline);});}
 nativeTick(){return this._call('nativeTick',[],()=>{check(this.nativeTicks<p.totalNativeTicks,'total N before effect');this.nativeTicks++;return 0;});}
}
