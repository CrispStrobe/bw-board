import test from 'node:test';
import assert from 'node:assert/strict';
import {inferNetlist} from '../src/infer-netlist.js';

const infer = name => inferNetlist({pins: [{name, where: 'P1.0', direction: 'pwm'}]});
const netFor = (nets, part, terminal) => nets.find(net =>
    net.terminals.some(endpoint => endpoint.part === part && endpoint.terminal === terminal));

for (const [name, loadKind, loadTerminal] of [
    ['motor_pwm', 'dc_motor', 'b'],
    ['relay_drive', 'relay', 'coil_b']
]) {
    test(`${name} inference includes a correctly oriented flyback diode`, () => {
        const {parts, nets} = infer(name);
        const load = parts.find(part => part.kind === loadKind);
        const diode = parts.find(part => part.kind === 'diode');
        assert.ok(load && diode);
        const switched = netFor(nets, load.id, loadTerminal);
        const supply = netFor(nets, 'VCC', 'vcc');
        assert.ok(switched.terminals.some(endpoint => endpoint.part === diode.id && endpoint.terminal === 'anode'));
        assert.ok(supply.terminals.some(endpoint => endpoint.part === diode.id && endpoint.terminal === 'cathode'));
    });
}
