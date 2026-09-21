/**
 * AN INFERRED PART MUST DECLARE ONLY WHAT THE ENGINE READS.
 *
 * Two emissions in inferNetlist said something no code consumed, and
 * sb3-creator's `circuit-params-are-read` gate named both against this engine:
 *
 *   - sevenseg8 carried `params.commonAnode`, while registerSevenseg8's init()
 *     reads `params.common` and tests it with /anode/i. A program declaring
 *     `PART display = SEVENSEG8 … COMMON ANODE` was therefore inferred as a
 *     common-CATHODE display: the declaration reached the file and died there.
 *
 *   - every inferred led carried `vf: 2.0`, which is exactly the engine's own
 *     LED_VF. A generated bench that restates the default says nothing, and ten
 *     such benches crowded that gate's probe cap with sites where the LED is
 *     dark — so the one key that IS read looked inert. The colour stays: the
 *     renderer draws with it, and it is a choice, not a default restated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist } from '../src/infer-netlist.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

const sevenseg = commonAnode => inferNetlist({
  pins: [],
  parts: [{
    name: 'display', type: 'sevenseg8', segPort: 0, commonAnode,
    selPins: [{ port: 2, bit: 2 }, { port: 2, bit: 3 }, { port: 2, bit: 4 }],
  }],
}).parts.find(part => part.kind === 'sevenseg8');

describe('inferNetlist: a declared param is one the device reads', () => {
  it('COMMON ANODE reaches the device through the key it actually reads', () => {
    const part = sevenseg(true);
    assert.equal(part.params.common, 'anode');
    assert.equal(part.params.commonAnode, undefined,
      'commonAnode is the name nothing read — emitting it again would restore the defect');
    // Not a spelling claim: drive the device's own init with what we emit.
    const state = getDevice('sevenseg8').init(part);
    assert.equal(state.commonAnode, true,
      'the device did not come up as common anode, so the declaration is still inert');
  });

  it('and the default stays explicit rather than absent', () => {
    const part = sevenseg(false);
    assert.equal(part.params.common, 'cathode');
    assert.equal(getDevice('sevenseg8').init(part).commonAnode, false);
  });

  it('an inferred LED declares its colour and not the engine default vf', () => {
    const { parts } = inferNetlist({
      pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: false }],
    });
    const led = parts.find(part => part.kind === 'led');
    assert.ok(led, 'no LED was inferred — this test would prove nothing');
    assert.equal(led.params.color, 'red');
    assert.equal(led.params.vf, undefined,
      'vf: 2.0 is exactly LED_VF; a generated bench restating the default says nothing');
  });
});
