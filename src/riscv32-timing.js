/**
 * Timing models on a live RV32 core (E8): attach the retire trace
 * (riscv32-trace.js) to a core and feed a pipeline model
 * (uarch-pipeline.js, which owns the caches and the branch predictor).
 *
 *   const t = attachTiming(machine.cpu, {forwarding: true, dcache: {size: 1024}});
 *   machine.run(…);
 *   t.report();       // named stats: cpu.cycles, cpu.cpi, pipe.stall.loaduse, dcache.missRate, bp.accuracy…
 *   t.occupancy(64);  // the pipeline diagram of the last 64 cycles, rows labelled with disassembly
 *   t.detach();       // the core runs its untraced step again
 *
 * The functional core stays the single source of truth: attaching, detaching
 * or reconfiguring timing never changes what a program computes (asserted in
 * test/riscv32-timing.test.mjs against an untraced run of the same program).
 * Reconfiguring starts a fresh model at the current instruction (cold caches
 * and predictor) — "switch models at a region of interest", E8.5's simplest
 * form.
 *
 * @module
 */

import {attachRetireTrace, disasmRv32} from './riscv32-trace.js';
import {PipelineModel, PIPELINE_DEFAULTS, STAGES, STALL_REASONS} from './uarch-pipeline.js';

export {PIPELINE_DEFAULTS, STAGES, STALL_REASONS};

/**
 * @param {import('./riscv32.js').RiscV32} cpu
 * @param {object} [cfg] PipelineModel config (see PIPELINE_DEFAULTS)
 */
export function attachTiming(cpu, cfg = {}) {
    let model = new PipelineModel(cfg);
    let records = 0;
    let trace = attachRetireTrace(cpu, rec => { records++; model.push(rec); });
    return {
        get model() { return model; },
        get config() { return {...model.cfg}; },
        get cpu() { return cpu; },
        /** Trace records produced so far (retired instructions + traps). */
        get records() { return records; },
        /** Named stats of everything simulated so far (in-flight instructions
         *  are not yet counted: they have not reached WB). */
        report() { return model.report(); },
        /** Zero the counters, keep the pipeline, caches and predictor warm. */
        resetStats() { model.resetStats(); },
        /** A fresh model with a new config, from the next instruction on. */
        reconfigure(next = {}) { model = new PipelineModel(next); },
        /** The pipeline diagram window, each row labelled with its disassembly. */
        occupancy(lastCycles) {
            const o = model.occupancy(lastCycles);
            for (const r of o.rows) r.text = r.cls === 'trap' ? 'trap' : disasmRv32(r.op ?? -1, r.pc >>> 0);
            return o;
        },
        detach() { if (trace) { trace.detach(); trace = null; } },
        get attached() { return trace !== null; }
    };
}

export default attachTiming;
