/**
 * i8086 floppy MEDIA BUNDLE runner — the executable half of a GPL-Lab
 * `brickwright-media.json` whose `machine` is `i8086` and whose payload
 * is a bootable floppy (ELKS, and any other real-mode OS that boots a
 * µPD765 floppy the same way).
 *
 * WHY THIS IS A SEPARATE MODULE, not a branch in machine-media.js.
 * `runMediaBundle` in machine-media.js is content-pinned by the AT/386
 * platform receipts (its sha is asserted verbatim), so it cannot grow an
 * i8086 branch without breaking frozen evidence. The i8086 boot path also
 * needs three things the generic slot router has no place for — a named
 * machine CONFIG, a floppy GEOMETRY, and per-OS hardware QUIRKS — so it
 * gets its own entry point here. Nothing in this file is pinned.
 *
 * THE CONTRACT (manifest fields this reads):
 *   machine:       "i8086"
 *   machineConfig: a name in CONFIGS (default "PCXT8086")
 *   slots.floppy:  the filename of the bootable image in `files`
 *   floppy.geometry: {cylinders, heads, sectors, bytesPerSector}
 *   floppy.quirks: names in QUIRKS, applied before reset (e.g.
 *                  "at-floppy-drive-type" — see installFloppyDriveType)
 *   steps:         instructions to run (default 4,000,000)
 *
 * The caller supplies the BIOS ROM bytes (`opts.romBytes`) — the ROM is
 * the app's, not GPL content, so it is not part of the fetched bundle.
 *
 * @module
 */
import {
    I8086Machine,
    PCXT8086, BREADBOARD8086, TIERA8088, SDCARD8086, SERIALSHELL8086,
} from './i8086-machine.js';

/** Named machine configs a manifest may select by string. */
const CONFIGS = { PCXT8086, BREADBOARD8086, TIERA8088, SDCARD8086, SERIALSHELL8086 };

/**
 * Supply INT 13h AH=08h's floppy DRIVE TYPE in BL the way a PC/AT BIOS
 * does — 01h=360K, 02h=1.2M, 03h=720K, 04h=1.44M, 05h=2.88M — as an
 * opt-in hook, so no ROM or receipt-bound core file carries it.
 *
 * ELKS (and other guests that trust the AT CMOS drive-type byte) do
 * `*drivep = fd_types[(BL & 0xFF) - 1]`; with BL=0 that indexes
 * `fd_types[-1]`, whose sector_size reads 256 not 512, and every block
 * lands at the wrong LBA so `/bin/init` is never found. The machine
 * fires onInterrupt at INT ENTRY, before the XT ROM's AH=08h handler
 * (which answers the geometry but leaves BX untouched and preserves it to
 * IRET), so the value written here is what the guest reads back. Scoped
 * to floppies (DL < 80h) with real media, so the HDD path is untouched.
 */
export function installFloppyDriveType(machine) {
    const prior = machine.hooks.onInterrupt;
    machine.hooks.onInterrupt = (ev) => {
        if (ev.vector === 0x13 && ev.source === 'int') {
            const cpu = machine.cpu;
            if (cpu.ah === 0x08 && cpu.dl < 0x80) {
                const geom = machine.chips.fdc1?.drives?.[cpu.dl & 3]?.geom;
                if (geom) {
                    const cyl = geom.cylinders | 0, spt = geom.sectors | 0;
                    cpu.bl = cyl <= 40 ? 1 : spt >= 36 ? 5 : spt >= 18 ? 4 : spt >= 15 ? 2 : 3;
                }
            }
        }
        if (prior) prior(ev);
    };
}

/** Manifest quirk name -> the machine mutation it names. */
const QUIRKS = { 'at-floppy-drive-type': installFloppyDriveType };

const DEFAULT_GEOM = { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 };

/** The CGA text plane (B800:0000) as one printable string. */
export function screenText(machine) {
    const v = machine.mem.subarray(0xb8000, 0xb8000 + 80 * 25 * 2);
    let t = '';
    for (let i = 0; i < v.length; i += 2) {
        t += (v[i] >= 32 && v[i] < 127) ? String.fromCharCode(v[i]) : ' ';
    }
    return t;
}

/**
 * Boot an i8086 floppy media bundle to its acceptance screen.
 *
 * @param {object} manifest - parsed brickwright-media.json (machine === 'i8086')
 * @param {Record<string, Uint8Array>} files - fetched, keyed by filename
 * @param {{romBytes: Uint8Array, hooks?: object, onStep?: (m:object,i:number)=>void}} opts
 *   romBytes: the BIOS ROM (the app's, not GPL content) — REQUIRED
 * @returns {{machine: object, screen: string, expect: {text: string, ok: boolean}[]}}
 */
export function runI8086FloppyBundle(manifest, files, opts = {}) {
    if (manifest.machine !== 'i8086') {
        throw new Error(`runI8086FloppyBundle: machine is '${manifest.machine}', expected 'i8086'`);
    }
    if (!opts.romBytes) {
        throw new Error('runI8086FloppyBundle: opts.romBytes (the BIOS ROM) is required');
    }
    const config = CONFIGS[manifest.machineConfig] || PCXT8086;
    const machine = new I8086Machine(config, opts.hooks || {});

    for (const q of manifest.floppy?.quirks || []) {
        const apply = QUIRKS[q];
        if (!apply) throw new Error(`runI8086FloppyBundle: unknown quirk '${q}'`);
        apply(machine);
    }

    machine.loadRom(opts.romBytes);

    const fname = manifest.slots?.floppy;
    if (!fname) throw new Error('runI8086FloppyBundle: manifest has no slots.floppy');
    const bytes = files[fname];
    if (!bytes) throw new Error(`runI8086FloppyBundle: file not provided: ${fname}`);
    machine.chips.fdc1.insert(0, bytes, manifest.floppy?.geometry || DEFAULT_GEOM);

    machine.reset();
    const steps = manifest.steps | 0 || 4_000_000;
    for (let i = 0; i < steps; i++) {
        machine.step();
        if (opts.onStep) opts.onStep(machine, i);
    }

    const screen = screenText(machine);
    const expect = (manifest.expect || []).map((text) => ({ text, ok: screen.includes(text) }));
    return { machine, screen, expect };
}
