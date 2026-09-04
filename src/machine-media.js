/**
 * Machine media — the one place that knows how software gets ONTO a
 * machine, so the app can offer "load ROM/tape/snapshot" generically.
 *
 * Every loader here already existed somewhere (loadRom at an address,
 * CP/M .COM at $0100, .tap/.tzx tape decks, .sna/.z80 snapshots, hex
 * flash); what was missing was a DESCRIBABLE surface: per target kind,
 * a list of SLOTS — named, typed load points — that a UI can render as
 * drop targets without knowing any machine's internals.
 *
 * Multi-file software travels as a plain {slotId: bytes} map. The app
 * side builds that map from individual drops or from a .zip bundle
 * whose brickwright-media.json names {slot: filename} — the zip layer
 * stays in the app (JSZip lives there); this module never parses
 * archives.
 *
 * describeMedia(kind)  → [{id, label, accept, required?, at?}]
 * applyMedia(target, entries, opts?) → {applied: [...], errors: [...]}
 *
 * `target` is a debug target from createDebugTarget — applyMedia
 * reaches its adapter/machine through the same surfaces the factory
 * wires (adapter.loadRom, machine.loadTape, machine.loadSnapshot...),
 * so a new machine kind that grows a loader only has to register a
 * slot here.
 *
 * @module
 */

/** @typedef {{id: string, label: string, accept: string[], required?: boolean, at?: number, hint?: string}} MediaSlot */

const HEX_EXT = ['.hex', '.ihx'];
const BIN_EXT = ['.bin', '.rom'];

/** @type {Record<string, MediaSlot[]>} */
const SLOTS = {
    eater6502: [
        { id: 'rom', label: 'ROM image', accept: [...BIN_EXT, ...HEX_EXT], at: 0x8000,
          hint: '32 KB at $8000, vectors included — what cc65/ca65 emit' },
        { id: 'sd-image', label: 'SD card image', accept: ['.img', '.bin', '.sd'],
          hint: 'raw block image for a wired sdcard chip (Bad Apple streams from here)' },
    ],
    gpascal: [
        { id: 'rom', label: 'ROM image', accept: BIN_EXT, at: 0x8000,
          hint: 'defaults to the vendored G-Pascal ROM; replace to run your own' },
    ],
    i8086: [
        // `at` is a LOAD address, and for a ROM it is not a constant: the reset
        // vector is at FFFF0h, so an image has to end at FFFFFh and a 64K BIOS
        // therefore starts at F0000h while a 32K monitor starts at F8000h. The
        // host computes `0x100000 - length`; the value here is the 64K case,
        // which is the only one a fixed number can describe.
        { id: 'rom', label: 'ROM image', accept: BIN_EXT, at: 0xf0000,
          hint: 'loaded so it ENDS at FFFFFh — the reset vector at FFFF0h must fall inside it' },
        { id: 'com', label: 'DOS program (.com)', accept: ['.com'], at: 0x0100,
          hint: 'runs on the DOS service layer, which is a different machine from a BIOS board' },
        { id: 'exe', label: 'DOS program (.exe)', accept: ['.exe'],
          hint: 'MZ header, relocated on load' },
        { id: 'floppy', label: 'Floppy image (360K)', accept: ['.img', '.ima', '.dsk'],
          hint: 'boots through the µPD765 and the 8237 when the board has them' },
    ],
    z80: [
        { id: 'rom', label: 'ROM image', accept: BIN_EXT, at: 0x0000 },
        { id: 'com', label: 'CP/M program (.com)', accept: ['.com'], at: 0x0100,
          hint: 'runs over the BDOS shim — BBC BASIC lives here' },
        { id: 'tape', label: 'Tape (.tap/.tzx)', accept: ['.tap', '.tzx'] },
        { id: 'snapshot', label: 'Snapshot (.sna/.z80)', accept: ['.sna', '.z80'] },
    ],
    zx48: [
        { id: 'rom', label: 'System ROM (16 KB)', accept: BIN_EXT, at: 0x0000 },
        { id: 'tape', label: 'Tape (.tap/.tzx)', accept: ['.tap', '.tzx'] },
        { id: 'snapshot', label: 'Snapshot (.sna/.z80)', accept: ['.sna', '.z80'] },
    ],
    zx128: [
        { id: 'rom0', label: '128K editor ROM', accept: BIN_EXT,
          hint: 'first 16 KB page — the two-file ROM set is the multi-file case' },
        { id: 'rom1', label: '48K BASIC ROM', accept: BIN_EXT },
        { id: 'tape', label: 'Tape (.tap/.tzx)', accept: ['.tap', '.tzx'] },
        { id: 'snapshot', label: 'Snapshot (.sna/.z80)', accept: ['.sna', '.z80'] },
    ],
};

/**
 * Slots for a target kind, or [] for kinds whose loading story is the
 * compile chain (MCUs flash hex through the existing build path).
 *
 * When `parts` is provided (the circuit's part list), dynamic slots
 * are added for circuit peripherals that accept loadable data (e.g.,
 * AT24C64 EEPROMs carrying animation data for the blinkenrocket).
 *
 * @param {string} kind
 * @param {{parts?: Array<{id: string, kind: string, declName?: string}>}} [opts]
 * @returns {MediaSlot[]}
 */
export function describeMedia(kind, opts) {
    const slots = [...(SLOTS[kind] || [])];
    // Dynamic: AT24C64 EEPROM parts in the circuit get a loadable slot
    if (opts?.parts) {
        for (const p of opts.parts) {
            if (p.kind === 'at24c64') {
                slots.push({
                    id: `eeprom:${p.id}`,
                    label: `EEPROM (${p.declName || p.id})`,
                    accept: [...BIN_EXT, ...HEX_EXT],
                    hint: '8 KB max — animation data, lookup tables',
                });
            }
        }
    }
    return slots;
}

/** Parse Intel HEX text into {bytes, origin}. Records must be type 00/01. */
export function parseIhex(text) {
    let min = Infinity, max = -1;
    const mem = new Map();
    for (const line of String(text).split(/\r?\n/)) {
        if (!line.startsWith(':')) continue;
        const n = parseInt(line.slice(1, 3), 16);
        const addr = parseInt(line.slice(3, 7), 16);
        const type = parseInt(line.slice(7, 9), 16);
        if (type === 1) break;
        if (type !== 0) continue; // extended addressing is not this tier
        for (let i = 0; i < n; i++) {
            const a = addr + i;
            mem.set(a, parseInt(line.slice(9 + i * 2, 11 + i * 2), 16));
            if (a < min) min = a;
            if (a > max) max = a;
        }
    }
    if (max < 0) throw new Error('no data records in hex file');
    const bytes = new Uint8Array(max - min + 1);
    for (const [a, v] of mem) bytes[a - min] = v;
    return { bytes, origin: min };
}

const isHexText = (bytes) => bytes.length > 1 && bytes[0] === 0x3a; // ':'

/**
 * Apply a {slotId: Uint8Array} map to a live debug target.
 *
 * Unknown slots and failed loads land in `errors` with the reason —
 * a UI shows them next to the slot; nothing throws for content
 * problems (a bad file must never take the panel down).
 *
 * @param {object} target - from createDebugTarget (adapter/machine reachable)
 * @param {Record<string, Uint8Array>} entries
 * @param {{kind?: string, parts?: Array, board?: object}} [opts]
 *   kind: target kind when the target doesn't carry it
 *   parts: circuit parts list (for dynamic eeprom slots)
 *   board: BoardImpl instance (for setPartParam on eeprom writes)
 * @returns {{applied: string[], errors: {slot: string, error: string}[]}}
 */
export function applyMedia(target, entries, opts = {}) {
    const kind = opts.kind || target.kind;
    const slots = new Map(describeMedia(kind, { parts: opts.parts }).map((s) => [s.id, s]));
    const machine = target.machine || target.adapter?.machine;
    const adapter = target.adapter || target;
    const applied = [];
    const errors = [];

    for (const [slotId, raw] of Object.entries(entries)) {
        const slot = slots.get(slotId);
        if (!slot) { errors.push({ slot: slotId, error: `unknown slot for ${kind}` }); continue; }
        try {
            let bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
            let at = slot.at ?? 0;
            if (isHexText(bytes) && slot.accept.some((e) => HEX_EXT.includes(e))) {
                const parsed = parseIhex(new TextDecoder().decode(bytes));
                bytes = parsed.bytes; at = parsed.origin;
            }
            switch (slotId) {
                case 'rom':
                case 'com': {
                    const load = adapter.loadRom || adapter.load
                        || (machine && (machine.loadRom || machine.load));
                    if (!load) throw new Error('target has no ROM loader');
                    load.call(adapter.loadRom || adapter.load ? adapter : machine, bytes, at);
                    break;
                }
                case 'rom0':
                case 'rom1': {
                    if (!machine || !machine.roms) throw new Error('target has no banked ROMs');
                    machine.roms[slotId === 'rom0' ? 0 : 1].set(bytes.subarray(0, 0x4000));
                    break;
                }
                case 'tape': {
                    const deck = machine && (machine.insertTape || machine.loadTape);
                    if (!deck) throw new Error('target has no tape deck');
                    deck.call(machine, bytes);
                    break;
                }
                case 'sd-image': {
                    const sd = machine && Object.values(machine.chips || {})
                        .find((c) => c && typeof c.setImage === 'function');
                    if (!sd) throw new Error('no sdcard chip in this machine config');
                    sd.setImage(bytes);
                    break;
                }
                case 'snapshot': {
                    if (!machine || !machine.loadSnapshot) throw new Error('target takes no snapshots');
                    machine.loadSnapshot(bytes);
                    break;
                }
                default: {
                    // Dynamic eeprom slots: eeprom:<partId>
                    if (slotId.startsWith('eeprom:')) {
                        const partId = slotId.slice(7);
                        const EEPROM_MAX = 8192;
                        if (bytes.length > EEPROM_MAX) {
                            throw new Error(`${bytes.length} bytes exceeds ${EEPROM_MAX}-byte EEPROM capacity`);
                        }
                        const contents = Array.from(bytes);
                        // Write via board.setPartParam if available (live circuit)
                        if (opts.board && typeof opts.board.setPartParam === 'function') {
                            opts.board.setPartParam(partId, 'contents', contents);
                        }
                        // Also write into the device state if the machine has it running
                        if (machine?.chips) {
                            const chip = Object.values(machine.chips)
                                .find((c) => c && c._partId === partId);
                            if (chip && chip.mem) {
                                chip.mem.fill(0xff);
                                for (let i = 0; i < contents.length; i++) chip.mem[i] = contents[i];
                            }
                        }
                        break;
                    }
                    throw new Error('slot registered but not routed — add its case');
                }
            }
            applied.push(slotId);
        } catch (e) {
            errors.push({ slot: slotId, error: e.message });
        }
    }

    // Required slots that never arrived are worth naming (the 128K ROM
    // pair loaded halfway is a machine that boots into garbage).
    for (const s of slots.values()) {
        if (s.required && !(s.id in entries)) {
            errors.push({ slot: s.id, error: 'required slot not provided' });
        }
    }
    return { applied, errors };
}

/**
 * Run a MEDIA BUNDLE — the brickwright-media.json contract the GPL Lab
 * ships: machine config, slot→filename mapping, documented preload
 * writes (bench preconditions), entry PC. One call from manifest +
 * fetched files to a running machine; the app's media panel needs no
 * machine knowledge at all.
 *
 * @param {object} manifest - parsed brickwright-media.json
 * @param {Record<string, Uint8Array>} files - fetched, keyed by filename
 * @param {{createMachine?: (config: object) => object}} [opts]
 *   createMachine defaults to the composable 6502 for machine
 *   'eater6502'; other machine kinds pass their own factory.
 * @returns {Promise<{machine: object, applied: string[], errors: {slot: string, error: string}[]}>}
 */
export async function runMediaBundle(manifest, files, opts = {}) {
    const errors = [];
    let machine;
    if (opts.createMachine) {
        machine = opts.createMachine(manifest.machineConfig);
    } else if (manifest.machine === 'eater6502' || manifest.machine === 'gpascal') {
        const { M6502Machine, EATER6502, GPASCAL } = await import('./m6502-machine.js');
        machine = new M6502Machine(
            manifest.machineConfig || (manifest.machine === 'gpascal' ? GPASCAL : EATER6502),
            opts.hooks || {});
    } else if (manifest.machine === 'zx48' || manifest.machine === 'zx128' || manifest.machine === 'z80') {
        const { Z80Machine, SEARLE } = await import('./z80-machine.js');
        const config = manifest.machineConfig
            || (manifest.machine === 'zx48'
                ? { clockHz: 3_500_000, regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }], ula: true }
                : manifest.machine === 'zx128' ? { clockHz: 3_546_900, zx128: true } : SEARLE);
        machine = new Z80Machine(config, opts.hooks || {});
    } else {
        throw new Error(`no machine factory for '${manifest.machine}' — pass opts.createMachine`);
    }

    // Bench preconditions FIRST — they are the state the software
    // assumes exists before it runs (the Bad Apple DDRB lesson). Each
    // carries its `why` in the manifest, so a UI can show provenance.
    for (const w of manifest.preload?.writes || []) {
        machine._write(w.addr, w.value & 0xff);
    }

    // Slots: filenames → bytes → the existing media routing. A slot
    // whose file is missing errors by name instead of throwing.
    const entries = {};
    for (const [slot, filename] of Object.entries(manifest.slots || {})) {
        if (files[filename]) entries[slot] = files[filename];
        else errors.push({ slot, error: `file not provided: ${filename}` });
    }
    // RAM-program manifests ('entry' with a hex/bin that self-locates
    // below the ROM window) route through the rom slot's loader — the
    // machine's loadRom writes RAM regions just as well.
    const media = applyMedia({ machine, kind: manifest.machine }, entries, { kind: manifest.machine });
    errors.push(...media.errors);

    if (manifest.entry != null) {
        machine.cpu.pc = manifest.entry & 0xffff;
    } else if (manifest.machine.startsWith('zx') || manifest.machine === 'z80') {
        machine.cpu.pc = 0x0000; // Z80 family resets to $0000
    } else {
        machine.cpu.pc = machine.mem[0xfffc] | (machine.mem[0xfffd] << 8);
    }
    return { machine, applied: media.applied, errors };
}
