/**
 * Optional product boundary for the qualified floooh/chips Z80 engine.
 *
 * THE THIRD-PARTY SOURCE AND WASM ARE DELIBERATELY NOT BUNDLED. A caller
 * supplies `loadModule` for a reviewed wrapper; without one there is no cycle
 * engine and the boundary refuses by name rather than importing something
 * nobody reviewed. That refusal is the point of the file, which is why it is
 * source here rather than a dependency.
 *
 * WHAT THE BOUNDARY CHECKS BEFORE IT ACCEPTS A MODULE: the wrapper ABI, the
 * loader actually resolving, and the module's own declared costs against host
 * ceilings -- each a named refusal code, so a caller learns which of the three
 * failed instead of getting a generic unavailable. State snapshots enumerate
 * every named CPU field and are validated BEFORE the core is touched, so a
 * malformed restore cannot leave the engine half-written.
 *
 * @module
 */

/** Optional product boundary for the qualified floooh/chips Z80 engine.
 * Third-party source/WASM is deliberately not bundled here. A caller must
 * explicitly supply a loader for a reviewed wrapper module. */

const PIN_NAMES = Object.freeze(['address', 'data', 'm1', 'mreq', 'iorq', 'rd', 'wr',
  'rfsh', 'halt', 'wait', 'int', 'nmi']);
const STATE_FIELDS = Object.freeze(['step', 'addr', 'dlatch', 'opcode', 'hlxIdx',
  'prefixActive', 'pins', 'intBits', 'pc', 'af', 'bc', 'de', 'hl', 'ix', 'iy',
  'wz', 'sp', 'ir', 'af2', 'bc2', 'de2', 'hl2', 'im', 'iff1', 'iff2']);

const refusal = (code, reason) => Object.freeze({accepted: false, code, reason});
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const BOOL_STATE = new Set(['prefixActive', 'iff1', 'iff2']);
const HOST_MAX_BATCH_TICKS = 65_536;
const HOST_MAX_EVENT_BYTES = 4 * 1024 * 1024;
const HOST_MAX_MODULE_BYTES = 2 * 1024 * 1024;

function validateState(state) {
  if (!plain(state) || state.schema !== 1 || state.engine !== 'floooh-z80' ||
      !plain(state.cpu) || !plain(state.pinState) || !Number.isSafeInteger(state.ticks) || state.ticks < 0 ||
      STATE_FIELDS.some(field => !Object.hasOwn(state.cpu, field)) ||
      PIN_NAMES.some(field => !Object.hasOwn(state.pinState, field)) ||
      STATE_FIELDS.some(field => BOOL_STATE.has(field) ? typeof state.cpu[field] !== 'boolean' :
        !Number.isSafeInteger(state.cpu[field])) ||
      PIN_NAMES.some(field => !Number.isSafeInteger(state.pinState[field]) &&
        typeof state.pinState[field] !== 'boolean')) {
    throw new TypeError('incomplete floooh Z80 provider state');
  }
  return clone(state);
}

export async function createFlooohZ80CycleProvider({loadModule, clockHz}) {
  if (typeof loadModule !== 'function') {
    return refusal('cycle-provider-unavailable',
      'floooh Z80 cycle mode was requested but no reviewed module loader was supplied');
  }
  if (!Number.isSafeInteger(clockHz) || clockHz <= 0) {
    return refusal('invalid-cycle-clock', 'Z80 cycle provider requires a positive integer clock');
  }
  let core;
  try { core = await loadModule(); } catch (error) {
    return refusal('cycle-provider-load-failed', error?.message || String(error));
  }
  for (const method of ['reset', 'tickBatch', 'registers', 'saveState', 'loadState', 'costMetadata']) {
    if (typeof core?.[method] !== 'function') {
      return refusal('cycle-provider-abi-mismatch', `floooh Z80 wrapper lacks ${method}()`);
    }
  }
  let ticks = 0;
  let pinState;
  try { pinState = clone(core.reset()); } catch (error) {
    return refusal('cycle-provider-reset-failed', error?.message || String(error));
  }
  if (!plain(pinState) || PIN_NAMES.some(name => !Object.hasOwn(pinState, name))) {
    return refusal('cycle-provider-abi-mismatch', 'floooh Z80 wrapper returned incomplete pins');
  }
  const cost = core.costMetadata();
  if (!plain(cost) || !Number.isSafeInteger(cost.maxBatchTicks) || cost.maxBatchTicks < 1 ||
      cost.maxBatchTicks > HOST_MAX_BATCH_TICKS || !Number.isSafeInteger(cost.maxEvents) ||
      cost.maxEvents < cost.maxBatchTicks || cost.maxEvents > HOST_MAX_BATCH_TICKS ||
      !Number.isSafeInteger(cost.eventBytes) || cost.eventBytes < 1 ||
      cost.eventBytes > HOST_MAX_EVENT_BYTES || !Number.isSafeInteger(cost.moduleBytes) ||
      cost.moduleBytes < 1 || cost.moduleBytes > HOST_MAX_MODULE_BYTES) {
    return refusal('cycle-provider-cost-unsupported', 'floooh Z80 wrapper exceeds bounded batch/module limits');
  }

  const drainBatch = count => {
    if (!Number.isSafeInteger(count) || count < 1 || count > cost.maxBatchTicks) {
      throw new RangeError(`Z80 cycle batch must contain 1..${cost.maxBatchTicks} ticks`);
    }
    const batch = core.tickBatch(count);
    if (!Array.isArray(batch) || batch.length !== count || batch.length > cost.maxEvents) {
      throw new Error('floooh Z80 wrapper returned an incomplete or oversized cycle batch');
    }
    for (const next of batch) {
      if (!plain(next) || !plain(next.registers) ||
          PIN_NAMES.some(name => !Object.hasOwn(next, name))) {
        throw new Error('floooh Z80 wrapper emitted incomplete pins/registers');
      }
    }
    return batch.map(next => {
      pinState = clone(next); ticks++;
      return Object.freeze({ticks, pins: Object.freeze(clone(pinState)),
        registers: Object.freeze(clone(next.registers)), retired: next.retired === true});
    });
  };

  return {
    accepted: true,
    metadata() { return {schema: 1,
      engine: 'floooh-z80@ca7d7ddd3ba77b48685d24120cf413ea53786767', boundary: 'clock',
      timeDomain: 'z80-tstates', clockHz, fidelity: 'recorded', resumable: true,
      signals: [...PIN_NAMES], checkpoint: true}; },
    costMetadata() { return Object.freeze({...cost, transport: 'bounded-batch-drain'}); },
    tick() { return drainBatch(1)[0]; },
    tickBatch(count) { return Object.freeze(drainBatch(count)); },
    registers() { return clone(core.registers()); },
    debugTime() { return {ticks, domain: 'z80-tstates', hz: clockHz}; },
    captureState() {
      const cpu = core.saveState();
      return validateState({schema: 1, engine: 'floooh-z80', ticks,
        cpu: Object.fromEntries(STATE_FIELDS.map(field => [field, clone(cpu[field])])),
        pinState: Object.fromEntries(PIN_NAMES.map(field => [field, clone(pinState[field])]))});
    },
    restoreState(snapshot) {
      const state = validateState(snapshot);
      // Validation and defensive cloning finish before the core is mutated.
      const result = core.loadState(clone(state.cpu), clone(state.pinState));
      if (result === false || result?.accepted === false) throw new Error('floooh Z80 state restore refused');
      ticks = state.ticks; pinState = clone(state.pinState);
      return true;
    }
  };
}

export {PIN_NAMES as FLOOOH_Z80_PINS, STATE_FIELDS as FLOOOH_Z80_STATE_FIELDS};
