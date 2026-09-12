import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';

// Contract fakes, not an electrical or native performance qualification. The
// independent native/reference boot tests exercise the real board and decoder.
function fixture(responses = [], transactions = [{kind: 'memory-read', address: 1, width: 2}]) {
    const calls = [], submitted = [], operands = [];
    const board = {
        capabilities: {transactionBatching: true, nativeMemoryBus: true},
        initialize() {}, submit(value) { submitted.push(value); },
        clock() { throw new Error('unexpected single-period fallback'); },
        runUntilCompletion(options) {
            calls.push(options);
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return typeof next === 'function' ? next(options) : next;
        }
    };
    class TestCPU extends HarrisBootCPU {
        *_instructions() {
            for (const transaction of transactions) {
                operands.push(yield transaction);
                this.retired++;
            }
            this.status = 'halted';
        }
    }
    const cpu = new TestCPU({enabled: true, board}); cpu.initialize();
    return {cpu, board, calls, submitted, operands};
}
const partial = {last: false, data: 0x34};
const final = {last: true, operand: 0x1234};
const result = (periods, completions = []) => ({periods, completed: completions.at(-1)?.last === true, completions});

test('logical odd transfer survives repeated budgets and pumps only at final completion', () => {
    const {cpu, calls, submitted, operands} = fixture([result(2, [partial]), result(1), result(2, [final])]);
    const iterator = cpu.iterator;
    assert.deepEqual(cpu.runTransactions({maxPeriods: 3, maxBatchPeriods: 2}),
        {status: 'budget-exhausted', periods: 3, retired: 0, completions: [partial]});
    assert.equal(cpu.iterator, iterator);
    assert.deepEqual(operands, []); assert.equal(submitted.length, 1);
    assert.deepEqual(cpu.runTransactions({maxPeriods: 8, maxBatchPeriods: 2}),
        {status: 'halted', periods: 2, retired: 1, completions: [final]});
    assert.deepEqual(operands, [0x1234]);
    assert.deepEqual(calls.map(call => call.maxPeriods), [2, 1, 2]);
    assert.equal(cpu.runTransactions({maxPeriods: 1}).periods, 0);
});

test('actual short completion counts, static READY, and default conservative cap', () => {
    const {cpu, calls} = fixture([result(1, [final]), result(1, [final])], [{}, {}]);
    const output = cpu.runTransactions({maxPeriods: 1000, ready_n: 1});
    assert.equal(output.periods, 2); assert.equal(output.retired, 2);
    assert.deepEqual(calls, Array.from({length: 2}, () => ({maxPeriods: 256, inputs: {ready_n: 1}})));
});

test('validation rejects observer/debugger options, invalid budgets and input before execution', () => {
    const {cpu, calls} = fixture();
    for (const options of [null, [], {maxPeriods: 0}, {maxPeriods: 1.1}, {maxPeriods: Infinity},
        {maxPeriods: 1, maxBatchPeriods: 0}, {maxPeriods: 1, maxBatchPeriods: 8193},
        {maxPeriods: 1, ready_n: true}, {maxPeriods: 1, signal: {}},
        {maxPeriods: 1, observer() {}}, {maxPeriods: 1, onPeriod() {}},
        {maxPeriods: 1, breakpoints: []}, {maxPeriods: 1, inputs: {intr: 1}}])
        assert.throws(() => cpu.runTransactions(options));
    assert.equal(calls.length, 0); assert.equal(cpu.status, 'running');
});

test('unsupported board capabilities cannot silently use period stepping', () => {
    for (const modification of [{transactionBatching: false}, {nativeMemoryBus: false}, {nmi: true}, {intr: true}]) {
        const {cpu, board, calls} = fixture(); Object.assign(board.capabilities, modification);
        assert.throws(() => cpu.runTransactions({maxPeriods: 10}), {code: 'UNSUPPORTED_TRANSACTION_BATCHING'});
        assert.equal(cpu.status, 'running'); assert.equal(calls.length, 0);
    }
    const {cpu, board} = fixture(); delete board.runUntilCompletion;
    assert.throws(() => cpu.runTransactions({maxPeriods: 10}), {code: 'UNSUPPORTED_TRANSACTION_BATCHING'});
});

test('malformed or zero progress faults without resuming generator or looping', () => {
    for (const response of [undefined, result(0), result(4), result(1.5),
        {periods: 1, completed: true, completions: []},
        {periods: 1, completed: false, completions: [final]},
        result(2, [final, partial]), result(2, [partial, partial]), result(1, [{last: true}]),
        result(1, [{last: true, operand: 65536}]), result(1, [null]), result(1, Array(1))]) {
        const {cpu, calls, operands} = fixture([response]);
        assert.throws(() => cpu.runTransactions({maxPeriods: 3}), {code: 'INVALID_BATCH_RESULT'});
        assert.equal(cpu.status, 'faulted'); assert.equal(calls.length, 1);
        assert.deepEqual(operands, []);
    }
});

test('malformed fault receipts cannot publish invented completions or elapsed periods', () => {
    for (const progress of [{periods: 0, completions: [partial]}, {periods: 1, completions: [null]},
        {periods: 1, completions: [final]}, {periods: 2, completions: [partial, partial]},
        {periods: 4, completions: []}, {periods: -1, completions: []}, {periods: 1, completions: Array(1)}]) {
        const error = Object.assign(new Error('invalid native receipt'), {progress});
        const {cpu, operands} = fixture([error]);
        assert.throws(() => cpu.runTransactions({maxPeriods: 3}), caught => {
            assert.equal(caught.code, 'INVALID_BATCH_RESULT');
            assert.equal(caught.progress.periods, 0); assert.deepEqual(caught.progress.completions, []);
            return true;
        });
        assert.deepEqual(operands, []); assert.equal(cpu.status, 'faulted');
    }
});

test('native fault aggregates preceding successful periods and physical halves, not faulting period', () => {
    const nativeError = Object.assign(new Error('sample failure'), {code: 'NATIVE_FAULT',
        progress: Object.freeze({periods: 1, completions: [partial], busClock: 74, stopReason: 'fault'})});
    const {cpu, operands} = fixture([result(2), nativeError]);
    assert.throws(() => cpu.runTransactions({maxPeriods: 9, maxBatchPeriods: 2}), error => {
        assert.equal(error, nativeError);
        assert.deepEqual(error.progress, {periods: 3, completions: [partial], busClock: 74,
            stopReason: 'fault', retired: 0});
        return true;
    });
    assert.equal(cpu.status, 'faulted'); assert.deepEqual(operands, []);
    assert.throws(() => cpu.initialize(), {code: 'CPU_FAULTED'});
});

test('pump/next transaction faults retain already completed periods and retirement', () => {
    const {cpu, board, operands} = fixture([result(2, [final])], [{}, {kind: 'io-read'}]);
    board.submit = () => { throw Object.assign(new Error('memory only'), {code: 'UNSUPPORTED_TRANSACTION'}); };
    assert.throws(() => cpu.runTransactions({maxPeriods: 8}), error => {
        assert.equal(error.code, 'UNSUPPORTED_TRANSACTION');
        assert.equal(error.progress.periods, 2); assert.equal(error.progress.retired, 1);
        assert.deepEqual(error.progress.completions, [final]); return true;
    });
    assert.equal(cpu.status, 'faulted'); assert.deepEqual(operands, [0x1234]);
});

test('cancellation is checked between bounded calls and never adds hidden periods', () => {
    const controller = new AbortController();
    const {cpu, calls, operands} = fixture([() => {controller.abort(); return result(2, [partial]);}]);
    assert.deepEqual(cpu.runTransactions({maxPeriods: 20, maxBatchPeriods: 2, signal: controller.signal}),
        {status: 'cancelled', periods: 2, retired: 0, completions: [partial]});
    assert.equal(calls.length, 1); assert.deepEqual(operands, []);
    const other = fixture();
    assert.equal(other.cpu.runTransactions({maxPeriods: 1, signal: controller.signal}).periods, 0);
    assert.equal(other.cpu.status, 'cancelled'); assert.equal(other.calls.length, 0);
});

test('unchanged stepClock can alternate with batching without replacing the iterator', () => {
    const {cpu, board, operands} = fixture([result(1, [final])]);
    board.clock = inputs => {assert.deepEqual(inputs, {ready_n: 1}); return partial;};
    const iterator = cpu.iterator;
    assert.equal(cpu.stepClock(1), partial); assert.deepEqual(operands, []);
    assert.equal(cpu.runTransactions({maxPeriods: 1}).status, 'halted');
    assert.equal(cpu.iterator, iterator); assert.deepEqual(operands, [0x1234]);
});
