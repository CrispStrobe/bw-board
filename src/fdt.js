/**
 * A minimal flattened-device-tree (DTB, version 17) writer — enough to describe
 * a machine to a Linux kernel without dtc. A node is
 *   {name, props: {key: value}, children: [node]}
 * and a property value is one of:
 *   - a string                → NUL-terminated string
 *   - an array of strings     → string list (e.g. compatible)
 *   - a number or number[]    → big-endian u32 cells
 *   - {u64: number}           → one big-endian u64
 *   - Uint8Array              → raw bytes
 *   - true                    → empty (boolean) property
 * `phandle` values are ordinary u32 cells: give a node `phandle: N` and refer
 * to it by N.
 *
 * @module
 */

const FDT_MAGIC = 0xd00dfeed, BEGIN_NODE = 1, END_NODE = 2, PROP = 3, END = 9;

/** @returns {Uint8Array} the DTB */
export function buildFdt(root, {bootCpuId = 0, reserve = []} = {}) {
    const strings = [], strOff = new Map();
    const strIndex = s => {
        if (!strOff.has(s)) { strOff.set(s, strings.reduce((n, x) => n + x.length + 1, 0)); strings.push(s); }
        return strOff.get(s);
    };
    const words = [];
    const bytes = [];                       // struct block as bytes
    const u32 = v => { bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); };
    const pad4 = () => { while (bytes.length & 3) bytes.push(0); };
    const encode = v => {
        if (v === true) return [];
        if (typeof v === 'string') return [...new TextEncoder().encode(v), 0];
        if (Array.isArray(v) && typeof v[0] === 'string') return v.flatMap(s => [...new TextEncoder().encode(s), 0]);
        if (v instanceof Uint8Array) return [...v];
        if (v && typeof v === 'object' && 'u64' in v) {
            const hi = Math.floor(v.u64 / 0x100000000), lo = v.u64 >>> 0;
            return [hi >>> 24, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, lo >>> 24, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255];
        }
        const cells = Array.isArray(v) ? v : [v];
        return cells.flatMap(c => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]);
    };
    const walk = node => {
        u32(BEGIN_NODE);
        bytes.push(...new TextEncoder().encode(node.name), 0);
        pad4();
        for (const [k, v] of Object.entries(node.props || {})) {
            if (v === undefined || v === false) continue;
            const data = encode(v);
            u32(PROP); u32(data.length); u32(strIndex(k));
            bytes.push(...data);
            pad4();
        }
        for (const c of node.children || []) walk(c);
        u32(END_NODE);
    };
    walk(root);
    u32(END);
    void words;
    const strBytes = new TextEncoder().encode(strings.map(s => s + '\0').join(''));

    const HEADER = 40;
    const rsvOff = HEADER, rsvSize = (reserve.length + 1) * 16;
    const structOff = rsvOff + rsvSize, structSize = bytes.length;
    const strOffset = structOff + structSize, total = strOffset + strBytes.length;
    const out = new Uint8Array((total + 3) & ~3);
    const dv = new DataView(out.buffer);
    const hdr = [FDT_MAGIC, out.length, structOff, strOffset, rsvOff, 17, 16, bootCpuId, strBytes.length, structSize];
    hdr.forEach((v, i) => dv.setUint32(i * 4, v >>> 0));
    reserve.forEach(([addr, size], i) => {
        dv.setUint32(rsvOff + i * 16, Math.floor(addr / 0x100000000)); dv.setUint32(rsvOff + i * 16 + 4, addr >>> 0);
        dv.setUint32(rsvOff + i * 16 + 8, Math.floor(size / 0x100000000)); dv.setUint32(rsvOff + i * 16 + 12, size >>> 0);
    });
    out.set(bytes, structOff);
    out.set(strBytes, strOffset);
    return out;
}

export default buildFdt;
