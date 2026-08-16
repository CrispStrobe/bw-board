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
 * @param {string} kind
 * @returns {MediaSlot[]}
 */
export function describeMedia(kind) {
    return SLOTS[kind] || [];
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
 * @param {{kind?: string}} [opts] - target kind when the target doesn't carry it
 * @returns {{applied: string[], errors: {slot: string, error: string}[]}}
 */
export function applyMedia(target, entries, opts = {}) {
    const kind = opts.kind || target.kind;
    const slots = new Map(describeMedia(kind).map((s) => [s.id, s]));
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
                    if (!machine || !machine.loadTape) throw new Error('target has no tape deck');
                    machine.loadTape(bytes);
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
                default:
                    throw new Error('slot registered but not routed — add its case');
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
