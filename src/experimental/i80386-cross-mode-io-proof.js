/**
 * Owned, opt-in executable fixture. This is not a board dispatcher.
 * It executes only IN AL,DX; MOV [BX/EBX],AL; MOV AL,[BX/EBX];
 * CMP AL,imm8; JNZ back to IN. No speculative decode or memory walk.
 */
const START=0x100;
const CS_BASE=0x10000,DS_BASE=0x20000;
const MAX=64;
const expectedCode=wide=>[0xec,0x88,wide?0x03:0x07,
  0x8a,wide?0x03:0x07,0x3c,null,0x75,0xf7];
const modeOf=cpu=>!(cpu.cr0&1)?'real':cpu.eflags&0x20000?'vm86':
  cpu.segmentCaches[1]?.default32?'protected32':'protected16';
const refuse=reason=>({accepted:false,completed:0,reason});
const exit=(completed,reason,cpu,ioReads)=>({accepted:true,completed,reason,
  stop:{cs:cpu.cs,eip:cpu.eip>>>0},ioReads});

export function runOwnedI80386CrossModeIoProof(machine,{maxInstructions=64}={}){
  if(!Number.isInteger(maxInstructions)||maxInstructions<1||maxInstructions>MAX)
    throw new RangeError('maxInstructions must be 1..64');
  const cpu=machine?.cpu;
  if(machine?.variant!=='80386'||!cpu||!machine.mem)
    throw new TypeError('cross-mode I/O proof requires an AT 386 board');
  const mode=modeOf(cpu),wide=mode==='protected32';
  const cs=cpu.segmentCaches[1],ds=cpu.segmentCaches[3],
    iopl=(cpu.eflags>>>12)&3;
  const translationGeneration=cpu._translationGeneration,
    functionalInstructionCycles=machine.functionalInstructionCycles;
  // IF=0 and no debug/shadow state mean ordinary step has no pending
  // interrupt or trap to deliver at these fixture boundaries. VM86 needs
  // IOPL3; the other modes run at CPL0. All other identities exit.
  if(cpu.cr0!==(mode==='real'?0:1)||cpu.cr3!==0||cpu.cr4!==0||
      cpu.cs!==0x1000||cpu.ds!==0x2000||cpu.dx!==0x21||
      cpu.eip!==START||!cs||!ds||cs.base!==CS_BASE||
      ds.base!==DS_BASE||cs.limit<START+8||ds.limit<0x40||
      !!cs.default32!==wide||!!ds.default32!==wide||
      !cs.present||!cs.code||!cs.readable||!ds.present||
      ds.code||!ds.readable||!ds.writable||
      cpu.currentPrivilegeLevel!==(mode==='vm86'?3:0)||
      (mode==='vm86'&&iopl!==3)||
      (cpu.eflags&(0x200|0x100|0x10000))||
      cpu.halted||cpu.shutdown||cpu._interruptShadow||
      cpu._nmiShadow||cpu._debugShadow||cpu._repeatContext||
      machine._nmiPending||machine._cpuResetPending||
      cpu._debugRegisters?.some(value=>value!==0)||
      !Number.isInteger(machine.functionalInstructionCycles)||
      machine.functionalInstructionCycles<1||
      machine._a20Configured!==true||machine._a20Enabled!==true||
      machine._xv6Mp||machine.ata)
    return refuse('fixture-state');
  const code=expectedCode(wide),codePage=CS_BASE>>>12;
  if(machine._page?.[codePage]!==1||
      code.some((value,index)=>value!==null&&
        machine.mem[CS_BASE+START+index]!==value)||
      machine.mem[CS_BASE+START+6]===undefined)
    return refuse('code-mismatch');
  const immediate=machine.mem[CS_BASE+START+6];
  // This core checks a 386 TSS bitmap for VM86 I/O even at IOPL3. Admit
  // only an owned RAM bitmap that grants DX=0021, so _checkIo cannot fault
  // or touch a device. A changed bitmap exits before the port read.
  const vmIoSafe=()=>mode!=='vm86'||
    cpu.tr.present&&[9,11].includes(cpu.tr.type)&&
    cpu.tr.base===0x30000&&cpu.tr.limit>=0x84&&
    machine._page?.[0x30]===1&&
    machine.mem[0x30066]===0x80&&machine.mem[0x30067]===0&&
    !(machine.mem[0x30084]&2);
  if(!vmIoSafe())return refuse('io-permission-slow-exit');
  let completed=0,ioReads=0;
  while(completed<maxInstructions){
    // Recheck bytes after every I/O helper: a synchronous hook may mutate
    // code or mapping. Do not continue on the stale code identity.
    if(code.some((value,index)=>machine.mem[CS_BASE+START+index]!==
        (value===null?immediate:value))||machine._page?.[codePage]!==1)
      return exit(completed,'code-revoked',cpu,ioReads);
    if(machine._nmiPending||machine._cpuResetPending||
        cpu._interruptShadow||cpu._nmiShadow||cpu._debugShadow||
        (cpu.eflags&(0x200|0x100|0x10000))||
        (mode==='vm86'&&((cpu.eflags>>>12)&3)!==3))
      return exit(completed,'interrupt-or-debug-boundary',cpu,ioReads);
    if(machine._chipDebt>=machine._chipDeadline||
        machine._lapicTimerInterval&&machine.cycles>=machine._lapicTimerNext)
      return exit(completed,'chip-event-boundary',cpu,ioReads);
    if(modeOf(cpu)!==mode||cpu.cr0!==(mode==='real'?0:1)||
        cpu.cr3!==0||cpu.cr4!==0||cpu.cs!==0x1000||cpu.ds!==0x2000||
        cs!==cpu.segmentCaches[1]||ds!==cpu.segmentCaches[3]||
        cs.base!==CS_BASE||cs.limit<START+8||!!cs.default32!==wide||
        !cs.present||!cs.code||!cs.readable||
        ds.base!==DS_BASE||ds.limit<0x40||!!ds.default32!==wide||
        !ds.present||ds.code||!ds.readable||!ds.writable||
        cpu.dx!==0x21||cpu.currentPrivilegeLevel!==(mode==='vm86'?3:0)||
        cpu._translationGeneration!==translationGeneration||
        machine.functionalInstructionCycles!==functionalInstructionCycles||
        machine._a20Configured!==true||machine._a20Enabled!==true)
      return exit(completed,'identity-change',cpu,ioReads);
    const offset=wide?cpu.ebx>>>0:cpu.bx;
    const linear=DS_BASE+offset;
    const physical=machine._decode386(linear>>>0);
    // Dynamic address is checked at each load/store. This fixture has
    // paging off; only ordinary kind-1 RAM on a different page from code
    // and every tracked page table is admitted. Any other access exits
    // before the instruction so JS can perform its fault/device behavior.
    const dataSafe=offset<=ds.limit&&linear<=0xffffffff&&
      physical<machine.memoryBytes&&machine._page?.[physical>>>12]===1&&
      physical>>>12!==codePage&&
      !cpu._translationTablePages?.has(physical>>>12)&&
      !(physical>=0x9fc00&&physical<0xc0000);
    const ip=cpu.eip>>>0;
    if(ip!==START&&ip!==START+1&&ip!==START+3&&
        ip!==START+5&&ip!==START+7)
      return exit(completed,'unsupported-entry',cpu,ioReads);
    if((ip===START+1||ip===START+3)&&!dataSafe)
      return exit(completed,'ram-slow-exit',cpu,ioReads);
    if(ip===START&&!vmIoSafe())
      return exit(completed,'io-permission-slow-exit',cpu,ioReads);
    const length=ip===START?1:2;
    cpu.eip=ip+length;
    cpu._instructionBytes=length;
    cpu._suppressTrace=false;cpu._preserveRf=false;
    // The only I/O form is IN AL,DX. The guard above proves the fixture's
    // IOPL path, so cpu.inPort invokes the board's ordered synchronous read.
    if(ip===START){
      cpu._checkIo(0x21,8);
      cpu.al=cpu.inPort(0x21,8)&255;ioReads++;
    }else if(ip===START+1){
      machine._write386(physical,cpu.al);
    }else if(ip===START+3){
      cpu.al=machine._read386(physical)&255;
    }else if(ip===START+5){
      cpu._add(cpu.al,immediate,8,true);
    }else{
      cpu.eip=cpu.eflags&0x40?START+9:START;
    }
    const charge=machine.functionalInstructionCycles;
    cpu.cycles++;machine.cycles+=charge;machine._chipDebt+=charge;
    completed++;
    if(cpu.eip===START+9)return exit(completed,'branch-fallthrough',cpu,ioReads);
  }
  return exit(completed,'run-budget',cpu,ioReads);
}
