// Read-only protected-32 census for the ordinary AT step path. The native
// decoder inspects only cached translations and direct RAM; it never runs.
import {decodeI80386NativeByteBlock} from './i80386-native-byte-block.js';
import {prevalidateI80386ReadWindow} from './i80386-read-window.js';

const PREFIXES = new Set([0x66,0x67,0x26,0x2e,0x36,0x3e,0x64,0x65,0xf0,0xf2,0xf3]);
const MODRM = new Set([0x89,0x8b,0x39,0x85,0x8d,0x0b,0x81,0x83,0xc1,
  0x8a,0x8e]);
const bump=(table,key)=>{table[key]=(table[key]??0)+1;};
const hex=byte=>byte.toString(16).padStart(2,'0');

export function createI80386Native32Census({decodeInstructions=8}={}) {
  if (!Number.isInteger(decodeInstructions)||decodeInstructions<1||decodeInstructions>64)
    throw new RangeError('native32 census decode budget must be 1 through 64');
  const counts={schema:'bw.i80386-native32-census.v1',decodeInstructions,
    entryAttempts:0,completedCoreSteps:0,sameEntryRetirements:0,
    redirectedRetirements:0,noRetirement:0,fetchMissing:0,
    codeWindowRefusedAttempts:0,decodeNullAttempts:0,
    singleCandidateAttempts:0,multiCandidateAttempts:0,
    repeatCandidateAttempts:0,candidateLengthHistogram:{},
    candidateStopReasons:{},retiredOpcodes:{},retiredModrmForms:{},
    nullByRetiredOpcode:{},singleByRetiredOpcode:{},
    multiByRetiredOpcode:{},candidateCategoryByRetiredModrmForm:{},
    codeWindowRefusedByRetiredOpcode:{},
    prefixBytesOnRetiredSteps:0};
  let machine=null,originalFetch=null,active=false,pending=null;
  let firstFetchCs=0,firstFetchEip=0;
  const bytes=[];
  return {
    attach(target) {
      if(machine||!target?.cpu||typeof target.cpu._fetch8!=='function')
        throw new TypeError('native32 census needs an unattached 386 CPU');
      machine=target;originalFetch=target.cpu._fetch8;
      const ownFetch=Object.getOwnPropertyDescriptor(target.cpu,'_fetch8');
      const wrapped=function(...args){
        const cs=this.cs,eip=this.eip>>>0;
        const value=originalFetch.apply(this,args);
        if(active&&bytes.length<16){
          if(bytes.length===0){firstFetchCs=cs;firstFetchEip=eip;}
          bytes.push(value);
        }
        return value;
      };
      target.cpu._fetch8=wrapped;
      return ()=>{
        if(target.cpu._fetch8===wrapped){
          if(ownFetch)Object.defineProperty(target.cpu,'_fetch8',ownFetch);
          else delete target.cpu._fetch8;
        }
        machine=null;active=false;pending=null;
      };
    },
    observe(target) {
      active=false;pending=null;bytes.length=0;
      if(target!==machine)throw new TypeError('native32 census is not attached to machine');
      const cpu=target.cpu,cs=cpu.segmentCaches?.[1];
      if(!cpu.protectedMode||cpu.virtual8086||!cs?.default32)return;
      counts.entryAttempts++;
      const eip=cpu.eip>>>0;
      const codeWindow=prevalidateI80386ReadWindow(target,eip,1);
      let category,block=null;
      if(!codeWindow){category='code-window-refused';counts.codeWindowRefusedAttempts++;}
      else {
        block=decodeI80386NativeByteBlock(target,decodeInstructions);
        if(!block){category='decode-null';counts.decodeNullAttempts++;}
        else {
          const length=block.instructions.length;
          bump(counts.candidateLengthHistogram,length);
          const first=block.instructions[0]?.op;
          if(first===17||first===20||first===21){
            category='repeat';counts.repeatCandidateAttempts++;
          }else if(length===1){category='single';counts.singleCandidateAttempts++;}
          else{category='multi';counts.multiCandidateAttempts++;}
          const last=block.instructions[length-1]?.op;
          const stop=length===decodeInstructions?'decode-budget':
            last===4||last===5?'branch-exit':
              last===17||last===20||last===21?'repeat-exit':
                'unsupported-or-page-boundary';
          bump(counts.candidateStopReasons,stop);
        }
      }
      pending={cs:cpu.cs,eip,cycles:cpu.cycles,category};
      active=true;
    },
    retired(target) {
      if(target!==machine)throw new TypeError('native32 census is not attached to machine');
      active=false;
      if(!pending)return;
      const before=pending,cpu=target.cpu;
      pending=null;
      if(cpu.cycles===before.cycles){counts.noRetirement++;return;}
      counts.completedCoreSteps++;
      if(!bytes.length){counts.fetchMissing++;return;}
      if(firstFetchCs!==before.cs||firstFetchEip!==before.eip){
        counts.redirectedRetirements++;return;
      }
      counts.sameEntryRetirements++;
      let index=0;
      while(index<bytes.length&&PREFIXES.has(bytes[index]))index++;
      counts.prefixBytesOnRetiredSteps+=index;
      if(index>=bytes.length){counts.fetchMissing++;return;}
      const op=bytes[index];
      const opcode=op===0x0f&&bytes[index+1]!==undefined?`0f${hex(bytes[index+1])}`:hex(op);
      bump(counts.retiredOpcodes,opcode);
      const modrmIndex=index+(op===0x0f?2:1);
      if(MODRM.has(op)&&bytes[modrmIndex]!==undefined){
        const modrm=bytes[modrmIndex],mod=modrm>>>6;
        const form=(op===0x81||op===0x83||op===0xc1)
          ?`${opcode}:m${mod}:g${(modrm>>>3)&7}`:`${opcode}:m${mod}`;
        bump(counts.retiredModrmForms,form);
        bump(counts.candidateCategoryByRetiredModrmForm,`${before.category}|${form}`);
      }
      if(before.category==='decode-null')bump(counts.nullByRetiredOpcode,opcode);
      else if(before.category==='single')bump(counts.singleByRetiredOpcode,opcode);
      else if(before.category==='multi')bump(counts.multiByRetiredOpcode,opcode);
      else if(before.category==='code-window-refused')
        bump(counts.codeWindowRefusedByRetiredOpcode,opcode);
    },
    report(){return counts;},
  };
}
