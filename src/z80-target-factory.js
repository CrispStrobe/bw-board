/**
 * Z80 target selection, including the OPTIONAL cycle core.
 *
 * Extracted from debug-target-factory.js so the cycle path is reached only by
 * a dynamic import: the optional engine and its wrapper are never pulled into
 * a bundle by the fast path, which is the whole reason the cycle provider is a
 * separate boundary.
 *
 * `executionMode` selects one target or the other and they are never live
 * together -- which is why the two carry different clock domain bases and
 * nothing compares them (see floooh-z80-cycle-provider.js).
 *
 * @module
 */

/** Dependency-isolated Z80 target selection, including the optional cycle core. */
export async function createZ80Target (opts = {}) {
  const {board, rom, config, pc, cpm} = opts;
  const executionMode = opts.executionMode ?? 'fast';
  if (!['fast', 'cycle'].includes(executionMode)) {
    throw new Error(`unknown Z80 execution mode: ${executionMode}`);
  }
  if (executionMode === 'cycle') {
    const {createZ80CycleDebugTarget} = await import('./z80-cycle-debug.js');
    const result = await createZ80CycleDebugTarget(opts);
    if (!result.accepted) return {target: null, adapter: null, refusal: result};
    if (board) result.adapter.attachBoard(board);
    return {target: result.target, adapter: result.adapter};
  }
  const {createZ80Adapter} = await import('./z80-adapter.js');
  const adapter = createZ80Adapter({config, rom, romAt: opts.romAt, pc, cpm});
  if (board) adapter.attachBoard(board);
  else adapter.attachBoard({advanceTo () {}});
  let target = null;
  try {
    const mod = await import('./z80-debug.js');
    if (mod.createZ80DebugTarget) target = mod.createZ80DebugTarget(adapter, {cpuId: opts.cpuId});
  } catch { /* adapter-only mode */ }
  return {target, adapter};
}

export default createZ80Target;
