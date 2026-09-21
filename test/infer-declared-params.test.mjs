/**
 * AN INFERRED PART MUST DECLARE ONLY WHAT THE ENGINE READS.
 *
 * One emission in inferNetlist said something no code consumed, and
 * sb3-creator's `circuit-params-are-read` gate named it against this engine:
 *
 *   - sevenseg8 carried `params.commonAnode`, while registerSevenseg8's init()
 *     reads `params.common` and tests it with /anode/i. A program declaring
 *     `PART display = SEVENSEG8 … COMMON ANODE` was therefore inferred as a
 *     common-CATHODE display: the declaration reached the file and died there.
 *
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

});
