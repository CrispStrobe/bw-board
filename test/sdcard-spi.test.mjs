// SD card in SPI mode on the VIA's pins — the Bad Apple storage hookup.
// The test IS the firmware's job description: a bit-banged SPI master
// (driven through real bus writes to the VIA registers, not by poking
// the model) runs the SDHC init dance and reads block 0 and block 3
// with CMD17, byte-for-byte against the image loaded through the
// media system's 'sd-image' slot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';
import { applyMedia } from '../src/machine-media.js';

const VIA = 0x6000;
const ORA = VIA + 1, DDRA = VIA + 3;
const CS = 2, SCK = 0, MOSI = 1, MISO = 3;

function machineWithCard() {
    const config = {
        ...EATER6502,
        chips: [
            ...EATER6502.chips,
            { kind: 'sdcard', name: 'sd1', via: 'via1', pins: { cs: CS, sck: SCK, mosi: MOSI, miso: MISO } },
        ],
    };
    const m = new M6502Machine(config, {});
    // 512-byte blocks with a recognizable per-block pattern.
    const image = new Uint8Array(4 * 512);
    for (let b = 0; b < 4; b++) for (let i = 0; i < 512; i++) image[b * 512 + i] = (b * 37 + i) & 0xff;
    const { applied, errors } = applyMedia({ machine: m, kind: 'eater6502' }, { 'sd-image': image });
    assert.deepEqual(applied, ['sd-image']);
    assert.deepEqual(errors, []);
    return { m, image };
}

function master(m) {
    let ora = (1 << CS) | (1 << MOSI); // CS high (deselected), MOSI idle high
    m._write(DDRA, (1 << CS) | (1 << SCK) | (1 << MOSI)); // MISO stays input
    m._write(ORA, ora);
    const set = (bit, level) => {
        ora = level ? (ora | (1 << bit)) : (ora & ~(1 << bit));
        m._write(ORA, ora);
    };
    return {
        select: () => set(CS, 0),
        deselect: () => { set(CS, 1); },
        xfer(out) {
            let inByte = 0;
            for (let i = 7; i >= 0; i--) {
                set(MOSI, (out >> i) & 1);
                set(SCK, 1);
                inByte = (inByte << 1) | ((m._read(ORA) >> MISO) & 1);
                set(SCK, 0);
            }
            return inByte;
        },
        cmd(n, arg) {
            this.xfer(0xff); // sync gap
            this.xfer(0x40 | n);
            this.xfer((arg >>> 24) & 0xff); this.xfer((arg >>> 16) & 0xff);
            this.xfer((arg >>> 8) & 0xff); this.xfer(arg & 0xff);
            this.xfer(n === 0 ? 0x95 : n === 8 ? 0x87 : 0x01); // CRC (only CMD0/8 checked on real cards)
            for (let i = 0; i < 8; i++) {           // wait out NCR
                const r = this.xfer(0xff);
                if (r !== 0xff) return r;
            }
            return 0xff;
        },
        readBlock(n) {
            const r1 = this.cmd(17, n);
            assert.equal(r1, 0x00, `CMD17 R1=${r1.toString(16)}`);
            let token = 0xff;
            for (let i = 0; i < 16 && token === 0xff; i++) token = this.xfer(0xff);
            assert.equal(token, 0xfe, `data token=${token.toString(16)}`);
            const data = new Uint8Array(512);
            for (let i = 0; i < 512; i++) data[i] = this.xfer(0xff);
            this.xfer(0xff); this.xfer(0xff);       // CRC
            return data;
        },
    };
}

test('SDHC init dance answers by the book', () => {
    const { m } = machineWithCard();
    const spi = master(m);
    spi.select();
    assert.equal(spi.cmd(0, 0), 0x01, 'CMD0 → idle');
    const r7 = spi.cmd(8, 0x1aa);
    assert.equal(r7, 0x01, 'CMD8 R1');
    const echo = [spi.xfer(0xff), spi.xfer(0xff), spi.xfer(0xff), spi.xfer(0xff)];
    assert.deepEqual(echo, [0x00, 0x00, 0x01, 0xaa], 'CMD8 echoes the check pattern');
    assert.equal(spi.cmd(55, 0), 0x01, 'CMD55');
    assert.equal(spi.cmd(41, 0x40000000), 0x01, 'first ACMD41 still idle');
    spi.cmd(55, 0);
    assert.equal(spi.cmd(41, 0x40000000), 0x00, 'second ACMD41 ready');
    const r3 = spi.cmd(58, 0);
    assert.equal(r3, 0x00, 'CMD58 R1');
    const ocr = [spi.xfer(0xff), spi.xfer(0xff), spi.xfer(0xff), spi.xfer(0xff)];
    assert.equal(ocr[0] & 0x40, 0x40, 'OCR says SDHC (CCS set)');
    spi.deselect();
});

test('CMD17 reads blocks byte-for-byte from the media image', () => {
    const { m, image } = machineWithCard();
    const spi = master(m);
    spi.select();
    spi.cmd(0, 0); spi.cmd(8, 0x1aa);
    spi.xfer(0xff); spi.xfer(0xff); spi.xfer(0xff); spi.xfer(0xff);
    spi.cmd(55, 0); spi.cmd(41, 0x40000000);
    spi.cmd(55, 0); spi.cmd(41, 0x40000000);
    for (const n of [0, 3]) {
        const data = spi.readBlock(n);
        assert.deepEqual([...data], [...image.subarray(n * 512, (n + 1) * 512)], `block ${n}`);
    }
    spi.deselect();
});

test('reads past the image end are erased-card zeros, not errors', () => {
    const { m } = machineWithCard();
    const spi = master(m);
    spi.select();
    spi.cmd(0, 0);
    const data = spi.readBlock(9);
    assert.ok([...data].every((b) => b === 0));
    spi.deselect();
});
