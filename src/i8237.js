/**
 * Intel 8237A DMA controller as the IBM PC/XT wires it -- the eight channel
 * registers and eight command ports at 00h-0Fh -- PLUS the DMA page
 * registers at 80h-83h/87h, which are not part of the 8237 at all.
 *
 * THE SPLIT IS THE WHOLE POINT. The 8237 is a 16-bit-address part living in
 * a 20-bit machine. It drives A0-A15 and nothing else. Address bits A16-A19
 * come from a separate 4-bit latch (a 74LS670 on the XT) that the CPU writes
 * through its own ports, and the two halves are NEVER connected: the 8237's
 * address counter rolling from FFFFh to 0000h does not increment the page
 * latch, because there is no wire between them to carry on. A transfer that
 * runs off the end of a 64K page therefore WRAPS to the bottom of the SAME
 * page and quietly overwrites what it just moved.
 *
 * That is the famous "DMA boundary". Every floppy driver ever written splits
 * a transfer that would straddle a 64K boundary, and the BIOS returns error
 * 09h ("DMA boundary crossed") rather than attempt it. A model that carried
 * into the page register would make a BROKEN driver look correct here and
 * fail on real hardware -- so the wrap is modelled deliberately and tested.
 *
 * PORTS 00h-0Fh. Even ports 0/2/4/6 are channel 0-3 address, odd ports
 * 1/3/5/7 are channel 0-3 word count. Then:
 *   08h  read status / write command
 *   09h  write request register
 *   0Ah  write single mask bit
 *   0Bh  write mode register
 *   0Ch  clear the first/last flip-flop
 *   0Dh  read temporary register / write master clear
 *   0Eh  write clear mask register
 *   0Fh  write all mask bits
 *
 * THE FIRST/LAST FLIP-FLOP. There is ONE flip-flop for the whole chip, not
 * one per register, and it decides whether the next byte written to (or read
 * from) any 16-bit register is the low or the high half. It toggles on every
 * such access. Software that loses track of it writes the halves of an
 * address into each other's slots; the cure is port 0Ch, and every real
 * driver hits 0Ch before programming a channel. Modelling it per-register
 * would hide exactly that class of bug.
 *
 * WORD COUNT IS N-1. Programming 511 moves 512 bytes. Terminal count is the
 * borrow out of 0000h, so the byte transferred while the counter reads zero
 * is the last one; the counter then reads FFFFh.
 *
 * PAGE PORTS. 87h=channel 0, 83h=channel 1, 81h=channel 2, 82h=channel 3.
 * The order looks scrambled because it is: it follows the XT's latch wiring,
 * not the channel numbers. 80h decodes to no channel -- it is the board's
 * scratch/POST-code port -- and is stored so a read-back sees it.
 *
 * ACCURACY TIER: programmer-visible register model, cycle-count-free. Every
 * register, the flip-flop, the mask/request logic, the mode decode, the
 * autoinitialise reload and the terminal-count rules behave as documented.
 * Bus timing does not exist: a transfer is a callback, not four T-states.
 *
 * EXPLICITLY NOT MODELLED:
 *   - Timing of any kind. Compressed timing, extended write, the ready
 *     input, and the 8237's cycle-stealing arbitration with the CPU are
 *     accepted into the command register and ignored. HRQ/HLDA handshaking
 *     is reduced to the `hrq` flag; there is no bus arbitration.
 *   - Memory-to-memory transfers (command bit 0, channel 0 -> channel 1)
 *     and the temporary register that carries the byte between them. The
 *     temporary register reads back as zero. The XT BIOS never uses this.
 *   - Rotating priority (command bit 4). Stored, ignored: priority is
 *     always fixed with channel 0 highest, which is what an XT programs.
 *   - DREQ/DACK sense inversion (command bits 6/7). Stored, ignored: a
 *     request through dreq() is always "asserted".
 *   - Cascade mode. The mode bits are stored and decoded, but a cascade
 *     channel never transfers -- there is no second controller on an XT
 *     for it to cascade to. (Channel 0 on an AT is the cascade channel;
 *     that is an AT, and this is not one.)
 *   - DRAM refresh. On a real XT, PIT counter 1 drives DREQ0 and channel 0
 *     runs an endless autoinitialising dummy read to keep the DRAM alive.
 *     Nothing here needs refreshing, so the machine layer simply never
 *     asserts DREQ0 and the BIOS's channel-0 programming sits inert. If it
 *     IS wired, program channel 0 for verify and the transfers cost only
 *     counter arithmetic -- a verify cycle touches neither callback.
 *   - The 8237's own reset behaviour for the mode registers, which the
 *     datasheet leaves undefined. Master clear zeroes them here so a
 *     reset machine is deterministic.
 *
 * WIRING. The controller imports nothing: the device and memory reach it as
 * callbacks so the machine layer owns both ends.
 *
 * @module
 */

import {noteRefusal} from './chip-ledger.js';

/** Mode register bits 2-3: what a transfer cycle actually does. */
const XFER_VERIFY = 0;   // run the counters, drive no bus cycle
const XFER_WRITE = 1;    // WRITE TO MEMORY: device -> memory (a floppy READ)
const XFER_READ = 2;     // READ FROM MEMORY: memory -> device (a floppy WRITE)
const XFER_ILLEGAL = 3;

/** Mode register bits 6-7. */
const MODE_DEMAND = 0;
const MODE_SINGLE = 1;
const MODE_BLOCK = 2;
const MODE_CASCADE = 3;

/**
 * Command register (port 08h write) bit 2: "controller disable". The only
 * command bit with a visible effect here; memory-to-memory (bit 0), timing
 * (bits 3/5), rotating priority (bit 4) and the sense bits (6/7) are stored
 * and ignored -- see the module header.
 */
const CMD_DISABLE = 0x04;
const CMD_ROTATE = 0x10;   // bit 4: rotating priority

/**
 * XT page-latch decode, indexed by port & 7 (so 80h-87h).
 * 80h -> none (scratch), 81h -> ch2, 82h -> ch3, 83h -> ch1, 87h -> ch0.
 * -1 means "this port is not a channel page".
 */
const PAGE_PORT_CHANNEL = [-1, 2, 3, 1, -1, -1, -1, 0];

export class I8237 {
    /**
     * @param {{ onHrq?: (active: boolean) => void,
     *           onTerminalCount?: (channel: number) => void }} [hooks]
     *   onHrq fires when the controller starts or stops wanting the bus --
     *   the machine layer can use it to decide whether to call transfer().
     *   onTerminalCount fires on the EOP pulse at the end of a channel's
     *   count. A floppy controller needs this: TC is what tells the uPD765
     *   the sector data is done, and without it the FDC hangs mid-command
     *   waiting for bytes that will never come.
     */
    constructor(hooks = {}) {
        this.hooks = hooks;
        this.channels = [0, 1, 2, 3].map((n) => new DMAChannel(n));
        /** Port 80h has no channel behind it; the XT uses it for POST codes. */
        this.pageScratch = 0;
        this._hrq = false;
        this.reset();
    }

    /** Power-on reset. Identical to the master clear command (write to 0Dh). */
    reset() {
        this.pageScratch = 0;
        for (const c of this.channels) c.page = 0;
        this._masterClear();
    }

    // ---------------------------------------------------------------- ports

    /** @param {number} reg port 00h-0Fh (only the low nibble is decoded) */
    read(reg) {
        reg &= 0x0f;
        if (reg < 8) {
            const ch = this.channels[reg >> 1];
            const v = (reg & 1) ? ch.curCount : ch.curAddr;
            // The SAME flip-flop that sequences writes sequences reads, and
            // a half-read leaves it flipped for whoever writes next.
            const byte = this._ff ? (v >> 8) & 0xff : v & 0xff;
            this._ff = !this._ff;
            return byte;
        }
        switch (reg) {
            case 0x08: {
                // Status: TC bits 0-3, DREQ-pending bits 4-7. Reading CLEARS
                // the TC bits, so the value is destructive and a debugger
                // that peeks here steals the flag from the driver.
                let v = this.status & 0x0f;
                for (const c of this.channels) if (c.requesting()) v |= 0x10 << c.n;
                this.status = 0;
                return v;
            }
            case 0x0c:
                // The datasheet defines "clear byte pointer" as a WRITE to
                // 0Ch and leaves the read undefined. Clearing on a read too
                // costs nothing and matches what software reading this port
                // is trying to achieve -- resynchronising the flip-flop.
                this._ff = false;
                return 0xff;
            case 0x0d:
                return this.temp & 0xff;
            default:
                // Write-only ports float; the XT's bus reads back all-ones.
                return 0xff;
        }
    }

    /** @param {number} reg port 00h-0Fh (only the low nibble is decoded) */
    write(reg, val) {
        reg &= 0x0f;
        val &= 0xff;
        if (reg < 8) {
            const ch = this.channels[reg >> 1];
            if (reg & 1) ch.writeCount(this._ff, val);
            else ch.writeAddr(this._ff, val);
            this._ff = !this._ff;
            return;
        }
        switch (reg) {
            case 0x08:
                this.command = val;
                this._noteUnmodelled(val, reg);
                this._updateHrq();
                break;
            case 0x09: {
                // Request register: bits 0-1 channel, bit 2 set/clear.
                const ch = this.channels[val & 3];
                ch.swRequest = !!(val & 0x04);
                this._updateHrq();
                break;
            }
            case 0x0a: {
                // Single mask bit: bits 0-1 channel, bit 2 = 1 masks it.
                const ch = this.channels[val & 3];
                ch.masked = !!(val & 0x04);
                this._updateHrq();
                break;
            }
            case 0x0b:
                this.channels[val & 3].writeMode(val);
                this._updateHrq();
                break;
            case 0x0c:
                this._ff = false;
                break;
            case 0x0d:
                this._masterClear();
                break;
            case 0x0e:
                // Clear mask register: unmask all four at once.
                for (const c of this.channels) c.masked = false;
                this._updateHrq();
                break;
            case 0x0f:
                // Write all mask bits: bits 0-3, one per channel.
                for (const c of this.channels) c.masked = !!(val & (1 << c.n));
                this._updateHrq();
                break;
            default:
                break;
        }
    }

    /**
     * Page latch read-back, ports 80h-8Fh. Write-only on real XT hardware
     * (nothing drives the data bus back), but a stored value read back is
     * more useful than open bus and cannot mislead anyone.
     * @param {number} reg port 80h-8Fh, or just its low three bits
     */
    readPage(reg) {
        const ch = PAGE_PORT_CHANNEL[reg & 7];
        return ch < 0 ? this.pageScratch & 0xff : this.channels[ch].page & 0xff;
    }

    /** @param {number} reg port 80h-8Fh, or just its low three bits */
    writePage(reg, val) {
        const ch = PAGE_PORT_CHANNEL[reg & 7];
        if (ch < 0) this.pageScratch = val & 0xff;
        else this.channels[ch].page = val & 0xff;
    }

    // ------------------------------------------------------------- requests

    /**
     * A device asserts or releases its DREQ line.
     * @param {number} channel 0-3
     * @param {boolean} [level] true (default) to assert, false to release
     */
    dreq(channel, level = true) {
        this.channels[channel & 3].dreqLevel = !!level;
        this._updateHrq();
    }

    /** True while some channel wants the bus -- the HRQ output. */
    get hrq() { return this._hrq; }

    /**
     * The four channels in CURRENT priority order, highest first.
     *
     * `lowestPriority` is the channel that currently holds lowest priority;
     * service runs from the next one upward, wrapping. 3 gives the fixed
     * default of channel 0 highest, which is what an XT programs, so the
     * rotating machinery costs nothing until a program asks for it.
     */
    _priorityOrder() {
        const out = [];
        for (let n = 1; n <= 4; n++) out.push(this.channels[(this.lowestPriority + n) & 3]);
        return out;
    }

    /** The channel that would be served next, or null. */
    pendingChannel() {
        if (this.command & CMD_DISABLE) return null;
        for (const c of this._priorityOrder()) {
            if (!c.requesting()) continue;
            // Cascade channels request the bus for a downstream controller we
            // do not have, so they can request forever and never transfer.
            if (c.mode === MODE_CASCADE) continue;
            if (c.transferType === XFER_ILLEGAL) continue;
            return c;
        }
        return null;
    }

    // ------------------------------------------------------------ transfers

    /**
     * Run the highest-priority pending channel.
     *
     * The two callbacks are the two ENDS of the DMA cycle, and which of them
     * is handed an address tells you the direction:
     *
     *   readByte(addr)         addr is the 20-bit PHYSICAL address when the
     *                          source is memory (mode "read from memory");
     *                          null when the source is the device, in which
     *                          case return the device's next byte.
     *   writeByte(addr, byte)  addr is the 20-bit PHYSICAL address when the
     *                          destination is memory (mode "write to
     *                          memory"); null when the destination is the
     *                          device, in which case hand it the byte.
     *
     * Exactly one of the two sees an address on any given cycle. A verify
     * cycle calls neither -- the real chip drives no memory or I/O command
     * for verify, it only runs the counters.
     *
     * How many bytes move depends on the mode, which is the point of having
     * modes at all: SINGLE releases the bus after each byte (one per call);
     * BLOCK runs to terminal count once started, ignoring DREQ; DEMAND runs
     * while the device keeps DREQ asserted. `limit` caps any of them so a
     * caller can meter DMA against CPU cycles instead of letting a block
     * transfer of 64K happen inside one instruction.
     *
     * @param {(addr: number|null) => number} readByte
     * @param {(addr: number|null, byte: number) => void} writeByte
     * @param {number} [limit] maximum bytes to move in this call
     * @returns {number} bytes actually moved
     */
    transfer(readByte, writeByte, limit = Infinity) {
        const ch = this.pendingChannel();
        if (!ch) return 0;

        let max = limit;
        if (ch.mode === MODE_SINGLE && max > 1) max = 1;

        let moved = 0;
        while (moved < max) {
            this._cycle(ch, readByte, writeByte);
            moved++;
            if (ch.tcHit) { ch.tcHit = false; break; }
            // Demand mode runs only as long as the device keeps asking. A
            // software request bit does not drop on its own, so it keeps a
            // demand channel running until terminal count -- which is the
            // documented way to use one. Block mode ignores DREQ entirely
            // once it has started, so it falls through and keeps going.
            if (ch.mode === MODE_DEMAND && !ch.requesting()) break;
            if (ch.mode !== MODE_DEMAND && ch.mode !== MODE_BLOCK) break;
        }
        // ROTATING PRIORITY (command bit 4). The channel just serviced drops to
        // lowest priority, so a busy channel cannot starve the others. Applied
        // after the burst rather than per cycle: the 8237 rotates when it
        // RELEASES the bus, and a demand or block transfer holds it for the
        // whole burst.
        if (moved > 0 && (this.command & CMD_ROTATE)) this.lowestPriority = ch.n & 3;
        this._updateHrq();
        return moved;
    }

    _cycle(ch, readByte, writeByte) {
        // THE 64K PAGE. Physical address is the page latch's four bits
        // concatenated with the 8237's sixteen -- concatenated, not added,
        // because there is no adder and no carry path between them.
        const addr = ((ch.page & 0x0f) << 16) | (ch.curAddr & 0xffff);

        if (ch.transferType === XFER_WRITE) {
            const byte = readByte ? readByte(null) & 0xff : 0xff;
            if (writeByte) writeByte(addr, byte);
        } else if (ch.transferType === XFER_READ) {
            const byte = readByte ? readByte(addr) & 0xff : 0xff;
            if (writeByte) writeByte(null, byte);
        }
        // XFER_VERIFY falls through: counters move, no bus cycle happens.

        // Increment or decrement WITHIN sixteen bits. The mask is the model:
        // FFFFh+1 becomes 0000h in the same page, it does not become 10000h
        // and it does not touch ch.page. Widen this to 20 bits and every
        // driver's 64K-boundary workaround becomes untestable.
        ch.curAddr = ch.decrement
            ? (ch.curAddr - 1) & 0xffff
            : (ch.curAddr + 1) & 0xffff;

        // The byte moved while the counter read zero was the last one; the
        // borrow out of zero is terminal count.
        if (ch.curCount === 0) {
            ch.curCount = 0xffff;
            this._terminalCount(ch);
        } else {
            ch.curCount--;
        }
    }

    _terminalCount(ch) {
        this.status |= 1 << ch.n;
        ch.tcHit = true;
        if (ch.autoinit) {
            // Autoinitialise reloads current from base and leaves the channel
            // armed. It does NOT set the mask bit -- that is the difference
            // between a refresh channel that runs forever and a floppy
            // channel that stops.
            ch.curAddr = ch.baseAddr;
            ch.curCount = ch.baseCount;
        } else {
            ch.masked = true;
            ch.swRequest = false;
        }
        if (this.hooks.onTerminalCount) this.hooks.onTerminalCount(ch.n);
    }

    // --------------------------------------------------------------- state

    _masterClear() {
        // Fixed priority is channel 0 highest, which the XT programs.
        this.lowestPriority = 3;
        this.unmodelled = null;
        this.command = 0;
        this.status = 0;
        this.temp = 0;
        this._ff = false;       // false = the next byte is the LOW half
        for (const c of this.channels) c.masterClear();
        this._hrq = false;
        if (this.hooks.onHrq) this.hooks.onHrq(false);
    }

    /**
     * A COMMAND BIT THIS CHIP DOES NOT MODEL IS RECORDED, NOT SWALLOWED.
     *
     * Every other chip in this repository says so when a program asks for
     * something it does not implement: the 8255 sets `modeWarning`, the 8251
     * the same, the SB DSP counts unknown commands in an `unsupported` map,
     * the uPD765 returns IC=invalid and names itself in `lastRefusal`. The
     * 8237 was the one that stayed silent -- it stored these bits and behaved
     * as though they were clear, which is indistinguishable from a chip that
     * honoured them and had nothing to do.
     *
     * That is the same shape as absent hardware reading back as open-bus FFh:
     * truthful only if someone is told. A driver that programs memory-to-
     * memory and gets nothing has no way to learn why, and the failure
     * surfaces as missing data somewhere else entirely.
     *
     * ROTATING PRIORITY IS DELIBERATELY ABSENT FROM THIS LIST -- it is
     * modelled now (2026-09-05), so announcing it would be a lie in the other
     * direction. The list is what remains unmodelled, and it shrinks as
     * things are implemented.
     *
     * Counts rather than flags, so a driver that sets a bit once and a driver
     * that sets it in a loop are distinguishable.
     */
    /**
     * The command bits this chip stores and does not act on, by name.
     *
     * Deliberately NOT a list of "everything the datasheet has" -- bit 2
     * (controller disable) and bit 4 (rotating priority) are both modelled,
     * and naming a modelled feature here would be a false report in the
     * opposite direction from the one this fixes.
     */
    static UNMODELLED_COMMAND_BITS = [
        [0x01, 'memory-to-memory transfer',
            'a block copy programmed through the DMA controller moves nothing and the '
            + 'temporary register reads back zero'],
        [0x02, 'channel-0 address hold',
            'only meaningful with memory-to-memory, which is itself unmodelled'],
        [0x08, 'compressed timing',
            'transfers take the same emulated time as normal timing; nothing is faster'],
        [0x20, 'extended write',
            'the write strobe timing a slow device needs is not reproduced'],
        [0x40, 'DREQ sense inversion',
            'a device that requests by pulling DREQ LOW is never seen as requesting'],
        [0x80, 'DACK sense inversion',
            'a device expecting an active-high DACK is never acknowledged'],
    ];

    _noteUnmodelled(val, at) {
        for (const [bit, feature, symptom] of I8237.UNMODELLED_COMMAND_BITS) {
            if (!(val & bit)) continue;
            // `at` is the port the program wrote to reach this. The debugger
            // points at the instruction with it; a sentence cannot be clicked.
            // The ledger keeps EVERY address the feature was refused at, not
            // the last -- see chip-ledger.js.
            noteRefusal(this.unmodelled ||= new Map(), feature, {symptom, at});
        }
    }

    _updateHrq() {
        const active = this.pendingChannel() !== null;
        if (active === this._hrq) return;
        this._hrq = active;
        if (this.hooks.onHrq) this.hooks.onHrq(active);
    }

    getState() {
        return {
            command: this.command, status: this.status, temp: this.temp,
            ff: this._ff, hrq: this._hrq, pageScratch: this.pageScratch,
            // Added with rotating priority 2026-09-05. A checkpoint that omits
            // this restores a controller whose PRIORITY ORDER is wrong while
            // every register reads right -- the machine runs and services
            // channels in a different order than it saved. Silent, and exactly
            // the corruption the checkpoint refusal exists to prevent.
            lowestPriority: this.lowestPriority,
            channels: this.channels.map((c) => c.getState()),
        };
    }

    setState(s) {
        this.command = s.command; this.status = s.status; this.temp = s.temp;
        this._ff = s.ff; this._hrq = s.hrq; this.pageScratch = s.pageScratch;
        // `?? 3` rather than a bare assignment: a checkpoint written before
        // rotation existed must restore to FIXED priority, not to undefined --
        // which would make _priorityOrder index channels[NaN] and serve
        // nothing at all.
        this.lowestPriority = s.lowestPriority ?? 3;
        for (let i = 0; i < 4; i++) this.channels[i].setState(s.channels[i]);
    }
}

class DMAChannel {
    constructor(n) {
        this.n = n;
        this.page = 0;
        this.masterClear();
    }

    masterClear() {
        this.baseAddr = 0;
        this.curAddr = 0;
        this.baseCount = 0;
        this.curCount = 0;
        // The datasheet leaves the mode register undefined after reset; we
        // zero it (verify, demand, increment, no autoinit) for determinism.
        this.mode = MODE_DEMAND;
        this.transferType = XFER_VERIFY;
        this.autoinit = false;
        this.decrement = false;
        // Master clear SETS the mask register -- a freshly reset controller
        // ignores every DREQ until software clears the mask. A model that
        // reset the mask to zero would run transfers the real chip refuses.
        this.masked = true;
        this.swRequest = false;
        this.dreqLevel = false;
        this.tcHit = false;
        // page survives: it lives in a different chip that the 8237's reset
        // pin does not reach.
    }

    /**
     * Software requests are NOT maskable on the 8237A -- the datasheet says
     * so explicitly, and it matters: setting a request bit on a masked
     * channel starts a transfer. Hardware DREQ is maskable. (The datasheet
     * also restricts software requests to block mode; that restriction is
     * not enforced here.)
     */
    requesting() { return this.swRequest || (this.dreqLevel && !this.masked); }

    writeAddr(high, val) {
        // Base and current load together on every byte, which is why a
        // half-written address is half-written in BOTH registers.
        if (high) this.baseAddr = (this.baseAddr & 0x00ff) | (val << 8);
        else this.baseAddr = (this.baseAddr & 0xff00) | val;
        this.curAddr = this.baseAddr;
    }

    writeCount(high, val) {
        if (high) this.baseCount = (this.baseCount & 0x00ff) | (val << 8);
        else this.baseCount = (this.baseCount & 0xff00) | val;
        this.curCount = this.baseCount;
    }

    writeMode(val) {
        this.transferType = (val >> 2) & 3;
        this.autoinit = !!(val & 0x10);
        this.decrement = !!(val & 0x20);
        this.mode = (val >> 6) & 3;
    }

    getState() {
        return {
            page: this.page, baseAddr: this.baseAddr, curAddr: this.curAddr,
            baseCount: this.baseCount, curCount: this.curCount,
            mode: this.mode, transferType: this.transferType,
            autoinit: this.autoinit, decrement: this.decrement,
            masked: this.masked, swRequest: this.swRequest,
            dreqLevel: this.dreqLevel,
        };
    }

    setState(s) {
        this.page = s.page; this.baseAddr = s.baseAddr; this.curAddr = s.curAddr;
        this.baseCount = s.baseCount; this.curCount = s.curCount;
        this.mode = s.mode; this.transferType = s.transferType;
        this.autoinit = s.autoinit; this.decrement = s.decrement;
        this.masked = s.masked; this.swRequest = s.swRequest;
        this.dreqLevel = s.dreqLevel;
        this.tcHit = false;
    }
}

export default I8237;
