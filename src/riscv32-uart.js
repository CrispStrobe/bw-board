/**
 * An NS16550A-compatible UART — the memory-mapped serial port an RTOS, xv6 or
 * Linux's 8250 driver talks to. Byte registers, so the core routes `this.io8`
 * (ld8/st8) accesses here:
 *
 *   +0  THR (write) / RBR (read)        DLL when LCR.DLAB
 *   +1  IER                             DLM when LCR.DLAB
 *   +2  IIR (read) / FCR (write)
 *   +3  LCR   +4 MCR   +5 LSR   +6 MSR   +7 SCR
 *
 * Transmission is instantaneous: a THR write emits the byte and the
 * transmitter is empty again at once, so LSR always shows THRE|TEMT. The
 * interrupt sources are the two a driver needs: received data available
 * (IER bit 0, while bytes are queued) and THR empty (IER bit 1: raised when
 * THRI is enabled and after each THR write; cleared by reading IIR while it
 * reports THRE, or by the next THR write). IIR reports the highest pending one
 * (RDA 0x04 before THRE 0x02, none 0x01), with the FIFO-enabled bits 0xC0 once
 * FCR bit 0 is set, as a 16550A does.
 *
 * `onRx(level)` drives the interrupt line (the name is historical: it was only
 * the receive line). Our PLIC latches a source on each `true` it is given, so
 * the line is re-signalled on every event that asserts it, not just on edges.
 *
 * @module
 */

const RBR = 0, IER = 1, IIR = 2, LCR = 3, MCR = 4, LSR = 5, MSR = 6, SCR = 7;
const LSR_DR = 0x01, LSR_THRE = 0x20, LSR_TEMT = 0x40;
const IER_RDI = 0x01, IER_THRI = 0x02;
const LCR_DLAB = 0x80;

/**
 * @param {{onSerial?: (byte:number)=>void, onRx?: (level:boolean)=>void, base?: number}} [opts]
 */
export function createUart(opts = {}) {
    const base = opts.base ?? 0x10000000;
    const onSerial = opts.onSerial || (() => {});
    const onIrq = opts.onRx || (() => {});
    const rx = [];
    let ier = 0, lcr = 0, mcr = 0, scr = 0, fcr = 0, dll = 0, dlm = 0;
    let threPending = false;

    const iir = () => {
        const fifo = (fcr & 1) ? 0xc0 : 0;
        if ((ier & IER_RDI) && rx.length) return fifo | 0x04;
        if ((ier & IER_THRI) && threPending) return fifo | 0x02;
        return fifo | 0x01;
    };
    const level = () => (iir() & 1) === 0;
    const signal = () => onIrq(level());

    return {
        base, size: 0x1000,
        load8(off) {
            switch (off) {
                case RBR: {
                    if (lcr & LCR_DLAB) return dll;
                    const b = rx.length ? rx.shift() : 0;
                    signal();
                    return b;
                }
                case IER: return (lcr & LCR_DLAB) ? dlm : ier;
                case IIR: {
                    const v = iir();
                    if ((v & 0x0f) === 0x02) { threPending = false; signal(); }
                    return v;
                }
                case LCR: return lcr;
                case MCR: return mcr;
                case LSR: return LSR_THRE | LSR_TEMT | (rx.length ? LSR_DR : 0);
                case MSR: return 0xb0;          // DCD, DSR, CTS asserted
                case SCR: return scr;
                default: return 0;
            }
        },
        store8(off, byte) {
            byte &= 0xff;
            switch (off) {
                case RBR:
                    if (lcr & LCR_DLAB) { dll = byte; return; }
                    onSerial(byte);                                    // transmit (instantly)
                    threPending = true;
                    signal();
                    return;
                case IER:
                    if (lcr & LCR_DLAB) { dlm = byte; return; }
                    if ((byte & IER_THRI) && !(ier & IER_THRI)) threPending = true;   // enabling THRI on an empty THR
                    ier = byte & 0x0f;
                    signal();
                    return;
                case IIR: fcr = byte; if (byte & 2) { rx.length = 0; signal(); } return;   // FCR (bit 1: clear RX FIFO)
                case LCR: lcr = byte; return;
                case MCR: mcr = byte; return;
                case SCR: scr = byte; return;
                default: return;
            }
        },
        /** Push a byte into the receive path (a keyboard / host stdin). */
        rxPush(byte) { rx.push(byte & 0xff); signal(); }
    };
}

export default createUart;
