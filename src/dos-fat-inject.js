/**
 * dos-fat-inject.js — a browser-safe FAT12 file injector.
 *
 * Add one file (e.g. a code-tab-compiled .COM) to an ALREADY-BUILT bootable
 * MS-DOS FAT12 image, without rebuilding the image. This is the receipt-safe way
 * for the GUI to run a compiled program on real DOS: lite ships a prebuilt MIT
 * MS-DOS 2.0 boot disk as a static asset (built once by scripts/build-dos-image.mjs,
 * whose bytes are content-pinned by a frozen qualification receipt and MUST NOT
 * change), and this injector — a NEW file that touches none of that — drops the
 * program onto a copy at runtime. Then createI8086DosBench boots it and runs the
 * program from the A> prompt.
 *
 * Pure Uint8Array; no Node built-ins, so it runs in the browser bundle. Geometry
 * is read from the image's own BPB, so it is not tied to one disk size.
 *
 * MS-DOS 2.0 loads IO.SYS and MSDOS.SYS by POSITION (first two directory entries,
 * contiguous from cluster 2). This only ever appends a LATER directory entry in
 * LATER free clusters, so the boot run is untouched.
 *
 * @module
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);

/** BIOS Parameter Block fields from the boot sector. */
function bpb(image) {
    return {
        bytesPerSector: u16(image, 11),
        sectorsPerCluster: image[13],
        reservedSectors: u16(image, 14),
        fats: image[16],
        rootEntries: u16(image, 17),
        totalSectors: u16(image, 19) || u16(image, 32),   // small vs large count
        sectorsPerFat: u16(image, 22),
    };
}

/** Derived sector offsets and the usable cluster count. */
function layout(b) {
    const fatStart = b.reservedSectors;
    const rootStart = fatStart + b.fats * b.sectorsPerFat;
    const rootSectors = Math.ceil((b.rootEntries * 32) / b.bytesPerSector);
    const dataStart = rootStart + rootSectors;
    const clusterBytes = b.sectorsPerCluster * b.bytesPerSector;
    return {
        sec: b.bytesPerSector, fats: b.fats, spf: b.sectorsPerFat, rootEntries: b.rootEntries,
        fatStart, rootStart, dataStart, clusterBytes,
        totalClusters: Math.floor((b.totalSectors - dataStart) / b.sectorsPerCluster) + 2,
    };
}

// FAT12: 12-bit packed entries. Cluster n's nibble lives at byte offset n + n/2.
const fat12Get = (fat, n) => { const o = n + (n >> 1); const v = fat[o] | (fat[o + 1] << 8); return (n & 1) ? (v >> 4) : (v & 0xfff); };
const fat12Set = (fat, n, val) => {
    const o = n + (n >> 1);
    if (n & 1) { fat[o] = (fat[o] & 0x0f) | ((val << 4) & 0xf0); fat[o + 1] = (val >> 4) & 0xff; }
    else { fat[o] = val & 0xff; fat[o + 1] = (fat[o + 1] & 0xf0) | ((val >> 8) & 0x0f); }
};

/** A NAME.EXT string as an 11-byte, space-padded 8.3 field. */
export function name83(name) {
    const [b = '', e = ''] = name.toUpperCase().split('.');
    return (b.slice(0, 8).padEnd(8, ' ') + e.slice(0, 3).padEnd(3, ' ')).slice(0, 11);
}

/**
 * Return a COPY of `image` with `name` (8.3) holding `data` (Uint8Array). Throws
 * if there is no free directory slot or not enough free clusters.
 * @param {Uint8Array} image  a bootable FAT12 image
 * @param {string} name       8.3 filename, e.g. 'PROG.COM'
 * @param {Uint8Array} data   file contents
 * @returns {Uint8Array}
 */
export function injectFile(image, name, data) {
    const out = image.slice();
    const lay = layout(bpb(out));
    const fat = out.subarray(lay.fatStart * lay.sec, (lay.fatStart + lay.spf) * lay.sec);

    const clustersNeeded = Math.max(1, Math.ceil(data.length / lay.clusterBytes));
    const free = [];
    for (let c = 2; c < lay.totalClusters && free.length < clustersNeeded; c++) if (fat12Get(fat, c) === 0) free.push(c);
    if (free.length < clustersNeeded) throw new Error(`dos-fat-inject: not enough free clusters for ${name} (${clustersNeeded} needed, ${free.length} free)`);

    const rootBase = lay.rootStart * lay.sec;
    let dirAt = -1;
    for (let i = 0; i < lay.rootEntries; i++) { const at = rootBase + i * 32; if (out[at] === 0x00 || out[at] === 0xe5) { dirAt = at; break; } }
    if (dirAt < 0) throw new Error('dos-fat-inject: root directory is full');

    const dataBase = lay.dataStart * lay.sec;
    for (let k = 0; k < free.length; k++) {
        out.set(data.subarray(k * lay.clusterBytes, (k + 1) * lay.clusterBytes), dataBase + (free[k] - 2) * lay.clusterBytes);
        fat12Set(fat, free[k], k === free.length - 1 ? 0xfff : free[k + 1]);
    }
    for (let f = 1; f < lay.fats; f++) out.set(fat, (lay.fatStart + f * lay.spf) * lay.sec);   // mirror FAT copies

    const nm = name83(name);
    for (let i = 0; i < 11; i++) out[dirAt + i] = nm.charCodeAt(i);
    out[dirAt + 11] = 0x20;                                             // attribute: archive
    out[dirAt + 26] = free[0] & 0xff; out[dirAt + 27] = (free[0] >> 8) & 0xff;   // first cluster
    const sz = data.length >>> 0;
    out[dirAt + 28] = sz & 0xff; out[dirAt + 29] = (sz >> 8) & 0xff; out[dirAt + 30] = (sz >> 16) & 0xff; out[dirAt + 31] = (sz >> 24) & 0xff;
    return out;
}

/** Read a file's bytes back out of a FAT12 image by name (the injector's inverse; for tests/tools). */
export function readFile(image, name) {
    const lay = layout(bpb(image));
    const fat = image.subarray(lay.fatStart * lay.sec, (lay.fatStart + lay.spf) * lay.sec);
    const want = name83(name);
    const rootBase = lay.rootStart * lay.sec;
    for (let i = 0; i < lay.rootEntries; i++) {
        const at = rootBase + i * 32;
        if (image[at] === 0x00) break;
        let matches = true;
        for (let j = 0; j < 11; j++) if (image[at + j] !== want.charCodeAt(j)) { matches = false; break; }
        if (!matches) continue;
        let size = image[at + 28] | (image[at + 29] << 8) | (image[at + 30] << 16) | (image[at + 31] << 24);
        let cluster = image[at + 26] | (image[at + 27] << 8);
        const dataBase = lay.dataStart * lay.sec;
        const bytes = new Uint8Array(size);
        let pos = 0;
        while (size > 0 && cluster >= 2 && cluster < 0xff8) {
            const take = Math.min(size, lay.clusterBytes);
            bytes.set(image.subarray(dataBase + (cluster - 2) * lay.clusterBytes, dataBase + (cluster - 2) * lay.clusterBytes + take), pos);
            pos += take; size -= take; cluster = fat12Get(fat, cluster);
        }
        return bytes;
    }
    return null;
}
