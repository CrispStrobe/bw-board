// Synthetic minimal WASM fixtures test guards only, never measured engine evidence.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BINARYEN, FLAGS, MODES, modeFlags, sha256, verifySource, optimizerIdentity, verifyInterfaces, postprocess} from '../scripts/postprocess-labwired-wasm.mjs';
const ref = 'a'.repeat(40);
const minimal = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
function fixture (callback) {
    const root = mkdtempSync(join(tmpdir(), 'bw-postprocess-guard-'));
    const source = join(root, 'source'); mkdirSync(source);
    const info = {ref, targets: {}};
    for (const target of ['nodejs', 'web']) {
        mkdirSync(join(source, target));
        info.targets[target] = {};
        for (const [file, bytes] of [['labwired_wasm.js', Buffer.from('exports.fixture = 1;\n')], ['labwired_wasm_bg.wasm', minimal]]) {
            writeFileSync(join(source, target, file), bytes);
            info.targets[target][file] = {bytes: bytes.length, sha256: sha256(bytes)};
        }
    }
    const saveInfo = () => {
        const bytes = Buffer.from(JSON.stringify(info));
        writeFileSync(join(source, 'BUILD-INFO.json'), bytes);
        return sha256(bytes);
    };
    const infoHash = saveInfo();
    try { callback({root, source, info, infoHash, saveInfo}); }
    finally { rmSync(root, {recursive: true, force: true}); } // Only our mkdtemp fixture.
}
test('valid original fixture is source/hash-bound and read-only', () => fixture(({source, infoHash}) => {
    const before = readFileSync(join(source, 'BUILD-INFO.json'));
    assert.equal(verifySource(source, ref, sha256(minimal), infoHash).info.ref, ref);
    assert(readFileSync(join(source, 'BUILD-INFO.json')).equals(before));
}));
test('wrong source, module, metadata and malformed identities fail closed', () => fixture(({source, infoHash}) => {
    for (const args of [[source, 'b'.repeat(40), sha256(minimal), infoHash],
        [source, ref, 'b'.repeat(64), infoHash], [source, ref, sha256(minimal), 'b'.repeat(64)],
        [source, 'main', sha256(minimal), infoHash], [source, ref, 'bad', infoHash]]) assert.throws(() => verifySource(...args));
}));
test('tampered executable bytes and incomplete target metadata fail', () => fixture(({source, infoHash, info, saveInfo}) => {
    writeFileSync(join(source, 'nodejs/labwired_wasm.js'), 'tampered');
    assert.throws(() => verifySource(source, ref, sha256(minimal), infoHash));
    delete info.targets.web;
    assert.throws(() => verifySource(source, ref, sha256(minimal), saveInfo()));
}));
test('stacked transformation and unverified extra executable are refused', () => fixture(({source, info, infoHash, saveInfo}) => {
    info.postprocess = {};
    assert.throws(() => verifySource(source, ref, sha256(minimal), saveInfo()));
    delete info.postprocess; const restored = saveInfo();
    assert.equal(restored, infoHash);
    writeFileSync(join(source, 'web/extra.js'), 'extra');
    assert.throws(() => verifySource(source, ref, sha256(minimal), restored));
}));
test('symlink artifact indirection is refused', () => fixture(({root, source, infoHash}) => {
    const file = join(source, 'nodejs/labwired_wasm.js');
    const backup = join(root, 'glue'); writeFileSync(backup, readFileSync(file));
    rmSync(file); symlinkSync(backup, file);
    assert.throws(() => verifySource(source, ref, sha256(minimal), infoHash));
}));
test('optimizer bytes are verified before running even the version command', () => fixture(({root}) => {
    const tool = join(root, 'untrusted-tool'); writeFileSync(tool, 'not pinned');
    let executed = false;
    assert.throws(() => optimizerIdentity(tool, () => { executed = true; }), /Unpinned/);
    assert.equal(executed, false);
}));
test('existing output and source-nested output are rejected before optimizer execution', () => fixture(({root, source, infoHash}) => {
    const options = {source, optimizer: join(root, 'absent'), expectedRef: ref,
        expectedWasmSha256: sha256(minimal), expectedInfoSha256: infoHash};
    assert.throws(() => postprocess({...options, out: source}), /overwrite/);
    assert.throws(() => postprocess({...options, out: join(source, 'nested')}), /inside source/);
}));
test('module descriptors and binary validation are guarded, not claimed as semantic proof', () => {
    assert.doesNotThrow(() => verifyInterfaces(minimal, minimal));
    assert.throws(() => verifyInterfaces(minimal, Buffer.from('bad')));
    // Valid exported memory changes the ABI descriptors.
    const memory = Buffer.from([...minimal, 5, 3, 1, 0, 1, 7, 5, 1, 1, 109, 2, 0]);
    assert.throws(() => verifyInterfaces(minimal, memory), /Exports changed/);
});
test('optimizer mode is pinned and excludes unsafe semantic relaxations', () => {
    assert.equal(FLAGS[0], '-O3');
    assert(!FLAGS.includes('--fast-math') && !FLAGS.includes('--ignore-implicit-traps'));
    assert.match(BINARYEN.toolSha256, /^[a-f0-9]{64}$/);
    assert.match(BINARYEN.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(BINARYEN.url, /WebAssembly\/binaryen\/releases\/download\/version_123/);
});
test('targeted modes are closed, ordered, immutable and never relax semantics', () => {
    assert.equal(modeFlags('o3'), FLAGS);
    assert.deepEqual(modeFlags('instructions').slice(0, 3), ['--optimize-instructions', '--dce', '--vacuum']);
    assert.deepEqual(modeFlags('locals').slice(0, 5), ['--simplify-locals', '--coalesce-locals', '--optimize-instructions', '--dce', '--vacuum']);
    assert(Object.isFrozen(MODES));
    for (const flags of Object.values(MODES)) {
        assert(Object.isFrozen(flags));
        assert(!flags.includes('--fast-math') && !flags.includes('--ignore-implicit-traps'));
        assert.deepEqual(flags.slice(-FLAGS.length + 1), FLAGS.slice(1));
    }
    for (const mode of ['__proto__', 'constructor', '--fast-math', 'Oz', '', null]) {
        assert.throws(() => modeFlags(mode), /Unknown optimizer mode/);
        assert.throws(() => postprocess({mode}), /Unknown optimizer mode/);
    }
});
test('hosted experiment is manual, independently reproduced, strictly tested and cannot publish', () => {
    const workflow = readFileSync(new URL('../.github/workflows/labwired-wasm-postopt.yml', import.meta.url), 'utf8');
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /leg: \[a, b\]/);
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /actions: read/);
    assert.doesNotMatch(workflow, /contents: write|gh release|publish:\s*\n|continue-on-error/);
    assert.match(workflow, /cmp "a\/\$target\/\$file" "b\/\$target\/\$file"/);
    assert.match(workflow, /source-info-sha256 "\$SOURCE_INFO_SHA"/);
    assert.match(workflow, /"\$\{tests:-0\}" -ge 101/);
    assert.match(workflow, /LABWIRED_REQUIRE_MOTION_RTX: '1'/);
    assert.match(workflow, /node-version: '22\.23\.3'/);
});
