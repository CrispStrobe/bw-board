// Static original-code selection only; never instantiate or execute engines.
const wanted = ['step_batch', 'run_t16_cached_run', 'run_t16_cached_fast_paths',
    'execute_t16_fast_op', 'run_t16_fast_block', 'step_internal', 'debug_halted'];
export function selectCpuWat(wat) {
    const lines = wat.split('\n');
    const functions = [];
    const names = new Set();
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^  \(func (\S+)/);
        if (!match || !match[1].includes('CortexM')) continue;
        const labels = wanted.filter(label => match[1].includes(label));
        if (!labels.length) continue;
        const start = i;
        while (i + 1 < lines.length && !/^  \(/.test(lines[i + 1])) i++;
        const body = lines.slice(start, i + 1).join('\n');
        if (names.has(match[1])) throw Error('Duplicate selected function name');
        names.add(match[1]);
        const calls = new Map();
        for (const m of body.matchAll(/\b(?:return_call|call) (\$[^\s()]+|\d+)/g)) {
            calls.set(m[1], (calls.get(m[1]) || 0) + 1);
        }
        const memoryOps = {};
        for (const m of body.matchAll(/\b((?:i32|i64|f32|f64)\.(?:load|store)[\w]*|memory\.(?:copy|fill))\b/g)) {
            memoryOps[m[1]] = (memoryOps[m[1]] || 0) + 1;
        }
        functions.push({name: match[1], labels, header: lines[start], wat: body,
            directCalls: [...calls].map(([target, occurrences]) => ({target, occurrences})),
            memoryOps, localDeclarations: (body.match(/\(local /g) || []).length});
    }
    for (const required of ['step_batch', 'run_t16_cached_run']) {
        if (!functions.some(f => f.labels.includes(required))) throw Error('Required CPU body absent: ' + required);
    }
    const references = new Set(functions.flatMap(f => [...f.wat.matchAll(/\(type (\$[^\s)]+|\d+)\)/g)].map(m => m[1])));
    const types = lines.filter(line => /^  \(type /.test(line) && references.has(
        line.match(/^  \(type (?:\(;(\d+);\)|([^\s)]+))/)?.slice(1).find(Boolean)));
    const capturedTypes = new Set(types.map(line => line.match(/^  \(type (?:\(;(\d+);\)|([^\s)]+))/)?.slice(1).find(Boolean)));
    for (const ref of references) if (!capturedTypes.has(ref)) throw Error('Missing original CPU type: ' + ref);
    const result = {functions, types,
        absentLabels: wanted.filter(label => !functions.some(f => f.labels.includes(label))),
        limitations: ['Static code and textual operation counts are not execution frequency or performance evidence',
            'Functions may be inlined, folded or labelled with aliases; absent names do not prove absent work',
            'Direct calls are references, not a complete transitive call graph',
            'Memory offsets alone do not identify Rust fields or cache representation',
            'No cost-removal, causality, runtime-tier or qualification claim']};
    if (new TextEncoder().encode(JSON.stringify(result)).length > 2_000_000) throw Error('CPU selection exceeds receipt bound');
    return result;
}
