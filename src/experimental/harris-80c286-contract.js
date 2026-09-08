/** Harris August 1996 80C286, file 2947.2. See docs/HARRIS-80C286-BUS-CONTRACT.md.
 * Logic levels, NOT asserted/deasserted booleans. A `_n` suffix means active low.
 */
export const HARRIS_80C286_SOURCE = Object.freeze({
    url: 'https://datasheets.chipdb.org/Harris/80c286.pdf',
    sha256: '19c1f3e3e56a872135c70f6739c9db532cef87768d67196a0e490cbdba151672',
    revision: 'August 1996, file 2947.2', variant: 'CS80C286-12', package: 'PLCC-68'
});

// PDF p.3 (printed 3-69), component-side PLCC view; not PGA numbering.
// Null means NC. Power pins are recorded, not electrically simulated here.
export const HARRIS_80C286_PLCC = Object.freeze([
    null,
    'bhe_n', null, null, 's1_n', 's0_n', 'peack_n', 'a23', 'a22', 'vss',
    'a21', 'a20', 'a19', 'a18', 'a17', 'a16', 'a15', 'a14', 'a13', 'a12',
    'a11', 'a10', 'a9', 'a8', 'a7', 'a6', 'a5', 'a4', 'a3', 'reset', 'vcc',
    'clk', 'a2', 'a1', 'a0', 'vss', 'd0', 'd8', 'd1', 'd9', 'd2', 'd10',
    'd3', 'd11', 'd4', 'd12', 'd5', 'd13', 'd6', 'd14', 'd7', 'd15',
    null, 'error_n', 'busy_n', null, null, 'intr', null, 'nmi', 'vss', 'pereq',
    'vcc', 'ready_n', 'hold', 'hlda', 'cod_inta_n', 'm_io', 'lock_n'
]);

// PDF p.4 (printed 3-70): COD/INTA, M/IO, S1, S0 status table.
const statuses = {
    'memory-read': [0, 1, 0, 1],
    'memory-write': [0, 1, 1, 0],
    'code-read': [1, 1, 0, 1],
    'io-read': [1, 0, 0, 1],
    'io-write': [1, 0, 1, 0],
    'interrupt-acknowledge': [0, 0, 0, 0],
    'halt-or-shutdown': [0, 1, 0, 0]
};
export const HARRIS_80C286_STATUS = Object.freeze(Object.fromEntries(Object.entries(statuses)
    .map(([name, [cod_inta_n, m_io, s1_n, s0_n]]) => [name, Object.freeze({cod_inta_n, m_io, s1_n, s0_n})])));

export function decode286Status({cod_inta_n, m_io, s1_n, s0_n, a1 = 0}) {
    if (![cod_inta_n, m_io, s1_n, s0_n, a1].every(v => v === 0 || v === 1)) return 'unknown';
    if (s1_n === 1 && s0_n === 1) return 'passive';
    for (const [name, s] of Object.entries(HARRIS_80C286_STATUS)) {
        if (s.cod_inta_n === cod_inta_n && s.m_io === m_io && s.s1_n === s1_n && s.s0_n === s0_n) {
            return name === 'halt-or-shutdown' ? a1 ? 'halt' : 'shutdown' : name;
        }
    }
    return 'reserved';
}

/** Physical transfer planning only; segmentation/fault checks belong to CPU.
 * Odd words split high lane then low lane. Refuse a wrap pending a CPU contract.
 */
export function plan286Transfers({kind, address, width = 1, value = 0}) {
    if (kind === 'interrupt-acknowledge') {
        if ((address !== undefined && address !== 0) || width !== 1 || value !== 0)
            throw new RangeError('INTA is an addressless, byte-vector transaction');
        return Object.freeze([0,1].map(ackIndex=>Object.freeze({kind,ackIndex,
            address:0,width:1,a0:0,bhe_n:1,data:0,...HARRIS_80C286_STATUS[kind]})));
    }
    if (!['memory-read', 'memory-write', 'code-read', 'io-read', 'io-write'].includes(kind)) {
        throw new RangeError(`unsupported transfer kind ${kind}`);
    }
    const limit = kind.startsWith('io-') ? 0xffff : 0xffffff;
    if (!Number.isSafeInteger(address) || address < 0 || address > limit) throw new RangeError('address');
    if (width !== 1 && width !== 2) throw new RangeError('width');
    if (address + width - 1 > limit) throw new RangeError('address wrap is not implemented');
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** (width * 8)) throw new RangeError('value');
    const encode = (a, w, v) => Object.freeze({kind, address: a, width: w,
        a0: a & 1, bhe_n: w === 2 || (a & 1) ? 0 : 1,
        data: w === 1 && (a & 1) ? v << 8 : v, ...HARRIS_80C286_STATUS[kind]});
    return Object.freeze(width === 2 && address % 2 ?
        [encode(address, 1, value & 255), encode(address + 1, 1, value >>> 8)] :
        [encode(address, width, value)]);
}
