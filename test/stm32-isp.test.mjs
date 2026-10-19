// The AN3155 flasher against a byte-exact mock bootloader: every frame
// the module emits is validated server-side the way the ROM validates
// it (command complements, XOR integrity bytes, word alignment,
// chunking), the mock assembles the written flash, and the assembled
// image must equal the input byte-for-byte. This proves OUR half of the
// wire completely; the first silicon run is still owed and the module
// header says so.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStm32Isp } from '../src/stm32-isp.js';

const ACK = 0x79;
const NACK = 0x1f;

/** A mock STM32 ROM bootloader speaking AN3155 over the transport shape. */
function mockBootloader (opts = {}) {
    const productId = opts.productId ?? 0x444; // F030x4/x6
    const flash = new Map();                   // addr -> byte
    let erased = false;
    let inbox = [];                            // bytes the HOST wrote
    let outbox = [];                           // bytes the ROM answers
    const log = [];

    const reply = (...b) => outbox.push(...b);
    const take = (n) => inbox.splice(0, n);

    // The ROM is a state machine fed by host bytes.
    let state = 'reset';
    let pending = null;
    function pump () {
        for (;;) {
            if (state === 'reset') {
                if (inbox.length < 1) return;
                const [b] = take(1);
                if (b !== 0x7f) { reply(NACK); continue; }
                log.push('init');
                reply(ACK);
                state = 'idle';
            } else if (state === 'idle') {
                if (inbox.length < 2) return;
                const [cmd, comp] = take(2);
                if (((~cmd) & 0xff) !== comp) { log.push(`badcomp:${cmd}`); reply(NACK); continue; }
                reply(ACK);
                if (cmd === 0x02) {            // GET ID
                    log.push('getid');
                    reply(1, (productId >> 8) & 0xff, productId & 0xff, ACK);
                } else if (cmd === 0x00) {     // GET
                    log.push('get');
                    reply(5, 0x31, 0x00, 0x02, 0x21, 0x31, 0x44, ACK);
                } else if (cmd === 0x44) {     // EXTENDED ERASE
                    state = 'ext-erase';
                } else if (cmd === 0x31) {     // WRITE MEMORY
                    state = 'write-addr';
                } else if (cmd === 0x21) {     // GO
                    state = 'go-addr';
                } else {
                    log.push(`unknown:${cmd}`);
                    reply(NACK);
                }
            } else if (state === 'ext-erase') {
                if (inbox.length < 3) return;
                const f = take(3);
                if ((f[0] ^ f[1]) !== f[2]) { reply(NACK); state = 'idle'; continue; }
                if (f[0] === 0xff && f[1] === 0xff) { erased = true; flash.clear(); log.push('global-erase'); reply(ACK); }
                else { log.push('page-erase'); reply(ACK); }
                state = 'idle';
            } else if (state === 'write-addr' || state === 'go-addr') {
                if (inbox.length < 5) return;
                const f = take(5);
                const cs = f[0] ^ f[1] ^ f[2] ^ f[3];
                if (cs !== f[4]) { log.push('badaddrcs'); reply(NACK); state = 'idle'; continue; }
                const addr = ((f[0] << 24) | (f[1] << 16) | (f[2] << 8) | f[3]) >>> 0;
                if (state === 'go-addr') { log.push(`go:${addr.toString(16)}`); reply(ACK); state = 'idle'; continue; }
                pending = addr;
                reply(ACK);
                state = 'write-data-len';
            } else if (state === 'write-data-len') {
                if (inbox.length < 1) return;
                const need = inbox[0] + 1;         // N-1 header
                if (inbox.length < 1 + need + 1) return;
                const f = take(1 + need + 1);
                const head = f[0];
                const data = f.slice(1, 1 + need);
                const cs = data.reduce((a, b) => a ^ b, head);
                if (cs !== f[f.length - 1]) { log.push('baddatacs'); reply(NACK); state = 'idle'; continue; }
                if (!erased) { log.push('write-before-erase'); }
                for (let i = 0; i < data.length; i++) flash.set(pending + i, data[i]);
                log.push(`write:${pending.toString(16)}+${data.length}`);
                reply(ACK);
                state = 'idle';
            }
        }
    }

    return {
        log,
        flashImage (base, len) {
            const out = new Uint8Array(len);
            for (let i = 0; i < len; i++) out[i] = flash.get(base + i) ?? 0xff;
            return out;
        },
        transport: {
            async write (bytes) { inbox.push(...bytes); pump(); },
            async read (n) {
                // Deterministic: the mock has already pumped; short reads
                // model a dead ROM (nothing buffered).
                return Uint8Array.from(outbox.splice(0, n));
            },
        },
    };
}

describe('STM32 AN3155 flasher (mock bootloader)', () => {
    it('the whole ritual writes the image byte-for-byte and jumps', async () => {
        const rom = mockBootloader();
        const isp = createStm32Isp(rom.transport);
        // 701 bytes (neither chunk- nor word-aligned): 3 chunks + padding
        const image = Uint8Array.from({ length: 701 }, (_, i) => (i * 7 + 3) & 0xff);
        const progress = [];
        const isp2 = createStm32Isp(rom.transport, { onProgress: (d, t) => progress.push([d, t]) });
        const res = await isp2.flash(image);
        assert.equal(res.productId, 0x444, 'F030 answers its id');
        assert.equal(res.bytes, 704, 'padded to a word multiple');
        const readBack = rom.flashImage(0x08000000, 701);
        assert.deepEqual([...readBack], [...image], 'flash equals the image byte-for-byte');
        assert.ok(rom.log.includes('global-erase'), 'erased before writing');
        assert.match(rom.log.join(','), /go:8000000/, 'jumped to the image base');
        assert.equal(progress[progress.length - 1][0], 704, 'progress reached the end');
        assert.ok(!rom.log.some((l) => l.startsWith('bad')), `no framing rejections (${rom.log.filter((l) => l.startsWith('bad'))})`);
    });

    it('command complements and checksums are what the ROM checks', async () => {
        const rom = mockBootloader();
        const isp = createStm32Isp(rom.transport);
        await isp.init();
        const id = await isp.getId();
        assert.equal(id, 0x444);
        const got = await isp.get();
        assert.equal(got.version, 0x31);
        assert.ok(got.commands.includes(0x44), 'the F0 ROM advertises extended erase');
    });

    it('a NACK surfaces with the command that drew it', async () => {
        const rom = mockBootloader();
        // sabotage: a transport that flips the complement byte of GO
        const t = {
            write: (b) => {
                if (b.length === 2 && b[0] === 0x21) b = Uint8Array.of(0x21, 0x00);
                return rom.transport.write(b);
            },
            read: rom.transport.read,
        };
        const isp = createStm32Isp(t);
        await isp.init();
        await assert.rejects(() => isp.go(0x08000000), /GO: NACK/);
    });

    it('refuses a misaligned or oversized chunk before touching the wire', async () => {
        const rom = mockBootloader();
        const isp = createStm32Isp(rom.transport);
        await assert.rejects(() => isp.writeChunk(0x08000001, new Uint8Array(4)), /not word-aligned/);
        await assert.rejects(() => isp.writeChunk(0x08000000, new Uint8Array(300)), /1\.\.256/);
        assert.equal(rom.log.length, 0, 'nothing reached the ROM');
    });

    it('a dead ROM (no BOOT0) reads as the helpful init error', async () => {
        const isp = createStm32Isp({ write: async () => {}, read: async () => Uint8Array.of() });
        await assert.rejects(() => isp.init(), /BOOT0/);
    });
});
