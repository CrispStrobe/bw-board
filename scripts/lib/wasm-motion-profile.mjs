/** Sampling and compiler diagnostics; neither is realtime qualification. */
export function summarizeCpuProfile (profile) {
    const {nodes, samples, timeDeltas} = profile;
    if (!Array.isArray(nodes) || !Array.isArray(samples) || !samples.length ||
        !Array.isArray(timeDeltas) || samples.length !== timeDeltas.length) {
        throw Error('Incomplete CPU profile');
    }
    const byId = new Map();
    for (const node of nodes) {
        if (!Number.isInteger(node.id) || byId.has(node.id) || !node.callFrame ||
            typeof node.callFrame.functionName !== 'string' || typeof node.callFrame.url !== 'string') {
            throw Error('Invalid CPU profile node');
        }
        byId.set(node.id, node);
    }
    const frames = new Map();
    let totalMicros = 0, wasmMicros = 0, wasmSamples = 0;
    for (let i = 0; i < samples.length; i++) {
        const node = byId.get(samples[i]), micros = timeDeltas[i];
        if (!node || !Number.isFinite(micros) || micros < 0) throw Error('Invalid CPU profile sample');
        const {functionName, url, lineNumber} = node.callFrame;
        const key = JSON.stringify([functionName, url, lineNumber]);
        const wasm = url.startsWith('wasm://') || functionName.startsWith('wasm-function');
        const frame = frames.get(key) || {functionName, url, lineNumber, wasm, samples: 0, selfMicros: 0};
        frame.samples++;
        frame.selfMicros += micros;
        frames.set(key, frame);
        totalMicros += micros;
        if (wasm) { wasmMicros += micros; wasmSamples++; }
    }
    if (!(totalMicros > 0)) throw Error('Empty CPU profile duration');
    const sorted = [...frames.values()].sort((a, b) => b.selfMicros - a.selfMicros);
    const describe = f => ({...f, processSelfShare: f.selfMicros / totalMicros});
    return {samples: samples.length, sampledMicros: totalMicros, wasmSamples,
        wasmSelfShare: wasmMicros / totalMicros,
        topFrames: sorted.slice(0, 30).map(describe),
        topWasmFrames: sorted.filter(f => f.wasm).slice(0, 30).map(describe),
        limitations: ['whole-process self samples include initialization, warmup and measurements',
            'sampling shares are attribution, not removable cost or an unprofiled timing A/B']};
}

export function parseWasmCompilations (text) {
    const compilations = [];
    const pattern = /Compiled function (\S+)#(\d+) using (\S+), took ([\d.]+) ms and .*?; bodysize (\d+) codesize (\d+) name (.+)$/;
    for (const line of text.split('\n')) {
        const m = line.match(pattern);
        if (!m) continue;
        const row = {module: m[1], index: Number(m[2]), tier: m[3],
            compileMs: Number(m[4]), bodyBytes: Number(m[5]), codeBytes: Number(m[6]), name: m[7]};
        if (![row.index, row.compileMs, row.bodyBytes, row.codeBytes].every(Number.isFinite)) {
            throw Error('Invalid WASM compilation trace');
        }
        compilations.push(row);
    }
    if (!compilations.length) throw Error('No WASM compilation trace records');
    return {count: compilations.length,
        tiers: Object.fromEntries([...new Set(compilations.map(c => c.tier))]
            .map(tier => [tier, compilations.filter(c => c.tier === tier).length])),
        largestBodies: [...compilations].sort((a, b) => b.bodyBytes - a.bodyBytes).slice(0, 30),
        cortexM: compilations.filter(c => /CortexM|cortex_m|step_internal|step_execute|step_batch/.test(c.name)),
        compilations};
}
