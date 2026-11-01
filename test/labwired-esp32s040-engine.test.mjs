import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {admitEsp32S040Inputs, esp32S040Manifest, requireEsp32S040Release,
  verifyEsp32S040Bytes} from '../scripts/fetch-esp32s040-fixtures.mjs';
import {runEsp32S040PublicFactoryProof} from './helpers/esp32s040-public-factory-proof.mjs';
import {createDebugTarget} from '../src/debug-target-factory.js';

const directory = process.env.LABWIRED_ESP32S040_INPUTS;
const required = process.env.LABWIRED_REQUIRE_ESP32S040 === '1';
if (required && !directory) throw new Error('required S040 engine/guest inputs are absent');
if (required) requireEsp32S040Release();

test('S040 evidence cannot promote a candidate or disagree with its source/catalog identity', () => {
  // Keep the replay failure tied to the actual v1 artifact, even after the
  // current engine advances. These are the original retained v1 receipt's
  // bytes, not the later v2 fix or an eventual production release.
  const v1 = esp32S040Manifest.history.find(record => record.version === 'candidate-engine-v1');
  assert.deepEqual(v1.engineAssets.map(({asset, bytes, sha256}) => ({asset, bytes, sha256})), [
    {asset:'nodejs-labwired_wasm.js', bytes:151452,
      sha256:'c4e2c7c0c33e483f4644266c43c705ec4fbc1cfe1ff055d3098ff17e5d572c2e'},
    {asset:'nodejs-labwired_wasm_bg.wasm', bytes:29021982,
      sha256:'433a2611afa7939273887de5ddfe850345fab8bfdb72779671f3b4678c580d42'},
  ]);
  assert.equal(v1.failures[0].version, 'candidate-engine-v1');
  assert.equal(v1.resolution.version, 'candidate-engine-v2');
  const manifest = structuredClone(esp32S040Manifest);
  manifest.qualification = 'candidate';
  assert.throws(() => requireEsp32S040Release(manifest), /release is pending/);
  manifest.qualification = 'release';
  manifest.engine.independentBuildsQualified = true;
  manifest.engine.siliconDriftAcknowledged = true;
  assert.throws(() => requireEsp32S040Release(manifest, 'not-a-source-pin'), /identities disagree/);
  const pin = '1'.repeat(40);
  manifest.source.commit = pin; manifest.engine.sourceCommit = pin;
  manifest.engine.releaseTag = 'labwired-wasm-22222222-locked';
  assert.throws(() => requireEsp32S040Release(manifest, pin), /identities disagree/);
  manifest.engine.releaseTag = 'labwired-wasm-11111111-locked';
  requireEsp32S040Release(manifest, pin); // identity syntax only, not real qualification evidence
  const bytes = Uint8Array.of(1, 2, 3);
  assert.throws(() => verifyEsp32S040Bytes(bytes, {file:'control',bytes:4,sha256:''}), /byte length/);
  assert.throws(() => verifyEsp32S040Bytes(bytes, {file:'control',bytes:3,sha256:'0'.repeat(64)}), /SHA-256/);
});

test('real S040 guest and H1 circuit pass through the public factory', {skip: !directory, timeout: 120_000}, async t => {
  const admitted = await admitEsp32S040Inputs(directory, {requireRelease: required});
  t.diagnostic(JSON.stringify({inputIdentity: admitted.identity,
    knownFailures: esp32S040Manifest.knownFailures}));
  // No executable import precedes admission of both the glue and its WASM.
  const wasm = createRequire(import.meta.url)(admitted.enginePath);
  try {
    const proof = await runEsp32S040PublicFactoryProof({wasm, firmware: admitted.firmware});
    assert.equal(proof.passed, true);
    assert.ok(proof.checks.length >= 19);
    assert.deepEqual(proof.h1.map(row => row.pin), [1, 2, 40, 43, 44]);
    t.diagnostic(JSON.stringify({proof}));
  } catch (error) {
    if (error.proof) t.diagnostic(JSON.stringify({proof: error.proof}));
    throw error;
  }
});

test('retained Arduino merged flash boots and resets under the trusted S040 assembly', {skip: !directory, timeout: 90_000}, async t => {
  const admitted = await admitEsp32S040Inputs(directory, {requireRelease: required});
  const wasm = createRequire(import.meta.url)(admitted.enginePath);
  const {target, adapter} = await createDebugTarget('labwired', {wasm,
    firmware:admitted.mergedFlash, firmwareBoot:admitted.firmwareBoot,
    labwiredBoardId:'esp32-4848s040'});
  const started = performance.now();
  function boot () {
    let transcript = '';
    adapter.onSerial(byte => { transcript += String.fromCharCode(byte); });
    target.run();
    for (let ms = 0; ms < 500 && !transcript.includes('SMOKE_OK'); ms++) {
      assert.equal(target.runFor(1_000_000), 'running', JSON.stringify(target.diagnostics()));
      assert.ok(transcript.length < 100_000 && performance.now() - started < 85_000, 'bounded retained boot');
    }
    assert.ok(transcript.includes('SMOKE_OK'), `retained application marker absent: ${transcript}`);
    assert.equal(target.video(), null, 'the smoke image did not initialize the RGB panel; no frame may be fabricated');
    return transcript;
  }
  try {
    assert.equal(adapter.labwiredBoard.id, 'esp32-4848s040');
    assert.equal(adapter.firmwareBoot.boardId, 'esp32-4848s040');
    assert.equal(target.video(), null);
    const before = boot();
    admitted.mergedFlash.fill(0); admitted.firmwareBoot.irom.fill(0); admitted.firmwareBoot.drom.fill(0);
    target.reset();
    assert.equal(target.video(), null);
    const after = boot();
    t.diagnostic(JSON.stringify({inputIdentity:admitted.identity,
      fixture:esp32S040Manifest.flashBoot, uartBeforeReset:before, uartAfterReset:after,
      display:'pending: this retained smoke image never initializes RGB', elapsedWallMs:performance.now()-started}));
  } finally {
    try { target.destroy(); } finally { adapter.sim.free(); }
  }
});
