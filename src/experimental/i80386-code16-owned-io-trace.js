/**
 * Opt-in, fixture-specific protected-16 trace experiment.
 *
 * This is deliberately not installed in the CPU or AT machine. A caller must
 * supply a pure, stable fetch bus and a chip-event horizon already expressed
 * as guest-instruction slots. Refusal leaves architectural state untouched.
 */
export function runOwnedI80386Code16IoTrace(cpu,{stepsUntilChipEvent}={}){
  const refuse=reason=>({accepted:false,completed:0,reason});
  if(!Number.isInteger(stepsUntilChipEvent)||stepsUntilChipEvent<0)
    throw new RangeError('stepsUntilChipEvent must be a nonnegative integer');
  if(stepsUntilChipEvent<3)return refuse('chip-deadline');
  const cs=cpu.segmentCaches?.[1];
  if(cpu.cr0!==0x11||cpu.cs!==8||cpu.ds!==0x10||cpu.ss!==0x10||
     cpu.es!==0||cpu.fs!==0||cpu.gs!==0||cpu.eflags!==6||
     cpu.eip!==0x7c2e||(cpu.edx&0xffff)!==0x21||
     !cs||cs.base!==0||cs.limit<0x7c3d||cs.default32!==false||
     !cs.present||!cs.code||!cs.readable||cpu.halted||cpu.shutdown||
     cpu._interruptShadow||cpu._nmiShadow||cpu._debugShadow||
     cpu._repeatContext||cpu._debugRegisters?.some(value=>value!==0))
    return refuse('fixture-state');
  // The code image is an owned, no-paging, base-zero 64 KiB code segment.
  // Verify both successors and the I/O opcode before changing any CPU state.
  const expected=[0xbb,0x01,0x00,0x83,0xfb,null,0x74,0x06,
    0xb0,0x46,0xe6,0xe9,0xeb,0x0b,0xec];
  const bytes=expected.map((_,index)=>cpu.fetch(0x7c2e+index)&255);
  if(bytes.some((value,index)=>expected[index]!==null&&
      value!==expected[index])||![1,2].includes(bytes[5]))
    return refuse('code-mismatch');
  // MOV BX,1; CMP BX,imm8; JZ +6. _add is the ordinary core's exact
  // 16-bit CMP flag helper; no I/O or device callback occurs in this call.
  cpu.ebx=((cpu.ebx&0xffff0000)|1)>>>0;
  const result=cpu._add(1,bytes[5],16,true);
  cpu.eip=result===0?0x7c3c:0x7c36;
  cpu.cycles+=3;
  return {accepted:true,completed:3,
    reason:result===0?'io-required':'branch-fallthrough',
    stop:{cs:cpu.cs,eip:cpu.eip},
    branchTaken:result===0};
}
