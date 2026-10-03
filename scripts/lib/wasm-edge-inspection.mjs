// Text inspection only: no instantiation, tier forcing, timing or qualification.
export function selectEdgeWat (wat, {inspectVtables = false} = {}) {
    const lines = wat.split('\n');
    const functions = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/^  \(func /.test(lines[i]) || !/input_channels|edge_service_addrs|service_edge_driven_gpio_devices/.test(lines[i])) continue;
        const start = i;
        while (i + 1 < lines.length && !/^  \(/.test(lines[i + 1])) i++;
        functions.push({header: lines[start], wat: lines.slice(start, i + 1).join('\n')});
    }
    if (!functions.some(f => f.header.includes('input_channels')) ||
        !functions.some(f => f.header.includes('service_edge_driven_gpio_devices_cold'))) {
        throw Error('Required named callees absent');
    }
    const typeNames = new Set(functions.flatMap(f => [...f.wat.matchAll(/\(type (\$[^\s)]+|\d+)\)/g)].map(m => m[1])));
    const types = lines.filter(line => /^  \(type /.test(line) && typeNames.has(line.match(/^  \(type (?:\(;(\d+);\)|([^\s)]+))/)?.slice(1).find(Boolean)));
    const elements = lines.filter(line => /^  \(elem /.test(line));
    if (!elements.length) throw Error('No function table elements');
    const empty = functions.find(f => /DeclarativeLogicDevice.*input_channels/.test(f.header));
    const emptyName = empty?.header.match(/^  \(func (\S+)/)?.[1];
    const table = new Map();
    for (const line of elements) {
        const m = line.match(/^  \(elem .*?\(i32.const (\d+)\) func (.*)\)$/);
        if (!m) throw Error('Unsupported element format');
        m[2].split(/\s+/).forEach((name, i) => table.set(Number(m[1]) + i, name));
    }
    const emptyIndices = new Set([...table].filter(([, name]) => name === emptyName).map(([index]) => index));
    const vtableCandidates = [];
    for (const line of inspectVtables ? lines.filter(line => /^  \(data /.test(line)) : []) {
        const m = line.match(/^  \(data .*?\(i32.const (\d+)\) "(.*)"\)$/);
        if (!m) throw Error('Unsupported active data format');
        const data = [];
        for (let i = 0; i < m[2].length; i++) {
            if (m[2][i] !== '\\') { data.push(m[2].charCodeAt(i)); continue; }
            const escape = m[2].slice(i + 1, i + 3);
            if (/^[0-9a-f]{2}$/.test(escape)) { data.push(parseInt(escape, 16)); i += 2; }
            else if ('"\\'.includes(m[2][i + 1])) { data.push(m[2].charCodeAt(++i)); }
            else throw Error('Unsupported WAT byte escape');
        }
        const bytes = Uint8Array.from(data), view = new DataView(bytes.buffer);
        for (let p = 48; p + 8 <= bytes.length; p += 4) {
            if (!emptyIndices.has(view.getUint32(p, true))) continue;
            const base = p - 48;
            const words = Array.from({length: 14}, (_, i) => view.getUint32(base + 4 * i, true));
            if (!table.has(words[13]) || !table.has(words[3]) || !table.has(words[4])) continue;
            vtableCandidates.push({address: Number(m[1]) + base, words,
                slots: words.map((value, i) => ({offset: i * 4, value, symbol: i === 1 || i === 2 ? null : table.get(value) || null}))});
        }
    }
    if (inspectVtables && (!emptyIndices.size || !vtableCandidates.length)) throw Error('No static empty-slice vtable candidates');
    const result = {functions, types, elements, emptyName, emptyIndices: [...emptyIndices], vtableCandidates,
        limitations: ['Static selected disassembly is not execution or performance evidence',
            'Names can label merged methods; table presence alone does not establish a concrete device vtable slot',
            'No claim that sampled self time is removable cost']};
    if (JSON.stringify(result).length > 2_000_000) throw Error('Selected inspection exceeds receipt bound');
    return result;
}
