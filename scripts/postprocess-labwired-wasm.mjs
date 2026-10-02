#!/usr/bin/env node
/** Opt-in experiment only. Never overwrite source bytes, publish, or change pins. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync, realpathSync} from 'node:fs';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {brotliCompressSync, constants} from 'node:zlib';

export const BINARYEN = Object.freeze({
    version: '123', versionOutput: 'wasm-opt version 123 (version_123)',
    url: 'https://github.com/WebAssembly/binaryen/releases/download/version_123/binaryen-version_123-x86_64-linux.tar.gz',
    archiveSha256: 'e959f2170af4c20c552e9de3a0253704d6a9d2766e8fdb88e4d6ac4bae9388fe',
    toolSha256: 'd66c6724c07334155720eb2def29c434dcaaf741ce859b4f7f389e22674f9c4a'
});
export const FLAGS = Object.freeze(['-O3', '--strip-debug', '--strip-producers',
    '--enable-bulk-memory', '--enable-simd', '--enable-nontrapping-float-to-int',
    '--enable-sign-ext', '--enable-reference-types', '--enable-multivalue']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => {
    const suffix = relative(parent, child);
    return suffix === '' || (suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix));
};
const regular = file => {
    assert(lstatSync(file).isFile(), `Not a regular non-symlink file: ${file}`);
    return readFileSync(file);
};

export function verifySource (directory, expectedRef, expectedWasmSha256, expectedInfoSha256) {
    assert.match(expectedRef, /^[a-f0-9]{40}$/, 'Explicit source commit required');
    assert.match(expectedWasmSha256, /^[a-f0-9]{64}$/, 'Explicit input module hash required');
    assert.match(expectedInfoSha256, /^[a-f0-9]{64}$/, 'Explicit source metadata hash required');
    const source = realpathSync(directory);
    const metadata = regular(join(source, 'BUILD-INFO.json'));
    assert.equal(sha256(metadata), expectedInfoSha256, 'Source metadata mismatch');
    const info = JSON.parse(metadata);
    assert.equal(info.ref, expectedRef, 'Source commit mismatch');
    assert.equal(info.postprocess, undefined, 'Do not silently stack transformations');
    for (const target of ['nodejs', 'web']) {
        const targetDir = join(source, target);
        assert(lstatSync(targetDir).isDirectory() && !lstatSync(targetDir).isSymbolicLink());
        for (const file of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
            const bytes = regular(join(targetDir, file)), declared = info.targets?.[target]?.[file];
            assert(declared && Number.isSafeInteger(declared.bytes) && declared.bytes > 0, 'Missing artifact declaration');
            assert.match(declared.sha256, /^[a-f0-9]{64}$/);
            assert.equal(bytes.length, declared.bytes, `${target}/${file} byte mismatch`);
            assert.equal(sha256(bytes), declared.sha256, `${target}/${file} hash mismatch`);
        }
        assert.equal(info.targets[target]['labwired_wasm_bg.wasm'].sha256, expectedWasmSha256);
        for (const file of readdirSync(targetDir)) assert(lstatSync(join(targetDir, file)).isFile(), 'Only flat regular artifacts supported');
        const described = Object.keys(info.targets[target]).sort();
        const actual = readdirSync(targetDir).filter(f => /\.(js|wasm)$/.test(f)).sort();
        assert.deepEqual(actual, described, 'Unverified executable file in source artifact');
    }
    const moduleBytes = regular(join(source, 'nodejs/labwired_wasm_bg.wasm'));
    assert(moduleBytes.equals(regular(join(source, 'web/labwired_wasm_bg.wasm'))), 'Target inputs differ');
    new WebAssembly.Module(moduleBytes); // Compile/validate only, no instantiation.
    return {source, metadata, info, moduleBytes};
}

export function optimizerIdentity (tool, run = spawnSync) {
    // Hash BEFORE execution: a plausible --version is not trusted provenance.
    assert.equal(sha256(regular(tool)), BINARYEN.toolSha256, 'Unpinned optimizer binary');
    const result = run(tool, ['--version'], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, 'Optimizer version command failed');
    assert.equal(result.stdout.trim(), BINARYEN.versionOutput, 'Optimizer version mismatch');
    return result.stdout.trim();
}

export function verifyInterfaces (beforeBytes, afterBytes) {
    const before = new WebAssembly.Module(beforeBytes), after = new WebAssembly.Module(afterBytes);
    const sorted = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(sorted(WebAssembly.Module.imports(after)), sorted(WebAssembly.Module.imports(before)), 'Imports changed');
    assert.deepEqual(sorted(WebAssembly.Module.exports(after)), sorted(WebAssembly.Module.exports(before)), 'Exports changed');
    // Descriptor equality is an ABI guard, NOT proof of instruction semantics.
}

export function postprocess ({source, out, optimizer, expectedRef, expectedWasmSha256, expectedInfoSha256}) {
    assert(!process.env.NODE_OPTIONS, 'Unset injected Node options');
    out = resolve(out);
    assert(!existsSync(out), 'Refusing to overwrite any output tree');
    const verified = verifySource(source, expectedRef, expectedWasmSha256, expectedInfoSha256);
    const parent = realpathSync(resolve(out, '..'));
    assert(!inside(verified.source, parent), 'Output must not be inside source tree');
    const versionOutput = optimizerIdentity(resolve(optimizer));
    mkdirSync(out); // Parent must already exist, never recursively create into source.
    writeFileSync(join(out, 'SOURCE-BUILD-INFO.json'), verified.metadata, {flag: 'wx'});
    for (const target of ['nodejs', 'web']) {
        mkdirSync(join(out, target));
        for (const file of readdirSync(join(verified.source, target))) {
            if (file !== 'labwired_wasm_bg.wasm') writeFileSync(join(out, target, file), regular(join(verified.source, target, file)), {flag: 'wx'});
        }
    }
    const result = spawnSync(resolve(optimizer), [join(verified.source, 'nodejs/labwired_wasm_bg.wasm'), ...FLAGS,
        '-o', join(out, 'nodejs/labwired_wasm_bg.wasm')], {encoding: 'utf8', timeout: 600000, maxBuffer: 4000000});
    writeFileSync(join(out, 'optimizer-stdout.txt'), result.stdout || '', {flag: 'wx'});
    writeFileSync(join(out, 'optimizer-stderr.txt'), result.stderr || '', {flag: 'wx'});
    assert.equal(result.status, 0, 'Optimizer failed; partial tree is unqualified');
    const optimized = regular(join(out, 'nodejs/labwired_wasm_bg.wasm'));
    assert.notEqual(sha256(optimized), expectedWasmSha256, 'No module transformation occurred');
    verifyInterfaces(verified.moduleBytes, optimized);
    writeFileSync(join(out, 'web/labwired_wasm_bg.wasm'), optimized, {flag: 'wx'});
    const info = structuredClone(verified.info);
    const moduleMetadata = {bytes: optimized.length,
        brotliBytes: brotliCompressSync(optimized, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}).length,
        sha256: sha256(optimized)};
    for (const target of ['nodejs', 'web']) {
        info.targets[target]['labwired_wasm_bg.wasm'] = {...moduleMetadata};
        assert.equal(sha256(regular(join(out, target, 'labwired_wasm.js'))), verified.info.targets[target]['labwired_wasm.js'].sha256);
    }
    // builtAt/rawBytes describe the original Rust/bindgen build, not new compilation.
    info.postprocess = {schema: 'labwired.binaryen-pilot.v1', diagnosticOnly: true,
        processedAt: new Date().toISOString(), optimizer: 'binaryen', version: '123.0.0', versionOutput,
        flags: [...FLAGS], toolSha256: BINARYEN.toolSha256, releaseArchiveSha256: BINARYEN.archiveSha256,
        releaseUrl: BINARYEN.url, sourceBuildInfoSha256: sha256(verified.metadata),
        sourceTargets: verified.info.targets, reusedIdenticalTargetModule: true,
        publication: false, appPinChanges: false};
    // Last file is the completion marker. Failures never get a completed BUILD-INFO.
    writeFileSync(join(out, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n', {flag: 'wx'});
    return info;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2), keys = ['source', 'out', 'optimizer', 'source-ref', 'source-wasm-sha256', 'source-info-sha256'];
    assert.equal(args.length, keys.length * 2, 'Exactly six explicit options required');
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        assert(keys.includes(args[i].slice(2)) && args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown/missing option');
        assert(!Object.hasOwn(options, args[i]), 'Duplicate option');
        options[args[i]] = args[i + 1];
    }
    const info = postprocess({source: options['--source'], out: options['--out'], optimizer: options['--optimizer'],
        expectedRef: options['--source-ref'], expectedWasmSha256: options['--source-wasm-sha256'], expectedInfoSha256: options['--source-info-sha256']});
    console.log(JSON.stringify(info, null, 2));
}
