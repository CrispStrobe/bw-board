// nRF24L01+ goldens: full-duplex SPI (STATUS rides out under every
// command byte), the RF24-style two-radio flow across the air, channel
// isolation, and write-1-to-clear on the IRQ.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerNrf24 } from '../src/devices/nrf24.js';
import { resetAir } from '../src/air.js';

registerNrf24();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const NRFT = ['vcc', 'gnd', 'ce', 'csn', 'sck', 'mosi', 'miso', 'irq'];

function rig(ids) {
    for (let ch = 0; ch < 128; ch++) resetAir(`nrf24:${ch}`);
    const board = new BoardImpl(5.0);
    const parts = [V, G];
    const nets = [net('nv', ['VCC', 'vcc']), net('ng', ['GND', 'gnd'])];
    const mcuTerms = [];
    ids.forEach((id, i) => {
        parts.push({ id, kind: 'nrf24l01', params: {}, terminals: NRFT });
        nets[0].terminals.push({ part: id, terminal: 'vcc' });
        nets[1].terminals.push({ part: id, terminal: 'gnd' });
        for (const t of ['ce', 'csn', 'sck', 'mosi', 'miso', 'irq']) {
            const pin = `P${i}.${['ce', 'csn', 'sck', 'mosi', 'miso', 'irq'].indexOf(t)}`;
            mcuTerms.push(pin);
            nets.push(net(`n_${id}_${t}`, ['MCU', pin], [id, t]));
        }
    });
    parts.push({ id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerms });
    board.setNetlist(parts, nets);
    let t = 0n;
    const tick = () => { t += 2_000n; board.advanceTo(t); };
    const pinName = (i, t2) => `P${i}.${['ce', 'csn', 'sck', 'mosi', 'miso', 'irq'].indexOf(t2)}`;
    const pin = (i, t2, h) => { board.setPin(pinName(i, t2), 'pushpull', h); tick(); };
    ids.forEach((_, i) => {
        pin(i, 'csn', true); pin(i, 'sck', false); pin(i, 'ce', false);
        board.setPin(pinName(i, 'miso'), 'input', false);
        board.setPin(pinName(i, 'irq'), 'input', false);
    });
    // SPI mode 0 master: MOSI set, sample MISO, SCK rise, SCK fall.
    const xfer = (i, bytes) => {
        const out = [];
        pin(i, 'csn', false);
        for (const b of bytes) {
            let got = 0;
            for (let bit = 7; bit >= 0; bit--) {
                pin(i, 'mosi', !!((b >> bit) & 1));
                got = (got << 1) | (board.readAnalog(pinName(i, 'miso')) > 2.5 ? 1 : 0);
                pin(i, 'sck', true);
                pin(i, 'sck', false);
            }
            out.push(got);
        }
        pin(i, 'csn', true);
        return out;
    };
    const irqLow = (i) => board.readAnalog(pinName(i, 'irq')) < 2.5;
    return { board, xfer, pin, irqLow };
}

const ADDR = [0xce, 0xcc, 0xce, 0xcc, 0xce];

describe('nRF24L01+', () => {
    it('STATUS rides out under the command byte; registers read back', () => {
        const r = rig(['N0']);
        const [st] = r.xfer(0, [0xff]);                 // NOP
        assert.equal(st & 0x0e, 0x0e, 'empty RX → pipe bits 111');
        r.xfer(0, [0x20 | 0x05, 76]);                   // W RF_CH = 76
        const [, ch] = r.xfer(0, [0x05, 0x00]);         // R RF_CH
        assert.equal(ch, 76);
    });

    it('two radios: write, CE pulse, packet crosses; pipe, payload, IRQ, clear', () => {
        const r = rig(['NTX', 'NRX']);
        // RX: PWR_UP|PRIM_RX|EN_CRC, ch 76, pipe1 addr, width 5, CE high.
        r.xfer(1, [0x20 | 0x00, 0x0b]);
        r.xfer(1, [0x20 | 0x05, 76]);
        r.xfer(1, [0x20 | 0x0b, ...ADDR]);              // RX_ADDR_P1
        r.xfer(1, [0x20 | 0x12, 5]);                    // RX_PW_P1
        r.pin(1, 'ce', true);
        // TX: PWR_UP, ch 76, TX_ADDR, payload, CE pulse.
        r.xfer(0, [0x20 | 0x00, 0x0a]);
        r.xfer(0, [0x20 | 0x05, 76]);
        r.xfer(0, [0x20 | 0x10, ...ADDR]);              // TX_ADDR
        r.xfer(0, [0xa0, ...[...'HELLO'].map((c) => c.charCodeAt(0))]);
        r.pin(0, 'ce', true); r.pin(0, 'ce', false);

        const [strx] = r.xfer(1, [0xff]);
        assert.equal(strx & 0x40, 0x40, 'RX_DR set');
        assert.equal((strx >> 1) & 0x07, 1, 'pipe 1');
        assert.ok(r.irqLow(1), 'RX IRQ pin active low');
        const [sttx] = r.xfer(0, [0xff]);
        assert.equal(sttx & 0x20, 0x20, 'TX_DS on the sender');

        const rx = r.xfer(1, [0x61, 0, 0, 0, 0, 0]);    // R_RX_PAYLOAD
        assert.equal(String.fromCharCode(...rx.slice(1)), 'HELLO');

        r.xfer(1, [0x20 | 0x07, 0x70]);                 // write-1-to-clear
        assert.ok(!r.irqLow(1), 'IRQ released after clear');
    });

    it('different channels never meet; MAX_RT reports the silence', () => {
        const r = rig(['NTX', 'NRX']);
        r.xfer(1, [0x20 | 0x00, 0x0b]);
        r.xfer(1, [0x20 | 0x05, 42]);                   // RX tuned elsewhere
        r.xfer(1, [0x20 | 0x0b, ...ADDR]);
        r.xfer(1, [0x20 | 0x12, 5]);
        r.pin(1, 'ce', true);
        r.xfer(0, [0x20 | 0x00, 0x0a]);
        r.xfer(0, [0x20 | 0x05, 76]);
        r.xfer(0, [0x20 | 0x10, ...ADDR]);
        r.xfer(0, [0xa0, 1, 2, 3, 4, 5]);
        r.pin(0, 'ce', true); r.pin(0, 'ce', false);
        const [strx] = r.xfer(1, [0xff]);
        assert.equal(strx & 0x40, 0, 'nothing arrived across channels');
        const [sttx] = r.xfer(0, [0xff]);
        assert.equal(sttx & 0x10, 0x10, 'auto-ack silence → MAX_RT');
    });
});
