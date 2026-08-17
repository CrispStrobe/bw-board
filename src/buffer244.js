/**
 * 74HC244 octal buffer as a read-only input port — the input mirror of
 * Latch374. On the real breadboard, the /OE pins are strobed by IO-read
 * decode: the CPU does IN (n),A and the glue logic pulls /OE low, gating
 * the A-input pins onto the data bus through the buffer's Y outputs.
 *
 * From the machine's perspective this is one read-only port: read()
 * returns the current state of the 8 A-inputs, sampled from the board's
 * pins via a callback. write() is a no-op (the buffer has no latched
 * state — it's transparent when enabled).
 *
 * @module
 */

export class Buffer244 {
    /** @param {{ onRead?: () => number }} [hooks]
     *  onRead: called on each port read, returns 8-bit sampled value */
    constructor(hooks = {}) {
        this.hooks = hooks;
    }

    /** Sample the buffer's inputs. The hook reads board pins. */
    read() {
        return this.hooks.onRead ? (this.hooks.onRead() & 0xff) : 0xff;
    }

    /** Write is a no-op — the 244 is a buffer, not a latch. */
    write() {}

    get irqAsserted() { return false; }
}

export default Buffer244;
