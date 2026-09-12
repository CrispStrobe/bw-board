/** Default-off cooperative host scheduling for the memory-only hybrid CPU.
 * READY events are invocation-relative offsets, applied before that period.
 * READY starts at zero on each invocation. To resume a scheduled run, rebase
 * remaining events and provide an event at zero for a currently high READY.
 * The caller owns exclusive CPU execution across awaited host yields.
 * There is no per-period callback, external interrupt or device scheduler here.
 */
import {CircuitFault} from './digital-circuit.js';

const OPTIONS = new Set(['cpu', 'maxPeriods', 'batchPeriods', 'wallBudgetMS', 'events', 'stopped', 'now', 'yieldTask']);
export async function runHarrisTransactions(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => !OPTIONS.has(key))) throw new TypeError('unsupported hybrid runner options');
    const {cpu, maxPeriods, batchPeriods = 128, wallBudgetMS = 8, events = [], stopped = () => false,
        now = () => performance.now(), yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))} = options;
    if (!Number.isSafeInteger(maxPeriods) || maxPeriods < 1) throw new RangeError('maxPeriods');
    if (!Number.isSafeInteger(batchPeriods) || batchPeriods < 1 || batchPeriods > 8192)
        throw new RangeError('batchPeriods 1..8192');
    if (!Number.isFinite(wallBudgetMS) || wallBudgetMS <= 0) throw new RangeError('wallBudgetMS');
    for (const [name, callback] of Object.entries({stopped, now, yieldTask}))
        if (typeof callback !== 'function') throw new TypeError(name);
    const capabilities = cpu?.board?.capabilities;
    if (typeof cpu?.runTransactions !== 'function' || !capabilities ||
        !['nativeMemoryBus', 'transactionBatching', 'hybridCPU', 'memoryOnly'].every(key => capabilities[key] === true) ||
        !['io', 'inta', 'intr', 'nmi', 'hold', 'dma'].every(key => capabilities[key] === false))
        throw new CircuitFault('UNSUPPORTED_TRANSACTION_BATCHING', 'explicit memory-only hybrid CPU required');
    if (!['running', 'halted', 'cancelled', 'faulted'].includes(cpu.status))
        throw new CircuitFault('CPU_NOT_RUNNING', cpu.status);
    if (!Array.isArray(events)) throw new TypeError('events');
    let previous = -1;
    const schedule = Array.from(events, event => {
        if (!event || typeof event !== 'object' || Array.isArray(event) ||
            Object.keys(event).some(key => !['at', 'ready_n'].includes(key)) ||
            !Number.isSafeInteger(event.at) || event.at <= previous || event.at < 0 || event.at >= maxPeriods ||
            (event.ready_n !== 0 && event.ready_n !== 1)) throw new TypeError('sorted unique READY events within budget required');
        previous = event.at;
        return {at: event.at, ready_n: event.ready_n};
    });
    let periods = 0, chunks = 0, activeMS = 0, maxChunkMS = 0, index = 0, ready_n = 0, retired = 0;
    let lastTime = -Infinity;
    const time = () => {
        const value = now();
        if (!Number.isFinite(value) || value < lastTime) throw new RangeError('now must return finite monotonic milliseconds');
        lastTime = value; return value;
    };
    const stop = () => {
        const value = stopped(periods);
        if (typeof value !== 'boolean') throw new TypeError('stopped must return boolean');
        return value;
    };
    const report = status => ({status, periods, chunks, activeMS, maxChunkMS});
    const invalid = () => new CircuitFault('INVALID_BATCH_RESULT', 'invalid bounded CPU transaction progress');
    let chunkStart = null;
    const closeChunk = end => {
        if (chunkStart === null) return;
        const duration = end - chunkStart;
        activeMS += duration; maxChunkMS = Math.max(maxChunkMS, duration); chunks++; chunkStart = null;
    };
    try {
        while (cpu.status === 'running' && periods < maxPeriods) {
            if (stop()) return report('stopped');
            chunkStart = time();
            while (cpu.status === 'running' && periods < maxPeriods) {
                if (index < schedule.length && schedule[index].at === periods) ready_n = schedule[index++].ready_n;
                const budget = Math.min(batchPeriods, maxPeriods - periods,
                    index < schedule.length ? schedule[index].at - periods : maxPeriods - periods);
                let result;
                try {result = cpu.runTransactions({maxPeriods: budget, maxBatchPeriods: budget, ready_n});}
                catch (error) {
                    const progress = error?.progress;
                    if (progress !== undefined) {
                        if (!Number.isSafeInteger(progress?.periods) || progress.periods < 0 ||
                            progress.periods > budget) throw invalid();
                        periods += progress.periods;
                    }
                    throw error;
                }
                if (!result || !Number.isSafeInteger(result.periods) || result.periods < 1 || result.periods > budget ||
                    !Number.isSafeInteger(result.retired) || result.retired < retired ||
                    !Array.isArray(result.completions) || result.completions.length > result.periods ||
                    Array.from(result.completions).some(transfer => !transfer || typeof transfer.last !== 'boolean' ||
                        (transfer.last && (!Number.isInteger(transfer.operand) || transfer.operand < 0 || transfer.operand > 65535))) ||
                    result.status !== (cpu.status === 'running' ? 'budget-exhausted' : cpu.status) ||
                    !['budget-exhausted', 'halted', 'cancelled'].includes(result.status) ||
                    (result.status === 'budget-exhausted' && result.periods !== budget)) throw invalid();
                periods += result.periods;
                retired = result.retired;
                const end = time(); // inspect wall time after every bounded CPU call
                const shouldStop = stop();
                if (shouldStop || cpu.status !== 'running' || periods === maxPeriods || end - chunkStart >= wallBudgetMS) {
                    closeChunk(end);
                    if (shouldStop) return report('stopped');
                    break;
                }
            }
            if (cpu.status === 'running' && periods < maxPeriods) await yieldTask();
        }
        return report(cpu.status === 'running' ? 'budget-exhausted' : cpu.status);
    } catch (error) {
        if (chunkStart !== null) {
            // Do not replace a wired fault if a diagnostic clock itself fails.
            try {closeChunk(time());} catch {chunkStart = null;}
        }
        const progress = Object.freeze(report('fault'));
        // Host callbacks may throw frozen errors or primitive values. Preserve
        // the original failure as cause rather than replacing it with an
        // incidental property-assignment TypeError and losing executed periods.
        let attached = false;
        if (error && (typeof error === 'object' || typeof error === 'function')) {
            try {error.runnerProgress = progress; attached = error.runnerProgress === progress;} catch {}
        }
        if (attached) throw error;
        const wrapped = new Error(error instanceof Error ? error.message : 'hybrid runner failed', {cause: error});
        if (typeof error?.code === 'string') wrapped.code = error.code;
        wrapped.runnerProgress = progress;
        throw wrapped;
    }
}
