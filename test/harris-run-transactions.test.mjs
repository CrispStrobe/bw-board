import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runHarrisTransactions} from '../src/experimental/harris-run-transactions.js';

// Contract fake only: real electrical state/completion equivalence is tested
// independently by the hybrid boot integration suite.
function fixture({haltAt = Infinity, periodMS = 1} = {}) {
    let clock = 0, elapsed = 0, yields = 0;
    const calls = [], pins = [];
    const cpu = {status: 'running', board: {capabilities: {
        nativeMemoryBus: true, transactionBatching: true, hybridCPU: true, memoryOnly: true,
        io: false, inta: false, intr: false, nmi: false, hold: false, dma: false
    }}, runTransactions({maxPeriods, maxBatchPeriods, ready_n}) {
        assert.equal(maxPeriods, maxBatchPeriods);
        calls.push({at: clock, maxPeriods, ready_n});
        const periods = Math.min(maxPeriods, haltAt - clock);
        pins.push(...Array(periods).fill(ready_n)); clock += periods; elapsed += periods * periodMS;
        if (clock === haltAt) cpu.status = 'halted';
        return {status: cpu.status === 'running' ? 'budget-exhausted' : cpu.status,
            periods, retired: 0, completions: []};
    }};
    return {cpu, calls, pins, now: () => elapsed, yieldTask: async () => {yields++; elapsed += 100;},
        read: () => ({clock, elapsed, yields})};
}

test('READY edges apply before exact period, with bounded calls and no skipped clocks', async () => {
    const f = fixture();
    const result = await runHarrisTransactions({...f, read: undefined}).catch(error => error);
    assert.ok(result instanceof TypeError, 'unknown options are not silently ignored');
    const output = await runHarrisTransactions({cpu: f.cpu, now: f.now, yieldTask: f.yieldTask,
        maxPeriods: 13, batchPeriods: 4, wallBudgetMS: 5,
        events: [{at: 0, ready_n: 1}, {at: 3, ready_n: 0}, {at: 10, ready_n: 1}]});
    assert.deepEqual(f.calls, [
        {at: 0, maxPeriods: 3, ready_n: 1}, {at: 3, maxPeriods: 4, ready_n: 0},
        {at: 7, maxPeriods: 3, ready_n: 0}, {at: 10, maxPeriods: 3, ready_n: 1}
    ]);
    assert.deepEqual(f.pins, [...Array(3).fill(1), ...Array(7).fill(0), ...Array(3).fill(1)]);
    assert.deepEqual(output, {status: 'budget-exhausted', periods: 13, chunks: 2, activeMS: 13, maxChunkMS: 7});
    assert.deepEqual(f.read(), {clock: 13, elapsed: 113, yields: 1});
});

test('schedule is an owned copy across asynchronous yields', async () => {
    const f = fixture(); const events = [{at: 0, ready_n: 1}, {at: 2, ready_n: 0}];
    await runHarrisTransactions({cpu: f.cpu, maxPeriods: 4, batchPeriods: 1, wallBudgetMS: 1,
        now: f.now, events, yieldTask: async () => {events[1].ready_n = 1; events.push({at: 3, ready_n: 1});}});
    assert.deepEqual(f.pins, [1, 1, 0, 0]);
});

test('wall budget is checked after each bounded call; yield time excluded from active duration', async () => {
    const f = fixture();
    const result = await runHarrisTransactions({cpu: f.cpu, maxPeriods: 9, batchPeriods: 2,
        wallBudgetMS: 3, now: f.now, yieldTask: f.yieldTask});
    assert.deepEqual(result, {status: 'budget-exhausted', periods: 9, chunks: 3, activeMS: 9, maxChunkMS: 4});
    assert.equal(f.read().yields, 2); assert.equal(f.read().elapsed, 209);
});

test('stopped returns resumable CPU and restart preserves pending instruction ownership', async () => {
    const f = fixture(); const original = f.cpu.runTransactions;
    const first = await runHarrisTransactions({cpu: f.cpu, maxPeriods: 20, batchPeriods: 2,
        wallBudgetMS: 3, now: f.now, yieldTask: f.yieldTask, stopped: periods => periods >= 6});
    assert.equal(first.status, 'stopped'); assert.equal(first.periods, 6);
    assert.equal(f.cpu.status, 'running'); assert.equal(f.cpu.runTransactions, original);
    const resumed = await runHarrisTransactions({cpu: f.cpu, maxPeriods: 3, now: f.now});
    assert.equal(resumed.periods, 3); assert.equal(f.read().clock, 9);
});

test('stop requested during yield executes no next period; terminal states execute zero periods', async () => {
    const f = fixture(); let stopped = false;
    const result = await runHarrisTransactions({cpu: f.cpu, maxPeriods: 5, batchPeriods: 1,
        wallBudgetMS: 1, now: f.now, stopped: () => stopped, yieldTask: async () => {stopped = true;}});
    assert.equal(result.periods, 1); assert.equal(result.status, 'stopped');
    for (const state of ['halted', 'cancelled', 'faulted']) {
        f.cpu.status = state;
        assert.deepEqual(await runHarrisTransactions({cpu: f.cpu, maxPeriods: 1}),
            {status: state, periods: 0, chunks: 0, activeMS: 0, maxChunkMS: 0});
    }
    f.cpu.status = 'running';
    assert.equal((await runHarrisTransactions({cpu: f.cpu, maxPeriods: 1, stopped: () => true})).chunks, 0);
});

test('early halt counts actual progress and does not yield or add periods', async () => {
    const f = fixture({haltAt: 3});
    const result = await runHarrisTransactions({cpu: f.cpu, maxPeriods: 20, batchPeriods: 8,
        now: f.now, yieldTask: f.yieldTask});
    assert.deepEqual(result, {status: 'halted', periods: 3, chunks: 1, activeMS: 3, maxChunkMS: 3});
    assert.equal(f.read().yields, 0);
});

test('all options/events are admitted before executing any period', async () => {
    const f = fixture();
    for (const options of [null, [], {}, {maxPeriods: 0}, {maxPeriods: 1.5},
        {batchPeriods: 8193}, {batchPeriods: 0}, {wallBudgetMS: 0}, {wallBudgetMS: Infinity},
        {stopped: false}, {now: 0}, {yieldTask: false}, {observer() {}},
        {events: {}}, {events: [undefined]}, {events: new Array(1)},
        {events: [{at: -1, ready_n: 0}]}, {events: [{at: 10, ready_n: 0}]},
        {events: [{at: 1.5, ready_n: 0}]}, {events: [{at: 1, ready_n: true}]},
        {events: [{at: 0, ready_n: 1, intr: 1}]},
        {events: [{at: 2, ready_n: 1}, {at: 2, ready_n: 0}]},
        {events: [{at: 2, ready_n: 1}, {at: 1, ready_n: 0}]}]) {
        const input = options === null || Array.isArray(options) ? options : {cpu: f.cpu, maxPeriods: 10, ...options};
        if (options && !Array.isArray(options) && Object.keys(options).length === 0) delete input.maxPeriods;
        await assert.rejects(runHarrisTransactions(input));
    }
    assert.equal(f.calls.length, 0);
    for (const capability of Object.keys(f.cpu.board.capabilities)) {
        const original = f.cpu.board.capabilities[capability]; f.cpu.board.capabilities[capability] = !original;
        await assert.rejects(runHarrisTransactions({cpu: f.cpu, maxPeriods: 1}), {code: 'UNSUPPORTED_TRANSACTION_BATCHING'});
        f.cpu.board.capabilities[capability] = original;
    }
    f.cpu.status = 'uninitialized';
    await assert.rejects(runHarrisTransactions({cpu: f.cpu, maxPeriods: 1}), {code: 'CPU_NOT_RUNNING'});
});

test('malformed progress cannot overrun budget or loop without forward progress', async () => {
    const valid = {status: 'budget-exhausted', periods: 2, retired: 0, completions: []};
    for (const response of [null, {...valid, periods: 0}, {...valid, periods: 3}, {...valid, periods: 1},
        {...valid, periods: 1.5}, {...valid, status: 'halted'}, {...valid, retired: -1},
        {...valid, completions: [1, 2, 3]}, {...valid, completions: null},
        {...valid, completions: new Array(1)}, {...valid, completions: [{last: true}]},
        {...valid, completions: [{last: true, operand: -1}]}]) {
        const f = fixture(); let calls = 0;
        f.cpu.runTransactions = () => {calls++; return response;};
        await assert.rejects(runHarrisTransactions({cpu: f.cpu, maxPeriods: 2, now: () => 0}), {code: 'INVALID_BATCH_RESULT'});
        assert.equal(calls, 1);
    }
});

test('native faults preserve original per-call progress and add whole-run receipt', async () => {
    const f = fixture(); let calls = 0;
    const run = f.cpu.runTransactions;
    const fault = Object.assign(new Error('wired sample'), {progress: {periods: 1, busClock: 72}});
    f.cpu.runTransactions = options => {if (calls++ === 1) throw fault; return run(options);};
    await assert.rejects(runHarrisTransactions({cpu: f.cpu, maxPeriods: 10, batchPeriods: 2, now: f.now}), error => {
        assert.equal(error, fault); assert.deepEqual(error.progress, {periods: 1, busClock: 72});
        assert.equal(error.runnerProgress.periods, 3); assert.equal(error.runnerProgress.status, 'fault'); return true;
    });
    for (const periods of [-1, 3, NaN]) {
        const other = fixture();
        other.cpu.runTransactions = () => {throw Object.assign(new Error('bad receipt'), {progress: {periods}});};
        await assert.rejects(runHarrisTransactions({cpu: other.cpu, maxPeriods: 2}), {code: 'INVALID_BATCH_RESULT'});
    }
});

test('invalid timing and stop callbacks fail instead of silently misreporting responsiveness', async () => {
    const f = fixture();
    await assert.rejects(runHarrisTransactions({cpu: f.cpu, maxPeriods: 1, now: () => NaN}), RangeError);
    assert.equal(f.calls.length, 0);
    await assert.rejects(runHarrisTransactions({cpu: f.cpu, maxPeriods: 1, stopped: () => 0}), TypeError);
    assert.equal(f.calls.length, 0);
    let time = 2;
    await assert.rejects(runHarrisTransactions({cpu: f.cpu, maxPeriods: 1, now: () => time--}), RangeError);
    assert.equal(f.calls.length, 1);
});
