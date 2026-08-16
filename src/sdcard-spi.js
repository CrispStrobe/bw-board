/**
 * SD card in SPI mode, bit-banged off a VIA's port pins — the storage
 * half of the Bad Apple hookup (video streamed from SD over the 6522).
 *
 * This is a SLAVE on four wires: the firmware wiggles CS/SCK/MOSI as
 * VIA outputs and reads MISO back as a VIA input; this model watches
 * the port-change stream, shifts bits on clock edges, and answers with
 * the SD SPI-mode protocol. No bus window, no address — like the
 * simplevga card it lives entirely on wires.
 *
 * Protocol subset (SDHC shape — block addressing, the modern card every
 * tutorial assumes):
 *   CMD0  → R1 $01 (idle)          CMD8  → R7 $01 + echo $000001AA
 *   CMD55 → R1 $01/$00             ACMD41→ $01 first, then $00 (ready)
 *   CMD58 → R3 $00 + OCR $C0FF8000 (CCS=1: SDHC, block addressing)
 *   CMD16 → $00 (block length — accepted, ignored: SDHC is fixed 512)
 *   CMD17 → R1 $00, gap, token $FE, 512 data bytes, CRC $FF $FF
 *   CMD18 → as CMD17 but streaming consecutive blocks until CMD12
 *   CMD12 → stuff byte, R1 $00 (stop transmission)
 * Everything else answers R1 $04 (illegal command) — honestly, so a
 * firmware probing features learns the truth.
 *
 * Timing model: responses appear after one $FF turnaround byte (NCR=1),
 * data tokens after one more — generous against the spec's 0..8, and
 * simple. MISO changes on the FALLING clock edge, the master samples on
 * the RISING edge (SPI mode 0), full duplex: every 8 clocks exchange
 * one byte in each direction.
 *
 * The card image arrives via setImage() — the media system's 'sd-image'
 * slot. Reads past the image end return $00 bytes (an erased card), not
 * an error: real cards do the same.
 *
 * @module
 */

export class SDCardSPI {
    /**
     * @param {{cs: number, sck: number, mosi: number, miso: number, port?: 'a'|'b'}} pins
     *   VIA port bit numbers for each wire (all on one port; 'a' default).
     */
    constructor(pins) {
        this.pins = { port: 'a', ...pins };
        this.image = new Uint8Array(0);
        // wire state as last seen
        this.cs = 1; this.sck = 0;
        this.mosi = 1;
        // bit engine
        this.bitIdx = 0;
        this.inShift = 0;
        this.outByte = 0xff;
        this.outQueue = [];
        // command assembly
        this.cmdBuf = [];
        this.acmd = false;
        this.acmd41Seen = false;
        // multi-block streaming state (CMD18)
        this.streaming = false;
        this.streamBlock = 0;
        /** MISO level to publish; the machine pushes it into the VIA. */
        this.misoLevel = 1;
        this.onMiso = null; // set by the machine: (level) => void
    }

    setImage(bytes) { this.image = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); }

    _block(n) {
        const start = n * 512;
        const out = new Uint8Array(512);
        if (start < this.image.length) {
            out.set(this.image.subarray(start, Math.min(start + 512, this.image.length)));
        }
        return out;
    }

    _queueBlock(n) {
        this.outQueue.push(0xff, 0xfe);         // turnaround + data token
        for (const b of this._block(n)) this.outQueue.push(b);
        this.outQueue.push(0xff, 0xff);         // CRC (ignored in SPI mode)
    }

    _command(cmd, arg) {
        const R1_IDLE = 0x01, R1_OK = 0x00, R1_ILLEGAL = 0x04;
        const wasAcmd = this.acmd;
        this.acmd = false;
        this.outQueue.push(0xff);               // NCR turnaround
        if (wasAcmd && cmd === 41) {            // ACMD41: idle once, then ready
            if (!this.acmd41Seen) { this.outQueue.push(R1_IDLE); this.acmd41Seen = true; }
            else { this.outQueue.push(R1_OK); this.ready = true; }
            return;
        }
        switch (cmd) {
            case 0: this.outQueue.push(R1_IDLE); break;
            case 8: this.outQueue.push(R1_IDLE, 0x00, 0x00, 0x01, 0xaa); break;
            // CMD55 answers idle until an ACMD41 has actually RETURNED
            // ready — answering $00 during the init loop reads as an
            // error to real firmware and triggers a full re-init (the
            // Bad Apple player did exactly that, forever).
            case 55: this.acmd = true; this.outQueue.push(this.ready ? R1_OK : R1_IDLE); break;
            case 58: this.outQueue.push(R1_OK, 0xc0, 0xff, 0x80, 0x00); break;
            case 16: this.outQueue.push(R1_OK); break;
            case 17: this.outQueue.push(R1_OK); this._queueBlock(arg); break;
            case 18:
                this.outQueue.push(R1_OK);
                this.streaming = true;
                this.streamBlock = arg;
                this._queueBlock(this.streamBlock++);
                break;
            case 12:
                this.streaming = false;
                this.outQueue.length = 0;       // stop mid-stream, spec-honest
                this.outQueue.push(0xff, R1_OK);
                break;
            default: this.outQueue.push(R1_ILLEGAL); break;
        }
    }

    _byteExchanged(inByte) {
        // Command frames start with 01xxxxxx; collect 6 bytes.
        if (this.cmdBuf.length === 0) {
            if ((inByte & 0xc0) === 0x40) this.cmdBuf.push(inByte);
        } else {
            this.cmdBuf.push(inByte);
            if (this.cmdBuf.length === 6) {
                const [c, a3, a2, a1, a0] = this.cmdBuf;
                this._command(c & 0x3f, ((a3 << 24) | (a2 << 16) | (a1 << 8) | a0) >>> 0);
                this.cmdBuf.length = 0;
            }
        }
        // CMD18 keeps the pipe full: whenever the stream drains, feed
        // the next consecutive block.
        if (this.streaming && this.outQueue.length === 0) {
            this._queueBlock(this.streamBlock++);
        }
    }

    /** Port pin changed. The machine calls this from the VIA's output stream. */
    pinChange(bit, level) {
        const p = this.pins;
        if (bit === p.cs) {
            this.cs = level;
            if (level === 1) {                  // deselect: reset the bit engine
                this.bitIdx = 0; this.inShift = 0;
                this.cmdBuf.length = 0;
                this.outByte = 0xff;
                this._setMiso(1);
            } else {
                this.outByte = this.outQueue.length ? this.outQueue.shift() : 0xff;
                this._setMiso((this.outByte >> 7) & 1);
            }
            return;
        }
        if (bit === p.mosi) { this.mosi = level; return; }
        if (bit !== p.sck) return;
        const rising = this.sck === 0 && level === 1;
        const falling = this.sck === 1 && level === 0;
        this.sck = level;
        if (this.cs !== 0) return;              // deselected: high-Z, stay idle
        if (rising) this._rising();
        else if (falling) this._setMiso((this.outByte >> (7 - this.bitIdx)) & 1);
    }

    /**
     * One full clock via the VIA's CA2 read-handshake pulse (the Bad
     * Apple trick: LDA PORTA IS the SPI clock). CA2 idles high and
     * pulses low: present the bit on the falling half, sample on the
     * rise back.
     */
    clockPulse() {
        if (this.cs !== 0) return;
        this._setMiso((this.outByte >> (7 - this.bitIdx)) & 1);
        this._rising();
    }

    _rising() {
        {
            this.inShift = ((this.inShift << 1) | this.mosi) & 0xff;
            this.bitIdx++;
            if (this.bitIdx === 8) {
                const inByte = this.inShift;
                this.bitIdx = 0; this.inShift = 0;
                this.outByte = this.outQueue.length ? this.outQueue.shift() : 0xff;
                this._byteExchanged(inByte);
                // Mode 0 discipline: the new byte's MSB is NOT presented
                // here — the master is about to sample THIS rising edge's
                // bit. MISO changes on the next falling edge only;
                // updating it here made the 8th sampled bit belong to the
                // next byte (CMD0 read back $FE instead of $01).
            }
        }
    }

    _setMiso(level) {
        if (level !== this.misoLevel) {
            this.misoLevel = level;
            if (this.onMiso) this.onMiso(level);
        }
    }
}

export default SDCardSPI;
