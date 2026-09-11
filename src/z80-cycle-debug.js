/**
 * A cycle-mode Z80 debug target over the optional floooh provider.
 *
 * A SEPARATE TARGET, NOT A MODE OF THE INSTRUCTION ONE. It declares
 * `steps: ['cycle']` and no breakpoints, publishes one `cycle`/`tick` fact per
 * real tick, and advertises `recording: []` because provider-state snapshots
 * are not a complete machine checkpoint -- the peripherals are not in them.
 *
 * ITS CLOCK IS `z80-tstates` AND THAT IS NOT THE INSTRUCTION TARGET'S
 * `z80-cycles`. The two are never live together: the factory selects one
 * execution mode or the other and returns a single target, so no run contains
 * facts from both and nothing compares them. Renaming this to match would
 * describe a cross-timeline hazard that does not exist here.
 *
 * @module
 */

import {createFlooohZ80CycleProvider} from './floooh-z80-cycle-provider.js';

export async function createZ80CycleDebugTarget(opts = {}) {
  const provider = await createFlooohZ80CycleProvider({loadModule: opts.loadCycleModule,
    clockHz: opts.config?.clockHz ?? 7_372_800});
  if (!provider.accepted) return provider;
  const listeners = new Set();
  let runState = 'halted';
  let pendingCycles = 0;
  const target = {
    capabilities: () => ({steps: ['cycle'], breakpoints: [], events: ['cycle', 'signal'],
      fidelity: {instruction: 'unsupported', cycle: 'recorded'}, timeFreezes: true,
      // Provider-state snapshots exist, but complete machine/peripheral
      // checkpoints arrive with the cycle-machine integration slice.
      recording: []}),
    cycleProvider: () => provider.metadata(),
    state: () => runState,
    onDebugEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    debugTime: () => provider.debugTime(),
    captureCheckpoint: () => ({schema: 1, target: 'z80', mode: 'cycle',
      time: provider.debugTime(), provider: provider.captureState()}),
    restoreCheckpoint(snapshot) {
      if (!snapshot || snapshot.schema !== 1 || snapshot.target !== 'z80' || snapshot.mode !== 'cycle') {
        throw new TypeError('incompatible Z80 cycle checkpoint');
      }
      provider.restoreState(snapshot.provider); runState = 'halted'; pendingCycles = 0; return true;
    },
    regs: () => provider.registers(),
    run() { runState = 'running'; pendingCycles = 0; },
    halt() { runState = 'halted'; pendingCycles = 0; },
    step(kind, count = 1) {
      if (kind !== 'cycle') return {unsupported: `Z80 cycle provider does not yet implement ${kind} stepping`};
      if (!Number.isSafeInteger(count) || count < 1) return {unsupported: 'cycle count must be positive'};
      runState = 'running'; pendingCycles = count;
    },
    runFor(budgetNs) {
      if (runState !== 'running') return 'halted';
      const budget = Math.min(65_536,
        Math.max(1, Math.floor(budgetNs * provider.metadata().clockHz / 1e9)));
      const wanted = pendingCycles ? Math.min(budget, pendingCycles) : budget;
      const facts = provider.tickBatch(Math.min(wanted, provider.costMetadata().maxBatchTicks));
      for (const fact of facts) {
        const event = {cpuId: 'z80', kind: 'cycle', phase: 'tick', fidelity: 'recorded',
          time: {ticks: fact.ticks, domain: 'z80-tstates', hz: provider.metadata().clockHz},
          signals: fact.pins, retired: fact.retired};
        for (const listener of [...listeners]) listener(event);
        if (pendingCycles && --pendingCycles === 0) runState = 'halted';
      }
      return runState === 'halted' ? 'halted' : 'budget';
    },
    timeNs: () => BigInt(Math.round(provider.debugTime().ticks * 1e9 / provider.metadata().clockHz))
  };
  const adapter = {provider, attachBoard() {}, timeNs: target.timeNs};
  return {accepted: true, target, adapter};
}
