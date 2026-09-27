// Opt-in first integration of real 386 bytes with the bounded WASM spike.
// Deliberately narrow: cached flat 32-bit RAM code and prevalidated RAM
// windows, with no instruction that can alter interrupt/debug/segment/paging state.
import {createI80386BlockSpike} from './i80386-block-spike.js';
import {prevalidateI80386ReadWindow, isI80386ReadWindowValid} from
  './i80386-read-window.js';
import {prevalidateI80386WriteWindow, isI80386WriteWindowValid} from
  './i80386-write-window.js';

const REG = ['eax','ecx','edx','ebx','esp','ebp','esi','edi'];

export function decodeI80386NativeByteBlock(machine, maxInstructions = 8) {
  const cpu = machine?.cpu;
  if (machine?.variant !== '80386' || !cpu ||
      !Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > 64 ||
      !cpu.segmentCaches[1]?.default32) return null;
  const startEip = cpu.eip >>> 0;
  const codeWindow = prevalidateI80386ReadWindow(machine, startEip, 1);
  if (!codeWindow) return null;
  const pageEnd = codeWindow.linearPage + 4096;
  const startPhysical = codeWindow.physicalPage + (startEip - codeWindow.linearPage);
  const mem = machine.mem;
  const instructions = [], readWindows = [], writeWindows = [];
  const starts = new Map();
  let eip = startEip;
  for (let n = 0; n < maxInstructions && eip < pageEnd; n++) {
    const at = codeWindow.physicalPage + (eip - codeWindow.linearPage);
    let p = at;
    const take = () => {
      if (p >= codeWindow.physicalPage + 4096) throw new RangeError('code page end');
      return mem[p++];
    };
    let ir;
    try {
      const op = take();
      if (op === 0xf3) {
        if (n !== 0 || take() !== 0xab || !cpu.protectedMode ||
            cpu.virtual8086 || cpu._repeatContext?.cs !== cpu.cs ||
            cpu._repeatContext?.eip !== startEip || !cpu.ecx) break;
        const window=prevalidateI80386WriteWindow(machine,cpu.edi >>> 0);
        if (!window) break;
        writeWindows.push(window);
        ir={op:17,width:32,base:window.linearPage,
          disp:window.delta,lo:window.lo,hi:window.hi};
      } else if (op === 0x90) ir = {op:0,width:32};
      else if (op >= 0xb8 && op <= 0xbf) {
        let immediate=0;
        for(let i=0;i<4;i++) immediate=(immediate | (take() << (8*i)))>>>0;
        ir={op:11,dst:op-0xb8,src:immediate,width:32};
      } else if (op === 0x81 || op === 0x83) {
        const modrm=take();
        const extension=(modrm >>> 3) & 7;
        if ((modrm >>> 6) !== 3 || ![0,1,4,7].includes(extension)) break;
        let immediate=0;
        if (op === 0x83) immediate=(take()<<24)>>24;
        else for(let i=0;i<4;i++) immediate=(immediate | (take() << (8*i)))>>>0;
        ir={op:({0:12,1:13,4:14,7:10})[extension],
          dst:modrm & 7,src:immediate>>>0,width:32};
      } else if (op === 0x25) {
        let immediate=0;
        for(let i=0;i<4;i++) immediate=(immediate | (take() << (8*i)))>>>0;
        ir={op:14,dst:0,src:immediate,width:32};
      } else if (op === 0xc1) {
        const modrm=take(), extension=(modrm >>> 3) & 7;
        if ((modrm >>> 6) !== 3 || (extension !== 4 && extension !== 5)) break;
        ir={op:extension === 4 ? 15 : 16,
          dst:modrm & 7,src:take(),width:32};
      } else if (op === 0x74 || op === 0x75) {
        const displacement = (take() << 24) >> 24;
        const target = (eip + 2 + displacement) >>> 0;
        const targetIndex = starts.get(target);
        if (targetIndex === undefined) break; // Only linked backward branches.
        ir = {op:op === 0x74 ? 4 : 5,dst:targetIndex,src:target,width:32};
      } else if ([0x89,0x39,0x85,0x8b,0x8d].includes(op)) {
        const modrm = take(), mod = modrm >>> 6,
          reg = (modrm >>> 3) & 7, rm = modrm & 7;
        if (mod === 3) {
          if (op === 0x8d) break;
          ir = op === 0x8b ? {op:1,dst:reg,src:rm,width:32} :
            {op:op === 0x89 ? 1 : op === 0x39 ? 2 : 3,
              dst:rm,src:reg,width:32};
        } else {
          if (op !== 0x8b && op !== 0x8d) break;
          let base=rm,index=8,scale=0,disp=0,segment=3;
          if (rm === 4) {
            const sib=take();scale=sib>>>6;index=(sib>>>3)&7;base=sib&7;
            if (index === 4) index=8;
          }
          const noBase=mod === 0 && base === 5;
          if (noBase) base=8;
          else if (base === 4 || base === 5) segment=2;
          if (noBase || mod === 2) {
            for(let i=0;i<4;i++) disp=(disp | (take() << (8*i)))>>>0;
          } else if (mod === 1) disp=(take()<<24)>>24;
          const ea={base,index,scale,disp:disp>>>0};
          if (op === 0x8d) ir={op:9,dst:reg,width:32,...ea};
          else {
            const offset = ((base < 8 ? cpu[REG[base]] : 0) +
              (index < 8 ? (cpu[REG[index]] << scale) : 0) + disp) >>> 0;
            const window=prevalidateI80386ReadWindow(machine,offset,segment);
            if (!window) break;
            readWindows.push(window);
            ir={op:8,dst:reg,width:32,...ea,
              disp:(disp+window.delta)>>>0,lo:window.lo,hi:window.hi};
          }
        }
      } else break;
    } catch (error) {
      if (error instanceof RangeError) break;
      throw error;
    }
    const length=p-at;
    if (length < 1 || length > 15 || eip + length > pageEnd) break;
    ir.length=length;
    starts.set(eip,instructions.length);
    instructions.push(ir);
    eip += length;
    if (ir.op >= 4 && ir.op <= 6 || ir.op === 17) break;
  }
  if (!instructions.length) return null;
  const bytes=mem.slice(startPhysical,startPhysical+(eip-startEip));
  return {machine,cpu,startEip,codeWindow,readWindows,writeWindows,instructions,
    physicalStart:startPhysical,bytes};
}

export function isI80386NativeByteBlockValid(block) {
  if (!block || block.machine?.cpu !== block.cpu ||
      block.cpu.eip !== block.startEip ||
      !isI80386ReadWindowValid(block.codeWindow) ||
      !block.readWindows.every(isI80386ReadWindowValid) ||
      !block.writeWindows.every(isI80386WriteWindowValid)) return false;
  const mem=block.machine.mem;
  for(let i=0;i<block.bytes.length;i++)
    if (mem[block.physicalStart+i] !== block.bytes[i]) return false;
  return true;
}

export async function createI80386NativeByteRunner(machine, ramBridge) {
  if (machine?.mem?.buffer !== ramBridge?.memory?.buffer)
    throw new TypeError('native byte runner needs the AT board attached to shared RAM');
  const native=await createI80386BlockSpike({ramBridge});
  return {
    decode(maxInstructions=8) {
      return decodeI80386NativeByteBlock(machine,maxInstructions);
    },
    run(block, maxInstructions=8) {
      const cpu=machine.cpu;
      if (!Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > 64)
        throw new RangeError('native byte block budget must be 1 through 64');
      const repeatStos=block?.instructions?.[0]?.op === 17;
      if (!isI80386NativeByteBlockValid(block) || cpu.halted || cpu.shutdown ||
          machine._cycleEst !== null ||
          cpu.eflags & (0x100 | 0x10000) || cpu._interruptShadow || cpu._nmiShadow ||
          cpu._debugShadow || (repeatStos
            ? (!cpu.protectedMode || cpu.virtual8086 ||
              cpu._repeatContext?.cs !== cpu.cs ||
              cpu._repeatContext?.eip !== block.startEip || !cpu.ecx)
            : cpu._repeatContext) || cpu.busTrace ||
          machine._cpuResetPending || cpu.cycles > 0xffffffff-64)
        return {instructions:0,cycles:0,reason:'fallback'};
      if (machine._chipDebt >= machine._chipDeadline)
        return {instructions:0,cycles:0,reason:'chip-event'};
      const apicMode=machine._xv6Mp && machine._mpReady && (cpu.cr0 & 1);
      let apicIrqReady=false;
      if (machine._xv6Mp && machine._apicIrqMask && (cpu.eflags & 0x200)) {
        for(let irq=0;irq<machine._apicIrq.length;irq++) {
          if (!(machine._apicIrqMask & (1 << irq))) continue;
          const low=machine._ioapic[0x10 + irq * 2] ?? 0;
          if (!(low & 0x10000)) {apicIrqReady=true;break;}
        }
      }
      if (machine._nmiPending ||
          (machine._xv6Mp && machine._lapicTimerPending && (cpu.eflags & 0x200)) ||
          apicIrqReady ||
          (!apicMode && (cpu.eflags & 0x200) && machine._pic?.intActive) ||
          (machine._lapicTimerInterval && machine.cycles >= machine._lapicTimerNext))
        return {instructions:0,cycles:0,reason:'fallback'};
      const charge=machine.functionalInstructionCycles;
      const budget=Math.min(maxInstructions,
        Math.ceil((machine._chipDeadline-machine._chipDebt)/charge),
        machine._lapicTimerInterval
          ? Math.ceil((machine._lapicTimerNext-machine.cycles)/charge) : 64);
      if (budget < 1) return {instructions:0,cycles:0,reason:'chip-event'};
      native.setCpuState(cpu);
      native.setProgram(block.instructions);
      const result=native.run(0,block.instructions.length,budget);
      native.copyStateToCpu(cpu);
      if (repeatStos && result.completed && !cpu.ecx) cpu._repeatContext=null;
      const cycles=result.completed*charge;
      machine.cycles+=cycles;machine._chipDebt+=cycles;
      return {instructions:result.completed,cycles,reason:result.reason};
    },
  };
}
