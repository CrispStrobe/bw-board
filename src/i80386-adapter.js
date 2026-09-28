/** Browser-safe adapter for the opt-in experimental 80386 AT machine. */
import { ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL,
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA } from './experimental/i80386-at-machine.js';
import ExperimentalATA16 from './experimental/ata16.js';
import { parseDosboxConfig } from './dosbox-config.js';

function browserFreeDosVgaConfig() {
  const base = PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA;
  return {...base, a20: {...base.a20, mouse: true}, chips: base.chips.map(chip => {
    if (chip.kind !== 'rtc') return chip;
    const cmos = new Uint8Array(0x40);
    for (const [index, value] of chip.initialCmos) cmos[index] = value;
    cmos[0x14] |= 4; // PS/2 auxiliary mouse in the AT equipment byte.
    cmos[0x3d] = 0x21; // Bochs BIOS: try floppy A: before fixed disk C:.
    let checksum = 0;
    for (let index = 0x10; index <= 0x2d; index++) checksum = (checksum + cmos[index]) & 0xffff;
    cmos[0x2e] = checksum >>> 8;
    cmos[0x2f] = checksum & 0xff;
    const initialCmos = chip.initialCmos.map(([index]) => [index, cmos[index]]);
    for (const index of [0x14, 0x2e, 0x2f, 0x3d])
      if (!initialCmos.some(([present]) => present === index)) initialCmos.push([index, cmos[index]]);
    return {...chip, initialCmos};
  })};
}

export function createI80386Adapter(opts = {}) {
  if (opts.config && opts.profile) throw new Error('386 adapter accepts config or profile, not both');
  if (opts.profile && opts.profile !== 'freedos-vga')
    throw new Error(`unknown 386 adapter profile: ${opts.profile}`);
  const config = opts.config ?? (opts.profile === 'freedos-vga'
    ? browserFreeDosVgaConfig() : PCAT80386_EXPERIMENTAL);
  const machine = new ExperimentalI80386ATMachine(config, {
    ataImage: opts.ataImage, ataGeometry: opts.ataGeometry,
    ataIntersectorDelayCycles: opts.ataIntersectorDelayCycles,
    onInterrupt: opts.onInterrupt, onPortAccess: opts.onPortAccess,
  });
  let board = null;
  let unloggedBoardInputs = false;
  let nativeDispatcher = null;
  const stats = { pinChangeCount: 0, advanceToCount: 0 };
  function attachBoard(next) {
    board = next || { advanceTo() {}, setPin() {}, readPin() { return 0; } };
    unloggedBoardInputs = typeof board.readPin === 'function';
    machine.reset();
  }
  function timeNs() { return BigInt(Math.round(machine.tMs * 1e6)); }
  function advanceNs(deltaNs) {
    const targetMs = machine.tMs + Number(deltaNs) / 1e6;
    if (nativeDispatcher) nativeDispatcher.advanceToMs(targetMs);
    else machine.advanceToMs(targetMs);
    board?.advanceTo?.(timeNs()); stats.advanceToCount++;
  }
  if (opts.rom) machine.loadRom(opts.rom, opts.romAt);
  return {
    machine, clockHz: config.clockHz, attachBoard, advanceNs, timeNs, stats,
    get nativeDispatcher() { return nativeDispatcher; },
    async enableNativeBlocks(options = {}) {
      if (nativeDispatcher) return nativeDispatcher;
      const { createI80386NativeDispatcher } = await import('./experimental/i80386-native-dispatch.js');
      nativeDispatcher = await createI80386NativeDispatcher(machine, options);
      return nativeDispatcher;
    },
    runNativeBlocks(maxInstructions) {
      if (!nativeDispatcher) throw new Error('i80386 native blocks are not enabled');
      return nativeDispatcher.run(maxInstructions);
    },
    unloggedBoardInputs: () => unloggedBoardInputs,
    loadRom(bytes, at) { machine.loadRom(bytes, at); },
    loadBiosRom(bytes) {
      // The reset alias is fetched high, then the AT BIOS executes in F000h.
      // Mirror the accepted CLI setup without changing other ROM slots.
      machine.loadRom(bytes, 0xf0000);
      machine.loadRom(bytes, 0xffff0000);
    },
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
    attachFloppyImage(bytes) {
      const image = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const geometry = {
        368640: {cylinders: 40, heads: 2, sectors: 9, bytesPerSector: 512},
        1228800: {cylinders: 80, heads: 2, sectors: 15, bytesPerSector: 512},
      }[image.length];
      if (!geometry) throw new Error('386 AT floppy image must be 360KiB or 1.2MiB');
      const fdc = machine.chips.fdc1;
      if (typeof fdc?.insert !== 'function') throw new Error('386 AT profile has no floppy controller');
      fdc.insert(0, image.slice(), geometry);
    },
    sendScancode(scancode) { return machine.keyIn?.(scancode) ?? false; },
    keyIn(scancode) { return machine.keyIn?.(scancode) ?? false; },
    mouseIn(event) { return machine.mouseIn?.(event) ?? false; },
    video() { return machine.video?.() ?? null; },
  };
}
