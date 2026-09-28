// Opt-in, observation-only protected-32 fallback span census for full xv6.
// Prefixes are excluded. Counts are fetched-byte completed JS instructions,
// not safe native admissions. No decode ahead, guest read, write or page walk.
// Predeclared design gate: >=2.4M selected fallback retirements in contiguous
// runs of length >=4, with mean length >=4, before coding a grouped grammar.
import {ExperimentalI80386} from '../src/experimental/i80386.js';

const originalFetch8 = ExperimentalI80386.prototype._fetch8;
const originalInstruction = ExperimentalI80386.prototype._stepInstruction;
let active = null, protected32FallbackRetired = 0;
const tiers = ['narrow', 'memoryAluBranch', 'plusStackControl',
  'plusByteString'].map(name => ({name, selectedRetirements:0,
    runsAtLeast2:0,stepsInRunsAtLeast2:0,runsAtLeast4:0,
    stepsInRunsAtLeast4:0,maxRun:0,lengths:{},endReasons:{},
    current:0,last:null}));
const ALU = new Set([0x01,0x03,0x0b,0x29,0x2b,0x31,0x33,
  0x39,0x3b,0x85]);
const IMMEDIATE_GROUP = new Set([0,1,4,7]);
const STACK_GROUP = new Set([2,4,6]);

function selected(bytes) {
  const opcode=bytes[0],modrm=bytes[1],mod=modrm===undefined?4:modrm>>>6;
  const narrow=(opcode===0x8b||opcode===0x89) && mod===0 &&
    (modrm&7)!==4 && (modrm&7)!==5;
  const memory=(opcode===0x8b||opcode===0x89) && mod<3;
  const alu=ALU.has(opcode) && modrm!==undefined;
  const grouped=(opcode===0x81||opcode===0x83) && modrm!==undefined &&
    IMMEDIATE_GROUP.has((modrm>>>3)&7);
  const nearJcc=opcode===0x0f && bytes[1]>=0x80 && bytes[1]<=0x8f;
  const base=memory || (opcode===0x8d&&mod<3) || alu || grouped ||
    opcode===0x25 || opcode===0xa8 || opcode===0x90 ||
    opcode>=0xb8&&opcode<=0xbf || opcode>=0x70&&opcode<=0x7f || nearJcc;
  const stack=opcode>=0x50&&opcode<=0x5f ||
    opcode===0x68||opcode===0x6a||opcode===0xe8||opcode===0xe9||
    opcode===0xeb||opcode===0xc2||opcode===0xc3||opcode===0xc9||
    (opcode===0xff&&modrm!==undefined&&STACK_GROUP.has((modrm>>>3)&7))||
    (opcode===0x8f&&modrm!==undefined&&((modrm>>>3)&7)===0);
  const byteString=(opcode===0xf6&&modrm!==undefined&&
    ((modrm>>>3)&7)===0) || opcode===0xa4 ||
    (opcode===0x0f&&(bytes[1]===0xb6||bytes[1]===0xb7));
  return [narrow,base,base||stack,base||stack||byteString];
}
function close(tier, reason) {
  const n=tier.current;
  if (!n) return;
  tier.lengths[n]=(tier.lengths[n]??0)+1;
  tier.endReasons[reason]=(tier.endReasons[reason]??0)+1;
  if (n>=2){tier.runsAtLeast2++;tier.stepsInRunsAtLeast2+=n;}
  if (n>=4){tier.runsAtLeast4++;tier.stepsInRunsAtLeast4+=n;}
  if (n>tier.maxRun)tier.maxRun=n;
  tier.current=0;tier.last=null;
}
function closeAll(reason){for(const tier of tiers)close(tier,reason);}

ExperimentalI80386.prototype._fetch8=function(){
  const byte=originalFetch8.call(this);
  if(active?.cpu===this&&active.bytes.length<8)active.bytes.push(byte);
  return byte;
};
ExperimentalI80386.prototype._stepInstruction=function(){
  const eligible=this.protectedMode&&!this.virtual8086&&
    this.segmentCaches[1]?.default32;
  const before={cpu:this,cs:this.cs,eip:this.eip>>>0,cycles:this.cycles};
  const previous=active;
  if(eligible)active={cpu:this,bytes:[]};
  try{return originalInstruction.call(this);}
  finally{
    if(!eligible)closeAll('mode-exit');
    else{
      const bytes=active.bytes;
      active=previous;
      if(this.cycles<=before.cycles||!bytes.length)closeAll('no-retirement');
      else{
        protected32FallbackRetired++;
        const flags=selected(bytes);
        for(let i=0;i<tiers.length;i++){
          const tier=tiers[i];
          if(!flags[i]){close(tier,'next-form-not-selected');continue;}
          tier.selectedRetirements++;
          if(tier.current){
            const last=tier.last;
            const reason=last.cs!==before.cs?'cs-change':
              last.eip!==before.eip?'eip-discontinuity':
              last.cycles!==before.cycles?'intervening-native-or-other-steps':null;
            if(reason)close(tier,reason);
          }
          tier.current++;
          tier.last={cs:this.cs,eip:this.eip>>>0,cycles:this.cycles};
        }
      }
    }
  }
};
process.on('exit',()=>{
  closeAll('end-of-run');
  console.error('DYNAMIC_SPAN_POTENTIAL',JSON.stringify({
    protected32FallbackRetired,tiers:tiers.map(({current,last,...report})=>({
      ...report,meanLengthAtLeast4:report.runsAtLeast4?
        report.stepsInRunsAtLeast4/report.runsAtLeast4:0}))}));
});
