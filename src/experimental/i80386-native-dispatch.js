// Opt-in dispatcher for the bounded native byte runner. The machine remains
// responsible for chip events, interrupts, faults, and unsupported opcodes.
import {createI80386RamBridge} from './i80386-ram-bridge.js';
import {createI80386NativeByteRunner} from './i80386-native-byte-block.js';

const REP_STOSD = 17;
const REP_MOVSD = 20;
const REP_STOSB = 21;
const isRepeatBlock = block =>
  block?.instructions?.[0]?.op === REP_STOSD ||
  block?.instructions?.[0]?.op === REP_MOVSD ||
  block?.instructions?.[0]?.op === REP_STOSB;

export async function createI80386NativeDispatcher(machine, {
  memoryBytes = machine?.memoryBytes,
  maxCachedBlocks = 4096,
  decodeInstructions = 8,
  blockInstructions = 16,
} = {}) {
  if (machine?.variant !== '80386' || !machine.cpu ||
      !Number.isInteger(memoryBytes) || memoryBytes !== machine.memoryBytes)
    throw new TypeError('native dispatcher needs a 386 machine and its memory size');
  if (!Number.isInteger(maxCachedBlocks) || maxCachedBlocks < 1 ||
      !Number.isInteger(decodeInstructions) || decodeInstructions < 1 ||
      decodeInstructions > 64 || !Number.isInteger(blockInstructions) ||
      blockInstructions < 1 || blockInstructions > 64)
    throw new RangeError('invalid native dispatcher cache or block budget');

  const ramBridge = machine._experimentalRamBridge ?? await createI80386RamBridge();
  if (!machine._experimentalRamBridge) {
    ramBridge.attach(machine);
    machine._experimentalRamBridge = ramBridge;
  }
  const runner = await createI80386NativeByteRunner(machine, ramBridge);
  const blocks = new Map();
  const stats = {attempts: 0, decoded: 0, blockCalls: 0, instructions: 0,
    ineligibleModeSteps: 0, repStosDecoded: 0, repStosBlockCalls: 0,
    repStosIterations: 0, repMovDecoded: 0, repMovBlockCalls: 0,
    repMovIterations: 0, repStosbDecoded: 0, repStosbBlockCalls: 0,
    repStosbIterations: 0};

  function run(maxInstructions = 64) {
    if (!Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > 64)
      throw new RangeError('native dispatcher budget must be 1 through 64 instructions');
    // The decoder refuses 16-bit code outright. Most DOS/Windows boot steps
    // use it, so do not pay a cache lookup or window admission per instruction.
    if (!machine.cpu.segmentCaches[1]?.default32) {
      stats.ineligibleModeSteps++;
      machine.step();
      return 1;
    }
    stats.attempts++;
    const cpu = machine.cpu;
    const key = cpu.eip >>> 0;
    let entry = blocks.get(key);
    if (!entry || entry.cs !== cpu.cs || entry.cr3 !== cpu.cr3 ||
        entry.cr4 !== cpu.cr4 || (!entry.block &&
          cpu._repeatContext?.cs === cpu.cs && cpu._repeatContext?.eip === key)) {
      let block = runner.decode(decodeInstructions);
      if (block && (block.instructions.length >= 2 || isRepeatBlock(block))) {
        stats.decoded++;
        if (block.instructions[0]?.op === REP_STOSD) stats.repStosDecoded++;
        if (block.instructions[0]?.op === REP_MOVSD) stats.repMovDecoded++;
        if (block.instructions[0]?.op === REP_STOSB) stats.repStosbDecoded++;
      } else block = null;
      if (blocks.size >= maxCachedBlocks) blocks.delete(blocks.keys().next().value);
      entry = {cs: cpu.cs, cr3: cpu.cr3, cr4: cpu.cr4, block};
      blocks.set(key, entry);
    }
    if (entry.block) {
      const result = runner.run(entry.block,
        Math.min(blockInstructions, maxInstructions));
      if (result.instructions > 0) {
        stats.blockCalls++;
        stats.instructions += result.instructions;
        if (entry.block.instructions[0]?.op === REP_STOSD) {
          stats.repStosBlockCalls++;
          stats.repStosIterations += result.instructions;
        }
        if (entry.block.instructions[0]?.op === REP_MOVSD) {
          stats.repMovBlockCalls++;
          stats.repMovIterations += result.instructions;
        }
        if (entry.block.instructions[0]?.op === REP_STOSB) {
          stats.repStosbBlockCalls++;
          stats.repStosbIterations += result.instructions;
        }
        return result.instructions;
      }
      if (result.reason === 'fallback' || result.reason === 'fault-boundary')
        blocks.delete(key);
    }
    machine.step();
    return 1;
  }

  function advanceToMs(targetMs) {
    const target = Math.round(targetMs * machine.clockHz / 1000);
    let steps = 0;
    while (machine.cycles < target) {
      // One interpreted instruction may cross the target by its cycle charge;
      // ceil gives the same bound to a native batch.
      const remaining = Math.ceil((target - machine.cycles) /
        machine.functionalInstructionCycles);
      steps += run(Math.min(64, remaining));
    }
    return steps;
  }

  return {run, advanceToMs, stats, ramBridge};
}
