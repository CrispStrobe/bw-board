// SPDX-License-Identifier: MIT
// CP2's digital data line. Time is integer microseconds from tape start.
export const CP2_DATA = 0x80;
export const CP2_SAVE = 0x40;
const LEADER_US = 16_000_000;
const SHORT_US = 35_000;
const LONG_US = 65_000;
const MAX_TRANSITIONS = 20_000;
const MAX_DURATION_US = 1_800_000_000;

/** A tape starts high. Each entry toggles the recovered data line. */
export function copyCp2Transitions(transitions) {
  if (!(transitions instanceof Uint32Array) && !Array.isArray(transitions)) {
    throw new TypeError('CP2 transitions must be a Uint32Array or an array');
  }
  if (transitions.length > MAX_TRANSITIONS) throw new RangeError('Too many CP2 transitions');
  let previous = 0;
  return Uint32Array.from(transitions, time => {
    if (!Number.isInteger(time) || time <= previous || time > MAX_DURATION_US) {
      throw new RangeError('CP2 transitions must increase within the maximum tape duration');
    }
    previous = time;
    return time;
  });
}

function byteAddress(index) {
  const offset = index & 255;
  return (index & 256) | ((256 - offset) & 255);
}

export function encodeCp2Memory(memory) {
  if (!(memory instanceof Uint8Array) || (memory.length !== 256 && memory.length !== 512)) {
    throw new RangeError('CP2 requires a 256-byte CP1 image or a 512-byte CP3 image');
  }
  const transitions = new Uint32Array(memory.length * 16 + 1);
  let time = LEADER_US;
  let edge = 0;
  transitions[edge++] = time;
  for (let index = 0; index < memory.length; index++) {
    const value = memory[byteAddress(index)];
    for (let bit = 0; bit < 8; bit++) {
      const one = Boolean(value & (1 << bit));
      time += one ? SHORT_US : LONG_US;
      transitions[edge++] = time;
      time += one ? LONG_US : SHORT_US;
      transitions[edge++] = time;
    }
  }
  return transitions;
}

export function decodeCp2Memory(input) {
  const transitions = copyCp2Transitions(input);
  const byteLength = (transitions.length - 1) / 16;
  if (byteLength !== 256 && byteLength !== 512) throw new RangeError('Incomplete CP2 memory image');
  if (transitions[0] < 200_000) throw new RangeError('Missing CP2 lead tone');
  const bytes = new Uint8Array(byteLength);
  let edge = 0;
  for (let index = 0; index < byteLength; index++) {
    let value = 0;
    for (let bit = 0; bit < 8; bit++) {
      const low = transitions[edge + 1] - transitions[edge];
      const high = transitions[edge + 2] - transitions[edge + 1];
      edge += 2;
      const total = low + high;
      if (total < 65_000 || total > 145_000 || Math.min(low, high) * 5 < total ||
          Math.abs(high - low) * 7 < total) throw new RangeError('Invalid CP2 bit timing');
      if (low < high) value |= 1 << bit;
    }
    bytes[byteAddress(index)] = value;
  }
  return bytes;
}

/** Listen to the terminal latch without owning the CP1 clock. */
export function recordCp2Signal(machine) {
  const transitions = [];
  const expectedEdges = machine.capacity * 32 + 1;
  const readTime = ms => Math.round(ms * 1000);
  let latch = machine.getPortState(1).latch;
  let leaderStart = (latch & CP2_SAVE) && (latch & CP2_DATA) ? readTime(machine.tMs) : null;
  let finished = false;
  const unsubscribe = machine.addPortListener((port, state, tMs) => {
    if (port !== 1 || finished) return;
    const previous = latch;
    latch = state.latch;
    if (leaderStart === null && (latch & CP2_SAVE) && (latch & CP2_DATA)) {
      leaderStart = readTime(tMs);
    } else if (leaderStart !== null && (previous & CP2_SAVE) && ((latch ^ previous) & CP2_DATA)) {
      const at = readTime(tMs) - leaderStart;
      if (at > 0) transitions.push(at);
      if (transitions.length === expectedEdges) finished = true;
    }
    if (leaderStart !== null && (previous & CP2_SAVE) && !(latch & CP2_SAVE)) finished = true;
  });
  const cancel = () => {
    unsubscribe();
    finished = true;
  };
  return {
    get finished() { return finished; },
    cancel,
    stop() {
      cancel();
      return copyCp2Transitions(transitions);
    },
  };
}
