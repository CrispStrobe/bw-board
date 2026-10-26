// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeSamdProfile, writeSamdProfile, SAMD_PROFILE_ASSET, SAMD_PROFILE_SOURCES} from '../scripts/lib/labwired-samd-profile.mjs';
import {admitProfile,admitProductionNodeEngine} from '../scripts/qualify-samd-native-game.mjs';
const ref = '0123456789abcdef0123456789abcdef01234567';
const sources = () => Object.fromEntries(Object.values(SAMD_PROFILE_SOURCES).map((p, i) => [p, Buffer.from(`# authored source ${i}\n`)]));
const sha = b => createHash('sha256').update(b).digest('hex');
test('production admission cannot omit glue WASM or loader identity bindings', async () => {
    const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
    const {tmpdir}=await import('node:os');const {join}=await import('node:path');
    const root=mkdtempSync(join(tmpdir(),'samd-engine-binding-'));
    try {
        mkdirSync(join(root,'nodejs'));
        const members={'labwired_wasm.js':Buffer.from('// authored metadata control; never executed\n'),'labwired_wasm_bg.wasm':Buffer.from([0,97,115,109,1,0,0,0]),'package.json':Buffer.from('{"type":"commonjs"}\n')};
        const info={targets:{nodejs:{}}};
        for(const [name,raw] of Object.entries(members)) {writeFileSync(join(root,'nodejs',name),raw);info.targets.nodejs[name]={bytes:raw.length,sha256:sha(raw)};}
        admitProductionNodeEngine(root,info);
        for(const name of Object.keys(members)) {const bad=structuredClone(info);delete bad.targets.nodejs[name];assert.throws(()=>admitProductionNodeEngine(root,bad),/closed field/);}
        const extra=structuredClone(info);extra.targets.nodejs.foreign=info.targets.nodejs['package.json'];assert.throws(()=>admitProductionNodeEngine(root,extra),/closed field/);
        writeFileSync(join(root,'nodejs/labwired_wasm.js'),'changed bytes');assert.throws(()=>admitProductionNodeEngine(root,info),/exact production/);
    } finally {rmSync(root,{recursive:true,force:true});}
});
test('exact source bytes and synthetic input packet survive serialisation', () => {
    const input = sources();
    const result = JSON.parse(JSON.stringify(makeSamdProfile(ref, input)));
    assert.equal(result.source, ref);
    assert.equal(result.physical_capture, false);
    for (const [field, path] of Object.entries(SAMD_PROFILE_SOURCES)) {
        assert.deepEqual(Buffer.from(result[field]), input[path]);
        assert.equal(result.source_bindings[path].sha256, sha(input[path]));
    }
    const sw = Buffer.from(result.inputs.LABWIRED_SAMD51_SIM_SW0.data, 'hex');
    const serial = Buffer.from(result.inputs.LABWIRED_SAMD51_SIM_SERIAL.data, 'hex');
    assert.equal(sw.length, 1024); assert.equal(serial.length, 1024);
    assert.deepEqual([...sw.subarray(0x80, 0x90)], [255,255,255,255,41,27,0,0,255,255,255,255,255,255,255,255]);
    assert.deepEqual([...serial.subarray(0x10, 0x1c)], [1,0,0,0,2,0,0,0,3,0,0,0]);
    assert.equal(serial.readUInt32LE(0x1fc), 0x42570001);
    assert.equal(result.inputs.LABWIRED_SAMD51_SIM_SW0.sha256, sha(sw));
    assert.equal(result.inputs.LABWIRED_SAMD51_SIM_SERIAL.sha256, sha(serial));
});
test('historical absent profile is explicit; partial or foreign source unions refuse', () => {
    assert.equal(makeSamdProfile(ref, {}), null);
    const partial = sources(); delete partial[SAMD_PROFILE_SOURCES.display_yaml];
    assert.throws(() => makeSamdProfile(ref, partial), /complete/);
    assert.throws(() => makeSamdProfile(ref, {...sources(), '../private': Buffer.from('x')}), /declared/);
    assert.throws(() => makeSamdProfile('main', sources()), /immutable/);
    const invalid = sources(); invalid[SAMD_PROFILE_SOURCES.chip_yaml] = Buffer.from([255]);
    assert.throws(() => makeSamdProfile(ref, invalid), /UTF-8/);
});
test('source edits change the asset binding while input callers stay unmodified', () => {
    const input = sources(); const original = Buffer.from(input[SAMD_PROFILE_SOURCES.chip_yaml]);
    const first = makeSamdProfile(ref, input);
    input[SAMD_PROFILE_SOURCES.chip_yaml] = Buffer.from('different source\n');
    const next = makeSamdProfile(ref, input);
    assert.notEqual(first.source_bindings[SAMD_PROFILE_SOURCES.chip_yaml].sha256, next.source_bindings[SAMD_PROFILE_SOURCES.chip_yaml].sha256);
    assert.deepEqual(Buffer.from(first.chip_yaml), original);
});

test('writer binds actual committed source, refuses dirty config and immutable-output reuse', async () => {
    const {execFileSync} = await import('node:child_process');
    const {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} = await import('node:fs');
    const {join, dirname} = await import('node:path');
    const {tmpdir} = await import('node:os');
    const root = mkdtempSync(join(process.env.TEST_SCRATCH || tmpdir(), 'samd-profile-control-'));
    const git = args => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore','pipe','pipe']}).trim();
    try {
        git(['init', '--quiet']);
        git(['config', 'user.name', 'SAMD profile control']);
        git(['config', 'user.email', 'profile-control@example.invalid']);
        for (const [name, bytes] of Object.entries(sources())) {
            mkdirSync(dirname(join(root, name)), {recursive: true}); writeFileSync(join(root, name), bytes);
        }
        git(['add', 'configs']); git(['commit', '--quiet', '-m', 'Authored profile control']);
        const ref = git(['rev-parse', 'HEAD']);
        const outDir = join(root, 'out');
        const assets = writeSamdProfile({sourceDir: root, outDir, ref});
        const raw = readFileSync(join(outDir, SAMD_PROFILE_ASSET));
        assert.equal(assets[SAMD_PROFILE_ASSET].sha256, sha(raw));
        assert.equal(JSON.parse(raw).source, ref);
        assert.throws(() => writeSamdProfile({sourceDir: root, outDir, ref}), /immutable/);
        assert.throws(() => writeSamdProfile({sourceDir: root, outDir: join(root, 'bad-ref'), ref: '0'.repeat(40)}), /same source/);
        writeFileSync(join(root, SAMD_PROFILE_SOURCES.chip_yaml), 'dirty source');
        assert.throws(() => writeSamdProfile({sourceDir: root, outDir: join(root, 'dirty'), ref}));
    } finally { rmSync(root, {recursive: true, force: true}); }
});

test('production guest gate refuses tampered package identity, source YAML and calibration', () => {
    const profile = makeSamdProfile(ref, sources());
    const admit = (value, source = ref, row = {}) => {
        const raw = Buffer.from(JSON.stringify(value));
        return admitProfile(raw, {ref: source, configAssets: {[SAMD_PROFILE_ASSET]: {bytes: raw.length, sha256: sha(raw), ...row}}});
    };
    assert.equal(admit(profile).source, ref);
    assert.throws(() => admit(profile, ref, {sha256: '0'.repeat(64)}), /asset/);
    assert.throws(() => admit(profile, 'f'.repeat(40)), /source/);
    assert.throws(() => admit({...profile, chip_yaml: 'changed source'}), /byte binding/);
    const inputs = structuredClone(profile.inputs);
    inputs.LABWIRED_SAMD51_SIM_SW0.data = '0'.repeat(2048);
    assert.throws(() => admit({...profile, inputs}), /identity/);
    assert.throws(() => admit({...profile, inputs: {...profile.inputs, FOREIGN: profile.inputs.LABWIRED_SAMD51_SIM_SW0}}), /union/);
    assert.throws(() => admit({...profile, physical_capture: true}), /boundary/);
});
