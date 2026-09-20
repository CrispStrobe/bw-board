/** Browser-safe adapter for the opt-in experimental 80386 AT machine. */
import { ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL } from './experimental/i80386-at-machine.js';
import ExperimentalATA16 from './experimental/ata16.js';
import { parseDosboxConfig } from './dosbox-config.js';

export function createI80386Adapter(opts = {}) {
  const config = opts.config ?? PCAT80386_EXPERIMENTAL;
  const machine = new ExperimentalI80386ATMachine(config, {
    ataImage: opts.ataImage, ataGeometry: opts.ataGeometry,
    ataIntersectorDelayCycles: opts.ataIntersectorDelayCycles,
    onInterrupt: opts.onInterrupt, onPortAccess: opts.onPortAccess,
  });
  let board = null;
  let unloggedBoardInputs = false;
  const stats = { pinChangeCount: 0, advanceToCount: 0 };
  function attachBoard(next) {
    board = next || { advanceTo() {}, setPin() {}, readPin() { return 0; } };
    unloggedBoardInputs = typeof board.readPin === 'function';
    machine.reset();
  }
  function timeNs() { return BigInt(Math.round(machine.tMs * 1e6)); }
  function advanceNs(deltaNs) {
    machine.advanceToMs(machine.tMs + Number(deltaNs) / 1e6);
    board?.advanceTo?.(timeNs()); stats.advanceToCount++;
  }
  if (opts.rom) machine.loadRom(opts.rom, opts.romAt);
  return {
    machine, clockHz: config.clockHz, attachBoard, advanceNs, timeNs, stats,
    unloggedBoardInputs: () => unloggedBoardInputs,
    loadRom(bytes, at) { machine.loadRom(bytes, at); },
    loadDosboxConfig(text) { this.dosboxConfig = parseDosboxConfig(text); return this.dosboxConfig; },
    attachAtaImage(bytes) {
      const image = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!machine.ata) {
        const geometry = { heads: 4, sectors: 17, cylinders: image.length / (4 * 17 * 512) };
        if (!Number.isInteger(geometry.cylinders)) throw new Error('ATA image size is not divisible by the default 4x17 geometry');
        machine.ata = new ExperimentalATA16(image, geometry, { onIRQ: active => machine.chips.pic2?.setIRQ(6, active ? 1 : 0), intersectorDelayCycles: 8192 });
        machine.attachDevice('ata', machine.ata);
        return;
      }
      const expected = machine.ata.geometry.cylinders * machine.ata.geometry.heads * machine.ata.geometry.sectors * 512;
      if (image.length !== expected) throw new Error(`ATA image is ${image.length} bytes; expected ${expected}`);
      machine.ata.image = image.slice(); machine.ata.reset();
    },
    sendScancode(scancode) { return machine.keyIn?.(scancode) ?? false; },
    keyIn(scancode) { return machine.keyIn?.(scancode) ?? false; },
    video() { return machine.video?.() ?? null; },
  };
}
