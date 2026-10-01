/** Sampling and compiler diagnostics; neither is realtime qualification. */
export function wasmFunctionNames (bytes) {
    if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((b, i) => bytes[i] === b)) {
        throw Error('Invalid WASM header');
    }
    let position = 8, end = bytes.length;
    const byte = () => {
        if (position >= end) throw Error('Truncated WASM section');
        return bytes[position++];
    };
    const u32 = () => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const b = byte();
            if (i === 4 && b > 15) throw Error('Invalid WASM u32');
            value += (b & 127) * 2 ** (7 * i);
            if (!(b & 128)) return value;
        }
        throw Error('Invalid WASM u32');
    };
    const string = () => {
        const length = u32();
        if (position + length > end) throw Error('Truncated WASM name');
        const result = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(position, position + length));
        position += length;
        return result;
    };
    const names = new Map();
    while (position < bytes.length) {
        end = bytes.length;
        const id = byte(), length = u32(), sectionEnd = position + length;
        if (sectionEnd > bytes.length) throw Error('Truncated WASM section');
        end = sectionEnd;
        if (id === 0 && string() === 'name') {
            while (position < sectionEnd) {
                end = sectionEnd;
                const subsection = byte(), size = u32(), subsectionEnd = position + size;
                if (subsectionEnd > sectionEnd) throw Error('Truncated WASM name subsection');
                end = subsectionEnd;
                if (subsection === 1) {
                    const count = u32();
                    for (let i = 0; i < count; i++) {
                        const index = u32();
                        if (names.has(index)) throw Error('Duplicate WASM function name');
                        names.set(index, string());
                    }
                    if (position !== subsectionEnd) throw Error('Trailing WASM function-name data');
                }
                position = subsectionEnd;
            }
        }
        position = sectionEnd;
    }
    return names;
}

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

export function assertCompilerMode (mode, compilation) {
    if (!['liftoff', 'turbofan'].includes(mode)) return;
    const expected = mode === 'liftoff' ? 'Liftoff' : 'TurboFan';
    if (!compilation?.compilations?.length ||
        compilation.compilations.some(row => row.tier !== expected)) {
        throw Error(`Requested ${mode}-only mode did not produce exclusively ${expected} compilation`);
    }
}

export function parseWasmCompilations (text) {
    const compilations = [];
    const pattern = /Compiled function (\S+)#(\d+) using (\S+), took ([\d.]+) ms and .*?; bodysize (\d+) codesize (\d+)(?: name (.+))?$/;
    for (const line of text.split('\n')) {
        const m = line.match(pattern);
        if (!m) {
            if (line.includes('Compiled function ')) throw Error('Unsupported WASM compilation trace format');
            continue;
        }
        const row = {module: m[1], index: Number(m[2]), tier: m[3],
            compileMs: Number(m[4]), bodyBytes: Number(m[5]), codeBytes: Number(m[6]), name: m[7] || null};
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
        cortexM: compilations.filter(c => c.name && /CortexM|cortex_m|step_internal|step_execute|step_batch/.test(c.name)),
        compilations};
}
