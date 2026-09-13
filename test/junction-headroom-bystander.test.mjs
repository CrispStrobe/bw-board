/**
 * A HEURISTIC THAT READS NETLIST-WIDE STATE NEEDS A CASE WITH AN IRRELEVANT
 * PART PRESENT. THIS IS THAT CASE.
 *
 * `junctionModelOf` routes a junction to the piecewise walker or the
 * exponential solve by how much SUPPLY HEADROOM it has, and the board computes
 * that headroom. It used to compute it netlist-WIDE: sum `vf` over every
 * junction in the circuit, subtract from vcc, hand the one number to every
 * junction. So a part in a completely separate branch — one that shares no
 * current path with the junction being routed, and may carry no current at all
 * — changed which MODEL another part was solved with.
 *
 * MEASURED before the fix, on a real board, by lego-38:
 *
 *     second branch none   headroom 3.00 V -> pwl        71.1111 mA
 *     second branch res    headroom 3.00 V -> pwl        71.1111 mA
 *     second branch led    headroom 1.00 V -> shockley   69.8184 mA
 *
 * A second RESISTOR did nothing because only junctions entered the sum. That
 * asymmetry is the tell, and it is why the bug survived: every routing test in
 * the suite had either ONE junction or a deliberate SERIES string, and the
 * defect needs two junctions that are NOT in series. No test constructed one.
 * The suite had full coverage of the shapes somebody thought of.
 *
 * `_junctionHeadroomFor(part)` now walks the part's SERIES CHAIN: two junctions
 * are in series when a net joins them and nothing else; a third terminal is a
 * branch point and ends the chain.
 *
 * THE CHOICE OF RAIL IS LOAD-BEARING. At 5 V a single 2.0 V LED has 3.0 V of
 * headroom, above MNA_HEADROOM_V = 2.0, so it routes to `pwl`. Adding a second
 * LED in PARALLEL made the old code see 5 - 4 = 1.0 V and flip it to
 * `shockley`. On a 3.3 V rail both readings are already below the threshold, so
 * every assertion here would pass with the defect fully present — the fixture
 * has to be built at a rail where the bystander CROSSES the threshold, or this
 * file is a true test of a claim it cannot see fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { MNA_HEADROOM_V } from '../src/mna.js';

const VCC = 5.0, VF = 2.0;

/** LED1 on its own branch, plus an optional bystander that must not matter. */
function build(second) {
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'R1', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
        {id: 'LED1', kind: 'led', params: {vf: VF}, terminals: ['anode', 'cathode']}];
    const nets = [
        {id: 'nv', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'R1', terminal: 'a'}]},
        {id: 'n1', terminals: [{part: 'R1', terminal: 'b'}, {part: 'LED1', terminal: 'anode'}]},
        {id: 'ng', terminals: [{part: 'GND', terminal: 'gnd'}, {part: 'LED1', terminal: 'cathode'}]}];
    if (second === 'resistor') {
        parts.push({id: 'R2', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']});
        nets[0].terminals.push({part: 'R2', terminal: 'a'});
        nets[2].terminals.push({part: 'R2', terminal: 'b'});
    } else if (second === 'led') {
        parts.push({id: 'R2', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']});
        parts.push({id: 'LED2', kind: 'led', params: {vf: VF}, terminals: ['anode', 'cathode']});
        nets[0].terminals.push({part: 'R2', terminal: 'a'});
        nets.push({id: 'n2', terminals: [{part: 'R2', terminal: 'b'}, {part: 'LED2', terminal: 'anode'}]});
        nets[2].terminals.push({part: 'LED2', terminal: 'cathode'});
    } else if (second === 'floating-led') {
        // Wired to nothing that carries current: the purest bystander there is.
        parts.push({id: 'LED2', kind: 'led', params: {vf: VF}, terminals: ['anode', 'cathode']});
        nets.push({id: 'nx', terminals: [{part: 'LED2', terminal: 'anode'}]});
        nets.push({id: 'ny', terminals: [{part: 'LED2', terminal: 'cathode'}]});
    }
    const b = new BoardImpl(VCC);
    b.setNetlist(parts, nets);
    return b;
}

const read = (b, id = 'LED1') => ({
    i: Math.abs(b.branchCurrent(id, 'anode')),
    model: b._solveParts.find(p => p.id === id)?._junctionModel,
});

test('THE FIXTURE CAN SEE THE DEFECT: this rail crosses the routing threshold', () => {
    // ANTI-VACUITY, and the reason this file specifies 5 V rather than 3.3.
    // A bystander LED added 2.0 V to the old netlist-wide sum. For that to
    // change anything, the alone-headroom must sit ABOVE MNA_HEADROOM_V and the
    // with-bystander headroom BELOW it. State both, so a later edit to VCC, VF
    // or the threshold fails here rather than silently making every assertion
    // below unfalsifiable.
    const alone = VCC - VF;
    const asOldCodeSawIt = VCC - 2 * VF;
    assert.ok(alone > MNA_HEADROOM_V,
        `alone-headroom ${alone} V must be ABOVE the ${MNA_HEADROOM_V} V threshold`);
    assert.ok(asOldCodeSawIt < MNA_HEADROOM_V,
        `the netlist-wide sum ${asOldCodeSawIt} V must be BELOW it, or the bystander cannot `
        + 'flip the routing and this file tests nothing');
    assert.equal(read(build('none')).model, 'pwl',
        'the alone case must route to pwl, which is the reading the bystander used to destroy');
});

test('a bystander in a PARALLEL branch changes nothing about LED1', () => {
    const alone = read(build('none'));
    assert.ok(alone.i > 0, 'fixture: LED1 must carry a driven current');
    for (const second of ['resistor', 'led', 'floating-led']) {
        const got = read(build(second));
        // BIT-IDENTICAL, not "close". A part on another branch does not perturb
        // this solve at all, so a tolerance here would be admitting it might.
        assert.equal(got.model, alone.model,
            `a second ${second} changed LED1's MODEL from ${alone.model} to ${got.model} — `
            + 'the routing heuristic is reading state that is not about this part');
        assert.equal(got.i, alone.i,
            `a second ${second} moved LED1 from ${(alone.i * 1e3).toFixed(6)} mA to `
            + `${(got.i * 1e3).toFixed(6)} mA`);
    }
    // The parallel LED must itself be lit, or "it changed nothing" is a claim
    // about a part that is not in the circuit in any meaningful sense.
    const both = build('led');
    assert.equal(read(both, 'LED2').i, alone.i,
        'the parallel LED must carry the same current as LED1 — identical branches');
});

test('but a junction in SERIES does change it, because that one is real', () => {
    // The other direction. If the fix had gone too far and made headroom purely
    // per-part, this would still read pwl and a genuinely starved series string
    // would go back to being reported dark — the failure E1.3b exists to
    // prevent. Series junctions share a current path and must be summed.
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'R1', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
        {id: 'LED1', kind: 'led', params: {vf: VF}, terminals: ['anode', 'cathode']},
        {id: 'LED2', kind: 'led', params: {vf: VF}, terminals: ['anode', 'cathode']}];
    const nets = [
        {id: 'nv', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'R1', terminal: 'a'}]},
        {id: 'n1', terminals: [{part: 'R1', terminal: 'b'}, {part: 'LED1', terminal: 'anode'}]},
        {id: 'nm', terminals: [{part: 'LED1', terminal: 'cathode'}, {part: 'LED2', terminal: 'anode'}]},
        {id: 'ng', terminals: [{part: 'GND', terminal: 'gnd'}, {part: 'LED2', terminal: 'cathode'}]}];
    const b = new BoardImpl(VCC);
    b.setNetlist(parts, nets);
    const series = read(b);
    assert.equal(series.model, 'shockley',
        'two LEDs in series on 5 V have 1.0 V of headroom and must take the exponential solve');
    const alone = read(build('none'));
    assert.notEqual(series.i, alone.i,
        'the series string must NOT read the same current as a single LED — if it does, the '
        + 'headroom walk has stopped seeing series junctions at all');
});
