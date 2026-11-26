// SPDX-License-Identifier: MIT
// MOS KIM-1 User Manual, figures 3.5–3.7. PB1–PB4 select a 74145 output.
const matrix = ['0123456'.split(''), '789ABCD'.split(''), ['E', 'F', 'AD', 'DA', '+', 'GO', 'PC']];
const masks = ['3F','06','5B','4F','66','6D','7D','07','7F','6F','77','7C','39','5E','79','71'];
const glyphs = new Map([[0, ' '], [64, '-'], ...masks.map((mask, index) => [parseInt(mask, 16), index.toString(16).toUpperCase()])]);
const keyHold = 50_000;
const keyGap = 35_000;
const persistence = 35_000;
const pin = (data, direction, mask) => ((data | ~direction) & mask) !== 0 ? 1 : 0;

export function createKim1FrontPanel() {
  return {
    pressed: null, keyPhase: 0, keyQueue: [],
    segments: Array(6).fill(0), refresh: Array(6).fill(-Infinity), clock: 0,
    tty: false, bitCycles: 0, incoming: [], incomingStart: null, start: null, next: 0, bits: 0, byte: 0,
    received: '', previous: 1
  };
}

export function queueKim1FrontKey(panel, key) {
  if (!matrix.some(row => row.includes(key))) return false;
  if (panel.keyQueue.length >= 128) throw new Error('KIM-1 keypad queue is full.');
  panel.keyQueue.push(key);
  return true;
}

export function setKim1Tty(panel, config) {
  const bitCycles = Math.round(1_000_000 / config?.baud);
  if (config?.enabled && (!Number.isInteger(bitCycles) || bitCycles < 30 || bitCycles > 100_000)) {
    throw new Error('Choose a supported KIM-1 TTY baud rate.');
  }
  Object.assign(panel, {tty: !!config?.enabled, bitCycles, incoming: [], incomingStart: null, start: null,
    next: 0, bits: 0, byte: 0, previous: 1});
}

export function sendKim1Tty(panel, text) {
  if (!panel.tty) throw new Error('Switch the KIM-1 to TTY mode first.');
  if (typeof text !== 'string' || !/^[\x00-\x7f]*$/.test(text) || panel.incoming.length + text.length > 1_048_576) {
    throw new Error('TTY input must be seven-bit ASCII and fit in the input queue.');
  }
  for (let i = 0; i < text.length; i++) panel.incoming.push(text.charCodeAt(i));
}

function keyboardLine(panel) {
  if (!panel.tty) return 1;
  if (panel.incomingStart === null) return 1;
  const bit = Math.floor((panel.clock - panel.incomingStart) / panel.bitCycles);
  if (bit < 0) return 1;
  if (bit === 0) return 0;
  if (bit > 8) return 1;
  return (panel.incoming[0] >> (bit - 1)) & 1;
}

export function pollKim1Tty(panel, io) {
  if (panel.tty && panel.incomingStart === null && panel.incoming.length && !pin(io.pb, io.ddrb, 32)) {
    panel.incomingStart = panel.clock + Math.round(panel.bitCycles / 4);
  }
}

export function stepKim1FrontPanel(panel, io, cycles) {
  panel.clock += cycles;
  if (panel.clock >= panel.keyPhase) {
    if (panel.pressed !== null) { panel.pressed = null; panel.keyPhase = panel.clock + keyGap; }
    else if (panel.keyQueue.length) { panel.pressed = panel.keyQueue.shift(); panel.keyPhase = panel.clock + keyHold; }
  }
  const select = (((io.pb | ~io.ddrb) & 30) >> 1);
  const row = matrix[select];
  const column = row?.indexOf(panel.pressed) ?? -1;
  if (panel.tty) {
    if (panel.incomingStart !== null && panel.clock - panel.incomingStart >= panel.bitCycles * 11) {
      panel.incoming.shift();
      panel.incomingStart = null;
    }
  }
  const keyboard = pin(io.pb, io.ddrb, 32) ? 1 : keyboardLine(panel);
  io.inputA = (keyboard << 7) | (0x7f ^ (column >= 0 ? 1 << (6 - column) : !row && panel.tty ? 1 : 0));
  io.inputB = 0xff;
  const mask = io.pa & io.ddra & 127;
  if (select >= 4 && select <= 9 && mask) {
    panel.segments[select - 4] = mask;
    panel.refresh[select - 4] = panel.clock;
  }
  if (!panel.tty) return;
  const printer = keyboard & pin(io.pb, io.ddrb, 1);
  if (panel.start === null && panel.previous && !printer) {
    panel.start = panel.clock;
    panel.next = panel.clock + Math.round(panel.bitCycles * 1.5);
    panel.bits = 0;
    panel.byte = 0;
  } else if (panel.start !== null && panel.clock >= panel.next) {
    if (panel.bits === 8) {
      if (printer) panel.received = (panel.received + String.fromCharCode(panel.byte & 127)).slice(-8192);
      panel.start = null;
    } else {
      panel.byte |= printer << panel.bits++;
      panel.next += panel.bitCycles;
    }
  }
  panel.previous = printer;
}

export function kim1FrontSegments(panel) {
  return panel.segments.map((mask, digit) => panel.clock - panel.refresh[digit] < persistence ? mask : 0);
}
export function kim1FrontText(masks) { return masks.map(mask => glyphs.get(mask) ?? '?').join(''); }
