/**
 * Compile C to a loadable RV32 image, in-process, in Node and the browser.
 *
 * This is the C-compiler companion to `riscv-asm.js`: that assembles RV32
 * assembly, this compiles C. Both hand back the same `{entry, segments}` image
 * the `RiscV32Machine` boots — so a learner can start from C, not only
 * assembly, with no server and no native toolchain on the machine.
 *
 * HOW IT WORKS
 * ------------
 * The compiler is **shecc** (github.com/sysprog21/shecc, BSD-2-Clause) — a small
 * self-hosting C compiler whose RV32IM backend emits a Linux ELF32 directly, no
 * external assembler or linker. It is built to `wasm32-wasi`
 * (`scripts/build-riscv-cc-wasm.sh`; provenance in `wasm/riscv-cc.PROVENANCE.md`)
 * and shipped as `wasm/riscv-cc.wasm`. shecc's Linux syscall ABI (a7=64 write,
 * a7=93 exit) is exactly the one `RiscV32Machine` services, so its programs run
 * unchanged. The linked ELF is turned into `{entry, segments}` by the one
 * exec-ELF reader the engine has, `execElfToImage` in `scripts/riscv-elf.mjs`,
 * so the compiler and the loader can never disagree about where a program lands.
 *
 * `riscv-cc.wasm` imports only 12 WASI preview1 calls, all file/args/exit — so
 * rather than depend on `node:wasi` (which the browser lacks) this module
 * carries a tiny in-memory WASI shim covering exactly those 12. The whole thing
 * is dependency-free and behaves identically in Node and a bundler.
 */

import {execElfToImage} from '../scripts/riscv-elf.mjs';

const WASI_ESUCCESS = 0;
const WASI_EBADF = 8;
const WASI_ENOENT = 44;
const WASI_FILETYPE_DIRECTORY = 3;
const WASI_FILETYPE_REGULAR_FILE = 4;
const WASI_PREOPENTYPE_DIR = 0;

/** The single directory shecc's argv paths live under (one WASI preopen). */
const PREOPEN_FD = 3;
const PREOPEN_NAME = '/work';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * A minimal WASI preview1 host backed by an in-memory file table. Only the
 * calls `riscv-cc.wasm` actually imports are implemented; a missing one would
 * throw at link time — a build-drift signal, not a silent no-op.
 */
class MemWasi {
    constructor(args, files) {
        this.args = args;                       // string[]
        this.files = files;                     // Map<string, {data:Uint8Array, pos:number}>
        this.stdout = [];                       // Uint8Array chunks (fd 1)
        this.stderr = [];                       // Uint8Array chunks (fd 2)
        this.fds = new Map();                   // fd -> {path, entry}
        this.nextFd = 4;                        // 0-2 std, 3 preopen
        this.exitCode = null;
        this.mem = null;                        // the instance's exported memory
    }

    get view() { return new DataView(this.mem.buffer); }
    get u8() { return new Uint8Array(this.mem.buffer); }

    imports() {
        const w = this;
        const ok = WASI_ESUCCESS;
        return {
            args_sizes_get: (argcPtr, bufSizePtr) => {
                const v = w.view;
                v.setUint32(argcPtr, w.args.length, true);
                let bytes = 0;
                for (const a of w.args) bytes += enc.encode(a).length + 1;
                v.setUint32(bufSizePtr, bytes, true);
                return ok;
            },
            args_get: (argvPtr, bufPtr) => {
                const v = w.view, u = w.u8;
                let p = bufPtr;
                for (let i = 0; i < w.args.length; i++) {
                    v.setUint32(argvPtr + i * 4, p, true);
                    const b = enc.encode(w.args[i]);
                    u.set(b, p); p += b.length;
                    u[p++] = 0;
                }
                return ok;
            },
            fd_prestat_get: (fd, buf) => {
                if (fd !== PREOPEN_FD) return WASI_EBADF;   // ends the preopen scan
                const v = w.view;
                v.setUint8(buf, WASI_PREOPENTYPE_DIR);
                v.setUint32(buf + 4, enc.encode(PREOPEN_NAME).length, true);
                return ok;
            },
            fd_prestat_dir_name: (fd, ptr, len) => {
                if (fd !== PREOPEN_FD) return WASI_EBADF;
                w.u8.set(enc.encode(PREOPEN_NAME).subarray(0, len), ptr);
                return ok;
            },
            path_open: (dirfd, _dirflags, pathPtr, pathLen, oflags, _rb, _ri, _fdflags, fdPtr) => {
                const rel = dec.decode(w.u8.subarray(pathPtr, pathPtr + pathLen));
                const full = rel.startsWith('/') ? rel : PREOPEN_NAME + '/' + rel;
                const O_CREAT = 1 << 0;                     // wasi oflags bit 0
                let entry = w.files.get(full);
                if (!entry) {
                    if (!(oflags & O_CREAT)) return WASI_ENOENT;
                    entry = { data: new Uint8Array(0), pos: 0 };
                    w.files.set(full, entry);
                }
                entry.pos = 0;
                const fd = w.nextFd++;
                w.fds.set(fd, { path: full, entry });
                w.view.setUint32(fdPtr, fd, true);
                return ok;
            },
            fd_read: (fd, iovsPtr, iovsLen, nreadPtr) => {
                const h = w.fds.get(fd);
                if (!h) return WASI_EBADF;
                const v = w.view, u = w.u8;
                let total = 0;
                for (let i = 0; i < iovsLen; i++) {
                    const base = v.getUint32(iovsPtr + i * 8, true);
                    const len = v.getUint32(iovsPtr + i * 8 + 4, true);
                    const { data } = h.entry;
                    const n = Math.min(len, data.length - h.entry.pos);
                    if (n <= 0) break;
                    u.set(data.subarray(h.entry.pos, h.entry.pos + n), base);
                    h.entry.pos += n; total += n;
                }
                v.setUint32(nreadPtr, total, true);
                return ok;
            },
            fd_write: (fd, iovsPtr, iovsLen, nwrittenPtr) => {
                const v = w.view, u = w.u8;
                let total = 0;
                const chunks = [];
                for (let i = 0; i < iovsLen; i++) {
                    const base = v.getUint32(iovsPtr + i * 8, true);
                    const len = v.getUint32(iovsPtr + i * 8 + 4, true);
                    chunks.push(u.slice(base, base + len));
                    total += len;
                }
                if (fd === 1) { for (const c of chunks) w.stdout.push(c); }
                else if (fd === 2) { for (const c of chunks) w.stderr.push(c); }
                else {
                    const h = w.fds.get(fd);
                    if (!h) return WASI_EBADF;
                    for (const c of chunks) {
                        const end = h.entry.pos + c.length;
                        if (end > h.entry.data.length) {
                            const grown = new Uint8Array(end);
                            grown.set(h.entry.data);
                            h.entry.data = grown;
                        }
                        h.entry.data.set(c, h.entry.pos);
                        h.entry.pos = end;
                    }
                }
                v.setUint32(nwrittenPtr, total, true);
                return ok;
            },
            fd_seek: (fd, offset, whence, newPtr) => {
                const h = w.fds.get(fd);
                if (!h) return WASI_EBADF;
                // `offset` is an i64: at the JS/wasm boundary it arrives as a BigInt.
                const off = Number(offset);
                const len = h.entry.data.length;
                let pos = whence === 0 ? off : whence === 1 ? h.entry.pos + off : len + off;
                if (pos < 0) pos = 0;
                h.entry.pos = pos;
                w.view.setBigUint64(newPtr, BigInt(pos), true);
                return ok;
            },
            fd_fdstat_get: (fd, buf) => {
                const v = w.view;
                const isDir = fd === PREOPEN_FD;
                v.setUint8(buf, isDir ? WASI_FILETYPE_DIRECTORY : WASI_FILETYPE_REGULAR_FILE);
                v.setUint16(buf + 2, 0, true);                        // fs_flags
                v.setBigUint64(buf + 8, 0xffffffffffffffffn, true);   // rights_base
                v.setBigUint64(buf + 16, 0xffffffffffffffffn, true);  // rights_inheriting
                return ok;
            },
            fd_fdstat_set_flags: () => ok,
            fd_close: (fd) => { w.fds.delete(fd); return ok; },
            proc_exit: (code) => { w.exitCode = code; throw new WasiExit(code); },
        };
    }
}

class WasiExit extends Error { constructor(code) { super('wasi exit ' + code); this.code = code; } }

/** Thrown when compilation fails; `.reason` and `.log` say why. */
export class RiscvCcError extends Error {
    constructor(message, { reason, log } = {}) {
        super(message);
        this.name = 'RiscvCcError';
        this.reason = reason || 'compile';   // 'compile' (the program's) | 'internal'
        this.log = log || '';
    }
}

let cachedModule = null;

/** Locate and compile `riscv-cc.wasm` once (works in Node and a bundler). */
async function loadModule(wasmBytes) {
    if (cachedModule) return cachedModule;
    let bytes = wasmBytes;
    if (!bytes) {
        const url = new URL('../wasm/riscv-cc.wasm', import.meta.url);
        if (typeof fetch === 'function' && url.protocol !== 'file:') {
            bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        } else {
            const { readFile } = await import('node:fs/promises');
            bytes = await readFile(url);
        }
    }
    cachedModule = await WebAssembly.compile(bytes);
    return cachedModule;
}

/**
 * Compile C source to a loadable RV32 image.
 *
 * @param {string} source                   C source text.
 * @param {{wasmBytes?: Uint8Array}} [opts]  Override the wasm bytes (tests).
 * @returns {Promise<{ok:true, image:{entry:number, segments:{addr:number,bytes:Uint8Array}[]}, log:string}>}
 * @throws {RiscvCcError} `.reason` 'compile' — the program did not compile, and
 *   `.log` carries shecc's own diagnostics (line:col) — or 'internal'.
 */
export async function compileRiscvC(source, opts = {}) {
    if (typeof source !== 'string' || source.trim() === '')
        throw new RiscvCcError('no source to compile', { reason: 'compile' });

    const module = await loadModule(opts.wasmBytes);
    const files = new Map([['/work/in.c', { data: enc.encode(source), pos: 0 }]]);
    const wasi = new MemWasi(['shecc', '-o', '/work/out.elf', '/work/in.c'], files);
    const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasi.imports(),
    });
    wasi.mem = instance.exports.memory;

    let exitCode = 0;
    try {
        instance.exports._start();
    } catch (e) {
        if (e instanceof WasiExit) exitCode = e.code;
        else throw new RiscvCcError('compiler crashed: ' + e.message, { reason: 'internal' });
    }
    const log = (dec.decode(concat(wasi.stderr)) + dec.decode(concat(wasi.stdout))).trim();
    const out = files.get('/work/out.elf');
    if (exitCode !== 0 || !out || out.data.length === 0)
        throw new RiscvCcError('compilation failed', { reason: 'compile', log });

    let image;
    try {
        image = execElfToImage(out.data);
    } catch (e) {
        throw new RiscvCcError('compiler produced no loadable image: ' + e.message, { reason: 'internal', log });
    }
    return { ok: true, image, log };
}

function concat(chunks) {
    let n = 0; for (const c of chunks) n += c.length;
    const out = new Uint8Array(n); let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
}
