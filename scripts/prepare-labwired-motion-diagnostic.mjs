#!/usr/bin/env node
/** Exact retained-engine diagnostic admission; not qualification or acquisition. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const MOTION_SOURCE = Object.freeze({
    repository: 'CrispStrobe/bw-board', run: 43191264877, artifact: 13932494417,
    producer: '0f78a4a873f3126c24717903ab09de1a34031c2c',
    core: 'fa992f357df88dbd50057a31f13dbcc0835a95cd',
    archive: 'sha256:eb032f56f4c3bc5ffcf7105767f342994c2a15c60d1a7488d4e273928fe72429',
    release: Object.freeze({id: 439136423, tag: 'labwired-wasm-fa992f35', assets: Object.freeze({
        'nodejs-labwired_wasm.js': 727497991, 'nodejs-labwired_wasm_bg.wasm': 727497995,
        'CORE-LICENSE.txt': 727497993, 'PRODUCER-LICENSE.txt': 727497992
    })}),
    guestImageSha256: 'd0088c4b4f5be1d96e75c15c347c47d129369b5b1e49ce7c69388dd21b122cca',
    gcc: 'arm-none-eabi-gcc (15:13.2.rel1-2) 13.2.1 20231009',
    linker: 'GNU ld (2.42-1ubuntu1+23) 2.42',
    node: 'v22.23.4', guest: '07ad8163f00532215836844184e0b50c0ceba7abb5bd607be005fcb6beb60fde',
    notices: Object.freeze({"CORE-LICENSE.txt": {"bytes": 1072, "sha256": "cee2a5445168030357d6f8d3b51e7e3dd244dfa052687b9dbe558f30a864454b"}, "PRODUCER-LICENSE.txt": {"bytes": 1068, "sha256": "e53c4e17a0971ca6cac5010a19876b77a896e3ce172b1f61d934dfd14c595d6d"}}),
    files: Object.freeze({
        'labwired_wasm.js': {bytes: 157556, sha256: 'c5bc1317e84b672987a64db7ad96f75589e86ab8106df9ad2ef5676b59ba1c7a'},
        'labwired_wasm_bg.wasm': {bytes: 19614873, sha256: '0071c27197830e6d1fab2be32297c69ab450405cf893036f29977796aaa5648e'}
    })
});
const hex40 = value => /^[a-f0-9]{40}$/.test(value);
const digest = value => /^sha256:[a-f0-9]{64}$/.test(value);
const id = value => Number.isSafeInteger(value) && value > 0;
const one = (rows, predicate, label) => {
    assert.ok(Array.isArray(rows), `${label}: missing rows`);
    const found = rows.filter(predicate);
    assert.equal(found.length, 1, `${label}: require one exact match`);
    return found[0];
};
function runBinding (run, expectedId, expectedHead) {
    assert.equal(run.id, expectedId, 'run identity');
    assert.equal(run.repository?.full_name, MOTION_SOURCE.repository, 'repository');
    assert.equal(run.head_repository?.full_name, MOTION_SOURCE.repository, 'head repository');
    assert.equal(run.head_sha, expectedHead, 'source head');
    assert.equal(run.status, 'completed', 'terminal run');
    assert.equal(run.run_attempt, 1, 'first attempt only');
    assert.equal(run.event, 'workflow_dispatch', 'manual diagnostic provenance');
}

/** Metadata only. No archive reader/network API is called by this function. */
export function admitMotionTransfer ({originalRun, originalJobs, originalArtifacts,
    transferRun, transferArtifacts, release, request}) {
    assert.equal(request.custodyAcknowledged, true, 'custody transfer not acknowledged');
    assert.ok(id(request.transferRun) && id(request.transferArtifact), 'transfer identities');
    assert.notEqual(request.transferRun, MOTION_SOURCE.run, 'must not reacquire original run');
    assert.notEqual(request.transferArtifact, MOTION_SOURCE.artifact, 'must not reacquire original artifact');
    assert.ok(hex40(request.transferHead), 'exact transfer source');
    assert.ok(digest(request.transferDigest), 'exact transfer archive digest');
    assert.equal(release.id, MOTION_SOURCE.release.id, 'reference release identity');
    assert.equal(release.tag_name, MOTION_SOURCE.release.tag, 'reference release tag');
    assert.equal(release.draft, false, 'published reference release');
    assert.equal(release.prerelease, false, 'stable reference release');
    for (const [name, assetId] of Object.entries(MOTION_SOURCE.release.assets)) {
        const row = one(release.assets, item => item.id === assetId, 'release asset');
        const expected = MOTION_SOURCE.files[name.replace(/^nodejs-/, '')] || MOTION_SOURCE.notices[name];
        assert.equal(row.name, name, 'release asset name');
        assert.equal(row.size, expected.bytes, 'release asset size');
        assert.equal(row.digest, 'sha256:' + expected.sha256, 'release asset bytes');
    }
    runBinding(originalRun, MOTION_SOURCE.run, MOTION_SOURCE.producer);
    assert.equal(originalRun.conclusion, 'failure', 'preserve failed qualification');
    assert.equal(originalRun.path, '.github/workflows/labwired-wasm.yml', 'original producer');
    const build = one(originalJobs.jobs, row => row.name === 'build (a)', 'build A');
    assert.equal(build.status, 'completed');
    assert.equal(build.conclusion, 'success', 'original build A success');
    const original = one(originalArtifacts.artifacts, row => row.id === MOTION_SOURCE.artifact, 'original artifact');
    assert.equal(original.name, 'labwired-wasm-a');
    assert.equal(original.digest, MOTION_SOURCE.archive, 'original archive digest');
    runBinding(transferRun, request.transferRun, request.transferHead);
    assert.equal(transferRun.conclusion, 'success', 'completed successful transfer');
    const transfer = one(transferArtifacts.artifacts, row => row.id === request.transferArtifact, 'transfer artifact');
    assert.equal(transfer.name, 'motion-source-retained-engine', 'transfer packet name');
    assert.equal(transfer.expired, false, 'transfer available');
    assert.equal(transfer.digest, request.transferDigest, 'transfer digest');
    assert.ok(Number.isSafeInteger(transfer.size_in_bytes) && transfer.size_in_bytes > 0 &&
        transfer.size_in_bytes <= 64 * 1024 * 1024, 'bounded transfer');
    return {schema: 'labwired.motion-retained-admission.v1', diagnosticOnly: true,
        referenceRun: MOTION_SOURCE.run, referenceArtifact: MOTION_SOURCE.artifact,
        referenceArchive: MOTION_SOURCE.archive, byteEquivalentRelease: MOTION_SOURCE.release.tag, transferRun: request.transferRun,
        transferArtifact: request.transferArtifact, transferDigest: request.transferDigest,
        transferHead: request.transferHead};
}

export function validateMotionEngine (input) {
    assert.equal(input.nodeVersion, MOTION_SOURCE.node, 'exact Node runtime');
    return {...validateRetainedMotionBytes(input), node: input.nodeVersion};
}

/** Pure byte/provenance validation only; does not admit a runtime or execute glue. */
export function validateRetainedMotionBytes ({info, transfer, read, readNotice}) {
    assert.equal(info.schema, 'labwired.retained-byte-manifest.v1', 'normalized retained-byte manifest');
    assert.equal(info.ref, MOTION_SOURCE.core, 'exact Core source');
    assert.equal(transfer.referenceRun, MOTION_SOURCE.run, 'reference qualification run');
    assert.equal(transfer.referenceArtifact, MOTION_SOURCE.artifact, 'reference qualification artifact');
    assert.equal(transfer.referenceArchive, MOTION_SOURCE.archive, 'reference qualification archive');
    assert.equal(transfer.retainedSource?.kind, 'byte-equivalent-release-assets', 'retained-byte source kind');
    assert.equal(transfer.retainedSource?.tag, MOTION_SOURCE.release.tag, 'byte-equivalent release');
    assert.deepEqual(transfer.retainedSource?.assets, MOTION_SOURCE.release.assets, 'reference release asset identities');
    assert.equal(transfer.verifiedRetainedBytes, true, 'custodian byte verification');
    const observed = {};
    for (const [name, expected] of Object.entries(MOTION_SOURCE.files)) {
        const bytes = read(name), declared = info.targets?.nodejs?.[name];
        assert.deepEqual(declared && {bytes: declared.bytes, sha256: declared.sha256}, expected, name + ': declared binding');
        const actual = {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
        assert.deepEqual(actual, expected, name + ': exact retained bytes');
        observed[name] = actual;
    }
    for (const [name, expected] of Object.entries(MOTION_SOURCE.notices)) {
        const bytes = readNotice(name);
        assert.deepEqual({bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}, expected, name + ': source notice');
    }
    return {diagnosticOnly: true, byteBindingOnly: true, core: info.ref, observed};
}

/** Independent ELF32 ARM load-image binding; non-loadable symbol strings are excluded. */
export function motionElfImage (input) {
    const bytes = Buffer.from(input);
    assert.ok(bytes.length >= 52 && bytes.length <= 1024 * 1024, 'bounded motion ELF');
    assert.deepEqual([...bytes.subarray(0, 7)], [0x7f, 69, 76, 70, 1, 1, 1], 'ELF32 little-endian');
    assert.equal(bytes.readUInt16LE(16), 2, 'executable ELF');
    assert.equal(bytes.readUInt16LE(18), 40, 'ARM ELF');
    assert.equal(bytes.readUInt32LE(20), 1, 'ELF version');
    assert.equal(bytes.readUInt16LE(40), 52, 'ELF header size');
    assert.equal(bytes.readUInt16LE(42), 32, 'program header size');
    const entry = bytes.readUInt32LE(24), flags = bytes.readUInt32LE(36);
    const offset = bytes.readUInt32LE(28), count = bytes.readUInt16LE(44);
    assert.ok(count > 0 && count <= 16 && offset >= 52 && offset + count * 32 <= bytes.length, 'program headers bounded');
    const segments = [];
    for (let i = 0; i < count; i++) {
        const row = offset + i * 32, type = bytes.readUInt32LE(row);
        if (type === 0) continue;
        assert.equal(type, 1, 'only null/load headers in held guest');
        const at = bytes.readUInt32LE(row + 4), vaddr = bytes.readUInt32LE(row + 8),
            paddr = bytes.readUInt32LE(row + 12), filesz = bytes.readUInt32LE(row + 16),
            memsz = bytes.readUInt32LE(row + 20), permissions = bytes.readUInt32LE(row + 24),
            align = bytes.readUInt32LE(row + 28);
        assert.ok(memsz > 0 && filesz <= memsz && at + filesz <= bytes.length, 'load bytes bounded');
        assert.ok(vaddr + memsz <= 0x100000000 && paddr + memsz <= 0x100000000, 'load address bounded');
        assert.ok(permissions <= 7 && (align === 0 || (align <= 0x100000 && (align & (align - 1)) === 0)), 'load attributes');
        segments.push({vaddr, paddr, filesz, memsz, flags: permissions, align, data: bytes.subarray(at, at + filesz)});
    }
    assert.ok(segments.length, 'nonempty load image');
    for (const key of ['vaddr', 'paddr']) {
        const ordered = [...segments].sort((a, b) => a[key] - b[key]);
        for (let i = 1; i < ordered.length; i++)
            assert.ok(ordered[i][key] >= ordered[i - 1][key] + ordered[i - 1].memsz, 'nonoverlapping load image');
    }
    assert.ok((entry & 1) === 1 && segments.some(row => (row.flags & 1) &&
        (entry - 1) >= row.vaddr && (entry - 1) < row.vaddr + row.filesz), 'Thumb entry in executable bytes');
    segments.sort((a, b) => a.vaddr - b.vaddr);
    const header = Buffer.alloc(16);
    [40, entry, flags, segments.length].forEach((value, i) => header.writeUInt32LE(value, i * 4));
    const pieces = [Buffer.from('labwired.motion-elf-image.v1\0'), header];
    for (const row of segments) {
        const header = Buffer.alloc(24);
        ['vaddr', 'paddr', 'filesz', 'memsz', 'flags', 'align'].forEach((name, i) => header.writeUInt32LE(row[name], i * 4));
        pieces.push(header, row.data);
    }
    return {schema: 'labwired.motion-elf-image.v1', sha256: createHash('sha256').update(Buffer.concat(pieces)).digest('hex'),
        fullElfSha256: createHash('sha256').update(bytes).digest('hex'), entry, flags,
        segments: segments.map(({data, ...row}) => row)};
}

export const SOURCE_HASHES = Object.freeze({
    "test/labwired-microbit-motion.test.mjs": "af73787b849eddf697ed988b3a7c0a2fe25a938a561131498f1b7de38db7e3c5",
    "test/fixtures/labwired/microbit-motion/board-io.S": "5615e27e480262672eccaec3747676a8a27160729956f12404fed801cc427cb8",
    "test/fixtures/labwired/microbit-motion/board-io.ld": "a701c40b9718e311a1f3e26a541cd6f5860e35532f850413f60a39015a467073",
    "test/fixtures/labwired/microbit-motion/motion-polled.inc": "3291a77258dd3141cb09a2a942754330fece9fd2855ec8a93eccb35abcb0d8f9",
    "src/labwired-adapter.js": "6688977c2f85aabec7f7e2cff839430c031966c42b64556954ff3096ef540aee",
    "src/labwired-bridge.js": "442da53134fd9b98251b1aaf873fd914fd06a09d4a41f5838d83be4fa792af95",
    "scripts/profile-labwired-motion.mjs": "6c985f45f2c5563bc5e3bd2ea2f3c931f6bf870f65d00f8dfcdbf77d4328e4ab",
    "scripts/lib/wasm-motion-profile.mjs": "f1de7785b1aa3b5f10c496bc87b4b894771f0ecb161ea4b8cf6b01301cf03e1e",
    "scripts/lib/motion-ab-receipt.mjs": "0c05c1f65c8254a5ca38488467d7f2b6f269ea4643689af131444526c37b6d8e"
});
export function validateMotionSources (read) {
    for (const [name, expected] of Object.entries(SOURCE_HASHES))
        assert.equal(createHash('sha256').update(read(name)).digest('hex'), expected, name + ': held source');
}
const json = path => JSON.parse(readFileSync(path, 'utf8'));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [mode, directory, output] = process.argv.slice(2);
    assert.ok(output, 'usage: prepare-labwired-motion-diagnostic.mjs metadata|engine DIRECTORY OUTPUT');
    let result;
    if (mode === 'metadata') result = admitMotionTransfer(json(join(directory, 'packet.json')));
    else if (mode === 'engine') {
        validateMotionSources(name => readFileSync(name));
        result = validateMotionEngine({info: json(join(directory, 'engine-manifest.json')),
            transfer: json(join(directory, 'transfer.json')), nodeVersion: process.version,
            read: name => readFileSync(join(directory, 'nodejs', name)),
            readNotice: name => readFileSync(join(directory, name))});
    } else throw Error('unknown admission phase');
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
