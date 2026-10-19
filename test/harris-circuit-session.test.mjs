import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisLoopROM} from '../src/experimental/harris-boot-rom.js';
import {createHarrisCircuitDocument, loadHarrisCircuitSession} from '../src/experimental/harris-circuit-session.js';

registerBusMemory();
const recipe = () => createHarrisCircuitDocument({enabled: true, rom: createHarrisLoopROM(), romLowAlias: true});
const load = doc => loadHarrisCircuitSession(doc, {enabled: true});
const fault = code => error => error.code === code;

test('configuration and loader require explicit gates', () => {
    assert.throws(() => createHarrisCircuitDocument(), fault('EXPERIMENT_DISABLED'));
    assert.throws(() => loadHarrisCircuitSession(recipe()), fault('EXPERIMENT_DISABLED'));
});

test('JSON round trip executes wired loop; exports construction recipe, not live RAM', () => {
    const doc = recipe();
    const session = load(JSON.stringify(doc));
    assert.equal(session.inspect().status, 'uninitialized');
    session.initialize();
    const result = session.run();
    assert.equal(result.reason, 'halted');
    assert.equal(result.cpu.retired, 47);
    assert.equal(result.clocks, 372);
    assert.equal(session.inspectBank('ram0').bytes[0x288], 10);
    assert.deepEqual(session.exportConfiguration(), doc);
    const fresh = load(session.exportConfiguration());
    assert.equal(fresh.inspectBank('ram0').bytes[0x288], 0);
    assert.equal(fresh.inspect().status, 'uninitialized');
});

test('recipe and inspection results cannot mutate the running session', () => {
    const doc = recipe(), session = load(doc);
    doc.rom.fill(0); doc.wires.length = 0;
    session.exportConfiguration().rom.fill(0);
    session.inspectBank('ram0').bytes.fill(255);
    session.initialize();
    session.inspect().registers.ax = 999;
    assert.equal(session.run().reason, 'halted');
    assert.equal(session.inspectBank('ram0').bytes[0x288], 10);
});

test('unsupported schemas, backends, parts and state fields are rejected', () => {
    for (const [change, code] of [
        [d => d.version = 2, 'UNSUPPORTED_CIRCUIT_PROFILE'],
        [d => d.backend = 'v86', 'UNSUPPORTED_BACKEND'],
        [d => d.parts[0].type = '80386', 'UNSUPPORTED_PARTS'],
        [d => d.parts[1] = d.parts[0], 'UNSUPPORTED_PARTS'],
        [d => d.snapshot = {}, 'INVALID_CIRCUIT_DOCUMENT'],
        [d => d.rom[0] = 256, 'INVALID_CIRCUIT_DOCUMENT'],
        [d => delete d.rom[0], 'INVALID_CIRCUIT_DOCUMENT'],
        [d => d.wires[0].extra = true, 'INVALID_CIRCUIT_DOCUMENT']
    ]) {
        const doc = recipe(); change(doc);
        assert.throws(() => load(doc), fault(code));
    }
});

test('saved wire edits actually affect electrical execution', () => {
    const doc = recipe();
    doc.wires = doc.wires.filter(w => !(w.to === 'rom0' && w.toTerminal === 'vcc'));
    const session = load(doc);
    assert.throws(() => session.initialize());
    assert.equal(session.inspect().status, 'faulted');
    const invalid = recipe(); invalid.wires[0].to = 'missing';
    assert.throws(() => load(invalid));
});

test('physical reset breakpoint precedes fetch and continue advances exactly once', () => {
    const session = load(recipe()); session.initialize();
    session.setBreakpoint(0xfffff0);
    let result = session.run();
    assert.equal(result.reason, 'breakpoint'); assert.equal(result.clocks, 0);
    assert.equal(result.cpu.retired, 0); assert.equal(result.cpu.instructionBoundary, true);
    session.setBreakpoint(0xf0100);
    result = session.run();
    assert.equal(result.reason, 'breakpoint'); assert.equal(result.cpu.retired, 1);
    assert.equal(result.cpu.csBase + result.cpu.ip, 0xf0100);
    assert.equal(session.stepInstruction().cpu.retired, 2);
    assert.equal(session.run().reason, 'halted');
});

test('instruction stepping retires one instruction, including from mid-fetch', () => {
    const session = load(recipe()); session.initialize();
    session.stepClock();
    assert.equal(session.inspect().instructionBoundary, false);
    const result = session.stepInstruction();
    assert.equal(result.reason, 'instruction'); assert.equal(result.cpu.retired, 1);
    assert.equal(result.cpu.instructionBoundary, true);
    assert.equal(result.cpu.ip, 0x100);
});

test('breakpoints do not fire on operand bytes and rearm on loop revisits', () => {
    const session = load(recipe()); session.initialize();
    session.setBreakpoint(0xfffff1); // reset JMP immediate, never an instruction boundary
    session.setBreakpoint(0xf0109); // MOV [BX],AX in the fill loop
    let result = session.run();
    assert.equal(result.reason, 'breakpoint');
    const first = result.cpu.retired;
    result = session.run();
    assert.equal(result.reason, 'breakpoint'); assert.ok(result.cpu.retired > first);
    session.clearBreakpoint(0xf0109);
    assert.equal(session.run().reason, 'halted');
});

test('waits and budgets leave resumable state; cancellation is terminal for session', () => {
    const session = load(recipe()); session.initialize();
    assert.equal(session.stepInstruction(8, 1).reason, 'budget-exhausted');
    assert.equal(session.inspect().retired, 0);
    assert.equal(session.stepInstruction().cpu.retired, 1);
    session.cancel();
    assert.equal(session.run().reason, 'cancelled');
    assert.throws(() => session.initialize(), fault('SESSION_ALREADY_INITIALIZED'));
});

test('unsupported debugger operations fail without changing state', () => {
    const session = load(recipe()); session.initialize();
    const before = session.inspect();
    for (const name of ['saveState', 'restoreState', 'readMem', 'writeMem', 'setRegisters', 'setBackend'])
        assert.throws(() => session[name]({backend: 'v86'}), fault('UNSUPPORTED_DEBUG_OPERATION'));
    for (const address of [-1, 0x1000000, 1.5]) assert.throws(() => session.setBreakpoint(address), RangeError);
    assert.throws(() => session.run(0), RangeError);
    assert.deepEqual(session.inspect(), before);
    assert.equal(session.capabilities.boundaryD, false);
    assert.equal(session.inspectNet('inputs', 'vcc').value, 1);
});
