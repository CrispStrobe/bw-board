/** Extract a CP1 whole-system connector, preserving the external solver board. */
export function extractCp1Machine(circuit) {
  const parts = circuit?.parts || [];
  const computers = parts.filter(part => part.kind === 'kosmos-cp1');
  const reasons = [];
  if (computers.length !== 1) reasons.push('Place exactly one Kosmos CP1 system connector.');
  if (parts.some(part => ['w65c02', 'z80', 'i8086', 'i8088'].includes(part.kind))) {
    reasons.push('A CP1 circuit cannot share one execution target with another computer.');
  }
  const part = computers[0];
  const expansion = part?.params?.expansion ?? false;
  const clockHz = part?.params?.clockHz ?? 6000000;
  if (typeof expansion !== 'boolean') reasons.push('CP3 expansion must be true or false.');
  if (clockHz !== 6000000) reasons.push('The CP1 system connector is qualified only for its 6 MHz crystal.');
  if (!expansion) {
    for (const wire of circuit?.wires || []) {
      for (const end of [
        [typeof wire.from === 'string' ? wire.from : wire.from?.part, wire.fromTerminal ?? wire.from?.terminal],
        [typeof wire.to === 'string' ? wire.to : wire.to?.part, wire.toTerminal ?? wire.to?.terminal]
      ]) {
        if (end[0] === part?.id && /^P[345]\./.test(end[1] || '')) {
          reasons.push('Ports 3, 4 and 5 require the CP3 expansion.');
        }
      }
    }
  }
  return {ok: reasons.length === 0, kind: 'cp1', config: {expansion, clockHz, partId: part?.id},
    notes: ['Whole CP1 system connector; internal CPU bus wiring is fixed by the original schematic.'],
    reasons: [...new Set(reasons)]};
}
