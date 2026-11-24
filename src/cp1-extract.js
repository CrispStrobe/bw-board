// SPDX-License-Identifier: MIT
/** Extract a CP1 whole-system connector, preserving the external solver board. */
import { CP1_TERMINALS } from './devices/cp1.js';
import { getDevice } from './devices.js';

const VALID_TERMINALS = new Set(CP1_TERMINALS.map(terminal => terminal.toLowerCase()));

function wireEnd(wire, side) {
  const end = wire?.[side];
  return {
    part: typeof end === 'string' ? end : end?.part,
    terminal: wire?.[`${side}Terminal`] ?? end?.terminal,
  };
}

export function extractCp1Machine(circuit) {
  const parts = Array.isArray(circuit?.parts) ? circuit.parts : [];
  const computers = parts.filter(part => part.kind === 'kosmos-cp1');
  const reasons = [];
  if (computers.length !== 1) reasons.push('Place exactly one Kosmos CP1 system connector.');
  if (parts.some(part => part.kind !== 'kosmos-cp1' &&
      (['mcu', 'w65c02', 'z80', 'i8086', 'i8088', 'i80386'].includes(part.kind) ||
       getDevice(part.kind)?.gpioFollowsPinStates))) {
    reasons.push('A CP1 circuit cannot share one execution target with another computer.');
  }
  const part = computers[0];
  const expansion = part?.params?.expansion ?? false;
  const clockHz = part?.params?.clockHz ?? 6000000;
  if (typeof expansion !== 'boolean') reasons.push('CP3 expansion must be true or false.');
  if (clockHz !== 6000000) reasons.push('The CP1 system connector is qualified only for its 6 MHz crystal.');
  const ends = [];
  for (const wire of Array.isArray(circuit?.wires) ? circuit.wires : []) {
    ends.push(wireEnd(wire, 'from'), wireEnd(wire, 'to'));
  }
  for (const net of Array.isArray(circuit?.nets) ? circuit.nets : []) {
    if (Array.isArray(net?.terminals)) ends.push(...net.terminals);
  }
  for (const end of ends) {
    if (!part || end?.part !== part.id) continue;
    const terminal = String(end.terminal ?? '').toLowerCase();
    if (!VALID_TERMINALS.has(terminal)) {
      reasons.push(`Unknown Kosmos CP1 terminal: ${end.terminal ?? '(missing)'}.`);
    } else if (!expansion && /^p[345]\./.test(terminal)) {
      reasons.push('Ports 3, 4 and 5 require the CP3 expansion.');
    }
  }
  return {ok: reasons.length === 0, kind: 'cp1', config: {expansion, clockHz, partId: part?.id},
    notes: ['Whole CP1 system connector; internal CPU bus wiring is fixed by the original schematic.'],
    reasons: [...new Set(reasons)]};
}
