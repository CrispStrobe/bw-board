import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VGACard } from '../src/vga-card.js';
import { VGAMemory } from '../src/experimental/vga-memory.js';

function fixture() {
    const card = new VGACard(5_000_000);
    const memory = new VGAMemory(card);
    const seq = (index, value) => {
        card.write(0x04, index);
        card.write(0x05, value);
    };
    const gc = (index, value) => {
        card.write(0x0e, index);
        card.write(0x0f, value);
    };
    card.write(0x02, 0x02); // miscellaneous output: enable CPU video RAM
    seq(2, 0x0f);
    seq(4, 0x06); // extended memory, sequential planar addressing
    gc(5, 0x00);
    gc(6, 0x05); // A0000-AFFFF, graphics mode
    gc(7, 0x0f);
    gc(8, 0xff);
    return { card, memory, seq, gc };
}

describe('experimental VGA memory', () => {
    it('decodes each graphics-controller aperture and refuses other addresses', () => {
        const { memory, gc } = fixture();
        memory.planes[0][0] = 0x11;
        memory.planes[0][0xffff] = 0x22;

        gc(6, 0x05);
        assert.equal(memory.read(0xa0000), 0x11);
        assert.equal(memory.read(0xaffff), 0x22);
        assert.equal(memory.read(0xb0000), null);
        assert.equal(memory.write(0xb0000, 0x99), false);

        gc(6, 0x09);
        assert.equal(memory.read(0xb0000), 0x11);
        assert.equal(memory.read(0xb7fff), 0);
        assert.equal(memory.read(0xb8000), null);

        gc(6, 0x0d);
        assert.equal(memory.read(0xb8000), 0x11);
        assert.equal(memory.read(0xbffff), 0);
        assert.equal(memory.read(0xb7fff), null);

        gc(6, 0x01);
        assert.equal(memory.read(0xa0000), 0x11);
        assert.equal(memory.read(0xb0000), 0x11, '128 KiB aperture aliases the planar map at 64 KiB');
    });

    it('loads all latches and implements read-map and color-compare modes', () => {
        const { memory, gc } = fixture();
        const values = [0xaa, 0xcc, 0xf0, 0x0f];
        for (let plane = 0; plane < 4; plane++) memory.planes[plane][0x1234] = values[plane];

        gc(4, 2);
        assert.equal(memory.read(0xa1234), 0xf0);
        assert.deepEqual(Array.from(memory.latches), values);

        gc(2, 0x05);
        gc(7, 0x0f);
        gc(5, 0x08);
        assert.equal(memory.read(0xa1234), 0x20);

        gc(7, 0x05);
        assert.equal(memory.read(0xa1234), 0xa0);
    });

    it('applies rotate, set/reset, raster operation, bit mask, and map mask in mode 0', () => {
        const { memory, seq, gc } = fixture();
        memory.planes[0][0] = 0x0f;
        memory.planes[1][0] = 0xf0;
        memory.read(0xa0000);

        seq(2, 0x03);
        gc(0, 0x02);
        gc(1, 0x02);
        gc(3, 0x19); // rotate 1, XOR
        gc(8, 0xf0);
        memory.write(0xa0000, 0x96);

        assert.equal(memory.planes[0][0], 0x4f);
        assert.equal(memory.planes[1][0], 0x00);
        assert.equal(memory.planes[2][0], 0x00, 'map mask suppresses plane 2');
    });

    it('implements write modes 1, 2, and 3 with persistent read latches', () => {
        const { memory, gc } = fixture();
        for (let plane = 0; plane < 4; plane++) memory.planes[plane][0] = 0x10 + plane;
        memory.read(0xa0000);

        gc(5, 1);
        memory.write(0xa0001, 0xff);
        assert.deepEqual(memory.planes.map((p) => p[1]), [0x10, 0x11, 0x12, 0x13]);

        gc(5, 2);
        gc(3, 0x00);
        gc(8, 0xff);
        memory.write(0xa0002, 0x05);
        assert.deepEqual(memory.planes.map((p) => p[2]), [0xff, 0x00, 0xff, 0x00]);

        for (let plane = 0; plane < 4; plane++) memory.planes[plane][3] = 0xaa;
        memory.read(0xa0003);
        gc(0, 0x01);
        gc(3, 0x14); // rotate 4, OR
        gc(5, 3);
        gc(8, 0x3c);
        memory.write(0xa0003, 0xf0); // effective mask 0x0c
        assert.equal(memory.planes[0][3], 0xae);
        assert.equal(memory.planes[1][3], 0xaa);
    });

    it('routes chain-4 accesses by low address bits and still honors map mask', () => {
        const { memory, seq, gc } = fixture();
        seq(4, 0x0e);
        gc(5, 0x00);
        for (let plane = 0; plane < 4; plane++) memory.write(0xa0000 + plane, 0x40 + plane);
        assert.deepEqual(memory.planes.map((p) => p[0]), [0x40, 0x41, 0x42, 0x43]);
        for (let plane = 0; plane < 4; plane++) {
            assert.equal(memory.read(0xa0000 + plane), 0x40 + plane);
        }

        seq(2, 0x01);
        assert.equal(memory.write(0xa0001, 0x99), true);
        assert.equal(memory.planes[1][0], 0x41, 'chain-selected plane is disabled by map mask');
        memory.write(0xa0004, 0x55);
        assert.equal(memory.planes[0][4], 0x55);

        memory.write(0xa0010, 0x6a);
        seq(4, 0x06);
        gc(4, 0);
        assert.equal(memory.read(0xa0010), 0x6a,
            'switching to planar mode observes the same literal CPU address');
    });

    it('routes odd/even accesses to plane pairs and substitutes A0 in the memory index', () => {
        const { memory, seq, gc } = fixture();
        seq(4, 0x02);
        gc(5, 0x10);
        gc(6, 0x07);
        gc(4, 0x02);
        memory.write(0xa0000, 0x66);
        memory.write(0xa0001, 0x77);
        assert.deepEqual(memory.planes.map((p) => p[0]), [0x66, 0x77, 0x66, 0x77]);
        assert.equal(memory.read(0xa0000), 0x66, 'read-map bit 1 chooses maps 2/3');
        assert.equal(memory.read(0xa0001), 0x77);
        memory.write(0xa0002, 0x88);
        assert.equal(memory.planes[0][2], 0x88);
        assert.equal(memory.planes[2][2], 0x88);
    });

    it('keeps the three odd/even controls independent in mixed register states', () => {
        const { memory, seq, gc } = fixture();
        seq(4, 0x06); // sequential writes: no parity restriction
        gc(5, 0x10); // odd/even read-map routing only
        gc(6, 0x05); // no A0 substitution
        memory.planes[3][0x101] = 0x31;
        gc(4, 0x02);
        assert.equal(memory.read(0xa0101), 0x31);
        memory.write(0xa0101, 0x44);
        assert.deepEqual(memory.planes.map((p) => p[0x101]), [0x44, 0x44, 0x44, 0x44]);

        seq(4, 0x02); // parity-select writes
        gc(5, 0x00); // ordinary read-map selection
        gc(6, 0x07); // substitute A0 in the memory-map address
        gc(4, 0x02);
        memory.planes[2][0x100] = 0x52;
        assert.equal(memory.read(0xa0101), 0x52, 'GC mode controls reads independently');
        memory.write(0xa0101, 0x77);
        assert.equal(memory.planes[1][0x100], 0x77);
        assert.equal(memory.planes[3][0x100], 0x77);
        assert.equal(memory.planes[0][0x100], 0x00);
        assert.equal(memory.planes[2][0x100], 0x52);
    });

    it('uses high aperture bits and extended-memory enable in routed map indices', () => {
        const { memory, seq, gc } = fixture();
        gc(6, 0x03); // 128 KiB aperture, A0 substitution
        gc(5, 0x10);
        gc(4, 0x02);
        seq(4, 0x06);
        memory.planes[3][0xfffe] = 0xe1;
        assert.equal(memory.read(0xbffff), 0xe1);

        seq(4, 0x04); // disable extended memory: 16 KiB per map
        memory.planes[3][0x3ffe] = 0xe2;
        assert.equal(memory.read(0xbffff), 0xe2);

        gc(6, 0x01);
        gc(5, 0x00);
        seq(4, 0x0e);
        memory.planes[3][0xfffc] = 0xc4;
        assert.equal(memory.read(0xbffff), 0xc4, 'chain-4 consumes A1:A0 as map select');
    });

    it('does not decode CPU video memory while miscellaneous-output RAM enable is clear', () => {
        const { card, memory } = fixture();
        memory.planes[0][0] = 0x5a;
        card.write(0x02, 0x00);
        assert.equal(memory.read(0xa0000), null);
        assert.equal(memory.write(0xa0000, 0xa5), false);
        assert.equal(memory.planes[0][0], 0x5a);
    });

    it('validates a checkpoint before changing planes or latches', () => {
        const { memory } = fixture();
        memory.planes[0][0] = 0x5a;
        memory.latches[0] = 0xa5;
        const state = memory.getState();
        state.planes[3].pop();
        assert.throws(() => memory.setState(state), /65536 bytes/);
        assert.equal(memory.planes[0][0], 0x5a);
        assert.equal(memory.latches[0], 0xa5);
    });
});
