/**
 * A minimal NS16550-compatible UART — the memory-mapped serial port an RTOS or
 * a freestanding program writes to for output (as opposed to the machine's
 * `ecall` ABI, which is a bare-metal newlib convenience). Byte registers, so
 * the core routes `this.io8` (ld8/st8) accesses here:
 *
 *   +0  THR (write) transmit  /  RBR (read) receive
 *   +1  IER      +2  IIR/FCR     +3  LCR     +4  MCR
 *   +5  LSR      status: bit0 DR (rx ready), bit5 THRE, bit6 TEMT (tx empty)
 *
 * Only what a polled driver needs: writing THR emits a byte; LSR always reports
 * the transmitter empty (so the driver's "wait for THRE" spin passes) and DR set
 * iff a byte was pushed in. It is the same shape the 16550 driver in Zephyr /
 * Linux / newlib pokes.
 *
 * @module
 */

const THR = 0, IER = 1, LCR = 3, MCR = 4, LSR = 5;
const LSR_DR = 0x01, LSR_THRE = 0x20, LSR_TEMT = 0x40;

/**
 * @param {{onSerial?: (byte:number)=>void, base?: number}} [opts]
 */
export function createUart(opts = {}) {
    const base = opts.base ?? 0x10000000;
    const onSerial = opts.onSerial || (() => {});
    const rx = [];
    let ier = 0, lcr = 0, mcr = 0;

    return {
        base, size: 0x1000,
        load8(off) {
            switch (off) {
                case THR: return rx.length ? rx.shift() : 0;             // RBR
                case IER: return ier;
                case LCR: return lcr;
                case MCR: return mcr;
                case LSR: return LSR_THRE | LSR_TEMT | (rx.length ? LSR_DR : 0);
                default: return 0;
            }
        },
        store8(off, byte) {
            switch (off) {
                case THR: onSerial(byte & 0xff); return;                 // transmit
                case IER: ier = byte & 0xff; return;
                case LCR: lcr = byte & 0xff; return;
                case MCR: mcr = byte & 0xff; return;
                default: return;                                          // FCR etc. ignored
            }
        },
        /** Push a byte into the receive path (a keyboard / host stdin). */
        rxPush(byte) { rx.push(byte & 0xff); }
    };
}

export default createUart;
