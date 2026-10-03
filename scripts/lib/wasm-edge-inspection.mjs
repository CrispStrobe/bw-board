// Text inspection only: no instantiation, tier forcing, timing or qualification.
export function selectEdgeWat (wat) {
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
    const result = {functions, types, elements,
        limitations: ['Static selected disassembly is not execution or performance evidence',
            'Names can label merged methods; table presence alone does not establish a concrete device vtable slot',
            'No claim that sampled self time is removable cost']};
    if (JSON.stringify(result).length > 2_000_000) throw Error('Selected inspection exceeds receipt bound');
    return result;
}
