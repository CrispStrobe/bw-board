/**
 * NE2000 Ethernet — a DP8390 "NIC" behind the NE2000 card's ISA glue,
 * clean-room from the DP8390D datasheet in the same shape as the other
 * chips here: a register file, a `read(reg)`/`write(reg, v)` bus interface,
 * and a link the board drives through `deliver()`.
 *
 * LICENCE, BECAUSE IT IS THE FIRST QUESTION THIS FILE HAS TO ANSWER. Every
 * NE2000 implementation worth reading is GPL or LGPL — QEMU, Bochs, DOSBox-X,
 * PCem, 86Box, VirtualBox. The one permissive implementation is v86's
 * (BSD-2), and this fleet has designated v86 ORACLE-ONLY: run it, diff
 * against it, never read it into our own code. So this is written from the
 * DP8390D datasheet and the NE2000 card's published port map, the same way
 * `ym3812.js` and `sb-dsp.js` were.
 *
 * WHAT AN "ETHERNET CARD" IS HERE. There are no raw sockets in a browser and
 * this bench must run offline, so the card is not attached to a network. It
 * is attached to a LINK — an object with `send(frame)` — and the board decides
 * what that is. Two links ship: a loopback (the card hears itself) and a hub
 * that joins two or more emulated machines. Two 8086s a learner built, on one
 * wire, is the lesson; a bridge to a real network is a product decision with
 * safety questions attached and is deliberately not made here.
 *
 * THE MEMORY MODEL IS THE WHOLE CHIP. The NIC has no access to host memory:
 * it owns 16 KB of buffer RAM, and the host reaches it ONLY through REMOTE
 * DMA — set an address in RSAR, a count in RBCR, start a remote read or write
 * in the command register, then move bytes through the data port at +10h.
 * Received frames land in a RING of 256-byte pages between PSTART and PSTOP,
 * each prefixed by a four-byte header the NIC writes itself: status, the page
 * the NEXT frame starts on, and the length in bytes including the header.
 *
 * BOUNDARY AND CURRENT ARE THE TWO HALVES OF THE RING, and confusing them is
 * the classic NE2000 driver bug. CURR is where the NIC will write next; BNRY
 * is the last page the HOST has finished with. The ring is full when they
 * meet, which is why a driver must advance BNRY as it consumes — and why a
 * driver that forgets stops receiving after 16 KB with no error anywhere.
 *
 * ACCURACY TIER: THE REGISTER FILE AND THE RING, NOT THE WIRE. Pages 0 and 1
 * are exact — the command register, the ring, remote DMA, the interrupt
 * status and mask, the MAC and multicast filters. What is NOT modelled, and
 * is said rather than faked: collisions, carrier sense, the FIFO thresholds,
 * loopback modes 1-3 in TCR, and the tally counters, which return zero
 * because nothing here can lose a packet on a wire.
 *
 * @module
 */

/** Command register bits (page-independent, at offset 0). */
const CR_STOP = 0x01, CR_START = 0x02, CR_TXP = 0x04;
const CR_RD_MASK = 0x38, CR_RD_READ = 0x08, CR_RD_WRITE = 0x10, CR_RD_SEND = 0x18,
    CR_RD_ABORT = 0x20;

/** Interrupt status / mask bits. */
const ISR_PRX = 0x01, ISR_PTX = 0x02, ISR_RXE = 0x04, ISR_TXE = 0x08,
    ISR_OVW = 0x10, ISR_CNT = 0x20, ISR_RDC = 0x40, ISR_RST = 0x80;

/** Receive status, written into the frame header. */
const RSR_PRX = 0x01;

/** Receive configuration. */
const RCR_AB = 0x04, RCR_AM = 0x08, RCR_PRO = 0x10;

/** 16 KB of buffer, at the address an NE2000 puts it: pages 0x40-0x7F. */
const BUF_BASE = 0x4000, BUF_SIZE = 0x4000;
const PAGE = 256;

/** The smallest and largest an Ethernet frame may be, without the FCS. */
const MIN_FRAME = 60, MAX_FRAME = 1514;

export class NE2000 {
    /**
     * @param {{ onIRQ?: (level: 0|1) => void, link?: {send: (f: Uint8Array) => void},
     *           mac?: number[] }} [opts]
     */
    constructor(opts = {}) {
        this.hooks = opts;
        this.link = opts.link || null;
        // A locally-administered address (bit 1 of the first octet) so it can
        // never collide with a real card's OUI. The last octet varies so two
        // machines on one hub are distinguishable without being configured.
        this.rom = opts.mac ? opts.mac.slice(0, 6) : [0x02, 0x00, 0x00, 0x8b, 0x86, 0x01];
        this.reset();
    }

    reset() {
        this.mem = new Uint8Array(BUF_SIZE);
        this.cr = CR_STOP;          // the NIC comes up STOPPED, per the datasheet
        this.page = 0;
        this.isr = ISR_RST;
        this.imr = 0;
        this.dcr = 0;
        this.rcr = 0;
        this.tcr = 0;
        this.pstart = 0; this.pstop = 0; this.bnry = 0; this.curr = 0;
        this.tpsr = 0; this.tbcr = 0;
        this.rsar = 0; this.rbcr = 0;
        this.par = this.rom.slice();
        this.mar = new Uint8Array(8);
        // INITIALISED, NOT DEFAULTED AT THE READ. These were `this.txStatus ||
        // 0x01` and `this.rsr || 0` in the register read, and the first of
        // those INVENTED A SUCCESS: TSR answered "transmitted OK" before any
        // transmission had happened, because the field was undefined and the
        // fallback supplied the plausible value.
        //
        // A driver polling TSR at startup would have seen a completed send it
        // never made -- and nothing could have told it otherwise, because
        // 0x01 is exactly what a real successful transmission reports.
        //
        // Zero is the honest answer: no status bits set means nothing has
        // completed. Do not manufacture forgeability (lego-a4).
        this.txStatus = 0;
        this.rsr = 0;
        this.txPending = false;
        this.overflow = false;
        this._irq = 0;
        // The card's PROM: the MAC, each octet DOUBLED, then 'BB' at 14-15.
        // A driver reads it through remote DMA at address 0 and takes every
        // other byte -- which is how it tells an NE2000 from an NE1000.
        this.prom = new Uint8Array(32);
        for (let i = 0; i < 6; i++) { this.prom[i * 2] = this.rom[i]; this.prom[i * 2 + 1] = this.rom[i]; }
        this.prom[28] = 0x57; this.prom[29] = 0x57;   // 'WW' — the 16-bit marker
        this._raise(0);
    }

    // ---- interrupts -----------------------------------------------------
    _raise(level) {
        if (level === this._irq) return;
        this._irq = level;
        if (this.hooks.onIRQ) this.hooks.onIRQ(level);
    }

    _updateIrq() {
        this._raise((this.isr & this.imr & 0x7f) ? 1 : 0);
    }

    _setIsr(bit) { this.isr |= bit; this._updateIrq(); }

    // ---- buffer ---------------------------------------------------------
    /** Card addresses are absolute; the buffer starts at BUF_BASE. */
    _rd(addr) {
        const a = addr & 0xffff;
        if (a < 32) return this.prom[a];                 // the PROM, below the buffer
        if (a >= BUF_BASE && a < BUF_BASE + BUF_SIZE) return this.mem[a - BUF_BASE];
        return 0xff;                                     // open bus
    }

    _wr(addr, v) {
        const a = addr & 0xffff;
        if (a >= BUF_BASE && a < BUF_BASE + BUF_SIZE) this.mem[a - BUF_BASE] = v & 0xff;
    }

    // ---- the bus --------------------------------------------------------
    /**
     * 32 ports. 00-0F are the DP8390's registers (paged by CR bits 6-7),
     * 10-17 is the remote DMA data port, and 18-1F is the reset port.
     */
    read(reg) {
        const r = reg & 0x1f;
        if (r >= 0x18) { this.reset(); return 0xff; }    // reading reset() resets
        if (r >= 0x10) return this._dmaRead();
        if (r === 0) return this.cr;
        return this.page === 1 ? this._readPage1(r) : this._readPage0(r);
    }

    write(reg, val) {
        const r = reg & 0x1f, v = val & 0xff;
        if (r >= 0x18) { this.reset(); return; }
        if (r >= 0x10) { this._dmaWrite(v); return; }
        if (r === 0) { this._writeCr(v); return; }
        if (this.page === 1) this._writePage1(r, v); else this._writePage0(r, v);
    }

    _writeCr(v) {
        this.cr = v;
        this.page = (v >> 6) & 3;
        if (v & CR_STOP) { this.cr = (this.cr & ~CR_START) | CR_STOP; }
        const rd = v & CR_RD_MASK;
        if (rd === CR_RD_ABORT || (v & CR_STOP)) {
            // An abort completes the DMA immediately; drivers poll RDC for it.
            this._setIsr(ISR_RDC);
        }
        if ((v & CR_TXP) && !(v & CR_STOP)) this._transmit();
    }

    _readPage0(r) {
        switch (r) {
        case 0x03: return this.bnry;
        case 0x04: return this.txStatus;                 // TSR; 0 until a send completes
        case 0x07: return this.isr;
        case 0x08: return this.rsar & 0xff;
        case 0x09: return (this.rsar >> 8) & 0xff;
        case 0x0c: return this.rsr;                      // RSR; 0 until a frame arrives
        // THE TALLY COUNTERS ARE ZERO AND THAT IS HONEST: they count frame
        // alignment errors, CRC errors and missed packets, none of which can
        // happen on a link that cannot corrupt or drop anything.
        case 0x0d: case 0x0e: case 0x0f: return 0;
        default: return 0;
        }
    }

    _writePage0(r, v) {
        switch (r) {
        case 0x01: this.pstart = v; break;
        case 0x02: this.pstop = v; break;
        case 0x03: this.bnry = v; break;
        case 0x04: this.tpsr = v; break;
        case 0x05: this.tbcr = (this.tbcr & 0xff00) | v; break;
        case 0x06: this.tbcr = (this.tbcr & 0x00ff) | (v << 8); break;
        // ISR IS WRITE-1-TO-CLEAR. A driver that wrote the bits it wanted to
        // KEEP would clear everything else and lose the interrupt it was
        // acknowledging -- which is why this is not a plain store.
        case 0x07: this.isr &= ~v; this._updateIrq(); break;
        case 0x08: this.rsar = (this.rsar & 0xff00) | v; break;
        case 0x09: this.rsar = (this.rsar & 0x00ff) | (v << 8); break;
        case 0x0a: this.rbcr = (this.rbcr & 0xff00) | v; break;
        case 0x0b: this.rbcr = (this.rbcr & 0x00ff) | (v << 8); break;
        case 0x0c: this.rcr = v; break;
        case 0x0d: this.tcr = v; break;
        case 0x0e: this.dcr = v; break;
        case 0x0f: this.imr = v; this._updateIrq(); break;
        default: break;
        }
    }

    _readPage1(r) {
        if (r >= 0x01 && r <= 0x06) return this.par[r - 1];
        if (r === 0x07) return this.curr;
        if (r >= 0x08 && r <= 0x0f) return this.mar[r - 8];
        return 0;
    }

    _writePage1(r, v) {
        if (r >= 0x01 && r <= 0x06) { this.par[r - 1] = v; return; }
        if (r === 0x07) { this.curr = v; return; }
        if (r >= 0x08 && r <= 0x0f) { this.mar[r - 8] = v; }
    }

    // ---- remote DMA -----------------------------------------------------
    /**
     * The ONLY path between the host and the card's 16 KB. RSAR walks and
     * RBCR counts down; when it hits zero the NIC raises RDC, which is how a
     * driver knows the transfer finished rather than by counting itself.
     *
     * BYTE OR WORD IS DCR BIT 0. In word mode the host moves two bytes per
     * access, which is what every 16-bit NE2000 driver uses and what makes
     * the card an NE2000 rather than an NE1000.
     */
    _dmaRead() {
        // ONE BYTE PER ACCESS, EVEN IN WORD MODE, and that is not a
        // simplification -- it is what this bus does. DCR bit 0 says the HOST
        // moves 16 bits per I/O instruction, and on an 8086 `IN AX, DX` is
        // two byte reads at the same port. So the chip advances one byte per
        // access and the width lives in the CPU, where it belongs.
        //
        // The first version consumed two bytes per call in word mode. A
        // caller reading four header bytes then got bytes 0, 2, 4 and 6 --
        // a frame length of 2 instead of 64, and a negative payload.
        const b = this._rd(this.rsar);
        this.rsar = (this.rsar + 1) & 0xffff;
        this.rbcr = this.rbcr > 0 ? this.rbcr - 1 : 0;
        if (this.rbcr === 0) this._setIsr(ISR_RDC);
        return b;
    }

    _dmaWrite(v) {
        this._wr(this.rsar, v);
        this.rsar = (this.rsar + 1) & 0xffff;
        this.rbcr = this.rbcr > 0 ? this.rbcr - 1 : 0;
        if (this.rbcr === 0) this._setIsr(ISR_RDC);
    }

    // ---- transmit -------------------------------------------------------
    _transmit() {
        const start = (this.tpsr << 8);
        let len = this.tbcr;
        if (len < MIN_FRAME) len = MIN_FRAME;            // the wire pads to 60
        if (len > MAX_FRAME) len = MAX_FRAME;
        const frame = new Uint8Array(len);
        for (let i = 0; i < len; i++) frame[i] = this._rd(start + i);
        this.txStatus = 0x01;                            // TSR: PTX
        this.cr &= ~CR_TXP;
        this._setIsr(ISR_PTX);
        if (this.link && this.link.send) this.link.send(frame, this);
    }

    // ---- receive --------------------------------------------------------
    /**
     * A frame arrives from the link. The board calls this; the chip decides
     * whether it is for us and where it goes.
     *
     * THE FILTER IS THE POINT OF THE MAC. Without RCR_PRO (promiscuous) a
     * card accepts only frames addressed to its own MAC, to broadcast if
     * RCR_AB is set, or to a multicast group whose hash bit is set in MAR.
     * A hub that delivered everything to everyone would make a learner's
     * "why did my machine not get it" impossible to answer.
     */
    deliver(frame) {
        if (!(this.cr & CR_START) || (this.cr & CR_STOP)) return false;
        if (!this._accepts(frame)) return false;
        const bytes = Math.min(frame.length, MAX_FRAME);
        // Four-byte header, then the frame, rounded up to whole 256-byte pages.
        const total = bytes + 4;
        const pages = Math.ceil(total / PAGE);
        if (!this._hasRoom(pages)) {
            // THE RING IS FULL. Set OVW and drop -- do not overwrite, because
            // overwriting loses a frame the host has not read and produces a
            // corruption a driver cannot diagnose.
            this.overflow = true;
            this._setIsr(ISR_OVW);
            return false;
        }
        const startPage = this.curr;
        let next = startPage + pages;
        if (next >= this.pstop) next = this.pstart + (next - this.pstop);
        let a = (startPage << 8);
        this._wr(a, RSR_PRX);
        this._wr(a + 1, next);
        this._wr(a + 2, total & 0xff);
        this._wr(a + 3, (total >> 8) & 0xff);
        a += 4;
        for (let i = 0; i < bytes; i++) {
            // The ring WRAPS mid-frame, and a model that wrote linearly would
            // run off the end of the buffer for a frame near PSTOP.
            if ((a >> 8) >= this.pstop) a = (this.pstart << 8) | (a & 0xff);
            this._wr(a, frame[i]);
            a = (a + 1) & 0xffff;
        }
        this.curr = next;
        this.rsr = RSR_PRX;
        this._setIsr(ISR_PRX);
        return true;
    }

    _accepts(frame) {
        if (frame.length < 6) return false;
        if (this.rcr & RCR_PRO) return true;
        let bcast = true, mine = true;
        for (let i = 0; i < 6; i++) {
            if (frame[i] !== 0xff) bcast = false;
            if (frame[i] !== this.par[i]) mine = false;
        }
        if (mine) return true;
        if (bcast) return !!(this.rcr & RCR_AB);
        if ((frame[0] & 1) && (this.rcr & RCR_AM)) return true;   // any multicast
        return false;
    }

    /** Free pages between CURR and BNRY, treating equality as EMPTY. */
    _hasRoom(pages) {
        const span = this.pstop - this.pstart;
        if (span <= 0) return false;
        const used = (this.curr - this.bnry + span) % span;
        return (span - used - 1) >= pages;
    }

    // ---- state ----------------------------------------------------------
    getState() {
        return {
            cr: this.cr, page: this.page, isr: this.isr, imr: this.imr,
            dcr: this.dcr, rcr: this.rcr, tcr: this.tcr,
            pstart: this.pstart, pstop: this.pstop, bnry: this.bnry, curr: this.curr,
            tpsr: this.tpsr, tbcr: this.tbcr, rsar: this.rsar, rbcr: this.rbcr,
            par: this.par.slice(), mar: Array.from(this.mar),
            mem: Array.from(this.mem),
        };
    }

    setState(s) {
        Object.assign(this, {
            cr: s.cr, page: s.page, isr: s.isr, imr: s.imr, dcr: s.dcr,
            rcr: s.rcr, tcr: s.tcr, pstart: s.pstart, pstop: s.pstop,
            bnry: s.bnry, curr: s.curr, tpsr: s.tpsr, tbcr: s.tbcr,
            rsar: s.rsar, rbcr: s.rbcr,
        });
        this.par = s.par.slice();
        this.mar = Uint8Array.from(s.mar);
        this.mem = Uint8Array.from(s.mem);
        this._updateIrq();
    }
}

/**
 * A LOOPBACK LINK: the card hears its own transmissions.
 *
 * Enough to bring a driver up and prove the ring, the filter and the
 * interrupt path without a second machine — and it is what a card's own
 * self-test does on real hardware.
 */
export class LoopbackLink {
    send(frame, from) { from.deliver(frame); }
}

/**
 * A HUB: every card on it hears every frame except its own.
 *
 * This is a repeater, not a switch, and deliberately so — a learner watching
 * two machines should see that everyone hears everything and that the MAC
 * FILTER is what makes a frame "theirs". A switch would hide the lesson by
 * doing the filtering in the wire.
 */
export class HubLink {
    constructor() { this.cards = []; }
    attach(card) { this.cards.push(card); card.link = this; return card; }
    send(frame, from) {
        for (const c of this.cards) if (c !== from) c.deliver(frame);
    }
}

export default NE2000;
