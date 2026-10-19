// Original-artifact metadata inspection only; never executes or alters WASM.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {wasmFunctionNames} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/wasm-motion-profile.mjs';

export function functionBodies(bytes) {
    // Also validates the header and section/name lengths before parsing code.
    const names = wasmFunctionNames(bytes);
    let p = 8, end = bytes.length, imports = 0, declared = null, rows = null;
    const byte = () => { if (p >= end) throw Error('Truncated section'); return bytes[p++]; };
    const u32 = () => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const b = byte();
            if (i === 4 && b > 15) throw Error('Invalid u32');
            value += (b & 127) * 2 ** (i * 7);
            if (!(b & 128)) return value;
        }
        throw Error('Invalid u32');
    };
    const skip = n => { if (p + n > end) throw Error('Truncated payload'); p += n; };
    while (p < bytes.length) {
        end = bytes.length;
        const id = byte(), size = u32(); end = p + size;
        if (end > bytes.length) throw Error('Truncated section');
        if (id === 2) {
            const count = u32();
            for (let i = 0; i < count; i++) {
                skip(u32()); skip(u32());
                // These original wasm-bindgen artifacts import functions only.
                // Fail closed instead of guessing offsets for other kinds.
                if (byte() !== 0) throw Error('Unsupported non-function import');
                u32(); imports++;
            }
            if (p !== end) throw Error('Trailing imports');
        } else if (id === 3) {
            if (declared !== null) throw Error('Duplicate function section');
            declared = u32();
            for (let i = 0; i < declared; i++) u32();
            if (p !== end) throw Error('Trailing function declarations');
        } else if (id === 10) {
            if (rows !== null) throw Error('Duplicate code section');
            const count = u32();
            if (count !== declared) throw Error('Code/declaration count mismatch');
            rows = [];
            for (let i = 0; i < count; i++) {
                const bodyBytes = u32(), offset = p, index = imports + i;
                if (!bodyBytes) throw Error('Empty function body');
                skip(bodyBytes);
                rows.push({index, offset, bodyBytes, name: names.get(index) || null});
            }
            if (p !== end) throw Error('Trailing code');
        }
        p = end;
    }
    if (!rows) throw Error('Missing code section');
    return rows;
}
if (process.argv.includes('--self-test')) {
    const minimal = Uint8Array.from([0,97,115,109,1,0,0,0,
        1,4,1,0x60,0,0, 3,2,1,0, 10,4,1,2,0,0x0b]);
    assert.deepEqual(functionBodies(minimal), [{index: 0,offset: 22,bodyBytes: 2,name: null}]);
    for (const bad of [minimal.slice(0,-1), minimal.slice(0,8),
        Uint8Array.from([...minimal.slice(0,21), 0, 0, 0x0b])]) {
        assert.throws(() => functionBodies(bad));
    }
    console.log('Body metadata parser self-tests passed; not engine evidence.');
} else {
    const root = resolve(process.argv[2] || '.');
    const out = join(root, 'code-size-inspection.json');
    if (existsSync(out)) throw Error('Refusing to overwrite inspection');
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const sources = {baseline: '43b2d62f5a0fa24ae0b38a645069f5aaa78af685',
        candidate: '53b2be10799570c607b444fa174e2eb37ea74095'};
    const artifacts = Object.fromEntries(Object.entries(sources).map(([label, source]) => {
        const info = JSON.parse(readFileSync(join(root,label,'BUILD-INFO.json')));
        const bytes = readFileSync(join(root,label,'nodejs/labwired_wasm_bg.wasm'));
        const glue = readFileSync(join(root,label,'nodejs/labwired_wasm.js'));
        assert.equal(info.ref, source);
        for (const [name,data] of [['labwired_wasm_bg.wasm',bytes],['labwired_wasm.js',glue]]) {
            assert.equal(hash(data), info.targets.nodejs[name].sha256);
            assert.equal(data.length, info.targets.nodejs[name].bytes);
        }
        const bodies = functionBodies(bytes);
        return [label,{source, wasmSha256:hash(bytes), wasmBytes:bytes.length,
            glueSha256:hash(glue), definedFunctions:bodies.length,
            cortexM:bodies.filter(r=>r.name && /cortex_m.*(?:step_batch|run_t16_fast_block|run_t16_cached_run|read_reg::|write_reg::)/.test(r.name))}];
    }));
    writeFileSync(out,JSON.stringify({diagnosticOnly:true, artifacts,
        limitations:['body byte sizes are not timing or removable cost',
            'no WASM execution or artifact mutation; no publication or pin changes']},null,2)+'\n');
    console.log(JSON.stringify(artifacts));
}
