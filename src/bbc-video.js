// Frame-grained BBC-style bitmap scanout. Addressing and layouts follow
// Acorn's BBC Microcomputer Service Manual §3.3. The mode port belongs
// to the Brickwright board and exposes the layouts without a MOS ROM.
const modes = [
    [640, 256, 1, 0x3000],
    [320, 256, 2, 0x3000],
    [160, 256, 4, 0x3000],
    [640, 200, 1, 0x4000],
    [320, 256, 1, 0x5800],
    [160, 256, 2, 0x5800],
    [320, 200, 1, 0x6000],
];

export const BBC_VIDEO_MODES = Object.freeze(modes.map(([width, height, bpp, base]) => Object.freeze({
    width, height, bpp, base, textColumns: width / 8, textRows: height / 8,
})));

function unpackByte(byte, pixel, bpp) {
    let colour = 0;
    for (let plane = 0; plane < bpp; plane++) {
        colour |= ((byte >> (7 - pixel - plane * (8 / bpp))) & 1) << (bpp - 1 - plane);
    }
    return colour;
}

const unpack = Object.fromEntries([1, 2, 4].map(bpp => [bpp,
    Uint8Array.from({length: 256 * (8 / bpp)}, (_, i) =>
        unpackByte((i * bpp) >> 3, i % (8 / bpp), bpp)),
]));

const defaultPalette = [0, 1, 2, 7, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 7];

export class BbcVideo {
    constructor({memory, clockHz}) {
        this.memory = memory;
        this.cyclesPerFrame = clockHz / 50;
        this.palette = Uint8Array.from(defaultPalette);
        this.layout = 0xff;
        this.frame = 0;
        this.elapsed = 0;
        this.cached = null;
    }

    read(reg) {
        return reg === 0 ? this.layout : 0xff;
    }

    write(reg, value) {
        if (reg === 0) this.layout = BBC_VIDEO_MODES[value] ? value : 0xff;
        if (reg === 1) this.palette[value >> 4] = value & 7;
        this.cached = null;
    }

    advance(cycles) {
        this.elapsed += cycles;
        if (this.elapsed >= this.cyclesPerFrame) {
            const frames = Math.floor(this.elapsed / this.cyclesPerFrame);
            this.elapsed -= frames * this.cyclesPerFrame;
            this.frame += frames;
            this.cached = null;
        }
    }

    videoFrame() {
        if (this.cached) return this.cached;
        const layout = BBC_VIDEO_MODES[this.layout];
        if (!layout) return {width: 640, height: 256, rgba: null, frame: this.frame, signal: false};

        const {width, height, bpp, base, textColumns, textRows} = layout;
        const rgba = new Uint8ClampedArray(width * height * 4);
        const pixelsPerByte = 8 / bpp;
        const bytesPerLine = width / pixelsPerByte;
        const lookup = unpack[bpp];
        let out = 0;
        for (let y = 0; y < height; y++) {
            let address = base + (y >> 3) * bytesPerLine * 8 + (y & 7);
            for (let column = 0; column < bytesPerLine; column++, address += 8) {
                const packed = this.memory[address] * pixelsPerByte;
                for (let pixel = 0; pixel < pixelsPerByte; pixel++) {
                    const rgb = this.palette[lookup[packed + pixel]];
                    rgba[out++] = (rgb & 1) ? 255 : 0;
                    rgba[out++] = (rgb & 2) ? 255 : 0;
                    rgba[out++] = (rgb & 4) ? 255 : 0;
                    rgba[out++] = 255;
                }
            }
        }
        this.cached = {width, height, textColumns, textRows, rgba, frame: this.frame,
            mode: this.layout === 3 || this.layout === 6 ? 'text' : 'graphics', signal: true};
        return this.cached;
    }

    saveState() {
        return {layout: this.layout, palette: Array.from(this.palette), frame: this.frame, elapsed: this.elapsed};
    }

    loadState({layout, palette, frame, elapsed}) {
        this.layout = layout;
        this.palette.set(palette);
        this.frame = frame;
        this.elapsed = elapsed;
        this.cached = null;
    }
}
