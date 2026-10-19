/** Bounded reduction of owned initial state. Never changes opcode or flag masks. */
export async function minimizeOracleProbe(probe,diverges,{maxEvaluations=128}={}) {
    if(!Number.isSafeInteger(maxEvaluations)||maxEvaluations<1)throw new RangeError('maxEvaluations');
    const clone=p=>({...p,bytes:[...p.bytes],models:[...p.models],regs:{...p.regs},ram:p.ram.map(pair=>[...pair])});
    let current=clone(probe),evaluations=0;
    const codeStart=(probe.regs.cs??0)*16+(probe.regs.ip??0x100);
    if(probe.ram.some(([a])=>a>=codeStart&&a<codeStart+probe.bytes.length))throw new Error('instruction-byte RAM overrides cannot be minimized');
    const reducible=key=>!['cs','ip'].includes(key); // do not relocate the opcode into initialized RAM
    const check=async candidate=>{if(evaluations===maxEvaluations)return false;evaluations++;return await diverges(candidate);};
    if(!await check(current))throw new Error('initial probe does not reproduce the requested divergence');
    // Delete independent register overrides (fall back to the probe defaults).
    for(const key of Object.keys(current.regs).filter(reducible)) {
        const candidate=clone(current);delete candidate.regs[key];
        if(await check(candidate))current=candidate;
    }
    // Delta-debug sparse initialized RAM, without manufacturing a disk/program.
    for(let chunk=Math.max(1,Math.ceil(current.ram.length/2));current.ram.length&&evaluations<maxEvaluations;chunk=Math.max(1,Math.floor(chunk/2))) {
        for(let start=0;start<current.ram.length&&evaluations<maxEvaluations;) {
            const candidate=clone(current);candidate.ram.splice(start,chunk);
            if(await check(candidate))current=candidate;else start+=chunk;
        }
        if(chunk===1)break;
    }
    // Bit clearing gives a deterministic bounded simplification, not a claim
    // of a globally shortest counterexample. Keep the same failure fingerprint.
    for(const key of Object.keys(current.regs).filter(reducible))for(let bit=15;bit>=0&&evaluations<maxEvaluations;bit--) {
        if(!(current.regs[key]&(1<<bit)))continue;
        const candidate=clone(current);candidate.regs[key]&=~(1<<bit);
        if(await check(candidate))current=candidate;
    }
    for(let i=0;i<current.ram.length;i++)for(let bit=7;bit>=0&&evaluations<maxEvaluations;bit--) {
        if(!(current.ram[i][1]&(1<<bit)))continue;
        const candidate=clone(current);candidate.ram[i][1]&=~(1<<bit);
        if(await check(candidate))current=candidate;
    }
    return {probe:current,evaluations,budgetExhausted:evaluations===maxEvaluations,
        method:'register/RAM deletion and bit clearing; fixed opcodes, models and flag masks; not global minimality'};
}
