// MIT. Representative protected32 microbenchmarks; no guest media or build.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root, arm, workload, stepsText, warmupText] = process.argv.slice(2);
const steps = Number(stepsText), warmupSteps = Number(warmupText);
if (!['ordinary', 'dispatch', 'candidate'].includes(arm) ||
    !['register', 'indexed-memory'].includes(workload) ||
    !Number.isSafeInteger(steps) || steps <= 0 || steps % 3 ||
    !Number.isSafeInteger(warmupSteps) || warmupSteps < 0)
  throw Error('invalid child configuration');
const {ExperimentalI80386ATMachine: Machine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP: config} = await import(
    pathToFileURL(root + '/src/experimental/i80386-at-machine.js'));
const {createI80386NativeDispatcher} = await import(
  pathToFileURL(root + '/src/experimental/i80386-native-dispatch.js'));

function make() {
  const m = new Machine(config);
  const put32 = (address, value) => {
    for (let i = 0; i < 4; i++) m._write386(address + i, value >>> (8 * i) & 255);
  };
  put32(0x1800, 0x4007);
  put32(0x4000 + 0x120 * 4, 0x120007);
  // MOV EAX,1; CMP EAX,2; JNZ back.
  let code = [0xb8, 1, 0, 0, 0, 0x83, 0xf8, 2, 0x75, 0xf6];
  if (workload === 'indexed-memory') {
    // MOV EAX,[EBX+ECX*4+10h]; CMP EAX,EDX; JNZ back.
    code = [0x8b, 0x44, 0x8b, 0x10, 0x39, 0xd0, 0x75, 0xf8];
    put32(0x4000 + 0x130 * 4, 0x130007);
    put32(0x130018, 0x12345679);
  }
  code.forEach((byte, i) => m._write386(0x120000 + i, byte));
  const c = m.cpu;
  c.segmentCaches[1] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: true, readable: true, writable: false};
  c.segmentCaches[3] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: false, readable: true, writable: true};
  c.cr0 = 0x80000001; c.cr3 = 0x1000; c.eip = 0x80120000;
  if (workload === 'indexed-memory') {
    c.ebx = 0x80130000; c.ecx = 2; c.edx = 0x12345678;
  }
  c._translate(c.eip);
  if (workload === 'indexed-memory') c._translate(0x80130018);
  m._chipDebt = 0; m._chipDeadline = 1000;
  return m;
}
async function setup() {
  const m = make();
  return {m, d: arm === 'ordinary' ? null : await createI80386NativeDispatcher(m)};
}
function run({m, d}, count) {
  let retired = 0;
  while (retired < count)
    retired += d ? d.run(Math.min(64, count - retired)) : (m.step(), 1);
  return retired;
}
run(await setup(), warmupSteps);
const state = await setup();
const cpuStart = process.cpuUsage(), start = process.hrtime.bigint();
const retired = run(state, steps);
const executionWallSeconds = Number(process.hrtime.bigint() - start) / 1e9;
const used = process.cpuUsage(cpuStart);
const m = state.m, c = m.cpu;
if (c.halted || c.shutdown || c.lastFault || c.eip !== 0x80120000 ||
    c.eax !== (workload === 'register' ? 1 : 0x12345679))
  throw Error('unexpected terminal CPU state');
const semantic = {
  instructionSnapshot: c._snapshotInstruction(), retired,
  eax: c.eax, eip: c.eip, eflags: c.eflags, cpuCycles: c.cycles,
  machineCycles: m.cycles, chipDebt: m._chipDebt, chipDeadline: m._chipDeadline,
  ramSha256: createHash('sha256').update(m.mem).digest('hex'),
  pit: m.chips.pit1.counters.map(p => ({ce: p.ce, out: p.out})),
  rtc: {phase: m.chips.rtc1.cyclePhase, periodic: m.chips.rtc1.periodicPhase},
  pics: [m.chips.pic1, m.chips.pic2].map(p => ({irr: p.irr, isr: p.isr, imr: p.imr})),
};
console.log(JSON.stringify({arm, workload, steps, warmupSteps,
  executionCpuSeconds: (used.user + used.system) / 1e6,
  executionWallSeconds, semantic, stats: state.d?.stats ?? null}));
