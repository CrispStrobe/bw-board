/**
 * A full I2C slave engine — the piece the existing write-only decoder in
 * i2c-parts.js does not have: it DRIVES the bus. ACK bits are pulled low
 * on the ninth clock, data bytes are transmitted to a reading master
 * bit-by-bit (changed on SCL falling edges, sampled by the master on
 * rising), and the master's ACK/NACK after each transmitted byte decides
 * whether the next byte loads. Built for the AT24C02 and reusable by any
 * register-style I2C part (MPU-6050, TCS34725, ...).
 *
 * Edge-fed like the rest of the board's protocol devices: call
 * feedI2CSlave(state, sclHigh, sdaHigh) on every update; it returns the
 * desired SDA drive (true = pull low) and invokes the handlers:
 *   onAddress(addr7, rw) → boolean          claim the transfer?
 *   onWriteByte(byte)    → boolean|void     ACK this data byte? (default yes)
 *   onReadByte()         → number           next byte for a reading master
 *   onStop()                                bus STOP (commit points live here)
 *
 * @module
 */

export function createI2CSlave(handlers) {
    return {
        handlers,
        lastScl: null, lastSda: null,
        phase: 'idle',      // idle | addr | sack | write | wack | read | mack | dead
        bit: 0, byte: 0, rw: 0,
        ackArmed: false, mackLow: false,
        txByte: 0,
        driveLow: false,
    };
}

/** @returns {boolean} whether the slave wants SDA pulled low right now */
export function feedI2CSlave(s, sclHigh, sdaHigh) {
    const sclRose = sclHigh && s.lastScl === false;
    const sclFell = !sclHigh && s.lastScl === true;
    const sdaFell = !sdaHigh && s.lastSda === true;
    const sdaRose = sdaHigh && s.lastSda === false;
    const h = s.handlers;

    if (sdaFell && sclHigh) {                       // START / repeated START
        s.phase = 'addr'; s.bit = 0; s.byte = 0;
        s.ackArmed = false; s.driveLow = false;
    } else if (sdaRose && sclHigh) {                // STOP
        if (s.phase !== 'idle' && h.onStop) h.onStop();
        s.phase = 'idle'; s.driveLow = false;
    } else if (sclRose) {
        if ((s.phase === 'addr' || s.phase === 'write') && s.bit < 8) {
            s.byte = ((s.byte << 1) | (sdaHigh ? 1 : 0)) & 0xff;
            s.bit++;
        } else if (s.phase === 'mack') {
            s.mackLow = !sdaHigh;                   // master ACK sampled here
        }
    } else if (sclFell) {
        switch (s.phase) {
            case 'addr':
                if (s.bit === 8) {
                    s.rw = s.byte & 1;
                    if (h.onAddress((s.byte >> 1) & 0x7f, s.rw)) {
                        s.phase = 'sack'; s.driveLow = true;    // ACK clock
                    } else { s.phase = 'dead'; }
                }
                break;
            case 'sack':                            // ACK clock ended
                if (s.rw === 1) {
                    s.phase = 'read';
                    s.txByte = h.onReadByte() & 0xff;
                    s.bit = 7;
                    s.driveLow = !((s.txByte >> 7) & 1);
                } else {
                    s.phase = 'write'; s.bit = 0; s.byte = 0; s.driveLow = false;
                }
                break;
            case 'write':
                if (s.bit === 8) {
                    const ack = h.onWriteByte ? h.onWriteByte(s.byte) : true;
                    if (ack === false) { s.phase = 'dead'; s.driveLow = false; }
                    else { s.phase = 'wack'; s.driveLow = true; }
                }
                break;
            case 'wack':                            // data-ACK clock ended
                s.phase = 'write'; s.bit = 0; s.byte = 0; s.driveLow = false;
                break;
            case 'read':
                if (s.bit > 0) {
                    s.bit--;
                    s.driveLow = !((s.txByte >> s.bit) & 1);
                } else {                            // byte done: master's ACK clock
                    s.phase = 'mack'; s.driveLow = false;
                }
                break;
            case 'mack':                            // master ACK clock ended
                if (s.mackLow) {
                    s.phase = 'read';
                    s.txByte = h.onReadByte() & 0xff;
                    s.bit = 7;
                    s.driveLow = !((s.txByte >> 7) & 1);
                } else { s.phase = 'dead'; s.driveLow = false; }
                break;
            default: break;
        }
    }

    s.lastScl = sclHigh; s.lastSda = sdaHigh;
    return s.driveLow;
}
