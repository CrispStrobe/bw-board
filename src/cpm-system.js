/**
 * A real CP/M 2.2 computer — CCP + BDOS + BIOS + RAM-disk on the Z80 core.
 *
 * This is the *system* twin of `z80-adapter.js`'s CP/M console. The adapter
 * runs a single `.COM` behind a BDOS **shim** (a trap at `CALL 5`, no operating
 * system on the machine). This module instead boots the **genuine** article:
 * Digital Research's CCP+BDOS binary (`roms/cpm/cpm22-64k.bin`, redistributable
 * — see `roms/cpm/PROVENANCE`) and our own MIT BIOS (`roms/cpm/bios.bin`,
 * MC6850 ACIA console + a host-side RAM-disk on ports $10–$15), on the
 * vector-complete Z80. The result is a CP/M computer with an `A>` prompt: `DIR`,
 * `TYPE`, warm boot, and running several programs off the disk all work, because
 * a real CCP and BDOS are executing — nothing is emulated behind a trap.
 *
 * It is the browser-safe extraction of what `scripts/cpm-smoke.mjs` proved
 * inline: no `node:fs` here, so lite's debug-runner can boot the same computer
 * from bytes it fetched. The caller passes the two ROM images and a map of files
 * to place on the disk; this builds the machine, lays out a CP/M 2.2 RAM-disk
 * with a real directory, wires the disk controller, and cold-boots to the BIOS.
 *
 * @module
 */

/** CCP entry / load address (top 6K of the TPA holds CCP+BDOS). */
export const CCP = 0xe400;
/** BIOS load address (our BIOS lives just below CCP's reserved top). */
export const BIOS = 0xfa00;
/** Bytes of `cpm22-64k.bin` that are CCP+BDOS (the rest are assembler stubs). */
export const SYS_LEN = 0x1600;

const SPT = 26;                 // sectors per track (128-byte sectors)
const BLS = 1024;               // CP/M block (allocation unit) size
const SPB = BLS / 128;          // sectors per block (8)
const OFS = 2;                  // reserved (system) tracks before the directory
const TRACKS = 77;              // a standard 8" SSSD image
const DISK_SIZE = TRACKS * SPT * 128;
const DIR_BLOCKS = 2;           // the directory occupies the first two data blocks
const FIRST_DATA_BLOCK = DIR_BLOCKS;     // file data starts at block 2
const DIR_ENTRY = 32;           // bytes per CP/M directory entry
const RECS_PER_EXTENT = 128;    // 16 KB / 128 B
const BLOCKS_PER_EXTENT = 16;   // 16 × 1 KB

/** Byte offset on the RAM-disk of allocation block `n` (n ≥ FIRST_DATA_BLOCK). */
const blockOffset = n => (OFS * SPT + n * SPB) * 128;
/** Byte offset of the directory (block 0 of the data area). */
const dirOffset = () => OFS * SPT * 128;

/** Split "PROG.COM" into a padded 8.3 CP/M name; throws on an unusable name. */
function cpmName(name) {
    const m = String(name).toUpperCase().trim().match(/^([^.]{1,8})(?:\.([^.]{1,3}))?$/);
    if (!m) throw new Error(`not a valid 8.3 CP/M filename: ${name}`);
    const base = m[1].padEnd(8, ' ');
    const ext = (m[2] || '').padEnd(3, ' ');
    return {base, ext};
}

/**
 * Write one file into the RAM-disk: its directory extents and its data blocks.
 * @returns {number} the next free allocation block after this file.
 */
function placeFile(disk, dirBase, entryIndex, name, bytes, firstBlock) {
    const {base, ext} = cpmName(name);
    const records = Math.max(1, Math.ceil(bytes.length / 128));
    const blocks = Math.max(1, Math.ceil(bytes.length / BLS));

    // Directory extents: up to 16 blocks / 128 records each, EX incrementing.
    let recLeft = records;
    let blkPlaced = 0;
    let ex = 0;
    let ei = entryIndex;
    while (blkPlaced < blocks) {
        const e = new Uint8Array(DIR_ENTRY);
        e[0] = 0;                                   // user area 0
        for (let i = 0; i < 8; i++) e[1 + i] = base.charCodeAt(i);
        for (let i = 0; i < 3; i++) e[9 + i] = ext.charCodeAt(i);
        e[12] = ex;                                 // EX (extent number)
        e[13] = 0; e[14] = 0;                       // S1, S2
        e[15] = Math.min(recLeft, RECS_PER_EXTENT); // RC (records in this extent)
        const blkThis = Math.min(blocks - blkPlaced, BLOCKS_PER_EXTENT);
        for (let i = 0; i < blkThis; i++) e[16 + i] = firstBlock + blkPlaced + i;
        disk.set(e, dirBase + ei * DIR_ENTRY);
        ei++;
        blkPlaced += blkThis;
        recLeft -= RECS_PER_EXTENT;
        ex++;
    }

    // Data blocks.
    for (let b = 0; b < blocks; b++) {
        const off = blockOffset(firstBlock + b);
        const from = b * BLS;
        disk.set(bytes.subarray(from, Math.min(from + BLS, bytes.length)), off);
    }
    return firstBlock + blocks;
}

/**
 * Build a bootable CP/M 2.2 RAM-disk image from a set of files.
 * @param {Uint8Array} ccpBdos the CCP+BDOS bytes (only SYS_LEN are used)
 * @param {Record<string, Uint8Array>} files 8.3-name → bytes
 * @returns {{image: Uint8Array, entries: number}}
 */
export function buildCpmDisk(ccpBdos, files = {}) {
    const disk = new Uint8Array(DISK_SIZE);
    // System tracks (0..OFS-1): the CCP+BDOS the BIOS reloads on warm boot.
    disk.set(ccpBdos.subarray(0, SYS_LEN), 0);
    // Directory: 0xE5 = empty entry.
    const dirBase = dirOffset();
    disk.fill(0xe5, dirBase, dirBase + DIR_BLOCKS * BLS);

    let entryIndex = 0;
    let nextBlock = FIRST_DATA_BLOCK;
    for (const [name, bytes] of Object.entries(files)) {
        const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        nextBlock = placeFile(disk, dirBase, entryIndex, name, body, nextBlock);
        // Count the directory entries this file consumed (one per 16-block extent).
        entryIndex += Math.max(1, Math.ceil(Math.ceil(body.length / BLS) / BLOCKS_PER_EXTENT));
    }
    return {image: disk, entries: entryIndex};
}

/**
 * Boot a real CP/M 2.2 computer.
 *
 * @param {object} opts
 * @param {Uint8Array} opts.ccpBdos  CCP+BDOS image (`roms/cpm/cpm22-64k.bin`)
 * @param {Uint8Array} opts.bios     our BIOS image (`roms/cpm/bios.bin`)
 * @param {Record<string, Uint8Array>} [opts.files]  files to place on drive A:
 * @param {(byte:number, tMs:number)=>void} [opts.onSerial]  console output sink
 * @param {(config?: object, hooks?: object)=>object} opts.Z80Machine  the class
 * @param {object} opts.CPM64K  the CP/M machine config
 * @returns {{
 *   machine: object, disk: Uint8Array, cpu: object,
 *   sendKey: (byte:number)=>void, sendText: (s:string)=>void,
 *   consoleIdle: () => boolean, step: () => void, boot: () => void
 * }}
 */
export function createCpmSystem(opts) {
    const {ccpBdos, bios, files = {}, onSerial, Z80Machine, CPM64K} = opts;
    if (!ccpBdos || !bios) throw new Error('createCpmSystem needs ccpBdos and bios bytes');
    if (!Z80Machine || !CPM64K) throw new Error('createCpmSystem needs Z80Machine and CPM64K (inject from z80-machine.js)');

    const machine = new Z80Machine(CPM64K, {onSerial: onSerial || (() => {})});
    machine.load(ccpBdos.subarray(0, SYS_LEN), CCP);
    machine.load(bios, BIOS);

    const {image: disk} = buildCpmDisk(ccpBdos, files);

    // Host-side RAM-disk controller on ports $10–$15 (matches bios.asm).
    let drive = 0, track = 0, sector = 1, dmaLo = 0x80, dmaHi = 0, result = 0;
    void drive;
    const doCmd = cmd => {
        const off = (track * SPT + (sector - 1)) * 128;
        const dma = (dmaLo | (dmaHi << 8)) & 0xffff;
        if (off < 0 || off + 128 > disk.length) { result = 1; return; }
        if (cmd === 0) { for (let i = 0; i < 128; i++) machine.mem[(dma + i) & 0xffff] = disk[off + i]; result = 0; }
        else if (cmd === 1) { for (let i = 0; i < 128; i++) disk[off + i] = machine.mem[(dma + i) & 0xffff]; result = 0; }
        else result = 1;
    };
    const origIn = machine.cpu.inPort, origOut = machine.cpu.outPort;
    machine.cpu.inPort = port => ((port & 0xff) === 0x15 ? result : origIn(port));
    machine.cpu.outPort = (port, v) => {
        switch (port & 0xff) {
            case 0x10: drive = v & 0xff; return;
            case 0x11: track = v & 0xff; return;
            case 0x12: sector = v & 0xff; return;
            case 0x13: dmaLo = v & 0xff; return;
            case 0x14: dmaHi = v & 0xff; return;
            case 0x15: doCmd(v & 0xff); return;
        }
        origOut(port, v);
    };

    const acia = machine.chips.acia1;
    const boot = () => { machine.cpu.pc = BIOS; machine.cpu.sp = 0x80; };
    boot();

    return {
        machine, disk, cpu: machine.cpu,
        sendKey: byte => acia.rxPush(byte & 0xff),
        sendText: s => { for (const ch of String(s)) acia.rxPush(ch.charCodeAt(0) & 0xff); },
        /** True when the CCP/program is blocked waiting for a key (nothing to read). */
        consoleIdle: () => !acia.rdrf && (!acia.rx || acia.rx.length === 0),
        step: () => machine.step(),
        boot
    };
}

export default createCpmSystem;
