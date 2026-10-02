// Separate build-path pilot on unmodified main, not the register-inlining candidate.
// Generates a NEW artifact tree and explicit transformation provenance.
import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {brotliCompressSync, constants} from 'node:zlib';
import assert from 'node:assert/strict';
const source = resolve(process.argv[2]), out = resolve(process.argv[3]);
if (existsSync(out)) throw Error('Refusing to overwrite an artifact tree');
const tool = '/tmp/labwired-binaryen-native.D72usw/binaryen-version_123/bin/wasm-opt';
const version = spawnSync(tool,['--version'],{encoding:'utf8'});
assert.equal(version.status,0);
assert.equal(createHash("sha256").update(readFileSync(tool)).digest("hex"),
    "d66c6724c07334155720eb2def29c434dcaaf741ce859b4f7f389e22674f9c4a");
assert.equal(version.stdout.trim(),'wasm-opt version 123 (version_123)');
const flags = ['-O3','--strip-debug','--strip-producers','--enable-bulk-memory',
    '--enable-simd','--enable-nontrapping-float-to-int','--enable-sign-ext',
    '--enable-reference-types','--enable-multivalue'];
const hash = data => createHash('sha256').update(data).digest('hex');
const originalBytes = readFileSync(join(source,'BUILD-INFO.json'));
const original = JSON.parse(originalBytes);
assert.equal(original.ref,'43b2d62f5a0fa24ae0b38a645069f5aaa78af685');
// Validate every original before generating anything, preserving the original tree.
for (const target of ['nodejs','web']) {
    for (const file of ['labwired_wasm.js','labwired_wasm_bg.wasm']) {
        const bytes = readFileSync(join(source,target,file)), declared = original.targets[target][file];
        assert.equal(hash(bytes),declared.sha256);
        assert.equal(bytes.length,declared.bytes);
    }
}
assert(readFileSync(join(source,"nodejs/labwired_wasm_bg.wasm")).equals(
    readFileSync(join(source,"web/labwired_wasm_bg.wasm"))), "Inputs differ: optimize each independently");
mkdirSync(out,{recursive:true});
writeFileSync(join(out,'SOURCE-BUILD-INFO.json'),originalBytes);
const info = structuredClone(original);
info.postprocess = {schema:'labwired.binaryen-pilot.v1',diagnosticOnly:true,
    processedAt:new Date().toISOString(),optimizer:'binaryen',version:'123.0.0',
    versionOutput:version.stdout.trim(),flags,
    sourceBuildInfoSha256:hash(originalBytes),toolSha256:hash(readFileSync(tool)),
    releaseArchiveSha256: "e959f2170af4c20c552e9de3a0253704d6a9d2766e8fdb88e4d6ac4bae9388fe",
    releaseUrl: "https://github.com/WebAssembly/binaryen/releases/download/version_123/binaryen-version_123-x86_64-linux.tar.gz",
    sourceTargets:original.targets,publication:false,appPinChanges:false};
for (const target of ['nodejs','web']) {
    mkdirSync(join(out,target));
    for (const file of readdirSync(join(source,target)).filter(f=>f!=='labwired_wasm_bg.wasm')) {
        writeFileSync(join(out,target,file),readFileSync(join(source,target,file)));
    }
    if (target === "web") {
        writeFileSync(join(out,target,"labwired_wasm_bg.wasm"),readFileSync(join(out,"nodejs/labwired_wasm_bg.wasm")));
    } else {
    const result = spawnSync(tool,[join(source,target,'labwired_wasm_bg.wasm'),...flags,
        '-o',join(out,target,'labwired_wasm_bg.wasm')],{encoding:'utf8',timeout:600000,maxBuffer:4*1024*1024});
    writeFileSync(join(out,target+'-optimizer-stdout.txt'),result.stdout || '');
    writeFileSync(join(out,target+'-optimizer-stderr.txt'),result.stderr || '');
    if(result.status!==0) throw Error('Optimizer failed; inspect preserved diagnostics');
    }
    const before = new WebAssembly.Module(readFileSync(join(source,target,"labwired_wasm_bg.wasm")));
    const after = new WebAssembly.Module(readFileSync(join(out,target,"labwired_wasm_bg.wasm")));
    const sorted = rows => rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(sorted(WebAssembly.Module.imports(after)), sorted(WebAssembly.Module.imports(before)));
    assert.deepEqual(sorted(WebAssembly.Module.exports(after)), sorted(WebAssembly.Module.exports(before)));
    for (const file of ['labwired_wasm.js','labwired_wasm_bg.wasm']) {
        const bytes=readFileSync(join(out,target,file));
        info.targets[target][file]={bytes:bytes.length,
            brotliBytes:brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length,
            sha256:hash(bytes)};
        if(file.endsWith('.js'))assert.equal(hash(bytes),original.targets[target][file].sha256);
    }
}
assert.equal(info.targets.nodejs['labwired_wasm_bg.wasm'].sha256,
    info.targets.web['labwired_wasm_bg.wasm'].sha256);
writeFileSync(join(out,'BUILD-INFO.json'),JSON.stringify(info,null,2)+'\n');
console.log(JSON.stringify(info));
