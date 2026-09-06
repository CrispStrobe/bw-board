/**
 * NEC uPD765A FDC -- the floppy disk controller as the IBM PC/XT wires it,
 * clean-room from the datasheet in the same shape as the 8255, 8254 and
 * 8259: a read()/write() bus interface over a small register window, hooks
 * for the two things that leave the chip (the interrupt line and the DMA
 * handshake), and no dependencies.
 *
 * ACCURACY TIER: SECTOR-LEVEL, PHASE-EXACT. The command/execution/result
 * phase machine, the main status register's RQM/DIO/NDM/CB bits, the four
 * status registers and the result-byte address arithmetic are modelled the
 * way the datasheet describes them. What is NOT modelled is anything below
 * a sector: there is no MFM bit stream, no gap bytes, no CRC generation, no
 * index pulse, no head-load or step timing, and no rotational latency. A
 * command completes inside the write() that delivers its last command byte.
 *
 * WHY THE PHASE MACHINE IS THE POINT. Firmware never "calls" this chip; it
 * watches two bits of the main status register at 3F4h and lets them tell
 * it what to do next -- RQM says the data register is ready, DIO says which
 * way it faces. A model that always answers 3F5h with something plausible
 * passes a naive test and fails every real driver, because the driver's
 * next move is decided by a bit our model got wrong, not by the byte. So:
 * reading 3F5h when DIO says CPU-to-FDC returns FFh (the chip is not
 * driving the bus) and advances nothing, writing it when the chip is
 * talking is dropped, and both are counted in `stats` rather than hidden.
 *
 * THE REGISTER WINDOW is 3F0h-3F7h; read()/write() take the offset:
 *   0,1  not decoded on the XT card         -> FFh
 *   2    DOR, digital output register (WRITE ONLY on the XT: drive select,
 *        motor enables, /RESET, and the DMA+interrupt gate). Reads FFh --
 *        the AT can read it back, the XT card cannot, and firmware that
 *        read-modify-writes the DOR is relying on something that is not
 *        there on this board.
 *   3    not decoded                        -> FFh
 *   4    MSR, main status register (READ ONLY)
 *   5    data register -- the command/result FIFO, both directions
 *   6    not decoded                        -> FFh
 *   7    read: DIR (bit 7 = disk change); write: CCR (data rate select,
 *        latched and inert -- this model has no data rate)
 *
 * COMMANDS MODELLED: SPECIFY, RECALIBRATE, SEEK, SENSE INTERRUPT STATUS,
 * SENSE DRIVE STATUS, READ DATA, WRITE DATA, READ ID, FORMAT TRACK. That is
 * the set a PC BIOS boot path and the DOS corpus actually issue.
 *
 * COMMANDS REFUSED, LOUDLY: READ TRACK (02h), WRITE DELETED DATA (09h),
 * READ DELETED DATA (0Ch), and the three SCAN commands (11h/19h/1Dh) are
 * real uPD765 commands this model does not implement. They consume their
 * parameter bytes -- the byte count is a property of the silicon and
 * swallowing it keeps the FIFO in sync -- and then answer the way the chip
 * answers an opcode it does not have: a one-byte result phase with
 * ST0 = 80h (IC = invalid command). Every refusal increments `refusals` and
 * names itself in `lastRefusal`, so a driver that needed one leaves
 * evidence instead of a mystery. An opcode that is not a command at all
 * (00h, 01h, 0Bh, 0Eh, ...) answers 80h immediately, consuming nothing,
 * exactly as the datasheet specifies.
 *
 * DMA IS NOT IN THIS FILE. The 8237 is a separate device; this chip only
 * has DRQ/DACK/TC pins, and here they are one hook:
 *
 *   hooks.onDmaRequest('write', byte) -- the FDC has a byte for memory
 *       (a DMA WRITE cycle, the direction a disk READ uses). Return false
 *       or null to say the channel has reached terminal count; any other
 *       return, undefined included, accepts the byte.
 *   hooks.onDmaRequest('read')        -- the FDC wants a byte from memory
 *       (a DMA READ cycle, used by WRITE DATA and FORMAT TRACK). Return the
 *       byte, or null/undefined at terminal count.
 *
 * The direction words are the 8237's, not the disk's: they name what the
 * DMA controller does to memory. The hook may also call terminalCount() on
 * this object instead of returning a sentinel -- TC is asserted during the
 * final transfer, so the byte still moves.
 *
 * PIO FALLBACK. The datasheet's non-DMA mode is real and is selected by the
 * ND bit of SPECIFY's second byte: the execution phase raises NDM and RQM
 * in the MSR and the host moves every byte through 3F5h itself. That mode
 * is fully modelled, and it is also the automatic fallback when no
 * onDmaRequest hook is wired -- which is the deviation that makes this
 * module testable and usable with no 8237 anywhere. A machine that wires
 * the 8237 gets the real choice back.
 *
 * TC MATTERS MORE THAN IT LOOKS. A transfer ends when the DMA controller
 * asserts terminal count. If it never does, the FDC reads to the end of the
 * cylinder, tries the sector after EOT, and terminates ABNORMALLY with
 * ST1 bit 7 (EN, end of cylinder) set -- IC = 01, not 00. That is not an
 * error in the model; it is what the chip does, and a driver that forgets
 * to size its DMA count sees exactly this on real hardware.
 *
 * WHAT ELSE IS DELIBERATELY NOT MODELLED
 *   - Timing of every kind: step rate, head load/unload, motor spin-up, the
 *     rotational position of the index hole. advance() is a no-op and
 *     nextWake() is Infinity because nothing here is driven by machine time.
 *     A read from a drive whose motor is off SUCCEEDS; the access is
 *     counted in stats.motorOff rather than failed, because failing it
 *     would only punish firmware for a delay we do not simulate.
 *   - Data errors: no CRC is computed, so ST1.DE and ST2.DD never set.
 *     Deleted data address marks do not exist, so ST2.CM never sets and the
 *     SK bit of a read is accepted and ignored.
 *   - The MFM/FM bit (MF) is accepted and ignored: images are sector dumps,
 *     which have no encoding. An FM-coded command against an MFM disk is
 *     therefore NOT refused, and on real hardware it would fail.
 *   - Multiple FDCs sharing a drive, the drive's own READY line (see below),
 *     and the "no other command may be issued while a drive is seeking"
 *     restriction -- the per-drive busy bits are reported honestly but the
 *     restriction is not enforced.
 *
 * WIRING, AND THE ONE WIRE THAT IS ALWAYS FORGOTTEN. This file imports
 * nothing; the machine layer owns both ends of the data path. Three
 * connections and a BIOS disk read completes:
 *
 *   1. PORTS. Decode 3F0h-3F7h onto read(port - 0x3F0) / write(port - 0x3F0).
 *   2. IRQ6. hooks.onIrqChange(level) -> the 8259's IR6. DOR bit 3 is
 *      already applied here, so the hook can go straight through.
 *   3. DMA CHANNEL 2 -- AND TERMINAL COUNT BACK THE OTHER WAY:
 *
 *        let fromMemory = 0xff;
 *        const fdc = new UPD765({
 *            onDmaRequest(dir, byte) {
 *                // One byte per call. An 8237 channel in SINGLE mode does
 *                // exactly this, and the limit argument caps the others.
 *                const moved = dma.transfer(
 *                    (a) => (a === null ? byte : mem[a]),
 *                    (a, b) => { if (a === null) fromMemory = b; else mem[a] = b; },
 *                    1);
 *                if (moved === 0) return false;   // masked or finished: this is TC
 *                return dir === 'read' ? fromMemory : true;
 *            },
 *        });
 *        const dma = new I8237({
 *            onTerminalCount(ch) { if (ch === 2) fdc.terminalCount(); },
 *        });
 *
 * `UPD765.terminalCount()` IS THE TC PIN, and it is the single most
 * forgettable wire on the board. Without it the controller is never told the
 * transfer is over: it keeps asking for bytes the DMA channel will not move
 * and the command either appears to hang or comes back with ST1 bit 7 (end
 * of cylinder) and nothing anywhere to explain it. TC is asserted DURING the
 * final transfer, so calling terminalCount() from inside the onDmaRequest
 * hook that is carrying the last byte is correct -- that byte still counts.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE IBM WIRING. On the PC the drive's
 * READY input to the FDC is strapped permanently active, so real hardware
 * can never report ST0.NR and an empty drive shows up as a missing address
 * mark on the first read. This model reports NR (ST0 = abnormal + NR) for a
 * drive with no image, because "not ready" is the truth and every other
 * emulator answers the same way. Firmware that distinguishes the two cases
 * would see a difference; nothing in the corpus does.
 *
 * SEEKING PAST THE END OF THE MEDIUM is the one behaviour this file could
 * not settle from the datasheet, so it is a policy option rather than a
 * silent choice -- see the `seekBeyondEnd` option on the constructor.
 *
 * @module
 */

/** Main status register bits, 3F4h. */
export const MSR = Object.freeze({
    RQM: 0x80,   // data register ready for a transfer with the host
    DIO: 0x40,   // 1 = FDC -> CPU, 0 = CPU -> FDC
    NDM: 0x20,   // execution phase of a non-DMA command is in progress
    CB: 0x10,    // controller busy: a command is under way
    // bits 3..0: drive 3..0 is in seek mode
});

/** Digital output register bits, 3F2h (write only on the XT). */
export const DOR = Object.freeze({
    SELECT: 0x03,   // which drive the select lines point at
    NRESET: 0x04,   // ACTIVE LOW: 0 holds the controller in reset
    DMAEN: 0x08,    // gates DRQ and IRQ onto the bus
    MOTORS: 0xf0,   // one motor-enable bit per drive, drive 0 in bit 4
});

/** ST0 -- the status register every command's result begins with. */
export const ST0 = Object.freeze({
    IC_NORMAL: 0x00,
    IC_ABNORMAL: 0x40,        // command started and did not finish cleanly
    IC_INVALID: 0x80,         // the chip does not have that command
    IC_READY_CHANGE: 0xc0,    // terminated because a drive's ready line moved
    IC_MASK: 0xc0,
    SE: 0x20,   // seek end
    EC: 0x10,   // equipment check: RECALIBRATE never saw track 0
    NR: 0x08,   // not ready
    HD: 0x04,   // head address at the end of the command
});

/** ST1 -- the "what went wrong on the track" register. */
export const ST1 = Object.freeze({
    EN: 0x80,   // end of cylinder: tried to read past EOT without a TC
    DE: 0x20,   // CRC error in an ID or data field (never set here)
    OR: 0x10,   // overrun: the host or DMA did not keep up
    ND: 0x04,   // no data: the requested sector was never found
    NW: 0x02,   // not writable: write protect
    MA: 0x01,   // missing address mark
});

/** ST2 -- the data-field half of the same story. */
export const ST2 = Object.freeze({
    CM: 0x40,   // control mark: a deleted-data mark was read (never set here)
    DD: 0x20,   // CRC error in the data field (never set here)
    WC: 0x10,   // wrong cylinder: the ID field's C did not match
    SH: 0x08,   // scan hit           (scan commands are refused)
    SN: 0x04,   // scan not satisfied  (ditto)
    BC: 0x02,   // bad cylinder: the ID field held FFh
    MD: 0x01,   // missing address mark in the data field
});

/** ST3 -- the drive's own pins, reported by SENSE DRIVE STATUS. */
export const ST3 = Object.freeze({
    FT: 0x80,   // fault line from the drive (never set here)
    WP: 0x40,   // write protected
    RDY: 0x20,  // drive ready
    T0: 0x10,   // head is over track 0
    TS: 0x08,   // two-sided medium
    HD: 0x04,   // head select
});

/** Where the PC/XT decodes this chip. The machine layer needs it. */
export const FDC_PORT_BASE = 0x3f0;

/**
 * The standard IBM layouts. `bytesPerSector` is 512 for every one of them,
 * which is why sector size is nearly always N=2 in a command -- but the
 * chip does not assume that and neither does this table.
 */
export const GEOMETRIES = Object.freeze({
    '160k': { cylinders: 40, heads: 1, sectors: 8, bytesPerSector: 512 },
    '180k': { cylinders: 40, heads: 1, sectors: 9, bytesPerSector: 512 },
    '320k': { cylinders: 40, heads: 2, sectors: 8, bytesPerSector: 512 },
    '360k': { cylinders: 40, heads: 2, sectors: 9, bytesPerSector: 512 },
    '720k': { cylinders: 80, heads: 2, sectors: 9, bytesPerSector: 512 },
    '1.2m': { cylinders: 80, heads: 2, sectors: 15, bytesPerSector: 512 },
    '1.44m': { cylinders: 80, heads: 2, sectors: 18, bytesPerSector: 512 },
    '2.88m': { cylinders: 80, heads: 2, sectors: 36, bytesPerSector: 512 },
});

/**
 * CHS to LBA, the one piece of arithmetic every layer above this file also
 * needs. Sectors are ONE-BASED on a floppy and heads and cylinders are
 * zero-based; the off-by-one that costs an afternoon is forgetting it.
 */
export function chsToLba(geom, c, h, s) {
    return (c * geom.heads + h) * geom.sectors + (s - 1);
}

/** Size in bytes of a whole image with this geometry. */
export function imageSize(geom) {
    return geom.cylinders * geom.heads * geom.sectors * geom.bytesPerSector;
}

/**
 * Pick a geometry. A name from GEOMETRIES, an explicit object (any layout a
 * caller wants -- the chip does not care), or, failing both, inference from
 * the image length, which is how every tool in this space does it because a
 * raw sector dump carries no other clue. Ambiguity does not exist here: no
 * two standard layouts share a size.
 */
export function resolveGeometry(spec, byteLength) {
    if (spec && typeof spec === 'object') {
        const g = {
            cylinders: spec.cylinders, heads: spec.heads,
            sectors: spec.sectors, bytesPerSector: spec.bytesPerSector ?? 512,
        };
        for (const k of ['cylinders', 'heads', 'sectors', 'bytesPerSector']) {
            if (!Number.isInteger(g[k]) || g[k] <= 0) {
                throw new Error(`upd765: geometry.${k} must be a positive integer`);
            }
        }
        return Object.freeze(g);
    }
    if (typeof spec === 'string') {
        const g = GEOMETRIES[spec.toLowerCase()];
        if (!g) throw new Error(`upd765: unknown geometry name ${spec}`);
        return g;
    }
    for (const g of Object.values(GEOMETRIES)) {
        if (imageSize(g) === byteLength) return g;
    }
    throw new Error(
        `upd765: cannot infer a geometry from a ${byteLength}-byte image -- pass one`);
}

/** N in a command byte is a log2 sector size: 0 = 128 bytes, 2 = 512. */
function sizeCode(bytesPerSector) {
    let n = 0, size = 128;
    while (size < bytesPerSector && n < 7) { size <<= 1; n++; }
    return n;
}

/**
 * The command table. `params` counts the bytes AFTER the command byte --
 * that count is a property of the silicon and is needed even for a command
 * this model refuses, so the FIFO stays in step. `modelled: false` marks a
 * command the real chip has and this model answers with IC = invalid.
 *
 * The flag is tested with `=== false`, NOT for truthiness. Reading it as
 * `!def.modelled` makes every entry WITHOUT the key -- which is every
 * command that IS implemented -- look unimplemented, and the whole chip
 * answers 80h to everything while still passing an invalid-command test.
 */
const COMMANDS = {
    0x02: { name: 'READ TRACK', params: 8, modelled: false },
    0x03: { name: 'SPECIFY', params: 2 },
    0x04: { name: 'SENSE DRIVE STATUS', params: 1 },
    0x05: { name: 'WRITE DATA', params: 8 },
    0x06: { name: 'READ DATA', params: 8 },
    0x07: { name: 'RECALIBRATE', params: 1 },
    0x08: { name: 'SENSE INTERRUPT STATUS', params: 0 },
    0x09: { name: 'WRITE DELETED DATA', params: 8, modelled: false },
    0x0a: { name: 'READ ID', params: 1 },
    0x0c: { name: 'READ DELETED DATA', params: 8, modelled: false },
    0x0d: { name: 'FORMAT TRACK', params: 5 },
    0x0f: { name: 'SEEK', params: 2 },
    0x11: { name: 'SCAN EQUAL', params: 8, modelled: false },
    0x19: { name: 'SCAN LOW OR EQUAL', params: 8, modelled: false },
    0x1d: { name: 'SCAN HIGH OR EQUAL', params: 8, modelled: false },
};

/** RECALIBRATE issues at most this many step pulses before giving up. */
const RECALIBRATE_STEPS = 77;

class Drive {
    constructor() {
        this.image = null;
        this.geom = null;
        this.writeProtect = false;
        // TWO cylinder numbers, and the difference is load-bearing. `pcn` is
        // the chip's own step counter -- what SENSE INTERRUPT STATUS reports,
        // because the FDC only knows how many pulses it sent. `track` is
        // where the head physically ended up, which is what the medium is
        // read through. They diverge exactly once: when a seek is asked for a
        // cylinder past the end of the disk and the head stops against the
        // stop while the counter keeps counting.
        this.pcn = 0;
        this.track = 0;
        this.changed = true;   // the disk-change latch: set until a step moves the head
        this.idIndex = 0;      // which sector READ ID finds next as the disk turns
    }
}

export class UPD765 {
    /**
     * @param {{ onIrqChange?: (asserted: boolean) => void,
     *           onDmaRequest?: (dir: 'read'|'write', byte?: number) => any,
     *           onMotorChange?: (drive: number, on: boolean) => void }} [hooks]
     * @param {{ seekBeyondEnd?: 'error'|'silent' }} [options]
     *   THE ONE BEHAVIOUR THE DATASHEET DOES NOT SETTLE. A uPD765 has no idea
     *   how many cylinders a drive has: SEEK counts out step pulses and the
     *   only feedback it ever gets is the TRACK 0 sensor. Read literally, a
     *   seek to cylinder 200 on a 40-cylinder drive is a NORMAL completion --
     *   seek end, PCN = 200 -- and the failure only appears on the next READ,
     *   as ND with the wrong-cylinder bit, because the head is jammed against
     *   the stop reading track 39's ID fields. That is 'silent'.
     *   Every emulator and every BIOS "seek error" path instead expects the
     *   controller to have noticed, so the default 'error' reports the same
     *   seek end with IC = abnormal termination. Both policies park the head
     *   at the last real cylinder and both leave PCN at the requested value,
     *   so the follow-up read fails identically; only the IC bits differ.
     *   Note that EC is NOT set in either case: EC means RECALIBRATE could
     *   not find track 0, and reusing it here would be a lie.
     */
    constructor(hooks = {}, options = {}) {
        this.hooks = hooks;
        this.seekBeyondEnd = options.seekBeyondEnd === 'silent' ? 'silent' : 'error';
        this.drives = Array.from({ length: 4 }, () => new Drive());
        this.reset(true);
    }

    /**
     * Power-on / hardware reset. Media and (unless `hard`) head positions
     * survive: a reset pulse on pin 1 does not eject anything and does not
     * move a head. `hard` additionally zeroes PCN and the head position,
     * which only a power-on can claim.
     */
    reset(hard = false) {
        // Capture the pin BEFORE the state is flattened. The draft cleared
        // this.irq first and then tested it, so a reset issued while IRQ6 was
        // asserted dropped the line internally and told the 8259 nothing --
        // leaving a phantom interrupt latched in the PIC for ever.
        const wasAsserted = this.irq === true;
        this.dor = 0;
        this.ccr = 0;
        this.phase = 'command';
        this.cmdBuf = [];
        this.cmdLen = 1;
        this.resultBuf = [];
        this.resultIdx = 0;
        this.exec = null;
        this.pendingInt = [];       // {st0, drive} queued for SENSE INTERRUPT
        this.intPending = false;
        this.irq = false;
        this.driveBusy = 0;         // MSR bits 3..0
        // SPECIFY's values. A hardware reset clears them, which is why every
        // BIOS re-issues SPECIFY after touching the DOR's reset bit.
        this.srt = 0; this.hut = 0; this.hlt = 0;
        this.nonDma = false;        // ND bit of SPECIFY: true = PIO execution
        this.refusals = 0;
        this.lastRefusal = null;
        this.lastRefusalSymptom = null;
        this.lastRefusalAt = null;
        this.lastFault = null;
        this.stats = {
            badReads: 0,      // read of 3F5h while the chip was not talking
            badWrites: 0,     // write of 3F5h while the chip was talking
            motorOff: 0,      // data command against a drive whose motor is off
            selectMismatch: 0,// command's US disagreed with the DOR's select
            headMismatch: 0,  // command's H disagreed with its own HDS bit
            overruns: 0,      // DMA wanted but DOR bit 3 never gated DRQ out
        };
        if (hard) for (const d of this.drives) { d.pcn = 0; d.track = 0; }
        if (wasAsserted) this._driveIrq(false);
    }

    // ---- media ----------------------------------------------------------
    /**
     * @param {number} drive 0..3
     * @param {Uint8Array} bytes raw sector image, LBA order
     * @param {string|object} [geometry] a GEOMETRIES key or an explicit
     *   {cylinders, heads, sectors, bytesPerSector}; inferred from the length
     *   when omitted.
     */
    insert(drive, bytes, geometry) {
        const d = this.drives[drive & 3];
        d.geom = resolveGeometry(geometry, bytes.length);
        d.image = bytes;
        d.changed = true;
        d.idIndex = 0;
        return d.geom;
    }

    eject(drive) {
        const d = this.drives[drive & 3];
        d.image = null; d.geom = null; d.changed = true;
    }

    setWriteProtect(drive, on) { this.drives[drive & 3].writeProtect = !!on; }

    /** Is a drive's motor enabled in the DOR? */
    motorOn(drive) { return !!(this.dor & (0x10 << (drive & 3))); }

    // ---- the machine-layer contract -------------------------------------
    /**
     * Nothing here is driven by machine time -- a command completes inside
     * the write() that finishes it -- but the machine's chip loop calls
     * advance() on everything, and its halted-CPU fast-forward refuses to
     * jump past a chip that advances without naming a horizon. So: a no-op
     * and an infinite horizon, stated rather than omitted.
     */
    advance(_cycles) { /* no time model: see the header */ }

    nextWake() { return Infinity; }

    /**
     * TC from the 8237. Asserted DURING the last transfer, so a byte handed
     * over in the same breath still counts; the transfer then terminates
     * normally at the next sector boundary check.
     */
    terminalCount() {
        if (this.exec) this.exec.tc = true;
    }

    // ---- the bus --------------------------------------------------------
    /** @param {number} reg offset from 3F0h */
    read(reg) {
        switch (reg & 7) {
            case 4: return this._msr();
            case 5: return this._readData();
            case 7: return this._readDir();
            // 3F0h, 3F1h, 3F3h, 3F6h: the XT card does not decode them and
            // the bus floats high. Answering anything else invents a register.
            default: return 0xff;
        }
    }

    /** @param {number} reg offset from 3F0h */
    write(reg, val) {
        val &= 0xff;
        switch (reg & 7) {
            case 2: this._writeDor(val); return;
            case 5: this._writeData(val); return;
            // CCR: the data rate select. Latched so a driver can see it did
            // not vanish, and inert, because this model has no data rate.
            case 7: this.ccr = val; return;
            default: return;   // the MSR is read only; everything else floats
        }
    }

    _msr() {
        let s = this.driveBusy & 0x0f;
        if (this.phase === 'command') {
            s |= MSR.RQM;
            // CB rises on the FIRST command byte, not when the command runs:
            // that is how a driver knows the FIFO is mid-command.
            if (this.cmdBuf.length) s |= MSR.CB;
        } else if (this.phase === 'exec') {
            s |= MSR.CB;
            if (this.exec.pio) {
                // Non-DMA execution: the host moves every byte itself, so RQM
                // is up and DIO points the way the data is going.
                s |= MSR.NDM | MSR.RQM;
                if (this.exec.toHost) s |= MSR.DIO;
            }
            // In DMA mode RQM stays LOW through the whole execution phase.
            // A driver that polls it there is waiting for the 8237, and a
            // model that raised it would let that driver corrupt the FIFO.
        } else {
            s |= MSR.CB | MSR.RQM | MSR.DIO;
        }
        return s;
    }

    /**
     * The digital input register. Bit 7 is the drive's DISK CHANGE line,
     * latched until a step pulse moves the head. The rest of the byte is
     * undriven on this card. Worth saying plainly: the original XT floppy
     * card does not decode 3F7h at all -- this is the AT/PS2 behaviour, kept
     * because it is harmless and because a driver that probes it learns the
     * truth about the medium rather than reading a floating bus.
     */
    _readDir() {
        const d = this.drives[this.dor & DOR.SELECT];
        return d.changed ? 0xff : 0x7f;   // bit 7 = changed, bits 6..0 float high
    }

    _writeDor(val) {
        const prev = this.dor;
        this.dor = val;
        if (this.hooks.onMotorChange) {
            for (let i = 0; i < 4; i++) {
                const bit = 0x10 << i;
                if ((prev & bit) !== (val & bit)) this.hooks.onMotorChange(i, !!(val & bit));
            }
        }
        if (!(val & DOR.NRESET)) {
            // Held in reset: the FIFO, the phase machine and every queued
            // interrupt go away. Media and head positions do not.
            this._enterReset();
        } else if (!(prev & DOR.NRESET)) {
            this._leaveReset();
        }
        // Bit 3 gates DRQ and IRQ onto the bus. An interrupt raised while the
        // gate was shut appears the moment it opens.
        this._refreshIrq();
    }

    _enterReset() {
        this.phase = 'command';
        this.cmdBuf = []; this.cmdLen = 1;
        this.resultBuf = []; this.resultIdx = 0;
        this.exec = null;
        this.pendingInt = [];
        this.driveBusy = 0;
        this.srt = 0; this.hut = 0; this.hlt = 0;
        this.nonDma = false;
        this.intPending = false;
        this._refreshIrq();
    }

    /**
     * Coming out of reset the chip raises its interrupt and then hands back
     * FOUR ready-change statuses, one per drive -- C0h, C1h, C2h, C3h. Every
     * PC BIOS reset path issues SENSE INTERRUPT STATUS four times to drain
     * them, and a controller that queues one (or none) leaves that loop
     * reading an invalid-command 80h and calling the drive dead.
     */
    _leaveReset() {
        for (let i = 0; i < 4; i++) {
            this.pendingInt.push({ st0: ST0.IC_READY_CHANGE | i, drive: i });
        }
        this.intPending = true;
        this._refreshIrq();
    }

    // ---- the data register ----------------------------------------------
    _readData() {
        if (this.phase === 'result') {
            const v = this.resultBuf[this.resultIdx++];
            // The interrupt drops as soon as the host takes the first result
            // byte -- it has plainly noticed.
            if (this.resultIdx === 1) { this.intPending = false; this._refreshIrq(); }
            if (this.resultIdx >= this.resultBuf.length) {
                this.resultBuf = []; this.resultIdx = 0;
                this.phase = 'command';
                this.cmdBuf = []; this.cmdLen = 1;
            }
            return v & 0xff;
        }
        if (this.phase === 'exec' && this.exec.pio && this.exec.toHost) {
            const byte = this.exec.buf[this.exec.idx];
            this._advanceOut();
            return byte & 0xff;
        }
        // DIO says CPU-to-FDC: the chip is not driving the bus, so the host
        // reads the pull-ups. Counted, never silent -- this is the exact
        // mistake a lenient model hides.
        this.stats.badReads++;
        return 0xff;
    }

    _writeData(val) {
        if (this.phase === 'command') { this._commandByte(val); return; }
        if (this.phase === 'exec' && this.exec.pio && !this.exec.toHost) {
            this._acceptIn(val);
            return;
        }
        this.stats.badWrites++;
    }

    _commandByte(val) {
        this.cmdBuf.push(val);
        if (this.cmdBuf.length === 1) {
            const def = COMMANDS[val & 0x1f];
            if (!def) {
                // Not a command at all. The chip terminates immediately and
                // consumes nothing -- the bytes the host writes next are read
                // as a fresh command, which is exactly how a desynchronised
                // driver ends up here in the first place.
                this._refuse(`opcode ${hex(val & 0x1f)}h is not a uPD765 command`,
                    'the controller returns ST0=80h in a one-byte result phase and raises NO interrupt, so a driver that waits on IRQ6 after issuing it waits for ever -- as it would on the silicon' );
                return;
            }
            this.cmdLen = def.params + 1;
        }
        if (this.cmdBuf.length >= this.cmdLen) this._execute();
    }

    // ---- command dispatch -----------------------------------------------
    _execute() {
        const cmd = this.cmdBuf[0];
        const def = COMMANDS[cmd & 0x1f];
        if (def.modelled === false) {
            this._refuse(`${def.name} (${hex(cmd & 0x1f)}h) is not modelled`,
                'the command EXISTS on a real uPD765 and this model does not '
                + 'implement it; the driver gets the same invalid-command result '
                + 'as for a nonsense opcode and cannot tell a gap in the model '
                + 'from a bug in itself');
            return;
        }
        switch (cmd & 0x1f) {
            case 0x03: this._specify(); return;
            case 0x04: this._senseDrive(); return;
            case 0x05: this._startTransfer(false); return;
            case 0x06: this._startTransfer(true); return;
            case 0x07: this._recalibrate(); return;
            case 0x08: this._senseInterrupt(); return;
            case 0x0a: this._readId(); return;
            case 0x0d: this._format(); return;
            case 0x0f: this._seek(); return;
            default:
                // NOT a fault the silicon would produce. A command this model
                // claims to support arrived with no handler behind it, which
                // is a bug here -- said plainly, because the driver sees the
                // same ST0 either way and cannot distinguish them.
                this._refuse(`${def.name} reached dispatch unimplemented`,
                    'this is a defect in the model, not a refusal the hardware '
                    + 'would make: the command is listed as supported and has no '
                    + 'implementation behind it');
                return;
        }
    }

    /**
     * A refusal. ST0 = 80h in a one-byte result phase is precisely what the
     * silicon does with an opcode it does not have, and NO interrupt is
     * generated -- a driver waiting on IRQ6 after an invalid command waits
     * for ever on real hardware too.
     */
    _refuse(why, symptom = null) {
        this.refusals++;
        this.lastRefusal = why;
        this.lastRefusalSymptom = symptom;
        // The data register, 3F5h on a PC's decode: the only port a command
        // byte can arrive on, and so the only place the refusal can point.
        // A register offset, not a bus address -- the board owns the decode.
        this.lastRefusalAt = 5;
        this._result([ST0.IC_INVALID], false);
    }

    _result(bytes, interrupt = true) {
        this.resultBuf = bytes.map((b) => b & 0xff);
        this.resultIdx = 0;
        this.phase = 'result';
        this.cmdBuf = []; this.cmdLen = 1;
        this.exec = null;
        if (interrupt) { this.intPending = true; this._refreshIrq(); }
    }

    _driveIrq(level) {
        this.irq = level;
        if (this.hooks.onIrqChange) this.hooks.onIrqChange(level);
    }

    /** The pin follows the internal request only while DOR bit 3 gates it. */
    _refreshIrq() {
        const level = this.intPending && !!(this.dor & DOR.DMAEN);
        if (level !== this.irq) this._driveIrq(level);
    }

    // ---- the commands ---------------------------------------------------
    /**
     * SPECIFY has NO result phase and raises NO interrupt -- it only loads
     * timing constants. The one bit that changes behaviour here is ND, the
     * bottom bit of the second byte: set means non-DMA execution.
     */
    _specify() {
        const b1 = this.cmdBuf[1], b2 = this.cmdBuf[2];
        this.srt = (b1 >> 4) & 0x0f;
        this.hut = b1 & 0x0f;
        this.hlt = (b2 >> 1) & 0x7f;
        this.nonDma = !!(b2 & 1);
        this.phase = 'command';
        this.cmdBuf = []; this.cmdLen = 1;
    }

    _senseDrive() {
        const us = this.cmdBuf[1] & 3, hd = (this.cmdBuf[1] >> 2) & 1;
        const d = this.drives[us];
        let st3 = us | (hd ? ST3.HD : 0);
        if (d.image) st3 |= ST3.RDY;
        if (d.writeProtect) st3 |= ST3.WP;
        if (d.track === 0) st3 |= ST3.T0;
        if (d.geom && d.geom.heads > 1) st3 |= ST3.TS;
        // No interrupt: SENSE DRIVE STATUS is a pure interrogation.
        this._result([st3], false);
    }

    /**
     * SENSE INTERRUPT STATUS drains one queued completion. With nothing
     * queued it answers 80h -- and that is NOT a refusal by this model, it
     * is defined chip behaviour, and it is how a BIOS knows it has drained
     * the four reset statuses. So it does not touch the refusal counter.
     */
    _senseInterrupt() {
        if (!this.pendingInt.length) {
            this._result([ST0.IC_INVALID], false);
            return;
        }
        const ev = this.pendingInt.shift();
        // The drive leaves "seek mode" only when its completion is sensed --
        // which is why MSR bits 3..0 can still be set long after the head
        // stopped moving.
        this.driveBusy &= ~(1 << ev.drive) & 0x0f;
        if (!this.pendingInt.length) this.intPending = false;
        this._refreshIrq();
        this._result([ev.st0, this.drives[ev.drive].pcn], false);
    }

    /**
     * RECALIBRATE steps toward track 0 and stops when the drive's track-0
     * sensor says so -- but the chip gives up after 77 pulses. A head at
     * cylinder 78 or beyond therefore comes back with EQUIPMENT CHECK and
     * the head only PART of the way home, which is the real reason PC BIOSes
     * for 80-track drives recalibrate twice.
     */
    _recalibrate() {
        const us = this.cmdBuf[1] & 3;
        const d = this.drives[us];
        let st0 = ST0.SE | us;
        if (d.track > RECALIBRATE_STEPS) {
            d.track -= RECALIBRATE_STEPS;
            d.pcn = d.track;
            st0 |= ST0.IC_ABNORMAL | ST0.EC;
        } else {
            if (d.track !== 0) d.changed = false;   // the head moved: latch clears
            d.track = 0; d.pcn = 0;
        }
        this._completeSeek(us, st0);
    }

    _seek() {
        const hds = this.cmdBuf[1], ncn = this.cmdBuf[2];
        const us = hds & 3, hd = (hds >> 2) & 1;
        const d = this.drives[us];
        let st0 = ST0.SE | (hd ? ST0.HD : 0) | us;
        // PCN is the chip's step counter and always reaches the requested
        // cylinder; the HEAD stops at the end of the disk. See seekBeyondEnd.
        const last = d.geom ? d.geom.cylinders - 1 : 255;
        d.pcn = ncn & 0xff;
        const target = Math.min(d.pcn, last);
        if (target !== d.track) d.changed = false;   // a step clears the latch
        d.track = target;
        if (d.pcn > last && this.seekBeyondEnd === 'error') st0 |= ST0.IC_ABNORMAL;
        this._completeSeek(us, st0);
    }

    /**
     * Both seeking commands end the same way: NO result phase (the host has
     * to ask with SENSE INTERRUPT STATUS), an interrupt, and the drive left
     * marked busy until that ask arrives. CB drops immediately -- the chip is
     * free to take another command while a head is still moving.
     */
    _completeSeek(us, st0) {
        this.driveBusy |= (1 << us);
        this.pendingInt.push({ st0, drive: us });
        this.intPending = true;
        this._refreshIrq();
        this.phase = 'command';
        this.cmdBuf = []; this.cmdLen = 1;
    }

    /**
     * READ ID reports the next ID field to pass under the head. There is no
     * index-hole model here, so "next" is a per-drive rotating counter: a
     * driver that polls READ ID to work out the layout sees every sector in
     * turn, which is the behaviour it is written against, even though the
     * order is not the real interleave.
     */
    _readId() {
        const hds = this.cmdBuf[1];
        const us = hds & 3, hd = (hds >> 2) & 1;
        const d = this.drives[us];
        const base = (hd ? ST0.HD : 0) | us;
        if (!d.image) {
            this._result([ST0.IC_ABNORMAL | ST0.NR | base, ST1.MA, 0, 0, hd, 0, 0]);
            return;
        }
        this._noteMotor(us);
        if (d.track >= d.geom.cylinders || hd >= d.geom.heads) {
            // Unformatted territory: no address marks at all.
            this._result([ST0.IC_ABNORMAL | base, ST1.MA | ST1.ND, 0,
                d.track, hd, 0, sizeCode(d.geom.bytesPerSector)]);
            return;
        }
        const r = (d.idIndex % d.geom.sectors) + 1;
        d.idIndex = (d.idIndex + 1) % d.geom.sectors;
        this._result([base, 0, 0, d.track, hd, r, sizeCode(d.geom.bytesPerSector)]);
    }

    // ---- READ DATA / WRITE DATA -----------------------------------------
    /**
     * Both halves of the data path, because they differ only in which way
     * the bytes move. cmdBuf is [cmd, HDS, C, H, R, N, EOT, GPL, DTL].
     */
    _startTransfer(reading) {
        const cmd = this.cmdBuf[0];
        const mt = !!(cmd & 0x80);
        const hds = this.cmdBuf[1];
        const us = hds & 3, hd = (hds >> 2) & 1;
        const c = this.cmdBuf[2], h = this.cmdBuf[3], r = this.cmdBuf[4];
        const n = this.cmdBuf[5], eot = this.cmdBuf[6], dtl = this.cmdBuf[8];
        const d = this.drives[us];
        const base = (hd ? ST0.HD : 0) | us;

        if ((this.dor & DOR.SELECT) !== us) this.stats.selectMismatch++;
        if (h !== hd) this.stats.headMismatch++;   // the ID's H should match HDS

        if (!d.image) {
            this._result([ST0.IC_ABNORMAL | ST0.NR | base, ST1.MA, 0, c, h, r, n]);
            return;
        }
        this._noteMotor(us);
        if (!reading && d.writeProtect) {
            this._result([ST0.IC_ABNORMAL | base, ST1.NW, 0, c, h, r, n]);
            return;
        }
        // The chip compares the C in the command against the ID field under
        // the head. It does NOT seek: a driver that forgot the SEEK gets
        // no-data plus wrong-cylinder, not a helpful silent seek.
        if (c !== d.track) {
            this._result([ST0.IC_ABNORMAL | base, ST1.ND, ST2.WC, c, h, r, n]);
            return;
        }
        // N is the sector size the command expects. The images here are plain
        // sector dumps whose ID fields we synthesise from the geometry, so a
        // mismatch means the head would find an ID it does not like.
        if (n !== sizeCode(d.geom.bytesPerSector)) {
            this._result([ST0.IC_ABNORMAL | base, ST1.ND, 0, c, h, r, n]);
            return;
        }
        // DTL only means anything when N is 0; for every real PC layout N is
        // 2 and DTL is the FFh every driver writes there out of habit.
        const secLen = n === 0 ? Math.min(dtl || 128, 128) : (128 << n);

        const pio = this._pio();
        if (!pio && !(this.dor & DOR.DMAEN)) {
            // DMA execution with the DOR's gate shut: DRQ never reaches the
            // 8237, nobody moves the byte, and the chip overruns. Real, and
            // the exact symptom of a DOR write that forgot bit 3.
            this.stats.overruns++;
            this.lastFault = 'DMA transfer with DOR bit 3 clear: DRQ is not gated to the bus';
            this._result([ST0.IC_ABNORMAL | base, ST1.OR, 0, c, h, r, n]);
            return;
        }

        this.exec = {
            kind: reading ? 'read' : 'write',
            toHost: reading, pio, mt, drive: us, base,
            c, h: hd, r, n, eot, secLen,
            buf: null, idx: 0, tc: false,
            st1: 0, st2: 0,
        };
        this.phase = 'exec';
        if (!this._loadSector()) {
            this.exec.st1 |= ST1.ND;
            this._endTransfer(ST0.IC_ABNORMAL);
            return;
        }
        if (!pio) this._pumpDma();
    }

    /**
     * FORMAT TRACK. cmdBuf is [cmd, HDS, N, SC, GPL, D]: the execution phase
     * pulls FOUR bytes per sector from the host (C, H, R, N -- the ID field
     * to lay down) and fills that sector's data area with D. There is no gap
     * or address-mark layer here, so GPL is accepted and ignored and the
     * track's physical layout cannot be changed: a format that names a
     * sector outside the medium's geometry fails with no-data rather than
     * reshaping the image.
     */
    _format() {
        const hds = this.cmdBuf[1];
        const us = hds & 3, hd = (hds >> 2) & 1;
        const n = this.cmdBuf[2], sc = this.cmdBuf[3], filler = this.cmdBuf[5];
        const d = this.drives[us];
        const base = (hd ? ST0.HD : 0) | us;

        if (!d.image) {
            this._result([ST0.IC_ABNORMAL | ST0.NR | base, ST1.MA, 0, 0, hd, 0, n]);
            return;
        }
        this._noteMotor(us);
        if (d.writeProtect) {
            this._result([ST0.IC_ABNORMAL | base, ST1.NW, 0, 0, hd, 0, n]);
            return;
        }
        const pio = this._pio();
        if (!pio && !(this.dor & DOR.DMAEN)) {
            this.stats.overruns++;
            this.lastFault = 'FORMAT with DOR bit 3 clear: DRQ is not gated to the bus';
            this._result([ST0.IC_ABNORMAL | base, ST1.OR, 0, 0, hd, 0, n]);
            return;
        }
        this.exec = {
            kind: 'format',
            toHost: false, pio, mt: false, drive: us, base,
            c: d.track, h: hd, r: 0, n, eot: sc, secLen: 4,
            buf: new Uint8Array(4), idx: 0, tc: false,
            left: sc, filler,
            st1: 0, st2: 0,
        };
        this.phase = 'exec';
        if (sc === 0) { this._endTransfer(ST0.IC_NORMAL); return; }
        if (!pio) this._pumpDma();
    }

    // ---- the execution phase engine -------------------------------------
    /** Non-DMA when SPECIFY said so, or when nobody wired an 8237. */
    _pio() { return this.nonDma || typeof this.hooks.onDmaRequest !== 'function'; }

    _noteMotor(us) { if (!this.motorOn(us)) this.stats.motorOff++; }

    /** Byte offset of a CHS address in a drive's image, or -1. */
    _offsetOf(d, c, h, r) {
        const g = d.geom;
        if (!g) return -1;
        if (c < 0 || c >= g.cylinders) return -1;
        if (h < 0 || h >= g.heads) return -1;
        if (r < 1 || r > g.sectors) return -1;
        const off = chsToLba(g, c, h, r) * g.bytesPerSector;
        if (off + g.bytesPerSector > d.image.length) return -1;   // short image
        return off;
    }

    /** Point exec.buf at the current sector. False = the head found nothing. */
    _loadSector() {
        const x = this.exec;
        const d = this.drives[x.drive];
        const off = this._offsetOf(d, x.c, x.h, x.r);
        if (off < 0) return false;
        x.off = off;
        x.buf = x.toHost
            ? d.image.subarray(off, off + x.secLen)
            : new Uint8Array(x.secLen);
        x.idx = 0;
        return true;
    }

    /**
     * Move to the sector after this one. Returns false when the transfer has
     * run off the end of the cylinder, which is the ONLY place the chip can
     * stop by itself. The address arithmetic is the datasheet's result table:
     * at EOT with MT set and head 0, cross to head 1 and start at sector 1;
     * otherwise bump the cylinder, reset the head under MT, and start at 1.
     */
    _nextSector() {
        const x = this.exec;
        if (x.r < x.eot) { x.r++; return true; }
        if (x.mt && x.h === 0) { x.h = 1; x.r = 1; return true; }
        x.c = (x.c + 1) & 0xff;
        if (x.mt) x.h = 0;
        x.r = 1;
        return false;
    }

    /** One byte has left the chip toward the host or the 8237. */
    _advanceOut() {
        const x = this.exec;
        x.idx++;
        if (x.idx < x.secLen) return;
        this._sectorDone();
    }

    /** One byte has arrived from the host or the 8237. */
    _acceptIn(byte) {
        const x = this.exec;
        x.buf[x.idx++] = byte & 0xff;
        if (x.idx < x.secLen) return;
        this._sectorDone();
    }

    _sectorDone() {
        const x = this.exec;
        const d = this.drives[x.drive];
        if (x.kind === 'write') {
            d.image.set(x.buf, x.off);
        } else if (x.kind === 'format') {
            // The four bytes are the ID field to write: C, H, R, N.
            const [fc, fh, fr, fn] = x.buf;
            const off = this._offsetOf(d, fc, fh, fr);
            if (off < 0 || fn !== sizeCode(d.geom.bytesPerSector)) {
                x.st1 |= ST1.ND;
                x.c = fc; x.h = fh; x.r = fr; x.n = fn;
                this._endTransfer(ST0.IC_ABNORMAL);
                return;
            }
            d.image.fill(x.filler & 0xff, off, off + d.geom.bytesPerSector);
            x.c = fc; x.h = fh; x.r = fr; x.n = fn;
            x.idx = 0;
            if (--x.left <= 0 || x.tc) { this._endTransfer(ST0.IC_NORMAL); return; }
            return;
        }
        x.idx = 0;
        const more = this._nextSector();
        // TC latched during this sector: a clean stop, with the address
        // already advanced to the sector that would have come next.
        if (x.tc) { this._endTransfer(ST0.IC_NORMAL); return; }
        if (!more) {
            // Ran out of cylinder with no terminal count. The chip TRIED to
            // read past EOT, and that attempt is what sets EN -- an abnormal
            // termination, not a normal one.
            x.st1 |= ST1.EN;
            this._endTransfer(ST0.IC_ABNORMAL);
            return;
        }
        if (!this._loadSector()) {
            x.st1 |= ST1.ND;
            this._endTransfer(ST0.IC_ABNORMAL);
        }
    }

    /**
     * Run the whole DMA transfer. It is bounded without a TC because
     * _nextSector stops at the end of the cylinder, so a caller whose DMA
     * hook accepts for ever still terminates -- with EN set, which is the
     * truth about what happened.
     */
    _pumpDma() {
        while (this.phase === 'exec') {
            const x = this.exec;
            if (x.toHost) {
                const ok = this.hooks.onDmaRequest('write', x.buf[x.idx] & 0xff);
                if (ok === false || ok === null) { x.tc = true; break; }
                this._advanceOut();
            } else {
                const v = this.hooks.onDmaRequest('read');
                if (v === null || v === undefined || v === false) { x.tc = true; break; }
                this._acceptIn(v & 0xff);
            }
            // The byte above MOVED. terminalCount() may have been called from
            // inside the hook that moved it -- TC is asserted DURING the last
            // transfer, not after it -- so the byte counts either way. If the
            // sector boundary fell on the same byte, _sectorDone has already
            // seen the flag and finished the command.
            if (this.phase !== 'exec') return;
            if (this.exec.tc) { this._endTransferOnTc(); return; }
        }
        if (this.phase === 'exec') this._endTransferOnTc();
    }

    /**
     * TC arrived mid-sector. The result address still advances -- the chip
     * reports the sector it would have done next, not the one it stopped in.
     */
    _endTransferOnTc() {
        const x = this.exec;
        if (x.idx > 0 && x.kind === 'write') {
            // TC in the middle of a sector does NOT abandon it. The chip has
            // already started laying down a data field and has to finish it,
            // so the rest of the sector is written as zeros -- which is why a
            // short DMA count on a WRITE DATA silently truncates a file to
            // nulls instead of leaving the old contents behind. exec.buf is
            // zero-filled at allocation, so the tail is already right.
            this.drives[x.drive].image.set(x.buf, x.off);
        }
        if (x.idx > 0 && x.kind !== 'format') this._nextSector();
        this._endTransfer(ST0.IC_NORMAL);
    }

    _endTransfer(ic) {
        const x = this.exec;
        const st0 = ic | (x.h ? ST0.HD : 0) | (x.base & 0x03);
        this._result([st0, x.st1, x.st2, x.c, x.h, x.r, x.n]);
    }

    // ---- state ----------------------------------------------------------
    /**
     * Everything but the media. A disk image is the caller's, can be
     * megabytes, and is not controller state -- restore it with insert().
     */
    getState() {
        return {
            dor: this.dor, ccr: this.ccr, phase: this.phase,
            cmdBuf: [...this.cmdBuf], cmdLen: this.cmdLen,
            resultBuf: [...this.resultBuf], resultIdx: this.resultIdx,
            pendingInt: this.pendingInt.map((e) => ({ ...e })),
            intPending: this.intPending, irq: this.irq, driveBusy: this.driveBusy,
            srt: this.srt, hut: this.hut, hlt: this.hlt, nonDma: this.nonDma,
            refusals: this.refusals, lastRefusal: this.lastRefusal,
            lastRefusalSymptom: this.lastRefusalSymptom,
            lastRefusalAt: this.lastRefusalAt,
            lastFault: this.lastFault,
            stats: { ...this.stats },
            drives: this.drives.map((d) => ({
                pcn: d.pcn, track: d.track, changed: d.changed,
                idIndex: d.idIndex, writeProtect: d.writeProtect,
            })),
        };
    }

    setState(s) {
        Object.assign(this, {
            dor: s.dor, ccr: s.ccr, phase: s.phase,
            cmdBuf: [...s.cmdBuf], cmdLen: s.cmdLen,
            resultBuf: [...s.resultBuf], resultIdx: s.resultIdx,
            pendingInt: s.pendingInt.map((e) => ({ ...e })),
            intPending: s.intPending, driveBusy: s.driveBusy,
            srt: s.srt, hut: s.hut, hlt: s.hlt, nonDma: s.nonDma,
            refusals: s.refusals, lastRefusal: s.lastRefusal,
            lastRefusalSymptom: s.lastRefusalSymptom ?? null,
            lastRefusalAt: s.lastRefusalAt ?? null,
            lastFault: s.lastFault ?? null,
            stats: { ...s.stats },
        });
        // An execution phase cannot be restored: it holds a live view into an
        // image. Snapshot between commands, not during one.
        this.exec = null;
        if (this.phase === 'exec') this.phase = 'command';
        s.drives.forEach((ds, i) => Object.assign(this.drives[i], ds));
        this.irq = false;
        this._refreshIrq();
    }
}

function hex(v) { return v.toString(16).toUpperCase(); }
