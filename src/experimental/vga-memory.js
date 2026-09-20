/**
 * Experimental VGA memory pipeline.
 *
 * This composes with VGACard through getVideoState(); it does not own ports,
 * timing, or rendering. CPU-visible accesses are decoded into four 64 KiB
 * maps and pass through the VGA read latches and graphics-controller ALU.
 */

const PLANE_SIZE = 0x10000;

function byte(value) {
    return value & 0xff;
}

function rotateRight8(value, count) {
    const n = count & 7;
    const v = byte(value);
    return byte((v >>> n) | (v << ((8 - n) & 7)));
}

function raster(source, latch, operation) {
    switch (operation & 3) {
        case 1: return source & latch;
        case 2: return source | latch;
        case 3: return source ^ latch;
        default: return source;
    }
}

function requireByteArray(value, length, name) {
    if (!Array.isArray(value) || value.length !== length
        || value.some((v) => !Number.isInteger(v) || v < 0 || v > 0xff)) {
        throw new TypeError(`${name} must contain exactly ${length} bytes`);
    }
}

export class VGAMemory {
    constructor(registerSource) {
        if (!registerSource || typeof registerSource.getVideoState !== 'function') {
            throw new TypeError('VGAMemory requires a VGA getVideoState() source');
        }
        this.registerSource = registerSource;
        this.planes = Array.from({ length: 4 }, () => new Uint8Array(PLANE_SIZE));
        this.latches = new Uint8Array(4);
    }

    reset() {
        for (const plane of this.planes) plane.fill(0);
        this.latches.fill(0);
    }

    _registers() {
        const state = this.registerSource.getVideoState();
        if (!state || !state.seq || state.seq.length < 5 || !state.gc || state.gc.length < 9) {
            throw new TypeError('VGA state must expose sequencer and graphics-controller registers');
        }
        return state;
    }

    _decode(address, gc) {
        if (!Number.isInteger(address) || address < 0) return null;
        switch ((gc[6] >>> 2) & 3) {
            case 0:
                return address >= 0xa0000 && address <= 0xbffff
                    ? address - 0xa0000 : null;
            case 1:
                return address >= 0xa0000 && address <= 0xaffff
                    ? address - 0xa0000 : null;
            case 2:
                return address >= 0xb0000 && address <= 0xb7fff
                    ? address - 0xb0000 : null;
            default:
                return address >= 0xb8000 && address <= 0xbffff
                    ? address - 0xb8000 : null;
        }
    }

    _route(offset, seq, gc) {
        const chain4 = (seq[4] & 0x08) !== 0;
        const addressMask = seq[4] & 0x02 ? 0xffff : 0x3fff;
        if (chain4) {
            return {
                // CPU address bits A1:A0 select the plane; the remaining
                // address bits stay in their literal positions in VGA RAM.
                // Display fetch packing belongs to CRTC/rendering logic.
                index: (offset & ~3) & addressMask,
                readPlane: offset & 3,
                chain4: true,
                writeOddEven: false,
            };
        }

        const hostOddEven = (gc[5] & 0x10) !== 0;
        const substituteA0 = (gc[6] & 0x02) !== 0;
        return {
            index: (substituteA0 ? offset & ~1 : offset) & addressMask,
            readPlane: hostOddEven ? ((gc[4] & 2) | (offset & 1)) : gc[4] & 3,
            chain4: false,
            writeOddEven: (seq[4] & 0x04) === 0,
        };
    }

    _loadLatches(index) {
        for (let plane = 0; plane < 4; plane++) {
            this.latches[plane] = this.planes[plane][index];
        }
    }

    /** Return null when the selected VGA aperture does not decode address. */
    read(address) {
        const { misc, seq, gc } = this._registers();
        if ((misc & 0x02) === 0) return null;
        const offset = this._decode(address, gc);
        if (offset === null) return null;
        const route = this._route(offset, seq, gc);
        this._loadLatches(route.index);

        if ((gc[5] & 0x08) === 0) return this.latches[route.readPlane];

        const compare = gc[2] & 0x0f;
        const care = gc[7] & 0x0f;
        let result = 0xff;
        for (let plane = 0; plane < 4; plane++) {
            if ((care & (1 << plane)) === 0) continue;
            const expected = compare & (1 << plane) ? 0xff : 0x00;
            result &= byte(~(this.latches[plane] ^ expected));
        }
        return result;
    }

    /** Return false when the selected VGA aperture does not decode address. */
    write(address, value) {
        const { misc, seq, gc } = this._registers();
        if ((misc & 0x02) === 0) return false;
        const offset = this._decode(address, gc);
        if (offset === null) return false;
        const route = this._route(offset, seq, gc);
        const mapMask = seq[2] & 0x0f;
        const writeMode = gc[5] & 3;
        const rotated = rotateRight8(value, gc[3] & 7);
        const operation = (gc[3] >>> 3) & 3;
        const registerMask = gc[8];

        for (let plane = 0; plane < 4; plane++) {
            if ((mapMask & (1 << plane)) === 0) continue;
            if (route.chain4 && plane !== route.readPlane) continue;
            if (route.writeOddEven && (plane & 1) !== (offset & 1)) continue;

            let source;
            let bitMask = registerMask;
            switch (writeMode) {
                case 1:
                    this.planes[plane][route.index] = this.latches[plane];
                    continue;
                case 2:
                    source = value & (1 << plane) ? 0xff : 0x00;
                    break;
                case 3:
                    source = gc[0] & (1 << plane) ? 0xff : 0x00;
                    bitMask &= rotated;
                    break;
                default:
                    source = gc[1] & (1 << plane)
                        ? (gc[0] & (1 << plane) ? 0xff : 0x00)
                        : rotated;
                    break;
            }
            const combined = raster(source, this.latches[plane], operation);
            this.planes[plane][route.index] = byte(
                (combined & bitMask) | (this.latches[plane] & byte(~bitMask)),
            );
        }
        return true;
    }

    getState() {
        return {
            planes: this.planes.map((plane) => Array.from(plane)),
            latches: Array.from(this.latches),
        };
    }

    validateState(state) {
        if (!state || !Array.isArray(state.planes) || state.planes.length !== 4) {
            throw new TypeError('VGA memory state requires four planes');
        }
        for (let plane = 0; plane < 4; plane++) {
            requireByteArray(state.planes[plane], PLANE_SIZE, `planes[${plane}]`);
        }
        requireByteArray(state.latches, 4, 'latches');
    }

    setState(state) {
        this.validateState(state);
        for (let plane = 0; plane < 4; plane++) this.planes[plane].set(state.planes[plane]);
        this.latches.set(state.latches);
    }
}

export default VGAMemory;
