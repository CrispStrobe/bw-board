/**
 * TZX container — standard speed data blocks parse to the same
 * block array ZXTape uses; turbo blocks refuse honestly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTzx, tzxToTape } from '../src/zx-tzx.js';

function makeHeader() {
    // "ZXTape!" + 0x1A + major 1 + minor 20
    return Uint8Array.from([0x5a, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21, 0x1a, 0x01, 0x14]);
}

test('parseTzx: rejects non-TZX data', () => {
    assert.throws(() => parseTzx(new Uint8Array(5)), /too short/);
    assert.throws(() => parseTzx(new Uint8Array(10)), /bad signature/);
});

test('parseTzx: empty TZX (header only) produces no blocks', () => {
    const { blocks, notes } = parseTzx(makeHeader());
    assert.equal(blocks.length, 0);
    assert.ok(notes.some(n => /TZX v1\.20/.test(n)));
});

test('parseTzx: standard speed data block ($10) extracts flag + data', () => {
    const header = makeHeader();
    // Block $10: pause(2) + len(2) + data
    // A header block: flag=$00, 17 data bytes, checksum
    const blockLen = 19; // flag + 17 data + checksum
    const block = new Uint8Array(4 + blockLen);
    block[0] = 0xe8; block[1] = 0x03; // pause = 1000ms
    block[2] = blockLen & 0xff; block[3] = (blockLen >> 8) & 0xff;
    block[4] = 0x00; // flag = header
    for (let i = 0; i < 17; i++) block[5 + i] = i + 1;
    block[22] = 0xAA; // checksum (not validated by parser)

    const buf = new Uint8Array(header.length + 1 + block.length);
    buf.set(header);
    buf[10] = 0x10; // block type
    buf.set(block, 11);

    const { blocks } = parseTzx(buf);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].flag, 0x00, 'header flag');
    assert.equal(blocks[0].data.length, 17, '17 data bytes');
    assert.equal(blocks[0].data[0], 1, 'first data byte');
});

test('parseTzx: turbo block ($11) is noted as skipped', () => {
    const header = makeHeader();
    // Minimal turbo block: 18-byte header + 0 data bytes
    const turbo = new Uint8Array(19);
    turbo[0] = 0x11; // block type
    // bytes 1-15: timing params (irrelevant)
    // bytes 16-18: data length (3 bytes LE) = 0
    turbo[16] = 0; turbo[17] = 0; turbo[18] = 0;

    const buf = new Uint8Array(header.length + turbo.length);
    buf.set(header);
    buf.set(turbo, 10);

    const { blocks, notes } = parseTzx(buf);
    assert.equal(blocks.length, 0, 'turbo block does not produce a trap block');
    assert.ok(notes.some(n => /turbo.*skipped/i.test(n)), 'turbo block noted');
});

test('parseTzx: multiple standard blocks parse in order', () => {
    const header = makeHeader();
    const mkBlock = (flag, dataLen) => {
        const blockLen = 1 + dataLen + 1; // flag + data + checksum
        const b = new Uint8Array(1 + 4 + blockLen); // type + pause + len + data
        b[0] = 0x10;
        b[1] = 0; b[2] = 0; // pause
        b[3] = blockLen & 0xff; b[4] = (blockLen >> 8) & 0xff;
        b[5] = flag;
        for (let i = 0; i < dataLen; i++) b[6 + i] = (flag + i) & 0xff;
        b[6 + dataLen] = 0; // checksum
        return b;
    };
    const b1 = mkBlock(0x00, 17); // header
    const b2 = mkBlock(0xff, 100); // data

    const buf = new Uint8Array(header.length + b1.length + b2.length);
    buf.set(header);
    buf.set(b1, header.length);
    buf.set(b2, header.length + b1.length);

    const { blocks } = parseTzx(buf);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].flag, 0x00);
    assert.equal(blocks[0].data.length, 17);
    assert.equal(blocks[1].flag, 0xff);
    assert.equal(blocks[1].data.length, 100);
});

test('tzxToTape: the trap interface loads a standard block', () => {
    const header = makeHeader();
    const dataBytes = Uint8Array.of(0x41, 0x42, 0x43); // "ABC"
    const blockLen = 1 + dataBytes.length + 1;
    const block = new Uint8Array(1 + 4 + blockLen);
    block[0] = 0x10;
    block[1] = 0; block[2] = 0;
    block[3] = blockLen & 0xff; block[4] = (blockLen >> 8) & 0xff;
    block[5] = 0xff; // flag = data block
    block.set(dataBytes, 6);
    block[6 + dataBytes.length] = 0;

    const buf = new Uint8Array(header.length + block.length);
    buf.set(header); buf.set(block, header.length);

    const tape = tzxToTape(buf);
    assert.equal(tape.blocks.length, 1);

    // Simulate the LD-BYTES trap
    const cpu = { a: 0xff, f: 0x01, ix: 0x5000, d: 0, e: 3, af_: 0 };
    const mem = new Uint8Array(65536);
    tape.trap(cpu, mem);

    assert.equal(mem[0x5000], 0x41, 'byte 0');
    assert.equal(mem[0x5001], 0x42, 'byte 1');
    assert.equal(mem[0x5002], 0x43, 'byte 2');
    assert.ok(cpu.f & 0x01, 'carry set = success');
});

test('parseTzx: text description and group blocks consumed without crash', () => {
    const header = makeHeader();
    // Text description: $30 + len + text
    const text = 'Hello TZX';
    const textBlock = new Uint8Array(2 + text.length);
    textBlock[0] = 0x30;
    textBlock[1] = text.length;
    for (let i = 0; i < text.length; i++) textBlock[2 + i] = text.charCodeAt(i);

    // Group start: $21 + len + name
    const gName = 'Part 1';
    const groupStart = new Uint8Array(2 + gName.length);
    groupStart[0] = 0x21;
    groupStart[1] = gName.length;
    for (let i = 0; i < gName.length; i++) groupStart[2 + i] = gName.charCodeAt(i);

    // Group end: $22
    const groupEnd = Uint8Array.of(0x22);

    const buf = new Uint8Array(header.length + textBlock.length + groupStart.length + groupEnd.length);
    buf.set(header);
    let off = header.length;
    buf.set(textBlock, off); off += textBlock.length;
    buf.set(groupStart, off); off += groupStart.length;
    buf.set(groupEnd, off);

    const { blocks, notes } = parseTzx(buf);
    assert.equal(blocks.length, 0, 'metadata blocks produce no tape blocks');
    assert.ok(notes.some(n => /Hello TZX/.test(n)), 'text captured');
    assert.ok(notes.some(n => /Part 1/.test(n)), 'group name captured');
});
